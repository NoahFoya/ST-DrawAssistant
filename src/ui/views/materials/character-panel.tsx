/**
 * 素材库 - 角色管理子面板。
 */

import type { VNode } from 'preact';
import type { Signal } from '@preact/signals';
import type {
    CharacterPresetData,
    OutfitPresetData,
    CharacterPartKey,
    PresetItem,
} from '@types';
import {
    CardView,
    PresetToolbarView,
    ButtonControl,
    SelectControl,
} from '../../framework';
import type { PresetActionType } from '../../composite';
import type { PresetController } from '../../viewmodels';
import {
    CHARACTER_PART_DEFS,
    normalizeCharacterData,
    computeCharacterTokenStats,
    type MaterialPartDef,
} from '../../../pipeline/material-definitions';
import { ICONS } from '../../components/icons';
import {
    CHAR_PART_GROUPS,
    renderAvatarBox,
    renderFullWidthTagField,
} from './material-types';

export interface CharacterPanelProps {
    charController: PresetController<CharacterPresetData>;
    outfitController: PresetController<OutfitPresetData>;
    avatarUrlsSignal: Signal<Record<string, string>>;
    charGroupExpanded: Signal<Record<string, boolean>>;
    selectedOutfitToBind: Signal<string>;
    onAction: (action: PresetActionType, id?: string) => Promise<void>;
    onImportFile: (file: File) => void;
    onUploadAvatar: (file: File) => Promise<string>;
    onRemoveAvatar: () => void;
    onEnsureAvatarLoaded: (avatarId: string) => void;
}

