/**
 * 表单脏状态变更追踪器 (DirtyTracker)
 *
 * 功能：
 * 1. 基于表单加载或保存时的初始基准快照 (baseline)，实时比对当前字段值；
 * 2. 字段值发生变动时标记脏状态 (.is-dirty)，触发对应保存按钮的高亮提示；
 * 3. 当用户将字段值改回基准值时，自动清除脏标记并熄灭保存按钮高亮；
 * 4. 保存成功后更新基准快照，支持一键回滚全部修改并同步已绑定控件。
 *
 * Tips：
 * 1. 深度比对内置颜色大小写不敏感、数值与数值字符串等价等语义比对规则；
 * 2. 表单面板销毁时调用 dispose 解绑所有控件与监听回调，避免引用残留。
 */

export type DirtyChangeListener = (isDirty: boolean, dirtyKeys: Set<string>) => void;

export interface IBoundControl {
    setDirty(isDirty: boolean): void;
    setValue?(val: any): void;
}

export interface IDirtyTracker<T extends Record<string, any>> {
    /** 更新基准快照 (如保存成功或重置时调用) */
    setBaseline(newBaseline: T): void;
    /** 获取当前基准快照 */
    getBaseline(): Readonly<T>;
    /** 保存成功后将当前已编辑的值固化为新基准快照，清空脏态 */
    commitBaseline(newValues?: Partial<T>): void;
    /** 将当前编辑值回滚为基准快照，清空脏态并返回基准值拷贝 */
    revertBaseline(): T;
    /** 检查并记录特定字段的当前值，返回该字段是否处于脏态并自动同步绑定控件 */
    notifyFieldChange<K extends keyof T>(key: K, currentValue: T[K]): boolean;
    /** 查询整体表单是否脏态 */
    isDirty(): boolean;
    /** 查询特定字段是否脏态 */
    isFieldDirty(key: keyof T): boolean;
    /** 获取当前最新编辑值快照 */
    getCurrentValues(): Readonly<Partial<T>>;
    /** 获取所有已修改的键名集合 */
    getDirtyKeys(): Set<keyof T>;
    /** 将输入控件句柄与特定字段双向绑定，自动响应 setDirty 与 revertBaseline */
    bindControl(key: keyof T, control: IBoundControl): () => void;
    /** 注册脏态变化监听回调 */
    onDirtyChange(listener: DirtyChangeListener): () => void;
    /** 销毁追踪器与所有事件/控件绑定 */
    dispose(): void;
}

/** 深度比对两个对象或值是否在语义上等价 */
function isSemanticallyEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;

    // 1. 颜色 Hex 忽略大小写
    if (typeof a === 'string' && typeof b === 'string') {
        if (a.startsWith('#') && b.startsWith('#') && a.length === b.length) {
            return a.toLowerCase() === b.toLowerCase();
        }
        // 普通字符串修剪后比对
        if (a.trim() === b.trim()) return true;
    }

    // 2. 数值与数值字符串等价比对 (例如 "1024" 与 1024)
    if ((typeof a === 'number' || typeof a === 'string') && (typeof b === 'number' || typeof b === 'string')) {
        const numA = Number(a);
        const numB = Number(b);
        if (!isNaN(numA) && !isNaN(numB) && String(a).trim() !== '' && String(b).trim() !== '') {
            return numA === numB;
        }
    }

    // 3. NaN 等价
    if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true;

    // 4. 数组比对
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!isSemanticallyEqual(a[i], b[i])) return false;
        }
        return true;
    }

    // 5. 对象深层比对 (属性顺序不敏感)
    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const k of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
            if (!isSemanticallyEqual(a[k], b[k])) return false;
        }
        return true;
    }

    return false;
}

/**
 * 创建轻量表单脏状态追踪与自动恢复机制
 */
