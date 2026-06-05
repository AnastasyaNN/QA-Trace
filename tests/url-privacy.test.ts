import {describe, it, expect} from 'vitest'
import {UrlPrivacy} from '../src/lib/url-privacy'

describe('UrlPrivacy.stripOriginFromText', () => {
    it('returns undefined for null/undefined', () => {
        expect(UrlPrivacy.stripOriginFromText(null)).toBeUndefined()
        expect(UrlPrivacy.stripOriginFromText(undefined)).toBeUndefined()
    })

    it('strips http(s) origin incl. port, keeping the path', () => {
        expect(UrlPrivacy.stripOriginFromText('see https://example.com:8080/dashboard now'))
            .toBe('see /dashboard now')
    })

    it("returns '/' for a field that is nothing but a path-less origin (mirrors stripOriginFromUrl)", () => {
        expect(UrlPrivacy.stripOriginFromText('https://example.com')).toBe('/')
        expect(UrlPrivacy.stripOriginFromText('https://example.com:8443')).toBe('/')
    })

    it('leaves an empty string empty', () => {
        expect(UrlPrivacy.stripOriginFromText('')).toBe('')
    })

    it('strips embedded credentials on http URLs', () => {
        expect(UrlPrivacy.stripOriginFromText('https://user:pass@host:443/p?q=1#h'))
            .toBe('/p?q=1#h')
    })

    it('strips non-http schemes including embedded credentials', () => {
        expect(UrlPrivacy.stripOriginFromText('Connection failed: mongodb://admin:s3cret@db.internal:27017'))
            .toBe('Connection failed: ')
        expect(UrlPrivacy.stripOriginFromText('socket wss://ws.example.com:9001/live dropped'))
            .toBe('socket /live dropped')
    })

    it('strips protocol-relative URLs at a token boundary', () => {
        expect(UrlPrivacy.stripOriginFromText('//cdn.example.com/lib.js')).toBe('/lib.js')
        expect(UrlPrivacy.stripOriginFromText('load //cdn.example.com/lib.js please'))
            .toBe('load /lib.js please')
        expect(UrlPrivacy.stripOriginFromText('src="//cdn.example.com/a.js"'))
            .toBe('src="/a.js"')
    })

    it('handles IPv6 hosts', () => {
        expect(UrlPrivacy.stripOriginFromText('http://[::1]:8080/x')).toBe('/x')
    })

    it('strips every occurrence in a multi-URL string', () => {
        expect(UrlPrivacy.stripOriginFromText('a https://h1.com/x and b https://h2.com/y'))
            .toBe('a /x and b /y')
    })

    it('does not touch non-URL text (no false positives)', () => {
        expect(UrlPrivacy.stripOriginFromText('a//b')).toBe('a//b')
        expect(UrlPrivacy.stripOriginFromText('time 12:30 here')).toBe('time 12:30 here')
        expect(UrlPrivacy.stripOriginFromText('path C:\\Users\\me')).toBe('path C:\\Users\\me')
        expect(UrlPrivacy.stripOriginFromText('this and/or that')).toBe('this and/or that')
    })
})

describe('UrlPrivacy.stripOriginFromUrl', () => {
    it('returns undefined for null/undefined/empty', () => {
        expect(UrlPrivacy.stripOriginFromUrl(null)).toBeUndefined()
        expect(UrlPrivacy.stripOriginFromUrl('   ')).toBeUndefined()
    })

    it('keeps path, query and hash while removing scheme + host + port', () => {
        expect(UrlPrivacy.stripOriginFromUrl('https://example.com:8443/api/items?id=42#section'))
            .toBe('/api/items?id=42#section')
    })

    it('removes embedded credentials', () => {
        expect(UrlPrivacy.stripOriginFromUrl('https://user:pass@host:443/secure'))
            .toBe('/secure')
        expect(UrlPrivacy.stripOriginFromUrl('mongodb://admin:s3cret@db.internal:27017/orders'))
            .toBe('/orders')
    })

    it('returns "/" for an origin with no path', () => {
        expect(UrlPrivacy.stripOriginFromUrl('https://example.com')).toBe('/')
    })

    it('falls back to the text stripper for protocol-relative URLs', () => {
        expect(UrlPrivacy.stripOriginFromUrl('//cdn.example.com/lib.js')).toBe('/lib.js')
    })

    it('leaves an already-relative path unchanged', () => {
        expect(UrlPrivacy.stripOriginFromUrl('/api/x?y=1')).toBe('/api/x?y=1')
    })
})

describe('UrlPrivacy.redactUrlIfEnabled', () => {
    it('returns undefined for null/empty', () => {
        expect(UrlPrivacy.redactUrlIfEnabled(null, true, true)).toBeUndefined()
        expect(UrlPrivacy.redactUrlIfEnabled('', true, true)).toBeUndefined()
    })

    it('strips query/hash but keeps origin when only query redaction is on', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://example.com/p?q=1#h', true, false))
            .toBe('https://example.com/p')
    })

    it('strips origin but keeps query when only origin redaction is on', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://example.com/p?q=1#h', false, true))
            .toBe('/p?q=1#h')
    })

    it('strips both when both are on', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://example.com/p?q=1#h', true, true))
            .toBe('/p')
    })

    it('returns the original URL when neither is on', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://example.com/p?q=1#h', false, false))
            .toBe('https://example.com/p?q=1#h')
    })
})

describe('UrlPrivacy.redactUrlIfEnabled — hash-routed SPAs (stripUrlQueryAndHashForStorage)', () => {
it('preserves a hash route while dropping the query string', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('http://example.com:8080/?x=1#/dashboard/items', true, false))
            .toBe('http://example.com:8080/#/dashboard/items')
    })

    it('keeps the hash route when there is no query', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('http://example.com:8080/#/dashboard/items', true, false))
            .toBe('http://example.com:8080/#/dashboard/items')
    })

    it('strips a query embedded inside the hash route', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://app.example.com/#/route?token=secret', true, false))
            .toBe('https://app.example.com/#/route')
    })

    it('preserves hashbang routes', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://app.example.com/#!/route/42', true, false))
            .toBe('https://app.example.com/#!/route/42')
    })

    it('drops non-route fragments that may carry credentials (OAuth implicit)', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://app.example.com/cb#access_token=xyz&token_type=bearer', true, false))
            .toBe('https://app.example.com/cb')
    })

    it('drops a plain anchor fragment', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('https://example.com/p?q=1#section', true, false))
            .toBe('https://example.com/p')
    })

    it('keeps the route hash for non-http schemes', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('ws://host:9001/live?q=1#/deep/link', true, false))
            .toBe('ws://host:9001/live#/deep/link')
    })

    it('preserves a hash route on an already-relative URL', () => {
        expect(UrlPrivacy.redactUrlIfEnabled('/page?q=1#/route', true, false))
            .toBe('/page#/route')
    })
})

describe('UrlPrivacy.redactTabInfoUrlIfEnabled', () => {
    it('returns the same object when url is empty', () => {
        const tabInfo = {id: 1, url: '', title: 't'}
        expect(UrlPrivacy.redactTabInfoUrlIfEnabled(tabInfo, true, true)).toBe(tabInfo)
    })

    it('redacts the url field', () => {
        const result = UrlPrivacy.redactTabInfoUrlIfEnabled(
            {id: 1, url: 'https://example.com/dashboard?token=abc', title: 't'},
            true,
            true
        )
        expect(result.url).toBe('/dashboard')
        expect(result.title).toBe('t')
    })
})
