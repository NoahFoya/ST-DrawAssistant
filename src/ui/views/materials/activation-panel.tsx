/**
 * 素材库 - 启用设置子面板。
 */

import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
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
    PresetToolbarView,
    SelectControl,
} from '../../framework';
import type { PresetActionType } from '../../composite';
import type { PresetController } from '../../viewmodels';
import {
    normalizeCharacterData,
    normalizeOutfitData,
    matchesOutfitId,
} from '../../../pipeline/material-definitions';
import { promptInjector } from '../../../pipeline/prompt-injector';
import { settingsStore } from '../../../store/settings-store';
import { getHostCharacterCards } from './material-types';

export interface ActivationPanelProps {
    charController: PresetController<CharacterPresetData>;
    outfitController: PresetController<OutfitPresetData>;
    activationController: PresetController<MaterialActivationPresetData>;
    materialConfigSignal: Signal<MaterialLibraryConfig>;
    onAction: (action: PresetActionType, id?: string) => Promise<boolean>;
    onImportFile: (file: File) => void;
}

export function ActivationPanel(props: ActivationPanelProps): VNode {
    const {
        charController,
        outfitController,
        activationController,
        materialConfigSignal,
        onAction,
        onImportFile,
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

    const parseCardNamesInput = (raw: string): string[] => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const token of raw.split(/[,，\r\n]/)) {
            const clean = token.trim();
            if (!clean) continue;
            const key = clean.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                result.push(clean);
            }
        }
        return result;
    };

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

    const rawBoundCards = (actDraft?.boundCardNames || [])
        .map((n) => (n || '').trim())
        .filter(Boolean);
    const primaryBoundCard = rawBoundCards[0] || '';
    const extraBoundCards = rawBoundCards.slice(1);

    const updateBoundCard = (cardName: string) => {
        const trimmed = cardName.trim();
        if (!trimmed) {
            activationController.updateDraft('boundCardNames', []);
            return;
        }
        const dedupedRest = extraBoundCards.filter(
            (n) => n.toLowerCase() !== trimmed.toLowerCase()
        );
        activationController.updateDraft('boundCardNames', [trimmed, ...dedupedRest]);
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
                <PresetToolbarView
                    presets={activationController.toolbarItems.value}
                    activePresetId={activationController.activePresetId.value}
                    dirty={activationController.isDirty.value}
                    onAction={(action, id) => onAction(action, id)}
                    onImportFile={onImportFile}
                />
            </div>

            {/* 1. 启用策略与酒馆角色卡联动卡片 */}
            <CardView title="酒馆角色卡联动" subtitle="设置当前启用预设的扫描策略与角色卡自动匹配规则">
                <div className="da-form-grid">
                    <FormFieldView
                        label="随角色卡自动切换预设"
                        tooltip="开启后，扩展将监听酒馆宿主的角色加载事件；当切换至不同角色卡时，自动将素材库启用预设切换为与该角色卡绑定的预设，自动同步切换专属服装与触发词。"
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
                        tooltip="将当前启用预设与宿主特定角色卡名称进行绑定。若列表中未列出，可手动输入角色卡名称（支持逗号分隔多个名称，忽略大小写）。"
                        width="auto"
                    >
                        {hostCards.length === 0 ? (
                            <input
                                type="text"
                                className="da-input"
                                placeholder="输入绑定的酒馆角色卡名称（多个可用逗号分隔）"
                                value={rawBoundCardsText !== null ? rawBoundCardsText : rawBoundCards.join(', ')}
                                onInput={(e) => {
                                    const nextRaw = (e.currentTarget as HTMLInputElement).value;
                                    setRawBoundCardsText(nextRaw);
                                    activationController.updateDraft(
                                        'boundCardNames',
                                        parseCardNamesInput(nextRaw)
                                    );
                                }}
                                onBlur={() => setRawBoundCardsText(null)}
                            />
                        ) : (() => {
                            const matchedHost = hostCards.find(
                                (hc) => hc.name.trim().toLowerCase() === primaryBoundCard.toLowerCase()
                            );
                            const selectedCardVal = matchedHost ? matchedHost.name : primaryBoundCard;
                            return (
                                <SelectControl
                                    value={selectedCardVal}
                                    placeholder="-- 未关联角色卡 (手动选择) --"
                                    onChange={(val) => updateBoundCard(val)}
                                    options={[
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
                                    ]}
                                />
                            );
                        })()}
                    </FormFieldView>

                    <FormFieldView
                        label="聊天消息扫描深度"
                        tooltip="从最近几条对话消息中检索角色/服装名称或别名（默认 2 条；设为 0 表示不扫描聊天正文，仅注入「常驻」素材）。"
                        width="w-120"
                    >
                        <input
                            type="number"
                            className="da-input da-input--sm"
                            min={0}
                            max={100}
                            value={actDraft?.scanDepth ?? 2}
                            onInput={(e) => {
                                const raw = (e.currentTarget as HTMLInputElement).value.trim();
                                if (raw === '') return;
                                const parsed = Number.parseInt(raw, 10);
                                if (!Number.isNaN(parsed)) {
                                    activationController.updateDraft(
                                        'scanDepth',
                                        Math.max(0, Math.min(100, parsed))
                                    );
                                }
                            }}
                            onBlur={(e) => {
                                const raw = (e.currentTarget as HTMLInputElement).value.trim();
                                if (raw === '') {
                                    activationController.updateDraft('scanDepth', 2);
                                }
                            }}
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
                    '控制参与生图的角色档案；支持「关键词触发」（聊天文本中命中角色名称或别名时自动注入）与「常驻触发」（每次生成强制注入该角色外貌）',
                emptyHint: '暂无角色预设，请先在「角色管理」中新增角色。',
                ruleGroup: 'characterRules',
                items: charRuleItems,
                rulesMap: charRules,
            })}

            {/* 3. 通用服装启用列表 (过滤排除已绑定专属服装) */}
            {renderRuleSection({
                title: `通用服装启用列表 (${universalOutfits.length})`,
                subtitle:
                    '未绑定特定角色的独立通用服装；支持「关键词触发」（聊天文本中命中服装名称或别名时自动注入）与「常驻触发」（每次生成强制注入该服装）',
                emptyHint: '暂无独立通用服装（专属服装已归属于角色并在角色触发时生效）。',
                ruleGroup: 'outfitRules',
                items: outfitRuleItems,
                rulesMap: outfitRules,
            })}
        </div>
    );
}
