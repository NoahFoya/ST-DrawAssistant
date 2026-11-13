/**
 * NovelAI 绘图服务提供方适配器 (NovelAIProvider)。
 *
 * 基于 NovelAI HTTP API 对接官方云端与第三方兼容端点的图像生成服务：
 * 1. 请求头携带 Authorization: Bearer 鉴权；
 * 2. 图像宽高必须为 64 的整数倍；
 * 3. 按模型版本组装 parameters（V4/V5 采用 v4_prompt，V3 采用扁平参数）；
 * 4. 从服务端返回的 ZIP 数据流、JSON 图片外链或 Base64 中解析并提取图片。
 */

import type {
    GenerationRequest,
    GenerationResult,
    ProviderHealthResult,
    ProviderType,
    ImageGenerationMetadata,
    NovelAIProviderConfig,
    DrawingPresetData,
} from '@types';
import { BaseGenerationProvider, type BaseProviderOptions } from '../base-provider';
import {
    base64ToBlob,
    detectImageMimeFromBytes,
    ensureValidImageBlob,
    HttpError,
} from '../../util/http-client';
import {
    NOVELAI_IMAGE_HOST,
    NOVELAI_CUSTOM_SERVICE_ID,
    NOVELAI_OFFICIAL_SERVICE_ID,
    resolveNovelAIModelFamily,
    resolveNovelAIModelName,
} from './novelai-models';

/** NovelAI 图像生成 API 端点 */
const NOVELAI_GENERATE_ENDPOINT = '/ai/generate-image';
const NOVELAI_USER_DATA_ENDPOINT = 'https://api.novelai.net/user/data';

/** NovelAI 提供方初始化配置项 */
export interface NovelAIProviderOptions extends BaseProviderOptions {}

/**
 * 解析并构建最终的生图请求端点。
 *
 * @remarks
 * 基于 URL 语义分析：
 * 1. 若配置的 URL 含非根子路径（如 /novelai、/api/generate），视为用户填写的完整生图路由，原样使用；
 * 2. 仅包含根域名时，追加官方标准生成端点 (/ai/generate-image)。
 *
 * @param serverUrl 用户配置的服务端基础地址
 * @returns 规范完整的生图请求 URL
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

/** 第三方中转网关返回的 JSON 多模态响应格式 */
export interface NovelAIGatewayResponse {
    readonly b64_json?: string;
    readonly image?: string;
    readonly url?: string;
    readonly image_url?: string;
    readonly data?: Array<{ b64_json?: string; image?: string; url?: string }> | { url?: string };
    readonly images?: string[];
    readonly error?: string | { message?: string };
    readonly message?: string;
    readonly detail?: string;
    readonly msg?: string;
}

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

    // 5. 容错解析 JSON 文本：跳过 UTF-8 BOM (0xEF 0xBB 0xBF) 及前导空白字符
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
 *
 * @param value 原始宽度或高度像素值
 * @returns 64 的正整数倍且不低于 64 的尺寸数值
 */
export function alignTo64(value: number): number {
    return Math.max(64, Math.floor(value / 64) * 64);
}

interface ZipEntryRecord {
    fileName: string;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    dataStart: number;
}

const IMAGE_ENTRY_EXT_REGEX = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

function inferMimeFromFileName(fileName: string, fallback: string): string {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    if (lower.endsWith('.avif')) return 'image/avif';
    if (lower.endsWith('.png')) return 'image/png';
    return fallback;
}

function findEocdOffset(bytes: Uint8Array): number {
    const minOffset = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minOffset; i--) {
        if (
            bytes[i] === 0x50 &&
            bytes[i + 1] === 0x4b &&
            bytes[i + 2] === 0x05 &&
            bytes[i + 3] === 0x06
        ) {
            return i;
        }
    }
    return -1;
}

