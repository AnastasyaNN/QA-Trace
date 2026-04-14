import {ConfigDOM} from "./configuration-dom";

export class ConfigIntegrations {
    static getSelectedIntegration(): 'llm' | 'webhook' | 'none' {
        const llm = ConfigDOM.getHtmlElement("enableLLM") as HTMLInputElement
        const webhook = ConfigDOM.getHtmlElement("enableWebhook") as HTMLInputElement
        if (llm?.checked)
            return 'llm'
        if (webhook?.checked)
            return 'webhook'
        return 'none'
    }

    static selectIntegrationOption(value: 'llm' | 'webhook' | 'none'): void {
        const llm = ConfigDOM.getHtmlElement("enableLLM") as HTMLInputElement
        const webhook = ConfigDOM.getHtmlElement("enableWebhook") as HTMLInputElement
        const none = ConfigDOM.getHtmlElement("integrationNone") as HTMLInputElement
        if (llm)
            llm.checked = value === 'llm'
        if (webhook)
            webhook.checked = value === 'webhook'
        if (none)
            none.checked = value === 'none'
        ConfigIntegrations.syncIntegrationSections()
    }

    static syncIntegrationSections(): void {
        const passphraseContainer = ConfigDOM.getHtmlElement("passphraseContainer") as HTMLElement
        const selected = ConfigIntegrations.getSelectedIntegration()
        const llmEnabled = selected === 'llm'
        const webhookEnabled = selected === 'webhook'

        ConfigIntegrations.setSectionEnabled('llmConfigSection', llmEnabled)
        ConfigIntegrations.setSectionEnabled('webhookConfigSection', webhookEnabled)

        if (passphraseContainer)
            passphraseContainer.style.display = (llmEnabled || webhookEnabled)
                ? 'block'
                : 'none'
    }

    static toggleApiUrl(): void {
        const llmType = ConfigDOM.getHtmlElement("llmType") as HTMLSelectElement
        const apiUrlContainer = ConfigDOM.getHtmlElement("apiUrlContainer") as HTMLElement

        if (!apiUrlContainer)
            return
        if (llmType?.value === 'custom')
            apiUrlContainer.style.display = 'block'
        else
            apiUrlContainer.style.display = 'none'
    }

    static handleLLMTypeChange(): void {
        const llmType = ConfigDOM.getHtmlElement("llmType") as HTMLSelectElement
        const llmModelInput = ConfigDOM.getHtmlElement("llmModel") as HTMLInputElement
        if (llmModelInput) {
            llmModelInput.value = ''
            if (llmType?.value === 'OpenAI')
                llmModelInput.value = 'gpt-5-nano'
            else if (llmType?.value === 'DeepSeek')
                llmModelInput.value = 'deepseek-chat'
        }
        ConfigIntegrations.toggleApiUrl()
    }

    private static setSectionEnabled(sectionId: string, enabled: boolean): void {
        const section = document.getElementById(sectionId)
        if (!section)
            return
        section.hidden = !enabled
    }
}
