import * as browser from "webextension-polyfill";
import {ConfigDOM} from "./configuration-dom";

export class DynamicFields {
    private static createRemoveButton(): HTMLButtonElement {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('data-i18n-key', 'config_remove')
        button.className = 'btn btn-secondary btn-remove'
        button.textContent = browser.i18n.getMessage('config_remove')
        return button
    }

    static addUrlField(): void {
        const container = ConfigDOM.getHtmlElement("urls-container")
        if (!container)
            return

        const urlEntry = document.createElement('div')
        urlEntry.className = 'url-entry'

        const urlItem = document.createElement('div')
        urlItem.className = 'url-item'

        const input = document.createElement('input')
        input.type = 'url'
        input.placeholder = 'https://example.com'
        input.className = 'input url-input'

        urlItem.appendChild(input)
        urlItem.appendChild(DynamicFields.createRemoveButton())
        urlEntry.appendChild(urlItem)

        const label = document.createElement('label')
        label.className = 'checkbox-item checkbox-label'

        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.className = 'checkbox-input skip-errors-checkbox'

        const span = document.createElement('span')
        span.setAttribute('data-i18n-key', 'config_do_not_monitor_errors_for_URL')
        span.textContent = browser.i18n.getMessage('config_do_not_monitor_errors_for_URL')

        label.appendChild(checkbox)
        label.appendChild(span)
        urlEntry.appendChild(label)

        container.appendChild(urlEntry)
    }

    static addUiErrorField(): void {
        const container = ConfigDOM.getHtmlElement("ui-errors-container")
        if (!container)
            return

        const selectorItem = document.createElement('div')
        selectorItem.className = 'url-item'

        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'input ui-error-input'

        selectorItem.appendChild(input)
        selectorItem.appendChild(DynamicFields.createRemoveButton())
        container.appendChild(selectorItem)
    }

    static removeUrlField(button: HTMLElement): void {
        const urlEntry = button.closest('.url-entry')
        if (urlEntry && ConfigDOM.getHtmlElements("urls").length > 1)
            urlEntry.remove()
    }

    static removeUiErrorField(button: HTMLElement): void {
        const selectorItem = button.closest('.url-item')
        if (selectorItem && ConfigDOM.getHtmlElements("ui-errors").length > 1)
            selectorItem.remove()
    }

    static toggleUiSelectorsVisibility(enabled: boolean): void {
        const section = ConfigDOM.getHtmlElement("uiErrorsSection")
        const addButton = ConfigDOM.getHtmlElement("addUiError") as HTMLButtonElement
        const inputs = ConfigDOM.getHtmlElements("ui-errors")
        if (section)
            section.style.display = enabled ? 'block' : 'none'
        inputs.forEach(input => {
            (input as HTMLInputElement).disabled = !enabled
        })
        if (addButton)
            addButton.disabled = !enabled
    }
}
