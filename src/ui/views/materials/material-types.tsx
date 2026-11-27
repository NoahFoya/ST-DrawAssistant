/**
 * 素材管理视图共享类型与公共辅助渲染方法。
 */

import { useEffect, useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import type { Signal } from '@preact/signals';
import {
    estimateTagTokens,
    CHAR_PART_GROUPS,
    OUTFIT_PART_GROUPS,
    type MaterialPartDef,
} from '../../../pipeline/material-definitions';
import { evaluatePresetDataDirty } from '../../state/preset-controller';
import {
    DEFAULT_SANDBOX_SAMPLE,
    createEmptyActivationTemplate,
    parseBoundCardNamesInput,
    splitBoundCardNames,
    applyPrimaryBoundCardSelection,
    type MaterialsSubTab,
} from '../../state/materials-state';
import { lightboxModal } from '../../media/lightbox-modal';
import { Toast } from '../../feedback/toast';
import { getHostCharacterCards as readHostCharacterCards } from '../../../host';

export {
    type MaterialsSubTab,
    DEFAULT_SANDBOX_SAMPLE,
    createEmptyActivationTemplate,
    evaluatePresetDataDirty,
    CHAR_PART_GROUPS,
    OUTFIT_PART_GROUPS,
};

export function getHostCharacterCards(): Array<{ id: string; name: string }> {
    return readHostCharacterCards();
}

export {
    parseBoundCardNamesInput,
    splitBoundCardNames,
    applyPrimaryBoundCardSelection,
};

export interface FullWidthTagFieldOptions {
    fieldKey: string;
    label: string;
    suffixBadge?: string;
    hint: string;
    value: string;
    placeholder: string;
    rows?: number;
    dirty?: boolean;
    extraClass?: string;
    onChange: (nextVal: string) => void;
}

/**
 * 渲染单行 100% 全宽的 Tag 文本域字段（右上角显示实时预估 Token 数）。
 */
function renderFullWidthTagField(options: FullWidthTagFieldOptions): VNode {
    const tokenCount = estimateTagTokens(options.value);
    return (
        <div
            key={options.fieldKey}
            className={`da-fullwidth-tag-field${options.dirty ? ' is-dirty' : ''}`}
        >
            <div className="da-fullwidth-tag-field__header">
                <div className="da-fullwidth-tag-field__meta">
                    <span className="da-fullwidth-tag-field__label">{options.label}</span>
                    {options.suffixBadge && (
                        <code className="da-fullwidth-tag-field__suffix">
                            {options.suffixBadge}
                        </code>
                    )}
                    <span className="da-fullwidth-tag-field__hint">{options.hint}</span>
                </div>
                <span className="da-fullwidth-tag-field__tokens">
                    (Token: ~{tokenCount})
                </span>
            </div>
            <textarea
                className={`da-textarea da-material-tag-textarea ${options.extraClass || ''}`.trim()}
                data-part-key={options.fieldKey}
                rows={options.rows ?? 2}
                value={options.value}
                placeholder={options.placeholder}
                onInput={(e) =>
                    options.onChange((e.currentTarget as HTMLTextAreaElement).value)
                }
            />
        </div>
    );
}

export interface RenderAvatarBoxOptions {
    kind: 'character' | 'outfit';
    avatarId: string;
    displayTitle: string;
    avatarUrl: string;
    onUploadAvatar: (file: File) => Promise<string>;
    onRemoveAvatar: () => void;
    onEnsureAvatarLoaded?: (avatarId: string) => void;
}

/**
 * 居中紧凑 3:4 比例参考图上传与预览组件。
 */
export function AvatarBox(options: RenderAvatarBoxOptions): VNode {
    const {
        kind,
        avatarId,
        displayTitle,
        avatarUrl,
        onUploadAvatar,
        onRemoveAvatar,
        onEnsureAvatarLoaded,
    } = options;
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (avatarId && onEnsureAvatarLoaded) {
            onEnsureAvatarLoaded(avatarId);
        }
    }, [avatarId, onEnsureAvatarLoaded]);

    const handleFileSelect = (e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
            void onUploadAvatar(file).catch(() => {
                Toast.show('处理参考图片失败，请更换图片重试', { level: 'error' });
            });
        }
        input.value = '';
    };

    return (
        <div className="da-material-avatar-box">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="da-material-avatar-file-input da-hidden"
                onChange={handleFileSelect}
            />

            {avatarUrl ? (
                <div className="da-material-avatar-preview">
                    <img
                        src={avatarUrl}
                        alt={displayTitle || '参考图'}
                        className="da-material-avatar-img"
                        title="点击放大预览"
                        onClick={() =>
                            lightboxModal.openItems([
                                {
                                    url: avatarUrl,
                                    title:
                                        displayTitle ||
                                        (kind === 'character' ? '角色参考图' : '服装预览图'),
                                },
                            ])
                        }
                    />
                    <div className="da-material-avatar-actions">
                        <button
                            type="button"
                            className="da-material-avatar-btn"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            更换
                        </button>
                        <button
                            type="button"
                            className="da-material-avatar-btn da-material-avatar-btn--danger"
                            onClick={onRemoveAvatar}
                        >
                            移除
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    className="da-material-avatar-placeholder"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <span className="da-material-avatar-placeholder__title">
                        {kind === 'character' ? '上传角色参考图' : '上传服装参考图'}
                    </span>
                    <span className="da-material-avatar-placeholder__sub">
                        点击选择图片
                    </span>
                </button>
            )}
        </div>
    );
}

/**
 * 共享素材细分部位折叠分组组件（复用于角色与服装面板）。
 */
export function MaterialPartGroups<K extends string>(props: {
    groups: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly keys: readonly K[];
    }>;
    defs: ReadonlyArray<MaterialPartDef<K>>;
    parts: Record<K, string>;
    expandedSignal: Signal<Record<string, boolean>>;
    dirtySet: Set<string>;
    onChangePart: (key: K, value: string) => void;
}): VNode {
    const { groups, defs, parts, expandedSignal, dirtySet, onChangePart } = props;
    const isWholePartsDirty = dirtySet.has('parts');

    return (
        <>
            {groups.map((grp) => {
                const isExpanded = Boolean(expandedSignal.value[grp.id]);
                const groupDefs = grp.keys
                    .map((k) => defs.find((d) => d.key === k))
                    .filter((d): d is MaterialPartDef<K> => Boolean(d));
                const filledCount = groupDefs.filter((d) =>
                    Boolean((parts[d.key] || '').trim())
                ).length;

                return (
                    <div key={grp.id} className="da-shot-group-accordion">
                        <button
                            type="button"
                            className="da-shot-group-accordion__header"
                            aria-expanded={isExpanded}
                            onClick={() => {
                                expandedSignal.value = {
                                    ...expandedSignal.value,
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
                                        value: parts[def.key],
                                        placeholder: def.placeholder,
                                        rows: 2,
                                        dirty:
                                            isWholePartsDirty ||
                                            dirtySet.has(`parts.${def.key}`) ||
                                            dirtySet.has(def.key),
                                        onChange: (val) => onChangePart(def.key, val),
                                    })
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}
