import {ErrorLog, NetworkErrorPayload, TabInfo, UserAction} from "./types";
import {UrlPrivacy} from "./url-privacy";

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
    static stripErrorsForPrompt(errors: ErrorLog[], redactOrigin: boolean): ErrorLog[] {
        return errors.map((error) => ErrorPromptUtils.stripErrorForPrompt(error, redactOrigin))
    }

    static stripActionsForPrompt(actions: UserAction[], redactOrigin: boolean): UserAction[] {
        if (!redactOrigin)
            return actions
        return actions.map((action) => {
            const copy = {...action} as Record<string, unknown>
            for (const k of ['value', 'labelText'] as const) {
                if (typeof copy[k] === 'string')
                    copy[k] = UrlPrivacy.stripOriginFromText(copy[k] as string)
            }
            if (action.tabInfo && typeof action.tabInfo.url === 'string')
                copy.tabInfo = {...action.tabInfo, url: UrlPrivacy.stripOriginFromUrl(action.tabInfo.url)}
            return copy as unknown as UserAction
        })
    }

    static mergeErrorsForWebhook(
        errors: ErrorLog[],
        networkPayloads: NetworkErrorPayload[],
        redactOrigin: boolean
    ): ErrorLog[] {
        const byPayloadId = new Map(networkPayloads.map((p) => [p.id, p]))
        return errors.map((e) => {
            const {screenshotId: _s, networkPayloadId, ...rest} = e
            const merged: Record<string, unknown> = {...rest}
            if (e.type === 'network' && networkPayloadId) {
                const payload = byPayloadId.get(networkPayloadId)
                if (payload) {
                    merged.requestHeaders = payload.requestHeaders
                    merged.requestBody = payload.requestBody
                    merged.responseHeaders = payload.responseHeaders
                    merged.responseBody = payload.responseBody
                }
            }
            if (e.type === 'network')
                merged.requestHeadersNote = REQUEST_HEADERS_NOTE
            if (redactOrigin)
                ErrorPromptUtils.stripErrorOrigins(merged)
            return merged as unknown as ErrorLog
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

    private static stripErrorForPrompt(error: ErrorLog, redactOrigin: boolean): ErrorLog {
        const copy = {...error} as Record<string, unknown>
        for (const k of PROMPT_OMIT_KEYS) {
            delete copy[k]
        }
        if (redactOrigin)
            ErrorPromptUtils.stripErrorOrigins(copy)
        return copy as unknown as ErrorLog
    }

    private static stripErrorOrigins(copy: Record<string, unknown>): void {
        for (const k of ['message', 'stack', 'requestBody', 'responseBody'] as const) {
            if (typeof copy[k] === 'string')
                copy[k] = UrlPrivacy.stripOriginFromText(copy[k] as string)
        }
        if (typeof copy.urlRequested === 'string')
            copy.urlRequested = UrlPrivacy.stripOriginFromUrl(copy.urlRequested as string)
        for (const k of ['requestHeaders', 'responseHeaders'] as const) {
            if (copy[k] && typeof copy[k] === 'object')
                copy[k] = ErrorPromptUtils.stripOriginsFromHeaders(copy[k] as Record<string, string>)
        }
        const tabInfo = copy.tabInfo as TabInfo | undefined
        if (tabInfo && typeof tabInfo.url === 'string')
            copy.tabInfo = {...tabInfo, url: UrlPrivacy.stripOriginFromUrl(tabInfo.url)}
    }

    private static stripOriginsFromHeaders(headers: Record<string, string>): Record<string, string> {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(headers))
            out[k] = typeof v === 'string' ? (UrlPrivacy.stripOriginFromText(v) ?? v) : v
        return out
    }
}
