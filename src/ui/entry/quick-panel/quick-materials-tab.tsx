/**
 * 悬浮球快捷面板 - 素材管理与解析联动页 (`materials`)。
 */

import type { VNode } from 'preact';
import type {
    ActivationTriggerMode,
    CharacterPresetData,
    MaterialActivationPresetData,
    MaterialExtractionPresetData,
    MaterialFormatPresetData,
    OutfitPresetData,
} from '@types';
import { DEFAULT_EXTRACTION_CONFIG } from '../../../pipeline/archive-extractor';
import {
    matchesOutfitId,
    normalizeCharacterData,
    normalizeOutfitData,
} from '../../../pipeline/material-definitions';
import {
    applyPrimaryBoundCardSelection,
    parseBoundCardNamesInput,
    splitBoundCardNames,
} from '../../state/materials-state';
import { buildSelectOptionsWithCurrent } from '../../state/quick-panel-state';
import {
    SwitchControl,
    SelectControl,
    SearchableSelectControl,
    SegmentedControlView,
} from '../../framework';
import { QuickSection, QuickFormRow, type QuickPanelSubViewProps } from './quick-shared';

export function QuickMaterialsTab(props: QuickPanelSubViewProps): VNode {
    const { state, settings: s } = props;
    const matCfg = s.materialConfig;
    const actPresets =
        (s.presets?.material_activations as
            | Array<{ id: string; name: string; data: MaterialActivationPresetData }>
            | undefined) || [];
    const extPresets =
        (s.presets?.material_extractions as
            | Array<{ id: string; name: string; data: MaterialExtractionPresetData }>
            | undefined) || [];
    const fmtPresets =
        (s.presets?.material_formats as
            | Array<{ id: string; name: string; data: MaterialFormatPresetData }>
            | undefined) || [];
    const characters =
        (s.presets?.characters as
            | Array<{ id: string; name: string; data: CharacterPresetData }>
            | undefined) || [];
    const outfits =
        (s.presets?.outfits as
            | Array<{ id: string; name: string; data: OutfitPresetData }>
            | undefined) || [];

    const activeActPreset =
        actPresets.find((p) => p.id === matCfg?.activeActivationPresetId) ||
        actPresets[0];
    const activeActId = activeActPreset?.id || '';
    const actData: MaterialActivationPresetData = activeActPreset?.data || {
        characterRules: {},
        outfitRules: {},
    };

    const activeExtPreset =
        extPresets.find((p) => p.id === matCfg?.activeExtractionPresetId) ||
        extPresets[0];
    const activeExtId = activeExtPreset?.id || '';
    const extData = {
        ...DEFAULT_EXTRACTION_CONFIG,
        ...(activeExtPreset?.data || {}),
    };

    const activeFmtPreset =
        fmtPresets.find((p) => p.id === matCfg?.activeFormatPresetId) ||
        fmtPresets[0];
    const activeFmtId = activeFmtPreset?.id || '';

    const hostCards = state.getHostCards();
    const {
        primaryCard: primaryBoundCard,
        extraCards: extraBoundCards,
        allCards: rawBoundCards,
    } = splitBoundCardNames(actData.boundCardNames);

    // 过滤已绑定至角色的专属服装，通用服装启用列表仅展示独立通用服装
    const allBoundOutfitIds: string[] = [];
    for (const c of characters) {
        const boundIds = c.data?.boundOutfitIds || [];
        for (const b of boundIds) {
            if (b && b.trim()) {
                allBoundOutfitIds.push(b.trim());
            }
        }
    }
    const universalOutfits = outfits.filter((o) => !matchesOutfitId(allBoundOutfitIds, o.id));

    return (
        <div className="da-fqp-tab-content" data-tab="materials">
            <QuickSection title="启用设置与角色卡联动">
                <QuickFormRow label="素材启用预设">
                    <SelectControl
                        value={activeActId}
                        disabled={actPresets.length === 0}
                        options={
                            actPresets.length === 0
                                ? [{ label: '暂无启用预设', value: '' }]
                                : actPresets.map((ap) => ({
                                      label: ap.name,
                                      value: ap.id,
                                  }))
                        }
                        onChange={(val) =>
                            state.updateMaterialConfig({ activeActivationPresetId: val })
                        }
                    />
                </QuickFormRow>
                <QuickFormRow label="随角色卡自动切换预设">
                    <SwitchControl
                        value={Boolean(matCfg?.autoSwitchByCard)}
                        onChange={(val) =>
                            state.updateMaterialConfig({ autoSwitchByCard: val })
                        }
                    />
                </QuickFormRow>
                {activeActPreset && (
                    <>
                        <QuickFormRow label="关联酒馆角色卡">
                            {hostCards.length === 0 ? (
                                <input
                                    type="text"
                                    className="da-input"
                                    placeholder="输入角色卡名（逗号分隔多个）"
                                    value={
                                        state.rawBoundCardsDraft.value?.presetId === activeActId
                                            ? state.rawBoundCardsDraft.value.text
                                            : rawBoundCards.join(', ')
                                    }
                                    onInput={(e) => {
                                        const nextRaw = (e.currentTarget as HTMLInputElement).value;
                                        state.rawBoundCardsDraft.value = {
                                            presetId: activeActId,
                                            text: nextRaw,
                                        };
                                        state.updateActiveActivationData(activeActPreset, {
                                            boundCardNames: parseBoundCardNamesInput(nextRaw),
                                        });
                                    }}
                                    onBlur={() => {
                                        state.rawBoundCardsDraft.value = null;
                                    }}
                                />
                            ) : (
                                <SearchableSelectControl
                                    value={primaryBoundCard}
                                    options={buildSelectOptionsWithCurrent(
                                        hostCards.map((hc) => ({
                                            label: hc.name,
                                            value: hc.name,
                                        })),
                                        primaryBoundCard
                                    )}
                                    emptyLabel="-- 未关联角色卡 --"
                                    placeholder="-- 未关联角色卡 --"
                                    searchPlaceholder="搜索酒馆角色卡..."
                                    emptyResultText="无匹配角色卡"
                                    allowCustomValue={true}
                                    customValueLabel={(q) => `使用自定义「${q}」`}
                                    onChange={(val) =>
                                        state.updateActiveActivationData(activeActPreset, {
                                            boundCardNames: applyPrimaryBoundCardSelection(
                                                val,
                                                extraBoundCards
                                            ),
                                        })
                                    }
                                />
                            )}
                        </QuickFormRow>
                        {hostCards.length > 0 && extraBoundCards.length > 0 && (
                            <div className="da-fqp-subhint">
                                另已关联 {extraBoundCards.length} 张：{extraBoundCards.join('、')}
                                （清空当前选择将一并解绑）
                            </div>
                        )}
                    </>
                )}
                {activeActPreset && (
                    <QuickFormRow label="角色触发时附带绑定服装">
                        <SwitchControl
                            value={actData.includeBoundOutfits !== false}
                            onChange={(val) =>
                                state.updateActiveActivationData(activeActPreset, {
                                    includeBoundOutfits: val,
                                })
                            }
                        />
                    </QuickFormRow>
                )}
            </QuickSection>

            <QuickSection title={`角色启用列表 (${characters.length})`}>
                {characters.length === 0 ? (
                    <div className="da-fqp-empty">暂无角色预设</div>
                ) : (
                    characters.map((c) => {
                        const data = normalizeCharacterData(c.data);
                        const displayName = data.name || c.name;
                        const rule = actData.characterRules?.[c.id];
                        return (
                            <div key={c.id} className="da-fqp-item-row">
                                <div className="da-fqp-item-row__left">
                                    <SwitchControl
                                        value={Boolean(rule?.enabled)}
                                        onChange={(val) =>
                                            activeActPreset &&
                                            state.updateActivationRule(
                                                activeActPreset,
                                                'characterRules',
                                                c.id,
                                                { enabled: val }
                                            )
                                        }
                                    />
                                    <span
                                        className="da-fqp-item-row__name"
                                        title={displayName}
                                    >
                                        {displayName}
                                    </span>
                                </div>
                                <div className="da-fqp-item-row__right">
                                    <SegmentedControlView
                                        value={rule?.triggerMode || 'keyword'}
                                        options={[
                                            { label: '关键词', value: 'keyword' },
                                            { label: '常驻', value: 'always' },
                                        ]}
                                        onChange={(val) =>
                                            activeActPreset &&
                                            state.updateActivationRule(
                                                activeActPreset,
                                                'characterRules',
                                                c.id,
                                                {
                                                    triggerMode:
                                                        val as ActivationTriggerMode,
                                                }
                                            )
                                        }
                                    />
                                </div>
                            </div>
                        );
                    })
                )}
            </QuickSection>

            <QuickSection title={`通用服装启用列表 (${universalOutfits.length})`}>
                {universalOutfits.length === 0 ? (
                    <div className="da-fqp-empty">暂无独立通用服装</div>
                ) : (
                    universalOutfits.map((o) => {
                        const data = normalizeOutfitData(o.data);
                        const displayName = data.name || o.name;
                        const rule = actData.outfitRules?.[o.id];
                        return (
                            <div key={o.id} className="da-fqp-item-row">
                                <div className="da-fqp-item-row__left">
                                    <SwitchControl
                                        value={Boolean(rule?.enabled)}
                                        onChange={(val) =>
                                            activeActPreset &&
                                            state.updateActivationRule(
                                                activeActPreset,
                                                'outfitRules',
                                                o.id,
                                                { enabled: val }
                                            )
                                        }
                                    />
                                    <span
                                        className="da-fqp-item-row__name"
                                        title={displayName}
                                    >
                                        {displayName}
                                    </span>
                                </div>
                                <div className="da-fqp-item-row__right">
                                    <SegmentedControlView
                                        value={rule?.triggerMode || 'keyword'}
                                        options={[
                                            { label: '关键词', value: 'keyword' },
                                            { label: '常驻', value: 'always' },
                                        ]}
                                        onChange={(val) =>
                                            activeActPreset &&
                                            state.updateActivationRule(
                                                activeActPreset,
                                                'outfitRules',
                                                o.id,
                                                {
                                                    triggerMode:
                                                        val as ActivationTriggerMode,
                                                }
                                            )
                                        }
                                    />
                                </div>
                            </div>
                        );
                    })
                )}
            </QuickSection>

            <QuickSection title="楼层解析与格式预设">
                <QuickFormRow label="档案解析预设">
                    <SelectControl
                        value={activeExtId}
                        disabled={extPresets.length === 0}
                        options={
                            extPresets.length === 0
                                ? [{ label: '暂无解析预设', value: '' }]
                                : extPresets.map((ep) => ({
                                      label: ep.name,
                                      value: ep.id,
                                  }))
                        }
                        onChange={(val) =>
                            state.updateMaterialConfig({ activeExtractionPresetId: val })
                        }
                    />
                </QuickFormRow>
                {activeExtPreset && (
                    <>
                        <QuickFormRow label="启用楼层档案提取">
                            <SwitchControl
                                value={extData.enabled !== false}
                                onChange={(val) =>
                                    state.updateActiveExtractionData(activeExtPreset, {
                                        enabled: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                        <QuickFormRow label="AI 回复后自动检测并弹窗确认">
                            <SwitchControl
                                value={extData.autoDetect !== false}
                                onChange={(val) =>
                                    state.updateActiveExtractionData(activeExtPreset, {
                                        autoDetect: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                        <QuickFormRow label="折叠楼层原始文本">
                            <SwitchControl
                                value={extData.collapseInFloor !== false}
                                onChange={(val) =>
                                    state.updateActiveExtractionData(activeExtPreset, {
                                        collapseInFloor: val,
                                    })
                                }
                            />
                        </QuickFormRow>
                    </>
                )}
                <QuickFormRow label="变量与宏格式预设">
                    <SelectControl
                        value={activeFmtId}
                        disabled={fmtPresets.length === 0}
                        options={
                            fmtPresets.length === 0
                                ? [{ label: '暂无格式预设', value: '' }]
                                : fmtPresets.map((fp) => ({
                                      label: fp.name,
                                      value: fp.id,
                                  }))
                        }
                        onChange={(val) =>
                            state.updateMaterialConfig({ activeFormatPresetId: val })
                        }
                    />
                </QuickFormRow>
            </QuickSection>
        </div>
    );
}
