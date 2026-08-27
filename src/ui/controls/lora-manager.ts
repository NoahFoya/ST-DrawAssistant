/**
 * @module ui/controls/lora-manager
 * @description LoRA 模型选择与权重配置控件 (LoraManagerControl)
 *
 * 设计意图：
 * 1. 采用分层卡片结构 (Header: 模型名称与启停/删除操作 / Body: 权重参数标准数值输入行)；
 * 2. 对齐全局标准数值输入控件 (.da-input .da-input-num-small)，支持 ComfyUI (Model/CLIP/Trigger) 与 SD-WebUI (主权重) 模式；
 * 3. 具备单项 Switch 启停开关、后端缓存比对、缺失警示与排他式动态追加。
 */

import { LoraItem } from '../../core';
import { createToggle } from './input-controls';

export type { LoraItem };

/**
 * LoRA 列表管理器 DOM 句柄，提供列表读取与全量更新接口
 */
export interface LoraManagerElement extends HTMLElement {
    getLoras: () => LoraItem[];
    setLoras: (loras: LoraItem[]) => void;
    update?: (loras: LoraItem[], cachedLoras?: string[]) => void;
}

/**
 * LoRA 列表管理器配置参数
 */
export interface LoraManagerOptions {
    loras: LoraItem[];
    cachedLoras: string[];
    /** 是否启用 ComfyUI WeiLin 多维权重模式 (Model, CLIP, Trigger) */
    showExtraWeights?: boolean;
    onChange: (loras: LoraItem[]) => void;
}

/**
 * 创建分层卡片式 LoRA 动态管理控件
 *
 * @param options LoRA 初始列表、缓存模型与变更监听
 * @returns 包含状态读写句柄的 DOM 节点 (.da-lora-manager)
 */
