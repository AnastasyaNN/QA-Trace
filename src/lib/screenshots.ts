import * as browser from "webextension-polyfill";

export class ScreenshotUtils {
    static async captureVisibleTab(windowId: number): Promise<string | null> {
        try {
            return await browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 })
        } catch (error) {
            console.warn('Failed to capture UI error screenshot', { windowId, error })
            return null
        }
    }

    static async copyScreenshotToClipboard(dataUrl: string): Promise<void> {
        if (typeof ClipboardItem === 'undefined')
            throw new Error('ClipboardItem not supported')
        const blob = await ScreenshotUtils.toPngBlob(dataUrl)
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})])
    }

    private static async toPngBlob(dataUrl: string): Promise<Blob> {
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
}
