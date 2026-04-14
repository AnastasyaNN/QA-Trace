import * as browser from "webextension-polyfill";
import {PopupContext, PopupDOM} from "./popup-context";
import {LLMClient, LLMRequest} from "../lib/llm-client";
import {WebhookClient, WebhookRequest} from "../lib/webhook-client";
import {PassphraseModal} from "./popup-passphrase-modal";
import {SavedResponse} from "./popup-saved-response";
import {PopupLanguage} from "./popup-language";
import {ErrorPromptUtils} from "../lib/error-prompt";

export class PromptConfirmation {
    static hasLLMCredentials(ctx: PopupContext): boolean {
        return !!(ctx.configuration?.llmEnabled && ctx.configuration?.llm?.encryptedKey)
    }

    static hasWebhookConfiguration(ctx: PopupContext): boolean {
        return !!(ctx.configuration?.webhookEnabled && ctx.configuration?.webhook?.url)
    }

    static updateSendToLLMOrTriggerWebhookVisibility(ctx: PopupContext): void {
        const sendToLLMBtn = PopupDOM.getHtmlElement('sendToLLM') as HTMLButtonElement
        if (sendToLLMBtn)
            sendToLLMBtn.style.display = PromptConfirmation.hasLLMCredentials(ctx) ? 'inline-block' : 'none'
        const triggerWebhookBtn = PopupDOM.getHtmlElement('triggerWebhook') as HTMLButtonElement
        if (triggerWebhookBtn)
            triggerWebhookBtn.style.display = PromptConfirmation.hasWebhookConfiguration(ctx) ? 'inline-block' : 'none'
    }

    static getFullPromptPlainText(ctx: PopupContext): string {
        const promptTextarea = PopupDOM.getHtmlElement('promptTextarea') as HTMLTextAreaElement
        const user = promptTextarea?.value ?? ''
        if (PromptConfirmation.integrationsSplitPrompt(ctx)) {
            const sys = ctx.systemPromptForTextarea || ''
            return sys ? `${sys}\n${user}` : user
        }
        return user
    }

    static applyPromptTextareaValue(ctx: PopupContext, userPrompt: string): void {
        const promptTextarea = PopupDOM.getHtmlElement('promptTextarea') as HTMLTextAreaElement
        if (!promptTextarea)
            return
        promptTextarea.value = PromptConfirmation.integrationsSplitPrompt(ctx)
            ? userPrompt
            : `${ctx.systemPromptForTextarea}\n${userPrompt}`
    }

    static setLLMResponseVisibility(show: boolean): void {
        const responseFields = PopupDOM.getHtmlElement('responseFields')
        if (responseFields)
            responseFields.style.display = show ? 'block' : 'none'
    }

    static resetResponseMessages(): void {
        const responseError = PopupDOM.getHtmlElement('responseError')
        const responseSuccess = PopupDOM.getHtmlElement('responseSuccess')
        if (responseError) {
            responseError.style.display = 'none'
            responseError.textContent = ''
        }
        if (responseSuccess) {
            responseSuccess.style.display = 'none'
            responseSuccess.textContent = ''
        }
    }

    static async sendPromptToLLM(ctx: PopupContext): Promise<void> {
        try {
            const promptTextarea = PopupDOM.getHtmlElement('promptTextarea') as HTMLTextAreaElement
            const finalPrompt = promptTextarea?.value || ctx.generatedPrompt
            const sendButton = PopupDOM.getHtmlElement('sendToLLM') as HTMLButtonElement

            if (!finalPrompt.trim()) {
                alert(browser.i18n.getMessage('popup_no_prompt_to_send'))
                return
            }

            if (!PromptConfirmation.hasLLMCredentials(ctx)) {
                PromptConfirmation.showResponseResult(browser.i18n.getMessage('popup_no_llm'), "error")
                return
            }

            const llmApiKey = await PassphraseModal.resolveCredential(ctx, 'llmKey', PromptConfirmation.showResponseResult)
            if (!llmApiKey) {
                PromptConfirmation.showResponseResult(browser.i18n.getMessage('popup_llm_key_expired'), "error")
                return
            }

            if (sendButton) {
                sendButton.disabled = true
                sendButton.textContent = browser.i18n.getMessage('popup_sending')
            }

            const llmRequest: LLMRequest = {
                prompt: finalPrompt,
                model: ctx.configuration?.llm?.model,
                systemPrompt: ctx.generatedSystemPrompt,
                apiKey: llmApiKey
            }

            PromptConfirmation.resetResponseMessages()
            PromptConfirmation.setLLMResponseVisibility(true)

            const llmResponse = await LLMClient.sendRequest(llmRequest)
            const responseSection = PopupDOM.getHtmlElement('responseSection')
            const responseSummary = PopupDOM.getHtmlElement('responseSummary') as HTMLInputElement
            const responseDescription = PopupDOM.getHtmlElement('responseDescription') as HTMLTextAreaElement
            const responseError = PopupDOM.getHtmlElement('responseError')

            if (responseSection && responseSummary && responseDescription && responseError) {
                responseSection.style.display = 'block'
                PromptConfirmation.resetResponseMessages()

                if (llmResponse.success && llmResponse.response) {
                    responseSummary.value = llmResponse.response.summary || ''
                    responseDescription.value = llmResponse.response.description || ''
                    await SavedResponse.saveLLMResponse(
                        llmResponse.response.summary || '',
                        llmResponse.response.description || ''
                    )
                } else {
                    responseSummary.value = ''
                    responseDescription.value = ''
                    responseError.style.display = 'block'
                    const baseError = llmResponse.error || 'Unknown error'
                    responseError.textContent = llmResponse.rawText
                        ? `Error: ${baseError}. Raw response: ${llmResponse.rawText}`
                        : `Error: ${baseError}`
                }

                responseSection.scrollIntoView({behavior: 'smooth'})
            }

        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_send_to_llm'))
            const message = error instanceof Error
                ? error.message
                : browser.i18n.getMessage('popup_failed_to_send_to_llm')
            PromptConfirmation.showResponseResult(`${browser.i18n.getMessage('popup_failed_to_send_to_llm')}: ${message}`, "error")
        } finally {
            const sendButton = PopupDOM.getHtmlElement('sendToLLM') as HTMLButtonElement
            if (sendButton) {
                sendButton.disabled = false
                sendButton.textContent = browser.i18n.getMessage('popup_send_to_llm')
            }
        }
    }

