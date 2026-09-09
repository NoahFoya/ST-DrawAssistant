/**
 * LoRA 模型选择与权重配置控件 (LoraManagerControl)
 * 采用分层结构展示模型条目，支持启停开关、模型名称检索与删除操作。
 * 数值输入适配 ComfyUI (Model/CLIP/Trigger) 与 SD-WebUI (主权重) 两种后端参数形态，
 * 并结合后端模型缓存提供缺失警示。
 */

import { createToggle } from './input-controls';
import { LoraItem } from '../../types';

export type { LoraItem };

/**
 * LoRA 列表管理器 DOM 句柄，提供列表读取与全量更新接口
 */
export interface LoraManagerElement extends HTMLElement {
    getLoras: () => LoraItem[];
    setLoras: (loras: LoraItem[]) => void;
    update?: (loras: LoraItem[], cachedLoras?: string[], showExtraWeights?: boolean) => void;
    setShowExtraWeights?: (show: boolean) => void;
}

/**
 * LoRA 列表管理器配置参数
 */
export interface LoraManagerOptions {
    /** 标题名称 (可选，默认为空，由外层卡片提供标题，内部仅展示启用数量统计) */
    title?: string;
    loras: LoraItem[];
    cachedLoras: string[];
    /** 是否显示额外权重输入项 (CLIP, Trigger) */
    showExtraWeights?: boolean;
    onChange: (loras: LoraItem[]) => void;
}

/**
 * 创建 LoRA 列表管理控件
 *
 * @param options LoRA 初始列表、缓存模型与变更监听
 * @returns 包含状态读写句柄的 DOM 节点 (.da-lora-manager)
 */
