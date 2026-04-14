import {ExtensionConfiguration, StorageData} from "../lib/types";
import {DEFAULT_CONFIGURATION} from "../lib/integrations";
import {ConfigurePopupConfig} from "./popup-configure-types";
import {TrackedTab} from "./popup-tab-scope";

export interface PopupContext {
    storageData: StorageData | null,
    configuration: ExtensionConfiguration,

    configurePopupInitialized: boolean,
    configureCurrentTabId: number,
    configureConfig: ConfigurePopupConfig,
    previousTabScope: { includeAllTabs: boolean, selectedTabIds: Array<number | string> } | null,
    trackedTabs: TrackedTab[],
    expectedErrors: Set<string>,
    allErrorsExpected: boolean,
    userDefinedError: string,

    generatedPrompt: string,
    generatedSystemPrompt: string,
    systemPromptForTextarea: string,

    passphraseModalResolve: ((value: string | null) => void) | null,
}

type PopupElementId = 'clearData' | 'configure' | 'getPrompt' | 'errorsList'
    | 'userActionsCount' | 'errorsCount'
    | 'sendToLLM' | 'triggerWebhook' | 'responseSection' | 'responseError' | 'responseSuccess'
    | 'configurationError' | 'responseFields'
    | 'passphraseModal' | 'passphraseModalInput' | 'passphraseModalPurpose' | 'passphraseModalOk' | 'passphraseModalCancel'
    | 'mainView' | 'configureView' | 'promptConfirmationView'
    | 'userErrorDescription' | 'actionsList' | 'actionsCount' | 'timeWindowMinutes' | 'storageStatus'
    | 'availableActionsBadge' | 'tabsCountBadge' | 'includeAllTabs' | 'tabScopeList' | 'allErrorsExpected'
    | 'filteredErrorsContainer' | 'backToMain' | 'generateBtn' | 'configureViewActions' | 'backToConfigure' | 'copyPrompt'
    | 'copyResponseSummary' | 'copyResponseDescription' | 'responseSummary' | 'responseDescription'
    | 'stepsConfigSection' | 'fullConfigSection'
    | 'expectedErrorsSection' | 'unexpectedBehaviorSection' | 'tabScopeContainer' | 'tabScopeEmpty' | 'dataScopeSection'
    | 'selectedCount' | 'configPreview' | 'promptTextarea'
    | 'latestResponseSection' | 'latestResponseSummary' | 'latestResponseDescription'
    | 'copyLatestSummary' | 'copyLatestDescription'
    | 'extVersion'

export class PopupDOM {
    static createPopupContext(): PopupContext {
        return {
            storageData: null,
            configuration: DEFAULT_CONFIGURATION,
            configurePopupInitialized: false,
            configureCurrentTabId: 0,
            configureConfig: {
                mode: 'steps',
                actionsCount: 50,
                timeWindowMinutes: 90,
                includeAllTabs: false,
                selectedTabIds: []
            },
            previousTabScope: null,
            trackedTabs: [],
            expectedErrors: new Set(),
            allErrorsExpected: false,
            userDefinedError: '',
            generatedPrompt: '',
            generatedSystemPrompt: '',
            systemPromptForTextarea: '',
            passphraseModalResolve: null,
        }
    }

    static getHtmlElement(element: PopupElementId): HTMLElement | null {
        return document.getElementById(element)
    }

    static showConfigureError(message: string): void {
        const configurationError = PopupDOM.getHtmlElement('configurationError')
        if (configurationError) {
            configurationError.style.display = 'block'
            configurationError.textContent = message
        }
    }
}
