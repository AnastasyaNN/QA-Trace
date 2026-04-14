import * as browser from "webextension-polyfill";
import {ErrorLog, ExtensionConfiguration, TabInfo, UserAction} from "../lib/types";
import {PopupContext, PopupDOM} from "./popup-context";
import {PromptConfirmation} from "./popup-prompt-confirmation";
import {PopupNavigation} from "./popup-navigation";
import {TabScope} from "./popup-tab-scope";
import {PopupRenderer} from "./popup-render";
import {PromptBuilder} from "./popup-prompt-build";
import {ConfigurePopupConfig, FilteredDataForConfigure} from "./popup-configure-types.ts";
import {PopupLanguage} from "./popup-language.ts";
import {PopupFormat} from "./popup-format.ts";
import {DataFilter} from "./popup-data-filter";

export interface ConfigureViewDeps {
    loadData: () => Promise<void>,
    showConfigureView: () => Promise<void>,
    copyToClipboard: (text: string) => Promise<void>,
}

export class ConfigureView {
    static async initializeConfigureView(ctx: PopupContext, deps: ConfigureViewDeps): Promise<void> {
        try {
            const userErrorTextarea = PopupDOM.getHtmlElement('userErrorDescription') as HTMLTextAreaElement

            await ConfigureView.setConfigureCurrentTabId(ctx)
            ctx.trackedTabs = await TabScope.buildTrackedTabsListFromStorage(ctx.storageData)
            TabScope.ensureDefaultTabSelection(ctx.configureConfig, ctx.trackedTabs, ctx.configureCurrentTabId)

            ConfigureView.updateConfigureStorageStatus(ctx)

            ConfigureView.setupConfigureEventListeners(ctx, deps)
            if (userErrorTextarea)
                userErrorTextarea.value = ctx.userDefinedError

            ConfigureView.initializeConfigureDefaults(ctx)

            ConfigureView.renderTabScopeList(ctx)
            ConfigureView.setTabScopeVisibility(ctx)

            ConfigureView.updateConfigureUI(ctx)
            ConfigureView.updateConfigurePreview(ctx)
            ConfigureView.renderExpectedErrors(ctx)
            ConfigureView.updateActionsCountLimits(ctx)

            ConfigureView.updateGenerateButtonState(ctx)

            ctx.configurePopupInitialized = true
        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_initialize_configure_view'))
        }
    }

    static async refreshConfigureViewState(ctx: PopupContext, loadData: () => Promise<void>): Promise<void> {
        await loadData()
        await ConfigureView.setConfigureCurrentTabId(ctx)
        ctx.trackedTabs = await TabScope.buildTrackedTabsListFromStorage(ctx.storageData)
        TabScope.reconcileSelectedTabScope(ctx.configureConfig, ctx.trackedTabs, ctx.configureCurrentTabId)
        ConfigureView.updateConfigureStorageStatus(ctx)
        ConfigureView.renderTabScopeList(ctx)
        ConfigureView.setTabScopeVisibility(ctx)
        ConfigureView.updateActionsCountLimits(ctx)
        ConfigureView.updateConfigurePreview(ctx)
        ConfigureView.renderExpectedErrors(ctx)
        ConfigureView.updateGenerateButtonState(ctx)
    }