export function createLoraManagerControl(options: LoraManagerOptions): LoraManagerElement {
    const container = document.createElement('div') as unknown as LoraManagerElement;
    container.className = 'da-lora-manager';

    let currentLoras: LoraItem[] = [...(options.loras || [])];
    let cachedList = [...(options.cachedLoras || [])];
    let isExtraWeights = Boolean(options.showExtraWeights);

    const render = () => {
        container.innerHTML = '';

        // 容器顶部统计头：已启用数量与总项数位于左侧
        const headerEl = document.createElement('div');
        headerEl.className = 'da-lora-container__header';
        headerEl.style.display = 'flex';
        headerEl.style.alignItems = 'center';
        headerEl.style.justifyContent = 'flex-start';
        headerEl.style.gap = '8px';

        if (options.title) {
            const headerTitle = document.createElement('div');
            headerTitle.className = 'da-lora-container__title';
            headerTitle.textContent = options.title;
            headerEl.appendChild(headerTitle);
        }

        const headerBadge = document.createElement('span');
        headerBadge.className = 'da-badge da-lora-container__badge da-lora-count-badge';
        const enabledCount = currentLoras.filter((l) => l.enabled !== false).length;
        headerBadge.textContent = `已启用: ${enabledCount} / 总数: ${currentLoras.length}`;
        headerEl.appendChild(headerBadge);

        container.appendChild(headerEl);

        // LoRA 列表容器
        const listWrapper = document.createElement('div');
        listWrapper.className = 'da-lora-list-set';

        if (currentLoras.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'da-lora-empty';
            emptyEl.innerHTML = `
                <div class="da-lora-empty__text">暂未添加任何 LoRA 模型，请从下方选择已同步模型添加</div>
            `;
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

                // 模型名称与删除操作行
                const headerRow = document.createElement('div');
                headerRow.className = 'da-lora-item__header';

                const titleBox = document.createElement('div');
                titleBox.className = 'da-lora-item__title-box';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'da-lora-item__name';
                nameSpan.textContent = lora.name;
                nameSpan.title = lora.name;
                titleBox.appendChild(nameSpan);

                if (isMissing) {
                    const warnBadge = document.createElement('span');
                    warnBadge.className = 'da-badge da-lora-badge da-lora-badge--missing';
                    warnBadge.title = '未在生图后端列表中找到此 LoRA 模型，生成时可能失效';
                    warnBadge.textContent = '⚠️ 后端未找到';
                    titleBox.appendChild(warnBadge);
                }

                headerRow.appendChild(titleBox);

                // 右侧删除按钮 (SVG 垃圾桶图标)
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'da-btn da-btn--danger da-lora-item__del';
                delBtn.title = '移除此 LoRA';
                delBtn.setAttribute('aria-label', '移除此 LoRA');
                delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                delBtn.onclick = () => {
                    currentLoras.splice(idx, 1);
                    render();
                    options.onChange(currentLoras);
                };

                headerRow.appendChild(delBtn);
                item.appendChild(headerRow);

                // 权重数值与启停开关行
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
                    input.className = 'da-input da-input-num-short da-lora-param__input';
                    input.value = String(initialVal);
                    input.disabled = !isEnabled;
                    inputElements.push(input);

                    input.onchange = () => {
                        const parsed = parseFloat(input.value);
                        const clamped = Number.isNaN(parsed) ? 1.0 : Math.max(-2, Math.min(2, parsed));
                        input.value = String(clamped);
                        onChangeVal(clamped);
                    };

                    field.appendChild(lbl);
                    field.appendChild(input);
                    return field;
                };

                if (isExtraWeights) {
                    // ComfyUI 多维权重
                    const modelField = createParamField(
                        '模型',
                        lora.weight ?? 1.0,
                        'UNet 模型权重 (默认 1.0)',
                        (val) => {
                            lora.weight = val;
                            options.onChange(currentLoras);
                        }
                    );
                    paramsWrapper.appendChild(modelField);

                    const clipField = createParamField(
                        'CLIP',
                        lora.clipWeight ?? lora.textWeight ?? 1.0,
                        'CLIP 文本编码器权重 (默认 1.0)',
                        (val) => {
                            lora.clipWeight = val;
                            lora.textWeight = val;
                            options.onChange(currentLoras);
                        }
                    );
                    paramsWrapper.appendChild(clipField);

                    const triggerField = createParamField(
                        '触发',
                        lora.triggerWeight ?? 1.0,
                        'LoRA 触发词注入权重 (默认 1.0)',
                        (val) => {
                            lora.triggerWeight = val;
                            options.onChange(currentLoras);
                        }
                    );
                    paramsWrapper.appendChild(triggerField);
                } else {
                    // 原生/单主权重
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

                // 右侧启停 Switch 开关
                const toggleWrapper = document.createElement('div');
                toggleWrapper.className = 'da-lora-item__toggle-box';

                const toggleHandle = createToggle({
                    value: isEnabled,
                    onChange: (checked) => {
                        lora.enabled = checked;
                        item.classList.toggle('is-disabled', !checked);
                        toggleHandle.title = checked ? '已启用（点击禁用）' : '已禁用（点击启用）';
                        inputElements.forEach((input) => {
                            input.disabled = !checked;
                        });
                        const currentEnabledCount = currentLoras.filter((l) => l.enabled !== false).length;
                        headerBadge.textContent = `已启用: ${currentEnabledCount} / 总数: ${currentLoras.length}`;
                        options.onChange(currentLoras);
                    }
                });
                toggleHandle.title = isEnabled ? '已启用（点击禁用）' : '已禁用（点击启用）';
                toggleWrapper.appendChild(toggleHandle);

                bodyRow.appendChild(paramsWrapper);
                bodyRow.appendChild(toggleWrapper);

                item.appendChild(bodyRow);
                listWrapper.appendChild(item);
            });
        }

        container.appendChild(listWrapper);

        // 底部追加栏：从已同步缓存模型中点选添加
        const footerEl = document.createElement('div');
        footerEl.className = 'da-lora-container__footer da-lora-add-row';

        const select = document.createElement('select');
        select.className = 'da-select da-lora-add-select';

        const availableOptions = cachedList.filter(
            (name) => !currentLoras.some((l) => l.name === name)
        );

        if (availableOptions.length === 0) {
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = cachedList.length === 0 ? '(未在生图后端找到可用 LoRA)' : '(所有可用 LoRA 均已添加)';
            select.appendChild(emptyOpt);
            select.disabled = true;
        } else {
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = '选择要追加的 LoRA 模型...';
            select.appendChild(defaultOpt);

            availableOptions.forEach((name) => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            });
        }

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'da-btn da-btn--secondary da-lora-add-btn';
        addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> 追加 LoRA`;
        addBtn.disabled = !select.value;

        select.onchange = () => {
            addBtn.disabled = !select.value;
        };

        addBtn.onclick = () => {
            const val = select.value.trim();
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
    container.update = (loras: LoraItem[], newCached?: string[], newExtraWeights?: boolean) => {
        currentLoras = [...loras];
        if (newCached) cachedList = [...newCached];
        if (newExtraWeights !== undefined) isExtraWeights = newExtraWeights;
        render();
    };
    container.setShowExtraWeights = (show: boolean) => {
        isExtraWeights = show;
        render();
    };

    return container;
}
