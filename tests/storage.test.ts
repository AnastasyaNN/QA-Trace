import {describe, it, expect, beforeEach, vi} from 'vitest'

const {store, ctrl} = vi.hoisted(() => ({
    store: {} as Record<string, any>,
    ctrl: {quotaBytes: undefined as number | undefined}
}))

vi.mock('webextension-polyfill', () => ({
    storage: {
        local: {
            get: async (keys: string | string[]) => {
                const arr = Array.isArray(keys) ? keys : [keys]
                const out: Record<string, any> = {}
                for (const k of arr)
                    if (k in store)
                        out[k] = store[k]
                return out
            },
            set: async (obj: Record<string, any>) => {
                if (ctrl.quotaBytes != null && JSON.stringify({...store, ...obj}).length > ctrl.quotaBytes)
                    throw new Error('QuotaExceededError: Resource::kQuotaBytes quota exceeded')
                Object.assign(store, obj)
            }
        },
        onChanged: {addListener: () => {}}
    }
}))

vi.mock('../src/popup/popup-saved-response.ts', () => ({
    SavedResponse: {clearSavedLLMResponse: async () => {}}
}))

import {StorageManager} from '../src/lib/storage'
import type {TabInfo} from '../src/lib/types'

const tab: TabInfo = {id: 1, url: 'https://app.example.com/p', title: 'A'}

function request(timestamp: number, urlRequested: string) {
    return {timestamp, method: 'GET', urlRequested}
}

beforeEach(() => {
    for (const k of Object.keys(store))
        delete store[k]
    ctrl.quotaBytes = undefined
    // Flush synchronously in tests so the batching debounce doesn't add latency per awaited call.
    const storageManager = StorageManager as any
    storageManager.batchers = {}
    storageManager.batchDelayMs = 0
})

