/**
 * 生图引擎驱动注册中心
 * 管理各生图后端驱动实例的注册、检索与生命周期释放。
 */

import { IDisposable, toDisposable } from '../../types/common';
import { ImageEngineDriver } from '../../types/driver';

export class DriverRegistry implements IDisposable {
    private readonly _drivers = new Map<string, ImageEngineDriver>();

    public register(driver: ImageEngineDriver): IDisposable {
        const id = driver.id.toLowerCase();
        if (this._drivers.has(id)) {
            const existing = this._drivers.get(id);
            if (existing !== driver) {
                existing?.dispose?.();
            }
        }
        this._drivers.set(id, driver);

        return toDisposable(() => {
            this.unregister(id);
        });
    }

    public unregister(id: string): void {
        const key = id.toLowerCase();
        const driver = this._drivers.get(key);
        if (driver) {
            this._drivers.delete(key);
            driver.dispose?.();
        }
    }

    public get(id: string): ImageEngineDriver | undefined {
        return this._drivers.get(id.toLowerCase());
    }

    public has(id: string): boolean {
        return this._drivers.has(id.toLowerCase());
    }

    public getAll(): ImageEngineDriver[] {
        return Array.from(this._drivers.values());
    }

    public getIds(): string[] {
        return Array.from(this._drivers.keys());
    }

    public dispose(): void {
        for (const driver of this._drivers.values()) {
            driver.dispose?.();
        }
        this._drivers.clear();
    }
}

import { NetworkClient } from '../network/client';
import type { SettingsStore } from '../../state/settings-store';
import { ComfyUiDriver, DEFAULT_COMFYUI_CONFIG, ComfyUIEngineConfig } from './comfyui-driver';
import { SdWebUiDriver, DEFAULT_SDWEBUI_CONFIG, SdWebUIEngineConfig } from './sdwebui-driver';
import { NovelAiDriver, DEFAULT_NOVELAI_CONFIG, NovelAIEngineConfig } from './novelai-driver';
import { OpenAiDriver, DEFAULT_OPENAI_CONFIG, OpenAIEngineConfig } from './openai-driver';

/** 创建已注册四大主流后端的默认驱动中心 */
export function createDefaultDriverRegistry(options?: {
    store?: SettingsStore;
    network?: NetworkClient;
}): DriverRegistry {
    const network = options?.network || new NetworkClient();
    const store = options?.store;
    const registry = new DriverRegistry();

    registry.register(new SdWebUiDriver({
        network,
        driverName: 'SdWebUI',
        getEndpointUrl: () => {
            const cfg = store?.getEngineConfig<SdWebUIEngineConfig>('sdwebui');
            return cfg?.serverUrl || DEFAULT_SDWEBUI_CONFIG.serverUrl;
        },
        getConfig: () => store?.getEngineConfig('sdwebui')
    }));

    registry.register(new NovelAiDriver({
        network,
        driverName: 'NovelAI',
        getEndpointUrl: () => {
            const cfg = store?.getEngineConfig<NovelAIEngineConfig>('novelai');
            return cfg?.serverUrl || DEFAULT_NOVELAI_CONFIG.serverUrl;
        },
        getConfig: () => store?.getEngineConfig('novelai')
    }));

    registry.register(new ComfyUiDriver({
        network,
        driverName: 'ComfyUI',
        getEndpointUrl: () => {
            const cfg = store?.getEngineConfig<ComfyUIEngineConfig>('comfyui');
            return cfg?.serverUrl || DEFAULT_COMFYUI_CONFIG.serverUrl;
        },
        getConfig: () => store?.getEngineConfig('comfyui')
    }));

    registry.register(new OpenAiDriver({
        network,
        driverName: 'OpenAI',
        getEndpointUrl: () => {
            const cfg = store?.getEngineConfig<OpenAIEngineConfig>('openai');
            return cfg?.serverUrl || DEFAULT_OPENAI_CONFIG.serverUrl;
        },
        getConfig: () => store?.getEngineConfig('openai')
    }));

    return registry;
}
