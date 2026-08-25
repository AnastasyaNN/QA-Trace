import {StorageManager} from "../lib/storage";
import {UserAction, ErrorLog, TabInfo, NetworkRequestLog} from "../lib/types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {ScreenshotUtils} from "../lib/screenshots";
import {AllowedOrigins} from "../lib/allowed-origins";
import {UrlPrivacy} from "../lib/url-privacy";
import {BodyRedaction} from "../lib/body-redaction";
import {Runtime} from "webextension-polyfill";
import MessageSender = Runtime.MessageSender;

const MAX_TEXT_FIELD_LENGTH = 5000;

const BURST_WINDOW_MS = 60_000;
const ERROR_BURST_MAX = 120;
const NETWORK_REQUEST_BURST_MAX = 600;
const errorBurstByTab = new Map<string, { count: number; resetAt: number }>();
const networkRequestBurstByTab = new Map<string, { count: number; resetAt: number }>();

// Tab ids for which we already recorded `open_tab` (first navigation to an allowed origin).
const openTabLoggedForTabId = new Set<number>();

function getHttpOriginFromUrl(url: string | undefined): string | null {
    if (!url)
        return null
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return null
        return u.origin
    } catch {
        return null
    }
}

async function isUrlAllowedForTracking(url: string | undefined): Promise<boolean> {
    const origin = getHttpOriginFromUrl(url)
    if (!origin)
        return false
    const configuration = await ExtensionConfigurationManager.getConfiguration()
    const allowed = AllowedOrigins.normalizeAllowedUrls(configuration.allowedUrls)
    if (!allowed.length)
        return false
    return AllowedOrigins.isOriginAllowed(origin, allowed)
}

async function maybeRecordOpenTab(tab: browser.Tabs.Tab): Promise<void> {
    const tabId = tab.id
    const url = tab.url;
    if (tabId == null)
        return
    if (!(await isUrlAllowedForTracking(url)))
        return
    if (openTabLoggedForTabId.has(tabId))
        return
    openTabLoggedForTabId.add(tabId)
    const configuration = await ExtensionConfigurationManager.getConfiguration()
    const tabInfo: TabInfo = UrlPrivacy.redactTabInfoUrlIfEnabled({
            id: tab.id,
            url: tab.url,
            title: tab.title
        },
        !!configuration.redactUrlQueryParams,
        false
    )
    await StorageManager.addUserAction({
        type: 'open_tab',
        element: 'TAB',
        value: `Open tab — ${tabInfo.url || ''}`,
        selector: '[tab]',
        timestamp: Date.now()
    }, tabInfo, true)
}

function allowBurst(buckets: Map<string, { count: number; resetAt: number }>, tabId: number | undefined, max: number): boolean {
    const key = String(tabId ?? 'none')
    const now = Date.now()
    let bucket = buckets.get(key)
    if (!bucket || now > bucket.resetAt) {
        bucket = {count: 1, resetAt: now + BURST_WINDOW_MS}
        buckets.set(key, bucket)
        return true
    }
    if (bucket.count >= max)
        return false
    bucket.count += 1
    return true
}

function isTrustedExtensionSender(sender: MessageSender): boolean {
    return sender.id === browser.runtime.id
}

function truncateField(value: unknown, max: number = MAX_TEXT_FIELD_LENGTH): string {
    const text = typeof value === 'string'
        ? value
        : String(value ?? '')
    return text.length > max
        ? text.slice(0, max)
        : text
}

function isValidActionType(value: unknown): value is UserAction['type'] {
    return [
        'click',
        'input',
        'select',
        'change',
        'open_tab',
        'reload_tab',
        'dblclick'
    ].includes(String(value))
}

function isValidErrorType(value: unknown): value is ErrorLog['type'] {
    return ['console', 'network', 'ui', 'user'].includes(String(value))
}

function sanitizeUserAction(input: any): Omit<UserAction, "tabInfo"> | null {
    if (!input || typeof input !== 'object' || !isValidActionType(input.type)) {
        return null
    }
    const timestamp = Number(input.timestamp)
    if (!Number.isFinite(timestamp))
        return null
    return {
        type: input.type,
        element: truncateField(input.element, 200),
        selector: truncateField(input.selector, 500),
        timestamp,
        value: input.value == null
            ? undefined
            : truncateField(input.value, 2000),
        labelText: input.labelText == null
            ? undefined
            : truncateField(input.labelText, 500)
    }
}

