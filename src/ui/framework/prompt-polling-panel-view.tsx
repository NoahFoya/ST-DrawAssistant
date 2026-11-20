/**
 * 声明式 Preact 包装视图：提示词预设轮询摘要表单行 (PromptPollingPanelView) 与官方预设同步卡片 (OfficialPresetSyncCardView)。
 */

import { useEffect, useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import { PROMPT_POLLING_PRESET_ID } from '../../config/constants';
import { OfficialPresetSyncCard } from '../composite';
import type { OfficialPresetSyncCardOptions } from '../composite/official-preset-sync-card';
import { summarizePromptPollingPool } from '../composite/prompt-polling-manager';
import { openPromptPollingModal } from '../modal/prompt-polling-modal';
import type { ProviderTabViewModel } from '../viewmodels/provider-tab-vm';
import { BadgeView, ButtonControl, FormFieldView } from './controls';

export interface PromptPollingPanelViewProps {
    readonly vm: ProviderTabViewModel;
}

/**
 * 共享提示词预设轮询入口行：仅当绑定提示词预设选为「使用轮询」(`__polling__`) 时显示，点击「管理轮询池」弹出独立管理模态框。
 */
export function PromptPollingPanelView(props: PromptPollingPanelViewProps): VNode | null {
    const { vm } = props;
    const draft = vm.presetController.draftConfig.value;
    const dirtyFields = vm.presetController.dirtyFields.value;
    const availablePresets = vm.promptPresets.value;
    const isPolling = draft.promptPresetId === PROMPT_POLLING_PRESET_ID;

    const vmRef = useRef(vm);
    vmRef.current = vm;

    if (!isPolling) {
        return null;
    }

    const summary = summarizePromptPollingPool(draft.promptPollingPool, availablePresets);

    const handleOpenModal = () => {
        openPromptPollingModal({
            availablePresets: vmRef.current.promptPresets.value,
            initialItems: vmRef.current.presetController.draftConfig.value.promptPollingPool || [],
            onSave: (nextPool) => {
                vmRef.current.updatePromptPollingPool(nextPool);
            },
        });
    };

    return (
        <FormFieldView
            label="轮询候选池"
            tooltip="管理参与随机抽取的提示词预设列表；列表为空时自动从当前服务的全部可用预设中抽取"
            dirty={dirtyFields.has('promptPollingPool')}
            invalid={summary.isInvalid}
            className="da-polling-entry-row"
        >
            <div className="da-polling-entry-control">
                <BadgeView
                    text={summary.entryLabel}
                    variant={summary.badgeVariant}
                    dot={true}
                />
                <ButtonControl
                    label="管理轮询池"
                    variant="secondary"
                    size="sm"
                    onClick={handleOpenModal}
                />
            </div>
        </FormFieldView>
    );
}

export interface OfficialPresetSyncCardViewProps {
    readonly options?: OfficialPresetSyncCardOptions;
}

/**
 * 官方预设更新摘要卡片的 Preact 包装视图。
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
