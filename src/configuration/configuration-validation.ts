import * as browser from "webextension-polyfill";
import {ExtensionConfiguration} from "../lib/types";
import {ConfigDOM} from "./configuration-dom";
import {ConfigIntegrations} from "./configuration-integrations";

export class ConfigValidation {
    static validate(existingConfiguration: ExtensionConfiguration): boolean {
        if (!ConfigValidation.validateUrls())
            return false
        if (!ConfigValidation.validateErrorMonitoring())
            return false
        return ConfigValidation.validateIntegrations(existingConfiguration)
    }

    static getAllowedUrlsFromUI(showAlerts: boolean = false): string[] | null {
        const urlInputs = ConfigDOM.getHtmlElements("urls")
        const origins: string[] = []

        for (const input of Array.from(urlInputs)) {
            const value = (input as HTMLInputElement).value.trim()
            if (!value)
                continue

            let parsed: URL
            try {
                parsed = new URL(value)
            } catch {
                if (showAlerts) {
                    alert(browser.i18n.getMessage('config_invalid_url', value));
                    (input as HTMLInputElement).focus()
                }
                return null
            }

            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                if (showAlerts) {
                    alert(browser.i18n.getMessage('config_allowed_url_protocol_error', value));
                    (input as HTMLInputElement).focus()
                }
                return null
            }

            origins.push(parsed.origin)
        }

        const uniqueOrigins = Array.from(new Set(origins))

        if (uniqueOrigins.length === 0) {
            if (showAlerts)
                alert(browser.i18n.getMessage('config_enter_at_least_1_url'))
            return null
        }

        return uniqueOrigins
    }

    static getErrorsDisabledUrlsFromUI(): string[] {
        const urlEntries = document.querySelectorAll('.url-entry')
        const origins: string[] = []

        urlEntries.forEach(entry => {
            const checkbox = entry.querySelector('.skip-errors-checkbox') as HTMLInputElement | null
            const urlInput = entry.querySelector('.url-input') as HTMLInputElement | null
            if (!checkbox?.checked || !urlInput)
                return
            const value = urlInput.value.trim()
            if (!value)
                return
            try {
                const parsed = new URL(value)
                if (parsed.protocol === 'http:' || parsed.protocol === 'https:')
                    origins.push(parsed.origin)
            } catch { /* invalid URL, skip */ }
        })

        return Array.from(new Set(origins))
    }

    static getUiErrorSelectorsFromUI(): string[] {
        const selectorInputs = ConfigDOM.getHtmlElements("ui-errors")
        const selectors: string[] = []

        selectorInputs.forEach(input => {
            const value = (input as HTMLInputElement).value.trim()
            if (value)
                selectors.push(value)
        })

        return selectors
    }

    private static validateUrls(): boolean {
        const allowedOrigins = ConfigValidation.getAllowedUrlsFromUI(true)
        return !!allowedOrigins
    }

    private static validateErrorMonitoring(): boolean {
        const network = (ConfigDOM.getHtmlElement("monitorNetwork") as HTMLInputElement).checked
        const consoleMonitoring = (ConfigDOM.getHtmlElement("monitorConsole") as HTMLInputElement).checked
        const ui = (ConfigDOM.getHtmlElement("monitorUI") as HTMLInputElement).checked
        const uiSelectors = ConfigValidation.getUiErrorSelectorsFromUI()

        if (!network && !consoleMonitoring && !ui) {
            alert(browser.i18n.getMessage('config_select_monitoring_type_error'))
            return false
        }

        if (ui && uiSelectors.length === 0) {
            alert(browser.i18n.getMessage('config_add_ui_selector_error'))
            return false
        }

        return true
    }

    private static validateIntegrations(existingConfiguration: ExtensionConfiguration): boolean {
        const integrationSelection = ConfigIntegrations.getSelectedIntegration()
        const enableLLM = integrationSelection === 'llm'
        const enableWebhook = integrationSelection === 'webhook'
        const llmKey = (ConfigDOM.getHtmlElement("llmKey") as HTMLInputElement).value.trim()
        const passphrase = (ConfigDOM.getHtmlElement("passphrase") as HTMLInputElement).value.trim()
        const hasEncryptedStored = !!existingConfiguration.llm.encryptedKey
        const webhookPassword = (ConfigDOM.getHtmlElement("webhookPassword") as HTMLInputElement).value.trim()
        const webhookUrl = (ConfigDOM.getHtmlElement("webhookUrl") as HTMLInputElement).value.trim()

        if (!enableLLM && !enableWebhook)
            return true

        if (enableLLM) {
            if (!llmKey && !hasEncryptedStored) {
                alert(browser.i18n.getMessage('config_enter_llm_key_error'))
                return false
            }
            if (llmKey && !passphrase) {
                alert(browser.i18n.getMessage('config_enter_passphrase_error'))
                return false
            }
        }

        if (enableWebhook) {
            if (!webhookUrl) {
                alert(browser.i18n.getMessage('config_enter_webhook_url_error'))
                return false
            }
            if (webhookPassword && !passphrase) {
                alert(browser.i18n.getMessage('config_enter_passphrase_webhook_error'))
                return false
            }
        }

        return true
    }
}