function truncateHeadersRecord(input: unknown): Record<string, string> | undefined {
    const out: Record<string, string> = {}
    if (!input || typeof input !== 'object') {
        return undefined
    }
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        // Defense in depth: re-drop sensitive headers in the trusted worker, not only in the page hook.
        if (BodyRedaction.isSensitiveKey(k))
            continue
        out[truncateField(k, 200)] = truncateField(String(v ?? ''), MAX_TEXT_FIELD_LENGTH)
    }
    return Object.keys(out).length
        ? out
        : undefined
}

function sanitizeNetworkFields(input: any, redactUrlQuery: boolean, disableBodyTruncation: boolean) {
    let urlRequested: string | undefined
    if (input.urlRequested) {
        let u = String(input.urlRequested)
        u = UrlPrivacy.redactUrlIfEnabled(u, redactUrlQuery, false) ?? u
        urlRequested = truncateField(u, 2000)
    }
    const bodyMax = disableBodyTruncation ? Infinity : MAX_TEXT_FIELD_LENGTH
    return {
        status: typeof input.status === 'number'
            ? input.status
            : undefined,
        method: input.method
            ? truncateField(input.method, 32)
            : undefined,
        urlRequested,
        requestHeaders: truncateHeadersRecord(input.requestHeaders),
        requestBody: input.requestBody
            ? truncateField(BodyRedaction.redactTokenPatterns(String(input.requestBody)), bodyMax)
            : undefined,
        responseHeaders: truncateHeadersRecord(input.responseHeaders),
        responseBody: input.responseBody
            ? truncateField(BodyRedaction.redactTokenPatterns(String(input.responseBody)), bodyMax)
            : undefined
    }
}

function sanitizeErrorLog(input: any, redactUrlQuery: boolean, disableBodyTruncation: boolean): Omit<ErrorLog, "tabInfo"> | null {
    if (!input || typeof input !== 'object' || !isValidErrorType(input.type)) {
        return null
    }
    const timestamp = Number(input.timestamp)
    if (!Number.isFinite(timestamp))
        return null
    return {
        id: input.id
            ? truncateField(input.id, 100)
            : undefined,
        type: input.type,
        message: truncateField(input.message, MAX_TEXT_FIELD_LENGTH),
        timestamp,
        stack: input.stack
            ? truncateField(input.stack, MAX_TEXT_FIELD_LENGTH)
            : undefined,
        ...sanitizeNetworkFields(input, redactUrlQuery, disableBodyTruncation)
    }
}

function sanitizeNetworkRequest(input: any, redactUrlQuery: boolean, disableBodyTruncation: boolean): Omit<NetworkRequestLog, "tabInfo"> | null {
    if (!input || typeof input !== 'object')
        return null
    const timestamp = Number(input.timestamp)
    if (!Number.isFinite(timestamp))
        return null
    const fields = sanitizeNetworkFields(input, redactUrlQuery, disableBodyTruncation)
    if (!fields.urlRequested)
        return null
    return {
        timestamp,
        ...fields
    }
}

async function handleUserAction(message: any, tabInfo: TabInfo): Promise<void> {
    const userAction = sanitizeUserAction(message.data)
    if (!userAction)
        return
    await StorageManager.addUserAction(userAction, tabInfo)
}

async function handleErrorDetected(message: any, sender: MessageSender, tabInfo: TabInfo, redactQuery: boolean, disableBodyTruncation: boolean): Promise<void> {
    if (!allowBurst(errorBurstByTab, sender.tab?.id, ERROR_BURST_MAX))
        return
    const error = sanitizeErrorLog(message.data, redactQuery, disableBodyTruncation)
    if (!error)
        return
    const windowId = sender.tab?.windowId
    // Capture before recording so a short-lived UI error element is still on screen, then store the
    // error and its screenshot in one atomic write so the screenshot can never be orphaned by the trim.
    const imageDataUrl = error.type === 'ui' && error.id && windowId != null
        ? await ScreenshotUtils.captureVisibleTab(windowId)
        : null
    await StorageManager.addError(error, tabInfo, imageDataUrl ?? undefined)
}

