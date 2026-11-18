/**
 * 生图服务选项卡共享布局骨架组件 (ProviderTabLayout)。
 *
 * @remarks
 * 为 ComfyUI、SD-WebUI、NovelAI、OpenAI 兼容服务视图提供统一的声明式 JSX 结构：
 * 1. 顶部服务连接与连通性检测卡片 (ConnectionCardView)；
 * 2. 中部由各提供商声明式注入的生图配置大卡片 (children，内含置顶预设工具栏、模型、尺寸与采样)；
 * 3. 底部按需挂载的工作流管理器 (WorkflowCardView) 与提示词预设卡片 (PromptPresetCardView)。
 */

import type { ComponentChildren, VNode } from 'preact';
import type { ProviderPreset } from '../composite/connection-card';
import {
    PreactSettingsView,
    ConnectionCardView,
    PromptPresetCardView,
    WorkflowCardView,
} from '../framework';
import { openBlueprintModal } from '../modal/blueprint-modal';
import type { ProviderTabViewModel } from '../viewmodels/provider-tab-vm';

/**
 * 生图服务选项卡公共视图基类。
 * 统一封装 ProviderTabViewModel 的激活、切出、未保存草稿校验与销毁生命周期。
 */
export abstract class ProviderTabView extends PreactSettingsView {
    public abstract readonly vm: ProviderTabViewModel;

    public override activate(): void {
        super.activate();
        this.vm.activate();
    }

    public override deactivate(): void {
        super.deactivate();
        this.vm.deactivate();
    }

    public hasUnsavedChanges(): boolean {
        return this.vm.hasUnsavedChanges();
    }

    public saveUnsavedChanges(): Promise<boolean> {
        return this.vm.saveUnsavedChanges();
    }

    public discardUnsavedChanges(): void {
        this.vm.discardUnsavedChanges();
    }

    public override dispose(): void {
        this.vm.dispose();
        super.dispose();
    }
}

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
    /** 服务商下拉的字段标签 */
    presetLabel?: string;
    /** 服务商下拉的悬浮说明 */
    presetTooltip?: string;
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
    const activePromptId = draft.promptPresetId || '';

    const workflowPresets = vm.workflowCardPresets.value;
    const activeWorkflowId = draft.txt2imgWorkflowId || '';

    return (
        <>
            <ConnectionCardView
                title={props.connectionTitle}
                subtitle={props.connectionSubtitle}
                urlPlaceholder={props.urlPlaceholder}
                showApiKey={props.showApiKey}
                providerPresets={props.providerPresets}
                presetLabel={props.presetLabel}
                presetTooltip={props.presetTooltip}
                onPresetChange={
                    vm.hasServiceProfiles ? (presetId) => vm.switchService(presetId) : undefined
                }
                data={vm.connectionData.value}
                onChange={(data) => vm.updateConnection(data)}
                onTestPing={(_url, _key, signal) => vm.testPing(signal)}
                onFetchAssets={
                    vm.supportsAssetSync
                        ? (_url, _key, signal) =>
                              vm.refreshServerAssets(false, { skipHealthCheck: true, signal })
                        : undefined
                }
            />

            {props.children}

            {props.showWorkflowManager && (
                <WorkflowCardView
                    presets={workflowPresets}
                    activePresetId={activeWorkflowId}
                    onInstanceChange={(inst) => vm.registerWorkflowCard(inst)}
                    onAction={(action, wfId, data) =>
                        vm.handleWorkflowAssetAction(action, wfId, data)
                    }
                    onImportFile={(file) => vm.handleWorkflowImportFile(file)}
                    onOpenBlueprint={(currentJson, resolvedWorkflowId) => {
                        const targetWorkflowId =
                            resolvedWorkflowId || activeWorkflowId || workflowPresets[0]?.id || '';
                        openBlueprintModal(currentJson, (updatedJson) => {
                            if (!targetWorkflowId) {
                                void vm.handleWorkflowAssetAction('saveAs', '', {
                                    json: updatedJson,
                                });
                            } else {
                                void vm.handleWorkflowAssetAction('save', targetWorkflowId, {
                                    json: updatedJson,
                                });
                            }
                        });
                    }}
                />
            )}

            <PromptPresetCardView
                presets={promptPresets}
                activePresetId={activePromptId}
                onInstanceChange={(inst) => vm.registerPromptCard(inst)}
                showLora={props.showLoraInPromptManager !== false}
                showNegativePrompt={props.showNegativeInPromptManager !== false}
                mode={vm.provider === 'comfyui' ? 'weilin' : 'standard'}
                availableModels={vm.serverLoras.value}
                onAction={(action, pId, data) => vm.handlePromptAssetAction(action, pId, data)}
                onImportFile={(file) => vm.handlePromptImportFile(file)}
            />
        </>
    );
}
