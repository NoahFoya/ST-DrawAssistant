/**
 * ComfyUI 工作流预设管理复合卡片 (WorkflowCard)。
 *
 * @remarks
 * 装配 Card 基础容器组件与 PresetToolbar 方案工具栏：
 * 1. 包含 ComfyUI 原生 API Prompt JSON 编辑域与实时语法合法性检测；
 * 2. 内置计算图变量扫描与连线保护算法，自动绑定模型、提示词、种子、步数、CFG与尺寸占位符；
 * 3. 提供工作流变量分析与格式化诊断模态弹窗，并支持蓝图编辑器跳转。
 */

import type { UIComponent } from '../types';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { PresetToolbar, type PresetToolbarItem, type PresetActionType } from './preset-toolbar';

/** 替换变量信息 */
export interface VariableReplacementInfo {
    variable: string;
    nodeId: string;
    classType: string;
    field: string;
    prevValue: unknown;
}

/** 未匹配变量信息 */
export interface UnmatchedVariableInfo {
    variable: string;
    label: string;
    tip: string;
}

/** 工作流分析结果 */
export interface WorkflowAnalysisResult {
    success: boolean;
    error?: string;
    formattedJson: string;
    replaced: VariableReplacementInfo[];
    unmatched: UnmatchedVariableInfo[];
}

/** ComfyUI 工作流宏变量定义规范 */
export interface ComfyWorkflowVariableDefinition {
    variable: string;
    label: string;
    matchKeys: readonly string[];
    tip: string;
}

/** 工作流卡片内部表单数据模型 */
export interface WorkflowCardData {
    json: string;
}

/** 工作流预设条目 */
export interface WorkflowCardPresetItem {
    id: string;
    name: string;
    data: {
        json: string;
    };
}

/** 工作流卡片配置参数 */
export interface WorkflowCardOptions {
    /** 预设工作流列表 */
    presets: WorkflowCardPresetItem[];
    /** 当前激活的预设 ID */
    activePresetId: string;
    /** 初始工作流数据 */
    value?: Partial<WorkflowCardData>;
    /** 预设操作动作回调 */
    onAction?: (action: PresetActionType, presetId: string, data?: WorkflowCardData) => void;
    /** 工作流内容变更回调 */
    onChange?: (data: WorkflowCardData) => void;
    /** 打开蓝图编辑器回调 */
    onOpenBlueprint?: (currentJson: string) => void;
    /** 操作确认回调。未传入时由 PresetToolbar 委托全局确认对话框 ConfirmDialog.confirm */
    confirmHandler?: (message: string) => Promise<boolean> | boolean;
    /** 附加 CSS 类名 */
    className?: string;
}

/** ComfyUI 标准变量占位符定义字典 */
export const COMFYUI_VARIABLE_DEFINITIONS: readonly ComfyWorkflowVariableDefinition[] = [
    {
        variable: '%basemodel_name%',
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
        tip: '包含正向起手式、风格修饰与主体描述词'
    },
    {
        variable: '%negative_prompt%',
        label: '负向提示词',
        matchKeys: ['negative', 'text'],
        tip: '包含负向过滤词与质量排除词'
    },
    {
        variable: '%seed%',
        label: '随机种子',
        matchKeys: ['seed', 'noise_seed'],
        tip: '随机种子数值 (通常位于 KSampler 或 Seed 节点)'
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
        tip: '采样调度策略 (如 normal, karras)'
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
        label: '重绘幅度',
        matchKeys: ['denoise'],
        tip: '去噪强度 (通常位于图生图/重绘 KSampler 节点)'
    }
] as const;