describe('StorageManager network requests', () => {
    it('persists requests under their own key, never in the storageData blob', async () => {
        await StorageManager.addNetworkRequest(request(1, 'https://a/x'), tab)
        expect(store.networkRequests).toHaveLength(1)
        expect(store.networkRequests[0].tabInfo).toEqual(tab)
        expect(store.storageData?.networkRequests ?? []).toHaveLength(0)
    })

    it('getStorage merges the dedicated network key', async () => {
        await StorageManager.addNetworkRequest(request(5, 'u'), tab)
        const s = await StorageManager.getStorage(true)
        expect(s.networkRequests).toHaveLength(1)
        expect(s.networkRequests[0].urlRequested).toBe('u')
    })

    it('action/error writes leave the network key untouched and never carry requests in the blob', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'boom', timestamp: 2}, tab)
        expect(store.networkRequests).toHaveLength(1)
        expect(store.storageData.networkRequests).toHaveLength(0)
        const s = await StorageManager.getStorage(true)
        expect(s.errors).toHaveLength(1)
        expect(s.networkRequests).toHaveLength(1)
    })

    it('caps stored requests at networkRequestsLimit, newest first', async () => {
        for (let i = 0; i < 152; i++)
            await StorageManager.addNetworkRequest(request(i, `u${i}`), tab)
        expect(store.networkRequests).toHaveLength(150)
        expect(store.networkRequests[0].urlRequested).toBe('u151')
    })

    it('falls back to legacy in-blob requests when the dedicated key is absent', async () => {
        store.storageData = {
            userActions: [],
            errors: [],
            networkRequests: [{...request(9, 'legacy'), tabInfo: tab}],
            uiErrorScreenshots: [],
            networkErrorPayloads: []
        }
        const s = await StorageManager.getStorage(true)
        expect(s.networkRequests).toHaveLength(1)
        expect(s.networkRequests[0].urlRequested).toBe('legacy')
    })

    it('getNetworkRequestById resolves a legacy in-blob request (matching the list)', async () => {
        store.storageData = {
            userActions: [],
            errors: [],
            networkRequests: [{...request(9, 'legacy'), id: 'x', tabInfo: tab}],
            uiErrorScreenshots: [],
            networkErrorPayloads: []
        }
        const found = await StorageManager.getNetworkRequestById('x')
        expect(found?.urlRequested).toBe('legacy')
    })

    it('clearData empties both the blob and the network key', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'x', timestamp: 2}, tab)
        await StorageManager.clearData()
        expect(store.networkRequests).toHaveLength(0)
        expect(store.storageData.userActions).toHaveLength(0)
        const s = await StorageManager.getStorage(true)
        expect(s.networkRequests).toHaveLength(0)
        expect(s.errors).toHaveLength(0)
    })

    it('cleanupOldData drops expired requests and updates the dedicated key', async () => {
        const now = Date.now()
        await StorageManager.addNetworkRequest(request(now, 'fresh'), tab)
        await StorageManager.addNetworkRequest(request(now - 13 * 60 * 60 * 1000, 'old'), tab)
        await StorageManager.cleanupOldData()
        expect(store.networkRequests).toHaveLength(1)
        expect(store.networkRequests[0].urlRequested).toBe('fresh')
    })

    it('sheds oldest network requests and retries when a write exceeds the storage quota', async () => {
        await StorageManager.addNetworkRequest(request(0, 'https://h/seed'), tab)
        ctrl.quotaBytes = JSON.stringify(store.networkRequests).length * 4

        for (let i = 1; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        expect(store.networkRequests.length).toBeGreaterThan(0)
        expect(store.networkRequests.length).toBeLessThan(20)
        expect(store.networkRequests[0].urlRequested).toBe('https://h/19')
    })

    it('sheds the network log before the primary errors/actions when the blob write hits quota', async () => {
        for (let i = 0; i < 40; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addError({type: 'console', message: 'boom', timestamp: 2}, tab)

        const networkBefore = store.networkRequests.length
        ctrl.quotaBytes = JSON.stringify(store).length - 1

        await StorageManager.addError({type: 'console', message: 'second', timestamp: 3}, tab)

        expect(store.networkRequests.length).toBeLessThan(networkBefore)
        expect(store.storageData.errors.length).toBeGreaterThanOrEqual(2)
        expect(store.storageData.userActions).toHaveLength(1)
    })

    it('interleaves blob trimming with the network log instead of draining the log first', async () => {
        for (let i = 0; i < 64; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        const big = 'x'.repeat(5000)
        const storage: any = {
            userActions: [],
            errors: Array.from({length: 8}, (_, i) => ({type: 'console', message: big, timestamp: 200 + i, tabInfo: tab})),
            networkRequests: [],
            uiErrorScreenshots: [],
            networkErrorPayloads: []
        }

        // Budget holds the full network log plus a single (huge) error, so the blob — not the network
        // log — is the over-quota culprit and must be trimmed to fit.
        const fitted = {networkRequests: store.networkRequests, storageData: {...storage, errors: storage.errors.slice(0, 1)}}
        ctrl.quotaBytes = JSON.stringify(fitted).length

        await StorageManager.setStorage(storage)

        // Blob content was trimmed...
        expect(store.storageData.errors.length).toBeLessThan(8)
        // ...but the network log was NOT drained to its floor first (the old shedder left it at 1).
        expect(store.networkRequests.length).toBeGreaterThan(1)
    })

    it('sheds UI screenshots before the network log when the blob write hits quota', async () => {
        for (let i = 0; i < 10; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        await StorageManager.addError(
            {type: 'ui', id: 'e1', message: 'ui', timestamp: 1},
            tab,
            'data:image/jpeg;base64,' + 'A'.repeat(3000)
        )

        const networkBefore = store.networkRequests.length
        expect(store.storageData.uiErrorScreenshots).toHaveLength(1)
        ctrl.quotaBytes = JSON.stringify(store).length

        await StorageManager.addError({type: 'console', message: 'trigger', timestamp: 2}, tab)

        expect(store.storageData.uiErrorScreenshots).toHaveLength(0)
        expect(store.networkRequests.length).toBe(networkBefore)
    })

    it('attaches a UI screenshot in the same write as its error', async () => {
        await StorageManager.addError(
            {type: 'ui', id: 'e1', message: 'ui', timestamp: 1},
            tab,
            'data:image/jpeg;base64,AAAA'
        )
        expect(store.storageData.uiErrorScreenshots).toHaveLength(1)
        const shot = store.storageData.uiErrorScreenshots[0]
        expect(shot.errorId).toBe('e1')
        expect(store.storageData.errors[0].screenshotId).toBe(shot.id)
    })

    it('never leaves an orphaned screenshot when the attached error is later evicted', async () => {
        await StorageManager.addError(
            {type: 'ui', id: 'e1', message: 'ui', timestamp: 1},
            tab,
            'data:image/jpeg;base64,AAAA'
        )
        // errorsLimit defaults to 50 — push it past the limit so e1 (the oldest) is trimmed out.
        for (let i = 0; i < 60; i++)
            await StorageManager.addError({type: 'console', message: `e${i}`, timestamp: 100 + i}, tab)

        expect(store.storageData.errors.some((error: any) => error.id === 'e1')).toBe(false)
        expect(store.storageData.uiErrorScreenshots.some((shot: any) => shot.errorId === 'e1')).toBe(false)
    })

    it('gives up gracefully (no throw) when even a single request cannot fit', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        ctrl.quotaBytes = 1

        await expect(StorageManager.addNetworkRequest(request(1, 'https://h/x'), tab)).resolves.toBeUndefined()
        expect(store.networkRequests).toBeUndefined()
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})

describe('StorageManager immediate user-action writes', () => {
    it('flushes an immediate action without waiting for the debounce window', async () => {
        const sm = StorageManager as any
        sm.batchDelayMs = 10_000
        await StorageManager.addUserAction({type: 'open_tab', element: 'TAB', selector: '[tab]', timestamp: 1}, tab, true)
        expect(store.storageData.userActions).toHaveLength(1)
        expect(store.storageData.userActions[0].type).toBe('open_tab')
    })

    it('an immediate action also flushes an already-buffered debounced action, newest first', async () => {
        const sm = StorageManager as any
        sm.batchDelayMs = 10_000
        const buffered = StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addUserAction({type: 'reload_tab', element: 'TAB', selector: '[tab]', timestamp: 2}, tab, true)
        await buffered
        const actions = store.storageData.userActions
        expect(actions).toHaveLength(2)
        expect(actions[0].type).toBe('reload_tab')
        expect(actions[1].type).toBe('click')
    })
})

describe('StorageManager dependent reconciliation', () => {
    it('skips reconciliation when a flush removes nothing', async () => {
        const spy = vi.spyOn(StorageManager as any, 'reconcileDependentStorage')
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addError({type: 'console', message: 'x', timestamp: 2}, tab)
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
    })

    it('reconciles when an error eviction can orphan a dependent', async () => {
        const spy = vi.spyOn(StorageManager as any, 'reconcileDependentStorage')
        for (let i = 0; i < 60; i++)
            await StorageManager.addError({type: 'console', message: `e${i}`, timestamp: i}, tab)
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })
})
