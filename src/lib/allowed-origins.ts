export class AllowedOrigins {
    static normalizeAllowedUrls(urls: string[] | undefined): string[] {
        if (!urls?.length)
            return []
        const seen = new Set<string>()
        const out: string[] = []
        for (const entry of urls) {
            const origin = AllowedOrigins.normalizeEntry(entry)
            if (origin && !seen.has(origin)) {
                seen.add(origin)
                out.push(origin)
            }
        }
        return out
    }

    static isOriginAllowed(pageOrigin: string, allowedUrls: string[]): boolean {
        if (!allowedUrls.length)
            return false
        return allowedUrls.some((entry) => {
            const origin = AllowedOrigins.normalizeEntry(entry)
            return origin === pageOrigin
        })
    }

    private static normalizeEntry(entry: string): string | null {
        const trimmed = entry.trim()
        if (!trimmed)
            return null
        try {
            const u = new URL(trimmed)
            if (u.protocol !== 'http:' && u.protocol !== 'https:')
                return null
            return u.origin
        } catch {
            return null
        }
    }
}
