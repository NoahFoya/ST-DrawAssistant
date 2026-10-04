/**
 * LoRA 动态管理卡片复合组件 (LoraManager)。
 *
 * @remarks
 * 负责生图任务中 LoRA 模型的挂载与权重管理：
 * 1. 语法模式支持：标准模式（Model/CLIP 双权重）与 WeiLin 扩展模式（Model/CLIP/Trigger 三权重）；
 * 2. 外部资产绑定：受控绑定外部载入的模型文件名列表；
 * 3. 顶部添加控制：根据资产情况提供选择或输入模型快速挂载；
 * 4. 独立参数调节：各权重步进器独立受控输入；
 * 5. 条目状态管理：支持条目启用/禁用休眠态切换；
 * 6. 生命周期管理：实现 UIComponent 与 Disposable 接口定义。
 */

import type { UIComponent, Disposable } from '../types';
import { Card } from '../components/card';
import { Select, type SelectOption } from '../components/select';
import { TextInput } from '../components/text-input';
import { Switch } from '../components/switch';
import { NumberInput } from '../components/number-input';
import { Button } from '../components/button';
import { Badge } from '../components/badge';

/** LoRA 语法模式：标准模式 ('standard') 与 WeiLin 扩展模式 ('weilin') */
export type LoraSyntaxMode = 'standard' | 'weilin';

/** 单个已挂载 LoRA 条目数据模型 */
export interface LoraEntryItem {
    readonly id: string;
    /** 启用状态，关闭时条目进入休眠态，生图处理时忽略该项 */
    enabled: boolean;
    /** 模型文件名或标识符 (如 "anime_v2.safetensors") */
    modelName: string;
    /** 基础模型权重，默认 0.80 */
    modelWeight: number;
    /** 文本编码器权重，默认 0.80 */
    clipWeight: number;
    /** 触发权重，默认 1.00，仅在 weilin 模式下生效 */
    triggerWeight?: number;
}

/** LoRA 管理器组件配置选项 */
export interface LoraManagerOptions {
    /** 卡片主标题，默认 "LoRA 模型管理" */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** LoRA 语法模式：标准模式 ('standard') 或 WeiLin 扩展模式 ('weilin')，默认 'standard' */
    mode?: LoraSyntaxMode;
    /** 外部注入的已载入可用 LoRA 模型文件名列表 */
    availableModels?: string[];
    /** 初始挂载的 LoRA 列表条目 */
    initialItems?: LoraEntryItem[];
    /** 挂载上限，默认 10 */
    maxCount?: number;
    /** 变更回调通知 */
    onChange?(items: LoraEntryItem[]): void;
}

/**
 * 根据指定模式将 LoRA 条目格式化为提示词标签。
 *
 * @remarks
 * 自动剥离常见的模型文件后缀 (.safetensors, .pt, .ckpt, .pth)。
 * 标准模式：两权重一致简写为 <lora:name:model>，不同时为 <lora:name:model:clip>。
 * WeiLin 扩展模式：四段式语法 <wlr:name:model:clip:trigger>。
 *
 * @param item LoRA 条目数据
 * @param mode 语法模式 ('standard' | 'weilin')，默认 'standard'
 * @returns 格式化后的标签字符串，若模型名为空则返回空字符串
 */
export function formatLoraTag(item: LoraEntryItem, mode: LoraSyntaxMode = 'standard'): string {
    if (!item || !item.modelName) {
        return '';
    }
    const cleanName = item.modelName.replace(/\.(safetensors|pt|ckpt|pth)$/i, '').trim();
    if (!cleanName) {
        return '';
    }

    const model = Number.isFinite(item.modelWeight) ? item.modelWeight : 0.8;
    const clip = Number.isFinite(item.clipWeight) ? item.clipWeight : model;

    if (mode === 'weilin') {
        const trigger = Number.isFinite(item.triggerWeight) ? item.triggerWeight! : 1.0;
        return `<wlr:${cleanName}:${model}:${clip}:${trigger}>`;
    }

    if (model === clip) {
        return `<lora:${cleanName}:${model}>`;
    }
    return `<lora:${cleanName}:${model}:${clip}>`;
}

/** 单条目交互组件的初始化配置项 */
interface LoraItemRowOptions {
    item: LoraEntryItem;
    mode: LoraSyntaxMode;
    availableModels: string[];
    onUpdate(id: string, patch: Partial<LoraEntryItem>): void;
    onDelete(id: string): void;
}

