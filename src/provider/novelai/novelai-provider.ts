/**
 * NovelAI 绘图服务提供方适配器 (NovelAIProvider)。
 *
 * @remarks
 * 基于 NovelAI 官方 HTTP API 对接云端图像生成服务：
 * 1. 鉴权机制：请求头必须携带 `Authorization: Bearer <apiKey>`；
 * 2. 尺寸整除约束：宽度与高度必须为 64 的正整数倍（通过 alignTo64 处理，防止云端校验抛错）；
 * 3. 语法适配：自动识别 A1111 权重语法 (tag:1.2) 并转换为 NovelAI 原生花括号/方括号语法；
 * 4. 响应解包算法：NovelAI 返回未压缩 ZIP 流（compression method = 0），直接通过 DataView
 *    扫描本地文件头 Local File Header (PK\x03\x04) 计算数据偏移切片提取 PNG Blob，避免引入额外解压依赖。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    TaskProgressCallback,
    ImageGenerationMetadata,
    NovelAIProviderConfig,
    DrawingPresetData,
    PromptPresetData,
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';

/**
 * 将 A1111 格式的数字权重语法 (tag:weight) 转换为 NovelAI 的花括号增强语法。
 *
 * @param text 输入提示词
 * @returns 转换后的提示词
 */
export function convertWeightToBrackets(text: string): string {
    return text.replace(/\(([^():]+):([0-9.]+)\)/g, (_match, tag, weightStr) => {
        const weight = parseFloat(weightStr);
        const trimmedTag = tag.trim();
        if (isNaN(weight) || weight === 1.0) {
            return trimmedTag;
        }
        if (weight > 1.0) {
            const count = Math.min(5, Math.max(1, Math.round((weight - 1.0) / 0.1)));
            return '{'.repeat(count) + trimmedTag + '}'.repeat(count);
        } else {
            const count = Math.min(5, Math.max(1, Math.round((1.0 - weight) / 0.1)));
            return '['.repeat(count) + trimmedTag + ']'.repeat(count);
        }
    });
}

/** NovelAI 图像生成 API 端点 */
const NOVELAI_IMAGE_HOST = 'https://image.novelai.net';
const NOVELAI_GENERATE_ENDPOINT = '/ai/generate-image';
const NOVELAI_USER_DATA_ENDPOINT = 'https://api.novelai.net/user/data';

/**
 * 已知 NovelAI 模型标识列表（NovelAI 不提供模型枚举 API）。
 * V5 / V4.5 / V4 / V3 及 furry 变体。
 */
const KNOWN_NOVELAI_MODELS: string[] = [
    'nai-diffusion-5-full',
    'nai-diffusion-5-curated-preview',
    'nai-diffusion-4-5-full',
    'nai-diffusion-4-5-curated-preview',
    'nai-diffusion-4-full',
    'nai-diffusion-4-curated-preview',
    'nai-diffusion-3',
    'nai-diffusion-furry-3',
];

/** NovelAI 提供方初始化配置项 */
export interface NovelAIProviderOptions extends BaseProviderOptions {}

/**
 * 将 width/height 向下对齐至 64 的整数倍，且最小取值不小于 64。
 *
 * @remarks
 * NovelAI API 要求图像尺寸必须为 64 的正整数倍且最小为 64，否则返回参数错误。
 */
export function alignTo64(value: number): number {
    return Math.max(64, Math.floor(value / 64) * 64);
}

/**
 * 从 ZIP 二进制数据中提取第一个条目的文件内容 Blob。
 *
 * @remarks
 * NovelAI 响应返回未压缩的 PNG（compression method = 0），
 * 因此可直接扫描 Local File Header（PK\x03\x04）定位数据起始偏移并切片，无需引入 zip 库。
 *
 * @param buffer 完整 ZIP 文件的 ArrayBuffer
 * @param mimeType 输出 Blob 的 MIME 类型
 * @throws 未找到有效图像条目时抛出错误
 */
