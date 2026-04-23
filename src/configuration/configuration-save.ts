import * as browser from "webextension-polyfill";
import {ExtensionConfiguration} from "../lib/types";
import {DEFAULT_CONFIGURATION, ExtensionConfigurationManager} from "../lib/integrations";
import {CryptoUtils} from "../lib/crypto";
import {ConfigDOM} from "./configuration-dom";
import {ConfigIntegrations} from "./configuration-integrations";
import {ConfigValidation} from "./configuration-validation";

export class ConfigSave {
    static async finishSetup(existingConfiguration: ExtensionConfiguration): Promise<ExtensionConfiguration | null> {
        if (!ConfigValidation.validate(existingConfiguration))
            return null

        try {
            const formData = ConfigSave.getConfigurationFromUI(existingConfiguration)
            const configurationToSave = await ConfigSave.prepareConfigurationForSave(formData)
            await ExtensionConfigurationManager.setConfiguration(configurationToSave)
            return configurationToSave
        } catch (error) {
            alert(browser.i18n.getMessage('config_not_saved_error'))
            return null
        }
    }

    private static getConfigurationFromUI(existingConfiguration: ExtensionConfiguration): {
        configuration: ExtensionConfiguration,
        llmKey?: string,
        passphrase?: string,
        webhookPassword?: string,
    } {
        const allowedUrls = ConfigValidation.getAllowedUrlsFromUI() || []
        const errorsDisabledUrls = ConfigValidation.getErrorsDisabledUrlsFromUI()

        const errorMonitoring = {
            network: (ConfigDOM.getHtmlElement("monitorNetwork") as HTMLInputElement).checked,
            console: (ConfigDOM.getHtmlElement("monitorConsole") as HTMLInputElement).checked,
            ui: (ConfigDOM.getHtmlElement("monitorUI") as HTMLInputElement).checked
        }

        const llmType = (ConfigDOM.getHtmlElement("llmType") as HTMLSelectElement).value as 'OpenAI' | 'DeepSeek' | 'custom'
        const llmKey = (ConfigDOM.getHtmlElement("llmKey") as HTMLInputElement).value.trim()
        const apiUrl = (ConfigDOM.getHtmlElement("apiUrl") as HTMLInputElement)?.value.trim()
        const llmModel = (ConfigDOM.getHtmlElement("llmModel") as HTMLInputElement)?.value.trim()
        const passphrase = (ConfigDOM.getHtmlElement("passphrase") as HTMLInputElement).value.trim()
        const language = (ConfigDOM.getHtmlElement("languageSelect") as HTMLSelectElement)?.value as 'auto' | 'en' | 'ru'
        const webhookUrl = (ConfigDOM.getHtmlElement("webhookUrl") as HTMLInputElement)?.value.trim()
        const webhookUsername = (ConfigDOM.getHtmlElement("webhookUsername") as HTMLInputElement)?.value.trim()
        const webhookPassword = (ConfigDOM.getHtmlElement("webhookPassword") as HTMLInputElement)?.value
        const integrationSelection = ConfigIntegrations.getSelectedIntegration()
        const llmEnabled = integrationSelection === 'llm'
        const webhookEnabled = integrationSelection === 'webhook'

        const summaryTicketExample = (ConfigDOM.getHtmlElement("summaryTicketExample") as HTMLInputElement).value
        const descriptionTicketExample = (ConfigDOM.getHtmlElement("descriptionTicketExample") as HTMLTextAreaElement).value

        const titleDocumentationExample = (ConfigDOM.getHtmlElement("titleDocumentationExample") as HTMLInputElement).value
        const stepsDocumentationExample = (ConfigDOM.getHtmlElement("stepsDocumentationExample") as HTMLTextAreaElement).value

        const userActionsLimit = (ConfigDOM.getHtmlElement("userActionsLimit") as HTMLInputElement).value
        const errorsLimit = (ConfigDOM.getHtmlElement("errorsLimit") as HTMLInputElement).value
        const textLengthLimit = (ConfigDOM.getHtmlElement("textLengthLimit") as HTMLInputElement).value
        const redactUrlQueryParams = ConfigDOM.getHtmlElement('redactUrlQueryParams') as HTMLInputElement
        const uiErrorSelectors = ConfigValidation.getUiErrorSelectorsFromUI()
        const effectiveUiSelectors = uiErrorSelectors.length > 0
            ? uiErrorSelectors
            : DEFAULT_CONFIGURATION.uiErrorSelectors

        const llmConfig: any = {
            ...existingConfiguration.llm,
            type: llmType,
            apiKey: ''
        }

        if (apiUrl && apiUrl.trim())
            llmConfig.apiUrl = apiUrl.trim()
        if (llmModel)
            llmConfig.model = llmModel

        const configurationWithoutExamples: ExtensionConfiguration = {
            allowedUrls,
            errorsDisabledUrls,
            errorMonitoring,
            llmEnabled,
            llm: llmConfig,
            language: language || 'auto',
            userActionsLimit: Math.max(1, Math.floor(+userActionsLimit)) || DEFAULT_CONFIGURATION.userActionsLimit,
            errorsLimit: Math.max(1, Math.floor(+errorsLimit)) || DEFAULT_CONFIGURATION.errorsLimit,
            textLengthLimit: Math.max(1, Math.floor(+textLengthLimit)) || DEFAULT_CONFIGURATION.textLengthLimit,
            uiErrorSelectors: effectiveUiSelectors,
            webhookEnabled,
            webhook: {
                url: webhookUrl || '',
                username: webhookUsername || '',
                encryptedPassword: existingConfiguration.webhook?.encryptedPassword
            },
            redactUrlQueryParams: redactUrlQueryParams?.checked !== false
        }
        let configuration = summaryTicketExample && descriptionTicketExample
            ? {
                ...configurationWithoutExamples,
                ticketExample: {
                    summary: summaryTicketExample,
                    description: descriptionTicketExample
                }
            }
            : configurationWithoutExamples

        configuration = titleDocumentationExample && stepsDocumentationExample
            ? {
                ...configuration,
                documentationExample: {
                    title: titleDocumentationExample,
                    steps: stepsDocumentationExample
                }
            }
            : configuration

        return {
            configuration,
            llmKey,
            passphrase,
            webhookPassword
        }
    }