/** HTML 字符转义工具函数 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** 内置内联 SVG 图标定义 (14×14) */
const ICONS = {
    refresh: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
    external: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`
};

/**
 * 遍历扫描 ComfyUI 工作流 JSON 的各节点输入参数 (inputs)，匹配并绑定宏变量占位符。
 *
 * @remarks
 * 1. 结构与格式校验：严格确保输入符合 ComfyUI API Prompt 格式（根对象为节点 ID 映射表）；
 * 2. 计算图连线保护：跳过所有二维数组 [nodeId, slot]，防止将节点连线误破坏为标量字符串；
 * 3. 正负向提示词连接消歧：预先建立 KSampler 等采样节点的 positive/negative 连线索引，精准消歧 text 输入项；
 * 4. 幂等性识别：若输入项已为宏变量占位符，识别为已就绪并保持幂等；
 * 5. 单次绑定策略：每类宏变量优先绑定首个有效匹配节点，避免复合节点重复覆盖。
 */
export function analyzeAndReplaceWorkflowVariables(jsonStr: string): WorkflowAnalysisResult {
    let parsed: Record<string, any>;
    try {
        parsed = JSON.parse((jsonStr || '').trim());
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            success: false,
            error: `JSON 语法解析错误: ${message}`,
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

    // 解包外层嵌套预设结构 (如 { data: { json: ... } } 或 { json: ... })
    if (parsed.data?.json && typeof parsed.data.json === 'string') {
        try {
            parsed = JSON.parse(parsed.data.json);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                error: `解析嵌套工作流 JSON 失败: ${message}`,
                formattedJson: jsonStr,
                replaced: [],
                unmatched: []
            };
        }
    } else if (parsed.json && typeof parsed.json === 'string') {
        try {
            parsed = JSON.parse(parsed.json);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                error: `解析嵌套工作流 JSON 失败: ${message}`,
                formattedJson: jsonStr,
                replaced: [],
                unmatched: []
            };
        }
    }

    // 二次解包校验
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            success: false,
            error: '无效的工作流数据：解析后的根节点必须为包含节点 ID 的 Object 字典结构',
            formattedJson: jsonStr,
            replaced: [],
            unmatched: []
        };
    }

    // 检测是否为 ComfyUI Web UI 保存格式 (包含 nodes 与 links 布局数组)
    if (Array.isArray(parsed.nodes) && (Array.isArray(parsed.links) || parsed.version !== undefined)) {
        return {
            success: false,
            error: '检测到当前内容为 ComfyUI Web 界面格式 (UI Layout)，非生图引擎所需的 API Prompt 格式。请在 ComfyUI 设置中开启「Enable Dev mode Options」，通过「Save (API Format)」导出后重新粘贴。',
            formattedJson: jsonStr,
            replaced: [],
            unmatched: []
        };
    }

    // 1. 建立采样节点的正负向条件连接索引，用于消歧 text 输入项归属
    const positiveNodeIds = new Set<string>();
    const negativeNodeIds = new Set<string>();

    for (const [, node] of Object.entries(parsed)) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        const inputs = node.inputs;
        if (Array.isArray(inputs.positive) && inputs.positive.length >= 1) {
            positiveNodeIds.add(String(inputs.positive[0]));
        }
        if (Array.isArray(inputs.negative) && inputs.negative.length >= 1) {
            negativeNodeIds.add(String(inputs.negative[0]));
        }
    }

    const isExplicitNegative = (nodeId: string, node: any): boolean => {
        if (negativeNodeIds.has(nodeId)) return true;
        const title = String(node._meta?.title || node.title || '').toLowerCase();
        return title.includes('negative') || title.includes('负向') || title.includes('负面');
    };

    const isExplicitPositive = (nodeId: string, node: any): boolean => {
        if (positiveNodeIds.has(nodeId)) return true;
        const title = String(node._meta?.title || node.title || '').toLowerCase();
        return title.includes('positive') || title.includes('正向') || title.includes('正面');
    };

    const replaced: VariableReplacementInfo[] = [];
    const matchedVars = new Set<string>();

    // 2. 遍历各节点输入字段
    for (const [nodeId, node] of Object.entries(parsed)) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        const classType = node.class_type || node._meta?.title || 'Unknown';
        const inputs = node.inputs;

        for (const [field, val] of Object.entries(inputs)) {
            // 连线保护：数组 [nodeId, slot] 代表节点间连接线，跳过替换
            if (Array.isArray(val)) continue;

            const fieldLower = field.toLowerCase();
            const isTextField = fieldLower === 'text' || fieldLower === 'positive' || fieldLower === 'negative';

            let preferredVar: string | null = null;
            if (isTextField) {
                if (isExplicitNegative(nodeId, node) || fieldLower === 'negative') {
                    preferredVar = '%negative_prompt%';
                } else if (isExplicitPositive(nodeId, node) || fieldLower === 'positive') {
                    preferredVar = '%prompt%';
                }
            }

            for (const item of COMFYUI_VARIABLE_DEFINITIONS) {
                // 每类变量优先绑定首个有效匹配节点
                if (matchedVars.has(item.variable)) continue;

                // 若原值本身已经是该变量占位符，保持幂等
                if (typeof val === 'string' && val.trim() === item.variable) {
                    matchedVars.add(item.variable);
                    break;
                }

                // 若已判定极性偏好，跳过另一侧提示词变量
                if (preferredVar && (item.variable === '%prompt%' || item.variable === '%negative_prompt%')) {
                    if (item.variable !== preferredVar) continue;
                }

                const isMatch = item.matchKeys.some((k: string) => fieldLower === k.toLowerCase());
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
 * 弹出工作流变量分析与格式化诊断模态弹窗。
 */
export function openWorkflowFormatModal(
    rawJson: string,
    onApply: (formattedJson: string) => void,
    onOpenBlueprint?: (currentJson: string) => void
): { dispose: () => void } {
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
        <span style="color: var(--da-accent-color); font-size: 1.1em; display: inline-flex;">✦</span>
        <span>工作流变量分析与格式化诊断</span>
    `;

    const message = document.createElement('div');
    message.className = 'da-dialog-message da-workflow-format-body';

    if (!analysis.success) {
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color: var(--da-danger); padding: 12px; background: rgba(var(--da-danger-rgb), 0.08); border-radius: var(--da-radius);';
        errDiv.textContent = analysis.error || '解析失败';
        message.appendChild(errDiv);
    } else {
        const repCount = analysis.replaced.length;
        const unrepCount = analysis.unmatched.length;

        let html = `
            <div class="da-workflow-format-summary" style="display: flex; justify-content: space-between; align-items: center;">
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
                        <span>✓ 已成功自动匹配替换 (${repCount})</span>
                    </div>
                    <div class="da-workflow-var-list">
            `;
            for (const r of analysis.replaced) {
                html += `
                    <div class="da-workflow-var-item da-workflow-var-item--matched">
                        <span class="da-macro-tag is-valid">${escapeHtml(r.variable)}</span>
                        <span class="da-workflow-var-target">➔ 节点 #${escapeHtml(r.nodeId)} (<code>${escapeHtml(r.classType)}.${escapeHtml(r.field)}</code>)</span>
                    </div>
                `;
            }
            html += `</div></div>`;
        }

        if (unrepCount > 0) {
            html += `
                <div class="da-workflow-format-section">
                    <div class="da-workflow-format-section-title da-workflow-format-section-title--warning">
                        <span>⚠ 未自动匹配到的变量 (${unrepCount})</span>
                    </div>
                    <div class="da-workflow-var-list">
            `;
            for (const u of analysis.unmatched) {
                html += `
                    <div class="da-workflow-var-item da-workflow-var-item--unmatched">
                        <span class="da-macro-tag da-macro-tag--warning">${escapeHtml(u.variable)}</span>
                        <span class="da-workflow-var-label">${escapeHtml(u.label)}</span>
                        <span class="da-workflow-var-tip">${escapeHtml(u.tip)}</span>
                    </div>
                `;
            }
            html += `</div></div>`;
        }

        message.innerHTML = html;
    }

    const actions = document.createElement('div');
    actions.className = 'da-dialog-actions';
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';

    const disposeModal = () => {
        backdrop.remove();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = disposeModal;
    actions.appendChild(cancelBtn);

    if (onOpenBlueprint) {
        const blueprintBtn = document.createElement('button');
        blueprintBtn.type = 'button';
        blueprintBtn.className = 'da-btn da-btn--secondary da-btn--sm';
        blueprintBtn.textContent = '打开蓝图手动配置';
        blueprintBtn.onclick = () => {
            disposeModal();
            onOpenBlueprint(rawJson);
        };
        actions.appendChild(blueprintBtn);
    }

    const applyBtn = document.createElement('button');
    applyBtn.className = 'da-btn da-btn--primary da-btn--sm';
    applyBtn.textContent = '应用变量替换';
    applyBtn.disabled = !analysis.success;
    applyBtn.onclick = () => {
        onApply(analysis.formattedJson);
        disposeModal();
    };
    actions.appendChild(applyBtn);

    modal.appendChild(title);
    modal.appendChild(message);
    modal.appendChild(actions);
    backdrop.appendChild(modal);

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) disposeModal();
    });

    document.body.appendChild(backdrop);

    return { dispose: disposeModal };
}

