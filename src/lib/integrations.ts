import {ExtensionConfiguration} from "./types";
import * as browser from "webextension-polyfill";
import {AllowedOrigins} from "./allowed-origins";

export const DEFAULT_CONFIGURATION: ExtensionConfiguration = {
    allowedUrls: [],
    errorsDisabledUrls: [],
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
    textLengthLimit: 500,
    webhookEnabled: false,
    webhook: {
        url: '',
        username: '',
    },
    redactUrlQueryParams: true,
};

export class ExtensionConfigurationManager {
    private static cachedConfiguration: ExtensionConfiguration | null = null
    private static listenerRegistered = false

    private static ensureStorageListener(): void {
        if (this.listenerRegistered)
            return
        this.listenerRegistered = true
        browser.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes.configuration) {
                this.cachedConfiguration = null
            }
        });
    }

    static async getConfiguration(): Promise<ExtensionConfiguration> {
        this.ensureStorageListener()
        if (this.cachedConfiguration)
            return this.cachedConfiguration
        const result: {[key: string]: any} = await browser.storage.local.get(['configuration'])
        const stored: ExtensionConfiguration | undefined = result.configuration
        const merged: ExtensionConfiguration = {
            ...DEFAULT_CONFIGURATION,
            ...(stored || {}),
            llmEnabled: stored?.llmEnabled ?? DEFAULT_CONFIGURATION.llmEnabled,
            webhookEnabled: stored?.webhookEnabled ?? DEFAULT_CONFIGURATION.webhookEnabled,
            errorsDisabledUrls: AllowedOrigins.normalizeAllowedUrls(stored?.errorsDisabledUrls),
            redactUrlQueryParams: stored?.redactUrlQueryParams ?? DEFAULT_CONFIGURATION.redactUrlQueryParams,
            llm: {
                ...DEFAULT_CONFIGURATION.llm,
                ...(stored?.llm || {})
            }
        }
        const webhookAny = merged.webhook as { password?: string } | undefined
        if (webhookAny?.password)
            webhookAny.password = ''
        merged.allowedUrls = AllowedOrigins.normalizeAllowedUrls(merged.allowedUrls)
        this.cachedConfiguration = merged
        return merged
    }

    static async setConfiguration(data: ExtensionConfiguration): Promise<void> {
        const sanitized = {
            ...data,
            allowedUrls: AllowedOrigins.normalizeAllowedUrls(data.allowedUrls),
            errorsDisabledUrls: AllowedOrigins.normalizeAllowedUrls(data.errorsDisabledUrls),
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
    }
}