    private static selectConfigureMode(ctx: PopupContext, mode: 'steps' | 'full' | 'document'): void {
        if (ctx.configureConfig.mode !== mode) {
            if (mode === 'full') {
                ctx.previousTabScope = {
                    includeAllTabs: ctx.configureConfig.includeAllTabs,
                    selectedTabIds: [...ctx.configureConfig.selectedTabIds],
                }
                ctx.configureConfig.includeAllTabs = true
            } else if ((mode === 'steps' || mode === 'document') && ctx.previousTabScope) {
                ctx.configureConfig.includeAllTabs = ctx.previousTabScope.includeAllTabs
                ctx.configureConfig.selectedTabIds = [...ctx.previousTabScope.selectedTabIds]
            }
        }

        ctx.configureConfig.mode = mode

        const selectedOption = document.querySelector(`[data-mode="${mode}"]`) as HTMLElement
        const stepsConfigSection = PopupDOM.getHtmlElement('stepsConfigSection')
        const fullConfigSection = PopupDOM.getHtmlElement('fullConfigSection')
        const actionsCountInput = PopupDOM.getHtmlElement('actionsCount') as HTMLInputElement
        const timeWindowInput = PopupDOM.getHtmlElement('timeWindowMinutes') as HTMLInputElement
        const includeAllTabsCheckbox = PopupDOM.getHtmlElement('includeAllTabs') as HTMLInputElement

        document.querySelectorAll('.radio-option').forEach((option: Element) => {
            (option as HTMLElement).classList.remove('selected')
            const radioInput = option.querySelector('.radio-input') as HTMLInputElement
            if (radioInput)
                radioInput.checked = (option as HTMLElement & { dataset: { mode: string } }).dataset.mode === mode
        })

        if (selectedOption)
            selectedOption.classList.add('selected')

        if (stepsConfigSection)
            stepsConfigSection.style.display = mode === 'steps' || mode === 'document' ? 'block' : 'none'
        if (fullConfigSection)
            fullConfigSection.style.display = mode === 'full' ? 'block' : 'none'

        if (ctx.storageData) {
            const totalActions = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
            if (mode === 'steps' || mode === 'document')
                ctx.configureConfig.actionsCount = Math.min(50, totalActions)
            else
                ctx.configureConfig.timeWindowMinutes = ctx.configureConfig.timeWindowMinutes || 90

            if (actionsCountInput) {
                actionsCountInput.value = ctx.configureConfig.actionsCount.toString()
                ConfigureView.updateSelectedCount(ctx)
            }
            if (timeWindowInput)
                timeWindowInput.value = ctx.configureConfig.timeWindowMinutes.toString()
        }

        if (includeAllTabsCheckbox) {
            includeAllTabsCheckbox.checked = ctx.configureConfig.includeAllTabs
            includeAllTabsCheckbox.disabled = mode === 'full'
        }

        ConfigureView.updateConfigurePreview(ctx)
        ConfigureView.renderExpectedErrors(ctx)
        ConfigureView.updateGenerateButtonState(ctx)
        ConfigureView.updateActionsCountLimits(ctx)
        ConfigureView.setTabScopeVisibility(ctx)
        ConfigureView.updateModeSpecificVisibility(ctx)
    }

    private static updateConfigureUI(ctx: PopupContext): void {
        ConfigureView.selectConfigureMode(ctx, ctx.configureConfig.mode)

        const includeAllTabsCheckbox = PopupDOM.getHtmlElement('includeAllTabs') as HTMLInputElement
        if (includeAllTabsCheckbox)
            includeAllTabsCheckbox.checked = ctx.configureConfig.includeAllTabs
        ConfigureView.updateModeSpecificVisibility(ctx)
    }

    private static initializeConfigureDefaults(ctx: PopupContext): void {
        if (!ctx.storageData)
            return
        const totalActions = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
        const actionsCountInput = PopupDOM.getHtmlElement('actionsCount') as HTMLInputElement
        const timeWindowInput = PopupDOM.getHtmlElement('timeWindowMinutes') as HTMLInputElement

        if (ctx.configureConfig.mode === 'steps' || ctx.configureConfig.mode === 'document')
            ctx.configureConfig.actionsCount = Math.min(50, totalActions)
        else
            ctx.configureConfig.timeWindowMinutes = ctx.configureConfig.timeWindowMinutes || 90

        if (actionsCountInput) {
            actionsCountInput.value = ctx.configureConfig.actionsCount.toString()
            actionsCountInput.max = totalActions.toString()
        }
        if (timeWindowInput)
            timeWindowInput.value = ctx.configureConfig.timeWindowMinutes.toString()

        ConfigureView.updateSelectedCount(ctx)
    }