export function createDirtyTracker<T extends Record<string, any>>(
    initialBaseline: T,
    onDirtyChangeCallback?: DirtyChangeListener
): IDirtyTracker<T> {
    let baseline: T = JSON.parse(JSON.stringify(initialBaseline));
    const currentValues: Partial<T> = JSON.parse(JSON.stringify(initialBaseline));
    const dirtyKeys = new Set<keyof T>();
    const listeners = new Set<DirtyChangeListener>();
    const boundControls = new Map<keyof T, Set<IBoundControl>>();

    if (onDirtyChangeCallback) {
        listeners.add(onDirtyChangeCallback);
    }

    const notify = (wasDirty: boolean, nowDirty: boolean) => {
        if (wasDirty !== nowDirty || listeners.size > 0) {
            for (const listener of listeners) {
                try {
                    listener(nowDirty, dirtyKeys as Set<string>);
                } catch (err) {
                    console.error('[DirtyTracker] 监听器执行异常:', err);
                }
            }
        }
    };

    const syncControlDirty = (key: keyof T, isFieldDirty: boolean) => {
        const controls = boundControls.get(key);
        if (controls) {
            for (const ctrl of controls) {
                try {
                    ctrl.setDirty(isFieldDirty);
                } catch (err) {
                    console.error('[DirtyTracker] 同步控件脏状态异常:', err);
                }
            }
        }
    };

    return {
        setBaseline(newBaseline: T): void {
            const wasDirty = dirtyKeys.size > 0;
            baseline = JSON.parse(JSON.stringify(newBaseline));
            for (const k of Object.keys(newBaseline)) {
                currentValues[k as keyof T] = newBaseline[k as keyof T];
            }
            dirtyKeys.clear();

            for (const [, controls] of boundControls.entries()) {
                for (const ctrl of controls) {
                    ctrl.setDirty(false);
                }
            }

            notify(wasDirty, false);
        },

        getBaseline(): Readonly<T> {
            return baseline;
        },

        commitBaseline(newValues?: Partial<T>): void {
            const wasDirty = dirtyKeys.size > 0;
            if (newValues) {
                Object.assign(baseline, JSON.parse(JSON.stringify(newValues)));
            } else {
                baseline = JSON.parse(JSON.stringify(currentValues));
            }
            dirtyKeys.clear();

            for (const [, controls] of boundControls.entries()) {
                for (const ctrl of controls) {
                    ctrl.setDirty(false);
                }
            }

            notify(wasDirty, false);
        },

        revertBaseline(): T {
            const wasDirty = dirtyKeys.size > 0;
            const snapshotCopy = JSON.parse(JSON.stringify(baseline)) as T;

            for (const k of Object.keys(baseline)) {
                currentValues[k as keyof T] = snapshotCopy[k as keyof T];
            }
            dirtyKeys.clear();

            for (const [key, controls] of boundControls.entries()) {
                const baseVal = baseline[key];
                for (const ctrl of controls) {
                    ctrl.setDirty(false);
                    if (typeof ctrl.setValue === 'function') {
                        ctrl.setValue(baseVal);
                    }
                }
            }

            notify(wasDirty, false);
            return snapshotCopy;
        },

        notifyFieldChange<K extends keyof T>(key: K, currentValue: T[K]): boolean {
            const wasDirty = dirtyKeys.size > 0;
            currentValues[key] = currentValue;

            const baseVal = baseline[key];
            const isFieldModified = !isSemanticallyEqual(baseVal, currentValue);

            if (isFieldModified) {
                dirtyKeys.add(key);
            } else {
                // 用户改回快照原值时，自动清除状态标记并从 dirtyKeys 移除
                dirtyKeys.delete(key);
            }

            // 同步已绑定的单字段 UI 控件高亮状态
            syncControlDirty(key, isFieldModified);

            const nowDirty = dirtyKeys.size > 0;
            notify(wasDirty, nowDirty);
            return isFieldModified;
        },

        isDirty(): boolean {
            return dirtyKeys.size > 0;
        },

        isFieldDirty(key: keyof T): boolean {
            return dirtyKeys.has(key);
        },

        getCurrentValues(): Readonly<Partial<T>> {
            return currentValues;
        },

        getDirtyKeys(): Set<keyof T> {
            return new Set(dirtyKeys);
        },

        bindControl(key: keyof T, control: IBoundControl): () => void {
            if (!boundControls.has(key)) {
                boundControls.set(key, new Set());
            }
            boundControls.get(key)!.add(control);

            // 立即按当前脏态同步一次
            control.setDirty(dirtyKeys.has(key));

            return () => {
                const set = boundControls.get(key);
                if (set) {
                    set.delete(control);
                    if (set.size === 0) boundControls.delete(key);
                }
            };
        },

        onDirtyChange(listener: DirtyChangeListener): () => void {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        dispose(): void {
            listeners.clear();
            dirtyKeys.clear();
            boundControls.clear();
        }
    };
}
