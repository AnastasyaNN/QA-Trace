import {ErrorLog, UserAction} from "./types"
import {ExtensionConfigurationManager} from "./integrations"
import {FetchUtils} from "./fetch-utils"
import * as browser from "webextension-polyfill"

export interface WebhookRequest {
    prompt: string,
    systemPrompt: string,
    language?: string,
    password?: string,
    userActions?: Array<UserAction>,
    errors?: Array<ErrorLog>
}

interface WebhookPayload {
    prompt: string,
    systemPrompt: string,
    language: string,
    timestamp: number,
    userActions?: Array<UserAction>,
    errors?: Array<ErrorLog>
}

export interface WebhookResponse {
    success: boolean,
    status?: number,
    error?: string
}

export class WebhookClient {
    static async send(request: WebhookRequest): Promise<WebhookResponse> {
        const configuration = await ExtensionConfigurationManager.getConfiguration()
        if (!configuration.webhookEnabled)
            return { success: false, error: 'Webhook integration is disabled in configuration.' }
        const url = configuration.webhook?.url?.trim()
        if (!url)
            return { success: false, error: 'Webhook URL not configured' }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }

        const password = request.password || null
        if (configuration.webhook?.username) {
            if (configuration.webhook.encryptedPassword && !password)
                return { success: false, error: 'Webhook password is locked. Unlock it with your passphrase before request.' }
            if (password)
                headers['Authorization'] = `Basic ${btoa(`${configuration.webhook.username}:${password}`)}`
        }

        try {
            const payload: WebhookPayload = {
                prompt: request.prompt,
                systemPrompt: request.systemPrompt,
                language: request.language || configuration.language || 'auto',
                timestamp: Date.now(),
                userActions: request.userActions,
                errors: request.errors
            }
            const response = await FetchUtils.fetchWithTimeout(
                url,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                },
                FetchUtils.INTEGRATION_FETCH_TIMEOUT_MS
            )

            if (!response.ok)
                return { success: false, status: response.status, error: `Webhook request failed with HTTP ${response.status}. Verify URL, credentials, and server availability.` }

            return { success: true, status: response.status }
        } catch (error) {
            if (FetchUtils.isAbortError(error)) {
                return {
                    success: false,
                    error: browser.i18n.getMessage('popup_webhook_request_timeout'),
                }
            }
            return { success: false, error: 'Webhook request failed due to a network error. Verify connectivity and webhook endpoint.' }
        }
    }
}
