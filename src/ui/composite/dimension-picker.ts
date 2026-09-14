/**
 * 画幅比例与分辨率预设微调组件 (DimensionPicker) - 方案 B 紧凑预设驱动体系
 * 组合比例预设 Select、64px 潜空间上下箭头微调输入框与 [ ⇄ ] 翻转按钮。
 * 提供主流画幅一键切换、自定义宽高 64 像素对齐约束与一键横竖翻转。
 */

import type { DimensionValue, IControlHandle, SelectOptionItem } from '@types';
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
    { id: '2:3', label: '2:3 胶片人像 (832×1216)', width: 832, height: 1216 },
    { id: '3:2', label: '3:2 风景胶片 (1216×832)', width: 1216, height: 832 },
    { id: '3:4', label: '3:4 人像插画 (768×1024)', width: 768, height: 1024 },
    { id: '4:3', label: '4:3 经典画幅 (1024×768)', width: 1024, height: 768 },
    { id: '9:16', label: '9:16 手机壁纸 (720×1280)', width: 720, height: 1280 },
    { id: '16:9', label: '16:9 电脑宽屏 (1280×720)', width: 1280, height: 720 },
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

export interface DimensionPickerHandle extends IControlHandle<DimensionValue> {
    readonly selectHandle: SelectHandle;
    readonly widthInputHandle: NumberInputHandle;
    readonly heightInputHandle: NumberInputHandle;
    readonly swapButtonHandle: IconButtonHandle;
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

    // 匹配最接近的已知预设
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
        ariaLabel: '画幅比例与分辨率预设',
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

    // 2. 宽度与高度微调输入行 (包含中间横竖翻转按钮)
    const inputsRow = document.createElement('div');
    inputsRow.className = 'da-dimension-picker__inputs-row';

    // 宽度微调端
    const widthSide = document.createElement('div');
    widthSide.className = 'da-dimension-picker__side';
    const widthLabel = document.createElement('span');
    widthLabel.className = 'da-dimension-picker__side-label';
    widthLabel.textContent = '宽度:';

    const widthInput: NumberInputHandle = createNumberInput({
        value: currentWidth,
        min,
        max,
        step,
        unit: 'px',
        variant: 'short',
        ariaLabel: '画幅宽度',
        onChange: (w) => {
            currentWidth = w;
            syncPresetFromInputs();
            triggerChange();
        }
    });

    widthSide.appendChild(widthLabel);
    widthSide.appendChild(widthInput.element);

    // 翻转按钮 (Swap width & height)
    const swapBtn: IconButtonHandle = createIconButton({
        icon: 'swap',
        title: '翻转横竖画幅 (交换宽与高)',
        className: 'da-dimension-picker__swap-btn',
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

    // 高度微调端
    const heightSide = document.createElement('div');
    heightSide.className = 'da-dimension-picker__side';
    const heightLabel = document.createElement('span');
    heightLabel.className = 'da-dimension-picker__side-label';
    heightLabel.textContent = '高度:';

    const heightInput: NumberInputHandle = createNumberInput({
        value: currentHeight,
        min,
        max,
        step,
        unit: 'px',
        variant: 'short',
        ariaLabel: '画幅高度',
        onChange: (h) => {
            currentHeight = h;
            syncPresetFromInputs();
            triggerChange();
        }
    });

    heightSide.appendChild(heightLabel);
    heightSide.appendChild(heightInput.element);

    inputsRow.appendChild(widthSide);
    inputsRow.appendChild(swapBtn.element);
    inputsRow.appendChild(heightSide);
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
        selectHandle: selectComp,
        widthInputHandle: widthInput,
        heightInputHandle: heightInput,
        swapButtonHandle: swapBtn,
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
        setDirty(isDirty: boolean): void {
            selectComp.setDirty?.(isDirty);
            widthInput.setDirty?.(isDirty);
            heightInput.setDirty?.(isDirty);
        },
        setError(hasError: boolean, message?: string): void {
            selectComp.setError?.(hasError, message);
            widthInput.setError?.(hasError, message);
            heightInput.setError?.(hasError, message);
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