export function createLoraManagerControl(options: LoraManagerOptions): LoraManagerElement {
    const container = document.createElement('div') as unknown as LoraManagerElement;
    container.className = 'da-lora-manager';

    let currentLoras: LoraItem[] = [...(options.loras || [])];
    let cachedList = [...(options.cachedLoras || [])];
    const showExtraWeights = Boolean(options.showExtraWeights);

    const render = () => {
        container.innerHTML = '';

        // ── 1. 容器顶部统计头 ──────────────────────────────────────────
        const headerEl = document.createElement('div');
        headerEl.className = 'da-lora-container__header';

        const headerTitle = document.createElement('div');
        headerTitle.className = 'da-lora-container__title';
        headerTitle.innerHTML = '<i class="fa-solid fa-layer-group"></i> 已加载 LoRA 列表';

        const headerBadge = document.createElement('span');
        headerBadge.className = 'da-lora-container__badge';
        const enabledCount = currentLoras.filter((l) => l.enabled !== false).length;
        headerBadge.textContent = `${enabledCount} / ${currentLoras.length} 项已启用`;

        headerEl.appendChild(headerTitle);
        headerEl.appendChild(headerBadge);
        container.appendChild(headerEl);

        // ── 2. 列表集底座容器 ──────────────────────────────────────────
        const listWrapper = document.createElement('div');
        listWrapper.className = 'da-lora-list-set';

        if (currentLoras.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-lora-empty';
            emptyEl.innerHTML = `
                <div class="da-lora-empty__icon"><i class="fa-solid fa-bolt"></i></div>
                <div class="da-lora-empty__text">暂未添加任何 LoRA 模型，请从下方选择追加</div>
            `;
            const quickAddBtn = document.createElement('button');
            quickAddBtn.type = 'button';
            quickAddBtn.className = 'da-btn da-btn--ghost da-btn--sm';
            quickAddBtn.textContent = '+ 选择并添加第一个 LoRA';
            quickAddBtn.style.marginTop = '8px';
            quickAddBtn.addEventListener('click', () => {
                const addSelect = container.querySelector<HTMLSelectElement>('.da-lora-add-select');
                if (addSelect) {
                    addSelect.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    addSelect.focus();
                }
            });
            emptyEl.appendChild(quickAddBtn);
            listWrapper.appendChild(emptyEl);
        } else {
            currentLoras.forEach((lora, idx) => {
                const item = document.createElement('div');
                const isEnabled = lora.enabled !== false;
                item.className = `da-lora-item ${!isEnabled ? 'is-disabled' : ''}`;

                // 检测模型是否在当前后端缓存列表中，缺失时呈现警示标识
                const isMissing = Boolean(
                    lora.name && cachedList.length > 0 && !cachedList.includes(lora.name)
                );
                if (isMissing) {
                    item.classList.add('da-lora-item--missing');
                }

                // ── 1. 卡片顶行：模型全名与启停/删除操作 ─────────────────────────
                const headerRow = document.createElement('div');
                headerRow.className = 'da-lora-item__header';

                // 左侧模型名称信息
                const titleBox = document.createElement('div');
                titleBox.className = 'da-lora-item__title-box';

                const icon = document.createElement('span');
                icon.className = 'da-lora-item__icon';
                icon.innerHTML = '<i class="fa-solid fa-bolt"></i>';
                titleBox.appendChild(icon);

                const nameSpan = document.createElement('span');
                nameSpan.className = 'da-lora-item__name';
                nameSpan.textContent = lora.name;
                nameSpan.title = lora.name;
                titleBox.appendChild(nameSpan);

                if (isMissing) {
                    const warnBadge = document.createElement('span');
                    warnBadge.className = 'da-lora-badge da-lora-badge--missing';
                    warnBadge.title = '未在生图后端找到此 LoRA 模型，生图时可能失效';
                    warnBadge.textContent = '⚠️ 未找到';
                    titleBox.appendChild(warnBadge);
                }

                headerRow.appendChild(titleBox);

                // 右侧删除按钮
                const delBtn = document.createElement('button');
                delBtn.className = 'da-btn danger da-lora-item__del';
                delBtn.title = '从当前列表中移除此 LoRA';
                delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
                delBtn.onclick = () => {
                    currentLoras.splice(idx, 1);
                    render();
                    options.onChange(currentLoras);
                };

                headerRow.appendChild(delBtn);
                item.appendChild(headerRow);

                // ── 2. 卡片底行：权重数值输入字段群 (左) ＋ 启停开关 (右) ───────
                const bodyRow = document.createElement('div');
                bodyRow.className = 'da-lora-item__body';

                const paramsWrapper = document.createElement('div');
                paramsWrapper.className = 'da-lora-item__params';

                const inputElements: HTMLInputElement[] = [];

                const createParamField = (
                    label: string,
                    initialVal: number,
                    tip: string,
                    onChangeVal: (val: number) => void
                ): HTMLElement => {
                    const field = document.createElement('div');
                    field.className = 'da-lora-param';

                    const lbl = document.createElement('span');
                    lbl.className = 'da-lora-param__label';
                    lbl.textContent = label;
                    lbl.title = tip;

                    const input = document.createElement('input');
                    input.type = 'number';
                    input.step = '0.05';
                    input.min = '-2';
                    input.max = '2';
                    input.className = 'da-input da-input-num-small da-lora-param__input';
                    input.value = String(initialVal);
                    input.disabled = !isEnabled;
                    inputElements.push(input);

                    input.onchange = () => {
                        const parsed = parseFloat(input.value);
                        const clamped = Number.isNaN(parsed) ? 1.0 : parsed;
                        input.value = String(clamped);
                        onChangeVal(clamped);
                    };

                    field.appendChild(lbl);
                    field.appendChild(input);
                    return field;
                };

                if (showExtraWeights) {
                    // ComfyUI WeiLin 多维权重输入
                    // (1) Model 权重输入
                    const modelField = createParamField(
                        '模型 (Model)',
                        lora.weight ?? 1.0,
                        'UNet 模型权重 (默认 1.0)',
                        (val) => {
                            lora.weight = val;
                            options.onChange(currentLoras);
                        }
                    );
                    paramsWrapper.appendChild(modelField);

                    // (2) CLIP 权重输入
                    const clipField = createParamField(
                        '文本 (CLIP)',
                        lora.clipWeight ?? lora.textWeight ?? 1.0,
                        'CLIP 文本编码器权重 (默认 1.0)',
                        (val) => {
                            lora.clipWeight = val;
                            lora.textWeight = val;
                            options.onChange(currentLoras);
                        }
                    );
                    paramsWrapper.appendChild(clipField);

                    // (3) Trigger 触发词注入权重输入
                    const triggerField = createParamField(
                        '触发 (Trigger)',
                        lora.triggerWeight ?? 1.0,
                        'LoRA 触发词注入权重 (默认 1.0)',
                        (val) => {
                            lora.triggerWeight = val;
                            options.onChange(currentLoras);
                        }
                    );
                    paramsWrapper.appendChild(triggerField);
                } else {
                    // SD-WebUI 单主权重输入
                    const singleField = createParamField(
                        '权重',
                        lora.weight ?? 1.0,
                        'LoRA 主权重 (默认 1.0)',
                        (val) => {
                            lora.weight = val;
                            options.onChange(currentLoras);
                        }
                    );
                    paramsWrapper.appendChild(singleField);
                }

                // 右侧启停 Switch 结构 (标准 createToggle 句柄)
                const toggleWrapper = document.createElement('div');
                toggleWrapper.className = 'da-lora-item__toggle-box';

                const toggleHandle = createToggle({
                    value: isEnabled,
                    onChange: (checked) => {
                        lora.enabled = checked;
                        item.classList.toggle('is-disabled', !checked);
                        toggleHandle.title = checked ? '已启用（点击临时禁用）' : '已禁用（点击重新启用）';
                        inputElements.forEach((input) => {
                            input.disabled = !checked;
                        });
                        options.onChange(currentLoras);
                    }
                });
                toggleHandle.title = isEnabled ? '已启用（点击临时禁用）' : '已禁用（点击重新启用）';
                toggleWrapper.appendChild(toggleHandle);

                bodyRow.appendChild(paramsWrapper);
                bodyRow.appendChild(toggleWrapper);

                item.appendChild(bodyRow);
                listWrapper.appendChild(item);
            });
        }

        container.appendChild(listWrapper);

        // ── 3. 底部追加栏 ────────────────────────────────────────────────
        const footerEl = document.createElement('div');
        footerEl.className = 'da-lora-container__footer';

        const select = document.createElement('select');
        select.className = 'da-select da-lora-add-select';

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '选择要追加的 LoRA 模型...';
        select.appendChild(defaultOpt);

        const availableOptions = cachedList.filter(
            (name) => !currentLoras.some((l) => l.name === name)
        );

        availableOptions.forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'da-btn da-btn--secondary da-lora-add-btn';
        addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 追加 LoRA';
        addBtn.onclick = () => {
            const val = select.value;
            if (val && !currentLoras.some((l) => l.name === val)) {
                currentLoras.push({
                    name: val,
                    weight: 1.0,
                    clipWeight: 1.0,
                    textWeight: 1.0,
                    triggerWeight: 1.0,
                    enabled: true
                });
                render();
                options.onChange(currentLoras);
            }
        };

        footerEl.appendChild(select);
        footerEl.appendChild(addBtn);
        container.appendChild(footerEl);
    };

    render();

    container.getLoras = () => currentLoras;
    container.setLoras = (loras: LoraItem[]) => {
        currentLoras = [...loras];
        render();
    };
    container.update = (loras: LoraItem[], newCached?: string[]) => {
        currentLoras = [...loras];
        if (newCached) cachedList = [...newCached];
        render();
    };

    return container;
}
