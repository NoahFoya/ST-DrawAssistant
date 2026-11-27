/**
 * ComfyUI 原生工作流 LoRA 节点动态拼接与连线注入工具。
 *
 * @remarks
 * ComfyUI 原生节点体系（CLIPTextEncode 等）不解析文本中的 `<lora:...>` 或 `<wlr:...>` 标签。
 * 本模块在非 WeiLin 工作流提交前，自动追踪主模型 (`MODEL`) 与文本编码器 (`CLIP`) 上游根输出端，
 * 按需动态串联内置 `LoraLoader` / `LoraLoaderModelOnly` 节点并安全重连原有下游引用，
 * 同时保留工作流既有的静态 LoRA 节点与 `VAE` 独立输出端连线。
 */

import type { ResolvedLoraSpec } from '@types';
export { hasWeilinNodeInGraph } from '../../domain/provider-specs/comfyui-workflow';

/** ComfyUI API 节点连线引用 `[nodeId, outputSlot]` */
export type ComfyNodeLink = [string, number];

/** 模板占位符注入前采集的提示词节点坐标提示 */
export interface WorkflowAnchorHints {
    readonly positivePromptNodeIds: Set<string>;
    readonly negativePromptNodeIds: Set<string>;
}

/** 原生 LoRA 节点图注入可选项 */
export interface NativeLoraInjectionOptions {
    /** 模板变量替换前采集的正/负向提示词节点 ID 提示 */
    readonly anchorHints?: WorkflowAnchorHints;
    /** 服务端 `/object_info` 是否暴露 `LoraLoader` 节点（未传时默认视为支持） */
    readonly supportsLoraLoader?: boolean;
    /** 服务端 `/object_info` 是否暴露 `LoraLoaderModelOnly` 节点（未传时默认视为支持） */
    readonly supportsLoraLoaderModelOnly?: boolean;
}

interface RawComfyNode {
    class_type?: unknown;
    _meta?: { title?: unknown };
    inputs?: Record<string, unknown>;
    [key: string]: unknown;
}

const KNOWN_MODEL_LOADER_CLASSES = new Set([
    'checkpointloadersimple',
    'checkpointloader',
    'checkpointloadernf4',
    'unetloader',
    'unetloadergguf',
    'unetloadermodelonly',
    'diffusionmodelloader',
    'diffusionmodelloaderkj',
]);

const KNOWN_CLIP_ENCODER_CLASSES = new Set([
    'cliptextencode',
    'cliptextencodesdxl',
    'cliptextencodesdxlrefiner',
    'cliptextencodeflux',
    'cliptextencodesd3',
    'textencodeqwenimageedit',
    'textencodeqwenimageeditplus',
]);