/**
 * 内部单条目卡片交互封装。
 */
class LoraItemRow implements Disposable {
    public readonly element: HTMLElement;
    public readonly item: LoraEntryItem;

    private readonly options: LoraItemRowOptions;
    private readonly disposables: Disposable[] = [];

    private readonly deleteBadge: HTMLButtonElement;
    private readonly assetContainer: HTMLElement;
    private readonly switchControl: Switch;
    private readonly paramsRow: HTMLElement;

    private selectComponent?: Select;
    private textInputComponent?: TextInput;

    private modelWeightInput!: NumberInput;
    private clipWeightInput!: NumberInput;
    private triggerWeightInput?: NumberInput;

    constructor(options: LoraItemRowOptions) {
        this.options = options;
        this.item = options.item;

        // 1. 条目主容器 (.da-lora-item)
        this.element = document.createElement('div');
        this.element.classList.add('da-lora-item');
        if (!this.item.enabled) {
            this.element.classList.add('is-disabled');
        }

        // 2. 右上角角标式删除按钮 (.da-lora-item__delete-badge)
        this.deleteBadge = document.createElement('button');
        this.deleteBadge.type = 'button';
        this.deleteBadge.classList.add('da-lora-item__delete-badge');
        this.deleteBadge.setAttribute('aria-label', '移除该 LoRA');
        this.deleteBadge.title = '移除该 LoRA';
        this.deleteBadge.innerHTML = `<svg viewBox="0 0 12 12"><path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"/></svg>`;
        const onDeleteClick = (e: MouseEvent) => {
            e.stopPropagation();
            this.options.onDelete(this.item.id);
        };
        this.deleteBadge.addEventListener('click', onDeleteClick);
        this.disposables.push({
            dispose: () => this.deleteBadge.removeEventListener('click', onDeleteClick)
        });
        this.element.appendChild(this.deleteBadge);

        // 3. 首行：左侧模型资产选择，右侧启用开关 (.da-lora-item__row--header)
        const headerRow = document.createElement('div');
        headerRow.classList.add('da-lora-item__row--header');

        this.assetContainer = document.createElement('div');
        this.assetContainer.classList.add('da-lora-item__asset-box');
        this.renderAssetControl(options.availableModels);
        headerRow.appendChild(this.assetContainer);

        const switchBox = document.createElement('div');
        switchBox.classList.add('da-lora-item__switch-box');
        this.switchControl = new Switch({
            value: this.item.enabled,
            onChange: (enabled) => {
                this.item.enabled = enabled;
                this.updateDisabledState(!enabled);
                this.options.onUpdate(this.item.id, { enabled });
            }
        });
        this.disposables.push(this.switchControl);
        switchBox.appendChild(this.switchControl.element);
        headerRow.appendChild(switchBox);
        this.element.appendChild(headerRow);

        // 4. 次行：参数步进器容器 (.da-lora-item__row--params)
        this.paramsRow = document.createElement('div');
        this.paramsRow.classList.add('da-lora-item__row--params');
        this.renderParamsInputs(options.mode);
        this.element.appendChild(this.paramsRow);
    }

    /** 渲染首行模型资产选择或输入控件 */
    public renderAssetControl(availableModels: string[]): void {
        this.assetContainer.innerHTML = '';
        this.selectComponent?.dispose();
        this.textInputComponent?.dispose();

        if (availableModels.length > 0) {
            const options: SelectOption[] = availableModels.map(m => ({
                value: m,
                label: m
            }));

            // 若当前条目模型名不在已载入列表中，在首位保留以保全数据
            const exists = availableModels.includes(this.item.modelName);
            if (this.item.modelName && !exists) {
                options.unshift({
                    value: this.item.modelName,
                    label: `${this.item.modelName} (未探测到)`
                });
            }

            this.selectComponent = new Select({
                value: this.item.modelName,
                options,
                placeholder: '选择 LoRA 资产...',
                disabled: !this.item.enabled,
                onChange: (val) => {
                    this.item.modelName = val;
                    this.options.onUpdate(this.item.id, { modelName: val });
                }
            });
            this.assetContainer.appendChild(this.selectComponent.element);
        } else {
            this.textInputComponent = new TextInput({
                value: this.item.modelName,
                placeholder: '输入 LoRA 模型文件名 (如 anime_v2.safetensors)',
                disabled: !this.item.enabled,
                onChange: (val) => {
                    const clean = val.trim();
                    this.item.modelName = clean;
                    this.options.onUpdate(this.item.id, { modelName: clean });
                }
            });
            this.assetContainer.appendChild(this.textInputComponent.element);
        }
    }

