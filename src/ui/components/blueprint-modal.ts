/**
 * @module ui/components/blueprint-modal
 * @description 工作流蓝图可视化编辑弹窗组件
 *
 * 职责：
 * - 解析 ComfyUI API 格式工作流 JSON，绘制可视化节点列表与参数编辑器
 * - 提供节点分类过滤、实时搜索及占位变量快捷插入
 * - 支持修改节点输入参数后重新导出更新的工作流 JSON
 */

import { loadSettings } from '../../settings/manager';
import { patchSettings } from '../../state/app-store';
import { PARAMETER_VARIABLES } from '../../core/variables';
import { logger } from '../../core/logger';
import { escapeHtml } from '../../utils/html';
import { showToastNotice } from '../../utils/toast';
import { applyPluginTheme, applyCurrentThemeToNode } from '../tabs/theme-tab';

export interface WorkflowNodeData {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
}

export type WorkflowJsonObj = Record<string, WorkflowNodeData>;

let modalOverlayEl: HTMLElement | null = null;
let currentZoom = 1.0;
let selectedNodeId: string | null = null;
let currentCategoryFilter = 'ALL';
let currentSearchQuery = '';

/**
 * 打开工作流蓝图可视化编辑弹窗
 *
 * @param workflowJsonStr 要编辑的工作流 JSON 字符串
 * @param onSaveCallback 保存修改后的工作流 JSON 字符串回调
 * @param targetType 目标工作流类型
 */
