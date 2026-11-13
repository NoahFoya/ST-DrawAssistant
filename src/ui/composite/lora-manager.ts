/**
 * LoRA 动态管理复合组件 (LoraManager)。
 *
 * @remarks
 * 负责生图任务中 LoRA 模型的语法模式切换、检索联想选择、挂载与权重管理：
 * 1. 第 1 行（标准表单行）：左侧为“LoRA 添加模式”及悬停提示说明（?），右侧切换 SD-WebUI (`<lora:...>`) 与 ComfyUI (`<wlr:...>`) 模式；
 * 2. 第 2 行（检索联想添加栏）：左侧为可输入联想选择下拉框（仅支持从已同步的服务端模型列表中联想筛选并选择，不支持手动添加未知模型），右侧为添加按钮；
 * 3. 无数量上限：不限制挂载的 LoRA 数量；
 * 4. 条目卡片列表：展示实时语法标签预览、启用/停用开关、移除按钮及自适应多维权重步进器。
 */

import type { UIComponent, Disposable } from '../types';
import type { LoraSyntaxMode } from '@types';
import { Card } from '../components/card';
import { FormField } from '../components/form-field';
import { SegmentedControl } from '../components/segmented-control';
import { Switch } from '../components/switch';
import { NumberInput } from '../components/number-input';
import { Button } from '../components/button';
import { Badge } from '../components/badge';
import { renderIcon } from '../components/icons';
import { formatLoraTag, type FormatLoraTagInput } from '../../pipeline/prompt-pipeline';

export type { LoraSyntaxMode, FormatLoraTagInput };
export { formatLoraTag };

/** 单个已挂载 LoRA 条目数据模型 */
export interface LoraEntryItem {
    readonly id: string;
    /** 启用状态，关闭时条目停用，生图处理时忽略该项 */
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
    /** 是否以嵌入式无外框模式渲染（用于独立模态弹窗内部，消除双层卡片嵌套），默认 false */
    embedded?: boolean;
    /** LoRA 语法模式：标准模式 ('standard') 或 WeiLin 扩展模式 ('weilin')，默认 'standard' */
    mode?: LoraSyntaxMode;
    /** 外部注入的已载入可用 LoRA 模型文件名列表 */
    availableModels?: string[];
    /** 初始挂载的 LoRA 列表条目 */
    initialItems?: LoraEntryItem[];
    /** 条目变更回调通知 */
    onChange?(items: LoraEntryItem[]): void;
    /** 语法模式变更回调通知 */
    onModeChange?(mode: LoraSyntaxMode): void;
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

    private mode: LoraSyntaxMode;
    private availableModels: string[];

    private readonly switchControl: Switch;
    private readonly nameTextEl: HTMLElement;
    private readonly missingBadgeEl: HTMLElement;
    private readonly tagPreviewEl: HTMLElement;
    private readonly deleteBadge: HTMLButtonElement;
    private readonly paramsRow: HTMLElement;

    private modelWeightInput!: NumberInput;
    private clipWeightInput!: NumberInput;
    private triggerWeightInput?: NumberInput;

