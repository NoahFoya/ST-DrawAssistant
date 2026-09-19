/**
 * ST-DrawAssistant 方案预设管理器脏状态追踪器 (PresetDirtyTracker)。
 *
 * @remarks
 * 专门面向方案管理器 (Prompt 方案、绘图参数方案、工作流方案等)，维护已存方案基准快照 (Baseline)，
 * 比对当前编辑参数的语义等价性，驱动脏状态高亮指示与“一键还原至方案原值”能力。
 */

import type { IControlHandle } from './types';

/**
 * 语义等价判别函数。
 *
 * @remarks
 * 避免因格式等价伪差异（如 Hex 颜色大小写、文本两端空白、微小浮点精度误差）导致误判为脏状态。
 */
export function isSemanticallyEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;

    // 1. 字符串比对（修剪两端空白）
    if (typeof a === 'string' && typeof b === 'string') {
        const trimmedA = a.trim();
        const trimmedB = b.trim();

        // Hex 颜色大小写不敏感
        if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmedA) &&
            /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmedB)) {
            return trimmedA.toLowerCase() === trimmedB.toLowerCase();
        }

        return trimmedA === trimmedB;
    }

    // 2. 数值比对（容忍微小浮点舍入误差）
    if (typeof a === 'number' && typeof b === 'number') {
        return Math.abs(a - b) < 0.0001;
    }

    // 3. 布尔值比对
    if (typeof a === 'boolean' && typeof b === 'boolean') {
        return a === b;
    }

    // 4. 数组比对
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!isSemanticallyEqual(a[i], b[i])) return false;
        }
        return true;
    }

    // 5. 纯对象比对
    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a as Record<string, unknown>);
        const keysB = Object.keys(b as Record<string, unknown>);
        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (!isSemanticallyEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
        }
        return true;
    }

    return false;
}

export interface PresetDirtyTrackerOptions<T extends Record<string, any>> {
    /** 初始基准数据快照 */
    baseline?: T;
    /** 脏状态变动回调 */
    onDirtyChange?: (isDirty: boolean, dirtyKeys: Set<keyof T>) => void;
}

export class PresetDirtyTracker<T extends Record<string, any> = Record<string, any>> {
    private baseline: T;
    private readonly boundControls = new Map<keyof T, IControlHandle<any>>();
    private readonly dirtyKeys = new Set<keyof T>();
    private readonly onDirtyChange?: (isDirty: boolean, dirtyKeys: Set<keyof T>) => void;

    constructor(options: PresetDirtyTrackerOptions<T> = {}) {
        this.baseline = options.baseline ? JSON.parse(JSON.stringify(options.baseline)) : ({} as T);
        this.onDirtyChange = options.onDirtyChange;
    }

    /**
     * 更新当前方案基准快照 (如用户切换方案或执行保存后)
     * @param baseline 新基准方案数据
     */
    public setBaseline(baseline: T): void {
        this.baseline = JSON.parse(JSON.stringify(baseline));
        this.recalculate();
    }

    /**
     * 获取当前基准快照克隆副本
     */
    public getBaseline(): Readonly<T> {
        return JSON.parse(JSON.stringify(this.baseline));
    }

    /**
     * 关联受控输入控件
     * @param key 对应的方案字段名
     * @param control 表单输入控件句柄
     */
    public bindControl(key: keyof T, control: IControlHandle<any>): void {
        this.boundControls.set(key, control);
    }

    /**
     * 取消受控输入控件关联
     * @param key 方案字段名
     */
    public unbindControl(key: keyof T): void {
        const control = this.boundControls.get(key);
        if (control) {
            control.setDirty?.(false);
            this.boundControls.delete(key);
            this.dirtyKeys.delete(key);
        }
    }

    /**
     * 检查并更新指定字段或全局数据脏状态
     * @param currentData 当前表单整包数据 (可选；若未传入则从已绑定的控件获取)
     */
    public checkDirty(currentData?: Partial<T>): boolean {
        const prevDirty = this.isDirty();
        const dataToCheck = currentData || this.collectCurrentData();

        for (const [key, control] of this.boundControls.entries()) {
            const currentVal = dataToCheck[key];
            const baselineVal = this.baseline[key];
            const isFieldDirty = !isSemanticallyEqual(currentVal, baselineVal);

            if (isFieldDirty) {
                this.dirtyKeys.add(key);
                control.setDirty?.(true);
            } else {
                this.dirtyKeys.delete(key);
                control.setDirty?.(false);
            }
        }

        const nowDirty = this.isDirty();
        if (prevDirty !== nowDirty || this.dirtyKeys.size > 0) {
            this.onDirtyChange?.(nowDirty, new Set(this.dirtyKeys));
        }

        return nowDirty;
    }

    /**
     * 当前方案是否存在未保存的修改
     */
    public isDirty(): boolean {
        return this.dirtyKeys.size > 0;
    }

    /**
     * 获取所有发生修改的字段键名集合
     */
    public getDirtyKeys(): Set<keyof T> {
        return new Set(this.dirtyKeys);
    }

    /**
     * 一键还原所有受控控件至当前基准方案的原值
     */
    public revert(): void {
        for (const [key, control] of this.boundControls.entries()) {
            const baselineVal = this.baseline[key];
            if (baselineVal !== undefined) {
                control.setValue(baselineVal, { silent: true });
                control.setDirty?.(false);
            }
        }
        this.dirtyKeys.clear();
        this.onDirtyChange?.(false, new Set());
    }

    /**
     * 标记当前表单已保存覆盖为新方案基准
     * @param newBaseline 新的基准方案数据 (可选；若未传入则取当前控件值)
     */
    public markSaved(newBaseline?: T): void {
        const nextBaseline = newBaseline || this.collectCurrentData();
        this.setBaseline(nextBaseline);
        for (const control of this.boundControls.values()) {
            control.setDirty?.(false);
        }
        this.dirtyKeys.clear();
        this.onDirtyChange?.(false, new Set());
    }

    private collectCurrentData(): T {
        const result = { ...this.baseline };
        for (const [key, control] of this.boundControls.entries()) {
            result[key] = control.getValue();
        }
        return result;
    }

    private recalculate(): void {
        this.checkDirty();
    }

    public dispose(): void {
        for (const control of this.boundControls.values()) {
            control.setDirty?.(false);
        }
        this.boundControls.clear();
        this.dirtyKeys.clear();
    }
}
