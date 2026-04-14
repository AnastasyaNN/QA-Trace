import {ErrorLog, TicketExample, UserAction} from "../types";
import {ErrorPromptUtils} from "../error-prompt";
import {type LlmPromptLocale} from "./prompt-i18n";
import {FormatTemplates} from "./formats.template";
import {RequirementsTemplate} from "./requirements.template";

export class ErrorStepsTemplate {
    static buildErrorStepsPrompt(
    actions: UserAction[],
    errors: ErrorLog[],
    ticketExample: TicketExample | undefined,
    promptLocale: LlmPromptLocale
): string {
    const errorsForLlm = ErrorPromptUtils.stripErrorsForPrompt(errors)
    return promptLocale === "en"
        ? `Analyze the storage and describe how to reproduce the following errors:

${JSON.stringify(errorsForLlm)}
${JSON.stringify(actions)}

${RequirementsTemplate.buildRequirementsPrompt("steps", promptLocale)}

${FormatTemplates.buildTicketExamplePrompt(ticketExample, promptLocale)}
`
        : `Проанализируй хранилище и опиши, как воспроизвести следующие ошибки:

${JSON.stringify(errorsForLlm)}
${JSON.stringify(actions)}

${RequirementsTemplate.buildRequirementsPrompt("steps", promptLocale)}

${FormatTemplates.buildTicketExamplePrompt(ticketExample, promptLocale)}
`
    }
}

