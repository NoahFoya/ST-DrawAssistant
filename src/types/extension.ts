/**
 * ST-DrawAssistant 插件扩展协议
 * 为外部模块、第三方脚本或扩展子插件提供清晰、解耦的接入契约与受控上下文。
 */

import { IDisposable } from './common';
import { CoreEventMap } from './task';
import { TypedEventBus } from '../utils/event-bus';
import { HostClient } from '../host/host-client';
import { SettingsStore } from '../state/settings-store';
import { DriverRegistry } from '../services/drivers/driver-registry';
import { PromptPipeline } from '../pipeline/prompt-pipeline';

/** 插件可访问的受控核心服务上下文 */
export interface PluginContext {
    /** 宿主通信客户端 */
    readonly host: HostClient;
    /** 全局强类型事件总线 */
    readonly events: TypedEventBus<CoreEventMap>;
    /** 核心配置存储仓库 */
    readonly store: SettingsStore;
    /** 生图驱动注册中心 */
    readonly drivers: DriverRegistry;
    /** 提示词处理流水线 (可挂载中间件) */
    readonly pipeline: PromptPipeline;
}

/**
 * 外部扩展插件标准接口
 */
export interface DrawAssistantPlugin extends Partial<IDisposable> {
    /** 插件全局唯一标识或名称 */
    readonly name: string;
    /** 插件语义化版本号 */
    readonly version?: string;
    /** 插件描述 */
    readonly description?: string;

    /**
     * 初始化挂载
     * 当插件被注册到 DrawAssistantApp 时被调用
     */
    init(context: PluginContext): Promise<void> | void;

    /**
     * 释放与清理逻辑
     * 当宿主卸载或插件被移除时协同调用
     */
    dispose?(): void;
}