    static async triggerWebhook(ctx: PopupContext): Promise<void> {
        try {
            const promptTextarea = PopupDOM.getHtmlElement('promptTextarea') as HTMLTextAreaElement
            const finalPrompt = promptTextarea?.value || ctx.generatedPrompt
            const webhookButton = PopupDOM.getHtmlElement('triggerWebhook') as HTMLButtonElement

            if (!finalPrompt.trim()) {
                alert(browser.i18n.getMessage('popup_no_prompt_to_send'))
                return
            }

            if (!PromptConfirmation.hasWebhookConfiguration(ctx)) {
                PromptConfirmation.showResponseResult(browser.i18n.getMessage('popup_no_webhook'), "error")
                return
            }

            const webhookPassword = await PassphraseModal.resolveCredential(ctx, 'webhookPwd', PromptConfirmation.showResponseResult)
            if (ctx.configuration?.webhook?.encryptedPassword && !webhookPassword) {
                PromptConfirmation.showResponseResult(browser.i18n.getMessage('popup_password_expired'), "error")
                if (webhookButton) {
                    webhookButton.disabled = !PromptConfirmation.hasWebhookConfiguration(ctx)
                    webhookButton.textContent = browser.i18n.getMessage('popup_trigger_webhook')
                }
                return
            }

            if (webhookButton) {
                webhookButton.disabled = true
                webhookButton.textContent = browser.i18n.getMessage('popup_sending')
            }

            const request: WebhookRequest = {
                prompt: finalPrompt,
                systemPrompt: ctx.generatedSystemPrompt,
                userActions: ctx.storageData?.userActions,
                errors: ErrorPromptUtils.mergeErrorsForWebhook(
                    ctx.storageData?.errors || [],
                    ctx.storageData?.networkErrorPayloads || []
                ),
                language: PopupLanguage.getResolvedLanguageCode(ctx.configuration),
                password: webhookPassword || undefined
            }

            const result = await WebhookClient.send(request)

            const responseSection = PopupDOM.getHtmlElement('responseSection')
            const responseSummary = PopupDOM.getHtmlElement('responseSummary') as HTMLInputElement
            const responseDescription = PopupDOM.getHtmlElement('responseDescription') as HTMLTextAreaElement
            PromptConfirmation.setLLMResponseVisibility(false)
            PromptConfirmation.resetResponseMessages()
            if (responseSummary) responseSummary.value = ''
            if (responseDescription) responseDescription.value = ''
            if (responseSection) {
                responseSection.style.display = 'block'
                if (result.success) {
                    PromptConfirmation.showResponseResult(browser.i18n.getMessage('popup_webhook_triggered_suc'), "success")
                } else {
                    const errorMessage = browser.i18n.getMessage('popup_webhook_failed_error', [result.error || "Unknown", result.status?.toString() || '500'])
                    PromptConfirmation.showResponseResult(errorMessage, "error")
                }
            }
        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_trigger_webhook'))
            const message = error instanceof Error
                ? error.message
                : browser.i18n.getMessage('popup_failed_to_trigger_webhook')
            PromptConfirmation.setLLMResponseVisibility(false)
            PromptConfirmation.showResponseResult(`${browser.i18n.getMessage('popup_failed_to_trigger_webhook')}: ${message}`, 'error')
        } finally {
            const webhookButton = PopupDOM.getHtmlElement('triggerWebhook') as HTMLButtonElement
            if (webhookButton) {
                webhookButton.disabled = !PromptConfirmation.hasWebhookConfiguration(ctx)
                webhookButton.textContent = browser.i18n.getMessage('popup_trigger_webhook')
            }
        }
    }

    private static integrationsSplitPrompt(ctx: PopupContext): boolean {
        return !!(ctx.configuration?.llmEnabled || ctx.configuration?.webhookEnabled)
    }

    private static showResponseResult(message: string, result: "success" | "error"): void {
        const responseSection = PopupDOM.getHtmlElement('responseSection')
        const responseSuccess = PopupDOM.getHtmlElement('responseSuccess')
        const responseError = PopupDOM.getHtmlElement('responseError')
        if (responseSection)
            responseSection.style.display = 'block'
        if (responseSuccess) {
            responseSuccess.style.display = result === "success" ? 'block' : 'none'
            responseSuccess.textContent = result === "success" ? message : ''
        }
        if (responseError) {
            responseError.style.display = result === "error" ? 'block' : 'none'
            responseError.textContent = result === "error" ? message : ''
        }
    }
}
