/**
 * 素材库 - 启用设置子面板。
 */

import type { VNode } from 'preact';
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
} from '../../../pipeline/material-definitions';
import { promptInjector } from '../../../pipeline/prompt-injector';
import { settingsStore } from '../../../store/settings-store';
import { getHostCharacterCards } from './material-types';

export interface ActivationPanelProps {
    charController: PresetController<CharacterPresetData>;
    outfitController: PresetController<OutfitPresetData>;
    activationController: PresetController<MaterialActivationPresetData>;
    materialConfigSignal: Signal<MaterialLibraryConfig>;
    onAction: (action: PresetActionType, id?: string) => Promise<void>;
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

    // 收集所有角色预设绑定的专属服装标识，通用服装列表中仅保留未绑定的独立服装
    const allBoundOutfitIds = new Set<string>();
    for (const c of characters) {
        const boundIds = c.data?.boundOutfitIds || [];
        for (const b of boundIds) {
            if (b) {
                allBoundOutfitIds.add(b);
                allBoundOutfitIds.add(b.trim().toLowerCase());
            }
        }
    }
    const universalOutfits = outfits.filter((o) => {
        const name = (o.data?.name || o.name || '').trim().toLowerCase();
        return !allBoundOutfitIds.has(o.id) && (!name || !allBoundOutfitIds.has(name));
    });

    const toggleCharacterEnabled = (presetId: string, enabled: boolean) => {
        const prev = charRules[presetId];
        settingsStore.setMaterialActivationRule('character', presetId, {
            enabled,
            triggerMode: prev?.triggerMode || 'keyword',
        }, activationController.activePresetId.value);
        activationController.reloadFromStore();
        materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
        void promptInjector.scheduleSyncToHost();
    };

    const changeCharacterTriggerMode = (
        presetId: string,
        triggerMode: ActivationTriggerMode
    ) => {
        const prev = charRules[presetId];
        settingsStore.setMaterialActivationRule('character', presetId, {
            enabled: prev?.enabled ?? true,
            triggerMode,
        }, activationController.activePresetId.value);
        activationController.reloadFromStore();
        materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
        void promptInjector.scheduleSyncToHost();
    };

    const toggleOutfitEnabled = (presetId: string, enabled: boolean) => {
        const prev = outfitRules[presetId];
        settingsStore.setMaterialActivationRule('outfit', presetId, {
            enabled,
            triggerMode: prev?.triggerMode || 'keyword',
        }, activationController.activePresetId.value);
        activationController.reloadFromStore();
        materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
        void promptInjector.scheduleSyncToHost();
    };

    const changeOutfitTriggerMode = (
        presetId: string,
        triggerMode: ActivationTriggerMode
    ) => {
        const prev = outfitRules[presetId];
        settingsStore.setMaterialActivationRule('outfit', presetId, {
            enabled: prev?.enabled ?? true,
            triggerMode,
        }, activationController.activePresetId.value);
        activationController.reloadFromStore();
        materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
        void promptInjector.scheduleSyncToHost();
    };

    const updateBoundCard = (cardName: string) => {
        const cur = activationController.currentPreset.value;
        if (!cur) return;
        const nextData: MaterialActivationPresetData = {
            ...cur.data,
            boundCardNames: cardName ? [cardName] : [],
        };
        settingsStore.savePreset('material_activations', {
            ...cur,
            data: nextData,
            updatedAt: Date.now(),
        });
        activationController.reloadFromStore();
        materialConfigSignal.value = { ...settingsStore.get('materialConfig') };
        void promptInjector.scheduleSyncToHost();
    };

