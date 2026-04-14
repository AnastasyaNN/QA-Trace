import * as browser from "webextension-polyfill";
import {StorageManager} from "./storage";
import {TabInfo} from "./types";

export class ScreenshotUtils {
    static async captureAndStoreUiScreenshot(
        errorId: string,
        tabInfo: TabInfo,
        windowId: number
    ): Promise<void> {
        try {
            const imageDataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' })
            const screenshotId = ScreenshotUtils.newUiErrorScreenshotId()
            await StorageManager.addUiErrorScreenshotAndAttach(errorId, {
                id: screenshotId,
                errorId,
                tabId: tabInfo.id,
                timestamp: Date.now(),
                imageDataUrl
            })
        } catch (error) {
            console.warn('Failed to capture UI error screenshot', { errorId, windowId, tabId: tabInfo.id, error })
        }
    }

    static async copyPngDataUrlToClipboard(dataUrl: string): Promise<void> {
        if (typeof ClipboardItem === 'undefined')
            throw new Error('ClipboardItem not supported')
        const blob = await ScreenshotUtils.getPngBlobFromDataUrl(dataUrl)
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})])
    }

    private static async getPngBlobFromDataUrl(dataUrl: string): Promise<Blob> {
        const sourceBlob = await (await fetch(dataUrl)).blob()
        if (sourceBlob.type === 'image/png')
            return sourceBlob

        const image = await createImageBitmap(sourceBlob)
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        if (!context) {
            image.close()
            throw new Error('Failed to access screenshot canvas')
        }

        context.drawImage(image, 0, 0)
        image.close()

        const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!converted)
            throw new Error('Failed to convert screenshot to png')
        return converted
    }

    private static newUiErrorScreenshotId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }
}
