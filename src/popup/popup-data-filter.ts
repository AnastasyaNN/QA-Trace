import {ErrorLog, StorageData, UserAction} from "../lib/types"
import {ConfigurePopupConfig, FilteredDataForConfigure} from "./popup-configure-types"
import {PopupFormat} from "./popup-format"

export class DataFilter {
    static getActionsByScope(
    storageData: StorageData | null,
    configureConfig: ConfigurePopupConfig
): UserAction[] {
    if (!storageData)
        return []
    if (configureConfig.includeAllTabs)
        return storageData.userActions
    if (configureConfig.selectedTabIds.length === 0)
        return []
    return storageData.userActions.filter((action) =>
        configureConfig.selectedTabIds.some((id) => id === action.tabInfo.id)
    )
}

    static getFilteredDataForConfig(
    storageData: StorageData | null,
    configureConfig: ConfigurePopupConfig
): FilteredDataForConfigure {
    if (!storageData)
        return {actions: [], errors: [], limitedActions: [], limitedErrors: []}

    const actions = DataFilter.getActionsByScope(storageData, configureConfig)
    const errors = DataFilter.getErrorsByScope(storageData, configureConfig)

    if (configureConfig.mode === 'full') {
        const windowMinutes = configureConfig.timeWindowMinutes || 90
        const windowMs = windowMinutes * 60 * 1000
        const threshold = Date.now() - windowMs

        const windowedActions = actions.filter((action) => action.timestamp >= threshold)
        const windowedErrors = errors.filter((error) => error.timestamp >= threshold)

        return {
            actions: windowedActions,
            errors: windowedErrors,
            limitedActions: windowedActions,
            limitedErrors: windowedErrors,
        }
    }

    const actionsLimit = Math.min(configureConfig.actionsCount, actions.length)
    const limitedActions = actions.slice(0, actionsLimit)
    const lastActionTimestamp = limitedActions[limitedActions.length - 1]?.timestamp
    const limitedErrors =
        configureConfig.mode === 'steps'
            ? lastActionTimestamp
                ? errors.filter((error) => error.timestamp > lastActionTimestamp)
                : []
            : errors

    return {
        actions,
        errors,
        limitedActions,
        limitedErrors,
    }
}

    static getEffectiveErrors(
    filteredData: FilteredDataForConfigure,
    mode: ConfigurePopupConfig['mode'],
    expectedErrors: Set<string>,
    allErrorsExpected: boolean
): ErrorLog[] {
    if (mode === 'full')
        return filteredData.errors
    if (mode === 'document')
        return []

    const sourceErrors = mode === 'steps' ? filteredData.limitedErrors : filteredData.errors
    const currentKeys = new Set(sourceErrors.map((error) => PopupFormat.getErrorKey(error)))

    expectedErrors.forEach((key) => {
        if (!currentKeys.has(key))
            expectedErrors.delete(key)
    })

    if (allErrorsExpected)
        return []

    return sourceErrors.filter((error) => !expectedErrors.has(PopupFormat.getErrorKey(error)))
    }

    private static getErrorsByScope(
    storageData: StorageData | null,
    configureConfig: ConfigurePopupConfig
): ErrorLog[] {
    if (!storageData)
        return []
    if (configureConfig.includeAllTabs)
        return storageData.errors
    if (configureConfig.selectedTabIds.length === 0)
        return []
    return storageData.errors.filter((error) =>
        configureConfig.selectedTabIds.some((id) => id === error.tabInfo.id)
    )
    }
}
