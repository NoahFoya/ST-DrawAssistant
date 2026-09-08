/**
 * 模型资产工具函数
 * 提供模型文件格式识别、基础模型架构推断以及下拉选项标签生成。
 */

import { ModelAssetItem } from '../../types/driver';

/**
 * 根据文件名、路径或配置名称推断基础模型架构
 */
export function detectModelArchitecture(name: string, config?: string): string | undefined {
    const combined = `${name || ''} ${config || ''}`.toLowerCase();

    // 1. Pony
    if (/pony/i.test(combined)) {
        return 'pony';
    }
    // 2. Illustrious / NoobAI
    if (/illustrious|noobai/i.test(combined)) {
        return 'illustrious';
    }
    // 3. Flux
    if (/flux/i.test(combined)) {
        return 'flux';
    }
    // 4. SDXL (sdxl, animaginexl, etc.)
    if (/sd_?xl|[-_.]xl|xl[-_.]|animagine/i.test(combined)) {
        return 'sdxl';
    }
    // 5. SD 3 / 3.5
    if (/sd_?3(?:\.5)?/i.test(combined)) {
        return 'sd3';
    }
    // 6. SD 2.1 / 2.0
    if (/sd_?2(?:\.1)?|768-v/i.test(combined)) {
        return 'sd21';
    }
    // 7. SD 1.5 / 1.4
    if (/sd_?1\.?[45]|v1-5|v1\.5/i.test(combined)) {
        return 'sd15';
    }
    // 8. Qwen / Moody
    if (/qwen|moody/i.test(combined)) {
        return 'qwen';
    }
    // 9. Wan
    if (/wan(?:2\.1)?/i.test(combined)) {
        return 'wan';
    }
    // 10. Hunyuan
    if (/hunyuan/i.test(combined)) {
        return 'hunyuan';
    }

    return undefined;
}

/**
 * 根据文件后缀或命名特征推断模型格式类型
 */
export function detectModelFormatType(filename: string, defaultType = 'checkpoint'): string {
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.gguf')) {
        return 'gguf';
    }
    if (lower.includes('-nf4') || lower.includes('_nf4') || lower.includes('bnb-nf4')) {
        return 'nf4';
    }
    if (lower.includes('diffusers') || (!lower.includes('.') && lower.includes('/'))) {
        return 'diffusers';
    }
    return defaultType;
}

/**
 * 格式化模型在下拉框中的展示标签
 * 统一带上 [Checkpoint]、[UNet]、[GGUF] 等格式前缀
 */
export function formatModelDisplayLabel(item: ModelAssetItem | string): string {
    if (typeof item === 'string') {
        return item;
    }

    const typePrefix = item.type
        ? `[${formatTypeTag(item.type)}] `
        : '';

    const displayName = item.title || item.name;
    return `${typePrefix}${displayName}`;
}

function formatTypeTag(type: string): string {
    switch (type.toLowerCase()) {
        case 'checkpoint':
            return 'Checkpoint';
        case 'unet':
            return 'UNet';
        case 'gguf':
            return 'GGUF';
        case 'nf4':
            return 'NF4';
        case 'diffusers':
            return 'Diffusers';
        default:
            return type.charAt(0).toUpperCase() + type.slice(1);
    }
}
