import {StorageData, UserAction, ErrorLog, TabInfo, UiErrorScreenshot, NetworkErrorPayload, NetworkRequestLog} from "./types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "./integrations";
import {IdUtils} from "./id";
import {SavedResponse} from "../popup/popup-saved-response.ts";
import {STORAGE_CAP_BYTES, STORAGE_WARNING_PERCENT, StorageUsage, StorageWarning, byteLength, usagePercentOf} from "./storage-limits";

const AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES = 5
const LEGACY_NETWORK_KEY = 'networkRequests'
const NETWORK_INDEX_KEY = 'networkRequestIndex'
const NETWORK_ENTRY_PREFIX = 'networkRequest.'
const STORAGE_SIZE_KEY_PREFIX = 'storageSize.'
const STORAGE_WARNED_KEY = 'storageWarned'
const COUNTED_KEYS = ['storageData', 'networkLog'] as const
const RETENTION_MS = 12 * 60 * 60 * 1000
type CountedKey = typeof COUNTED_KEYS[number]
type StorageSizes = Record<CountedKey, number>
type StoredRequest = NetworkRequestLog & {id: string}
type NetworkIndexEntry = {id: string, timestamp: number, bytes: number}
type NetworkWrite = {index: NetworkIndexEntry[], set: Record<string, StoredRequest>, remove: string[]}
type ShedTrigger = {reason: 'cap', excess: number, written: number} | {reason: 'quota'}
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
    private static warned: Promise<Set<StorageWarning>> | null = null
    static onWarning: ((warning: StorageWarning) => void) | undefined

    static storageUsage(data: StorageData): StorageUsage | null {
        try {
            const size = (items: unknown[]) => items.length ? this.measure(items) : 0
            const userActions = size(data.userActions)
            const errors = size(data.errors) + size(data.uiErrorScreenshots) + size(data.networkErrorPayloads)
            const requests = size(data.networkRequests)
            const bytes = userActions + errors + requests
            return {bytes, percent: usagePercentOf(bytes, this.capBytes), userActions, errors, requests}
        } catch {
            return null
        }
    }

    static async getStorage(): Promise<StorageData> {
        return (await this.readBlob()).storage
    }

    private static async readBlob(): Promise<{storage: StorageData, legacyRequests: boolean}> {
        const result: {[key: string]: any} = await browser.storage.local.get(['storageData'])
        const data = result.storageData || {}
        return {
            storage: {
                userActions: data.userActions || [],
                errors: data.errors || [],
                networkRequests: [],
                uiErrorScreenshots: data.uiErrorScreenshots || [],
                networkErrorPayloads: data.networkErrorPayloads || []
            },
            legacyRequests: !!this.asArray(data.networkRequests)?.length
        }
    }

    private static itemCount(data: StorageData): number {
        return (Object.keys(DEFAULT_STORAGE) as Array<keyof StorageData>).reduce((sum, key) => sum + (this.asArray(data[key])?.length ?? 0), 0)
    }

    static async setStorage(data: StorageData): Promise<void> {
        const blob = this.toBlob(data)
        await this.persist(() => ({storageData: blob}), this.makeBlobShedder(blob))
    }

    private static toBlob(data: StorageData): StorageData {
        return {...data, networkRequests: []}
    }

    static async getNetworkRequestById(id: string): Promise<NetworkRequestLog | undefined> {
        const key = this.entryKey(id)
        const result: {[key: string]: any} = await browser.storage.local.get([NETWORK_INDEX_KEY, key])
        const index = this.toIndex(result[NETWORK_INDEX_KEY])
        if (index)
            return index.some((entry) => entry.id === id) ? result[key] : undefined
        const requests = await this.readLegacyRequests()
        return requests.find((request) => request.id === id)
    }

    static async getNetworkRequests(): Promise<NetworkRequestLog[]> {
        const index = await this.readIndex()
        return index ? this.readEntries(index) : this.readLegacyRequests()
    }

    private static async readIndex(): Promise<NetworkIndexEntry[] | undefined> {
        return this.toIndex(await this.readRawIndex())
    }

    private static async readRawIndex(): Promise<unknown> {
        const result: {[key: string]: any} = await browser.storage.local.get(NETWORK_INDEX_KEY)
        return result[NETWORK_INDEX_KEY]
    }

    private static toIndex(value: unknown): NetworkIndexEntry[] | undefined {
        return this.asArray<NetworkIndexEntry>(value)?.filter((entry) =>
            typeof entry?.id === 'string' && Number.isFinite(entry.timestamp) && Number.isFinite(entry.bytes)
        )
    }

    private static asArray<T>(value: unknown): T[] | undefined {
        return Array.isArray(value) ? value : undefined
    }

    private static async readEntries(index: NetworkIndexEntry[]): Promise<NetworkRequestLog[]> {
        if (!index.length)
            return []
        const records: {[key: string]: any} = await browser.storage.local.get(index.map((entry) => this.entryKey(entry.id)))
        return index.map((entry) => records[this.entryKey(entry.id)]).filter(Boolean)
    }

    private static async readLegacyRequests(): Promise<NetworkRequestLog[]> {
        const result: {[key: string]: any} = await browser.storage.local.get(LEGACY_NETWORK_KEY)
        return this.asArray<NetworkRequestLog>(result[LEGACY_NETWORK_KEY]) ?? []
    }

    private static entryKey(id: string): string {
        return NETWORK_ENTRY_PREFIX + id
    }

    private static entryKeys(keys: string[]): string[] {
        return keys.filter((key) => key.startsWith(NETWORK_ENTRY_PREFIX))
    }

    private static async allKeys(): Promise<string[]> {
        return browser.storage.local.getKeys?.() ?? Object.keys(await browser.storage.local.get(null))
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
            await this.mutateNetworkIndex((index) => index.slice(0, configuration.networkRequestsLimit), [...batch].reverse())
        })
    }

    static async clearData(): Promise<void> {
        // Drop buffered-but-unflushed appends so an in-flight batch cannot write data back after the wipe.
        Object.values(this.batchers).forEach((batcher) => batcher.items = [])
        // Route through persist() so a rejected write is reported (onWarning) instead of becoming an
        // unhandled rejection in the CLEAR_DATA handler. Nothing to shed when writing empty data.
        const wipe = async () => {
            const [keys, index] = await Promise.all([
                this.allKeys().catch((error) => {
                    console.warn('QA Trace: could not list storage keys', error)
                    return []
                }),
                this.readIndex().catch(() => undefined)
            ])
            const named = (index ?? []).map((entry) => this.entryKey(entry.id))
            return this.persist(
                () => ({storageData: {...DEFAULT_STORAGE}, [NETWORK_INDEX_KEY]: []}),
                () => false,
                false,
                () => [...new Set([...this.entryKeys(keys), ...named]), LEGACY_NETWORK_KEY]
            )
        }
        await this.enqueueWrite(() => this.enqueueWrite(wipe, 'network'), 'main')
    }

    static async cleanupOldData(): Promise<void> {
        const cutoff = Date.now() - RETENTION_MS
        const isFresh = (timestamp: number) => timestamp > cutoff

        const network = this.enqueueWrite(
            () => this.mutateNetworkIndex((index) => index.filter((entry) => isFresh(entry.timestamp))),
            'network'
        )
        await network.catch(() => undefined)

        await this.enqueueWrite(async () => {
            const {storage, legacyRequests} = await this.readBlob()
            const before = this.itemCount(storage)
            storage.userActions = storage.userActions.filter(action => isFresh(action.timestamp))
            storage.errors = storage.errors.filter(error => isFresh(error.timestamp))
            storage.uiErrorScreenshots = storage.uiErrorScreenshots.filter(item => isFresh(item.timestamp))
            storage.networkErrorPayloads = storage.networkErrorPayloads.filter(p => isFresh(p.timestamp))
            await SavedResponse.clearSavedLLMResponse(cutoff)

            const reconciled = this.reconcileDependentStorage(storage)
            if (reconciled || legacyRequests || this.itemCount(storage) < before)
                await this.setStorage(storage)
        }, 'main')

        await network
    }

    static sweepNetworkEntries(): Promise<void> {
        return this.enqueueWrite(async () => {
            const index = await this.readIndex()
            if (!index)
                return
            const keys = new Set(await this.allKeys())
            const known = new Set(index.map((entry) => this.entryKey(entry.id)))
            await this.removeKeys([
                ...this.entryKeys([...keys]).filter((key) => !known.has(key)),
                ...(keys.has(LEGACY_NETWORK_KEY) ? [LEGACY_NETWORK_KEY] : [])
            ])
            const present = index.filter((entry) => keys.has(this.entryKey(entry.id)))
            if (present.length < index.length)
                await this.setNetworkRequests({index: present, set: {}, remove: []}, true)
        }, 'network')
    }

    private static async setNetworkRequests(write: NetworkWrite, shrinking = false): Promise<boolean> {
        let current = write
        let removedStored = false
        const fresh = new Set(Object.keys(write.set))
        const removeStored = async (keys: string[]) => {
            removedStored ||= this.entryKeys(keys).length > 0
            await this.removeKeys(keys)
        }
        const written = await this.persist(() => ({...current.set, [NETWORK_INDEX_KEY]: current.index}), async (trigger) => {
            if (trigger.reason === 'quota' && current.remove.length) {
                const scheduled = current.remove
                current = {...current, remove: []}
                await removeStored(scheduled)
                return true
            }
            if (trigger.reason === 'cap' && trigger.excess >= trigger.written)
                return false
            const next = this.halve(current.index)
            if (!next)
                return false
            const kept = new Set(next.map((entry) => entry.id))
            const dropped = current.index.filter((entry) => !kept.has(entry.id)).map((entry) => this.entryKey(entry.id))
            current = {
                index: next,
                set: Object.fromEntries(Object.entries(current.set).filter(([, request]) => kept.has(request.id))),
                remove: current.remove
            }
            await removeStored(dropped.filter((key) => !fresh.has(key)))
            return true
        }, shrinking, () => current.remove)
        if (!written && removedStored)
            await this.persist(
                () => ({[NETWORK_INDEX_KEY]: current.index.filter((entry) => !(this.entryKey(entry.id) in current.set))}),
                () => false,
                true
            )
        return written
    }

    // Read-modify-write of the index; callers already run inside the 'network' queue.
    private static async mutateNetworkIndex(keep: (index: NetworkIndexEntry[]) => NetworkIndexEntry[] | null, added: NetworkRequestLog[] = [], shrinking = false): Promise<boolean> {
        const raw = this.asArray<unknown>(await this.readRawIndex())
        const stored = raw && this.toIndex(raw)
        const legacy = stored ? [] : await this.readLegacyRequests()
        const fresh: StoredRequest[] = [...added, ...legacy]
            .filter((request) => Number.isFinite(request.timestamp))
            .map((request) => ({...request, id: request.id || IdUtils.generate()}))
        const index = keep([...fresh.map((request) => this.toIndexEntry(request)), ...(stored ?? [])])
        if (!index)
            return false
        if (!fresh.length && raw && index.length === raw.length)
            return true
        const kept = new Set(index.map((entry) => entry.id))
        return this.setNetworkRequests({
            index,
            set: Object.fromEntries(fresh.filter((request) => kept.has(request.id)).map((request) => [this.entryKey(request.id), request])),
            remove: [
                ...(stored ?? []).filter((entry) => !kept.has(entry.id)).map((entry) => this.entryKey(entry.id)),
                ...(stored ? [] : [LEGACY_NETWORK_KEY])
            ]
        }, shrinking)
    }

    private static toIndexEntry(request: StoredRequest): NetworkIndexEntry {
        return {id: request.id, timestamp: request.timestamp, bytes: this.measure(request)}
    }

    private static async removeKeys(keys: string[]): Promise<void> {
        if (!keys.length)
            return
        try {
            await browser.storage.local.remove(keys)
        } catch (error) {
            console.warn('QA Trace: could not remove replaced storage keys', error)
        }
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
    private static async persist(buildEntries: () => Record<string, unknown>, shed: (trigger: ShedTrigger) => boolean | Promise<boolean>, shrinking = false, keysToRemove: () => string[] = () => []): Promise<boolean> {
        while (true) {
            const entries = buildEntries()
            const written = this.measureWritten(entries)
            const total = shrinking ? null : await this.totalBytes(written)
            if (total !== null && total > this.capBytes && await shed({reason: 'cap', excess: total - this.capBytes, written: this.total(written)}))
                continue
            try {
                await browser.storage.local.set(entries)
            } catch (error) {
                const quota = this.isQuotaExceeded(error)
                if (quota && await shed({reason: 'quota'}))
                    continue
                console.warn(quota ? 'QA Trace: browser storage quota exceeded; latest data was not saved' : 'QA Trace: storage write failed', error)
                if (!shrinking)
                    await this.flagWarning(quota ? 'full' : 'failed')
                return false
            }
            await Promise.all([
                this.rememberSizes(written),
                this.forgetSizes(this.writtenKeys(entries).filter((key) => !(key in written))),
                this.removeKeys(keysToRemove())
            ])
            if (!shrinking)
                await this.updateWarnings(total)
            return true
        }
    }

    private static measure(value: unknown): number {
        return value == null ? 0 : byteLength(JSON.stringify(value))
    }

    private static total(sizes: Partial<StorageSizes>): number {
        return COUNTED_KEYS.reduce((sum, key) => sum + (sizes[key] ?? 0), 0)
    }

    private static readonly stores: Record<CountedKey, {key: string, reads: string[], bytes: (values: Record<string, unknown>) => number}> = {
        storageData: {key: 'storageData', reads: ['storageData'], bytes: (values) => StorageManager.measure(values.storageData)},
        networkLog: {
            key: NETWORK_INDEX_KEY,
            reads: [NETWORK_INDEX_KEY, LEGACY_NETWORK_KEY],
            bytes: (values) => {
                const index = StorageManager.toIndex(values[NETWORK_INDEX_KEY])
                return index ? StorageManager.indexBytes(index) : StorageManager.measure(values[LEGACY_NETWORK_KEY])
            }
        }
    }

    private static indexBytes(index: NetworkIndexEntry[]): number {
        return index.reduce((sum, entry) => sum + entry.bytes, 0) + this.measure(index)
    }

    private static writtenKeys(entries: Record<string, unknown>): CountedKey[] {
        return COUNTED_KEYS.filter((key) => this.stores[key].key in entries)
    }

    private static measureWritten(entries: Record<string, unknown>): Partial<StorageSizes> {
        const written: Partial<StorageSizes> = {}
        try {
            for (const key of this.writtenKeys(entries))
                written[key] = this.stores[key].bytes(entries)
            return written
        } catch (error) {
            console.warn('QA Trace: could not measure storage write', error)
            return {}
        }
    }

    private static async totalBytes(written: Partial<StorageSizes>): Promise<number | null> {
        try {
            const cached = await this.cachedSizes(COUNTED_KEYS.filter((key) => !(key in written)))
            return this.total({...cached, ...written})
        } catch (error) {
            console.warn('QA Trace: could not measure storage, skipping cap check', error)
            return null
        }
    }

    private static async cachedSizes(keys: CountedKey[]): Promise<StorageSizes> {
        const sizes: StorageSizes = {storageData: 0, networkLog: 0}
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
        const local: {[key: string]: any} = await browser.storage.local.get(uncached.flatMap((key) => this.stores[key].reads))
        uncached.forEach((key) => sizes[key] = this.stores[key].bytes(local))
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

    static flaggedWarnings(): Promise<Set<StorageWarning>> {
        return this.warned ??= browser.storage.session.get(STORAGE_WARNED_KEY)
            .then((result) => new Set(this.asArray<StorageWarning>(result[STORAGE_WARNED_KEY]) ?? []))
            .catch(() => new Set())
    }

    private static async saveWarned(warned: Set<StorageWarning>): Promise<void> {
        try {
            await browser.storage.session.set({[STORAGE_WARNED_KEY]: [...warned]})
        } catch (error) {
            console.debug('QA Trace: could not save storage warning state', error)
        }
    }

    private static async flagWarning(warning: StorageWarning): Promise<void> {
        const warned = await this.flaggedWarnings()
        if (warned.has(warning))
            return
        warned.add(warning)
        await this.saveWarned(warned)
        this.onWarning?.(warning)
    }

    private static async unflagWarnings(...warnings: StorageWarning[]): Promise<void> {
        const warned = await this.flaggedWarnings()
        if (warnings.filter((warning) => warned.delete(warning)).length)
            await this.saveWarned(warned)
    }

    private static async updateWarnings(total: number | null): Promise<void> {
        await this.unflagWarnings('failed')
        if (total === null)
            return
        if (usagePercentOf(total, this.capBytes) >= STORAGE_WARNING_PERCENT)
            await this.flagWarning('high')
        else
            await this.unflagWarnings('high', 'full')
    }

    private static makeBlobShedder(data: StorageData): () => Promise<boolean> {
        const rungs: Array<() => boolean | Promise<boolean>> = [
            () => this.dropOldestScreenshot(data),
            () => this.shedNetworkRequests(),
            () => this.replaceIfHalved(data.networkErrorPayloads, (next) => { data.networkErrorPayloads = next }),
            () => this.replaceIfHalved(data.errors, (next) => { data.errors = next }),
            () => this.replaceIfHalved(data.userActions, (next) => { data.userActions = next })
        ]
        let cursor = 0
        return async () => {
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
                return await this.mutateNetworkIndex((index) => this.halve(index), [], true)
            } catch (error) {
                console.warn('QA Trace: could not shed network requests', error)
                return false
            }
        }, 'network')
    }

    private static reconcileDependentStorage(storage: StorageData): boolean {
        let changed = false
        const ids = (values: Array<string | undefined>) =>
            new Set(values.filter((id): id is string => typeof id === 'string' && id.length > 0))
        const prune = <T>(items: T[] | undefined, keep: (item: T) => boolean): T[] => {
            const kept = (items || []).filter(keep)
            changed ||= kept.length !== (items || []).length
            return kept
        }
        const unlink = (field: 'screenshotId' | 'networkPayloadId', known: Set<string>) =>
            storage.errors.forEach((error) => {
                const id = error[field]
                if (id && !known.has(id)) {
                    delete error[field]
                    changed = true
                }
            })

        const errorIds = ids(storage.errors.map((error) => error.id))
        storage.uiErrorScreenshots = prune(storage.uiErrorScreenshots, (shot) => errorIds.has(shot.errorId))
        unlink('screenshotId', ids(storage.uiErrorScreenshots.map((shot) => shot.id)))

        const payloadIds = ids(storage.errors.map((error) => error.networkPayloadId))
        storage.networkErrorPayloads = prune(storage.networkErrorPayloads, (payload) => payloadIds.has(payload.id))
        unlink('networkPayloadId', ids(storage.networkErrorPayloads.map((payload) => payload.id)))
        return changed
    }
}