    constructor(options: LoraItemRowOptions) {
        this.options = options;
        this.item = options.item;
        this.mode = options.mode;
        this.availableModels = options.availableModels;

        // 1. 条目主容器 (.da-lora-item)
        this.element = document.createElement('div');
        this.element.classList.add('da-lora-item');
        if (!this.item.enabled) {
            this.element.classList.add('is-disabled');
        }

        // 2. 首行：左侧开关与模型标识/实时标签预览，右侧移除按钮 (.da-lora-item__row--header)
        const headerRow = document.createElement('div');
        headerRow.classList.add('da-lora-item__row--header');

        const identityBox = document.createElement('div');
        identityBox.classList.add('da-lora-item__identity');

        const switchBox = document.createElement('div');
        switchBox.classList.add('da-lora-item__switch-box');
        this.switchControl = new Switch({
            value: this.item.enabled,
            onChange: (enabled) => {
                this.item.enabled = enabled;
                this.updateDisabledState(!enabled);
                this.options.onUpdate(this.item.id, { enabled });
            },
        });
        this.disposables.push(this.switchControl);
        switchBox.appendChild(this.switchControl.element);
        identityBox.appendChild(switchBox);

        const titleWrap = document.createElement('div');
        titleWrap.classList.add('da-lora-item__title-wrap');

        const nameLine = document.createElement('div');
        nameLine.classList.add('da-lora-item__name-line');

        this.nameTextEl = document.createElement('span');
        this.nameTextEl.classList.add('da-lora-item__name');
        this.nameTextEl.textContent = this.item.modelName || '(未命名模型)';
        this.nameTextEl.title = this.item.modelName || '';
        nameLine.appendChild(this.nameTextEl);

        this.missingBadgeEl = document.createElement('span');
        this.missingBadgeEl.classList.add('da-lora-item__missing-dot');
        this.missingBadgeEl.title = '服务端未检测到此模型，仍会按名称生成对应标签';
        nameLine.appendChild(this.missingBadgeEl);

        this.tagPreviewEl = document.createElement('code');
        this.tagPreviewEl.classList.add('da-lora-item__tag-preview');

        titleWrap.appendChild(nameLine);
        titleWrap.appendChild(this.tagPreviewEl);
        identityBox.appendChild(titleWrap);
        headerRow.appendChild(identityBox);

        // 右侧移除按钮
        this.deleteBadge = document.createElement('button');
        this.deleteBadge.type = 'button';
        this.deleteBadge.classList.add('da-lora-item__delete-badge', 'da-lora-item__remove-btn');
        this.deleteBadge.setAttribute('aria-label', '移除该 LoRA');
        this.deleteBadge.title = '移除该 LoRA';
        this.deleteBadge.textContent = '移除';
        const onDeleteClick = (e: MouseEvent) => {
            e.stopPropagation();
            this.options.onDelete(this.item.id);
        };
        this.deleteBadge.addEventListener('click', onDeleteClick);
        this.disposables.push({
            dispose: () => this.deleteBadge.removeEventListener('click', onDeleteClick),
        });
        headerRow.appendChild(this.deleteBadge);
        this.element.appendChild(headerRow);

        // 3. 次行：自适应网格参数步进器容器 (.da-lora-item__row--params)
        this.paramsRow = document.createElement('div');
        this.paramsRow.classList.add('da-lora-item__row--params');
        this.renderParamsInputs(this.mode);
        this.element.appendChild(this.paramsRow);

        this.refreshHeaderMeta();
    }

    /** 刷新模型缺失标记与实时标签预览 */
    private refreshHeaderMeta(): void {
        this.nameTextEl.textContent = this.item.modelName || '(未命名模型)';
        this.nameTextEl.title = this.item.modelName || '';

        const isMissing =
            Boolean(this.item.modelName) &&
            this.availableModels.length > 0 &&
            !this.availableModels.includes(this.item.modelName);
        this.missingBadgeEl.style.display = isMissing ? 'inline-block' : 'none';
        if (isMissing) {
            this.element.classList.add('is-missing');
            this.element.title = '服务端未检测到此模型，仍会按名称生成对应标签';
        } else {
            this.element.classList.remove('is-missing');
            this.element.title = '';
        }

        const previewTag = formatLoraTag(this.item, this.mode);
        this.tagPreviewEl.textContent = previewTag || '<lora:未指定:0.8>';
    }

