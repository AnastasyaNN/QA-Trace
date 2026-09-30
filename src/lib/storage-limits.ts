export const STORAGE_CAP_BYTES = 9_500_000
const SHED_FLOOR_BYTES = 1_500_000
export const MAX_STORED_RESPONSE_BYTES = (STORAGE_CAP_BYTES - SHED_FLOOR_BYTES) / 2

export function byteLength(value: string): number {
    return new TextEncoder().encode(value).length
}
