/**
 * ComfyUI 工作流模板变量注入工具。
 *
 * @remarks
 * 基于纯函数实现 ComfyUI API 格式工作流的参数替换。
 * 支持主模型 (%basemodel_name%)、额外模型 (%extramodel_name%n)、提示词及采样参数的注入。
 *
 * ComfyUI 节点对输入类型有明确区分（如采样器数值参数要求 number，文本编码节点要求 string）。
 * 模块根据占位符类型进行分流处理，保证类型与节点输入要求一致。
 */

/** 工作流注入变量字典类型 */
export type WorkflowVariables = Record<string, string | number | undefined>;

/**
 * 数值型占位符集合。
 * 命中该集合的占位符在注入时会解析或保持为数值类型。
 */
const NUMERIC_PLACEHOLDERS = new Set([
    '%seed%',
    '%steps%',
    '%cfg%',
    '%width%',
    '%height%',
    '%denoise%',
    '%batch_size%',
]);

/**
 * 标准化变量占位符键名。
 *
 * @remarks
 * 支持调用方传入不带百分号的键名（如 "basemodel_name"）或已带百分号的形式（"%basemodel_name%"），
 * 统一归一化为标准的 "%key%" 格式，便于字典索引。
 *
 * @param key 原始键名
 * @returns 带有首尾百分号的标准占位符文本
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
 * 若调用方传入有限的正数，向下取整为合法整型；
 * 若未传入或传入无效数值（非正数、NaN 等），生成 1 到 10^14 范围内的随机正整数，
 * 满足 ComfyUI 64 位整型种子范围并保证单次生成的确定性。
 *
 * @param seed 用户指定的种子值
 * @returns 确定的整型种子数值
 */
export function resolveSeed(seed?: number): number {
    if (typeof seed === 'number' && Number.isFinite(seed) && seed > 0) {
        return Math.floor(seed);
    }
    return Math.floor(Math.random() * 1e14);
}

/**
 * 构建并注入工作流模板变量。
 *
 * @remarks
 * 纯函数执行，对原始工作流对象执行深拷贝后递归遍历注入，保证模板缓存不被意外污染。
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

    // 分流数值变量与字符串变量
    const numberVars = new Map<string, number>();
    const stringVars = new Map<string, string>();

    for (const [key, value] of Object.entries(variables)) {
        if (value === undefined || value === null) {
            continue;
        }

        const normKey = normalizeKey(key);
        const isNumericPlaceholder = NUMERIC_PLACEHOLDERS.has(normKey);

        if (typeof value === 'number' && Number.isFinite(value)) {
            numberVars.set(normKey, value);
        } else if (isNumericPlaceholder && typeof value === 'string') {
            const trimmed = value.trim();
            const parsed = Number(trimmed);
            if (trimmed !== '' && Number.isFinite(parsed)) {
                numberVars.set(normKey, parsed);
            } else {
                stringVars.set(normKey, value);
            }
        } else {
            stringVars.set(normKey, String(value));
        }
    }

    function processValue(val: unknown): unknown {
        if (typeof val === 'string') {
            // 完全匹配占位符时保留对应数据类型
            if (numberVars.has(val)) {
                return numberVars.get(val)!;
            }

            if (stringVars.has(val)) {
                return stringVars.get(val)!;
            }

            // 局部包含占位符时作为文本替换
            let result = val;
            let replaced = false;

            for (const [placeholder, numVal] of numberVars.entries()) {
                if (result.includes(placeholder)) {
                    result = result.split(placeholder).join(String(numVal));
                    replaced = true;
                }
            }

            for (const [placeholder, strVal] of stringVars.entries()) {
                if (result.includes(placeholder)) {
                    result = result.split(placeholder).join(strVal);
                    replaced = true;
                }
            }

            return replaced ? result : val;
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