    /** 渲染次行参数步进器 */
    public renderParamsInputs(mode: LoraSyntaxMode): void {
        this.mode = mode;
        this.paramsRow.innerHTML = '';
        this.modelWeightInput?.dispose();
        this.clipWeightInput?.dispose();
        this.triggerWeightInput?.dispose();

        // 1. Model 权重步进器
        const modelGroup = document.createElement('div');
        modelGroup.classList.add('da-lora-param-group');
        const modelLabel = document.createElement('span');
        modelLabel.classList.add('da-lora-param-label');
        modelLabel.textContent = '模型权重 (Model)';
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
                this.refreshHeaderMeta();
                this.options.onUpdate(this.item.id, { modelWeight: val });
            },
        });
        modelGroup.appendChild(this.modelWeightInput.element);
        this.paramsRow.appendChild(modelGroup);

        // 2. CLIP 权重步进器
        const clipGroup = document.createElement('div');
        clipGroup.classList.add('da-lora-param-group');
        const clipLabel = document.createElement('span');
        clipLabel.classList.add('da-lora-param-label');
        clipLabel.textContent = 'CLIP 权重 (CLIP)';
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
                this.refreshHeaderMeta();
                this.options.onUpdate(this.item.id, { clipWeight: val });
            },
        });
        clipGroup.appendChild(this.clipWeightInput.element);
        this.paramsRow.appendChild(clipGroup);

        // 3. WeiLin 模式专属：Trigger 权重步进器
        if (mode === 'weilin') {
            const triggerGroup = document.createElement('div');
            triggerGroup.classList.add('da-lora-param-group');
            const triggerLabel = document.createElement('span');
            triggerLabel.classList.add('da-lora-param-label');
            triggerLabel.textContent = '触发词权重 (Trigger)';
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
                    this.refreshHeaderMeta();
                    this.options.onUpdate(this.item.id, { triggerWeight: val });
                },
            });
            triggerGroup.appendChild(this.triggerWeightInput.element);
            this.paramsRow.appendChild(triggerGroup);
        } else {
            this.triggerWeightInput = undefined;
        }

        this.refreshHeaderMeta();
    }

    /** 语法模式发生变化时动态更新次行与标签预览 */
    public updateMode(mode: LoraSyntaxMode): void {
        this.renderParamsInputs(mode);
    }

    /** 可用模型资产发生变化时更新检测标识 */
    public updateAvailableModels(availableModels: string[]): void {
        this.availableModels = availableModels;
        this.refreshHeaderMeta();
    }

    /** 更新启用/停用状态 */
    public updateDisabledState(disabled: boolean): void {
        this.element.classList.toggle('is-disabled', disabled);
        this.modelWeightInput.setDisabled(disabled);
        this.clipWeightInput.setDisabled(disabled);
        this.triggerWeightInput?.setDisabled(disabled);
    }

    public dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        this.modelWeightInput?.dispose();
        this.clipWeightInput?.dispose();
        this.triggerWeightInput?.dispose();
        this.switchControl.dispose();
        this.element.remove();
    }
}

/**
 * 业务复合组件：LoRA 动态管理器 (LoraManager)。
 */
export class LoraManager implements UIComponent, Disposable {
    public readonly element: HTMLElement;

    private readonly card?: Card;
    private readonly options: LoraManagerOptions;
    private readonly items: LoraEntryItem[] = [];
    private readonly itemRows = new Map<string, LoraItemRow>();
    private readonly disposables: Disposable[] = [];

    private mode: LoraSyntaxMode;
    private availableModels: string[];
    private readonly isEmbedded: boolean;

    private readonly quotaBadge: Badge;
    private readonly modeSegmented: SegmentedControl;
    private readonly modeFormField: FormField;
    private readonly addBarContainer: HTMLElement;
    private readonly comboboxContainer: HTMLElement;
    private readonly comboboxInput: HTMLInputElement;
    private readonly comboboxClearBtn: HTMLButtonElement;
    private readonly comboboxToggleBtn: HTMLButtonElement;
    private readonly comboboxDropdown: HTMLElement;
    private readonly addModelButton: Button;

    private filterKeyword = '';
    private selectedAddModelName = '';
    private highlightedIndex = 0;
    private isDropdownOpen = false;

    private readonly listContainer: HTMLElement;
    private readonly emptyNoticeElement: HTMLElement;

