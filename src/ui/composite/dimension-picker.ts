/**
 * 画幅比例与尺寸选择复合卡片 (DimensionPicker)。
 *
 * @remarks
 * 为生图提供方（SD-WebUI/Forge、ComfyUI、NovelAI、OpenAI 等）提供统一且轻量的画幅尺寸控制外壳：
 * 1. 黄金画幅比例下拉框（1:1 方形、9:16 手机竖屏、16:9 电脑宽屏、3:4 半身、4:3 横幅等），一键填入推荐分辨率；
 * 2. 紧凑型双段像素数值输入框（宽 × 高），默认以 64 倍数对齐以适配潜空间尺寸约束；
 * 3. 严格对齐 240px 标准表单控件宽度，居中排版；
 * 4. 实时像素量与比例状态指示（如 832 × 1216 · 1.01 MP）；
 * 5. 全生命周期级联注销与事件安全释放。
 */

import type { UIComponent, Disposable } from '../types';
import { Card } from '../components/card';
import { FormField } from '../components/form-field';
import { Select, type SelectOption } from '../components/select';
import { NumberInput } from '../components/number-input';
import { Badge } from '../components/badge';
import { logger } from '../../util/logger';

/** 常用画幅比例预设项定义 */
export interface AspectRatioPreset {
    /** 比例标识，如 '1:1', '9:16' */
    readonly id: string;
    /** 显示标签文本 */
    readonly label: string;
    /** 推荐宽度像素 */
    readonly width: number;
    /** 推荐高度像素 */
    readonly height: number;
    /** 宽高比例数值 */
    readonly ratio: number;
}

/** 当前尺寸卡片数据状态 */
export interface DimensionPickerData {
    /** 图像宽度 (像素) */
    width: number;
    /** 图像高度 (像素) */
    height: number;
    /** 当前匹配的比例标识符或 'custom' */
    aspectRatio?: string;
}

/** 尺寸选择卡片构造选项 */
export interface DimensionPickerOptions {
    /** 卡片主标题，默认 "画幅比例与尺寸" */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 初始数据 */
    initialData?: Partial<DimensionPickerData>;
    /** 像素强制对齐倍数，默认 64 */
    alignMultiple?: number;
    /** 允许的最小尺寸，默认 64 */
    minDimension?: number;
    /** 允许的最大尺寸，默认 4096 */
    maxDimension?: number;
    /** 快捷比例预设列表 */
    aspectRatios?: AspectRatioPreset[];
    /** 是否作为嵌入组件（不创建外层 Card 边框与标题） */
    embedded?: boolean;
    /** 数据变更通知回调 */
    onChange?: (data: DimensionPickerData) => void;
}

/** 官方与行业主流推荐的高频画幅比例列表 */
export const DEFAULT_ASPECT_RATIOS: AspectRatioPreset[] = [
    { id: '1:1', label: '1:1 方形', width: 1024, height: 1024, ratio: 1.0 },
    { id: '9:16', label: '9:16 手机竖屏', width: 768, height: 1344, ratio: 768 / 1344 },
    { id: '16:9', label: '16:9 电脑宽屏', width: 1344, height: 768, ratio: 1344 / 768 },
    { id: '3:4', label: '3:4 经典半身', width: 896, height: 1152, ratio: 896 / 1152 },
    { id: '4:3', label: '4:3 经典横幅', width: 1152, height: 896, ratio: 1152 / 896 },
    { id: '2:3', label: '2:3 单反人像', width: 832, height: 1216, ratio: 832 / 1216 },
    { id: '3:2', label: '3:2 单反风光', width: 1216, height: 832, ratio: 1216 / 832 },
    { id: '21:9', label: '21:9 电影画幅', width: 1536, height: 640, ratio: 1536 / 640 },
];

export class DimensionPicker implements UIComponent, Disposable {
    public readonly element: HTMLElement;
    public readonly card?: Card;

    private readonly data: DimensionPickerData;
    private readonly options: DimensionPickerOptions;
    private readonly alignMultiple: number;
    private readonly minDimension: number;
    private readonly maxDimension: number;
    private readonly aspectRatios: AspectRatioPreset[];
    private readonly disposables: Disposable[] = [];

    // 控件引用
    private readonly ratioBadge: Badge;
    private readonly ratioSelect: Select;
    private readonly ratioFormField: FormField;
    private readonly widthInput: NumberInput;
    private readonly heightInput: NumberInput;
    private readonly sizeFormField: FormField;

