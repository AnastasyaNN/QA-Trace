import {ErrorLog, NetworkErrorPayload} from "./types";

const REQUEST_HEADERS_NOTE = 'Sensitive and browser-managed headers are omitted';

const PROMPT_OMIT_KEYS = [
    'requestHeaders',
    'requestBody',
    'responseHeaders',
    'responseBody',
    'screenshotId',
    'networkPayloadId'
] as const;

export class ErrorPromptUtils {
    static stripErrorsForPrompt(errors: ErrorLog[]): ErrorLog[] {
        return errors.map(ErrorPromptUtils.stripErrorForPrompt)
    }

    static mergeErrorsForWebhook(
        errors: ErrorLog[],
        networkPayloads: NetworkErrorPayload[]
    ): ErrorLog[] {
        const byPayloadId = new Map(networkPayloads.map((p) => [p.id, p]))
        return errors.map((e) => {
            const {screenshotId: _s, networkPayloadId, ...rest} = e
            let merged: ErrorLog
            if (e.type === 'network' && networkPayloadId) {
                const payload = byPayloadId.get(networkPayloadId)
                if (payload) {
                    merged = {
                        ...rest,
                        requestHeaders: payload.requestHeaders,
                        requestBody: payload.requestBody,
                        responseHeaders: payload.responseHeaders,
                        responseBody: payload.responseBody
                    }
                } else
                    merged = rest as ErrorLog
            } else
                merged = rest as ErrorLog
            if (e.type === 'network') {
                return {
                    ...merged,
                    requestHeadersNote: REQUEST_HEADERS_NOTE
                }
            }
            return merged
        })
    }

    static mergeErrorForLocalCopy(
        error: ErrorLog,
        networkPayloads: NetworkErrorPayload[]
    ): Record<string, unknown> {
        const byPayloadId = new Map(networkPayloads.map((p) => [p.id, p]))
        const errorType = error.type
        const base: Record<string, unknown> = {...error}
        delete base.networkPayloadId
        if (errorType === 'network' && error.networkPayloadId) {
            const payload = byPayloadId.get(error.networkPayloadId)
            if (payload) {
                base.requestHeaders = payload.requestHeaders
                base.requestBody = payload.requestBody
                base.responseHeaders = payload.responseHeaders
                base.responseBody = payload.responseBody
            }
        }
        if (base.screenshotId)
            delete base.screenshotId
        delete base.id
        delete base.tabInfo
        delete base.type
        if (errorType === 'network')
            base.requestHeadersNote = REQUEST_HEADERS_NOTE
        return base
    }

    private static stripErrorForPrompt(error: ErrorLog): ErrorLog {
        const copy = {...error} as Record<string, unknown>
        for (const k of PROMPT_OMIT_KEYS) {
            delete copy[k]
        }
        return copy as unknown as ErrorLog
    }
}