    constructor(options: LoraManagerOptions = {}) {
        this.options = options;
        this.mode = options.mode ?? 'standard';
        this.availableModels = [...(options.availableModels ?? [])];
        this.isEmbedded = Boolean(options.embedded);

        // 1. 统计徽标（不设上限）
        this.quotaBadge = new Badge({
            text: '已启用 0 / 共 0 项',
            variant: 'info',
        });
        this.disposables.push(this.quotaBadge);

        // 2. 初始化容器（独立卡片模式 vs 模态框内嵌模式）
        let contentHost: HTMLElement;
        if (this.isEmbedded) {
            this.element = document.createElement('div');
            this.element.className = 'da-lora-manager da-lora-manager--embedded';
            contentHost = this.element;
        } else {
            this.card = new Card({
                title: options.title ?? 'LoRA 模型管理',
                subtitle: options.subtitle ?? '检索并配置生图 LoRA 模型及权重',
            });
            this.element = this.card.element;
            this.element.classList.add('da-lora-manager');
            this.card.setBadges(this.quotaBadge.element);
            this.disposables.push(this.card);
            contentHost = this.card.getBodyElement();
        }

        // 3. 顶部控制面板 (.da-lora-add-bar)：
        //    第 1 行：标准表单行（左：LoRA 添加模式 + ? 帮助提示；右：SD-WebUI / ComfyUI 切换）
        //    第 2 行：可输入联想选择下拉框 + 添加按钮
        this.addBarContainer = document.createElement('div');
        this.addBarContainer.classList.add('da-lora-add-bar');

        this.modeSegmented = new SegmentedControl({
            value: this.mode,
            options: [
                { label: 'SD-WebUI', value: 'standard' },
                { label: 'ComfyUI', value: 'weilin' },
            ],
            onChange: (val) => {
                const nextMode = (val === 'weilin' ? 'weilin' : 'standard') as LoraSyntaxMode;
                this.setMode(nextMode);
            },
        });
        this.disposables.push(this.modeSegmented);

        this.modeFormField = new FormField({
            label: 'LoRA 添加模式',
            tooltip:
                'SD-WebUI 模式生成标准的 <lora:模型:模型权重:CLIP权重> 标签（适用于 SD-WebUI / Forge）；ComfyUI 模式生成 <wlr:模型:模型权重:CLIP权重:触发词权重> 标签，配合 ComfyUI-WeiLin 节点在 API 工作流中通过提示词动态加载与调节 LoRA。',
            width: 'w-240',
            className: 'da-lora-mode-row',
            control: this.modeSegmented,
        });
        this.disposables.push(this.modeFormField);
        this.addBarContainer.appendChild(this.modeFormField.element);

        // 第 2 行：输入联想选择下拉框 + 添加按钮
        const addControlsRow = document.createElement('div');
        addControlsRow.classList.add('da-lora-add-bar__row');

        this.comboboxContainer = document.createElement('div');
        this.comboboxContainer.classList.add('da-lora-combobox');

        const inputBox = document.createElement('div');
        inputBox.classList.add('da-input-wrapper', 'da-lora-combobox__box');

        this.comboboxInput = document.createElement('input');
        this.comboboxInput.type = 'text';
        this.comboboxInput.classList.add('da-input', 'da-lora-combobox__input');
        this.comboboxInput.autocomplete = 'off';
        this.comboboxInput.setAttribute('role', 'combobox');
        this.comboboxInput.setAttribute('aria-autocomplete', 'list');
        this.comboboxInput.setAttribute('aria-expanded', 'false');
        inputBox.appendChild(this.comboboxInput);

        this.comboboxClearBtn = document.createElement('button');
        this.comboboxClearBtn.type = 'button';
        this.comboboxClearBtn.classList.add('da-lora-combobox__clear');
        this.comboboxClearBtn.title = '清空输入';
        this.comboboxClearBtn.innerHTML = renderIcon('close', 12);
        this.comboboxClearBtn.style.display = 'none';
        inputBox.appendChild(this.comboboxClearBtn);

        this.comboboxToggleBtn = document.createElement('button');
        this.comboboxToggleBtn.type = 'button';
        this.comboboxToggleBtn.classList.add('da-lora-combobox__toggle');
        this.comboboxToggleBtn.title = '展开/收起候选模型列表';
        this.comboboxToggleBtn.innerHTML = renderIcon('chevronDown', 14);
        inputBox.appendChild(this.comboboxToggleBtn);

        this.comboboxDropdown = document.createElement('div');
        this.comboboxDropdown.className = 'da-lora-combobox__dropdown st-da-root';
        this.comboboxDropdown.setAttribute('role', 'listbox');
        this.comboboxDropdown.style.display = 'none';
        if (typeof document !== 'undefined') {
            document.body.appendChild(this.comboboxDropdown);
        }

        this.comboboxContainer.appendChild(inputBox);
        addControlsRow.appendChild(this.comboboxContainer);

        this.addModelButton = new Button({
            label: '添加',
            variant: 'secondary',
            size: 'sm',
            onClick: () => this.handleQuickAdd(),
        });
        this.disposables.push(this.addModelButton);
        addControlsRow.appendChild(this.addModelButton.element);

        this.addBarContainer.appendChild(addControlsRow);
        contentHost.appendChild(this.addBarContainer);

        // 4. 已挂载条目列表容器 (.da-lora-list)
        this.listContainer = document.createElement('div');
        this.listContainer.classList.add('da-lora-list');
        contentHost.appendChild(this.listContainer);

        // 5. 空列表提示
        this.emptyNoticeElement = document.createElement('div');
        this.emptyNoticeElement.classList.add('da-lora-list__empty');
        this.emptyNoticeElement.textContent = '暂无已挂载 LoRA 模型，可从上方下拉框选择并添加';
        contentHost.appendChild(this.emptyNoticeElement);

        // 6. 装载初始条目
        if (options.initialItems && options.initialItems.length > 0) {
            for (const item of options.initialItems) {
                this.items.push({ ...item });
            }
        }

        this.bindComboboxEvents();
        this.refreshComboboxState();
        this.renderAllItems();
        this.updateQuotaDisplay();
    }

