import * as browser from "webextension-polyfill";
import {StorageManager} from "../lib/storage";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {ScreenshotUtils} from "../lib/screenshots";
import {ErrorPromptUtils} from "../lib/error-prompt";
import {ClipboardUtils} from "../lib/clipboard";
import {ICON_COPY} from "../lib/icons";
import {I18nUtils} from "../lib/i18n";
import {PopupDOM, PopupContext, PopupElementId} from "./popup-context";
import {PassphraseModal} from "./popup-passphrase-modal";
import {PopupNavigation} from "./popup-navigation";
import {PromptConfirmation} from "./popup-prompt-confirmation";
import {
    ConfigureView,
    ConfigureViewDeps,
} from "./popup-configure-view";
import {PopupRenderer} from "./popup-render";
import {PopupFormat} from "./popup-format";
import {SavedResponse} from "./popup-saved-response";

class PopupManager {
    private popupContext: PopupContext = PopupDOM.createPopupContext()

    async init(): Promise<void> {
        const extVersion = PopupDOM.getHtmlElement('extVersion')
        I18nUtils.applyI18n()
        this.renderCopyIcons()
        if (extVersion)
            extVersion.textContent = `v${browser.runtime.getManifest().version}`
        await this.loadData()
        this.setupEventListeners()
        PassphraseModal.setupPassphraseModal(this.popupContext)
        this.render()
    }

    private renderCopyIcons(): void {
        const ids: PopupElementId[] = ['copyLatestSummary', 'copyLatestDescription', 'copyPrompt', 'copyResponseSummary', 'copyResponseDescription']
        ids.forEach((id) => {
            const button = PopupDOM.getHtmlElement(id)
            if (button)
                button.innerHTML = ICON_COPY
        })
    }

    private async loadData(): Promise<void> {
        try {
            await StorageManager.cleanupOldData()
        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_cleanup_old_data'))
        }

        this.popupContext.storageData = await StorageManager.getStorage(true)
        this.popupContext.configuration = await ExtensionConfigurationManager.getConfiguration()
        PromptConfirmation.updateSendToLLMOrTriggerWebhookVisibility(this.popupContext)
    }

    private setupEventListeners(): void {
        PopupDOM.getHtmlElement('clearData')?.addEventListener('click', async () => {
            await this.clearData()
        })

        PopupDOM.getHtmlElement('configure')?.addEventListener('click', async () => {
            await this.openConfigurationPage()
        })

        PopupDOM.getHtmlElement('getPrompt')?.addEventListener('click', async () => {
            await this.showConfigureView()
        })

        this.delegateClicks('errorsList', [
            {selector: '.btn-browse-error', data: 'errorId', handle: (id) => void this.openDetailView('error', id)},
            {selector: '.btn-copy-error', data: 'errorIndex', handle: this.onIndex((i) => this.copyRecentErrorDetails(i))},
            {selector: '.btn-copy-screenshot', data: 'errorIndex', handle: this.onIndex((i) => this.copyRecentErrorScreenshot(i))}
        ])

        this.delegateClicks('networkRequestsList', [
            {selector: '.btn-browse-network-request', data: 'requestId', handle: (id) => void this.openDetailView('network', id)},
            {selector: '.btn-copy-network-request', data: 'requestIndex', handle: this.onIndex((i) => this.copyNetworkRequestDetails(i))}
        ])

        PopupDOM.getHtmlElement('downloadNetworkRequests')?.addEventListener('click', () => {
            this.downloadNetworkRequests()
        })

        PopupDOM.getHtmlElement('copyLatestSummary')?.addEventListener('click', async () => {
            const summary = PopupDOM.getHtmlElement('latestResponseSummary') as HTMLInputElement
            if (summary)
                await this.copyToClipboard(summary.value)
        })

        PopupDOM.getHtmlElement('copyLatestDescription')?.addEventListener('click', async () => {
            const description = PopupDOM.getHtmlElement('latestResponseDescription') as HTMLTextAreaElement
            if (description)
                await this.copyToClipboard(description.value)
        })
    }

    private delegateClicks(listId: PopupElementId, handlers: Array<{selector: string, data: string, handle: (value: string) => void}>): void {
        PopupDOM.getHtmlElement(listId)?.addEventListener('click', (event) => {
            const target = event.target as HTMLElement
            for (const {selector, data, handle} of handlers) {
                const btn = target.closest(selector) as HTMLElement | null
                if (btn) {
                    const value = btn.dataset[data]
                    if (value != null)
                        handle(value)
                    return
                }
            }
        })
    }

    private onIndex(fn: (index: number) => unknown): (value: string) => void {
        return (value) => {
            const index = Number(value)
            if (!Number.isNaN(index))
                void fn(index)
        }
    }

