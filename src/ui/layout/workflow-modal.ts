/**
 * ComfyUI 工作流蓝图与 JSON 检查弹窗 (WorkflowModal)
 *
 * 功能：
 * 1. 提供 ComfyUI API 工作流节点的可视化流程结构与原生 JSON 预览；
 * 2. 支持节点属性检查、占位变量高亮与参数联动；
 * 3. 提供工作流 JSON 本地导入、导出下载与剪贴板一键复制；
 * 4. 支持可视化与 Raw 源码视图无缝切换，并提供键盘快捷键退出。
 *
 * Tips：
 * 1. 复杂工作流可能包含上百个节点，渲染迷你卡片时需控制 DOM 数量并做局部滚动隔离；
 * 2. 外部 JSON 文本导入时需执行语法校验与防呆拦截，防止非法数据污染当前预设。
 */

import { createElement } from '../../util/dom';
import { createButton, ButtonHandle } from '../components/button';
import { createTextInput, createTextarea, TextareaHandle } from '../components/input';
import { Toast } from '../components/feedback';
import { getIconSvg } from '../components/icons';

export interface WorkflowModalOptions {
    title?: string;
    workflowId?: string;
    workflowJson: string;
    containerEl?: HTMLElement;
    onSave?: (json: string) => void;
    onClose?: () => void;
}

export interface WorkflowModalHandle {
    readonly element: HTMLElement;
    open(): void;
    close(): void;
    isOpen(): boolean;
    setJson(json: string): void;
    getJson(): string;
    dispose(): void;
}

