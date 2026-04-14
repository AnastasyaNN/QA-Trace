import {ExtensionConfiguration} from "../lib/types";
import {DEFAULT_CONFIGURATION, ExtensionConfigurationManager} from "../lib/integrations";
import {I18nUtils} from "../lib/i18n";
import {ConfigDOM} from "./configuration-dom";
import {DynamicFields} from "./configuration-dynamic-fields";
import {ConfigIntegrations} from "./configuration-integrations";
import {ConfigSave} from "./configuration-save";

class ConfigurationPage {
    private existingConfiguration: ExtensionConfiguration = DEFAULT_CONFIGURATION

    constructor() {
        this.initialize()
    }

    private async initialize() {
        I18nUtils.applyI18n()
        this.setupEventListeners()
        await this.initializeExistingConfiguration()
    }

    private async initializeExistingConfiguration() {
        let configuration = await ExtensionConfigurationManager.getConfiguration()
        if (!configuration)
            configuration = DEFAULT_CONFIGURATION
        this.existingConfiguration = configuration

        for (let i = 1; i < configuration.allowedUrls.length; i++) {
            DynamicFields.addUrlField()
        }
        for (let i = 1; i < configuration.uiErrorSelectors.length; i++) {
            DynamicFields.addUiErrorField()
        }

        const urlInputs = ConfigDOM.getHtmlElements("urls")
        const uiErrorInputs = ConfigDOM.getHtmlElements("ui-errors")
        const monitorNetworkCheckBox = ConfigDOM.getHtmlElement("monitorNetwork") as HTMLInputElement
        const monitorConsoleCheckBox = ConfigDOM.getHtmlElement("monitorConsole") as HTMLInputElement
        const monitorUICheckBox = ConfigDOM.getHtmlElement("monitorUI") as HTMLInputElement
        const enableLLMCheckbox = ConfigDOM.getHtmlElement("enableLLM") as HTMLInputElement
        const enableWebhookCheckbox = ConfigDOM.getHtmlElement("enableWebhook") as HTMLInputElement
        const integrationNoneRadio = ConfigDOM.getHtmlElement("integrationNone") as HTMLInputElement
        const llmTypeSelect = ConfigDOM.getHtmlElement("llmType") as HTMLSelectElement
        const llmKeyInput = ConfigDOM.getHtmlElement("llmKey") as HTMLInputElement
        const apiUrlInput = ConfigDOM.getHtmlElement("apiUrl") as HTMLInputElement
        const llmModelInput = ConfigDOM.getHtmlElement("llmModel") as HTMLInputElement
        const languageSelect = ConfigDOM.getHtmlElement("languageSelect") as HTMLSelectElement
        const summaryTicketExampleInput = ConfigDOM.getHtmlElement("summaryTicketExample") as HTMLInputElement
        const descriptionTicketExampleTextArea = ConfigDOM.getHtmlElement("descriptionTicketExample") as HTMLTextAreaElement
        const titleDocumentationExampleInput = ConfigDOM.getHtmlElement("titleDocumentationExample") as HTMLInputElement
        const stepsDocumentationExampleTextArea = ConfigDOM.getHtmlElement("stepsDocumentationExample") as HTMLTextAreaElement
        const userActionsLimit = ConfigDOM.getHtmlElement("userActionsLimit") as HTMLInputElement
        const errorsLimit = ConfigDOM.getHtmlElement("errorsLimit") as HTMLInputElement
        const textLengthLimit = ConfigDOM.getHtmlElement("textLengthLimit") as HTMLInputElement
        const webhookUrlInput = ConfigDOM.getHtmlElement("webhookUrl") as HTMLInputElement
        const webhookUsernameInput = ConfigDOM.getHtmlElement("webhookUsername") as HTMLInputElement
        const webhookPasswordInput = ConfigDOM.getHtmlElement("webhookPassword") as HTMLInputElement
        const inferredLLMEnabled = configuration.llmEnabled ?? !!(configuration.llm?.encryptedKey)
        const inferredWebhookEnabled = configuration.webhookEnabled ?? !!configuration.webhook?.url
        const selectedIntegration: 'llm' | 'webhook' | 'none' = inferredLLMEnabled
            ? 'llm'
            : inferredWebhookEnabled
                ? 'webhook'
                : 'none'
        const redactUrlQueryEl = ConfigDOM.getHtmlElement('redactUrlQueryParams') as HTMLInputElement | null

        urlInputs.forEach((input, index) => {
            (input as HTMLInputElement).value = configuration.allowedUrls[index] || ''
        })
        uiErrorInputs.forEach((input, index) => {
            (input as HTMLInputElement).value = configuration.uiErrorSelectors[index] || ''
        })
        if (monitorNetworkCheckBox)
            monitorNetworkCheckBox.checked = configuration.errorMonitoring.network
        if (monitorConsoleCheckBox)
            monitorConsoleCheckBox.checked = configuration.errorMonitoring.console
        if (monitorUICheckBox)
            monitorUICheckBox.checked = configuration.errorMonitoring.ui
        ConfigIntegrations.selectIntegrationOption(selectedIntegration)
        if (integrationNoneRadio && !integrationNoneRadio.checked
            && !enableLLMCheckbox?.checked && !enableWebhookCheckbox?.checked)
            integrationNoneRadio.checked = true
        if (llmTypeSelect)
            llmTypeSelect.value = configuration.llm.type
        if (llmKeyInput)
            llmKeyInput.value = ''
        if (apiUrlInput)
            apiUrlInput.value = configuration.llm?.apiUrl || ''
        if (llmModelInput)
            llmModelInput.value = configuration.llm?.model || ''
        if (languageSelect)
            languageSelect.value = configuration.language || 'auto'
        if (summaryTicketExampleInput && configuration.ticketExample?.summary)
            summaryTicketExampleInput.value = configuration.ticketExample.summary
        if (descriptionTicketExampleTextArea && configuration.ticketExample?.description)
            descriptionTicketExampleTextArea.value = configuration.ticketExample.description
        if (titleDocumentationExampleInput && configuration.documentationExample?.title)
            titleDocumentationExampleInput.value = configuration.documentationExample.title
        if (stepsDocumentationExampleTextArea && configuration.documentationExample?.steps)
            stepsDocumentationExampleTextArea.value = configuration.documentationExample.steps
        if (userActionsLimit)
            userActionsLimit.value = configuration.userActionsLimit.toString()
        if (errorsLimit)
            errorsLimit.value = configuration.errorsLimit.toString()
        if (textLengthLimit)
            textLengthLimit.value = configuration.textLengthLimit?.toString()
        if (redactUrlQueryEl)
            redactUrlQueryEl.checked = configuration.redactUrlQueryParams !== false
        if (webhookUrlInput)
            webhookUrlInput.value = configuration.webhook?.url || ''
        if (webhookUsernameInput)
            webhookUsernameInput.value = configuration.webhook?.username || ''
        if (webhookPasswordInput)
            webhookPasswordInput.value = ''

        ConfigIntegrations.syncIntegrationSections()
        DynamicFields.toggleUiSelectorsVisibility(configuration.errorMonitoring.ui)
        ConfigIntegrations.toggleApiUrl()
    }