export function extractFirstEntryFromZip(buffer: ArrayBuffer, mimeType = 'image/png'): Blob {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // 扫描 Local File Header magic: PK (0x50 0x4B) 0x03 0x04
    let offset = 0;
    while (offset < bytes.length - 30) {
        if (
            bytes[offset] === 0x50 &&
            bytes[offset + 1] === 0x4b &&
            bytes[offset + 2] === 0x03 &&
            bytes[offset + 3] === 0x04
        ) {
            // Local File Header 各字段偏移（相对 header 起始）：
            //   [0..3]   signature
            //   [4..5]   version needed
            //   [6..7]   general purpose bit flag
            //   [8..9]   compression method
            //   [10..11] last mod file time
            //   [12..13] last mod file date
            //   [14..17] crc-32
            //   [18..21] compressed size
            //   [22..25] uncompressed size
            //   [26..27] file name length
            //   [28..29] extra field length
            const fileNameLength = view.getUint16(offset + 26, true);
            const extraFieldLength = view.getUint16(offset + 28, true);
            const compressedSize = view.getUint32(offset + 18, true);

            // 文件数据起始偏移
            const dataStart = offset + 30 + fileNameLength + extraFieldLength;
            const dataEnd = dataStart + compressedSize;

            if (dataEnd <= bytes.length) {
                return new Blob([bytes.slice(dataStart, dataEnd)], { type: mimeType });
            }
        }
        offset++;
    }

    throw new Error('NovelAI 响应 ZIP 解包失败：未找到有效图像条目');
}

/**
 * NovelAI 绘图服务提供方实现类。
 */
export class NovelAIProvider extends BaseGenerationProvider {
    public readonly providerType: ProviderType = 'novelai';
    public readonly name: string = 'NovelAI';

    public constructor(options: NovelAIProviderOptions = {}) {
        super(options);
    }

    private _getConfig(): NovelAIProviderConfig | undefined {
        return this._settingsStore?.getProviderConfig<NovelAIProviderConfig>('novelai');
    }

    /**
     * 获取 NovelAI 服务基础地址。
     *
     * @remarks
     * 读取配置中心的 NovelAI 服务地址，支持用户配置第三方代理或自建中转端点，
     * 未配置时缺省为官方图像服务地址 (https://image.novelai.net)。
     * 自动规整末尾斜杠以确保 URL 拼接的一致性。
     */
    public getServerUrl(): string {
        const config = this._getConfig();
        if (config?.serverUrl) {
            return this.normalizeUrl(config.serverUrl);
        }
        return NOVELAI_IMAGE_HOST;
    }

    private _buildAuthHeaders(apiKey: string): Record<string, string> {
        return {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        };
    }

    /**
     * 检查 NovelAI 服务连通性与 Token 有效性。
     *
     * @remarks
     * 请求 GET /ai/settings 验证 Bearer token 是否有效。
     *
     * @param signal 中止信号
     */
    public async checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const config = this._getConfig();
        if (!config?.apiKey) {
            return {
                status: 'error',
                message: '未配置 NovelAI API Key',
            };
        }

        const transport = this.getTransport();
        const serverUrl = this.getServerUrl();
        // 自定义反代端点优先探测反代地址，官方端点探测官方用户数据接口
        const probeUrl =
            serverUrl !== NOVELAI_IMAGE_HOST
                ? `${serverUrl}/user/data`
                : NOVELAI_USER_DATA_ENDPOINT;

        let pingResult = await this._httpClient.ping(probeUrl, {
            transport,
            signal,
            timeoutMs: 5000,
            headers: { Authorization: `Bearer ${config.apiKey}` },
        });

        // 若自定义端点 /user/data 未响应，fallback 尝试官方端点确认 Token 有效性
        if (!pingResult.ok && probeUrl !== NOVELAI_USER_DATA_ENDPOINT) {
            pingResult = await this._httpClient.ping(NOVELAI_USER_DATA_ENDPOINT, {
                transport,
                signal,
                timeoutMs: 5000,
                headers: { Authorization: `Bearer ${config.apiKey}` },
            });
        }

        if (pingResult.ok) {
            return {
                status: 'ok',
                latencyMs: pingResult.latencyMs,
                message: `NovelAI 响应正常 (${pingResult.latencyMs}ms)`,
            };
        }

