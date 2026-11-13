/**
 * 素材库 - 服装管理子面板。
 */

import type { VNode } from 'preact';
import type { Signal } from '@preact/signals';
import type { OutfitPresetData, OutfitPartKey } from '@types';
import { CardView, PresetToolbarView } from '../../framework';
import type { PresetActionType } from '../../composite';
import type { PresetController } from '../../viewmodels';
import {
    OUTFIT_PART_DEFS,
    normalizeOutfitData,
    computeOutfitTokenStats,
    type MaterialPartDef,
} from '../../../pipeline/material-definitions';
import {
    OUTFIT_PART_GROUPS,
    renderAvatarBox,
    renderFullWidthTagField,
} from './material-types';

export interface OutfitPanelProps {
    outfitController: PresetController<OutfitPresetData>;
    avatarUrlsSignal: Signal<Record<string, string>>;
    outfitGroupExpanded: Signal<Record<string, boolean>>;
    onAction: (action: PresetActionType, id?: string) => Promise<void>;
    onImportFile: (file: File) => void;
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
        onImportFile,
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
                <PresetToolbarView
                    presets={outfitController.toolbarItems.value}
                    activePresetId={activeId}
                    dirty={isDirty}
                    onAction={(action, id) => void onAction(action, id)}
                    onImportFile={onImportFile}
                />
            </div>

            {/* 1. 基本属性卡片 */}
            <CardView title="基本属性" dirty={isDirty}>
                <div className="da-material-identity-layout">
                    {/* 第一行：居中紧凑参考图 (3:4 比例，缩小尺寸居顶居中) */}
                    <div className="da-material-avatar-center-wrap">
                        {renderAvatarBox({
                            kind: 'outfit',
                            avatarId: draft.avatarId,
                            displayTitle: draft.name,
                            avatarUrl: draft.avatarId ? avatarUrlsSignal.value[draft.avatarId] || '' : '',
                            onUploadAvatar,
                            onRemoveAvatar,
                            onEnsureAvatarLoaded,
                        })}
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
                            placeholder="填写服装设计风格、面料剪裁与整体外观，将注入模型上下文供 AI 理解服饰细节..."
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

            {/* 2. 绘画标签卡片 (服饰穿搭各部位细分全宽文本域) */}
            <CardView
                title="绘画标签"
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
                                data-tooltip="官方服饰收录规范：若为具有专属名称的成套服装或制服，填写 Danbooru 标准服饰标签（例如 school_uniform, serafuku）；若为通用散件搭配或自设日常服装，无需填写专属标识，此处留空即可，模型将依据下方各部位衣着标签进行生成。"
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

                    {OUTFIT_PART_GROUPS.map((grp) => {
                        const isExpanded = Boolean(outfitGroupExpanded.value[grp.id]);
                        const groupDefs = grp.keys
                            .map((k) => OUTFIT_PART_DEFS.find((d) => d.key === k))
                            .filter((d): d is MaterialPartDef<OutfitPartKey> => Boolean(d));
                        const filledCount = groupDefs.filter((d) =>
                            Boolean((draft.parts[d.key] || '').trim())
                        ).length;

                        return (
                            <div key={grp.id} className="da-shot-group-accordion">
                                <button
                                    type="button"
                                    className="da-shot-group-accordion__header"
                                    onClick={() => {
                                        outfitGroupExpanded.value = {
                                            ...outfitGroupExpanded.value,
                                            [grp.id]: !isExpanded,
                                        };
                                    }}
                                >
                                    <div className="da-shot-group-accordion__title">
                                        <span>{isExpanded ? '▾' : '▸'}</span>
                                        <span>{grp.label}</span>
                                    </div>
                                    <span className="da-shot-group-accordion__badge">
                                        已填 {filledCount}/{groupDefs.length} 项
                                    </span>
                                </button>

                                {isExpanded && (
                                    <div className="da-shot-group-accordion__body">
                                        {groupDefs.map((def) =>
                                            renderFullWidthTagField({
                                                fieldKey: def.key,
                                                label: def.label,
                                                hint: def.hint,
                                                value: draft.parts[def.key],
                                                placeholder: def.placeholder,
                                                rows: 2,
                                                dirty: dirtySet.has(`parts.${def.key}`) || dirtySet.has(def.key),
                                                onChange: (val) => updatePart(def.key, val),
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardView>
        </div>
    );
}
