// Runtime init (token/redaction flag) is sent by content script via window.postMessage.

import {BodyRedaction, MAX_RESPONSE_CHARS, MAX_BODY_REDACT_CHARS, MAX_STORED_RESPONSE_BYTES} from "../lib/body-redaction";

type PostKind = 'console' | 'network' | 'network-request';

interface QaTraceXhr extends XMLHttpRequest {
    _qaMethod: string,
    _qaUrl: string,
    _qaRequestHeaders: Record<string, string>
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

interface NetworkRequestPayload {
    status?: number,
    method: string,
    urlRequested: string,
    requestHeaders: Record<string, string>,
    requestBody: string,
    responseHeaders: Record<string, string>,
    responseBody: string
}

type PendingEvent = {
    kind: PostKind,
    payload: ConsolePayload | NetworkPayload | NetworkRequestPayload
}

class QaTracePageHooks {
    private static readonly BINARY_CONTENT_TYPE =
        /^(?:image|audio|video|font)\/|^application\/(?:pdf|zip|gzip|x-gzip|x-bzip2|x-tar|x-7z-compressed|x-rar-compressed|wasm|x-protobuf|vnd\.(?:ms-|openxmlformats|oasis\.opendocument))/i

    private static readonly MAX_PENDING_EVENTS = 250

    private qaTraceToken: string | null = null
    private initialized = false
    private shouldStripUrlQuery = true
    private trackAllNetwork = false
    private disableBodyTruncation = false
    private pending: PendingEvent[] = []

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

    private get redactCap(): number {
        return this.disableBodyTruncation ? Infinity : MAX_BODY_REDACT_CHARS
    }

    private get responseCap(): number {
        return this.disableBodyTruncation ? Infinity : MAX_RESPONSE_CHARS
    }

    static install(): void {
        const w = window as QaTraceWindow
        if (w.__qaTraceHooksInstalled)
            return
        w.__qaTraceHooksInstalled = true
        const hooks = new QaTracePageHooks()
        hooks.seedFromScriptTag()
        hooks.attach()
    }

    // trackAll/disableBodyTruncation arrive in the injected script's URL fragment so capture is
    // gated and the body cap is set before the first request, not read-then-discarded. Runs while
    // document.currentScript is still valid.
    private seedFromScriptTag(): void {
        try {
            const src = (document.currentScript as HTMLScriptElement | null)?.src || ''
            const hash = src.includes('#') ? src.slice(src.indexOf('#') + 1) : ''
            const params = new URLSearchParams(hash)
            if (params.get('trackAll') === '1')
                this.trackAllNetwork = true
            if (params.get('disableBodyTruncation') === '1')
                this.disableBodyTruncation = true
        } catch {
        }
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
        const token = event.data.token
        if (typeof token !== 'string' || !token)
            return
        if (this.qaTraceToken && token !== this.qaTraceToken)
            return
        this.qaTraceToken = token
        this.shouldStripUrlQuery = this.initialized
            ? this.shouldStripUrlQuery || !!event.data.stripUrlQuery
            : !!event.data.stripUrlQuery
        this.trackAllNetwork = this.trackAllNetwork || !!event.data.trackAllNetwork
        if (!this.initialized)
            this.disableBodyTruncation = this.disableBodyTruncation || !!event.data.disableBodyTruncation
        this.initialized = true
        this.flushPending()
    }

