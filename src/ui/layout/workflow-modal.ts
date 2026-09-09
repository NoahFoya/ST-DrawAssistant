/**
 * ComfyUI 工作流可视化编辑弹窗组件
 * 提供 ComfyUI 节点工作流的可视化卡片工作台、属性检查器与宏变量填入
 */

import { escapeHtml } from '../foundation';
import { FeedbackService } from '../feedback/feedback';
import { ModalService } from './modal-service';
import { COMFYUI_VARIABLE_DEFINITIONS } from '../components';

export interface WorkflowNodeData {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
}

export type WorkflowJsonObj = Record<string, WorkflowNodeData>;

export interface WorkflowModalOptions {
    targetType?: 'txt2img' | 'inpaint';
    onSave?: (newJson: string) => void;
}

/** 辅助函数：根据节点信息判别 Badge 分类与类型 */
export function getNodeBadgeMeta(_nodeId: string, nodeData: WorkflowNodeData) {
    const classType = (nodeData.class_type || '').toLowerCase();
    const title = nodeData._meta?.title ?? nodeData.class_type;

    if (classType.includes('cliptextencode') || classType.includes('prompt')) {
        return {
            title,
            badgeText: '🔤 文本编码',
            badgeClass: 'da-workflow-badge--prompt',
            category: 'PROMPT',
            isCore: true
        };
    }
    if (classType.includes('ksampler') || classType.includes('sampler')) {
        return {
            title,
            badgeText: '⚙️ 采样器',
            badgeClass: 'da-workflow-badge--sampler',
            category: 'SAMPLER',
            isCore: true
        };
    }
    if (classType.includes('checkpointloader') || classType.includes('unetloader')) {
        return {
            title,
            badgeText: '📦 模型加载',
            badgeClass: 'da-workflow-badge--model',
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
            badgeClass: 'da-workflow-badge--size',
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
            badgeClass: 'da-workflow-badge--output',
            category: 'OUTPUT',
            isCore: true
        };
    }
    if (classType.includes('loraloader') || classType.includes('lora')) {
        return {
            title,
            badgeText: '🏷️ LoRA',
            badgeClass: 'da-workflow-badge--lora',
            category: 'SAMPLER',
            isCore: true
        };
    }

    return {
        title,
        badgeText: '🧩 节点',
        badgeClass: 'da-workflow-badge--general',
        category: 'GENERAL',
        isCore: false
    };
}

/**
 * 弹出 ComfyUI 蓝图可视化编辑弹窗
 *
 * @param jsonStr 当前待编辑的工作流 JSON 字符串
 * @param optionsOrOnSave 保存回调或弹窗配置项
 * @param maybeType 模式类型 (txt2img | inpaint)
 */
