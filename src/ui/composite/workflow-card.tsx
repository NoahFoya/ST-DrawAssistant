/**
 * ComfyUI 工作流预设管理复合卡片 (WorkflowCard)。
 *
 * @remarks
 * 基于 Preact JSX 装配 CardView 与 PresetToolbar：
 * 1. 包含 ComfyUI 原生 API Prompt JSON 编辑域与实时语法合法性检测；
 * 2. 提供工作流变量分析与格式化诊断模态弹窗，并支持蓝图编辑器跳转；
 * 3. 当工作流包含 WeiLin 节点时响应式呈现按需提示条并支持关闭持久化；
 * 4. 工作流纯领域解析与变量匹配逻辑委托 `domain/provider-specs/comfyui-workflow`。
 */

import type { VNode } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { CardView, ButtonControl } from '../framework/controls';
import { renderIcon } from '../components/icons';
import {
    PresetToolbar,
    type PresetToolbarItem,
    type PresetActionType,
} from './preset-toolbar';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';
import { settingsStore } from '../../store/settings-store';
import {
    COMFYUI_VARIABLE_DEFINITIONS,
    analyzeAndReplaceWorkflowVariables,
    hasWeilinNodeInWorkflow,
    isWorkflowFieldEligibleForVariable,
    parseComfyWorkflowInput,
    type ComfyWorkflowVariableDefinition,
    type ParsedComfyWorkflowError,
    type ParsedComfyWorkflowResult,
    type UnmatchedVariableInfo,
    type VariableReplacementInfo,
    type WorkflowAnalysisResult,
} from '../../domain/provider-specs/comfyui-workflow';

export {
    COMFYUI_VARIABLE_DEFINITIONS,
    analyzeAndReplaceWorkflowVariables,
    hasWeilinNodeInWorkflow,
    isWorkflowFieldEligibleForVariable,
    parseComfyWorkflowInput,
    type ComfyWorkflowVariableDefinition,
    type ParsedComfyWorkflowError,
    type ParsedComfyWorkflowResult,
    type UnmatchedVariableInfo,
    type VariableReplacementInfo,
    type WorkflowAnalysisResult,
};

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

/** 工作流卡片组件属性 */
export interface WorkflowCardProps {
    /** 预设工作流列表 */
    presets: WorkflowCardPresetItem[];
    /** 当前激活的预设 ID */
    activePresetId: string;
    /** 受控/初始工作流数据 */
    value?: Partial<WorkflowCardData>;
    /** 受控脏状态（提供时由外部状态模型托管基线与脏状态） */
    dirty?: boolean;
    /** 预设操作动作回调 */
    onAction?: (
        action: PresetActionType,
        presetId: string,
        data?: WorkflowCardData
    ) => void | boolean | Promise<void | boolean>;
    /** 批量/多文件导入自定义解析回调 */
    onImportFiles?: (files: File[]) => void;
    /** 工作流内容变更回调 */
    onChange?: (data: WorkflowCardData) => void;
    /** 打开蓝图编辑器回调 */
    onOpenBlueprint?: (currentJson: string, activePresetId?: string) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

export type WorkflowCardOptions = WorkflowCardProps;

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
    backdrop.className = 'da-modal-backdrop st-da-root da-workflow-format-backdrop';

    const modal = document.createElement('div');
    modal.className = 'da-dialog-panel da-workflow-format-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'da-dialog-title';
    title.textContent = '工作流变量分析与格式化诊断';

    const message = document.createElement('div');
    message.className = 'da-dialog-message da-workflow-format-body';

    if (!analysis.success) {
        const errDiv = document.createElement('div');
        errDiv.className = 'da-workflow-format-error';
        errDiv.textContent = analysis.error || '解析失败';
        message.appendChild(errDiv);
    } else {
        const repCount = analysis.replaced.length;
        const unrepCount = analysis.unmatched.length;

        let html = `
            <div class="da-workflow-format-summary">
                <span>扫描完成：共识别并自动绑定 <strong>${repCount}</strong> 处模板变量，另有 <strong>${unrepCount}</strong> 项变量未自动匹配。</span>
                <span class="da-workflow-status-badge ${unrepCount === 0 ? 'da-workflow-status-badge--matched' : 'da-workflow-status-badge--unmatched'}">
                    ${unrepCount === 0 ? '全部匹配' : '部分未匹配'}
                </span>
            </div>
        `;

        if (repCount > 0) {
            html += `
                <div class="da-workflow-format-section">
                    <div class="da-workflow-format-section-title da-workflow-format-section-title--success">
                        <span>已成功自动匹配替换 (${repCount})</span>
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
            html += '</div></div>';
        }

        if (unrepCount > 0) {
            html += `
                <div class="da-workflow-format-section">
                    <div class="da-workflow-format-section-title da-workflow-format-section-title--warning">
                        <span>未自动匹配到的变量 (${unrepCount})</span>
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
            html += '</div></div>';
        }

        message.innerHTML = html;
    }

