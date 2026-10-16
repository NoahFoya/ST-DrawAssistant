/**
 * 通用服务连接与状态探测复合卡片 (ConnectionCard)。
 *
 * @remarks
 * 为生图服务提供方（ComfyUI、SD-WebUI/Forge、NovelAI、OpenAI 兼容协议）提供统一的服务连接卡片：
 * 1. 服务地址 (Base URL) 与可选鉴权密钥 (API Key/Token) 受控表单输入；
 * 2. 可选的服务商预设模板切换 (OpenAI/SiliconFlow/Grok 等)；
 * 3. 连通性健康探测 (checkHealth) 与 RTT 延迟状态徽标反馈；
 * 4. 可重载的模型资产拉取扩展函数 (fetchAssetList)；
 * 5. 全生命周期级联注销与请求中止防护。
 */

import type { UIComponent, Disposable } from '../types';
import type { ProviderHealthResult } from '@types';
import { Card } from '../components/card';
import { TextInput } from '../components/text-input';
import { Select, type SelectOption } from '../components/select';
import { Button } from '../components/button';
import { Badge, type BadgeVariant } from '../components/badge';
import { FormField } from '../components/form-field';
import { logger } from '../../util/logger';

/** 服务商预设模板定义 */
export interface ProviderPreset {
    readonly id: string;
    readonly label: string;
    readonly defaultUrl: string;
}

/** 连接卡片当前数据状态 */
export interface ConnectionCardData {
    serverUrl: string;
    apiKey?: string;
    customHeaders?: Record<string, string>;
    activePresetId?: string;
}

/** 资产列表拉取结果 */
export interface AssetFetchResult {
    readonly count: number;
    readonly message?: string;
}

export interface ConnectionCardOptions {
    /** 卡片主标题，默认 "服务连接与状态探测" */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 初始数据 */
    initialData?: Partial<ConnectionCardData>;
    /** 服务地址输入提示，默认 "http://127.0.0.1:8188" */
    urlPlaceholder?: string;
    /** 是否展示 API Key 鉴权凭据输入框，默认 false */
    showApiKey?: boolean;
    /** API Key 输入框占位提示 */
    apiKeyPlaceholder?: string;
    /** 是否展示自定义请求头输入框，默认 false */
    showCustomHeaders?: boolean;
    /** 可选的服务商预设模板列表 */
    providerPresets?: ProviderPreset[];
    /** 连通性健康探测处理函数 */
    onTestPing?: (serverUrl: string, apiKey?: string) => Promise<ProviderHealthResult>;
    /** 资产列表拉取处理函数（若不提供且未重载 fetchAssetList 则不渲染拉取按钮） */
    onFetchAssets?: (serverUrl: string, apiKey?: string) => Promise<AssetFetchResult>;
    /** 数据变更回调 */
    onChange?: (data: ConnectionCardData) => void;
}

export class ConnectionCard implements UIComponent, Disposable {
    public readonly element: HTMLElement;
    public readonly card: Card;

    private readonly data: ConnectionCardData;
    private readonly options: ConnectionCardOptions;
    private readonly disposables: Disposable[] = [];

    private readonly statusBadge: Badge;
    private presetSelect?: Select;
    private readonly urlInput: TextInput;
    private readonly urlFormField: FormField;
    private apiKeyInput?: TextInput;
    private apiKeyFormField?: FormField;
    private headersInput?: TextInput;
    private headersFormField?: FormField;

    private readonly pingButton: Button;
    private fetchAssetsButton?: Button;

    private pingAbortController: AbortController | null = null;
    private assetAbortController: AbortController | null = null;

