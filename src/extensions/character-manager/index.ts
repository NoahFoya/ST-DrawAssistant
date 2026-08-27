/**
 * @module extensions/character-manager/index
 * @description 角色与服装管理独立业务扩展 (CharacterManagerExtension)
 */

import {
    IExtension,
    KernelContext,
    IDisposable,
    DisposableStore
} from '../../core';
import { CharacterStorage } from './data/storage';
import { createCharacterPromptHook } from './domain/prompt-hook';
import { createCharacterTabView } from './ui/character-tab';
import { CHARACTER_MANAGER_EXTENSION_ID } from './constants';

export class CharacterManagerExtension implements IExtension {
    public readonly id = CHARACTER_MANAGER_EXTENSION_ID;
    public readonly name = '角色与服装预设管理';
    public readonly version = '1.0.0';
    public readonly description = '开启后在设置面板中显示【角色管理】Tab，支持管理角色与服装特征预设。关闭后自动隐藏该 Tab。';

    private readonly _disposables = new DisposableStore();

    /**
     * 激活角色管理器扩展：挂载提示词 Hook 并动态注册 UI 视图
     * @param context 核心全局上下文实例
     */
    public activate(context: KernelContext): void {
        const storage = new CharacterStorage(context.host, context.presets);

        // 1. 注册提示词流水线前置处理 Hook (beforePromptBuild)
        if (context.hooks?.beforePromptBuild) {
            const promptHook = createCharacterPromptHook(storage, context.host);
            const unhook = context.hooks.beforePromptBuild.tap('character-manager-hook', promptHook, 10);
            this._disposables.add(unhook);
        }

        // 2. 动态根据 Store 状态注册/卸载 UI Tab 插槽
        let tabRegistration: IDisposable | null = null;

        const registerTab = () => {
            if (tabRegistration) return;
            tabRegistration = context.ui.registerTab({
                id: 'character-manager',
                title: '角色管理',
                icon: '',
                order: 20,
                render: (container: HTMLElement) => {
                    const view = createCharacterTabView(storage);
                    container.appendChild(view);
                }
            });
        };

        const unregisterTab = () => {
            if (tabRegistration) {
                tabRegistration.dispose();
                tabRegistration = null;
            }
        };

        const syncTabState = () => {
            const extState = context.store.getState().extensions?.[this.id];
            const isEnabled = extState?.enabled ?? true;
            if (isEnabled) {
                registerTab();
            } else {
                unregisterTab();
            }
        };

        syncTabState();

        this._disposables.add(
            context.store.subscribeKey('extensions', () => {
                syncTabState();
            })
        );

        this._disposables.add({
            dispose: () => {
                unregisterTab();
            }
        });

        context.logger.info('角色与服装管理扩展已成功激活挂载');
    }

    public deactivate(): void {
        this._disposables.dispose();
    }
}

export * from './types';
export * from './constants';
export * from './data/storage';
export * from './data/preset-loader';
export * from './ui/adapters';
export * from './domain/prompt-hook';
export * from './ui/character-tab';
export * from './domain/macro-engine';

