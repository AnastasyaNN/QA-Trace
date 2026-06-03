import {TabInfo} from "./types";

// Matches a URL authority embedded in free text and stops before the path, so the path is kept.
// Two ways to start a match:
//   - any explicit scheme: `scheme://` (http, https, ws, wss, ftp, mongodb, redis, ...)
//   - protocol-relative `//host`, but only at a token boundary (start, whitespace, quote, `<`)
//     so it does not eat a stray `a//b` inside ordinary text.
// The authority run `[^\s/"'()<>]+` also covers embedded `user:pass@host:port` credentials.
const EMBEDDED_ORIGIN = /(?:\b[a-z][a-z0-9+.\-]*:\/\/|(?<=^|[\s"'(<])\/\/)[^\s/"'()<>]+/gi

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
        return String(text).replace(EMBEDDED_ORIGIN, '')
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