    private static updateConfigureStorageStatus(ctx: PopupContext): void {
        const statusElement = PopupDOM.getHtmlElement('storageStatus')
        if (!statusElement || !ctx.storageData)
            return

        const uniqueTabs = new Set(ctx.storageData.userActions.map(action => action.tabInfo.id))
        const tabsCount = uniqueTabs.size
        const actionsCount = ctx.storageData.userActions.length
        const errorsCount = ctx.storageData.errors.length
        const availableActionsBadge = PopupDOM.getHtmlElement('availableActionsBadge')
        const tabsCountBadge = PopupDOM.getHtmlElement('tabsCountBadge')

        statusElement.textContent =
            `${browser.i18n.getMessage('popup_default_storage')} | ` +
            `${browser.i18n.getMessage('popup_tabs_count', tabsCount.toString())} | ` +
            `${browser.i18n.getMessage('popup_actions_count', actionsCount.toString())} | ` +
            `${browser.i18n.getMessage('popup_errors_count', errorsCount.toString())}`

        if (availableActionsBadge)
            availableActionsBadge.textContent = browser.i18n.getMessage('popup_available_actions', actionsCount.toString())

        if (tabsCountBadge)
            tabsCountBadge.textContent = browser.i18n.getMessage('popup_tabs_count', tabsCount.toString())
    }

    private static async setConfigureCurrentTabId(ctx: PopupContext): Promise<void> {
        const [tab] = await browser.tabs?.query({active: true, currentWindow: true})
        if (tab?.id) {
            ctx.configureCurrentTabId = tab.id
        } else {
            ctx.configureCurrentTabId = 0
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_no_active_tabs'))
        }
    }

    private static updateSelectedCount(ctx: PopupContext): void {
        const selectedCountElement = PopupDOM.getHtmlElement('selectedCount')
        if (selectedCountElement && ctx.storageData) {
            if (ctx.configureConfig.mode === 'full') {
                selectedCountElement.textContent =
                    browser.i18n.getMessage('popup_time_window_selected', ctx.configureConfig.timeWindowMinutes.toString()) ||
                    `${ctx.configureConfig.timeWindowMinutes} minutes`
            } else {
                const totalActions = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
                selectedCountElement.textContent =
                    browser.i18n.getMessage('popup_actions_count', ctx.configureConfig.actionsCount.toString()) +
                    (ctx.configureConfig.actionsCount > totalActions ? browser.i18n.getMessage('popup_limited') : '')
            }
        }
    }

    private static updateConfigurePreview(ctx: PopupContext): void {
        const previewElement = PopupDOM.getHtmlElement('configPreview')
        if (!previewElement || !ctx.storageData)
            return

        const filteredData = DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
        previewElement.textContent = ConfigureView.buildConfigurePreviewText(
            ctx.configureConfig,
            filteredData,
            ctx.configuration,
            ctx.userDefinedError
        )
    }

    private static renderExpectedErrors(ctx: PopupContext): void {
        const container = PopupDOM.getHtmlElement('filteredErrorsContainer')
        const allErrorsCheckbox = PopupDOM.getHtmlElement('allErrorsExpected') as HTMLInputElement
        const expectedSection = PopupDOM.getHtmlElement('expectedErrorsSection')

        if (!container)
            return

        if (ctx.configureConfig.mode === 'full' || ctx.configureConfig.mode === 'document') {
            container.style.display = 'none'
            if (expectedSection)
                expectedSection.style.display = 'none'
            return
        }
        container.style.display = 'block'
        if (expectedSection)
            expectedSection.style.display = 'block'

        const filteredData = DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
        const errorsForView = ctx.configureConfig.mode === 'steps'
            ? filteredData.limitedErrors
            : filteredData.errors

        if (allErrorsCheckbox)
            allErrorsCheckbox.checked = ctx.allErrorsExpected

        container.replaceChildren(PopupRenderer.buildExpectedErrorsList(
            errorsForView,
            ctx.expectedErrors,
            ctx.allErrorsExpected
        ))
    }

