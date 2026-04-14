import {type LlmPromptLocale} from "./prompt-i18n";
import {FormatTemplates} from "./formats.template"

export class SystemDocumentationTemplate {
    static buildSystemDocumentationPrompt(
    skipResponseFormat: boolean = false,
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `You are an expert in interpretation of user actions storage in the following format Array<UserAction> and generation of documentation from it.
${FormatTemplates.buildUserActionsFormatPrompt(promptLocale)}
${FormatTemplates.buildTabInfoFormatPrompt(promptLocale)}
User actions are stored in the following order: the recent one is the first one in the array.
${skipResponseFormat ? '' : FormatTemplates.buildResponseFormatPrompt('document', promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}`
        : `Ты — эксперт по интерпретации хранилища действий пользователя в формате Array<UserAction> и по составлению документации на его основе.
${FormatTemplates.buildUserActionsFormatPrompt(promptLocale)}
${FormatTemplates.buildTabInfoFormatPrompt(promptLocale)}
Действия пользователя хранятся в следующем порядке: самая свежая запись — первая в массиве.
${skipResponseFormat ? '' : FormatTemplates.buildResponseFormatPrompt('document', promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}`
    }
}

