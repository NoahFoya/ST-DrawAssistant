/**
 * 插件扩展注册中心 (ExtensionRegistry)
 *
 * 功能：
 * 1. 提供插件内部功能扩展的注册、发现与生命周期管理机制；
 * 2. 分配受控上下文、沙箱存储空间与生命周期钩子；
 * 3. 编排提示词增强与图像后处理链式钩子。
 *
 * Tips：
 * 1. 幂等与解绑：扩展注册与注销必须保持幂等，禁用时彻底解绑钩子与清理内存；
 * 2. 异常隔离：执行第三方扩展钩子时进行异常捕获与隔离保护，防止阻断插件核心流程。
 */

import type {
    DrawAssistantExtension,
    ExtensionContext,
    ExtensionStorageAccessor,
    ExtensionHooksRegistry
} from '@types';
import type { SettingsStore } from '@store/settings';

export class ExtensionRegistry {
    private static _instance: ExtensionRegistry | null = null;

    private readonly _extensions = new Map<string, DrawAssistantExtension>();
    private readonly _localEnabled = new Map<string, boolean>();
    private readonly _listeners = new Set<() => void>();
    private readonly _inMemoryStorage = new Map<string, Record<string, unknown>>();

    private readonly _promptHooks = new Map<string, ((prompt: string) => string | Promise<string>)[]>();
    private readonly _imageHooks = new Map<string, ((result: unknown) => void)[]>();

    private _settingsStore: SettingsStore | null = null;

    private constructor() {}

    /** 获取扩展注册中心单例 */
    static getInstance(): ExtensionRegistry {
        if (!this._instance) {
            this._instance = new ExtensionRegistry();
        }
        return this._instance;
    }

    /** 检查扩展注册中心是否已初始化 */
    static isInitialized(): boolean {
        return !!this._instance;
    }

    /**
     * 关联配置存储中心
     * 用于状态与持久化配置的读写同步
     */
    bindSettingsStore(store: SettingsStore): void {
        this._settingsStore = store;
    }

    /**
     * 注册扩展
     * @param ext 待注册的扩展实例
     */
    register(ext: DrawAssistantExtension): void {
        if (!ext || !ext.id) {
            return;
        }
        this._extensions.set(ext.id, ext);
        this._notify();
    }

    /**
     * 注销指定标识的扩展
     * @param id 扩展唯一标识
     */
    unregister(id: string): void {
        const ext = this._extensions.get(id);
        if (ext) {
            this._promptHooks.delete(id);
            this._imageHooks.delete(id);
            try {
                ext.dispose?.();
            } catch (err) {
                console.warn(`[ST-DrawAssistant][ExtensionRegistry] 扩展 ${id} dispose 异常:`, err);
            }
            this._extensions.delete(id);
            this._localEnabled.delete(id);
            this._notify();
        }
    }

    /**
     * 获取当前所有已注册的扩展列表
     */
    getAll(): DrawAssistantExtension[] {
        return Array.from(this._extensions.values());
    }

    /**
     * 根据 ID 获取扩展
     */
    get(id: string): DrawAssistantExtension | undefined {
        return this._extensions.get(id);
    }

    /**
     * 查询指定扩展当前是否处于启用状态
     * 优先读取持久化配置，若无则使用扩展默认值
     */
    isEnabled(id: string): boolean {
        if (this._settingsStore) {
            const map = (this._settingsStore.get('enabledExtensions') || {}) as Record<string, boolean>;
            if (id in map) {
                return map[id];
            }
        }
        if (this._localEnabled.has(id)) {
            return this._localEnabled.get(id)!;
        }
        const ext = this._extensions.get(id);
        return ext?.defaultEnabled ?? true;
    }

    /**
     * 设置扩展启用/禁用状态
     * 内聚状态维护、配置同步与生命周期回调调度
     */
    setEnabled(id: string, enabled: boolean): void {
        this._localEnabled.set(id, enabled);

        if (this._settingsStore) {
            const current = (this._settingsStore.get('enabledExtensions') || {}) as Record<string, boolean>;
            this._settingsStore.set('enabledExtensions', { ...current, [id]: enabled });
        }

        const ext = this._extensions.get(id);
        if (ext?.onToggle) {
            try {
                ext.onToggle(enabled);
            } catch (err) {
                console.warn(`[ST-DrawAssistant][ExtensionRegistry] 扩展 ${id} onToggle 回调执行异常:`, err);
            }
        }

        this._notify();
    }

    /**
     * 为指定扩展创建独立配置访问器
     * 保证各扩展的配置读写限定在自身命名空间内
     */
    createStorageAccessor(extensionId: string): ExtensionStorageAccessor {
        return {
            get: <T>(key: string, defaultValue?: T): T => {
                if (this._settingsStore) {
                    const allCustom = (this._settingsStore.get('extensionCustomSettings') || {}) as Record<string, Record<string, unknown>>;
                    const extScope = allCustom[extensionId] || {};
                    return (extScope[key] !== undefined ? extScope[key] : defaultValue) as T;
                }
                const extScope = this._inMemoryStorage.get(extensionId) || {};
                return (extScope[key] !== undefined ? extScope[key] : defaultValue) as T;
            },
            set: <T>(key: string, value: T): void => {
                if (this._settingsStore) {
                    const allCustom = (this._settingsStore.get('extensionCustomSettings') || {}) as Record<string, Record<string, unknown>>;
                    const extScope = { ...(allCustom[extensionId] || {}), [key]: value };
                    this._settingsStore.set('extensionCustomSettings', {
                        ...allCustom,
                        [extensionId]: extScope
                    });
                    return;
                }
                const extScope = { ...(this._inMemoryStorage.get(extensionId) || {}), [key]: value };
                this._inMemoryStorage.set(extensionId, extScope);
            }
        };
    }

