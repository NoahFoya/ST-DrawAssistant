/**
 * 对象操作工具
 * 提供纯对象判定、深度克隆与递归合并能力。
 */

/**
 * 校验目标是否为字面量纯对象（排除 null、数组、Date、RegExp 与 DOM/类实例）。
 */
export function isPlainObject(val: unknown): val is Record<string, any> {
    if (typeof val !== 'object' || val === null) {
        return false;
    }
    if (Array.isArray(val)) {
        return false;
    }
    const proto = Object.getPrototypeOf(val);
    return proto === null || proto === Object.prototype;
}

/**
 * 深度克隆复合对象，完全解除内存引用。
 */
export function deepClone<T>(target: T): T {
    if (target === null || typeof target !== 'object') {
        return target;
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(target);
        } catch {
            // 降级使用递归克隆
        }
    }

    if (Array.isArray(target)) {
        return target.map((item) => deepClone(item)) as unknown as T;
    }

    if (isPlainObject(target)) {
        const copy: Record<string, any> = {};
        for (const [key, value] of Object.entries(target)) {
            copy[key] = deepClone(value);
        }
        return copy as T;
    }

    return target;
}

/**
 * 深度合并源对象至目标对象。
 * 针对同名纯对象进行递归合并，数组与原始值由源对象直接覆盖；
 * 严格过滤 __proto__、constructor 与 prototype 属性，防范原型链污染。
 */
export function deepMerge<T extends Record<string, any>>(target: T, source?: Partial<T> | null): T {
    if (!source || !isPlainObject(source)) {
        return deepClone(target);
    }

    const result = deepClone(target) as Record<string, any>;

    for (const key of Object.keys(source)) {
        // 安全防护：防止原型链污染
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }

        const srcVal = (source as any)[key];
        const tgtVal = result[key];

        if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
            result[key] = deepMerge(tgtVal, srcVal);
        } else if (srcVal !== undefined) {
            result[key] = deepClone(srcVal);
        }
    }

    return result as T;
}
