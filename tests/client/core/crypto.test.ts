import { describe, it, expect, beforeEach } from 'vitest';
import {
    encryptCredential,
    decryptCredential,
    getOrCreateDeviceKey,
    resetDeviceKeyCache,
    CredentialDecryptionError
} from '../../../src/client/core/crypto/cipher';

describe('Crypto (Web Crypto AES-GCM-256 凭据加解密服务)', () => {
    beforeEach(() => {
        resetDeviceKeyCache();
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.clear();
            }
        } catch {}
    });

    it('getOrCreateDeviceKey 应自动在当前设备生成 256 位 AES-GCM 密钥并持久化在本地', async () => {
        const key1 = await getOrCreateDeviceKey();
        expect(key1).toBeDefined();
        expect(key1.algorithm.name).toBe('AES-GCM');

        // 二次调用应复用同一设备密钥
        const key2 = await getOrCreateDeviceKey();
        expect(key2).toBe(key1);
    });

    it('encryptCredential 应输出带有 enc:v1: 前缀的密文且绝不泄露明文', async () => {
        const rawToken = 'STD-ZiI50G8xVTcizlc0ABKo';
        const ciphertext = await encryptCredential(rawToken);

        expect(ciphertext.startsWith('enc:v1:')).toBe(true);
        expect(ciphertext).not.toContain(rawToken);
        expect(ciphertext).not.toContain('STD-');

        // 每次加密因 IV 随机，密文应互不相同
        const ciphertext2 = await encryptCredential(rawToken);
        expect(ciphertext2).not.toBe(ciphertext);
    });

    it('decryptCredential 应能精准还原加密前的原始明文', async () => {
        const rawToken = 'STD-ZiI50G8xVTcizlc0ABKo';
        const ciphertext = await encryptCredential(rawToken);
        const decrypted = await decryptCredential(ciphertext);

        expect(decrypted).toBe(rawToken);
    });

    it('对于未加密的普通明文应直接兼容返回原值', async () => {
        const raw = 'plain-text-token';
        const result = await decryptCredential(raw);
        expect(result).toBe(raw);
    });

    it('对于空字符串或非字符串输入应安全返回空字符串', async () => {
        expect(await encryptCredential('')).toBe('');
        expect(await decryptCredential('')).toBe('');
    });

    it('当密文损坏或格式非法时应明确抛出 CredentialDecryptionError，绝不静默伪装', async () => {
        const corrupted = 'enc:v1:invalid_iv_base64:invalid_cipher_base64';

        await expect(decryptCredential(corrupted)).rejects.toThrow(CredentialDecryptionError);
    });
});
