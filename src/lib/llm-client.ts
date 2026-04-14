import {ExtensionConfiguration} from "./types"
import {ExtensionConfigurationManager} from "./integrations"
import {FetchUtils} from "./fetch-utils"
import * as browser from "webextension-polyfill"

export const DEFAULT_LLM_URLS: Record<string, string> = {
    'OpenAI': 'https://api.openai.com/v1',
    'DeepSeek': 'https://api.deepseek.com/v1',
    'custom': ''
}

export interface LLMRequest {
    prompt: string,
    model?: string,
    systemPrompt: string,
    apiKey?: string
}

export interface LLMResponse {
    success: boolean,
    response?: {
        summary: string,
        description: string
    },
    rawText?: string,
    error?: string
}

export class LLMClient {
    static async sendRequest(request: LLMRequest): Promise<LLMResponse> {
        try {
            const configuration = await ExtensionConfigurationManager.getConfiguration()
            if (!configuration.llmEnabled)
                return { success: false, error: 'LLM integration is disabled in configuration. Enable it in Settings > Integrations.' }

            const apiKey = request.apiKey
            if (!apiKey)
                return { success: false, error: 'LLM API key not available. Unlock it with your passphrase before request.' }

            const apiUrl = this.getApiUrl(configuration)
            if (!apiUrl)
                return { success: false, error: 'API URL is not configured. Set a valid URL in Settings > Integrations.' }

            switch (configuration.llm.type) {
                case 'OpenAI':
                case 'custom':
                    return await this.callChatCompletions(request, configuration, apiKey)
                case 'DeepSeek':
                    return await this.callChatCompletions(request, configuration, apiKey, 'deepseek-chat')
                default:
                    return { success: false, error: 'Unsupported LLM type. Choose OpenAI, DeepSeek, or custom in settings.' }
            }
        } catch (error) {
            if (FetchUtils.isAbortError(error)) {
                return {
                    success: false,
                    error: browser.i18n.getMessage('popup_llm_request_timeout'),
                }
            }
            return { success: false, error: 'LLM request failed. Check network access, API URL, model name, and API key permissions.' }
        }
    }

    private static getApiUrl(config: ExtensionConfiguration): string {
        if (config.llm.type === 'custom')
            return config.llm.apiUrl || ''
        return config.llm.apiUrl || DEFAULT_LLM_URLS[config.llm.type] || ''
    }

    private static buildMessages(request: LLMRequest) {
        return [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.prompt }
        ]
    }

    private static async callChatCompletions(request: LLMRequest, config: ExtensionConfiguration, apiKey: string, defaultModel?: string): Promise<LLMResponse> {
        const apiUrl = this.getApiUrl(config);
        const response = await FetchUtils.fetchWithTimeout(
            `${apiUrl}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: request.model || config.llm.model || defaultModel,
                    messages: this.buildMessages(request),
                }),
            },
            FetchUtils.INTEGRATION_FETCH_TIMEOUT_MS
        )

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            return { success: false, error: errorData.error?.message || `HTTP ${response.status}` }
        }

        const data = await response.json()
        const content = data.choices?.[0]?.message?.content || ''
        const parsed = this.parseStructuredResponse(content)
        return {
            success: !!parsed,
            response: parsed || undefined,
            rawText: content,
            error: parsed
                ? undefined
                : `Invalid LLM response format. Ensure the model returns JSON: {"summary":"...","description":"..."}. Received data: ${JSON.stringify(data)}`
        }
    }

    private static parseStructuredResponse(content: string | undefined): { summary: string, description: string } | null {
        if (!content)
            return null
        try {
            let cleaned = content.trim()
            if (cleaned.startsWith('```'))
                cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
            const parsed = JSON.parse(cleaned)
            if (parsed && typeof parsed.summary === 'string' && typeof parsed.description === 'string')
                return { summary: parsed.summary, description: parsed.description }
        } catch (e) {
            console.warn('Failed to parse LLM content as JSON', e, content)
        }
        return null
    }
}
