/**
 * 提示词预设管理卡片 (PromptPresetCard)。
 *
 * @remarks
 * 基于 Preact JSX 负责提示词与 LoRA 预设的管理与编辑：
 * 1. 管理正向提示词前缀、后缀与负向提示词（附带宏语法联想自动补全）；
 * 2. 呈现已挂载 LoRA 模型的胶囊概要（支持快速启停、移除及独立弹窗配置）；
 * 3. 支持受控 (`value` + `dirty`) 与独立运行两种模式，响应配置变更与预设工具栏操作。
 */

import type { VNode } from 'preact';
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { CardView } from '../framework/controls';
import { renderIcon } from '../components/icons';
import {
    PresetToolbar,
    type PresetToolbarItem,
    type PresetActionType,
} from './preset-toolbar';
import type { LoraEntryItem } from './lora-manager';
import { openLoraModal } from '../modal/lora-modal';
import { attachTagAutocomplete, type TagAutocomplete } from './tag-autocomplete';
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { DEFAULT_LORA_WEIGHTS } from '../../domain/lora/lora-syntax';

/** 提示词卡片表单数据模型 */
export interface PromptCardData {
    positivePrefix: string;
    positiveSuffix: string;
    negativePrompt: string;
    loras: LoraEntryItem[];
}

/** 提示词预设条目 */
export interface PromptCardPresetItem {
    id: string;
    name: string;
    data: PromptCardData;
}

