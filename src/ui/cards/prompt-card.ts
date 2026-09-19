/**
 * ST-DrawAssistant 提示词与 LoRA 模型管理配置卡片。
 *
 * @remarks
 * 管理正向通用前后缀、默认全局负向提示词以及动态 LoRA 模型条目列表。
 * 数据统一保存至 settingsStore 中的 prompts 预设。
 */

import { CardBase } from './card-base';
import {
    createFormField,
    createTextInput,
    createTextarea,
    createButton,
} from '../components';
import { settingsStore } from '../../store/settings-store';
import type { PresetItem, PromptPresetData } from '@types';

export class PromptCard extends CardBase {
    private currentPreset: PresetItem<PromptPresetData>;
    private loraContainer: HTMLDivElement | null = null;

    constructor() {
        super({
            title: '提示词与 LoRA 预设',
            badge: '提示词流',
        });

        // 获取第一个提示词预设或默认方案
        const promptPresets = settingsStore.getPresets<PromptPresetData>('prompts');
        if (promptPresets.length > 0) {
            this.currentPreset = promptPresets[0];
        } else {
            this.currentPreset = {
                id: 'default_prompt',
                name: '默认提示词方案',
                data: {
                    prefix: 'masterpiece, best quality',
                    suffix: '',
                    defaultNegative: 'low quality, worst quality, deformed, bad anatomy',
                    loras: [],
                },
            };
        }

        this.buildFields();
    }

    private saveCurrentPreset(): void {
        settingsStore.savePreset('prompts', this.currentPreset);
    }

    private buildFields(): void {
        const data = this.currentPreset.data;

        // 1. 正向提示词通用前缀
        const prefixInput = this.registerChild(
            createTextInput({
                value: data.prefix ?? '',
                placeholder: '如: masterpiece, high quality, 1girl',
                onChange: (val) => {
                    this.currentPreset.data.prefix = val;
                    this.saveCurrentPreset();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '正向提示词前缀',
                description: '自动置于动态提取出的提示词最前端',
                control: prefixInput,
                slotWidth: '240',
            }).element
        );

        // 2. 正向提示词通用后缀
        const suffixInput = this.registerChild(
            createTextInput({
                value: data.suffix ?? '',
                placeholder: '如: highly detailed, cinematic lighting',
                onChange: (val) => {
                    this.currentPreset.data.suffix = val;
                    this.saveCurrentPreset();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '正向提示词后缀',
                description: '自动追加在正向提示词末尾',
                control: suffixInput,
                slotWidth: '240',
            }).element
        );

        // 3. 默认全局负向提示词
        const negTextarea = this.registerChild(
            createTextarea({
                value: data.defaultNegative ?? '',
                placeholder: '输入负向提示词 (Negative Prompt)...',
                rows: 3,
                onChange: (val) => {
                    this.currentPreset.data.defaultNegative = val;
                    this.saveCurrentPreset();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '默认负向提示词',
                description: '过滤常见形变、低画质及不良特征的负向标记',
                layout: 'stacked',
                control: negTextarea,
                slotWidth: 'full',
            }).element
        );

        // 4. LoRA 列表容器
        this.renderLoraSection();
    }

    private renderLoraSection(): void {
        if (!this.loraContainer) {
            this.loraContainer = document.createElement('div');
            this.loraContainer.classList.add('da-lora-container');
            this.bodyElement.appendChild(this.loraContainer);
        }

        this.loraContainer.innerHTML = '';

        const headerRow = document.createElement('div');
        headerRow.classList.add('da-lora-container__header');

        const titleSpan = document.createElement('span');
        titleSpan.classList.add('da-lora-container__title');
        titleSpan.textContent = '已挂载 LoRA 模型列表';

        const loras = this.currentPreset.data.loras || [];
        const badge = document.createElement('span');
        badge.classList.add('da-lora-container__badge');
        badge.textContent = `${loras.length} 个`;

        headerRow.appendChild(titleSpan);
        headerRow.appendChild(badge);
        this.loraContainer.appendChild(headerRow);

        const listSet = document.createElement('div');
        listSet.classList.add('da-lora-list-set');

        if (loras.length === 0) {
            const emptyTip = document.createElement('div');
            emptyTip.classList.add('da-lora-empty');
            const emptyText = document.createElement('span');
            emptyText.classList.add('da-lora-empty__text');
            emptyText.textContent = '暂无挂载的 LoRA 模型，可通过下方添加';
            emptyTip.appendChild(emptyText);
            listSet.appendChild(emptyTip);
        } else {
            loras.forEach((item, index) => {
                const itemRow = document.createElement('div');
                itemRow.classList.add('da-row', 'da-row--divided');

                const nameInput = this.registerChild(
                    createTextInput({
                        value: item.name,
                        placeholder: 'LoRA 模型名',
                        variant: 'short',
                        onChange: (val) => {
                            item.name = val;
                            this.saveCurrentPreset();
                        },
                    })
                );

                const weightInput = this.registerChild(
                    createTextInput({
                        type: 'number',
                        value: item.weight,
                        variant: 'num-short',
                        step: 0.05,
                        min: -2,
                        max: 2,
                        onChange: (val) => {
                            const num = parseFloat(val);
                            item.weight = Number.isNaN(num) ? 1.0 : num;
                            this.saveCurrentPreset();
                        },
                    })
                );

                const delBtn = this.registerChild(
                    createButton({
                        text: '删除',
                        variant: 'danger',
                        size: 'sm',
                        onClick: () => {
                            loras.splice(index, 1);
                            this.currentPreset.data.loras = loras;
                            this.saveCurrentPreset();
                            this.renderLoraSection();
                        },
                    })
                );

                itemRow.appendChild(nameInput.element);
                itemRow.appendChild(weightInput.element);
                itemRow.appendChild(delBtn.element);
                listSet.appendChild(itemRow);
            });
        }

        // 添加新 LoRA 操作区
        const addRow = document.createElement('div');
        addRow.classList.add('da-row', 'da-row--divided');

        const newNameInput = this.registerChild(
            createTextInput({
                placeholder: '新 LoRA 文件名',
                variant: 'short',
            })
        );

        const addBtn = this.registerChild(
            createButton({
                text: '+ 添加 LoRA',
                variant: 'primary',
                size: 'sm',
                onClick: () => {
                    const name = newNameInput.getValue().trim();
                    if (!name) return;

                    const list = this.currentPreset.data.loras || [];
                    list.push({ name, weight: 1.0 });
                    this.currentPreset.data.loras = list;
                    this.saveCurrentPreset();
                    this.renderLoraSection();
                },
            })
        );

        addRow.appendChild(newNameInput.element);
        addRow.appendChild(addBtn.element);
        listSet.appendChild(addRow);

        this.loraContainer.appendChild(listSet);
    }
}
