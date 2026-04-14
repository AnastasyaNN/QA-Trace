import * as browser from "webextension-polyfill"

export class Messaging {
    static async safeSendMessage(message: any): Promise<void> {
        try {
            await browser.runtime.sendMessage(message)
        } catch (error: any) {
            const msg = error?.message || ''
            if (typeof msg === 'string' && msg.includes('Extension context invalidated')) {
                console.warn('QA Trace: runtime context invalidated, dropping message.')
                return
            }
            console.debug('QA Trace: failed to send message to background', error)
        }
    }
}
