/**
 * 画幅比例与尺寸选择复合卡片 (DimensionPicker)。
 *
 * @remarks
 * 基于 Preact JSX 为生图提供方提供统一画幅尺寸控制：
 * 1. 黄金画幅比例下拉框，一键填入推荐分辨率（可选支持「自动 (由模型决定)」）；
 * 2. 紧凑型双段像素数值输入框（宽 × 高），支持自由输入整数像素分辨率；
 * 3. 实时像素量与比例状态指示徽标（如 832 × 1216 (1.01 MP)）。
 */

import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SelectOption } from '../components/select';
import {
    BadgeView,
    CardView,
    FormFieldView,
    NumberInputControl,
    SelectControl,
} from '../framework/controls';
import {
    type AspectRatioPreset,
    DEFAULT_ASPECT_RATIOS,
    OPENAI_ASPECT_RATIOS,
    GPT_IMAGE_ASPECT_RATIOS,
} from '../../domain/provider-specs/dimensions';

export {
    type AspectRatioPreset,
    DEFAULT_ASPECT_RATIOS,
    OPENAI_ASPECT_RATIOS,
    GPT_IMAGE_ASPECT_RATIOS,
};

/** 当前尺寸卡片数据状态 */
export interface DimensionPickerData {
    /** 图像宽度 (像素) */
    width: number;
    /** 图像高度 (像素) */
    height: number;
    /** 当前匹配的比例标识符或 'custom' / 'auto' */
    aspectRatio?: string;
}

/** 尺寸选择卡片组件属性 */
export interface DimensionPickerProps {
    /** 卡片主标题，默认 "画幅比例与尺寸" */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 当前宽度 (px) */
    width?: number;
    /** 当前高度 (px) */
    height?: number;
    /** 当前比例标识（如 'auto'） */
    aspectRatio?: string;
    /** 允许的最小尺寸，默认 64 */
    minDimension?: number;
    /** 允许的最大尺寸，默认 4096 */
    maxDimension?: number;
    /** 快捷比例预设列表 */
    aspectRatios?: AspectRatioPreset[];
    /** 是否允许选择「自动 (由模型决定)」模式 */
    allowAuto?: boolean;
    /** 是否作为嵌入组件（不创建外层 Card 边框与标题） */
    embedded?: boolean;
    /** 是否处于未保存脏状态 */
    dirty?: boolean;
    /** 附加 CSS 类名 */
    className?: string;
    /** 数据变更通知回调 */
    onChange?: (data: DimensionPickerData) => void;
}

export function clampDimensionValue(val: number, minDim = 64, maxDim = 4096): number {
    const rounded = Math.round(Number.isFinite(val) ? val : 1024);
    return Math.max(minDim, Math.min(maxDim, rounded));
}

export function detectDimensionRatio(
    width: number,
    height: number,
    aspectRatios: readonly AspectRatioPreset[] = DEFAULT_ASPECT_RATIOS
): string {
    if (width <= 0 || height <= 0) return 'custom';

    for (const preset of aspectRatios) {
        if (width === preset.width && height === preset.height) {
            return preset.id;
        }
    }

    const currentRatio = width / height;
    for (const preset of aspectRatios) {
        const diff = Math.abs(currentRatio - preset.ratio) / preset.ratio;
        if (diff < 0.02) {
            return preset.id;
        }
    }
    return 'custom';
}

function formatDimensionBadgeText(width: number, height: number, ratioId?: string): string {
    if (ratioId === 'auto') {
        return '自动 (由模型决定)';
    }
    const mp = ((width * height) / 1000000).toFixed(2);
    const ratioLabel = ratioId && ratioId !== 'custom' ? ` · ${ratioId}` : '';
    return `${width} × ${height} (${mp} MP${ratioLabel})`;
}

