import {type LlmPromptLocale} from "./prompt-i18n";
import {FormatTemplates} from "./formats.template";

export class SystemErrorTemplate {
    static buildSystemErrorPrompt(
    skipResponseFormat: boolean = false,
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `You are an expert in interpretation of user actions storage in the following format Array<UserAction>, errors storage in the format Array<Error> and generation of Jira ticket from it.
${FormatTemplates.buildUserActionsFormatPrompt(promptLocale)}
${FormatTemplates.buildErrorLogFormatPrompt(promptLocale)}
${FormatTemplates.buildTabInfoFormatPrompt(promptLocale)}

User actions and errors are stored in the following order: the recent one is the first one in the array.
${skipResponseFormat ? '' : FormatTemplates.buildResponseFormatPrompt('steps', promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}`
        : `Ты — эксперт по интерпретации хранилища действий пользователя в формате Array<UserAction>, хранилища ошибок в формате Array<Error> и по формированию тикета Jira на их основе.
${FormatTemplates.buildUserActionsFormatPrompt(promptLocale)}
${FormatTemplates.buildErrorLogFormatPrompt(promptLocale)}
${FormatTemplates.buildTabInfoFormatPrompt(promptLocale)}

Действия пользователя и ошибки хранятся в следующем порядке: самая свежая запись — первая в массиве.
${skipResponseFormat ? '' : FormatTemplates.buildResponseFormatPrompt('steps', promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}`
    }
}