    /** 渲染次行参数步进器 */
    public renderParamsInputs(mode: LoraSyntaxMode): void {
        this.paramsRow.innerHTML = '';
        this.modelWeightInput?.dispose();
        this.clipWeightInput?.dispose();
        this.triggerWeightInput?.dispose();

        // 1. Model 权重步进器
        const modelGroup = document.createElement('div');
        modelGroup.classList.add('da-lora-param-group');
        const modelLabel = document.createElement('span');
        modelLabel.classList.add('da-lora-param-label');
        modelLabel.textContent = 'Model';
        modelGroup.appendChild(modelLabel);

        this.modelWeightInput = new NumberInput({
            value: this.item.modelWeight,
            min: -2.0,
            max: 2.0,
            step: 0.05,
            precision: 2,
            disabled: !this.item.enabled,
            onChange: (val) => {
                this.item.modelWeight = val;
                this.options.onUpdate(this.item.id, { modelWeight: val });
            }
        });
        modelGroup.appendChild(this.modelWeightInput.element);
        this.paramsRow.appendChild(modelGroup);

        // 2. CLIP 权重步进器
        const clipGroup = document.createElement('div');
        clipGroup.classList.add('da-lora-param-group');
        const clipLabel = document.createElement('span');
        clipLabel.classList.add('da-lora-param-label');
        clipLabel.textContent = 'CLIP';
        clipGroup.appendChild(clipLabel);

        this.clipWeightInput = new NumberInput({
            value: this.item.clipWeight,
            min: -2.0,
            max: 2.0,
            step: 0.05,
            precision: 2,
            disabled: !this.item.enabled,
            onChange: (val) => {
                this.item.clipWeight = val;
                this.options.onUpdate(this.item.id, { clipWeight: val });
            }
        });
        clipGroup.appendChild(this.clipWeightInput.element);
        this.paramsRow.appendChild(clipGroup);

        // 3. WeiLin 模式专属：Trigger 权重步进器
        if (mode === 'weilin') {
            const triggerGroup = document.createElement('div');
            triggerGroup.classList.add('da-lora-param-group');
            const triggerLabel = document.createElement('span');
            triggerLabel.classList.add('da-lora-param-label');
            triggerLabel.textContent = 'Trigger';
            triggerGroup.appendChild(triggerLabel);

            this.triggerWeightInput = new NumberInput({
                value: this.item.triggerWeight ?? 1.0,
                min: -2.0,
                max: 2.0,
                step: 0.05,
                precision: 2,
                disabled: !this.item.enabled,
                onChange: (val) => {
                    this.item.triggerWeight = val;
                    this.options.onUpdate(this.item.id, { triggerWeight: val });
                }
            });
            triggerGroup.appendChild(this.triggerWeightInput.element);
            this.paramsRow.appendChild(triggerGroup);
        } else {
            this.triggerWeightInput = undefined;
        }
    }

    /** 语法模式发生变化时动态更新次行 */
    public updateMode(mode: LoraSyntaxMode): void {
        this.renderParamsInputs(mode);
    }

    /** 可用模型资产发生变化时更新首行选择器 */
    public updateAvailableModels(availableModels: string[]): void {
        this.renderAssetControl(availableModels);
    }

    /** 更新启用/休眠状态 */
    public updateDisabledState(disabled: boolean): void {
        if (disabled) {
            this.element.classList.add('is-disabled');
        } else {
            this.element.classList.remove('is-disabled');
        }

        this.modelWeightInput.setDisabled(disabled);
        this.clipWeightInput.setDisabled(disabled);
        this.triggerWeightInput?.setDisabled(disabled);

        this.selectComponent?.setDisabled(disabled);
        this.textInputComponent?.setDisabled(disabled);
    }

    public dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        this.selectComponent?.dispose();
        this.textInputComponent?.dispose();
        this.modelWeightInput?.dispose();
        this.clipWeightInput?.dispose();
        this.triggerWeightInput?.dispose();
        this.switchControl.dispose();
        this.element.remove();
    }
}

/**
 * 业务复合卡片：LoRA 动态管理器 (LoraManager)。
 */
export class LoraManager implements UIComponent, Disposable {
    public readonly element: HTMLElement;

