/**
 * OpenAI 兼容绘图服务提供方私有配置模型。
 *
 * @remarks
 * 包含兼容 OpenAI `/v1/images/generations` 规范的第三方云端与自建服务的专有配置。
 */

/** OpenAI 兼容绘图服务提供方私有配置 */
export interface OpenAIProviderConfig {
    /** 服务端基础接口地址 */
    readonly serverUrl: string;
    /** 访问认证密钥 */
    readonly apiKey: string;
    /** 选用的具体上游服务商标识 */
    readonly activeProvider?: string;
    /** 当前激活的绘图预设标识符 */
    readonly activeDrawingProfileId?: string;
}