export function openBlueprintModal(
    workflowJsonStr: string,
    onSaveCallback?: (updatedJsonStr: string) => void,
    targetType: 'txt2img' | 'inpaint' = 'txt2img'
): void {
    let parsed: WorkflowJsonObj = {};
    try {
        if (workflowJsonStr.trim()) {
            parsed = JSON.parse(workflowJsonStr) as WorkflowJsonObj;
        }
    } catch (err) {
        logger.warn('蓝图编辑器打开失败: 工作流 JSON 存在语法错误', err);
        showToastNotice('当前工作流 JSON 存在语法错误，无法启动蓝图可视化编辑器！', '语法错误', false);
        return;
    }

    currentZoom = 1.0;
    selectedNodeId = null;
    currentCategoryFilter = 'ALL';
    currentSearchQuery = '';

    if (modalOverlayEl) {
        modalOverlayEl.remove();
        modalOverlayEl = null;
    }

    modalOverlayEl = document.createElement('div');
    modalOverlayEl.className = 'da-blueprint-backdrop da-modal-backdrop st-da-root';
    modalOverlayEl.style.display = 'flex';
    modalOverlayEl.style.zIndex = '100050';
    applyCurrentThemeToNode(modalOverlayEl);

    const modalInner = document.createElement('div');
    modalInner.className = 'da-settings-panel da-blueprint-container st-da-root';
    modalInner.style.width = '94%';
    modalInner.style.maxWidth = '1180px';
    modalInner.style.height = '88vh';
    modalInner.style.maxHeight = '880px';
    modalInner.style.display = 'flex';
    modalInner.style.flexDirection = 'column';
    modalInner.addEventListener('click', (e) => e.stopPropagation());

    // 主题全景同步：确保蓝图模态框即刻刷新应用当前皮肤
    const settings = loadSettings();
    applyPluginTheme(settings.themePreset || 'luminous-obsidian');
    applyCurrentThemeToNode(modalInner);

    // 1. 顶栏
    const header = document.createElement('div');
    header.className = 'da-header-bar da-blueprint-header';

    const headerLeft = document.createElement('div');
    headerLeft.style.display = 'flex';
    headerLeft.style.alignItems = 'center';
    headerLeft.style.gap = '10px';

    const titleSt = document.createElement('span');
    titleSt.style.fontWeight = 'bold';
    titleSt.style.fontSize = '1.1em';
    titleSt.style.color = 'var(--da-text-primary)';
    titleSt.textContent = targetType === 'inpaint' ? 'ComfyUI 局部重绘工作流蓝图编辑器' : 'ComfyUI 文生图工作流蓝图编辑器';

    const countBadge = document.createElement('span');
    countBadge.className = 'da-header-version-badge';
    countBadge.textContent = `${Object.keys(parsed).length} 个节点`;

    headerLeft.appendChild(titleSt);
    headerLeft.appendChild(countBadge);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.title = '关闭蓝图编辑器';
    closeBtn.addEventListener('click', () => closeBlueprintModal());

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);
    modalInner.appendChild(header);

    // 2. 搜索与缩放控制工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'da-blueprint-toolbar';

    // 2.1 搜索框
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '🔍 搜索节点 ID、class_type 或字段...';
    searchInput.className = 'da-input';
    searchInput.style.width = '240px';
    searchInput.style.fontSize = '0.82em';

    // 2.2 分类切片按钮
    const catTabs = document.createElement('div');
    catTabs.style.display = 'flex';
    catTabs.style.gap = '4px';
    catTabs.style.flexWrap = 'wrap';

    const categories = [
        { id: 'ALL', label: '全部' },
        { id: 'CORE', label: '🔥 核心节点' },
        { id: 'PROMPT', label: '🔤 文本编码' },
        { id: 'SAMPLER', label: '⚙️ 采样与模型' },
        { id: 'SIZE', label: '🖼️ 尺寸输出' },
    ];

    const renderTabs = () => {
        catTabs.innerHTML = '';
        categories.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = `da-btn ${currentCategoryFilter === cat.id ? 'primary' : 'secondary'}`;
            btn.style.padding = '3px 9px';
            btn.style.fontSize = '0.78em';
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

    // 2.3 画布缩放控制器
    const zoomGroup = document.createElement('div');
    zoomGroup.style.display = 'flex';
    zoomGroup.style.alignItems = 'center';
    zoomGroup.style.gap = '4px';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'da-btn secondary';
    zoomOutBtn.style.padding = '3px 8px';
    zoomOutBtn.textContent = '－';
    zoomOutBtn.title = '缩小画布';

    const zoomResetBtn = document.createElement('button');
    zoomResetBtn.className = 'da-btn secondary';
    zoomResetBtn.style.padding = '3px 8px';
    zoomResetBtn.style.fontSize = '0.78em';
    zoomResetBtn.textContent = '100%';

    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'da-btn secondary';
    zoomInBtn.style.padding = '3px 8px';
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

    // 3. 画布与右侧属性抽屉主工作区
    const workspace = document.createElement('div');
    workspace.className = 'da-blueprint-workspace';

    // 左侧画布包裹器
    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'da-blueprint-canvas-wrapper';

    const canvasInner = document.createElement('div');
    canvasInner.className = 'da-blueprint-canvas-inner';
    canvasWrapper.appendChild(canvasInner);
    workspace.appendChild(canvasWrapper);

    // 右侧属性 Inspector 抽屉
    const inspectorPanel = document.createElement('div');
    inspectorPanel.className = 'da-blueprint-inspector-panel';
    workspace.appendChild(inspectorPanel);

    modalInner.appendChild(workspace);

    // 重新渲染画布与属性面板
    const renderInspector = () => {
        inspectorPanel.innerHTML = '';
        if (!selectedNodeId || !parsed[selectedNodeId]) {
            const emptyHint = document.createElement('div');
            emptyHint.style.textAlign = 'center';
            emptyHint.style.color = 'var(--da-text-secondary)';
            emptyHint.style.padding = '40px 10px';
            emptyHint.style.fontSize = '0.85em';
            emptyHint.innerHTML = `
                <div style="font-size: 2em; margin-bottom: 8px;">🖱️</div>
                <div>点击左侧画布上的节点卡片</div>
                <div style="font-size: 0.8em; margin-top: 4px; opacity: 0.75;">在此编辑属性与快速绑定变量</div>
            `;
            inspectorPanel.appendChild(emptyHint);
            return;
        }

        const nodeData = parsed[selectedNodeId];
        const cardHeader = document.createElement('div');
        cardHeader.style.borderBottom = '1px solid var(--da-border-color)';
        cardHeader.style.paddingBottom = '8px';

        const badgeMeta = getNodeBadgeMeta(selectedNodeId, nodeData);

        cardHeader.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span class="da-blueprint-node-badge ${badgeMeta.badgeClass}">${badgeMeta.badgeText}</span>
                <span style="font-weight: bold; font-family: var(--monoFontFamily, monospace); color: var(--da-accent-color);">#${selectedNodeId}</span>
            </div>
            <div style="font-weight: bold; font-size: 0.95em; color: var(--da-text-primary);">${escapeHtml(badgeMeta.title)}</div>
            <div style="font-size: 0.75em; color: var(--da-text-secondary); font-family: var(--monoFontFamily, monospace); margin-top: 2px;">class: ${escapeHtml(nodeData.class_type)}</div>
        `;
        inspectorPanel.appendChild(cardHeader);

        // 属性表单编辑区域
        const fieldsBox = document.createElement('div');
        fieldsBox.style.display = 'flex';
        fieldsBox.style.flexDirection = 'column';
        fieldsBox.style.gap = '10px';

        Object.entries(nodeData.inputs || {}).forEach(([key, val]) => {
            const fieldGroup = document.createElement('div');
            fieldGroup.style.display = 'flex';
            fieldGroup.style.flexDirection = 'column';
            fieldGroup.style.gap = '4px';

            const fieldLabelRow = document.createElement('div');
            fieldLabelRow.style.display = 'flex';
            fieldLabelRow.style.alignItems = 'center';
            fieldLabelRow.style.justifyContent = 'space-between';

            const keySpan = document.createElement('span');
            keySpan.style.fontFamily = 'var(--monoFontFamily, monospace)';
            keySpan.style.fontSize = '0.8em';
            keySpan.style.fontWeight = '600';
            keySpan.style.color = 'var(--da-text-primary)';
            keySpan.textContent = key;
            fieldLabelRow.appendChild(keySpan);

            if (Array.isArray(val)) {
                const linkSpan = document.createElement('span');
                linkSpan.style.fontSize = '0.75em';
                linkSpan.style.color = 'var(--da-text-secondary)';
                linkSpan.textContent = `Node Link [${val.join(', ')}]`;
                fieldLabelRow.appendChild(linkSpan);
                fieldGroup.appendChild(fieldLabelRow);
            } else {
                fieldGroup.appendChild(fieldLabelRow);

                const isLongText = typeof val === 'string' && (key.toLowerCase().includes('text') || key.toLowerCase().includes('prompt') || String(val).length > 24);
                let inputControl: HTMLInputElement | HTMLTextAreaElement;

                if (isLongText) {
                    const txtArea = document.createElement('textarea');
                    txtArea.className = 'da-input';
                    txtArea.style.height = '60px';
                    txtArea.style.fontSize = '0.8em';
                    txtArea.style.resize = 'vertical';
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
                    txtInput.style.fontSize = '0.8em';
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

                // 快捷变量注入胶囊下拉框
                const varSelect = document.createElement('select');
                varSelect.className = 'da-select';
                varSelect.style.fontSize = '0.75em';
                varSelect.style.padding = '2px 4px';
                varSelect.style.marginTop = '2px';

                let opts = `<option value="">快捷变量注入...</option>`;
                PARAMETER_VARIABLES.forEach(v => {
                    opts += `<option value="${v.key}">${v.key} (${v.name})</option>`;
                });
                varSelect.innerHTML = opts;

                varSelect.addEventListener('change', () => {
                    if (!varSelect.value) return;
                    inputControl.value = varSelect.value;
                    nodeData.inputs[key] = varSelect.value;
                    varSelect.value = '';
                    renderCanvas();
                });

                fieldGroup.appendChild(inputControl);
                fieldGroup.appendChild(varSelect);
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
            // 1. 搜索词匹配
            if (currentSearchQuery) {
                const q = currentSearchQuery.toLowerCase();
                const matchId = nodeId.includes(q);
                const matchType = data.class_type.toLowerCase().includes(q);
                const matchTitle = meta.title.toLowerCase().includes(q);
                if (!matchId && !matchType && !matchTitle) return false;
            }

            // 2. 分类切片匹配
            if (currentCategoryFilter === 'CORE') return meta.isCore;
            if (currentCategoryFilter === 'PROMPT') return meta.category === 'PROMPT';
            if (currentCategoryFilter === 'SAMPLER') return meta.category === 'SAMPLER';
            if (currentCategoryFilter === 'SIZE') return meta.category === 'SIZE';
            return true;
        });

        if (filtered.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.gridColumn = '1 / -1';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.padding = '50px';
            emptyMsg.style.color = 'var(--da-text-secondary)';
            emptyMsg.textContent = '未查找到符合条件的节点';
            canvasInner.appendChild(emptyMsg);
            return;
        }

        filtered.forEach(([nodeId, data]) => {
            const miniCard = document.createElement('div');
            miniCard.className = `da-blueprint-mini-card ${selectedNodeId === nodeId ? 'active' : ''}`;

            const meta = getNodeBadgeMeta(nodeId, data);

            // 提取前 2 项属性作简略摘要
            const inputSummary: string[] = [];
            Object.entries(data.inputs || {}).slice(0, 2).forEach(([k, v]) => {
                if (!Array.isArray(v)) {
                    const strVal = String(v);
                    inputSummary.push(`${k}: ${strVal.length > 18 ? strVal.substring(0, 18) + '...' : strVal}`);
                }
            });

            miniCard.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span class="da-blueprint-node-badge ${meta.badgeClass}">${meta.badgeText}</span>
                    <span style="font-weight: bold; font-family: var(--monoFontFamily, monospace); font-size: 0.8em; color: var(--da-accent-color);">#${nodeId}</span>
                </div>
                <div style="font-weight: bold; font-size: 0.88em; color: var(--da-text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(meta.title)}</div>
                <div style="font-size: 0.72em; color: var(--da-text-secondary); line-height: 1.3;">
                    ${inputSummary.map(s => `<div>${escapeHtml(s)}</div>`).join('')}
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

    // 初始渲染
    renderCanvas();
    renderInspector();

    // 4. 底栏
    const footer = document.createElement('div');
    footer.className = 'da-footer-bar';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'da-btn primary';
    saveBtn.textContent = '保存工作流修改';
    saveBtn.addEventListener('click', () => {
        try {
            const updatedStr = JSON.stringify(parsed, null, 2);
            const activeSettings = loadSettings();

            if (targetType === 'txt2img') {
                const currentId = activeSettings.comfyTxt2ImgWorkflowId;
                const list = [...(activeSettings.comfyTxt2ImgWorkflows ?? [])];
                if (currentId) {
                    const item = list.find(w => w.id === currentId);
                    if (item) {
                        item.data = { json: updatedStr };
                        patchSettings({ comfyTxt2ImgWorkflows: list });
                    }
                }
            } else {
                const currentId = activeSettings.comfyInpaintWorkflowId;
                const list = [...(activeSettings.comfyInpaintWorkflows ?? [])];
                if (currentId) {
                    const item = list.find(w => w.id === currentId);
                    if (item) {
                        item.data = { json: updatedStr };
                        patchSettings({ comfyInpaintWorkflows: list });
                    }
                }
            }

            if (onSaveCallback) {
                onSaveCallback(updatedStr);
            }
            closeBlueprintModal();
            showToastNotice('蓝图工作流节点配置已成功写回并保存！', '保存成功', true);
        } catch (err) {
            logger.error('保存蓝图改动失败', err);
            showToastNotice(`保存失败: ${err instanceof Error ? err.message : String(err)}`, '保存失败', false);
        }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'da-btn secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => closeBlueprintModal());

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modalInner.appendChild(footer);

    modalOverlayEl.appendChild(modalInner);
    modalOverlayEl.addEventListener('click', () => closeBlueprintModal());
    document.body.appendChild(modalOverlayEl);
}

export function closeBlueprintModal(): void {
    if (modalOverlayEl) {
        modalOverlayEl.remove();
        modalOverlayEl = null;
    }
}

/** 辅助函数：根据节点信息判别 Badge 分类与类型 */
function getNodeBadgeMeta(nodeId: string, nodeData: WorkflowNodeData) {
    const classType = (nodeData.class_type || '').toLowerCase();
    const title = nodeData._meta?.title ?? nodeData.class_type;

    if (classType.includes('cliptextencode') || classType.includes('prompt')) {
        return {
            title,
            badgeText: '🔤 Prompt',
            badgeClass: 'da-blueprint-badge--prompt',
            category: 'PROMPT',
            isCore: true,
        };
    }
    if (classType.includes('ksampler') || classType.includes('sampler')) {
        return {
            title,
            badgeText: '⚙️ 采样器',
            badgeClass: 'da-blueprint-badge--sampler',
            category: 'SAMPLER',
            isCore: true,
        };
    }
    if (classType.includes('checkpointloader') || classType.includes('loraloader') || classType.includes('model')) {
        return {
            title,
            badgeText: '📦 模型加载',
            badgeClass: 'da-blueprint-badge--model',
            category: 'SAMPLER',
            isCore: true,
        };
    }
    if (classType.includes('emptylatent') || classType.includes('saveimage') || classType.includes('previewimage')) {
        return {
            title,
            badgeText: '🖼️ 尺寸输出',
            badgeClass: 'da-blueprint-badge--size',
            category: 'SIZE',
            isCore: true,
        };
    }

    return {
        title,
        badgeText: `节点 #${nodeId}`,
        badgeClass: 'da-blueprint-badge--generic',
        category: 'GENERIC',
        isCore: false,
    };
}
