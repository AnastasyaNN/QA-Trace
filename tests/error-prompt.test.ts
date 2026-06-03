import {describe, it, expect} from 'vitest'
import {ErrorPromptUtils} from '../src/lib/error-prompt'
import type {ErrorLog, NetworkErrorPayload, UserAction} from '../src/lib/types'

function networkError(overrides: Partial<ErrorLog> = {}): ErrorLog {
    return {
        type: 'network',
        message: 'XHR GET https://api.internal:8443/orders failed with status 500',
        timestamp: 1,
        tabInfo: {id: 1, url: 'https://app.internal:8443/dashboard?token=abc', title: 'App'},
        urlRequested: 'https://api.internal:8443/orders?page=2#top',
        stack: 'at https://app.internal:8443/bundle.js:10',
        ...overrides
    }
}

function openTabAction(): UserAction {
    return {
        type: 'open_tab',
        element: 'TAB',
        selector: '[tab]',
        timestamp: 1,
        value: 'Open tab — https://app.internal:8443/dashboard',
        tabInfo: {id: 1, url: 'https://app.internal:8443/dashboard', title: 'App'}
    }
}

describe('ErrorPromptUtils.stripActionsForPrompt', () => {
    it('returns the input untouched when redactOrigin is false', () => {
        const actions = [openTabAction()]
        expect(ErrorPromptUtils.stripActionsForPrompt(actions, false)).toBe(actions)
    })

    it('strips origin from value (free text) and tabInfo.url (structured)', () => {
        const [action] = ErrorPromptUtils.stripActionsForPrompt([openTabAction()], true)
        expect(action.value).toBe('Open tab — /dashboard')
        expect(action.tabInfo.url).toBe('/dashboard')
    })
})

describe('ErrorPromptUtils.stripErrorsForPrompt', () => {
    it('omits headers/bodies and keeps origins when redactOrigin is false', () => {
        const [stripped] = ErrorPromptUtils.stripErrorsForPrompt(
            [networkError({requestHeaders: {Referer: 'https://app.internal:8443/x'}, responseBody: 'see https://api.internal:8443/y'})],
            false
        )
        expect(stripped.requestHeaders).toBeUndefined()
        expect(stripped.responseBody).toBeUndefined()
        expect(stripped.message).toContain('https://api.internal:8443/orders')
        expect(stripped.urlRequested).toBe('https://api.internal:8443/orders?page=2#top')
    })

    it('strips origins from message, stack, urlRequested and tabInfo.url when redactOrigin is true', () => {
        const [stripped] = ErrorPromptUtils.stripErrorsForPrompt([networkError()], true)
        expect(stripped.message).toBe('XHR GET /orders failed with status 500')
        expect(stripped.stack).toBe('at /bundle.js:10')
        expect(stripped.urlRequested).toBe('/orders?page=2#top')
        expect(stripped.tabInfo.url).toBe('/dashboard?token=abc')
    })
})

describe('ErrorPromptUtils.mergeErrorsForWebhook', () => {
    const payloads: NetworkErrorPayload[] = [{
        id: 'p1',
        errorId: 'e1',
        timestamp: 1,
        requestHeaders: {Referer: 'https://app.internal:8443/page'},
        requestBody: 'callback=https://app.internal:8443/cb',
        responseHeaders: {Location: 'https://api.internal:8443/redirect'},
        responseBody: '{"next":"https://api.internal:8443/next"}'
    }]

    it('keeps full origins (host+port) when redactOrigin is false', () => {
        const [merged] = ErrorPromptUtils.mergeErrorsForWebhook(
            [networkError({id: 'e1', networkPayloadId: 'p1'})],
            payloads,
            false
        ) as any[]
        expect(merged.message).toContain('https://api.internal:8443/orders')
        expect(merged.responseHeaders.Location).toBe('https://api.internal:8443/redirect')
        expect(merged.responseBody).toContain('https://api.internal:8443/next')
    })

    it('strips origins from metadata AND header/body values when redactOrigin is true', () => {
        const [merged] = ErrorPromptUtils.mergeErrorsForWebhook(
            [networkError({id: 'e1', networkPayloadId: 'p1'})],
            payloads,
            true
        ) as any[]
        expect(merged.message).toBe('XHR GET /orders failed with status 500')
        expect(merged.urlRequested).toBe('/orders?page=2#top')
        expect(merged.tabInfo.url).toBe('/dashboard?token=abc')
        expect(merged.requestHeaders.Referer).toBe('/page')
        expect(merged.requestBody).toBe('callback=/cb')
        expect(merged.responseHeaders.Location).toBe('/redirect')
        expect(merged.responseBody).toBe('{"next":"/next"}')
    })
})

describe('ErrorPromptUtils.mergeErrorForLocalCopy', () => {
    it('always keeps full host+port (no origin stripping on local copy)', () => {
        const payloads: NetworkErrorPayload[] = [{
            id: 'p1',
            errorId: 'e1',
            timestamp: 1,
            responseHeaders: {Location: 'https://api.internal:8443/redirect'},
            responseBody: '{"next":"https://api.internal:8443/next"}'
        }]
        const copy = ErrorPromptUtils.mergeErrorForLocalCopy(
            networkError({id: 'e1', networkPayloadId: 'p1'}),
            payloads
        ) as any
        expect(copy.message).toContain('https://api.internal:8443/orders')
        expect(copy.urlRequested).toBe('https://api.internal:8443/orders?page=2#top')
        expect(copy.responseHeaders.Location).toBe('https://api.internal:8443/redirect')
        expect(copy.responseBody).toContain('https://api.internal:8443/next')
    })
})