    private render(): void {
        if (!this.popupContext.storageData)
            return

        const actionsCount = PopupDOM.getHtmlElement('userActionsCount')
        const errorsCount = PopupDOM.getHtmlElement('errorsCount')

        if (actionsCount)
            actionsCount.textContent = this.popupContext.storageData.userActions.length.toString()

        if (errorsCount)
            errorsCount.textContent = this.popupContext.storageData.errors.length.toString()

        const actionsList = PopupDOM.getHtmlElement('actionsList')
        if (actionsList) {
            actionsList.replaceChildren(PopupRenderer.buildRecentActions(
                this.popupContext.storageData.userActions.slice(0, 5),
                browser.i18n.getMessage('popup_no_actions_detected')
            ))
        }

        const errorsList = PopupDOM.getHtmlElement('errorsList')
        if (errorsList) {
            errorsList.replaceChildren(PopupRenderer.buildRecentErrors(
                this.popupContext.storageData.errors.slice(0, 5),
                browser.i18n.getMessage('popup_no_errors_detected'),
                browser.i18n.getMessage('popup_error_copy'),
                browser.i18n.getMessage('popup_error_copy_screenshot'),
                browser.i18n.getMessage('popup_browse')
            ))
        }

        this.renderNetworkRequests()

        void SavedResponse.renderLatestResponse(this.popupContext)
    }

    private renderNetworkRequests(): void {
        if (!this.popupContext.storageData)
            return

        const networkTrackingEnabled = !!this.popupContext.configuration?.allNetworkRequestsUrls?.length
        const networkRequests = this.popupContext.storageData.networkRequests

        PopupDOM.toggleVisible('networkRequestsStatCard', networkTrackingEnabled)
        PopupDOM.toggleVisible('recentNetworkRequestsSection', networkTrackingEnabled)
        PopupDOM.toggleVisible('downloadNetworkRequests', networkRequests.length > 0)

        const networkRequestsCount = PopupDOM.getHtmlElement('networkRequestsCount')
        if (networkRequestsCount)
            networkRequestsCount.textContent = networkRequests.length.toString()

        const networkRequestsList = PopupDOM.getHtmlElement('networkRequestsList')
        if (networkRequestsList) {
            networkRequestsList.replaceChildren(PopupRenderer.buildRecentNetworkRequests(
                networkRequests.slice(0, 5),
                browser.i18n.getMessage('popup_no_network_requests'),
                browser.i18n.getMessage('popup_error_copy'),
                browser.i18n.getMessage('popup_browse')
            ))
        }
    }

    private async clearData(): Promise<void> {
        await browser.runtime.sendMessage({type: 'CLEAR_DATA'})
        await SavedResponse.clearSavedLLMResponse()
        await this.loadData()
        this.render()
    }

    private async openConfigurationPage(): Promise<void> {
        await browser.tabs.create({
            url: browser.runtime.getURL('src/configuration/configuration.html')
        })
    }

    private async openDetailView(type: 'network' | 'error', id: string): Promise<void> {
        await browser.tabs.create({
            url: browser.runtime.getURL(`src/detail-view/detail-view.html?type=${type}&id=${encodeURIComponent(id)}`)
        })
    }

    private async showConfigureView(): Promise<void> {
        PopupNavigation.showConfigureViewDOM()
        const deps: ConfigureViewDeps = {
            loadData: () => this.loadData(),
            showConfigureView: () => this.showConfigureView(),
            copyToClipboard: (text) => this.copyToClipboard(text),
        }
        if (!this.popupContext.configurePopupInitialized) {
            await ConfigureView.initializeConfigureView(this.popupContext, deps)
        } else {
            await ConfigureView.refreshConfigureViewState(this.popupContext, () => this.loadData())
        }
    }

    private async copyToClipboard(text: string): Promise<void> {
        if (!(await ClipboardUtils.writeText(text)))
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_copy'))
    }

    private async copyRecentErrorDetails(errorIndex: number): Promise<void> {
        if (!this.popupContext.storageData)
            return
        const error = this.popupContext.storageData.errors[errorIndex]
        if (!error)
            return

        const payload = ErrorPromptUtils.mergeErrorForLocalCopy(
            error,
            this.popupContext.storageData.networkErrorPayloads || []
        )
        await this.copyToClipboard(PopupFormat.prettyJson(payload))
    }

    private async copyRecentErrorScreenshot(errorIndex: number): Promise<void> {
        if (!this.popupContext.storageData)
            return
        const error = this.popupContext.storageData.errors[errorIndex]
        if (!error || error.type !== 'ui' || !error.screenshotId)
            return
        const shot = this.popupContext.storageData.uiErrorScreenshots.find((s) => s.id === error.screenshotId)
        if (!shot?.imageDataUrl) {
            alert(browser.i18n.getMessage('popup_failed_to_copy'))
            return
        }
        try {
            await ScreenshotUtils.copyScreenshotToClipboard(shot.imageDataUrl)
        } catch {
            alert(browser.i18n.getMessage('popup_failed_to_copy'))
        }
    }

    private async copyNetworkRequestDetails(requestIndex: number): Promise<void> {
        if (!this.popupContext.storageData)
            return
        const request = this.popupContext.storageData.networkRequests[requestIndex]
        if (!request)
            return
        await this.copyToClipboard(PopupFormat.prettyJson(request))
    }

    private downloadNetworkRequests(): void {
        if (!this.popupContext.storageData)
            return
        const requests = this.popupContext.storageData.networkRequests.slice().reverse()
        const json = PopupFormat.prettyJson(requests)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `qa-trace-network-requests-${timestamp}.txt`

        const blob = new Blob([json], {type: 'text/plain'})
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const popupManager = new PopupManager()
    await popupManager.init()
})