function parseCentralDirectoryEntries(bytes: Uint8Array, view: DataView): ZipEntryRecord[] {
    const eocdOffset = findEocdOffset(bytes);
    if (eocdOffset < 0) {
        return [];
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    if (cdOffset + cdSize > eocdOffset || totalEntries === 0) {
        return [];
    }

    const entries: ZipEntryRecord[] = [];
    const decoder = new TextDecoder('utf-8');
    let offset = cdOffset;

    for (let i = 0; i < totalEntries && offset + 46 <= cdOffset + cdSize; i++) {
        if (
            bytes[offset] !== 0x50 ||
            bytes[offset + 1] !== 0x4b ||
            bytes[offset + 2] !== 0x01 ||
            bytes[offset + 3] !== 0x02
        ) {
            break;
        }

        const compressionMethod = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const fileNameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);

        const nameStart = offset + 46;
        const nameEnd = nameStart + fileNameLen;
        if (nameEnd > bytes.length) {
            break;
        }
        const fileName = decoder.decode(bytes.subarray(nameStart, nameEnd));

        if (
            localHeaderOffset + 30 <= bytes.length &&
            bytes[localHeaderOffset] === 0x50 &&
            bytes[localHeaderOffset + 1] === 0x4b &&
            bytes[localHeaderOffset + 2] === 0x03 &&
            bytes[localHeaderOffset + 3] === 0x04
        ) {
            const lfhNameLen = view.getUint16(localHeaderOffset + 26, true);
            const lfhExtraLen = view.getUint16(localHeaderOffset + 28, true);
            const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
            if (dataStart + compressedSize <= bytes.length) {
                entries.push({
                    fileName,
                    compressionMethod,
                    compressedSize,
                    uncompressedSize,
                    dataStart,
                });
            }
        }

        offset = nameEnd + extraLen + commentLen;
    }

    return entries;
}

function parseLocalHeaderEntries(bytes: Uint8Array, view: DataView): ZipEntryRecord[] {
    const entries: ZipEntryRecord[] = [];
    const decoder = new TextDecoder('utf-8');
    let offset = 0;

    while (offset <= bytes.length - 30) {
        if (
            bytes[offset] === 0x50 &&
            bytes[offset + 1] === 0x4b &&
            bytes[offset + 2] === 0x03 &&
            bytes[offset + 3] === 0x04
        ) {
            const compressionMethod = view.getUint16(offset + 8, true);
            const compressedSize = view.getUint32(offset + 18, true);
            const uncompressedSize = view.getUint32(offset + 22, true);
            const fileNameLength = view.getUint16(offset + 26, true);
            const extraFieldLength = view.getUint16(offset + 28, true);
            const nameStart = offset + 30;
            const dataStart = nameStart + fileNameLength + extraFieldLength;

            if (compressedSize > 0 && dataStart + compressedSize <= bytes.length) {
                const fileName = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));
                entries.push({
                    fileName,
                    compressionMethod,
                    compressedSize,
                    uncompressedSize,
                    dataStart,
                });
                offset = dataStart + compressedSize;
                continue;
            }
        }
        offset++;
    }

    return entries;
}

function selectZipImageEntry(bytes: Uint8Array): ZipEntryRecord {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let entries = parseCentralDirectoryEntries(bytes, view);
    if (entries.length === 0) {
        entries = parseLocalHeaderEntries(bytes, view);
    }

    const candidates = entries.filter((entry) => {
        if (!entry.fileName || entry.fileName.endsWith('/')) {
            return false;
        }
        if (entry.fileName.startsWith('__MACOSX/') || entry.fileName.includes('/__MACOSX/')) {
            return false;
        }
        return entry.compressedSize > 0;
    });

    if (candidates.length === 0) {
        throw new Error('NovelAI 响应 ZIP 解包失败：未找到有效图像条目');
    }

    return candidates.find((entry) => IMAGE_ENTRY_EXT_REGEX.test(entry.fileName)) ?? candidates[0];
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('当前浏览器运行环境不支持原生 DecompressionStream("deflate-raw") 解压 Deflate ZIP');
    }
    const copied = new Uint8Array(compressed);
    const stream = new Blob([copied]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const decompressedBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(decompressedBuffer);
}

/**
 * 异步解包 NovelAI 返回的 ZIP 响应，提取首张有效图像 Blob。
 *
 * @remarks
 * 兼容官方原生 STORE (method = 0) 与第三方端点常见的流式 Data Descriptor (`flags & 0x0008`) + Deflate (`method = 8`) ZIP：
 * 优先解析 Central Directory 读取真实大小与偏移，并通过原生 `DecompressionStream('deflate-raw')` 解压。
 */
