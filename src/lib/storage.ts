import {StorageData, UserAction, ErrorLog, TabInfo, UiErrorScreenshot, NetworkErrorPayload, NetworkRequestLog} from "./types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "./integrations";
import {IdUtils} from "./id";
import {SavedResponse} from "../popup/popup-saved-response.ts";
import {STORAGE_CAP_BYTES, byteLength} from "./storage-limits";

const AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES = 5
const NETWORK_REQUESTS_KEY = 'networkRequests'
const STORAGE_SIZE_KEY_PREFIX = 'storageSize.'
const NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000
const NOTIFIED_AT_KEY_PREFIX = 'notifiedAt.'
const COUNTED_KEYS = ['storageData', NETWORK_REQUESTS_KEY] as const
const RETENTION_MS = 12 * 60 * 60 * 1000
type CountedKey = typeof COUNTED_KEYS[number]
type StorageSizes = Record<CountedKey, number>
const DEFAULT_STORAGE: StorageData = {
    userActions: [],
    errors: [],
    networkRequests: [],
    uiErrorScreenshots: [],
    networkErrorPayloads: []
}

export class StorageManager {
    private static writeQueues: Record<string, Promise<void>> = {}
    // Per-store buffers that coalesce bursty appends into one read-modify-write per debounce window.
    private static batchers: Record<string, {items: any[], pending: Promise<void> | null, flushNow: (() => void) | null}> = {}
    private static batchDelayMs = 300
    private static capBytes = STORAGE_CAP_BYTES

    static usagePercent(data: StorageData): number | null {
        try {
            const bytes = this.measure(this.toBlob(data)) + this.measure(data.networkRequests)
            return Math.min(100, Math.round(100 * bytes / this.capBytes))
        } catch {
            return null
        }
    }

    static async getStorage(): Promise<StorageData> {
        const result: {[key: string]: any} = await browser.storage.local.get(['storageData'])
        const data = result.storageData || {}
        return {
            userActions: data.userActions || [],
            errors: data.errors || [],
            networkRequests: [],
            uiErrorScreenshots: data.uiErrorScreenshots || [],
            networkErrorPayloads: data.networkErrorPayloads || []
        }
    }

    static async setStorage(data: StorageData): Promise<void> {
        const blob = this.toBlob(data)
        await this.persist(() => ({storageData: blob}), this.makeBlobShedder(blob))
    }

    private static toBlob(data: StorageData): StorageData {
        return {...data, networkRequests: []}
    }

    static async getNetworkRequestById(id: string): Promise<NetworkRequestLog | undefined> {
        const requests = await this.getNetworkRequests()
        return requests.find((request) => request.id === id)
    }

    // Own key, with a read-only fallback to legacy in-blob requests. The blob is read lazily so the
    // hot path avoids deserializing it. Not migrated on read: a write here would deadlock callers
    // already running on the 'network' queue.
    static async getNetworkRequests(): Promise<NetworkRequestLog[]> {
        const result: {[key: string]: any} = await browser.storage.local.get(NETWORK_REQUESTS_KEY)
        if (result[NETWORK_REQUESTS_KEY] != null)
            return result[NETWORK_REQUESTS_KEY]
        const legacy: {[key: string]: any} = await browser.storage.local.get('storageData')
        return legacy.storageData?.networkRequests ?? []
    }

    static async addUserAction(action: Omit<UserAction, "tabInfo">, currentTabInfo: TabInfo, immediate = false): Promise<void> {
        await this.batchWrite('userActions', 'main', {action, tabInfo: currentTabInfo}, async (batch) => {
            const storage = await this.getStorage()
            const configuration = await ExtensionConfigurationManager.getConfiguration()

            let needsReconcile = false
            for (const {action, tabInfo} of batch) {
                const firstElement = storage.userActions[0]
                const isDuplicateOfFirst = !!firstElement &&
                    firstElement.selector === action.selector &&
                    firstElement.element === action.element &&
                    firstElement.tabInfo?.url === tabInfo.url &&
                    firstElement.tabInfo?.id === tabInfo.id &&
                    !!action.labelText &&
                    firstElement.labelText === action.labelText
                // remove the latest action if it was performed with the same element as current action
                if (isDuplicateOfFirst)
                    storage.userActions.shift()

                // todo check/uncheck
                storage.userActions.unshift({...action, tabInfo})

                if (storage.userActions.length > configuration.userActionsLimit) {
                    const itemForDeletion = storage.userActions[storage.userActions.length - 1]
                    const errorsBefore = storage.errors.length
                    // remove errors occurred before deleted action
                    storage.errors = storage.errors.filter(error => error.timestamp > itemForDeletion.timestamp)
                    if (storage.errors.length < errorsBefore)
                        needsReconcile = true
                    storage.userActions = storage.userActions.slice(0, configuration.userActionsLimit)
                }
            }

            if (needsReconcile)
                this.reconcileDependentStorage(storage)

            await this.setStorage(storage)
        }, immediate)
    }

