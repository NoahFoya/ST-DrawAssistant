/**
 * 素材管理 - 启用设置子面板。
 */

import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type {
    CharacterPresetData,
    OutfitPresetData,
    MaterialActivationPresetData,
    MaterialLibraryConfig,
    ActivationTriggerMode,
} from '@types';
import {
    CardView,
    FormFieldView,
    SwitchControl,
    SegmentedControlView,
    SearchableSelectControl,
    NumberInputControl,
} from '../../framework';
import { PresetToolbar, type PresetActionType } from '../../composite';
import type { PresetController } from '../../state';
import {
    normalizeCharacterData,
    normalizeOutfitData,
    matchesOutfitId,
} from '../../../pipeline/material-definitions';
import { promptInjector } from '../../../pipeline/prompt-injector';
import { settingsStore } from '../../../store/settings-store';
import {
    applyPrimaryBoundCardSelection,
    getHostCharacterCards,
    parseBoundCardNamesInput,
    splitBoundCardNames,
} from './material-types';

export interface ActivationPanelProps {
    charController: PresetController<CharacterPresetData>;
    outfitController: PresetController<OutfitPresetData>;
    activationController: PresetController<MaterialActivationPresetData>;
    materialConfigSignal: Signal<MaterialLibraryConfig>;
    onAction: (action: PresetActionType, id?: string) => Promise<boolean>;
    onImportFiles?: (files: File[]) => void;
}