const KNOWN_SAMPLER_OR_GUIDER_CLASSES = new Set([
    'ksampler',
    'ksampleradvanced',
    'samplercustom',
    'samplercustomadvanced',
    'basicguider',
    'cfgguider',
    'dualcfgguider',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeLink(value: unknown): value is [string | number, number] {
    return (
        Array.isArray(value) &&
        value.length >= 2 &&
        (typeof value[0] === 'string' || typeof value[0] === 'number') &&
        typeof value[1] === 'number' &&
        Number.isFinite(value[1])
    );
}

function toNodeLink(value: [string | number, number]): ComfyNodeLink {
    return [String(value[0]), value[1]];
}

function getNodeClassType(node: unknown): string {
    return isPlainRecord(node) && typeof node.class_type === 'string' ? node.class_type.trim() : '';
}

function isNunchakuLoaderClass(classType: string): boolean {
    return /^nunchaku/i.test(classType);
}

function linksEqual(a: ComfyNodeLink, b: ComfyNodeLink): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

function serializeLink(link: ComfyNodeLink): string {
    return `${link[0]}#${link[1]}`;
}

/**
 * 在模板变量替换之前扫描工作流中引用 `%prompt%` / `%negative_prompt%` 的节点 ID，
 * 用于在多模型工作流（如 Base + Refiner）中准确锁定主生成链路。
 */
export function collectWorkflowAnchorHints(
    rawWorkflow: Record<string, unknown> | undefined | null
): WorkflowAnchorHints {
    const positivePromptNodeIds = new Set<string>();
    const negativePromptNodeIds = new Set<string>();

    if (!rawWorkflow || typeof rawWorkflow !== 'object') {
        return { positivePromptNodeIds, negativePromptNodeIds };
    }

    const inspectValue = (val: unknown, nodeId: string): void => {
        if (typeof val === 'string') {
            if (val.includes('%prompt%')) positivePromptNodeIds.add(nodeId);
            if (val.includes('%negative_prompt%')) negativePromptNodeIds.add(nodeId);
            return;
        }
        if (Array.isArray(val) && !isNodeLink(val)) {
            for (const item of val) {
                inspectValue(item, nodeId);
            }
            return;
        }
        if (isPlainRecord(val)) {
            for (const sub of Object.values(val)) {
                inspectValue(sub, nodeId);
            }
        }
    };

    for (const [nodeId, rawNode] of Object.entries(rawWorkflow)) {
        if (!isPlainRecord(rawNode) || !isPlainRecord(rawNode.inputs)) {
            continue;
        }
        inspectValue(rawNode.inputs, nodeId);
    }

    return { positivePromptNodeIds, negativePromptNodeIds };
}

/**
 * 沿指定输入端口（如 `'model'` 或 `'clip'`）从消费端向上逆向追踪至无同端口输入的源节点输出引用。
 */
function traceRootAnchorForInput(
    workflow: Record<string, RawComfyNode>,
    startNodeId: string,
    inputKey: 'model' | 'clip'
): ComfyNodeLink | null {
    let currentId: string | null = startNodeId;
    let lastLink: ComfyNodeLink | null = null;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const node = workflow[currentId];
        const rawInput = isPlainRecord(node?.inputs) ? node.inputs[inputKey] : undefined;
        if (!isNodeLink(rawInput)) {
            return lastLink;
        }
        const upstream = toNodeLink(rawInput);
        lastLink = upstream;
        currentId = upstream[0];
    }

    return lastLink;
}

/** 构建“节点 ID -> 下游直接引用该节点的节点 ID 列表”正向邻接表（可排除 Latent/样本边以免跨阶段串入 Refiner） */
function buildDownstreamAdjacency(
    workflow: Record<string, RawComfyNode>,
    conditioningOnly = false
): Map<string, Set<string>> {
    const downstream = new Map<string, Set<string>>();
    for (const [nodeId, rawNode] of Object.entries(workflow)) {
        if (!isPlainRecord(rawNode?.inputs)) {
            continue;
        }
        for (const [field, val] of Object.entries(rawNode.inputs)) {
            if (conditioningOnly && /^(?:latent|latent_image|samples|image|images|pixels|vae)$/i.test(field)) {
                continue;
            }
            if (!isNodeLink(val)) {
                continue;
            }
            const sourceId = String(val[0]);
            let targets = downstream.get(sourceId);
            if (!targets) {
                targets = new Set<string>();
                downstream.set(sourceId, targets);
            }
            targets.add(nodeId);
        }
    }
    return downstream;
}

/** 判断节点是否属于采样器或引导器等模型消费节点 */
function isModelConsumerNode(node: RawComfyNode): boolean {
    const classLower = getNodeClassType(node).toLowerCase();
    const inputs = isPlainRecord(node.inputs) ? node.inputs : undefined;
    if (!inputs) {
        return false;
    }
    if (KNOWN_SAMPLER_OR_GUIDER_CLASSES.has(classLower)) {
        return isNodeLink(inputs.model);
    }
    return (
        isNodeLink(inputs.model) &&
        (isNodeLink(inputs.positive) || isNodeLink(inputs.conditioning) || isNodeLink(inputs.latent_image))
    );
}

/** 从指定起始节点顺连线 BFS 收集所有可达的下游节点 ID */
function collectReachableNodeIds(
    seeds: Iterable<string>,
    downstream: Map<string, Set<string>>
): Set<string> {
    const visited = new Set<string>();
    const queue = Array.from(seeds);
    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const nextSet = downstream.get(cur);
        if (nextSet) {
            for (const nextId of nextSet) {
                if (!visited.has(nextId)) {
                    queue.push(nextId);
                }
            }
        }
    }
    return visited;
}

/** 唯一化连线列表 */
function dedupeLinks(links: readonly ComfyNodeLink[]): ComfyNodeLink[] {
    const map = new Map<string, ComfyNodeLink>();
    for (const link of links) {
        map.set(serializeLink(link), link);
    }
    return Array.from(map.values());
}

