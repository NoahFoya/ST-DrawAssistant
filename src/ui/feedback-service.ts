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

import { showToastNotice } from '../utils/toast';
import { showConfirmDialog, showPromptDialog, showTripleChoiceDialog, type TripleChoiceResult } from './components/modals';
import { UI_MESSAGES } from '../core/messages';

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

class UnsavedStateManagerImpl {
    private providers: Map<string, UnsavedProvider> = new Map();
    private stateChangeListeners: Array<() => void> = [];

    public registerProvider(provider: UnsavedProvider): void {
        this.providers.set(provider.tabId, provider);
        this.notifyStateChange();
    }

    public unregisterProvider(tabId: string): void {
        this.providers.delete(tabId);
        this.notifyStateChange();
    }

    public subscribeStateChange(listener: () => void): () => void {
        this.stateChangeListeners.push(listener);
        return () => {
            this.stateChangeListeners = this.stateChangeListeners.filter(l => l !== listener);
        };
    }

    public notifyStateChange(): void {
        this.stateChangeListeners.forEach(listener => {
            try {
                listener();
            } catch {
                // 忽略监听器回调错误
            }
        });
    }

    public getDirtyProviders(): UnsavedProvider[] {
        const dirty: UnsavedProvider[] = [];
        this.providers.forEach((provider) => {
            try {
                if (provider.hasUnsavedChanges()) {
                    dirty.push(provider);
                }
            } catch (e) {
                // 忽略被销毁节点的解绑异常
            }
        });
        return dirty;
    }

    public async checkUnsavedBeforeAction(actionDesc: string = '切出界面'): Promise<'proceed' | 'cancel'> {
        const dirtyList = this.getDirtyProviders();
        if (dirtyList.length === 0) {
            return 'proceed';
        }

        const names = dirtyList.map((p) => `【${p.tabName}】`).join('与');
        const message = `检测到 ${names} 存在未保存的修改！直接${actionDesc}将丢弃所有未保存改动，请选择操作：`;

        const choice: TripleChoiceResult = await showTripleChoiceDialog({
            title: '⚠️ 未保存修改提示',
            message,
            saveText: '保存修改',
            discardText: '放弃修改',
            cancelText: '取消',
        });

        if (choice === 'cancel') {
            return 'cancel';
        }

        if (choice === 'save') {
            for (const provider of dirtyList) {
                await provider.saveChanges();
            }
            return 'proceed';
        }

        if (choice === 'discard') {
            for (const provider of dirtyList) {
                provider.discardChanges();
            }
            return 'proceed';
        }

        return 'cancel';
    }
}

export const unsavedStateManager = new UnsavedStateManagerImpl();

export class FeedbackService {
    // ── 1. 浮动 Toast 气泡通知 ──

    /** 弹出标准成功/提示 Toast 气泡 */
    public static toastSuccess(message: string, title: string = 'Starlight DrawAssistant'): void {
        showToastNotice(message, title, true);
    }

    /** 弹出标准错误 Toast 气泡 */
    public static toastError(message: string, title: string = 'Starlight DrawAssistant'): void {
        showToastNotice(message, title, false);
    }

    /** 弹出警告 Toast 气泡 */
    public static toastWarning(message: string, title: string = 'Starlight DrawAssistant'): void {
        showToastNotice(`⚠️ ${message}`, title, false);
    }

    /** 弹出信息 Toast 气泡 */
    public static toastInfo(message: string, title: string = 'Starlight DrawAssistant'): void {
        showToastNotice(message, title, true);
    }

    /** 根据预设方案类别快捷弹出【保存成功】Toast */
    public static notifySaved(category: string): void {
        switch (category) {
            case 'theme':
                showToastNotice(UI_MESSAGES.THEME_SAVED.message, UI_MESSAGES.THEME_SAVED.title, true);
                break;
            case 'model':
                showToastNotice(UI_MESSAGES.MODEL_PROFILE_SAVED.message, UI_MESSAGES.MODEL_PROFILE_SAVED.title, true);
                break;
            case 'prompt':
                showToastNotice(UI_MESSAGES.PROMPT_PROFILE_SAVED.message, UI_MESSAGES.PROMPT_PROFILE_SAVED.title, true);
                break;
            case 'workflow':
                showToastNotice(UI_MESSAGES.WORKFLOW_PROFILE_SAVED.message, UI_MESSAGES.WORKFLOW_PROFILE_SAVED.title, true);
                break;
            case 'inpaint':
                showToastNotice(UI_MESSAGES.INPAINT_WORKFLOW_SAVED.message, UI_MESSAGES.INPAINT_WORKFLOW_SAVED.title, true);
                break;
            case 'character':
                showToastNotice('角色预设已保存！', '保存成功', true);
                break;
            case 'outfit':
                showToastNotice('服装预设已保存！', '保存成功', true);
                break;
            case 'enable-scheme':
                showToastNotice('设定启用方案已保存！', '保存成功', true);
                break;
            case 'general':
            default:
                showToastNotice(UI_MESSAGES.GENERAL_SAVED.message, UI_MESSAGES.GENERAL_SAVED.title, true);
                break;
        }
    }

    // ── 2. 语义化对话框 (Modal Confirm & Prompt) ──

