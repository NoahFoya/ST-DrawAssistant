/**
 * @module index
 * @description ST-DrawAssistant 绘画助手扩展主入口文件
 *
 * 初始化模式：遵循 ST 宿主推荐的"顶层仅注册监听，APP_READY 内完成所有初始化"模式
 *
 * 关键约束：
 * - 模块顶层调用 getContext() 存在时序风险（若扩展加载较早，宿主可能尚未初始化），
 *   因此顶层的 getContext() 调用应始终包裹在 try-catch 中，
 *   真正的初始化逻辑应在 APP_READY 事件回调内执行
 * - extension_settings 访问必须在 APP_READY 后执行（此时设置已加载完毕）
 * - CHARACTER_MESSAGE_RENDERED 事件数据含 { message, element }，直接用 element
 *
 * 规范参考：
 * - .agents/Skills/sillytavern-extension-host/SKILL.md §4.2 (扩展入口生命周期与事件总线)
 */
export {};
//# sourceMappingURL=index.d.ts.map