    private readonly card: Card;
    private readonly options: LoraManagerOptions;
    private readonly items: LoraEntryItem[] = [];
    private readonly itemRows = new Map<string, LoraItemRow>();
    private readonly disposables: Disposable[] = [];

    private mode: LoraSyntaxMode;
    private availableModels: string[];
    private readonly maxCount: number;

    private readonly quotaBadge: Badge;
    private readonly addBarContainer: HTMLElement;
    private readonly addControlBox: HTMLElement;
    private readonly addModelButton: Button;

    private modelSelectInput?: Select;
    private manualAddInput?: TextInput;
    private selectedAddModelName = '';

    private readonly listContainer: HTMLElement;
    private readonly emptyNoticeElement: HTMLElement;

    constructor(options: LoraManagerOptions = {}) {
        this.options = options;
        this.mode = options.mode ?? 'standard';
        this.availableModels = [...(options.availableModels ?? [])];
        this.maxCount = options.maxCount ?? 10;

        // 1. 初始化 Card 容器
        this.card = new Card({
            title: options.title ?? 'LoRA 模型管理',
            subtitle: options.subtitle ?? '挂载并配置生图 LoRA 模型及权重',
            collapsible: true,
            defaultCollapsed: false
        });
        this.element = this.card.element;
        this.disposables.push(this.card);

        // 2. 头部配额指示徽标
        this.quotaBadge = new Badge({
            text: `0 / ${this.maxCount}`,
            variant: 'info'
        });
        this.disposables.push(this.quotaBadge);
        this.card.setBadges(this.quotaBadge.element);

        // 3. 顶部模型选择与添加控制栏 (.da-lora-add-bar)
        this.addBarContainer = document.createElement('div');
        this.addBarContainer.classList.add('da-lora-add-bar');

        this.addControlBox = document.createElement('div');
        this.addControlBox.classList.add('da-lora-add-bar__control');
        this.addBarContainer.appendChild(this.addControlBox);

        this.addModelButton = new Button({
            label: '＋ 添加',
            variant: 'secondary',
            size: 'sm',
            onClick: () => this.handleQuickAdd()
        });
        this.disposables.push(this.addModelButton);
        this.addBarContainer.appendChild(this.addModelButton.element);

        this.card.appendContent(this.addBarContainer);
        this.renderAddBarControl();

        // 4. 已挂载条目列表容器 (.da-lora-list)
        this.listContainer = document.createElement('div');
        this.listContainer.classList.add('da-lora-list');
        this.card.appendContent(this.listContainer);

        // 5. 空列表提示
        this.emptyNoticeElement = document.createElement('div');
        this.emptyNoticeElement.classList.add('da-lora-list__empty');
        this.emptyNoticeElement.textContent = '暂无已挂载 LoRA 模型，请从上方选择添加';
        this.card.appendContent(this.emptyNoticeElement);

        // 6. 装载初始条目
        if (options.initialItems && options.initialItems.length > 0) {
            for (const item of options.initialItems) {
                this.items.push({ ...item });
            }
        }

        this.renderAllItems();
        this.updateQuotaDisplay();
    }

    /** 渲染顶部添加控制区 */
    private renderAddBarControl(): void {
        this.addControlBox.innerHTML = '';
        this.modelSelectInput?.dispose();
        this.manualAddInput?.dispose();

        if (this.availableModels.length > 0) {
            const options: SelectOption[] = this.availableModels.map(m => ({
                value: m,
                label: m
            }));

            if (!this.selectedAddModelName && options.length > 0) {
                this.selectedAddModelName = options[0].value;
            }

            this.modelSelectInput = new Select({
                value: this.selectedAddModelName,
                options,
                placeholder: '选择已载入的 LoRA 模型...',
                onChange: (val) => {
                    this.selectedAddModelName = val;
                }
            });
            this.addControlBox.appendChild(this.modelSelectInput.element);
        } else {
            this.manualAddInput = new TextInput({
                value: this.selectedAddModelName,
                placeholder: '输入 LoRA 模型文件名 (如 anime_v2.safetensors)',
                onChange: (val) => {
                    this.selectedAddModelName = val.trim();
                }
            });
            this.addControlBox.appendChild(this.manualAddInput.element);
        }
    }

    /** 触发快捷添加操作 */
    private handleQuickAdd(): void {
        const modelName = this.selectedAddModelName.trim();
        if (!modelName) {
            return;
        }
        this.addItem({ modelName });
    }

    /** 获取当前语法模式 */
    public getMode(): LoraSyntaxMode {
        return this.mode;
    }

