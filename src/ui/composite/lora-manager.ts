/**
 * LoRA 模型管理复合组件 (LoraManager)
 *
 * 功能：
 * 1. 管理 LoRA 模型列表的增删、启用开关与权重调节；
 * 2. 依据后端模式 (ComfyUI 3 项 / SD-WebUI 2 项) 动态切换权重字段；
 * 3. 关联远端同步得到的可用 LoRA 资产列表，支持模型名称下拉联想与模糊匹配。
 *
 * Tips：
 * 1. LoRA 条目禁用时置灰对应输入控件，防止无效权重提交；
 * 2. 列表变更时深拷贝状态并触发 onChange 回调，更新外层脏状态。
 */

import type { LoraItemModel } from '@types';
import { createToggle, ToggleHandle } from '../components/toggle';
import { createNumberInput, NumberInputHandle } from '../components/input';
import { createIconButton, createButton, IconButtonHandle, ButtonHandle } from '../components/button';
import { createTextInput, TextInputHandle } from '../components/input';
import { Toast } from '../components/feedback';

export interface LoraManagerOptions {
    loras: LoraItemModel[];
    backendMode?: 'comfyui' | 'sdwebui';
    availableLoras?: string[];
    onChange?: (loras: LoraItemModel[]) => void;
    className?: string;
}

export interface LoraManagerHandle {
    readonly element: HTMLElement;
    getLoras(): LoraItemModel[];
    setLoras(loras: LoraItemModel[]): void;
    setBackendMode(mode: 'comfyui' | 'sdwebui'): void;
    setAvailableLoras(loras: string[]): void;
    dispose(): void;
}

