import {ExtensionConfiguration} from "./types";
import * as browser from "webextension-polyfill";
import {AllowedOrigins} from "./allowed-origins";

export const DEFAULT_CONFIGURATION: ExtensionConfiguration = {
    allowedUrls: [],
    errorsDisabledUrls: [],
    allNetworkRequestsUrls: [],
    llmEnabled: false,
    errorMonitoring: {
        network: true,
        console: true,
        ui: true,
    },
    uiErrorSelectors: ['div[id^="__error"]'],
    language: 'auto',
    llm: {
        type: 'OpenAI',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-5-nano'
    },
    userActionsLimit: 1000,
    errorsLimit: 50,
    networkRequestsLimit: 150,
    textLengthLimit: 500,
    webhookEnabled: false,
    webhook: {
        url: '',
        username: '',
    },
    redactUrlQueryParams: true,
    redactUrlOrigin: true,
    disableBodyTruncation: false
};

export class ExtensionConfigurationManager {
    private static pending: Promise<ExtensionConfiguration> | null = null

    static async getConfiguration(): Promise<ExtensionConfiguration> {
        if (!this.pending) {
            const read = this.readConfiguration()
            read.catch(() => {
                if (this.pending === read)
                    this.pending = null
            })
            this.pending = read
        }
        return this.pending
    }

    static invalidate(): void {
        this.pending = null
    }

    private static async readConfiguration(): Promise<ExtensionConfiguration> {
        const result: {[key: string]: any} = await browser.storage.local.get(['configuration'])
        const stored: ExtensionConfiguration | undefined = result.configuration
        const merged: ExtensionConfiguration = {
            ...DEFAULT_CONFIGURATION,
            ...(stored || {}),
            llmEnabled: stored?.llmEnabled ?? DEFAULT_CONFIGURATION.llmEnabled,
            webhookEnabled: stored?.webhookEnabled ?? DEFAULT_CONFIGURATION.webhookEnabled,
            errorsDisabledUrls: AllowedOrigins.normalizeAllowedUrls(stored?.errorsDisabledUrls),
            allNetworkRequestsUrls: AllowedOrigins.normalizeAllowedUrls(stored?.allNetworkRequestsUrls),
            redactUrlQueryParams: stored?.redactUrlQueryParams ?? DEFAULT_CONFIGURATION.redactUrlQueryParams,
            redactUrlOrigin: stored?.redactUrlOrigin ?? DEFAULT_CONFIGURATION.redactUrlOrigin,
            llm: {
                ...DEFAULT_CONFIGURATION.llm,
                ...(stored?.llm || {})
            }
        }
        const webhookAny = merged.webhook as { password?: string } | undefined
        if (webhookAny?.password)
            webhookAny.password = ''
        merged.allowedUrls = AllowedOrigins.normalizeAllowedUrls(merged.allowedUrls)
        return merged
    }

    static async setConfiguration(data: ExtensionConfiguration): Promise<void> {
        const sanitized = {
            ...data,
            allowedUrls: AllowedOrigins.normalizeAllowedUrls(data.allowedUrls),
            errorsDisabledUrls: AllowedOrigins.normalizeAllowedUrls(data.errorsDisabledUrls),
            allNetworkRequestsUrls: AllowedOrigins.normalizeAllowedUrls(data.allNetworkRequestsUrls),
            llm: {
                ...data.llm,
                apiKey: ''
            },
            webhook: {
                ...(data.webhook || {})
            }
        } as ExtensionConfiguration & { webhook?: { password?: string } }
        if (sanitized.webhook?.password)
            sanitized.webhook.password = ''
        await browser.storage.local.set({ configuration: sanitized })
        this.invalidate()
        await browser.runtime.sendMessage({type: 'CONFIGURATION_CHANGED'}).catch(() => undefined)
    }
}
