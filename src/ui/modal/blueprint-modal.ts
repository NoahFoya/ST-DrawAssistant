/**
 * ComfyUI 蓝图可视化节点编辑器模态弹窗 (BlueprintModal)。
 *
 * @remarks
 * 为 ComfyUI API 格式工作流提供交互式可视化节点检视与在线编辑能力：
 * 1. 结构安全解析：验证并解析工作流 JSON 流程节点结构字典；
 * 2. 点阵画布与微缩节点流：按分类色彩徽标渲染节点概览卡片，支持关键字检索与分类切片；
 * 3. 节点属性检视器 (Inspector)：编辑选定节点的 inputs 输入参数，支持一键注入标准宏变量占位符胶囊；
 * 4. 双向数据写回：支持保存修改并格式化输出，触发外层工作流草稿同步更新。
 */

import type { Disposable } from '../types';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';
import { COMFYUI_VARIABLE_DEFINITIONS } from '../composite/workflow-card';

export interface WorkflowNodeData {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
}

export type WorkflowJsonObj = Record<string, WorkflowNodeData>;

export type BlueprintSaveCallback = (updatedJsonStr: string) => void;

type NodeCategory = 'ALL' | 'CORE' | 'PROMPT' | 'SAMPLER' | 'SIZE';

interface CategoryTab {
    id: NodeCategory;
    label: string;
}

const CATEGORY_TABS: CategoryTab[] = [
    { id: 'ALL', label: '全部' },
    { id: 'CORE', label: '核心节点' },
    { id: 'PROMPT', label: '文本编码' },
    { id: 'SAMPLER', label: '采样与模型' },
    { id: 'SIZE', label: '尺寸输出' },
];

export class BlueprintModal implements Disposable {
    private isOpenState = false;
    private workflowData: WorkflowJsonObj = {};
    private onSaveCallback?: BlueprintSaveCallback;

    private selectedNodeId: string | null = null;
    private currentCategory: NodeCategory = 'ALL';
    private searchQuery = '';
    private canvasZoom = 1.0;

    // DOM 引用
    private backdropElement: HTMLElement | null = null;
    private canvasInnerElement: HTMLElement | null = null;
    private inspectorContentElement: HTMLElement | null = null;
    private nodeCountBadge: HTMLElement | null = null;
    private activeDropdown: HTMLElement | null = null;
    private closeDropdownListener: ((e: MouseEvent) => void) | null = null;

    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    /**
     * 打开蓝图可视化节点编辑器。
     *
     * @param workflowJsonStr 工作流 JSON 文本
     * @param onSave 保存工作流时的回调函数
     */
    public open(workflowJsonStr: string, onSave?: BlueprintSaveCallback): boolean {
        let parsed: WorkflowJsonObj = {};
        try {
            const trimmed = workflowJsonStr.trim();
            if (trimmed) {
                parsed = JSON.parse(trimmed) as WorkflowJsonObj;
            }
        } catch (err) {
            logger.warn('蓝图编辑器打开失败: 工作流 JSON 存在语法错误', err);
            Toast.error('当前工作流 JSON 存在语法错误，无法启动蓝图可视化编辑器！');
            return false;
        }

        this.workflowData = parsed;
        this.onSaveCallback = onSave;
        this.selectedNodeId = null;
        this.currentCategory = 'ALL';
        this.searchQuery = '';
        this.canvasZoom = 1.0;

        this.close();
        this.buildDOM();
        this.bindEvents();
        this.isOpenState = true;

        if (this.backdropElement) {
            document.body.appendChild(this.backdropElement);
        }

        this.renderCanvas();
        this.renderInspector();
        return true;
    }

    /**
     * 关闭蓝图编辑器并释放 DOM。
     */
    public close(): void {
        this.closeDropdown();
        if (!this.isOpenState && !this.backdropElement) {
            return;
        }
        this.unbindEvents();
        if (this.backdropElement && this.backdropElement.parentElement) {
            this.backdropElement.parentElement.removeChild(this.backdropElement);
        }
        this.backdropElement = null;
        this.canvasInnerElement = null;
        this.inspectorContentElement = null;
        this.nodeCountBadge = null;
        this.isOpenState = false;
    }