    constructor(options: DimensionPickerOptions = {}) {
        this.options = options;
        this.alignMultiple = options.alignMultiple ?? 64;
        this.minDimension = options.minDimension ?? 64;
        this.maxDimension = options.maxDimension ?? 4096;
        this.aspectRatios = options.aspectRatios ?? DEFAULT_ASPECT_RATIOS;

        // 1. 初始化尺寸状态并强制倍数对齐
        const initialWidth = this.snapToMultiple(options.initialData?.width ?? 1024);
        const initialHeight = this.snapToMultiple(options.initialData?.height ?? 1024);
        const initialRatio = this.detectRatio(initialWidth, initialHeight);

        this.data = {
            width: initialWidth,
            height: initialHeight,
            aspectRatio: initialRatio,
        };

        // 2. 初始化徽标
        this.ratioBadge = new Badge({
            text: this.getBadgeText(this.data.width, this.data.height, this.data.aspectRatio),
            variant: 'neutral',
        });
        this.disposables.push(this.ratioBadge);

        // 3. 构建第 1 行：画幅比例下拉选择表单项
        const selectOptions: SelectOption[] = this.aspectRatios.map((p) => ({
            value: p.id,
            label: `${p.label} (${p.width} × ${p.height})`,
        }));
        selectOptions.push({ value: 'custom', label: '自定义尺寸' });

        this.ratioSelect = new Select({
            value: this.data.aspectRatio ?? '1:1',
            options: selectOptions,
            onChange: (val: string) => {
                if (val !== 'custom') {
                    const preset = this.aspectRatios.find((p) => p.id === val);
                    if (preset) {
                        this.setDimensions(preset.width, preset.height);
                    }
                } else {
                    this.data.aspectRatio = 'custom';
                    this.ratioBadge.setText(this.getBadgeText(this.data.width, this.data.height, 'custom'));
                    this.notifyChange();
                }
            },
        });
        this.disposables.push(this.ratioSelect);

        this.ratioFormField = new FormField({
            label: '画幅比例',
            tooltip: '选择推荐的黄金比例无畸变预设分辨率',
            control: this.ratioSelect,
        });
        this.disposables.push(this.ratioFormField);

        // 4. 构建第 2 行：画幅尺寸复合输入表单项 (宽 × 高)
        this.widthInput = new NumberInput({
            value: this.data.width,
            min: this.minDimension,
            max: this.maxDimension,
            step: this.alignMultiple,
            unit: 'px',
            onChange: (val) => {
                const nextWidth = this.snapToMultiple(val);
                if (nextWidth !== this.data.width) {
                    this.updateDimensionsInternal(nextWidth, this.data.height);
                }
            },
        });
        this.disposables.push(this.widthInput);

        this.heightInput = new NumberInput({
            value: this.data.height,
            min: this.minDimension,
            max: this.maxDimension,
            step: this.alignMultiple,
            unit: 'px',
            onChange: (val) => {
                const nextHeight = this.snapToMultiple(val);
                if (nextHeight !== this.data.height) {
                    this.updateDimensionsInternal(this.data.width, nextHeight);
                }
            },
        });
        this.disposables.push(this.heightInput);

        const sizeGroup = document.createElement('div');
        sizeGroup.className = 'da-dimension-picker__size-group';

        sizeGroup.appendChild(this.widthInput.element);

        const separator = document.createElement('span');
        separator.className = 'da-dimension-picker__size-separator';
        separator.textContent = '×';
        sizeGroup.appendChild(separator);

        sizeGroup.appendChild(this.heightInput.element);

        this.sizeFormField = new FormField({
            label: '画幅尺寸',
            tooltip: '指定具体生成的像素尺寸 (自动以 64 像素倍数对齐)',
            control: sizeGroup,
        });
        this.disposables.push(this.sizeFormField);

        // 5. 挂载至卡片或根容器
        if (options.embedded) {
            this.element = document.createElement('div');
            this.element.className = 'da-dimension-picker da-dimension-picker--embedded';
            this.element.appendChild(this.ratioFormField.element);
            this.element.appendChild(this.sizeFormField.element);
        } else {
            const card = new Card({
                title: options.title ?? '画幅比例与尺寸',
                subtitle: options.subtitle,
            });
            card.setTitleBadges(this.ratioBadge.element);
            card.appendContent(this.ratioFormField.element);
            card.appendContent(this.sizeFormField.element);
            this.card = card;
            this.element = card.element;
            this.disposables.push(card);
        }
    }

