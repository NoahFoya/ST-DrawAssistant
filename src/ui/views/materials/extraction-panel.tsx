/**
 * 素材库 - 解析设置子面板。
 */

import type { VNode } from 'preact';
import type { Signal } from '@preact/signals';
import type {
    CharacterPresetData,
    OutfitPresetData,
    MaterialExtractionPresetData,
    CharacterExtractionConfig,
} from '@types';
import {
    CardView,
    FormFieldView,
    SwitchControl,
    PresetToolbarView,
    ButtonControl,
    BadgeView,
} from '../../framework';
import type { PresetController } from '../../viewmodels';
import {
    extractArchivesFromText,
    DEFAULT_EXTRACTION_CONFIG,
} from '../../../pipeline/archive-extractor';
import { openArchiveConfirmModal } from '../../modal/archive-confirm-modal';
import { DEFAULT_SANDBOX_SAMPLE } from './material-types';

export interface ExtractionPanelProps {
    extractionController: PresetController<MaterialExtractionPresetData>;
    charController: PresetController<CharacterPresetData>;
    outfitController: PresetController<OutfitPresetData>;
    sandboxText: Signal<string>;
    onArchivesApplied?: () => void;
}

export function ExtractionPanel(props: ExtractionPanelProps): VNode {
    const {
        extractionController,
        charController,
        outfitController,
        sandboxText,
        onArchivesApplied,
    } = props;

    const ext = {
        ...DEFAULT_EXTRACTION_CONFIG,
        ...(extractionController.draftConfig.value || {}),
    };
    const previewItems = extractArchivesFromText(sandboxText.value, ext);

    const updateExtractionConfig = (patch: Partial<CharacterExtractionConfig>) => {
        extractionController.patchDraft(patch);
    };

    return (
        <div className="da-material-subpanel">
            <PresetToolbarView
                presets={extractionController.toolbarItems.value}
                activePresetId={extractionController.activePresetId.value}
                dirty={extractionController.isDirty.value}
                onAction={(action, id) => extractionController.handleAction(action, id)}
                onImportFile={(file) => extractionController.handleImportFile(file)}
            />

            {/* 卡片 1: 楼层档案提取设置 */}
            <CardView
                title="楼层档案提取设置"
                subtitle="角色与服装档案正文提取规则"
                tooltip={`从酒馆会话消息中自动捕获与识别 <角色> 与 <服装> 档案数据块：\n- 智能解析起止标记与内部键值对（如 NAME、ALIASES、外观及身体部位标签）；\n- 支持弹窗预览并一键收录至本地素材库，实现开箱即用的自动化档案收录与同步。`}
                className="da-card--padded"
            >
                <FormFieldView
                    label="启用楼层档案提取"
                    tooltip="开启后，扩展将对酒馆对话消息进行扫描，识别其中符合规范的角色与服装档案标记块；关闭后停止扫描楼层正文。"
                    width="w-toggle"
                >
                    <SwitchControl
                        value={ext.enabled !== false}
                        onChange={(checked) =>
                            updateExtractionConfig({ enabled: checked })
                        }
                    />
                </FormFieldView>

                <FormFieldView
                    label="AI 回复后自动检测并弹窗确认"
                    tooltip="开启后，当 AI 回复中包含符合正则规范的 <角色> 或 <服装> 档案数据块时，立即弹出确认对话框，支持一键将新角色/新服装录入本地素材库或增量更新已有档案。"
                    width="w-toggle"
                >
                    <SwitchControl
                        value={ext.autoDetect !== false}
                        onChange={(checked) =>
                            updateExtractionConfig({ autoDetect: checked })
                        }
                    />
                </FormFieldView>

                <FormFieldView
                    label="折叠楼层原始文本"
                    tooltip="开启后，楼层正文中被成功解析的档案原始数据块将被自动折叠收纳为微型胶囊徽章，避免冗长的原始文本影响正文沉浸式阅读。"
                    width="w-toggle"
                >
                    <SwitchControl
                        value={ext.collapseInFloor !== false}
                        onChange={(checked) =>
                            updateExtractionConfig({ collapseInFloor: checked })
                        }
                    />
                </FormFieldView>

                <FormFieldView
                    label="角色档案起止标记"
                    tooltip="定义在 AI 回复中识别角色档案数据块的成对标记（默认 <角色> 与 </角色>）。"
                    width="auto"
                >
                    <div className="da-tag-affix-group">
                        <div className="da-tag-affix-item">
                            <span className="da-tag-affix-label">起始标记</span>
                            <input
                                type="text"
                                className="da-input da-input--sm da-tag-affix-input"
                                value={ext.charStartTag}
                                placeholder="<角色>"
                                onInput={(e) =>
                                    updateExtractionConfig({
                                        charStartTag: (e.currentTarget as HTMLInputElement).value,
                                    })
                                }
                            />
                        </div>
                        <div className="da-tag-affix-item">
                            <span className="da-tag-affix-label">结束标记</span>
                            <input
                                type="text"
                                className="da-input da-input--sm da-tag-affix-input"
                                value={ext.charEndTag}
                                placeholder="</角色>"
                                onInput={(e) =>
                                    updateExtractionConfig({
                                        charEndTag: (e.currentTarget as HTMLInputElement).value,
                                    })
                                }
                            />
                        </div>
                    </div>
                </FormFieldView>

                <FormFieldView
                    label="服装档案起止标记"
                    tooltip="定义在 AI 回复中识别服装档案数据块的成对标记（默认 <服装> 与 </服装>）。"
                    width="auto"
                >
                    <div className="da-tag-affix-group">
                        <div className="da-tag-affix-item">
                            <span className="da-tag-affix-label">起始标记</span>
                            <input
                                type="text"
                                className="da-input da-input--sm da-tag-affix-input"
                                value={ext.outfitStartTag}
                                placeholder="<服装>"
                                onInput={(e) =>
                                    updateExtractionConfig({
                                        outfitStartTag: (e.currentTarget as HTMLInputElement).value,
                                    })
                                }
                            />
                        </div>
                        <div className="da-tag-affix-item">
                            <span className="da-tag-affix-label">结束标记</span>
                            <input
                                type="text"
                                className="da-input da-input--sm da-tag-affix-input"
                                value={ext.outfitEndTag}
                                placeholder="</服装>"
                                onInput={(e) =>
                                    updateExtractionConfig({
                                        outfitEndTag: (e.currentTarget as HTMLInputElement).value,
                                    })
                                }
                            />
                        </div>
                    </div>
                </FormFieldView>
            </CardView>

            {/* 卡片 2: 提取测试沙盒 */}
            <CardView
                title="提取测试沙盒"
                subtitle="档案提取与部位拆解实时测试"
                tooltip={`可在此处输入或粘贴包含 <角色> 与 <服装> 标签的酒馆 AI 回复文本，实时校验正文正则提取与部位拆解是否符合预期。`}
                className="da-card--padded"
                actions={
                    <div className="da-sandbox-actions">
                        <ButtonControl
                            label="载入示例"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                sandboxText.value = DEFAULT_SANDBOX_SAMPLE;
                            }}
                        />
                        <ButtonControl
                            label="清空"
                            variant="ghost"
                            size="sm"
                            disabled={!sandboxText.value}
                            onClick={() => {
                                sandboxText.value = '';
                            }}
                        />
                        <ButtonControl
                            label="测试导入"
                            variant="secondary"
                            size="sm"
                            disabled={previewItems.length === 0}
                            onClick={() => {
                                openArchiveConfirmModal({
                                    items: previewItems,
                                    onConfirmed: () => {
                                        charController.reloadFromStore();
                                        outfitController.reloadFromStore();
                                        onArchivesApplied?.();
                                    },
                                });
                            }}
                        />
                    </div>
                }
            >
                <textarea
                    className="da-textarea da-sandbox-textarea"
                    rows={4}
                    value={sandboxText.value}
                    placeholder="粘贴包含 <角色> 或 <服装> 档案块的 AI 回复文本进行实时提取测试..."
                    onInput={(e) => {
                        sandboxText.value = (
                            e.currentTarget as HTMLTextAreaElement
                        ).value;
                    }}
                />

                <div className="da-sandbox-preview">
                    {previewItems.length === 0 ? (
                        <div className="da-empty-hint da-empty-hint--compact">
                            未匹配到有效档案块（需包含起止符以及 NAME 名称行）
                        </div>
                    ) : (
                        previewItems.map((item, i) => {
                            const isCharItem = item.kind === 'character';
                            const nonEmpties = Object.entries(item.parts).filter(
                                ([, v]) => Boolean(v?.trim())
                            );
                            const partSummary = nonEmpties
                                .map(([k, val]) => `${k}: ${val}`)
                                .join(' | ');

                            return (
                                <div key={i} className="da-sandbox-item">
                                    <div className="da-sandbox-item__header">
                                        <BadgeView
                                            text={isCharItem ? '角色档案' : '服装档案'}
                                            variant={isCharItem ? 'info' : 'neutral'}
                                        />
                                        <span className="da-sandbox-item__name">
                                            {item.name}
                                        </span>
                                        {item.aliases && (
                                            <span className="da-sandbox-item__aliases">
                                                ({item.aliases})
                                            </span>
                                        )}
                                        <span className="da-badge da-badge--subtle">
                                            {nonEmpties.length} 个部位
                                        </span>
                                    </div>
                                    <div className="da-sandbox-item__body">
                                        {item.trigger && (
                                            <div className="da-sandbox-item__line">
                                                <span className="da-sandbox-item__label">触发词:</span>
                                                <span>{item.trigger}</span>
                                            </div>
                                        )}
                                        {item.baseTrait && (
                                            <div className="da-sandbox-item__line">
                                                <span className="da-sandbox-item__label">
                                                    {isCharItem ? '体貌特征:' : '服饰风格:'}
                                                </span>
                                                <span>{item.baseTrait}</span>
                                            </div>
                                        )}
                                        {partSummary && (
                                            <div className="da-sandbox-item__line">
                                                <span className="da-sandbox-item__label">部位标签:</span>
                                                <span>{partSummary}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </CardView>
        </div>
    );
}
