/**
 * 提示词预设方案管理复合卡片 (PromptPresetCard)。
 *
 * @remarks
 * 装配 Card 基础容器组件、PresetToolbar 方案工具栏与 LoraManager 复合组件：
 * 1. 结构化管理正向修饰词前缀、后缀与通用负向词模板；
 * 2. 受控内嵌 LoRA 动态管理卡片，支持权重配置与语法模式解耦；
 * 3. 实时比对配置脏状态，驱动方案工具栏保存高亮与切换拦截。
 */

import type { UIComponent } from '../types';
import { Card } from '../components/card';
import { PresetToolbar, type PresetToolbarItem, type PresetActionType } from './preset-toolbar';
import { LoraManager, type LoraEntryItem, type LoraSyntaxMode } from './lora-manager';

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

/** 提示词预设方案卡片配置选项 */
export interface PromptPresetCardOptions {
    /** 预设列表 */
    presets: PromptCardPresetItem[];
    /** 当前激活的预设 ID */
    activePresetId: string;
    /** 初始表单数据覆盖 */
    value?: Partial<PromptCardData>;
    /** 是否展示内嵌的 LoRA 管理器，默认 true */
    showLora?: boolean;
    /** 是否展示负向提示词输入框，针对 OpenAI 兼容等无负向词特性的后端可配置为 false，默认 true */
    showNegativePrompt?: boolean;
    /** LoRA 语法模式 (正常模式 vs WeiLin 扩展模式)，默认 'standard' */
    mode?: LoraSyntaxMode;
    /** 可选 LoRA 模型资产列表 */
    availableModels?: string[];
    /** 预设运维动作回调 */
    onAction?: (action: PresetActionType, presetId: string, data?: PromptCardData) => void;
    /** 表单内容变更回调 */
    onChange?: (data: PromptCardData) => void;
    /** 操作确认回调。未传入时由 PresetToolbar 委托全局确认对话框 ConfirmDialog.confirm */
    confirmHandler?: (message: string) => Promise<boolean> | boolean;
    /** 附加 CSS 类名 */
    className?: string;
}

export class PromptPresetCard implements UIComponent {
    public readonly element: HTMLElement;
    public readonly card: Card;
    public readonly toolbar: PresetToolbar;
    public readonly loraManager: LoraManager | null = null;

    private readonly prefixTextarea: HTMLTextAreaElement;
    private readonly suffixTextarea: HTMLTextAreaElement;
    private readonly negTextarea: HTMLTextAreaElement;

    private currentData: PromptCardData;
    private baselineData: PromptCardData;
    private rawPresets: PromptCardPresetItem[] = [];
    private activePresetId = '';
    private readonly showLora: boolean;
    private readonly showNegativePrompt: boolean;
    private readonly onChangeCallback?: (data: PromptCardData) => void;
    private readonly onActionCallback?: (action: PresetActionType, presetId: string, data?: PromptCardData) => void;

    private readonly prefixInputListener: () => void;
    private readonly suffixInputListener: () => void;
    private readonly negInputListener: () => void;

