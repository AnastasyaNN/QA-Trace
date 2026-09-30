import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import * as browser from 'webextension-polyfill'

const {store, session, ctrl, notify, read} = vi.hoisted(() => ({
    store: {} as Record<string, any>,
    session: {} as Record<string, any>,
    ctrl: {quotaBytes: undefined as number | undefined, failNetworkSet: false},
    notify: vi.fn(),
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
            get: async (keys: string | string[]) => read(store, keys),
            set: async (obj: Record<string, any>) => {
                if (ctrl.quotaBytes != null && JSON.stringify({...store, ...obj}).length > ctrl.quotaBytes)
                    throw new Error('QuotaExceededError: Resource::kQuotaBytes quota exceeded')
                if (ctrl.failNetworkSet && 'networkRequests' in obj)
                    throw new Error('disk error')
                Object.assign(store, obj)
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
        },
        onChanged: {addListener: () => {}}
    },
    notifications: {create: notify},
    runtime: {getURL: (path: string) => path},
    i18n: {getMessage: (key: string) => key}
}))

vi.mock('../src/popup/popup-saved-response.ts', () => ({
    SavedResponse: {clearSavedLLMResponse: async () => {}}
}))

import {StorageManager} from '../src/lib/storage'
import {byteLength} from '../src/lib/storage-limits'
import type {TabInfo} from '../src/lib/types'

const tab: TabInfo = {id: 1, url: 'https://app.example.com/p', title: 'A'}
const defaultCapBytes = (StorageManager as any).capBytes

function request(timestamp: number, urlRequested: string) {
    return {timestamp, method: 'GET', urlRequested}
}

async function readStorage() {
    const storage = await StorageManager.getStorage()
    storage.networkRequests = await StorageManager.getNetworkRequests()
    return storage
}

beforeEach(() => {
    for (const k of Object.keys(store))
        delete store[k]
    for (const k of Object.keys(session))
        delete session[k]
    ctrl.quotaBytes = undefined
    ctrl.failNetworkSet = false
    notify.mockReset()
    // Flush synchronously in tests so the batching debounce doesn't add latency per awaited call.
    const storageManager = StorageManager as any
    storageManager.batchers = {}
    storageManager.batchDelayMs = 0
    storageManager.capBytes = defaultCapBytes
})

afterEach(() => vi.restoreAllMocks())

