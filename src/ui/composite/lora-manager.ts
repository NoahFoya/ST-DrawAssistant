/**
 * LoRA 模型管理复合组件 (LoraManager)
 * 支持 LoRA 列表条目增删、启用开关、模型权重与 CLIP 权重等宽数字调节，并联动 WeiLin 语法。
 */

import type { LoraItemModel } from '@types';
import { createToggle, ToggleHandle } from '../components/toggle';
import { createNumberInput, NumberInputHandle } from '../components/input';
import { createIconButton, createButton, IconButtonHandle, ButtonHandle } from '../components/button';
import { createTextInput, TextInputHandle } from '../components/input';
import { Toast } from '../components/feedback';

export interface LoraManagerOptions {
    loras: LoraItemModel[];
    availableLoras?: string[];
    onChange?: (loras: LoraItemModel[]) => void;
    className?: string;
}

export interface LoraManagerHandle {
    readonly element: HTMLElement;
    getLoras(): LoraItemModel[];
    setLoras(loras: LoraItemModel[]): void;
    dispose(): void;
}

export function createLoraManager(options: LoraManagerOptions): LoraManagerHandle {
    const container = document.createElement('div');
    container.className = 'da-lora-manager da-lora-container';
    if (options.className) container.classList.add(options.className);

    let loraItems: LoraItemModel[] = options.loras.map((l) => ({ ...l }));
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
        countBadge.textContent = String(loraItems.length);
    };

    const triggerChange = () => {
        updateCount();
        options.onChange?.(loraItems);
    };

    const handleAdd = (name: string) => {
        const newItem: LoraItemModel = {
            id: `lora_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: name.trim(),
            enabled: true,
            modelWeight: 0.8,
            clipWeight: 0.8,
            triggerWeight: 1.0
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
        // 清理子组件监听
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
            if (item.isMissing) row.classList.add('da-lora-item--missing');

            // 1. 卡片头部：图标、名称与移除按钮
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
            nameEl.title = item.name;

            titleBox.appendChild(iconSpan);
            titleBox.appendChild(nameEl);

            const actionsBox = document.createElement('div');
            actionsBox.className = 'da-lora-item__actions';

            const delBtn: IconButtonHandle = createIconButton({
                icon: 'trash',
                variant: 'danger',
                title: '移除此 LoRA',
                onClick: () => handleDelete(item.id)
            });
            childCleanups.push(() => delBtn.dispose());
            actionsBox.appendChild(delBtn.element);

            itemHeader.appendChild(titleBox);
            itemHeader.appendChild(actionsBox);
            row.appendChild(itemHeader);

            // 2. 卡片次级调节行：权重微调与开关
            const itemBody = document.createElement('div');
            itemBody.className = 'da-lora-item__body';

            const paramsBox = document.createElement('div');
            paramsBox.className = 'da-lora-item__params';

            // 模型权重
            const modelParam = document.createElement('div');
            modelParam.className = 'da-lora-param';

            const modelLabel = document.createElement('span');
            modelLabel.className = 'da-lora-param__label';
            modelLabel.textContent = '模型';

            const modelWeightInput: NumberInputHandle = createNumberInput({
                value: item.modelWeight,
                min: 0,
                max: 2.0,
                step: 0.05,
                unit: 'M',
                variant: 'small',
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
            clipLabel.textContent = 'CLIP';

            const clipWeightInput: NumberInputHandle = createNumberInput({
                value: item.clipWeight,
                min: 0,
                max: 2.0,
                step: 0.05,
                unit: 'C',
                variant: 'small',
                onChange: (val) => {
                    item.clipWeight = val;
                    triggerChange();
                }
            });
            childCleanups.push(() => clipWeightInput.dispose?.());

            clipParam.appendChild(clipLabel);
            clipParam.appendChild(clipWeightInput.element);
            paramsBox.appendChild(clipParam);

            // 单项开关
            const toggleBox = document.createElement('div');
            toggleBox.className = 'da-lora-item__toggle-box';

            const toggle: ToggleHandle = createToggle({
                checked: item.enabled,
                onChange: (checked) => {
                    item.enabled = checked;
                    row.classList.toggle('is-disabled', !checked);
                    triggerChange();
                }
            });
            childCleanups.push(() => toggle.dispose?.());
            toggleBox.appendChild(toggle.element);

            itemBody.appendChild(paramsBox);
            itemBody.appendChild(toggleBox);
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
        dispose(): void {
            childCleanups.forEach((cleanup) => cleanup());
            childCleanups.length = 0;
            addInput.dispose?.();
            addBtn.dispose();
            container.remove();
        }
    };
}
