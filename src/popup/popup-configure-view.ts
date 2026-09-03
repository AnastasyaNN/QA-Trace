import * as browser from "webextension-polyfill";
import {ErrorLog, ExtensionConfiguration, TabInfo, UserAction} from "../lib/types";
import {PopupContext, PopupDOM, PopupElementId} from "./popup-context";
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

const MODE_SECTIONS: Record<'steps' | 'document' | 'full', PopupElementId[]> = {
    steps: ['modeConfigSection', 'dataScopeSection', 'stepsConfigSection', 'expectedErrorsSection', 'unexpectedBehaviorSection', 'reviewSection'],
    document: ['modeConfigSection', 'dataScopeSection', 'stepsConfigSection', 'reviewSection'],
    full: ['modeConfigSection', 'fullConfigSection', 'reviewSection'],
}

const ALL_CONFIG_SECTIONS: PopupElementId[] = [
    'modeConfigSection', 'dataScopeSection', 'stepsConfigSection', 'fullConfigSection',
    'expectedErrorsSection', 'unexpectedBehaviorSection', 'reviewSection',
]

export class ConfigureView {
    static async initializeConfigureView(ctx: PopupContext, deps: ConfigureViewDeps): Promise<void> {
        try {
            const userErrorTextarea = PopupDOM.getHtmlElement('userErrorDescription') as HTMLTextAreaElement

            await ConfigureView.setConfigureCurrentTabId(ctx)
            ctx.trackedTabs = await TabScope.buildTrackedTabsListFromStorage(ctx.storageData)
            TabScope.ensureDefaultTabSelection(ctx.configureConfig, ctx.trackedTabs, ctx.configureCurrentTabId)
            ConfigureView.recomputeIncludeAllTabs(ctx)

            ConfigureView.setupConfigureEventListeners(ctx, deps)
            if (userErrorTextarea)
                userErrorTextarea.value = ctx.userDefinedError

            ConfigureView.initializeConfigureDefaults(ctx)

            ConfigureView.selectConfigureMode(ctx, ctx.configureConfig.mode)

            ctx.configurePopupInitialized = true
        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_initialize_configure_view'))
        }
    }

    static async refreshConfigureViewState(ctx: PopupContext, loadData: () => Promise<void>): Promise<void> {
        await loadData()
        await ConfigureView.setConfigureCurrentTabId(ctx)
        const wasAllTabs = ctx.configureConfig.includeAllTabs
        ctx.trackedTabs = await TabScope.buildTrackedTabsListFromStorage(ctx.storageData)
        if (wasAllTabs)
            ctx.configureConfig.selectedTabIds = ctx.trackedTabs.map(tab => tab.id ?? 'unknown')
        else
            TabScope.reconcileSelectedTabScope(ctx.configureConfig, ctx.trackedTabs, ctx.configureCurrentTabId)
        ConfigureView.recomputeIncludeAllTabs(ctx)
        ConfigureView.renderConfigureView(ctx)
    }

    private static selectConfigureMode(ctx: PopupContext, mode: 'steps' | 'full' | 'document'): void {
        const modeChanged = ctx.configureConfig.mode !== mode
        if (modeChanged) {
            if (mode === 'full') {
                ctx.previousTabScope = {
                    selectedTabIds: [...ctx.configureConfig.selectedTabIds],
                }
                ctx.configureConfig.includeAllTabs = true
            } else if ((mode === 'steps' || mode === 'document') && ctx.previousTabScope) {
                ctx.configureConfig.selectedTabIds = [...ctx.previousTabScope.selectedTabIds]
                ConfigureView.recomputeIncludeAllTabs(ctx)
            }
        }

        ctx.configureConfig.mode = mode

        const selectedOption = document.querySelector(`[data-mode="${mode}"]`) as HTMLElement
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

        if (modeChanged && ctx.storageData) {
            const totalActions = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
            if (mode === 'steps' || mode === 'document')
                ctx.configureConfig.actionsCount = ConfigureView.defaultActionsCount(totalActions)
            else
                ctx.configureConfig.timeWindowMinutes = ctx.configureConfig.timeWindowMinutes || 90
        }

        if (timeWindowInput)
            timeWindowInput.value = ctx.configureConfig.timeWindowMinutes.toString()

        if (includeAllTabsCheckbox) {
            includeAllTabsCheckbox.checked = ctx.configureConfig.includeAllTabs
            includeAllTabsCheckbox.disabled = mode === 'full'
        }

        ConfigureView.renderConfigureView(ctx)
    }

