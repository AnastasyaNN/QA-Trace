import {StorageData, UserAction, ErrorLog, TabInfo, UiErrorScreenshot, NetworkErrorPayload} from "./types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "./integrations";
import {SavedResponse} from "../popup/popup-saved-response.ts";

const AMOUNT_OF_ELEMENTS_IN_ADDITIONAL_ERROR_STORAGES = 5
const DEFAULT_STORAGE: StorageData = {
    userActions: [],
    errors: [],
    uiErrorScreenshots: [],
    networkErrorPayloads: []
}

export class StorageManager {
    private static writeQueue: Promise<void> = Promise.resolve()

    static async getStorage(): Promise<StorageData> {
        const result: {[key: string]: any} = await browser.storage.local.get(['storageData'])
        const data = result.storageData || DEFAULT_STORAGE
        return {
            userActions: data.userActions || [],
            errors: data.errors || [],
            uiErrorScreenshots: data.uiErrorScreenshots || [],
            networkErrorPayloads: data.networkErrorPayloads || []
        }
    }

    static async setStorage(data: StorageData): Promise<void> {
        await browser.storage.local.set({ storageData: data })
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
        await this.setStorage(DEFAULT_STORAGE)
    }

    static async cleanupOldData(): Promise<void> {
        const storage = await this.getStorage()
        const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000)

        storage.userActions = storage.userActions.filter(action => action.timestamp > twelveHoursAgo)

        storage.errors = storage.errors.filter(error => error.timestamp > twelveHoursAgo)
        storage.uiErrorScreenshots = storage.uiErrorScreenshots.filter(item => item.timestamp > twelveHoursAgo)

        storage.networkErrorPayloads = (storage.networkErrorPayloads || []).filter(
            (p) => p.timestamp > twelveHoursAgo
        )
        await SavedResponse.clearSavedLLMResponse(twelveHoursAgo)

        this.reconcileDependentStorage(storage)
        await this.setStorage(storage)
    }

    private static enqueueWrite(task: () => Promise<void>): Promise<void> {
        const nextTask = this.writeQueue.then(task)
        this.writeQueue = nextTask.catch(() => undefined)
        return nextTask
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