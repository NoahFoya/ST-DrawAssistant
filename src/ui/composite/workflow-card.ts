/**
 * ComfyUI 工作流管理与变量诊断卡片 (WorkflowCard)
 * 展示工作流元数据、节点数与参数变量插桩完整性诊断标签，支持导入与导出。
 */

import { WorkflowCardModel } from './types';
import { createButton, createIconButton, ButtonHandle, IconButtonHandle } from '../components/button';
import { createBadge, BadgeHandle } from '../components/feedback';
import { Toast } from '../components/feedback';

export interface WorkflowCardOptions {
    workflow: WorkflowCardModel;
    onImportJson?: (jsonObj: Record<string, any>) => void;
    onExportJson?: (model: WorkflowCardModel) => void;
    onViewDetail?: (model: WorkflowCardModel) => void;
    className?: string;
}

export interface WorkflowCardHandle {
    readonly element: HTMLElement;
    setWorkflow(data: WorkflowCardModel): void;
    getWorkflow(): WorkflowCardModel;
    dispose(): void;
}

/** 探测工作流 JSON 中是否包含各核心变量占位符 */
export function diagnoseWorkflowVariables(workflowObj: Record<string, any>): WorkflowCardModel['variables'] {
    const rawStr = JSON.stringify(workflowObj || {});
    return {
        prompt: rawStr.includes('%prompt%'),
        negativePrompt: rawStr.includes('%negative_prompt%'),
        seed: rawStr.includes('%seed%'),
        width: rawStr.includes('%width%'),
        height: rawStr.includes('%height%'),
        steps: rawStr.includes('%steps%'),
        cfg: rawStr.includes('%cfg%'),
        sampler: rawStr.includes('%sampler_name%'),
        scheduler: rawStr.includes('%scheduler%'),
        modelName: rawStr.includes('%model_name%')
    };
}

export function createWorkflowCard(options: WorkflowCardOptions): WorkflowCardHandle {
    const card = document.createElement('div');
    card.className = 'da-workflow-card da-card';
    if (options.className) card.classList.add(options.className);

    let currentWorkflow: WorkflowCardModel = { ...options.workflow };

    // 1. 顶部标题与元数据行
    const header = document.createElement('div');
    header.className = 'da-workflow-card__header';

    const infoBox = document.createElement('div');
    infoBox.className = 'da-workflow-card__info';

    const titleEl = document.createElement('div');
    titleEl.className = 'da-workflow-card__title';
    titleEl.textContent = currentWorkflow.title || '自定义工作流';

    const descEl = document.createElement('div');
    descEl.className = 'da-workflow-card__desc';
    descEl.textContent = currentWorkflow.description || 'ComfyUI 运算流程节点图';

    infoBox.appendChild(titleEl);
    infoBox.appendChild(descEl);

    // 节点统计徽标
    const nodeBadge: BadgeHandle = createBadge({
        text: `${currentWorkflow.nodesCount ?? Object.keys(currentWorkflow.rawJson || {}).length} 个节点`,
        variant: 'info'
    });

    header.appendChild(infoBox);
    header.appendChild(nodeBadge.element);
    card.appendChild(header);

    // 2. 变量插桩诊断标签组
    const varsContainer = document.createElement('div');
    varsContainer.className = 'da-workflow-card__vars';

    const renderVars = () => {
        varsContainer.innerHTML = '';
        const vars = currentWorkflow.variables || diagnoseWorkflowVariables(currentWorkflow.rawJson || {});

        const varList: { key: keyof typeof vars; label: string }[] = [
            { key: 'prompt', label: '正向词' },
            { key: 'negativePrompt', label: '负向词' },
            { key: 'modelName', label: '模型' },
            { key: 'seed', label: '种子' },
            { key: 'width', label: '宽度' },
            { key: 'height', label: '高度' },
            { key: 'steps', label: '步数' },
            { key: 'cfg', label: 'CFG' },
            { key: 'sampler', label: '采样器' },
            { key: 'scheduler', label: '调度器' }
        ];

        for (const v of varList) {
            const hasVar = vars[v.key];
            const chip = document.createElement('span');
            chip.className = `da-macro-tag ${hasVar ? 'is-valid' : 'da-macro-tag--warning is-warning'}`;
            chip.textContent = `${v.label} ${hasVar ? '✓' : '✗'}`;
            chip.title = hasVar ? `工作流已支持 %${String(v.key)}% 变量动态注入` : `未检测到占位符，该参数将无法由插件动态控制`;
            varsContainer.appendChild(chip);
        }
    };

    renderVars();
    card.appendChild(varsContainer);

    // 3. 底部操作栏
    const footer = document.createElement('div');
    footer.className = 'da-workflow-card__footer';

    // 隐藏的 JSON 导入 input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(reader.result as string);
                    currentWorkflow.rawJson = parsed;
                    currentWorkflow.nodesCount = Object.keys(parsed).length;
                    currentWorkflow.variables = diagnoseWorkflowVariables(parsed);
                    nodeBadge.setText(`${currentWorkflow.nodesCount} 个节点`);
                    renderVars();
                    options.onImportJson?.(parsed);
                    Toast.success('工作流 JSON 导入成功');
                } catch {
                    Toast.error('工作流文件不是合法的 JSON 格式');
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        }
    });

    const importBtn: ButtonHandle = createButton({
        text: '导入 JSON',
        variant: 'secondary',
        size: 'sm',
        icon: 'refresh',
        onClick: () => fileInput.click()
    });

    const exportBtn: ButtonHandle = createButton({
        text: '导出 JSON',
        variant: 'secondary',
        size: 'sm',
        icon: 'external',
        onClick: () => {
            if (options.onExportJson) {
                options.onExportJson(currentWorkflow);
            } else if (currentWorkflow.rawJson) {
                const blob = new Blob([JSON.stringify(currentWorkflow.rawJson, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${currentWorkflow.id || 'workflow'}.json`;
                a.click();
                URL.revokeObjectURL(url);
                Toast.success('工作流已下载');
            }
        }
    });

    const viewBtn: IconButtonHandle = createIconButton({
        icon: 'eye',
        title: '查看详细 JSON 节点结构',
        onClick: () => {
            options.onViewDetail?.(currentWorkflow);
        }
    });

    footer.appendChild(importBtn.element);
    footer.appendChild(exportBtn.element);
    footer.appendChild(viewBtn.element);
    footer.appendChild(fileInput);
    card.appendChild(footer);

    return {
        element: card,
        setWorkflow(data: WorkflowCardModel): void {
            currentWorkflow = { ...data };
            titleEl.textContent = currentWorkflow.title || '自定义工作流';
            descEl.textContent = currentWorkflow.description || 'ComfyUI 运算流程节点图';
            nodeBadge.setText(`${currentWorkflow.nodesCount ?? Object.keys(currentWorkflow.rawJson || {}).length} 个节点`);
            renderVars();
        },
        getWorkflow(): WorkflowCardModel {
            return { ...currentWorkflow };
        },
        dispose(): void {
            importBtn.dispose();
            exportBtn.dispose();
            viewBtn.dispose();
            card.remove();
        }
    };
}
