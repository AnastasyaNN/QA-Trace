import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import * as browser from 'webextension-polyfill'

const {store, session, ctrl, read} = vi.hoisted(() => ({
    store: {} as Record<string, any>,
    session: {} as Record<string, any>,
    ctrl: {quotaBytes: undefined as number | undefined, failNetworkSets: 0, keyListing: true},
    read: (source: Record<string, any>, keys: string | string[]) => {
        const out: Record<string, any> = {}
        for (const k of Array.isArray(keys) ? keys : [keys])
            if (k in source)
                out[k] = source[k]
        return out
    }
}))

vi.mock('webextension-polyfill', () => ({
    storage: {
        local: {
            get: async (keys: string | string[] | null) => keys == null ? {...store} : read(store, keys),
            set: async (obj: Record<string, any>) => {
                if (ctrl.quotaBytes != null && JSON.stringify({...store, ...obj}).length > ctrl.quotaBytes)
                    throw new Error('QuotaExceededError: Resource::kQuotaBytes quota exceeded')
                if (ctrl.failNetworkSets > 0 && 'networkRequestIndex' in obj) {
                    ctrl.failNetworkSets--
                    throw new Error('disk error')
                }
                Object.assign(store, obj)
            },
            remove: async (keys: string | string[]) => {
                for (const k of [keys].flat())
                    delete store[k]
            },
            get getKeys() {
                return ctrl.keyListing ? async () => Object.keys(store) : undefined
            }
        },
        session: {
            get: async (keys: string | string[]) => read(session, keys),
            set: async (obj: Record<string, any>) => {
                Object.assign(session, obj)
            },
            remove: async (keys: string | string[]) => {
                for (const k of [keys].flat())
                    delete session[k]
            }
        }
    }
}))

vi.mock('../src/popup/popup-saved-response.ts', () => ({
    SavedResponse: {clearSavedLLMResponse: async () => {}}
}))

import {StorageManager} from '../src/lib/storage'
import {ExtensionConfigurationManager} from '../src/lib/integrations'
import {byteLength, formatBytes} from '../src/lib/storage-limits'
import type {TabInfo} from '../src/lib/types'

const INDEX_KEY = 'networkRequestIndex'
const ENTRY_PREFIX = 'networkRequest.'
const tab: TabInfo = {id: 1, url: 'https://app.example.com/p', title: 'A'}
const defaultCapBytes = (StorageManager as any).capBytes
const onWarning = vi.fn()

function request(timestamp: number, urlRequested: string) {
    return {timestamp, method: 'GET', urlRequested}
}

function emptyData() {
    return {userActions: [], errors: [], networkRequests: [], uiErrorScreenshots: [], networkErrorPayloads: []}
}

async function readStorage() {
    const storage = await StorageManager.getStorage()
    storage.networkRequests = await StorageManager.getNetworkRequests()
    return storage
}

function entryKeys(): string[] {
    return Object.keys(store).filter((key) => key.startsWith(ENTRY_PREFIX))
}

function storedRequests(): any[] {
    return (store[INDEX_KEY] ?? []).map((entry: any) => store[ENTRY_PREFIX + entry.id]).filter(Boolean)
}

function networkBytes(): number {
    const index = store[INDEX_KEY]
    if (!index)
        return store.networkRequests == null ? 0 : byteLength(JSON.stringify(store.networkRequests))
    return index.reduce((sum: number, entry: any) => sum + byteLength(JSON.stringify(store[ENTRY_PREFIX + entry.id])), 0)
        + byteLength(JSON.stringify(index))
}

beforeEach(() => {
    for (const k of Object.keys(store))
        delete store[k]
    for (const k of Object.keys(session))
        delete session[k]
    ctrl.quotaBytes = undefined
    ctrl.failNetworkSets = 0
    ctrl.keyListing = true
    onWarning.mockReset()
    StorageManager.onWarning = onWarning
    ExtensionConfigurationManager.invalidate()
    // Flush synchronously in tests so the batching debounce doesn't add latency per awaited call.
    const storageManager = StorageManager as any
    storageManager.batchers = {}
    storageManager.batchDelayMs = 0
    storageManager.capBytes = defaultCapBytes
    storageManager.warned = null
})

afterEach(() => vi.restoreAllMocks())

