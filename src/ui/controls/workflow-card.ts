/**
 * @module ui/controls/workflow-card
 * @description 标准化工作流预设卡片控件与宏变量诊断工具 (Workflow Preset Card Control)
 */

import { PresetProfileItem, WorkflowProfileData, getMacroVariables } from '../../core';
import { createCard, createCardHeader, createRow, createFieldLabel } from '../layout/container-factory';
import { createTextarea, TextareaHandle } from './input-controls';
import { bindPresetToolbar, PresetToolbarElement } from './preset-toolbar';
import { openBlueprintModal } from '../layout/blueprint-modal';
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
export function openWorkflowFormatModal(
    rawJson: string,
    onApply: (formattedJson: string) => void,
    onOpenBlueprint?: (jsonToEdit: string) => void
): void {
    const analysis = analyzeAndReplaceWorkflowVariables(rawJson);

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';

    const modal = document.createElement('div');
    modal.className = 'da-dialog-panel da-workflow-format-modal';
    modal.style.maxWidth = '680px';
    modal.style.width = '92vw';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'da-dialog-title';
    title.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 工作流变量分析与格式化诊断';

    const message = document.createElement('div');
    message.className = 'da-dialog-message da-workflow-format-body';

    if (!analysis.success) {
        message.innerHTML = `<div class="da-text-danger">${analysis.error}</div>`;
    } else {
        const repCount = analysis.replaced.length;
        const unrepCount = analysis.unmatched.length;

        let html = `
            <div class="da-workflow-format-summary">
                扫描完成：共识别并自动绑定 <strong>${repCount}</strong> 处宏变量，另有 <strong>${unrepCount}</strong> 项宏变量未自动匹配。
            </div>
        `;

        if (repCount > 0) {
            html += `
                <div class="da-workflow-format-section">
                    <div class="da-workflow-format-section-title success">
                        <i class="fa-solid fa-circle-check"></i> 已成功自动匹配替换 (${repCount})
                    </div>
                    <div class="da-workflow-var-list">
            `;
            analysis.replaced.forEach((r) => {
                html += `
                    <div class="da-workflow-var-item matched">
                        <span class="da-macro-tag">${r.variable}</span>
                        <span class="da-workflow-var-target">➔ 节点 #${r.nodeId} (<code>${r.classType}.${r.field}</code>)</span>
                    </div>
                `;
            });
            html += `</div></div>`;
        }

        if (unrepCount > 0) {
            html += `
                <div class="da-workflow-format-section">
                    <div class="da-workflow-format-section-title warning">
                        <i class="fa-solid fa-circle-exclamation"></i> 未自动匹配到的宏变量 (${unrepCount})
                    </div>
                    <div class="da-workflow-var-list">
            `;
            analysis.unmatched.forEach((u) => {
                html += `
                    <div class="da-workflow-var-item unmatched">
                        <span class="da-macro-tag warning">${u.variable}</span>
                        <span class="da-workflow-var-label">${u.label}</span>
                        <span class="da-workflow-var-tip">${u.tip || '如需生效，请在蓝图编辑器中指定节点绑定此变量'}</span>
                    </div>
                `;
            });
            html += `</div></div>`;
        }

        message.innerHTML = html;
    }

    const actions = document.createElement('div');
    actions.className = 'da-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn da-btn--secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => backdrop.remove();

    if (onOpenBlueprint && analysis.success) {
        const bpBtn = document.createElement('button');
        bpBtn.className = 'da-btn da-btn--secondary';
        bpBtn.innerHTML = '<i class="fa-solid fa-diagram-project"></i> 打开蓝图手动配置';
        bpBtn.onclick = () => {
            backdrop.remove();
            onOpenBlueprint(analysis.formattedJson);
        };
        actions.appendChild(bpBtn);
    }

    const applyBtn = document.createElement('button');
    applyBtn.className = 'da-btn da-btn--primary';
    applyBtn.innerHTML = '<i class="fa-solid fa-check"></i> 应用变量替换';
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
    /** 是否可折叠 */
    collapsible?: boolean;
    /** 默认是否展开（collapsible 为 true 时生效，缺省为 true） */
    defaultOpen?: boolean;
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
    onRefresh: () => void;
}

export interface WorkflowPresetCardHandle extends HTMLElement {
    readonly toolbar: PresetToolbarElement;
    readonly inputHandle: TextareaHandle;
    refresh: () => void;
}

/**
 * 创建标准化工作流预设卡片控件
 */
export function createWorkflowPresetCard(options: WorkflowPresetCardOptions): WorkflowPresetCardHandle {
    let toolbarEl: PresetToolbarElement;
    let inputHandleEl: TextareaHandle;

    const card = createCard({ hoverable: true });
    const header = createCardHeader({
        title: options.title,
        description: options.description
    });
    card.header.appendChild(header);

    // 可折叠支持（与 FormRenderer.renderCard 保持一致的行为）
    if (options.collapsible) {
        const isInitiallyOpen = options.defaultOpen !== false;
        card.header.classList.add('da-card__header--collapsible');
        card.root.classList.toggle('da-card--collapsed', !isInitiallyOpen);
        if (!isInitiallyOpen) {
            card.body.style.display = 'none';
        }
        card.header.addEventListener('click', () => {
            const isCollapsed = card.root.classList.toggle('da-card--collapsed');
            card.body.style.display = isCollapsed ? 'none' : '';
        });
    }

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
    card.body.appendChild(toolbarEl);

    // ── JSON 标题与操作栏 (左侧标题 + 右侧操作按钮组) ──
    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'da-flex-center-row da-gap-sm';

    const formatBtn = document.createElement('button');
    formatBtn.type = 'button';
    formatBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    formatBtn.textContent = '格式化变量';
    formatBtn.onclick = () => {
        const currentJson = options.getCurrentJson();
        openWorkflowFormatModal(
            currentJson,
            (updatedStr) => {
                options.onJsonChange(updatedStr);
                options.onRefresh();
            },
            (jsonToEdit) => {
                options.onJsonChange(jsonToEdit);
                openBlueprintModal(
                    jsonToEdit,
                    (bpJson) => {
                        options.onJsonChange(bpJson);
                        options.onRefresh();
                    },
                    options.blueprintMode
                );
            }
        );
    };

    const openBlueprintBtn = document.createElement('button');
    openBlueprintBtn.type = 'button';
    openBlueprintBtn.className = 'da-btn da-btn--secondary da-btn--sm';
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

    const titleRow = createRow(['left', 'right'], { align: 'center', divided: true });
    const label = createFieldLabel({
        title: options.fieldLabel,
        helpTooltip: options.helpTooltip
    });
    titleRow.slots[0].appendChild(label);
    titleRow.slots[1].appendChild(actionsWrapper);
    card.body.appendChild(titleRow.root);

    // ── JSON 代码编辑行 (全宽) ──
    const textareaRow = createRow(['full'], { divided: true });
    inputHandleEl = createTextarea({
        rows: 6,
        value: options.getCurrentJson(),
        placeholder: options.placeholder || '{\n  "3": {\n    "class_type": "KSampler",\n    ...\n  }\n}',
        onChange: (val) => {
            options.onJsonChange(val);
        }
    });
    textareaRow.slots[0].appendChild(inputHandleEl);
    card.body.appendChild(textareaRow.root);

    const handle = Object.assign(card.root, {
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
