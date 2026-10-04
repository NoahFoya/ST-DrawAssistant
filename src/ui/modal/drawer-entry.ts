/**
 * SillyTavern 宿主抽屉快捷入口。
 *
 * @remarks
 * 负责探测宿主扩展侧边栏并在其中挂载快捷唤起按钮。
 */

import type { Disposable } from '../types';

export interface DrawerEntryOptions {
    onOpenSettings?: () => void;
}

export class DrawerEntry implements Disposable {
    private isMountedState = false;

    constructor(private readonly options: DrawerEntryOptions = {}) {}

    /**
     * 挂载抽屉入口至宿主容器。
     */
    public mount(): void {
        this.isMountedState = true;
    }

    /**
     * 触发打开设置面板。
     */
    public triggerOpen(): void {
        this.options.onOpenSettings?.();
    }

    /**
     * 释放抽屉入口。
     */
    public dispose(): void {
        this.isMountedState = false;
    }

    /**
     * 获取当前挂载状态。
     */
    public isMounted(): boolean {
        return this.isMountedState;
    }
}
