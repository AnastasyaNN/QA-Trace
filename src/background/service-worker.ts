import {StorageManager} from "../lib/storage";
import {UserAction, ErrorLog, TabInfo, NetworkRequestLog} from "../lib/types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {ScreenshotUtils} from "../lib/screenshots";
import {AllowedOrigins} from "../lib/allowed-origins";
import {UrlPrivacy} from "../lib/url-privacy";
import {BodyRedaction, MAX_TEXT_FIELD_LENGTH} from "../lib/body-redaction";
import {isStorageWarning, StorageWarning} from "../lib/storage-limits";
import {Runtime} from "webextension-polyfill";
import MessageSender = Runtime.MessageSender;

const BURST_WINDOW_MS = 60_000;
const ERROR_BURST_MAX = 120;
const NETWORK_REQUEST_BURST_MAX = 600;
const CLEANUP_ALARM = 'cleanup-old-data';
const errorBurstByTab = new Map<string, { count: number; resetAt: number }>();
const networkRequestBurstByTab = new Map<string, { count: number; resetAt: number }>();

function sessionSet<T>(key: string) {
    const items = new Set<T>()
    const seeded = browser.storage.session.get(key)
        .then((result) => ((result[key] as T[] | undefined) || []).forEach((item) => items.add(item)))
        .catch(() => undefined)
    const persist = () => void browser.storage.session.set({[key]: [...items]}).catch(() => undefined)
    return {items, seeded, persist}
}

// Tab ids for which we already recorded `open_tab` (first navigation to an allowed origin).
const openTabLogged = sessionSet<number>('openTabLoggedTabIds');
// Storage warnings wait here until a visible tracked tab has shown them as a toast.
const pendingWarnings = sessionSet<StorageWarning>('pendingStorageWarnings');
let lastEventTabId: number | undefined;
let deliveringWarnings: Promise<void> | null = null;

function deliverStorageWarnings(tabId: number | undefined): Promise<void> {
    if (tabId == null || deliveringWarnings)
        return Promise.resolve()
    deliveringWarnings = (async () => {
        await pendingWarnings.seeded
        const flagged = await StorageManager.flaggedWarnings()
        const stale = [...pendingWarnings.items].filter((warning) => !flagged.has(warning))
        stale.forEach((warning) => pendingWarnings.items.delete(warning))
        if (stale.length)
            pendingWarnings.persist()
        if (!pendingWarnings.items.size)
            return
        const warnings = [...pendingWarnings.items]
        const shown = await browser.tabs.sendMessage(tabId, {type: 'STORAGE_WARNING', warnings}).catch(() => [])
        const delivered = (Array.isArray(shown) ? shown : []).filter(isStorageWarning)
        if (!delivered.length)
            return
        delivered.forEach((warning) => pendingWarnings.items.delete(warning))
        pendingWarnings.persist()
    })().finally(() => {
        deliveringWarnings = null
    })
    return deliveringWarnings
}

async function queueStorageWarning(warning: StorageWarning): Promise<void> {
    await pendingWarnings.seeded
    pendingWarnings.items.add(warning)
    pendingWarnings.persist()
    await deliveringWarnings
    await deliverStorageWarnings(lastEventTabId)
}

StorageManager.onWarning = (warning) => void queueStorageWarning(warning)

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
    await openTabLogged.seeded
    if (!(await isUrlAllowedForTracking(url)))
        return
    if (openTabLogged.items.has(tabId))
        return
    openTabLogged.items.add(tabId)
    openTabLogged.persist()
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
        value: `Open tab - ${tabInfo.url || ''}`,
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

const TRACKED_EVENTS = new Set(['USER_ACTION', 'ERROR_DETECTED', 'NETWORK_REQUEST_DETECTED'])

// @ts-ignore
browser.runtime.onMessage.addListener((message: any, sender: MessageSender, sendResponse: (response?: unknown) => void) => {
    const handled = handleMessage(message, sender).catch((error) => console.warn('QA Trace: message handling failed', error))
    if (TRACKED_EVENTS.has(message?.type))
        return false
    void handled.finally(() => sendResponse())
    return true
});

async function handleMessage(message: any, sender: MessageSender): Promise<void> {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string')
        return
    if (!isTrustedExtensionSender(sender))
        return
    if (message.type === 'CONFIGURATION_CHANGED') {
        ExtensionConfigurationManager.invalidate()
        await notifyTabsOfConfigurationChange()
        return
    }
    const configuration = await ExtensionConfigurationManager.getConfiguration()
    const redactQuery = !!configuration.redactUrlQueryParams
    const disableBodyTruncation = !!configuration.disableBodyTruncation
    const tabInfo = UrlPrivacy.redactTabInfoUrlIfEnabled(getTabInfoFromSender(sender), redactQuery, false)
    if (sender.tab?.id != null && TRACKED_EVENTS.has(message.type)) {
        lastEventTabId = sender.tab.id
        void deliverStorageWarnings(lastEventTabId)
    }

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
        case 'CLEANUP_OLD_DATA':
            await StorageManager.cleanupOldData()
            break
    }
}

async function notifyTabsOfConfigurationChange(): Promise<void> {
    const tabs = await browser.tabs.query({url: ['http://*/*', 'https://*/*']})
    await Promise.all(tabs.map((tab) => tab.id == null
        ? undefined
        : browser.tabs.sendMessage(tab.id, {type: 'CONFIGURATION_CHANGED'}).catch(() => undefined)))
}

browser.tabs.onCreated.addListener((tab) => {
    void maybeRecordOpenTab(tab)
});

browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url != null || changeInfo.status === 'complete') {
        void maybeRecordOpenTab(tab)
    }
});

browser.tabs.onRemoved.addListener((tabId) => {
    errorBurstByTab.delete(String(tabId))
    networkRequestBurstByTab.delete(String(tabId))
    void openTabLogged.seeded.then(() => {
        openTabLogged.items.delete(tabId)
        openTabLogged.persist()
    })
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
                value: `Reload tab - ${tabInfo.url || ''}`,
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

    await createCleanupAlarm()
    await runStorageMaintenance()
});

async function runStorageMaintenance(): Promise<void> {
    const tasks: Array<[string, () => Promise<void>]> = [
        ['cleanupOldData', () => StorageManager.cleanupOldData()],
        ['sweepNetworkEntries', () => StorageManager.sweepNetworkEntries()]
    ]
    for (const [name, task] of tasks) {
        try {
            await task()
        } catch (error) {
            console.debug(`QA Trace: ${name} failed`, error)
        }
    }
}

async function createCleanupAlarm(): Promise<void> {
    await browser.alarms.create(CLEANUP_ALARM, {periodInMinutes: 60})
}

async function ensureCleanupAlarm(): Promise<void> {
    if (!(await browser.alarms.get(CLEANUP_ALARM)))
        await createCleanupAlarm()
}

ensureCleanupAlarm().catch((error) => console.debug('QA Trace: could not schedule cleanup', error))

browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === CLEANUP_ALARM)
        await runStorageMaintenance()
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