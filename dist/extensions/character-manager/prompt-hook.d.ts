/**
 * @module extensions/character-manager/prompt-hook
 * @description 角色与服装提示词构建钩子 (beforePromptBuild 单向宏替换与公式求值)
 */
import { CharacterStorage } from './storage';
import { PipelineHookContext } from '../../domain/pipeline/pipeline-hooks';
import { IHostBridge } from '../../core/foundation/host-bridge';
/**
 * 创建角色与服装宏展开流水线钩子处理函数
 *
 * @param storage 角色与服装存储管理器实例
 * @param _host 宿主环境桥接实例 (可选)
 * @returns 符合 IPipelineHooks 规范的异步提示词转换函数
 */
export declare function createCharacterPromptHook(storage: CharacterStorage, _host?: IHostBridge): (prompt: string, _context?: PipelineHookContext) => Promise<string>;
//# sourceMappingURL=prompt-hook.d.ts.map