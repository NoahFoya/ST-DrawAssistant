/**
 * 状态管理与持久化存储层统一出口
 *
 * 功能：
 * 1. 集中导出全局设置、预设管理、任务调度、IndexedDB 本地存储与结果整合服务。
 *
 * Tips：
 * 1. 供外部统一按 @store 别名引用核心存储服务，隔离子模块文件演进。
 */

export * from './settings';
export * from './preset';
export * from './task';
export * from './storage';
export * from './url-pool';
export * from './integrator';
export * from './normalizer';
