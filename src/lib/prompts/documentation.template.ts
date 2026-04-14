import {DocumentationExample, UserAction} from "../types";
import {type LlmPromptLocale} from "./prompt-i18n";
import {FormatTemplates} from "./formats.template";
import {RequirementsTemplate} from "./requirements.template";

export class DocumentationTemplate {
    static buildDocumentationPrompt(
    actions: UserAction[],
    documentExample: DocumentationExample | undefined,
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `Analyze the storage and describe how to reproduce the following steps:

${JSON.stringify(actions)}

${RequirementsTemplate.buildRequirementsPrompt("document", promptLocale)}

${FormatTemplates.buildDocumentationExamplePrompt(documentExample, promptLocale)}
`
        : `Проанализируй хранилище и опиши, как воспроизвести следующие шаги:

${JSON.stringify(actions)}

${RequirementsTemplate.buildRequirementsPrompt("document", promptLocale)}

${FormatTemplates.buildDocumentationExamplePrompt(documentExample, promptLocale)}
`
    }
}