export class WorkflowCard implements UIComponent {
    public readonly element: HTMLElement;
    public readonly card: Card;
    public readonly toolbar: PresetToolbar;
    public readonly formatButton: Button;
    public readonly blueprintButton: Button;
    public readonly textareaElement: HTMLTextAreaElement;

    private currentData: WorkflowCardData;
    private rawPresets: WorkflowCardPresetItem[] = [];
    private activePresetId = '';
    private baselineJson = '';
    private readonly onChangeCallback?: (data: WorkflowCardData) => void;
    private readonly onActionCallback?: (action: PresetActionType, presetId: string, data?: WorkflowCardData) => void;
    private readonly onOpenBlueprintCallback?: (currentJson: string) => void;
    private readonly textareaInputListener: () => void;

    constructor(options: WorkflowCardOptions) {
        this.rawPresets = [...options.presets];
        this.activePresetId = options.activePresetId || (this.rawPresets[0]?.id ?? '');
        this.onChangeCallback = options.onChange;
        this.onActionCallback = options.onAction;
        this.onOpenBlueprintCallback = options.onOpenBlueprint;

        // 1. 初始化数据模型
        const initialJson = options.value?.json
            ?? (this.rawPresets.find((p) => p.id === this.activePresetId)?.data?.json || '{}');
        this.currentData = { json: initialJson };
        this.baselineJson = initialJson;

        // 2. 卡片外壳
        this.card = new Card({
            title: 'ComfyUI 工作流设置'
        });
        this.element = this.card.element;
        this.element.classList.add('da-workflow-preset-manager', 'da-workflow-card');
        if (options.className) {
            this.element.classList.add(options.className);
        }

        // 3. 预设方案工具栏 PresetToolbar
        this.toolbar = new PresetToolbar({
            presets: this.buildToolbarItems(this.rawPresets),
            activePresetId: this.activePresetId,
            confirmHandler: options.confirmHandler,
            onAction: (action, presetId) => this.handlePresetAction(action, presetId)
        });
        this.card.appendContent(this.toolbar.element);

        // 4. 控制栏：[ 格式化变量 ] 与 [ 打开蓝图 ]
        const actionsBar = document.createElement('div');
        actionsBar.className = 'da-workflow-card__actions-bar';

        const actionsTitle = document.createElement('div');
        actionsTitle.className = 'da-workflow-card__actions-title';
        actionsTitle.textContent = '工作流 JSON 定义';

        const actionsBtns = document.createElement('div');
        actionsBtns.className = 'da-workflow-card__actions-btns';

        this.formatButton = new Button({
            label: '格式化变量',
            variant: 'secondary',
            size: 'sm',
            icon: ICONS.refresh,
            onClick: () => {
                openWorkflowFormatModal(
                    this.currentData.json,
                    (formatted) => {
                        this.currentData.json = formatted;
                        this.textareaElement.value = formatted;
                        this.checkJsonState(formatted);
                        this.updateDirtyState();
                        this.onChangeCallback?.(this.currentData);
                    },
                    this.onOpenBlueprintCallback
                );
            }
        });

        this.blueprintButton = new Button({
            label: '打开蓝图',
            tooltip: '查看详细工作流蓝图或在线编辑',
            variant: 'secondary',
            size: 'sm',
            icon: ICONS.external,
            onClick: () => {
                this.onOpenBlueprintCallback?.(this.currentData.json);
            }
        });

        actionsBtns.appendChild(this.formatButton.element);
        actionsBtns.appendChild(this.blueprintButton.element);

        actionsBar.appendChild(actionsTitle);
        actionsBar.appendChild(actionsBtns);
        this.card.appendContent(actionsBar);

        // 5. 工作流多行代码编辑文本域
        const editorRow = document.createElement('div');
        editorRow.className = 'da-workflow-card__editor-row';

        this.textareaElement = document.createElement('textarea');
        this.textareaElement.className = 'da-textarea da-workflow-json-editor';
        this.textareaElement.rows = 8;
        this.textareaElement.placeholder = '{\n  "3": {\n    "class_type": "KSampler",\n    "inputs": { "seed": "%seed%", "steps": "%steps%" }\n  }\n}';
        this.textareaElement.value = this.currentData.json;

        this.textareaInputListener = () => {
            const val = this.textareaElement.value;
            this.currentData.json = val;
            this.checkJsonState(val);
            this.updateDirtyState();
            this.onChangeCallback?.(this.currentData);
        };
        this.textareaElement.addEventListener('input', this.textareaInputListener);

        this.checkJsonState(this.currentData.json);
        editorRow.appendChild(this.textareaElement);
        this.card.appendContent(editorRow);
    }