    /** 绑定输入联想下拉框交互事件 */
    private bindComboboxEvents(): void {
        const onInput = () => {
            this.filterKeyword = this.comboboxInput.value.trim();
            this.comboboxClearBtn.style.display = this.comboboxInput.value.length > 0 ? 'inline-flex' : 'none';
            this.highlightedIndex = 0;

            // 仅当输入内容完整匹配已同步模型，或用户从下拉候选列表中点选后，才激活添加按钮
            this.selectedAddModelName = this.availableModels.includes(this.filterKeyword)
                ? this.filterKeyword
                : '';

            this.openDropdown();
            this.renderDropdownOptions();
            this.updateQuotaDisplay();
        };

        const onFocus = () => {
            if (this.availableModels.length > 0) {
                this.openDropdown();
                this.renderDropdownOptions();
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            const matched = this.getFilteredModels();
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!this.isDropdownOpen) {
                    this.openDropdown();
                } else if (matched.length > 0) {
                    this.highlightedIndex = (this.highlightedIndex + 1) % matched.length;
                    this.selectedAddModelName = matched[this.highlightedIndex] ?? '';
                }
                this.renderDropdownOptions();
                this.updateQuotaDisplay();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (matched.length > 0) {
                    this.highlightedIndex = (this.highlightedIndex - 1 + matched.length) % matched.length;
                    this.selectedAddModelName = matched[this.highlightedIndex] ?? '';
                }
                this.renderDropdownOptions();
                this.updateQuotaDisplay();
            } else if (e.key === 'Enter') {
                if (this.isDropdownOpen && matched.length > 0) {
                    e.preventDefault();
                    const picked = matched[this.highlightedIndex] ?? matched[0];
                    if (picked) {
                        this.selectModelFromDropdown(picked);
                    }
                }
            } else if (e.key === 'Escape') {
                if (this.isDropdownOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeDropdown();
                }
            }
        };

        const onClearClick = (e: MouseEvent) => {
            e.stopPropagation();
            this.comboboxInput.value = '';
            this.filterKeyword = '';
            this.selectedAddModelName = '';
            this.comboboxClearBtn.style.display = 'none';
            this.highlightedIndex = 0;
            this.renderDropdownOptions();
            this.updateQuotaDisplay();
            this.comboboxInput.focus();
        };

        const onToggleClick = (e: MouseEvent) => {
            e.stopPropagation();
            if (this.availableModels.length === 0) return;
            if (this.isDropdownOpen) {
                this.closeDropdown();
            } else {
                this.openDropdown();
                this.renderDropdownOptions();
                this.comboboxInput.focus();
            }
        };

        const onDocumentClick = (e: MouseEvent) => {
            const targetNode = e.target as Node | null;
            if (
                this.isDropdownOpen &&
                targetNode &&
                !this.comboboxContainer.contains(targetNode) &&
                !this.comboboxDropdown.contains(targetNode)
            ) {
                this.closeDropdown();
            }
        };

        const onScrollCapture = (e: Event) => {
            if (this.isDropdownOpen) {
                if (e.target === this.comboboxDropdown || this.comboboxDropdown.contains(e.target as Node)) {
                    return;
                }
                this.positionDropdown();
            }
        };

        const onResize = () => {
            if (this.isDropdownOpen) {
                this.positionDropdown();
            }
        };

        this.comboboxInput.addEventListener('input', onInput);
        this.comboboxInput.addEventListener('focus', onFocus);
        this.comboboxInput.addEventListener('keydown', onKeyDown);
        this.comboboxClearBtn.addEventListener('click', onClearClick);
        this.comboboxToggleBtn.addEventListener('click', onToggleClick);
        if (typeof document !== 'undefined') {
            document.addEventListener('click', onDocumentClick);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('scroll', onScrollCapture, true);
            window.addEventListener('resize', onResize);
        }

