import {UserAction} from "../lib/types";
import {ExtensionConfigurationManager} from "../lib/integrations";
import {TextUtils} from "../lib/text";
import {AllowedOrigins} from "../lib/allowed-origins";
import {Messaging} from "../lib/messaging";

// Nearest semantic control when the click target is nested (e.g. SPAN inside BUTTON).
const PRIMARY_INTERACTIVE_TAGS = new Set([
    'a',
    'area',
    'button',
    'input',
    'label',
    'select',
    'summary',
    'textarea',
])

export class UserActionTracker {
    private static instance: UserActionTracker
    private isTracking = false
    private boundHandlers: { event: string; handler: (e: Event) => void }[] = []

    static getInstance(): UserActionTracker {
        if (!UserActionTracker.instance)
            UserActionTracker.instance = new UserActionTracker()
        return UserActionTracker.instance
    }

    startTracking(): void {
        if (this.isTracking)
            return

        this.isTracking = true
        this.setupEventListeners()
    }

    stopTracking(): void {
        if (!this.isTracking)
            return

        for (const { event, handler } of this.boundHandlers) {
            document.removeEventListener(event, handler, true)
        }
        this.boundHandlers = []
        this.isTracking = false
    }

    private setupEventListeners(): void {
        const listeners: { event: string; handler: (e: Event) => void }[] = [
            { event: 'click', handler: this.handleClick.bind(this) },
            { event: 'dblclick', handler: this.handleDblClick.bind(this) },
            { event: 'input', handler: this.handleInput.bind(this) },
            { event: 'change', handler: this.handleChange.bind(this) },
        ]
        for (const { event, handler } of listeners) {
            document.addEventListener(event, handler, true)
        }
        this.boundHandlers = listeners
    }

    private async handleClick(event: Event) {
        const target = event.target as HTMLElement
        if (await this.shouldTrackElement(target)) {
            const recordEl = this.resolvePrimaryInteractiveTarget(target)
            await this.recordAction({
                type: 'click',
                element: recordEl.tagName,
                value: recordEl.textContent?.trim() || '',
                selector: this.getElementSelector(recordEl),
            })
        }
    }

    private async handleDblClick(event: Event) {
        const target = event.target as HTMLElement
        if (await this.shouldTrackElement(target)) {
            const recordEl = this.resolvePrimaryInteractiveTarget(target)
            await this.recordAction({
                type: 'dblclick',
                element: recordEl.tagName,
                value: recordEl.textContent?.trim() || '',
                selector: this.getElementSelector(recordEl),
            })
        }
    }

    private async handleInput(event: Event) {
        const target = event.target as HTMLInputElement
        if (await this.shouldTrackElement(target) && target.value) {
            const value = target.type === 'password'
                ? '******'
                : target.value
            await this.recordAction({
                type: 'input',
                element: target.tagName,
                value,
                selector: this.getElementSelector(target),
            })
        }
    }

    private async handleChange(event: Event) {
        const target = event.target as HTMLSelectElement | HTMLInputElement
        if (await this.shouldTrackElement(target)) {
            const value = target instanceof HTMLInputElement && target.type === 'password'
                ? '******'
                : target.value
            await this.recordAction({
                type: 'change',
                element: target.tagName,
                value,
                selector: this.getElementSelector(target),
            })
        }
    }

    private async shouldTrackElement(element: HTMLElement): Promise<boolean> {
        const extensionConfiguration = await ExtensionConfigurationManager.getConfiguration()
        const currentOrigin = window.location.origin
        if (!AllowedOrigins.isOriginAllowed(currentOrigin, extensionConfiguration.allowedUrls))
            return false
        const tagName = element.tagName.toLowerCase()
        const ignoreTags = ['html', 'body', 'head']
        const ignoreTypes = ['hidden']

        if (ignoreTags.includes(tagName))
            return false

        if (element instanceof HTMLInputElement)
            return !ignoreTypes.includes(element.type)

        return true
    }

    // Walk ancestors for a primary interactive tag; otherwise keep the original target.
    private resolvePrimaryInteractiveTarget(target: HTMLElement): HTMLElement {
        let el: HTMLElement | null = target
        while (el) {
            if (PRIMARY_INTERACTIVE_TAGS.has(el.tagName.toLowerCase()))
                return el
            if (el === document.body || el === document.documentElement)
                break
            el = el.parentElement
        }
        return target
    }

    private getElementSelector(element: HTMLElement): string {
        try {
            if (element.id)
                return `#${CSS.escape(element.id)}`

            if (element.className) {
                const classes = element.className.split(' ').filter(c => c).map(c => CSS.escape(c)).join('.')
                if (classes)
                    return `${element.tagName.toLowerCase()}.${classes}`
            }

            return element.tagName.toLowerCase()
        } catch {
            return element.tagName.toLowerCase()
        }
    }

    private async recordAction(action: Omit<UserAction, 'id' | 'timestamp' | "tabInfo">): Promise<void> {
        const labelText = this.getClosestLabelText(action.selector)
        const limit = await TextUtils.getConfiguredTextLimit()
        const fullAction: Omit<UserAction, "tabInfo"> = {
            timestamp: Date.now(),
            ...action,
            value: TextUtils.truncateText(action.value, limit) || undefined,
            labelText: TextUtils.truncateText(labelText, limit) || undefined
        }

        await Messaging.safeSendMessage({
            type: 'USER_ACTION',
            data: fullAction,
        })
    }

    private getClosestLabelText(selector: string): string {
        let element: Element | null = null
        try {
            element = document.querySelector(selector)
        } catch {
            return ''
        }
        let label: string | undefined | null = element?.textContent

        while (label === '' || label === undefined) {
            element = element?.parentElement || null
            if (element !== null)
                label = element?.textContent
            else
                label = null
        }
        return label || ''
    }

}