export function createLoraManager(options: LoraManagerOptions): LoraManagerHandle {
    const container = document.createElement('div');
    container.className = 'da-lora-manager da-lora-container';
    if (options.className) container.classList.add(options.className);

    let currentBackendMode: 'comfyui' | 'sdwebui' = options.backendMode || 'sdwebui';
    let loraItems: LoraItemModel[] = options.loras.map((l) => ({ ...l }));
    let availableList: string[] = options.availableLoras ? [...options.availableLoras] : [];
    const childCleanups: (() => void)[] = [];

    // 1. 标题与计数栏
    const header = document.createElement('div');
    header.className = 'da-lora-container__header';

    const title = document.createElement('div');
    title.className = 'da-lora-container__title';
    title.textContent = '挂载 LoRA 模型';

    const countBadge = document.createElement('span');
    countBadge.className = 'da-lora-count-badge';

    header.appendChild(title);
    header.appendChild(countBadge);
    container.appendChild(header);

    // 2. LoRA 卡片列表容器
    const listContainer = document.createElement('div');
    listContainer.className = 'da-lora-manager__list da-lora-list-set';
    container.appendChild(listContainer);

    // 3. 底部快速添加行
    const addRow = document.createElement('div');
    addRow.className = 'da-lora-add-row';

    const addInput: TextInputHandle = createTextInput({
        placeholder: '输入 LoRA 模型名称或文件名...',
        variant: 'normal'
    });

    const addBtn: ButtonHandle = createButton({
        text: '添加 LoRA',
        variant: 'secondary',
        size: 'sm',
        onClick: () => {
            const rawName = addInput.getValue();
            const name = rawName ? rawName.trim() : '';
            if (!name) return;
            if (loraItems.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
                Toast.warn('该 LoRA 模型已在列表中');
                return;
            }
            handleAdd(name);
            addInput.setValue('');
        }
    });

    addRow.appendChild(addInput.element);
    addRow.appendChild(addBtn.element);
    container.appendChild(addRow);

    const updateCount = () => {
        const enabledCount = loraItems.filter((i) => i.enabled).length;
        const totalCount = loraItems.length;
        countBadge.textContent = totalCount > 0 ? `(${enabledCount} / ${totalCount} 已启用)` : '';
    };

    const triggerChange = () => {
        updateCount();
        options.onChange?.(loraItems);
    };

    const handleAdd = (name: string) => {
        const isKnown = availableList.length === 0 || availableList.some((a) => a.toLowerCase() === name.toLowerCase());
        const newItem: LoraItemModel = {
            id: `lora_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: name.trim(),
            enabled: true,
            modelWeight: 0.8,
            clipWeight: 0.8,
            triggerWeight: 1.0,
            isInvalid: !isKnown
        };
        loraItems.push(newItem);
        renderList();
        triggerChange();
    };

    const handleDelete = (id: string) => {
        loraItems = loraItems.filter((item) => item.id !== id);
        renderList();
        triggerChange();
    };

    const renderList = () => {
        childCleanups.forEach((cleanup) => cleanup());
        childCleanups.length = 0;
        listContainer.innerHTML = '';

        if (loraItems.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-lora-empty';
            emptyEl.innerHTML = `
                <div class="da-lora-empty__icon">✦</div>
                <div class="da-lora-empty__text">暂未挂载任何 LoRA 模型</div>
            `;
            listContainer.appendChild(emptyEl);
            updateCount();
            return;
        }

        for (const item of loraItems) {
            const row = document.createElement('div');
            row.className = 'da-lora-item';
            const isItemInvalid = Boolean(item.isInvalid);
            if (isItemInvalid) {
                row.classList.add('is-invalid');
            }
            if (!item.enabled) {
                row.classList.add('is-disabled');
            }

            // 1. 卡片首行：左侧 LoRA 名称，右侧启用开关与右上角 [ × ] 关闭按钮
            const itemHeader = document.createElement('div');
            itemHeader.className = 'da-lora-item__header';

            const titleBox = document.createElement('div');
            titleBox.className = 'da-lora-item__title-box';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'da-lora-item__icon';
            iconSpan.textContent = '✦';

            const nameEl = document.createElement('div');
            nameEl.className = 'da-lora-item__name';
            nameEl.textContent = item.name;

            if (isItemInvalid) {
                const invalidTip = `${item.name}（模型文件已失效，未在当前生图服务中发现）`;
                nameEl.title = invalidTip;
                row.title = invalidTip;
            } else {
                nameEl.title = item.name;
            }

            titleBox.appendChild(iconSpan);
            titleBox.appendChild(nameEl);

            const actionsBox = document.createElement('div');
            actionsBox.className = 'da-lora-item__actions';

            // 启用开关 (位于首行右侧)
            const toggleBox = document.createElement('div');
            toggleBox.className = 'da-lora-item__toggle-box';

            const toggle: ToggleHandle = createToggle({
                checked: item.enabled,
                ariaLabel: `启用 ${item.name}`,
                onChange: (checked) => {
                    item.enabled = checked;
                    row.classList.toggle('is-disabled', !checked);
                    triggerChange();
                }
            });
            childCleanups.push(() => toggle.dispose?.());
            toggleBox.appendChild(toggle.element);
            actionsBox.appendChild(toggleBox);

            // 右上角 [ × ] 删除按钮
            const delBtn: IconButtonHandle = createIconButton({
                icon: 'close',
                variant: 'danger',
                className: 'da-lora-item__close-btn',
                title: '删除此 LoRA',
                onClick: () => handleDelete(item.id)
            });
            childCleanups.push(() => delBtn.dispose());
            actionsBox.appendChild(delBtn.element);

            itemHeader.appendChild(titleBox);
            itemHeader.appendChild(actionsBox);
            row.appendChild(itemHeader);

            // 2. 卡片次行：参数调节行 (ComfyUI 3 项 / SD-WebUI 2 项上下箭头步进器)
            const itemBody = document.createElement('div');
            itemBody.className = 'da-lora-item__body';

            const paramsBox = document.createElement('div');
            paramsBox.className = 'da-lora-item__params';

            // 模型权重
            const modelParam = document.createElement('div');
            modelParam.className = 'da-lora-param';

            const modelLabel = document.createElement('span');
            modelLabel.className = 'da-lora-param__label';
            modelLabel.textContent = '模型:';

            const modelWeightInput: NumberInputHandle = createNumberInput({
                value: item.modelWeight ?? 0.8,
                min: -2.0,
                max: 2.0,
                step: 0.05,
                showStepper: true,
                variant: 'short',
                ariaLabel: `${item.name} 模型权重`,
                onChange: (val) => {
                    item.modelWeight = val;
                    triggerChange();
                }
            });
            childCleanups.push(() => modelWeightInput.dispose?.());

            modelParam.appendChild(modelLabel);
            modelParam.appendChild(modelWeightInput.element);
            paramsBox.appendChild(modelParam);

            // CLIP 权重
            const clipParam = document.createElement('div');
            clipParam.className = 'da-lora-param';

            const clipLabel = document.createElement('span');
            clipLabel.className = 'da-lora-param__label';
            clipLabel.textContent = 'CLIP:';

            const clipWeightInput: NumberInputHandle = createNumberInput({
                value: item.clipWeight ?? 0.8,
                min: -2.0,
                max: 2.0,
                step: 0.05,
                showStepper: true,
                variant: 'short',
                ariaLabel: `${item.name} CLIP 权重`,
                onChange: (val) => {
                    item.clipWeight = val;
                    triggerChange();
                }
            });
            childCleanups.push(() => clipWeightInput.dispose?.());

            clipParam.appendChild(clipLabel);
            clipParam.appendChild(clipWeightInput.element);
            paramsBox.appendChild(clipParam);

            // 触发词权重 (仅在 ComfyUI 驱动模式下渲染)
            if (currentBackendMode === 'comfyui') {
                const triggerParam = document.createElement('div');
                triggerParam.className = 'da-lora-param';

                const triggerLabel = document.createElement('span');
                triggerLabel.className = 'da-lora-param__label';
                triggerLabel.textContent = '触发词:';

                const triggerWeightInput: NumberInputHandle = createNumberInput({
                    value: item.triggerWeight ?? 1.0,
                    min: -2.0,
                    max: 2.0,
                    step: 0.05,
                    showStepper: true,
                    variant: 'short',
                    ariaLabel: `${item.name} 触发词权重`,
                    onChange: (val) => {
                        item.triggerWeight = val;
                        triggerChange();
                    }
                });
                childCleanups.push(() => triggerWeightInput.dispose?.());

                triggerParam.appendChild(triggerLabel);
                triggerParam.appendChild(triggerWeightInput.element);
                paramsBox.appendChild(triggerParam);
            }

            itemBody.appendChild(paramsBox);
            row.appendChild(itemBody);

            listContainer.appendChild(row);
        }

        updateCount();
    };

    renderList();

    return {
        element: container,
        getLoras(): LoraItemModel[] {
            return loraItems.map((l) => ({ ...l }));
        },
        setLoras(loras: LoraItemModel[]): void {
            loraItems = loras.map((l) => ({ ...l }));
            renderList();
        },
        setBackendMode(mode: 'comfyui' | 'sdwebui'): void {
            if (currentBackendMode !== mode) {
                currentBackendMode = mode;
                renderList();
            }
        },
        setAvailableLoras(loras: string[]): void {
            availableList = [...loras];
            for (const item of loraItems) {
                const isInvalid = !availableList.some((a) => a.toLowerCase() === item.name.toLowerCase());
                item.isInvalid = isInvalid;
            }
            renderList();
        },
        dispose(): void {
            childCleanups.forEach((cleanup) => cleanup());
            childCleanups.length = 0;
            addInput.dispose?.();
            addBtn.dispose();
            container.remove();
        }
    };
}