export function openWorkflowModal(
    jsonStr: string,
    optionsOrOnSave?: ((newJson: string) => void) | WorkflowModalOptions,
    maybeType?: 'txt2img' | 'inpaint'
): void {
    let targetType: 'txt2img' | 'inpaint' = 'txt2img';
    let onSaveCallback: ((newJson: string) => void) | undefined;

    if (typeof optionsOrOnSave === 'function') {
        onSaveCallback = optionsOrOnSave;
        if (maybeType) targetType = maybeType;
    } else if (optionsOrOnSave && typeof optionsOrOnSave === 'object') {
        if (optionsOrOnSave.onSave) onSaveCallback = optionsOrOnSave.onSave;
        if (optionsOrOnSave.targetType) targetType = optionsOrOnSave.targetType;
    }

    let parsed: WorkflowJsonObj = {};
    try {
        let rawObj = JSON.parse(jsonStr.trim() || '{}');
        if (rawObj?.prompt && typeof rawObj.prompt === 'object' && !Array.isArray(rawObj.prompt)) {
            rawObj = rawObj.prompt;
        }
        if (rawObj?.data?.json && typeof rawObj.data.json === 'string') {
            rawObj = JSON.parse(rawObj.data.json);
        } else if (rawObj?.json && typeof rawObj.json === 'string') {
            rawObj = JSON.parse(rawObj.json);
        }
        if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
            throw new Error('工作流数据根节点必须为包含节点 ID 的 Object 结构');
        }
        parsed = rawObj as WorkflowJsonObj;
    } catch (err: any) {
        FeedbackService.toastError(`解析工作流 JSON 失败: ${err?.message || err}`);
        return;
    }

    // 实例级闭包状态 (完全消除模块级全局变量污染)
    let currentZoom = 1.0;
    let selectedNodeId: string | null = null;
    let currentCategoryFilter = 'ALL';
    let currentSearchQuery = '';
    let activeDropdownEl: HTMLElement | null = null;
    let activeDropdownCleanup: (() => void) | null = null;
    let modalHandle: { dispose: () => void } | null = null;

    const closeMacroDropdown = () => {
        if (activeDropdownCleanup) {
            activeDropdownCleanup();
            activeDropdownCleanup = null;
        }
        if (activeDropdownEl) {
            activeDropdownEl.remove();
            activeDropdownEl = null;
        }
    };

    const closeModal = () => {
        closeMacroDropdown();
        if (modalHandle) {
            modalHandle.dispose();
            modalHandle = null;
        }
    };

    /** 弹出智能宏变量选择浮层 */
    const openMacroDropdown = (
        anchorBtn: HTMLElement,
        fieldKey: string,
        currentValue: string,
        onSelect: (val: string) => void
    ) => {
        closeMacroDropdown();

        const dropdown = document.createElement('div');
        dropdown.className = 'da-var-dropdown da-portal-dropdown st-da-root';

        const macros = COMFYUI_VARIABLE_DEFINITIONS;
        const normalizedKey = (fieldKey || '').toLowerCase();

        const isRecommended = (item: (typeof COMFYUI_VARIABLE_DEFINITIONS)[number]): boolean => {
            if (currentValue && currentValue === item.variable) return true;
            if (item.matchKeys && Array.isArray(item.matchKeys)) {
                return item.matchKeys.some((k: string) =>
                    normalizedKey.includes(k.toLowerCase()) || k.toLowerCase().includes(normalizedKey)
                );
            }
            return false;
        };

        const recommendedList = macros.filter(isRecommended);
        const otherList = macros.filter((m) => !isRecommended(m));

        let html = '';
        if (recommendedList.length > 0) {
            html += '<div class="da-var-dropdown__group-title">🌟 智能推荐变量</div>';
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
            html += '<div class="da-var-dropdown__group-title">📋 全部宏变量</div>';
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

        // 定位计算
        const rect = anchorBtn.getBoundingClientRect();
        const dropdownHeight = Math.min(360, dropdown.scrollHeight || 200);
        const spaceBelow = window.innerHeight - rect.bottom;

        dropdown.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`;

        if (spaceBelow < dropdownHeight + 10 && rect.top > dropdownHeight) {
            dropdown.style.bottom = `${window.innerHeight - rect.top + 6}px`;
            dropdown.style.top = 'auto';
        } else {
            dropdown.style.top = `${rect.bottom + 6}px`;
            dropdown.style.bottom = 'auto';
        }

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
    };

    // 创建模态框 DOM 结构
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'da-modal-backdrop st-da-root';

    const modalInner = document.createElement('div');
    modalInner.className = 'st-da-root';
    modalInner.addEventListener('click', (e) => e.stopPropagation());

    // 顶栏工具条
    const header = document.createElement('div');
    header.className = 'da-header-bar';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'da-workflow-header-left';

    const titleSt = document.createElement('span');
    titleSt.className = 'da-workflow-title';
    titleSt.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
        ${targetType === 'inpaint' ? 'ComfyUI 局部重绘工作流配置' : 'ComfyUI 文生图工作流配置'}
    `;

    const countBadge = document.createElement('span');
    countBadge.className = 'da-version-badge';
    countBadge.textContent = `${Object.keys(parsed).length} 个节点`;

    headerLeft.appendChild(titleSt);
    headerLeft.appendChild(countBadge);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-modal-close-btn';
    closeBtn.title = '关闭工作流编辑器';
    closeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
    `;
    closeBtn.addEventListener('click', () => closeModal());

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);
    modalInner.appendChild(header);

    // 搜索与缩放控制工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'da-workflow-toolbar';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 搜索节点 ID、类名或标题...';
    searchInput.className = 'da-input';

    const catTabs = document.createElement('div');
    catTabs.className = 'da-workflow-category-tabs';

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
            btn.className = `da-btn ${
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
    zoomGroup.className = 'da-workflow-zoom-group';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'da-btn da-btn--secondary';
    zoomOutBtn.textContent = '－';
    zoomOutBtn.title = '缩小画布';

    const zoomResetBtn = document.createElement('button');
    zoomResetBtn.className = 'da-btn da-btn--secondary';
    zoomResetBtn.textContent = '100%';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'da-btn da-btn--secondary';
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
    toolbarLeft.className = 'da-workflow-toolbar-left';
    toolbarLeft.appendChild(searchInput);
    toolbarLeft.appendChild(catTabs);

    const toolbarRight = document.createElement('div');
    toolbarRight.className = 'da-workflow-toolbar-right';
    toolbarRight.appendChild(zoomGroup);

    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(toolbarRight);
    modalInner.appendChild(toolbar);

    // 工作台：节点画布与属性抽屉
    const workspace = document.createElement('div');
    workspace.className = 'da-workflow-workspace';

    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'da-workflow-canvas-wrapper';

    const canvasInner = document.createElement('div');
    canvasInner.className = 'da-workflow-canvas-inner';
    canvasWrapper.appendChild(canvasInner);
    workspace.appendChild(canvasWrapper);

    const inspectorPanel = document.createElement('div');
    inspectorPanel.className = 'da-workflow-inspector-panel';
    workspace.appendChild(inspectorPanel);

    modalInner.appendChild(workspace);

    const renderInspector = () => {
        inspectorPanel.innerHTML = '';
        closeMacroDropdown();

        if (!selectedNodeId || !parsed[selectedNodeId]) {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'da-workflow-empty-hint';
            emptyHint.innerHTML = `
                <div class="da-workflow-empty-hint-icon">🖱️</div>
                <div style="font-weight:600;">点击左侧画布上的节点卡片</div>
                <div class="da-workflow-empty-hint-sub">即可在此编辑参数与绑定宏变量</div>
            `;
            inspectorPanel.appendChild(emptyHint);
            return;
        }

        const nodeData = parsed[selectedNodeId];
        const cardHeader = document.createElement('div');
        cardHeader.className = 'da-workflow-card-header';

        const badgeMeta = getNodeBadgeMeta(selectedNodeId, nodeData);

        cardHeader.innerHTML = `
            <div class="da-workflow-header-row">
                <span class="${badgeMeta.badgeClass}">${badgeMeta.badgeText}</span>
                <span class="da-workflow-node-id">#${selectedNodeId}</span>
            </div>
            <div class="da-workflow-node-title">${escapeHtml(badgeMeta.title)}</div>
            <div class="da-workflow-class-type">class: <code>${escapeHtml(nodeData.class_type)}</code></div>
        `;
        inspectorPanel.appendChild(cardHeader);

        // 字段属性编辑区
        const fieldsBox = document.createElement('div');
        fieldsBox.className = 'da-workflow-fields-box';

        Object.entries(nodeData.inputs || {}).forEach(([key, val]) => {
            const fieldGroup = document.createElement('div');
            fieldGroup.className = 'da-workflow-field-group';

            const fieldLabelRow = document.createElement('div');
            fieldLabelRow.className = 'da-workflow-field-label-row';

            const keySpan = document.createElement('span');
            keySpan.className = 'da-workflow-key-label';
            keySpan.textContent = key;
            fieldLabelRow.appendChild(keySpan);

            if (Array.isArray(val)) {
                const linkSpan = document.createElement('span');
                linkSpan.className = 'da-workflow-link-label';
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
                inputGroup.className = 'da-workflow-input-group';

                let inputControl: HTMLInputElement | HTMLTextAreaElement;

                if (isLongText) {
                    const txtArea = document.createElement('textarea');
                    txtArea.className = 'da-input';
                    txtArea.value = val !== undefined && val !== null ? String(val) : '';
                    txtArea.addEventListener('input', () => {
                        nodeData.inputs[key] = txtArea.value;
                        renderCanvas();
                    });
                    inputControl = txtArea;
                } else {
                    const txtInput = document.createElement('input');
                    txtInput.type = 'text';
                    txtInput.className = 'da-input';
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
                varBtn.textContent = '{v}';
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
            emptyMsg.className = 'da-workflow-empty-canvas';
            emptyMsg.textContent = '未查找到符合条件的节点';
            canvasInner.appendChild(emptyMsg);
            return;
        }

        filtered.forEach(([nodeId, data]) => {
            const miniCard = document.createElement('div');
            miniCard.className = `da-workflow-mini-card ${selectedNodeId === nodeId ? 'active' : ''}`;

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
                <div class="da-workflow-header-row">
                    <span class="${meta.badgeClass}">${meta.badgeText}</span>
                    <span class="da-workflow-node-id">#${nodeId}</span>
                </div>
                <div class="da-workflow-card-title">${escapeHtml(meta.title)}</div>
                <div class="da-workflow-card-inputs">
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

    // 底栏操作区
    const footer = document.createElement('div');
    footer.className = 'da-footer-bar';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'da-btn da-btn--primary';
    saveBtn.textContent = '保存工作流修改';
    saveBtn.addEventListener('click', () => {
        try {
            const updatedStr = JSON.stringify(parsed, null, 2);
            if (onSaveCallback) {
                onSaveCallback(updatedStr);
            }
            closeModal();
            FeedbackService.toastSuccess('工作流配置已成功保存！');
        } catch (err: any) {
            FeedbackService.toastError(`保存失败: ${err?.message || err}`);
        }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn da-btn--secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => closeModal());

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modalInner.appendChild(footer);

    modalBackdrop.appendChild(modalInner);

    modalHandle = ModalService.getInstance().open(modalBackdrop, {
        closeOnBackdrop: true,
        closeOnEscape: true,
        onClose: () => {
            closeMacroDropdown();
        }
    });
}