export function ActivationPanel(props: ActivationPanelProps): VNode {
    const {
        charController,
        outfitController,
        activationController,
        materialConfigSignal,
        onAction,
        onImportFiles,
    } = props;

    const characters = charController.presets.value;
    const outfits = outfitController.presets.value;
    const actDraft = activationController.draftConfig.value;
    const charRules = actDraft?.characterRules || {};
    const outfitRules = actDraft?.outfitRules || {};
    const hostCards = getHostCharacterCards();

    // 收集所有角色预设绑定的专属服装，通用服装列表中仅保留未绑定的独立服装
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

    const [rawBoundCardsText, setRawBoundCardsText] = useState<string | null>(null);
    const activeActivationPresetId = activationController.activePresetId.value;
    useEffect(() => {
        setRawBoundCardsText(null);
    }, [activeActivationPresetId]);

    const updateActivationRule = (
        ruleGroup: 'characterRules' | 'outfitRules',
        presetId: string,
        patch: { enabled?: boolean; triggerMode?: ActivationTriggerMode }
    ) => {
        const currentRules = ruleGroup === 'characterRules' ? charRules : outfitRules;
        const prev = currentRules[presetId];
        const nextMode = patch.triggerMode ?? prev?.triggerMode ?? 'keyword';
        // 切换至「常驻」时自动启用开关，避免规则仍处于关闭态而未实际注入
        const nextEnabled =
            patch.enabled !== undefined
                ? patch.enabled
                : patch.triggerMode === 'always'
                  ? true
                  : (prev?.enabled ?? false);

        activationController.updateDraft(ruleGroup, {
            ...currentRules,
            [presetId]: {
                ...(prev || {}),
                enabled: nextEnabled,
                triggerMode: nextMode,
            },
        });
    };

    const {
        primaryCard: primaryBoundCard,
        extraCards: extraBoundCards,
        allCards: rawBoundCards,
    } = splitBoundCardNames(actDraft?.boundCardNames);

    const updateBoundCard = (cardName: string) => {
        activationController.updateDraft(
            'boundCardNames',
            applyPrimaryBoundCardSelection(cardName, extraBoundCards)
        );
    };

    const renderRuleSection = (cfg: {
        title: string;
        subtitle: string;
        emptyHint: string;
        ruleGroup: 'characterRules' | 'outfitRules';
        items: Array<{ id: string; name: string; displayName: string; aliases: string }>;
        rulesMap: Record<string, { enabled?: boolean; triggerMode?: ActivationTriggerMode } | undefined>;
    }): VNode => (
        <CardView className="da-card--padded" title={cfg.title} subtitle={cfg.subtitle}>
            {cfg.items.length === 0 ? (
                <div className="da-empty-hint">{cfg.emptyHint}</div>
            ) : (
                cfg.items.map((item) => {
                    const rule = cfg.rulesMap[item.id];
                    return (
                        <div key={item.id} className="da-activation-item-block">
                            <div className="da-activation-row">
                                <div className="da-activation-row__left">
                                    <SwitchControl
                                        value={Boolean(rule?.enabled)}
                                        onChange={(checked) =>
                                            updateActivationRule(cfg.ruleGroup, item.id, {
                                                enabled: checked,
                                            })
                                        }
                                    />
                                    <span className="da-activation-name">
                                        {item.displayName || item.name}
                                        {item.aliases ? (
                                            <span className="da-activation-aliases">
                                                {' '}
                                                ({item.aliases})
                                            </span>
                                        ) : null}
                                    </span>
                                </div>
                                <div className="da-activation-row__right">
                                    <SegmentedControlView
                                        value={rule?.triggerMode || 'keyword'}
                                        options={[
                                            { label: '关键词', value: 'keyword' },
                                            { label: '常驻', value: 'always' },
                                        ]}
                                        onChange={(val) =>
                                            updateActivationRule(cfg.ruleGroup, item.id, {
                                                triggerMode: val as ActivationTriggerMode,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })
            )}
        </CardView>
    );

    const charRuleItems = characters.map((c) => {
        const data = normalizeCharacterData(c.data);
        return { id: c.id, name: c.name, displayName: data.name, aliases: data.aliases };
    });
    const outfitRuleItems = universalOutfits.map((o) => {
        const data = normalizeOutfitData(o.data);
        return { id: o.id, name: o.name, displayName: data.name, aliases: data.aliases };
    });

    return (
        <div className="da-material-subpanel">
            {/* 顶部独立启用预设工具栏 */}
            <div className="da-material-preset-bar">
                <PresetToolbar
                    presets={activationController.toolbarItems.value}
                    activePresetId={activationController.activePresetId.value}
                    dirty={activationController.isDirty.value}
                    onAction={(action, id) => onAction(action, id)}
                    onImportFiles={onImportFiles}
                />
            </div>

            {/* 1. 启用策略与酒馆角色卡联动卡片 */}
            <CardView title="酒馆角色卡联动" subtitle="设置当前启用预设的扫描策略与角色卡自动匹配规则">
                <div className="da-form-grid">
                    <FormFieldView
                        label="随角色卡自动切换预设"
                        tooltip="开启后，在酒馆切换不同角色卡时，自动切到该角色卡绑定的素材启用预设，同步更换当前启用的角色和服装。"
                        width="w-toggle"
                    >
                        <SwitchControl
                            value={Boolean(materialConfigSignal.value?.autoSwitchByCard)}
                            onChange={(checked) => {
                                const cur = settingsStore.get('materialConfig');
                                const next = { ...cur, autoSwitchByCard: checked };
                                settingsStore.set('materialConfig', next);
                                materialConfigSignal.value = next;
                                void promptInjector.scheduleSyncToHost();
                            }}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="关联酒馆角色卡"
                        tooltip="把当前启用预设和酒馆里的角色卡名绑定在一起。如果下拉框里找不到，可以手动输入角色卡名（多个名称用英文逗号分隔，不区分大小写）。"
                        width="w-240"
                    >
                        {hostCards.length === 0 ? (
                                    <input
                                        type="text"
                                        className="da-input"
                                        placeholder="输入绑定的酒馆角色卡名称（多个可用逗号分隔）"
                                        value={
                                            rawBoundCardsText !== null
                                                ? rawBoundCardsText
                                                : rawBoundCards.join(', ')
                                        }
                                        onInput={(e) => {
                                            const nextRaw = (e.currentTarget as HTMLInputElement).value;
                                            setRawBoundCardsText(nextRaw);
                                            activationController.updateDraft(
                                                'boundCardNames',
                                                parseBoundCardNamesInput(nextRaw)
                                            );
                                        }}
                                        onBlur={() => setRawBoundCardsText(null)}
                                    />
                                ) : (() => {
                                    const matchedHost = hostCards.find(
                                        (hc) =>
                                            hc.name.trim().toLowerCase() ===
                                            primaryBoundCard.toLowerCase()
                                    );
                                    const selectedCardVal = matchedHost
                                        ? matchedHost.name
                                        : primaryBoundCard;
                                    const cardOptions = [
                                        ...(primaryBoundCard && !matchedHost
                                            ? [
                                                  {
                                                      value: primaryBoundCard,
                                                      label: `${primaryBoundCard} (当前已配置)`,
                                                  },
                                              ]
                                            : []),
                                        ...hostCards.map((hc) => ({
                                            value: hc.name,
                                            label: hc.name,
                                        })),
                                    ];
                                    return (
                                        <div className="da-activation-bound-wrap">
                                            <SearchableSelectControl
                                                value={selectedCardVal}
                                                options={cardOptions}
                                                emptyLabel="-- 未关联角色卡 --"
                                                placeholder="-- 未关联角色卡 --"
                                                searchPlaceholder="搜索酒馆角色卡名称..."
                                                emptyResultText="未找到匹配的角色卡"
                                                allowCustomValue={true}
                                                customValueLabel={(q) => `使用自定义角色卡名「${q}」`}
                                                onChange={(val) => updateBoundCard(val)}
                                            />
                                            {extraBoundCards.length > 0 && (
                                                <div className="da-field-inline-hint">
                                                    另已关联 {extraBoundCards.length} 张角色卡：
                                                    {extraBoundCards.join('、')}（清空当前选择将一并解绑）
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                    </FormFieldView>

                    <FormFieldView
                        label="聊天消息扫描深度"
                        tooltip="从最近几条对话消息中检索角色/服装名称或别名（默认 2 条；设为 0 表示不扫描聊天正文，仅注入「常驻」素材）。"
                        width="w-240"
                    >
                        <NumberInputControl
                            min={0}
                            max={100}
                            step={1}
                            value={actDraft?.scanDepth ?? 2}
                            onChange={(val) => activationController.updateDraft('scanDepth', val)}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="角色触发时附带绑定服装"
                        tooltip="开启后，当某个角色启用时，将同时自动展开并注入该角色下绑定的专属服装档案。"
                        width="w-toggle"
                    >
                        <SwitchControl
                            value={actDraft?.includeBoundOutfits !== false}
                            onChange={(checked) =>
                                activationController.updateDraft('includeBoundOutfits', checked)
                            }
                        />
                    </FormFieldView>
                </div>
            </CardView>

            {/* 2. 角色启用列表 */}
            {renderRuleSection({
                title: `角色启用列表 (${characters.length})`,
                subtitle:
                    '管理哪些角色参与生图；「关键词」在聊天提到角色名或别名时自动生效，「常驻」每次出图都会带给 AI',
                emptyHint: '暂无角色预设，请先在「角色管理」中新增角色。',
                ruleGroup: 'characterRules',
                items: charRuleItems,
                rulesMap: charRules,
            })}

            {/* 3. 通用服装启用列表 (过滤排除已绑定专属服装) */}
            {renderRuleSection({
                title: `通用服装启用列表 (${universalOutfits.length})`,
                subtitle:
                    '不绑定特定角色的通用服装；「关键词」在聊天提到服装名或别名时自动生效，「常驻」每次出图都会带给 AI',
                emptyHint: '暂无独立通用服装（专属服装已归属于角色并在角色触发时生效）。',
                ruleGroup: 'outfitRules',
                items: outfitRuleItems,
                rulesMap: outfitRules,
            })}
        </div>
    );
}