    private static updateGenerateButtonState(ctx: PopupContext): void {
        const generateBtn = PopupDOM.getHtmlElement('generateBtn') as HTMLButtonElement
        const configureActions = PopupDOM.getHtmlElement('configureViewActions')
        if (!generateBtn)
            return
        if (!ctx.storageData) {
            generateBtn.style.display = 'none'
            generateBtn.disabled = true
            configureActions?.classList.add('actions-single')
            return
        }
        const filtered = DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
        const effectiveCount =
            ctx.configureConfig.mode === 'full' ? filtered.actions.length : filtered.limitedActions.length
        const canGenerate = effectiveCount > 0
        generateBtn.style.display = canGenerate ? '' : 'none'
        generateBtn.disabled = false
        configureActions?.classList.toggle('actions-single', !canGenerate)
    }

    private static updateActionsCountLimits(ctx: PopupContext): void {
        if (ctx.configureConfig.mode === 'full') {
            ConfigureView.updateAvailableActionsBadge(ctx)
            return
        }
        const actionsCountInput = PopupDOM.getHtmlElement('actionsCount') as HTMLInputElement
        if (!actionsCountInput || !ctx.storageData)
            return
        const availableActions = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
        actionsCountInput.max = availableActions.toString()
        if (ctx.configureConfig.actionsCount > availableActions) {
            ctx.configureConfig.actionsCount = availableActions
            actionsCountInput.value = availableActions.toString()
        }
        ConfigureView.updateSelectedCount(ctx)
        ConfigureView.updateAvailableActionsBadge(ctx)
    }

