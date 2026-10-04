export const STORAGE_CAP_BYTES = 9_500_000
const SHED_FLOOR_BYTES = 1_500_000
export const MAX_STORED_RESPONSE_BYTES = (STORAGE_CAP_BYTES - SHED_FLOOR_BYTES) / 2
export const STORAGE_NOTICE_PERCENT = 80
export const STORAGE_WARNING_PERCENT = 90
export const STORAGE_WARNINGS = ['high', 'full', 'failed'] as const
export type StorageWarning = typeof STORAGE_WARNINGS[number]
export type StorageUsage = {bytes: number, percent: number, userActions: number, errors: number, requests: number}
const encoder = new TextEncoder()

export function isStorageWarning(value: unknown): value is StorageWarning {
    return (STORAGE_WARNINGS as readonly unknown[]).includes(value)
}

export function byteLength(value: string): number {
    return encoder.encode(value).length
}

export function usagePercentOf(bytes: number, cap: number): number {
    return Math.min(100, Math.round(100 * bytes / cap))
}

export function formatBytes(bytes: number): string {
    const kb = Math.round(bytes / 1_000)
    if (kb >= 1_000)
        return (bytes / 1_000_000).toFixed(1) + ' MB'
    if (bytes >= 1_000)
        return kb + ' KB'
    return bytes + ' B'
}
