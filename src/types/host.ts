/**
 * SillyTavern 宿主环境接口与事件定义
 */

export interface HostContextInfo {
    characterId?: string | number;
    characterName?: string;
    userName?: string;
    chatId?: string;
    messageId?: number;
    swipeId?: number;
}
