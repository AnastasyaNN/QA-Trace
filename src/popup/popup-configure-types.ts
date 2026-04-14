export type ConfigurePopupMode = 'steps' | 'full' | 'document';

export interface ConfigurePopupConfig {
    mode: ConfigurePopupMode,
    actionsCount: number,
    timeWindowMinutes: number,
    includeAllTabs: boolean,
    selectedTabIds: Array<number | string>
}

export interface FilteredDataForConfigure {
    actions: import('../lib/types').UserAction[],
    errors: import('../lib/types').ErrorLog[],
    limitedActions: import('../lib/types').UserAction[],
    limitedErrors: import('../lib/types').ErrorLog[]
}