    constructor(options: PromptPresetCardOptions) {
        this.rawPresets = [...options.presets];
        this.activePresetId = options.activePresetId || (this.rawPresets[0]?.id ?? '');
        this.showLora = options.showLora !== false;
        this.showNegativePrompt = options.showNegativePrompt !== false;
        this.onChangeCallback = options.onChange;
        this.onActionCallback = options.onAction;

        // 1. 初始化当前数据模型与基准快照
        const found = this.rawPresets.find((p) => p.id === this.activePresetId);
        const defaultData: PromptCardData = {
            positivePrefix: found?.data?.positivePrefix || '',
            positiveSuffix: found?.data?.positiveSuffix || '',
            negativePrompt: found?.data?.negativePrompt || '',
            loras: found?.data?.loras ? found.data.loras.map((l) => ({ ...l })) : []
        };

        this.currentData = {
            positivePrefix: options.value?.positivePrefix ?? defaultData.positivePrefix,
            positiveSuffix: options.value?.positiveSuffix ?? defaultData.positiveSuffix,
            negativePrompt: options.value?.negativePrompt ?? defaultData.negativePrompt,
            loras: options.value?.loras ? options.value.loras.map((l) => ({ ...l })) : defaultData.loras
        };
        this.baselineData = this.cloneData(this.currentData);

        // 2. 卡片外壳
        this.card = new Card({
            title: '提示词预设方案'
        });
        this.element = this.card.element;
        this.element.classList.add('da-prompt-preset-card', 'da-prompt-preset-manager');
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

        // 4. 正向提示词前缀多行文本域
        this.prefixInputListener = () => {
            this.currentData.positivePrefix = this.prefixTextarea.value;
            this.updateDirtyState();
            this.onChangeCallback?.(this.getValue());
        };
        const prefixGroup = this.createTextAreaRow(
            '正向提示词前缀',
            '常驻在主体描述词之前的画质、风格与通用修饰词',
            2,
            this.currentData.positivePrefix,
            this.prefixInputListener
        );
        this.prefixTextarea = prefixGroup.textarea;
        this.card.appendContent(prefixGroup.container);

        // 5. 正向提示词后缀多行文本域
        this.suffixInputListener = () => {
            this.currentData.positiveSuffix = this.suffixTextarea.value;
            this.updateDirtyState();
            this.onChangeCallback?.(this.getValue());
        };
        const suffixGroup = this.createTextAreaRow(
            '正向提示词后缀',
            '常驻在主体描述词之后的通用细节强化与附加描述词',
            2,
            this.currentData.positiveSuffix,
            this.suffixInputListener
        );
        this.suffixTextarea = suffixGroup.textarea;
        this.card.appendContent(suffixGroup.container);

        // 6. 负向提示词多行文本域
        this.negInputListener = () => {
            this.currentData.negativePrompt = this.negTextarea.value;
            this.updateDirtyState();
            this.onChangeCallback?.(this.getValue());
        };
        const negGroup = this.createTextAreaRow(
            '负向提示词',
            '生成时自动注入的基础过滤词，抑制畸变、水印及低画质特征',
            3,
            this.currentData.negativePrompt,
            this.negInputListener
        );
        this.negTextarea = negGroup.textarea;
        if (!this.showNegativePrompt) {
            negGroup.container.style.display = 'none';
        }
        this.card.appendContent(negGroup.container);

        // 7. 内嵌 LoRA 模型管理器 (按需加载)
        if (this.showLora) {
            this.loraManager = new LoraManager({
                mode: options.mode ?? 'standard',
                availableModels: options.availableModels ?? [],
                initialItems: this.currentData.loras,
                onChange: (items) => {
                    this.currentData.loras = items.map((it) => ({ ...it }));
                    this.updateDirtyState();
                    this.onChangeCallback?.(this.getValue());
                }
            });
            this.card.appendContent(this.loraManager.element);
        }
    }

    /**
     * 获取当前提示词数据快照（深拷贝）。
     */
    public getValue(): PromptCardData {
        return this.cloneData(this.currentData);
    }

    /**
     * 外部受控更新表单数据。
     */
    public setValue(val: Partial<PromptCardData>): void {
        if (val.positivePrefix !== undefined) this.currentData.positivePrefix = val.positivePrefix;
        if (val.positiveSuffix !== undefined) this.currentData.positiveSuffix = val.positiveSuffix;
        if (val.negativePrompt !== undefined) this.currentData.negativePrompt = val.negativePrompt;
        if (val.loras !== undefined) {
            this.currentData.loras = val.loras.map((l) => ({ ...l }));
        }

        this.syncInputs(this.currentData);
        this.baselineData = this.cloneData(this.currentData);
        this.toolbar.setDirty(false);
    }

    /**
     * 动态刷新预设方案列表。
     */
    public setPresets(presets: PromptCardPresetItem[], activeId?: string): void {
        this.rawPresets = [...presets];
        if (activeId !== undefined) {
            this.activePresetId = activeId;
        } else if (!this.rawPresets.some((p) => p.id === this.activePresetId)) {
            this.activePresetId = this.rawPresets[0]?.id || '';
        }

        this.toolbar.setPresets(this.buildToolbarItems(this.rawPresets), this.activePresetId);
        const found = this.rawPresets.find((p) => p.id === this.activePresetId);
        if (found) {
            this.currentData = this.cloneData(found.data);
            this.baselineData = this.cloneData(found.data);
            this.syncInputs(this.currentData);
            this.toolbar.setDirty(false);
        }
    }

    /**
     * 更新基准快照并重置脏状态。
     */
    public setBaseline(data: PromptCardData): void {
        this.currentData = this.cloneData(data);
        this.baselineData = this.cloneData(data);
        this.syncInputs(this.currentData);
        this.toolbar.setDirty(false);
    }

    /**
     * 动态更新 LoRA 语法模式。
     */
    public setMode(mode: LoraSyntaxMode): void {
        this.loraManager?.setMode(mode);
    }

    /**
     * 动态更新可选 LoRA 模型资产列表。
     */
    public setAvailableModels(models: string[]): void {
        this.loraManager?.setAvailableModels(models);
    }

    /**
     * 查询当前是否处于脏状态。
     */
    public isDirty(): boolean {
        return this.toolbar.isDirty();
    }