/** 解析工作流中要接入动态 LoRA 的主 `MODEL` 源输出端 `[nodeId, slot]` */
function resolveModelAnchor(
    workflow: Record<string, RawComfyNode>,
    downstream: Map<string, Set<string>>,
    hints?: WorkflowAnchorHints
): ComfyNodeLink {
    const allConsumerIds = Object.entries(workflow)
        .filter(([, node]) => isModelConsumerNode(node))
        .map(([nodeId]) => nodeId);

    // 优先聚焦从正向提示词节点下游可达的主采样/引导链（兼容 Base + Refiner 双模型图）
    let candidateConsumerIds = allConsumerIds;
    if (hints && hints.positivePromptNodeIds.size > 0 && allConsumerIds.length > 1) {
        const reachableFromPrompt = collectReachableNodeIds(hints.positivePromptNodeIds, downstream);
        const promptReachableConsumers = allConsumerIds.filter((id) => reachableFromPrompt.has(id));
        if (promptReachableConsumers.length > 0) {
            candidateConsumerIds = promptReachableConsumers;
        }
    }

    const tracedModelAnchors = dedupeLinks(
        candidateConsumerIds
            .map((id) => traceRootAnchorForInput(workflow, id, 'model'))
            .filter((link): link is ComfyNodeLink => link !== null)
    );

    if (tracedModelAnchors.length === 1) {
        return tracedModelAnchors[0];
    }

    if (tracedModelAnchors.length > 1) {
        throw new Error(
            `工作流中存在多个独立的 MODEL 加载源 (${tracedModelAnchors.map((l) => l[0]).join(', ')})，无法确定动态 LoRA 的唯一挂载点，请在「打开蓝图」中核对模型连线。`
        );
    }

    // 回退策略：当存在未纳入标准采样器映射的自定义采样节点时，仅在全图唯一存在一个标准主模型加载器时锚定
    const standaloneLoaders = Object.entries(workflow)
        .filter(([, node]) => {
            const cls = getNodeClassType(node).toLowerCase();
            return KNOWN_MODEL_LOADER_CLASSES.has(cls) || isNunchakuLoaderClass(cls);
        })
        .map(([id]) => id);

    if (standaloneLoaders.length === 1) {
        return [standaloneLoaders[0], 0];
    }

    throw new Error(
        '无法在当前 ComfyUI 工作流中定位主模型 (MODEL) 源加载节点连线，请确认工作流包含标准加载器（如 CheckpointLoaderSimple / UNETLoader）及采样节点，或在「打开蓝图」中检查连线结构。'
    );
}

/** 解析工作流中要接入动态 LoRA 的 `CLIP` 源输出端 `[nodeId, slot]`（若工作流无 CLIP 链则返回 null） */
function resolveClipAnchor(
    workflow: Record<string, RawComfyNode>,
    downstream: Map<string, Set<string>>,
    hints?: WorkflowAnchorHints
): ComfyNodeLink | null {
    // 1. 优先从包含 %prompt% / %negative_prompt% 的节点及其直接下游文本编码器出发追溯 CLIP 源
    const seedClipNodeIds: string[] = [];
    if (hints && (hints.positivePromptNodeIds.size > 0 || hints.negativePromptNodeIds.size > 0)) {
        const promptIds = new Set([...hints.positivePromptNodeIds, ...hints.negativePromptNodeIds]);
        for (const pId of promptIds) {
            const pNode = workflow[pId];
            if (isPlainRecord(pNode?.inputs) && isNodeLink(pNode.inputs.clip)) {
                seedClipNodeIds.push(pId);
            }
        }
        if (seedClipNodeIds.length === 0) {
            const reachable = collectReachableNodeIds(hints.positivePromptNodeIds, downstream);
            for (const id of reachable) {
                const node = workflow[id];
                if (isPlainRecord(node?.inputs) && isNodeLink(node.inputs.clip)) {
                    seedClipNodeIds.push(id);
                }
            }
        }
    }

    if (seedClipNodeIds.length > 0) {
        const traced = dedupeLinks(
            seedClipNodeIds
                .map((id) => traceRootAnchorForInput(workflow, id, 'clip'))
                .filter((link): link is ComfyNodeLink => link !== null)
        );
        if (traced.length >= 1) {
            if (traced.length > 1 && hints && hints.positivePromptNodeIds.size > 0) {
                const posTraced = dedupeLinks(
                    Array.from(hints.positivePromptNodeIds)
                        .map((id) => traceRootAnchorForInput(workflow, id, 'clip'))
                        .filter((link): link is ComfyNodeLink => link !== null)
                );
                if (posTraced.length === 1) {
                    return posTraced[0];
                }
            }
            if (traced.length === 1) {
                return traced[0];
            }
        }
    }

    // 2. 遍历扫描工作流内所有具备 inputs.clip 的文本编码节点
    const allEncoderIds = Object.entries(workflow)
        .filter(([, node]) => {
            const cls = getNodeClassType(node).toLowerCase();
            return (
                isPlainRecord(node?.inputs) &&
                isNodeLink(node.inputs.clip) &&
                (KNOWN_CLIP_ENCODER_CLASSES.has(cls) || cls.includes('cliptextencode'))
            );
        })
        .map(([id]) => id);

    const fallbackTraced = dedupeLinks(
        allEncoderIds
            .map((id) => traceRootAnchorForInput(workflow, id, 'clip'))
            .filter((link): link is ComfyNodeLink => link !== null)
    );

    if (fallbackTraced.length === 1) {
        return fallbackTraced[0];
    }

    return null;
}

