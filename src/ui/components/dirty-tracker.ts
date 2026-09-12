/**
 * @module src/ui/components/dirty-tracker
 * @description 表单脏状态变更追踪器 (DirtyTracker)
 *
 * 核心逻辑与状态流转：
 * 1. 基于表单加载或保存时的初始基准快照 (baseline)，实时比对当前字段值；
 * 2. 字段值发生变动时标记脏状态 (.is-dirty)，触发对应保存按钮的高亮提示；
 * 3. 当用户将字段值改回基准值时，自动清除脏标记并熄灭保存按钮高亮；
 * 4. 保存成功后更新基准快照，重置所有字段状态。
 */

export type DirtyChangeListener = (isDirty: boolean, dirtyKeys: Set<string>) => void;

export interface IDirtyTracker<T extends Record<string, any>> {
    /** 更新基准快照 (如保存成功或重置时调用) */
    setBaseline(newBaseline: T): void;
    /** 获取当前基准快照 */
    getBaseline(): Readonly<T>;
    /** 检查并记录特定字段的当前值，返回该字段是否处于脏态 */
    notifyFieldChange<K extends keyof T>(key: K, currentValue: T[K]): boolean;
    /** 查询整体表单是否脏态 */
    isDirty(): boolean;
    /** 查询特定字段是否脏态 */
    isFieldDirty(key: keyof T): boolean;
    /** 获取所有已修改的键名集合 */
    getDirtyKeys(): Set<keyof T>;
    /** 注册脏态变化监听回调 */
    onDirtyChange(listener: DirtyChangeListener): () => void;
    /** 销毁追踪器 */
    dispose(): void;
}

/**
 * 创建轻量脏态追踪器
 */
export function createDirtyTracker<T extends Record<string, any>>(
    initialBaseline: T,
    onDirtyChangeCallback?: DirtyChangeListener
): IDirtyTracker<T> {
    let baseline: T = { ...initialBaseline };
    const currentValues: Partial<T> = { ...initialBaseline };
    const dirtyKeys = new Set<keyof T>();
    const listeners = new Set<DirtyChangeListener>();

    if (onDirtyChangeCallback) {
        listeners.add(onDirtyChangeCallback);
    }

    const checkEquality = (a: any, b: any): boolean => {
        if (a === b) return true;
        if (typeof a === 'string' && typeof b === 'string') {
            if (a.startsWith('#') && b.startsWith('#') && a.length === b.length) {
                return a.toLowerCase() === b.toLowerCase();
            }
        }
        if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) return true;
        if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
            return JSON.stringify(a) === JSON.stringify(b);
        }
        return false;
    };

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

    return {
        setBaseline(newBaseline: T): void {
            const wasDirty = dirtyKeys.size > 0;
            baseline = { ...newBaseline };
            for (const k of Object.keys(newBaseline)) {
                currentValues[k as keyof T] = newBaseline[k as keyof T];
            }
            dirtyKeys.clear();
            notify(wasDirty, false);
        },

        getBaseline(): Readonly<T> {
            return baseline;
        },

        notifyFieldChange<K extends keyof T>(key: K, currentValue: T[K]): boolean {
            const wasDirty = dirtyKeys.size > 0;
            currentValues[key] = currentValue;

            const baseVal = baseline[key];
            const isFieldModified = !checkEquality(baseVal, currentValue);

            if (isFieldModified) {
                dirtyKeys.add(key);
            } else {
                dirtyKeys.delete(key);
            }

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

        getDirtyKeys(): Set<keyof T> {
            return new Set(dirtyKeys);
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
        }
    };
}
