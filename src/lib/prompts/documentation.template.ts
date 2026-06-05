import {DocumentationExample, UserAction} from "../types";
import {type LlmPromptLocale} from "./prompt-i18n";
import {FormatTemplates} from "./formats.template";
import {RequirementsTemplate} from "./requirements.template";
import {ErrorPromptUtils} from "../error-prompt";

export class DocumentationTemplate {
    static buildDocumentationPrompt(
    actions: UserAction[],
    documentExample: DocumentationExample | undefined,
    promptLocale: LlmPromptLocale,
    redactOrigin: boolean
): string {
    const actionsForLlm = ErrorPromptUtils.stripActionsForPrompt(actions, redactOrigin)
    return promptLocale === "en"
        ? `Analyze the storage and describe how to reproduce the following steps:

${JSON.stringify(actionsForLlm)}

${RequirementsTemplate.buildRequirementsPrompt("document", promptLocale)}

${FormatTemplates.buildDocumentationExamplePrompt(documentExample, promptLocale)}
`
        : `Проанализируй хранилище и опиши, как воспроизвести следующие шаги:

${JSON.stringify(actionsForLlm)}

${RequirementsTemplate.buildRequirementsPrompt("document", promptLocale)}

${FormatTemplates.buildDocumentationExamplePrompt(documentExample, promptLocale)}
`
    }
}