    private setupEventListeners(): void {
        const finishBtn = ConfigDOM.getHtmlElement("finishBtn") as HTMLButtonElement
        const addUrlBtn = ConfigDOM.getHtmlElement("addUrl") as HTMLButtonElement
        const addUiErrorBtn = ConfigDOM.getHtmlElement("addUiError") as HTMLButtonElement
        const llmType = ConfigDOM.getHtmlElement("llmType") as HTMLSelectElement
        const integrationOptions = ConfigDOM.getHtmlElements("intObjects")
        const monitorUI = ConfigDOM.getHtmlElement("monitorUI") as HTMLInputElement

        finishBtn?.addEventListener('click', async () => {
            const saved = await ConfigSave.finishSetup(this.existingConfiguration)
            if (saved) {
                this.existingConfiguration = saved
                window.close()
            }
        })
        addUrlBtn?.addEventListener('click', () => DynamicFields.addUrlField())
        addUiErrorBtn?.addEventListener('click', () => DynamicFields.addUiErrorField())
        llmType?.addEventListener('change', () => ConfigIntegrations.handleLLMTypeChange())
        integrationOptions.forEach(input => input.addEventListener('change', () => ConfigIntegrations.syncIntegrationSections()))
        monitorUI?.addEventListener('change', () => DynamicFields.toggleUiSelectorsVisibility(monitorUI.checked))

        ConfigDOM.getHtmlElement("urls-container")?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement
            if (target.classList.contains('btn-remove'))
                DynamicFields.removeUrlField(target)
        })

        ConfigDOM.getHtmlElement("ui-errors-container")?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement
            if (target.classList.contains('btn-remove'))
                DynamicFields.removeUiErrorField(target)
        })
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ConfigurationPage()
})
