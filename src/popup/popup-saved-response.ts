import * as browser from "webextension-polyfill";
import {PopupDOM, PopupContext} from "./popup-context";
import {PromptConfirmation} from "./popup-prompt-confirmation";

const STORAGE_KEY = 'savedLLMResponse'
interface SavedLLMResponse {
    summary: string,
    description: string,
    timestamp: number
}

export class SavedResponse {
    static async saveLLMResponse(
        summary: string,
        description: string
    ): Promise<void> {
        const saved: SavedLLMResponse = {
            summary,
            description,
            timestamp: Date.now()
        }
        await browser.storage.local.set({[STORAGE_KEY]: saved})
    }

    static async clearSavedLLMResponse(timePeriod?: number): Promise<void> {
        const saved = await SavedResponse.getSavedLLMResponse()
        if (!timePeriod || (timePeriod && saved && saved.timestamp < timePeriod))
            await browser.storage.local.remove(STORAGE_KEY)
    }

    static async renderLatestResponse(ctx: PopupContext): Promise<void> {
        const section = PopupDOM.getHtmlElement('latestResponseSection')
        if (!section) return

        const saved = PromptConfirmation.hasLLMCredentials(ctx) ? await SavedResponse.getSavedLLMResponse() : null
        if (!saved) {
            section.style.display = 'none'
            return
        }

        section.style.display = 'block'
        const summary = PopupDOM.getHtmlElement('latestResponseSummary') as HTMLInputElement
        const description = PopupDOM.getHtmlElement('latestResponseDescription') as HTMLTextAreaElement
        if (summary)
            summary.value = saved.summary
        if (description)
            description.value = saved.description
    }

    private static async getSavedLLMResponse(): Promise<SavedLLMResponse | null> {
        const result = await browser.storage.local.get(STORAGE_KEY)
        return (result[STORAGE_KEY] as SavedLLMResponse) || null
    }
}
