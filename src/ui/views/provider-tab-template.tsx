/**
 * 绘图服务选项卡共享布局骨架组件 (ProviderTabLayout)。
 *
 * @remarks
 * 为 ComfyUI、SD-WebUI、NovelAI、OpenAI 兼容服务视图提供统一的声明式 JSX 结构：
 * 1. 顶部服务连接与连通性探测卡片 (ConnectionCardView)；
 * 2. 绘画参数预设方案主控工具栏 (PresetToolbarView)；
 * 3. 中部由各提供商声明式注入的模型、尺寸、采样与专属特性卡片 (children)；
 * 4. 底部按需挂载的工作流管理器 (WorkflowCardView) 与提示词预设管理器 (PromptPresetManagerView)。
 */

import type { ComponentChildren, VNode } from 'preact';
import type { ProviderPreset } from '../composite/connection-card';
import {
    ConnectionCardView,
    PresetToolbarView,
    PromptPresetManagerView,
    WorkflowCardView,
} from '../framework/composite-views';
import type { ProviderTabViewModel } from '../viewmodels/provider-tab-vm';

export interface ProviderTabLayoutProps {
    /** 视图绑定的提供商状态模型 */
    vm: ProviderTabViewModel;
    /** 连接卡片标题 */
    connectionTitle?: string;
    /** 连接卡片副标题 */
    connectionSubtitle?: string;
    /** 连接地址输入框占位提示 */
    urlPlaceholder?: string;
    /** 是否显示 API Key 鉴权输入框 */
    showApiKey?: boolean;
    /** 服务商端点预设列表（如 OpenAI / SiliconFlow） */
    providerPresets?: ProviderPreset[];
    /** 是否在底部渲染 ComfyUI 工作流管理器卡片 */
    showWorkflowManager?: boolean;
    /** 提示词管理器是否展示 LoRA 挂载区域，默认 true */
    showLoraInPromptManager?: boolean;
    /** 提示词管理器是否展示负向提示词输入框，默认 true */
    showNegativeInPromptManager?: boolean;
    /** 中部专属参数卡片子节点 */
    children?: ComponentChildren;
}

export function ProviderTabLayout(props: ProviderTabLayoutProps): VNode {
    const { vm } = props;
    const draft = vm.presetController.draftConfig.value;
    const promptPresets = vm.promptCardPresets.value;
    const activePromptId = draft.promptPresetId || promptPresets[0]?.id || '';

    const workflowPresets = vm.workflowCardPresets.value;
    const activeWorkflowId = draft.txt2imgWorkflowId || workflowPresets[0]?.id || '';

    return (
        <>
            <ConnectionCardView
                title={props.connectionTitle}
                subtitle={props.connectionSubtitle}
                urlPlaceholder={props.urlPlaceholder}
                showApiKey={props.showApiKey}
                providerPresets={props.providerPresets}
                data={vm.connectionData.value}
                onChange={(data) => vm.updateConnection(data)}
                onTestPing={() => vm.testPing()}
                onFetchAssets={() => vm.refreshServerAssets()}
            />

            <PresetToolbarView
                presets={vm.presetController.toolbarItems.value}
                activePresetId={vm.presetController.activePresetId.value}
                dirty={vm.presetController.isDirty.value}
                onAction={(action, id) => vm.presetController.handleAction(action, id)}
                onImportFile={(file) => vm.presetController.handleImportFile(file)}
            />

            {props.children}

            {props.showWorkflowManager && (
                <WorkflowCardView
                    presets={workflowPresets}
                    activePresetId={activeWorkflowId}
                    defaultCollapsed={true}
                    onAction={(action, wfId, data) =>
                        vm.handleWorkflowAssetAction(action, wfId, data)
                    }
                />
            )}

            <PromptPresetManagerView
                presets={promptPresets}
                activePresetId={activePromptId}
                showLora={props.showLoraInPromptManager !== false}
                showNegativePrompt={props.showNegativeInPromptManager !== false}
                mode="standard"
                defaultCollapsed={true}
                onAction={(action, pId, data) => vm.handlePromptAssetAction(action, pId, data)}
            />
        </>
    );
}