    /**
     * 获取当前工作流数据快照。
     */
    public getValue(): WorkflowCardData {
        return { ...this.currentData };
    }

    /**
     * 外部受控更新工作流数据。
     */
    public setValue(val: Partial<WorkflowCardData>): void {
        if (val.json !== undefined) {
            this.currentData.json = val.json;
            this.textareaElement.value = val.json;
            this.checkJsonState(val.json);
            this.baselineJson = val.json;
            this.toolbar.setDirty(false);
        }
    }

    /**
     * 动态刷新工作流预设方案列表。
     */
    public setPresets(presets: WorkflowCardPresetItem[], activeId?: string): void {
        this.rawPresets = [...presets];
        if (activeId !== undefined) {
            this.activePresetId = activeId;
        } else if (!this.rawPresets.some((p) => p.id === this.activePresetId)) {
            this.activePresetId = this.rawPresets[0]?.id || '';
        }

        this.toolbar.setPresets(this.buildToolbarItems(this.rawPresets), this.activePresetId);
        const found = this.rawPresets.find((p) => p.id === this.activePresetId);
        if (found?.data?.json !== undefined) {
            this.currentData.json = found.data.json;
            this.baselineJson = found.data.json;
            this.textareaElement.value = found.data.json;
            this.checkJsonState(found.data.json);
            this.toolbar.setDirty(false);
        }
    }

