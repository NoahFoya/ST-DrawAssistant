/**
 * SillyTavern 聊天消息与扩展元数据接口声明
 */

export interface ChatMessageExtra {
    /** 绘图助手专用的楼层元数据存储命名空间 */
    draw_assistant?: {
        /** 当前楼层关联的最近一次生图结果元数据 */
        last_generation?: {
            taskId: string;
            engine: string;
            prompt: string;
            negativePrompt?: string;
            seed?: number;
            width?: number;
            height?: number;
            timestamp: number;
            imageKey?: string;
        };
        /** 历史出图记录列表 */
        history?: Array<{
            taskId: string;
            engine: string;
            prompt: string;
            negativePrompt?: string;
            seed?: number;
            timestamp: number;
            imageKey?: string;
        }>;
    };
    [key: string]: unknown;
}

export interface ChatMessage {
    /** 发言者名称 */
    name: string;
    /** 是否为用户消息 */
    is_user: boolean;
    /** 是否为系统消息 */
    is_system?: boolean;
    /** 消息正文纯文本 */
    mes: string;
    /** 消息发送时间戳 */
    send_date?: string | number;
    /** 消息附加扩展元数据对象（用于持久化生图参数） */
    extra?: ChatMessageExtra;
    /** 多分支滑动序号与文本 */
    swipe_id?: number;
    swipes?: string[];
    [key: string]: unknown;
}

export interface ChatMetadata {
    [key: string]: unknown;
}