        return {
            status: 'error',
            latencyMs: pingResult.latencyMs,
            message: pingResult.error || `连接失败 (HTTP ${pingResult.status ?? 'unknown'})`,
        };
    }

    /**
     * 返回已知 NovelAI 模型标识列表。
     *
     * @remarks
     * NovelAI 不提供模型枚举 API，返回静态已知列表。
     */
    public async fetchModels(_signal?: AbortSignal): Promise<string[]> {
        return [...KNOWN_NOVELAI_MODELS];
    }

    /**
     * 执行 NovelAI 图像生成任务。
     *
     * @remarks
     * 向 /ai/generate-image 端点提交请求，服务端返回未压缩 PNG 的 ZIP 二进制流，
     * 通过 extractFirstEntryFromZip 解包提取目标图像 Blob。
     *
     * @param request 生图请求参数
     * @param onProgress 进度与状态回调
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
    public async generate(
        request: GenerationRequest,
        onProgress?: TaskProgressCallback,
        signal?: AbortSignal
    ): Promise<GenerationResult> {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const startTime = Date.now();
        const config = this._getConfig();

        if (!config?.apiKey) {
            throw new Error('未配置 NovelAI API Key，请在设置中填写');
        }

        const transport = this.getTransport();
        const params = request.parameters ?? {};
        const maxTimeoutMs = this.getTimeoutMs();

        let drawingPreset: DrawingPresetData | undefined;
        if (this._settingsStore) {
            const activeDrawingId = config.activeDrawingPresetId;
            if (activeDrawingId) {
                drawingPreset = this._settingsStore.getPreset<DrawingPresetData>(
                    'drawing',
                    activeDrawingId,
                    'novelai'
                )?.data;
            }
            if (!drawingPreset && typeof this._settingsStore.getPresets === 'function') {
                const allPresets = this._settingsStore.getPresets<DrawingPresetData>('drawing', 'novelai');
                if (allPresets && allPresets.length > 0) {
                    drawingPreset = allPresets[0].data;
                }
            }
        }

        // 1. 尝试从绑定的提示词预设方案中解析模板 (SSOT)
        let resolvedPrompt = request.prompt;
        let resolvedNegative = request.negativePrompt || '';

        const promptPresetId = (params.promptPresetId ?? drawingPreset?.promptPresetId) as string | undefined;
        if (this._settingsStore && promptPresetId) {
            const promptPreset = this._settingsStore.getPreset<PromptPresetData>('prompts', promptPresetId)?.data;
            if (promptPreset) {
                const prefix = (promptPreset.positivePrefix || '').trim();
                const suffix = (promptPreset.positiveSuffix || '').trim();
                const defaultNeg = (promptPreset.negativePrompt || '').trim();

                if (prefix) resolvedPrompt = `${prefix}, ${resolvedPrompt}`;
                if (suffix) resolvedPrompt = `${resolvedPrompt}, ${suffix}`;
                if (defaultNeg) {
                    resolvedNegative = resolvedNegative
                        ? `${defaultNeg}, ${resolvedNegative}`
                        : defaultNeg;
                }
            }
        }

        const resolvedModel =
            (params.baseModel ?? drawingPreset?.baseModel ?? 'nai-diffusion-4-5-full') as string;

        const isV5 = resolvedModel.includes('diffusion-5') || resolvedModel.includes('v5');
        const isV4 = resolvedModel.includes('diffusion-4') || resolvedModel.includes('v4');
        const isV4OrHigher = isV5 || isV4;

        // 2. 自动追加官方画质标签 (仅在配置明确开启且提示词中未显式包含时)
        const enableQualityTags = Boolean(params.qualityTags ?? drawingPreset?.qualityTags);
        if (enableQualityTags && !resolvedPrompt.includes('masterpiece')) {
            const qualityPrefix = isV4OrHigher
                ? 'very aesthetic, masterpiece, absurdres'
                : 'masterpiece, best quality';
            resolvedPrompt = `${qualityPrefix}, ${resolvedPrompt}`;
        }

        // 3. 自动转换 SD 权重语法为 NovelAI 花括号语法 (仅在配置明确开启时)
        const enableConvertSyntax = Boolean(params.convertSyntax ?? drawingPreset?.convertSyntax);
        if (enableConvertSyntax) {
            resolvedPrompt = convertWeightToBrackets(resolvedPrompt);
            if (resolvedNegative) {
                resolvedNegative = convertWeightToBrackets(resolvedNegative);
            }
        }

        // 4. 尺寸向下对齐至 64 的整数倍
        const rawWidth = (params.width ?? drawingPreset?.width ?? 832) as number;
        const rawHeight = (params.height ?? drawingPreset?.height ?? 1216) as number;
        const resolvedWidth = alignTo64(rawWidth);
        const resolvedHeight = alignTo64(rawHeight);

        const resolvedSteps = (params.steps ?? drawingPreset?.steps ?? 28) as number;
        const resolvedCfgScale = (params.cfgScale ?? drawingPreset?.cfgScale ?? 5.0) as number;
        const resolvedSampler = (params.samplerName ?? drawingPreset?.samplerName ?? 'k_euler') as string;
        const resolvedSeed =
            typeof params.seed === 'number' && params.seed >= 0
                ? (params.seed as number)
                : typeof drawingPreset?.seed === 'number' && drawingPreset.seed >= 0
                  ? drawingPreset.seed
                  : Math.floor(Math.random() * 2 ** 32);

        // 5. 组装 NovelAI 专有生成参数
        const generationParams: Record<string, unknown> = {
            width: resolvedWidth,
            height: resolvedHeight,
            steps: resolvedSteps,
            scale: resolvedCfgScale,
            sampler: resolvedSampler,
            seed: resolvedSeed,
            n_samples: 1,
        };

        // 负向模板预设 (Undesired Content Preset: Heavy=0, Light=1, Human Focus=2, None=3)
        const ucPresetMap: Record<string, number> = {
            Heavy: 0,
            Light: 1,
            'Human Focus': 2,
            None: 3,
        };
        const rawUc = (params.ucPreset ?? drawingPreset?.ucPreset ?? 'Heavy') as string | number;
        const ucIndex = typeof rawUc === 'number' ? rawUc : (ucPresetMap[rawUc] ?? 0);
        generationParams['ucPreset'] = ucIndex;

        // 引导重缩放 (CFG Rescale)
        const cfgRescale = (params.cfgRescale ?? drawingPreset?.cfgRescale) as number | undefined;
        if (typeof cfgRescale === 'number' && cfgRescale > 0) {
            generationParams['cfg_rescale'] = cfgRescale;
        }

        // 依据模型家族分流构造核心请求体
        if (isV4OrHigher) {
            // V4/V4.5/V5 官方要求提供 params_version 与结构化 v4_prompt / v4_negative_prompt
            generationParams['params_version'] = isV5 ? 4 : 3;
            generationParams['v4_prompt'] = {
                caption: {
                    base_caption: resolvedPrompt,
                    char_captions: [],
                },
                use_coords: false,
                use_order: true,
            };
            generationParams['v4_negative_prompt'] = {
                caption: {
                    base_caption: resolvedNegative,
                    char_captions: [],
                },
            };
            // 并在顶层 parameters 附带 negative_prompt 字段以适配下游代理网关与日志解析
            if (resolvedNegative) {
                generationParams['negative_prompt'] = resolvedNegative;
            }
        } else {
            // V3 经典架构：扁平 negative_prompt，支持 SMEA 与 Decrisper
            if (resolvedNegative) {
                generationParams['negative_prompt'] = resolvedNegative;
            }

            const smeaMode = (params.smeaMode ?? drawingPreset?.smeaMode ?? 'smea_dyn') as string;
            if (smeaMode === 'smea_dyn') {
                generationParams['sm'] = true;
                generationParams['sm_dyn'] = true;
            } else if (smeaMode === 'smea') {
                generationParams['sm'] = true;
                generationParams['sm_dyn'] = false;
            }

            const decrisper = Boolean(params.decrisper ?? drawingPreset?.decrisper);
            if (decrisper) {
                generationParams['dynamic_thresholding'] = true;
            }
        }

        const requestBody: Record<string, unknown> = {
            input: resolvedPrompt,
            model: resolvedModel,
            action: 'generate',
            parameters: generationParams,
        };

        if (onProgress) {
            onProgress({ percent: 5, statusText: '提交生图请求...' });
        }

        const serverUrl = this.getServerUrl();
        const generateUrl = `${serverUrl}${NOVELAI_GENERATE_ENDPOINT}`;
        const response = await this.fetchWithTransport(
            generateUrl,
            {
                method: 'POST',
                headers: this._buildAuthHeaders(config.apiKey),
                body: JSON.stringify(requestBody),
                timeoutMs: maxTimeoutMs,
                retries: 0,
                signal,
            },
            transport
        );

        if (!response.ok) {
            let errorDetail = `HTTP ${response.status}`;
            try {
                const errJson = (await response.json()) as { message?: string };
                if (errJson.message) errorDetail = errJson.message;
            } catch {
                // 忽略响应体解析失败
            }
            throw new Error(`NovelAI 生图请求失败: ${errorDetail}`);
        }

        if (onProgress) {
            onProgress({ percent: 80, statusText: '解析响应...' });
        }

        // 解包 ZIP 响应提取 PNG 图像
        const arrayBuffer = await response.arrayBuffer();
        const blob = extractFirstEntryFromZip(arrayBuffer, 'image/png');

        if (onProgress) {
            onProgress({ percent: 100, statusText: '生图完成' });
        }

        const durationMs = Date.now() - startTime;
        const metadata: ImageGenerationMetadata = {
            prompt: resolvedPrompt,
            negativePrompt: resolvedNegative || undefined,
            seed: resolvedSeed,
            sampler: resolvedSampler,
            steps: resolvedSteps,
            cfgScale: resolvedCfgScale,
            engine: 'novelai',
            durationMs,
            baseModel: resolvedModel,
            width: resolvedWidth,
            height: resolvedHeight,
        };

        return {
            blob,
            metadata,
        };
    }
}
