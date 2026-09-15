/**
 * NovelAI 生图引擎适配器 (NovelAIAdapter)
 *
 * 功能：
 * 1. 组装 NovelAI 官方格式生图请求，注入 Bearer 鉴权凭据；
 * 2. 处理官方接口返回的 ZIP 压缩二进制流，容错提取并封装 PNG 图像 Blob；
 * 3. 探测服务连通性与用户订阅点数 (Anlas) 资产余额；
 * 4. 规范化生图响应元数据。
 *
 * Tips：
 * 1. 尺寸硬性限制：NovelAI 严格要求生成图像宽高为 64 的整倍数，非法尺寸会触发服务端 400 校验拒绝；
 * 2. ZIP 流容错提取：服务端返回多文件 ZIP 封包，需基于 PNG 魔数 (Magic Number) 准确定位图像文件头。
 */

import type {
    EngineCapabilities,
    EngineType,
    HealthCheckResult,
    ImageGenerationResult,
    NovelAIRequestData
} from '@types';
import type { HttpClient } from '@util/http';
import { BaseAdapter } from './base';
import { NetworkError } from '@util/http';

/**
 * 从 ZIP 流或二进制 Buffer 中提取 PNG 图像
 */
export function extractPngBlob(buffer: ArrayBuffer): Blob {
    const bytes = new Uint8Array(buffer);
    const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    // 查找 PNG 文件头起始位置
    let startIdx = -1;
    for (let i = 0; i < bytes.length - 8; i++) {
        let match = true;
        for (let j = 0; j < 8; j++) {
            if (bytes[i + j] !== pngMagic[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            startIdx = i;
            break;
        }
    }

    if (startIdx === -1) {
        // 未检测到 PNG 魔数，直接作为原始 Blob 回退
        return new Blob([buffer], { type: 'image/png' });
    }

    // 查找 PNG 结束块 IEND (49 45 4E 44 AE 42 60 82)
    const iendMagic = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    let endIdx = bytes.length;
    for (let i = startIdx; i < bytes.length - 8; i++) {
        let match = true;
        for (let j = 0; j < 8; j++) {
            if (bytes[i + j] !== iendMagic[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            endIdx = i + 8;
            break;
        }
    }

    const pngBytes = bytes.subarray(startIdx, endIdx);
    return new Blob([pngBytes], { type: 'image/png' });
}

export class NovelAIAdapter extends BaseAdapter<NovelAIRequestData> {
    public readonly id: EngineType = 'novelai';
    public readonly name = 'NovelAI';

    public readonly capabilities: EngineCapabilities = {
        txt2img: true,
        img2img: false,
        inpaint: false,
        lora: false,
        progress: false,
        interrupt: false,
        customWorkflow: false
    };

    private _apiKey: string;

    constructor(baseUrl = 'https://image.novelai.net', apiKey = '', httpClient?: HttpClient) {
        super(baseUrl, httpClient);
        this._apiKey = apiKey;
    }

    public setApiKey(key: string): void {
        this._apiKey = key;
    }

    /**
     * NovelAI 服务连通性与账户订阅资产 (Opus档位、Anlas余额) 探测
     */
    public override async fetchAssets(
        signal?: AbortSignal,
        options?: { apiKey?: string; token?: string }
    ): Promise<HealthCheckResult> {
        const token = (options?.apiKey || options?.token || this._apiKey || '').trim();
        if (!token) {
            return {
                ok: false,
                latencyMs: 0,
                message: '请先配置有效的 NovelAI API Token 凭据'
            };
        }

        const start = performance.now();
        try {
            const resp = await this.httpClient.fetchExternal('https://api.novelai.net/user/subscription', {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`
                },
                timeoutMs: 8000,
                signal
            });

            const latencyMs = Math.round(performance.now() - start);

            if (resp.status === 401) {
                return {
                    ok: false,
                    latencyMs,
                    message: 'API Token 鉴权失败 (HTTP 401)，请核对凭据有效性'
                };
            }

            if (!resp.ok) {
                return {
                    ok: false,
                    latencyMs,
                    message: `NovelAI 订阅接口异常 (HTTP ${resp.status})`
                };
            }

            const data = await resp.json().catch(() => ({}));
            const tier = data.tier ?? 0;
            const anlas = data.trainingStepsLeft?.fixedTrainingStepsLeft ?? data.anlasBalance ?? 0;

            const tierNames: Record<number, string> = {
                1: 'Tablet',
                2: 'Scroll',
                3: 'Opus (尊享会员)'
            };
            const tierName = tierNames[tier] || `档位 ${tier}`;

            const assetsSummary = `订阅有效 [${tierName}] · Anlas 余额: ${anlas}`;

            return {
                ok: true,
                latencyMs,
                assetsSummary,
                assets: {
                    tier,
                    tierName,
                    anlas,
                    active: data.active
                }
            };
        } catch (err: any) {
            this.logger.error('NovelAI 连通性探测异常:', err);
            return {
                ok: false,
                latencyMs: 0,
                message: err?.message || '无法连接至 NovelAI 官方服务'
            };
        }
    }

    public async generate(
        params: NovelAIRequestData,
        onProgress?: (progress: number) => void,
        signal?: AbortSignal
    ): Promise<ImageGenerationResult> {
        const startTime = performance.now();
        const apiKey = this._apiKey;
        if (!apiKey) {
            throw new Error('NovelAI 生图请求缺少有效的 API Key');
        }

        const endpoint = `${this.baseUrl}/ai/generate-image`;

        const resolvedWidth = Math.max(64, Math.round((params.parameters.width || 832) / 64) * 64);
        const resolvedHeight = Math.max(64, Math.round((params.parameters.height || 1216) / 64) * 64);

        const requestBody = {
            input: params.input || params.prompt || '',
            model: params.model || 'nai-diffusion-4-5-full',
            action: params.action || 'generate',
            parameters: {
                ...params.parameters,
                width: resolvedWidth,
                height: resolvedHeight
            }
        };

        let resp: Response;
        try {
            resp = await this.fetchWithTransport(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody),
                signal
            }, params.transport);
        } catch (err: any) {
            if (err instanceof NetworkError || err?.status) {
                const status = err.status;
                let errMsg = `NovelAI 生图请求失败 (HTTP ${status})`;
                if (status === 401) {
                    errMsg = 'NovelAI 鉴权失败 (HTTP 401)，请核对 API Token 有效性';
                } else if (status === 402) {
                    errMsg = 'NovelAI 账户 Anlas 点数不足或订阅已失效 (HTTP 402)';
                } else if (status === 429) {
                    errMsg = 'NovelAI 触发并发限制或频率超限 (HTTP 429)';
                } else if (err.details) {
                    const detail = typeof err.details === 'object' ? (err.details.message || JSON.stringify(err.details)) : String(err.details);
                    errMsg += `: ${detail}`;
                }
                throw new Error(errMsg);
            }
            throw err;
        }

        const arrayBuffer = await resp.arrayBuffer();
        const blob = extractPngBlob(arrayBuffer);

        if (onProgress) {
            onProgress(1.0);
        }

        return {
            blob,
            mimeType: 'image/png',
            width: resolvedWidth,
            height: resolvedHeight,
            seed: params.parameters.seed,
            durationMs: this.measureDuration(startTime),
            metadata: {
                model: requestBody.model
            }
        };
    }
}