    private static async prepareConfigurationForSave(formData: {
        configuration: ExtensionConfiguration,
        llmKey?: string,
        passphrase?: string,
        webhookPassword?: string,
    }): Promise<ExtensionConfiguration> {
        const configuration = formData.configuration
        const {llmKey, passphrase, webhookPassword} = formData
        const llmEnabled = !!configuration.llmEnabled
        const webhookEnabled = !!configuration.webhookEnabled

        if (!llmEnabled)
            configuration.llm = DEFAULT_CONFIGURATION.llm
        else
            await verifyLlmConfiguration()

        if (!webhookEnabled)
            configuration.webhook = {}
        else
            await verifyWebhookIntegration()

        return configuration

        async function verifyLlmConfiguration() {
            if (llmEnabled && llmKey) {
                if (!passphrase)
                    throw new Error(browser.i18n.getMessage('config_passphrase_is_required'))
                configuration.llm.encryptedKey = await CryptoUtils.encryptSecret(llmKey, passphrase)
            }
        }

        async function verifyWebhookIntegration() {
            if (!configuration.webhook)
                configuration.webhook = {}
            if (webhookEnabled && webhookPassword) {
                if (!passphrase)
                    throw new Error(browser.i18n.getMessage('config_passphrase_is_required_webhook'))
                configuration.webhook.encryptedPassword = await CryptoUtils.encryptSecret(webhookPassword, passphrase)
            }
        }
    }
}
