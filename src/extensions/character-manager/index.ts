/**
 * @module extensions/character-manager/index
 * @description 角色与服装管理独立业务扩展 (CharacterManagerExtension)
 */

import { IExtension } from '../../core/registry/extension-registry';
import { KernelContext } from '../../core/context';
import { IDisposable, DisposableStore } from '../../core/foundation/disposable';
import { CharacterStorage } from './storage';
import { createCharacterPromptHook } from './prompt-hook';
import { createCharacterTabView } from './character-tab';
import { CHARACTER_MANAGER_EXTENSION_ID } from './constants';
import { VERSION } from '../../core/constants';

export class CharacterManagerExtension implements IExtension {
    public readonly id = CHARACTER_MANAGER_EXTENSION_ID;
    public readonly name = '角色与服装预设管理';
    public readonly version = VERSION;

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
export * from './storage';
export * from './adapters';
export * from './prompt-hook';
export * from './character-tab';
export * from './macro-engine';
export * from './card-converter';