    const actions = document.createElement('div');
    actions.className = 'da-dialog-actions';

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

function resolveWorkflowSelection(
    presets: WorkflowCardPresetItem[],
    requestedActiveId: string
): { activeId: string; found?: WorkflowCardPresetItem } {
    let targetId = requestedActiveId || '';
    let found = presets.find((p) => p.id === targetId);
    if (!found && presets.length > 0) {
        targetId = presets[0].id;
        found = presets[0];
    }
    return { activeId: targetId || '', found };
}

function validateWorkflowJson(val: string): string | undefined {
    const trimmed = (val || '').trim();
    if (!trimmed) {
        return undefined;
    }
    const parsedRes = parseComfyWorkflowInput(trimmed);
    return parsedRes.ok ? undefined : `已失效：${parsedRes.error}`;
}

export function WorkflowCard(props: WorkflowCardProps): VNode {
    const isControlled = props.dirty !== undefined && props.value?.json !== undefined;

    const initialSel = resolveWorkflowSelection(props.presets, props.activePresetId);
    const initialJson = props.value?.json ?? (initialSel.found?.data?.json || '{}');

    const [, setTick] = useState(0);
    const standaloneRef = useRef<{
        activeId: string;
        json: string;
        baselineJson: string;
    } | null>(null);
    if (!standaloneRef.current) {
        standaloneRef.current = {
            activeId: initialSel.activeId,
            json: initialJson,
            baselineJson: initialJson,
        };
    }

    const prevSyncSigRef = useRef<string>(
        JSON.stringify({ presets: props.presets, activeId: props.activePresetId })
    );
    const propsRef = useRef(props);
    propsRef.current = props;

    // 独立运行模式下，预设列表或激活 ID 变化时同步（直接更新 ref 避免渲染期间调用 setState）
    const nextSyncSig = JSON.stringify({
        presets: props.presets,
        activeId: props.activePresetId,
    });
    if (!isControlled && nextSyncSig !== prevSyncSigRef.current) {
        prevSyncSigRef.current = nextSyncSig;
        const sel = resolveWorkflowSelection(props.presets, props.activePresetId);
        const curState = standaloneRef.current;
        const wasDirty = curState.json !== curState.baselineJson;

        if (sel.found?.data?.json !== undefined && wasDirty && sel.activeId === curState.activeId) {
            // 同 preset 池刷新时保留未保存草稿
        } else {
            const nextJson = sel.found?.data?.json ?? '{}';
            standaloneRef.current = {
                activeId: sel.activeId,
                json: nextJson,
                baselineJson: nextJson,
            };
        }
    }

    const setStandaloneState = (nextState: {
        activeId: string;
        json: string;
        baselineJson: string;
    }) => {
        standaloneRef.current = nextState;
        setTick((n) => n + 1);
    };

    const standaloneState = standaloneRef.current;

    const resolvedActiveId = isControlled
        ? resolveWorkflowSelection(props.presets, props.activePresetId).activeId
        : standaloneState.activeId;
    const currentJson = isControlled ? props.value?.json ?? '{}' : standaloneState.json;
    const isDirty = isControlled
        ? Boolean(props.dirty)
        : standaloneState.json !== standaloneState.baselineJson;

    const invalidTitle = validateWorkflowJson(currentJson);
    const dismissWeilinNotice = Boolean(settingsStore.signals.ui.value?.dismissWeilinNotice);
    const showWeilinNotice = !dismissWeilinNotice && hasWeilinNodeInWorkflow(currentJson);

    const commitJson = (nextJson: string) => {
        if (!isControlled) {
            setStandaloneState({
                ...standaloneRef.current!,
                json: nextJson,
            });
        }
        propsRef.current.onChange?.({ json: nextJson });
    };

    const handlePresetAction = async (
        action: PresetActionType,
        presetId: string
    ): Promise<boolean> => {
        const curProps = propsRef.current;
        const prevStandalone = standaloneRef.current!;
        const activeJson = isControlled ? curProps.value?.json ?? '{}' : prevStandalone.json;
        const currentlyDirty = isControlled
            ? Boolean(curProps.dirty)
            : prevStandalone.json !== prevStandalone.baselineJson;
        let mutatedState = false;

        if (action === 'new') {
            if (currentlyDirty) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '新建工作流确认',
                    message: '当前工作流存在未保存的修改，新建将放弃未保存的修改。是否确定继续新建？',
                });
                if (!confirmed) return false;
            }
        } else if (action === 'select') {
            const activeTargetId = isControlled ? resolvedActiveId : prevStandalone.activeId;
            if (presetId !== activeTargetId && currentlyDirty) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '切换工作流确认',
                    message: '当前工作流存在未保存的修改，切换将放弃未保存的修改。是否确定继续切换？',
                });
                if (!confirmed) return false;
            }
            if (!isControlled) {
                const found = curProps.presets.find((p) => p.id === presetId);
                const newJson = found?.data?.json ?? '{}';
                const nextState = {
                    activeId: presetId,
                    json: newJson,
                    baselineJson: newJson,
                };
                standaloneRef.current = nextState;
                setStandaloneState(nextState);
                curProps.onChange?.({ json: newJson });
                mutatedState = true;
            }
        } else if (action === 'save' || action === 'saveAs') {
            const parsedRes = parseComfyWorkflowInput((activeJson || '').trim() || '{}');
            if (!parsedRes.ok) {
                Toast.show(
                    `工作流${action === 'saveAs' ? '另存为' : '保存'}失败：${parsedRes.error}`,
                    { level: 'error' }
                );
                return false;
            }
        } else if (action === 'reset') {
            if (currentlyDirty) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '重置修改确认',
                    message: '确定要放弃当前未保存的工作流修改并恢复初始状态吗？',
                });
                if (!confirmed) return false;
            }
            if (!isControlled) {
                const base = curProps.presets.find((p) => p.id === prevStandalone.activeId);
                const resetJson = base?.data?.json ?? prevStandalone.baselineJson;
                const nextState = {
                    activeId: prevStandalone.activeId,
                    json: resetJson,
                    baselineJson: resetJson,
                };
                standaloneRef.current = nextState;
                setStandaloneState(nextState);
                curProps.onChange?.({ json: resetJson });
                mutatedState = true;
            }
        }

        const payload: WorkflowCardData = {
            json: isControlled
                ? curProps.value?.json ?? '{}'
                : standaloneRef.current!.json,
        };
        const result = await curProps.onAction?.(action, presetId, payload);
        if (result === false) {
            if (mutatedState && !isControlled) {
                setStandaloneState(prevStandalone);
                curProps.onChange?.({ json: prevStandalone.json });
            }
            return false;
        }

        if (!isControlled && (action === 'save' || action === 'saveAs')) {
            const committedJson = standaloneRef.current!.json;
            setStandaloneState({
                ...standaloneRef.current!,
                baselineJson: committedJson,
            });
        }

        return true;
    };

    const toolbarItems: PresetToolbarItem[] = props.presets.map((p) => ({
        id: p.id,
        name: p.name,
    }));

    const cardClasses = [
        'da-workflow-preset-manager',
        'da-workflow-card',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <CardView title="ComfyUI 工作流设置" className={cardClasses}>
            <PresetToolbar
                presets={toolbarItems}
                activePresetId={resolvedActiveId}
                dirty={isDirty}
                onAction={(action, presetId) => handlePresetAction(action, presetId)}
                onImportFiles={props.onImportFiles}
            />

            <div className="da-workflow-card__actions-bar">
                <div className="da-workflow-card__actions-title">工作流 JSON 定义</div>
                <div className="da-workflow-card__actions-btns">
                    <ButtonControl
                        label="格式化变量"
                        tooltip="自动识别工作流节点并替换为标准参数占位符（模型、提示词、尺寸、步数、CFG 与种子等）"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            openWorkflowFormatModal(
                                currentJson,
                                (formatted) => commitJson(formatted),
                                props.onOpenBlueprint
                                    ? (json) => props.onOpenBlueprint?.(json, resolvedActiveId)
                                    : undefined
                            );
                        }}
                    />
                    <ButtonControl
                        label="打开蓝图"
                        tooltip="查看详细工作流蓝图或在线编辑"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            props.onOpenBlueprint?.(currentJson, resolvedActiveId);
                        }}
                    />
                </div>
            </div>

            <div className="da-workflow-card__editor-row">
                <textarea
                    className={`da-textarea da-workflow-json-editor${invalidTitle ? ' is-invalid' : ''}`}
                    rows={8}
                    title={invalidTitle}
                    placeholder={'{\n  "3": {\n    "class_type": "KSampler",\n    "inputs": { "seed": "%seed%", "steps": "%steps%" }\n  }\n}'}
                    value={currentJson}
                    onInput={(e) => {
                        commitJson((e.currentTarget as HTMLTextAreaElement).value);
                    }}
                />
            </div>

            <div
                className="da-workflow-weilin-notice"
                style={{ display: showWeilinNotice ? 'flex' : 'none' }}
            >
                <span
                    className="da-workflow-weilin-notice__icon"
                    dangerouslySetInnerHTML={{ __html: renderIcon('info', 16) }}
                />
                <div className="da-workflow-weilin-notice__body">
                    <span className="da-workflow-weilin-notice__text">
                        检测到当前工作流包含 <strong>WeiLin 节点</strong>：如需使用触发词权重或 WeiLin 词库等更精细的 LoRA 控制，请确认已在 ComfyUI Manager 搜索安装 <strong>ComfyUI-WeiLin</strong>（WeiLin-Comfyui-Tools）插件，生图时会自动将 LoRA 按 &lt;wlr:...&gt; 语法传给该节点；切换为原生工作流则无需安装任何第三方插件。
                    </span>
                    <button
                        type="button"
                        className="da-workflow-weilin-notice__dismiss"
                        data-action="dismiss-weilin-notice"
                        onClick={() => {
                            const currentUi = settingsStore.get('ui');
                            settingsStore.set('ui', {
                                ...currentUi,
                                dismissWeilinNotice: true,
                            });
                        }}
                    >
                        不再显示该提示
                    </button>
                </div>
            </div>
        </CardView>
    );
}