export function DimensionPicker(props: DimensionPickerProps): VNode {
    const minDim = props.minDimension ?? 64;
    const maxDim = props.maxDimension ?? 4096;
    const aspectRatios = props.aspectRatios ?? DEFAULT_ASPECT_RATIOS;
    const allowAuto = Boolean(props.allowAuto);

    const resolveFromProps = (): DimensionPickerData => {
        const w = clampDimensionValue(props.width ?? 1024, minDim, maxDim);
        const h = clampDimensionValue(props.height ?? 1024, minDim, maxDim);
        const isAuto = allowAuto && props.aspectRatio === 'auto';
        const ratio = isAuto ? 'auto' : detectDimensionRatio(w, h, aspectRatios);
        return { width: w, height: h, aspectRatio: ratio };
    };

    const [localData, setLocalData] = useState<DimensionPickerData>(() => resolveFromProps());
    const prevPropKeyRef = useRef(
        `${props.width ?? ''}:${props.height ?? ''}:${props.aspectRatio ?? ''}:${allowAuto}`
    );

    useEffect(() => {
        const nextKey = `${props.width ?? ''}:${props.height ?? ''}:${props.aspectRatio ?? ''}:${allowAuto}`;
        if (prevPropKeyRef.current !== nextKey) {
            prevPropKeyRef.current = nextKey;
            setLocalData(resolveFromProps());
        }
    }, [props.width, props.height, props.aspectRatio, allowAuto, minDim, maxDim]);

    const commitData = (next: DimensionPickerData) => {
        setLocalData(next);
        props.onChange?.({ ...next });
    };

    const isAutoMode = allowAuto && localData.aspectRatio === 'auto';

    const selectOptions: SelectOption[] = [
        ...(allowAuto ? [{ value: 'auto', label: '自动 (由模型决定)' }] : []),
        ...aspectRatios.map((p) => ({
            value: p.id,
            label: `${p.label} (${p.width} × ${p.height})`,
        })),
        { value: 'custom', label: '自定义尺寸' },
    ];

    const badgeText = formatDimensionBadgeText(
        localData.width,
        localData.height,
        localData.aspectRatio
    );

    const fields = (
        <>
            <FormFieldView
                label="画幅比例"
                tooltip={
                    allowAuto
                        ? '支持选用「自动 (由模型决定)」交由模型自定构图，或快速切换常用画幅比例与推荐分辨率（涵盖 1:1 正方形、3:4 / 9:16 竖屏人像与 16:9 宽屏风光等）。'
                        : '快速切换常用画幅比例与推荐分辨率（涵盖 1:1 正方形、3:4 / 9:16 竖屏人像与 16:9 宽屏风光等）。'
                }
            >
                <SelectControl
                    value={localData.aspectRatio ?? '1:1'}
                    options={selectOptions}
                    onChange={(val) => {
                        if (val === 'auto' && allowAuto) {
                            commitData({
                                width: localData.width,
                                height: localData.height,
                                aspectRatio: 'auto',
                            });
                        } else if (val !== 'custom') {
                            const preset = aspectRatios.find((p) => p.id === val);
                            if (preset) {
                                const w = clampDimensionValue(preset.width, minDim, maxDim);
                                const h = clampDimensionValue(preset.height, minDim, maxDim);
                                commitData({
                                    width: w,
                                    height: h,
                                    aspectRatio: detectDimensionRatio(w, h, aspectRatios),
                                });
                            }
                        } else {
                            commitData({
                                width: localData.width,
                                height: localData.height,
                                aspectRatio: 'custom',
                            });
                        }
                    }}
                />
            </FormFieldView>

            {!isAutoMode && (
                <FormFieldView
                    label="画幅尺寸"
                    tooltip="设置出图宽高像素分辨率，支持自由输入任意合法尺寸（范围 64~4096）。"
                >
                    <div className="da-dimension-picker__size-group">
                        <NumberInputControl
                            value={localData.width}
                            min={minDim}
                            max={maxDim}
                            step={1}
                            unit="px"
                            onChange={(val) => {
                                const w = clampDimensionValue(val, minDim, maxDim);
                                if (w !== localData.width) {
                                    commitData({
                                        width: w,
                                        height: localData.height,
                                        aspectRatio: detectDimensionRatio(
                                            w,
                                            localData.height,
                                            aspectRatios
                                        ),
                                    });
                                }
                            }}
                        />
                        <span className="da-dimension-picker__size-separator">×</span>
                        <NumberInputControl
                            value={localData.height}
                            min={minDim}
                            max={maxDim}
                            step={1}
                            unit="px"
                            onChange={(val) => {
                                const h = clampDimensionValue(val, minDim, maxDim);
                                if (h !== localData.height) {
                                    commitData({
                                        width: localData.width,
                                        height: h,
                                        aspectRatio: detectDimensionRatio(
                                            localData.width,
                                            h,
                                            aspectRatios
                                        ),
                                    });
                                }
                            }}
                        />
                    </div>
                </FormFieldView>
            )}
        </>
    );

    if (props.embedded) {
        const cls = [
            'da-dimension-picker',
            'da-dimension-picker--embedded',
            props.dirty ? 'is-dirty' : '',
            props.className || '',
        ]
            .filter(Boolean)
            .join(' ');
        return <div className={cls}>{fields}</div>;
    }

    return (
        <CardView
            title={props.title ?? '画幅比例与尺寸'}
            subtitle={props.subtitle}
            dirty={props.dirty}
            className={props.className}
            badges={<BadgeView text={badgeText} variant="neutral" />}
        >
            {fields}
        </CardView>
    );
}