    /**
     * 语义化删除确认对话框 (自动对接 UI_MESSAGES 字典)
     */
    public static async confirmDelete(
        target: string,
        extraParam?: any
    ): Promise<boolean> {
        let title = '删除确认';
        let message = '确定要删除该选中项吗？此操作不可撤销。';

        const cDict = UI_MESSAGES.CONFIRM_DELETE;
        if (target === 'theme') {
            title = cDict.THEME.title;
            message = cDict.THEME.message;
        } else if (target === 'model') {
            title = cDict.MODEL.title;
            message = cDict.MODEL.message;
        } else if (target === 'prompt') {
            title = cDict.PROMPT.title;
            message = cDict.PROMPT.message;
        } else if (target === 'workflow') {
            title = cDict.WORKFLOW.title;
            message = cDict.WORKFLOW.message;
        } else if (target === 'inpaint') {
            title = cDict.INPAINT.title;
            message = cDict.INPAINT.message;
        } else if (target === 'isolated') {
            title = cDict.ISOLATED_IMAGES.title;
            message = cDict.ISOLATED_IMAGES.message;
        } else if (target === 'stats') {
            title = cDict.RESET_STATS.title;
            message = cDict.RESET_STATS.message;
        } else if (target === 'image' && typeof extraParam === 'string') {
            const cfg = UI_MESSAGES.CONFIRM_DELETE.DELETE_IMAGE(extraParam);
            title = cfg.title;
            message = cfg.message;
        } else if (target === 'gallery_batch') {
            const cfg = UI_MESSAGES.CONFIRM_DELETE.GALLERY_BATCH(extraParam);
            title = cfg.title;
            message = cfg.message;
        }

        return showConfirmDialog({
            title,
            message,
            confirmText: '确定删除',
            cancelText: '取消',
            isDangerous: true,
        });
    }

    /**
     * 语义化预设名称输入对话框 (自动对接 UI_MESSAGES 字典)
     */
    public static async promptName(
        action: 'new' | 'rename',
        target: string,
        defaultValue?: string
    ): Promise<string | null> {
        let title = action === 'new' ? '新建预设' : '重命名预设';
        let message = '请输入名称：';
        let defaultVal = defaultValue ?? '';
        let placeholder = '预设名称';

        const pDict = UI_MESSAGES.PROMPT;
        if (target === 'theme') {
            const cfg = action === 'new' ? pDict.NEW_THEME : pDict.RENAME_THEME;
            title = cfg.title;
            message = cfg.message;
            if (action === 'new') {
                defaultVal = pDict.NEW_THEME.defaultValue;
                placeholder = pDict.NEW_THEME.placeholder;
            }
        } else if (target === 'model') {
            const cfg = action === 'new' ? pDict.NEW_MODEL : pDict.RENAME_MODEL;
            title = cfg.title;
            message = cfg.message;
            if (action === 'new') {
                defaultVal = pDict.NEW_MODEL.defaultValue;
                placeholder = pDict.NEW_MODEL.placeholder;
            }
        } else if (target === 'prompt') {
            const cfg = action === 'new' ? pDict.NEW_PROMPT : pDict.RENAME_PROMPT;
            title = cfg.title;
            message = cfg.message;
            if (action === 'new') {
                defaultVal = pDict.NEW_PROMPT.defaultValue;
                placeholder = pDict.NEW_PROMPT.placeholder;
            }
        } else if (target === 'workflow') {
            const cfg = action === 'new' ? pDict.NEW_WORKFLOW : pDict.RENAME_WORKFLOW;
            title = cfg.title;
            message = cfg.message;
            if (action === 'new') {
                defaultVal = pDict.NEW_WORKFLOW.defaultValue;
                placeholder = pDict.NEW_WORKFLOW.placeholder;
            }
        } else if (target === 'inpaint') {
            const cfg = action === 'new' ? pDict.NEW_INPAINT : pDict.RENAME_INPAINT;
            title = cfg.title;
            message = cfg.message;
            if (action === 'new') {
                defaultVal = pDict.NEW_INPAINT.defaultValue;
                placeholder = pDict.NEW_INPAINT.placeholder;
            }
        }

        return showPromptDialog({
            title,
            message,
            defaultValue: defaultValue ?? defaultVal,
            placeholder,
        });
    }

    /** 自定义通用确认框 */
    public static async confirm(
        title: string,
        message: string,
        confirmText: string = '确定',
        isDangerous: boolean = false
    ): Promise<boolean> {
        return showConfirmDialog({
            title,
            message,
            confirmText,
            cancelText: '取消',
            isDangerous,
        });
    }

    /** 自定义通用 Prompt 输入框 */
    public static async prompt(
        title: string,
        message: string,
        defaultValue: string = '',
        placeholder: string = ''
    ): Promise<string | null> {
        return showPromptDialog({
            title,
            message,
            defaultValue,
            placeholder,
        });
    }

    // ── 3. 未保存防呆检查与注册 ──

    /** 注册指定 Tab 的未保存检查器 */
    public static registerUnsavedProvider(provider: UnsavedProvider): void {
        unsavedStateManager.registerProvider(provider);
    }

    /** 注销指定 Tab 的未保存检查器 */
    public static unregisterUnsavedProvider(tabId: string): void {
        unsavedStateManager.unregisterProvider(tabId);
    }

    /** 执行全局防呆检查 (切 Tab 或关面板) */
    public static async checkUnsavedBefore(actionDesc: string = '切出界面'): Promise<'proceed' | 'cancel'> {
        return unsavedStateManager.checkUnsavedBeforeAction(actionDesc);
    }
}
