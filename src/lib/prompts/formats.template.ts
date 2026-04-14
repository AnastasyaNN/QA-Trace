import {type LlmPromptLocale} from "./prompt-i18n";
import {DocumentationExample, TicketExample} from "../types";
import {ConfigurePopupMode} from "../../popup/popup-configure-types";

export class FormatTemplates {
    static buildUserActionsFormatPrompt(
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `Where UserAction has the following format:
${getJson()}

where:
'type' is action type
'element' is HTML type in the DOM (span, div, etc.)
'value' is value entered in the input, value on button, etc.
'timestamp' is local time when action was tracked
'url' is url where action was performed
'selector' is selector that can be used to find the element in the DOM
'tabInfo' is tab information
'labelText' is label for input or button. The value could be the closest label or value from element itself. It works for elements located by id, but if 'selector' isn't by id, 'labelText' could have wrong value, then 'value' should be used.`
        : `Где UserAction имеет следующий формат:
${getJson()}

где:
'type' - тип действия
'element' - HTML тип элемента в DOM (span, div, etc.)
'value' - значение, введённое в поле ввода, имя кнопки и т.д.
'timestamp' - локальное время занесения действия в хранилище
'url' - url, где было выполнено действие
'selector' - селектор для поиска элемента в DOM
'tabInfo' - информация о вкладке
'labelText' - метка для поля ввода или кнопки. Value может относится к ближайшей метке или самому элементу. Работает для элементов, с селектором по id, но если 'selector' - не id, 'labelText' может иметь неверное значение, тогда используй 'value'.
`

    function getJson() {
        return JSON.stringify(`{
    type: 'click' | 'input' | 'select' | 'change' | 'open_tab' | 'reload_tab' | 'dblclick',
    element: string,
    value?: string,
    timestamp: number,
    url: string,
    selector: string,
    tabInfo?: TabInfo,
    labelText?: string
}`)
    }
}

    static buildErrorLogFormatPrompt(
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `ErrorLog has the following format:
${getJson()}

where:
'type' is error type
'message' is error message
'timestamp' is local time when error was tracked
'url': is url where error occurred
'tabInfo' is tab information`
        : `ErrorLog имеет следующий формат:
${getJson()}
где:
'type' - тип ошибки
'message' - сообщение об ошибке
'timestamp' - локальное время занесения ошибки в хранилище
'url': - url, где была выявлена ошибка
'tabInfo' - информация о вкладке
`

    function getJson() {
        return JSON.stringify(`{
    type: 'console' | 'network' | 'ui' | 'user',
    message: string,
    timestamp: number,
    url: string,
    tabInfo?: TabInfo,
    stack?: string,
    status?: number,
    method?: string,
    urlRequested?: string
}`)
    }
}

    static buildTabInfoFormatPrompt(
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `TabInfo has the following format:
${getJson()}`
        : `TabInfo имеет следующий формат:
${getJson()}
`

    function getJson() {
        return JSON.stringify(`{
    id: number,
    url: string,
    title: string
}`)
    }
}

    static buildResponseFormatPrompt(
    mode: ConfigurePopupMode,
    promptLocale: LlmPromptLocale
): string {
    let summaryText, descriptionText
    switch (mode) {
        case 'steps':
            summaryText = promptLocale === "en"
                ? "short title"
                : "короткое описание"
            descriptionText = promptLocale === "en"
                ? "detailed description"
                : "подробное описание"
            break
        case 'document':
            summaryText = promptLocale === "en"
                ? "title"
                : "заголовок"
            descriptionText = promptLocale === "en"
                ? "detailed description"
                : "подробное описание"
            break
        case 'full':
            summaryText = promptLocale === "en"
                ? "overview"
                : "общее описание"
            descriptionText = promptLocale === "en"
                ? "exploratory testing report"
                : "отчёт о сессии исследовательского тестирования"
            break
    }
    return promptLocale === "en"
        ? `Return response strictly as JSON with the following shape (no extra text):
{"summary": "<${summaryText}>", "description": "<${descriptionText}>"}.`
        : `Верни ответ точно в следующем JSON формате (без дополнительного текста):
{"summary": "<${summaryText}>", "description": "<${descriptionText}>"}. НЕ МЕНЯЙ язык для формата!`
}

    static buildLanguageOutputPrompt(
    promptLocale: LlmPromptLocale
): string {
    return promptLocale === "en"
        ? `Provide all output in English language.`
        : `Предоставь результат полностью на Русском языке.`
}

    static buildTicketExamplePrompt(
    ticketExample: TicketExample | undefined,
    promptLocale: LlmPromptLocale
): string {
    if (!ticketExample)
        return ''
    return promptLocale === "en"
        ? `Example of Jira ticket: 
Summary: ${ticketExample.summary}
Description: ${ticketExample.description}`
        : `Пример Jira тикета:
Краткое описание: ${ticketExample.summary}
Описание: ${ticketExample.description}`
}

    static buildDocumentationExamplePrompt(
    documentationExample: DocumentationExample | undefined,
    promptLocale: LlmPromptLocale
): string {
    if (!documentationExample)
        return ''
    return promptLocale === "en"
        ? `Example of Documentation:
Title: ${documentationExample?.title}
Steps: ${documentationExample?.steps}`
        : `Пример сценария для документации:
Заголовок: ${documentationExample?.title}
Шаги: ${documentationExample?.steps}`
    }
}