        this.disposables.push({
            dispose: () => {
                this.comboboxInput.removeEventListener('input', onInput);
                this.comboboxInput.removeEventListener('focus', onFocus);
                this.comboboxInput.removeEventListener('keydown', onKeyDown);
                this.comboboxClearBtn.removeEventListener('click', onClearClick);
                this.comboboxToggleBtn.removeEventListener('click', onToggleClick);
                if (typeof document !== 'undefined') {
                    document.removeEventListener('click', onDocumentClick);
                }
                if (typeof window !== 'undefined') {
                    window.removeEventListener('scroll', onScrollCapture, true);
                    window.removeEventListener('resize', onResize);
                }
            },
        });
    }

    /** 获取当前关键词联想匹配的可用模型列表 */
    private getFilteredModels(): string[] {
        if (this.availableModels.length === 0) {
            return [];
        }
        const kwLower = this.filterKeyword.toLowerCase();
        if (!kwLower) {
            return this.availableModels;
        }
        return this.availableModels.filter((m) => m.toLowerCase().includes(kwLower));
    }

    /** 刷新联想下拉框初始状态与占位文案 */
    private refreshComboboxState(): void {
        this.filterKeyword = '';
        this.selectedAddModelName = '';
        this.comboboxInput.value = '';
        this.comboboxClearBtn.style.display = 'none';
        this.highlightedIndex = 0;

        if (this.availableModels.length > 0) {
            this.comboboxInput.disabled = false;
            this.comboboxToggleBtn.disabled = false;
            this.comboboxInput.placeholder = `输入关键词联想或点击下拉选择 LoRA 模型 (共 ${this.availableModels.length} 个)...`;
        } else {
            this.comboboxInput.disabled = true;
            this.comboboxToggleBtn.disabled = true;
            this.comboboxInput.placeholder = '暂未同步服务端 LoRA 列表，请先在服务连接卡片中测试并同步';
            this.closeDropdown();
        }

        this.renderDropdownOptions();
    }

    /** 动态计算并设置下拉浮层在视口中的 Fixed 绝对坐标 */
    private positionDropdown(): void {
        if (!this.isDropdownOpen || typeof window === 'undefined') {
            return;
        }
        const rect = this.comboboxInput.getBoundingClientRect();
        const viewportH = window.innerHeight || 800;
        const viewportW = window.innerWidth || 1200;

        const width = Math.max(260, rect.width || 300);
        const left = Math.max(8, Math.min(rect.left, viewportW - width - 8));
        let top = rect.bottom + 4;

        if (top + 224 > viewportH && rect.top > 230) {
            top = Math.max(8, rect.top - 228);
        }

        this.comboboxDropdown.style.width = `${width}px`;
        this.comboboxDropdown.style.left = `${left}px`;
        this.comboboxDropdown.style.top = `${top}px`;
    }

    /** 打开候选列表下拉浮层 */
    private openDropdown(): void {
        if (this.availableModels.length === 0) return;
        this.isDropdownOpen = true;
        this.positionDropdown();
        this.comboboxDropdown.style.display = 'block';
        this.comboboxInput.setAttribute('aria-expanded', 'true');
        this.comboboxContainer.classList.add('is-open');
    }

    /** 关闭候选列表下拉浮层 */
    private closeDropdown(): void {
        this.isDropdownOpen = false;
        this.comboboxDropdown.style.display = 'none';
        this.comboboxInput.setAttribute('aria-expanded', 'false');
        this.comboboxContainer.classList.remove('is-open');
    }

    /** 渲染候选下拉选项列表 */
    private renderDropdownOptions(): void {
        this.comboboxDropdown.innerHTML = '';
        const matched = this.getFilteredModels();

        if (matched.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-lora-combobox__empty';
            emptyEl.textContent =
                this.availableModels.length === 0
                    ? '未同步服务端模型列表'
                    : '无匹配的已同步 LoRA 模型';
            this.comboboxDropdown.appendChild(emptyEl);
            return;
        }

        if (this.highlightedIndex >= matched.length) {
            this.highlightedIndex = 0;
        }

        matched.forEach((modelName, idx) => {
            const optBtn = document.createElement('button');
            optBtn.type = 'button';
            optBtn.setAttribute('role', 'option');
            optBtn.className = 'da-lora-combobox__option';
            if (idx === this.highlightedIndex || modelName === this.selectedAddModelName) {
                optBtn.classList.add('is-active');
                optBtn.setAttribute('aria-selected', 'true');
            } else {
                optBtn.setAttribute('aria-selected', 'false');
            }
            optBtn.textContent = modelName;
            optBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectModelFromDropdown(modelName);
            });
            optBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectModelFromDropdown(modelName);
            });
            this.comboboxDropdown.appendChild(optBtn);
        });
    }

    /** 从联想下拉列表中选中某个合法模型 */
    private selectModelFromDropdown(modelName: string): void {
        if (!this.availableModels.includes(modelName)) {
            return;
        }
        this.selectedAddModelName = modelName;
        this.comboboxInput.value = modelName;
        this.filterKeyword = '';
        this.comboboxClearBtn.style.display = 'inline-flex';
        this.closeDropdown();
        this.updateQuotaDisplay();
    }

    /** 触发添加操作（仅允许添加存在于 availableModels 中的有效模型，添加后自动清空输入框） */
    private handleQuickAdd(): void {
        const modelName = this.selectedAddModelName.trim();
        if (!modelName || !this.availableModels.includes(modelName)) {
            return;
        }
        this.addItem({ modelName });
        this.selectedAddModelName = '';
        this.comboboxInput.value = '';
        this.filterKeyword = '';
        this.comboboxClearBtn.style.display = 'none';
        this.highlightedIndex = 0;
        this.closeDropdown();
        this.renderDropdownOptions();
        this.updateQuotaDisplay();
    }

    /** 获取当前语法模式 */
    public getMode(): LoraSyntaxMode {
        return this.mode;
    }

    /** 动态设置语法模式并重绘条目参数步进器 */
    public setMode(mode: LoraSyntaxMode): void {
        if (this.mode === mode) return;
        this.mode = mode;
        this.modeSegmented.setValue(mode, { silent: true });

        for (const item of this.items) {
            if (mode === 'weilin' && item.triggerWeight === undefined) {
                item.triggerWeight = 1.0;
            }
        }

        for (const row of this.itemRows.values()) {
            row.updateMode(mode);
        }

        this.options.onModeChange?.(mode);
        this.notifyChange();
    }

    /** 获取已绑定的可用模型列表 */
    public getAvailableModels(): string[] {
        return this.availableModels;
    }

    /** 受控更新可用模型列表并同步刷新添加栏与各条目资产选项 */
    public setAvailableModels(models: string[]): void {
        this.availableModels = [...models];
        this.refreshComboboxState();

        for (const row of this.itemRows.values()) {
            row.updateAvailableModels(this.availableModels);
        }
        this.updateQuotaDisplay();
    }

    /** 添加新的 LoRA 条目（不设数量上限） */
    public addItem(partial?: Partial<LoraEntryItem>): void {
        const newItem: LoraEntryItem = {
            id: partial?.id ?? `lora_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            enabled: partial?.enabled ?? true,
            modelName: partial?.modelName ?? '',
            modelWeight: partial?.modelWeight ?? 0.8,
            clipWeight: partial?.clipWeight ?? 0.8,
            triggerWeight: partial?.triggerWeight ?? (this.mode === 'weilin' ? 1.0 : undefined),
        };

        this.items.push(newItem);
        this.renderSingleRow(newItem);
        this.updateQuotaDisplay();
        this.notifyChange();
    }

    /** 移除指定 LoRA 条目 */
    public removeItem(id: string): void {
        const index = this.items.findIndex((it) => it.id === id);
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
        const item = this.items.find((it) => it.id === id);
        if (!item) return;

        Object.assign(item, patch);
        this.updateQuotaDisplay();
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
            onDelete: (id) => this.removeItem(id),
        });
        this.itemRows.set(item.id, row);
        this.listContainer.appendChild(row.element);
    }

    /** 更新计数徽标、按钮使能状态与空列表提示 */
    private updateQuotaDisplay(): void {
        const count = this.items.length;
        const activeCount = this.items.filter((it) => it.enabled !== false).length;
        this.quotaBadge.setText(`已启用 ${activeCount} / 共 ${count} 项`);
        this.quotaBadge.setVariant('info');

        const canAdd =
            Boolean(this.selectedAddModelName) &&
            this.availableModels.includes(this.selectedAddModelName);
        this.addModelButton.setDisabled(!canAdd);

        this.emptyNoticeElement.style.display = count === 0 ? 'block' : 'none';
    }

    /** 获取当前全量已挂载条目快照 */
    public getItems(): LoraEntryItem[] {
        return this.items.map((it) => ({ ...it }));
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
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        this.closeDropdown();
        this.comboboxDropdown.remove();
        this.element.remove();
    }
}
