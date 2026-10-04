import {ErrorLog, NetworkRequestLog} from "../lib/types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {TextUtils} from "../lib/text";
import {Messaging} from "../lib/messaging";
import {IdUtils} from "../lib/id";
import {STORAGE_WARNING_PERCENT, StorageWarning, isStorageWarning} from "../lib/storage-limits";

export const TOAST_CONTAINER_CLASS = 'qa-trace-toast-container'
const ERROR_TOAST_MS = 6000
const STORAGE_TOAST_MS = 10_000
const TOAST_FADE_MS = 400

export class PageMonitor {
    private static instance: PageMonitor
    private consoleTrackingEnabled = false
    private networkTrackingEnabled = false
    private fullNetworkTrackingEnabled = false
    private uiObservers: MutationObserver[] = []
    private pageHooksReady?: Promise<void>
    private pageMessageListenerAdded = false
    private readonly pageMessageToken = IdUtils.generate(10)
    private toastContainer: HTMLElement | null = null
    private activeUiToastAnchors: WeakMap<HTMLElement, number> = new WeakMap()
    private activeStorageWarnings = new Map<StorageWarning, HTMLElement>()
    private readonly toastLifetimeMs = ERROR_TOAST_MS + TOAST_FADE_MS

    static getInstance(): PageMonitor {
        if (!PageMonitor.instance)
            PageMonitor.instance = new PageMonitor()
        return PageMonitor.instance
    }

    async setupConsoleErrorTracking() {
        if (this.consoleTrackingEnabled)
            return
        this.consoleTrackingEnabled = true
        await this.ensurePageMessageListener()
        await this.syncPageHooksConfig()
    }

    async setupNetworkErrorTracking() {
        if (this.networkTrackingEnabled)
            return
        this.networkTrackingEnabled = true
        await this.ensurePageMessageListener()
        await this.syncPageHooksConfig()
    }

    async setupFullNetworkTracking() {
        if (this.fullNetworkTrackingEnabled)
            return
        this.fullNetworkTrackingEnabled = true
        await this.ensurePageMessageListener()
        await this.syncPageHooksConfig()
    }

    setupUIErrorTracking(selectors: string[] = ['div[id^="__error"]']) {
        const config = {
            childList: true,
            subtree: true
        }

        const callback = (mutationsList: MutationRecord[]) => {
            const groupedByAnchor: Map<HTMLElement, Set<Element>> = new Map()

            for (const mutation of mutationsList) {
                if (mutation.type !== 'childList')
                    continue

                mutation.addedNodes.forEach((node: any) => {
                    if (node.nodeType !== Node.ELEMENT_NODE)
                        return
                    const element = node as Element
                    this.collectElementAndNested(selectors, groupedByAnchor, element)
                })
            }

            (async () => {
                try {
                    const recordPromises = Array.from(groupedByAnchor.entries()).map(
                        ([container, elements]) => {
                            const message = this.buildUiErrorMessage(container, Array.from(elements))
                            return this.recordError({ type: 'ui', message }, container)
                        }
                    )

                    await Promise.all(recordPromises)
                } catch (err) {
                    console.debug('Failed to record UI error', err)
                }
            })()
        }

        const observer = new MutationObserver(callback)

        observer.observe(document.body, config)
        this.uiObservers.push(observer)
        return observer
    }

    private async recordError(error: Omit<ErrorLog, 'id' | 'timestamp' | "tabInfo">, uiElement?: HTMLElement): Promise<void> {
        const errorId = IdUtils.generate(6)
        const fullError: Omit<ErrorLog, "tabInfo"> = {
            id: errorId,
            timestamp: Date.now(),
            ...error,
            message: error.message,
            stack: error.stack
        }
        const displayMessage = TextUtils.truncateText(fullError.message, 200)

        if (error.type === 'ui' && uiElement) {
            if (!this.hasActiveUiToast(uiElement)) {
                this.showToast(displayMessage, error.type)
                this.markUiToast(uiElement)
            }
        } else
            this.showToast(displayMessage, error.type)

        await Messaging.safeSendMessage({
            type: 'ERROR_DETECTED',
            data: fullError,
        })
    }

    private async recordNetworkRequest(request: Omit<NetworkRequestLog, 'timestamp' | 'tabInfo'>): Promise<void> {
        await Messaging.safeSendMessage({
            type: 'NETWORK_REQUEST_DETECTED',
            data: {
                ...request,
                timestamp: Date.now()
            }
        })
    }

