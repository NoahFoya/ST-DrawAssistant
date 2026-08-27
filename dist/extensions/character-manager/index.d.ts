/**
 * @module extensions/character-manager/index
 * @description 角色与服装管理独立业务扩展 (CharacterManagerExtension)
 */
import { IExtension } from '../../core/registry/extension-registry';
import { KernelContext } from '../../core/context';
export declare class CharacterManagerExtension implements IExtension {
    readonly id = "character-manager";
    readonly name = "\u89D2\u8272\u4E0E\u670D\u88C5\u9884\u8BBE\u7BA1\u7406";
    readonly version = "0.3.5";
    private readonly _disposables;
    /**
     * 激活角色管理器扩展：挂载提示词 Hook 并动态注册 UI 视图
     * @param context 核心全局上下文实例
     */
    activate(context: KernelContext): void;
    deactivate(): void;
}
export * from './types';
export * from './storage';
export * from './adapters';
export * from './prompt-hook';
export * from './character-tab';
export * from './macro-engine';
export * from './card-converter';
//# sourceMappingURL=index.d.ts.map