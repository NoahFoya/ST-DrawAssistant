/**
 * @module src/ui/composite/prompt-preset-manager
 * @description 提示词预设方案管理器卡片 (PromptPresetManager)
 *
 * 核心功能：
 * 1. 统一管理正向修饰词前缀、后缀与通用负向词模板；
 * 2. 集成 LoRA 模型管理控件，支持权重调节与按引擎按需显隐；
 * 3. 联动预设工具栏，支持提示词方案的切换、重命名、另存为与出厂重置；
 * 4. 内置表单脏状态追踪，编辑内容变更时自动同步保存状态。
 *
 * 注意事项：
 * 1. 不同引擎（如 NovelAI vs SD-WebUI）对 LoRA 的支持机制不同，需根据引擎特性动态适配展示；
 * 2. 预设切换或重置时应先比对当前表单是否存在未保存的脏状态，防止意外丢弃用户修改。
 */

import { PresetItem } from '@types';
import type { LoraItemModel, PresetActionType } from '@types';
import { createCard } from '../components/form-field';
import { createTextarea, TextareaHandle } from '../components/input';
import { createFormField, FormFieldHandle } from '../components/form-field';
import { createPresetToolbar, PresetToolbarHandle, PresetToolbarItem } from './preset-toolbar';
import { createLoraManager, LoraManagerHandle } from './lora-manager';
import { createDirtyTracker, IDirtyTracker } from '../components/dirty-tracker';
import { getIconSvg } from '../components/icons';

export interface PromptPresetData extends Record<string, any> {
    positivePrefix: string;
    positiveSuffix: string;
    negativePrompt: string;
    loras?: LoraItemModel[];
}

export interface PromptPresetManagerOptions {
    presets: PresetItem<PromptPresetData>[];
    activePresetId: string;
    value?: Partial<PromptPresetData>;
    showLora?: boolean;
    backendMode?: 'comfyui' | 'sdwebui';
    availableLoras?: string[];
    onAction?: (action: PresetActionType, presetId: string, data?: PromptPresetData) => void;
    onChange?: (data: PromptPresetData) => void;
    className?: string;
}

export interface PromptPresetManagerHandle {
    readonly element: HTMLElement;
    readonly toolbar: PresetToolbarHandle;
    readonly loraManager: LoraManagerHandle | null;
    getValue(): PromptPresetData;
    setValue(val: Partial<PromptPresetData>): void;
    setPresets(presets: PresetItem<PromptPresetData>[], activeId?: string): void;
    setBackendMode(mode: 'comfyui' | 'sdwebui'): void;
    setAvailableLoras(loras: string[]): void;
    setBaseline(data: PromptPresetData): void;
    isDirty(): boolean;
    dispose(): void;
}

