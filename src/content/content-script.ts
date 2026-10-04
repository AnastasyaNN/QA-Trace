import {UserActionTracker} from "./user-action-tracker";
import {PageMonitor} from "./page-monitor";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {AllowedOrigins} from "../lib/allowed-origins";
import {UrlPrivacy} from "../lib/url-privacy";
import * as browser from "webextension-polyfill";

// Runs at document_start so page hooks are injected before page scripts fire their first
// fetch/XHR. Only DOM-dependent setup (the UI-error observer) waits for <body>.
init().catch(console.error)

function onBodyReady(callback: () => void): void {
    if (document.body)
        callback()
    else
        document.addEventListener('DOMContentLoaded', () => callback(), {once: true})
}

async function init() {
    const extensionConfiguration = await ExtensionConfigurationManager.getConfiguration()
    const currentOrigin = window.location.origin
    if (!AllowedOrigins.isOriginAllowed(currentOrigin, extensionConfiguration.allowedUrls))
        return

    const actionTracker = UserActionTracker.getInstance()
    actionTracker.startTracking()

    const allNetworkRequestsEnabled = (extensionConfiguration.allNetworkRequestsUrls || []).includes(currentOrigin)
    const errorsDisabled = (extensionConfiguration.errorsDisabledUrls || []).includes(currentOrigin)

    if (allNetworkRequestsEnabled || !errorsDisabled) {
        const pageMonitor = PageMonitor.getInstance()
        if (allNetworkRequestsEnabled)
            await pageMonitor.setupFullNetworkTracking()
        if (!errorsDisabled) {
            if (extensionConfiguration.errorMonitoring.console)
                await pageMonitor.setupConsoleErrorTracking()
            if (extensionConfiguration.errorMonitoring.network)
                await pageMonitor.setupNetworkErrorTracking()
            if (extensionConfiguration.errorMonitoring.ui)
                onBodyReady(() => pageMonitor.setupUIErrorTracking(extensionConfiguration.uiErrorSelectors))
        }
    }

    // @ts-ignore
    browser.runtime.onMessage.addListener((message: any, _sender: browser.Runtime.MessageSender, sendResponse: (response: unknown) => void) => {
        if (message.type === 'CONFIGURATION_CHANGED') {
            ExtensionConfigurationManager.invalidate()
            void ExtensionConfigurationManager.getConfiguration().then((config) => {
                if (!AllowedOrigins.isOriginAllowed(window.location.origin, config.allowedUrls))
                    actionTracker.stopTracking()
            })
            return
        }
        if (message.type === 'STORAGE_WARNING') {
            sendResponse(document.visibilityState === 'visible' ? PageMonitor.getInstance().showStorageWarnings(message.warnings) : [])
            return true
        }
        if (message.type === 'GET_PAGE_INFO') {
            void ExtensionConfigurationManager.getConfiguration().then((config) => {
                const href = window.location.href
                const url = UrlPrivacy.redactUrlIfEnabled(
                    href,
                    !!config.redactUrlQueryParams,
                    false
                ) ?? href
                sendResponse({
                    url,
                    title: document.title,
                    timestamp: Date.now(),
                })
            })
            return true
        }
    });
}