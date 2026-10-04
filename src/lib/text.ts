import {ExtensionConfigurationManager} from "./integrations";

export class TextUtils {
    static async getConfiguredTextLimit(): Promise<number> {
        return (await ExtensionConfigurationManager.getConfiguration()).textLengthLimit || 500
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
}