    static async addError(error: Omit<ErrorLog, "tabInfo">, currentTabInfo: TabInfo, imageDataUrl?: string): Promise<void> {
        await this.batchWrite('errors', 'main', {error, tabInfo: currentTabInfo, imageDataUrl}, async (batch) => {
            const storage = await this.getStorage()
            const configuration = await ExtensionConfigurationManager.getConfiguration()

            let needsReconcile = false
            for (const {error, tabInfo, imageDataUrl} of batch) {
                let toStore: Omit<ErrorLog, 'tabInfo'> = {...error}
                if (error.type === 'network') {
                    const payloadId = IdUtils.generate()
                    const errorId = error.id || payloadId
                    const payload: NetworkErrorPayload = {
                        id: payloadId,
                        errorId,
                        timestamp: error.timestamp,
                        requestHeaders: error.requestHeaders,
                        requestBody: error.requestBody,
                        responseHeaders: error.responseHeaders,
                        responseBody: error.responseBody
                    }
                    storage.networkErrorPayloads = storage.networkErrorPayloads || []
                    storage.networkErrorPayloads.unshift(payload)
                    if (storage.networkErrorPayloads.length > AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES) {
                        storage.networkErrorPayloads = storage.networkErrorPayloads.slice(0, AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES)
                        needsReconcile = true
                    }

                    const {
                        requestHeaders: _rh,
                        requestBody: _rb,
                        responseHeaders: _rsh,
                        responseBody: _rsb,
                        ...slim
                    } = toStore
                    toStore = {
                        ...slim,
                        id: errorId,
                        networkPayloadId: payloadId
                    }
                }

                storage.errors.unshift({...toStore, tabInfo})

                if (imageDataUrl && error.type === 'ui' && error.id) {
                    const screenshot: UiErrorScreenshot = {
                        id: IdUtils.generate(6),
                        errorId: error.id,
                        tabId: tabInfo.id,
                        timestamp: error.timestamp,
                        imageDataUrl
                    }
                    storage.uiErrorScreenshots.unshift(screenshot)
                    if (storage.uiErrorScreenshots.length > AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES) {
                        storage.uiErrorScreenshots = storage.uiErrorScreenshots.slice(0, AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES)
                        needsReconcile = true
                    }
                    storage.errors[0].screenshotId = screenshot.id
                }

                if (storage.errors.length > configuration.errorsLimit) {
                    const itemForDeletion = storage.errors[storage.errors.length - 1]
                    storage.userActions = storage.userActions?.filter(action => action.timestamp > itemForDeletion.timestamp)
                    storage.errors = storage.errors.slice(0, configuration.errorsLimit)
                    needsReconcile = true
                }
            }

            if (needsReconcile)
                this.reconcileDependentStorage(storage)

            await this.setStorage(storage)
        })
    }

    static async addNetworkRequest(request: Omit<NetworkRequestLog, "tabInfo">, currentTabInfo: TabInfo): Promise<void> {
        const entry: NetworkRequestLog = {id: IdUtils.generate(), ...request, tabInfo: currentTabInfo}
        await this.batchWrite('networkRequests', 'network', entry, async (batch) => {
            const configuration = await ExtensionConfigurationManager.getConfiguration()
            await this.mutateNetworkRequests((networkRequests) => {
                batch.forEach((item) => networkRequests.unshift(item))
                return networkRequests.slice(0, configuration.networkRequestsLimit)
            })
        })
    }