    /**
     * 更新基准快照并重置脏状态。
     */
    public setBaseline(data: WorkflowCardData): void {
        this.currentData = { ...data };
        this.baselineJson = data.json;
        this.textareaElement.value = data.json;
        this.checkJsonState(data.json);
        this.toolbar.setDirty(false);
    }

    /**
     * 查询当前是否处于脏状态。
     */
    public isDirty(): boolean {
        return this.toolbar.isDirty();
    }

    /**
     * 级联释放子组件、事件监听与 DOM 节点。
     */
    public dispose(): void {
        this.textareaElement.removeEventListener('input', this.textareaInputListener);
        this.toolbar.dispose();
        this.formatButton.dispose();
        this.blueprintButton.dispose();
        this.card.dispose();
    }

    /** 预设工具栏动作事件分发 */
    private handlePresetAction(action: PresetActionType, presetId: string): void {
        if (action === 'select') {
            this.activePresetId = presetId;
            const found = this.rawPresets.find((p) => p.id === presetId);
            const newJson = found?.data?.json ?? '{}';
            this.currentData = { json: newJson };
            this.baselineJson = newJson;
            this.textareaElement.value = newJson;
            this.checkJsonState(newJson);
            this.toolbar.setDirty(false);
            this.onChangeCallback?.(this.currentData);
        } else if (action === 'save') {
            const target = this.rawPresets.find((p) => p.id === presetId);
            if (target) {
                target.data = { json: this.currentData.json };
            }
            this.baselineJson = this.currentData.json;
            this.toolbar.setDirty(false);
        } else if (action === 'reset') {
            const base = this.rawPresets.find((p) => p.id === presetId);
            const resetJson = base?.data?.json ?? this.baselineJson;
            this.currentData = { json: resetJson };
            this.baselineJson = resetJson;
            this.textareaElement.value = resetJson;
            this.checkJsonState(resetJson);
            this.toolbar.setDirty(false);
            this.onChangeCallback?.(this.currentData);
        }

        this.onActionCallback?.(action, presetId, this.currentData);
    }

    /** 检查 JSON 语法状态并切换 invalid 样式类 */
    private checkJsonState(val: string): void {
        const trimmed = (val || '').trim();
        if (!trimmed) {
            this.textareaElement.classList.remove('is-invalid');
            this.textareaElement.removeAttribute('title');
            return;
        }

        try {
            JSON.parse(trimmed);
            this.textareaElement.classList.remove('is-invalid');
            this.textareaElement.removeAttribute('title');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.textareaElement.classList.add('is-invalid');
            this.textareaElement.title = `已失效：JSON 语法错误 (${message})`;
        }
    }

    /** 联动更新 PresetToolbar 脏状态 */
    private updateDirtyState(): void {
        const isDirty = this.currentData.json !== this.baselineJson;
        this.toolbar.setDirty(isDirty);
    }

    /** 将内部工作流预设映射为 PresetToolbar 所需条目 */
    private buildToolbarItems(items: WorkflowCardPresetItem[]): PresetToolbarItem[] {
        return items.map((p) => ({
            id: p.id,
            name: p.name
        }));
    }
}