    private async ensurePageMessageListener() {
        if (this.pageMessageListenerAdded)
            return
        window.addEventListener('message', (event: MessageEvent) => {
            if (event.source !== window || !event.data || event.data.source !== 'qa-trace')
                return
            if (event.data.token !== this.pageMessageToken)
                return

            const { kind, payload } = event.data
            if (!kind || !payload)
                return

            if (kind === 'console' && this.consoleTrackingEnabled) {
                void this.recordError({
                    type: 'console',
                    message: payload.message,
                    stack: payload.stack
                })
            } else if (kind === 'network' && this.networkTrackingEnabled) {
                void this.recordError({
                    type: 'network',
                    message: payload.message,
                    status: payload.status,
                    method: payload.method,
                    urlRequested: payload.urlRequested,
                    requestHeaders: payload.requestHeaders,
                    requestBody: payload.requestBody,
                    responseHeaders: payload.responseHeaders,
                    responseBody: payload.responseBody
                })
            } else if (kind === 'network-request' && this.fullNetworkTrackingEnabled) {
                void this.recordNetworkRequest({
                    status: payload.status,
                    method: payload.method,
                    urlRequested: payload.urlRequested,
                    requestHeaders: payload.requestHeaders,
                    requestBody: payload.requestBody,
                    responseHeaders: payload.responseHeaders,
                    responseBody: payload.responseBody
                })
            }
        })
        this.pageMessageListenerAdded = true
    }


    /**
     * Injects page-hooks.ts from the extension origin (CSP-safe on strict pages) exactly once.
     * Resolves once the script has loaded (or failed) so config can be posted to a live listener.
     */
    private ensurePageHooksInjected(disableBodyTruncation: boolean): Promise<void> {
        if (this.pageHooksReady)
            return this.pageHooksReady
        this.pageHooksReady = new Promise<void>((resolve) => {
            try {
                const script = document.createElement('script')
                // trackAll/disableBodyTruncation in the fragment let the hooks gate capture and set
                // the body cap at install time, before the async init message arrives.
                const trackAll = this.fullNetworkTrackingEnabled ? '1' : '0'
                const noTruncation = disableBodyTruncation ? '1' : '0'
                script.src = `${browser.runtime.getURL('src/page-hooks/page-hooks.js')}#trackAll=${trackAll}&disableBodyTruncation=${noTruncation}`
                script.async = true
                script.onload = () => {
                    script.remove()
                    resolve()
                }
                script.onerror = () => {
                    console.warn('QA Trace: failed to inject page hooks script')
                    script.remove()
                    resolve()
                }
                const parent = document.head || document.documentElement
                parent.appendChild(script)
            } catch (error) {
                console.warn('QA Trace: failed to initialize page hooks script', error)
                this.pageHooksReady = undefined
                resolve()
            }
        })
        return this.pageHooksReady
    }

    // Re-sends the current runtime flags to the page hooks
    private async syncPageHooksConfig(): Promise<void> {
        try {
            const configuration = await ExtensionConfigurationManager.getConfiguration()
            await this.ensurePageHooksInjected(!!configuration.disableBodyTruncation)
            window.postMessage({
                source: 'qa-trace-init',
                token: this.pageMessageToken,
                stripUrlQuery: !!configuration.redactUrlQueryParams,
                trackAllNetwork: this.fullNetworkTrackingEnabled,
                disableBodyTruncation: !!configuration.disableBodyTruncation
            }, window.location.origin || '*')
        } catch (error) {
            await this.ensurePageHooksInjected(false)
            console.warn('QA Trace: failed to sync page hooks config', error)
        }
    }

    private hasActiveUiToast(element: HTMLElement): boolean {
        const now = Date.now()
        let current: HTMLElement | null = element
        while (current) {
            const expires = this.activeUiToastAnchors.get(current)
            if (expires && expires > now)
                return true
            current = current.parentElement
        }
        return false
    }

    private markUiToast(element: HTMLElement): void {
        this.activeUiToastAnchors.set(element, Date.now() + this.toastLifetimeMs)
    }

    showStorageWarnings(input: unknown): StorageWarning[] {
        return (Array.isArray(input) ? input : []).filter(isStorageWarning).filter((warning) => {
            if (this.activeStorageWarnings.get(warning)?.isConnected)
                return true
            const text = browser.i18n.getMessage('storage_warning_' + warning, String(STORAGE_WARNING_PERCENT))
            const toast = this.appendToast(text, 'qa-trace-storage', STORAGE_TOAST_MS, (hidden) => {
                if (this.activeStorageWarnings.get(warning) === hidden)
                    this.activeStorageWarnings.delete(warning)
            })
            if (toast)
                this.activeStorageWarnings.set(warning, toast)
            return toast !== null
        })
    }

    private showToast(message: string, type: ErrorLog['type']) {
        const safeType = type === 'user'
            ? 'ui'
            : (type || 'ui')
        this.appendToast(message || 'Error detected', `qa-trace-${safeType}`, ERROR_TOAST_MS)
    }

