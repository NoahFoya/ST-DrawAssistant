/**
 * 提示词预设方案管理器独立组件 (PromptPresetManager)
 * 集中管理正向前缀、正向后缀、通用负向提示词及关联的 LoRA 列表
 */

import { IDisposable, DisposableStore } from '../../types';
import { FeedbackService } from '../feedback/feedback';
import {
    createCard,
    createCardHeader,
    createRow,
    createCol,
    createFieldLabel
} from '../layout/container-factory';
import {
    createTextInput,
    createTextarea,
    TextInputHandle,
    TextareaHandle
} from './input-controls';
import {
    bindPresetToolbar,
    createPresetStoreAdapter,
    PresetItem,
    PresetToolbarElement
} from './preset-toolbar';
import {
    createLoraManagerControl,
    LoraItem,
    LoraManagerElement
} from './lora-manager';

export interface PromptProfileData {
    promptPrefix?: string;
    promptSuffix?: string;
    negativePrompt?: string;
    loras?: LoraItem[];
    [key: string]: unknown;
}

export interface PromptPresetManagerOptions {
    title?: string;
    getProfiles: () => PresetItem<PromptProfileData>[];
    getCurrentProfileId: () => string;
    cachedLoras?: string[];
    /** 是否展示附加权重参数 (ComfyUI 为 true，SD-WebUI 为 false) */
    showExtraWeights?: boolean;
    /** 是否启用 LoRA 管理区域 (NovelAI 等云端后端传 false，默认为 true) */
    enableLora?: boolean;
    onProfilesChange: (profiles: PresetItem<PromptProfileData>[], activeId: string) => void;
    onDataChange?: (activeData: PromptProfileData) => void;
}

export interface PromptPresetManagerHandle extends HTMLElement, IDisposable {
    readonly toolbar: PresetToolbarElement;
    refresh: () => void;
    updateCachedLoras: (cached: string[]) => void;
    getData: () => PromptProfileData;
    updateForProfile: (data?: PromptProfileData) => void;
}

/**
 * 创建通用独立的提示词预设方案管理器组件
 */
