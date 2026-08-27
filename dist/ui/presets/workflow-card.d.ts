/**
 * @module ui/presets/workflow-card
 * @description 标准化工作流预设卡片控件与宏变量诊断工具 (Workflow & Preset Domain)
 */
import { PresetProfileItem, WorkflowProfileData } from '../../core/state/store-types';
import { InputControlHandle } from '../controls';
import { PresetToolbarElement } from './preset-manager';
export interface VariableReplacementInfo {
    variable: string;
    nodeId: string;
    classType: string;
    field: string;
    prevValue: unknown;
}
export interface UnmatchedVariableInfo {
    variable: string;
    label: string;
    tip: string;
}
export interface WorkflowAnalysisResult {
    success: boolean;
    error?: string;
    formattedJson: string;
    replaced: VariableReplacementInfo[];
    unmatched: UnmatchedVariableInfo[];
}
/**
 * 递归深度扫描并分析 ComfyUI 工作流 JSON，自动匹配替换标准宏变量占位符
 */
export declare function analyzeAndReplaceWorkflowVariables(jsonStr: string): WorkflowAnalysisResult;
/**
 * 弹出工作流变量诊断与格式化模态框
 */
export declare function openWorkflowFormatModal(rawJson: string, onApply: (formattedJson: string) => void): void;
/**
 * 工作流预设卡片配置项
 */
export interface WorkflowPresetCardOptions {
    title: string;
    description: string;
    label: string;
    blueprintMode: 'txt2img' | 'inpaint';
    fieldLabel: string;
    helpTooltip: string;
    placeholder?: string;
    getProfiles: () => PresetProfileItem<WorkflowProfileData>[];
    getCurrentProfileId: () => string;
    getCurrentJson: () => string;
    onProfilesChange: (profiles: PresetProfileItem<WorkflowProfileData>[], activeId: string) => void;
    onJsonChange: (json: string) => void;
    fetchDefaults: () => Promise<PresetProfileItem<WorkflowProfileData>[]>;
    onRefresh: () => void;
}
export interface WorkflowPresetCardHandle extends HTMLElement {
    readonly toolbar: PresetToolbarElement;
    readonly inputHandle: InputControlHandle;
    refresh: () => void;
}
/**
 * 创建标准化工作流预设卡片控件
 */
export declare function createWorkflowPresetCard(options: WorkflowPresetCardOptions): WorkflowPresetCardHandle;
//# sourceMappingURL=workflow-card.d.ts.map