/**
 * OpenAI 官方与兼容图像模型目录及能力表。
 */

export type OpenAIModelFamily = 'dall-e-3' | 'dall-e-2' | 'gpt-image' | 'compat';

export interface OpenAIModelCapabilities {
    readonly family: OpenAIModelFamily;
    /** 是否在请求体中发送 response_format: 'b64_json'（GPT Image 家族不支持该字段） */
    readonly sendResponseFormatB64: boolean;
    /** 是否支持 quality 参数 */
    readonly supportsQuality: boolean;
    /** quality 可选值 */
    readonly qualityOptions: readonly string[];
    /** 是否支持 style 参数 (vivid / natural) */
    readonly supportsStyle: boolean;
    /** 是否支持 background 参数 (auto / transparent / opaque) */
    readonly supportsBackground: boolean;
    /** 是否支持 output_format 参数 (png / jpeg / webp) */
    readonly supportsOutputFormat: boolean;
    /** 是否支持自动分辨率/尺寸（GPT Image 发送 size: "auto"，兼容后端省略 size） */
    readonly supportsAutoSize: boolean;
}

export const OPENAI_MODEL_OPTIONS: Array<{ label: string; value: string }> = [
    { label: 'dall-e-3', value: 'dall-e-3' },
    { label: 'dall-e-2', value: 'dall-e-2' },
    { label: 'gpt-image-1', value: 'gpt-image-1' },
    { label: 'gpt-image-1-mini', value: 'gpt-image-1-mini' },
    { label: 'gpt-image-1.5', value: 'gpt-image-1.5' },
    { label: 'black-forest-labs/FLUX.1-schnell', value: 'black-forest-labs/FLUX.1-schnell' },
    { label: 'black-forest-labs/FLUX.1-dev', value: 'black-forest-labs/FLUX.1-dev' },
    { label: 'Kwai-Kolors/Kolors', value: 'Kwai-Kolors/Kolors' },
];

export function isSiliconFlowService(serviceId?: string, serverUrl?: string): boolean {
    return (
        serviceId === 'siliconflow' ||
        /(?:^|[./])siliconflow\.cn(?:[:/]|$)/i.test(serverUrl || '')
    );
}

export function resolveOpenAIModelCapabilities(modelId?: string): OpenAIModelCapabilities {
    const lower = (modelId || '').trim().toLowerCase();

    if (lower.includes('gpt-image')) {
        return {
            family: 'gpt-image',
            sendResponseFormatB64: false,
            supportsQuality: true,
            qualityOptions: ['auto', 'low', 'medium', 'high'],
            supportsStyle: false,
            supportsBackground: true,
            supportsOutputFormat: true,
            supportsAutoSize: true,
        };
    }

    if (lower.includes('dall-e-3')) {
        return {
            family: 'dall-e-3',
            sendResponseFormatB64: true,
            supportsQuality: true,
            qualityOptions: ['standard', 'hd'],
            supportsStyle: true,
            supportsBackground: false,
            supportsOutputFormat: false,
            supportsAutoSize: false,
        };
    }

    if (lower.includes('dall-e-2')) {
        return {
            family: 'dall-e-2',
            sendResponseFormatB64: true,
            supportsQuality: false,
            qualityOptions: [],
            supportsStyle: false,
            supportsBackground: false,
            supportsOutputFormat: false,
            supportsAutoSize: false,
        };
    }

    return {
        family: 'compat',
        sendResponseFormatB64: false,
        supportsQuality: false,
        qualityOptions: [],
        supportsStyle: false,
        supportsBackground: false,
        supportsOutputFormat: false,
        supportsAutoSize: true,
    };
}
