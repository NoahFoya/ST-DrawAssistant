/**
 * NovelAI 绘图服务提供方适配器 (NovelAIProvider)。
 *
 * 基于 NovelAI HTTP API 对接云端图像生成服务：
 * 1. 请求头携带 Authorization: Bearer 鉴权；
 * 2. 图像宽高必须为 64 的整数倍；
 * 3. 按模型版本组装 parameters（V4/V5 采用 v4_prompt，V3 采用扁平参数）；
 * 4. 从服务端返回的 ZIP 数据流中解析并提取图片。
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
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';

export { convertWeightToBrackets } from '../../pipeline/prompt-pipeline';

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
 * 解析并构建最终的生图请求端点。
 *
 * @remarks
 * 基于 URL 语义分析：
 * 1. 若配置的 URL 已包含非根子路径（例如 /api/generate、/custom/route 等），直接使用该完整 URL；
 * 2. 若仅包含根域名或根路径，追加官方标准生成端点 (/ai/generate-image)。
 */
export function resolveNovelAIEndpoint(serverUrl: string): string {
    const trimmed = (serverUrl || NOVELAI_IMAGE_HOST).trim().replace(/\/+$/, '');
    try {
        const parsed = new URL(trimmed);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        if (pathname && pathname !== '') {
            return trimmed;
        }
    } catch {
        // 非标准 URL 容错保护
    }
    return `${trimmed}${NOVELAI_GENERATE_ENDPOINT}`;
}

/** 响应体多模态识别结果 */
export type ResponseBodyType = 'zip' | 'json' | 'image' | 'unknown';

/**
 * 嗅探并识别 HTTP 响应体的多模态数据类型（ZIP 归档、JSON 描述、直接图像流）。
 *
 * @param bytes 响应体字节数组
 * @param contentTypeHeader Content-Type 响应头字符串
 * @returns 识别出的数据类型
 */
export function detectResponseBodyType(bytes: Uint8Array, contentTypeHeader = ''): ResponseBodyType {
    const contentType = contentTypeHeader.toLowerCase();

    // 1. ZIP 二进制归档魔数: PK\x03\x04 (0x50 0x4B 0x03 0x04)
    if (
        bytes.length >= 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        bytes[2] === 0x03 &&
        bytes[3] === 0x04
    ) {
        return 'zip';
    }

    // 2. 常见图像文件魔数特征：
    // PNG: 0x89 'P' 'N' 'G' (0x89 0x50 0x4E 0x47)
    if (
        bytes.length >= 4 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
    ) {
        return 'image';
    }
    // JPEG: 0xFF 0xD8 0xFF
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image';
    }
    // WebP: RIFF....WEBP (bytes[0..3] === 'RIFF', bytes[8..11] === 'WEBP')
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image';
    }

    // 3. HTTP 头部声明为 JSON
    if (contentType.includes('application/json')) {
        return 'json';
    }

    // 4. HTTP 头部声明为图像
    if (contentType.startsWith('image/')) {
        return 'image';
    }

    // 5. 容错探测 JSON 文本：跳过 UTF-8 BOM (0xEF 0xBB 0xBF) 及前导空白字符
    let idx = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        idx = 3;
    }
    while (idx < bytes.length) {
        const b = bytes[idx];
        // 跳过空格(0x20)、制表符(0x09)、换行(0x0A)、回车(0x0D)
        if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
            idx++;
            continue;
        }
        // 检查首个有效字符是否为 '{' (0x7b) 或 '[' (0x5b)
        if (b === 0x7b || b === 0x5b) {
            return 'json';
        }
        break;
    }

    return 'unknown';
}

/**
 * 从网关或第三方服务返回的 JSON 数据中提取业务错误说明。
 *
 * @param json 解析后的 JSON 对象
 * @returns 提取到的错误信息字符串，未识别到有效错误时返回 null
 */
