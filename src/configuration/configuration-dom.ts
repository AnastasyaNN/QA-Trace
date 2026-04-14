export type ConfigElementId =
    'urls-container' | 'ui-errors-container' | 'passphraseContainer' | 'apiUrlContainer' | 'uiErrorsSection'
    | 'monitorNetwork' | 'monitorConsole' | 'monitorUI'
    | 'enableLLM' | 'enableWebhook' | 'integrationNone'
    | 'llmType' | 'apiUrl' | 'llmKey' | 'llmModel' | 'passphrase'
    | 'webhookUsername' | 'webhookPassword' | 'webhookUrl'
    | 'languageSelect' | 'summaryTicketExample' | 'descriptionTicketExample'
    | 'titleDocumentationExample' | 'stepsDocumentationExample'
    | 'userActionsLimit' | 'errorsLimit' | 'textLengthLimit' | 'redactUrlQueryParams'
    | 'finishBtn' | 'addUrl' | 'addUiError'

export type ConfigElementsId = 'urls' | 'ui-errors' | 'intObjects'

export class ConfigDOM {
    static getHtmlElements(element: ConfigElementsId): NodeListOf<Element> {
        switch (element) {
            case "urls":
                return document.querySelectorAll('.url-input')
            case "ui-errors":
                return document.querySelectorAll('.ui-error-input')
            case "intObjects":
                return document.querySelectorAll('input[name="integrationOption"]')
        }
    }

    static getHtmlElement(element: ConfigElementId): HTMLElement | null {
        return document.getElementById(element)
    }
}
