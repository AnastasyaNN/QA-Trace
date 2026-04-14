import {StorageManager} from "../lib/storage";
import {UserAction, ErrorLog, TabInfo} from "../lib/types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {ScreenshotUtils} from "../lib/screenshots";
import {AllowedOrigins} from "../lib/allowed-origins";
import {UrlPrivacy} from "../lib/url-privacy";
import {Runtime} from "webextension-polyfill";
import MessageSender = Runtime.MessageSender;

const MAX_TEXT_FIELD_LENGTH = 5000;

const ERROR_BURST_WINDOW_MS = 60_000;
const ERROR_BURST_MAX = 120;
const errorBurstByTab = new Map<string, { count: number; resetAt: number }>();

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
    const redact = configuration.redactUrlQueryParams !== false
    const urlForStorage = redact
        ? (UrlPrivacy.stripUrlQueryAndHashForStorage(url) ?? url ?? '')
        : (url || '')
    const tabInfo: TabInfo = UrlPrivacy.redactTabInfoUrlIfEnabled({
        id: tab.id,
        url: tab.url,
        title: tab.title
    }, redact)
    await StorageManager.addUserAction({
        type: 'open_tab',
        element: 'TAB',
        value: `Open tab — ${urlForStorage}`,
        selector: '[tab]',
        timestamp: Date.now()
    }, tabInfo)
}

function allowErrorBurst(tabId: number | undefined): boolean {
    const key = String(tabId ?? 'none')
    const now = Date.now()
    let bucket = errorBurstByTab.get(key)
    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 1, resetAt: now + ERROR_BURST_WINDOW_MS };
        errorBurstByTab.set(key, bucket)
        return true
    }
    if (bucket.count >= ERROR_BURST_MAX)
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
    const timestamp = Number(input.timestamp)
    if (!input || typeof input !== 'object' || !isValidActionType(input.type)) {
        return null
    }
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
        out[truncateField(k, 200)] = truncateField(String(v ?? ''), MAX_TEXT_FIELD_LENGTH)
    }
    return Object.keys(out).length
        ? out
        : undefined
}

function sanitizeErrorLog(input: any, redactUrlQuery: boolean): Omit<ErrorLog, "tabInfo"> | null {
    const timestamp = Number(input.timestamp)
    if (!input || typeof input !== 'object' || !isValidErrorType(input.type)) {
        return null
    }
    if (!Number.isFinite(timestamp))
        return null
    let urlRequested: string | undefined
    if (input.urlRequested) {
        let u = String(input.urlRequested)
        if (redactUrlQuery) {
            u = UrlPrivacy.stripUrlQueryAndHashForStorage(u) ?? u
        }
        urlRequested = truncateField(u, 2000)
    }
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
        status: typeof input.status === 'number'
            ? input.status
            : undefined,
        method: input.method
            ? truncateField(input.method, 32)
            : undefined,
        urlRequested,
        requestHeaders: truncateHeadersRecord(input.requestHeaders),
        requestBody: input.requestBody
            ? truncateField(input.requestBody, MAX_TEXT_FIELD_LENGTH)
            : undefined,
        responseHeaders: truncateHeadersRecord(input.responseHeaders),
        responseBody: input.responseBody
            ? truncateField(input.responseBody, MAX_TEXT_FIELD_LENGTH)
            : undefined
    }
}

browser.runtime.onMessage.addListener(async (message: any, sender: MessageSender) => {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string')
        return
    if (!isTrustedExtensionSender(sender))
        return
    const configuration = await ExtensionConfigurationManager.getConfiguration()
    const redactUrls = configuration.redactUrlQueryParams !== false
    const tabInfo = UrlPrivacy.redactTabInfoUrlIfEnabled(getTabInfoFromSender(sender), redactUrls)

    switch (message.type) {
        case 'USER_ACTION':
            const userAction = sanitizeUserAction(message.data);
            if (!userAction)
                return
            await StorageManager.addUserAction(userAction, tabInfo);
            break

        case 'ERROR_DETECTED':
            if (!allowErrorBurst(sender.tab?.id))
                return
            const error = sanitizeErrorLog(message.data, redactUrls)
            if (!error)
                return
            await StorageManager.addError(error, tabInfo)
            if (error.type === 'ui' && error.id && sender?.tab?.windowId) {
                await ScreenshotUtils.captureAndStoreUiScreenshot(error.id, tabInfo, sender.tab.windowId);
            }
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
            const redact = configuration.redactUrlQueryParams !== false
            const combined = url || tab.url || ''
            const urlForStorage = redact
                ? (UrlPrivacy.stripUrlQueryAndHashForStorage(combined) ?? combined)
                : combined
            const tabInfo: TabInfo = UrlPrivacy.redactTabInfoUrlIfEnabled({
                id: tab.id,
                url: tab.url,
                title: tab.title
            }, redact)
            await StorageManager.addUserAction({
                type: 'reload_tab',
                element: 'TAB',
                value: `Reload tab — ${urlForStorage}`,
                selector: '[tab]',
                timestamp: Date.now()
            }, tabInfo)
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