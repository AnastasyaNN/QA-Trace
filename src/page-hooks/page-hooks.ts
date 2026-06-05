// Runtime init (token/redaction flag) is sent by content script via window.postMessage.

type PostKind = 'console' | 'network';

interface QaTraceXhr extends XMLHttpRequest {
    _qaMethod: string,
    _qaUrl: string,
    _qaRequestHeaders: Record<string, string>,
    _qaRequestBody: string
}

interface QaTraceWindow extends Window {
    __qaTraceHooksInstalled?: boolean
}

interface ConsolePayload {
    message: string,
    stack?: string
}

interface NetworkPayload {
    message: string,
    status?: number,
    method: string,
    urlRequested: string,
    requestHeaders: Record<string, string>,
    requestBody: string,
    responseHeaders: Record<string, string>,
    responseBody: string
}

class QaTracePageHooks {
    private static readonly SENSITIVE_HEADER_PATTERNS: readonly string[] = [
        'authorization',
        'proxy-authorization',
        'cookie',
        'set-cookie',
        'x-api-key',
        'x-auth-token',
        'x-csrf-token',
        'x-xsrf-token',
        'token',
        'secret',
        'password'
    ];
    private static readonly SENSITIVE_BODY_PATTERNS: readonly string[] = [
        'authorization',
        'token',
        'secret',
        'password',
        'passwd',
        'api_key',
        'apikey',
        'access_token',
        'refresh_token',
        'session'
    ];

    private qaTraceToken: string | null = null
    private shouldStripUrlQuery = true

    private readonly originalFetch: typeof window.fetch
    private readonly originalXhrOpen: typeof XMLHttpRequest.prototype.open
    private readonly originalXhrSend: typeof XMLHttpRequest.prototype.send
    private readonly originalXhrSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader

    constructor() {
        this.originalFetch = window.fetch.bind(window)
        this.originalXhrOpen = XMLHttpRequest.prototype.open
        this.originalXhrSend = XMLHttpRequest.prototype.send
        this.originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader
    }

    static install(): void {
        const w = window as QaTraceWindow
        if (w.__qaTraceHooksInstalled)
            return
        w.__qaTraceHooksInstalled = true
        new QaTracePageHooks().attach()
    }

    private attach(): void {
        window.addEventListener('message', this.onInitMessage)
        window.addEventListener('error', this.onWindowError)
        window.addEventListener('unhandledrejection', this.onUnhandledRejection)
        window.fetch = this.patchedFetch.bind(this)
        this.patchXmlHttpRequest()
    }

    private readonly onInitMessage = (event: MessageEvent): void => {
        if (event.source !== window || !event.data || event.data.source !== 'qa-trace-init')
            return
        if (typeof event.data.token !== 'string' || !event.data.token)
            return
        this.qaTraceToken = event.data.token
        this.shouldStripUrlQuery = event.data.stripUrlQuery
    }

    private readonly onWindowError = (event: ErrorEvent): void => {
        this.post('console', {
            message: event.message || this.serialize(event.error) || 'Unknown error',
            stack: event.error?.stack || (new Error()).stack
        })
    }

    private readonly onUnhandledRejection = (event: PromiseRejectionEvent): void => {
        const errorObj = event.reason instanceof Error ? event.reason : null
        this.post('console', {
            message: 'Unhandled Promise Rejection: ' + this.serialize(event.reason),
            stack: errorObj?.stack || (new Error()).stack
        })
    }

    private stripRequestUrlForTelemetry(raw: string | null | undefined): string {
        if (!this.shouldStripUrlQuery)
            return raw == null
                ? ''
                : String(raw)
        if (raw == null || raw === '')
            return ''
        const s = String(raw).trim()
        if (!s)
            return ''
        try {
            const base = typeof window !== 'undefined' && window.location
                ? window.location.href
                : undefined
            const u = new URL(s, base)
            if (u.protocol === 'http:' || u.protocol === 'https:')
                return u.origin + (u.pathname || '/')
            return u.origin + (u.pathname || '')
        } catch {
            const noHash = s.split('#')[0] || ''
            return noHash.split('?')[0] || ''
        }
    }

