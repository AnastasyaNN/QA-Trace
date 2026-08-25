export class IdUtils {
    static generate(randomLength = 8): string {
        const bytes = crypto.getRandomValues(new Uint8Array(randomLength))
        const random = Array.from(bytes, (byte) => (byte % 36).toString(36)).join('')
        return `${Date.now()}-${random}`
    }
}