    /** 动态设置语法模式并重绘条目参数步进器 */
    public setMode(mode: LoraSyntaxMode): void {
        if (this.mode === mode) return;
        this.mode = mode;

        for (const item of this.items) {
            if (mode === 'weilin' && item.triggerWeight === undefined) {
                item.triggerWeight = 1.0;
            }
        }

        for (const row of this.itemRows.values()) {
            row.updateMode(mode);
        }

        this.notifyChange();
    }

    /** 获取已绑定的可用模型列表 */
    public getAvailableModels(): string[] {
        return this.availableModels;
    }

    /** 受控更新可用模型列表并同步刷新添加栏与各条目资产选项 */
    public setAvailableModels(models: string[]): void {
        this.availableModels = [...models];
        this.renderAddBarControl();

        for (const row of this.itemRows.values()) {
            row.updateAvailableModels(this.availableModels);
        }
    }

    /** 添加新的 LoRA 条目 */
    public addItem(partial?: Partial<LoraEntryItem>): void {
        if (this.items.length >= this.maxCount) {
            return;
        }

        const newItem: LoraEntryItem = {
            id: partial?.id ?? `lora_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            enabled: partial?.enabled ?? true,
            modelName: partial?.modelName ?? '',
            modelWeight: partial?.modelWeight ?? 0.8,
            clipWeight: partial?.clipWeight ?? 0.8,
            triggerWeight: partial?.triggerWeight ?? (this.mode === 'weilin' ? 1.0 : undefined)
        };

        this.items.push(newItem);
        this.renderSingleRow(newItem);
        this.updateQuotaDisplay();
        this.notifyChange();
    }

    /** 移除指定 LoRA 条目 */
    public removeItem(id: string): void {
        const index = this.items.findIndex(it => it.id === id);
        if (index === -1) return;

        this.items.splice(index, 1);
        const row = this.itemRows.get(id);
        if (row) {
            row.dispose();
            this.itemRows.delete(id);
        }

        this.updateQuotaDisplay();
        this.notifyChange();
    }

    /** 处理条目内部字段更新 */
    private handleItemUpdate(id: string, patch: Partial<LoraEntryItem>): void {
        const item = this.items.find(it => it.id === id);
        if (!item) return;

        Object.assign(item, patch);
        this.notifyChange();
    }

    /** 重新全量渲染条目列表 */
    private renderAllItems(): void {
        for (const row of this.itemRows.values()) {
            row.dispose();
        }
        this.itemRows.clear();
        this.listContainer.innerHTML = '';

        for (const item of this.items) {
            this.renderSingleRow(item);
        }
    }

    /** 渲染单个条目 */
    private renderSingleRow(item: LoraEntryItem): void {
        const row = new LoraItemRow({
            item,
            mode: this.mode,
            availableModels: this.availableModels,
            onUpdate: (id, patch) => this.handleItemUpdate(id, patch),
            onDelete: (id) => this.removeItem(id)
        });
        this.itemRows.set(item.id, row);
        this.listContainer.appendChild(row.element);
    }

    /** 更新配额徽标与空状态展示 */
    private updateQuotaDisplay(): void {
        const count = this.items.length;
        this.quotaBadge.setText(`${count} / ${this.maxCount}`);

        if (count >= this.maxCount) {
            this.quotaBadge.setVariant('warning');
            this.addModelButton.setDisabled(true);
        } else {
            this.quotaBadge.setVariant('info');
            this.addModelButton.setDisabled(false);
        }

        this.emptyNoticeElement.style.display = count === 0 ? 'block' : 'none';
    }

    /** 获取当前全量已挂载条目快照 */
    public getItems(): LoraEntryItem[] {
        return this.items.map(it => ({ ...it }));
    }

    /** 全量设置已挂载条目 */
    public setItems(items: LoraEntryItem[]): void {
        this.items.length = 0;
        for (const it of items) {
            this.items.push({ ...it });
        }
        this.renderAllItems();
        this.updateQuotaDisplay();
        this.notifyChange();
    }

    /** 触发外部变更通知 */
    private notifyChange(): void {
        this.options.onChange?.(this.getItems());
    }

    /** 级联销毁与解绑所有事件 */
    public dispose(): void {
        for (const row of this.itemRows.values()) {
            row.dispose();
        }
        this.itemRows.clear();
        this.modelSelectInput?.dispose();
        this.manualAddInput?.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        this.element.remove();
    }
}