describe('StorageManager network requests', () => {
    it('persists each request under its own key plus an index, never in the storageData blob', async () => {
        await StorageManager.addNetworkRequest(request(1, 'https://a/x'), tab)
        expect(store[INDEX_KEY]).toHaveLength(1)
        expect(entryKeys()).toHaveLength(1)
        expect(storedRequests()[0].tabInfo).toEqual(tab)
        expect(store.networkRequests).toBeUndefined()
        expect(store.storageData?.networkRequests ?? []).toHaveLength(0)
    })

    it('getStorage merges the dedicated network key', async () => {
        await StorageManager.addNetworkRequest(request(5, 'u'), tab)
        const s = await readStorage()
        expect(s.networkRequests).toHaveLength(1)
        expect(s.networkRequests[0].urlRequested).toBe('u')
    })

    it('action/error writes leave the network entries untouched and never carry requests in the blob', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'boom', timestamp: 2}, tab)
        expect(storedRequests()).toHaveLength(1)
        expect(store.storageData.networkRequests).toHaveLength(0)
        const s = await readStorage()
        expect(s.errors).toHaveLength(1)
        expect(s.networkRequests).toHaveLength(1)
    })

    it('a write sets only the new entries and the index, never the rest of the log', async () => {
        for (let i = 0; i < 3; i++)
            await StorageManager.addNetworkRequest(request(i, `u${i}`), tab)
        const set = vi.spyOn(browser.storage.local, 'set')

        await StorageManager.addNetworkRequest(request(3, 'u3'), tab)

        expect(set).toHaveBeenCalledTimes(1)
        expect(Object.keys(set.mock.calls[0][0]).sort()).toEqual([ENTRY_PREFIX + store[INDEX_KEY][0].id, INDEX_KEY].sort())
    })

    it('records each entry size once in the index and caches their sum', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addNetworkRequest(request(2, 'v'), tab)
        for (const entry of store[INDEX_KEY])
            expect(entry.bytes).toBe(byteLength(JSON.stringify(store[ENTRY_PREFIX + entry.id])))
        expect(session['storageSize.networkLog']).toBe(networkBytes())
    })

    it('caps stored requests at networkRequestsLimit, newest first, and removes the dropped keys', async () => {
        for (let i = 0; i < 152; i++)
            await StorageManager.addNetworkRequest(request(i, `u${i}`), tab)
        expect(storedRequests()).toHaveLength(150)
        expect(entryKeys()).toHaveLength(150)
        expect(storedRequests()[0].urlRequested).toBe('u151')
    })

    it('getNetworkRequestById reads the index and the one entry in a single get', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        const id = store[INDEX_KEY][0].id
        const get = vi.spyOn(browser.storage.local, 'get')

        const found = await StorageManager.getNetworkRequestById(id)

        expect(found?.urlRequested).toBe('u')
        expect(get).toHaveBeenCalledTimes(1)
        expect(get.mock.calls[0][0]).toEqual([INDEX_KEY, ENTRY_PREFIX + id])
    })

    it('getNetworkRequestById ignores a row the index does not name', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        store[ENTRY_PREFIX + 'ghost'] = {...request(2, 'ghost'), id: 'ghost', tabInfo: tab}

        expect(await StorageManager.getNetworkRequestById('ghost')).toBeUndefined()
    })

    it('cleanupOldData purges a corrupt index entry and the sweep removes its row', async () => {
        await StorageManager.addNetworkRequest(request(Date.now(), 'u'), tab)
        store[INDEX_KEY] = [{id: 'broken', timestamp: Date.now(), bytes: null}, ...store[INDEX_KEY]]
        store[ENTRY_PREFIX + 'broken'] = {...request(Date.now(), 'broken'), id: 'broken', tabInfo: tab}

        await StorageManager.cleanupOldData()
        expect(store[INDEX_KEY]).toHaveLength(1)
        expect(store[INDEX_KEY][0].id).not.toBe('broken')

        await StorageManager.sweepNetworkEntries()
        expect(entryKeys()).toHaveLength(1)
    })

    it('migrates a legacy network log into per-entry keys on the first write', async () => {
        store.networkRequests = [{...request(2, 'b'), id: 'l2', tabInfo: tab}, {...request(1, 'a'), id: 'l1', tabInfo: tab}]

        await StorageManager.addNetworkRequest(request(3, 'c'), tab)

        expect(storedRequests().map((r) => r.urlRequested)).toEqual(['c', 'b', 'a'])
        expect(store.networkRequests).toBeUndefined()
        expect(entryKeys()).toHaveLength(3)
    })

    it('a migration gives a legacy request with an empty id a fresh one', async () => {
        store.networkRequests = [{...request(2, 'b'), id: '', tabInfo: tab}, {...request(1, 'a'), id: '', tabInfo: tab}]

        await StorageManager.addNetworkRequest(request(3, 'c'), tab)

        expect(storedRequests().map((r) => r.urlRequested)).toEqual(['c', 'b', 'a'])
        expect(entryKeys()).toHaveLength(3)
        expect(store[ENTRY_PREFIX]).toBeUndefined()
    })

    it('migrates a legacy log on a store at quota: the array is removed before its rows are written', async () => {
        store.storageData = {...emptyData(), errors: [{type: 'console', message: 'x'.repeat(3000), timestamp: 1, tabInfo: tab}]}
        store.networkRequests = Array.from({length: 8}, (_, i) => ({...request(i, 'https://h/' + 'p'.repeat(2000)), id: `l${i}`, tabInfo: tab}))
        ctrl.quotaBytes = JSON.stringify(store).length + 3000
        const remove = vi.spyOn(browser.storage.local, 'remove')
        const set = vi.spyOn(browser.storage.local, 'set')

        await StorageManager.addNetworkRequest(request(9, 'https://h/new'), tab)

        expect(set.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(remove.mock.calls[0][0]).toEqual(['networkRequests'])
        expect(store.networkRequests).toBeUndefined()
        expect(storedRequests()).toHaveLength(9)
        expect(store.storageData.errors).toHaveLength(1)
        expect(onWarning).not.toHaveBeenCalled()
    })

    it('keeps the legacy log when the migrating write fails for a non-quota reason', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        store.networkRequests = Array.from({length: 8}, (_, i) => ({...request(i, `https://h/${i}`), id: `l${i}`, tabInfo: tab}))
        ctrl.failNetworkSets = Infinity

        await StorageManager.addNetworkRequest(request(9, 'https://h/new'), tab)

        expect(store.networkRequests).toHaveLength(8)
        expect(store[INDEX_KEY]).toBeUndefined()
        expect(entryKeys()).toHaveLength(0)
        expect(onWarning).toHaveBeenCalledWith('failed')
    })

    it('a migration that gives up under quota writes no index', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        store.storageData = {...emptyData(), errors: [{type: 'console', message: 'x'.repeat(3000), timestamp: 1, tabInfo: tab}]}
        store.networkRequests = Array.from({length: 8}, (_, i) => ({...request(i, `https://h/${i}`), id: `l${i}`, tabInfo: tab}))
        ctrl.quotaBytes = JSON.stringify({storageData: store.storageData}).length + 100

        await StorageManager.addNetworkRequest(request(9, 'https://h/new'), tab)

        expect(store[INDEX_KEY]).toBeUndefined()
        expect(entryKeys()).toHaveLength(0)
        expect(store.storageData.errors).toHaveLength(1)
        expect(onWarning).toHaveBeenCalledWith('full')
    })

    it('reads a corrupt legacy value as an empty log and writes no junk rows', async () => {
        store.networkRequests = 'corrupt'

        expect(await StorageManager.getNetworkRequests()).toEqual([])
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)

        expect(storedRequests().map((r) => r.urlRequested)).toEqual(['u'])
        expect(entryKeys()).toHaveLength(1)
        expect(store.networkRequests).toBeUndefined()
    })

    it('falls back to the legacy read when the index is not an array', async () => {
        store[INDEX_KEY] = 'corrupt'
        store.networkRequests = [{...request(1, 'legacy'), tabInfo: tab}]

        const requests = await StorageManager.getNetworkRequests()

        expect(requests.map((r) => r.urlRequested)).toEqual(['legacy'])
    })

    it('reports a write as saved when only a key removal fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        store.networkRequests = [{...request(1, 'legacy'), id: 'l1', tabInfo: tab}]
        vi.spyOn(browser.storage.local, 'remove').mockRejectedValueOnce(new Error('disk error'))

        await StorageManager.addNetworkRequest(request(2, 'new'), tab)

        expect(storedRequests()).toHaveLength(2)
        expect(store.networkRequests).toHaveLength(1)
        expect(warn).toHaveBeenCalledWith('QA Trace: could not remove replaced storage keys', expect.any(Error))
        expect(onWarning).not.toHaveBeenCalled()
    })

    it('clearData empties the blob, the index, every entry key including rows the index does not name, and a legacy log', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'x', timestamp: 2}, tab)
        store[ENTRY_PREFIX + 'orphan'] = {...request(2, 'orphan'), id: 'orphan', tabInfo: tab}
        store.networkRequests = [{...request(0, 'legacy'), tabInfo: tab}]
        await StorageManager.clearData()
        expect(store[INDEX_KEY]).toEqual([])
        expect(entryKeys()).toHaveLength(0)
        expect(store.networkRequests).toBeUndefined()
        expect(store.storageData.userActions).toHaveLength(0)
        const s = await readStorage()
        expect(s.networkRequests).toHaveLength(0)
        expect(s.errors).toHaveLength(0)
    })

    it('cleanupOldData drops expired requests and their keys', async () => {
        const now = Date.now()
        await StorageManager.addNetworkRequest(request(now, 'fresh'), tab)
        await StorageManager.addNetworkRequest(request(now - 13 * 60 * 60 * 1000, 'old'), tab)
        await StorageManager.cleanupOldData()
        expect(storedRequests()).toHaveLength(1)
        expect(storedRequests()[0].urlRequested).toBe('fresh')
        expect(entryKeys()).toHaveLength(1)
    })

    it('cleanupOldData writes nothing when nothing expired', async () => {
        await StorageManager.addNetworkRequest(request(Date.now(), 'fresh'), tab)
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: Date.now()}, tab)
        const set = vi.spyOn(browser.storage.local, 'set')

        await StorageManager.cleanupOldData()

        expect(set).not.toHaveBeenCalled()
        expect(storedRequests()).toHaveLength(1)
        expect(store.storageData.userActions).toHaveLength(1)
    })

    it('cleanupOldData strips a 1.1.0 in-blob request array even when nothing expired', async () => {
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: Date.now()}, tab)
        store.storageData.networkRequests = [{...request(Date.now(), 'legacy'), tabInfo: tab}]

        await StorageManager.cleanupOldData()

        expect(store.storageData.networkRequests).toEqual([])
        expect(store.storageData.userActions).toHaveLength(1)
    })

    it('a trim whose scheduled rows were removed under quota and whose retry then fails rewrites the index', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const now = Date.now()
        for (let i = 0; i < 2; i++)
            await StorageManager.addNetworkRequest(request(now, `https://h/${i}`), tab)
        const expired = {...request(now - 13 * 60 * 60 * 1000, 'https://h/' + 'p'.repeat(2000)), id: 'old', tabInfo: tab}
        store[ENTRY_PREFIX + 'old'] = expired
        store[INDEX_KEY] = [...store[INDEX_KEY], {id: 'old', timestamp: expired.timestamp, bytes: byteLength(JSON.stringify(expired))}]
        ctrl.quotaBytes = JSON.stringify(store).length - 500
        ctrl.failNetworkSets = 1

        await StorageManager.cleanupOldData()

        expect(store[INDEX_KEY].map((entry: any) => entry.id)).not.toContain('old')
        expect(store[INDEX_KEY]).toHaveLength(2)
        expect(store[ENTRY_PREFIX + 'old']).toBeUndefined()
        expect(entryKeys()).toHaveLength(2)
        expect(onWarning).toHaveBeenCalledWith('failed')
    })

    it('cleanupOldData purges the blob and still rejects when the network step fails', async () => {
        const old = Date.now() - 13 * 60 * 60 * 1000
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: old}, tab)
        vi.spyOn(browser.storage.local, 'get').mockImplementation(async (keys: any) => {
            if (keys === INDEX_KEY)
                throw new Error('profile unavailable')
            return read(store, keys)
        })

        await expect(StorageManager.cleanupOldData()).rejects.toThrow('profile unavailable')
        expect(store.storageData.userActions).toHaveLength(0)
    })

    it('sweepNetworkEntries removes entry keys the index no longer references and a leftover legacy log', async () => {
        await StorageManager.addNetworkRequest(request(Date.now(), 'kept'), tab)
        store[ENTRY_PREFIX + 'orphan'] = {...request(Date.now(), 'orphan'), id: 'orphan', tabInfo: tab}
        store.networkRequests = [{...request(1, 'legacy'), tabInfo: tab}]
        const set = vi.spyOn(browser.storage.local, 'set')

        await StorageManager.sweepNetworkEntries()

        expect(entryKeys()).toHaveLength(1)
        expect(storedRequests()[0].urlRequested).toBe('kept')
        expect(store.networkRequests).toBeUndefined()
        expect(set).not.toHaveBeenCalled()
    })

    it('cleanupOldData writes the blob when reconciliation drops a dangling screenshot reference', async () => {
        store.storageData = {...emptyData(), errors: [{type: 'ui', id: 'e1', message: 'ui', timestamp: Date.now(), screenshotId: 'gone', tabInfo: tab}]}

        await StorageManager.cleanupOldData()

        expect(store.storageData.errors[0].screenshotId).toBeUndefined()
    })

    it('cleanupOldData rethrows a network failure that rejects with no value', async () => {
        const old = Date.now() - 13 * 60 * 60 * 1000
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: old}, tab)
        vi.spyOn(browser.storage.local, 'get').mockImplementation(async (keys: any) => {
            if (keys === INDEX_KEY)
                throw undefined
            return read(store, keys)
        })

        await expect(StorageManager.cleanupOldData()).rejects.toBeUndefined()
        expect(store.storageData.userActions).toHaveLength(0)
    })

    it('clearData still wipes the blob, the index and the rows the index names when the browser cannot list keys', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        ctrl.keyListing = false
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'boom', timestamp: 2}, tab)
        store.networkRequests = [{...request(1, 'legacy'), tabInfo: tab}]
        expect(entryKeys()).toHaveLength(1)
        vi.spyOn(browser.storage.local, 'get').mockImplementation(async (keys: any) => {
            if (keys == null)
                throw new Error('profile unavailable')
            return read(store, keys)
        })

        await StorageManager.clearData()

        expect(store.storageData).toEqual(emptyData())
        expect(store[INDEX_KEY]).toEqual([])
        expect(entryKeys()).toHaveLength(0)
        expect(store.networkRequests).toBeUndefined()
        expect(warn).toHaveBeenCalledWith('QA Trace: could not list storage keys', expect.any(Error))
    })

    it('a migration skips a legacy request without a finite timestamp', async () => {
        store.networkRequests = [{...request(1, 'a'), id: 'l1', tabInfo: tab}, {...request(NaN, 'b'), id: 'l2', tabInfo: tab}]

        await StorageManager.addNetworkRequest(request(3, 'c'), tab)

        expect(storedRequests().map((r) => r.urlRequested)).toEqual(['c', 'a'])
        expect(entryKeys()).toHaveLength(2)
        expect(store.networkRequests).toBeUndefined()
    })

    it('sweepNetworkEntries and clearData fall back to a full read when the browser cannot list keys', async () => {
        ctrl.keyListing = false
        await StorageManager.addNetworkRequest(request(Date.now(), 'kept'), tab)
        store[ENTRY_PREFIX + 'orphan'] = {...request(Date.now(), 'orphan'), id: 'orphan', tabInfo: tab}

        await StorageManager.sweepNetworkEntries()
        expect(entryKeys()).toHaveLength(1)
        expect(storedRequests()[0].urlRequested).toBe('kept')

        store[ENTRY_PREFIX + 'orphan2'] = {...request(Date.now(), 'orphan'), id: 'orphan2', tabInfo: tab}
        await StorageManager.clearData()
        expect(entryKeys()).toHaveLength(0)
    })

    it('sheds oldest network requests and retries when a write exceeds the storage quota', async () => {
        await StorageManager.addNetworkRequest(request(0, 'https://h/seed'), tab)
        ctrl.quotaBytes = JSON.stringify(store).length * 4

        for (let i = 1; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        expect(storedRequests().length).toBeGreaterThan(0)
        expect(storedRequests().length).toBeLessThan(20)
        expect(storedRequests()[0].urlRequested).toBe('https://h/19')
        expect(entryKeys()).toHaveLength(storedRequests().length)
    })

    it('sheds the network log before the primary errors/actions when the blob write hits quota', async () => {
        for (let i = 0; i < 40; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addError({type: 'console', message: 'boom', timestamp: 2}, tab)

        const networkBefore = storedRequests().length
        ctrl.quotaBytes = JSON.stringify(store).length - 1

        await StorageManager.addError({type: 'console', message: 'second', timestamp: 3}, tab)

        expect(storedRequests().length).toBeLessThan(networkBefore)
        expect(entryKeys()).toHaveLength(storedRequests().length)
        expect(store.storageData.errors.length).toBeGreaterThanOrEqual(2)
        expect(store.storageData.userActions).toHaveLength(1)
    })

    it('interleaves blob trimming with the network log instead of draining the log first', async () => {
        for (let i = 0; i < 64; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        const big = 'x'.repeat(5000)
        const storage: any = {
            ...emptyData(),
            errors: Array.from({length: 8}, (_, i) => ({type: 'console', message: big, timestamp: 200 + i, tabInfo: tab}))
        }

        // Budget holds the full network log plus a single (huge) error, so the blob - not the network
        // log - is the over-quota culprit and must be trimmed to fit.
        const fitted = {...store, storageData: {...storage, errors: storage.errors.slice(0, 1)}}
        ctrl.quotaBytes = JSON.stringify(fitted).length

        await StorageManager.setStorage(storage)

        // Blob content was trimmed...
        expect(store.storageData.errors.length).toBeLessThan(8)
        // ...but the network log was NOT drained to its floor first (the old shedder left it at 1).
        expect(storedRequests().length).toBeGreaterThan(1)
    })

    it('sheds UI screenshots before the network log when the blob write hits quota', async () => {
        for (let i = 0; i < 10; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        await StorageManager.addError(
            {type: 'ui', id: 'e1', message: 'ui', timestamp: 1},
            tab,
            'data:image/jpeg;base64,' + 'A'.repeat(3000)
        )

        const networkBefore = storedRequests().length
        expect(store.storageData.uiErrorScreenshots).toHaveLength(1)
        ctrl.quotaBytes = JSON.stringify(store).length

        await StorageManager.addError({type: 'console', message: 'trigger', timestamp: 2}, tab)

        expect(store.storageData.uiErrorScreenshots).toHaveLength(0)
        expect(storedRequests().length).toBe(networkBefore)
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
        // errorsLimit defaults to 50 - push it past the limit so e1 (the oldest) is trimmed out.
        for (let i = 0; i < 60; i++)
            await StorageManager.addError({type: 'console', message: `e${i}`, timestamp: 100 + i}, tab)

        expect(store.storageData.errors.some((error: any) => error.id === 'e1')).toBe(false)
        expect(store.storageData.uiErrorScreenshots.some((shot: any) => shot.errorId === 'e1')).toBe(false)
    })

    it('gives up gracefully (no throw) when even a single request cannot fit', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        ctrl.quotaBytes = 1

        await expect(StorageManager.addNetworkRequest(request(1, 'https://h/x'), tab)).resolves.toBeUndefined()
        expect(store[INDEX_KEY]).toBeUndefined()
        expect(entryKeys()).toHaveLength(0)
        expect(warn).toHaveBeenCalled()
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
    })

    it('reconciles when an error eviction can orphan a dependent', async () => {
        const spy = vi.spyOn(StorageManager as any, 'reconcileDependentStorage')
        for (let i = 0; i < 60; i++)
            await StorageManager.addError({type: 'console', message: `e${i}`, timestamp: i}, tab)
        expect(spy).toHaveBeenCalled()
    })
})

describe('StorageManager size cap', () => {
    const sm = StorageManager as any
    const bytesOf = (key: string) => store[key] == null ? 0 : byteLength(JSON.stringify(store[key]))
    const storedBytes = () => bytesOf('storageData') + networkBytes()
    const cachedSizes = () => ({'storageSize.storageData': bytesOf('storageData'), 'storageSize.networkLog': networkBytes()})
    const sizeCache = () => Object.fromEntries(Object.entries(session).filter(([key]) => key.startsWith('storageSize.')))
    const networkReads = (calls: unknown[][]) => calls.filter(([keys]) => [keys].flat().includes(INDEX_KEY)).length
    const bigError = (bytes: number, timestamp: number) => ({type: 'console' as const, message: 'x'.repeat(bytes), timestamp})

    it('forgets the cached size of a key whose value could not be measured', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        expect(session['storageSize.storageData']).toBe(bytesOf('storageData'))
        vi.spyOn(sm, 'measure').mockImplementationOnce(() => {
            throw new RangeError('Invalid string length')
        })

        await StorageManager.addUserAction({type: 'click', element: 'OTHER', selector: '#c', timestamp: 2}, tab)

        expect(store.storageData.userActions).toHaveLength(2)
        expect(session['storageSize.storageData']).toBeUndefined()
    })

    it('storageUsage returns null instead of throwing when the data cannot be measured', () => {
        vi.spyOn(sm, 'measure').mockImplementationOnce(() => {
            throw new RangeError('Invalid string length')
        })
        const data: any = {...emptyData(), userActions: [{type: 'click', element: 'BTN', selector: '#b', timestamp: 1, tabInfo: tab}]}
        expect(StorageManager.storageUsage(data)).toBeNull()
    })

    it('storageUsage reports 0 B for empty stores', () => {
        expect(StorageManager.storageUsage(emptyData())).toEqual({bytes: 0, percent: 0, userActions: 0, errors: 0, requests: 0})
    })

    it('formatBytes promotes a thousand rounded KB to MB', () => {
        expect(formatBytes(999_600)).toBe('1.0 MB')
        expect(formatBytes(999_499)).toBe('999 KB')
        expect(formatBytes(999)).toBe('999 B')
    })

    it('storageUsage counts screenshots and payloads under errors', () => {
        const data: any = {
            ...emptyData(),
            errors: [{type: 'ui', id: 'e1', message: 'ui', timestamp: 1, tabInfo: tab, screenshotId: 's1', networkPayloadId: 'p1'}],
            uiErrorScreenshots: [{id: 's1', errorId: 'e1', timestamp: 1, imageDataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(300)}],
            networkErrorPayloads: [{id: 'p1', errorId: 'e1', timestamp: 1, responseBody: 'x'.repeat(200)}],
            networkRequests: [{...request(1, 'u'), tabInfo: tab}]
        }
        const bytes = (value: unknown) => byteLength(JSON.stringify(value))

        const usage = StorageManager.storageUsage(data)!

        expect(usage.userActions).toBe(0)
        expect(usage.errors).toBe(bytes(data.errors) + bytes(data.uiErrorScreenshots) + bytes(data.networkErrorPayloads))
        expect(usage.requests).toBe(bytes(data.networkRequests))
        expect(usage.bytes).toBe(usage.userActions + usage.errors + usage.requests)
    })

    it('writes anyway when the value cannot be measured', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(sm, 'measure').mockImplementationOnce(() => {
            throw new RangeError('Invalid string length')
        })

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(warn).toHaveBeenCalledWith('QA Trace: could not measure storage write', expect.any(Error))
        expect(onWarning).not.toHaveBeenCalled()
    })

    it('sheds through the ladder when a blob write would cross the cap, with no browser quota error involved', async () => {
        for (let i = 0; i < 40; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addError({type: 'console', message: 'Ошибка сети', timestamp: 2}, tab)
        const networkBefore = storedRequests().length
        sm.capBytes = storedBytes()

        await StorageManager.addError({type: 'console', message: 'Вторая ошибка', timestamp: 3}, tab)

        expect(storedRequests().length).toBeLessThan(networkBefore)
        expect(store.storageData.errors).toHaveLength(2)
        expect(store.storageData.userActions).toHaveLength(1)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(sizeCache()).toEqual(cachedSizes())
    })

    it('halves the network log when a network write would cross the cap', async () => {
        await StorageManager.addNetworkRequest(request(0, 'https://h/seed'), tab)
        sm.capBytes = networkBytes() * 4

        for (let i = 1; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        expect(storedRequests().length).toBeGreaterThan(0)
        expect(storedRequests().length).toBeLessThan(20)
        expect(storedRequests()[0].urlRequested).toBe('https://h/19')
        expect(entryKeys()).toHaveLength(storedRequests().length)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
    })

    it('re-reads the other key until that key is written, then uses the cache', async () => {
        store.storageData = {...emptyData(), errors: [{type: 'console', message: 'x', timestamp: 1, tabInfo: tab}]}
        store.networkRequests = [{...request(1, 'u'), tabInfo: tab}]
        const get = vi.spyOn(browser.storage.local, 'get')

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 2}, tab)
        await StorageManager.addUserAction({type: 'click', element: 'OTHER', selector: '#c', timestamp: 3}, tab)
        expect(networkReads(get.mock.calls)).toBe(2)
        expect(session['storageSize.networkLog']).toBeUndefined()

        await StorageManager.addNetworkRequest(request(2, 'v'), tab)
        const readsBefore = networkReads(get.mock.calls)
        await StorageManager.addUserAction({type: 'click', element: 'THIRD', selector: '#d', timestamp: 4}, tab)
        expect(networkReads(get.mock.calls)).toBe(readsBefore)
        expect(sizeCache()).toEqual(cachedSizes())
    })

    it('concurrent blob and network writes each cache only the size they measured', async () => {
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addNetworkRequest(request(1, 'https://h/1'), tab)

        await Promise.all([
            StorageManager.addError({type: 'console', message: 'x'.repeat(2000), timestamp: 2}, tab),
            StorageManager.addNetworkRequest(request(2, 'https://h/2'), tab)
        ])

        expect(sizeCache()).toEqual(cachedSizes())
    })

    it('re-measures a malformed cache entry instead of letting it disable the cap', async () => {
        for (let i = 0; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        session['storageSize.networkLog'] = 'x'
        sm.capBytes = 1000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 100}, tab)

        expect(storedRequests().length).toBeLessThan(20)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(sizeCache()).toEqual(cachedSizes())
    })

    it('clearData resets both cached sizes to the empty stores', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'x', timestamp: 2}, tab)
        await StorageManager.clearData()
        expect(sizeCache()).toEqual({
            'storageSize.storageData': byteLength(JSON.stringify(store.storageData)),
            'storageSize.networkLog': byteLength('[]')
        })
    })

    it('trims a pre-existing over-cap profile on the first write, with no cached sizes', async () => {
        const big = 'x'.repeat(5000)
        store.storageData = {...emptyData(), errors: Array.from({length: 8}, (_, i) => ({type: 'console', message: big, timestamp: 200 + i, tabInfo: tab}))}
        store.networkRequests = Array.from({length: 4}, (_, i) => ({...request(i, `https://h/${i}`), tabInfo: tab}))
        sm.capBytes = 12_000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 300}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(store.storageData.errors.length).toBeLessThan(8)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(sizeCache()).toEqual(cachedSizes())
    })

    it('storageUsage rounds the percent against the cap and never exceeds 100', () => {
        sm.capBytes = 1000
        const dataOfBytes = (target: number) => {
            const data: any = {...emptyData(), userActions: [{type: 'click', element: '', selector: '#a', timestamp: 1, tabInfo: tab}]}
            data.userActions[0].element = 'x'.repeat(target - byteLength(JSON.stringify(data.userActions)))
            return data
        }
        expect(StorageManager.storageUsage(dataOfBytes(800))?.percent).toBe(80)
        expect(StorageManager.storageUsage(dataOfBytes(810))?.percent).toBe(81)
        expect(StorageManager.storageUsage(dataOfBytes(1200))?.percent).toBe(100)
        expect(StorageManager.storageUsage(dataOfBytes(800))?.bytes).toBe(800)
    })

    it('writes the blob anyway when the cap is exceeded but nothing more can be shed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        sm.capBytes = 10

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(session['storageSize.storageData']).toBe(bytesOf('storageData'))
        expect(warn).not.toHaveBeenCalled()
        expect(onWarning.mock.calls).toEqual([['high']])
    })

    it('writes the network log anyway when the cap is exceeded but nothing more can be shed', async () => {
        sm.capBytes = 10

        await StorageManager.addNetworkRequest(request(1, 'https://h/x'), tab)

        expect(storedRequests()).toHaveLength(1)
        expect(session['storageSize.networkLog']).toBe(networkBytes())
        expect(onWarning.mock.calls).toEqual([['high']])
    })

    it('raises full once while the browser keeps rejecting writes, and again only after usage drops below 90%', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        ctrl.quotaBytes = 1

        for (let i = 0; i < 3; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        expect(warn).toHaveBeenCalledTimes(3)
        expect(onWarning.mock.calls).toEqual([['full']])
        expect(session.storageWarned).toEqual(['full'])
        expect(session['storageSize.networkLog']).toBeUndefined()

        ctrl.quotaBytes = undefined
        await StorageManager.clearData()
        expect(session.storageWarned).toEqual([])
        expect(await StorageManager.flaggedWarnings()).toEqual(new Set())

        ctrl.quotaBytes = 1
        await StorageManager.addNetworkRequest(request(3, 'https://h/3'), tab)
        expect(onWarning.mock.calls).toEqual([['full'], ['full']])
    })

    it('raises full once even when the warning state cannot be read from the session', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(browser.storage.session, 'get').mockImplementation(async (keys: any) => {
            if (keys === 'storageWarned')
                throw new Error('session unavailable')
            return read(session, keys)
        })
        ctrl.quotaBytes = 1

        await StorageManager.addNetworkRequest(request(1, 'https://h/1'), tab)
        await StorageManager.addNetworkRequest(request(2, 'https://h/2'), tab)

        expect(onWarning.mock.calls).toEqual([['full']])
    })

    it('raises failed once for a browser error and again only after a successful write', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        ctrl.failNetworkSets = Infinity

        await StorageManager.addNetworkRequest(request(1, 'https://h/1'), tab)
        await StorageManager.addNetworkRequest(request(2, 'https://h/2'), tab)
        expect(onWarning.mock.calls).toEqual([['failed']])

        ctrl.failNetworkSets = 0
        await StorageManager.addNetworkRequest(request(3, 'https://h/3'), tab)
        expect(session.storageWarned).toEqual([])

        ctrl.failNetworkSets = Infinity
        await StorageManager.addNetworkRequest(request(4, 'https://h/4'), tab)
        expect(onWarning.mock.calls).toEqual([['failed'], ['failed']])
    })

    it('raises high once when a write reaches 90% of the cap and stays silent on later writes above it', async () => {
        sm.capBytes = 100_000

        await StorageManager.addError(bigError(50_000, 1), tab)
        expect(onWarning).not.toHaveBeenCalled()

        await StorageManager.addError(bigError(41_000, 2), tab)
        expect(onWarning.mock.calls).toEqual([['high']])
        expect(session.storageWarned).toEqual(['high'])
        expect(await StorageManager.flaggedWarnings()).toEqual(new Set(['high']))

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 3}, tab)
        await StorageManager.addNetworkRequest(request(4, 'https://h/4'), tab)
        expect(onWarning).toHaveBeenCalledTimes(1)
        expect(storedBytes()).toBeGreaterThanOrEqual(sm.capBytes * 0.9)
    })

    it('re-arms high after a shed leaves the retried write below 90%', async () => {
        for (let i = 0; i < 9; i++)
            await StorageManager.addNetworkRequest(request(i, 'https://h/' + 'p'.repeat(10_000)), tab)
        sm.capBytes = Math.floor(storedBytes() / 0.905)

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 10}, tab)
        expect(onWarning.mock.calls).toEqual([['high']])

        await StorageManager.addNetworkRequest(request(11, 'https://h/' + 'p'.repeat(10_000)), tab)
        expect(storedBytes()).toBeLessThan(sm.capBytes * 0.9)
        expect(session.storageWarned).toEqual([])

        await StorageManager.addNetworkRequest(request(12, 'https://h/' + 'p'.repeat(Math.ceil(sm.capBytes * 0.9) - storedBytes())), tab)
        expect(onWarning.mock.calls).toEqual([['high'], ['high']])
    })

    it('re-arms high after clearData', async () => {
        sm.capBytes = 100_000

        await StorageManager.addError(bigError(91_000, 1), tab)
        await StorageManager.clearData()
        expect(session.storageWarned).toEqual([])
        await StorageManager.addError(bigError(91_000, 2), tab)

        expect(onWarning.mock.calls).toEqual([['high'], ['high']])
    })

    it('re-arms high after cleanupOldData expires enough data', async () => {
        const old = Date.now() - 13 * 60 * 60 * 1000
        store.storageData = {...emptyData(), errors: [{...bigError(91_000, old), tabInfo: tab}]}
        sm.capBytes = 100_000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: Date.now()}, tab)
        expect(onWarning.mock.calls).toEqual([['high']])

        await StorageManager.cleanupOldData()
        expect(store.storageData.errors).toHaveLength(0)
        expect(session.storageWarned).toEqual([])

        await StorageManager.addError(bigError(91_000, Date.now()), tab)
        expect(onWarning.mock.calls).toEqual([['high'], ['high']])
    })

    it('a flagged high survives a worker restart', async () => {
        sm.capBytes = 100_000
        await StorageManager.addError(bigError(91_000, 1), tab)
        sm.warned = null

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 2}, tab)

        expect(onWarning.mock.calls).toEqual([['high']])
        expect(session.storageWarned).toEqual(['high'])
    })

    it('shrinking writes never raise', async () => {
        for (let i = 0; i < 4; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        sm.capBytes = 10

        await sm.shedNetworkRequests()
        await StorageManager.sweepNetworkEntries()

        expect(onWarning).not.toHaveBeenCalled()
    })

    it('flags the warning even when no hook is registered', async () => {
        StorageManager.onWarning = undefined
        sm.capBytes = 10

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(session.storageWarned).toEqual(['high'])
    })

    it('skips the cap check and still writes when the size read rejects', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(browser.storage.local, 'get').mockImplementation(async (keys: any) => {
            if (Array.isArray(keys) && keys.includes(INDEX_KEY))
                throw new Error('profile unavailable')
            return read(store, keys)
        })

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(warn).toHaveBeenCalledWith('QA Trace: could not measure storage, skipping cap check', expect.any(Error))
        expect(onWarning).not.toHaveBeenCalled()
    })

    it('a shed rung never reads the other key or the size cache', async () => {
        for (let i = 0; i < 4; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        const get = vi.spyOn(browser.storage.local, 'get')
        const sessionGet = vi.spyOn(browser.storage.session, 'get')

        await sm.shedNetworkRequests()

        expect(storedRequests()).toHaveLength(2)
        expect(entryKeys()).toHaveLength(2)
        expect(get.mock.calls.some(([keys]) => [keys].flat().includes('storageData'))).toBe(false)
        expect(sessionGet).not.toHaveBeenCalled()
    })

    it('a shed that gives up writes back an index naming only the rows that still exist', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        for (let i = 0; i < 6; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        // Below one row plus a one-entry index, above an empty index: the shed exhausts, then the
        // index-only write fits.
        ctrl.quotaBytes = 100

        await StorageManager.addNetworkRequest(request(6, 'https://h/6'), tab)

        expect(store[INDEX_KEY]).toEqual([])
        expect(entryKeys()).toHaveLength(0)
        expect(session['storageSize.networkLog']).toBe(networkBytes())
    })

    it('sweepNetworkEntries prunes an index entry whose row is gone', async () => {
        for (let i = 0; i < 3; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        delete store[ENTRY_PREFIX + store[INDEX_KEY][2].id]

        await StorageManager.sweepNetworkEntries()

        expect(store[INDEX_KEY]).toHaveLength(2)
        expect(store[INDEX_KEY].every((entry: any) => (ENTRY_PREFIX + entry.id) in store)).toBe(true)
        expect(session['storageSize.networkLog']).toBe(networkBytes())
    })

    it('ignores an index entry without a size instead of letting NaN disable the cap', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        store[INDEX_KEY] = [{id: 'broken'}, ...store[INDEX_KEY]]
        store[ENTRY_PREFIX + 'broken'] = {...request(2, 'broken'), id: 'broken', tabInfo: tab}
        delete session['storageSize.networkLog']
        sm.capBytes = 10

        expect((await StorageManager.getNetworkRequests()).map((r) => r.urlRequested)).toEqual(['u'])
        expect(await sm.totalBytes({storageData: 0})).toBeGreaterThan(sm.capBytes)
    })

    it('a blob write on a profile without an index reads the index and the legacy key in one round trip', async () => {
        const get = vi.spyOn(browser.storage.local, 'get')

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        const coldReads = get.mock.calls.filter(([keys]) => [keys].flat().includes(INDEX_KEY))
        expect(coldReads).toHaveLength(1)
        expect([coldReads[0][0]].flat()).toContain('networkRequests')
    })

    it('counts an unmigrated legacy array toward the cap and sheds it on the first blob write', async () => {
        store.networkRequests = Array.from({length: 8}, (_, i) => ({...request(i, 'https://h/' + 'p'.repeat(500)), id: `l${i}`, tabInfo: tab}))
        sm.capBytes = byteLength(JSON.stringify(store.networkRequests)) - 500

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(store.networkRequests).toBeUndefined()
        expect(storedRequests().length).toBeLessThan(8)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
    })

    it('a shed under the soft cap halves at once instead of removing scheduled keys first', async () => {
        for (let i = 0; i < 150; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        sm.capBytes = storedBytes() - 10
        const remove = vi.spyOn(browser.storage.local, 'remove')

        await StorageManager.addNetworkRequest(request(150, 'https://h/150'), tab)

        expect(storedRequests().length).toBeLessThan(150)
        expect(remove.mock.calls[0][0].length).toBeGreaterThan(1)
    })

    it('a network write leaves the log alone when the blob alone exceeds the cap', async () => {
        for (let i = 0; i < 4; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        await StorageManager.addError({type: 'console', message: 'x'.repeat(3000), timestamp: 10}, tab)
        sm.capBytes = bytesOf('storageData') - 10
        const remove = vi.spyOn(browser.storage.local, 'remove')

        await StorageManager.addNetworkRequest(request(11, 'https://h/new'), tab)

        expect(storedRequests()).toHaveLength(5)
        expect(remove).not.toHaveBeenCalled()
        expect(onWarning.mock.calls).toEqual([['high']])
    })

    it("a shed rung that exhausts under quota does not raise; the user's write still fits", async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        for (let i = 0; i < 2; i++)
            await StorageManager.addNetworkRequest(request(i, 'https://h/' + 'p'.repeat(500)), tab)
        await StorageManager.setStorage({...emptyData(), errors: Array.from({length: 4}, (_, i) => ({type: 'console', message: 'x'.repeat(1000), timestamp: i, tabInfo: tab}))})
        ctrl.quotaBytes = bytesOf('storageData') - 100

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 10}, tab)

        expect(onWarning).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalled()
        expect(store.storageData.errors).toHaveLength(2)
        expect(store.storageData.userActions).toHaveLength(1)
    })

    it('sheds one screenshot per pass and halves the network log before the next', async () => {
        for (let i = 0; i < 10; i++)
            await StorageManager.addNetworkRequest(request(i, 'https://h/' + 'p'.repeat(500)), tab)
        for (let i = 0; i < 3; i++)
            await StorageManager.addError({type: 'ui', id: `e${i}`, message: 'ui', timestamp: 100 + i}, tab, 'data:image/jpeg;base64,' + 'A'.repeat(3000))
        for (let i = 0; i < 6; i++)
            await StorageManager.addError({type: 'console', message: `c${i}`, timestamp: 200 + i}, tab)
        const errorsBefore = store.storageData.errors.length
        sm.capBytes = storedBytes() - 5000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 300}, tab)

        expect(store.storageData.uiErrorScreenshots).toHaveLength(2)
        expect(storedRequests()).toHaveLength(5)
        expect(store.storageData.errors).toHaveLength(errorsBefore)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
    })

    it('moves past a shed rung whose own write fails instead of trusting it', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        for (let i = 0; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        for (let i = 0; i < 8; i++)
            await StorageManager.addError({type: 'console', message: 'x'.repeat(500), timestamp: 100 + i}, tab)
        const networkBefore = networkBytes()
        ctrl.failNetworkSets = Infinity
        sm.capBytes = storedBytes() - 1500

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 300}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(store.storageData.errors.length).toBeLessThan(8)
        expect(networkBytes()).toBe(networkBefore)
        expect(session['storageSize.networkLog']).toBe(networkBefore)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(onWarning).not.toHaveBeenCalledWith('failed')
        expect(onWarning).not.toHaveBeenCalledWith('full')
    })
})
