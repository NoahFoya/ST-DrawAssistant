/**
 * 插件自身扩展标准接口与受控上下文模型 (@types/extension)
 *
 * 核心功能：
 * 1. 规范第三方与内部子模块扩展的生命周期标准接口 (DrawAssistantExtension)；
 * 2. 提供受控沙箱上下文 (ExtensionContext)，包括独立命名空间存储与流水线钩子注册能力；
 * 3. 实现扩展功能与插件核心运行时解耦。
 *
 * 注意事项：
 * 1. 扩展存储读写限定在扩展各自专属命名空间内，禁止越权操作全局设置；
 * 2. 钩子注册方法必须返回解绑函数，以便扩展禁用或重载时彻底释放。
 */

/**
 * 扩展独立配置访问器接口
 * 保证各扩展的配置读写限定在自身独立命名空间内
 */
export interface ExtensionStorageAccessor {
    get<T>(key: string, defaultValue?: T): T;
    set<T>(key: string, value: T): void;
}

/**
 * 扩展可注册的流水线钩子接口
 */
export interface ExtensionHooksRegistry {
    /** 注册提示词前置处理钩子 */
    onBeforePromptProcess?(handler: (prompt: string) => string | Promise<string>): () => void;
    /** 注册图像生成完成观察钩子 */
    onAfterImageGenerated?(handler: (result: unknown) => void): () => void;
}

/**
 * 传递给扩展的标准上下文接口
 */
export interface ExtensionContext {
    /** 扩展自身唯一标识 */
    readonly extensionId: string;
    /** 扩展独立配置访问器 */
    readonly storage: ExtensionStorageAccessor;
    /** 扩展流水线钩子注册器 */
    readonly hooks?: ExtensionHooksRegistry;
    /** 扩展独立日志记录器 */
    readonly log: {
        info(msg: string): void;
        warn(msg: string): void;
        error(msg: string): void;
    };
    /** 宿主环境上下文只读引用 (可选) */
    readonly host?: unknown;
}

/**
 * 插件扩展标准接口定义
 */
export interface DrawAssistantExtension {
    /** 扩展唯一标识 */
    readonly id: string;
    /** 扩展显示名称 */
    readonly name: string;
    /** 扩展版本号 */
    readonly version?: string;
    /** 扩展描述说明 */
    readonly description?: string;
    /** 扩展默认启用状态，未指定时默认为 true */
    readonly defaultEnabled?: boolean;
    /** 扩展初始化钩子 */
    init?(context: ExtensionContext): void | Promise<void>;
    /** 扩展启用/禁用状态切换回调 */
    onToggle?(enabled: boolean): void;
    /** 扩展释放与清理钩子 */
    dispose?(): void;
}