    private static initializeConfigureDefaults(ctx: PopupContext): void {
        if (!ctx.storageData)
            return
        const totalActions = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
        const timeWindowInput = PopupDOM.getHtmlElement('timeWindowMinutes') as HTMLInputElement

        if (ctx.configureConfig.mode === 'steps' || ctx.configureConfig.mode === 'document')
            ctx.configureConfig.actionsCount = ConfigureView.defaultActionsCount(totalActions)
        else
            ctx.configureConfig.timeWindowMinutes = ctx.configureConfig.timeWindowMinutes || 90

        if (timeWindowInput)
            timeWindowInput.value = ctx.configureConfig.timeWindowMinutes.toString()

        ConfigureView.updateActionsBadge(ctx)
    }

    private static defaultActionsCount(available: number): number {
        return Math.min(50, available)
    }

    private static updateTabsCountBadge(ctx: PopupContext): void {
        const tabsCountBadge = PopupDOM.getHtmlElement('tabsCountBadge')
        if (!tabsCountBadge || !ctx.storageData)
            return
        const tabsCount = new Set(ctx.storageData.userActions.map(action => action.tabInfo.id)).size
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

    private static updateActionsBadge(ctx: PopupContext, availableActions?: number): void {
        const badge = PopupDOM.getHtmlElement('availableActionsBadge')
        if (!badge || !ctx.storageData)
            return
        const available = availableActions ?? DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
        const selected = Math.min(ctx.configureConfig.actionsCount, available)
        badge.textContent = browser.i18n.getMessage('popup_actions_selected_count', [selected.toString(), available.toString()])
        const selectAllCheckbox = PopupDOM.getHtmlElement('selectAllActions') as HTMLInputElement
        if (selectAllCheckbox)
            selectAllCheckbox.checked = available > 0 && ctx.configureConfig.actionsCount >= available
    }

    private static updateConfigurePreview(ctx: PopupContext, filteredData?: FilteredDataForConfigure): void {
        const previewElement = PopupDOM.getHtmlElement('configPreview')
        if (!previewElement || !ctx.storageData)
            return

        const data = filteredData ?? DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
        previewElement.textContent = ConfigureView.buildConfigurePreviewText(
            ctx.configureConfig,
            data,
            ctx.configuration,
            ctx.userDefinedError
        )
    }

    private static renderExpectedErrors(ctx: PopupContext, filteredData?: FilteredDataForConfigure): void {
        const container = PopupDOM.getHtmlElement('filteredErrorsContainer')
        if (!container || ctx.configureConfig.mode !== 'steps')
            return

        const allErrorsCheckbox = PopupDOM.getHtmlElement('allErrorsExpected') as HTMLInputElement
        if (allErrorsCheckbox)
            allErrorsCheckbox.checked = ctx.allErrorsExpected

        const data = filteredData ?? DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
        container.replaceChildren(PopupRenderer.buildExpectedErrorsList(
            data.limitedErrors,
            ctx.expectedErrors,
            ctx.allErrorsExpected
        ))
    }

    private static updateGenerateButtonState(ctx: PopupContext, filteredData?: FilteredDataForConfigure): void {
        const generateBtn = PopupDOM.getHtmlElement('generateBtn') as HTMLButtonElement
        if (!generateBtn)
            return
        if (!ctx.storageData) {
            generateBtn.disabled = true
            return
        }
        const filtered = filteredData ?? DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
        const effectiveCount =
            ctx.configureConfig.mode === 'full' ? filtered.actions.length : filtered.limitedActions.length
        generateBtn.disabled = effectiveCount === 0
    }

    private static renderConfigureView(ctx: PopupContext): void {
        const visible = new Set(MODE_SECTIONS[ctx.configureConfig.mode])

        ALL_CONFIG_SECTIONS.forEach((id) => {
            const el = PopupDOM.getHtmlElement(id)
            if (el)
                el.style.display = visible.has(id) ? 'block' : 'none'
        })

        const scopedActions = ctx.storageData ? DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig) : []
        if (ctx.configureConfig.mode !== 'full' && ctx.storageData)
            ConfigureView.clampActionsCount(ctx, scopedActions.length)
        const filteredData = ctx.storageData ? DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig, scopedActions) : undefined

