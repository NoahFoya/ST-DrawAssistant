/**
 * @module ui/presets/workflow-card
 * @description 标准化工作流预设卡片控件与宏变量诊断工具 (Workflow & Preset Domain)
 */

import { PresetProfileItem, WorkflowProfileData } from '../../core/state/store-types';
import { createSectionCard, createInputRow, InputControlHandle } from '../controls';
import { bindPresetToolbar, PresetToolbarElement } from './preset-manager';
import { openBlueprintModal } from './blueprint-modal';
import { getMacroVariables } from '../../core/config/config-loader';
import { FeedbackService } from '../feedback/feedback';

export interface VariableReplacementInfo {
    variable: string;
    nodeId: string;
    classType: string;
    field: string;
    prevValue: unknown;
}

export interface UnmatchedVariableInfo {
    variable: string;
    label: string;
    tip: string;
}

export interface WorkflowAnalysisResult {
    success: boolean;
    error?: string;
    formattedJson: string;
    replaced: VariableReplacementInfo[];
    unmatched: UnmatchedVariableInfo[];
}

/**
 * 递归深度扫描并分析 ComfyUI 工作流 JSON，自动匹配替换标准宏变量占位符
 */
export function analyzeAndReplaceWorkflowVariables(jsonStr: string): WorkflowAnalysisResult {
    let parsed: Record<string, any>;
    try {
        parsed = JSON.parse(jsonStr.trim());
    } catch (err: any) {
        return {
            success: false,
            error: `JSON 语法解析错误: ${err?.message || err}`,
            formattedJson: jsonStr,
            replaced: [],
            unmatched: []
        };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            success: false,
            error: '无效的工作流数据：根节点必须为包含节点 ID 的 Object 结构',
            formattedJson: jsonStr,
            replaced: [],
            unmatched: []
        };
    }

    if (parsed.data?.json && typeof parsed.data.json === 'string') {
        try {
            parsed = JSON.parse(parsed.data.json);
        } catch {}
    } else if (parsed.json && typeof parsed.json === 'string') {
        try {
            parsed = JSON.parse(parsed.json);
        } catch {}
    }

    const macroDict = getMacroVariables();
    const replaced: VariableReplacementInfo[] = [];
    const matchedVars = new Set<string>();

    for (const [nodeId, node] of Object.entries(parsed)) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        const classType = node.class_type || node._meta?.title || 'Unknown';
        const inputs = node.inputs;

        for (const [field, val] of Object.entries(inputs)) {
            if (Array.isArray(val)) continue;

            for (const item of macroDict) {
                if (matchedVars.has(item.variable)) continue;

                const isMatch = item.matchKeys.some((k: string) => field.toLowerCase() === k.toLowerCase());
                if (isMatch) {
                    inputs[field] = item.variable;
                    replaced.push({
                        variable: item.variable,
                        nodeId,
                        classType,
                        field,
                        prevValue: val
                    });
                    matchedVars.add(item.variable);
                    break;
                }
            }
        }
    }

    const unmatched: UnmatchedVariableInfo[] = [];
    for (const item of macroDict) {
        if (!matchedVars.has(item.variable)) {
            unmatched.push({
                variable: item.variable,
                label: item.label,
                tip: item.tip
            });
        }
    }

    return {
        success: true,
        formattedJson: JSON.stringify(parsed, null, 2),
        replaced,
        unmatched
    };
}

/**
 * 弹出工作流变量诊断与格式化模态框
 */
export function openWorkflowFormatModal(rawJson: string, onApply: (formattedJson: string) => void): void {
    const analysis = analyzeAndReplaceWorkflowVariables(rawJson);

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';

    const modal = document.createElement('div');
    modal.className = 'da-dialog-panel da-main-modal-inner';
    modal.style.maxWidth = '640px';
    modal.style.width = '90vw';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'da-dialog-title';
    title.textContent = '工作流变量分析与格式化诊断';

    const message = document.createElement('div');
    message.className = 'da-dialog-message';

    if (!analysis.success) {
        message.innerHTML = `<div class="da-text-danger">${analysis.error}</div>`;
    } else {
        const repCount = analysis.replaced.length;
        const unrepCount = analysis.unmatched.length;

        let summaryHtml = `<div style="margin-bottom: 12px;">自动扫描完成：成功匹配并替换 <strong>${repCount}</strong> 处宏变量占位符，有 <strong>${unrepCount}</strong> 项可选宏未在工作流中发现。</div>`;

        if (repCount > 0) {
            summaryHtml += '<div style="margin-bottom: 8px; font-weight: 600; color: var(--da-accent-color);">已自动匹配替换项：</div>';
            summaryHtml += '<ul style="margin: 0 0 12px 20px; font-size: 0.88em; color: var(--da-text-secondary); max-height: 120px; overflow-y: auto;">';
            analysis.replaced.forEach((r) => {
                summaryHtml += `<li><code>${r.variable}</code> → 节点 #${r.nodeId} (${r.classType}.${r.field})</li>`;
            });
            summaryHtml += '</ul>';
        }

        message.innerHTML = summaryHtml;
    }

    const actions = document.createElement('div');
    actions.className = 'da-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => backdrop.remove();

    const applyBtn = document.createElement('button');
    applyBtn.className = 'da-btn primary';
    applyBtn.textContent = '应用格式化与替换';
    applyBtn.disabled = !analysis.success;
    applyBtn.onclick = () => {
        onApply(analysis.formattedJson);
        backdrop.remove();
        FeedbackService.toastSuccess('工作流已成功完成变量替换与格式化！');
    };

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);

    modal.appendChild(title);
    modal.appendChild(message);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
}

