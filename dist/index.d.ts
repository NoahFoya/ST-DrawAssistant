/**
 * ST-DrawAssistant 扩展入口（P0 完整版）
 *
 * 初始化模式：遵循 ST 宿主推荐的"顶层仅注册监听，APP_READY 内完成所有初始化"模式
 * 参考：.agents/Skills/sillytavern-extension-host/SKILL.md §4.2
 *
 * 关键约束：
 * - 模块顶层可安全调用 getContext() 获取 eventSource/event_types（宿主已挂载）
 * - extension_settings 访问必须在 APP_READY 后执行（此时设置已加载完毕）
 * - CHARACTER_MESSAGE_RENDERED 事件数据含 { message, element }，直接用 element
 */
export {};
//# sourceMappingURL=index.d.ts.map