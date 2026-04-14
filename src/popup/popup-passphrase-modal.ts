import * as browser from "webextension-polyfill";
import {PopupContext, PopupDOM} from "./popup-context";
import {CryptoUtils} from "../lib/crypto";

export class PassphraseModal {
    static setupPassphraseModal(ctx: PopupContext): void {
        PopupDOM.getHtmlElement('passphraseModalOk')?.addEventListener('click', () => {
            const input = PopupDOM.getHtmlElement('passphraseModalInput') as HTMLInputElement | null
            PassphraseModal.closePassphraseModal(ctx, input?.value?.trim() || null)
        })
        PopupDOM.getHtmlElement('passphraseModalCancel')?.addEventListener('click', () => {
            PassphraseModal.closePassphraseModal(ctx, null)
        })
        PopupDOM.getHtmlElement('passphraseModalInput')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                const input = event.target as HTMLInputElement
                PassphraseModal.closePassphraseModal(ctx, input?.value?.trim() || null)
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                PassphraseModal.closePassphraseModal(ctx, null)
            }
        })
    }

    static showInputForPassphraseBeforeUsingCredential(ctx: PopupContext, purpose: string): Promise<string | null> {
        const modal = PopupDOM.getHtmlElement('passphraseModal')
        const input = PopupDOM.getHtmlElement('passphraseModalInput') as HTMLInputElement | null
        const purposeEl = PopupDOM.getHtmlElement('passphraseModalPurpose')
        if (!modal || !input || !purposeEl)
            return Promise.resolve(null)
        return new Promise((resolve) => {
            ctx.passphraseModalResolve = resolve
            purposeEl.textContent = browser.i18n.getMessage('popup_enter_passphrase', purpose)
            input.value = ''
            modal.style.display = 'flex'
            setTimeout(() => input.focus(), 0)
        })
    }

    static closePassphraseModal(ctx: PopupContext, value: string | null): void {
        const modal = PopupDOM.getHtmlElement('passphraseModal')
        const input = PopupDOM.getHtmlElement('passphraseModalInput') as HTMLInputElement | null
        if (modal)
            modal.style.display = 'none'
        if (input)
            input.value = ''
        const resolve = ctx.passphraseModalResolve
        ctx.passphraseModalResolve = null
        resolve?.(value)
    }

    static async resolveCredential(
        ctx: PopupContext,
        type: "llmKey" | "webhookPwd",
        onError: (message: string, result: "error") => void,
    ): Promise<string | null> {
        const encryptedCred = type === "llmKey"
            ? ctx.configuration?.llm?.encryptedKey
            : ctx.configuration?.webhook?.encryptedPassword
        const passphraseMessage = type === "llmKey"
            ? 'popup_unlock_llm_key'
            : 'popup_unlock_password'
        const failedMessage = type === "llmKey"
            ? 'popup_failed_to_decrypt_llm_key'
            : 'popup_failed_to_decrypt_password'
        const passphrase = await PassphraseModal.showInputForPassphraseBeforeUsingCredential(
            ctx,
            browser.i18n.getMessage(passphraseMessage),
        )

        if (!encryptedCred)
            return null

        if (!passphrase)
            return null

        try {
            return await CryptoUtils.decryptSecret(encryptedCred, passphrase)
        } catch (error) {
            onError(browser.i18n.getMessage(failedMessage), "error")
            return null
        }
    }
}