    return (
        <div className="da-material-subpanel">
            {/* 顶部独立启用预设工具栏 */}
            <div className="da-material-preset-bar">
                <PresetToolbarView
                    presets={activationController.toolbarItems.value}
                    activePresetId={activationController.activePresetId.value}
                    dirty={activationController.isDirty.value}
                    onAction={(action, id) => void onAction(action, id)}
                    onImportFile={onImportFile}
                />
            </div>

            {/* 1. 酒馆角色卡联动卡片 */}
            <CardView title="酒馆角色卡联动" subtitle="设置当前启用预设与酒馆角色卡的自动联动匹配规则">
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
                            }}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="关联酒馆角色卡"
                        tooltip="将当前启用预设与宿主特定角色卡名称进行绑定。若列表中未列出，可手动输入角色卡名称以精确匹配。"
                        width="auto"
                    >
                        {hostCards.length === 0 ? (
                            <input
                                type="text"
                                className="da-input"
                                placeholder="输入绑定的酒馆角色卡名称"
                                value={actDraft?.boundCardNames?.[0] || ''}
                                onInput={(e) =>
                                    updateBoundCard((e.currentTarget as HTMLInputElement).value)
                                }
                            />
                        ) : (
                            <SelectControl
                                value={actDraft?.boundCardNames?.[0] || ''}
                                placeholder="-- 未关联角色卡 (手动选择) --"
                                onChange={(val) => updateBoundCard(val)}
                                options={[
                                    ...(actDraft?.boundCardNames?.[0] &&
                                    !hostCards.some(
                                        (hc) => hc.name === actDraft.boundCardNames[0]
                                    )
                                        ? [
                                              {
                                                  value: actDraft.boundCardNames[0],
                                                  label: `${actDraft.boundCardNames[0]} (当前已配置)`,
                                              },
                                          ]
                                        : []),
                                    ...hostCards.map((hc) => ({
                                        value: hc.name,
                                        label: hc.name,
                                    })),
                                ]}
                            />
                        )}
                    </FormFieldView>
                </div>
            </CardView>

            {/* 2. 角色启用列表 */}
            <CardView
                className="da-card--padded"
                title={`角色启用列表 (${characters.length})`}
                subtitle="控制参与生图的角色档案；支持「关键词触发」（生图提示词中命中角色名称、别名或专属标签时自动注入）与「常驻触发」（每次生图强制注入该角色外貌）"
            >
                {characters.length === 0 ? (
                    <div className="da-empty-hint">
                        暂无角色预设，请先在「角色管理」中新增角色。
                    </div>
                ) : (
                    characters.map((c) => {
                        const data = normalizeCharacterData(c.data);
                        const rule = charRules[c.id];

                        return (
                            <div key={c.id} className="da-activation-item-block">
                                <div className="da-activation-row">
                                    <div className="da-activation-row__left">
                                        <SwitchControl
                                            value={Boolean(rule?.enabled)}
                                            onChange={(checked) =>
                                                toggleCharacterEnabled(c.id, checked)
                                            }
                                        />
                                        <span className="da-activation-name">
                                            {data.name || c.name}
                                            {data.aliases ? (
                                                <span className="da-activation-aliases">
                                                    {' '}
                                                    ({data.aliases})
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
                                                changeCharacterTriggerMode(
                                                    c.id,
                                                    val as ActivationTriggerMode
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </CardView>

            {/* 3. 通用服装启用列表 (过滤排除已绑定专属服装) */}
            <CardView
                className="da-card--padded"
                title={`通用服装启用列表 (${universalOutfits.length})`}
                subtitle="未绑定特定角色的独立通用服装；支持「关键词触发」（提示词中命中服装别名时自动穿戴）与「常驻触发」（每次生图强制穿戴该服装）"
            >
                {universalOutfits.length === 0 ? (
                    <div className="da-empty-hint">
                        暂无独立通用服装（专属服装已归属于角色并在角色触发时生效）。
                    </div>
                ) : (
                    universalOutfits.map((o) => {
                        const data = normalizeOutfitData(o.data);
                        const rule = outfitRules[o.id];

                        return (
                            <div key={o.id} className="da-activation-item-block">
                                <div className="da-activation-row">
                                    <div className="da-activation-row__left">
                                        <SwitchControl
                                            value={Boolean(rule?.enabled)}
                                            onChange={(checked) =>
                                                toggleOutfitEnabled(o.id, checked)
                                            }
                                        />
                                        <span className="da-activation-name">
                                            {data.name || o.name}
                                            {data.aliases ? (
                                                <span className="da-activation-aliases">
                                                    {' '}
                                                    ({data.aliases})
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
                                                changeOutfitTriggerMode(
                                                    o.id,
                                                    val as ActivationTriggerMode
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </CardView>
        </div>
    );
}
