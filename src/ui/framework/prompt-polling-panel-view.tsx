/**
 * 声明式 Preact 包装视图：提示词预设轮询面板 (PromptPollingPanelView) 与官方预设同步卡片 (OfficialPresetSyncCardView)。
 */

import { useEffect, useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import { PROMPT_POLLING_PRESET_ID } from '../../config/constants';
import { PromptPollingManager, OfficialPresetSyncCard } from '../composite';
import type { OfficialPresetSyncCardOptions } from '../composite/official-preset-sync-card';
import type { ProviderTabViewModel } from '../viewmodels/provider-tab-vm';

export interface PromptPollingPanelViewProps {
    readonly vm: ProviderTabViewModel;
}

/**
 * 共享提示词预设轮询管理面板：仅当绑定提示词预设选为「使用轮询」(`__polling__`) 时展开显示。
 */
export function PromptPollingPanelView(props: PromptPollingPanelViewProps): VNode | null {
    const { vm } = props;
    const draft = vm.presetController.draftConfig.value;
    const availablePresets = vm.promptPresets.value;
    const isPolling = draft.promptPresetId === PROMPT_POLLING_PRESET_ID;
    const pool = draft.promptPollingPool;

    const hostRef = useRef<HTMLDivElement | null>(null);
    const managerRef = useRef<PromptPollingManager | null>(null);
    const vmRef = useRef(vm);
    vmRef.current = vm;

    useEffect(() => {
        const container = hostRef.current;
        if (!isPolling || !container) {
            if (managerRef.current) {
                managerRef.current.dispose();
                managerRef.current = null;
            }
            return;
        }

        if (!managerRef.current) {
            const mgr = new PromptPollingManager({
                availablePresets,
                initialItems: pool,
                onChange: (nextPool) => {
                    vmRef.current.updatePromptPollingPool(nextPool);
                },
            });
            managerRef.current = mgr;
            container.appendChild(mgr.element);
        } else {
            managerRef.current.sync(availablePresets, pool);
        }
    }, [isPolling, availablePresets, pool]);

    useEffect(() => {
        return () => {
            if (managerRef.current) {
                managerRef.current.dispose();
                managerRef.current = null;
            }
        };
    }, []);

    if (!isPolling) {
        return null;
    }

    return <div ref={hostRef} className="da-polling-panel-host" />;
}

export interface OfficialPresetSyncCardViewProps {
    readonly options?: OfficialPresetSyncCardOptions;
}

/**
 * 官方预设快速同步卡片的 Preact 包装视图。
 */
export function OfficialPresetSyncCardView(props: OfficialPresetSyncCardViewProps): VNode {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const cardRef = useRef<OfficialPresetSyncCard | null>(null);

    useEffect(() => {
        const container = hostRef.current;
        if (!container) return;

        const card = new OfficialPresetSyncCard(props.options);
        cardRef.current = card;
        container.appendChild(card.element);

        return () => {
            card.dispose();
            cardRef.current = null;
        };
    }, []);

    return <div ref={hostRef} className="da-sync-card-host" />;
}
