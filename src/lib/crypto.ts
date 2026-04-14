import {EncryptedPassword} from "./types";

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class CryptoUtils {
    static async encryptSecret(secret: string, passphrase: string): Promise<EncryptedPassword> {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const salt = crypto.getRandomValues(new Uint8Array(16))
        const key = await CryptoUtils.deriveKey(passphrase, salt)
        const ciphertextBuffer = await crypto.subtle.encrypt(
            {name: 'AES-GCM', iv: CryptoUtils.toArrayBuffer(iv)},
            key,
            encoder.encode(secret)
        )

        return {
            ciphertext: CryptoUtils.toBase64(new Uint8Array(ciphertextBuffer)),
            iv: CryptoUtils.toBase64(iv),
            salt: CryptoUtils.toBase64(salt)
        }
    }

    static async decryptSecret(encrypted: EncryptedPassword, passphrase: string): Promise<string> {
        const iv = CryptoUtils.fromBase64(encrypted.iv)
        const salt = CryptoUtils.fromBase64(encrypted.salt)
        const ciphertext = CryptoUtils.fromBase64(encrypted.ciphertext)
        const key = await CryptoUtils.deriveKey(passphrase, salt)
        const plaintextBuffer = await crypto.subtle.decrypt(
            {name: 'AES-GCM', iv: CryptoUtils.toArrayBuffer(iv)},
            key,
            CryptoUtils.toArrayBuffer(ciphertext)
        )
        return decoder.decode(plaintextBuffer)
    }

    private static toBase64(bytes: Uint8Array): string {
        let binary = ''
        bytes.forEach((b) => binary += String.fromCharCode(b))
        return btoa(binary)
    }

    private static fromBase64(value: string): Uint8Array {
        const binary = atob(value)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
        }
        return bytes
    }

    private static toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }

    private static async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(passphrase),
            {name: 'PBKDF2'},
            false,
            ['deriveKey']
        )

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: CryptoUtils.toArrayBuffer(salt),
                iterations: 600000,
                hash: 'SHA-256'
            },
            keyMaterial,
            {name: 'AES-GCM', length: 256},
            false,
            ['encrypt', 'decrypt']
        )
    }
}
