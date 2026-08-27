/**
 * @module ui/layout/blueprint-modal
 * @description 工作流蓝图可视化编辑弹窗组件 (BlueprintModal)
 *
 * 核心特性：
 * 1. 深度整合 --da-* 主题 Token，完美自适应深色与浅色毛玻璃主题；
 * 2. 每个可编辑属性输入框后置变量化图标按钮 ({v})，点击呼出智能高亮推荐下拉浮层；
 * 3. 支持节点按 ID / 类名 / 标题即时搜索、分类过滤、画布平移缩放与双向数据同步。
 */

import { Logger, getMacroVariables } from '../../core';
import { ThemeService } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';

export interface WorkflowNodeData {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
}

export type WorkflowJsonObj = Record<string, WorkflowNodeData>;

const logger = new Logger('BlueprintModal');

let modalOverlayEl: HTMLElement | null = null;
let activeDropdownEl: HTMLElement | null = null;
let currentZoom = 1.0;
let selectedNodeId: string | null = null;
let currentCategoryFilter = 'ALL';
let currentSearchQuery = '';

/** HTML 转义 */
function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** 辅助函数：根据节点信息判别 Badge 分类与类型 */
function getNodeBadgeMeta(_nodeId: string, nodeData: WorkflowNodeData) {
    const classType = (nodeData.class_type || '').toLowerCase();
    const title = nodeData._meta?.title ?? nodeData.class_type;

    if (classType.includes('cliptextencode') || classType.includes('prompt')) {
        return {
            title,
            badgeText: '🔤 文本编码',
            badgeClass: 'da-blueprint-badge--prompt',
            category: 'PROMPT',
            isCore: true
        };
    }
    if (classType.includes('ksampler') || classType.includes('sampler')) {
        return {
            title,
            badgeText: '⚙️ 采样器',
            badgeClass: 'da-blueprint-badge--sampler',
            category: 'SAMPLER',
            isCore: true
        };
    }
    if (classType.includes('checkpointloader') || classType.includes('unetloader')) {
        return {
            title,
            badgeText: '📦 模型加载',
            badgeClass: 'da-blueprint-badge--model',
            category: 'SAMPLER',
            isCore: true
        };
    }
    if (
        classType.includes('emptylatentimage') ||
        classType.includes('latentupscale') ||
        classType.includes('imagesize')
    ) {
        return {
            title,
            badgeText: '📐 尺寸潜空间',
            badgeClass: 'da-blueprint-badge--size',
            category: 'SIZE',
            isCore: true
        };
    }
    if (
        classType.includes('vaedecode') ||
        classType.includes('saveimage') ||
        classType.includes('previewimage')
    ) {
        return {
            title,
            badgeText: '🖼️ 图像输出',
            badgeClass: 'da-blueprint-badge--output',
            category: 'OUTPUT',
            isCore: true
        };
    }
    if (classType.includes('loraloader') || classType.includes('lora')) {
        return {
            title,
            badgeText: '🏷️ LoRA',
            badgeClass: 'da-blueprint-badge--lora',
            category: 'SAMPLER',
            isCore: true
        };
    }

    return {
        title,
        badgeText: '🧩 节点',
        badgeClass: 'da-blueprint-badge--general',
        category: 'GENERAL',
        isCore: false
    };
}

let activeDropdownCleanup: (() => void) | null = null;

/** 关闭当前激活的宏变量下拉菜单 */
function closeMacroDropdown(): void {
    if (activeDropdownCleanup) {
        activeDropdownCleanup();
        activeDropdownCleanup = null;
    }
    if (activeDropdownEl) {
        activeDropdownEl.remove();
        activeDropdownEl = null;
    }
}

/**
 * 弹出智能宏变量选择浮层
 *
 * @param anchorBtn 触发按钮元素
 * @param fieldKey 当前字段名 (如 seed, positive, steps)
 * @param currentValue 当前输入框的值
 * @param onSelect 选中宏变量后的回调
 */