    constructor(options: ConnectionCardOptions = {}) {
        this.options = options;
        this.data = {
            serverUrl: options.initialData?.serverUrl ?? '',
            apiKey: options.initialData?.apiKey ?? '',
            customHeaders: options.initialData?.customHeaders,
            activePresetId: options.initialData?.activePresetId,
        };

        // 1. 初始化 Card 容器外壳
        this.card = new Card({
            title: options.title ?? '服务连接与状态探测',
            subtitle: options.subtitle ?? '配置后端服务访问端点与鉴权凭据，并探测网络连通状态',
            collapsible: true,
            defaultCollapsed: false,
        });
        this.element = this.card.element;
        this.disposables.push(this.card);

        // 2. 初始化头部右上角状态指示徽标
        this.statusBadge = new Badge({
            text: '未探测',
            variant: 'neutral',
            dot: true,
        });
        this.card.setBadges(this.statusBadge.element);
        this.disposables.push(this.statusBadge);

        // 3. 构建表单主体内容
        // 3.1 可选：服务商预设模板选择
        if (options.providerPresets && options.providerPresets.length > 0) {
            const presetOptions: SelectOption[] = options.providerPresets.map((p) => ({
                value: p.id,
                label: p.label,
            }));
            presetOptions.push({ value: 'custom', label: '自定义端点' });

            const initialPreset = this.data.activePresetId || presetOptions[0].value;
            this.presetSelect = new Select({
                value: initialPreset,
                options: presetOptions,
                onChange: (presetId: string) => {
                    this.data.activePresetId = presetId;
                    const matched = options.providerPresets?.find((p) => p.id === presetId);
                    if (matched) {
                        this.urlInput.setValue(matched.defaultUrl, { triggerChange: true });
                    }
                    this.notifyChange();
                },
            });
            const presetField = new FormField({
                label: '服务商预设模板',
                tooltip: '快速填入主流 OpenAI 兼容云端服务的标准基础地址',
                control: this.presetSelect,
            });
            this.card.appendContent(presetField.element);
            this.disposables.push(this.presetSelect, presetField);
        }

        // 3.2 服务基础地址 (Base URL)
        this.urlInput = new TextInput({
            value: this.data.serverUrl,
            placeholder: options.urlPlaceholder ?? 'http://127.0.0.1:8188',
            clearable: true,
            onChange: (val: string) => {
                this.data.serverUrl = val;
                this.resetStatusToIdle();
                this.notifyChange();
            },
        });
        this.urlFormField = new FormField({
            label: '服务基础地址',
            required: true,
            tooltip: '后端 API 服务的监听地址（Base URL），如本地 ComfyUI (8188) 或第三方云端兼容端点',
            control: this.urlInput,
        });
        this.card.appendContent(this.urlFormField.element);
        this.disposables.push(this.urlInput, this.urlFormField);

        // 3.3 可选：接口鉴权凭据 (API Key / Token)
        if (options.showApiKey) {
            this.apiKeyInput = new TextInput({
                value: this.data.apiKey,
                placeholder: options.apiKeyPlaceholder ?? '输入 API Key 或访问令牌',
                type: 'password',
                clearable: true,
                onChange: (val: string) => {
                    this.data.apiKey = val;
                    this.resetStatusToIdle();
                    this.notifyChange();
                },
            });
            this.apiKeyFormField = new FormField({
                label: '接口鉴权密匙',
                tooltip: '访问受保护服务接口所需的认证密钥或 Bearer Token（API Key）',
                control: this.apiKeyInput,
            });
            this.card.appendContent(this.apiKeyFormField.element);
            this.disposables.push(this.apiKeyInput, this.apiKeyFormField);
        }

        // 3.4 可选：自定义请求头 (Headers)
        if (options.showCustomHeaders) {
            const initialHeadersStr = this.data.customHeaders
                ? JSON.stringify(this.data.customHeaders)
                : '';
            this.headersInput = new TextInput({
                value: initialHeadersStr,
                placeholder: '{"Authorization": "Bearer ..."}',
                onChange: (val: string) => {
                    const trimmed = val.trim();
                    if (!trimmed) {
                        this.data.customHeaders = undefined;
                        this.headersInput?.element.classList.remove('is-invalid');
                        this.headersFormField?.setTooltip('针对特定中转站或网关所需的额外 HTTP Headers (JSON 格式)');
                        this.resetStatusToIdle();
                        this.notifyChange();
                        return;
                    }

                    try {
                        const parsed = JSON.parse(trimmed);
                        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                            throw new Error('请求头必须为键值对 JSON 对象结构');
                        }
                        this.data.customHeaders = parsed;
                        this.headersInput?.element.classList.remove('is-invalid');
                        this.headersFormField?.setTooltip('针对特定中转站或网关所需的额外 HTTP Headers (JSON 格式)');
                        this.resetStatusToIdle();
                        this.notifyChange();
                    } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : String(err);
                        this.headersInput?.element.classList.add('is-invalid');
                        this.headersFormField?.setTooltip(`当前输入的 JSON 格式非法: ${message}`);
                        // 输入非法时阻止对外派发，防止损坏数据污染全局配置
                    }
                },
            });
            this.headersFormField = new FormField({
                label: '自定义请求头',
                tooltip: '针对特定中转站或网关所需的额外 HTTP Headers（JSON 格式）',
                control: this.headersInput,
            });
            this.card.appendContent(this.headersFormField.element);
            this.disposables.push(this.headersInput, this.headersFormField);
        }

        // 4. 构建操作按钮行
        const actionRow = document.createElement('div');
        actionRow.classList.add('da-card__actions-row');
        actionRow.style.display = 'flex';
        actionRow.style.justifyContent = 'flex-end';
        actionRow.style.gap = '8px';
        actionRow.style.marginTop = '8px';

        // 4.1 可选：拉取资产列表按钮（若提供了 onFetchAssets 或由子类重载实现）
        if (options.onFetchAssets || this.hasCustomFetchAssetList()) {
            this.fetchAssetsButton = new Button({
                label: '拉取资产列表',
                variant: 'secondary',
                size: 'sm',
                className: 'da-connection-btn--refresh',
                onClick: async () => {
                    await this.triggerFetchAssets();
                },
            });
            actionRow.appendChild(this.fetchAssetsButton.element);
            this.disposables.push(this.fetchAssetsButton);
        }

        // 4.2 连通性健康测试按钮
        this.pingButton = new Button({
            label: '测试连接',
            variant: 'primary',
            size: 'sm',
            className: 'da-connection-btn--ping',
            onClick: async () => {
                await this.triggerPing();
            },
        });
        actionRow.appendChild(this.pingButton.element);
        this.disposables.push(this.pingButton);

        this.card.appendContent(actionRow);
    }

    /**
     * 获取当前卡片完整的表单数据副本。
     */
    public getData(): ConnectionCardData {
        return {
            serverUrl: this.data.serverUrl,
            apiKey: this.data.apiKey,
            customHeaders: this.data.customHeaders ? { ...this.data.customHeaders } : undefined,
            activePresetId: this.data.activePresetId,
        };
    }

    /**
     * 外部受控更新数据。
     */
    public setData(data: Partial<ConnectionCardData>): void {
        if (data.serverUrl !== undefined) {
            this.data.serverUrl = data.serverUrl;
            this.urlInput.setValue(data.serverUrl);
        }
        if (data.apiKey !== undefined && this.apiKeyInput) {
            this.data.apiKey = data.apiKey;
            this.apiKeyInput.setValue(data.apiKey);
        }
        if (data.activePresetId !== undefined && this.presetSelect) {
            this.data.activePresetId = data.activePresetId;
            this.presetSelect.setValue(data.activePresetId);
        }
        if (data.customHeaders !== undefined && this.headersInput) {
            this.data.customHeaders = data.customHeaders;
            this.headersInput.setValue(JSON.stringify(data.customHeaders));
        }
        this.resetStatusToIdle();
    }

    /**
     * 设置字段脏状态指示。
     */
    public setDirty(isDirty: boolean): void {
        this.urlFormField.setDirty(isDirty);
        this.apiKeyFormField?.setDirty(isDirty);
        this.headersFormField?.setDirty(isDirty);
    }

    /**
     * 获取当前状态徽标文字。
     */
    public getStatusText(): string {
        return this.statusBadge.element.textContent ?? '';
    }

    /**
     * 触发单次连通性健康探测。
     */
    public async triggerPing(): Promise<ProviderHealthResult | null> {
        if (!this.options.onTestPing) {
            return null;
        }

        if (this.pingAbortController) {
            this.pingAbortController.abort();
        }
        this.pingAbortController = new AbortController();

        this.updateBadge('info', '探测中...');
        this.pingButton.setLoading(true);

        try {
            const result = await this.options.onTestPing(this.data.serverUrl, this.data.apiKey);
            if (result.status === 'ok') {
                const latencyText = result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : '';
                this.updateBadge('success', `已连接${latencyText}`);
            } else {
                const errorMsg = result.message ? `: ${result.message}` : '';
                this.updateBadge('danger', `连接失败${errorMsg}`);
            }
            return result;
        } catch (err) {
            const msg = (err as Error)?.message || '网络异常';
            this.updateBadge('danger', `探测异常: ${msg}`);
            return { status: 'error', message: msg };
        } finally {
            this.pingButton.setLoading(false);
            this.pingAbortController = null;
        }
    }

    /**
     * 触发拉取资产列表。
     *
     * @remarks
     * 优先调用子类重载的 fetchAssetList 方法，未重载时调用 options.onFetchAssets。
     */
    public async triggerFetchAssets(): Promise<AssetFetchResult | null> {
        const executor = this.hasCustomFetchAssetList()
            ? this.fetchAssetList!.bind(this)
            : this.options.onFetchAssets;

        if (!executor) {
            return null;
        }

        if (this.assetAbortController) {
            this.assetAbortController.abort();
        }
        this.assetAbortController = new AbortController();

        if (this.fetchAssetsButton) {
            this.fetchAssetsButton.setLoading(true);
        }

        try {
            return await executor(this.data.serverUrl, this.data.apiKey);
        } catch (err) {
            logger.error('[ConnectionCard] 拉取模型资产失败:', err instanceof Error ? err.message : String(err));
            return null;
        } finally {
            if (this.fetchAssetsButton) {
                this.fetchAssetsButton.setLoading(false);
            }
            this.assetAbortController = null;
        }
    }

    /**
     * 可重载的资产拉取扩展函数（子类可重载定制具体后端资产解析协议）。
     */
    public async fetchAssetList?(serverUrl: string, apiKey?: string): Promise<AssetFetchResult>;

    private hasCustomFetchAssetList(): boolean {
        return typeof this.fetchAssetList === 'function';
    }

    private resetStatusToIdle(): void {
        this.updateBadge('neutral', '未探测');
    }

    private updateBadge(variant: BadgeVariant, text: string): void {
        this.statusBadge.setVariant(variant);
        this.statusBadge.setText(text);
    }

    private notifyChange(): void {
        this.options.onChange?.(this.getData());
    }

    /**
     * 释放所有子控件与未完成的异步任务。
     */
    public dispose(): void {
        if (this.pingAbortController) {
            this.pingAbortController.abort();
            this.pingAbortController = null;
        }
        if (this.assetAbortController) {
            this.assetAbortController.abort();
            this.assetAbortController = null;
        }

        for (const item of this.disposables) {
            try {
                item.dispose();
            } catch {
                // 忽略清理异常
            }
        }
        this.disposables.length = 0;
        this.element.parentElement?.removeChild(this.element);
    }
}