    static async clearData(): Promise<void> {
        // Drop buffered-but-unflushed appends so an in-flight batch cannot write data back after the wipe.
        Object.values(this.batchers).forEach((batcher) => batcher.items = [])
        // Route through persist() so a rejected write is reported (notifyUser) instead of becoming an
        // unhandled rejection in the CLEAR_DATA handler. Nothing to shed when writing empty data.
        const wipe = () => this.persist(
            () => ({storageData: {...DEFAULT_STORAGE}, [NETWORK_REQUESTS_KEY]: []}),
            () => false
        )
        await this.enqueueWrite(() => this.enqueueWrite(wipe, 'network'), 'main')
    }

    static async cleanupOldData(): Promise<void> {
        const cutoff = Date.now() - RETENTION_MS
        const isFresh = (timestamp: number) => timestamp > cutoff

        await this.enqueueWrite(async () => {
            const storage = await this.getStorage()
            storage.userActions = storage.userActions.filter(action => isFresh(action.timestamp))
            storage.errors = storage.errors.filter(error => isFresh(error.timestamp))
            storage.uiErrorScreenshots = storage.uiErrorScreenshots.filter(item => isFresh(item.timestamp))
            storage.networkErrorPayloads = (storage.networkErrorPayloads || []).filter(p => isFresh(p.timestamp))
            await SavedResponse.clearSavedLLMResponse(cutoff)

            this.reconcileDependentStorage(storage)
            await this.setStorage(storage)
        }, 'main')

        await this.enqueueWrite(
            () => this.mutateNetworkRequests((requests) => requests.filter(request => isFresh(request.timestamp))),
            'network'
        )
    }

    private static setNetworkRequests(requests: NetworkRequestLog[], shrinking = false): Promise<boolean> {
        let current = requests
        return this.persist(() => ({[NETWORK_REQUESTS_KEY]: current}), () => {
            const next = this.halve(current)
            if (!next)
                return false
            current = next
            return true
        }, shrinking)
    }

    // Read-modify-write of the network log; callers already run inside the 'network' queue.
    private static async mutateNetworkRequests(mutator: (requests: NetworkRequestLog[]) => NetworkRequestLog[]): Promise<void> {
        await this.setNetworkRequests(mutator(await this.getNetworkRequests()))
    }

    // Buffers item under key and, once per debounce window, drains the whole batch through one
    // queued read-modify-write (flush) - collapsing N appends into ~1 write. Best-effort: a failed
    // flush is logged, never thrown, so message handlers awaiting the append don't reject.
    private static batchWrite<T>(key: string, queue: 'main' | 'network', item: T, flush: (batch: T[]) => Promise<void>, immediate = false): Promise<void> {
        const batcher = this.batchers[key] ?? (this.batchers[key] = {items: [], pending: null, flushNow: null})
        batcher.items.push(item)
        if (!batcher.pending)
            batcher.pending = this.runBatch(batcher, queue, flush as (batch: any[]) => Promise<void>)
        if (immediate)
            batcher.flushNow?.()
        return batcher.pending
    }