    public isOpen(): boolean {
        return this.isOpenState;
    }

    public dispose(): void {
        this.close();
    }

    private buildDOM(): void {
        // 1. 遮罩层
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-blueprint-backdrop';
        backdrop.style.zIndex = '100050';
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                this.close();
            }
        });
        this.backdropElement = backdrop;

        // 2. 弹窗主视窗
        const modal = document.createElement('div');
        modal.className = 'da-blueprint-container';
        modal.addEventListener('click', (e) => e.stopPropagation());

        // 3. 顶栏 (Header)
        const header = document.createElement('div');
        header.className = 'da-header-bar da-blueprint-header';

        const headerLeft = document.createElement('div');
        headerLeft.className = 'da-header-left';
        headerLeft.style.display = 'flex';
        headerLeft.style.alignItems = 'center';
        headerLeft.style.gap = '10px';

        const title = document.createElement('h3');
        title.className = 'da-header-title';
        title.textContent = 'ComfyUI 蓝图可视化节点编辑器';
        title.style.margin = '0';
        title.style.fontSize = '1.05rem';

        this.nodeCountBadge = document.createElement('span');
        this.nodeCountBadge.className = 'da-badge da-header-badge';
        this.nodeCountBadge.textContent = `${Object.keys(this.workflowData).length} 个节点`;

        headerLeft.appendChild(title);
        headerLeft.appendChild(this.nodeCountBadge);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'da-modal-close-btn';
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.setAttribute('aria-label', '关闭蓝图编辑器');
        closeBtn.addEventListener('click', () => this.close());

        header.appendChild(headerLeft);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // 4. 工具栏 (Toolbar: 搜索 + 分类 Tab + 缩放控制)
        const toolbar = document.createElement('div');
        toolbar.className = 'da-blueprint-toolbar';

        // 4.1 搜索输入框
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'da-input da-blueprint-search-input';
        searchInput.placeholder = '🔍 搜索节点 ID、类型或字段...';
        searchInput.value = this.searchQuery;
        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value.trim().toLowerCase();
            this.renderCanvas();
        });
        toolbar.appendChild(searchInput);

        // 4.2 分类过滤按钮组
        const catGroup = document.createElement('div');
        catGroup.className = 'da-blueprint-cat-group';

        for (const cat of CATEGORY_TABS) {
            const catBtn = document.createElement('button');
            catBtn.type = 'button';
            catBtn.className = `da-btn da-btn--sm ${this.currentCategory === cat.id ? 'da-btn--primary' : 'da-btn--secondary'}`;
            catBtn.textContent = cat.label;
            catBtn.addEventListener('click', () => {
                this.currentCategory = cat.id;
                // 更新高亮
                for (const child of Array.from(catGroup.children)) {
                    child.classList.remove('da-btn--primary');
                    child.classList.add('da-btn--secondary');
                }
                catBtn.classList.remove('da-btn--secondary');
                catBtn.classList.add('da-btn--primary');
                this.renderCanvas();
            });
            catGroup.appendChild(catBtn);
        }
        toolbar.appendChild(catGroup);

        // 4.3 缩放控制
        const zoomControl = document.createElement('div');
        zoomControl.className = 'da-blueprint-zoom-control';

        const zoomOutBtn = document.createElement('button');
        zoomOutBtn.type = 'button';
        zoomOutBtn.className = 'da-btn da-btn--sm da-btn--secondary';
        zoomOutBtn.textContent = '－';
        zoomOutBtn.title = '缩小画布';
        zoomOutBtn.addEventListener('click', () => {
            this.canvasZoom = Math.max(0.6, Number((this.canvasZoom - 0.1).toFixed(2)));
            this.applyZoom();
        });

        const zoomResetBtn = document.createElement('button');
        zoomResetBtn.type = 'button';
        zoomResetBtn.className = 'da-btn da-btn--sm da-btn--secondary';
        zoomResetBtn.textContent = '100%';
        zoomResetBtn.title = '重置为原始比例';
        zoomResetBtn.addEventListener('click', () => {
            this.canvasZoom = 1.0;
            this.applyZoom();
        });

        const zoomInBtn = document.createElement('button');
        zoomInBtn.type = 'button';
        zoomInBtn.className = 'da-btn da-btn--sm da-btn--secondary';
        zoomInBtn.textContent = '＋';
        zoomInBtn.title = '放大画布';
        zoomInBtn.addEventListener('click', () => {
            this.canvasZoom = Math.min(1.5, Number((this.canvasZoom + 0.1).toFixed(2)));
            this.applyZoom();
        });

        zoomControl.appendChild(zoomOutBtn);
        zoomControl.appendChild(zoomResetBtn);
        zoomControl.appendChild(zoomInBtn);
        toolbar.appendChild(zoomControl);

        modal.appendChild(toolbar);

        // 5. 工作区 (Workspace: 左侧点阵画布 + 右侧属性检视面板)
        const workspace = document.createElement('div');
        workspace.className = 'da-blueprint-workspace';

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'da-blueprint-canvas-wrapper';

        this.canvasInnerElement = document.createElement('div');
        this.canvasInnerElement.className = 'da-blueprint-canvas-inner';
        canvasWrapper.appendChild(this.canvasInnerElement);
        workspace.appendChild(canvasWrapper);

        const inspectorPanel = document.createElement('div');
        inspectorPanel.className = 'da-blueprint-inspector-panel';

        const inspectorHeader = document.createElement('div');
        inspectorHeader.className = 'da-blueprint-inspector-header';
        inspectorHeader.innerHTML = '<h4>节点属性检视器</h4>';
        inspectorPanel.appendChild(inspectorHeader);

        this.inspectorContentElement = document.createElement('div');
        this.inspectorContentElement.className = 'da-blueprint-inspector-body';
        inspectorPanel.appendChild(this.inspectorContentElement);

        workspace.appendChild(inspectorPanel);
        modal.appendChild(workspace);

        // 6. 底栏 (Footer: 取消与保存修改)
        const footer = document.createElement('div');
        footer.className = 'da-footer-bar da-blueprint-footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'da-btn da-btn--secondary';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'da-btn da-btn--primary';
        saveBtn.textContent = '保存工作流修改';
        saveBtn.addEventListener('click', () => {
            try {
                const formatted = JSON.stringify(this.workflowData, null, 2);
                this.onSaveCallback?.(formatted);
                Toast.success('蓝图工作流节点配置已更新！');
                this.close();
            } catch (err) {
                logger.error('保存工作流修改失败:', err);
                Toast.error(`保存失败: ${String(err)}`);
            }
        });

        footer.appendChild(cancelBtn);
        footer.appendChild(saveBtn);
        modal.appendChild(footer);

        backdrop.appendChild(modal);
    }

    private applyZoom(): void {
        if (!this.canvasInnerElement) return;
        this.canvasInnerElement.style.transform = `scale(${this.canvasZoom})`;
    }

    private renderCanvas(): void {
        if (!this.canvasInnerElement) return;
        this.canvasInnerElement.innerHTML = '';

        const nodeEntries = Object.entries(this.workflowData);
        let visibleCount = 0;

        for (const [nodeId, nodeData] of nodeEntries) {
            const meta = this.classifyNode(nodeId, nodeData);

            // 分类过滤
            if (this.currentCategory !== 'ALL') {
                if (this.currentCategory === 'CORE' && !meta.isCore) continue;
                if (this.currentCategory === 'PROMPT' && meta.category !== 'PROMPT') continue;
                if (this.currentCategory === 'SAMPLER' && meta.category !== 'SAMPLER') continue;
                if (this.currentCategory === 'SIZE' && meta.category !== 'SIZE') continue;
            }

            // 搜索过滤
            if (this.searchQuery) {
                const q = this.searchQuery;
                const matchId = nodeId.toLowerCase().includes(q);
                const matchType = (nodeData.class_type || '').toLowerCase().includes(q);
                const matchTitle = meta.title.toLowerCase().includes(q);
                const matchInputs = JSON.stringify(nodeData.inputs || {}).toLowerCase().includes(q);
                if (!matchId && !matchType && !matchTitle && !matchInputs) {
                    continue;
                }
            }

            visibleCount++;
            const isSelected = this.selectedNodeId === nodeId;

            const card = document.createElement('div');
            card.className = `da-blueprint-mini-card${isSelected ? ' is-active' : ''}`;
            card.setAttribute('data-node-id', nodeId);

            const badge = document.createElement('span');
            badge.className = `da-blueprint-node-badge ${meta.badgeClass}`;
            badge.textContent = `${meta.badgeText} #${nodeId}`;
            card.appendChild(badge);

            const title = document.createElement('div');
            title.className = 'da-blueprint-card-title';
            title.textContent = meta.title;
            card.appendChild(title);

            const classLabel = document.createElement('div');
            classLabel.className = 'da-blueprint-card-type';
            classLabel.textContent = nodeData.class_type;
            card.appendChild(classLabel);

            // 简要输入参数摘录 (取前 3 项)
            const inputs = nodeData.inputs || {};
            const inputSummary = Object.entries(inputs).slice(0, 3).map(([k, v]) => {
                const valStr = typeof v === 'object' ? '[Link]' : String(v);
                return `${k}: ${valStr.length > 20 ? valStr.slice(0, 18) + '...' : valStr}`;
            });

            if (inputSummary.length > 0) {
                const summaryBox = document.createElement('div');
                summaryBox.className = 'da-blueprint-card-inputs-preview';
                summaryBox.textContent = inputSummary.join(' · ');
                card.appendChild(summaryBox);
            }

            card.addEventListener('click', () => {
                this.selectedNodeId = nodeId;
                this.renderCanvas();
                this.renderInspector();
            });

            this.canvasInnerElement.appendChild(card);
        }

        if (visibleCount === 0) {
            const emptyTip = document.createElement('div');
            emptyTip.className = 'da-blueprint-empty';
            emptyTip.textContent = '未检索到匹配的节点';
            this.canvasInnerElement.appendChild(emptyTip);
        }
    }

    private renderInspector(): void {
        if (!this.inspectorContentElement) return;
        this.inspectorContentElement.innerHTML = '';

        if (!this.selectedNodeId || !this.workflowData[this.selectedNodeId]) {
            const placeholder = document.createElement('div');
            placeholder.className = 'da-blueprint-inspector-empty';
            placeholder.textContent = '👈 点击左侧节点卡片，在此检视与配置参数';
            this.inspectorContentElement.appendChild(placeholder);
            return;
        }

        const nodeId = this.selectedNodeId;
        const node = this.workflowData[nodeId];
        const meta = this.classifyNode(nodeId, node);

        // 1. 节点摘要头
        const nodeSummary = document.createElement('div');
        nodeSummary.className = 'da-blueprint-node-summary';
        nodeSummary.innerHTML = `
            <div class="da-blueprint-node-summary-id">节点: <strong>${meta.title} (#${nodeId})</strong></div>
            <div class="da-blueprint-node-summary-type">类型: <code>${node.class_type}</code></div>
        `;
        this.inspectorContentElement.appendChild(nodeSummary);

        // 2. 遍历 inputs 表单字段
        const inputs = node.inputs || {};
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'da-blueprint-fields-container';

        for (const [key, val] of Object.entries(inputs)) {
            const row = document.createElement('div');
            row.className = 'da-blueprint-field-row';

            const label = document.createElement('label');
            label.className = 'da-blueprint-field-label';
            label.textContent = key;
            row.appendChild(label);

            if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'string' && typeof val[1] === 'number') {
                // ComfyUI 连接槽: ["nodeId", slotIndex]
                const linkBadge = document.createElement('div');
                linkBadge.className = 'da-blueprint-link-slot';
                linkBadge.textContent = `➔ 引用自节点 #${val[0]} (插槽 ${val[1]})`;
                row.appendChild(linkBadge);
            } else if (typeof val === 'boolean') {
                const switchWrap = document.createElement('label');
                switchWrap.className = 'da-switch';
                const chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.className = 'da-switch__input';
                chk.checked = val;
                chk.addEventListener('change', () => {
                    node.inputs[key] = chk.checked;
                    this.renderCanvas();
                });
                const track = document.createElement('span');
                track.className = 'da-switch__track';
                const thumb = document.createElement('span');
                thumb.className = 'da-switch__thumb';
                track.appendChild(thumb);
                switchWrap.appendChild(chk);
                switchWrap.appendChild(track);
                row.appendChild(switchWrap);
            } else {
                // 可编辑属性复合行 (输入框 + 快捷变量替换按钮)
                const controlGroup = document.createElement('div');
                controlGroup.className = 'da-blueprint-field-control-group';

                const isLongText = typeof val === 'string' && (key.toLowerCase().includes('text') || key.toLowerCase().includes('prompt') || val.length > 50);

                let inputEl: HTMLInputElement | HTMLTextAreaElement;
                if (isLongText) {
                    const strInput = document.createElement('textarea');
                    strInput.className = 'da-textarea da-blueprint-textarea-field';
                    strInput.rows = typeof val === 'string' && val.length > 80 ? 4 : 2;
                    strInput.value = String(val ?? '');
                    strInput.setAttribute('data-input-field-key', key);
                    strInput.addEventListener('input', () => {
                        node.inputs[key] = strInput.value;
                        this.renderCanvas();
                    });
                    inputEl = strInput;
                } else {
                    const txtInput = document.createElement('input');
                    txtInput.type = 'text';
                    txtInput.className = 'da-input da-blueprint-input-field';
                    txtInput.value = val !== undefined && val !== null ? String(val) : '';
                    txtInput.setAttribute('data-input-field-key', key);
                    txtInput.addEventListener('input', () => {
                        const raw = txtInput.value.trim();
                        if (/^-?\d+(\.\d+)?$/.test(raw)) {
                            node.inputs[key] = Number(raw);
                        } else if (raw === 'true' || raw === 'false') {
                            node.inputs[key] = raw === 'true';
                        } else {
                            node.inputs[key] = txtInput.value;
                        }
                        this.renderCanvas();
                    });
                    inputEl = txtInput;
                }

                // 快捷变量按钮
                const varBtn = document.createElement('button');
                varBtn.type = 'button';
                varBtn.className = 'da-btn da-blueprint-var-btn';
                varBtn.textContent = '🏷️';
                varBtn.setAttribute('data-var-btn-key', key);

                const recommended = this.findRecommendedVariable(nodeId, node, key);
                if (recommended) {
                    varBtn.title = `推荐: ${recommended.variable} (${recommended.label}) - 点击替换`;
                    varBtn.classList.add('da-blueprint-var-btn--has-rec');
                } else {
                    varBtn.title = '选择参数变量进行替换';
                }

                varBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleVarDropdown(varBtn, inputEl, key, node, recommended);
                });

                controlGroup.appendChild(inputEl);
                controlGroup.appendChild(varBtn);
                row.appendChild(controlGroup);
            }

            fieldContainer.appendChild(row);
        }

        this.inspectorContentElement.appendChild(fieldContainer);
    }

    /**
     * 切换展开快捷变量选择浮层下拉菜单。
     */
    private toggleVarDropdown(
        btn: HTMLButtonElement,
        inputEl: HTMLInputElement | HTMLTextAreaElement,
        fieldKey: string,
        node: WorkflowNodeData,
        recommended: (typeof COMFYUI_VARIABLE_DEFINITIONS)[number] | null
    ): void {
        if (this.activeDropdown) {
            const isSame = this.activeDropdown.getAttribute('data-dropdown-for') === fieldKey;
            this.closeDropdown();
            if (isSame) {
                return;
            }
        }

        const dropdown = document.createElement('div');
        dropdown.className = 'da-blueprint-var-dropdown';
        dropdown.setAttribute('data-dropdown-for', fieldKey);
        dropdown.addEventListener('click', (e) => e.stopPropagation());

        // 1. 推荐匹配分类
        if (recommended) {
            const recHeader = document.createElement('div');
            recHeader.className = 'da-blueprint-var-group-title da-blueprint-var-group-title--rec';
            recHeader.textContent = '★ 推荐匹配';
            dropdown.appendChild(recHeader);

            const recItem = document.createElement('button');
            recItem.type = 'button';
            recItem.className = 'da-blueprint-var-item da-blueprint-var-item--recommended';
            recItem.innerHTML = `
                <span class="da-blueprint-var-item-name">${recommended.variable}</span>
                <span class="da-blueprint-var-item-desc">${recommended.label}</span>
            `;
            recItem.addEventListener('click', () => {
                inputEl.value = recommended.variable;
                node.inputs[fieldKey] = recommended.variable;
                this.closeDropdown();
                this.renderCanvas();
                Toast.info(`已为字段 [${fieldKey}] 填入推荐变量 ${recommended.variable}`);
            });
            dropdown.appendChild(recItem);
        }

        // 2. 所有可用参数变量列表
        const allHeader = document.createElement('div');
        allHeader.className = 'da-blueprint-var-group-title';
        allHeader.textContent = '所有参数变量';
        dropdown.appendChild(allHeader);

        for (const item of COMFYUI_VARIABLE_DEFINITIONS) {
            if (recommended && item.variable === recommended.variable) {
                continue;
            }
            const varItem = document.createElement('button');
            varItem.type = 'button';
            varItem.className = 'da-blueprint-var-item';
            varItem.innerHTML = `
                <span class="da-blueprint-var-item-name">${item.variable}</span>
                <span class="da-blueprint-var-item-desc">${item.label}</span>
            `;
            varItem.addEventListener('click', () => {
                inputEl.value = item.variable;
                node.inputs[fieldKey] = item.variable;
                this.closeDropdown();
                this.renderCanvas();
                Toast.info(`已为字段 [${fieldKey}] 填入变量 ${item.variable}`);
            });
            dropdown.appendChild(varItem);
        }

        // 浮层定位计算
        const rect = btn.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        const dropdownWidth = 270;
        const dropdownMaxHeight = 320;

        const left = Math.max(12, rect.right - dropdownWidth);
        dropdown.style.left = `${left}px`;

        if (rect.bottom + dropdownMaxHeight > window.innerHeight && rect.top > dropdownMaxHeight) {
            dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        } else {
            dropdown.style.top = `${rect.bottom + 4}px`;
        }

        document.body.appendChild(dropdown);
        this.activeDropdown = dropdown;

        // 全局点击监听延迟挂载
        setTimeout(() => {
            if (!this.closeDropdownListener && this.activeDropdown) {
                this.closeDropdownListener = (e: MouseEvent) => {
                    if (this.activeDropdown && !this.activeDropdown.contains(e.target as Node) && e.target !== btn) {
                        this.closeDropdown();
                    }
                };
                document.addEventListener('click', this.closeDropdownListener);
            }
        }, 0);
    }

    /**
     * 关闭当前活动的变量选择浮层。
     */
    private closeDropdown(): void {
        if (this.closeDropdownListener) {
            document.removeEventListener('click', this.closeDropdownListener);
            this.closeDropdownListener = null;
        }
        if (this.activeDropdown) {
            this.activeDropdown.remove();
            this.activeDropdown = null;
        }
    }

    /**
     * 基于工作流节点连线与语义分析识别最匹配的宏变量。
     */
    public findRecommendedVariable(
        nodeId: string,
        node: WorkflowNodeData,
        fieldKey: string
    ): (typeof COMFYUI_VARIABLE_DEFINITIONS)[number] | null {
        const keyLower = fieldKey.toLowerCase();
        const classLower = (node.class_type || '').toLowerCase();
        const titleLower = (node._meta?.title || '').toLowerCase();

        // 1. 优先通过连线依赖关系检测正负向提示词
        if (keyLower === 'text' || keyLower === 'positive' || keyLower === 'negative') {
            let isWiredToPositive = false;
            let isWiredToNegative = false;

            for (const targetNode of Object.values(this.workflowData)) {
                const targetClass = (targetNode.class_type || '').toLowerCase();
                if (targetClass.includes('sampler')) {
                    const posInput = targetNode.inputs?.positive;
                    if (Array.isArray(posInput) && String(posInput[0]) === nodeId) {
                        isWiredToPositive = true;
                    }
                    const negInput = targetNode.inputs?.negative;
                    if (Array.isArray(negInput) && String(negInput[0]) === nodeId) {
                        isWiredToNegative = true;
                    }
                }
            }

            if (isWiredToNegative) {
                return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%negative_prompt%') ?? null;
            }
            if (isWiredToPositive) {
                return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%prompt%') ?? null;
            }

            // 若无直接连线引用，检查节点标题或键名特征
            const isNegText = titleLower.includes('neg') || titleLower.includes('负') || keyLower.includes('neg');
            if (isNegText) {
                return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%negative_prompt%') ?? null;
            }
            if (classLower.includes('cliptextencode') || titleLower.includes('prompt') || titleLower.includes('正')) {
                return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%prompt%') ?? null;
            }
        }

        // 2. 字段名精准映射
        for (const def of COMFYUI_VARIABLE_DEFINITIONS) {
            if (def.variable === '%prompt%' || def.variable === '%negative_prompt%') {
                continue;
            }
            if (def.matchKeys.some((k) => k.toLowerCase() === keyLower)) {
                return def;
            }
        }

        // 3. 次级模糊匹配
        if (keyLower.includes('width')) {
            return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%width%') ?? null;
        }
        if (keyLower.includes('height')) {
            return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%height%') ?? null;
        }
        if (keyLower.includes('seed')) {
            return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%seed%') ?? null;
        }
        if (keyLower.includes('step')) {
            return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%steps%') ?? null;
        }
        if (keyLower.includes('cfg')) {
            return COMFYUI_VARIABLE_DEFINITIONS.find((v) => v.variable === '%cfg%') ?? null;
        }

        return null;
    }

    private classifyNode(_nodeId: string, node: WorkflowNodeData): {
        title: string;
        badgeText: string;
        badgeClass: string;
        category: NodeCategory;
        isCore: boolean;
    } {
        const classType = (node.class_type || '').toLowerCase();
        const customTitle = node._meta?.title;

        if (classType.includes('cliptextencode') || classType.includes('prompt')) {
            return {
                title: customTitle || '文本特征编码 (Prompt)',
                badgeText: 'Prompt',
                badgeClass: 'da-blueprint-badge--prompt',
                category: 'PROMPT',
                isCore: true,
            };
        }
        if (classType.includes('ksampler') || classType.includes('sampler')) {
            return {
                title: customTitle || '采样去噪计算 (KSampler)',
                badgeText: 'Sampler',
                badgeClass: 'da-blueprint-badge--sampler',
                category: 'SAMPLER',
                isCore: true,
            };
        }
        if (
            classType.includes('checkpointloader') ||
            classType.includes('loraloader') ||
            classType.includes('vaeloader') ||
            classType.includes('unetloader') ||
            classType.includes('cliploader')
        ) {
            return {
                title: customTitle || '模型载入 (Loader)',
                badgeText: 'Model',
                badgeClass: 'da-blueprint-badge--model',
                category: 'SAMPLER',
                isCore: true,
            };
        }
        if (
            classType.includes('emptylatent') ||
            classType.includes('saveimage') ||
            classType.includes('previewimage')
        ) {
            return {
                title: customTitle || '尺寸与潜空间 (Size/Output)',
                badgeText: 'Output',
                badgeClass: 'da-blueprint-badge--size',
                category: 'SIZE',
                isCore: true,
            };
        }

        return {
            title: customTitle || node.class_type,
            badgeText: 'Generic',
            badgeClass: 'da-blueprint-badge--generic',
            category: 'ALL',
            isCore: false,
        };
    }

    private bindEvents(): void {
        this.unbindEvents();
        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (this.activeDropdown) {
                    e.stopPropagation();
                    this.closeDropdown();
                    return;
                }
                if (this.isOpenState) {
                    e.stopPropagation();
                    this.close();
                }
            }
        };
        window.addEventListener('keydown', this.keydownHandler, true);
    }

    private unbindEvents(): void {
        if (this.keydownHandler) {
            window.removeEventListener('keydown', this.keydownHandler, true);
            this.keydownHandler = null;
        }
    }
}

let globalBlueprintModalInstance: BlueprintModal | null = null;

/**
 * 弹出 ComfyUI 蓝图可视化节点编辑器模态弹窗单例函数。
 *
 * @param workflowJsonStr 工作流 JSON 文本
 * @param onSave 保存回调
 */
export function openBlueprintModal(
    workflowJsonStr: string,
    onSave?: BlueprintSaveCallback
): boolean {
    if (!globalBlueprintModalInstance) {
        globalBlueprintModalInstance = new BlueprintModal();
    }
    return globalBlueprintModalInstance.open(workflowJsonStr, onSave);
}
