/**
 * 标准化工作流预设卡片控件与变量诊断工具 (Workflow Preset Card Control)
 * 提供 ComfyUI 工作流卡片展示、变量占位符扫描与实时诊断
 */

import { IDisposable } from '../../types';
import {
    createCard,
    createCardHeader,
    createRow,
    createFieldLabel
} from '../layout/container-factory';
import { createTextarea, TextareaHandle } from './input-controls';
import { bindPresetToolbar, PresetToolbarElement, createPresetStoreAdapter } from './preset-toolbar';
import { ModalService } from '../layout/modal-service';
import { FeedbackService } from '../feedback/feedback';
import { escapeHtml } from '../foundation/utils';
import { Logger } from '../../utils';

const logger = new Logger('WorkflowCard');

export interface WorkflowProfileData {
    json: string;
}

export interface PresetProfileItem<T = unknown> {
    id: string;
    name: string;
    data?: T;
}

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

/** ComfyUI 标准变量占位符定义字典 */
export const COMFYUI_VARIABLE_DEFINITIONS = [
    {
        variable: '%model_name%',
        label: '主模型',
        matchKeys: ['ckpt_name', 'unet_name', 'model_name'],
        tip: '主模型文件名 (通常位于 CheckpointLoaderSimple 或 UNETLoader 节点)'
    },
    {
        variable: '%clip_name%',
        label: 'CLIP 模型',
        matchKeys: ['clip_name'],
        tip: 'CLIP 文本特征提取模型 (通常位于 CLIPLoader 节点)'
    },
    {
        variable: '%vae_name%',
        label: 'VAE 编解码器',
        matchKeys: ['vae_name'],
        tip: 'VAE 图像编解码模型 (通常位于 VAELoader 节点)'
    },
    {
        variable: '%prompt%',
        label: '正向提示词',
        matchKeys: ['positive', 'text'],
        tip: '自动包含模型起手式、全局前缀、AI提示词及后缀与LoRA'
    },
    {
        variable: '%negative_prompt%',
        label: '负向提示词',
        matchKeys: ['negative', 'text'],
        tip: '自动包含模型负向起手式、全局负向词及当次负向词'
    },
    {
        variable: '%seed%',
        label: '随机种子',
        matchKeys: ['seed', 'noise_seed'],
        tip: '生图随机种子数值 (通常位于 KSampler 或 Seed 节点)'
    },
    {
        variable: '%steps%',
        label: '采样步数',
        matchKeys: ['steps'],
        tip: '采样迭代步数 (通常位于 KSampler 节点)'
    },
    {
        variable: '%cfg%',
        label: 'CFG Scale',
        matchKeys: ['cfg', 'cfg_scale'],
        tip: '提示词引导系数 (通常位于 KSampler 节点)'
    },
    {
        variable: '%sampler_name%',
        label: '采样器算法',
        matchKeys: ['sampler_name', 'sampler'],
        tip: '采样算法名称 (如 euler, dpmpp_2m)'
    },
    {
        variable: '%scheduler%',
        label: '调度器类型',
        matchKeys: ['scheduler'],
        tip: '采样调度算法 (如 normal, karras)'
    },
    {
        variable: '%width%',
        label: '图像宽度',
        matchKeys: ['width'],
        tip: '生成宽度 (通常位于 EmptyLatentImage 节点)'
    },
    {
        variable: '%height%',
        label: '图像高度',
        matchKeys: ['height'],
        tip: '生成高度 (通常位于 EmptyLatentImage 节点)'
    },
    {
        variable: '%denoise%',
        label: '重绘重绘幅度',
        matchKeys: ['denoise'],
        tip: '去噪强度 (通常位于图生图/重绘 KSampler 节点)'
    }
] as const;

