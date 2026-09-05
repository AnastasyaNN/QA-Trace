import {ErrorLog, UserAction, NetworkRequestLog} from "../lib/types";
import {TrackedTab} from "./popup-tab-scope";
import {PopupFormat} from "./popup-format";
import {TextUtils} from "../lib/text.ts";
import {IconName, IconUtils} from "../lib/icons";

export class PopupRenderer {
    static buildRecentErrors(
        recentErrors: ErrorLog[],
        noErrorsMessage: string,
        copyLabel: string,
        copyShotLabel: string,
        browseLabel: string
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

            if (error.type === 'ui' && error.screenshotId)
                actions.appendChild(this.iconButton('btn-copy-screenshot', copyShotLabel, 'screenshot', {errorIndex: String(idx)}))
            else
                actions.appendChild(this.iconButton('btn-copy-error', copyLabel, 'copy', {errorIndex: String(idx)}))
            if (error.id)
                actions.appendChild(this.iconButton('btn-browse-error', browseLabel, 'browse', {errorId: error.id}))

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

        recentActions.forEach(action => fragment.appendChild(this.buildActionItem(action)))

        return fragment
    }

    static buildActionPickerList(
        items: { action: UserAction, index: number }[],
        noActionsMessage: string
    ): DocumentFragment {
        const fragment = document.createDocumentFragment()

        if (items.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.textContent = noActionsMessage
            fragment.appendChild(empty)
            return fragment
        }

        items.forEach(({action, index}) => {
            const item = this.buildActionItem(action, true)
            item.dataset.actionIndex = String(index)
            fragment.appendChild(item)
        })

        return fragment
    }

    static decorateActionPickerItem(item: HTMLElement, included: boolean, isStart: boolean, startLabel: string): void {
        item.classList.toggle('included', included)
        item.classList.toggle('start', isStart)
        const existing = item.querySelector('.action-start-badge')
        if (isStart && !existing) {
            const badge = document.createElement('span')
            badge.className = 'action-start-badge'
            badge.textContent = startLabel
            item.appendChild(badge)
        } else if (!isStart && existing) {
            existing.remove()
        }
    }

    private static buildActionItem(action: UserAction, compact = false): HTMLDivElement {
        const actionItem = document.createElement('div')
        actionItem.className = 'action-item'
        actionItem.title = this.buildActionTooltip(action)

        const actionType = document.createElement('div')
        actionType.className = 'action-type'
        let typeText = `${action.type} in ${action.element}`
        if (!compact && action.labelText)
            typeText += ` with label: ${TextUtils.truncateText(action.labelText)}`
        actionType.textContent = typeText
        actionItem.appendChild(actionType)

        const descriptor = compact
            ? action.labelText || action.value
            : action.value || action.labelText || action.element
        if (descriptor) {
            const actionMessage = document.createElement('div')
            actionMessage.className = 'action-message'
            actionMessage.textContent = TextUtils.truncateText(descriptor)
            actionItem.appendChild(actionMessage)
        }

        const actionTime = document.createElement('div')
        actionTime.className = 'action-time'
        actionTime.textContent = PopupFormat.formatTime(action.timestamp)
        actionItem.appendChild(actionTime)

        return actionItem
    }

    static actionDetailFields(action: UserAction): string[] {
        return [action.labelText, action.value, action.selector, action.tabInfo?.url].filter((v): v is string => !!v)
    }

    private static buildActionTooltip(action: UserAction): string {
        return [
            `${action.type} in ${action.element}`,
            ...this.actionDetailFields(action),
            PopupFormat.formatTime(action.timestamp, true),
        ].join('\n')
    }

    static buildRecentNetworkRequests(
        recentRequests: NetworkRequestLog[],
        noRequestsMessage: string,
        copyLabel: string,
        browseLabel: string
    ): DocumentFragment {
        const fragment = document.createDocumentFragment()

        if (recentRequests.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'empty-state'
            empty.textContent = noRequestsMessage
            fragment.appendChild(empty)
            return fragment
        }

        recentRequests.forEach((request, idx) => {
            const requestItem = document.createElement('div')
            requestItem.className = 'network-request-item'

            const head = document.createElement('div')
            head.className = 'network-request-item-head'

            const info = document.createElement('div')

            const requestType = document.createElement('div')
            requestType.className = 'network-request-type'
            requestType.textContent = `${request.method || 'GET'} ${request.status ?? ''}`.trim()

            const requestUrl = document.createElement('div')
            requestUrl.className = 'network-request-url'
            requestUrl.textContent = TextUtils.truncateText(request.urlRequested || '')

            const requestTime = document.createElement('div')
            requestTime.className = 'network-request-time'
            requestTime.textContent = PopupFormat.formatTime(request.timestamp)

            info.appendChild(requestType)
            info.appendChild(requestUrl)
            info.appendChild(requestTime)

            const actions = document.createElement('div')
            actions.className = 'network-request-item-actions'

            actions.appendChild(this.iconButton('btn-copy-network-request', copyLabel, 'copy', {requestIndex: String(idx)}))
            if (request.id)
                actions.appendChild(this.iconButton('btn-browse-network-request', browseLabel, 'browse', {requestId: request.id}))

            head.appendChild(info)
            head.appendChild(actions)
            requestItem.appendChild(head)
            fragment.appendChild(requestItem)
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

    private static iconButton(className: string, title: string, icon: IconName, data: Record<string, string>): HTMLButtonElement {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `btn-icon btn-inline-icon ${className}`
        button.title = title
        button.setAttribute('aria-label', title)
        button.appendChild(IconUtils.create(icon))
        Object.entries(data).forEach(([key, value]) => {
            button.dataset[key] = value
        })
        return button
    }
}
