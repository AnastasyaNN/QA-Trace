import {TabInfo} from "./types";

export class UrlPrivacy {
    static redactUrlIfEnabled(raw: string | undefined | null, redactUrlQuery: boolean = true, redactOrigin: boolean = true): string | undefined {
        if (raw == null)
            return undefined
        let url = String(raw).trim()
        if (!url)
            return undefined
        if (redactUrlQuery)
            url = UrlPrivacy.stripUrlQueryAndHashForStorage(url) ?? url
        if (redactOrigin)
            url = UrlPrivacy.stripUrlOriginForStorage(url) ?? url
        return url || '/'
    }

    static redactTabInfoUrlIfEnabled(tabInfo: TabInfo, redactUrlQuery: boolean = true, redactOrigin: boolean = true): TabInfo {
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

    private static stripUrlQueryAndHashForStorage(raw: string | undefined | null): string | undefined {
        const s = String(raw).trim()
        try {
            const u = new URL(s)
            if (u.protocol === 'http:' || u.protocol === 'https:')
                return `${u.origin}${u.pathname || '/'}`
            return `${u.origin}${u.pathname || ''}`
        } catch {
            const noHash = s.split('#')[0] ?? ''
            const noQuery = noHash.split('?')[0]
            return noQuery || undefined
        }
    }

    private static stripUrlOriginForStorage(raw: string | undefined | null): string | undefined {
        const s = String(raw).trim()
        try {
            const u = new URL(s)
            return u.pathname || '/'
        } catch {
            const withoutProtocol = s.replace(/^https?:\/\/[^/]*/, '')
            return withoutProtocol || '/'
        }
    }
}
