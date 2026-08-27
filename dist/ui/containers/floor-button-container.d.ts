/**
 * @module ui/containers/floor-button-container
 * @description 楼层生图按钮扫描器与控制器 (FloorButtonContainer)
 *
 * 核心职责：
 * 1. 扫描 AI 消息文本，识别占位符并注入交互式生图按钮
 * 2. 管理按钮状态机 (default / loading / progress / done / error)
 * 3. 历史图恢复：从 IndexedDB / chat.extra.da_images 恢复已生成的图像，支持存量 Base64 自动无感迁移
 * 4. 图文绑定持久化：图像生成后进行转码与 SHA-256 去重存入 IndexedDB，仅在宿主 extra 写入轻量 UUID 引用
 * 5. autoGenerate 自动生图触发、rAF 进度节流、Swipe 分支切换动态重扫
 */
import { IDisposable } from '../../core/foundation/disposable';
import { IHostBridge } from '../../core/foundation/host-bridge';
import { ITypedEventBus } from '../../core/foundation/event-bus';
import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { IStorageAdapter } from '../../core/state/storage-adapter';
import { ITaskManager } from '../../domain/task/task-manager';
import { PromptPipeline } from '../../domain/pipeline/prompt-pipeline';
export interface FloorButtonContainerOptions {
    hostBridge: IHostBridge;
    events: ITypedEventBus;
    store: ObservableStore<DrawAssistantSettings>;
    taskManager: ITaskManager;
    pipeline: PromptPipeline;
    storage: IStorageAdapter;
}
export declare class FloorButtonContainer implements IDisposable {
    private readonly _hostBridge;
    private readonly _events;
    private readonly _store;
    private readonly _taskManager;
    private readonly _pipeline;
    private readonly _storage;
    private readonly _logger;
    private readonly _disposables;
    private _isDisposed;
    private static readonly BUTTON_LABELS;
    constructor(options: FloorButtonContainerOptions);
    private initHostEventListeners;
    /**
     * 扫描指定楼层并注入生图按钮
     *
     * @param messageId 楼层在 chat 数组中的索引
     */
    scanAndInjectMessage(messageId: number): void;
    /**
     * 构建兼容 HTML 实体转义 (# / &#35; / &num;) 的占位符正则表达式
     */
    private static buildPlaceholderRegex;
    /**
     * 创建楼层生图按钮上下文并绑定完整生命周期
     */
    private createButton;
    /**
     * 创建图像操作菜单回调
     */
    private createActionCallbacks;
    /**
     * 绑定楼层按钮点击与状态机调度
     */
    private bindButtonEvents;
    /**
     * 切换按钮状态机并同步 UI 样式
     */
    private setButtonState;
    /**
     * rAF 节流更新生成进度显示
     */
    private updateProgress;
    /**
     * 尝试从 IndexedDB (及旧 extra 结构) 恢复历史生成的图像
     */
    private restoreSavedImage;
    /**
     * 持久化图像：转码、IndexedDB 存储与聊天记录 extra 引用回写
     */
    private persistImageToChat;
    /**
     * 图像格式与画质转码工具
     */
    private transcodeImage;
    private blobToDataURL;
    private dataURLtoBlob;
    dispose(): void;
}
//# sourceMappingURL=floor-button-container.d.ts.map