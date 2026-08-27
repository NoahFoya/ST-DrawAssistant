/**
 * @module core/event-bus
 * @description 全局事件发布与订阅总线 (EventBus)
 *
 * 设计模式：发布订阅模式 (PubSub Pattern)
 *
 * 核心职责：
 * - 提供类型安全的事件发布与订阅机制，实现组件间解耦通信
 * - 提供单例 globalEventBus 供全局事件调度
 * - 声明 DA_EVENTS 常量字典，统一维护扩展内部通信契约
 */
/**
 * 通用事件总线类
 */
export declare class EventBus {
    private readonly _handlers;
    /**
     * 订阅指定事件
     *
     * @param event 事件名称
     * @param handler 事件接收回调函数
     * @returns 取消该订阅的解绑闭包函数
     */
    on<T = unknown>(event: string, handler: (payload: T) => void): () => void;
    /**
     * 取消订阅事件
     *
     * @param event 事件名称
     * @param handler 已注册的回调函数
     */
    off(event: string, handler: Function): void;
    /**
     * 广播触发指定事件
     *
     * @param event 事件名称
     * @param payload 随事件传递的数据参数（可选）
     */
    emit<T = unknown>(event: string, payload?: T): void;
    /**
     * 单次订阅事件（触发一次后自动解除解绑）
     *
     * @param event 事件名称
     * @param handler 单次触发回调
     */
    once<T = unknown>(event: string, handler: (payload: T) => void): void;
    /**
     * 移除某事件绑定的全部监听回调
     *
     * @param event 事件名称
     */
    clearEvent(event: string): void;
}
export declare const globalEventBus: EventBus;
/**
 * DrawAssistant 全局事件名注册表
 * 所有模块必须通过此常量引用事件名，禁止硬编码字符串
 */
export declare const DA_EVENTS: {
    /** 设置项发生变更（payload: Partial<DrawAssistantSettings>） */
    readonly SETTINGS_CHANGED: "da:settings-changed";
    /** 图像驱动或 Provider 发生切换（payload: { provider: ImageProvider }） */
    readonly DRIVER_CHANGED: "da:driver-changed";
    /** 生图任务已提交（payload: { taskId: string }） */
    readonly TASK_SUBMITTED: "da:task-submitted";
    /** 生图任务已完成（payload: { taskId: string; result: GenerateResult }） */
    readonly TASK_COMPLETED: "da:task-completed";
    /** 图库数据发生变化（payload: void）*/
    readonly GALLERY_CHANGED: "da:gallery-changed";
    /** 主题发生切换（payload: { themeId: string }） */
    readonly THEME_CHANGED: "da:theme-changed";
    /** 扩展启用状态变化（payload: { extensionId: string; enabled: boolean }） */
    readonly EXTENSION_TOGGLED: "da:extension-toggled";
};
export type DAEventName = typeof DA_EVENTS[keyof typeof DA_EVENTS];
//# sourceMappingURL=event-bus.d.ts.map