export function CharacterPanel(props: CharacterPanelProps): VNode {
    const {
        charController,
        outfitController,
        avatarUrlsSignal,
        charGroupExpanded,
        selectedOutfitToBind,
        onAction,
        onImportFile,
        onUploadAvatar,
        onRemoveAvatar,
        onEnsureAvatarLoaded,
    } = props;

    const activeId = charController.activePresetId.value;
    const rawDraft = charController.draftConfig.value;
    const draft = normalizeCharacterData(rawDraft);
    const isDirty = charController.isDirty.value;
    const dirtySet = charController.dirtyFields.value;

    const allOutfits = outfitController.presets.value;
    const boundIds = draft.boundOutfitIds;

    const isOutfitBound = (outfit: PresetItem<OutfitPresetData>): boolean => {
        if (boundIds.includes(outfit.id)) return true;
        const outfitName = (outfit.data?.name || outfit.name || '').trim().toLowerCase();
        return Boolean(
            outfitName && boundIds.some((b) => b.trim().toLowerCase() === outfitName)
        );
    };

    const unboundOutfits = allOutfits.filter((o) => !isOutfitBound(o));
    const effectiveOutfitToAdd = unboundOutfits.some(
        (o) => o.id === selectedOutfitToBind.value
    )
        ? selectedOutfitToBind.value
        : unboundOutfits[0]?.id || '';

    const handleAddBoundOutfit = () => {
        if (!effectiveOutfitToAdd || boundIds.includes(effectiveOutfitToAdd)) return;
        charController.updateDraft('boundOutfitIds', [
            ...boundIds,
            effectiveOutfitToAdd,
        ]);
        selectedOutfitToBind.value = '';
    };

    const handleRemoveBoundOutfit = (refToRemove: string) => {
        charController.updateDraft(
            'boundOutfitIds',
            boundIds.filter((id) => id !== refToRemove)
        );
    };

    const invalidBoundCount = boundIds.filter((refId) => {
        return !allOutfits.some(
            (o) => o.id === refId || (o.data?.name && o.data.name === refId)
        );
    }).length;

    const handleCleanInvalidBoundOutfits = () => {
        const validBoundIds = boundIds.filter((refId) =>
            allOutfits.some(
                (o) => o.id === refId || (o.data?.name && o.data.name === refId)
            )
        );
        charController.updateDraft('boundOutfitIds', validBoundIds);
    };

    const updatePart = (partKey: CharacterPartKey, val: string) => {
        charController.updateDraft('parts', {
            ...draft.parts,
            [partKey]: val,
        });
    };

    const tokenStats = computeCharacterTokenStats(draft);

    return (
        <div className="da-material-subpanel">
            <div className="da-material-preset-bar">
                <PresetToolbarView
                    presets={charController.toolbarItems.value}
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
                            kind: 'character',
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
                                className="da-input da-material-title-input da-char-name-input"
                                value={draft.name}
                                placeholder="例如: 爱丽丝"
                                onInput={(e) =>
                                    charController.updateDraft(
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
                                className="da-input da-material-title-input da-char-aliases-input"
                                value={draft.aliases}
                                placeholder="以 | 分隔，例如: alice|爱丽丝"
                                onInput={(e) =>
                                    charController.updateDraft(
                                        'aliases',
                                        (e.currentTarget as HTMLInputElement).value
                                    )
                                }
                            />
                        </div>
                    </div>

                    {/* 第三行：角色描述全宽 */}
                    <div className="da-material-single-field">
                        <label className="da-material-compact-label">角色描述</label>
                        <textarea
                            className="da-char-description-textarea"
                            value={draft.description}
                            placeholder="填写角色性格背景、身份设定与故事定位，将注入模型上下文供 AI 理解人设..."
                            onInput={(e) =>
                                charController.updateDraft(
                                    'description',
                                    (e.currentTarget as HTMLTextAreaElement).value
                                )
                            }
                        />
                    </div>
                </div>
            </CardView>

            {/* 2. 绘画标签卡片 (人体生理细分部位全宽文本域) */}
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
                    {/* 角色专属触发词置顶全宽 */}
                    <div className="da-material-single-field">
                        <div className="da-material-compact-label-row">
                            <label className="da-material-compact-label">角色触发词 (Trigger Tags)</label>
                            <span
                                className="da-help-icon"
                                data-tooltip="官方角色收录规范：若为动漫/游戏等知名 IP 角色，请填写 Danbooru 标准角色标签与作品出处（例如 hatsune_miku, vocaloid）；若为原创自设角色 (Original Character)，因 Danbooru 官方不设专属角色名，此处留空即可，模型将依据下方外貌特征标签进行生成。"
                            >
                                ?
                            </span>
                        </div>
                        <input
                            type="text"
                            className="da-input da-material-title-input da-char-trigger-input da-material-tag-input"
                            value={draft.trigger}
                            placeholder="例如: hatsune_miku, vocaloid（原创角色无需专属标签，留空即可）"
                            onInput={(e) =>
                                charController.updateDraft(
                                    'trigger',
                                    (e.currentTarget as HTMLInputElement).value
                                )
                            }
                        />
                    </div>

                    {/* 人体生理结构 5 组折叠分组面板 */}
                    {CHAR_PART_GROUPS.map((grp) => {
                        const isExpanded = Boolean(charGroupExpanded.value[grp.id]);
                        const groupDefs = grp.keys
                            .map((k) => CHARACTER_PART_DEFS.find((d) => d.key === k))
                            .filter((d): d is MaterialPartDef<CharacterPartKey> => Boolean(d));
                        const filledCount = groupDefs.filter((d) =>
                            Boolean((draft.parts[d.key] || '').trim())
                        ).length;

                        return (
                            <div key={grp.id} className="da-shot-group-accordion">
                                <button
                                    type="button"
                                    className="da-shot-group-accordion__header"
                                    onClick={() => {
                                        charGroupExpanded.value = {
                                            ...charGroupExpanded.value,
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

            {/* 3. 专属服装卡片 */}
            <CardView title={`专属服装 (${boundIds.length} 套)`}>
                <div className="da-character-outfits-section">
                    <div className="da-char-outfit-toolbar">
                        <div className="da-char-outfit-toolbar__left">
                            <label className="da-char-outfit-toolbar__label">可用服装：</label>
                            <SelectControl
                                className="da-char-outfit-select"
                                disabled={unboundOutfits.length === 0}
                                value={effectiveOutfitToAdd}
                                placeholder={
                                    unboundOutfits.length === 0
                                        ? allOutfits.length === 0
                                            ? '服装库暂无可用服装'
                                            : '已添加全部可用服装'
                                        : undefined
                                }
                                onChange={(val) => {
                                    selectedOutfitToBind.value = val;
                                }}
                                options={unboundOutfits.map((o) => ({
                                    value: o.id,
                                    label: o.data?.name || o.name,
                                }))}
                            />
                        </div>
                        <div className="da-char-outfit-toolbar__actions">
                            <ButtonControl
                                label="添加服装"
                                variant="secondary"
                                size="sm"
                                disabled={!effectiveOutfitToAdd}
                                onClick={handleAddBoundOutfit}
                            />
                            {invalidBoundCount > 0 && (
                                <ButtonControl
                                    label={`清理失效服装 (${invalidBoundCount})`}
                                    variant="danger"
                                    size="sm"
                                    onClick={handleCleanInvalidBoundOutfits}
                                />
                            )}
                        </div>
                    </div>

                    <div className="da-char-outfit-list">
                        {boundIds.length === 0 ? (
                            <div className="da-empty-hint">
                                暂未添加专属服装
                            </div>
                        ) : (
                            boundIds.map((refId) => {
                                const outfitPreset = allOutfits.find(
                                    (o) =>
                                        o.id === refId ||
                                        (o.data?.name && o.data.name === refId)
                                );
                                const isValid = Boolean(outfitPreset);
                                const displayName = outfitPreset
                                    ? outfitPreset.data?.name || outfitPreset.name
                                    : refId;
                                const description = outfitPreset?.data?.description || '';

                                return (
                                    <div
                                        key={refId}
                                        className={`da-char-outfit-card ${
                                            isValid ? 'is-valid' : 'is-invalid'
                                        }`}
                                    >
                                        <div className="da-char-outfit-card__info">
                                            <span className="da-char-outfit-card__icon">
                                                👗
                                            </span>
                                            <span className="da-char-outfit-card__name">
                                                {displayName}
                                            </span>
                                            {!isValid && (
                                                <span
                                                    className="da-status-badge da-status-badge--invalid"
                                                    title="引用的服装在服装库中不存在"
                                                >
                                                    失效
                                                </span>
                                            )}
                                            {description && (
                                                <span className="da-char-outfit-card__description">
                                                    {description}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            className="da-wi-icon-btn da-wi-icon-btn--danger"
                                            title="移除此服装"
                                            onClick={() => handleRemoveBoundOutfit(refId)}
                                            dangerouslySetInnerHTML={{ __html: ICONS.trash }}
                                        />
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </CardView>
        </div>
    );
}
