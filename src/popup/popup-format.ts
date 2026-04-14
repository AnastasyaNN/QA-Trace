import {ErrorLog, UserAction} from "../lib/types";

export class PopupFormat {
    static formatErrorType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1)
}

    static formatTime(timestamp: number, withDate = false): string {
    return withDate
        ? new Date(timestamp).toLocaleString()
        : new Date(timestamp).toLocaleTimeString()
}

    static hasInactivityBreaks(actions: UserAction[]): boolean {
    if (actions.length < 2)
        return false
    const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp)
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].timestamp - sorted[i - 1].timestamp > 15 * 60 * 1000)
            return true
    }
    return false
}

    static getErrorKey(error: ErrorLog): string {
    return `${error.timestamp}-${error.message}-${error.tabInfo?.url || ''}`
    }
}