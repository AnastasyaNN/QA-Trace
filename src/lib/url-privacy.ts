import {TabInfo} from "./types";

export class UrlPrivacy {
    static stripUrlQueryAndHashForStorage(raw: string | undefined | null): string | undefined {
        if (raw == null)
            return undefined
        const s = String(raw).trim()
        if (!s)
            return undefined
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

    static redactTabInfoUrlIfEnabled(tabInfo: TabInfo, redactUrlQuery: boolean): TabInfo {
        if (!redactUrlQuery || tabInfo.url == null || tabInfo.url === '')
            return tabInfo
        const stripped = UrlPrivacy.stripUrlQueryAndHashForStorage(tabInfo.url)
        return {
            ...tabInfo,
            url: stripped ?? tabInfo.url,
        }
    }
}
