import {ErrorLog, UserAction} from "../lib/types";
import {TrackedTab} from "./popup-tab-scope";
import {PopupFormat} from "./popup-format";
import {TextUtils} from "../lib/text.ts";

export class PopupRenderer {
    static buildRecentErrors(
        recentErrors: ErrorLog[],
        noErrorsMessage: string,
        copyLabel: string,
        copyShotLabel: string
    ): DocumentFragment {
        const fragment = document.createDocumentFragment()

        if (recentErrors.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.textContent = noErrorsMessage
            fragment.appendChild(empty)
            return fragment
        }

        recentErrors.forEach((error, idx) => {
            const errorItem = document.createElement('div')
            errorItem.className = 'error-item'

            const head = document.createElement('div')
            head.className = 'error-item-head'

            const info = document.createElement('div')

            const errorType = document.createElement('div')
            errorType.className = 'error-type'
            errorType.textContent = PopupFormat.formatErrorType(error.type)

            const errorMessage = document.createElement('div')
            errorMessage.className = 'error-message'
            errorMessage.textContent = TextUtils.truncateText(error.message)

            const errorTime = document.createElement('div')
            errorTime.className = 'error-time'
            errorTime.textContent = PopupFormat.formatTime(error.timestamp)

            info.appendChild(errorType)
            info.appendChild(errorMessage)
            info.appendChild(errorTime)

            const actions = document.createElement('div')
            actions.className = 'error-item-actions'

            const btn = document.createElement('button')
            btn.type = 'button'
            if (error.type === 'ui' && error.screenshotId) {
                btn.className = 'btn btn-secondary btn-inline btn-copy-screenshot'
                btn.dataset.errorIndex = String(idx)
                btn.textContent = copyShotLabel
            } else {
                btn.className = 'btn btn-secondary btn-inline btn-copy-error'
                btn.dataset.errorIndex = String(idx)
                btn.textContent = copyLabel
            }
            actions.appendChild(btn)

            head.appendChild(info)
            head.appendChild(actions)
            errorItem.appendChild(head)
            fragment.appendChild(errorItem)
        })

        return fragment
    }

    static buildRecentActions(
        recentActions: UserAction[],
        noActionsMessage: string
    ): DocumentFragment {
        const fragment = document.createDocumentFragment()

        if (recentActions.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.textContent = noActionsMessage
            fragment.appendChild(empty)
            return fragment
        }

        recentActions.forEach(action => {
            const actionItem = document.createElement('div')
            actionItem.className = 'action-item'

            const actionType = document.createElement('div')
            actionType.className = 'action-type'
            let typeText = `${action.type} in ${action.element}`
            if (action.labelText)
                typeText += ` with label: ${TextUtils.truncateText(action.labelText)}`
            actionType.textContent = typeText

            const actionMessage = document.createElement('div')
            actionMessage.className = 'action-message'
            actionMessage.textContent = TextUtils.truncateText(action.value || action.labelText || action.element || '')

            const actionTime = document.createElement('div')
            actionTime.className = 'action-time'
            actionTime.textContent = PopupFormat.formatTime(action.timestamp)

            actionItem.appendChild(actionType)
            actionItem.appendChild(actionMessage)
            actionItem.appendChild(actionTime)
            fragment.appendChild(actionItem)
        })

        return fragment
    }

    static buildExpectedErrorsList(
        errors: ErrorLog[],
        expectedErrors: Set<string>,
        allErrorsExpected: boolean
    ): DocumentFragment {
        const fragment = document.createDocumentFragment()

        if (!errors.length) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.setAttribute('data-i18n-key', 'popup_no_errors_filtered')
            empty.textContent = 'No errors for current filters.'
            fragment.appendChild(empty)
            return fragment
        }

        errors.forEach(error => {
            const key = PopupFormat.getErrorKey(error)
            const item = document.createElement('div')
            item.className = 'expected-error-item'

            const checkboxWrapper = document.createElement('div')
            checkboxWrapper.className = 'expected-error-checkbox-wrapper'
            if (!allErrorsExpected) {
                const checkbox = document.createElement('input')
                checkbox.type = 'checkbox'
                checkbox.className = 'expected-error-checkbox'
                checkbox.value = key
                if (expectedErrors.has(key))
                    checkbox.checked = true
                checkboxWrapper.appendChild(checkbox)
            }

            const details = document.createElement('div')
            details.className = 'expected-error-details'

            const message = document.createElement('div')
            message.className = 'expected-error-message'
            message.textContent = TextUtils.truncateText(error.message)

            const meta = document.createElement('div')
            meta.className = 'expected-error-meta'
            meta.textContent = `${PopupFormat.formatErrorType(error.type)} \u2022 ${PopupFormat.formatTime(error.timestamp)} \u2022 ${error.tabInfo?.url || ''}`

            details.appendChild(message)
            details.appendChild(meta)

            item.appendChild(checkboxWrapper)
            item.appendChild(details)
            fragment.appendChild(item)
        })

        return fragment
    }

    static buildTabScopeList(
        trackedTabs: TrackedTab[],
        selectedTabIds: Array<number | string>
    ): DocumentFragment {
        const fragment = document.createDocumentFragment()
        const selectedIds = new Set(selectedTabIds.map(id => String(id)))

        trackedTabs.forEach(tab => {
            const item = document.createElement('div')
            item.className = 'tab-scope-item'

            const checkbox = document.createElement('input')
            checkbox.type = 'checkbox'
            checkbox.className = 'checkbox-input tab-scope-checkbox'
            checkbox.dataset.tabId = String(tab.id ?? '')
            if (selectedIds.has(String(tab.id)))
                checkbox.checked = true

            const info = document.createElement('div')

            const titleLine = document.createElement('div')
            titleLine.textContent = tab.title || tab.url || 'Untitled tab'
            if (tab.closed) {
                const closedLabel = document.createElement('span')
                closedLabel.className = 'tab-scope-closed'
                closedLabel.textContent = '(tab closed)'
                titleLine.appendChild(document.createTextNode(' '))
                titleLine.appendChild(closedLabel)
            }

            const metaLine = document.createElement('div')
            metaLine.className = 'tab-scope-meta'
            metaLine.textContent = tab.url || ''

            info.appendChild(titleLine)
            info.appendChild(metaLine)

            item.appendChild(checkbox)
            item.appendChild(info)
            fragment.appendChild(item)
        })

        return fragment
    }
}