describe('StorageManager network requests', () => {
    it('persists requests under their own key, never in the storageData blob', async () => {
        await StorageManager.addNetworkRequest(request(1, 'https://a/x'), tab)
        expect(store.networkRequests).toHaveLength(1)
        expect(store.networkRequests[0].tabInfo).toEqual(tab)
        expect(store.storageData?.networkRequests ?? []).toHaveLength(0)
    })

    it('getStorage merges the dedicated network key', async () => {
        await StorageManager.addNetworkRequest(request(5, 'u'), tab)
        const s = await readStorage()
        expect(s.networkRequests).toHaveLength(1)
        expect(s.networkRequests[0].urlRequested).toBe('u')
    })

    it('action/error writes leave the network key untouched and never carry requests in the blob', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'boom', timestamp: 2}, tab)
        expect(store.networkRequests).toHaveLength(1)
        expect(store.storageData.networkRequests).toHaveLength(0)
        const s = await readStorage()
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
        const s = await readStorage()
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
        const s = await readStorage()
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

        // Budget holds the full network log plus a single (huge) error, so the blob - not the network
        // log - is the over-quota culprit and must be trimmed to fit.
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
        expect(store.networkRequests).toBeUndefined()
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
    const emptyData = () => ({userActions: [], errors: [], networkRequests: [], uiErrorScreenshots: [], networkErrorPayloads: []})
    const bytesOf = (key: string) => store[key] == null ? 0 : byteLength(JSON.stringify(store[key]))
    const storedBytes = () => bytesOf('storageData') + bytesOf('networkRequests')
    const cachedSizes = () => ({'storageSize.storageData': bytesOf('storageData'), 'storageSize.networkRequests': bytesOf('networkRequests')})
    const networkReads = (calls: unknown[][]) => calls.filter(([keys]) => [keys].flat().includes('networkRequests')).length

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

    it('usagePercent returns null instead of throwing when the data cannot be measured', () => {
        vi.spyOn(sm, 'measure').mockImplementationOnce(() => {
            throw new RangeError('Invalid string length')
        })
        expect(StorageManager.usagePercent(emptyData())).toBeNull()
    })

    it('still notifies when the throttle stamp cannot be read', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(browser.storage.session, 'get').mockImplementation(async (keys: any) => {
            if (keys === 'notifiedAt.storage_quota_dropped')
                throw new Error('session unavailable')
            return read(session, keys)
        })
        ctrl.quotaBytes = 1

        await StorageManager.addNetworkRequest(request(1, 'https://h/1'), tab)

        expect(notify).toHaveBeenCalledTimes(1)
    })

    it('writes anyway when the value cannot be measured', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(sm, 'measure').mockImplementationOnce(() => {
            throw new RangeError('Invalid string length')
        })

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(warn).toHaveBeenCalledWith('QA Trace: could not measure storage write', expect.any(Error))
        expect(notify).not.toHaveBeenCalled()
    })

    it('sheds through the ladder when a blob write would cross the cap, with no browser quota error involved', async () => {
        for (let i = 0; i < 40; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addError({type: 'console', message: 'Ошибка сети', timestamp: 2}, tab)
        const networkBefore = store.networkRequests.length
        sm.capBytes = storedBytes()

        await StorageManager.addError({type: 'console', message: 'Вторая ошибка', timestamp: 3}, tab)

        expect(store.networkRequests.length).toBeLessThan(networkBefore)
        expect(store.storageData.errors).toHaveLength(2)
        expect(store.storageData.userActions).toHaveLength(1)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(session).toEqual(cachedSizes())
    })

    it('halves the network log when a network write would cross the cap', async () => {
        await StorageManager.addNetworkRequest(request(0, 'https://h/seed'), tab)
        sm.capBytes = bytesOf('networkRequests') * 4

        for (let i = 1; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        expect(store.networkRequests.length).toBeGreaterThan(0)
        expect(store.networkRequests.length).toBeLessThan(20)
        expect(store.networkRequests[0].urlRequested).toBe('https://h/19')
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
    })

    it('re-reads the other key until that key is written, then uses the cache', async () => {
        store.storageData = {...emptyData(), errors: [{type: 'console', message: 'x', timestamp: 1, tabInfo: tab}]}
        store.networkRequests = [{...request(1, 'u'), tabInfo: tab}]
        const get = vi.spyOn(browser.storage.local, 'get')

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 2}, tab)
        await StorageManager.addUserAction({type: 'click', element: 'OTHER', selector: '#c', timestamp: 3}, tab)
        expect(networkReads(get.mock.calls)).toBe(2)
        expect(session['storageSize.networkRequests']).toBeUndefined()

        await StorageManager.addNetworkRequest(request(2, 'v'), tab)
        const readsBefore = networkReads(get.mock.calls)
        await StorageManager.addUserAction({type: 'click', element: 'THIRD', selector: '#d', timestamp: 4}, tab)
        expect(networkReads(get.mock.calls)).toBe(readsBefore)
        expect(session).toEqual(cachedSizes())
    })

    it('counts a legacy in-blob network log once and never reads it back through the fallback', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const longUrl = 'https://h/' + 'x'.repeat(1000)
        store.storageData = {...emptyData(), networkRequests: Array.from({length: 5}, (_, i) => ({...request(i, longUrl), tabInfo: tab}))}
        const get = vi.spyOn(browser.storage.local, 'get')
        sm.capBytes = 2000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(store.networkRequests).toBeUndefined()
        expect(session['storageSize.networkRequests']).toBeUndefined()
        expect(networkReads(get.mock.calls)).toBe(1)
        expect(warn).not.toHaveBeenCalled()
    })

    it('concurrent blob and network writes each cache only the size they measured', async () => {
        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)
        await StorageManager.addNetworkRequest(request(1, 'https://h/1'), tab)

        await Promise.all([
            StorageManager.addError({type: 'console', message: 'x'.repeat(2000), timestamp: 2}, tab),
            StorageManager.addNetworkRequest(request(2, 'https://h/2'), tab)
        ])

        expect(session).toEqual(cachedSizes())
    })

    it('re-measures a malformed cache entry instead of letting it disable the cap', async () => {
        for (let i = 0; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        session['storageSize.networkRequests'] = 'x'
        sm.capBytes = 1000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 100}, tab)

        expect(store.networkRequests.length).toBeLessThan(20)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(session).toEqual(cachedSizes())
    })

    it('clearData resets both cached sizes to the empty stores', async () => {
        await StorageManager.addNetworkRequest(request(1, 'u'), tab)
        await StorageManager.addError({type: 'console', message: 'x', timestamp: 2}, tab)
        await StorageManager.clearData()
        expect(session).toEqual({
            'storageSize.storageData': byteLength(JSON.stringify(store.storageData)),
            'storageSize.networkRequests': byteLength('[]')
        })
    })

    it('trims a pre-existing over-cap profile on the first write, with no cached sizes and no migration', async () => {
        const big = 'x'.repeat(5000)
        store.storageData = {...emptyData(), errors: Array.from({length: 8}, (_, i) => ({type: 'console', message: big, timestamp: 200 + i, tabInfo: tab}))}
        store.networkRequests = Array.from({length: 4}, (_, i) => ({...request(i, `https://h/${i}`), tabInfo: tab}))
        sm.capBytes = 12_000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 300}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(store.storageData.errors.length).toBeLessThan(8)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(session).toEqual(cachedSizes())
    })

    it('usagePercent rounds against the cap, 81 is the first high value, and never exceeds 100', () => {
        sm.capBytes = 1000
        const dataOfBytes = (target: number) => {
            const data: any = {...emptyData(), userActions: [{type: 'click', element: '', selector: '#a', timestamp: 1, tabInfo: tab}]}
            const bytes = byteLength(JSON.stringify({...data, networkRequests: []})) + byteLength(JSON.stringify(data.networkRequests))
            data.userActions[0].element = 'x'.repeat(target - bytes)
            return data
        }
        expect(StorageManager.usagePercent(dataOfBytes(800))).toBe(80)
        expect(StorageManager.usagePercent(dataOfBytes(810))).toBe(81)
        expect(StorageManager.usagePercent(dataOfBytes(1200))).toBe(100)
    })

    it('writes the blob anyway when the cap is exceeded but nothing more can be shed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        sm.capBytes = 10

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(session['storageSize.storageData']).toBe(bytesOf('storageData'))
        expect(warn).not.toHaveBeenCalled()
        expect(notify).not.toHaveBeenCalled()
    })

    it('writes the network log anyway when the cap is exceeded but nothing more can be shed', async () => {
        sm.capBytes = 10

        await StorageManager.addNetworkRequest(request(1, 'https://h/x'), tab)

        expect(store.networkRequests).toHaveLength(1)
        expect(session['storageSize.networkRequests']).toBe(bytesOf('networkRequests'))
        expect(notify).not.toHaveBeenCalled()
    })

    it('notifies once when the browser keeps rejecting writes', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        ctrl.quotaBytes = 1

        for (let i = 0; i < 3; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)

        expect(warn).toHaveBeenCalledTimes(3)
        expect(notify).toHaveBeenCalledTimes(1)
        expect(notify.mock.calls[0][0].message).toBe('storage_quota_dropped')
        expect(typeof session['notifiedAt.storage_quota_dropped']).toBe('number')
        expect(session['storageSize.networkRequests']).toBeUndefined()
    })

    it('does not stamp the throttle when the notification could not be shown', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        notify.mockRejectedValueOnce(new Error('denied'))
        ctrl.quotaBytes = 1

        await StorageManager.addNetworkRequest(request(1, 'https://h/1'), tab)
        expect(session['notifiedAt.storage_quota_dropped']).toBeUndefined()

        await StorageManager.addNetworkRequest(request(2, 'https://h/2'), tab)
        expect(notify).toHaveBeenCalledTimes(2)
        expect(typeof session['notifiedAt.storage_quota_dropped']).toBe('number')
    })

    it('skips the cap check and still writes when the size read rejects', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(browser.storage.local, 'get').mockImplementation(async (keys: any) => {
            if (Array.isArray(keys) && keys.length === 1 && keys[0] === 'networkRequests')
                throw new Error('profile unavailable')
            return read(store, keys)
        })

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 1}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(warn).toHaveBeenCalledWith('QA Trace: could not measure storage, skipping cap check', expect.any(Error))
        expect(notify).not.toHaveBeenCalled()
    })

    it('a shrinking write from a shed rung never reads the other key', async () => {
        const get = vi.spyOn(browser.storage.local, 'get')

        await sm.setNetworkRequests([{...request(1, 'u'), tabInfo: tab}], true)

        expect(get).not.toHaveBeenCalled()
        expect(store.networkRequests).toHaveLength(1)
    })

    it('drops every screenshot before halving errors or the network log', async () => {
        for (let i = 0; i < 10; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        for (let i = 0; i < 3; i++)
            await StorageManager.addError({type: 'ui', id: `e${i}`, message: 'ui', timestamp: 100 + i}, tab, 'data:image/jpeg;base64,' + 'A'.repeat(3000))
        for (let i = 0; i < 6; i++)
            await StorageManager.addError({type: 'console', message: `c${i}`, timestamp: 200 + i}, tab)
        const networkBefore = store.networkRequests.length
        const errorsBefore = store.storageData.errors.length
        sm.capBytes = storedBytes() - 7000

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 300}, tab)

        expect(store.storageData.uiErrorScreenshots).toHaveLength(0)
        expect(store.storageData.errors).toHaveLength(errorsBefore)
        expect(store.networkRequests).toHaveLength(networkBefore)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
    })

    it('moves past a shed rung whose own write fails instead of trusting it', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        for (let i = 0; i < 20; i++)
            await StorageManager.addNetworkRequest(request(i, `https://h/${i}`), tab)
        for (let i = 0; i < 8; i++)
            await StorageManager.addError({type: 'console', message: 'x'.repeat(500), timestamp: 100 + i}, tab)
        const networkBefore = bytesOf('networkRequests')
        ctrl.failNetworkSet = true
        sm.capBytes = storedBytes() - 1500

        await StorageManager.addUserAction({type: 'click', element: 'BTN', selector: '#b', timestamp: 300}, tab)

        expect(store.storageData.userActions).toHaveLength(1)
        expect(store.storageData.errors.length).toBeLessThan(8)
        expect(bytesOf('networkRequests')).toBe(networkBefore)
        expect(session['storageSize.networkRequests']).toBe(networkBefore)
        expect(storedBytes()).toBeLessThanOrEqual(sm.capBytes)
        expect(notify).not.toHaveBeenCalled()
    })
})
