import {ErrorLog} from "../lib/types";
import * as browser from "webextension-polyfill";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {TextUtils} from "../lib/text";
import {Messaging} from "../lib/messaging";

export class ErrorDetector {
    private static instance: ErrorDetector
    private consoleTrackingEnabled = false
    private networkTrackingEnabled = false
    private uiObservers: MutationObserver[] = []
    private pageHooksInjected = false
    private pageMessageListenerAdded = false
    private readonly pageMessageToken = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
    private toastContainer: HTMLElement | null = null
    private activeUiToastAnchors: WeakMap<HTMLElement, number> = new WeakMap()
    private readonly toastLifetimeMs = 6400

    static getInstance(): ErrorDetector {
        if (!ErrorDetector.instance)
            ErrorDetector.instance = new ErrorDetector()
        return ErrorDetector.instance
    }

    async setupConsoleErrorTracking() {
        if (this.consoleTrackingEnabled)
            return
        this.consoleTrackingEnabled = true
        await this.ensurePageHooksInjected()
        await this.ensurePageMessageListener()
    }

    async setupNetworkErrorTracking() {
        if (this.networkTrackingEnabled)
            return
        this.networkTrackingEnabled = true
        await this.ensurePageHooksInjected()
        await this.ensurePageMessageListener()
    }

    setupUIErrorTracking(selectors: string[] = ['div[id^="__error"]']) {
        const config = {
            childList: true,
            subtree: true
        }

        const callback = (mutationsList: MutationRecord[], observer: MutationObserver) => {
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

            if (groupedByAnchor.size > 0)
                observer.disconnect()
        }

        const observer = new MutationObserver(callback)

        observer.observe(document.body, config)
        this.uiObservers.push(observer)
        return observer
    }

    private async recordError(error: Omit<ErrorLog, 'id' | 'timestamp' | "tabInfo">, uiElement?: HTMLElement): Promise<void> {
        const errorId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

            if (kind === 'console') {
                void this.recordError({
                    type: 'console',
                    message: payload.message,
                    stack: payload.stack
                })
            } else if (kind === 'network') {
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
            }
        })
        this.pageMessageListenerAdded = true
    }


    /**
     * Injects page-hooks.js from the extension origin (CSP-safe on strict pages),
     * then sends runtime init data over window.postMessage.
     */
    private async ensurePageHooksInjected(): Promise<void> {
        if (this.pageHooksInjected)
            return
        this.pageHooksInjected = true

        const hooksUrl = browser.runtime.getURL('src/page-hooks/page-hooks.js')
        try {
            const configuration = await ExtensionConfigurationManager.getConfiguration()
            const stripUrlQuery = configuration.redactUrlQueryParams !== false

            const script = document.createElement('script')
            script.src = hooksUrl
            script.async = true
            script.onload = () => {
                const targetOrigin = window.location.origin || '*'
                window.postMessage({
                    source: 'qa-trace-init',
                    token: this.pageMessageToken,
                    stripUrlQuery
                }, targetOrigin)
                script.remove()
            }
            script.onerror = () => {
                console.warn('QA Trace: failed to inject page hooks script')
                script.remove()
            }
            (document.head || document.documentElement).appendChild(script)
        } catch (error) {
            this.pageHooksInjected = false
            console.warn('QA Trace: failed to initialize page hooks script', error)
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

    private showToast(message: string, type: ErrorLog['type']) {
        this.ensureToastContainer()
        if (!this.toastContainer)
            return

        const toast = document.createElement('div')
        const safeType = type === 'user'
            ? 'ui'
            : (type || 'ui')
        const safeMessage = message || 'Error detected'
        toast.className = `qa-trace-toast qa-trace-${safeType}`
        toast.textContent = safeMessage

        this.toastContainer.appendChild(toast)
        setTimeout(() => {
            toast.classList.add('qa-trace-hide')
            setTimeout(() => toast.remove(), 400)
        }, 6000)
    }

    private ensureToastContainer() {
        if (this.toastContainer)
            return
        const container = document.createElement('div')
        container.className = 'qa-trace-toast-container'
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
.qa-trace-toast-container {
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
}
.qa-trace-toast.qa-trace-console { border-left: 3px solid #f59e0b; }
.qa-trace-toast.qa-trace-network { border-left: 3px solid #ef4444; }
.qa-trace-toast.qa-trace-ui { border-left: 3px solid #8b5cf6; }
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

