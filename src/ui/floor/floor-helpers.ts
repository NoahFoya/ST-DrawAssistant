/**
 * 楼层装饰纯辅助函数集合 (FloorHelpers)。
 *
 * @remarks
 * 从 MessageDecorator 中抽离无实例状态依赖的纯计算、资产预校验与 DOM 指令节点替换逻辑，
 * 以便独立进行单元测试并保持主控制器聚焦于事件调度与交互生命周期。
 */

import type {
    DrawingPresetData,
    PromptPresetData,
    ProviderStoredConfig,
    ProviderType,
} from '@types';
import type { promptPipeline } from '../../pipeline/prompt-pipeline';
import { settingsStore } from '../../store/settings-store';
import { validatePresetAssets } from '../../util/asset-matcher';

type ExtractedFloorCommand = ReturnType<typeof promptPipeline.extractCommands>[number];

/** 构造楼层按钮与容器的唯一映射键 */
export function buildFloorSlotKey(
    chatId: string,
    messageId: number,
    swipeId: number,
    instructionIndex: number
): string {
    return `${chatId}:${messageId}:${swipeId}:${instructionIndex}`;
}

/**
 * 校验当前激活预设中的资产（主模型、VAE、CLIP、LoRA）是否存在于资产缓存中。
 *
 * @param providerType 生图后端服务提供方标识
 * @returns 校验结果：valid 为是否齐备，missing 记录缺失的模型文件名列表
 */
export function validateCurrentPresetAssets(
    providerType: ProviderType
): { valid: boolean; missing: string[] } {
    const pCfg = settingsStore.getProviderConfig<ProviderStoredConfig>(providerType);
    const activeDrawingId = pCfg?.activeDrawingPresetId;
    const cache = pCfg?.assetCache;

    if (!activeDrawingId) {
        return { valid: true, missing: [] };
    }

    const dp = settingsStore.getPreset<DrawingPresetData>('drawing', activeDrawingId, providerType);
    const promptPresetId = dp?.data?.promptPresetId;
    const pp = promptPresetId
        ? settingsStore.getPreset<PromptPresetData>('prompts', promptPresetId, providerType)
        : undefined;

    return validatePresetAssets({
        drawingPreset: dp?.data,
        promptPreset: pp?.data,
        assetCache: cache,
        providerType,
    });
}

/**
 * 将消息文本节点中的生图指令标记替换为 `.da-floor-slot` 挂载容器节点。
 *
 * @param container 消息文本宿主 DOM 容器 (.mes_text)
 * @param commands 已提取的生图指令列表
 * @returns instructionIndex 到容器 DOM 节点的映射
 */
export function replaceCommandsWithFloorSlots(
    container: HTMLElement,
    commands: ExtractedFloorCommand[]
): Map<number, HTMLElement> {
    const slotsMap = new Map<number, HTMLElement>();
    if (!container || commands.length === 0) {
        return slotsMap;
    }

    // 先检查是否已有现成容器
    for (const cmd of commands) {
        const existing = container.querySelector(
            `.da-floor-slot[data-instruction-index="${cmd.instructionIndex}"]`
        ) as HTMLElement | null;
        if (existing) {
            slotsMap.set(cmd.instructionIndex, existing);
        }
    }

    // 若全部容器已就绪，直接返回
    if (slotsMap.size === commands.length) {
        return slotsMap;
    }

    for (const cmd of commands) {
        if (slotsMap.has(cmd.instructionIndex)) {
            continue;
        }

        // 每次动态重新遍历纯文本节点，避免多指令切分导致脱落节点的 DOMException
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        let targetTextNode: Text | null = null;
        let matchIndex = -1;
        let matchLength = cmd.rawMatch.length;

        while (true) {
            const node = walker.nextNode() as Text | null;
            if (!node) {
                break;
            }
            const content = node.nodeValue || '';
            const idx = content.indexOf(cmd.rawMatch);
            if (idx !== -1) {
                targetTextNode = node;
                matchIndex = idx;
                matchLength = cmd.rawMatch.length;
                break;
            }
        }

        // 若完整 rawMatch 遇到换行或空格在 Markdown 渲染中被规范化，使用宽松空白正则直接在原始节点文本中定位真实偏移与长度
        if (!targetTextNode) {
            const tokens = cmd.rawMatch.trim().split(/\s+/).filter(Boolean);
            if (tokens.length > 0) {
                const looseRegex = new RegExp(
                    tokens.map((t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
                );
                const looseWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
                while (true) {
                    const node = looseWalker.nextNode() as Text | null;
                    if (!node) break;
                    const content = node.nodeValue || '';
                    const m = looseRegex.exec(content);
                    if (m && m.index !== undefined) {
                        targetTextNode = node;
                        matchIndex = m.index;
                        matchLength = m[0].length;
                        break;
                    }
                }
            }
        }

        if (!targetTextNode || !targetTextNode.parentNode || matchIndex === -1) {
            continue;
        }

        const parentNode = targetTextNode.parentNode;
        const textContent = targetTextNode.nodeValue || '';
        const beforeText = textContent.substring(0, matchIndex);
        const afterText = textContent.substring(matchIndex + matchLength);

        const slotElement = document.createElement('div');
        slotElement.className = 'da-floor-slot';
        slotElement.setAttribute('data-instruction-index', String(cmd.instructionIndex));

        const fragment = document.createDocumentFragment();
        if (beforeText) {
            fragment.appendChild(document.createTextNode(beforeText));
        }
        fragment.appendChild(slotElement);
        if (afterText) {
            fragment.appendChild(document.createTextNode(afterText));
        }

        parentNode.replaceChild(fragment, targetTextNode);
        slotsMap.set(cmd.instructionIndex, slotElement);
    }

    return slotsMap;
}
