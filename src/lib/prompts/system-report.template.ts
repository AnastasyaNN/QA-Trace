import {type LlmPromptLocale} from "./prompt-i18n";
import {FormatTemplates} from "./formats.template";

export class SystemReportTemplate {
    static buildSystemReportPrompt(
    skipResponseFormat: boolean = false,
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `You are an expert in interpretation of user actions storage in the following format Array<UserAction>, errors storage in the format Array<Error> and generation of exploratory testing report from it.
${FormatTemplates.buildUserActionsFormatPrompt(promptLocale)}
${FormatTemplates.buildErrorLogFormatPrompt(promptLocale)}
${FormatTemplates.buildTabInfoFormatPrompt(promptLocale)}

User actions and errors are stored in the following order: the recent one is the first one in the array.
User actions were executed by QA Engineer during test charter.

Rules for the report:
- Shape the output to be similar to Xray exploratory testing tool reports with clear summary and detailed narrative aligned to the provided structures.
${skipResponseFormat ? '' : FormatTemplates.buildResponseFormatPrompt('full', promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}`
        : `Ты — эксперт по интерпретации хранилища действий пользователя в формате Array<UserAction>, хранилища ошибок в формате Array<Error> и по составлению отчёта сессии исследовательского тестирования.
${FormatTemplates.buildUserActionsFormatPrompt(promptLocale)}
${FormatTemplates.buildErrorLogFormatPrompt(promptLocale)}
${FormatTemplates.buildTabInfoFormatPrompt(promptLocale)}

Действия пользователя и ошибки хранятся в следующем порядке: самая свежая запись — первая в массиве.
Действия пользователя выполнены QA-инженером в ходе сессии исследовательского тестирования.

Правила для отчёта:
- Сформируй вывод по образцу отчётов инструмента исследовательского тестирования Xray: чёткое резюме и развёрнутое повествование в соответствии с указанными структурами.
${skipResponseFormat ? '' : FormatTemplates.buildResponseFormatPrompt('full', promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}`
    }
}
