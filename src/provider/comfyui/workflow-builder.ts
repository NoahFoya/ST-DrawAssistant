/**
 * ComfyUI 工作流模板变量注入工具。
 *
 * @remarks
 * 基于纯函数实现 ComfyUI API 格式工作流的参数替换。
 * 支持模型（%basemodel_name% / %model_name% / %unet_name% / %clip_name% / %vae_name%）、提示词及数值采样参数的注入。
 *
 * ComfyUI 节点对输入类型有明确区分（如采样器数值参数要求 number，文本编码节点要求 string）。
 * 模块根据变量类型进行分流处理，保证类型与节点输入要求一致。
 */

/** 工作流注入变量字典类型 */
export type WorkflowVariables = Record<string, string | number | undefined>;

/**
 * 数值型模板变量集合。
 * 命中该集合的变量在注入时会解析或保持为数值类型。
 */
const NUMERIC_PLACEHOLDERS = new Set([
    '%seed%',
    '%steps%',
    '%cfg%',
    '%width%',
    '%height%',
    '%denoise%',
    '%batch_size%',
    '%mask_blur%',
]);

/**
 * 标准化模板变量键名。
 *
 * @remarks
 * 支持调用方传入不带百分号的键名（如 "basemodel_name"）或已带百分号的形式（"%basemodel_name%"），
 * 统一归一化为标准的 "%key%" 格式，便于字典索引。
 *
 * @param key 原始键名
 * @returns 带有首尾百分号的标准模板变量文本
 */
function normalizeKey(key: string): string {
    const trimmed = key.trim();
    if (trimmed.startsWith('%') && trimmed.endsWith('%') && trimmed.length >= 2) {
        return trimmed;
    }
    return `%${trimmed}%`;
}

/**
 * 解析并生成高精度随机种子。
 *
 * @remarks
 * 若调用方传入有限的非负数（包括 0），向下取整为合法整型保留确定性；
 * 若未传入或传入无效数值（负数、NaN 等），生成 0 到 10^14 - 1 范围内的随机非负整数，
 * 满足 ComfyUI 64 位整型种子范围并保证单次生成的确定性。
 *
 * @param seed 用户指定的种子值
 * @returns 确定的整型种子数值
 */
export function resolveSeed(seed?: number): number {
    if (typeof seed === 'number' && Number.isFinite(seed) && seed >= 0) {
        return Math.floor(seed);
    }
    return Math.floor(Math.random() * 1e14);
}

/**
 * 构建并注入工作流模板变量。
 *
 * @remarks
 * 对原始工作流对象深拷贝后递归遍历注入，避免修改原工作流模板。
 * 遍历过程中完整保留节点间连线数组结构（如 ["4", 0]）及未在字典中配置的字段。
 *
 * @param rawWorkflow 原始 ComfyUI API 节点图对象
 * @param variables 待注入的变量字典
 * @returns 变量注入完成后的全新工作流对象
 */
export function buildWorkflow(
    rawWorkflow: Record<string, unknown>,
    variables?: WorkflowVariables
): Record<string, unknown> {
    if (!rawWorkflow || typeof rawWorkflow !== 'object') {
        return {};
    }

    if (!variables || Object.keys(variables).length === 0) {
        return JSON.parse(JSON.stringify(rawWorkflow));
    }

    // 分流数值变量与字符串变量（全字段匹配优先保留数值类型；内嵌占位符统一执行单遍文本替换）
    const numberVars = new Map<string, number>();
    const stringVars = new Map<string, string>();
    const stringReplacements = new Map<string, string>();

    for (const [key, value] of Object.entries(variables)) {
        if (value === undefined || value === null) {
            continue;
        }

        const normKey = normalizeKey(key);
        const isNumericPlaceholder = NUMERIC_PLACEHOLDERS.has(normKey);

        if (typeof value === 'number' && Number.isFinite(value)) {
            numberVars.set(normKey, value);
            stringReplacements.set(normKey, String(value));
        } else if (isNumericPlaceholder && typeof value === 'string') {
            const trimmed = value.trim();
            const parsed = Number(trimmed);
            if (trimmed !== '' && Number.isFinite(parsed)) {
                numberVars.set(normKey, parsed);
                stringReplacements.set(normKey, String(parsed));
            } else {
                stringVars.set(normKey, value);
                stringReplacements.set(normKey, value);
            }
        } else {
            const strVal = String(value);
            stringVars.set(normKey, strVal);
            stringReplacements.set(normKey, strVal);
        }
    }

    function processValue(val: unknown): unknown {
        if (typeof val === 'string') {
            // 完全匹配模板变量时保留对应数据类型
            if (numberVars.has(val)) {
                return numberVars.get(val)!;
            }

            if (stringVars.has(val)) {
                return stringVars.get(val)!;
            }

            if (!val.includes('%')) {
                return val;
            }

            // 单遍替换内嵌占位符，防止先替换出的提示词文本含 `%seed%` 等字样被二次展开
            return val.replace(/%[a-zA-Z0-9_]+%/g, (placeholder) =>
                stringReplacements.has(placeholder)
                    ? stringReplacements.get(placeholder)!
                    : placeholder
            );
        }

        // 保持数组结构（如节点连线引用）
        if (Array.isArray(val)) {
            return val.map(processValue);
        }

        // 递归处理子对象
        if (val !== null && typeof val === 'object') {
            const nextObj: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
                nextObj[k] = processValue(v);
            }
            return nextObj;
        }

        return val;
    }

    return processValue(rawWorkflow) as Record<string, unknown>;
}