/** 提示词预设卡片组件属性 */
export interface PromptPresetCardProps {
    /** 预设列表 */
    presets: PromptCardPresetItem[];
    /** 当前激活的预设 ID */
    activePresetId: string;
    /** 受控/初始表单数据覆盖 */
    value?: Partial<PromptCardData>;
    /** 受控脏状态（提供时由外部状态模型托管基线与脏状态） */
    dirty?: boolean;
    /** 是否展示 LoRA 挂载概要与管理入口，默认 true */
    showLora?: boolean;
    /** 是否展示负向提示词输入框，默认 true */
    showNegativePrompt?: boolean;
    /** 可选 LoRA 模型列表 */
    availableModels?: string[];
    /** 预设操作回调 */
    onAction?: (
        action: PresetActionType,
        presetId: string,
        data?: PromptCardData
    ) => void | boolean | Promise<void | boolean>;
    /** 批量/多文件导入自定义解析回调 */
    onImportFiles?: (files: File[]) => void;
    /** 表单内容变更回调 */
    onChange?: (data: PromptCardData) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

export type PromptPresetCardOptions = PromptPresetCardProps;

export function clonePromptCardData(data?: Partial<PromptCardData>): PromptCardData {
    return {
        positivePrefix: data?.positivePrefix || '',
        positiveSuffix: data?.positiveSuffix || '',
        negativePrompt: data?.negativePrompt || '',
        loras: data?.loras ? data.loras.map((l) => ({ ...l })) : [],
    };
}

export function arePromptCardDataEqual(a: PromptCardData, b: PromptCardData): boolean {
    if (a.positivePrefix !== b.positivePrefix) return false;
    if (a.positiveSuffix !== b.positiveSuffix) return false;
    if (a.negativePrompt !== b.negativePrompt) return false;

    const aLoras = a.loras || [];
    const bLoras = b.loras || [];
    if (aLoras.length !== bLoras.length) return false;

    for (let i = 0; i < aLoras.length; i++) {
        const c = aLoras[i];
        const base = bLoras[i];
        if (c.id !== base.id || c.enabled !== base.enabled || c.modelName !== base.modelName) {
            return false;
        }
        if (c.modelWeight !== base.modelWeight || c.clipWeight !== base.clipWeight) {
            return false;
        }
        if (c.triggerWeight !== base.triggerWeight) return false;
        if ((c.triggerMode ?? 'always') !== (base.triggerMode ?? 'always')) return false;
        if ((c.keywords ?? '') !== (base.keywords ?? '')) return false;
    }

    return true;
}

function resolvePromptSelection(
    presets: PromptCardPresetItem[],
    requestedActiveId: string
): { activeId: string; found?: PromptCardPresetItem } {
    let targetId = requestedActiveId || '';
    let found = presets.find((p) => p.id === targetId);
    if (!found && presets.length > 0) {
        targetId = presets[0].id;
        found = presets[0];
    }
    return { activeId: targetId || '', found };
}

export function PromptPresetCard(props: PromptPresetCardProps): VNode {
    const isControlled = props.dirty !== undefined && props.value !== undefined;
    const showLora = props.showLora !== false;
    const showNegativePrompt = props.showNegativePrompt !== false;
    const availableModels = props.availableModels || [];

    const initialSelection = resolvePromptSelection(props.presets, props.activePresetId);
    const initialBaseline = clonePromptCardData(initialSelection.found?.data);
    const initialCurrent = props.value
        ? {
              positivePrefix: props.value.positivePrefix ?? initialBaseline.positivePrefix,
              positiveSuffix: props.value.positiveSuffix ?? initialBaseline.positiveSuffix,
              negativePrompt: props.value.negativePrompt ?? initialBaseline.negativePrompt,
              loras: props.value.loras
                  ? props.value.loras.map((l) => ({ ...l }))
                  : initialBaseline.loras,
          }
        : clonePromptCardData(initialBaseline);

    const [, setTick] = useState(0);
    const standaloneRef = useRef<{
        activeId: string;
        current: PromptCardData;
        baseline: PromptCardData;
    } | null>(null);
    if (!standaloneRef.current) {
        standaloneRef.current = {
            activeId: initialSelection.activeId,
            current: initialCurrent,
            baseline: clonePromptCardData(initialCurrent),
        };
    }

    const prevSyncSigRef = useRef<string>(
        JSON.stringify({ presets: props.presets, activeId: props.activePresetId })
    );
    const propsRef = useRef(props);
    propsRef.current = props;

    // 独立运行模式下，当外部传入预设池或激活 ID 变化时同步（直接更新 ref 避免渲染期间调用 setState）
    const nextSyncSig = JSON.stringify({
        presets: props.presets,
        activeId: props.activePresetId,
    });
    if (!isControlled && nextSyncSig !== prevSyncSigRef.current) {
        prevSyncSigRef.current = nextSyncSig;
        const sel = resolvePromptSelection(props.presets, props.activePresetId);
        const curState = standaloneRef.current;
        const wasDirty = !arePromptCardDataEqual(curState.current, curState.baseline);

        if (sel.found && wasDirty && sel.activeId === curState.activeId) {
            // 同 preset 池刷新时保留用户未保存草稿
        } else if (sel.found) {
            const nextData = clonePromptCardData(sel.found.data);
            standaloneRef.current = {
                activeId: sel.activeId,
                current: nextData,
                baseline: clonePromptCardData(nextData),
            };
        } else {
            const empty = clonePromptCardData();
            standaloneRef.current = {
                activeId: sel.activeId,
                current: empty,
                baseline: clonePromptCardData(empty),
            };
        }
    }

    const setStandaloneState = (nextState: {
        activeId: string;
        current: PromptCardData;
        baseline: PromptCardData;
    }) => {
        standaloneRef.current = nextState;
        setTick((n) => n + 1);
    };

    const standaloneState = standaloneRef.current;

    const resolvedActiveId = isControlled
        ? resolvePromptSelection(props.presets, props.activePresetId).activeId
        : standaloneState.activeId;
    const displayData: PromptCardData = isControlled
        ? clonePromptCardData(props.value)
        : standaloneState.current;
    const isDirty = isControlled
        ? Boolean(props.dirty)
        : !arePromptCardDataEqual(standaloneState.current, standaloneState.baseline);

    const prefixRef = useRef<HTMLTextAreaElement | null>(null);
    const suffixRef = useRef<HTMLTextAreaElement | null>(null);
    const negRef = useRef<HTMLTextAreaElement | null>(null);
    const autocompletesRef = useRef<TagAutocomplete[]>([]);

    useEffect(() => {
        const list: TagAutocomplete[] = [];
        if (prefixRef.current) {
            list.push(attachTagAutocomplete(prefixRef.current, { mode: 'prompt-with-macro' }));
        }
        if (suffixRef.current) {
            list.push(attachTagAutocomplete(suffixRef.current, { mode: 'prompt-with-macro' }));
        }
        if (negRef.current) {
            list.push(attachTagAutocomplete(negRef.current, { mode: 'prompt-with-macro' }));
        }
        autocompletesRef.current = list;
        return () => {
            for (const ac of list) {
                ac.dispose();
            }
            autocompletesRef.current = [];
        };
    }, []);

    useLayoutEffect(() => {
        for (const ac of autocompletesRef.current) {
            ac.refreshMacroStatus();
        }
    }, [displayData.positivePrefix, displayData.positiveSuffix, displayData.negativePrompt]);

    const commitDataEdit = (nextData: PromptCardData) => {
        const copy = clonePromptCardData(nextData);
        if (!isControlled) {
            setStandaloneState({
                ...standaloneRef.current!,
                current: copy,
            });
        }
        propsRef.current.onChange?.(clonePromptCardData(copy));
    };

    const handlePresetAction = async (
        action: PresetActionType,
        presetId: string
    ): Promise<boolean> => {
        const curProps = propsRef.current;
        const prevStandalone = standaloneRef.current!;
        const currentlyDirty = isControlled
            ? Boolean(curProps.dirty)
            : !arePromptCardDataEqual(prevStandalone.current, prevStandalone.baseline);
        let mutatedState = false;

        if (action === 'new') {
            if (currentlyDirty) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '新建提示词预设确认',
                    message: '当前提示词预设存在未保存的修改，新建将放弃未保存的修改。是否确定继续新建？',
                });
                if (!confirmed) return false;
            }
        } else if (action === 'select') {
            const activeTargetId = isControlled ? resolvedActiveId : prevStandalone.activeId;
            if (presetId !== activeTargetId && currentlyDirty) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '切换提示词预设确认',
                    message: '当前提示词预设存在未保存的修改，切换将放弃未保存的修改。是否确定继续切换？',
                });
                if (!confirmed) return false;
            }
            if (!isControlled) {
                const found = curProps.presets.find((p) => p.id === presetId);
                const nextData = found?.data
                    ? clonePromptCardData(found.data)
                    : clonePromptCardData(prevStandalone.current);
                const nextState = {
                    activeId: presetId,
                    current: nextData,
                    baseline: found?.data ? clonePromptCardData(found.data) : prevStandalone.baseline,
                };
                standaloneRef.current = nextState;
                setStandaloneState(nextState);
                curProps.onChange?.(clonePromptCardData(nextData));
                mutatedState = true;
            }
        } else if (action === 'reset') {
            if (currentlyDirty) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '重置修改确认',
                    message: '确定要放弃当前未保存的提示词修改并恢复初始状态吗？',
                });
                if (!confirmed) return false;
            }
            if (!isControlled) {
                const base =
                    curProps.presets.find((p) => p.id === prevStandalone.activeId)?.data ??
                    prevStandalone.baseline;
                const restored = clonePromptCardData(base);
                const nextState = {
                    activeId: prevStandalone.activeId,
                    current: restored,
                    baseline: clonePromptCardData(restored),
                };
                standaloneRef.current = nextState;
                setStandaloneState(nextState);
                curProps.onChange?.(clonePromptCardData(restored));
                mutatedState = true;
            }
        }

        const payload = isControlled
            ? clonePromptCardData(curProps.value)
            : clonePromptCardData(standaloneRef.current!.current);
        const result = await curProps.onAction?.(action, presetId, payload);
        if (result === false) {
            if (mutatedState && !isControlled) {
                setStandaloneState(prevStandalone);
                curProps.onChange?.(clonePromptCardData(prevStandalone.current));
            }
            return false;
        }

        if (!isControlled && (action === 'save' || action === 'saveAs')) {
            const committed = clonePromptCardData(standaloneRef.current!.current);
            setStandaloneState({
                ...standaloneRef.current!,
                baseline: committed,
            });
        }

        return true;
    };

    const toolbarItems: PresetToolbarItem[] = props.presets.map((p) => ({
        id: p.id,
        name: p.name,
    }));

    const cardClasses = [
        'da-prompt-preset-card',
        'da-prompt-preset-manager',
        props.className || '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <CardView title="提示词预设" className={cardClasses}>
            <PresetToolbar
                presets={toolbarItems}
                activePresetId={resolvedActiveId}
                dirty={isDirty}
                onAction={(action, presetId) => handlePresetAction(action, presetId)}
                onImportFiles={props.onImportFiles}
            />

            <div className="da-textarea-row">
                <div className="da-textarea-header">
                    <label className="da-field-label">正向提示词前缀</label>
                    <span className="da-field-help">
                        常驻在主体描述词之前的画质、风格与通用修饰词
                    </span>
                </div>
                <textarea
                    ref={prefixRef}
                    className="da-textarea"
                    rows={2}
                    value={displayData.positivePrefix}
                    onInput={(e) => {
                        const value = (e.currentTarget as HTMLTextAreaElement).value;
                        commitDataEdit({
                            ...displayData,
                            positivePrefix: value,
                        });
                    }}
                />
            </div>

            <div className="da-textarea-row">
                <div className="da-textarea-header">
                    <label className="da-field-label">正向提示词后缀</label>
                    <span className="da-field-help">
                        常驻在主体描述词之后的通用细节强化与附加描述词
                    </span>
                </div>
                <textarea
                    ref={suffixRef}
                    className="da-textarea"
                    rows={2}
                    value={displayData.positiveSuffix}
                    onInput={(e) => {
                        const value = (e.currentTarget as HTMLTextAreaElement).value;
                        commitDataEdit({
                            ...displayData,
                            positiveSuffix: value,
                        });
                    }}
                />
            </div>

            <div
                className="da-textarea-row"
                style={showNegativePrompt ? undefined : { display: 'none' }}
            >
                <div className="da-textarea-header">
                    <label className="da-field-label">负向提示词 (Negative Prompt)</label>
                    <span className="da-field-help">
                        生成时自动注入的基础过滤词，抑制畸变、水印及低画质特征
                    </span>
                </div>
                <textarea
                    ref={negRef}
                    className="da-textarea"
                    rows={3}
                    value={displayData.negativePrompt}
                    onInput={(e) => {
                        const value = (e.currentTarget as HTMLTextAreaElement).value;
                        commitDataEdit({
                            ...displayData,
                            negativePrompt: value,
                        });
                    }}
                />
            </div>

            {showLora && (
                <div className="da-textarea-row da-prompt-lora-summary-row">
                    <div className="da-textarea-header da-prompt-lora-header">
                        <div className="da-prompt-lora-title-group">
                            <label className="da-field-label">LoRA 模型</label>
                        </div>
                        <button
                            type="button"
                            className="da-btn da-btn--secondary da-btn--sm"
                            title="打开独立模态弹窗管理 LoRA 模型与权重"
                            onClick={() => {
                                openLoraModal({
                                    availableModels,
                                    initialItems: displayData.loras,
                                    onSave: (items) => {
                                        commitDataEdit({
                                            ...displayData,
                                            loras: items.map((it) => ({ ...it })),
                                        });
                                    },
                                });
                            }}
                        >
                            管理 LoRA
                        </button>
                    </div>

                    <div className="da-prompt-lora-badges">
                        {displayData.loras.length === 0 ? (
                            <span className="da-prompt-lora-empty">
                                暂未挂载任何 LoRA（点击右上角“管理 LoRA”从服务端列表检索选择添加）
                            </span>
                        ) : (
                            displayData.loras.map((lora) => {
                                const isEnabled = lora.enabled !== false;
                                const isMissing =
                                    Boolean(lora.modelName) &&
                                    availableModels.length > 0 &&
                                    !availableModels.includes(lora.modelName);
                                const isKeywordTrigger = lora.triggerMode === 'keyword';
                                const triggerWeightText = (
                                    lora.triggerWeight ?? DEFAULT_LORA_WEIGHTS.triggerWeight
                                ).toFixed(2);

                                let tooltip = isEnabled
                                    ? `点击停用: ${lora.modelName} (Model: ${lora.modelWeight}, CLIP: ${lora.clipWeight}, Trigger: ${triggerWeightText})`
                                    : `已停用（点击重新启用）: ${lora.modelName}`;
                                if (isKeywordTrigger) {
                                    const kwDesc = (lora.keywords || '').trim() || '未填写关键词';
                                    tooltip += ` [关键词触发: ${kwDesc}]`;
                                }
                                if (isMissing) {
                                    tooltip += ' [服务端未检测到此模型]';
                                }

                                const chipClasses = [
                                    'da-lora-chip',
                                    !isEnabled ? 'is-disabled' : '',
                                    isMissing ? 'is-missing' : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ');

                                return (
                                    <div key={lora.id} className={chipClasses} title={tooltip}>
                                        <button
                                            type="button"
                                            className="da-lora-chip__main"
                                            onClick={() => {
                                                const nextLoras = displayData.loras.map((item) =>
                                                    item.id === lora.id
                                                        ? { ...item, enabled: !isEnabled }
                                                        : item
                                                );
                                                commitDataEdit({
                                                    ...displayData,
                                                    loras: nextLoras,
                                                });
                                            }}
                                        >
                                            <span className="da-lora-chip__dot" />
                                            <span className="da-lora-chip__name">
                                                {lora.modelName.replace(
                                                    /\.(safetensors|pt|ckpt|pth)$/i,
                                                    ''
                                                )}
                                            </span>
                                            <span className="da-lora-chip__weight">
                                                {lora.modelWeight === lora.clipWeight
                                                    ? `${lora.modelWeight}`
                                                    : `${lora.modelWeight}/${lora.clipWeight}`}
                                            </span>
                                            {isKeywordTrigger && (
                                                <span className="da-lora-chip__trigger">关键词</span>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            className="da-lora-chip__remove"
                                            title="移除该 LoRA"
                                            dangerouslySetInnerHTML={{
                                                __html: renderIcon('close', 11),
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                commitDataEdit({
                                                    ...displayData,
                                                    loras: displayData.loras.filter(
                                                        (it) => it.id !== lora.id
                                                    ),
                                                });
                                            }}
                                        />
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </CardView>
    );
}
