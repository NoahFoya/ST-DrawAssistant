/**
 * @module core/contracts
 * @description 核心基础服务与领域调度器接口定义
 *
 * 核心设计原则：
 * 1. 严格遵循系统分层单向依赖约束 (Extensions -> UI -> Domain -> Core)；
 * 2. 将 UI 层与领域层的通用服务抽象下沉为统一接口，避免跨层循环依赖；
 * 3. 各服务实现类在所属分层中实现对应接口，确保模块解耦与类型安全。
 */
import { IDisposable } from '../foundation/disposable';
/**
 * 外观主题服务接口
 */
export interface IThemeContract extends IDisposable {
    /**
     * 将主题配色变量注入到目标 DOM 节点或根节点
     * @param themeData 可选的主题配色属性字典
     * @param targetNode 可选的目标 DOM 节点，默认指向 document.documentElement
     */
    applyTheme(themeData?: Record<string, any>, targetNode?: HTMLElement): void;
    /**
     * 获取当前生效的主题配色数据对象
     * @returns 当前主题数据快照
     */
    getCurrentTheme(): Record<string, any>;
    /**
     * 切换并应用指定预设主题
     * @param presetId 目标主题预设唯一标识 ID
     */
    setThemePreset(presetId: string): void;
}
/**
 * 生图任务调度系统接口
 */
export interface ITaskContract extends IDisposable {
    /**
     * 提交一个新的异步生图任务
     * @param options 任务上下文标识与生图载荷 (chatId, messageId, swipeId, payload)
     * @returns 任务全局唯一标识 UUID
     */
    submit(options: {
        chatId: string;
        messageId: number;
        swipeId?: number;
        payload: any;
    }): Promise<string>;
    /**
     * 取消指定任务 (若任务在运行中则标记为客户端丢弃 DISCARDED)
     * @param taskId 目标任务 ID
     */
    cancelTask(taskId: string): Promise<void>;
    /**
     * 根据任务 ID 获取任务当前状态与结果
     * @param taskId 目标任务 ID
     * @returns 任务状态快照，若不存在则返回 undefined
     */
    getTask(taskId: string): any;
    /**
     * 获取指定楼层关联的所有任务列表
     * @param chatId 聊天会话 ID
     * @param messageId 楼层消息索引
     * @returns 该楼层的任务列表
     */
    getTasksByMessage(chatId: string, messageId: number): any[];
}
/**
 * 提示词流水线前置处理钩子接口
 */
export interface IPipelineHooksContract {
    /** 阶段 1：原始文本清理前钩子 */
    readonly beforeClean: any;
    /** 阶段 2：宏展开与角色设定标签注入钩子 (扩展层主要挂载点) */
    readonly beforePromptBuild: any;
    /** 阶段 3：提交生图驱动前的载荷拦截钩子 */
    readonly beforeSubmit: any;
}
/**
 * 模态框管理服务接口
 */
export interface IModalContract extends IDisposable {
    /**
     * 打开并挂载一个模态框，自动管理 Z-Index 栈层级
     * @param element 模态框根 DOM 节点
     * @param options 模态框配置选项
     * @returns 可用于销毁关闭该模态框的 IDisposable 句柄
     */
    open(element: HTMLElement, options?: any): IDisposable;
    /**
     * 根据 ID 关闭指定模态框
     * @param modalId 目标模态框 ID
     */
    close(modalId: string): void;
    /**
     * 关闭栈顶当前最上层的模态框
     * @returns 是否成功关闭了一个模态框
     */
    closeTop(): boolean;
    /**
     * 获取当前处于打开状态的模态框数量
     * @returns 打开的模态框计数
     */
    getOpenCount(): number;
}
/**
 * 用户交互反馈服务接口 (Toast 提示与对话框)
 */
export interface IFeedbackContract {
    /**
     * 显示浮动 Toast 消息提示
     * @param message 提示文本
     * @param isError 是否为错误提示
     */
    showToast?(message: string, isError?: boolean): void;
    /**
     * 弹出确认对话框
     * @param options 对话框标题、消息内容与按钮配置
     * @returns 用户点击确认返回 true，点击取消或 Esc 返回 false
     */
    confirm?(options: any): Promise<boolean>;
    /**
     * 弹出文本输入对话框
     * @param options 对话框标题、提示语与默认值
     * @returns 用户输入的文本，取消则返回 null
     */
    prompt?(options: any): Promise<string | null>;
}
//# sourceMappingURL=index.d.ts.map