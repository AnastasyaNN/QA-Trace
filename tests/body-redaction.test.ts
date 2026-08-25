import {describe, it, expect} from 'vitest'
import {BodyRedaction, MAX_RESPONSE_CHARS, MAX_BODY_REDACT_CHARS} from '../src/lib/body-redaction'

describe('BodyRedaction.redact — JSON bodies', () => {
    it('redacts sensitive top-level keys and keeps the rest', () => {
        const out = BodyRedaction.redact('{"password":"hunter2","user":"bob"}')
        expect(out).toContain('"password":"[REDACTED]"')
        expect(out).toContain('"user":"bob"')
    })

    it('redacts sensitive keys nested in objects and arrays', () => {
        const out = BodyRedaction.redact('{"a":{"token":"x"},"list":[{"api_key":"y"}]}')
        expect(out).toContain('"token":"[REDACTED]"')
        expect(out).toContain('"api_key":"[REDACTED]"')
    })

    it('matches keys case-insensitively and by substring', () => {
        const out = BodyRedaction.redact('{"X-CSRF-Token":"abc","userPassword":"p"}')
        expect(out).toContain('"X-CSRF-Token":"[REDACTED]"')
        expect(out).toContain('"userPassword":"[REDACTED]"')
    })

    it('keeps non-string values under sensitive keys (numbers/booleans are not secrets)', () => {
        const out = BodyRedaction.redact('{"session_count":5,"jwt_enabled":false,"access_token":"s3cr3t"}')
        expect(out).toContain('"session_count":5')
        expect(out).toContain('"jwt_enabled":false')
        expect(out).toContain('"access_token":"[REDACTED]"')
    })

    it('still redacts string and structured values under sensitive keys', () => {
        const out = BodyRedaction.redact('{"credentials":{"user":"a","pass":"b"},"tokens":["x","y"]}')
        expect(out).toContain('"credentials":"[REDACTED]"')
        expect(out).toContain('"tokens":"[REDACTED]"')
    })
})

describe('BodyRedaction.redact — non-JSON bodies', () => {
    it('redacts form-encoded sensitive values and leaves others intact', () => {
        expect(BodyRedaction.redact('user=bob&password=hunter2&page=2'))
            .toBe('user=bob&password=[REDACTED]&page=2')
    })

    it('redacts quoted values (double and single quotes)', () => {
        expect(BodyRedaction.redact('password = "hunter2"')).toBe('password = "[REDACTED]"')
        expect(BodyRedaction.redact("password='hunter2'")).toBe("password='[REDACTED]'")
    })

    it('redacts space-delimited values without leaking the tail', () => {
        const out = BodyRedaction.redact('Authorization: Basic dXNlcjpwYXNzd29yZA==')
        expect(out).not.toContain('dXNlcjpwYXNzd29yZA==')
        expect(out).toContain('[REDACTED]')
    })

    it('stops redaction at pair separators', () => {
        expect(BodyRedaction.redact('session=abc; path=/; other=1'))
            .toBe('session=[REDACTED]; path=/; other=1')
    })

    it('leaves non-sensitive key/value bodies untouched', () => {
        expect(BodyRedaction.redact('count=5&page=2&sort=asc')).toBe('count=5&page=2&sort=asc')
    })

    it('redacts bare JWT and Bearer tokens anywhere in the body', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcDEF123_-'
        expect(BodyRedaction.redact(`note is ${jwt} end`)).not.toContain(jwt)
        expect(BodyRedaction.redact('x-note: Bearer abc.def-123')).toContain('Bearer [REDACTED]')
    })

    it('truncates the redacted output to the response cap', () => {
        const out = BodyRedaction.redact('note=' + 'a'.repeat(MAX_RESPONSE_CHARS * 2), MAX_BODY_REDACT_CHARS, MAX_RESPONSE_CHARS)
        expect(out.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS)
    })
})

describe('BodyRedaction.redact — oversized/unparseable JSON falls back to key redaction', () => {
    it('redacts JSON-quoted sensitive keys when the body is too large to JSON.parse', () => {
        // Body exceeds the redact cap, so redact() truncates it into invalid JSON and hits the
        // key/value fallback; the sensitive field (in the retained prefix) must still be redacted.
        const body = '{"password":"hunter2","pad":"' + 'a'.repeat(150_000) + '"}'
        const out = BodyRedaction.redact(body, MAX_BODY_REDACT_CHARS, MAX_RESPONSE_CHARS)
        expect(out).not.toContain('hunter2')
        expect(out).toContain('[REDACTED]')
    })

    it('redacts JSON-quoted sensitive keys in an invalid-JSON fragment', () => {
        const out = BodyRedaction.redact('{"token":"abc","user":"bob"')
        expect(out).toContain('"token":"[REDACTED]"')
        expect(out).toContain('"user":"bob"')
        expect(out).not.toContain('abc')
    })
})

describe('BodyRedaction.redact — uncapped (no truncation)', () => {
    it('keeps output beyond the response cap when no caps are given', () => {
        const out = BodyRedaction.redact('note=' + 'a'.repeat(MAX_RESPONSE_CHARS * 2))
        expect(out.length).toBeGreaterThan(MAX_RESPONSE_CHARS)
    })

    it('still redacts sensitive fields in uncapped bodies past the redact cap', () => {
        const body = JSON.stringify({padding: 'a'.repeat(150_000), password: 'hunter2'})
        const out = BodyRedaction.redact(body)
        expect(out).toContain('"password":"[REDACTED]"')
        expect(out).not.toContain('hunter2')
        expect(out.length).toBeGreaterThan(MAX_BODY_REDACT_CHARS)
    })
})

describe('BodyRedaction.redact — ReDoS regression', () => {
    // The previous regex was O(n^2): ~13s at the 100k cap. The linear rewrite must stay well under 1s.
    const budgetMs = 1000
    const cases: [string, string][] = [
        ['delimiter-free blob', 'a'.repeat(100_000)],
        ['keyword then long tail', 'password' + 'a'.repeat(100_000)],
        ['repeated near-keyword', 'sessio'.repeat(20_000)],
        ['repeated key= prefix', 'password='.repeat(20_000)]
    ]
    it.each(cases)('stays linear on %s', (_name, input) => {
        const start = performance.now()
        BodyRedaction.redact(input)
        expect(performance.now() - start).toBeLessThan(budgetMs)
    })
})
