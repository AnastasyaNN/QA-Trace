import {TabInfo} from "./types";

// Matches a URL authority embedded in free text and stops before the path, so the path is kept.
// Two ways to start a match:
//   - any explicit scheme: `scheme://` (http, https, ws, wss, ftp, mongodb, redis, ...)
//   - protocol-relative `//host`, but only at a token boundary (start, whitespace, quote, `<`)
//     so it does not eat a stray `a//b` inside ordinary text.
// The authority run `[^\s/"'()<>]+` also covers embedded `user:pass@host:port` credentials.
const EMBEDDED_ORIGIN = /(?:\b[a-z][a-z0-9+.\-]*:\/\/|(?<=^|[\s"'(<])\/\/)[^\s/"'()<>]+/gi

// A scheme-less `host:port` (e.g. `db.internal.corp:5432`, `10.0.0.5:6379`) still exposes the host.
// The explicit numeric port is the signal that separates a network authority from ordinary dotted
// text. To avoid eating stack frames like `app.js:128`, only IPs or multi-label hostnames whose
// final label is not a source-file extension match, and the token must start at a boundary so
// path-qualified frames (`/app/server.internal:5432`) are left alone.
const EMBEDDED_HOST_PORT = /(?<=^|[\s"'(<])(?:\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?!(?:js|jsx|ts|tsx|mjs|cjs|json|map|css|scss|less|html?|vue|svelte|py|rb|go|rs|php|txt|md|ya?ml|xml|png|jpe?g|gif|svg|wasm|woff2?)\b)[a-z][a-z0-9-]*):\d{1,5}/gi

export class UrlPrivacy {
    static redactUrlIfEnabled(raw: string | undefined | null, redactUrlQuery: boolean, redactOrigin: boolean): string | undefined {
        if (raw == null)
            return undefined
        let url = String(raw).trim()
        if (!url)
            return undefined
        if (redactUrlQuery)
            url = UrlPrivacy.stripUrlQueryAndHashForStorage(url) ?? url
        if (redactOrigin)
            url = UrlPrivacy.stripOriginFromUrl(url) ?? url
        return url || '/'
    }

    static redactTabInfoUrlIfEnabled(tabInfo: TabInfo, redactUrlQuery: boolean, redactOrigin: boolean): TabInfo {
        if (tabInfo.url == null || tabInfo.url === '')
            return tabInfo
        const url = UrlPrivacy.redactUrlIfEnabled(tabInfo.url, redactUrlQuery, redactOrigin)
        if (url === tabInfo.url)
            return tabInfo
        return {
            ...tabInfo,
            url,
        }
    }

    // Free-text fields (error message, stack, request/response bodies, header values, action labels)
    static stripOriginFromText(text: string | undefined | null): string | undefined {
        if (text == null)
            return undefined
        const input = String(text)
        const stripped = input.replace(EMBEDDED_ORIGIN, '').replace(EMBEDDED_HOST_PORT, '')
        return stripped === '' && input !== '' ? '/' : stripped
    }

    // Whole-URL fields (urlRequested, tabInfo.url)
    static stripOriginFromUrl(raw: string | undefined | null): string | undefined {
        if (raw == null)
            return undefined
        const s = String(raw).trim()
        if (!s)
            return undefined
        try {
            const u = new URL(s)
            return `${u.pathname}${u.search}${u.hash}` || '/'
        } catch {
            return UrlPrivacy.stripOriginFromText(s)
        }
    }

    private static stripUrlQueryAndHashForStorage(raw: string | undefined | null): string | undefined {
        const s = String(raw).trim()
        try {
            const u = new URL(s)
            const hash = UrlPrivacy.safeHashRoute(u.hash)
            if (u.protocol === 'http:' || u.protocol === 'https:')
                return `${u.origin}${u.pathname || '/'}${hash}`
            return `${u.origin}${u.pathname || ''}${hash}`
        } catch {
            const noQuery = (s.split('#')[0] ?? '').split('?')[0]
            const hashIdx = s.indexOf('#')
            const hash = hashIdx >= 0 ? UrlPrivacy.safeHashRoute(s.slice(hashIdx)) : ''
            return (noQuery + hash) || undefined
        }
    }

    // Hash-routed SPAs keep navigation state in the fragment, so the route path is preserved to
    // identify the page. A query inside the route and non-route fragments (e.g. OAuth implicit
    // `#access_token=…`) are dropped so credentials never reach storage.
    private static safeHashRoute(hash: string | undefined | null): string {
        const route = (String(hash ?? '').replace(/^#/, '').split('?')[0]) ?? ''
        return /^!?\//.test(route)
            ? `#${route}`
            : ''
    }
}
