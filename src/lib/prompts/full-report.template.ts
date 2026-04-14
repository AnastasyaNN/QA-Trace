import {ErrorLog, TicketExample, UserAction} from "../types";
import {type LlmPromptLocale} from "./prompt-i18n";
import {FormatTemplates} from "./formats.template";
import {RequirementsTemplate} from "./requirements.template";
import {ErrorPromptUtils} from "../error-prompt";

export class FullReportTemplate {
    static buildFullReportPrompt(
    actions: UserAction[],
    errors: ErrorLog[],
    ticketExample: TicketExample | undefined,
    promptLocale: LlmPromptLocale
): string {
    const errorsForLlm = ErrorPromptUtils.stripErrorsForPrompt(errors)
    return promptLocale === "en"
        ? `Analyze the storage and describe what and how was done during test charter:

${JSON.stringify(errorsForLlm)}
${JSON.stringify(actions)}

Rules for the report:
- The output should follow the style of Xray exploratory testing reports (https://www.getxray.app/) and keep close to the structures above.

${RequirementsTemplate.buildRequirementsPrompt("full", promptLocale)}

${FormatTemplates.buildTicketExamplePrompt(ticketExample, promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}
`
        : `Проанализируй хранилище и опиши, что и как было сделано в ходе сессии исследовательского тестирования:

${JSON.stringify(errorsForLlm)}
${JSON.stringify(actions)}

Правила для отчёта:
- Формат вывода должен соответствовать стилю отчётов сессий исследовательского тестирования Xray (https://www.getxray.app/) и быть близким к приведённым выше структурам.

${RequirementsTemplate.buildRequirementsPrompt("full", promptLocale)}

${FormatTemplates.buildTicketExamplePrompt(ticketExample, promptLocale)}
${FormatTemplates.buildLanguageOutputPrompt(promptLocale)}
`
    }
}

