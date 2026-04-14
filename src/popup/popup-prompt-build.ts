import {ErrorLog, ExtensionConfiguration, TabInfo, UserAction} from "../lib/types";
import {ErrorStepsTemplate} from "../lib/prompts/error-steps.template";
import {FullReportTemplate} from "../lib/prompts/full-report.template";
import {DocumentationTemplate} from "../lib/prompts/documentation.template";
import {SystemReportTemplate} from "../lib/prompts/system-report.template";
import {SystemErrorTemplate} from "../lib/prompts/system-error.template";
import {SystemDocumentationTemplate} from "../lib/prompts/system-documentation.template";
import {PopupLanguage} from "./popup-language";

export class PromptBuilder {
    static buildReportUserPrompt(
        actions: UserAction[],
        errors: ErrorLog[],
        configuration: ExtensionConfiguration
    ): string {
        return FullReportTemplate.buildFullReportPrompt(
            actions,
            errors,
            configuration.ticketExample,
            PopupLanguage.getResolvedLanguageCode(configuration)
        );
    }

    static buildErrorStepsUserPrompt(
        actions: UserAction[],
        errors: ErrorLog[],
        configuration: ExtensionConfiguration
    ): string {
        return ErrorStepsTemplate.buildErrorStepsPrompt(
            actions,
            errors,
            configuration.ticketExample,
            PopupLanguage.getResolvedLanguageCode(configuration)
        );
    }

    static buildDocumentationUserPrompt(
        actions: UserAction[],
        configuration: ExtensionConfiguration
    ): string {
        return DocumentationTemplate.buildDocumentationPrompt(
            actions,
            configuration.documentationExample,
            PopupLanguage.getResolvedLanguageCode(configuration)
        );
    }

    static buildSystemPromptForReport(
        configuration: ExtensionConfiguration,
        skipResponseFormat = false
    ): string {
        return SystemReportTemplate.buildSystemReportPrompt(skipResponseFormat, PopupLanguage.getResolvedLanguageCode(configuration));
    }

    static buildSystemPromptForError(
        configuration: ExtensionConfiguration,
        skipResponseFormat = false
    ): string {
        return SystemErrorTemplate.buildSystemErrorPrompt(skipResponseFormat, PopupLanguage.getResolvedLanguageCode(configuration))
    }

    static buildSystemPromptForDocumentation(
        configuration: ExtensionConfiguration,
        skipResponseFormat = false
    ): string {
        return SystemDocumentationTemplate.buildSystemDocumentationPrompt(skipResponseFormat, PopupLanguage.getResolvedLanguageCode(configuration))
    }

    static buildUserDefinedErrorLog(description: string, tabInfo: TabInfo): ErrorLog | null {
        const trimmed = description.trim()
        if (!trimmed)
            return null
        return {
            type: 'user',
            message: trimmed,
            timestamp: Date.now(),
            tabInfo,
        }
    }
}
