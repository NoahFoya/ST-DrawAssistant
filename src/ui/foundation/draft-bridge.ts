/**
 * @module ui/foundation/draft-bridge
 * @description 草稿数据投影同步器 (DraftBridge: 将草稿 Store 状态声明式同步投影至持久化主 Store)
 *
 * 设计意图：
 * 消除 Tab 视图中逐字段手动复制 15+ 状态的繁琐样板代码。
 * 传入需要同步的字段键列表，DraftBridge 会在草稿变更时自动过滤并更新主 Store。
 *
 * 用法：
 *   const bridge = new DraftBridge(draftStore, mainStore, COMFYUI_DRAFT_KEYS);
 *   // Tab dispose 时自动清理：bridge.dispose()
 */

import { ObservableStore, IDisposable } from '../../core';

/**
 * 声明式草稿状态同步桥接器
 *
 * @template TState Store 状态类型
 */
export class DraftBridge<TState extends Record<string, any>> implements IDisposable {
    private readonly _unsub: IDisposable;

    /**
     * @param draftStore 草稿 Store (内存临时工作区)
     * @param mainStore  持久化主 Store
     * @param keys       需要从草稿同步至主 Store 的字段名数组
     */
    constructor(
        draftStore: ObservableStore<TState>,
        mainStore: ObservableStore<TState>,
        keys: readonly (keyof TState)[]
    ) {
        this._unsub = draftStore.subscribe((draft) => {
            const patch = {} as Partial<TState>;
            for (const k of keys) {
                patch[k] = draft[k];
            }
            mainStore.update(patch);
        });
    }

    dispose(): void {
        this._unsub.dispose();
    }
}
