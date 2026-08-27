/**
 * @module ui/layout/floor-button-container
 * @description 楼层生图按钮扫描与交互控制器 (FloorButtonContainer)
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
    private readonly _contextMap;
    private _isDisposed;
    private _isChatLoading;
    private _scanDebounceTimer;
    private static readonly BUTTON_LABELS;
    constructor(options: FloorButtonContainerOptions);
    private hasActiveChat;
    private initHostEventListeners;
    private debounceScanAll;
    private clearAllContexts;
    private removeMessageContexts;
    private handleMessageDeleted;
    scanAllMessages(): void;
    scanAndInjectMessage(messageId: number): void;
    private handleMessageSwiped;
    private static buildPlaceholderRegex;
    private createButton;
    private createActionCallbacks;
    private bindButtonEvents;
    private setButtonState;
    private updateProgress;
    private restoreSavedImage;
    private persistImageToChat;
    private transcodeImage;
    private dataURLtoBlob;
    private blobToDataURL;
    dispose(): void;
}
//# sourceMappingURL=floor-button-container.d.ts.map