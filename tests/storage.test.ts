import {describe, it, expect, beforeEach, vi} from 'vitest'

const {store} = vi.hoisted(() => ({store: {} as Record<string, any>}))

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
        const s = await StorageManager.getStorage()
        expect(s.networkRequests).toHaveLength(1)
        expect(s.networkRequests[0].urlRequested).toBe('u')
    })

    it('action/error writes leave the network key untouched and never carry requests in the blob', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'boom', timestamp: 2}, tab)
        expect(store.networkRequests).toHaveLength(1)
        expect(store.storageData.networkRequests).toHaveLength(0)
        const s = await StorageManager.getStorage()
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
        const s = await StorageManager.getStorage()
        expect(s.networkRequests).toHaveLength(1)
        expect(s.networkRequests[0].urlRequested).toBe('legacy')
    })

    it('clearData empties both the blob and the network key', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'x', timestamp: 2}, tab)
        await StorageManager.clearData()
        expect(store.networkRequests).toHaveLength(0)
        expect(store.storageData.userActions).toHaveLength(0)
        const s = await StorageManager.getStorage()
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
})
