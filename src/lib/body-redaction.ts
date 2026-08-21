const SENSITIVE_PATTERNS: readonly string[] = [
    'authorization',
    'cookie',
    'token',
    'secret',
    'password',
    'passwd',
    'api_key',
    'apikey',
    'api-key',
    'access_token',
    'refresh_token',
    'session',
    'csrf',
    'xsrf',
    'jwt',
    'credential'
]

// Bounded key + required [=:] anchor + value; no overlapping unbounded quantifiers, so no ReDoS.
const KEY_VALUE_REGEX = /([A-Za-z0-9_.\-\[\]]{1,64})([ \t]*[=:][ \t]*)("[^"]*"|'[^']*'|[^&;\r\n]*)/g
const SENSITIVE_KEY_REGEX = new RegExp(`(?:${SENSITIVE_PATTERNS.join('|')})`, 'i')
const JWT_REGEX = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9._\-]+/gi

export const MAX_RESPONSE_CHARS = 12_000
export const MAX_BODY_REDACT_CHARS = 100_000
// Hard ceiling on a stored response body, independent of the truncation setting: a body over this
// is dropped for a size marker so an oversized response can never overflow the ~10 MB storage.local
// quota and lose the whole request row. Kept just under the quota to leave room for the rest.
export const MAX_STORED_RESPONSE_CHARS = 9_000_000

export class BodyRedaction {
    static isSensitiveKey(name: string): boolean {
        return SENSITIVE_KEY_REGEX.test(String(name || ''))
    }

    static redact(value: string | null | undefined, redactCap = Infinity, responseCap = Infinity): string {
        if (value == null)
            return ''
        const text = String(value).slice(0, redactCap)
        if (!text)
            return ''
        let out: string
        try {
            out = JSON.stringify(this.redactParsedJson(JSON.parse(text)))
        } catch {
            out = this.redactKeyValueBody(text)
        }
        return this.truncate(this.redactTokenPatterns(out), responseCap)
    }

    static truncate(value: string | null | undefined, responseCap = Infinity): string {
        if (value == null)
            return ''
        const str = String(value)
        return str.length > responseCap
            ? str.slice(0, responseCap)
            : str
    }

    static redactTokenPatterns(text: string): string {
        return text
            .replace(JWT_REGEX, '[REDACTED]')
            .replace(BEARER_REGEX, 'Bearer [REDACTED]')
    }

    static redactKeyValueBody(text: string): string {
        return text.replace(KEY_VALUE_REGEX, (match, key, separator, value) => {
            if (!this.isSensitiveKey(key))
                return match
            const quote = value[0] === '"' || value[0] === "'" ? value[0] : ''
            return `${key}${separator}${quote}[REDACTED]${quote}`
        })
    }

    private static redactParsedJson(value: unknown, depth = 0): unknown {
        if (depth > 6)
            return '[Truncated]'
        if (Array.isArray(value))
            return value.map((entry) => this.redactParsedJson(entry, depth + 1))
        if (!value || typeof value !== 'object')
            return value
        const redacted: Record<string, unknown> = {}
        Object.entries(value).forEach(([key, val]) => {
            redacted[key] = this.isSensitiveKey(key)
                ? '[REDACTED]'
                : this.redactParsedJson(val, depth + 1)
        })
        return redacted
    }
}
