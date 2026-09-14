/**
 * @module src/ui/composite/workflow-card
 * @description ComfyUI 工作流预设管理器 (WorkflowPresetManager) 与变量诊断工具
 *
 * 核心功能：
 * 1. 提供 ComfyUI 工作流预设方案的快速切换、新增、重命名、另存为与出厂重置；
 * 2. 支持工作流原生 JSON 结构预览，提供语法校验与错误即时反馈；
 * 3. 内置工作流节点图变量扫描算法，自动分析提示词、种子、尺寸与模型占位符映射；
 * 4. 提供可视化诊断弹窗，支持占位符匹配报告查看与一键安全替换；
 * 5. 追踪工作流 JSON 脏状态，联动预设工具栏进行保存状态提示与切换拦截。
 *
 * 注意事项：
 * 1. ComfyUI 节点连线 (Link) 数组结构极为敏感，变量注入与替换严禁污染非目标输入字段；
 * 2. 外部导入工作流必须校验 JSON 合法性，防止畸形数据导致后续执行阶段崩溃。
 */

import type {
    PresetItem,
    PresetActionType,
    WorkflowPresetData,
    WorkflowAnalysisResult,
    VariableReplacementInfo,
    UnmatchedVariableInfo,
    ComfyWorkflowVariableDefinition
} from '@types';

export type {
    PresetItem,
    PresetActionType,
    WorkflowPresetData,
    WorkflowAnalysisResult,
    VariableReplacementInfo,
    UnmatchedVariableInfo,
    ComfyWorkflowVariableDefinition
};
import { createCard } from '../components/form-field';
import { createTextarea, TextareaHandle } from '../components/input';
import { createButton, ButtonHandle } from '../components/button';
import { Toast } from '../components/feedback';
import { createPresetToolbar, PresetToolbarHandle, PresetToolbarItem } from './preset-toolbar';
import { createDirtyTracker, IDirtyTracker } from '../components/dirty-tracker';
import { getIconSvg } from '../components/icons';
import { escapeHtml } from '../../util/dom';

/** ComfyUI 标准 13 项变量占位符定义字典 */
export const COMFYUI_VARIABLE_DEFINITIONS: readonly ComfyWorkflowVariableDefinition[] = [
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
        tip: '自动包含模型起手式、前缀修饰、提示词及后缀与LoRA'
    },
    {
        variable: '%negative_prompt%',
        label: '负向提示词',
        matchKeys: ['negative', 'text'],
        tip: '自动包含模型负向起手式、基础负向词及当次负向词'
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
        label: '重绘幅度',
        matchKeys: ['denoise'],
        tip: '去噪强度 (通常位于图生图/重绘 KSampler 节点)'
    }
] as const;

/**
 * 遍历扫描 ComfyUI 工作流 JSON 的各节点输入参数 (inputs)，匹配并绑定工作流变量占位符 (%prompt%, %seed% 等)
 *
 * 核心机制与技术边界说明：
 * 1. 结构与格式校验：严格确保输入符合 ComfyUI API Prompt 格式（根对象为节点 ID 映射表）；若检测到 Web UI 保存格式 (含有 nodes/links 数组) 则给出专业指引；
 * 2. 节点连线保护：跳过所有二维数组 [nodeId, slot]（即 Node Link 连线），防止将计算图连线误破坏为字符串导致 ComfyUI 无法执行；
 * 3. 正负向提示词连接消歧：预先扫描 KSampler 等采样节点的 positive/negative 连线，结合节点 _meta.title 语义，精准消歧 text 输入项归属，防止正反向颠倒；
 * 4. 幂等性识别：若输入项已正确配置为宏变量占位符，直接标记为已就绪，不产生多余覆盖记录；
 * 5. 单次绑定策略：每类宏变量优先绑定工作流中首个有效匹配节点，防止多阶段采样器等复合节点重复插桩引发冲突。
 */