    /**
     * 级联注销子组件、解绑事件与卸载 DOM 树。
     */
    public dispose(): void {
        this.prefixTextarea.removeEventListener('input', this.prefixInputListener);
        this.suffixTextarea.removeEventListener('input', this.suffixInputListener);
        this.negTextarea.removeEventListener('input', this.negInputListener);

        this.toolbar.dispose();
        this.loraManager?.dispose();
        this.card.dispose();
    }

    /** 处理方案工具栏运维动作 */
    private handlePresetAction(action: PresetActionType, presetId: string): void {
        if (action === 'select') {
            this.activePresetId = presetId;
            const found = this.rawPresets.find((p) => p.id === presetId);
            if (found && found.data) {
                this.currentData = this.cloneData(found.data);
                this.baselineData = this.cloneData(found.data);
                this.syncInputs(this.currentData);
                this.toolbar.setDirty(false);
                this.onChangeCallback?.(this.getValue());
            }
        } else if (action === 'save') {
            const target = this.rawPresets.find((p) => p.id === presetId);
            if (target) {
                target.data = this.cloneData(this.currentData);
            }
            this.baselineData = this.cloneData(this.currentData);
            this.toolbar.setDirty(false);
        } else if (action === 'reset') {
            const base = this.rawPresets.find((p) => p.id === presetId)?.data ?? this.baselineData;
            this.currentData = this.cloneData(base);
            this.baselineData = this.cloneData(base);
            this.syncInputs(this.currentData);
            this.toolbar.setDirty(false);
            this.onChangeCallback?.(this.getValue());
        }

        this.onActionCallback?.(action, presetId, this.getValue());
    }

    /** 将最新数据回填至界面控件 */
    private syncInputs(data: PromptCardData): void {
        this.prefixTextarea.value = data.positivePrefix || '';
        this.suffixTextarea.value = data.positiveSuffix || '';
        this.negTextarea.value = data.negativePrompt || '';
        if (this.loraManager && data.loras) {
            this.loraManager.setItems(data.loras);
        }
    }

    /** 联动更新 PresetToolbar 脏状态 */
    private updateDirtyState(): void {
        const isDirty = this.checkIsDirty();
        this.toolbar.setDirty(isDirty);
    }

    /** 深比对当前数据与基准快照是否发生变动 */
    private checkIsDirty(): boolean {
        if (this.currentData.positivePrefix !== this.baselineData.positivePrefix) return true;
        if (this.currentData.positiveSuffix !== this.baselineData.positiveSuffix) return true;
        if (this.currentData.negativePrompt !== this.baselineData.negativePrompt) return true;

        const currentLoras = this.currentData.loras || [];
        const baseLoras = this.baselineData.loras || [];

        if (currentLoras.length !== baseLoras.length) return true;

        for (let i = 0; i < currentLoras.length; i++) {
            const c = currentLoras[i];
            const b = baseLoras[i];
            if (c.id !== b.id || c.enabled !== b.enabled || c.modelName !== b.modelName) return true;
            if (c.modelWeight !== b.modelWeight || c.clipWeight !== b.clipWeight) return true;
            if (c.triggerWeight !== b.triggerWeight) return true;
        }

        return false;
    }

    /** 数据深拷贝纯函数 */
    private cloneData(data: PromptCardData): PromptCardData {
        return {
            positivePrefix: data.positivePrefix,
            positiveSuffix: data.positiveSuffix,
            negativePrompt: data.negativePrompt,
            loras: data.loras ? data.loras.map((l) => ({ ...l })) : []
        };
    }

    /** 创建带标题与说明的多行文本输入行容器 */
    private createTextAreaRow(
        label: string,
        helpText: string,
        rows: number,
        initialValue: string,
        onInput: () => void
    ): { container: HTMLElement; textarea: HTMLTextAreaElement } {
        const row = document.createElement('div');
        row.className = 'da-textarea-row';

        const header = document.createElement('div');
        header.className = 'da-textarea-header';

        const labelEl = document.createElement('label');
        labelEl.className = 'da-field-label';
        labelEl.textContent = label;

        const helpEl = document.createElement('span');
        helpEl.className = 'da-field-help';
        helpEl.textContent = helpText;

        header.appendChild(labelEl);
        header.appendChild(helpEl);
        row.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.className = 'da-textarea';
        textarea.rows = rows;
        textarea.value = initialValue;
        textarea.addEventListener('input', onInput);
        row.appendChild(textarea);

        return { container: row, textarea };
    }

    /** 转换为 PresetToolbar 预设选项条目 */
    private buildToolbarItems(items: PromptCardPresetItem[]): PresetToolbarItem[] {
        return items.map((p) => ({
            id: p.id,
            name: p.name
        }));
    }
}
