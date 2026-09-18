/**
 * ComfyUI 绘图服务提供方私有配置模型。
 *
 * @remarks
 * 包含 ComfyUI 节点图执行引擎的专有连接、工作流模板与绘图预设配置。
 */

/** ComfyUI 绘图服务提供方私有配置 */
export interface ComfyUIProviderConfig {
    /** 服务端基础接口地址 */
    readonly serverUrl: string;
    /** 当前激活的工作流模板标识符 */
    readonly activeWorkflowProfileId?: string;
    /** 当前激活的绘图预设标识符 */
    readonly activeDrawingProfileId?: string;
}
