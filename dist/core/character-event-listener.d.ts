/**
 * @module core/character-event-listener
 * @description 宿主事件监听器与新角色卡智能检测提醒器
 */
/**
 * 校验指定角色卡名称/chatId 是否已被其他方案关联（防冲突提醒）
 */
export declare function checkCharacterCardConflict(lineEntry: string, currentSchemeId: string): string | null;
/**
 * 监听新角色卡切换事件与全局世界书预发送文本刷新
 */
export declare function registerCharacterEventListeners(): void;
//# sourceMappingURL=character-event-listener.d.ts.map