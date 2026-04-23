import {UserActionTracker} from "./user-action-tracker";
import {ErrorDetector} from "./error-detector";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {AllowedOrigins} from "../lib/allowed-origins";
import {UrlPrivacy} from "../lib/url-privacy";
import * as browser from "webextension-polyfill";

if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => init().catch(console.error))
else
    init().catch(console.error)

async function init() {
    const extensionConfiguration = await ExtensionConfigurationManager.getConfiguration()
    const currentOrigin = window.location.origin
    if (!AllowedOrigins.isOriginAllowed(currentOrigin, extensionConfiguration.allowedUrls))
        return

    const actionTracker = UserActionTracker.getInstance()
    actionTracker.startTracking()

    const errorsDisabled = (extensionConfiguration.errorsDisabledUrls || []).includes(currentOrigin)
    if (!errorsDisabled) {
        const errorDetector = ErrorDetector.getInstance()
        if (extensionConfiguration.errorMonitoring.console)
            await errorDetector.setupConsoleErrorTracking()
        if (extensionConfiguration.errorMonitoring.network)
            await errorDetector.setupNetworkErrorTracking()
        if (extensionConfiguration.errorMonitoring.ui)
            errorDetector.setupUIErrorTracking(extensionConfiguration.uiErrorSelectors)
    }

    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.configuration)
            return
        void ExtensionConfigurationManager.getConfiguration().then((config) => {
            const currentOrigin = window.location.origin
            if (!AllowedOrigins.isOriginAllowed(currentOrigin, config.allowedUrls))
                actionTracker.stopTracking()
        })
    });

    // @ts-ignore
    browser.runtime.onMessage.addListener((message: any, _sender: browser.Runtime.MessageSender, sendResponse: (response: unknown) => void) => {
        if (message.type === 'GET_PAGE_INFO') {
            void ExtensionConfigurationManager.getConfiguration().then((config) => {
                const redact = config.redactUrlQueryParams !== false
                const href = window.location.href
                const url = redact
                    ? (UrlPrivacy.stripUrlQueryAndHashForStorage(href) ?? href)
                    : href
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