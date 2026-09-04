/**
 * @module core/crypto/cipher
 * @description 客户端凭据加解密服务 (基于原生 Web Crypto API AES-GCM-256 与设备独立主密钥)
 */

export class CredentialDecryptionError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = 'CredentialDecryptionError';
    }
}

const DEVICE_KEY_STORAGE_KEY = 'st_da_device_key';
const CIPHER_PREFIX = 'enc:v1:';

let _cachedCryptoKey: CryptoKey | null = null;

/**
 * 将 Uint8Array 编码为 Base64 字符串
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa === 'function') {
        return btoa(binary);
    }
    return Buffer.from(binary, 'binary').toString('base64');
}

/**
 * 将 Base64 字符串解码为 Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    let binary: string;
    if (typeof atob === 'function') {
        binary = atob(base64);
    } else {
        binary = Buffer.from(base64, 'base64').toString('binary');
    }
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function readLocalDeviceKey(): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        return localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    } catch {
        return null;
    }
}

function writeLocalDeviceKey(encoded: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(DEVICE_KEY_STORAGE_KEY, encoded);
    } catch {
        // 私密浏览或配额受限环境写入失败时回退仅在内存生命周期内生效
    }
}

/**
 * 获取或自动生成当前浏览器设备的专属主密钥 (Device Master Key)
 *
 * 设计意图：使用浏览器私有 Web Crypto 256 位随机密钥，仅保留于当前浏览器实例的专属存储中，
 * 绝不进入宿主 extensionSettings。当导出设置时，由于缺少目标设备的私有主密钥，密文天然不可逆，
 * 从而彻底杜绝跨设备分享配置时的 API Key 泄露。若存储损坏或缺失，则自动派生新密钥保障系统可用。
 */
export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
    if (_cachedCryptoKey) {
        return _cachedCryptoKey;
    }

    const cryptoObj = typeof window !== 'undefined' ? window.crypto : (globalThis as any).crypto;
    if (!cryptoObj || !cryptoObj.subtle) {
        throw new Error('当前运行环境不支持 Web Crypto API，无法进行安全凭据处理');
    }

    const rawKeyBase64 = readLocalDeviceKey();
    let keyBytes: Uint8Array | null = null;

    if (rawKeyBase64) {
        try {
            const parsed = base64ToUint8Array(rawKeyBase64);
            if (parsed.length === 32) {
                keyBytes = parsed;
            }
        } catch {}
    }

    const effectiveKeyBytes = keyBytes ?? cryptoObj.getRandomValues(new Uint8Array(32));
    if (!keyBytes) {
        writeLocalDeviceKey(uint8ArrayToBase64(effectiveKeyBytes));
    }

    const importedKey = await cryptoObj.subtle.importKey(
        'raw',
        effectiveKeyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );

    _cachedCryptoKey = importedKey;
    return importedKey;
}

/**
 * 加密敏感凭据 (输出形如 enc:v1:<iv_b64>:<ciphertext_b64>)
 *
 * @param plaintext 待加密的明文凭据
 */
export async function encryptCredential(plaintext: string): Promise<string> {
    if (!plaintext || typeof plaintext !== 'string') {
        return '';
    }

    // 避免重复加密
    if (plaintext.startsWith(CIPHER_PREFIX)) {
        return plaintext;
    }

    const cryptoObj = typeof window !== 'undefined' ? window.crypto : (globalThis as any).crypto;
    const key = await getOrCreateDeviceKey();

    // 每次加密使用全新的 12 字节 IV
    const iv = cryptoObj.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encoded = encoder.encode(plaintext);

    const ciphertextBuffer = await cryptoObj.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );

    const ivB64 = uint8ArrayToBase64(iv);
    const cipherB64 = uint8ArrayToBase64(new Uint8Array(ciphertextBuffer));

    return `${CIPHER_PREFIX}${ivB64}:${cipherB64}`;
}

/**
 * 解密敏感凭据
 *
 * @param ciphertext 密文字符串 (支持直接兼容未加密明文)
 */
export async function decryptCredential(ciphertext: string): Promise<string> {
    if (!ciphertext || typeof ciphertext !== 'string') {
        return '';
    }

    // 如果未加密，直接返回原字符串
    if (!ciphertext.startsWith(CIPHER_PREFIX)) {
        return ciphertext;
    }

    const payload = ciphertext.slice(CIPHER_PREFIX.length);
    const colonIndex = payload.indexOf(':');
    if (colonIndex === -1) {
        throw new CredentialDecryptionError('密文格式异常，缺少 IV 与密文分隔符');
    }
    const ivB64 = payload.slice(0, colonIndex);
    const cipherB64 = payload.slice(colonIndex + 1);

    if (!ivB64 || !cipherB64) {
        throw new CredentialDecryptionError('密文格式异常，缺少 IV 或密文载荷');
    }

    try {
        const cryptoObj = typeof window !== 'undefined' ? window.crypto : (globalThis as any).crypto;
        const key = await getOrCreateDeviceKey();

        const iv = base64ToUint8Array(ivB64);
        const cipherBytes = base64ToUint8Array(cipherB64);

        const decryptedBuffer = await cryptoObj.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            cipherBytes
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    } catch (err: any) {
        throw new CredentialDecryptionError(
            '凭据解密失败：该密文可能由其他设备生成或已被篡改，请在当前设备重新输入 API Key',
            err
        );
    }
}

/**
 * 重置设备密钥缓存 (用于单元测试隔离)
 */
export function resetDeviceKeyCache(): void {
    _cachedCryptoKey = null;
}