    // Hooks intercept requests before the content script delivers the token/flags, so events captured
    // during page load are buffered and replayed here.
    private flushPending(): void {
        const buffered = this.pending
        this.pending = []
        for (const {kind, payload} of buffered) {
            if (kind === 'network-request' && !this.trackAllNetwork)
                continue
            this.sendNow(kind, payload)
        }
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

    // Strips query/hash only and KEEPS the origin: captured network URLs must keep their host so
    // the API endpoint stays shareable. Origin redaction happens later, at prompt/webhook egress.
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

    private post(kind: PostKind, payload: ConsolePayload | NetworkPayload | NetworkRequestPayload): void {
        if (!this.initialized) {
            this.pushPending({kind, payload})
            return
        }
        this.sendNow(kind, payload)
    }

    private pushPending(entry: PendingEvent): void {
        if (this.pending.length >= QaTracePageHooks.MAX_PENDING_EVENTS) {
            // Evict a network-request before a console/network error, which is the higher-value signal.
            const evictable = this.pending.findIndex((e) => e.kind === 'network-request')
            if (evictable >= 0)
                this.pending.splice(evictable, 1)
            else
                this.pending.shift()
        }
        this.pending.push(entry)
    }

    private sendNow(kind: PostKind, payload: ConsolePayload | NetworkPayload | NetworkRequestPayload): void {
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

    private sanitizeHeadersObject(headersObj: Record<string, unknown>): Record<string, string> {
        const result: Record<string, string> = {}
        if (!headersObj || typeof headersObj !== 'object')
            return result
        Object.entries(headersObj).forEach(([k, v]) => {
            if (BodyRedaction.isSensitiveKey(k))
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
                    if (!BodyRedaction.isSensitiveKey(key))
                        result[key] = value
                })
                return result
            }
            if (Array.isArray(headersLike)) {
                headersLike.forEach(([key, value]) => {
                    if (!BodyRedaction.isSensitiveKey(key))
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
            return BodyRedaction.redact(body, this.redactCap, this.responseCap);
        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
            return BodyRedaction.redact(body.toString(), this.redactCap, this.responseCap)
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
            const pairs: [string, string][] = []
            body.forEach((value, key) => {
                const safeValue = BodyRedaction.isSensitiveKey(key)
                    ? '[REDACTED]'
                    : (typeof value === 'string'
                        ? value
                        : '[binary]'
                    )
                pairs.push([key, safeValue])
            })
            return BodyRedaction.truncate(BodyRedaction.redactTokenPatterns(JSON.stringify(pairs)), this.responseCap)
        }
        try {
            return BodyRedaction.redact(this.serialize(body), this.redactCap, this.responseCap)
        } catch {
            return ''
        }
    }

    // Skips only clearly-binary bodies (media/fonts/archives); absent/unknown/octet-stream types
    // are treated as readable so mislabeled textual bodies are still captured.
    private isBinaryContentType(contentType: string | null | undefined): boolean {
        return !!contentType && QaTracePageHooks.BINARY_CONTENT_TYPE.test(contentType)
    }

    private static responseBodyUnavailable(reason: unknown): string {
        const detail = reason instanceof Error
            ? reason.message
            : String(reason ?? '')
        return detail
            ? `[QA Trace: response body could not be captured - ${detail}]`
            : '[QA Trace: response body could not be captured]'
    }

    // exact size is known for XHR (full responseText is in memory); a streamed fetch body is only
    // read up to the cap, so its size is reported as a lower bound.
    private static responseTooLarge(bytes: number, exact: boolean): string {
        const size = QaTracePageHooks.formatBytes(bytes)
        return `[QA Trace: response body too large to store - ${exact ? size : 'over ' + size}]`
    }

    private static formatBytes(bytes: number): string {
        if (bytes >= 1_000_000)
            return (bytes / 1_000_000).toFixed(1) + ' MB'
        if (bytes >= 1_000)
            return Math.round(bytes / 1_000) + ' KB'
        return bytes + ' B'
    }

    private static byteLength(str: string): number {
        return new TextEncoder().encode(str).length
    }

    private async readResponseBody(response: Response): Promise<string> {
        try {
            if (this.isBinaryContentType(response.headers.get('content-type')))
                return ''
            // Truncating mode never keeps more than redactCap, so don't buffer up to 9 MB to slice
            // it away; the "too large" marker is only meaningful when storing full bodies.
            const cap = this.disableBodyTruncation ? MAX_STORED_RESPONSE_BYTES : this.redactCap
            const {text, bytes, overflow} = await this.readCappedText(response, cap)
            if (overflow && this.disableBodyTruncation)
                return QaTracePageHooks.responseTooLarge(bytes, false)
            return BodyRedaction.redact(text, this.redactCap, this.responseCap)
        } catch (error) {
            return QaTracePageHooks.responseBodyUnavailable(error)
        }
    }

    // Reads at most cap bytes from the (cloned) body, then cancels so we never buffer a large or
    // streaming body; overflow is true when the source held more than cap. Cap is bytes because the
    // storage.local quota is bytes; output length is bounded downstream by responseCap.
    private async readCappedText(source: Request | Response, cap: number): Promise<{text: string, bytes: number, overflow: boolean}> {
        const body = source.body
        if (!body) {
            const full = await source.text()
            const bytes = QaTracePageHooks.byteLength(full)
            return {text: full, bytes, overflow: bytes > cap}
        }
        const reader = body.getReader()
        const decoder = new TextDecoder()
        let out = ''
        let bytes = 0
        try {
            while (bytes <= cap) {
                const {done, value} = await reader.read()
                if (done)
                    return {text: out + decoder.decode(), bytes, overflow: false}
                bytes += value.byteLength
                out += decoder.decode(value, {stream: true})
            }
        } finally {
            void reader.cancel()
        }
        return {text: out, bytes, overflow: true}
    }

    private readXhrResponseBody(xhr: XMLHttpRequest): string {
        try {
            if (this.isBinaryContentType(xhr.getResponseHeader('content-type')))
                return ''
            const type = xhr.responseType
            const raw = type === '' || type === 'text'
                ? (xhr.responseText || '')
                : type === 'json'
                    ? JSON.stringify(xhr.response)
                    : ''
            if (!raw)
                return ''
            // UTF-8 is at most 3 bytes per UTF-16 code unit, so skip the encode when it can't overflow.
            if (raw.length * 3 > MAX_STORED_RESPONSE_BYTES) {
                const bytes = QaTracePageHooks.byteLength(raw)
                if (bytes > MAX_STORED_RESPONSE_BYTES)
                    return QaTracePageHooks.responseTooLarge(bytes, true)
            }
            return BodyRedaction.redact(raw, this.redactCap, this.responseCap)
        } catch (error) {
            return QaTracePageHooks.responseBodyUnavailable(error)
        }
    }

    private parseRawResponseHeaders(raw: string): Record<string, string> {
        const result: Record<string, string> = {}
        raw.split('\n').forEach((line) => {
            const idx = line.indexOf(':')
            if (idx <= 0)
                return
            const key = line.slice(0, idx).trim()
            const value = line.slice(idx + 1).trim()
            if (!BodyRedaction.isSensitiveKey(key))
                result[key] = value
        })
        return result
    }

    private shouldRecordRequest(status: number): boolean {
        return this.trackAllNetwork && status !== 0
    }

    private emitNetworkEvent(isError: boolean, shouldRecordRequest: boolean, errorMessage: string, payload: NetworkRequestPayload): void {
        if (isError)
            this.post('network', {message: errorMessage, ...payload})
        if (shouldRecordRequest)
            this.post('network-request', payload)
    }

    private async patchedFetch(...args: Parameters<typeof fetch>): Promise<Response> {
        const self = this
        const input = args[0]
        const init = (args[1] || {}) as RequestInit
        const requestUrlRaw = typeof input === 'string'
            ? input
            : ((input as Request)?.url || '')
        const requestUrl = this.stripRequestUrlForTelemetry(requestUrlRaw)
        const requestMethod = init.method || (input as Request)?.method || 'GET'
        const requestHeaders = this.headersToObject(init.headers || (input as Request)?.headers)
        const requestClone = init.body == null && typeof Request !== 'undefined' && input instanceof Request && input.body
            ? input.clone()
            : null
        try {
            const response = await this.originalFetch(...args)
            const isError = !response.ok && response.status !== 0
            const shouldRecordRequest = this.shouldRecordRequest(response.status)
            if (!isError && !shouldRecordRequest)
                return response

            // Read the body now, not lazily: an unread clone held across the init gap makes the
            // browser buffer the whole response and loses large bodies. post() buffers pre-init.
            const payload: NetworkRequestPayload = {
                status: response.status,
                method: requestMethod,
                urlRequested: requestUrl,
                requestHeaders,
                requestBody: await readRequestBody(),
                responseHeaders: this.headersToObject(response.headers),
                responseBody: await this.readResponseBody(response.clone())
            }
            this.emitNetworkEvent(isError, shouldRecordRequest, 'HTTP ' + response.status + ' ' + response.statusText, payload)
            return response
        } catch (error) {
            this.post('network', {
                message: 'Fetch error: ' + this.serialize(error),
                method: requestMethod,
                urlRequested: requestUrl,
                requestHeaders,
                requestBody: await readRequestBody(),
                responseHeaders: {},
                responseBody: ''
            })
            throw error
        }

        async function readRequestBody(): Promise<string> {
            if (init.body != null)
                return self.parseRequestBody(init.body)
            if (!requestClone)
                return ''
            if (self.isBinaryContentType(requestClone.headers.get('content-type')))
                return ''
            try {
                const {text} = await self.readCappedText(requestClone, self.redactCap)
                return BodyRedaction.redact(text, self.redactCap, self.responseCap)
            } catch {
                return ''
            }
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
                if (!BodyRedaction.isSensitiveKey(header)) {
                    this._qaRequestHeaders = this._qaRequestHeaders || {}
                    this._qaRequestHeaders[String(header)] = String(value)
                }
            } catch {
            }
            return originalXhrSetRequestHeader.call(this, header, value)
        }

        XMLHttpRequest.prototype.send = function (this: QaTraceXhr, body?: Document | XMLHttpRequestBodyInit | null) {
            // Defer body redaction to emit time (past the emit gate), mirroring patchedFetch, so
            // successful untracked requests don't pay parseRequestBody on the send hot path.
            const readRequestBody = () => self.parseRequestBody(body as BodyInit | null)
            this.addEventListener('error', () => {
                const xhrUrl = self.stripRequestUrlForTelemetry(this._qaUrl || '')
                self.post('network', {
                    message: 'XHR ' + (this._qaMethod || 'GET') + ' ' + xhrUrl + ' failed with status ' + this.status,
                    status: this.status,
                    method: this._qaMethod || 'GET',
                    urlRequested: xhrUrl,
                    requestHeaders: this._qaRequestHeaders || {},
                    requestBody: readRequestBody(),
                    responseHeaders: {},
                    responseBody: ''
                })
            })
            this.addEventListener('load', () => {
                const xhr = this
                const isError = xhr.status >= 400
                const shouldRecordRequest = self.shouldRecordRequest(xhr.status)
                if (!isError && !shouldRecordRequest)
                    return
                const xhrUrlLoaded = self.stripRequestUrlForTelemetry(xhr._qaUrl || '')
                const method = xhr._qaMethod || 'GET'
                const payload: NetworkRequestPayload = {
                    status: xhr.status,
                    method,
                    urlRequested: xhrUrlLoaded,
                    requestHeaders: xhr._qaRequestHeaders || {},
                    requestBody: readRequestBody(),
                    responseHeaders: self.parseRawResponseHeaders(xhr.getAllResponseHeaders?.() || ''),
                    responseBody: self.readXhrResponseBody(xhr)
                }
                self.emitNetworkEvent(isError, shouldRecordRequest, 'XHR ' + method + ' ' + xhrUrlLoaded + ' failed with status ' + xhr.status, payload)
            })
            return originalXhrSend.call(this, body)
        }
    }
}

QaTracePageHooks.install();
