/**
 * 提示词预设管理卡片 (PromptPresetCard)。
 *
 * @remarks
 * 负责提示词与 LoRA 预设的管理与编辑：
 * 1. 管理正向提示词前缀、后缀与负向提示词；
 * 2. 内嵌 LoRA 模型列表与权重设置；
 * 3. 响应配置变更并驱动预设工具栏的保存与重置。
 */

import type { UIComponent } from '../types';
import { Card } from '../components/card';
import { renderIcon } from '../components/icons';
import { PresetToolbar, type PresetToolbarItem, type PresetActionType } from './preset-toolbar';
import { type LoraEntryItem, type LoraSyntaxMode } from './lora-manager';
import { openLoraModal } from '../modal/lora-modal';
import { attachTagAutocomplete, type TagAutocomplete } from './tag-autocomplete';
import { ConfirmDialog } from '../feedback/confirm-dialog';

/** 提示词卡片表单数据模型 */
export interface PromptCardData {
    positivePrefix: string;
    positiveSuffix: string;
    negativePrompt: string;
    loraSyntaxMode?: LoraSyntaxMode;
    loras: LoraEntryItem[];
}

/** 提示词预设条目 */
export interface PromptCardPresetItem {
    id: string;
    name: string;
    data: PromptCardData;
}

/** 提示词预设卡片配置选项 */
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
    /** LoRA 语法模式（'standard' 为标准双权重，'weilin' 为三权重扩展），默认 'standard' */
    mode?: LoraSyntaxMode;
    /** 可选 LoRA 模型列表 */
    availableModels?: string[];
    /** 预设运维动作回调 */
    onAction?: (
        action: PresetActionType,
        presetId: string,
        data?: PromptCardData
    ) => void | boolean | Promise<void | boolean>;
    /** 导入文件自定义解析回调 */
    onImportFile?: (file: File) => void;
    /** 表单内容变更回调 */
    onChange?: (data: PromptCardData) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

export class PromptPresetCard implements UIComponent {
    public readonly element: HTMLElement;
    public readonly card: Card;
    public readonly toolbar: PresetToolbar;

    private readonly prefixTextarea: HTMLTextAreaElement;
    private readonly suffixTextarea: HTMLTextAreaElement;
    private readonly negTextarea: HTMLTextAreaElement;
    private loraBadgesContainer?: HTMLElement;
    private loraModeBadgeEl?: HTMLElement;
    private availableModels: string[] = [];

    private currentData: PromptCardData;
    private baselineData: PromptCardData;
    private rawPresets: PromptCardPresetItem[] = [];
    private activePresetId = '';
    private readonly showLora: boolean;
    private readonly showNegativePrompt: boolean;
    private readonly onChangeCallback?: (data: PromptCardData) => void;
    private readonly onActionCallback?: (
        action: PresetActionType,
        presetId: string,
        data?: PromptCardData
    ) => void | boolean | Promise<void | boolean>;

    private readonly prefixInputListener: () => void;
    private readonly suffixInputListener: () => void;
    private readonly negInputListener: () => void;
    private readonly autocompletes: TagAutocomplete[] = [];