/**
 * 递归扫描 ComfyUI 工作流 JSON，匹配并替换工作流变量占位符 (%prompt%, %seed% 等)
 * 自动解构 Web 前端导出的封装格式，跳过 Node Link 连线数组以保护节点拓扑图不被破坏。
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

    // 兼容展开带有外层包装的 ComfyUI 工作流数据 (如 { data: { json: ... } } 或 { json: ... })
    if (parsed.data?.json && typeof parsed.data.json === 'string') {
        try {
            parsed = JSON.parse(parsed.data.json);
        } catch (err) {
            logger.warn('解析内层 data.json 失败:', err);
        }
    } else if (parsed.json && typeof parsed.json === 'string') {
        try {
            parsed = JSON.parse(parsed.json);
        } catch (err) {
            logger.warn('解析内层 json 失败:', err);
        }
    }

    const replaced: VariableReplacementInfo[] = [];
    const matchedVars = new Set<string>();

    for (const [nodeId, node] of Object.entries(parsed)) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        const classType = node.class_type || node._meta?.title || 'Unknown';
        const inputs = node.inputs;

        for (const [field, val] of Object.entries(inputs)) {
            // 值为数组 [nodeId, slot] 时代表上游节点的连接线 (Node Link)，严禁替换为变量以免破坏节点拓扑
            if (Array.isArray(val)) continue;

            for (const item of COMFYUI_VARIABLE_DEFINITIONS) {
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
    for (const item of COMFYUI_VARIABLE_DEFINITIONS) {
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
    onOpenWorkflow?: (currentJson: string) => void,
    onOpenBlueprint?: (currentJson: string) => void
): void {
    const analysis = analyzeAndReplaceWorkflowVariables(rawJson);

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';

    const modal = document.createElement('div');
    modal.className = 'da-dialog-panel da-workflow-format-modal';
    modal.style.maxWidth = '740px';
    modal.style.width = '94vw';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'da-dialog-title';
    title.innerHTML = `
        <svg class="da-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 4-2 4-4 2 4 2 2 4 2-4 4-2-4-2z"/><path d="M9 15 2 22"/>
        </svg> 工作流变量分析与格式化诊断
    `;

    const message = document.createElement('div');
    message.className = 'da-dialog-message da-workflow-format-body';

    if (!analysis.success) {
        message.innerHTML = `<div class="da-text-danger">${escapeHtml(analysis.error)}</div>`;
    } else {
        const repCount = analysis.replaced.length;
        const unrepCount = analysis.unmatched.length;

        let html = `
            <div class="da-workflow-format-summary da-flex-between">
                <span>扫描完成：共识别并自动绑定 <strong>${repCount}</strong> 处变量占位符，另有 <strong>${unrepCount}</strong> 项变量未自动匹配。</span>
                <span class="da-workflow-status-badge ${unrepCount === 0 ? 'da-workflow-status-badge--matched' : 'da-workflow-status-badge--unmatched'}">
                    ${unrepCount === 0 ? '全部匹配' : '部分未匹配'}
                </span>
            </div>
        `;

        if (repCount > 0) {
            html += `
                <div class="da-workflow-format-section">
                    <div class="da-workflow-format-section-title da-workflow-format-section-title--success">
                        <svg class="da-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                        </svg> 已成功自动匹配替换 (${repCount})
                    </div>
                    <div class="da-workflow-var-list">
            `;
            analysis.replaced.forEach((r) => {
                html += `
                    <div class="da-workflow-var-item da-workflow-var-item--matched">
                        <span class="da-macro-tag">${escapeHtml(r.variable)}</span>
                        <span class="da-workflow-var-target">➔ 节点 #${escapeHtml(r.nodeId)} (<code>${escapeHtml(r.classType)}.${escapeHtml(r.field)}</code>)</span>
                    </div>
                `;
            });
            html += `</div></div>`;
        }

        if (unrepCount > 0) {
            html += `
                <div class="da-workflow-format-section">
                    <div class="da-workflow-format-section-title da-workflow-format-section-title--warning">
                        <svg class="da-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg> 未自动匹配到的变量 (${unrepCount})
                    </div>
                    <div class="da-workflow-var-list">
            `;
            analysis.unmatched.forEach((u) => {
                html += `
                    <div class="da-workflow-var-item da-workflow-var-item--unmatched">
                        <span class="da-macro-tag da-macro-tag--warning">${escapeHtml(u.variable)}</span>
                        <span class="da-workflow-var-label">${escapeHtml(u.label)}</span>
                        <span class="da-workflow-var-tip">${escapeHtml(u.tip)}</span>
                    </div>
                `;
            });
            html += `</div></div>`;
        }

        message.innerHTML = html;
    }

    const actions = document.createElement('div');
    actions.className = 'da-dialog-actions';

    let modalHandle: { dispose: () => void };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn da-btn--secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => modalHandle?.dispose();

    actions.appendChild(cancelBtn);

    const openEditor = onOpenBlueprint || onOpenWorkflow;
    if (openEditor) {
        const blueprintBtn = document.createElement('button');
        blueprintBtn.type = 'button';
        blueprintBtn.className = 'da-btn da-btn--secondary da-btn-open-blueprint';
        blueprintBtn.textContent = '打开蓝图手动配置';
        blueprintBtn.onclick = () => {
            modalHandle?.dispose();
            openEditor(rawJson);
        };
        actions.appendChild(blueprintBtn);
    }

    const applyBtn = document.createElement('button');
    applyBtn.className = 'da-btn da-btn--primary';
    applyBtn.innerHTML = `
        <svg class="da-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
        </svg> 应用变量替换
    `;
    applyBtn.disabled = !analysis.success;
    applyBtn.onclick = () => {
        onApply(analysis.formattedJson);
        modalHandle?.dispose();
        FeedbackService.toastSuccess('工作流已成功完成变量替换与格式化！');
    };

    actions.appendChild(applyBtn);

    modal.appendChild(title);
    modal.appendChild(message);
    modal.appendChild(actions);
    backdrop.appendChild(modal);

    modalHandle = ModalService.getInstance().open(backdrop, {
        closeOnBackdrop: true,
        closeOnEscape: true
    });
}

/**
 * 工作流预设卡片配置项
 */
