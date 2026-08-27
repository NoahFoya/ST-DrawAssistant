/**
 * @module ui/layout/unsaved-floating-notice
 * @description 顶置居中独立浮动未保存提示通知条 (UnsavedFloatingNotice)
 */
import { IDisposable } from '../../core/foundation/disposable';
export interface FloatingNoticeComponent extends IDisposable {
    readonly element: HTMLElement;
}
/**
 * 创建独立顶置未保存提示浮层组件
 */
export declare function createUnsavedFloatingNotice(): FloatingNoticeComponent;
//# sourceMappingURL=unsaved-floating-notice.d.ts.map