export class ClipboardUtils {
    static async writeText(text: string): Promise<boolean> {
        try {
            await navigator.clipboard.writeText(text)
            return true
        } catch {
            return false
        }
    }
}
