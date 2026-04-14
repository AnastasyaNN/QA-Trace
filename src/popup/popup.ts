import * as browser from "webextension-polyfill";
import {StorageManager} from "../lib/storage";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {ScreenshotUtils} from "../lib/screenshots";
import {ErrorPromptUtils} from "../lib/error-prompt";
import {I18nUtils} from "../lib/i18n";
import {PopupDOM, PopupContext} from "./popup-context";
import {PassphraseModal} from "./popup-passphrase-modal";
import {PopupNavigation} from "./popup-navigation";
import {PromptConfirmation} from "./popup-prompt-confirmation";
import {
    ConfigureView,
    ConfigureViewDeps,
} from "./popup-configure-view";
import {PopupRenderer} from "./popup-render";
import {SavedResponse} from "./popup-saved-response";

class PopupManager {
    private popupContext: PopupContext = PopupDOM.createPopupContext()

    async init(): Promise<void> {
        const extVersion = PopupDOM.getHtmlElement('extVersion')
        I18nUtils.applyI18n()
        if (extVersion)
            extVersion.textContent = `v${browser.runtime.getManifest().version}`
        await this.loadData()
        this.setupEventListeners()
        PassphraseModal.setupPassphraseModal(this.popupContext)
        this.render()
    }

    private async loadData(): Promise<void> {
        try {
            await StorageManager.cleanupOldData()
        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_cleanup_old_data'))
        }

        this.popupContext.storageData = await StorageManager.getStorage()
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

        PopupDOM.getHtmlElement('errorsList')?.addEventListener('click', (event) => {
            const target = event.target as HTMLElement
            const btn = target.closest('.btn-copy-error')
            const shotBtn = target.closest('.btn-copy-screenshot')
            if (btn) {
                const idx = Number((btn as HTMLElement).dataset.errorIndex)
                if (!Number.isNaN(idx))
                    void this.copyRecentErrorDetails(idx)
            } else if (shotBtn) {
                const idx = Number((shotBtn as HTMLElement).dataset.errorIndex)
                if (!Number.isNaN(idx))
                    void this.copyRecentErrorScreenshot(idx)
            }
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
                browser.i18n.getMessage('popup_error_copy_screenshot')
            ))
        }

        void SavedResponse.renderLatestResponse(this.popupContext)
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
        try {
            await navigator.clipboard.writeText(text)
        } catch (error) {
            PopupDOM.showConfigureError(browser.i18n.getMessage('popup_failed_to_copy'))
        }
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
        const text = JSON.stringify(payload, null, 2)
        await this.copyToClipboard(text)
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
            await ScreenshotUtils.copyPngDataUrlToClipboard(shot.imageDataUrl)
        } catch {
            alert(browser.i18n.getMessage('popup_failed_to_copy'))
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const popupManager = new PopupManager()
    await popupManager.init()
})