export interface WorkflowPresetCardOptions {
    title: string;
    description?: string;
    collapsible?: boolean;
    defaultOpen?: boolean;
    label: string;
    workflowMode?: 'txt2img' | 'inpaint';
    blueprintMode?: 'txt2img' | 'inpaint';
    fieldLabel: string;
    helpTooltip: string;
    placeholder?: string;
    getProfiles: () => PresetProfileItem<WorkflowProfileData>[];
    getCurrentProfileId: () => string;
    getCurrentJson: () => string;
    onProfilesChange: (profiles: PresetProfileItem<WorkflowProfileData>[], activeId: string) => void;
    onJsonChange: (json: string) => void;
    onRefresh: () => void;
    onOpenWorkflow?: (currentJson: string) => void;
    onOpenBlueprint?: (currentJson: string) => void;
}

export interface WorkflowPresetCardHandle extends HTMLElement, IDisposable {
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

    const isInitiallyCollapsed = options.collapsible ? options.defaultOpen === false : undefined;
    const card = createCard({
        hoverable: true,
        collapsible: options.collapsible,
        defaultCollapsed: isInitiallyCollapsed
    });
    const header = createCardHeader({
        title: options.title,
        description: options.description || ''
    });
    card.header.appendChild(header);

    let activeBaselineJson: string = (options.getCurrentJson() || '').trim();

    const checkJsonState = (val: string) => {
        const trimmed = val.trim();
        const isDirty = trimmed !== activeBaselineJson;
        toolbarEl?.setDirty?.(isDirty);

        if (!trimmed) {
            inputHandleEl?.setError?.(false);
            inputHandleEl?.setDirty?.(false);
            inputHandleEl?.inputElement?.removeAttribute('title');
            return;
        }

        try {
            JSON.parse(trimmed);
            inputHandleEl?.setError?.(false);
            inputHandleEl?.setDirty?.(isDirty);
            if (isDirty) {
                inputHandleEl.inputElement.title = '已修改';
            } else {
                inputHandleEl?.inputElement?.removeAttribute('title');
            }
        } catch (err: any) {
            inputHandleEl?.setError?.(true, `已失效：JSON 语法错误 (${err?.message || err})`);
        }
    };

