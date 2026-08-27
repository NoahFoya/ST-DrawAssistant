/**
 * @module extensions/character-manager/prompt-hook
 * @description 提示词前置拦截钩子实现 (beforePromptBuild 标签注入、精准方案匹配、宏展开与正则公式求值)
 */
import { CharacterStorage } from './storage';
import { PipelineHookContext } from '../../domain/pipeline/pipeline-hooks';
import { IHostBridge } from '../../core/foundation/host-bridge';
export declare function createCharacterPromptHook(storage: CharacterStorage, host: IHostBridge): (prompt: string, context: PipelineHookContext) => Promise<string>;
//# sourceMappingURL=prompt-hook.d.ts.map