export function extractGatewayErrorMessage(json: unknown): string | null {
    if (!json || typeof json !== 'object') {
        return null;
    }
    const record = json as Record<string, unknown>;
    // 1. 优先提取明确的 error 字段（字符串或具有 message 属性的对象）
    if (record.error) {
        if (typeof record.error === 'string' && record.error.trim()) {
            return record.error.trim();
        }
        if (typeof record.error === 'object' && record.error !== null) {
            const nested = record.error as Record<string, unknown>;
            if (typeof nested.message === 'string' && nested.message.trim()) {
                return nested.message.trim();
            }
        }
    }
    // 2. 备选常见报错键名 message, detail, msg
    if (typeof record.message === 'string' && record.message.trim()) {
        return record.message.trim();
    }
    if (typeof record.detail === 'string' && record.detail.trim()) {
        return record.detail.trim();
    }
    if (typeof record.msg === 'string' && record.msg.trim()) {
        return record.msg.trim();
    }
    return null;
}

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

        // 若官方端点亦未响应且配置为具体生成端点，探测该端点本身是否具备连通性
        if (!pingResult.ok && serverUrl !== NOVELAI_IMAGE_HOST) {
            const endpoint = resolveNovelAIEndpoint(serverUrl);
            pingResult = await this._httpClient.ping(endpoint, {
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
                if (!drawingPreset) {
                    throw new Error(`当前激活的绘图预设方案已失效或不存在 (ID: ${activeDrawingId})，请重新选择预设`);
                }
            }
        }

        const resolvedPrompt = request.prompt;
        const resolvedNegative = request.negativePrompt || '';

        const resolvedModel =
            (params.baseModel ?? drawingPreset?.baseModel ?? 'nai-diffusion-4-5-full') as string;

        const isV5 = resolvedModel.includes('diffusion-5') || resolvedModel.includes('v5');
        const isV4 = resolvedModel.includes('diffusion-4') || resolvedModel.includes('v4');
        const isV4OrHigher = isV5 || isV4;

        // 尺寸向下对齐至 64 的整数倍
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
            // 注入 token 字段以兼容直接从请求体提取鉴权凭据的第三方中转服务网关
            token: config.apiKey,
        };

        if (onProgress) {
            onProgress({ percent: 5, statusText: '提交生图请求...' });
        }

        const serverUrl = this.getServerUrl();
        const generateUrl = resolveNovelAIEndpoint(serverUrl);
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
                const errJson = await response.json();
                const extracted = extractGatewayErrorMessage(errJson);
                if (extracted) errorDetail = extracted;
            } catch {
                // 忽略响应体解析失败
            }
            throw new Error(`NovelAI 生图请求失败: ${errorDetail}`);
        }

        if (onProgress) {
            onProgress({ percent: 80, statusText: '解析响应...' });
        }

        // 解包多模态响应（支持官方未压缩 ZIP 流与第三方中转 JSON 图片外链）
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const contentTypeHeader = response.headers?.get ? response.headers.get('content-type') : '';
        const contentType = (contentTypeHeader || '').toLowerCase();
        const bodyType = detectResponseBodyType(bytes, contentType);
        let blob: Blob;

        if (bodyType === 'json') {
            let json: Record<string, any>;
            try {
                const text = new TextDecoder('utf-8').decode(bytes);
                json = JSON.parse(text);
            } catch {
                throw new Error('NovelAI 响应 JSON 解析失败');
            }

            const imageUrl = json.url || json.image_url || json.data?.url;
            if (typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
                if (onProgress) {
                    onProgress({ percent: 90, statusText: '下载图像数据...' });
                }
                if (signal?.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }
                const imgRes = await this.fetchWithTransport(
                    imageUrl,
                    { method: 'GET', timeoutMs: maxTimeoutMs, signal },
                    transport
                );
                if (!imgRes.ok) {
                    throw new Error(`下载中转图片失败: HTTP ${imgRes.status}`);
                }
                blob = await imgRes.blob();
            } else {
                const errorMsg = extractGatewayErrorMessage(json);
                if (errorMsg) {
                    throw new Error(`NovelAI 接口异常: ${errorMsg}`);
                }
                throw new Error('NovelAI 响应未包含有效图像数据');
            }
        } else if (bodyType === 'zip') {
            // 官方原生未压缩 ZIP 二进制归档
            blob = extractFirstEntryFromZip(arrayBuffer, 'image/png');
        } else {
            // 直接返回图像二进制流 (PNG / JPEG / WebP 等)
            const mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/png';
            blob = new Blob([arrayBuffer], { type: mimeType });
        }

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
