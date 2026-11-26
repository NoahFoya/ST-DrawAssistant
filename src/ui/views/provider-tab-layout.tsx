/**
 * 生图服务选项卡共享布局骨架组件 (ProviderTabLayout)。
 *
 * @remarks
 * 为 ComfyUI、SD-WebUI、NovelAI、OpenAI 兼容、Google Gemini 与 xAI Grok 服务视图提供统一的声明式 JSX 结构：
 * 1. 顶部服务连接与连通性检测卡片 (ConnectionCardView)；
 * 2. 中部由各提供商声明式注入的生图配置大卡片 (children，内含置顶预设工具栏、模型、尺寸与采样)；
 * 3. 底部按需挂载的工作流管理器 (WorkflowCardView) 与提示词预设卡片 (PromptPresetCardView)。
 */

import type { ComponentChildren, VNode } from 'preact';
import type { SettingsView } from '../types';
import { ConnectionCard, type ProviderPreset } from '../composite/connection-card';
import { PromptPresetCard } from '../composite/prompt-preset-card';
import { WorkflowCard } from '../composite/workflow-card';
import { createPreactSettingsView, type StatefulSettingsView } from '../framework';
import { openBlueprintModal } from '../modal/blueprint-modal';
import type { ProviderTabState, CustomBodyJsonController } from '../state';

export interface ProviderTabViewOptions {
    id: string;
    title: string;
    className: string;
    vm: ProviderTabState;
    customBodyJson?: CustomBodyJsonController;
    render: () => ComponentChildren;
}

/**
 * 生图服务选项卡共享适配器：统一托管 ProviderTabState 生命周期、未保存校验与可选 CustomBodyJson 校验。
 */
export function createProviderTabView(
    options: ProviderTabViewOptions
): StatefulSettingsView<ProviderTabState> & SettingsView {
    const { vm, customBodyJson } = options;
    return createPreactSettingsView<ProviderTabState>({
        id: options.id,
        title: options.title,
        className: options.className,
        state: vm,
        render: options.render,
        onActivate: () => {
            vm.activate();
            customBodyJson?.syncOnActivate();
        },
        onDeactivate: () => vm.deactivate(),
        onDispose: () => vm.dispose(),
        hasUnsavedChanges: () =>
            vm.hasUnsavedChanges() || Boolean(customBodyJson && !customBodyJson.isValid.value),
        saveUnsavedChanges: async () => {
            if (customBodyJson && !customBodyJson.validateBeforeSave()) {
                return false;
            }
            return await vm.saveUnsavedChanges();
        },
        discardUnsavedChanges: () => {
            vm.discardUnsavedChanges();
            customBodyJson?.syncFromDraft();
        },
    });
}

export interface ProviderTabLayoutProps {
    /** 视图绑定的提供商状态模型 */
    vm: ProviderTabState;
    /** 连接卡片标题 */
    connectionTitle?: string;
    /** 连接卡片副标题 */
    connectionSubtitle?: string;
    /** 连接地址输入框占位提示 */
    urlPlaceholder?: string;
    /** 是否显示 API Key 鉴权输入框 */
    showApiKey?: boolean;
    /** API Key 输入框占位提示 */
    apiKeyPlaceholder?: string;
    /** API Key 输入框悬浮说明 */
    apiKeyTooltip?: string;
    /** 服务商地址预设列表（如 OpenAI / SiliconFlow） */
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
            <ConnectionCard
                providerType={vm.provider}
                title={props.connectionTitle}
                subtitle={props.connectionSubtitle}
                urlPlaceholder={props.urlPlaceholder}
                showApiKey={props.showApiKey}
                apiKeyPlaceholder={props.apiKeyPlaceholder}
                apiKeyTooltip={props.apiKeyTooltip}
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
                <WorkflowCard
                    presets={workflowPresets}
                    activePresetId={activeWorkflowId}
                    value={vm.workflowDraft.value}
                    dirty={vm.isWorkflowDirty.value}
                    onChange={(data) => vm.updateWorkflowDraft(data)}
                    onAction={(action, wfId, data) =>
                        vm.handleWorkflowAssetAction(action, wfId, data)
                    }
                    onImportFiles={(files) => void vm.handleWorkflowImportFiles(files)}
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

            <PromptPresetCard
                presets={promptPresets}
                activePresetId={activePromptId}
                value={vm.promptDraft.value}
                dirty={vm.isPromptDirty.value}
                onChange={(data) => vm.updatePromptDraft(data)}
                showLora={props.showLoraInPromptManager !== false}
                showNegativePrompt={props.showNegativeInPromptManager !== false}
                availableModels={vm.serverLoras.value}
                onAction={(action, pId, data) => vm.handlePromptAssetAction(action, pId, data)}
                onImportFiles={(files) => void vm.handlePromptImportFiles(files)}
            />
        </>
    );
}