    // 1. 顶部工作流预设方案工具栏
    toolbarEl = bindPresetToolbar({
        adapter: createPresetStoreAdapter<WorkflowProfileData>({
            category: 'workflows',
            label: options.label,
            generateId: () => `${options.blueprintMode || options.workflowMode || 'txt2img'}_wf_${Date.now()}`,
            getPresets: () =>
                options.getProfiles().map((p) => ({
                    id: p.id,
                    name: p.name,
                    data: p.data
                })),
            getActiveId: () => options.getCurrentProfileId(),
            onPresetsChange: (presets, activeId) => {
                options.onProfilesChange(presets, activeId);
            },
            onApply: (profile) => {
                if (profile?.data?.json) {
                    activeBaselineJson = profile.data.json.trim();
                    options.onJsonChange(profile.data.json);
                    options.onRefresh();
                    inputHandleEl?.setValue(profile.data.json);
                    inputHandleEl?.setDirty?.(false);
                    inputHandleEl?.setError?.(false);
                    inputHandleEl?.inputElement?.removeAttribute('title');
                    toolbarEl.setDirty?.(false);
                }
            }
        }),
        getCurrentData: () => ({
            json: options.getCurrentJson()
        }),
        applyData: (id: string) => {
            const profile = options.getProfiles().find((p) => p.id === id);
            if (profile?.data?.json) {
                activeBaselineJson = profile.data.json.trim();
                options.onJsonChange(profile.data.json);
                options.onRefresh();
                inputHandleEl?.setValue(profile.data.json);
                inputHandleEl?.setDirty?.(false);
                inputHandleEl?.setError?.(false);
                inputHandleEl?.inputElement?.removeAttribute('title');
                toolbarEl.setDirty?.(false);
            }
        },
        onApplied: (profile) => {
            if (profile?.data?.json) {
                activeBaselineJson = profile.data.json.trim();
                options.onJsonChange(profile.data.json);
                options.onRefresh();
                inputHandleEl?.setValue(profile.data.json);
                inputHandleEl?.setDirty?.(false);
                inputHandleEl?.setError?.(false);
                inputHandleEl?.inputElement?.removeAttribute('title');
                toolbarEl.setDirty?.(false);
            }
        }
    });
    card.body.appendChild(toolbarEl);

    // 2. 标题与操作按钮组
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
                inputHandleEl?.setValue(updatedStr);
                checkJsonState(updatedStr);
            },
            options.onOpenWorkflow,
            options.onOpenBlueprint
        );
    };

    actionsWrapper.appendChild(formatBtn);

    const openEditor = options.onOpenBlueprint || options.onOpenWorkflow;
    if (openEditor) {
        const blueprintBtn = document.createElement('button');
        blueprintBtn.type = 'button';
        blueprintBtn.className = 'da-btn da-btn--secondary da-btn--sm da-btn-blueprint';
        blueprintBtn.textContent = '打开蓝图';
        blueprintBtn.onclick = () => {
            openEditor(options.getCurrentJson());
        };
        actionsWrapper.appendChild(blueprintBtn);
    }

    const titleRow = createRow(['left', 'right'], { align: 'center', divided: true });
    const label = createFieldLabel({
        title: options.fieldLabel,
        helpTooltip: options.helpTooltip
    });
    titleRow.slots[0].appendChild(label);
    titleRow.slots[1].appendChild(actionsWrapper);
    card.body.appendChild(titleRow.root);

    // 3. JSON 代码编辑行
    const textareaRow = createRow(['full'], { divided: true });
    inputHandleEl = createTextarea({
        rows: 6,
        value: options.getCurrentJson(),
        placeholder: options.placeholder || '{\n  "3": {\n    "class_type": "KSampler",\n    ...\n  }\n}',
        onChange: (val) => {
            options.onJsonChange(val);
            checkJsonState(val);
        }
    });
    textareaRow.slots[0].appendChild(inputHandleEl);
    card.body.appendChild(textareaRow.root);

    const handle = Object.assign(card.root, {
        toolbar: toolbarEl!,
        inputHandle: inputHandleEl!,
        refresh: () => {
            activeBaselineJson = (options.getCurrentJson() || '').trim();
            if (inputHandleEl) {
                inputHandleEl.setValue(options.getCurrentJson());
                inputHandleEl.setDirty?.(false);
                inputHandleEl.setError?.(false);
                inputHandleEl.inputElement?.removeAttribute('title');
            }
            toolbarEl?.refreshPresets?.(options.getProfiles(), options.getCurrentProfileId());
            toolbarEl?.setDirty?.(false);
        },
        dispose: () => {
            (toolbarEl as any)?.dispose?.();
            inputHandleEl?.dispose();
            card.root.remove();
        }
    });

    return handle as WorkflowPresetCardHandle;
}