export function analyzeAndReplaceWorkflowVariables(jsonStr: string): WorkflowAnalysisResult {
    let parsed: Record<string, any>;
    try {
        parsed = JSON.parse((jsonStr || '').trim());
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
        } catch {
            // 解析内层失败则回退使用原对象
        }
    } else if (parsed.json && typeof parsed.json === 'string') {
        try {
            parsed = JSON.parse(parsed.json);
        } catch {
            // 解析内层失败则回退使用原对象
        }
    }

    // 二次解包防御与数据有效性校验
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            success: false,
            error: '无效的工作流数据：解析后的根节点必须为包含节点 ID 的 Object 字典结构',
            formattedJson: jsonStr,
            replaced: [],
            unmatched: []
        };
    }

    // 检测是否误传入了 ComfyUI Web UI 保存格式 (包含 nodes 与 links 布局数组)
    if (Array.isArray(parsed.nodes) && (Array.isArray(parsed.links) || parsed.version !== undefined)) {
        return {
            success: false,
            error: '检测到当前内容为 ComfyUI Web 界面格式 (UI Layout)，非生图引擎所需的 API Prompt 格式。请在 ComfyUI 设置中开启「Enable Dev mode Options」，通过「Save (API Format)」导出后重新粘贴。',
            formattedJson: jsonStr,
            replaced: [],
            unmatched: []
        };
    }

    // 1. 预先建立采样节点的正负向条件连接索引 (Graph Wiring Index)，用于精准消歧 CLIPTextEncode.text
    const positiveNodeIds = new Set<string>();
    const negativeNodeIds = new Set<string>();

    for (const [, node] of Object.entries(parsed)) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        const inputs = node.inputs;
        // KSampler / KSamplerAdvanced 中的 positive 与 negative 连线均为 [nodeId, slot] 形式
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

    // 2. 遍历各节点及其直接 inputs 字段
    for (const [nodeId, node] of Object.entries(parsed)) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        const classType = node.class_type || node._meta?.title || 'Unknown';
        const inputs = node.inputs;

        for (const [field, val] of Object.entries(inputs)) {
            // 技术边界：值为数组 [nodeId, slot] 时代表节点间连接线 (Node Link)，严禁替换为变量以免破坏节点连接关系
            if (Array.isArray(val)) continue;

            // 特殊处理文本字段 text 的正反向智能消歧
            const fieldLower = field.toLowerCase();
            const isTextField = fieldLower === 'text' || fieldLower === 'positive' || fieldLower === 'negative';

            // 优先针对提示词字段结合节点连接关系与计算图结构进行智能消歧
            let preferredVar: string | null = null;
            if (isTextField) {
                if (isExplicitNegative(nodeId, node) || fieldLower === 'negative') {
                    preferredVar = '%negative_prompt%';
                } else if (isExplicitPositive(nodeId, node) || fieldLower === 'positive') {
                    preferredVar = '%prompt%';
                }
            }

            for (const item of COMFYUI_VARIABLE_DEFINITIONS) {
                // 技术边界：每类宏变量优先单次绑定首个匹配节点，避免多阶段采样器等复合节点重复覆盖引发冲突
                if (matchedVars.has(item.variable)) continue;

                // 若原值本身已经是该变量占位符，识别为已就绪占位符，保持幂等并不重复生成修改记录
                if (typeof val === 'string' && val.trim() === item.variable) {
                    matchedVars.add(item.variable);
                    break;
                }

                // 若已判定正负向极性偏好，跳过不符的另一侧提示词变量
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


/** 弹出工作流变量诊断与格式化模态框 */
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
        message.innerHTML = `<div style="color: var(--da-color-error, #ff453a); padding: 12px; background: rgba(255, 69, 58, 0.08); border-radius: 6px;">${escapeHtml(analysis.error || '解析失败')}</div>`;
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
            analysis.replaced.forEach((r) => {
                html += `
                    <div class="da-workflow-var-item da-workflow-var-item--matched">
                        <span class="da-macro-tag is-valid">${escapeHtml(r.variable)}</span>
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
                        <span>⚠ 未自动匹配到的变量 (${unrepCount})</span>
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
        Toast.success('工作流已成功完成变量替换与格式化！');
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

export interface WorkflowPresetManagerOptions {
    presets: PresetItem<{ json: string }>[];
    activePresetId: string;
    value?: Partial<WorkflowPresetData>;
    onAction?: (action: PresetActionType, presetId: string, data?: WorkflowPresetData) => void;
    onChange?: (data: WorkflowPresetData) => void;
    onOpenBlueprint?: (currentJson: string) => void;
    className?: string;
}

export interface WorkflowPresetManagerHandle {
    readonly element: HTMLElement;
    readonly toolbar: PresetToolbarHandle;
    getValue(): WorkflowPresetData;
    setValue(val: Partial<WorkflowPresetData>): void;
    setPresets(presets: PresetItem<{ json: string }>[], activeId?: string): void;
    setBaseline(data: WorkflowPresetData): void;
    isDirty(): boolean;
    dispose(): void;
}

/**
 * 创建标准化工作流预设管理器 (WorkflowPresetManager)
 */
export function createWorkflowPresetManager(options: WorkflowPresetManagerOptions): WorkflowPresetManagerHandle {
    const disposers: (() => void)[] = [];

    // 1. 卡片外壳
    const card = createCard({
        title: '工作流预设管理器',
        iconSvg: getIconSvg('sparkles'),
        collapsible: true
    });
    card.element.classList.add('da-workflow-preset-manager', 'da-workflow-card');
    if (options.className) card.element.classList.add(options.className);
    disposers.push(() => card.dispose());

    // 2. 当前数据模型与基准快照
    let currentData: WorkflowPresetData = {
        json: options.value?.json ?? (options.presets.find((p) => p.id === options.activePresetId)?.data?.json || '{}')
    };

    // 3. 构造预设列表选项
    const toPresetToolbarItems = (items: PresetItem<{ json: string }>[]): PresetToolbarItem[] =>
        items.map((p) => ({
            id: p.id,
            name: p.name,
            isBuiltin: p.isBuiltin
        }));

    let rawPresets = options.presets || [];
    let currentPresetId = options.activePresetId || (rawPresets[0]?.id ?? 'default');

    // 4. 表单脏状态追踪器
    const dirtyTracker: IDirtyTracker<WorkflowPresetData> = createDirtyTracker(currentData, (isDirty) => {
        toolbar.setDirty(isDirty);
    });
    disposers.push(() => dirtyTracker.dispose());

    // 5. 方案工具栏 PresetToolbar
    const toolbar: PresetToolbarHandle = createPresetToolbar({
        presets: toPresetToolbarItems(rawPresets),
        activePresetId: currentPresetId,
        onAction: (action: PresetActionType, presetId: string) => {
            if (action === 'select') {
                currentPresetId = presetId;
                const found = rawPresets.find((p) => p.id === presetId);
                const newJson = found?.data?.json ?? '{}';
                currentData = { json: newJson };
                syncControls(currentData);
                dirtyTracker.setBaseline(currentData);
                options.onChange?.(currentData);
            } else if (action === 'save') {
                const target = rawPresets.find((p) => p.id === presetId);
                if (target) {
                    target.data = { json: currentData.json };
                }
                dirtyTracker.setBaseline(currentData);
                Toast.success('工作流预设已保存');
            } else if (action === 'reset') {
                const base = rawPresets.find((p) => p.id === presetId);
                const resetJson = base?.data?.json ?? '{}';
                currentData = { json: resetJson };
                syncControls(currentData);
                dirtyTracker.setBaseline(currentData);
            }

            options.onAction?.(action, presetId, currentData);
        }
    });
    disposers.push(() => toolbar.dispose());
    card.append(toolbar.element);

    // 6. 操作栏：[ 格式化变量 ] 与 [ 打开蓝图 ]
    const actionsBar = document.createElement('div');
    actionsBar.className = 'da-workflow-card__actions-bar';

    const actionsTitle = document.createElement('div');
    actionsTitle.className = 'da-workflow-card__actions-title';
    actionsTitle.innerHTML = `<span>工作流 JSON 定义</span>`;

    const actionsBtns = document.createElement('div');
    actionsBtns.className = 'da-workflow-card__actions-btns';

    const formatBtn: ButtonHandle = createButton({
        text: '格式化变量',
        variant: 'secondary',
        size: 'sm',
        icon: 'refresh',
        onClick: () => {
            openWorkflowFormatModal(
                currentData.json,
                (formatted) => {
                    currentData.json = formatted;
                    jsonInput.setValue(formatted);
                    dirtyTracker.notifyFieldChange('json', formatted);
                    checkJsonState(formatted);
                    options.onChange?.(currentData);
                },
                options.onOpenBlueprint
            );
        }
    });
    disposers.push(() => formatBtn.dispose());

    const blueprintBtn: ButtonHandle = createButton({
        text: '打开蓝图',
        title: '查看详细工作流蓝图或在线编辑',
        variant: 'secondary',
        size: 'sm',
        icon: 'external',
        onClick: () => {
            options.onOpenBlueprint?.(currentData.json);
        }
    });
    disposers.push(() => blueprintBtn.dispose());

    actionsBtns.appendChild(formatBtn.element);
    actionsBtns.appendChild(blueprintBtn.element);

    actionsBar.appendChild(actionsTitle);
    actionsBar.appendChild(actionsBtns);
    card.append(actionsBar);

    // 7. 工作流 JSON 代码查看/编辑域
    const editorRow = document.createElement('div');
    editorRow.className = 'da-workflow-card__editor-row';

    const checkJsonState = (val: string) => {
        const trimmed = (val || '').trim();
        if (!trimmed) {
            jsonInput.element.classList.remove('is-invalid');
            jsonInput.element.removeAttribute('title');
            return;
        }

        try {
            JSON.parse(trimmed);
            jsonInput.element.classList.remove('is-invalid');
            jsonInput.element.removeAttribute('title');
        } catch (err: any) {
            jsonInput.element.classList.add('is-invalid');
            jsonInput.element.title = `已失效：JSON 语法错误 (${err?.message || err})`;
        }
    };

    const jsonInput: TextareaHandle = createTextarea({
        value: currentData.json,
        placeholder: '{\n  "3": {\n    "class_type": "KSampler",\n    "inputs": { "seed": "%seed%", "steps": "%steps%" }\n  }\n}',
        rows: 7,
        onChange: (val) => {
            currentData.json = val;
            dirtyTracker.notifyFieldChange('json', val);
            checkJsonState(val);
            options.onChange?.(currentData);
        }
    });
    jsonInput.element.classList.add('da-workflow-json-editor');
    disposers.push(() => jsonInput.dispose?.());
    checkJsonState(currentData.json);

    editorRow.appendChild(jsonInput.element);
    card.append(editorRow);

    const syncControls = (data: WorkflowPresetData) => {
        jsonInput.setValue(data.json || '');
        checkJsonState(data.json || '');
    };

    return {
        element: card.element,
        toolbar,
        getValue(): WorkflowPresetData {
            return { ...currentData };
        },
        setValue(val: Partial<WorkflowPresetData>): void {
            currentData = {
                ...currentData,
                ...val
            };
            syncControls(currentData);
            dirtyTracker.setBaseline(currentData);
        },
        setPresets(presets: PresetItem<{ json: string }>[], activeId?: string): void {
            rawPresets = presets;
            if (activeId) currentPresetId = activeId;
            toolbar.setPresets(toPresetToolbarItems(rawPresets), currentPresetId);
            const found = rawPresets.find((p) => p.id === currentPresetId);
            if (found?.data?.json) {
                currentData.json = found.data.json;
                syncControls(currentData);
                dirtyTracker.setBaseline(currentData);
            }
        },
        setBaseline(data: WorkflowPresetData): void {
            currentData = { ...data };
            dirtyTracker.setBaseline(currentData);
            toolbar.setDirty(false);
        },
        isDirty(): boolean {
            return dirtyTracker.isDirty();
        },
        dispose(): void {
            disposers.forEach((d) => d());
            disposers.length = 0;
        }
    };
}
