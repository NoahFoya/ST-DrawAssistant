/**
 * SD-WebUI / Forge 绘图服务提供方私有配置模型。
 *
 * @remarks
 * 包含 SD-WebUI (A1111) 及 Forge 等 WebUI 兼容服务的专有连接与预设配置。
 */

/** SD-WebUI / Forge 绘图服务提供方私有配置 */
export interface SDWebUIProviderConfig {
    /** 服务端基础接口地址 */
    readonly serverUrl: string;
    /** 当前激活的绘图预设标识符 */
    readonly activeDrawingProfileId?: string;
    /** 当前激活的提示词预设标识符 */
    readonly activePromptProfileId?: string;
}
