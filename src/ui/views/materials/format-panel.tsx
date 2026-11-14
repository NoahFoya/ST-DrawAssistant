/**
 * 素材库 - 变量与宏管理子面板。
 */

import type { VNode } from 'preact';
import type { Signal } from '@preact/signals';
import type {
    MaterialFormatPresetData,
    MaterialFormatConfig,
    MaterialMacroRule,
} from '@types';
import {
    CardView,
    SegmentedControlView,
    PresetToolbarView,
    ButtonControl,
    BadgeView,
} from '../../framework';
import type { PresetController } from '../../viewmodels';
import {
    CHARACTER_PART_DEFS,
    OUTFIT_PART_DEFS,
    normalizeCharacterData,
    normalizeOutfitData,
    validateMacroKey,
} from '../../../pipeline/material-definitions';
import {
    DEFAULT_FORMAT_TEMPLATES,
    renderArchiveRowTemplate,
    renderMacroRowTemplate,
} from '../../../pipeline/prompt-injector';
import { Toast } from '../../feedback/toast';
import { ICONS } from '../../components/icons';

export interface FormatPanelProps {
    formatController: PresetController<MaterialFormatPresetData>;
    activeMacroRuleKind: Signal<'character' | 'outfit'>;
    activeTemplateKind: Signal<'character' | 'outfit' | 'macro'>;
    isVariablesDrawerOpen: Signal<boolean>;
    expandedMacroRuleIds: Signal<Record<string, boolean>>;
}

