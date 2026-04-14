import {ExtensionConfigurationManager} from "./integrations";
import * as browser from "webextension-polyfill";

export class TextUtils {
    private static cachedTextLimit: number | null = null
    private static textLimitListenerRegistered = false

    static async getConfiguredTextLimit(): Promise<number> {
        TextUtils.ensureTextLimitListener()
        if (TextUtils.cachedTextLimit !== null)
            return TextUtils.cachedTextLimit
        const configuration = await ExtensionConfigurationManager.getConfiguration()
        TextUtils.cachedTextLimit = configuration.textLengthLimit || 500
        return TextUtils.cachedTextLimit
    }

    static truncateText(value: string | undefined | null, limit: number = 100): string {
        if (!value)
            return ''
        if (!limit || limit <= 0)
            return value
        return value.length > limit
            ? `${value.substring(0, limit)}...`
            : value
    }

    private static ensureTextLimitListener(): void {
        if (TextUtils.textLimitListenerRegistered)
            return
        TextUtils.textLimitListenerRegistered = true
        browser.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes.configuration)
                TextUtils.cachedTextLimit = null
        })
    }
}
