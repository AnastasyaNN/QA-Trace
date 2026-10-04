import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import * as browser from 'webextension-polyfill'

const {store, gate, sendMessage} = vi.hoisted(() => ({
    store: {} as Record<string, any>,
    gate: {hold: false, release: [] as Array<() => void>},
    sendMessage: vi.fn(async () => undefined)
}))

vi.mock('webextension-polyfill', () => ({
    storage: {
        local: {
            get: async (keys: string[]) => {
                const snapshot = {...store}
                if (gate.hold)
                    await new Promise<void>((resolve) => gate.release.push(resolve))
                const out: Record<string, any> = {}
                for (const k of keys)
                    if (k in snapshot)
                        out[k] = snapshot[k]
                return out
            },
            set: async (obj: Record<string, any>) => {
                Object.assign(store, obj)
            }
        }
    },
    runtime: {sendMessage}
}))

import {DEFAULT_CONFIGURATION, ExtensionConfigurationManager} from '../src/lib/integrations'

beforeEach(() => {
    for (const k of Object.keys(store))
        delete store[k]
    gate.hold = false
    gate.release = []
    sendMessage.mockClear()
    ExtensionConfigurationManager.invalidate()
})

afterEach(() => vi.restoreAllMocks())

describe('ExtensionConfigurationManager cache', () => {
    it('shares one storage read between concurrent callers', async () => {
        const get = vi.spyOn(browser.storage.local, 'get')

        const [first, second] = await Promise.all([
            ExtensionConfigurationManager.getConfiguration(),
            ExtensionConfigurationManager.getConfiguration()
        ])

        expect(get).toHaveBeenCalledTimes(1)
        expect(first).toBe(second)
    })

    it('drops a read that an invalidation overtook, so the next caller sees the new value', async () => {
        const get = vi.spyOn(browser.storage.local, 'get')
        gate.hold = true
        const stale = ExtensionConfigurationManager.getConfiguration()
        store.configuration = {userActionsLimit: 7}
        ExtensionConfigurationManager.invalidate()
        gate.hold = false
        gate.release.forEach((resolve) => resolve())

        expect((await stale).userActionsLimit).toBe(1000)
        expect((await ExtensionConfigurationManager.getConfiguration()).userActionsLimit).toBe(7)
        expect(get).toHaveBeenCalledTimes(2)
    })

    it('does not cache a rejected read', async () => {
        const get = vi.spyOn(browser.storage.local, 'get').mockRejectedValueOnce(new Error('boom'))

        await expect(ExtensionConfigurationManager.getConfiguration()).rejects.toThrow('boom')
        expect((await ExtensionConfigurationManager.getConfiguration()).userActionsLimit).toBe(1000)
        expect(get).toHaveBeenCalledTimes(2)
    })

    it('setConfiguration drops the cache and announces the change to the background', async () => {
        const get = vi.spyOn(browser.storage.local, 'get')
        expect((await ExtensionConfigurationManager.getConfiguration()).userActionsLimit).toBe(1000)

        await ExtensionConfigurationManager.setConfiguration({...DEFAULT_CONFIGURATION, userActionsLimit: 7})

        expect((await ExtensionConfigurationManager.getConfiguration()).userActionsLimit).toBe(7)
        expect(get).toHaveBeenCalledTimes(2)
        expect(sendMessage).toHaveBeenCalledTimes(1)
        expect(sendMessage).toHaveBeenCalledWith({type: 'CONFIGURATION_CHANGED'})
    })
})
