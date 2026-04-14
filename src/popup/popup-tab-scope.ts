import {StorageData, TabInfo} from "../lib/types";
import {ConfigurePopupConfig} from "./popup-configure-types";
import * as browser from "webextension-polyfill";

export type TrackedTab = {
    id: TabInfo['id'],
    url?: string,
    title?: string,
    closed?: boolean
}

export class TabScope {
    static async buildTrackedTabsListFromStorage(storageData: StorageData | null): Promise<TrackedTab[]> {
        if (!storageData)
            return []
        const map = new Map<number | string, TrackedTab>()
        storageData.userActions.forEach((action) => {
            const id = action.tabInfo?.id
            if (id === undefined || id === null)
                return
            if (!map.has(id)) {
                map.set(id, {
                    id,
                    url: action.tabInfo?.url,
                    title: action.tabInfo?.title,
                    closed: false,
                })
            }
        })

        const items = Array.from(map.values())
        return Promise.all(
            items.map(async (item) => {
                if (typeof item.id === 'number') {
                    try {
                        await browser.tabs.get(item.id)
                        return {...item, closed: false}
                    } catch {
                        return {...item, closed: true}
                    }
                }
                return {...item, closed: true}
            })
        )
    }

    static ensureDefaultTabSelection(
        configureConfig: ConfigurePopupConfig,
        trackedTabs: TrackedTab[],
        configureCurrentTabId: number
    ): void {
        if (configureConfig.selectedTabIds.length > 0)
            return
        if (configureCurrentTabId) {
            configureConfig.selectedTabIds = [configureCurrentTabId]
            return
        }
        if (trackedTabs.length > 0)
            configureConfig.selectedTabIds = [trackedTabs[0].id ?? 'unknown']
    }

    static reconcileSelectedTabScope(
        configureConfig: ConfigurePopupConfig,
        trackedTabs: TrackedTab[],
        configureCurrentTabId: number
    ): void {
        const trackedTabIds = new Set(trackedTabs.map((tab) => String(tab.id)))
        configureConfig.selectedTabIds = configureConfig.selectedTabIds.filter((id) =>
            trackedTabIds.has(String(id))
        )
        TabScope.ensureDefaultTabSelection(configureConfig, trackedTabs, configureCurrentTabId)
    }

    static parseTabId(id: string): number | string {
        const numeric = Number(id)
        return Number.isNaN(numeric) ? id : numeric
    }
}