        if (visible.has('dataScopeSection')) {
            ConfigureView.renderTabScopeList(ctx)
            ConfigureView.updateTabsCountBadge(ctx)
            const includeAllTabsCheckbox = PopupDOM.getHtmlElement('includeAllTabs') as HTMLInputElement
            if (includeAllTabsCheckbox) {
                includeAllTabsCheckbox.checked = ctx.configureConfig.includeAllTabs
                const group = includeAllTabsCheckbox.closest('.checkbox-group') as HTMLElement | null
                if (group)
                    group.style.display = ctx.trackedTabs.length > 1 ? '' : 'none'
            }
        }
        if (visible.has('stepsConfigSection')) {
            const filterInput = PopupDOM.getHtmlElement('actionFilter') as HTMLInputElement
            if (filterInput)
                filterInput.value = ctx.actionFilter
            ConfigureView.renderActionPicker(ctx, scopedActions)
            ConfigureView.updateActionsBadge(ctx, scopedActions.length)
        }
        if (visible.has('expectedErrorsSection'))
            ConfigureView.renderExpectedErrors(ctx, filteredData)

        ConfigureView.updateConfigurePreview(ctx, filteredData)
        ConfigureView.updateGenerateButtonState(ctx, filteredData)
    }

    private static clampActionsCount(ctx: PopupContext, available: number): void {
        if (available <= 0)
            return
        if (ctx.configureConfig.actionsCount > available)
            ctx.configureConfig.actionsCount = available
        else if (ctx.configureConfig.actionsCount <= 0)
            ctx.configureConfig.actionsCount = ConfigureView.defaultActionsCount(available)
    }

    private static renderActionPicker(ctx: PopupContext, actions: UserAction[]): void {
        const list = PopupDOM.getHtmlElement('actionPickerList')
        if (!list)
            return
        const items = actions.map((action, index) => ({action, index}))
        list.replaceChildren(PopupRenderer.buildActionPickerList(items, browser.i18n.getMessage('popup_no_actions_detected')))
        ConfigureView.focusMatch(ConfigureView.applyActionHighlights(ctx, actions), 0, false)
    }

    private static applyActionHighlights(ctx: PopupContext, actions: UserAction[]): HTMLElement[] {
        const list = PopupDOM.getHtmlElement('actionPickerList')
        const matches: HTMLElement[] = []
        if (!list)
            return matches
        const includedCount = ctx.configureConfig.actionsCount
        const startIndex = Math.min(includedCount, actions.length) - 1
        const startLabel = browser.i18n.getMessage('popup_start_here')
        const search = ctx.actionFilter.trim().toLowerCase()
        list.querySelectorAll('.action-item').forEach((el) => {
            const item = el as HTMLElement
            const idx = parseInt(item.dataset.actionIndex ?? '-1')
            PopupRenderer.decorateActionPickerItem(item, idx > -1 && idx < includedCount, idx === startIndex, startLabel)
            const action = actions[idx]
            const isMatch = !!search && !!action && ConfigureView.actionMatchesSearch(action, search)
            item.classList.toggle('match', isMatch)
            if (isMatch)
                matches.push(item)
        })
        return matches
    }

    private static focusMatch(matches: HTMLElement[], index: number, scroll = true): void {
        const list = PopupDOM.getHtmlElement('actionPickerList')
        if (!list)
            return
        const countEl = PopupDOM.getHtmlElement('actionMatchCount')
        const prevBtn = PopupDOM.getHtmlElement('actionMatchPrev') as HTMLButtonElement
        const nextBtn = PopupDOM.getHtmlElement('actionMatchNext') as HTMLButtonElement

        list.querySelectorAll('.action-item.match-current').forEach(el => el.classList.remove('match-current'))
        if (prevBtn) prevBtn.disabled = matches.length === 0
        if (nextBtn) nextBtn.disabled = matches.length === 0

        if (matches.length === 0) {
            if (countEl) countEl.textContent = '0/0'
            return
        }
        const clamped = ((index % matches.length) + matches.length) % matches.length
        const current = matches[clamped]
        current.classList.add('match-current')
        if (countEl) countEl.textContent = `${clamped + 1}/${matches.length}`
        if (scroll)
            current.scrollIntoView({block: 'center'})
    }

    private static stepMatch(delta: number): void {
        const list = PopupDOM.getHtmlElement('actionPickerList')
        if (!list)
            return
        const matches = Array.from(list.querySelectorAll('.action-item.match')) as HTMLElement[]
        if (matches.length === 0)
            return
        const currentIdx = matches.findIndex(el => el.classList.contains('match-current'))
        ConfigureView.focusMatch(matches, (currentIdx === -1 ? 0 : currentIdx) + delta)
    }

    private static actionMatchesSearch(action: UserAction, search: string): boolean {
        return [action.type, action.element, ...PopupRenderer.actionDetailFields(action)]
            .join(' ')
            .toLowerCase()
            .includes(search)
    }

    private static applyActionsCount(ctx: PopupContext, count: number): void {
        ctx.configureConfig.actionsCount = count
        if (!ctx.storageData)
            return
        const list = PopupDOM.getHtmlElement('actionPickerList')
        const currentMatchIndex = list
            ? Array.from(list.querySelectorAll('.action-item.match')).findIndex(el => el.classList.contains('match-current'))
            : -1
        const filteredData = DataFilter.getFilteredDataForConfig(ctx.storageData, ctx.configureConfig)
        const matches = ConfigureView.applyActionHighlights(ctx, filteredData.actions)
        ConfigureView.focusMatch(matches, currentMatchIndex === -1 ? 0 : currentMatchIndex, false)
        ConfigureView.updateActionsBadge(ctx, filteredData.actions.length)
        ConfigureView.renderExpectedErrors(ctx, filteredData)
        ConfigureView.updateConfigurePreview(ctx, filteredData)
        ConfigureView.updateGenerateButtonState(ctx, filteredData)
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

    private static recomputeIncludeAllTabs(ctx: PopupContext): void {
        ctx.configureConfig.includeAllTabs = ctx.configureConfig.mode === 'full'
            || (ctx.trackedTabs.length > 1
                && TabScope.allTabsSelected(ctx.configureConfig.selectedTabIds, ctx.trackedTabs))
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
            previewText += browser.i18n.getMessage('popup_configuration_preview_actions', filteredData.limitedActions.length.toString())
        } else if (configureConfig.mode === 'document') {
            previewText += browser.i18n.getMessage('popup_configuration_preview_document', filteredData.limitedActions.length.toString())
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

        const actionPickerList = PopupDOM.getHtmlElement('actionPickerList')
        actionPickerList?.addEventListener('click', (event) => {
            const item = (event.target as HTMLElement).closest('.action-item') as HTMLElement | null
            if (!item || item.dataset.actionIndex === undefined)
                return
            ConfigureView.applyActionsCount(ctx, parseInt(item.dataset.actionIndex) + 1)
        })

        const actionFilterInput = PopupDOM.getHtmlElement('actionFilter') as HTMLInputElement
        actionFilterInput?.addEventListener('input', () => {
            ctx.actionFilter = actionFilterInput.value
            if (!ctx.storageData)
                return
            const actions = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig)
            ConfigureView.focusMatch(ConfigureView.applyActionHighlights(ctx, actions), 0)
        })
        actionFilterInput?.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter')
                return
            event.preventDefault()
            ConfigureView.stepMatch(event.shiftKey ? -1 : 1)
        })

        PopupDOM.getHtmlElement('actionMatchPrev')?.addEventListener('click', () => ConfigureView.stepMatch(-1))
        PopupDOM.getHtmlElement('actionMatchNext')?.addEventListener('click', () => ConfigureView.stepMatch(1))

        const selectAllActionsCheckbox = PopupDOM.getHtmlElement('selectAllActions') as HTMLInputElement
        selectAllActionsCheckbox?.addEventListener('change', () => {
            if (!ctx.storageData)
                return
            const available = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig).length
            ConfigureView.applyActionsCount(ctx, selectAllActionsCheckbox.checked ? available : 1)
        })

        if (timeWindowInput)
            timeWindowInput.addEventListener('input', () => {
                ctx.configureConfig.timeWindowMinutes = parseInt(timeWindowInput.value) || ctx.configureConfig.timeWindowMinutes
                ConfigureView.updateConfigurePreview(ctx)
                ConfigureView.updateGenerateButtonState(ctx)
            })

        if (includeAllTabsCheckbox)
            includeAllTabsCheckbox.addEventListener('change', () => {
                if (includeAllTabsCheckbox.checked) {
                    ctx.configureConfig.selectedTabIds = ctx.trackedTabs.map(tab => tab.id ?? 'unknown')
                } else {
                    ctx.configureConfig.selectedTabIds = []
                    TabScope.ensureDefaultTabSelection(ctx.configureConfig, ctx.trackedTabs, ctx.configureCurrentTabId)
                }
                ConfigureView.recomputeIncludeAllTabs(ctx)
                ConfigureView.renderConfigureView(ctx)
            })

        tabScopeList?.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement
            if (target.classList.contains('tab-scope-checkbox')) {
                const tabId = target.dataset.tabId
                if (!tabId)
                    return
                const parsedId = TabScope.parseTabId(tabId)
                if (target.checked && !ctx.configureConfig.selectedTabIds.some(id => TabScope.tabIdsEqual(id, parsedId))) {
                    ctx.configureConfig.selectedTabIds.push(parsedId)
                } else {
                    ctx.configureConfig.selectedTabIds = ctx.configureConfig.selectedTabIds.filter(id => !TabScope.tabIdsEqual(id, parsedId))
                }
                ConfigureView.recomputeIncludeAllTabs(ctx)
                ConfigureView.renderConfigureView(ctx)
            }
        })

        if (allErrorsExpectedCheckbox)
            allErrorsExpectedCheckbox.addEventListener('change', () => {
                ctx.allErrorsExpected = allErrorsExpectedCheckbox.checked
                ConfigureView.renderExpectedErrors(ctx)
                ConfigureView.updateConfigurePreview(ctx)
            })

        filteredErrorsContainer?.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement
            if (target.classList.contains('expected-error-checkbox')) {
                if (target.checked) {
                    ctx.expectedErrors.add(target.value)
                } else {
                    ctx.expectedErrors.delete(target.value)
                }
                ConfigureView.updateConfigurePreview(ctx)
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

    private static getTabInfoForUserDefinedError(ctx: PopupContext): TabInfo {
        const scopedAction = DataFilter.getActionsByScope(ctx.storageData, ctx.configureConfig)[0]

        return {
            id: scopedAction?.tabInfo?.id ?? ctx.configureCurrentTabId ?? 'unknown',
            url: scopedAction?.tabInfo?.url,
            title: scopedAction?.tabInfo?.title
        }
    }

    private static buildUserDefinedError(ctx: PopupContext): ErrorLog | null {
        return PromptBuilder.buildUserDefinedErrorLog(ctx.userDefinedError.trim(), ConfigureView.getTabInfoForUserDefinedError(ctx))
    }
}
