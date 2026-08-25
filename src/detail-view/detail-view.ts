import * as browser from "webextension-polyfill";
import {StorageManager} from "../lib/storage";
import {I18nUtils} from "../lib/i18n";
import {ClipboardUtils} from "../lib/clipboard";
import {ErrorLog, NetworkRequestLog, NetworkExchange, TabInfo} from "../lib/types";
import {ErrorPromptUtils} from "../lib/error-prompt";
import {PopupFormat} from "../popup/popup-format";
import {ICON_COPY} from "../lib/icons";

interface DetailRecord extends NetworkExchange {
    typeLabel: string,
    timestamp?: number,
    tab?: TabInfo,
    message?: string,
    stack?: string,
    screenshotDataUrl?: string
}

class DetailView {
    private el(id: string): HTMLElement | null {
        return document.getElementById(id)
    }

    async render(): Promise<void> {
        I18nUtils.applyI18n()
        const params = new URLSearchParams(window.location.search)
        const type = params.get('type')
        const id = params.get('id')

        const record = id
            ? (type === 'error'
                ? await this.loadError(id)
                : await this.loadNetworkRequest(id))
            : undefined

        if (!record) {
            this.showNotFound()
            return
        }
        this.fill(record)
    }

    private async loadNetworkRequest(id: string): Promise<DetailRecord | undefined> {
        const request = await StorageManager.getNetworkRequestById(id)
        if (!request)
            return undefined
        return this.fromNetworkRequest(request)
    }

    private fromNetworkRequest(request: NetworkRequestLog): DetailRecord {
        return {
            typeLabel: browser.i18n.getMessage('detail_type_request') || 'fetch/XHR',
            timestamp: request.timestamp,
            tab: request.tabInfo,
            ...this.networkExchange(request)
        }
    }

    private networkExchange(src: NetworkExchange): Partial<DetailRecord> {
        return {
            method: src.method,
            urlRequested: src.urlRequested,
            status: src.status,
            requestHeaders: src.requestHeaders,
            requestBody: src.requestBody,
            responseHeaders: src.responseHeaders,
            responseBody: src.responseBody
        }
    }

    private async loadError(id: string): Promise<DetailRecord | undefined> {
        const storage = await StorageManager.getStorage()
        const error = storage.errors.find((candidate) => candidate.id === id)
        if (!error)
            return undefined

        const merged = ErrorPromptUtils.mergeErrorForLocalCopy(error, storage.networkErrorPayloads) as NetworkExchange
        const record: DetailRecord = {
            typeLabel: this.errorTypeLabel(error),
            timestamp: error.timestamp,
            tab: error.tabInfo,
            message: error.message,
            stack: error.stack,
            ...this.networkExchange(merged)
        }

        if (error.screenshotId) {
            const shot = storage.uiErrorScreenshots.find((candidate) => candidate.id === error.screenshotId)
            if (shot?.imageDataUrl)
                record.screenshotDataUrl = shot.imageDataUrl
        }

        return record
    }

    private errorTypeLabel(error: ErrorLog): string {
        return browser.i18n.getMessage(`detail_type_${error.type}`) || error.type
    }

    private fill(record: DetailRecord): void {
        this.setBadge(record.typeLabel)
        this.setText('detailTime', record.timestamp != null ? PopupFormat.formatTime(record.timestamp, true) : '')
        this.setText('detailTab', record.tab?.title || record.tab?.url || '')

        this.toggleSection('messageSection', !!record.message, () => this.setText('detailMessage', record.message || ''))
        this.toggleSection('stackSection', !!record.stack, () => this.setText('detailStack', record.stack || ''))

        const hasRequest = !!(record.method || record.urlRequested || record.requestHeaders || record.requestBody)
        this.toggleSection('requestSection', hasRequest, () => {
            this.setValue('detailMethod', record.method || 'GET')
            this.setValue('detailUrl', record.urlRequested || '')
            this.setValue('detailRequestHeaders', this.formatHeaders(record.requestHeaders))
            this.setValue('detailRequestBody', this.formatBody(record.requestBody))
        })

        const hasResponse = record.status != null || !!record.responseHeaders || !!record.responseBody
        this.toggleSection('responseSection', hasResponse, () => {
            this.setValue('detailStatus', record.status != null ? String(record.status) : '')
            this.setValue('detailResponseHeaders', this.formatHeaders(record.responseHeaders))
            this.setValue('detailResponseBody', this.formatBody(record.responseBody))
        })

        this.toggleSection('screenshotSection', !!record.screenshotDataUrl, () => {
            const img = this.el('detailScreenshot') as HTMLImageElement | null
            if (img && record.screenshotDataUrl)
                img.src = record.screenshotDataUrl
        })

        this.wireCopy('copyRequest', () => PopupFormat.prettyJson({
            method: record.method,
            url: record.urlRequested,
            headers: record.requestHeaders,
            body: record.requestBody
        }))
        this.wireCopy('copyResponse', () => PopupFormat.prettyJson({
            status: record.status,
            headers: record.responseHeaders,
            body: record.responseBody
        }))
    }

    private setBadge(label: string): void {
        const badge = this.el('detailTypeBadge')
        if (badge)
            badge.textContent = label
    }

    private toggleSection(sectionId: string, visible: boolean, fill: () => void): void {
        const section = this.el(sectionId)
        if (!section)
            return
        if (!visible) {
            section.style.display = 'none'
            return
        }
        fill()
    }

    private setText(id: string, value: string): void {
        const node = this.el(id)
        if (node)
            node.textContent = value
    }

    private setValue(id: string, value: string): void {
        const node = this.el(id) as HTMLInputElement | HTMLTextAreaElement | null
        if (node)
            node.value = value
    }

    private formatHeaders(headers?: Record<string, string>): string {
        if (!headers)
            return ''
        return Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\n')
    }

    private formatBody(body?: string): string {
        return body ? PopupFormat.prettyJson(body) : ''
    }

    private wireCopy(buttonId: string, getText: () => string): void {
        const button = this.el(buttonId)
        if (!button)
            return
        button.innerHTML = ICON_COPY
        button.addEventListener('click', async () => {
            if (!(await ClipboardUtils.writeText(getText())))
                alert(browser.i18n.getMessage('popup_failed_to_copy'))
        })
    }

    private showNotFound(): void {
        const content = this.el('detailContent')
        if (content)
            content.style.display = 'none'
        const notFound = this.el('detailNotFound')
        if (notFound)
            notFound.style.display = 'block'
    }
}

document.addEventListener('DOMContentLoaded', () => {
    void new DetailView().render()
})