export function createWorkflowModal(options: WorkflowModalOptions): WorkflowModalHandle {
    const disposers: (() => void)[] = [];

    const regDisposer = (item?: { dispose?: () => void }) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    let currentJsonStr = options.workflowJson || '{}';
    let parsedNodes: Record<string, any> = {};
    let selectedNodeId: string | null = null;
    let isRawView = false;
    let isOpen = false;

    // 1. 全屏遮罩外壳
    const backdrop = createElement('div', {
        className: 'da-modal-backdrop st-da-root',
        attributes: { style: 'display: none; position: fixed; inset: 0; z-index: var(--da-z-modal, 100050); background: var(--da-bg-overlay-modal, rgba(0, 0, 0, 0.65)); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); align-items: center; justify-content: center;' }
    });

    // 2. 视窗主体
    const inner = createElement('div', { className: 'da-workflow-modal-inner' });
    backdrop.appendChild(inner);

    // 3. 顶部工具栏 (.da-workflow-header)
    const header = createElement('div', { className: 'da-workflow-header' });

    const headerLeft = createElement('div', { className: 'da-workflow-header-left' });
    const titleEl = createElement('div', { className: 'da-workflow-title' });
    titleEl.innerHTML = `
        <span style="color: var(--da-accent-color);">${getIconSvg('palette')}</span>
        <span>${options.title || 'ComfyUI 运算流程蓝图'}</span>
    `;
    headerLeft.appendChild(titleEl);

    const nodeCountBadge = createElement('span', {
        className: 'da-workflow-node-badge da-workflow-badge--general',
        attributes: { style: 'margin-left: 8px;' },
        textContent: '0 个节点'
    });
    headerLeft.appendChild(nodeCountBadge);
    header.appendChild(headerLeft);

    const headerRight = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px; align-items: center;' }
    });

    // 视图切换按钮 (可视化 / JSON)
    const toggleViewBtn: ButtonHandle = createButton({
        text: '切换源码 (JSON)',
        variant: 'secondary',
        onClick: () => {
            isRawView = !isRawView;
            toggleViewBtn.setText(isRawView ? '返回画布视图' : '切换源码 (JSON)');
            renderWorkspace();
        }
    });
    regDisposer(toggleViewBtn);
    headerRight.appendChild(toggleViewBtn.element);

    // 复制 JSON 按钮
    const copyJsonBtn: ButtonHandle = createButton({
        text: '复制 JSON',
        variant: 'secondary',
        icon: 'copy',
        onClick: () => {
            navigator.clipboard.writeText(currentJsonStr);
            Toast.success('工作流 JSON 已复制到剪贴板');
        }
    });
    regDisposer(copyJsonBtn);
    headerRight.appendChild(copyJsonBtn.element);

    // 导出文件按钮
    const exportFileBtn: ButtonHandle = createButton({
        text: '导出文件',
        variant: 'secondary',
        icon: 'download',
        onClick: () => {
            const blob = new Blob([currentJsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${options.workflowId || 'comfyui_workflow'}_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            Toast.success('工作流已导出');
        }
    });
    regDisposer(exportFileBtn);
    headerRight.appendChild(exportFileBtn.element);

    // 关闭按钮
    const closeBtn = createElement('button', {
        className: 'da-icon-btn',
        attributes: { type: 'button', 'aria-label': '关闭窗口', title: '关闭 (Esc)' }
    });
    closeBtn.innerHTML = getIconSvg('close');
    closeBtn.addEventListener('click', () => close());
    headerRight.appendChild(closeBtn);

    header.appendChild(headerRight);
    inner.appendChild(header);

    // 4. 工作区分栏容器 (.da-workflow-workspace)
    const workspace = createElement('div', { className: 'da-workflow-workspace' });
    inner.appendChild(workspace);

    // 左侧画布面板
    const canvasWrapper = createElement('div', { className: 'da-workflow-canvas-wrapper' });
    const canvasInner = createElement('div', { className: 'da-workflow-canvas-inner' });
    canvasWrapper.appendChild(canvasInner);

    // 右侧检查器面板
    const inspector = createElement('div', { className: 'da-workflow-inspector-panel' });

    // 源码多行编辑视图
    const rawEditorWrapper = createElement('div', {
        attributes: { style: 'flex: 1; display: flex; flex-direction: column; padding: 12px; height: 100%; box-sizing: border-box;' }
    });
    const rawTextarea: TextareaHandle = createTextarea({
        value: currentJsonStr,
        placeholder: 'ComfyUI 流程图 JSON 结构...',
        rows: 25,
        onChange: (val) => {
            currentJsonStr = val;
            tryParseJson();
        }
    });
    regDisposer(rawTextarea);
    rawEditorWrapper.appendChild(rawTextarea.element);

    // 5. 底部操作栏
    const footer = createElement('div', {
        attributes: {
            style: 'height: 48px; padding: 0 16px; background: var(--da-bg-secondary); border-top: 1px solid var(--da-border-color); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;'
        }
    });

    const statusNote = createElement('span', {
        attributes: { style: 'font-size: 12px; color: var(--da-text-secondary);' },
        textContent: 'ComfyUI 标准 API 格式定义'
    });
    footer.appendChild(statusNote);

    const footerActions = createElement('div', {
        attributes: { style: 'display: flex; gap: 8px;' }
    });

    const saveBtn: ButtonHandle = createButton({
        text: '保存并应用',
        variant: 'primary',
        icon: 'check',
        onClick: () => {
            options.onSave?.(currentJsonStr);
            Toast.success('工作流修改已保存');
            close();
        }
    });
    regDisposer(saveBtn);
    footerActions.appendChild(saveBtn.element);

    footer.appendChild(footerActions);
    inner.appendChild(footer);

    // 辅助解析与分类
    function getNodeCategory(classType: string): 'prompt' | 'sampler' | 'model' | 'size' | 'output' | 'lora' | 'general' {
        const lower = (classType || '').toLowerCase();
        if (lower.includes('cliptext') || lower.includes('prompt')) return 'prompt';
        if (lower.includes('ksampler') || lower.includes('sampler')) return 'sampler';
        if (lower.includes('checkpoint') || lower.includes('loader') || lower.includes('unet')) return 'model';
        if (lower.includes('latent') || lower.includes('size') || lower.includes('dimension')) return 'size';
        if (lower.includes('saveimage') || lower.includes('preview') || lower.includes('output')) return 'output';
        if (lower.includes('lora')) return 'lora';
        return 'general';
    }

    function tryParseJson() {
        try {
            parsedNodes = JSON.parse(currentJsonStr);
            if (typeof parsedNodes !== 'object' || parsedNodes === null) {
                parsedNodes = {};
            }
        } catch {
            parsedNodes = {};
        }
    }

    function renderWorkspace() {
        workspace.innerHTML = '';
        if (isRawView) {
            rawTextarea.setValue(currentJsonStr);
            workspace.appendChild(rawEditorWrapper);
            return;
        }

        tryParseJson();
        const nodeIds = Object.keys(parsedNodes);
        nodeCountBadge.textContent = `${nodeIds.length} 个节点`;

        workspace.appendChild(canvasWrapper);
        workspace.appendChild(inspector);

        canvasInner.innerHTML = '';

        if (nodeIds.length === 0) {
            const emptyEl = createElement('div', {
                className: 'da-workflow-empty-canvas',
                textContent: '未解析到有效节点或 JSON 结构为空'
            });
            canvasInner.appendChild(emptyEl);
            inspector.innerHTML = '<div style="color: var(--da-text-muted); font-size: 13px; text-align: center; margin-top: 40px;">请在左侧选择节点查看属性</div>';
            return;
        }

        if (!selectedNodeId || !parsedNodes[selectedNodeId]) {
            selectedNodeId = nodeIds[0];
        }

        for (const nid of nodeIds) {
            const nodeData = parsedNodes[nid];
            const classType = nodeData?.class_type || 'UnknownNode';
            const cat = getNodeCategory(classType);

            const card = createElement('div', {
                className: `da-workflow-mini-card ${nid === selectedNodeId ? 'active' : ''}`
            });

            card.innerHTML = `
                <div class="da-workflow-header-row">
                    <span class="da-workflow-node-id">#${nid}</span>
                    <span class="da-workflow-node-badge da-workflow-badge--${cat}">${cat.toUpperCase()}</span>
                </div>
                <div class="da-workflow-card-title" title="${classType}">${nodeData?._meta?.title || classType}</div>
            `;

            card.addEventListener('click', () => {
                selectedNodeId = nid;
                renderWorkspace();
            });

            canvasInner.appendChild(card);
        }

        renderInspector();
    }

    function renderInspector() {
        inspector.innerHTML = '';
        if (!selectedNodeId || !parsedNodes[selectedNodeId]) {
            inspector.innerHTML = '<div style="color: var(--da-text-muted); font-size: 13px; text-align: center; margin-top: 40px;">未选择节点</div>';
            return;
        }

        const node = parsedNodes[selectedNodeId];
        const classType = node.class_type || 'UnknownNode';

        const headerEl = createElement('div', { className: 'da-workflow-card-header' });
        headerEl.innerHTML = `
            <div class="da-workflow-node-title">#${selectedNodeId} · ${node._meta?.title || classType}</div>
            <div class="da-workflow-class-type">${classType}</div>
        `;
        inspector.appendChild(headerEl);

        const inputs = node.inputs || {};
        const fieldsBox = createElement('div', { className: 'da-workflow-fields-box' });

        const keys = Object.keys(inputs);
        if (keys.length === 0) {
            fieldsBox.innerHTML = '<div style="color: var(--da-text-secondary); font-size: 12px;">该节点无输入参数</div>';
        } else {
            for (const k of keys) {
                const val = inputs[k];
                const group = createElement('div', { className: 'da-workflow-field-group' });

                const labelRow = createElement('div', { className: 'da-workflow-field-label-row' });
                labelRow.innerHTML = `<span class="da-workflow-key-label" style="font-size: 12px; font-weight: 600;">${k}</span>`;
                group.appendChild(labelRow);

                if (Array.isArray(val)) {
                    // 连接其他节点端口
                    const linkText = createElement('div', {
                        attributes: { style: 'font-family: monospace; font-size: 12px; color: var(--da-accent-color); background: rgba(var(--da-accent-rgb), 0.08); padding: 4px 8px; border-radius: 4px;' },
                        textContent: `[连接至节点 #${val[0]} 端口 ${val[1]}]`
                    });
                    group.appendChild(linkText);
                } else if (typeof val === 'string' && val.length > 50) {
                    const ta = createTextarea({
                        value: val,
                        rows: 3,
                        onChange: (newVal) => {
                            inputs[k] = newVal;
                            currentJsonStr = JSON.stringify(parsedNodes, null, 2);
                        }
                    });
                    group.appendChild(ta.element);
                } else {
                    const ti = createTextInput({
                        value: String(val ?? ''),
                        onChange: (newVal) => {
                            inputs[k] = isNaN(Number(newVal)) ? newVal : Number(newVal);
                            currentJsonStr = JSON.stringify(parsedNodes, null, 2);
                        }
                    });
                    group.appendChild(ti.element);
                }

                fieldsBox.appendChild(group);
            }
        }

        inspector.appendChild(fieldsBox);
    }

    // 键盘 Esc 监听
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && isOpen) {
            close();
        }
    };
    document.addEventListener('keydown', onKeyDown);
    disposers.push(() => document.removeEventListener('keydown', onKeyDown));

    // 遮罩点击关闭
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            close();
        }
    });

    disposers.push(() => backdrop.remove());

    function open() {
        isOpen = true;
        const targetParent = options.containerEl || (typeof document !== 'undefined' ? document.body : null);
        if (targetParent && !targetParent.contains(backdrop)) {
            targetParent.appendChild(backdrop);
        }
        backdrop.style.display = 'flex';
        renderWorkspace();
    }

    function close() {
        isOpen = false;
        backdrop.style.display = 'none';
        options.onClose?.();
    }

    return {
        element: backdrop,
        open,
        close,
        isOpen(): boolean {
            return isOpen;
        },
        setJson(json: string): void {
            currentJsonStr = json;
            if (isOpen) {
                renderWorkspace();
            }
        },
        getJson(): string {
            return currentJsonStr;
        },
        dispose(): void {
            for (const d of disposers) {
                d();
            }
        }
    };
}
