/**
 * NovelAI 绘图服务提供方私有配置模型。
 *
 * @remarks
 * 包含 NovelAI 官方云端图像生成服务的专有连接、API 密钥与绘图预设配置。
 */

/** NovelAI 绘图服务提供方私有配置 */
export interface NovelAIProviderConfig {
    /** 服务端基础接口地址 */
    readonly serverUrl: string;
    /** 访问认证密钥 */
    readonly apiKey: string;
    /** 当前激活的绘图预设标识符 */
    readonly activeDrawingProfileId?: string;
}