/** 计算与已有节点键值不冲突的递增纯数字节点 ID 生成器 */
function createNextNodeIdGenerator(workflow: Record<string, unknown>): () => string {
    let maxNumericId = 0;
    const existingKeys = new Set(Object.keys(workflow));
    for (const key of existingKeys) {
        if (/^\d+$/.test(key)) {
            const parsed = Number.parseInt(key, 10);
            if (Number.isFinite(parsed) && parsed > maxNumericId) {
                maxNumericId = parsed;
            }
        }
    }
    let counter = Math.max(1000, maxNumericId + 1);
    return () => {
        while (existingKeys.has(String(counter))) {
            counter++;
        }
        const id = String(counter);
        existingKeys.add(id);
        counter++;
        return id;
    };
}

/**
 * 校验原生工作流待注入 LoRA 文件列表的格式合法性（显式拦截暂不兼容的 `.gguf` 格式）。
 */
export function assertSupportedNativeLoraFiles(loras: readonly ResolvedLoraSpec[]): void {
    for (const lora of loras) {
        if (/\.gguf$/i.test(lora.modelName.trim())) {
            throw new Error(
                `ComfyUI 原生 LoraLoader / LoraLoaderModelOnly 节点不支持直接加载 .gguf 格式 LoRA (${lora.modelName})，请改用 .safetensors 格式的 LoRA 文件。`
            );
        }
    }
}

/**
 * 向非 WeiLin 的标准 ComfyUI 工作流节点图动态串联注入原生 `LoraLoader` / `LoraLoaderModelOnly` 节点。
 */
