/**
 * @module core/variables
 * @description 可配置模型与生图参数变量注册表
 *
 * 职责：
 * - 定义工作流 JSON 模板中占位符变量 (如 %prompt%, %ckpt_name%) 的常量元数据
 * - 提供可视化蓝图编辑器与模板替换引擎的变量选择基准
 */


export interface ParameterVariable {
    key: string;
    name: string;
    category: 'prompt' | 'model' | 'sampler' | 'resolution' | 'other';
    type: 'string' | 'number';
    description: string;
}

export const PARAMETER_VARIABLES: ParameterVariable[] = [
    {
        key: '%prompt%',
        name: '正向提示词',
        category: 'prompt',
        type: 'string',
        description: '自动包含模型起手式、全局前缀、AI提取提示词及后缀与LORA',
    },
    {
        key: '%negative_prompt%',
        name: '负向提示词',
        category: 'prompt',
        type: 'string',
        description: '自动包含模型负向起手式、全局负向词及当次负向词',
    },
    {
        key: '%ckpt_name%',
        name: 'Checkpoint/UNet 主模型',
        category: 'model',
        type: 'string',
        description: '选中的 Checkpoint / UNet 模型文件名',
    },
    {
        key: '%clip_name%',
        name: 'CLIP 模型',
        category: 'model',
        type: 'string',
        description: '选中的 CLIP 模型文件名',
    },
    {
        key: '%vae_name%',
        name: 'VAE 模型',
        category: 'model',
        type: 'string',
        description: '选中的 VAE 模型文件名',
    },
    {
        key: '%width%',
        name: '图像宽度 (Width)',
        category: 'resolution',
        type: 'number',
        description: '生成图像像素宽度',
    },
    {
        key: '%height%',
        name: '图像高度 (Height)',
        category: 'resolution',
        type: 'number',
        description: '生成图像像素高度',
    },
    {
        key: '%steps%',
        name: '采样步数 (Steps)',
        category: 'sampler',
        type: 'number',
        description: 'KSampler 采样迭代步数',
    },
    {
        key: '%cfg%',
        name: 'CFG Scale',
        category: 'sampler',
        type: 'number',
        description: '提示词引导强度 (CFG)',
    },
    {
        key: '%sampler_name%',
        name: '采样器算法 (Sampler)',
        category: 'sampler',
        type: 'string',
        description: '采样算法名称 (如 euler_ancestral)',
    },
    {
        key: '%scheduler%',
        name: '调度器算法 (Scheduler)',
        category: 'sampler',
        type: 'string',
        description: '调度算法名称 (如 normal)',
    },
    {
        key: '%seed%',
        name: '随机种子 (Seed)',
        category: 'sampler',
        type: 'number',
        description: '随机 Seed 整数 (-1 自动替换为随机大数)',
    },
    {
        key: '%denoise%',
        name: '重噪系数 (Denoise)',
        category: 'sampler',
        type: 'number',
        description: '局部重绘/图生图 Denoise 强度 (如 1.0)',
    },
];
