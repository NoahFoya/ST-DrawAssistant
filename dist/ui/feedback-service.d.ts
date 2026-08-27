/**
 * @module ui/feedback-service
 * @description 扩展统一 UI 用户反馈与交互门面服务 (FeedbackService Facade)
 *
 * 设计模式：门面模式 (Facade Pattern)
 *
 * 核心职责：
 * - 统一封装 Toast 浮动气泡、Modal 确认对话框、Prompt 输入框与未保存防呆拦截服务
 * - 隔离底层 DOM 模态框构建细节与 SillyTavern 宿主原生的 toastr 通知接口
 * - 集中调度 UI_MESSAGES 提示字典，向上层 UI 选项卡与组件提供声明式调用接口
 */
/**
 * Tab 未保存状态数据提供者接口
 */
export interface UnsavedProvider {
    /** 标签页唯一标识符 */
    tabId: string;
    /** 标签页用户可读名称 */
    tabName: string;
    /** 检查当前标签页是否存在未保存修改的函数 */
    hasUnsavedChanges: () => boolean;
    /** 保存当前未保存修改的异步函数 */
    saveChanges: () => Promise<void> | void;
    /** 放弃当前未保存修改的回调函数 */
    discardChanges: () => void;
}
declare class UnsavedStateManagerImpl {
    private providers;
    private stateChangeListeners;
    registerProvider(provider: UnsavedProvider): void;
    unregisterProvider(tabId: string): void;
    subscribeStateChange(listener: () => void): () => void;
    notifyStateChange(): void;
    getDirtyProviders(): UnsavedProvider[];
    checkUnsavedBeforeAction(actionDesc?: string): Promise<'proceed' | 'cancel'>;
}
export declare const unsavedStateManager: UnsavedStateManagerImpl;
export declare class FeedbackService {
    /** 弹出标准成功/提示 Toast 气泡 */
    static toastSuccess(message: string, title?: string): void;
    /** 弹出标准错误 Toast 气泡 */
    static toastError(message: string, title?: string): void;
    /** 弹出警告 Toast 气泡 */
    static toastWarning(message: string, title?: string): void;
    /** 弹出信息 Toast 气泡 */
    static toastInfo(message: string, title?: string): void;
    /** 根据预设方案类别快捷弹出【保存成功】Toast */
    static notifySaved(category: string): void;
    /**
     * 语义化删除确认对话框 (自动对接 UI_MESSAGES 字典)
     */
    static confirmDelete(target: string, extraParam?: any): Promise<boolean>;
    /**
     * 语义化预设名称输入对话框 (自动对接 UI_MESSAGES 字典)
     */
    static promptName(action: 'new' | 'rename', target: string, defaultValue?: string): Promise<string | null>;
    /** 自定义通用确认框 */
    static confirm(title: string, message: string, confirmText?: string, isDangerous?: boolean): Promise<boolean>;
    /** 自定义通用 Prompt 输入框 */
    static prompt(title: string, message: string, defaultValue?: string, placeholder?: string): Promise<string | null>;
    /** 注册指定 Tab 的未保存检查器 */
    static registerUnsavedProvider(provider: UnsavedProvider): void;
    /** 注销指定 Tab 的未保存检查器 */
    static unregisterUnsavedProvider(tabId: string): void;
    /** 执行全局防呆检查 (切 Tab 或关面板) */
    static checkUnsavedBefore(actionDesc?: string): Promise<'proceed' | 'cancel'>;
}
export {};
//# sourceMappingURL=feedback-service.d.ts.map