    /**
     * 为指定扩展创建流水线钩子注册器
     */
    createHooksRegistry(extensionId: string): ExtensionHooksRegistry {
        return {
            onBeforePromptProcess: (handler: (prompt: string) => string | Promise<string>) => {
                if (!this._promptHooks.has(extensionId)) {
                    this._promptHooks.set(extensionId, []);
                }
                const list = this._promptHooks.get(extensionId)!;
                list.push(handler);
                return () => {
                    const index = list.indexOf(handler);
                    if (index >= 0) {
                        list.splice(index, 1);
                    }
                };
            },
            onAfterImageGenerated: (handler: (result: unknown) => void) => {
                if (!this._imageHooks.has(extensionId)) {
                    this._imageHooks.set(extensionId, []);
                }
                const list = this._imageHooks.get(extensionId)!;
                list.push(handler);
                return () => {
                    const index = list.indexOf(handler);
                    if (index >= 0) {
                        list.splice(index, 1);
                    }
                };
            }
        };
    }

    /**
     * 为指定扩展创建标准受控上下文
     */
    createContext(extensionId: string, hostContext?: unknown): ExtensionContext {
        return {
            extensionId,
            storage: this.createStorageAccessor(extensionId),
            hooks: this.createHooksRegistry(extensionId),
            log: {
                info: (msg: string) => console.log(`[ST-DrawAssistant][Ext:${extensionId}] ${msg}`),
                warn: (msg: string) => console.warn(`[ST-DrawAssistant][Ext:${extensionId}] ${msg}`),
                error: (msg: string) => console.error(`[ST-DrawAssistant][Ext:${extensionId}] ${msg}`)
            },
            host: hostContext
        };
    }

    /**
     * 初始化指定扩展
     */
    async initExtension(id: string, hostContext?: unknown): Promise<void> {
        const ext = this._extensions.get(id);
        if (!ext || !ext.init) {
            return;
        }
        try {
            const ctx = this.createContext(id, hostContext);
            await ext.init(ctx);
        } catch (err) {
            console.warn(`[ST-DrawAssistant][ExtensionRegistry] 扩展 ${id} 初始化异常:`, err);
        }
    }

    /**
     * 初始化所有已启用的扩展
     */
    async initAll(hostContext?: unknown): Promise<void> {
        for (const ext of this._extensions.values()) {
            if (this.isEnabled(ext.id)) {
                await this.initExtension(ext.id, hostContext);
            }
        }
    }

    /**
     * 执行提示词前置修改钩子流水线
     * 仅调用当前处于启用状态的扩展所注册的钩子
     */
    async executeBeforePromptProcess(prompt: string): Promise<string> {
        let currentPrompt = prompt;
        for (const [id, handlers] of this._promptHooks.entries()) {
            if (!this.isEnabled(id)) {
                continue;
            }
            for (const handler of handlers) {
                try {
                    currentPrompt = await handler(currentPrompt);
                } catch (err) {
                    console.warn(`[ST-DrawAssistant][ExtensionRegistry] 扩展 ${id} 前置提示词钩子执行异常:`, err);
                }
            }
        }
        return currentPrompt;
    }

    /**
     * 执行图像生成完成观察钩子
     * 仅通知当前处于启用状态的扩展
     */
    executeAfterImageGenerated(result: unknown): void {
        for (const [id, handlers] of this._imageHooks.entries()) {
            if (!this.isEnabled(id)) {
                continue;
            }
            for (const handler of handlers) {
                try {
                    handler(result);
                } catch (err) {
                    console.warn(`[ST-DrawAssistant][ExtensionRegistry] 扩展 ${id} 生成完成钩子执行异常:`, err);
                }
            }
        }
    }

    /**
     * 监听扩展注册或状态变化
     */
    subscribe(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * 清空所有已注册扩展 (主要用于测试隔离与重置)
     */
    clear(): void {
        for (const [id, ext] of this._extensions.entries()) {
            try {
                ext.dispose?.();
            } catch (err) {
                console.warn(`[ST-DrawAssistant][ExtensionRegistry] 扩展 ${id} dispose 异常:`, err);
            }
        }
        this._extensions.clear();
        this._localEnabled.clear();
        this._inMemoryStorage.clear();
        this._promptHooks.clear();
        this._imageHooks.clear();
        this._notify();
    }

    private _notify(): void {
        for (const fn of this._listeners) {
            try {
                fn();
            } catch {
                // 异常隔离
            }
        }
    }
}
