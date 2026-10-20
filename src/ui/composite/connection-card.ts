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
import { ConfirmDialog } from '../feedback/confirm-dialog';
import { Toast } from '../feedback/toast';
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
    private readonly connectionRow: HTMLElement;
    private apiKeyInput?: TextInput;
    private apiKeyFormField?: FormField;

    private readonly actionButton: Button;

    private pingAbortController: AbortController | null = null;
    private assetAbortController: AbortController | null = null;
    private lastErrorDetails: { url: string; message: string } | null = null;

    constructor(options: ConnectionCardOptions = {}) {
        this.options = options;
        this.data = {
            serverUrl: options.initialData?.serverUrl ?? '',
            apiKey: options.initialData?.apiKey ?? '',
            activePresetId: options.initialData?.activePresetId,
        };

        // 1. 初始化 Card 容器外壳
        this.card = new Card({
            title: options.title ?? '服务连接',
            subtitle: options.subtitle,
        });
        this.element = this.card.element;
        this.element.classList.add('da-connection-card');
        this.disposables.push(this.card);

        // 2. 初始化头部右上角状态指示徽标
        this.statusBadge = new Badge({
            text: '未探测',
            variant: 'neutral',
            dot: true,
        });
        this.statusBadge.element.addEventListener('click', () => {
            if (this.lastErrorDetails) {
                this.showErrorDetailsModal();
            }
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
                label: '服务商预设',
                tooltip: '快速填入主流 OpenAI 兼容云端服务的标准基础地址',
                control: this.presetSelect,
            });
            this.card.appendContent(presetField.element);
            this.disposables.push(this.presetSelect, presetField);
        }

        // 3.2 服务地址与测试操作单行流式排布 (.da-connection-row)
        // 左侧输入框居中且自适应占满剩余空间，右侧紧跟合并后的“测试连接与同步”主操作按钮，彻底删除冗余的“Url”字段标签
        this.connectionRow = document.createElement('div');
        this.connectionRow.classList.add('da-connection-row');

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

        const hasAssetSync = Boolean(options.onFetchAssets || this.hasCustomFetchAssetList());
        this.actionButton = new Button({
            label: hasAssetSync ? '测试连接与同步' : '测试连接',
            variant: 'primary',
            size: 'sm',
            className: 'da-connection-btn--sync',
            onClick: async () => {
                await this.triggerPingAndSync();
            },
        });

        this.connectionRow.appendChild(this.urlInput.element);
        this.connectionRow.appendChild(this.actionButton.element);

        this.card.appendContent(this.connectionRow);
        this.disposables.push(this.urlInput, this.actionButton);

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
                label: 'API Key',
                tooltip: '访问受保护服务接口所需的认证密钥或 Bearer Token',
                control: this.apiKeyInput,
            });
            this.card.appendContent(this.apiKeyFormField.element);
            this.disposables.push(this.apiKeyInput, this.apiKeyFormField);
        }
    }

    /**
     * 获取当前卡片完整的表单数据副本。
     */
    public getData(): ConnectionCardData {
        return {
            serverUrl: this.data.serverUrl,
            apiKey: this.data.apiKey,
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
        this.resetStatusToIdle();
    }

    /**
     * 设置字段脏状态指示。
     */
    public setDirty(isDirty: boolean): void {
        this.urlInput.setDirty(isDirty);
        if (isDirty) {
            this.connectionRow.classList.add('da-form-row--dirty');
        } else {
            this.connectionRow.classList.remove('da-form-row--dirty');
        }
        this.apiKeyFormField?.setDirty(isDirty);
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
        this.actionButton.setLoading(true);

        try {
            const result = await this.options.onTestPing(this.data.serverUrl, this.data.apiKey);
            if (result.status === 'ok') {
                const latencyText = result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : '';
                this.lastErrorDetails = null;
                this.updateBadge('success', `已连接${latencyText}`);
                this.statusBadge.element.removeAttribute('title');
                this.statusBadge.element.style.cursor = 'default';
            } else {
                const rawMsg = result.message || '网络连接异常';
                this.lastErrorDetails = { url: this.data.serverUrl, message: rawMsg };
                this.updateBadge('danger', '连接失败');
                this.statusBadge.element.title = '点击查看排查指引与详细错误';
                this.statusBadge.element.style.cursor = 'pointer';
                const briefMsg = rawMsg.length > 50 ? `${rawMsg.slice(0, 50)}...` : rawMsg;
                Toast.error(`服务连接失败: ${briefMsg}`);
            }
            return result;
        } catch (err) {
            const msg = (err as Error)?.message || '网络异常';
            this.lastErrorDetails = { url: this.data.serverUrl, message: msg };
            this.updateBadge('danger', '探测异常');
            this.statusBadge.element.title = '点击查看排查指引与详细错误';
            this.statusBadge.element.style.cursor = 'pointer';
            Toast.error(`服务探测异常: ${msg}`);
            return { status: 'error', message: msg };
        } finally {
            this.actionButton.setLoading(false);
            this.pingAbortController = null;
        }
    }

    /**
     * 弹出服务连接排查与错误详情模态对话框。
     */
    public showErrorDetailsModal(): void {
        if (!this.lastErrorDetails) return;
        const { url, message } = this.lastErrorDetails;
        const formattedMsg = [
            `【请求地址】\n${url || '(未设置服务地址)'}`,
            `\n【错误详情】\n${message}`,
            `\n【排查建议】\n1. 请检查生图服务（如 ComfyUI / SD-WebUI / Forge）是否已在后台启动；\n2. 检查上方服务地址与端口是否正确输入；\n3. 若在浏览器中遇到跨域 (CORS) 拦截，可在「常规设置」中开启“酒馆代理”模式。`,
        ].join('\n');

        void ConfirmDialog.info({
            title: '服务连接排查指引',
            message: formattedMsg,
            confirmText: '我知道了',
            copyText: `服务地址: ${url}\n错误信息: ${message}`,
        });
    }

    /**
     * 获取最近一次失败的错误详情数据。
     */
    public getLastErrorDetails(): { url: string; message: string } | null {
        return this.lastErrorDetails;
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

        this.actionButton.setLoading(true);

        try {
            return await executor(this.data.serverUrl, this.data.apiKey);
        } catch (err) {
            logger.error('[ConnectionCard] 拉取模型资产失败:', err instanceof Error ? err.message : String(err));
            return null;
        } finally {
            this.actionButton.setLoading(false);
            this.assetAbortController = null;
        }
    }

    /**
     * 触发一键连通性测试与资产同步。
     *
     * @remarks
     * 先进行健康连通探测；当且仅当连通成功且具备资产拉取能力时，立即自动级联同步模型等资产。
     */
    public async triggerPingAndSync(): Promise<{
        ping: ProviderHealthResult | null;
        assets: AssetFetchResult | null;
    }> {
        const pingResult = await this.triggerPing();
        if (pingResult?.status === 'ok' && (this.options.onFetchAssets || this.hasCustomFetchAssetList())) {
            const assetResult = await this.triggerFetchAssets();
            return { ping: pingResult, assets: assetResult };
        }
        return { ping: pingResult, assets: null };
    }

    /**
     * 可重载的资产拉取扩展函数（子类可重载定制具体后端资产解析协议）。
     */
    public async fetchAssetList?(serverUrl: string, apiKey?: string): Promise<AssetFetchResult>;

    private hasCustomFetchAssetList(): boolean {
        return typeof this.fetchAssetList === 'function';
    }

    private resetStatusToIdle(): void {
        this.lastErrorDetails = null;
        this.statusBadge.element.removeAttribute('title');
        this.statusBadge.element.style.cursor = 'default';
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