    constructor(options: PromptPresetCardOptions) {
        this.rawPresets = [...options.presets];
        let effectiveActiveId = options.activePresetId || '';
        let found = this.rawPresets.find((p) => p.id === effectiveActiveId);
        if (!found && this.rawPresets.length > 0) {
            effectiveActiveId = this.rawPresets[0].id;
            found = this.rawPresets[0];
        }
        this.activePresetId = effectiveActiveId;
        this.showLora = options.showLora !== false;
        this.showNegativePrompt = options.showNegativePrompt !== false;
        this.onChangeCallback = options.onChange;
        this.onActionCallback = options.onAction;

        // 1. 初始化当前数据模型与基准快照
        const defaultData: PromptCardData = {
            positivePrefix: found?.data?.positivePrefix || '',
            positiveSuffix: found?.data?.positiveSuffix || '',
            negativePrompt: found?.data?.negativePrompt || '',
            loraSyntaxMode: found?.data?.loraSyntaxMode ?? options.mode ?? 'standard',
            loras: found?.data?.loras ? found.data.loras.map((l) => ({ ...l })) : []
        };

        this.currentData = {
            positivePrefix: options.value?.positivePrefix ?? defaultData.positivePrefix,
            positiveSuffix: options.value?.positiveSuffix ?? defaultData.positiveSuffix,
            negativePrompt: options.value?.negativePrompt ?? defaultData.negativePrompt,
            loraSyntaxMode: options.value?.loraSyntaxMode ?? defaultData.loraSyntaxMode,
            loras: options.value?.loras ? options.value.loras.map((l) => ({ ...l })) : defaultData.loras
        };
        this.baselineData = this.cloneData(this.currentData);

        // 2. 卡片外壳
        this.card = new Card({
            title: '提示词预设'
        });
        this.element = this.card.element;
        this.element.classList.add('da-prompt-preset-card', 'da-prompt-preset-manager');
        if (options.className) {
            this.element.classList.add(...options.className.trim().split(/\s+/).filter(Boolean));
        }

        // 3. 预设工具栏 PresetToolbar
        this.toolbar = new PresetToolbar({
            presets: this.buildToolbarItems(this.rawPresets),
            activePresetId: this.activePresetId,
            onAction: (action, presetId) => this.handlePresetAction(action, presetId),
            onImportFile: options.onImportFile
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
            '负向提示词 (Negative Prompt)',
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

        this.autocompletes.push(
            attachTagAutocomplete(this.prefixTextarea, { mode: 'prompt-with-macro' }),
            attachTagAutocomplete(this.suffixTextarea, { mode: 'prompt-with-macro' }),
            attachTagAutocomplete(this.negTextarea, { mode: 'prompt-with-macro' })
        );

        // 7. LoRA 挂载概要与独立管理弹窗入口
        if (this.showLora) {
            this.availableModels = options.availableModels ? [...options.availableModels] : [];

            const loraRow = document.createElement('div');
            loraRow.className = 'da-textarea-row da-prompt-lora-summary-row';

            const loraHeader = document.createElement('div');
            loraHeader.className = 'da-textarea-header da-prompt-lora-header';

            const loraTitleGroup = document.createElement('div');
            loraTitleGroup.className = 'da-prompt-lora-title-group';

            const loraTitle = document.createElement('label');
            loraTitle.className = 'da-field-label';
            loraTitle.textContent = 'LoRA 模型';

            const modeBadge = document.createElement('span');
            modeBadge.className = 'da-badge da-badge--neutral da-prompt-lora-mode-badge';
            this.loraModeBadgeEl = modeBadge;

            loraTitleGroup.appendChild(loraTitle);
            loraTitleGroup.appendChild(modeBadge);

            const openLoraBtn = document.createElement('button');
            openLoraBtn.type = 'button';
            openLoraBtn.className = 'da-btn da-btn--secondary da-btn--sm';
            openLoraBtn.textContent = '管理 LoRA';
            openLoraBtn.title = '打开独立模态弹窗管理 LoRA 模型与权重';
            openLoraBtn.onclick = () => {
                openLoraModal({
                    mode: this.currentData.loraSyntaxMode ?? options.mode ?? 'standard',
                    availableModels: this.availableModels,
                    initialItems: this.currentData.loras,
                    onSave: (items, mode) => {
                        this.currentData.loras = items.map((it) => ({ ...it }));
                        this.currentData.loraSyntaxMode = mode;
                        this.renderLoraBadges();
                        this.updateDirtyState();
                        this.onChangeCallback?.(this.getValue());
                    },
                });
            };

            loraHeader.appendChild(loraTitleGroup);
            loraHeader.appendChild(openLoraBtn);
            loraRow.appendChild(loraHeader);

            const badgesBox = document.createElement('div');
            badgesBox.className = 'da-prompt-lora-badges';
            loraRow.appendChild(badgesBox);

            this.loraBadgesContainer = badgesBox;
            this.card.appendContent(loraRow);
            this.renderLoraBadges();
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
        if (val.loraSyntaxMode !== undefined) this.currentData.loraSyntaxMode = val.loraSyntaxMode;
        if (val.loras !== undefined) {
            this.currentData.loras = val.loras.map((l) => ({ ...l }));
        }

        this.syncInputs(this.currentData);
        this.baselineData = this.cloneData(this.currentData);
        this.toolbar.setDirty(false);
    }

    /**
     * 动态刷新提示词预设列表。
     *
     * @param presets 最新的提示词预设列表
     * @param activeId 可选的激活预设 ID
     */
    public setPresets(presets: PromptCardPresetItem[], activeId?: string): void {
        const prevActiveId = this.activePresetId;
        const wasDirty = this.checkIsDirty();
        this.rawPresets = [...presets];
        let targetId = activeId !== undefined ? activeId : this.activePresetId;
        let found = this.rawPresets.find((p) => p.id === targetId);

        if (!found && this.rawPresets.length > 0) {
            targetId = this.rawPresets[0].id;
            found = this.rawPresets[0];
        }
        this.activePresetId = targetId || '';

        this.toolbar.setPresets(this.buildToolbarItems(this.rawPresets), this.activePresetId);
        if (found && wasDirty && this.activePresetId === prevActiveId) {
            // 同 preset 池刷新时保留用户未保存草稿
            this.toolbar.setDirty(true);
            return;
        }
        if (found) {
            this.currentData = this.cloneData(found.data);
            this.baselineData = this.cloneData(found.data);
            this.syncInputs(this.currentData);
            this.toolbar.setDirty(false);
        } else {
            // 仅在预设列表真正为空时置空
            this.currentData = {
                positivePrefix: '',
                positiveSuffix: '',
                negativePrompt: '',
                loras: [],
            };
            this.baselineData = this.cloneData(this.currentData);
            this.syncInputs(this.currentData);
            this.toolbar.setDirty(false);
        }
    }

    /**
     * 获取当前激活的提示词预设 ID。
     */
    public getActivePresetId(): string {
        return this.activePresetId;
    }

    /**
     * 保存当前未保存的提示词草稿。
     */
    public async saveDraft(): Promise<boolean> {
        if (!this.checkIsDirty()) return true;
        if (!this.activePresetId) {
            return await this.handlePresetAction('saveAs', '');
        }
        return await this.handlePresetAction('save', this.activePresetId);
    }

    /**
     * 静默放弃当前提示词草稿并恢复为基线快照。
     */
    public discardDraft(): void {
        const base =
            this.rawPresets.find((p) => p.id === this.activePresetId)?.data ?? this.baselineData;
        this.currentData = this.cloneData(base);
        this.baselineData = this.cloneData(base);
        this.syncInputs(this.currentData);
        this.toolbar.setDirty(false);
        this.onChangeCallback?.(this.getValue());
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
        this.currentData.loraSyntaxMode = mode;
    }

    /**
     * 动态更新可选 LoRA 模型列表。
     */
    public setAvailableModels(models: string[]): void {
        this.availableModels = [...models];
        this.renderLoraBadges();
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
        for (const ac of this.autocompletes) {
            ac.dispose();
        }
        this.autocompletes.length = 0;

        this.prefixTextarea.removeEventListener('input', this.prefixInputListener);
        this.suffixTextarea.removeEventListener('input', this.suffixInputListener);
        this.negTextarea.removeEventListener('input', this.negInputListener);

        this.toolbar.dispose();
        this.card.dispose();
    }

    /** 处理预设工具栏运维动作 */
    private async handlePresetAction(action: PresetActionType, presetId: string): Promise<boolean> {
        if (action === 'new') {
            if (this.checkIsDirty()) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '新建提示词预设确认',
                    message: '当前提示词预设存在未保存的修改，新建将放弃未保存的修改。是否确定继续新建？',
                });
                if (!confirmed) return false;
            }
        } else if (action === 'select') {
            if (presetId !== this.activePresetId && this.checkIsDirty()) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '切换提示词预设确认',
                    message: '当前提示词预设存在未保存的修改，切换将放弃未保存的修改。是否确定继续切换？',
                });
                if (!confirmed) return false;
            }
            this.activePresetId = presetId;
            const found = this.rawPresets.find((p) => p.id === presetId);
            if (found && found.data) {
                this.currentData = this.cloneData(found.data);
                this.baselineData = this.cloneData(found.data);
                this.syncInputs(this.currentData);
                this.toolbar.setDirty(false);
                this.onChangeCallback?.(this.getValue());
            }
        } else if (action === 'reset') {
            if (this.checkIsDirty()) {
                const confirmed = await ConfirmDialog.confirm({
                    title: '重置修改确认',
                    message: '确定要放弃当前未保存的提示词修改并恢复初始状态吗？',
                });
                if (!confirmed) return false;
            }
            this.discardDraft();
        }

        const result = await this.onActionCallback?.(action, presetId, this.getValue());
        if (result === false) {
            return false;
        }

        if (action === 'save') {
            const target = this.rawPresets.find((p) => p.id === presetId);
            if (target) {
                target.data = this.cloneData(this.currentData);
            }
            this.baselineData = this.cloneData(this.currentData);
            this.toolbar.setDirty(false);
        }
        return true;
    }

    /** 将最新数据回填至界面控件与概要徽标 */
    private syncInputs(data: PromptCardData): void {
        this.prefixTextarea.value = data.positivePrefix || '';
        this.suffixTextarea.value = data.positiveSuffix || '';
        this.negTextarea.value = data.negativePrompt || '';
        for (const ac of this.autocompletes) {
            ac.refreshMacroStatus();
        }
        this.renderLoraBadges();
    }

    /** 渲染已挂载的 LoRA 胶囊标签（支持点击快速启停切换与单项移除） */
    private renderLoraBadges(): void {
        if (!this.loraBadgesContainer) return;
        this.loraBadgesContainer.innerHTML = '';

        const mode = this.currentData.loraSyntaxMode ?? 'standard';
        if (this.loraModeBadgeEl) {
            this.loraModeBadgeEl.textContent = mode === 'weilin' ? 'ComfyUI <wlr>' : 'SD-WebUI <lora>';
        }

        const allLoras = this.currentData.loras || [];
        if (allLoras.length === 0) {
            const emptySpan = document.createElement('span');
            emptySpan.className = 'da-prompt-lora-empty';
            emptySpan.textContent = '暂未挂载任何 LoRA（点击右上角“配置 LoRA”从服务端列表检索选择添加）';
            this.loraBadgesContainer.appendChild(emptySpan);
            return;
        }

        for (const lora of allLoras) {
            const isEnabled = lora.enabled !== false;
            const isMissing =
                Boolean(lora.modelName) &&
                this.availableModels.length > 0 &&
                !this.availableModels.includes(lora.modelName);

            const chip = document.createElement('div');
            let chipClasses = 'da-lora-chip';
            if (!isEnabled) chipClasses += ' is-disabled';
            if (isMissing) chipClasses += ' is-missing';
            chip.className = chipClasses;

            let tooltip = isEnabled
                ? `点击停用: ${lora.modelName} (Model: ${lora.modelWeight}, CLIP: ${lora.clipWeight})`
                : `已停用（点击重新启用）: ${lora.modelName}`;
            if (isMissing) {
                tooltip += ` [服务端未检测到此模型]`;
            }
            chip.title = tooltip;

            const toggleArea = document.createElement('button');
            toggleArea.type = 'button';
            toggleArea.className = 'da-lora-chip__main';
            toggleArea.onclick = () => {
                lora.enabled = !isEnabled;
                this.renderLoraBadges();
                this.updateDirtyState();
                this.onChangeCallback?.(this.getValue());
            };

            const dot = document.createElement('span');
            dot.className = 'da-lora-chip__dot';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'da-lora-chip__name';
            nameSpan.textContent = lora.modelName.replace(/\.(safetensors|pt|ckpt|pth)$/i, '');

            const weightSpan = document.createElement('span');
            weightSpan.className = 'da-lora-chip__weight';
            weightSpan.textContent =
                lora.modelWeight === lora.clipWeight
                    ? `${lora.modelWeight}`
                    : `${lora.modelWeight}/${lora.clipWeight}`;

            toggleArea.appendChild(dot);
            toggleArea.appendChild(nameSpan);
            toggleArea.appendChild(weightSpan);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'da-lora-chip__remove';
            removeBtn.title = '移除该 LoRA';
            removeBtn.innerHTML = renderIcon('close', 11);
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                this.currentData.loras = this.currentData.loras.filter((it) => it.id !== lora.id);
                this.renderLoraBadges();
                this.updateDirtyState();
                this.onChangeCallback?.(this.getValue());
            };

            chip.appendChild(toggleArea);
            chip.appendChild(removeBtn);
            this.loraBadgesContainer.appendChild(chip);
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
        if (
            (this.currentData.loraSyntaxMode ?? 'standard') !==
            (this.baselineData.loraSyntaxMode ?? 'standard')
        ) {
            return true;
        }

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
            loraSyntaxMode: data.loraSyntaxMode ?? 'standard',
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
