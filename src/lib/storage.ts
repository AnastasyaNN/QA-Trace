import {StorageData, UserAction, ErrorLog, TabInfo, UiErrorScreenshot, NetworkErrorPayload, NetworkRequestLog} from "./types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "./integrations";
import {SavedResponse} from "../popup/popup-saved-response.ts";

const AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES = 5
const NETWORK_REQUESTS_KEY = 'networkRequests'
const DEFAULT_STORAGE: StorageData = {
    userActions: [],
    errors: [],
    networkRequests: [],
    uiErrorScreenshots: [],
    networkErrorPayloads: []
}

export class StorageManager {
    private static writeQueues: Record<'main' | 'network', Promise<void>> = {
        main: Promise.resolve(),
        network: Promise.resolve()
    }

    static async getStorage(): Promise<StorageData> {
        const result: {[key: string]: any} = await browser.storage.local.get(['storageData', NETWORK_REQUESTS_KEY])
        const data = result.storageData || {}
        return {
            userActions: data.userActions || [],
            errors: data.errors || [],
            networkRequests: result[NETWORK_REQUESTS_KEY] ?? data.networkRequests ?? [],
            uiErrorScreenshots: data.uiErrorScreenshots || [],
            networkErrorPayloads: data.networkErrorPayloads || []
        }
    }

    static async setStorage(data: StorageData): Promise<void> {
        const blob: StorageData = {...data, networkRequests: []}
        await this.persist(() => ({storageData: blob}), () => this.shedStorageData(blob))
    }

    private static async getNetworkRequests(): Promise<NetworkRequestLog[]> {
        const result: {[key: string]: any} = await browser.storage.local.get([NETWORK_REQUESTS_KEY])
        return result[NETWORK_REQUESTS_KEY] || []
    }

    private static async setNetworkRequests(requests: NetworkRequestLog[]): Promise<void> {
        let current = requests
        await this.persist(() => ({[NETWORK_REQUESTS_KEY]: current}), () => {
            const next = this.halve(current)
            if (!next)
                return false
            current = next
            return true
        })
    }

    static async addUserAction(action: Omit<UserAction, "tabInfo">, currentTabInfo: TabInfo): Promise<void> {
        await this.enqueueWrite(async () => {
            const storage = await this.getStorage()
            const configuration = await ExtensionConfigurationManager.getConfiguration()

            const existingIndex = storage.userActions.findIndex(existing =>
                existing.selector === action.selector &&
                existing.element === action.element &&
                existing.tabInfo?.url === currentTabInfo.url &&
                existing.tabInfo?.id === currentTabInfo.id &&
                action.labelText &&
                existing.labelText === action.labelText
            )
            // remove the latest action if it was performed with the same element as current action
            if (existingIndex === 0)
                storage.userActions.shift()

            // todo check/uncheck
            storage.userActions.unshift({
                ...action,
                tabInfo: currentTabInfo
            })

            if (storage.userActions.length > configuration.userActionsLimit) {
                const itemForDeletion = storage.userActions[storage.userActions.length - 1]
                // remove errors occurred before deleted action
                storage.errors = storage.errors?.filter(error => error.timestamp > itemForDeletion.timestamp)
                storage.userActions = storage.userActions.slice(0, configuration.userActionsLimit)
            }

            this.reconcileDependentStorage(storage)

            await this.setStorage(storage)
        });
    }

