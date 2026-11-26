/**
 * 常用生图画幅比例与分辨率规格定义。
 */

/** 常用画幅比例预设项定义 */
export interface AspectRatioPreset {
    /** 比例标识，如 '1:1', '9:16' */
    readonly id: string;
    /** 显示标签文本 */
    readonly label: string;
    /** 推荐宽度像素 */
    readonly width: number;
    /** 推荐高度像素 */
    readonly height: number;
    /** 宽高比例数值 */
    readonly ratio: number;
}

/** 官方与行业主流推荐的高频画幅比例列表 */
export const DEFAULT_ASPECT_RATIOS: AspectRatioPreset[] = [
    { id: '1:1', label: '1:1 正方形', width: 1024, height: 1024, ratio: 1.0 },
    { id: '9:16', label: '9:16 竖屏', width: 768, height: 1344, ratio: 768 / 1344 },
    { id: '16:9', label: '16:9 宽屏', width: 1344, height: 768, ratio: 1344 / 768 },
    { id: '3:4', label: '3:4 人像', width: 896, height: 1152, ratio: 896 / 1152 },
    { id: '4:3', label: '4:3 风景', width: 1152, height: 896, ratio: 1152 / 896 },
    { id: '2:3', label: '2:3 人像', width: 832, height: 1216, ratio: 832 / 1216 },
    { id: '3:2', label: '3:2 风景', width: 1216, height: 832, ratio: 1216 / 832 },
    { id: '21:9', label: '21:9 超宽屏', width: 1536, height: 640, ratio: 1536 / 640 },
];

/** OpenAI (DALL-E 3) 官方规范画幅比例列表 */
export const OPENAI_ASPECT_RATIOS: AspectRatioPreset[] = [
    { id: '1:1', label: '1:1 正方形 (1024×1024)', width: 1024, height: 1024, ratio: 1.0 },
    { id: '9:16', label: '9:16 竖屏 (1024×1792)', width: 1024, height: 1792, ratio: 1024 / 1792 },
    { id: '16:9', label: '16:9 宽屏 (1792×1024)', width: 1792, height: 1024, ratio: 1792 / 1024 },
];

/** OpenAI GPT Image (gpt-image-1 / 1.5) 官方规范画幅比例列表 */
export const GPT_IMAGE_ASPECT_RATIOS: AspectRatioPreset[] = [
    { id: '1:1', label: '1:1 正方形 (1024×1024)', width: 1024, height: 1024, ratio: 1.0 },
    { id: '2:3', label: '2:3 竖屏 (1024×1536)', width: 1024, height: 1536, ratio: 1024 / 1536 },
    { id: '3:2', label: '3:2 宽屏 (1536×1024)', width: 1536, height: 1024, ratio: 1536 / 1024 },
];