    /**
     * 获取当前尺寸状态数据。
     */
    public getData(): DimensionPickerData {
        return { ...this.data };
    }

    /**
     * 设置部分或全部尺寸数据。
     *
     * @param partial 待更新数据
     * @param options 配置选项（如 silent）
     */
    public setData(partial: Partial<DimensionPickerData>, options?: { silent?: boolean }): void {
        const nextWidth = partial.width !== undefined
            ? this.snapToMultiple(partial.width)
            : this.data.width;
        const nextHeight = partial.height !== undefined
            ? this.snapToMultiple(partial.height)
            : this.data.height;

        this.updateDimensionsInternal(nextWidth, nextHeight, options);
    }

    /**
     * 受控更新宽度与高度数值。
     *
     * @param width 目标宽度 (px)
     * @param height 目标高度 (px)
     * @param options 配置选项
     */
    public setDimensions(width: number, height: number, options?: { silent?: boolean }): void {
        const snappedWidth = this.snapToMultiple(width);
        const snappedHeight = this.snapToMultiple(height);
        this.updateDimensionsInternal(snappedWidth, snappedHeight, options);
    }

    /**
     * 兼容性保留：互换当前宽度与高度。
     */
    public swapDimensions(): void {
        const currentWidth = this.data.width;
        const currentHeight = this.data.height;
        this.setDimensions(currentHeight, currentWidth);
    }

    /**
     * 内部更新逻辑：同步输入框、下拉框选项与徽标，并触发数据变更通知。
     */
    private updateDimensionsInternal(
        width: number,
        height: number,
        options?: { silent?: boolean }
    ): void {
        this.data.width = width;
        this.data.height = height;
        this.data.aspectRatio = this.detectRatio(width, height);

        // 同步输入框状态 (静默以避免循环触发)
        this.widthInput.setValue(width, { silent: true });
        this.heightInput.setValue(height, { silent: true });

        // 同步下拉框选项
        this.ratioSelect.setValue(this.data.aspectRatio, { silent: true });

        // 同步徽标
        this.ratioBadge.setText(this.getBadgeText(width, height, this.data.aspectRatio));

        if (!options?.silent) {
            this.notifyChange();
        }
    }

    /**
     * 将数值对齐至配置的倍数 (默认 64)，并截断在允许区间内。
     */
    private snapToMultiple(val: number): number {
        const clamped = Math.max(this.minDimension, Math.min(this.maxDimension, val));
        const snapped = Math.round(clamped / this.alignMultiple) * this.alignMultiple;
        return Math.max(this.minDimension, Math.min(this.maxDimension, snapped));
    }

    /**
     * 检测当前长宽比是否匹配已知预设（优先精确匹配，其次比例容差 < 2%）。
     */
    private detectRatio(width: number, height: number): string {
        if (width <= 0 || height <= 0) return 'custom';

        // 1. 优先精确匹配预设尺寸
        for (const preset of this.aspectRatios) {
            if (width === preset.width && height === preset.height) {
                return preset.id;
            }
        }

        // 2. 比对比例数值 (容差 < 2%)
        const currentRatio = width / height;
        for (const preset of this.aspectRatios) {
            const diff = Math.abs(currentRatio - preset.ratio) / preset.ratio;
            if (diff < 0.02) {
                return preset.id;
            }
        }
        return 'custom';
    }

    /**
     * 计算并格式化徽标文本。
     */
    private getBadgeText(width: number, height: number, ratioId?: string): string {
        const mp = ((width * height) / 1000000).toFixed(2);
        const ratioLabel = ratioId && ratioId !== 'custom' ? ` · ${ratioId}` : '';
        return `${width} × ${height} (${mp} MP${ratioLabel})`;
    }

    private notifyChange(): void {
        if (this.options.onChange) {
            try {
                this.options.onChange(this.getData());
            } catch (err) {
                logger.error('[DimensionPicker] onChange 回调执行异常:', err instanceof Error ? err.message : String(err));
            }
        }
    }

    /**
     * 释放卡片内所有子控件与事件监听。
     */
    public dispose(): void {
        for (const item of this.disposables) {
            try {
                item.dispose();
            } catch {
                // 忽略释放异常
            }
        }
        this.disposables.length = 0;
        this.element.parentElement?.removeChild(this.element);
    }
}