export function injectNativeLoraNodes(
    workflow: Record<string, unknown>,
    loras: readonly ResolvedLoraSpec[],
    options: NativeLoraInjectionOptions = {}
): Record<string, unknown> {
    if (!workflow || typeof workflow !== 'object') {
        throw new Error('ComfyUI 工作流节点图无效，无法注入原生 LoRA 节点');
    }

    const cloned = JSON.parse(JSON.stringify(workflow)) as Record<string, RawComfyNode>;
    if (!loras || loras.length === 0) {
        return cloned;
    }

    // 1. 校验目标 LoRA 文件格式与兼容前置边界
    assertSupportedNativeLoraFiles(loras);

    const supportsLoraLoader = options.supportsLoraLoader !== false;
    const supportsLoraLoaderModelOnly = options.supportsLoraLoaderModelOnly !== false;
    const downstream = buildDownstreamAdjacency(cloned, true);

    // 2. 定位主 MODEL 与 CLIP 基准输出端并拦截 Nunchaku 非标加速节点
    const origModelAnchor = resolveModelAnchor(cloned, downstream, options.anchorHints);
    const modelSourceNode = cloned[origModelAnchor[0]];
    const modelSourceClass = getNodeClassType(modelSourceNode);
    if (isNunchakuLoaderClass(modelSourceClass)) {
        throw new Error(
            `检测到当前工作流使用 Nunchaku 量化加速节点 (${modelSourceClass})，不兼容 ComfyUI 原生 LoraLoader。请在工作流中改用 Nunchaku 专用 LoRA 加载节点或切换为标准 Checkpoint / UNet / GGUF 工作流。`
        );
    }

    const origClipAnchor = resolveClipAnchor(cloned, downstream, options.anchorHints);
    if (origClipAnchor) {
        const clipSourceClass = getNodeClassType(cloned[origClipAnchor[0]]);
        if (isNunchakuLoaderClass(clipSourceClass)) {
            throw new Error(
                `检测到当前工作流使用 Nunchaku 文本编码加载节点 (${clipSourceClass})，不兼容 ComfyUI 原生 LoraLoader。请在工作流中改用兼容加载器或调整为纯模型加载。`
            );
        }
    }

    // 3. 逐条构建 LoRA 节点链路（同步检验是否缺少 CLIP 连线或必需节点）
    const originalNodeIds = Object.keys(cloned);
    const nextNodeId = createNextNodeIdGenerator(cloned);
    let currentModelRef: ComfyNodeLink = origModelAnchor;
    let currentClipRef: ComfyNodeLink | null = origClipAnchor;

    for (let idx = 0; idx < loras.length; idx++) {
        const lora = loras[idx];
        const needsClip = Math.abs(lora.clipWeight) >= 0.001;

        if (needsClip) {
            if (!currentClipRef) {
                throw new Error(
                    `当前工作流未检测到有效的 CLIP 文本编码器源连线，无法挂载 CLIP 权重非零的 LoRA (${lora.modelName}, CLIP 权重: ${lora.clipWeight})。请在「LoRA 模型管理」将 CLIP 权重设为 0，或在「打开蓝图」补充标准 CLIP 连线。`
                );
            }
            if (!supportsLoraLoader) {
                throw new Error(
                    'ComfyUI 服务端 /object_info 未检测到标准 LoraLoader 节点，无法应用含 CLIP 权重的 LoRA。'
                );
            }
            const newId = nextNodeId();
            cloned[newId] = {
                inputs: {
                    model: currentModelRef,
                    clip: currentClipRef,
                    lora_name: lora.modelName,
                    strength_model: lora.modelWeight,
                    strength_clip: lora.clipWeight,
                },
                class_type: 'LoraLoader',
                _meta: {
                    title: `ST-Draw LoRA #${idx + 1}`,
                },
            };
            currentModelRef = [newId, 0];
            currentClipRef = [newId, 1];
            continue;
        }

        // 纯 MODEL 权重 (clipWeight === 0)：优先选用 LoraLoaderModelOnly 避免无谓修补 CLIP 链
        if (supportsLoraLoaderModelOnly) {
            const newId = nextNodeId();
            cloned[newId] = {
                inputs: {
                    model: currentModelRef,
                    lora_name: lora.modelName,
                    strength_model: lora.modelWeight,
                },
                class_type: 'LoraLoaderModelOnly',
                _meta: {
                    title: `ST-Draw LoRA (ModelOnly) #${idx + 1}`,
                },
            };
            currentModelRef = [newId, 0];
        } else if (currentClipRef && supportsLoraLoader) {
            const newId = nextNodeId();
            cloned[newId] = {
                inputs: {
                    model: currentModelRef,
                    clip: currentClipRef,
                    lora_name: lora.modelName,
                    strength_model: lora.modelWeight,
                    strength_clip: 0,
                },
                class_type: 'LoraLoader',
                _meta: {
                    title: `ST-Draw LoRA #${idx + 1}`,
                },
            };
            currentModelRef = [newId, 0];
            currentClipRef = [newId, 1];
        } else {
            throw new Error(
                `ComfyUI 服务端缺少 LoraLoaderModelOnly 节点且当前工作流无法连接标准 LoraLoader 的 CLIP 链路，无法加载纯模型 LoRA (${lora.modelName})。`
            );
        }
    }

    // 4. 仅重连注入前原本存在的下游节点引用，天然保留已有静态 LoraLoader 与 VAE 输出端
    const modelChanged = !linksEqual(currentModelRef, origModelAnchor);
    const clipChanged = Boolean(origClipAnchor && currentClipRef && !linksEqual(currentClipRef, origClipAnchor));

    for (const origId of originalNodeIds) {
        const node = cloned[origId];
        if (!isPlainRecord(node?.inputs)) {
            continue;
        }
        for (const [field, val] of Object.entries(node.inputs)) {
            if (!isNodeLink(val)) {
                continue;
            }
            const link = toNodeLink(val);
            if (modelChanged && linksEqual(link, origModelAnchor)) {
                node.inputs[field] = currentModelRef;
            } else if (clipChanged && origClipAnchor && currentClipRef && linksEqual(link, origClipAnchor)) {
                node.inputs[field] = currentClipRef;
            }
        }
    }

    return cloned;
}