    private appendToast(message: string, className: string, lifetimeMs: number, onHide?: (toast: HTMLElement) => void): HTMLElement | null {
        this.ensureToastContainer()
        if (!this.toastContainer)
            return null

        const toast = document.createElement('div')
        toast.className = `qa-trace-toast ${className}`
        toast.textContent = message
        const hide = () => {
            if (toast.classList.contains('qa-trace-hide'))
                return
            clearTimeout(timer)
            toast.classList.add('qa-trace-hide')
            setTimeout(() => toast.remove(), TOAST_FADE_MS)
            onHide?.(toast)
        }
        const timer = setTimeout(hide, lifetimeMs)
        toast.addEventListener('click', hide, {once: true})
        this.toastContainer.appendChild(toast)
        return toast
    }

    private ensureToastContainer() {
        if (this.toastContainer?.isConnected)
            return
        // Errors can be captured at document_start, before <body> exists; skip the visual
        // toast in that case (the error itself is still recorded via messaging).
        if (!document.body)
            return
        const container = document.createElement('div')
        container.className = TOAST_CONTAINER_CLASS
        document.body.appendChild(container)
        this.toastContainer = container
        this.injectStyles()
    }

    private injectStyles() {
        if (document.getElementById('qa-trace-styles'))
            return
        const style = document.createElement('style')
        style.id = 'qa-trace-styles'
        style.textContent = `
.${TOAST_CONTAINER_CLASS} {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 320px;
  pointer-events: none;
  font-family: Arial, sans-serif;
}
.qa-trace-toast {
  background: #1f2937;
  color: #fff;
  padding: 10px 12px;
  -moz-border-radius: 6px;
  border-radius: 6px;
  -moz-box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.95;
  transition: opacity 0.3s ease, transform 0.3s ease;
  transform: translateY(0);
  pointer-events: auto;
  cursor: pointer;
}
.qa-trace-toast.qa-trace-console { border-left: 3px solid #f59e0b; }
.qa-trace-toast.qa-trace-network { border-left: 3px solid #ef4444; }
.qa-trace-toast.qa-trace-ui { border-left: 3px solid #8b5cf6; }
.qa-trace-toast.qa-trace-storage { background: #214363; }
.qa-trace-hide { opacity: 0; transform: translateY(-6px); }
.qa-trace-inline-error {
  position: absolute;
  background: #ef4444;
  color: #fff;
  padding: 6px 8px;
  -moz-border-radius: 6px;
  border-radius: 6px;
  -moz-box-shadow: 0 3px 10px rgba(0,0,0,0.2);
  box-shadow: 0 3px 10px rgba(0,0,0,0.2);
  font-size: 12px;
  z-index: 2147483646;
  max-width: 260px;
  pointer-events: none;
}
`
        document.head.appendChild(style);
    }

    private buildUiErrorMessage(anchor: HTMLElement, elements: Element[]): string {
        const elementText = elements
            .map(el => (el.textContent || '').trim())
            .find(text => text.length > 0)
        const anchorText = (anchor.textContent || '').trim()
        const descriptor = this.describeElement(anchor)
        const baseText = elementText || anchorText || descriptor
        return `Error detected: ${baseText || 'UI container'}`
    }

    private describeElement(element: HTMLElement): string {
        const idPart = element.id
            ? `#${element.id}`
            : ''
        const classPart = element.className
            ? `.${element.className.toString().split(/\s+/).filter(Boolean).join('.')}`
            : ''
        return `${element.tagName.toLowerCase()}${idPart}${classPart}`
    }

    private collectElementAndNested(selectors: string[], groupedByAnchor: Map<HTMLElement, Set<Element>>, element: Element) {
        if (this.matchesSelectors(selectors, element))
            this.addToGroup(groupedByAnchor, element)

        selectors.forEach(selector => {
            const nestedErrorDivs = element.querySelectorAll(selector)
            nestedErrorDivs.forEach((div: Element) => {
                if (this.matchesSelectors(selectors, div))
                    this.addToGroup(groupedByAnchor, div)
            })
        })
    }

    private addToGroup(groupedByAnchor: Map<HTMLElement, Set<Element>>, element: Element) {
        const anchor = this.findAnchorElement(element)
        if (!anchor)
            return
        const existing = groupedByAnchor.get(anchor) || new Set<Element>()
        existing.add(element)
        groupedByAnchor.set(anchor, existing)
    }

    private findAnchorElement(element: Element): HTMLElement | null {
        const specificContainer = (element.closest('dialog, [role="dialog"], [aria-modal="true"], .modal, .dialog, [data-dialog]') as HTMLElement) || null
        if (specificContainer)
            return specificContainer
        return element.parentElement || (element as HTMLElement)
    }

    private matchesSelectors(selectors: string[], element: Element) {
        return selectors.some(selector => {
            try {
                return element.matches(selector)
            } catch (e) {
                console.warn('Invalid UI error selector ignored:', selector, e)
                return false
            }
        })
    }
}

