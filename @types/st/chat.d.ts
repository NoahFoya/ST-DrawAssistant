/**
 * SillyTavern 宿主消息结构与插件绘图关联数据模型 (HostChat)
 *
 * @remarks
 * `message.extra` 是宿主开放给所有扩展的共享字典，本插件通过 `drawings` 键独立命名空间。
 * `DrawingInstruction` 为运行时解析产物，不持久化，不依赖宿主存储。
 * `StoredImageRecord` 独立于 `messageId`/`swipeId` 存在，画廊功能可直接基于其管理。
 */

/**
 * 从消息正文中按先后次序提取的单条绘图指令只读数据视图。
 *
 * @remarks
 * instructionIndex 由指令在正文中的出现次序决定，从 0 开始递增，
 * 是插槽挂载与 MessageDrawingMap 存储的对应键。
 * 该结构为运行时解析产物，不持久化。
 */
export interface DrawingInstruction {
    /** 指令在当前消息正文中的出现序号，从 0 开始递增 */
    readonly instructionIndex: number;
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本，指令中包含管道符分隔时存在 */
    readonly negativePrompt?: string;
    /** 原始占位标签文本，用于定位与替换原正文显示 */
    readonly rawTag: string;
}

/**
 * 写入 `message.extra.drawings[swipeId][instructionIndex]` 的单条展示记录。
 *
 * @remarks
 * imageId 为必选字段，指向插件私有 IndexedDB 中的 StoredImageRecord。
 * imageUrl 与 base64 为独立可选叠加字段，依据用户配置按需存在。
 * 展示图源解析优先级：imageUrl > base64 > 通过 imageId 读取本地 Blob。
 */
export interface DrawingSlotEntry {
    /** 插件本地 IndexedDB 图像资产唯一标识符 UUID */
    readonly imageId: string;
    /** 宿主静态资源相对路径，在成功保存至服务端时存在 */
    readonly imageUrl?: string;
    /** 聊天记录内嵌 Base64 文本，在开启内嵌选项时存在 */
    readonly base64?: string;
}

/**
 * 按 `[swipeId][instructionIndex]` 双重索引存储各候选分支各指令插槽展示记录的映射表。
 *
 * @remarks
 * 收到 `MESSAGE_SWIPE_DELETED` 时，执行 `delete map[swipeId]` 清除废弃分支记录，
 * 不影响其他分支，也不影响插件私有 IndexedDB 中的图像资产。
 */
export interface MessageDrawingMap {
    [swipeId: number]: {
        [instructionIndex: number]: DrawingSlotEntry;
    };
}

/**
 * 宿主消息附加扩展元数据字典。
 *
 * @remarks
 * 该字典由宿主开放给所有扩展共享写入。本插件通过 `drawings` 键独立命名空间，
 * 不干扰其他扩展写入的数据。
 */
export interface ChatMessageExtra {
    /** 绘图展示索引，按分支与指令序号双重索引映射 */
    drawings?: MessageDrawingMap;
    /** 允许安全访问其他扩展或宿主写入的属性 */
    readonly [key: string]: unknown;
}

/**
 * 保存在插件私有 IndexedDB 中的完整图像生成技术参数快照。
 *
 * @remarks
 * 不写入宿主消息文件，避免聊天记录体积随生图次数线性增长。
 * 通过 `imageId` 与 `DrawingSlotEntry` 关联，供图片详情弹窗与重绘功能使用。
 */
export interface ImageGenerationMetadata {
    /** 主模型文件名 */
    readonly baseModel?: string;
    /** 额外模型文件名列表 */
    readonly extraModels?: string[];
    /** 正向提示词文本 */
    readonly prompt: string;
    /** 负向提示词文本 */
    readonly negativePrompt?: string;
    /** 随机种子 */
    readonly seed?: number;
    /** 采样器名称 */
    readonly sampler?: string;
    /** 采样步数 */
    readonly steps?: number;
    /** 提示词引导系数 CFG Scale */
    readonly cfgScale?: number;
    /** 生图引擎标识符 */
    readonly engine?: string;
    /** 生成耗时，单位毫秒 */
    readonly durationMs?: number;
    /** 图像宽度，单位像素 */
    readonly width?: number;
    /** 图像高度，单位像素 */
    readonly height?: number;
    /** 引擎扩展参数快照 */
    readonly [key: string]: unknown;
}

/**
 * 保存在插件本地 IndexedDB 中的完整图像资产记录。
 *
 * @remarks
 * `imageId` 为全局稳定唯一标识符，与 `messageId`/`swipeId` 无绑定关系。
 * 消息被删除或分支被清除时，此记录保持存续，画廊功能可独立访问。
 * `remotePath` 与 `DrawingSlotEntry.imageUrl` 保持同步，作为服务端路径的本地缓存副本。
 */
export interface StoredImageRecord {
    /** 图像全局唯一标识符 UUID */
    readonly imageId: string;
    /** 生成任务标识符 */
    readonly taskId?: string;
    /** MIME 类型，如 image/png 或 image/webp */
    readonly mimeType: string;
    /** 图像字节大小 */
    readonly byteSize: number;
    /** 图像宽度，单位像素 */
    readonly width?: number;
    /** 图像高度，单位像素 */
    readonly height?: number;
    /** 创建时间戳，单位毫秒 */
    readonly createdAt: number;
    /** 完整生成技术参数快照 */
    readonly metadata: ImageGenerationMetadata;
    /** 宿主静态资源相对路径，开启服务端保存时存在 */
    readonly remotePath?: string;
    /** 关联的宿主会话标识符 */
    readonly chatId?: string;
    /** 关联的角色名称 */
    readonly characterName?: string;
    /** 资产状态 */
    readonly status: 'ready' | 'deleted';
}

/**
 * SillyTavern 宿主聊天消息结构。
 *
 * @remarks
 * `swipe_id` 为当前激活的候选分支序号，与 `extra.drawings` 的第一维索引对应。
 * `extra` 为宿主开放字典，扩展写入时应通过独立子键隔离，避免覆盖其他扩展数据。
 */
export interface ChatMessage {
    /** 发言者名称 */
    readonly name: string;
    /** 是否为用户消息 */
    readonly is_user: boolean;
    /** 是否为系统消息 */
    readonly is_system?: boolean;
    /** 消息正文原始 Markdown 纯文本 */
    readonly mes: string;
    /** 消息发送时间戳 */
    readonly send_date?: string | number;
    /** 消息附加扩展元数据字典 */
    extra?: ChatMessageExtra;
    /** 当前激活的候选分支序号，缺省为 0 */
    readonly swipe_id?: number;
    /** 候选分支文本列表 */
    readonly swipes?: string[];
    /** 允许安全访问宿主其他只读属性 */
    readonly [key: string]: unknown;
}

/** 会话全局元数据字典 */
export interface ChatMetadata {
    readonly [key: string]: unknown;
}