    static async addError(error: Omit<ErrorLog, "tabInfo">, currentTabInfo: TabInfo): Promise<void> {
        await this.enqueueWrite(async () => {
            const storage = await this.getStorage()
            const configuration = await ExtensionConfigurationManager.getConfiguration()

            let toStore: Omit<ErrorLog, 'tabInfo'> = {...error}
            if (error.type === 'network') {
                const payloadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
                storage.networkErrorPayloads = storage.networkErrorPayloads.slice(0, AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES)

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

            storage.errors.unshift({
                ...toStore,
                tabInfo: currentTabInfo
            })

            if (storage.errors.length > configuration.errorsLimit) {
                const itemForDeletion = storage.errors[storage.errors.length - 1]
                storage.userActions = storage.userActions?.filter(action => action.timestamp > itemForDeletion.timestamp)
                storage.errors = storage.errors.slice(0, configuration.errorsLimit)
            }

            this.reconcileDependentStorage(storage)

            await this.setStorage(storage)
        })
    }

    static async addNetworkRequest(request: Omit<NetworkRequestLog, "tabInfo">, currentTabInfo: TabInfo): Promise<void> {
        await this.enqueueWrite(async () => {
            const configuration = await ExtensionConfigurationManager.getConfiguration()
            const networkRequests = await this.getNetworkRequests()

            networkRequests.unshift({
                ...request,
                tabInfo: currentTabInfo
            })

            await this.setNetworkRequests(networkRequests.slice(0, configuration.networkRequestsLimit))
        }, 'network')
    }

    static async addUiErrorScreenshotAndAttach(errorId: string, screenshot: UiErrorScreenshot): Promise<void> {
        await this.enqueueWrite(async () => {
            const storage = await this.getStorage()
            storage.uiErrorScreenshots.unshift(screenshot)
            storage.uiErrorScreenshots = storage.uiErrorScreenshots.slice(0, AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES)
            const idx = storage.errors.findIndex(error => error.id === errorId)
            if (idx >= 0)
                storage.errors[idx].screenshotId = screenshot.id
            this.reconcileDependentStorage(storage)
            await this.setStorage(storage)
        })
    }

    static async clearData(): Promise<void> {
        await this.enqueueAcrossQueues(async () => {
            await browser.storage.local.set({
                storageData: {...DEFAULT_STORAGE, networkRequests: []},
                [NETWORK_REQUESTS_KEY]: []
            })
        })
    }

    static async cleanupOldData(): Promise<void> {
        const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000)
        const isFresh = (timestamp: number) => timestamp > twelveHoursAgo

        await this.enqueueWrite(async () => {
            const storage = await this.getStorage()
            storage.userActions = storage.userActions.filter(action => isFresh(action.timestamp))
            storage.errors = storage.errors.filter(error => isFresh(error.timestamp))
            storage.uiErrorScreenshots = storage.uiErrorScreenshots.filter(item => isFresh(item.timestamp))
            storage.networkErrorPayloads = (storage.networkErrorPayloads || []).filter(p => isFresh(p.timestamp))
            await SavedResponse.clearSavedLLMResponse(twelveHoursAgo)

            this.reconcileDependentStorage(storage)
            await this.setStorage(storage)
        }, 'main')

        await this.enqueueWrite(async () => {
            const requests = await this.getNetworkRequests()
            await this.setNetworkRequests(requests.filter(request => isFresh(request.timestamp)))
        }, 'network')
    }

    private static enqueueWrite<T>(task: () => Promise<T>, queue: 'main' | 'network' = 'main'): Promise<T> {
        const nextTask = this.writeQueues[queue].then(task)
        this.writeQueues[queue] = nextTask.then(() => undefined, () => undefined)
        return nextTask
    }

    private static enqueueAcrossQueues(task: () => Promise<void>): Promise<void> {
        return this.enqueueWrite(() => this.enqueueWrite(task, 'network'), 'main')
    }

    // Writes are best-effort: on a storage-quota rejection we shed the oldest/heaviest data and
    // retry until it fits. `shed` returns false when nothing more can be dropped.
    private static async persist(buildEntries: () => Record<string, unknown>, shed: () => boolean | Promise<boolean>): Promise<void> {
        while (true) {
            try {
                await browser.storage.local.set(buildEntries())
                return
            } catch (error) {
                if (!this.isQuotaExceeded(error)) {
                    console.warn('QA Trace: storage write failed', error)
                    this.notifyUser('storage_write_failed')
                    return
                }
                if (!(await shed())) {
                    console.warn('QA Trace: storage quota exceeded; oldest data was dropped')
                    this.notifyUser('storage_quota_dropped')
                    return
                }
            }
        }
    }

    private static isQuotaExceeded(error: unknown): boolean {
        // Some browsers reject with a name-only DOMException (empty message), so check both.
        const name = (error as {name?: unknown})?.name
        const message = error instanceof Error ? error.message : String(error)
        return /quota/i.test(String(name)) || /quota/i.test(message)
    }

    // Single shed policy: keep the larger (newer) half — items are unshifted to the front, so slicing
    // from 0 retains the most recent and never drops the last survivor. Returns null when the list is
    // too small to shrink, signalling shed loops to stop.
    private static halve<T>(items: T[]): T[] | null {
        return items.length > 1
            ? items.slice(0, Math.ceil(items.length / 2))
            : null
    }

    private static notifyUser(messageKey: string): void {
        try {
            void browser.notifications?.create({
                type: 'basic',
                iconUrl: browser.runtime.getURL('icons/128.png'),
                title: browser.i18n.getMessage('extName'),
                message: browser.i18n.getMessage(messageKey)
            })
        } catch (error) {
            console.warn('QA Trace: failed to show notification', error)
        }
    }

    private static async shedStorageData(data: StorageData): Promise<boolean> {
        if (data.uiErrorScreenshots.length > 0) {
            data.uiErrorScreenshots = data.uiErrorScreenshots.slice(0, -1)
            this.reconcileDependentStorage(data)
            return true
        }
        if (await this.shedNetworkRequests())
            return true
        const payloads = this.halve(data.networkErrorPayloads || [])
        if (payloads) {
            data.networkErrorPayloads = payloads
            this.reconcileDependentStorage(data)
            return true
        }
        const errors = this.halve(data.errors)
        if (errors) {
            data.errors = errors
            this.reconcileDependentStorage(data)
            return true
        }
        const userActions = this.halve(data.userActions)
        if (userActions) {
            data.userActions = userActions
            return true
        }
        return false
    }

    private static shedNetworkRequests(): Promise<boolean> {
        return this.enqueueWrite(async () => {
            const next = this.halve(await this.getNetworkRequests())
            if (!next)
                return false
            await this.setNetworkRequests(next)
            return true
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