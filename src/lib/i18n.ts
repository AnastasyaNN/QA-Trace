import * as browser from "webextension-polyfill";

export class I18nUtils {
    static applyI18n(): void {
        const elements = document.querySelectorAll<HTMLElement>('[data-i18n-key]');
        elements.forEach((el) => {
            const key = el.dataset.i18nKey
            if (!key)
                return

            const message = browser.i18n.getMessage(key)
            if (!message)
                return

            const attr = el.dataset.i18nAttr
            if (attr) {
                el.setAttribute(attr, message)
                return
            }

            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                el.setAttribute('placeholder', message)
                return
            }

            el.textContent = message
        })
    }
}
