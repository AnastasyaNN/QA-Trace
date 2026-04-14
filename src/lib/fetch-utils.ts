export class FetchUtils {
    static readonly INTEGRATION_FETCH_TIMEOUT_MS = 5 * 60 * 1000

    static isAbortError(error: unknown): boolean {
        if (error instanceof DOMException && error.name === 'AbortError')
            return true
        return error instanceof Error && error.name === 'AbortError'
    }

    static async fetchWithTimeout(
        input: RequestInfo | URL,
        init: RequestInit | undefined,
        timeoutMs: number
    ): Promise<Response> {
        const controller = new AbortController()
        const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)
        try {
            return await fetch(input, {...init, signal: controller.signal})
        } finally {
            globalThis.clearTimeout(timeoutId)
        }
    }
}