export function createPromptPresetManager(options: PromptPresetManagerOptions): PromptPresetManagerHandle {
    const card = createCard({ hoverable: true });
    const header = createCardHeader({ title: options.title || '提示词预设管理器' });
    card.header.appendChild(header);

    let prefixInput: TextInputHandle;
    let suffixInput: TextInputHandle;
    let negativeInput: TextareaHandle;
    let loraManagerEl: LoraManagerElement | null = null;
    let currentCachedLoras = [...(options.cachedLoras || [])];
    const isExtraWeights = options.showExtraWeights !== false;
    const isLoraEnabled = options.enableLora !== false;

    const getActiveProfile = (): PresetItem<PromptProfileData> | undefined => {
        const list = options.getProfiles();
        const activeId = options.getCurrentProfileId();
        return list.find((p) => p.id === activeId) || list[0];
    };

    // 方案基准快照 (用于判断表单是否有未保存的草稿修改)
    let activeBaseline: PromptProfileData = JSON.parse(JSON.stringify(getActiveProfile()?.data || {}));

    const getCurrentDraftData = (): PromptProfileData => {
        const active = getActiveProfile();
        return {
            promptPrefix: prefixInput ? prefixInput.getValue() : (active?.data?.promptPrefix || ''),
            promptSuffix: suffixInput ? suffixInput.getValue() : (active?.data?.promptSuffix || ''),
            negativePrompt: negativeInput ? negativeInput.getValue() : (active?.data?.negativePrompt || ''),
            loras: loraManagerEl ? loraManagerEl.getLoras() : (active?.data?.loras || [])
        };
    };

    const isDataEqual = (a?: PromptProfileData, b?: PromptProfileData): boolean => {
        return JSON.stringify(a || {}) === JSON.stringify(b || {});
    };

    const checkDirty = () => {
        const draft = getCurrentDraftData();
        const isDirty = !isDataEqual(draft, activeBaseline);
        toolbar.setDirty?.(isDirty);
    };

    const applyProfileToUI = (data?: PromptProfileData) => {
        const prefix = data?.promptPrefix || '';
        const suffix = data?.promptSuffix || '';
        const negative = data?.negativePrompt || '';
        const loras = data?.loras || [];

        if (prefixInput) prefixInput.setValue(prefix);
        if (suffixInput) suffixInput.setValue(suffix);
        if (negativeInput) negativeInput.setValue(negative);
        if (loraManagerEl) {
            loraManagerEl.update?.(loras, currentCachedLoras, isExtraWeights);
        }
    };

    // 1. 方案管理工具栏
    const toolbar = bindPresetToolbar<PromptProfileData>({
        adapter: createPresetStoreAdapter<PromptProfileData>({
            category: 'prompts',
            label: '提示词',
            getPresets: () => options.getProfiles(),
            getActiveId: () => options.getCurrentProfileId(),
            onPresetsChange: (presets, activeId) => {
                options.onProfilesChange(presets, activeId);
            },
            onApply: (preset) => {
                activeBaseline = JSON.parse(JSON.stringify(preset.data || {}));
                applyProfileToUI(preset.data);
                toolbar.setDirty?.(false);
                if (preset.data) {
                    options.onDataChange?.(preset.data);
                }
            }
        }),
        getCurrentData: () => getCurrentDraftData(),
        onBeforeSelect: async (_newId) => {
            if (toolbar.isDirty?.()) {
                return await FeedbackService.confirm({
                    title: '未保存修改提示',
                    message: '当前提示词预设方案有未保存的修改，切换将放弃修改，是否继续？',
                    confirmText: '放弃修改并切换'
                });
            }
            return true;
        },
        onResetOverride: () => {
            applyProfileToUI(activeBaseline);
            toolbar.setDirty?.(false);
        }
    });

    card.body.appendChild(toolbar);

    // 初始活跃方案数据
    const initialActive = getActiveProfile()?.data;

    const disposables = new DisposableStore();

    // 2. 正向提示词前缀
    const prefixRow = createRow(['left', 'right'], { align: 'center', divided: true });
    prefixRow.slots[0].appendChild(createFieldLabel({
        title: '正向提示词前缀',
        description: '自动置于生成提示词最前方的通用起手式'
    }));
    prefixInput = createTextInput({
        value: initialActive?.promptPrefix || '',
        placeholder: 'masterpiece, best quality, ...',
        onChange: () => checkDirty()
    });
    disposables.add(prefixInput);
    prefixRow.slots[1].appendChild(prefixInput);
    card.body.appendChild(prefixRow.root);

    // 3. 正向提示词后缀
    const suffixRow = createRow(['left', 'right'], { align: 'center', divided: true });
    suffixRow.slots[0].appendChild(createFieldLabel({
        title: '正向提示词后缀',
        description: '自动置于生成提示词最末尾的修饰词'
    }));
    suffixInput = createTextInput({
        value: initialActive?.promptSuffix || '',
        placeholder: 'highly detailed, ...',
        onChange: () => checkDirty()
    });
    disposables.add(suffixInput);
    suffixRow.slots[1].appendChild(suffixInput);
    card.body.appendChild(suffixRow.root);

    // 4. 通用负向提示词
    const negCol = createCol(2, { gap: '6px' });
    negCol.root.classList.add('da-row--divided');
    negCol.slots[0].appendChild(createFieldLabel({
        title: '通用负向提示词',
        description: '统一生效的负向过滤词，出图时自动合并'
    }));
    negativeInput = createTextarea({
        value: initialActive?.negativePrompt || '',
        placeholder: 'lowres, bad anatomy, bad hands, ...',
        rows: 3,
        onChange: () => checkDirty()
    });
    disposables.add(negativeInput);
    negCol.slots[1].appendChild(negativeInput);
    card.body.appendChild(negCol.root);

    // 5. LoRA 模型列表管理 (按需渲染)
    if (isLoraEnabled) {
        const loraWrapper = createCol(2, { gap: '6px' });
        loraWrapper.root.classList.add('da-row--divided');
        loraWrapper.slots[0].appendChild(createFieldLabel({
            title: 'LoRA 模型',
            description: '提示词预设方案绑定的 LoRA 模型与权重配置'
        }));

        loraManagerEl = createLoraManagerControl({
            loras: initialActive?.loras || [],
            cachedLoras: currentCachedLoras,
            showExtraWeights: isExtraWeights,
            onChange: () => checkDirty()
        });

        loraWrapper.slots[1].appendChild(loraManagerEl);
        card.body.appendChild(loraWrapper.root);
    }

    const handle: PromptPresetManagerHandle = Object.assign(card.root, {
        toolbar,
        refresh: () => {
            const active = getActiveProfile();
            activeBaseline = JSON.parse(JSON.stringify(active?.data || {}));
            applyProfileToUI(active?.data);
            toolbar.refreshPresets?.(options.getProfiles(), options.getCurrentProfileId());
            toolbar.setDirty?.(false);
        },
        updateCachedLoras: (cached: string[]) => {
            currentCachedLoras = [...cached];
            if (loraManagerEl) {
                const currentData = getCurrentDraftData();
                loraManagerEl.update?.(
                    currentData.loras || [],
                    currentCachedLoras,
                    isExtraWeights
                );
            }
        },
        getData: () => getCurrentDraftData(),
        updateForProfile: (data?: PromptProfileData) => applyProfileToUI(data),
        dispose: () => {
            disposables.dispose();
            card.root.remove();
        }
    });

    return handle;
}
