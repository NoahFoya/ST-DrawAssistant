/**
 * SillyTavern 宿主环境接口与消息契约
 */

export interface HostContextInfo {
    characterId?: string | number;
    characterName?: string;
    userName?: string;
    chatId?: string;
    messageId?: number;
    swipeId?: number;
}