export function FormatPanel(props: FormatPanelProps): VNode {
    const {
        formatController,
        activeMacroRuleKind,
        activeTemplateKind,
        isVariablesDrawerOpen,
        expandedMacroRuleIds,
    } = props;

    const draft = formatController.draftConfig.value;
    const fmt: MaterialFormatConfig = {
        characterTemplate:
            draft?.characterTemplate ?? DEFAULT_FORMAT_TEMPLATES.characterTemplate,
        outfitTemplate:
            draft?.outfitTemplate ?? DEFAULT_FORMAT_TEMPLATES.outfitTemplate,
        macroTemplate:
            draft?.macroTemplate ?? DEFAULT_FORMAT_TEMPLATES.macroTemplate ?? '- {{macro}}: {{description}}',
    };

    const updateFormatConfig = (patch: Partial<MaterialFormatConfig>) => {
        formatController.patchDraft(patch);
    };

    const updateMacroRules = (
        kind: 'character' | 'outfit',
        rules: MaterialMacroRule[]
    ) => {
        formatController.patchDraft({
            [kind === 'character' ? 'characterMacros' : 'outfitMacros']: rules,
        });
    };

    const insertVar = (
        textareaId: string,
        varName: string,
        onUpdate: (nextVal: string) => void
    ) => {
        const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
        if (!el) return;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const val = el.value;
        const insertion = `{{${varName}}}`;
        const nextVal = val.slice(0, start) + insertion + val.slice(end);
        onUpdate(nextVal);
        setTimeout(() => {
            el.focus();
            el.setSelectionRange(start + insertion.length, start + insertion.length);
        }, 0);
    };

    // 角色变量（基础属性 + 绘画标签部位，不向 AI 泄露底层触发词）
    const CHAR_BASE_VARS = [
        { key: 'name', label: '名称' },
        { key: 'aliases', label: '别名' },
        { key: 'description', label: '描述' },
        { key: 'outfits', label: '专属服装' },
    ];
    const CHAR_PART_VARS = CHARACTER_PART_DEFS.map((d) => ({
        key: d.key,
        label: d.label,
    }));

    // 服装变量（基础属性 + 绘画标签部位，不向 AI 泄露底层触发词）
    const OUTFIT_BASE_VARS = [
        { key: 'name', label: '名称' },
        { key: 'aliases', label: '别名' },
        { key: 'description', label: '描述' },
    ];
    const OUTFIT_PART_VARS = OUTFIT_PART_DEFS.map((d) => ({
        key: d.key,
        label: d.label,
    }));

    const sampleOutfitPreset = {
        id: 'preview_outfit_1',
        name: '学院制服',
        data: normalizeOutfitData({
            name: '学院制服',
            aliases: 'school_uniform|制服',
            description: '经典日系深蓝水手服与百褶短裙',
            parts: {
                style: 'sailor_uniform, navy_blue, pleated_skirt',
                headwear: 'white_headband',
                top: 'sailor_collar, short_sleeves, white_shirt',
                bottom: 'pleated_skirt, navy_blue_skirt',
                handwear: 'wrist_cuffs',
                socks: 'white_socks',
                shoes: 'loafers',
                accessories: 'red_neckerchief',
                underwear: 'white_bra, white_panties',
            },
        }),
    };

    const sampleCharData = normalizeCharacterData({
        name: '爱丽丝',
        aliases: 'alice|爱丽丝',
        description: '金发碧眼的见习魔法使，性格温顺文雅',
        boundOutfitIds: [sampleOutfitPreset.id],
        parts: {
            appearance: 'fair_skin, slender, elf',
            hair: 'blonde_hair, long_hair, twintails, bangs',
            face: 'blue_eyes, gentle_smile, delicate_face',
            features: 'cat_ears, wings',
            chest: 'medium_breasts',
            upper_body: 'slender_arms, collarbone',
            waist: 'narrow_waist, flat_stomach',
            hips: 'gentle_hips',
            legs: 'slender_legs',
            feet: 'bare_feet',
            hands: 'slender_fingers',
            accessories: 'hair_ribbon, pendant',
            privates: '',
        },
    });

    const renderCharPreview = (template: string) =>
        renderArchiveRowTemplate(
            template || '',
            sampleCharData,
            [sampleOutfitPreset],
            fmt.outfitTemplate,
            true
        );

    const renderOutfitPreview = (template: string) =>
        renderArchiveRowTemplate(template || '', sampleOutfitPreset.data, []);

    const sampleCharRules = draft?.characterMacros || [];
    const sampleOutfitRules = draft?.outfitMacros || [];

    const renderMacrosPreview = (rules: MaterialMacroRule[], template?: string) => {
        const tpl =
            template ||
            DEFAULT_FORMAT_TEMPLATES.macroTemplate ||
            '- {{macro}}: {{description}}';
        return rules.map((r) => renderMacroRowTemplate(tpl, r)).join('\n');
    };

    const renderUnifiedMacroRulesCard = (): VNode => {
        const kind = activeMacroRuleKind.value;
        const isChar = kind === 'character';

        const customRules = isChar ? sampleCharRules : sampleOutfitRules;
        const partDefs = isChar ? CHARACTER_PART_DEFS : OUTFIT_PART_DEFS;

        const updateRule = (index: number, nextRule: MaterialMacroRule) => {
            const nextList = [...customRules];
            nextList[index] = nextRule;
            updateMacroRules(kind, nextList);
        };

        const deleteRule = (index: number) => {
            const nextList = customRules.filter((_, i) => i !== index);
            updateMacroRules(kind, nextList);
        };

        const addRule = () => {
            const newId = `macro_${kind}_${Date.now().toString(36)}`;
            const newRule: MaterialMacroRule = {
                id: newId,
                name: '',
                description: '',
                targetParts: [],
            };
            expandedMacroRuleIds.value = {
                ...expandedMacroRuleIds.value,
                [newId]: true,
            };
            updateMacroRules(kind, [...customRules, newRule]);
        };

        const resetToDefaults = () => {
            const baseData = formatController.baselineSnapshot.value;
            const baseRules = (isChar ? baseData?.characterMacros : baseData?.outfitMacros) || [];
            updateMacroRules(kind, baseRules);
            Toast.show(`已重置${isChar ? '角色' : '服装'}宏规则草稿`, { level: 'info' });
        };

        const toggleExpand = (ruleId: string) => {
            const current = Boolean(expandedMacroRuleIds.value[ruleId]);
            expandedMacroRuleIds.value = {
                ...expandedMacroRuleIds.value,
                [ruleId]: !current,
            };
        };

        return (
            <CardView
                title="生图宏规则配置"
                subtitle="生图宏指令与展开部位维护"
                tooltip={`定义生图宏（如 $角色名-部位$ 或 $服装名-部位$）的展开与拼装规范：\n1. 组合展开：将部位标签按顺序自动拼装成逗号分隔的出图提示词；\n2. 预置取景：支持 -closeup（头部特写）、-upper（半身）、-cowboy（七分身）、-full（全身）、-intimate（亲密视角）等快捷后缀；\n3. 提示词通道注入：所有已配置的宏条目将由行模板渲染，并注入到上下文中的 {{角色可用宏列表}} 与 {{服装可用宏列表}}。`}
                className="da-card--padded"
            >
                <div className="da-macro-unified-toolbar">
                    <SegmentedControlView
                        size="sm"
                        value={activeMacroRuleKind.value}
                        options={[
                            { label: `角色宏规则 (${sampleCharRules.length})`, value: 'character' },
                            { label: `服装宏规则 (${sampleOutfitRules.length})`, value: 'outfit' },
                        ]}
                        onChange={(val) => {
                            activeMacroRuleKind.value = val as 'character' | 'outfit';
                        }}
                    />

                    <div className="da-macro-unified-toolbar__actions">
                        <ButtonControl
                            label="恢复默认规则"
                            variant="ghost"
                            size="sm"
                            onClick={resetToDefaults}
                        />
                        <ButtonControl
                            label={`+ 新增${isChar ? '角色' : '服装'}宏`}
                            variant="secondary"
                            size="sm"
                            onClick={addRule}
                        />
                    </div>
                </div>

                <div className="da-macro-accordion-list">
                    {customRules.map((rule, idx) => {
                        const ruleId = rule.id || `macro_${kind}_${idx}`;
                        const isExpanded = Boolean(expandedMacroRuleIds.value[ruleId]);
                        const validation = validateMacroKey(rule.name, rule.id, customRules, isChar);
                        const hasError = Boolean(!validation.valid && rule.name.trim().length > 0);
                        const targetSet = new Set(rule.targetParts || []);

                        const togglePart = (partKey: string) => {
                            const nextParts = targetSet.has(partKey)
                                ? rule.targetParts.filter((k) => k !== partKey)
                                : [...rule.targetParts, partKey];
                            updateRule(idx, { ...rule, targetParts: nextParts });
                        };

                        return (
                            <div
                                key={ruleId}
                                className={`da-macro-accordion-item ${isExpanded ? 'is-expanded' : ''} ${hasError ? 'has-error' : ''}`}
                            >
                                <div className="da-macro-accordion-header">
                                    <button
                                        type="button"
                                        className={`da-macro-expand-btn ${isExpanded ? 'is-expanded' : ''}`}
                                        onClick={() => toggleExpand(ruleId)}
                                        title={isExpanded ? '收起部位抽屉' : '展开部位抽屉'}
                                        aria-expanded={isExpanded}
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            width="14"
                                            height="14"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                    </button>

                                    {/* 一体化宏 Key 输入框组 */}
                                    <div className={`da-macro-key-group ${hasError ? 'is-invalid' : ''}`}>
                                        <span className="da-macro-key-prefix">
                                            {isChar ? '$角色-' : '$服装-'}
                                        </span>
                                        <input
                                            type="text"
                                            className="da-macro-key-input"
                                            value={rule.name}
                                            placeholder="closeup"
                                            title={hasError ? validation.error : '输入英文调用名 (a-z0-9_)'}
                                            onInput={(e) => {
                                                const val = (e.currentTarget as HTMLInputElement).value.trim();
                                                updateRule(idx, { ...rule, name: val });
                                            }}
                                        />
                                        <span className="da-macro-key-suffix">$</span>
                                    </div>

                                    {/* 中文功能说明 */}
                                    <div className="da-macro-desc-wrap">
                                        <input
                                            type="text"
                                            className="da-input da-input--sm da-macro-desc-input"
                                            value={rule.description || ''}
                                            placeholder={
                                                isChar
                                                    ? '中文说明 (如: 半身构图，呈现上身、胸型与双手)'
                                                    : '中文说明 (如: 上身穿搭，头饰、上装与配饰)'
                                            }
                                            onInput={(e) => {
                                                const val = (e.currentTarget as HTMLInputElement).value;
                                                updateRule(idx, { ...rule, description: val });
                                            }}
                                        />
                                    </div>

                                    {/* 只读部位计数 Badge */}
                                    <span
                                        className="da-badge da-badge--subtle"
                                        title="当前包含部位数量"
                                    >
                                        {rule.targetParts.length} 部位
                                    </span>

                                    <button
                                        type="button"
                                        className="da-btn da-btn--ghost da-btn--danger da-btn--sm da-macro-delete-btn"
                                        title={`删除此${isChar ? '角色' : '服装'}宏`}
                                        onClick={() => deleteRule(idx)}
                                        dangerouslySetInnerHTML={{ __html: ICONS.trash }}
                                    />
                                </div>

                                {hasError && (
                                    <div className="da-macro-validation-error">
                                        <span>{validation.error}</span>
                                    </div>
                                )}

                                {isExpanded && (
                                    <div className="da-macro-accordion-body">
                                        <div className="da-macro-part-group">
                                            <span className="da-macro-part-group__label">
                                                绘画标签 ({partDefs.length}):
                                            </span>
                                            <div className="da-macro-part-chips">
                                                {partDefs.map((def) => {
                                                    const isChecked = targetSet.has(def.key);
                                                    return (
                                                        <button
                                                            key={def.key}
                                                            type="button"
                                                            className={`da-macro-part-chip ${isChecked ? 'is-active' : ''}`}
                                                            onClick={() => togglePart(def.key)}
                                                            title={`${def.label} (${def.key}) - ${def.hint}`}
                                                        >
                                                            {def.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardView>
        );
    };

    return (
        <div className="da-material-subpanel">
            <PresetToolbarView
                presets={formatController.toolbarItems.value}
                activePresetId={formatController.activePresetId.value}
                dirty={formatController.isDirty.value}
                onAction={(action, id) => formatController.handleAction(action, id)}
                onImportFile={(file) => formatController.handleImportFile(file)}
            />

            {/* 卡片 1: 独立实时渲染效果预览 (优先预览) */}
            <CardView
                title="实时渲染效果预览"
                subtitle="模板注入效果实时预览"
                tooltip={`模拟提示词最终生成时的实际单行与列表展开效果。\n各列分别对应 {{角色启用列表}}、{{服装启用列表}}、{{角色可用宏列表}} 与 {{服装可用宏列表}}。`}
                className="da-card--padded"
            >
                <div className="da-format-preview-grid">
                    <div className="da-format-preview-col">
                        <div className="da-format-preview-col__header">
                            <span className="da-format-preview-col__title">角色单行效果</span>
                            <BadgeView text="{{角色启用列表}}" variant="info" />
                        </div>
                        <div className="da-format-preview-col__content">
                            {renderCharPreview(fmt.characterTemplate)}
                        </div>
                    </div>

                    <div className="da-format-preview-col">
                        <div className="da-format-preview-col__header">
                            <span className="da-format-preview-col__title">服装单行效果</span>
                            <BadgeView text="{{服装启用列表}}" variant="neutral" />
                        </div>
                        <div className="da-format-preview-col__content">
                            {renderOutfitPreview(fmt.outfitTemplate)}
                        </div>
                    </div>

                    <div className="da-format-preview-col">
                        <div className="da-format-preview-col__header">
                            <span className="da-format-preview-col__title">角色可用宏列表预览</span>
                            <BadgeView text="{{角色可用宏列表}}" variant="info" />
                        </div>
                        <div className="da-format-preview-col__content da-format-preview-col__content--macros">
                            {renderMacrosPreview(sampleCharRules, fmt.macroTemplate)}
                        </div>
                    </div>

                    <div className="da-format-preview-col">
                        <div className="da-format-preview-col__header">
                            <span className="da-format-preview-col__title">服装可用宏列表预览</span>
                            <BadgeView text="{{服装可用宏列表}}" variant="neutral" />
                        </div>
                        <div className="da-format-preview-col__content da-format-preview-col__content--macros">
                            {renderMacrosPreview(sampleOutfitRules, fmt.macroTemplate)}
                        </div>
                    </div>
                </div>
            </CardView>

            {/* 卡片 2: 行模板变量管理 */}
            <CardView
                title="行模板变量管理"
                subtitle="素材单行格式与宏说明模板配置"
                tooltip={`定制素材数据注入到酒馆上下文时的文本格式与占位变量：\n- 角色行模板：聚合生成 {{角色启用列表}}，支持 {{name}}、{{aliases}}、{{description}} 与 {{outfits}}；\n- 服装行模板：聚合生成 {{服装启用列表}}，支持专属服装缩进与通用服装展示；\n- 宏说明模板：聚合生成 {{角色可用宏列表}} 与 {{服装可用宏列表}}，告知大语言模型每个宏的触发场景。\n支持点击下方「展开可用变量」在光标处插入属性占位符。`}
                className="da-card--padded"
            >
                <div className="da-macro-unified-toolbar">
                    <SegmentedControlView
                        size="sm"
                        value={activeTemplateKind.value}
                        options={[
                            { label: '角色展现模板', value: 'character' },
                            { label: '服装展现模板', value: 'outfit' },
                            { label: '宏说明模板', value: 'macro' },
                        ]}
                        onChange={(val) => {
                            activeTemplateKind.value = val as 'character' | 'outfit' | 'macro';
                        }}
                    />

                    <div className="da-macro-unified-toolbar__actions">
                        <ButtonControl
                            label="恢复默认模板"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                const kind = activeTemplateKind.value;
                                if (kind === 'character') {
                                    updateFormatConfig({
                                        characterTemplate: DEFAULT_FORMAT_TEMPLATES.characterTemplate,
                                    });
                                } else if (kind === 'outfit') {
                                    updateFormatConfig({
                                        outfitTemplate: DEFAULT_FORMAT_TEMPLATES.outfitTemplate,
                                    });
                                } else {
                                    updateFormatConfig({
                                        macroTemplate: DEFAULT_FORMAT_TEMPLATES.macroTemplate,
                                    });
                                }
                                Toast.show('已恢复默认单行模板', { level: 'info' });
                            }}
                        />
                    </div>
                </div>

                <div className="da-format-templates-body">
                    {(
                        [
                            {
                                kind: 'character' as const,
                                textareaId: 'da-format-char-textarea',
                                textareaCls: 'da-format-char-textarea',
                                value: fmt.characterTemplate,
                                placeholder: '例如: - 角色: {{name}} (别名: {{aliases}})',
                                updateValue: (v: string) => updateFormatConfig({ characterTemplate: v }),
                                groups: [
                                    { hint: '基本属性:', vars: CHAR_BASE_VARS, isPart: false },
                                    { hint: '绘画标签:', vars: CHAR_PART_VARS, isPart: true },
                                ],
                                totalVars: CHAR_BASE_VARS.length + CHAR_PART_VARS.length,
                            },
                            {
                                kind: 'outfit' as const,
                                textareaId: 'da-format-outfit-textarea',
                                textareaCls: 'da-format-outfit-textarea',
                                value: fmt.outfitTemplate,
                                placeholder: '例如: - 服装: {{name}} (别名: {{aliases}})',
                                updateValue: (v: string) => updateFormatConfig({ outfitTemplate: v }),
                                groups: [
                                    { hint: '基本属性:', vars: OUTFIT_BASE_VARS, isPart: false },
                                    { hint: '绘画标签:', vars: OUTFIT_PART_VARS, isPart: true },
                                ],
                                totalVars: OUTFIT_BASE_VARS.length + OUTFIT_PART_VARS.length,
                            },
                            {
                                kind: 'macro' as const,
                                textareaId: 'da-format-macro-textarea',
                                textareaCls: 'da-format-macro-textarea',
                                value: fmt.macroTemplate || DEFAULT_FORMAT_TEMPLATES.macroTemplate,
                                placeholder: '例如: - {{macro}}: {{description}}',
                                updateValue: (v: string) => updateFormatConfig({ macroTemplate: v }),
                                groups: [
                                    {
                                        hint: '基础信息:',
                                        vars: [
                                            { key: 'macro', label: '宏指令' },
                                            { key: 'description', label: '功能说明' },
                                            { key: 'parts', label: '展开部位' },
                                        ],
                                        isPart: false,
                                    },
                                ],
                                totalVars: 3,
                            },
                        ] as const
                    )
                        .filter((cfg) => cfg.kind === activeTemplateKind.value)
                        .map((cfg) => (
                            <div key={cfg.kind} className="da-format-template-section">
                                <div className="da-format-editor-box">
                                    <textarea
                                        id={cfg.textareaId}
                                        className={`da-textarea da-format-editor-textarea ${cfg.textareaCls}`}
                                        rows={2}
                                        value={cfg.value}
                                        placeholder={cfg.placeholder}
                                        onInput={(e) =>
                                            cfg.updateValue((e.currentTarget as HTMLTextAreaElement).value)
                                        }
                                    />
                                    {isVariablesDrawerOpen.value && (
                                        <div className="da-format-editor-drawer">
                                            {cfg.groups.map((grp) => (
                                                <div key={grp.hint} className="da-format-var-bar">
                                                    <span className="da-format-var-bar__hint">{grp.hint}</span>
                                                    {grp.vars.map((item) => (
                                                        <button
                                                            key={item.key}
                                                            type="button"
                                                            className={`da-format-pill-btn${grp.isPart ? ' da-format-pill-btn--part' : ''}`}
                                                            title={`点击在光标处插入 {{${item.key}}}`}
                                                            onClick={() =>
                                                                insertVar(cfg.textareaId, item.key, cfg.updateValue)
                                                            }
                                                        >
                                                            + {`{{${item.key}}}`}{' '}
                                                            <span className="da-format-pill-btn__label">{item.label}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="da-format-editor-footer">
                                        <button
                                            type="button"
                                            className="da-format-var-toggle-btn"
                                            onClick={() => {
                                                isVariablesDrawerOpen.value = !isVariablesDrawerOpen.value;
                                            }}
                                            title={isVariablesDrawerOpen.value ? '收起变量库' : '展开可用变量库'}
                                        >
                                            <span className="da-format-var-toggle-btn__text">
                                                {isVariablesDrawerOpen.value ? '收起可用变量 ▴' : '展开可用变量 ▾'}
                                            </span>
                                            <span className="da-format-var-toggle-btn__count">
                                                ({cfg.totalVars})
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                </div>
            </CardView>

            {/* 卡片 3: 生图宏规则配置 */}
            {renderUnifiedMacroRulesCard()}
        </div>
    );
}
