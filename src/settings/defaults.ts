/**
 * 设置默认值
 *
 * 注入配置默认对应 Wai 工作流节点结构：
 *   正向: 节点 "113" WeiLinPromptUI → inputs.positive
 *   负向: 节点 "12"  CLIPTextEncode → inputs.text
 *   宽高: 节点 "119"/"118" PrimitiveInt → inputs.value
 *   采样: 节点 "63"  KSampler → inputs.*
 *   输出: 节点 "99"  SaveImage（用于定位结果图像）
 *
 * 若使用其他工作流，请在设置面板中修改注入节点 ID。
 */

import type { DrawAssistantSettings, WorkflowInjectionConfig } from './types';

const DEFAULT_WORKFLOW_INJECTION: Readonly<WorkflowInjectionConfig> = {
    positiveNodeId: '113',
    positiveField: 'positive',
    negativeNodeId: '12',
    negativeField: 'text',
    widthNodeId: '119',
    widthField: 'value',
    heightNodeId: '118',
    heightField: 'value',
    kSamplerNodeId: '63',
    saveImageNodeId: '99',
} as const;

export const DEFAULT_SETTINGS: Readonly<DrawAssistantSettings> = {
    // 后端配置
    provider: 'comfyui',
    serverUrl: 'http://127.0.0.1:8188',
    apiKey: undefined,

    // Workflow 配置（空字符串代表使用内置默认工作流）
    workflowJson: '',
    workflowInjection: { ...DEFAULT_WORKFLOW_INJECTION },

    // 占位符配置
    placeholderStart: 'image###',
    placeholderEnd: '###',

    // 图像参数默认值（与 Wai 工作流默认参数一致）
    width: 1024,
    height: 1344,
    steps: 18,
    cfgScale: 6,
    samplerName: 'euler_ancestral',
    scheduler: 'normal',

    // 提示词配置
    promptPrefix: '',
    negativePrefix: 'score_1, score_2, score_3, bad anatomy, bad proportions, deformed anatomy, deformed face, deformed eyes, text, multiple fingers, watermark, artist name',

    // 行为配置
    autoGenerate: false,
    maxConcurrent: 1,
    requestTimeout: 120000,
} as const;

