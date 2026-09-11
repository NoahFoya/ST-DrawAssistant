/**
 * 生图任务状态与调度事件接口定义
 * @author NoahFoya
 */

import { DrawAssistantSettings, StoredImageRecord } from './settings';
import { GenerationRequest, GenerationResult } from './driver';

/** 任务生命周期状态 */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

/** 任务上下文标识 */
export interface TaskContextIdentity {
    readonly taskId: string;
    readonly chatId?: string;
    readonly messageId?: number;
    readonly swipeId?: number;
}

/** 任务状态快照 */
export interface TaskSnapshot {
    readonly id: string;
    readonly targetEngine: string;
    readonly status: TaskStatus;
    readonly request: GenerationRequest;
    readonly progress: number;
    readonly previewUrl?: string;
    readonly result?: GenerationResult;
    readonly error?: string;
    readonly createdAt: number;
    readonly startedAt?: number;
    readonly finishedAt?: number;
}

/** 任务提交选项 */
export interface SubmitTaskOptions {
    request: GenerationRequest;
    chatId?: string;
    messageId?: number;
    swipeId?: number;
}

/**
 * 插件运行时事件定义
 */
export interface CoreEventMap {
    'settings:changed': { settings: DrawAssistantSettings; changedKey?: string };
    'settings:save_failed': { error: string };
    'presets:reset': void;
    'presets:imported': { importedCount: number };
    'chat:changed': { chatId: string };
    'host:ready': void;
    'asset:saved': { assetId: string; record: StoredImageRecord };
    'asset:deleted': { assetId: string };
    // 任务状态事件
    'task:queued': { taskId: string; request: GenerationRequest };
    'task:started': { taskId: string; request: GenerationRequest };
    'task:progress': { taskId: string; progress: number; previewUrl?: string };
    'task:completed': { taskId: string; result: GenerationResult };
    'task:cancelled': { taskId: string; reason?: string };
    'task:failed': { taskId: string; error: string };
    'task:state_changed': { taskId: string; status: TaskStatus; error?: string };
}

export type TaskEventMap = CoreEventMap;
