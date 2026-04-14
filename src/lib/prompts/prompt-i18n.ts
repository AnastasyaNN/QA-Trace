import enMessages from "../../../public/_locales/en/messages.json";
import ruMessages from "../../../public/_locales/ru/messages.json";

export type LlmPromptLocale = "en" | "ru"

type MessagePack = Record<string, { message?: string }>

const enPack = enMessages as MessagePack
const ruPack = ruMessages as MessagePack

export class PromptI18n {
    static promptT(messageName: string, locale: LlmPromptLocale): string {
    const primary = locale === "ru" ? ruPack : enPack
    const msg = primary[messageName]?.message
    if (msg)
        return msg
    return enPack[messageName]?.message ?? ""
    }
}
