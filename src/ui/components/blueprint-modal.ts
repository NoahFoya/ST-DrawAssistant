/**
 * @module ui/components/blueprint-modal
 * @description ComfyUI 工作流蓝图可视化查看与编辑模态框
 */

export interface WorkflowNodeData {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
}

export type WorkflowJsonObj = Record<string, WorkflowNodeData>;

/**
 * 打开 ComfyUI 工作流蓝图可视化查看与编辑弹窗
 *
 * @param workflowJsonStr 工作流 JSON 字符串
 * @param onSaveCallback 保存修改后的工作流回调函数
 * @param targetType 生图模式 ('txt2img' | 'inpaint')
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
    } catch {
        alert('当前工作流 JSON 存在语法错误，无法启动蓝图可视化编辑器！');
        return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root';
    backdrop.style.zIndex = '100050';
    backdrop.style.display = 'flex';
    backdrop.style.justifyContent = 'center';
    backdrop.style.alignItems = 'center';

    const modalInner = document.createElement('div');
    modalInner.className = 'da-settings-panel da-blueprint-container st-da-root';
    modalInner.style.width = '94%';
    modalInner.style.maxWidth = '1180px';
    modalInner.style.height = '88vh';
    modalInner.style.maxHeight = '880px';
    modalInner.style.display = 'flex';
    modalInner.style.flexDirection = 'column';
    modalInner.style.background = 'var(--da-bg-primary)';
    modalInner.style.borderRadius = '12px';
    modalInner.style.boxShadow = '0 12px 48px rgba(0,0,0,0.7)';
    modalInner.style.overflow = 'hidden';
    modalInner.addEventListener('click', (e) => e.stopPropagation());

    // 1. 顶栏
    const header = document.createElement('div');
    header.className = 'da-header-bar da-blueprint-header';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '12px 20px';
    header.style.borderBottom = '1px solid var(--da-border-color)';

    const titleSt = document.createElement('span');
    titleSt.style.fontWeight = 'bold';
    titleSt.style.fontSize = '1.1em';
    titleSt.style.color = 'var(--da-text-primary)';
    titleSt.textContent = targetType === 'inpaint' ? 'ComfyUI 局部重绘工作流蓝图编辑器' : 'ComfyUI 文生图工作流蓝图编辑器';

    const rightBtnGroup = document.createElement('div');
    rightBtnGroup.style.display = 'flex';
    rightBtnGroup.style.alignItems = 'center';
    rightBtnGroup.style.gap = '8px';

    if (onSaveCallback) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'da-btn primary';
        saveBtn.style.padding = '4px 12px';
        saveBtn.textContent = '💾 保存蓝图';
        saveBtn.onclick = () => {
            onSaveCallback(JSON.stringify(parsed, null, 2));
            backdrop.remove();
            alert('已成功保存并同步工作流蓝图！');
        };
        rightBtnGroup.appendChild(saveBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'da-close-red-dot';
    closeBtn.title = '关闭';
    closeBtn.onclick = () => backdrop.remove();
    rightBtnGroup.appendChild(closeBtn);

    header.appendChild(titleSt);
    header.appendChild(rightBtnGroup);
    modalInner.appendChild(header);

    // 2. 节点视图区域
    const body = document.createElement('div');
    body.style.flex = '1';
    body.style.display = 'flex';
    body.style.overflow = 'hidden';

    // 左侧节点列表
    const leftList = document.createElement('div');
    leftList.style.width = '320px';
    leftList.style.borderRight = '1px solid var(--da-border-color)';
    leftList.style.overflowY = 'auto';
    leftList.style.padding = '12px';

    // 右侧节点参数详情
    const rightDetail = document.createElement('div');
    rightDetail.style.flex = '1';
    rightDetail.style.overflowY = 'auto';
    rightDetail.style.padding = '20px';

    const renderNodeDetail = (nodeId: string, node: WorkflowNodeData) => {
        rightDetail.innerHTML = '';
        const title = document.createElement('h3');
        title.style.margin = '0 0 12px 0';
        title.style.color = 'var(--da-accent-color)';
        title.textContent = `节点 #${nodeId} : ${node._meta?.title || node.class_type}`;
        rightDetail.appendChild(title);

        const typeTag = document.createElement('div');
        typeTag.style.fontSize = '0.85em';
        typeTag.style.color = 'var(--da-text-secondary)';
        typeTag.style.marginBottom = '16px';
        typeTag.textContent = `类型 (class_type): ${node.class_type}`;
        rightDetail.appendChild(typeTag);

        const inputList = document.createElement('div');
        inputList.style.display = 'flex';
        inputList.style.flexDirection = 'column';
        inputList.style.gap = '10px';

        for (const [k, v] of Object.entries(node.inputs || {})) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '8px 12px';
            row.style.background = 'var(--da-bg-secondary)';
            row.style.borderRadius = '6px';

            const keySpan = document.createElement('span');
            keySpan.style.fontWeight = '500';
            keySpan.textContent = k;

            const valSpan = document.createElement('span');
            valSpan.style.color = 'var(--da-text-secondary)';
            valSpan.textContent = Array.isArray(v) ? `[连接 -> 节点 #${v[0]}.${v[1]}]` : String(v);

            row.appendChild(keySpan);
            row.appendChild(valSpan);
            inputList.appendChild(row);
        }

        rightDetail.appendChild(inputList);
    };

    const nodeEntries = Object.entries(parsed);
    nodeEntries.forEach(([nodeId, node]) => {
        const item = document.createElement('div');
        item.style.padding = '10px 12px';
        item.style.marginBottom = '6px';
        item.style.borderRadius = '6px';
        item.style.background = 'var(--da-bg-secondary)';
        item.style.cursor = 'pointer';
        item.style.border = '1px solid transparent';
        item.innerHTML = `
            <div style="font-weight:600; font-size:0.9em; color:var(--da-text-primary);">#${nodeId} ${node._meta?.title || node.class_type}</div>
            <div style="font-size:0.8em; color:var(--da-text-secondary);">${node.class_type}</div>
        `;

        item.onclick = () => {
            leftList.querySelectorAll('div').forEach((d) => (d.style.borderColor = 'transparent'));
            item.style.borderColor = 'var(--da-accent-color)';
            renderNodeDetail(nodeId, node);
        };

        leftList.appendChild(item);
    });

    if (nodeEntries.length > 0) {
        renderNodeDetail(nodeEntries[0][0], nodeEntries[0][1]);
    }

    body.appendChild(leftList);
    body.appendChild(rightDetail);
    modalInner.appendChild(body);

    backdrop.appendChild(modalInner);
    document.body.appendChild(backdrop);
}
