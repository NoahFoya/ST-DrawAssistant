/**
 * @module extensions/character-manager
 * @description 角色与服装设定管理模块
 *
 * 职责：
 * - 导出角色与服装预设方案类型与存储接口
 * - 导出设定注入与动态宏展开处理器
 * - 导出角色设定管理 Tab 配置页面
 */

export * from './types';
export * from './storage';
export * from './injection';
export * from './event-listener';
export { renderCharacterTab } from './character-tab';

export const CHARACTER_MANAGER_EXTENSION = {
    id: 'character-manager',
    displayName: '角色与服装设定管理',
    version: '1.0.0',
    description: '支持为特定角色卡/Chat ID 绑定专属生图方案、多套服装预设及世界书占位符注入。',
};