    private circularReplacer(): (_key: string, value: unknown) => unknown {
        const seen = new WeakSet()
        return (_key: string, value: unknown) => {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) return '[Circular]'
                seen.add(value)
            }
            return value
        }
    }

    private serialize(input: unknown): string {
        if (input instanceof Error)
            return input.stack || `${input.name}: ${input.message}` || input.toString()
        if (typeof input === 'object' && input !== null) {
            try {
                return JSON.stringify(input, this.circularReplacer())
            } catch {
            }
            try {
                return Object.prototype.toString.call(input)
            } catch {
            }
        }
        return String(input)
    }

    private post(kind: PostKind, payload: ConsolePayload | NetworkPayload): void {
        if (!this.qaTraceToken)
            return
        const targetOrigin = typeof window !== 'undefined' && window.location
            ? window.location.origin
            : '*'
        window.postMessage({
            source: 'qa-trace',
            token: this.qaTraceToken,
            kind,
            payload
        }, targetOrigin)
    }

    private isSensitiveHeader(name: string): boolean {
        const normalized = String(name || '').toLowerCase()
        return QaTracePageHooks.SENSITIVE_HEADER_PATTERNS.some((pattern) => normalized.includes(pattern))
    }

    private isSensitiveBodyKey(name: string): boolean {
        const normalized = String(name || '').toLowerCase()
        return QaTracePageHooks.SENSITIVE_BODY_PATTERNS.some((pattern) => normalized.includes(pattern))
    }

    private redactParsedJson(value: unknown, depth = 0): unknown {
        if (depth > 6)
            return '[Truncated]'
        if (Array.isArray(value))
            return value.map((entry) => this.redactParsedJson(entry, depth + 1))
        if (!value || typeof value !== 'object')
            return value
        const redacted: Record<string, unknown> = {}
        Object.entries(value).forEach(([key, val]) => {
            if (this.isSensitiveBodyKey(key))
                redacted[key] = '[REDACTED]'
            else
                redacted[key] = this.redactParsedJson(val, depth + 1)
        })
        return redacted
    }

    private truncateBody(value: string | null | undefined, max = 12000): string {
        if (value == null)
            return ''
        const str = String(value)
        return str.length > max
            ? str.slice(0, max)
            : str
    }

    private redactBodyText(value: string | null | undefined): string {
        const text = this.truncateBody(value)
        if (!text)
            return ''
        try {
            const parsed: unknown = JSON.parse(text)
            return this.truncateBody(JSON.stringify(this.redactParsedJson(parsed)))
        } catch {
            return text
        }
    }

    private sanitizeHeadersObject(headersObj: Record<string, unknown>): Record<string, string> {
        const result: Record<string, string> = {}
        if (!headersObj || typeof headersObj !== 'object')
            return result
        Object.entries(headersObj).forEach(([k, v]) => {
            if (this.isSensitiveHeader(k))
                return
            result[String(k)] = String(v)
        })
        return result
    }

    private headersToObject(headersLike: HeadersInit | Headers | null | undefined): Record<string, string> {
        const result: Record<string, string> = {}
        try {
            if (!headersLike)
                return result
            if (typeof Headers !== 'undefined' && headersLike instanceof Headers) {
                headersLike.forEach((value, key) => {
                    if (!this.isSensitiveHeader(key))
                        result[key] = value
                })
                return result
            }
            if (Array.isArray(headersLike)) {
                headersLike.forEach(([key, value]) => {
                    if (!this.isSensitiveHeader(key))
                        result[String(key)] = String(value)
                })
                return result
            }
            return this.sanitizeHeadersObject(headersLike as Record<string, unknown>)
        } catch {
            return result
        }
    }

    private parseRequestBody(body: BodyInit | null | undefined): string {
        if (body == null)
            return ''
        if (typeof body === 'string')
            return this.redactBodyText(body);
        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
            return this.redactBodyText(body.toString())
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
            const pairs: [string, string][] = []
            body.forEach((value, key) => {
                const safeValue = this.isSensitiveBodyKey(key)
                    ? '[REDACTED]'
                    : (typeof value === 'string'
                        ? value
                        : '[binary]'
                    )
                pairs.push([key, safeValue])
            })
            return this.truncateBody(JSON.stringify(pairs))
        }
        try {
            return this.redactBodyText(this.serialize(body))
        } catch {
            return ''
        }
    }

    private async readResponseBodySafe(response: Response): Promise<string> {
        try {
            const cloned = response.clone()
            const text = await cloned.text()
            return this.redactBodyText(text)
        } catch {
            return ''
        }
    }

    private async patchedFetch(...args: Parameters<typeof fetch>): Promise<Response> {
        const input = args[0]
        const init = args[1] || {}
        const requestUrlRaw = typeof input === 'string'
            ? input
            : ((input as Request)?.url || '')
        const requestUrl = this.stripRequestUrlForTelemetry(requestUrlRaw)
        const requestMethod = (init as RequestInit)?.method || (input as Request)?.method || 'GET'
        const requestHeaders = this.headersToObject((init as RequestInit)?.headers || (input as Request)?.headers)
        const requestBody = this.parseRequestBody((init as RequestInit)?.body)
        try {
            const response = await this.originalFetch(...args)
            if (!response.ok) {
                const responseHeaders = this.headersToObject(response.headers)
                const responseBody = await this.readResponseBodySafe(response)
                this.post('network', {
                    message: 'HTTP ' + response.status + ' ' + response.statusText,
                    status: response.status,
                    method: requestMethod,
                    urlRequested: requestUrl,
                    requestHeaders,
                    requestBody,
                    responseHeaders,
                    responseBody
                })
            }
            return response
        } catch (error) {
            this.post('network', {
                message: 'Fetch error: ' + this.serialize(error),
                method: requestMethod,
                urlRequested: requestUrl,
                requestHeaders,
                requestBody,
                responseHeaders: {},
                responseBody: ''
            })
            throw error
        }
    }

    private patchXmlHttpRequest(): void {
        const originalXhrOpen = this.originalXhrOpen
        const originalXhrSend = this.originalXhrSend
        const originalXhrSetRequestHeader = this.originalXhrSetRequestHeader
        const self = this

        XMLHttpRequest.prototype.open = function (this: QaTraceXhr, method: string, url: string | URL) {
            this._qaMethod = method
            this._qaUrl = typeof url === 'string'
                ? url
                : url.toString()
            this._qaRequestHeaders = {}
            return originalXhrOpen.apply(this, arguments as unknown as Parameters<typeof originalXhrOpen>)
        }

        XMLHttpRequest.prototype.setRequestHeader = function (this: QaTraceXhr, header: string, value: string) {
            try {
                if (!self.isSensitiveHeader(header)) {
                    this._qaRequestHeaders = this._qaRequestHeaders || {}
                    this._qaRequestHeaders[String(header)] = String(value)
                }
            } catch {
            }
            return originalXhrSetRequestHeader.call(this, header, value)
        }

        XMLHttpRequest.prototype.send = function (this: QaTraceXhr, body?: Document | XMLHttpRequestBodyInit | null) {
            this._qaRequestBody = self.parseRequestBody(body as BodyInit | null)
            this.addEventListener('error', () => {
                const xhrUrl = self.stripRequestUrlForTelemetry(this._qaUrl || '')
                self.post('network', {
                    message: 'XHR ' + (this._qaMethod || 'GET') + ' ' + xhrUrl + ' failed with status ' + this.status,
                    status: this.status,
                    method: this._qaMethod || 'GET',
                    urlRequested: xhrUrl,
                    requestHeaders: this._qaRequestHeaders || {},
                    requestBody: this._qaRequestBody || '',
                    responseHeaders: {},
                    responseBody: ''
                })
            })
            this.addEventListener('load', () => {
                if (this.status >= 400) {
                    const responseHeaders: Record<string, string> = {}
                    const rawHeaders = this.getAllResponseHeaders?.() || ''
                    rawHeaders.split('\n').forEach((line) => {
                        const idx = line.indexOf(':')
                        if (idx <= 0)
                            return
                        const key = line.slice(0, idx).trim()
                        const value = line.slice(idx + 1).trim()
                        if (!self.isSensitiveHeader(key))
                            responseHeaders[key] = value
                    })
                    const xhrUrlLoaded = self.stripRequestUrlForTelemetry(this._qaUrl || '')
                    self.post('network', {
                        message: 'XHR ' + (this._qaMethod || 'GET') + ' ' + xhrUrlLoaded + ' failed with status ' + this.status,
                        status: this.status,
                        method: this._qaMethod || 'GET',
                        urlRequested: xhrUrlLoaded,
                        requestHeaders: this._qaRequestHeaders || {},
                        requestBody: this._qaRequestBody || '',
                        responseHeaders,
                        responseBody: self.redactBodyText(this.responseText || '')
                    })
                }
            })
            return originalXhrSend.call(this, body)
        }
    }
}

QaTracePageHooks.install();
