/**
 * 设置默认值
 *
 * 注入配置默认对应 Wai 工作流节点结构：
 *   正向: 节点 "113" WeiLinPromptUI → inputs.positive
 *   负向: 节点 "12"  CLIPTextEncode → inputs.text
 *   宽高: 节点 "119"/"118" PrimitiveInt → inputs.value
 *   采样: 节点 "63"  KSampler → inputs.*
 *   输出: 节点 "99"  SaveImage（用于定位结果图像）
 *
 * 若使用其他工作流，请在设置面板中修改注入节点 ID。
 */
import type { DrawAssistantSettings } from './types';
export declare const DEFAULT_SETTINGS: Readonly<DrawAssistantSettings>;
//# sourceMappingURL=defaults.d.ts.map