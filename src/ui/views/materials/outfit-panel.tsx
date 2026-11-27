/**
 * 素材管理 - 服装管理子面板。
 */

import type { VNode } from 'preact';
import type { Signal } from '@preact/signals';
import type { OutfitPresetData, OutfitPartKey } from '@types';
import { CardView } from '../../framework';
import { PresetToolbar, type PresetActionType } from '../../composite';
import type { PresetController } from '../../state';
import {
    OUTFIT_PART_DEFS,
    normalizeOutfitData,
    computeOutfitTokenStats,
} from '../../../pipeline/material-definitions';
import {
    OUTFIT_PART_GROUPS,
    AvatarBox,
    MaterialPartGroups,
} from './material-types';

export interface OutfitPanelProps {
    outfitController: PresetController<OutfitPresetData>;
    avatarUrlsSignal: Signal<Record<string, string>>;
    outfitGroupExpanded: Signal<Record<string, boolean>>;
    onAction: (action: PresetActionType, id?: string) => Promise<boolean>;
    onImportFiles?: (files: File[]) => void;
    onUploadAvatar: (file: File) => Promise<string>;
    onRemoveAvatar: () => void;
    onEnsureAvatarLoaded: (avatarId: string) => void;
}

export function OutfitPanel(props: OutfitPanelProps): VNode {
    const {
        outfitController,
        avatarUrlsSignal,
        outfitGroupExpanded,
        onAction,
        onImportFiles,
        onUploadAvatar,
        onRemoveAvatar,
        onEnsureAvatarLoaded,
    } = props;

    const activeId = outfitController.activePresetId.value;
    const rawDraft = outfitController.draftConfig.value;
    const draft = normalizeOutfitData(rawDraft);
    const isDirty = outfitController.isDirty.value;
    const dirtySet = outfitController.dirtyFields.value;

    const updatePart = (partKey: OutfitPartKey, val: string) => {
        outfitController.updateDraft('parts', {
            ...draft.parts,
            [partKey]: val,
        });
    };

    const tokenStats = computeOutfitTokenStats(draft);

    return (
        <div className="da-material-subpanel">
            <div className="da-material-preset-bar">
                <PresetToolbar
                    presets={outfitController.toolbarItems.value}
                    activePresetId={activeId}
                    dirty={isDirty}
                    onAction={(action, id) => onAction(action, id)}
                    onImportFiles={onImportFiles}
                />
            </div>

            {/* 1. 基本属性卡片 */}
            <CardView title="基本属性" dirty={isDirty}>
                <div className="da-material-identity-layout">
                    {/* 第一行：居中紧凑参考图 (3:4 比例，缩小尺寸居顶居中) */}
                    <div className="da-material-avatar-center-wrap">
                        <AvatarBox
                            kind="outfit"
                            avatarId={draft.avatarId}
                            displayTitle={draft.name}
                            avatarUrl={draft.avatarId ? avatarUrlsSignal.value[draft.avatarId] || '' : ''}
                            onUploadAvatar={onUploadAvatar}
                            onRemoveAvatar={onRemoveAvatar}
                            onEnsureAvatarLoaded={onEnsureAvatarLoaded}
                        />
                    </div>

                    {/* 第二行：名称与别名并排 */}
                    <div className="da-material-identity-row-2">
                        <div className="da-material-single-field">
                            <label className="da-material-compact-label">
                                名称 <span className="da-required-mark">*</span>
                            </label>
                            <input
                                type="text"
                                className="da-input da-material-title-input da-outfit-name-input"
                                value={draft.name}
                                placeholder="主调用名与显示名，如: 学院制服"
                                onInput={(e) =>
                                    outfitController.updateDraft(
                                        'name',
                                        (e.currentTarget as HTMLInputElement).value
                                    )
                                }
                            />
                        </div>

                        <div className="da-material-single-field">
                            <label className="da-material-compact-label">
                                别名 (以 | 分隔)
                            </label>
                            <input
                                type="text"
                                className="da-input da-material-title-input da-outfit-aliases-input"
                                value={draft.aliases}
                                placeholder="以 | 分隔，例如: school_uniform|制服"
                                onInput={(e) =>
                                    outfitController.updateDraft(
                                        'aliases',
                                        (e.currentTarget as HTMLInputElement).value
                                    )
                                }
                            />
                        </div>
                    </div>

                    {/* 第三行：服装描述全宽 */}
                    <div className="da-material-single-field">
                        <label className="da-material-compact-label">服装描述</label>
                        <textarea
                            className="da-material-description-textarea da-outfit-description-textarea"
                            value={draft.description}
                            placeholder="填写服装风格、面料剪裁与整体款式说明，会随素材通道发给 AI 参考..."
                            onInput={(e) =>
                                outfitController.updateDraft(
                                    'description',
                                    (e.currentTarget as HTMLTextAreaElement).value
                                )
                            }
                        />
                    </div>
                </div>
            </CardView>

            {/* 2. 绘画标签卡片 (按主要服装与内衣、鞋袜与配饰自然分组) */}
            <CardView
                title="绘画标签"
                tooltip="各部位支持 通用tags|[intact]tags|[disheveled]tags 状态分层格式：\n- 最左侧无前缀为全状态共用的通用 Tags；\n- [intact] 为穿戴完整状态，[disheveled] 为凌乱、敞开或半褪状态，调用 $名称-宏-状态$ 时按需展开。"
                actions={
                    <div className="da-card-header-stats">
                        <span className="da-token-stat-pill">
                            触发词: ~{tokenStats.trigger}
                        </span>
                        <span className="da-token-stat-pill">
                            总体: ~{tokenStats.total}
                        </span>
                    </div>
                }
            >
                <div className="da-material-tags-stack">
                    {/* 服装专属触发词置顶全宽 */}
                    <div className="da-material-single-field">
                        <div className="da-material-compact-label-row">
                            <label className="da-material-compact-label">服装触发词 (Trigger Tags)</label>
                            <span
                                className="da-help-icon"
                                data-tooltip="若有成套制服或专属服装标签（如 school_uniform, serafuku）可填在此处；常见日常散搭没有专属触发词时留空即可，生图会以下方各部位描写为准。"
                                role="button"
                                tabIndex={0}
                                aria-label="查看服装触发词填写规范"
                            >
                                ?
                            </span>
                        </div>
                        <input
                            type="text"
                            className="da-input da-material-title-input da-outfit-trigger-input da-material-tag-input"
                            value={draft.trigger}
                            placeholder="例如: school_uniform, serafuku（通用或自设服饰无需专属标识，留空即可）"
                            onInput={(e) =>
                                outfitController.updateDraft(
                                    'trigger',
                                    (e.currentTarget as HTMLInputElement).value
                                )
                            }
                        />
                    </div>

                    <MaterialPartGroups
                        groups={OUTFIT_PART_GROUPS}
                        defs={OUTFIT_PART_DEFS}
                        parts={draft.parts}
                        expandedSignal={outfitGroupExpanded}
                        dirtySet={dirtySet}
                        onChangePart={updatePart}
                    />
                </div>
            </CardView>
        </div>
    );
}