async function handleNetworkRequestDetected(message: any, sender: MessageSender, tabInfo: TabInfo, redactQuery: boolean, disableBodyTruncation: boolean): Promise<void> {
    if (!allowBurst(networkRequestBurstByTab, sender.tab?.id, NETWORK_REQUEST_BURST_MAX))
        return
    const networkRequest = sanitizeNetworkRequest(message.data, redactQuery, disableBodyTruncation)
    if (!networkRequest)
        return
    await StorageManager.addNetworkRequest(networkRequest, tabInfo)
}

browser.runtime.onMessage.addListener(async (message: any, sender: MessageSender) => {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string')
        return
    if (!isTrustedExtensionSender(sender))
        return
    const configuration = await ExtensionConfigurationManager.getConfiguration()
    const redactQuery = !!configuration.redactUrlQueryParams
    const disableBodyTruncation = !!configuration.disableBodyTruncation
    const tabInfo = UrlPrivacy.redactTabInfoUrlIfEnabled(getTabInfoFromSender(sender), redactQuery, false)

    switch (message.type) {
        case 'USER_ACTION':
            await handleUserAction(message, tabInfo)
            break
        case 'ERROR_DETECTED':
            await handleErrorDetected(message, sender, tabInfo, redactQuery, disableBodyTruncation)
            break
        case 'NETWORK_REQUEST_DETECTED':
            await handleNetworkRequestDetected(message, sender, tabInfo, redactQuery, disableBodyTruncation)
            break
        case 'CLEAR_DATA':
            await StorageManager.clearData()
            break
    }
});

browser.tabs.onCreated.addListener((tab) => {
    void maybeRecordOpenTab(tab)
});

browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url != null || changeInfo.status === 'complete') {
        void maybeRecordOpenTab(tab)
    }
});

browser.tabs.onRemoved.addListener((tabId) => {
    openTabLoggedForTabId.delete(tabId)
    errorBurstByTab.delete(String(tabId))
    networkRequestBurstByTab.delete(String(tabId))
});

browser.webNavigation.onCommitted.addListener((details) => {
    if (details.transitionType !== 'reload')
        return
    if (details.frameId !== 0)
        return
    void (async () => {
        const url = details.url
        if (!(await isUrlAllowedForTracking(url)))
            return
        try {
            const tab = await browser.tabs.get(details.tabId)
            const configuration = await ExtensionConfigurationManager.getConfiguration()
            const redactQuery = !!configuration.redactUrlQueryParams
            const tabInfo: TabInfo = UrlPrivacy.redactTabInfoUrlIfEnabled({
                    id: tab.id,
                    url: tab.url,
                    title: tab.title
                },
                redactQuery,
                false
            )
            await StorageManager.addUserAction({
                type: 'reload_tab',
                element: 'TAB',
                value: `Reload tab — ${tabInfo.url || ''}`,
                selector: '[tab]',
                timestamp: Date.now()
            }, tabInfo, true)
        } catch {
            // tab may be gone
        }
    })();
});

browser.runtime.onInstalled.addListener(async function (details) {
    if (details.reason == "install") {
        await browser.tabs.create({
            url: browser.runtime.getURL('src/configuration/configuration.html')
        })
        const configuration = await ExtensionConfigurationManager.getConfiguration()
        await ExtensionConfigurationManager.setConfiguration(configuration)
    } else if (details.reason == "update") {
        //handle an update
        //empty for now
    }

    try {
        await StorageManager.cleanupOldData()
    } catch (error) {
        console.debug(browser.i18n.getMessage('popup_failed_to_cleanup_old_data', 'on startup'), error)
    }
});

browser.alarms.create('cleanup-old-data', {periodInMinutes: 60});

browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cleanup-old-data') {
        try {
            await StorageManager.cleanupOldData();
        } catch (error) {
            console.debug(browser.i18n.getMessage('popup_failed_to_cleanup_old_data'), error);
        }
    }
});

function getTabInfoFromSender(sender: browser.Runtime.MessageSender): TabInfo {
    if (sender?.tab) {
        return {
            id: sender.tab.id,
            url: sender.tab.url,
            title: sender.tab.title
        }
    }

    return {
        id: undefined,
        url: undefined,
        title: undefined
    }
}