    private static updateAvailableActionsBadge(ctx: PopupContext): void {
        const badge = PopupDOM.getHtmlElement('availableActionsBadge')
        if (!badge)
            return
        const count = ctx.configureConfig.mode === 'full'
            ? DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig).actions.length
            : DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
        const localized = browser.i18n.getMessage('popup_available_actions', count.toString())
        badge.textContent = localized || `${count} available`
    }

    private static renderTabScopeList(ctx: PopupContext): void {
        const list = PopupDOM.getHtmlElement('tabScopeList')
        const empty = PopupDOM.getHtmlElement('tabScopeEmpty')
        if (!list || !empty) return

        if (ctx.trackedTabs.length === 0) {
            list.replaceChildren()
            empty.style.display = 'block'
            return
        }
        empty.style.display = 'none'

        list.replaceChildren(PopupRenderer.buildTabScopeList(
            ctx.trackedTabs,
            ctx.configureConfig.selectedTabIds
        ))
    }

    private static setTabScopeVisibility(ctx: PopupContext): void {
        const container = PopupDOM.getHtmlElement('tabScopeContainer')
        const inputs = document.querySelectorAll('.tab-scope-checkbox')
        if (!container)
            return
        if (ctx.configureConfig.mode === 'full' || ctx.configureConfig.includeAllTabs) {
            container.style.display = 'none'
            inputs.forEach(el => (el as HTMLInputElement).disabled = true)
        } else {
            container.style.display = 'block'
            inputs.forEach(el => (el as HTMLInputElement).disabled = false)
        }
    }

    private static generateConfigurePrompt(ctx: PopupContext): void {
        if (!ctx.storageData) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_no_storage_data'))
            return
        }

        try {
            const filteredData = DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
            const actionsForMode = ctx.configureConfig.mode === 'full'
                ? filteredData.actions
                : filteredData.limitedActions
            const errorsForMode = DataFilter.getEffectiveErrors(
                filteredData,
                ctx.configureConfig.mode,
                ctx.expectedErrors,
                ctx.allErrorsExpected
            )
            const userDefinedError = ctx.configureConfig.mode === 'steps'
                ? ConfigureView.buildUserDefinedError(ctx)
                : null
            const combinedErrors = userDefinedError
                ? [...errorsForMode, userDefinedError]
                : errorsForMode
            const responseSection = PopupDOM.getHtmlElement('responseSection')
            const responseSummary = PopupDOM.getHtmlElement('responseSummary') as HTMLInputElement
            const responseDescription = PopupDOM.getHtmlElement('responseDescription') as HTMLTextAreaElement
            const responseSuccess = PopupDOM.getHtmlElement('responseSuccess')
            const sendButton = PopupDOM.getHtmlElement('sendToLLM') as HTMLButtonElement
            const webhookButton = PopupDOM.getHtmlElement('triggerWebhook') as HTMLButtonElement

            let prompt = ''
            let systemPrompt = ''
            let systemPromptForTextarea = ''

            if (actionsForMode.length === 0) {
                PopupDOM.showConfigureError(browser.i18n.getMessage('popup_no_actions'))
                return
            }

            if (ctx.configureConfig.mode === 'document') {
                prompt = PromptBuilder.buildDocumentationUserPrompt(actionsForMode, ctx.configuration)
                systemPrompt = PromptBuilder.buildSystemPromptForDocumentation(ctx.configuration)
                systemPromptForTextarea = PromptBuilder.buildSystemPromptForDocumentation(ctx.configuration, true)
            } else if (ctx.configureConfig.mode === 'steps') {
                prompt = PromptBuilder.buildErrorStepsUserPrompt(actionsForMode, combinedErrors, ctx.configuration)
                systemPrompt = PromptBuilder.buildSystemPromptForError(ctx.configuration)
                systemPromptForTextarea = PromptBuilder.buildSystemPromptForError(ctx.configuration, true)
            } else {
                prompt = PromptBuilder.buildReportUserPrompt(actionsForMode, combinedErrors, ctx.configuration)
                systemPrompt = PromptBuilder.buildSystemPromptForReport(ctx.configuration)
                systemPromptForTextarea = PromptBuilder.buildSystemPromptForReport(ctx.configuration, true)
            }

            ctx.generatedPrompt = prompt
            ctx.generatedSystemPrompt = systemPrompt
            ctx.systemPromptForTextarea = systemPromptForTextarea
            PopupNavigation.showPromptConfirmationViewDOM(ctx)

            PromptConfirmation.applyPromptTextareaValue(ctx, prompt)

            if (responseSection)
                responseSection.style.display = 'none'
            PromptConfirmation.resetResponseMessages()
            PromptConfirmation.setLLMResponseVisibility(true)
            if (responseSummary)
                responseSummary.value = ''
            if (responseDescription)
                responseDescription.value = ''
            if (responseSuccess)
                responseSuccess.textContent = ''

            if (sendButton)
                sendButton.disabled = !PromptConfirmation.hasLLMCredentials(ctx)
            if (webhookButton)
                webhookButton.disabled = !PromptConfirmation.hasWebhookConfiguration(ctx)

        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_generate_prompt'))
        }
    }

    private static buildConfigurePreviewText(
        configureConfig: ConfigurePopupConfig,
        filteredData: FilteredDataForConfigure,
        configuration: ExtensionConfiguration,
        userDefinedError: string
    ): string {
        const totalActions = filteredData.actions.length
        const totalTabs = new Set(filteredData.actions.map((action: UserAction) => action.tabInfo.id)).size
        const languageName = PopupLanguage.getResolvedLanguageCode(configuration) === 'ru' ? 'Русский' : 'English'

        let previewText = ''

        const modeTitleKey =
            configureConfig.mode === 'full'
                ? 'popup_mode_full_title'
                : configureConfig.mode === 'document'
                    ? 'popup_mode_document_title'
                    : 'popup_mode_steps_title'
        previewText = `📋 ${browser.i18n.getMessage(modeTitleKey)}\n\n`

        if (configureConfig.mode === 'steps') {
            previewText += browser.i18n.getMessage('popup_configuration_preview_actions', configureConfig.actionsCount.toString())
        } else if (configureConfig.mode === 'document') {
            previewText += browser.i18n.getMessage('popup_configuration_preview_document', configureConfig.actionsCount.toString())
        } else {
            previewText += browser.i18n.getMessage('popup_configuration_preview_full_report')
            previewText += `\n⏱️ ${browser.i18n.getMessage('popup_configuration_preview_time_window', configureConfig.timeWindowMinutes.toString())}`
            if (filteredData.actions.length) {
                const newest = Math.max(...filteredData.actions.map(a => a.timestamp))
                const oldest = Math.min(...filteredData.actions.map(a => a.timestamp))
                previewText += `\n🕰️ ${browser.i18n.getMessage('popup_configuration_preview_time_range', [PopupFormat.formatTime(oldest, true), PopupFormat.formatTime(newest, true)])}`
                if (PopupFormat.hasInactivityBreaks(filteredData.actions))
                    previewText += `\n⏸️ ${browser.i18n.getMessage('popup_configuration_preview_inactivity')}`
            }
        }

        const selectedTabs = configureConfig.mode === 'full' || configureConfig.includeAllTabs
            ? browser.i18n.getMessage('popup_configuration_preview_all_tabs', totalTabs.toString())
            : browser.i18n.getMessage('popup_tabs_count', configureConfig.selectedTabIds.length.toString() || '0')
        previewText += `\n📊 ${browser.i18n.getMessage('popup_configuration_preview_data_scope', [selectedTabs, totalActions.toString()])}`

        previewText += `\n🌐 ${browser.i18n.getMessage('popup_configuration_preview_language', languageName)}`

        if (configureConfig.mode === 'steps' && userDefinedError.trim())
            previewText += `\n⚠️ ${browser.i18n.getMessage('popup_configuration_preview_user_defined_error')}`

        return previewText
    }

    private static setupConfigureEventListeners(ctx: PopupContext, deps: ConfigureViewDeps): void {
        document.querySelectorAll('.radio-option').forEach((option: Element) => {
            option.addEventListener('click', (event) => {
                const target = event.currentTarget as HTMLElement
                const mode = (target as HTMLElement & {
                    dataset: { mode: 'steps' | 'full' | 'document' }
                }).dataset.mode
                ConfigureView.selectConfigureMode(ctx, mode)
            })
        })

        const actionsCountInput = PopupDOM.getHtmlElement('actionsCount') as HTMLInputElement
        const timeWindowInput = PopupDOM.getHtmlElement('timeWindowMinutes') as HTMLInputElement
        const includeAllTabsCheckbox = PopupDOM.getHtmlElement('includeAllTabs') as HTMLInputElement
        const tabScopeList = PopupDOM.getHtmlElement('tabScopeList')
        const allErrorsExpectedCheckbox = PopupDOM.getHtmlElement('allErrorsExpected') as HTMLInputElement
        const filteredErrorsContainer = PopupDOM.getHtmlElement('filteredErrorsContainer')
        const userErrorTextarea = PopupDOM.getHtmlElement('userErrorDescription') as HTMLTextAreaElement
        const backBtn = PopupDOM.getHtmlElement('backToMain')
        const generateBtn = PopupDOM.getHtmlElement('generateBtn')
        const backToConfigureBtn = PopupDOM.getHtmlElement('backToConfigure')
        const sendToLLMBtn = PopupDOM.getHtmlElement('sendToLLM')
        const triggerWebhookBtn = PopupDOM.getHtmlElement('triggerWebhook')
        const copyPromptBtn = PopupDOM.getHtmlElement('copyPrompt')
        const copyResponseSummaryBtn = PopupDOM.getHtmlElement('copyResponseSummary')
        const copyResponseDescriptionBtn = PopupDOM.getHtmlElement('copyResponseDescription')

        if (actionsCountInput)
            actionsCountInput.addEventListener('input', () => {
                ctx.configureConfig.actionsCount = parseInt(actionsCountInput.value) || 0
                ConfigureView.updateSelectedCount(ctx)
                ConfigureView.updateConfigurePreview(ctx)
                ConfigureView.renderExpectedErrors(ctx)
                ConfigureView.updateGenerateButtonState(ctx)
            })

        if (timeWindowInput)
            timeWindowInput.addEventListener('input', () => {
                ctx.configureConfig.timeWindowMinutes = parseInt(timeWindowInput.value) || ctx.configureConfig.timeWindowMinutes
                ConfigureView.updateSelectedCount(ctx)
                ConfigureView.updateConfigurePreview(ctx)
                ConfigureView.updateGenerateButtonState(ctx)
            })

        if (includeAllTabsCheckbox)
            includeAllTabsCheckbox.addEventListener('change', () => {
                ctx.configureConfig.includeAllTabs = includeAllTabsCheckbox.checked
                ConfigureView.setTabScopeVisibility(ctx)
                ConfigureView.updateActionsCountLimits(ctx)
                ConfigureView.updateConfigurePreview(ctx)
                ConfigureView.updateGenerateButtonState(ctx)
                ConfigureView.renderExpectedErrors(ctx)
                ConfigureView.updateSelectedCount(ctx)
            })

        tabScopeList?.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement
            if (target.classList.contains('tab-scope-checkbox')) {
                const tabId = target.dataset.tabId
                if (!tabId)
                    return
                const parsedId = TabScope.parseTabId(tabId)
                if (target.checked && !ctx.configureConfig.selectedTabIds.find(id => id === parsedId)) {
                    ctx.configureConfig.selectedTabIds.push(parsedId)
                } else {
                    ctx.configureConfig.selectedTabIds = ctx.configureConfig.selectedTabIds.filter(id => id !== parsedId)
                }
                ConfigureView.updateActionsCountLimits(ctx)
                ConfigureView.updateConfigurePreview(ctx)
                ConfigureView.renderExpectedErrors(ctx)
                ConfigureView.updateGenerateButtonState(ctx)
                ConfigureView.updateSelectedCount(ctx)
            }
        })

        if (allErrorsExpectedCheckbox)
            allErrorsExpectedCheckbox.addEventListener('change', () => {
                ctx.allErrorsExpected = allErrorsExpectedCheckbox.checked
                ConfigureView.renderExpectedErrors(ctx)
            })

        filteredErrorsContainer?.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement
            if (target.classList.contains('expected-error-checkbox')) {
                if (target.checked) {
                    ctx.expectedErrors.add(target.value)
                } else {
                    ctx.expectedErrors.delete(target.value)
                }
            }
        })

        if (userErrorTextarea) {
            userErrorTextarea.addEventListener('input', () => {
                ctx.userDefinedError = userErrorTextarea.value
                ConfigureView.updateConfigurePreview(ctx)
            })
            userErrorTextarea.addEventListener('paste', (event: ClipboardEvent) => {
                const text = event.clipboardData?.getData('text/plain')
                if (!text)
                    return
                event.preventDefault()
                const start = userErrorTextarea.selectionStart ?? userErrorTextarea.value.length
                const end = userErrorTextarea.selectionEnd ?? start
                const value = userErrorTextarea.value
                userErrorTextarea.value = value.slice(0, start) + text + value.slice(end)
                const caretPos = start + text.length
                userErrorTextarea.setSelectionRange(caretPos, caretPos)
                userErrorTextarea.dispatchEvent(new Event('input', {bubbles: true}))
            })
        }

        if (backBtn)
            backBtn.addEventListener('click', () => PopupNavigation.showMainViewDOM())

        if (generateBtn)
            generateBtn.addEventListener('click', () => {
                ConfigureView.generateConfigurePrompt(ctx)
            })

        if (backToConfigureBtn)
            backToConfigureBtn.addEventListener('click', async () => {
                await deps.showConfigureView()
            })

        if (sendToLLMBtn)
            sendToLLMBtn.addEventListener('click', async () => {
                await PromptConfirmation.sendPromptToLLM(ctx)
            })

        if (triggerWebhookBtn)
            triggerWebhookBtn.addEventListener('click', async () => {
                await PromptConfirmation.triggerWebhook(ctx)
            })

        if (copyPromptBtn)
            copyPromptBtn.addEventListener('click', async () => {
                if (!PopupDOM.getHtmlElement('promptTextarea'))
                    return
                await deps.copyToClipboard(PromptConfirmation.getFullPromptPlainText(ctx))
            })

        if (copyResponseSummaryBtn)
            copyResponseSummaryBtn.addEventListener('click', async () => {
                const responseSummary = PopupDOM.getHtmlElement('responseSummary') as HTMLInputElement
                if (responseSummary)
                    await deps.copyToClipboard(responseSummary.value)
            })

        if (copyResponseDescriptionBtn)
            copyResponseDescriptionBtn.addEventListener('click', async () => {
                const responseDescription = PopupDOM.getHtmlElement('responseDescription') as HTMLTextAreaElement
                if (responseDescription)
                    await deps.copyToClipboard(responseDescription.value)
            })
    }

    private static updateModeSpecificVisibility(ctx: PopupContext): void {
        const expectedErrorsSection = PopupDOM.getHtmlElement('expectedErrorsSection')
        const unexpectedSection = PopupDOM.getHtmlElement('unexpectedBehaviorSection')
        const includeAllTabsCheckbox = PopupDOM.getHtmlElement('includeAllTabs') as HTMLInputElement
        const tabScopeContainer = PopupDOM.getHtmlElement('tabScopeContainer')
        const fullConfigSection = PopupDOM.getHtmlElement('fullConfigSection')
        const stepsConfigSection = PopupDOM.getHtmlElement('stepsConfigSection')
        const dataScopeSection = PopupDOM.getHtmlElement('dataScopeSection')

        if (expectedErrorsSection)
            expectedErrorsSection.style.display = ctx.configureConfig.mode === 'steps' ? 'block' : 'none'
        if (unexpectedSection)
            unexpectedSection.style.display = ctx.configureConfig.mode === 'steps' ? 'block' : 'none'
        if (includeAllTabsCheckbox) {
            includeAllTabsCheckbox.disabled = ctx.configureConfig.mode === 'full'
            includeAllTabsCheckbox.checked = ctx.configureConfig.mode === 'full' ? true : ctx.configureConfig.includeAllTabs
        }
        if (tabScopeContainer)
            tabScopeContainer.style.display = ctx.configureConfig.mode === 'full' ? 'none' : 'block'
        if (dataScopeSection)
            dataScopeSection.style.display = ctx.configureConfig.mode === 'full' ? 'none' : 'block'
        if (fullConfigSection)
            fullConfigSection.style.display = ctx.configureConfig.mode === 'full' ? 'block' : 'none'
        if (stepsConfigSection)
            stepsConfigSection.style.display =
                ctx.configureConfig.mode === 'steps' || ctx.configureConfig.mode === 'document' ? 'block' : 'none'
    }

    private static getUserDefinedError(ctx: PopupContext): string {
        return ctx.userDefinedError.trim()
    }

    private static getTabInfoForUserDefinedError(ctx: PopupContext): TabInfo {
        const scopedAction = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig)[0]

        return {
            id: scopedAction?.tabInfo?.id ?? ctx.configureCurrentTabId ?? 'unknown',
            url: scopedAction?.tabInfo?.url,
            title: scopedAction?.tabInfo?.title
        }
    }

    private static buildUserDefinedError(ctx: PopupContext): ErrorLog | null {
        return PromptBuilder.buildUserDefinedErrorLog(ConfigureView.getUserDefinedError(ctx), ConfigureView.getTabInfoForUserDefinedError(ctx))
    }
}