    private static async runBatch(batcher: {items: any[], pending: Promise<void> | null, flushNow: (() => void) | null}, queue: 'main' | 'network', flush: (batch: any[]) => Promise<void>): Promise<void> {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.batchDelayMs)
            batcher.flushNow = () => {
                clearTimeout(timer)
                resolve()
            }
        })
        batcher.flushNow = null
        batcher.pending = null
        const batch = batcher.items
        batcher.items = []
        if (!batch.length)
            return
        await this.enqueueWrite(() => flush(batch), queue)
            .catch((error) => console.warn('QA Trace: batched write failed', error))
    }

    private static enqueueWrite<T>(task: () => Promise<T>, queue = 'main'): Promise<T> {
        const tail = this.writeQueues[queue] ?? Promise.resolve()
        const nextTask = tail.then(task)
        this.writeQueues[queue] = nextTask.then(() => undefined, () => undefined)
        return nextTask
    }

    // Best-effort: shed and retry while over the cap; once nothing more can be shed, or on a
    // browser quota rejection, the browser has the final say.
    private static async persist(buildEntries: () => Record<string, unknown>, shed: () => boolean | Promise<boolean>, shrinking = false): Promise<boolean> {
        while (true) {
            const entries = buildEntries()
            const written = this.measureWritten(entries)
            if (!shrinking && await this.exceedsCap(written) && await shed())
                continue
            try {
                await browser.storage.local.set(entries)
                await this.rememberSizes(written)
                await this.forgetSizes(COUNTED_KEYS.filter((key) => key in entries && !(key in written)))
                return true
            } catch (error) {
                if (!this.isQuotaExceeded(error)) {
                    console.warn('QA Trace: storage write failed', error)
                    if (!shrinking)
                        await this.notifyUser('storage_write_failed')
                    return false
                }
                if (!(await this.shedOrGiveUp(shed)))
                    return false
            }
        }
    }

    private static async shedOrGiveUp(shed: () => boolean | Promise<boolean>): Promise<boolean> {
        if (await shed())
            return true
        console.warn('QA Trace: browser storage quota exceeded; latest data was not saved')
        await this.notifyUser('storage_quota_dropped')
        return false
    }

    private static measure(value: unknown): number {
        return value == null ? 0 : byteLength(JSON.stringify(value))
    }

    private static total(sizes: StorageSizes): number {
        return COUNTED_KEYS.reduce((sum, key) => sum + sizes[key], 0)
    }

    private static measureWritten(entries: Record<string, unknown>): Partial<StorageSizes> {
        const written: Partial<StorageSizes> = {}
        try {
            for (const key of COUNTED_KEYS)
                if (key in entries)
                    written[key] = this.measure(entries[key])
            return written
        } catch (error) {
            console.warn('QA Trace: could not measure storage write', error)
            return {}
        }
    }

    private static async exceedsCap(written: Partial<StorageSizes>): Promise<boolean> {
        try {
            const cached = await this.cachedSizes(COUNTED_KEYS.filter((key) => !(key in written)))
            return this.total({...cached, ...written}) > this.capBytes
        } catch (error) {
            console.warn('QA Trace: could not measure storage, skipping cap check', error)
            return false
        }
    }

    private static async cachedSizes(keys: CountedKey[]): Promise<StorageSizes> {
        const sizes: StorageSizes = {storageData: 0, [NETWORK_REQUESTS_KEY]: 0}
        if (!keys.length)
            return sizes
        const cached = await this.readSizes(keys)
        const uncached: CountedKey[] = []
        for (const key of keys)
            if (Number.isFinite(cached[key]))
                sizes[key] = cached[key] as number
            else
                uncached.push(key)
        if (!uncached.length)
            return sizes
        const local: {[key: string]: any} = await browser.storage.local.get(uncached)
        uncached.forEach((key) => sizes[key] = this.measure(local[key]))
        return sizes
    }

    private static async readSizes(keys: CountedKey[]): Promise<Partial<Record<CountedKey, unknown>>> {
        try {
            const result: {[key: string]: any} = await browser.storage.session.get(keys.map((key) => STORAGE_SIZE_KEY_PREFIX + key))
            return Object.fromEntries(keys.map((key) => [key, result[STORAGE_SIZE_KEY_PREFIX + key]]))
        } catch {
            return {}
        }
    }

    private static async rememberSizes(sizes: Partial<StorageSizes>): Promise<void> {
        try {
            await browser.storage.session.set(Object.fromEntries(
                Object.entries(sizes).map(([key, bytes]) => [STORAGE_SIZE_KEY_PREFIX + key, bytes])
            ))
        } catch (error) {
            console.debug('QA Trace: could not cache storage sizes', error)
        }
    }

    private static async forgetSizes(keys: CountedKey[]): Promise<void> {
        if (!keys.length)
            return
        try {
            await browser.storage.session.remove(keys.map((key) => STORAGE_SIZE_KEY_PREFIX + key))
        } catch (error) {
            console.debug('QA Trace: could not clear cached storage sizes', error)
        }
    }

    private static isQuotaExceeded(error: unknown): boolean {
        // Some browsers reject with a name-only DOMException (empty message), so check both.
        const name = (error as {name?: unknown})?.name
        const message = error instanceof Error ? error.message : String(error)
        return /quota/i.test(String(name)) || /quota/i.test(message)
    }

    // Single shed policy: keep the larger (newer) half - items are unshifted to the front, so slicing
    // from 0 retains the most recent and never drops the last survivor. Returns null when the list is
    // too small to shrink, signalling shed loops to stop.
    private static halve<T>(items: T[]): T[] | null {
        return items.length > 1
            ? items.slice(0, Math.ceil(items.length / 2))
            : null
    }

    private static async notifyUser(messageKey: string): Promise<void> {
        const stampKey = NOTIFIED_AT_KEY_PREFIX + messageKey
        const stamped = await this.readStamp(stampKey)
        const now = Date.now()
        if (stamped !== undefined && now - stamped < NOTIFICATION_INTERVAL_MS)
            return
        try {
            await browser.notifications?.create({
                type: 'basic',
                iconUrl: browser.runtime.getURL('icons/128.png'),
                title: browser.i18n.getMessage('extName'),
                message: browser.i18n.getMessage(messageKey)
            })
            await browser.storage.session.set({[stampKey]: now})
        } catch (error) {
            console.warn('QA Trace: failed to show notification', error)
        }
    }

    private static async readStamp(stampKey: string): Promise<number | undefined> {
        try {
            const stamped: unknown = (await browser.storage.session.get(stampKey))[stampKey]
            return typeof stamped === 'number' ? stamped : undefined
        } catch {
            return undefined
        }
    }

    // Screenshots first (largest, least essential), then round-robin so the network log isn't
    // drained before the blob's own oversized content. Returns false once a pass sheds nothing.
    private static makeBlobShedder(data: StorageData): () => Promise<boolean> {
        const rungs: Array<() => boolean | Promise<boolean>> = [
            () => this.shedNetworkRequests(),
            () => this.replaceIfHalved(data.networkErrorPayloads, (next) => { data.networkErrorPayloads = next }),
            () => this.replaceIfHalved(data.errors, (next) => { data.errors = next }),
            () => this.replaceIfHalved(data.userActions, (next) => { data.userActions = next })
        ]
        let cursor = 0
        return async () => {
            if (this.dropOldestScreenshot(data)) {
                this.reconcileDependentStorage(data)
                return true
            }
            for (let i = 0; i < rungs.length; i++) {
                const rung = rungs[cursor]
                cursor = (cursor + 1) % rungs.length
                if (await rung()) {
                    this.reconcileDependentStorage(data)
                    return true
                }
            }
            return false
        }
    }

    private static dropOldestScreenshot(data: StorageData): boolean {
        if (data.uiErrorScreenshots.length === 0)
            return false
        data.uiErrorScreenshots = data.uiErrorScreenshots.slice(0, -1)
        return true
    }

    private static replaceIfHalved<T>(items: T[], assign: (next: T[]) => void): boolean {
        const next = this.halve(items)
        if (!next)
            return false
        assign(next)
        return true
    }

    private static shedNetworkRequests(): Promise<boolean> {
        return this.enqueueWrite(async () => {
            try {
                const next = this.halve(await this.getNetworkRequests())
                return !!next && await this.setNetworkRequests(next, true)
            } catch (error) {
                console.warn('QA Trace: could not shed network requests', error)
                return false
            }
        }, 'network')
    }

    private static reconcileDependentStorage(storage: StorageData): void {
        const errorIds = new Set(
            storage.errors
                .map((error) => error.id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )

        storage.uiErrorScreenshots = (storage.uiErrorScreenshots || []).filter((shot) => errorIds.has(shot.errorId))

        const screenshotIds = new Set(storage.uiErrorScreenshots.map((shot) => shot.id))
        storage.errors.forEach((error) => {
            if (error.screenshotId && !screenshotIds.has(error.screenshotId))
                delete error.screenshotId
        })

        const payloadIdsFromErrors = new Set(
            storage.errors
                .map((error) => error.networkPayloadId)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
        storage.networkErrorPayloads = (storage.networkErrorPayloads || []).filter((payload) =>
            payloadIdsFromErrors.has(payload.id)
        )

        const payloadIds = new Set(storage.networkErrorPayloads.map((payload) => payload.id))
        storage.errors.forEach((error) => {
            if (error.networkPayloadId && !payloadIds.has(error.networkPayloadId))
                delete error.networkPayloadId
        })
    }
}