/**
 * 工作流预设卡片配置项
 */
export interface WorkflowPresetCardOptions {
    title: string;
    description: string;
    label: string;
    blueprintMode: 'txt2img' | 'inpaint';
    fieldLabel: string;
    helpTooltip: string;
    placeholder?: string;
    getProfiles: () => PresetProfileItem<WorkflowProfileData>[];
    getCurrentProfileId: () => string;
    getCurrentJson: () => string;
    onProfilesChange: (profiles: PresetProfileItem<WorkflowProfileData>[], activeId: string) => void;
    onJsonChange: (json: string) => void;
    fetchDefaults: () => Promise<PresetProfileItem<WorkflowProfileData>[]>;
    onRefresh: () => void;
}

export interface WorkflowPresetCardHandle extends HTMLElement {
    readonly toolbar: PresetToolbarElement;
    readonly inputHandle: InputControlHandle;
    refresh: () => void;
}

/**
 * 创建标准化工作流预设卡片控件
 */
export function createWorkflowPresetCard(options: WorkflowPresetCardOptions): WorkflowPresetCardHandle {
    let toolbarEl: PresetToolbarElement;
    let inputHandleEl: InputControlHandle;

    const card = createSectionCard({
        title: options.title,
        description: options.description,
        renderBody: (body: HTMLElement) => {
            toolbarEl = bindPresetToolbar({
                adapter: {
                    label: options.label,
                    getProfiles: () =>
                        options.getProfiles().map((p) => ({
                            id: p.id,
                            name: p.name,
                            data: p.data
                        })),
                    getInitialId: () => options.getCurrentProfileId(),
                    createProfile: (name, data: WorkflowProfileData) => {
                        const id = `${options.blueprintMode}_wf_${Date.now()}`;
                        const current = options.getProfiles();
                        const next = [...current, { id, name, data }];
                        options.onProfilesChange(next, id);
                        return id;
                    },
                    saveProfile: (id, data: WorkflowProfileData) => {
                        const current = options.getProfiles();
                        const next = current.map((p) => (p.id === id ? { ...p, data } : p));
                        options.onProfilesChange(next, id);
                    },
                    renameProfile: (id, newName) => {
                        const current = options.getProfiles();
                        const next = current.map((p) => (p.id === id ? { ...p, name: newName } : p));
                        options.onProfilesChange(next, id);
                    },
                    deleteProfile: (id) => {
                        const current = options.getProfiles();
                        const next = current.filter((p) => p.id !== id);
                        const fallbackId = next[0]?.id || '';
                        options.onProfilesChange(next, fallbackId);
                        return fallbackId;
                    },
                    resetToDefault: async () => {
                        try {
                            const defaults = await options.fetchDefaults();
                            options.onProfilesChange(defaults, defaults[0]?.id || '');
                        } catch {
                            options.onProfilesChange([], '');
                        }
                    }
                },
                getCurrentData: () => ({
                    json: options.getCurrentJson()
                }),
                onApplied: (profile) => {
                    if (profile?.data?.json) {
                        options.onJsonChange(profile.data.json);
                        options.onRefresh();
                    }
                }
            });
            body.appendChild(toolbarEl);

            const actionsWrapper = document.createElement('div');
            actionsWrapper.className = 'da-flex-center-row';

            const formatBtn = document.createElement('button');
            formatBtn.className = 'da-btn secondary da-btn-sm';
            formatBtn.textContent = '格式化变量';
            formatBtn.onclick = () => {
                const currentJson = options.getCurrentJson();
                openWorkflowFormatModal(currentJson, (updatedStr) => {
                    options.onJsonChange(updatedStr);
                    options.onRefresh();
                });
            };

            const openBlueprintBtn = document.createElement('button');
            openBlueprintBtn.className = 'da-btn secondary da-btn-sm';
            openBlueprintBtn.textContent = '蓝图编辑器';
            openBlueprintBtn.onclick = () => {
                const currentJson = options.getCurrentJson();
                openBlueprintModal(
                    currentJson,
                    (updatedJson: string) => {
                        options.onJsonChange(updatedJson);
                        options.onRefresh();
                    },
                    options.blueprintMode
                );
            };

            actionsWrapper.appendChild(formatBtn);
            actionsWrapper.appendChild(openBlueprintBtn);

            inputHandleEl = createInputRow({
                label: options.fieldLabel,
                helpTooltip: options.helpTooltip,
                type: 'textarea',
                rows: 6,
                value: options.getCurrentJson(),
                placeholder: options.placeholder || '{\n  "3": {\n    "class_type": "KSampler",\n    ...\n  }\n}',
                headerAction: actionsWrapper,
                onChange: (val) => {
                    options.onJsonChange(val);
                }
            });

            body.appendChild(inputHandleEl);
        }
    });

    const handle = Object.assign(card, {
        toolbar: toolbarEl!,
        inputHandle: inputHandleEl!,
        refresh: () => {
            if (inputHandleEl) {
                inputHandleEl.setValue(options.getCurrentJson());
            }
        }
    });

    return handle as WorkflowPresetCardHandle;
}
