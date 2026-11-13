/**
 * 素材库视图共享类型与公共辅助渲染方法。
 */

import type { VNode } from 'preact';
import type {
    CharacterPartKey,
    OutfitPartKey,
    MaterialActivationPresetData,
    CharacterPresetData,
    OutfitPresetData,
} from '@types';
import { estimateTagTokens } from '../../../pipeline/material-definitions';
import { settingsStore } from '../../../store/settings-store';
import { lightboxModal } from '../../media/lightbox-modal';
import { Toast } from '../../feedback/toast';

export type MaterialsSubTab =
    | 'characters'
    | 'outfits'
    | 'activation'
    | 'extraction'
    | 'format';

/** 角色人体生理结构 5 组自顶向下自然认知划分 */
export const CHAR_PART_GROUPS: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly keys: readonly CharacterPartKey[];
    readonly defaultExpanded: boolean;
}> = [
    {
        id: 'physique_features',
        label: '基础外貌与配饰',
        keys: ['appearance', 'features', 'accessories'],
        defaultExpanded: false,
    },
    {
        id: 'face_head',
        label: '容貌发相',
        keys: ['hair', 'face'],
        defaultExpanded: false,
    },
    {
        id: 'torso_body',
        label: '身形躯干',
        keys: ['upper_body', 'chest', 'waist', 'hips'],
        defaultExpanded: false,
    },
    {
        id: 'limbs_details',
        label: '四肢手足',
        keys: ['hands', 'legs', 'feet'],
        defaultExpanded: false,
    },
    {
        id: 'reproductive',
        label: '生殖性征',
        keys: ['privates'],
        defaultExpanded: false,
    },
];

/** 服装穿搭层级 5 组由外至内分层划分 */
export const OUTFIT_PART_GROUPS: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly keys: readonly OutfitPartKey[];
    readonly defaultExpanded: boolean;
}> = [
    {
        id: 'style_head',
        label: '风格头饰',
        keys: ['style', 'headwear'],
        defaultExpanded: false,
    },
    {
        id: 'main_wear',
        label: '主体衣着',
        keys: ['top', 'bottom'],
        defaultExpanded: false,
    },
    {
        id: 'limbs_shoes',
        label: '手足穿戴',
        keys: ['handwear', 'socks', 'shoes'],
        defaultExpanded: false,
    },
    {
        id: 'accessories',
        label: '随身配件',
        keys: ['accessories'],
        defaultExpanded: false,
    },
    {
        id: 'underwear',
        label: '贴身内衣',
        keys: ['underwear'],
        defaultExpanded: false,
    },
];

export const DEFAULT_SANDBOX_SAMPLE = `<角色>
NAME: 爱丽丝
ALIASES: alice|爱丽丝
TRIGGER: original
DESCRIPTION: 金发碧眼的见习魔法使，性格温顺文雅
OUTFITS: 学院制服
APPEARANCE: fair_skin, slender
hair: blonde_hair, long_hair
face: blue_eyes, delicate_face
features: wings
upper_body: slender_shoulders, collarbone
chest: medium_breasts
waist: narrow_waist, flat_stomach
hips: gentle_hips
legs: slender_legs
feet: bare_feet
hands: slender_fingers
accessories: hair_ribbon, pendant
privates: pubic_hair
</角色>`;

export function getHostCharacterCards(): Array<{ id: string; name: string }> {
    if (typeof window === 'undefined') return [];
    const ctx = window.SillyTavern?.getContext?.();
    const chars = ctx?.characters;
    if (!Array.isArray(chars)) return [];
    return chars.map((c, i) => {
        const item = c as { avatar?: string; name?: string };
        return {
            id: item.avatar || item.name || `char_${i}`,
            name: item.name || item.avatar || `角色卡 #${i + 1}`,
        };
    });
}

export function createEmptyActivationTemplate(): MaterialActivationPresetData {
    const charRules: MaterialActivationPresetData['characterRules'] = {};
    for (const c of settingsStore.getPresets<CharacterPresetData>('characters')) {
        charRules[c.id] = { enabled: true, triggerMode: 'keyword' };
    }
    const outfitRules: MaterialActivationPresetData['outfitRules'] = {};
    for (const o of settingsStore.getPresets<OutfitPresetData>('outfits')) {
        outfitRules[o.id] = { enabled: true, triggerMode: 'keyword' };
    }
    return {
        boundCardNames: [],
        scanDepth: 5,
        includeBoundOutfits: true,
        characterRules: charRules,
        outfitRules,
    };
}

/**
 * 比较预设草稿与基线快照的脏字段。
 *
 * @remarks
 * 角色与服装预设包含嵌套对象（parts）与数组（boundOutfitIds），采用序列化比对感知深层变更。
 */
export function evaluatePresetDataDirty(
    draft: Record<string, unknown>,
    base: Record<string, unknown>
): Set<string> {
    const dirty = new Set<string>();
    const keys = new Set([...Object.keys(draft || {}), ...Object.keys(base || {})]);
    for (const k of keys) {
        if (JSON.stringify(draft?.[k]) !== JSON.stringify(base?.[k])) {
            dirty.add(k);
        }
    }
    return dirty;
}

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
export function renderFullWidthTagField(options: FullWidthTagFieldOptions): VNode {
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
 * 渲染居中紧凑 3:4 比例参考图上传与预览框。
 */
export function renderAvatarBox(options: RenderAvatarBoxOptions): VNode {
    const { kind, avatarId, displayTitle, avatarUrl, onUploadAvatar, onRemoveAvatar, onEnsureAvatarLoaded } = options;
    if (avatarId && onEnsureAvatarLoaded) {
        onEnsureAvatarLoaded(avatarId);
    }
    let fileInputEl: HTMLInputElement | null = null;

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
                ref={(el) => {
                    fileInputEl = el;
                }}
                type="file"
                accept="image/*"
                className="da-material-avatar-file-input"
                style={{ display: 'none' }}
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
                            onClick={() => fileInputEl?.click()}
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
                    onClick={() => fileInputEl?.click()}
                >
                    <span className="da-material-avatar-placeholder__icon">🖼️</span>
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
