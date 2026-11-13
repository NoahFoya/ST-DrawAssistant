/**
 * ST-DrawAssistant 类型定义全库聚合导出。
 *
 * @remarks
 * 聚合导出宿主类型体系、任务运行模型、本地资产存储、绘图服务提供方接口及各提供方私有配置，
 * 作为后续业务模块引用的统一类型入口。
 */

export * from './st';
export * from './task';
export * from './storage';
export * from './provider';
export * from './providers';
export * from './preset';
export * from './update';

/**
 * 统一生命周期资源释放接口。
 */
export interface Disposable {
    /**
     * 释放实例持有的事件监听、计时器、句柄或外部资源。
     */
    dispose(): void;
}