export function createPromptPresetManager(options: PromptPresetManagerOptions): PromptPresetManagerHandle {
    const showLora = options.showLora !== false;
    const disposers: (() => void)[] = [];

    // 1. 卡片外壳
    const card = createCard({
        title: '提示词预设管理器',
        iconSvg: getIconSvg('palette'),
        collapsible: true
    });
    card.element.classList.add('da-prompt-preset-manager');
    if (options.className) card.element.classList.add(options.className);
    disposers.push(() => card.dispose());

    // 2. 当前数据模型与基准快照
    let currentData: PromptPresetData = {
        positivePrefix: options.value?.positivePrefix || '',
        positiveSuffix: options.value?.positiveSuffix || '',
        negativePrompt: options.value?.negativePrompt || '',
        loras: options.value?.loras ? options.value.loras.map((l) => ({ ...l })) : []
    };

    // 3. 构造预设列表选项
    const toPresetToolbarItems = (items: PresetItem<PromptPresetData>[]): PresetToolbarItem[] =>
        items.map((p) => ({
            id: p.id,
            name: p.name,
            isBuiltin: p.isBuiltin
        }));

    let rawPresets = options.presets || [];
    let currentPresetId = options.activePresetId || (rawPresets[0]?.id ?? 'default');

    // 4. 表单脏状态追踪器
    const dirtyTracker: IDirtyTracker<PromptPresetData> = createDirtyTracker(currentData, (isDirty) => {
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
                if (found && found.data) {
                    currentData = {
                        positivePrefix: found.data.positivePrefix || '',
                        positiveSuffix: found.data.positiveSuffix || '',
                        negativePrompt: found.data.negativePrompt || '',
                        loras: found.data.loras ? found.data.loras.map((l) => ({ ...l })) : []
                    };
                    syncControls(currentData);
                    dirtyTracker.setBaseline(currentData);
                }
            } else if (action === 'save') {
                dirtyTracker.setBaseline(currentData);
            } else if (action === 'reset') {
                const base = dirtyTracker.getBaseline();
                currentData = {
                    positivePrefix: base.positivePrefix || '',
                    positiveSuffix: base.positiveSuffix || '',
                    negativePrompt: base.negativePrompt || '',
                    loras: base.loras ? base.loras.map((l) => ({ ...l })) : []
                };
                syncControls(currentData);
                dirtyTracker.setBaseline(currentData);
            }

            options.onAction?.(action, presetId, currentData);
        }
    });
    disposers.push(() => toolbar.dispose());
    card.append(toolbar.element);

    // 6. 正向提示词前缀 Textarea
    const prefixInput: TextareaHandle = createTextarea({
        value: currentData.positivePrefix,
        placeholder: 'masterpiece, best quality, ultra-detailed, cinematic lighting...',
        rows: 2,
        onChange: (val) => {
            currentData.positivePrefix = val;
            dirtyTracker.notifyFieldChange('positivePrefix', val);
            options.onChange?.(currentData);
        }
    });
    disposers.push(() => prefixInput.dispose?.());
    const prefixField: FormFieldHandle = createFormField({
        label: '正向提示词前缀',
        helpText: '常驻在主体描述词之前的画质、风格与通用修饰词',
        control: prefixInput
    });
    disposers.push(() => prefixField.dispose?.());
    card.append(prefixField);

    // 7. 正向提示词后缀 Textarea
    const suffixInput: TextareaHandle = createTextarea({
        value: currentData.positiveSuffix,
        placeholder: '8k wallpaper, highly detailed illustration...',
        rows: 2,
        onChange: (val) => {
            currentData.positiveSuffix = val;
            dirtyTracker.notifyFieldChange('positiveSuffix', val);
            options.onChange?.(currentData);
        }
    });
    disposers.push(() => suffixInput.dispose?.());
    const suffixField: FormFieldHandle = createFormField({
        label: '正向提示词后缀',
        helpText: '常驻在主体描述词之后的通用细节强化与附加描述词',
        control: suffixInput
    });
    disposers.push(() => suffixField.dispose?.());
    card.append(suffixField);

    // 8. 通用负向提示词 Textarea
    const negInput: TextareaHandle = createTextarea({
        value: currentData.negativePrompt,
        placeholder: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, cropped...',
        rows: 3,
        onChange: (val) => {
            currentData.negativePrompt = val;
            dirtyTracker.notifyFieldChange('negativePrompt', val);
            options.onChange?.(currentData);
        }
    });
    disposers.push(() => negInput.dispose?.());
    const negField: FormFieldHandle = createFormField({
        label: '负向提示词',
        helpText: '生成时自动注入的基础过滤词，抑制畸变、水印及低画质特征',
        control: negInput
    });
    disposers.push(() => negField.dispose?.());
    card.append(negField);

    // 9. 内嵌 LoRA 管理器 (按需显示)
    let loraManager: LoraManagerHandle | null = null;
    if (showLora) {
        loraManager = createLoraManager({
            loras: currentData.loras || [],
            backendMode: options.backendMode,
            availableLoras: options.availableLoras,
            onChange: (loras) => {
                currentData.loras = loras.map((l) => ({ ...l }));
                dirtyTracker.notifyFieldChange('loras', currentData.loras);
                options.onChange?.(currentData);
            }
        });
        disposers.push(() => loraManager?.dispose());
        card.append(loraManager.element);
    }

    const syncControls = (data: PromptPresetData) => {
        prefixInput.setValue(data.positivePrefix);
        suffixInput.setValue(data.positiveSuffix);
        negInput.setValue(data.negativePrompt);
        if (loraManager && data.loras) {
            loraManager.setLoras(data.loras);
        }
    };

    return {
        element: card.element,
        toolbar,
        loraManager,
        getValue(): PromptPresetData {
            return {
                ...currentData,
                loras: currentData.loras ? currentData.loras.map((l) => ({ ...l })) : []
            };
        },
        setValue(val: Partial<PromptPresetData>): void {
            if (val.positivePrefix !== undefined) currentData.positivePrefix = val.positivePrefix;
            if (val.positiveSuffix !== undefined) currentData.positiveSuffix = val.positiveSuffix;
            if (val.negativePrompt !== undefined) currentData.negativePrompt = val.negativePrompt;
            if (val.loras !== undefined) currentData.loras = val.loras.map((l) => ({ ...l }));
            syncControls(currentData);
            dirtyTracker.setBaseline(currentData);
        },
        setPresets(presets: PresetItem<PromptPresetData>[], activeId?: string): void {
            rawPresets = presets;
            toolbar.setPresets(toPresetToolbarItems(rawPresets));
            if (activeId) {
                currentPresetId = activeId;
                toolbar.setActivePreset(activeId);
            }
        },
        setBackendMode(mode: 'comfyui' | 'sdwebui'): void {
            if (loraManager) {
                loraManager.setBackendMode(mode);
            }
        },
        setAvailableLoras(loras: string[]): void {
            if (loraManager) {
                loraManager.setAvailableLoras(loras);
            }
        },
        setBaseline(data: PromptPresetData): void {
            currentData = {
                ...data,
                loras: data.loras ? data.loras.map((l) => ({ ...l })) : []
            };
            dirtyTracker.setBaseline(currentData);
            syncControls(currentData);
        },
        isDirty(): boolean {
            return dirtyTracker.isDirty();
        },
        dispose(): void {
            for (const d of disposers) {
                d();
            }
        }
    };
}