export async function extractImageFromZip(buffer: ArrayBuffer, mimeType = 'image/png'): Promise<Blob> {
    const bytes = new Uint8Array(buffer);
    const entry = selectZipImageEntry(bytes);
    const payloadSlice = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);

    let outputBytes: Uint8Array;
    if (entry.compressionMethod === 0) {
        outputBytes = payloadSlice.slice();
    } else if (entry.compressionMethod === 8) {
        outputBytes = await inflateRawBytes(payloadSlice);
    } else {
        throw new Error(`NovelAI 响应 ZIP 使用了不支持的压缩方法 (method=${entry.compressionMethod})`);
    }

    if (outputBytes.length === 0) {
        throw new Error('NovelAI 响应 ZIP 解压结果为空 (0 字节)');
    }

    const resolvedMime =
        detectImageMimeFromBytes(outputBytes) ?? inferMimeFromFileName(entry.fileName, mimeType);
    const safeBytes = new Uint8Array(outputBytes);
    return new Blob([safeBytes], { type: resolvedMime });
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
     * 获取当前服务商标识。
     *
     * @remarks
     * 1. 显式配置了 serviceId 时直接采用；
     * 2. 未显式配置时：若配置了非官方自填地址，推断为第三方端点；否则默认为官方服务。
     */
    public getServiceId(): string {
        const cfg = this._getConfig();
        if (cfg?.serviceId) {
            return cfg.serviceId;
        }
        if (cfg?.serverUrl && this.normalizeUrl(cfg.serverUrl) !== NOVELAI_IMAGE_HOST) {
            return NOVELAI_CUSTOM_SERVICE_ID;
        }
        return NOVELAI_OFFICIAL_SERVICE_ID;
    }

    private _isOfficial(): boolean {
        return this.getServiceId() !== NOVELAI_CUSTOM_SERVICE_ID;
    }

    /**
     * 获取 NovelAI 服务基础地址。
     *
     * @remarks
     * 1. 官方服务商恒为官方图像服务地址 (https://image.novelai.net)，忽略配置中的地址；
     * 2. 第三方端点读取配置中心的自填地址，未填写时返回空字符串；
     * 3. 自动规整末尾斜杠以确保 URL 拼接的一致性。
     */
    public getServerUrl(): string {
        if (this._isOfficial()) {
            return NOVELAI_IMAGE_HOST;
        }
        const url = this._getConfig()?.serverUrl;
        return url ? this.normalizeUrl(url) : '';
    }

    private _buildAuthHeaders(apiKey: string): Record<string, string> {
        return {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        };
    }

    /**
     * 检查 NovelAI 服务连通性。
     *
     * @remarks
     * 1. 官方服务请求用户数据接口 (/user/data)，可确认 Token 有效性；
     * 2. 第三方端点向生图路由发送轻量连通性检查请求 (Ping)，HTTP 400 / 405 / 415 / 422 均表明生图路由存在；
     *    401 / 403 表明鉴权失败；仅当生图路由未命中 (404) 时回退检测站点 `/api/health`。
     *    第三方网关的连通性检测通常不校验完整参数或密钥，可达时提示密钥将在生图时校验。
     *
     * @param signal 中止信号
     */
    public async checkHealth(signal?: AbortSignal): Promise<ProviderHealthResult> {
        const config = this._getConfig();
        const transport = this.getTransport();

        if (this._isOfficial()) {
            if (!config?.apiKey) {
                return { status: 'error', message: '未配置 NovelAI API Key' };
            }
            const pingResult = await this._httpClient.ping(NOVELAI_USER_DATA_ENDPOINT, {
                transport,
                signal,
                timeoutMs: 5000,
                headers: { Authorization: `Bearer ${config.apiKey}` },
            });

            if (pingResult.ok) {
                return {
                    status: 'ok',
                    latencyMs: pingResult.latencyMs,
                    message: `NovelAI 官方服务响应正常 (${pingResult.latencyMs}ms)`,
                };
            }

            if (pingResult.status === 401 || pingResult.status === 403) {
                return {
                    status: 'error',
                    latencyMs: pingResult.latencyMs,
                    message: `NovelAI API Key 无效或已过期 (HTTP ${pingResult.status})`,
                };
            }

            return {
                status: 'error',
                latencyMs: pingResult.latencyMs,
                message:
                    pingResult.error ||
                    (pingResult.status !== undefined
                        ? `连接失败 (HTTP ${pingResult.status})`
                        : '无法直连 NovelAI 官方域名（可能受跨域或网络限制，可在常规设置开启“酒馆代理”或改用自定义反代）'),
            };
        }

        const serverUrl = this.getServerUrl();
        if (!serverUrl) {
            return { status: 'error', message: '未填写第三方端点地址' };
        }
        if (!config?.apiKey) {
            return { status: 'error', message: '未配置 API Key' };
        }

        const okMessage = (ms?: number): string =>
            `第三方端点可达 (${ms ?? '-'}ms)，密钥将在生图时校验`;
        const pingOptions = {
            transport,
            signal,
            timeoutMs: 4000,
            headers: { Authorization: `Bearer ${config.apiKey}` },
        };

        // 1. 首选单点检查：向生图路由发送轻量连通性检查请求 (Ping)
        // 多数代理在生图路由收到 GET 空请求时返回 400 / 405 / 415 / 422，均代表路由已存在并正常响应
        const endpointPing = await this._httpClient.ping(resolveNovelAIEndpoint(serverUrl), pingOptions);
        const reachableErrorStatuses = new Set([400, 405, 415, 422]);
        if (
            endpointPing.ok ||
            (endpointPing.status !== undefined && reachableErrorStatuses.has(endpointPing.status))
        ) {
            return { status: 'ok', latencyMs: endpointPing.latencyMs, message: okMessage(endpointPing.latencyMs) };
        }

        if (endpointPing.status === 401 || endpointPing.status === 403) {
            return {
                status: 'error',
                latencyMs: endpointPing.latencyMs,
                message: endpointPing.error || `API Key 无效或无权访问 (HTTP ${endpointPing.status})`,
            };
        }

        // 2. 判定是否属于底层网络连接失败（端口拒绝 ECONNREFUSED、主机无法解析 ENOTFOUND 或完全不可达）
        const isNetworkDown =
            !endpointPing.status ||
            endpointPing.status >= 500 ||
            (endpointPing.error && (
                endpointPing.error.includes('ECONNREFUSED') ||
                endpointPing.error.includes('ENOTFOUND') ||
                endpointPing.error.includes('Failed to fetch')
            ));

        // 若网络或端口不可达，直接返回失败，避免并发请求其他候选路由
        if (isNetworkDown) {
            return {
                status: 'error',
                latencyMs: endpointPing.latencyMs,
                message: endpointPing.error || `连接失败 (HTTP ${endpointPing.status ?? 'unknown'})`,
            };
        }

        // 3. 仅当生图路由明确返回 404 未命中时，回退检测站点简单健康路由（不附带 Authorization 以减少 CORS 预检阻塞）
        if (endpointPing.status === 404 && !signal?.aborted) {
            try {
                const healthUrl = `${new URL(serverUrl).origin}/api/health`;
                const res = await this._httpClient.ping(healthUrl, {
                    transport,
                    signal,
                    timeoutMs: 4000,
                });
                if (res.ok) {
                    return { status: 'ok', latencyMs: res.latencyMs, message: okMessage(res.latencyMs) };
                }
            } catch {
                // 忽略非标准 URL
            }
        }

        return {
            status: 'error',
            latencyMs: endpointPing.latencyMs,
            message: endpointPing.error || `连接失败 (HTTP ${endpointPing.status ?? 'unknown'})`,
        };
    }

    /**
     * 执行 NovelAI 图像生成任务。
     *
     * @remarks
     * 向 /ai/generate-image 端点提交请求，服务端返回 ZIP 二进制流（STORE / Deflate），
     * 通过 {@link extractImageFromZip} 解包提取目标图像 Blob。
     *
     * @param request 生图请求参数
     * @param signal 中止信号
     * @returns 包含图像 Blob 与生成元数据的生成结果
     */
    public async generate(
        request: GenerationRequest,
        signal?: AbortSignal
    ): Promise<GenerationResult> {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }

        const startTime = Date.now();
        const config = this._getConfig();

        // 1. 校验凭据与端点地址
        if (!config?.apiKey) {
            throw new Error('未配置 NovelAI API Key，请在设置中填写');
        }
        if (!this._isOfficial() && !this.getServerUrl()) {
            throw new Error('未填写第三方端点地址，请在设置中填写');
        }

        const transport = this.getTransport();
        const params = request.parameters ?? {};
        const maxTimeoutMs = this.getTimeoutMs();

        // 2. 读取激活的绘图预设（优先使用队列快照固定的 drawingPresetId）
        const drawingPreset = this.resolveDrawingPreset<DrawingPresetData>(params);

        // 3. 解析提示词与模型规格
        const resolvedPrompt = request.prompt;
        const resolvedNegative = request.negativePrompt || '';
        const resolvedModel = resolveNovelAIModelName(params, drawingPreset);

        // 架构分流：V3 按传统扁平参数组装，其余（V4 / V4.5 / V5 及无法识别的第三方模型）按 V4+ 结构化参数组装
        const modelFamily = resolveNovelAIModelFamily(resolvedModel);
        const isV5 = modelFamily === 'v5';
        const isV4OrHigher = modelFamily !== 'v3';

        // 4. 对齐分辨率尺寸至 64 的整数倍
        const rawWidth = (params.width ?? drawingPreset?.width ?? 832) as number;
        const rawHeight = (params.height ?? drawingPreset?.height ?? 1216) as number;
        const resolvedWidth = alignTo64(rawWidth);
        const resolvedHeight = alignTo64(rawHeight);

        const resolvedSteps = (params.steps ?? drawingPreset?.steps ?? 28) as number;
        const resolvedCfgScale = (params.cfgScale ?? drawingPreset?.cfgScale ?? 5.0) as number;
        const resolvedSampler = (params.samplerName ?? drawingPreset?.samplerName ?? 'k_euler') as string;
        const resolvedSeed =
            typeof params.seed === 'number' && Number.isFinite(params.seed) && params.seed >= 0
                ? Math.floor(params.seed)
                : typeof drawingPreset?.seed === 'number' &&
                    Number.isFinite(drawingPreset.seed) &&
                    drawingPreset.seed >= 0
                  ? Math.floor(drawingPreset.seed)
                  : Math.floor(Math.random() * 2 ** 32);

        // 5. 组装 NovelAI 专有生成参数
        // 固定携带 ucPreset: 3 (None) 禁用意外预设追加，负向词完全由本地提示词预设与指令管理
        const generationParams: Record<string, unknown> = {
            width: resolvedWidth,
            height: resolvedHeight,
            steps: resolvedSteps,
            scale: resolvedCfgScale,
            sampler: resolvedSampler,
            seed: resolvedSeed,
            n_samples: 1,
            ucPreset: 3,
        };

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
        // 部分第三方中转网关从请求体提取鉴权凭据；官方服务仅使用 Authorization 请求头，不在请求体中携带密钥
        if (!this._isOfficial()) {
            requestBody.token = config.apiKey;
        }

        // 6. 发起 HTTP 生图请求
        const serverUrl = this.getServerUrl();
        const generateUrl = resolveNovelAIEndpoint(serverUrl);
        let response: Response;
        try {
            response = await this.fetchWithTransport(
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
        } catch (err: unknown) {
            if (err instanceof HttpError) {
                const extracted = extractGatewayErrorMessage(err.details);
                throw new Error(`NovelAI 生图请求失败: ${extracted || `HTTP ${err.status}`}`);
            }
            throw err;
        }

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

        // 7. 解包多模态响应（支持官方未压缩 ZIP 流与第三方中转 JSON 图片外链）
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const contentTypeHeader = response.headers?.get ? response.headers.get('content-type') : '';
        const contentType = (contentTypeHeader || '').toLowerCase();
        const bodyType = detectResponseBodyType(bytes, contentType);
        let blob: Blob;

        if (bodyType === 'json') {
            let json: NovelAIGatewayResponse;
            try {
                const text = new TextDecoder('utf-8').decode(bytes);
                json = JSON.parse(text) as NovelAIGatewayResponse;
            } catch {
                throw new Error('NovelAI 响应 JSON 解析失败');
            }

            // 1. 优先提取 Base64 图像数据（适配部分第三方反代或聚合网关）
            const firstData = Array.isArray(json.data) ? json.data[0] : undefined;
            const b64Candidate =
                json.b64_json ||
                json.image ||
                firstData?.b64_json ||
                firstData?.image ||
                (Array.isArray(json.images) ? json.images[0] : undefined);

            if (typeof b64Candidate === 'string' && b64Candidate.length > 50) {
                const mime = b64Candidate.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
                blob = base64ToBlob(b64Candidate, mime);
            } else {
                // 2. 检查图片外链 URL
                const imageUrl =
                    json.url ||
                    json.image_url ||
                    (Array.isArray(json.data) ? json.data[0]?.url : json.data?.url);
                if (typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
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
            }
        } else if (bodyType === 'zip') {
            // 兼容官方 STORE 与第三方流式 Data Descriptor + Deflate ZIP
            blob = await extractImageFromZip(arrayBuffer, 'image/png');
        } else if (bodyType === 'image') {
            // 直接返回图像二进制流 (PNG / JPEG / WebP 等)
            const mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/png';
            blob = new Blob([arrayBuffer], { type: mimeType });
        } else {
            const rawText = new TextDecoder('utf-8')
                .decode(bytes.slice(0, 512))
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const snippet = rawText ? `: ${rawText.slice(0, 120)}` : '';
            throw new Error(`NovelAI 响应格式异常（非有效 ZIP 或图像数据）${snippet}`);
        }

        blob = await ensureValidImageBlob(blob, 'NovelAI');

        // 8. 装配生成元数据
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
