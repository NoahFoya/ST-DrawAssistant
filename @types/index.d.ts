/**
 * ST-DrawAssistant 类型声明统一导出入口
 */

export * from './st/context';
export * from './st/events';
export * from './st/chat';
export * from './generation';
export * from './adapter';
export * from './task';
export * from './storage';
export * from './preset';
export * from './settings';
export * from './ui';

/** 通用资源释放接口 */
export interface IDisposable {
    dispose(): void;
}
