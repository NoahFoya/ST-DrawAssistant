/**
 * 画幅比例与分辨率预设微调组件 (DimensionPicker)
 * 组合通用 Select、等宽数字输入框与翻转按钮。
 * 提供主流画幅一键切换、自定义宽高 64 像素对齐约束与一键横竖翻转。
 */

import type { DimensionValue, SelectOptionItem } from '@types';
import { createSelect, SelectHandle } from '../components/select';
import { createNumberInput, NumberInputHandle } from '../components/input';
import { createIconButton, IconButtonHandle } from '../components/button';

export interface DimensionPresetItem {
    id: string;
    label: string;
    width: number;
    height: number;
}

export const DEFAULT_DIMENSION_PRESETS: DimensionPresetItem[] = [
    { id: '1:1', label: '1:1 正方形 (1024×1024)', width: 1024, height: 1024 },
    { id: '9:16', label: '9:16 手机壁纸 (720×1280)', width: 720, height: 1280 },
    { id: '16:9', label: '16:9 电脑宽屏 (1280×720)', width: 1280, height: 720 },
    { id: '3:4', label: '3:4 人像插画 (768×1024)', width: 768, height: 1024 },
    { id: '4:3', label: '4:3 经典画幅 (1024×768)', width: 1024, height: 768 },
    { id: '2:3', label: '2:3 胶片人像 (832×1216)', width: 832, height: 1216 },
    { id: 'custom', label: '自定义画幅尺寸', width: 1024, height: 1024 }
];

export interface DimensionPickerOptions {
    value?: DimensionValue;
    presets?: DimensionPresetItem[];
    min?: number;
    max?: number;
    step?: number;
    onChange?: (val: DimensionValue) => void;
    className?: string;
}

export interface DimensionPickerHandle {
    readonly element: HTMLElement;
    getValue(): DimensionValue;
    setValue(val: DimensionValue): void;
    setDisabled(disabled: boolean): void;
    dispose(): void;
}

export function createDimensionPicker(options: DimensionPickerOptions = {}): DimensionPickerHandle {
    const root = document.createElement('div');
    root.className = 'da-dimension-picker';
    if (options.className) root.classList.add(options.className);

    const presets = options.presets || DEFAULT_DIMENSION_PRESETS;
    const min = options.min ?? 64;
    const max = options.max ?? 4096;
    const step = options.step ?? 64;

    let currentWidth = options.value?.width || 1024;
    let currentHeight = options.value?.height || 1024;

    // 匹配最接近的预设
    const findPresetId = (w: number, h: number): string => {
        const matched = presets.find((p) => p.id !== 'custom' && p.width === w && p.height === h);
        return matched ? matched.id : 'custom';
    };

    let activePresetId = findPresetId(currentWidth, currentHeight);

    // 1. 顶部画幅预设下拉框
    const presetRow = document.createElement('div');
    presetRow.className = 'da-dimension-picker__preset-row';

    const selectOptions: SelectOptionItem[] = presets.map((p) => ({
        label: p.label,
        value: p.id
    }));

    let selectComp: SelectHandle;
    selectComp = createSelect({
        options: selectOptions,
        value: activePresetId,
        onChange: (presetId) => {
            activePresetId = presetId;
            const target = presets.find((p) => p.id === presetId);
            if (target && target.id !== 'custom') {
                currentWidth = target.width;
                currentHeight = target.height;
                widthInput.setValue(currentWidth);
                heightInput.setValue(currentHeight);
                triggerChange();
            }
        }
    });

    presetRow.appendChild(selectComp.element);
    root.appendChild(presetRow);

    // 2. 宽度与高度微调输入行（含中间横竖翻转按钮）
    const inputsRow = document.createElement('div');
    inputsRow.className = 'da-dimension-picker__inputs-row';

    // 宽度微调框
    const widthInput: NumberInputHandle = createNumberInput({
        value: currentWidth,
        min,
        max,
        step,
        unit: 'W',
        variant: 'short',
        onChange: (w) => {
            currentWidth = w;
            syncPresetFromInputs();
            triggerChange();
        }
    });

    // 翻转按钮 (Swap width & height)
    const swapBtn: IconButtonHandle = createIconButton({
        icon: 'swap',
        title: '翻转横竖画幅 (交换宽与高)',
        onClick: () => {
            const temp = currentWidth;
            currentWidth = currentHeight;
            currentHeight = temp;
            widthInput.setValue(currentWidth);
            heightInput.setValue(currentHeight);
            syncPresetFromInputs();
            triggerChange();
        }
    });

    // 高度微调框
    const heightInput: NumberInputHandle = createNumberInput({
        value: currentHeight,
        min,
        max,
        step,
        unit: 'H',
        variant: 'short',
        onChange: (h) => {
            currentHeight = h;
            syncPresetFromInputs();
            triggerChange();
        }
    });

    inputsRow.appendChild(widthInput.element);
    inputsRow.appendChild(swapBtn.element);
    inputsRow.appendChild(heightInput.element);
    root.appendChild(inputsRow);

    const syncPresetFromInputs = () => {
        const newPresetId = findPresetId(currentWidth, currentHeight);
        if (newPresetId !== activePresetId) {
            activePresetId = newPresetId;
            selectComp.setValue(newPresetId);
        }
    };

    const triggerChange = () => {
        options.onChange?.({
            width: currentWidth,
            height: currentHeight,
            aspectRatio: activePresetId !== 'custom' ? activePresetId : undefined
        });
    };

    return {
        element: root,
        getValue(): DimensionValue {
            return {
                width: currentWidth,
                height: currentHeight,
                aspectRatio: activePresetId !== 'custom' ? activePresetId : undefined
            };
        },
        setValue(val: DimensionValue): void {
            currentWidth = val.width;
            currentHeight = val.height;
            widthInput.setValue(currentWidth);
            heightInput.setValue(currentHeight);
            syncPresetFromInputs();
        },
        setDisabled(disabled: boolean): void {
            selectComp.setDisabled(disabled);
            widthInput.setDisabled(disabled);
            heightInput.setDisabled(disabled);
            swapBtn.setDisabled(disabled);
        },
        dispose(): void {
            selectComp.dispose?.();
            widthInput.dispose?.();
            heightInput.dispose?.();
            swapBtn.dispose();
            root.remove();
        }
    };
}