function openMacroDropdown(
    anchorBtn: HTMLElement,
    fieldKey: string,
    currentValue: string,
    onSelect: (val: string) => void
): void {
    closeMacroDropdown();

    const dropdown = document.createElement('div');
    dropdown.className = 'da-var-dropdown da-portal-dropdown st-da-root';
    ThemeService.applyCurrentThemeToNode(dropdown);

    const macros = getMacroVariables();

    // 智能匹配判定：当前字段 key 命中 matchKeys 或值相等
    const normalizedKey = (fieldKey || '').toLowerCase();
    const isRecommended = (item: any): boolean => {
        if (currentValue && (currentValue === item.variable || item.aliases?.includes(currentValue))) {
            return true;
        }
        if (item.matchKeys && Array.isArray(item.matchKeys)) {
            return item.matchKeys.some((k: string) => normalizedKey.includes(k.toLowerCase()) || k.toLowerCase().includes(normalizedKey));
        }
        return false;
    };

    const recommendedList = macros.filter(isRecommended);
    const otherList = macros.filter((m) => !isRecommended(m));

    let html = '';

    if (recommendedList.length > 0) {
        html += '<div class="da-var-dropdown__group-title"><i class="fa-solid fa-star"></i> 智能推荐变量</div>';
        recommendedList.forEach((m) => {
            const isSelected = currentValue === m.variable;
            html += `
                <div class="da-var-dropdown__item recommended ${isSelected ? 'active' : ''}" data-val="${escapeHtml(m.variable)}">
                    <div class="da-var-dropdown__item-header">
                        <span class="da-macro-tag">${escapeHtml(m.variable)}</span>
                        <span class="da-var-dropdown__label">${escapeHtml(m.label)}</span>
                        <span class="da-var-dropdown__badge">🌟 推荐</span>
                    </div>
                    <div class="da-var-dropdown__tip">${escapeHtml(m.tip || '')}</div>
                </div>
            `;
        });
    }

    if (otherList.length > 0) {
        html += '<div class="da-var-dropdown__group-title"><i class="fa-solid fa-list"></i> 全部宏变量</div>';
        otherList.forEach((m) => {
            const isSelected = currentValue === m.variable;
            html += `
                <div class="da-var-dropdown__item ${isSelected ? 'active' : ''}" data-val="${escapeHtml(m.variable)}">
                    <div class="da-var-dropdown__item-header">
                        <span class="da-macro-tag">${escapeHtml(m.variable)}</span>
                        <span class="da-var-dropdown__label">${escapeHtml(m.label)}</span>
                    </div>
                    <div class="da-var-dropdown__tip">${escapeHtml(m.tip || '')}</div>
                </div>
            `;
        });
    }

    dropdown.innerHTML = html;

    // 绑定点击项事件
    dropdown.querySelectorAll<HTMLElement>('.da-var-dropdown__item').forEach((itemEl) => {
        itemEl.onclick = (e) => {
            e.stopPropagation();
            const val = itemEl.getAttribute('data-val');
            if (val) {
                onSelect(val);
                closeMacroDropdown();
                FeedbackService.toastSuccess(`已填入 ${val}`);
            }
        };
    });

    document.body.appendChild(dropdown);
    activeDropdownEl = dropdown;

    // 计算定位
    const rect = anchorBtn.getBoundingClientRect();
    const dropdownHeight = Math.min(360, dropdown.scrollHeight);
    const spaceBelow = window.innerHeight - rect.bottom;
    
    dropdown.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`;

    if (spaceBelow < dropdownHeight + 10 && rect.top > dropdownHeight) {
        // 向上弹出
        dropdown.style.bottom = `${window.innerHeight - rect.top + 6}px`;
        dropdown.style.top = 'auto';
    } else {
        // 向下弹出
        dropdown.style.top = `${rect.bottom + 6}px`;
        dropdown.style.bottom = 'auto';
    }

    // 点击外部关闭
    const onDocClick = (e: MouseEvent) => {
        if (!dropdown.contains(e.target as Node) && !anchorBtn.contains(e.target as Node)) {
            closeMacroDropdown();
        }
    };
    activeDropdownCleanup = () => {
        document.removeEventListener('click', onDocClick, true);
    };
    setTimeout(() => {
        if (activeDropdownEl === dropdown) {
            document.addEventListener('click', onDocClick, true);
        }
    }, 10);
}

/** 关闭蓝图编辑器 */
export function closeBlueprintModal(): void {
    closeMacroDropdown();
    if (modalOverlayEl) {
        modalOverlayEl.remove();
        modalOverlayEl = null;
    }
    selectedNodeId = null;
    currentZoom = 1.0;
}

/** 打开蓝图编辑器 */
export function openBlueprintModal(
    jsonStr: string,
    arg2?: ((newJson: string) => void) | 'txt2img' | 'inpaint',
    arg3?: ((newJson: string) => void) | 'txt2img' | 'inpaint'
): void {
    closeBlueprintModal();

    let targetType: 'txt2img' | 'inpaint' = 'txt2img';
    let onSaveCallback: ((newJson: string) => void) | undefined;

    if (typeof arg2 === 'function') {
        onSaveCallback = arg2;
        if (typeof arg3 === 'string') targetType = arg3;
    } else if (typeof arg2 === 'string') {
        targetType = arg2;
        if (typeof arg3 === 'function') onSaveCallback = arg3;
    }

    let parsed: WorkflowJsonObj = {};
    try {
        let rawObj = JSON.parse(jsonStr || '{}');
        if (rawObj?.prompt && typeof rawObj.prompt === 'object' && !Array.isArray(rawObj.prompt)) {
            rawObj = rawObj.prompt;
        }
        if (rawObj?.data?.json && typeof rawObj.data.json === 'string') {
            rawObj = JSON.parse(rawObj.data.json);
        } else if (rawObj?.json && typeof rawObj.json === 'string') {
            rawObj = JSON.parse(rawObj.json);
        }
        parsed = rawObj as WorkflowJsonObj;
    } catch (err) {
        logger.error('解析工作流 JSON 失败', err);
        FeedbackService.toastError('解析工作流 JSON 失败，格式不正确');
        return;
    }

    modalOverlayEl = document.createElement('div');
    modalOverlayEl.className = 'da-modal-backdrop st-da-root';
    ThemeService.applyCurrentThemeToNode(modalOverlayEl);

    const modalInner = document.createElement('div');
    modalInner.className = 'da-blueprint-modal-inner st-da-root';
    modalInner.addEventListener('click', (e) => e.stopPropagation());
    ThemeService.applyCurrentThemeToNode(modalInner);

    // 1. 顶栏
    const header = document.createElement('div');
    header.className = 'da-header-bar da-blueprint-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'da-blueprint-header-left';

    const titleSt = document.createElement('span');
    titleSt.className = 'da-blueprint-title';
    titleSt.innerHTML = `<i class="fa-solid fa-diagram-project"></i> ${
        targetType === 'inpaint'
            ? 'ComfyUI 局部重绘工作流蓝图编辑器'
            : 'ComfyUI 文生图工作流蓝图编辑器'
    }`;

    const countBadge = document.createElement('span');
    countBadge.className = 'da-version-capsule';
    countBadge.textContent = `${Object.keys(parsed).length} 个节点`;

    headerLeft.appendChild(titleSt);
    headerLeft.appendChild(countBadge);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-modal-close-btn';
    closeBtn.title = '关闭蓝图编辑器';
    closeBtn.addEventListener('click', () => closeBlueprintModal());

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);
    modalInner.appendChild(header);

    // 2. 搜索与缩放控制工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'da-blueprint-toolbar';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 搜索节点 ID、类名 (class_type) 或标题...';
    searchInput.className = 'da-input da-blueprint-search';

    const catTabs = document.createElement('div');
    catTabs.className = 'da-blueprint-category-tabs';

    const categories = [
        { id: 'ALL', label: '全部' },
        { id: 'CORE', label: '核心节点' },
        { id: 'PROMPT', label: '文本编码' },
        { id: 'SAMPLER', label: '采样与模型' },
        { id: 'SIZE', label: '尺寸输出' }
    ];

    const renderTabs = () => {
        catTabs.innerHTML = '';
        categories.forEach((cat) => {
            const btn = document.createElement('button');
            btn.className = `da-btn da-blueprint-category-btn ${
                currentCategoryFilter === cat.id ? 'da-btn--primary' : 'da-btn--secondary'
            }`;
            btn.textContent = cat.label;
            btn.addEventListener('click', () => {
                currentCategoryFilter = cat.id;
                renderTabs();
                renderCanvas();
            });
            catTabs.appendChild(btn);
        });
    };
    renderTabs();

    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'da-blueprint-zoom-group';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'da-btn da-btn--secondary da-blueprint-zoom-btn';
    zoomOutBtn.textContent = '－';
    zoomOutBtn.title = '缩小画布';

    const zoomResetBtn = document.createElement('button');
    zoomResetBtn.className = 'da-btn da-btn--secondary da-blueprint-zoom-btn-reset';
    zoomResetBtn.textContent = '100%';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'da-btn da-btn--secondary da-blueprint-zoom-btn';
    zoomInBtn.textContent = '＋';
    zoomInBtn.title = '放大画布';

    const applyZoom = (newZoom: number) => {
        currentZoom = Math.min(Math.max(newZoom, 0.5), 1.8);
        zoomResetBtn.textContent = `${Math.round(currentZoom * 100)}%`;
        if (canvasInner) {
            canvasInner.style.transform = `scale(${currentZoom})`;
        }
    };

    zoomOutBtn.addEventListener('click', () => applyZoom(currentZoom - 0.15));
    zoomInBtn.addEventListener('click', () => applyZoom(currentZoom + 0.15));
    zoomResetBtn.addEventListener('click', () => applyZoom(1.0));

    zoomGroup.appendChild(zoomOutBtn);
    zoomGroup.appendChild(zoomResetBtn);
    zoomGroup.appendChild(zoomInBtn);

    const toolbarLeft = document.createElement('div');
    toolbarLeft.className = 'da-blueprint-toolbar-left';
    toolbarLeft.appendChild(searchInput);
    toolbarLeft.appendChild(catTabs);

    const toolbarRight = document.createElement('div');
    toolbarRight.className = 'da-blueprint-toolbar-right';
    toolbarRight.appendChild(zoomGroup);

    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(toolbarRight);
    modalInner.appendChild(toolbar);

    // 3. 画布与右侧属性抽屉
    const workspace = document.createElement('div');
    workspace.className = 'da-blueprint-workspace';

    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'da-blueprint-canvas-wrapper';

    const canvasInner = document.createElement('div');
    canvasInner.className = 'da-blueprint-canvas-inner';
    canvasWrapper.appendChild(canvasInner);
    workspace.appendChild(canvasWrapper);

    const inspectorPanel = document.createElement('div');
    inspectorPanel.className = 'da-blueprint-inspector-panel';
    workspace.appendChild(inspectorPanel);

    modalInner.appendChild(workspace);

    const renderInspector = () => {
        inspectorPanel.innerHTML = '';
        closeMacroDropdown();

        if (!selectedNodeId || !parsed[selectedNodeId]) {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'da-blueprint-empty-hint';
            emptyHint.innerHTML = `
                <div class="da-blueprint-empty-hint-icon">🖱️</div>
                <div style="font-weight:600;">点击左侧画布上的节点卡片</div>
                <div class="da-blueprint-empty-hint-sub">即可在此编辑参数与绑定宏变量</div>
            `;
            inspectorPanel.appendChild(emptyHint);
            return;
        }

        const nodeData = parsed[selectedNodeId];
        const cardHeader = document.createElement('div');
        cardHeader.className = 'da-blueprint-card-header';

        const badgeMeta = getNodeBadgeMeta(selectedNodeId, nodeData);

        cardHeader.innerHTML = `
            <div class="da-blueprint-header-row">
                <span class="da-blueprint-node-badge ${badgeMeta.badgeClass}">${badgeMeta.badgeText}</span>
                <span class="da-blueprint-node-id">#${selectedNodeId}</span>
            </div>
            <div class="da-blueprint-node-title">${escapeHtml(badgeMeta.title)}</div>
            <div class="da-blueprint-class-type">class: <code>${escapeHtml(nodeData.class_type)}</code></div>
        `;
        inspectorPanel.appendChild(cardHeader);

        // ── 字段属性编辑区 ──
        const fieldsBox = document.createElement('div');
        fieldsBox.className = 'da-blueprint-fields-box';

        Object.entries(nodeData.inputs || {}).forEach(([key, val]) => {
            const fieldGroup = document.createElement('div');
            fieldGroup.className = 'da-blueprint-field-group';

            const fieldLabelRow = document.createElement('div');
            fieldLabelRow.className = 'da-blueprint-field-label-row';

            const keySpan = document.createElement('span');
            keySpan.className = 'da-blueprint-key-label';
            keySpan.textContent = key;
            fieldLabelRow.appendChild(keySpan);

            if (Array.isArray(val)) {
                const linkSpan = document.createElement('span');
                linkSpan.className = 'da-blueprint-link-label';
                linkSpan.textContent = `Node Link ➔ [#${val.join(', ')}]`;
                fieldLabelRow.appendChild(linkSpan);
                fieldGroup.appendChild(fieldLabelRow);
            } else {
                fieldGroup.appendChild(fieldLabelRow);

                const isLongText =
                    typeof val === 'string' &&
                    (key.toLowerCase().includes('text') ||
                        key.toLowerCase().includes('prompt') ||
                        String(val).length > 24);

                const inputGroup = document.createElement('div');
                inputGroup.className = 'da-blueprint-input-group';

                let inputControl: HTMLInputElement | HTMLTextAreaElement;

                if (isLongText) {
                    const txtArea = document.createElement('textarea');
                    txtArea.className = 'da-input da-blueprint-textarea';
                    txtArea.value = val !== undefined && val !== null ? String(val) : '';
                    txtArea.addEventListener('input', () => {
                        nodeData.inputs[key] = txtArea.value;
                        renderCanvas();
                    });
                    inputControl = txtArea;
                } else {
                    const txtInput = document.createElement('input');
                    txtInput.type = 'text';
                    txtInput.className = 'da-input da-blueprint-textinput';
                    txtInput.value = val !== undefined && val !== null ? String(val) : '';
                    txtInput.addEventListener('input', () => {
                        const rawVal = txtInput.value.trim();
                        if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
                            nodeData.inputs[key] = Number(rawVal);
                        } else if (rawVal === 'true' || rawVal === 'false') {
                            nodeData.inputs[key] = rawVal === 'true';
                        } else {
                            nodeData.inputs[key] = rawVal;
                        }
                        renderCanvas();
                    });
                    inputControl = txtInput;
                }

                // 变量注入图标按钮 {v}
                const varBtn = document.createElement('button');
                varBtn.type = 'button';
                varBtn.className = 'da-btn-var-inject';
                varBtn.title = '快捷注入宏变量...';
                varBtn.innerHTML = '{v}';
                varBtn.onclick = (e) => {
                    e.stopPropagation();
                    openMacroDropdown(varBtn, key, inputControl.value, (selectedVar) => {
                        inputControl.value = selectedVar;
                        nodeData.inputs[key] = selectedVar;
                        renderCanvas();
                    });
                };

                inputGroup.appendChild(inputControl);
                inputGroup.appendChild(varBtn);
                fieldGroup.appendChild(inputGroup);
            }

            fieldsBox.appendChild(fieldGroup);
        });

        inspectorPanel.appendChild(fieldsBox);
    };

    const renderCanvas = () => {
        canvasInner.innerHTML = '';
        const entries = Object.entries(parsed);

        const filtered = entries.filter(([nodeId, data]) => {
            const meta = getNodeBadgeMeta(nodeId, data);
            if (currentSearchQuery) {
                const q = currentSearchQuery.toLowerCase();
                const matchId = nodeId.includes(q);
                const matchType = data.class_type.toLowerCase().includes(q);
                const matchTitle = meta.title.toLowerCase().includes(q);
                if (!matchId && !matchType && !matchTitle) return false;
            }

            if (currentCategoryFilter === 'CORE') return meta.isCore;
            if (currentCategoryFilter === 'PROMPT') return meta.category === 'PROMPT';
            if (currentCategoryFilter === 'SAMPLER') return meta.category === 'SAMPLER';
            if (currentCategoryFilter === 'SIZE') return meta.category === 'SIZE';
            return true;
        });

        if (filtered.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'da-blueprint-empty-canvas';
            emptyMsg.textContent = '未查找到符合条件的节点';
            canvasInner.appendChild(emptyMsg);
            return;
        }

        filtered.forEach(([nodeId, data]) => {
            const miniCard = document.createElement('div');
            miniCard.className = `da-blueprint-mini-card ${
                selectedNodeId === nodeId ? 'active' : ''
            }`;

            const meta = getNodeBadgeMeta(nodeId, data);

            const inputSummary: string[] = [];
            Object.entries(data.inputs || {})
                .slice(0, 3)
                .forEach(([k, v]) => {
                    if (!Array.isArray(v)) {
                        const strVal = String(v);
                        inputSummary.push(
                            `${k}: ${strVal.length > 20 ? strVal.substring(0, 20) + '...' : strVal}`
                        );
                    }
                });

            miniCard.innerHTML = `
                <div class="da-blueprint-header-row">
                    <span class="da-blueprint-node-badge ${meta.badgeClass}">${meta.badgeText}</span>
                    <span class="da-blueprint-node-id">#${nodeId}</span>
                </div>
                <div class="da-blueprint-card-title">${escapeHtml(meta.title)}</div>
                <div class="da-blueprint-card-inputs">
                    ${inputSummary.map((s) => `<div>${escapeHtml(s)}</div>`).join('')}
                </div>
            `;

            miniCard.addEventListener('click', () => {
                selectedNodeId = nodeId;
                renderCanvas();
                renderInspector();
            });

            canvasInner.appendChild(miniCard);
        });
    };

    searchInput.addEventListener('input', () => {
        currentSearchQuery = searchInput.value.trim();
        renderCanvas();
    });

    renderCanvas();
    renderInspector();

    // 4. 底栏
    const footer = document.createElement('div');
    footer.className = 'da-footer-bar da-blueprint-footer';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'da-btn primary';
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 保存工作流修改';
    saveBtn.addEventListener('click', () => {
        try {
            const updatedStr = JSON.stringify(parsed, null, 2);
            if (onSaveCallback) {
                onSaveCallback(updatedStr);
            }
            closeBlueprintModal();
            FeedbackService.toastSuccess('工作流蓝图配置已成功保存！');
        } catch (err) {
            logger.error('保存蓝图改动失败', err);
            FeedbackService.toastError(
                `保存失败: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn da-btn--secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => closeBlueprintModal());

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modalInner.appendChild(footer);

    modalOverlayEl.appendChild(modalInner);
    modalOverlayEl.addEventListener('click', () => closeBlueprintModal());
    document.body.appendChild(modalOverlayEl);
}
