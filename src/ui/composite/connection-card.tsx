/**
 * 通用服务连接卡片 (ConnectionCard)。
 *
 * @remarks
 * 基于 Preact JSX 为生图服务提供方（ComfyUI、SD-WebUI/Forge、NovelAI、OpenAI 兼容、Google Gemini、xAI Grok）
 * 提供统一的服务连接卡片：
 * 1. 服务地址 (Base URL) 与可选鉴权密钥 (API Key/Token) 受控表单输入；
 * 2. 可选的服务商预设模板切换；
 * 3. 连通性检测 (onTestPing) 与 RTT 延迟状态徽标反馈、补全建议条；
 * 4. 可选的模型列表拉取联动 (onFetchAssets)；
 * 5. 组件卸载时自动中止未完成的异步检测请求。
 */

import type { VNode } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import type { ProviderHealthResult, ProviderType } from '@types';
import type { SelectOption } from '../components/select';
import type { BadgeVariant } from '../components/badge';
import {
    CardView,
    FormFieldView,
    SelectControl,
    TextInputControl,
    ButtonControl,
} from '../framework/controls';
import {
    logConnectionFailure,
    showConnectionDiagnosticsModal,
} from '../feedback/error-feedback';
import { Toast } from '../feedback/toast';
import { eventBus } from '../../util/event-bus';

/** 服务商预设模板定义 */
export interface ProviderPreset {
    readonly id: string;
    readonly label: string;
    readonly defaultUrl: string;
    /** 地址是否允许用户编辑，默认 true；为 false 时隐藏地址输入框（地址由服务商固定） */
    readonly urlEditable?: boolean;
}

/** 连接卡片当前数据状态 */
export interface ConnectionCardData {
    serverUrl: string;
    apiKey?: string;
    activePresetId?: string;
}

/** 模型列表拉取结果 */
export interface AssetFetchResult {
    readonly count: number;
    readonly message?: string;
}

export interface ConnectionCardProps {
    /** 所属生图服务类型（用于定制连接排错建议与状态事件分发） */
    providerType?: ProviderType;
    /** 卡片主标题，默认 "服务连接" */
    title?: string;
    /** 卡片副标题说明 */
    subtitle?: string;
    /** 受控外部数据 */
    data?: Partial<ConnectionCardData>;
    /** 初始数据（非受控/独立渲染时使用） */
    initialData?: Partial<ConnectionCardData>;
    /** 服务地址输入提示，默认 "http://127.0.0.1:8188" */
    urlPlaceholder?: string;
    /** 是否展示 API Key 鉴权凭据输入框，默认 false */
    showApiKey?: boolean;
    /** API Key 输入框占位提示 */
    apiKeyPlaceholder?: string;
    /** API Key 输入框悬浮说明 */
    apiKeyTooltip?: string;
    /** 可选的服务商预设模板列表 */
    providerPresets?: ProviderPreset[];
    /** 服务商下拉的字段标签，默认 "服务商" */
    presetLabel?: string;
    /** 服务商下拉的悬浮说明 */
    presetTooltip?: string;
    /** 脏状态指示 */
    dirty?: boolean;
    /**
     * 服务商切换回调。提供后由外部接管地址与密钥的切换（卡片不再用模板默认地址覆盖地址框），
     * 返回 false 时自动回滚下拉选中值。
     */
    onPresetChange?: (presetId: string) => void | boolean;
    /** 连通性检测处理函数 */
    onTestPing?: (
        serverUrl: string,
        apiKey?: string,
        signal?: AbortSignal
    ) => Promise<ProviderHealthResult>;
    /** 模型列表拉取处理函数（若不提供则仅渲染“测试连接”） */
    onFetchAssets?: (
        serverUrl: string,
        apiKey?: string,
        signal?: AbortSignal
    ) => Promise<AssetFetchResult>;
    /** 数据变更回调 */
    onChange?: (data: ConnectionCardData) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

export type ConnectionCardOptions = ConnectionCardProps;

interface ConnectionStatusState {
    variant: BadgeVariant;
    text: string;
    title?: string;
    clickable: boolean;
    errorDetails: { url: string; message: string } | null;
    suggestedUrl: string | null;
}

const IDLE_STATUS: ConnectionStatusState = {
    variant: 'neutral',
    text: '未检测',
    clickable: false,
    errorDetails: null,
    suggestedUrl: null,
};

function buildPresetOptions(presets?: ProviderPreset[]): SelectOption[] {
    if (!presets || presets.length === 0) {
        return [];
    }
    const list: SelectOption[] = presets.map((p) => ({
        value: p.id,
        label: p.label,
    }));
    if (!list.some((p) => p.value === 'custom')) {
        list.push({ value: 'custom', label: '自定义服务' });
    }
    return list;
}

function resolveValidPresetId(
    candidateId: string | undefined,
    providerPresets: ProviderPreset[] | undefined,
    presetOptions: SelectOption[],
    serverUrl: string
): string {
    const ids = presetOptions.map((p) => p.value).filter((v) => v.length > 0);
    if (candidateId && ids.includes(candidateId)) {
        return candidateId;
    }
    const normalizedUrl = serverUrl.trim().replace(/\/+$/, '');
    if (normalizedUrl && providerPresets) {
        const byUrl = providerPresets.find(
            (p) => p.defaultUrl && p.defaultUrl.replace(/\/+$/, '') === normalizedUrl
        );
        if (byUrl) {
            return byUrl.id;
        }
    }
    if (ids.includes('custom')) {
        return 'custom';
    }
    return ids[0] ?? '';
}

function normalizeIncomingData(
    src: Partial<ConnectionCardData> | undefined,
    providerPresets: ProviderPreset[] | undefined,
    presetOptions: SelectOption[]
): ConnectionCardData {
    const serverUrl = src?.serverUrl ?? '';
    return {
        serverUrl,
        apiKey: src?.apiKey ?? '',
        activePresetId:
            presetOptions.length > 0
                ? resolveValidPresetId(src?.activePresetId, providerPresets, presetOptions, serverUrl)
                : src?.activePresetId,
    };
}

export function ConnectionCard(props: ConnectionCardProps): VNode {
    const presetOptions = buildPresetOptions(props.providerPresets);
    const controlledSrc = props.data ?? props.initialData;
    const normalizedExternal = normalizeIncomingData(
        controlledSrc,
        props.providerPresets,
        presetOptions
    );
    const externalJson = JSON.stringify(normalizedExternal);

    const [, setTick] = useState(0);
    const stateRef = useRef<{
        data: ConnectionCardData;
        status: ConnectionStatusState;
        isTesting: boolean;
    } | null>(null);
    if (!stateRef.current) {
        stateRef.current = {
            data: normalizedExternal,
            status: IDLE_STATUS,
            isTesting: false,
        };
    }

    const isDisposedRef = useRef(false);
    const pingAbortRef = useRef<AbortController | null>(null);
    const assetAbortRef = useRef<AbortController | null>(null);
    const prevPropJsonRef = useRef<string>(externalJson);
    const latestDataRef = useRef<ConnectionCardData>(stateRef.current.data);
    const propsRef = useRef(props);
    propsRef.current = props;

    // 当外部受控 `props.data` 发生变化时同步本地数据并重置连通性状态（直接更新 stateRef，避免在渲染期间调用 setState 破坏 Preact hooks 上下文）
    if (props.data !== undefined && externalJson !== prevPropJsonRef.current) {
        prevPropJsonRef.current = externalJson;
        latestDataRef.current = normalizedExternal;
        if (pingAbortRef.current) {
            pingAbortRef.current.abort();
            pingAbortRef.current = null;
        }
        if (assetAbortRef.current) {
            assetAbortRef.current.abort();
            assetAbortRef.current = null;
        }
        stateRef.current = {
            data: normalizedExternal,
            status: IDLE_STATUS,
            isTesting: false,
        };
    }

    const forceRender = () => {
        if (!isDisposedRef.current) {
            setTick((n) => n + 1);
        }
    };

    const setLocalData = (nextData: ConnectionCardData) => {
        stateRef.current = { ...stateRef.current!, data: nextData };
        forceRender();
    };
    const setStatusState = (nextStatus: ConnectionStatusState) => {
        stateRef.current = { ...stateRef.current!, status: nextStatus };
        forceRender();
    };
    const setIsTesting = (testing: boolean) => {
        stateRef.current = { ...stateRef.current!, isTesting: testing };
        forceRender();
    };

    const localData = stateRef.current.data;
    const statusState = stateRef.current.status;
    const isTesting = stateRef.current.isTesting;

    useEffect(() => {
        isDisposedRef.current = false;
        return () => {
            isDisposedRef.current = true;
            if (pingAbortRef.current) {
                pingAbortRef.current.abort();
                pingAbortRef.current = null;
            }
            if (assetAbortRef.current) {
                assetAbortRef.current.abort();
                assetAbortRef.current = null;
            }
        };
    }, []);

    const emitHealthUpdate = (result: ProviderHealthResult | null) => {
        const providerType = propsRef.current.providerType;
        if (!providerType) return;
        eventBus.emit('provider:health-updated', {
            providerType,
            result,
        });
    };

    const resetStatusToIdle = (emitEvent = true) => {
        if (pingAbortRef.current) {
            pingAbortRef.current.abort();
            pingAbortRef.current = null;
        }
        if (assetAbortRef.current) {
            assetAbortRef.current.abort();
            assetAbortRef.current = null;
        }
        setIsTesting(false);
        setStatusState(IDLE_STATUS);
        if (emitEvent) {
            emitHealthUpdate(null);
        }
    };

    const commitLocalData = (nextData: ConnectionCardData) => {
        latestDataRef.current = nextData;
        if (propsRef.current.data !== undefined) {
            prevPropJsonRef.current = JSON.stringify(nextData);
        }
        setLocalData(nextData);
        resetStatusToIdle(true);
        propsRef.current.onChange?.({ ...nextData });
    };

    const handleConnectionFailure = (
        logScope: string,
        toastMessage: string,
        rawMessage: string,
        targetUrl: string,
        rawError?: unknown
    ) => {
        setStatusState({
            variant: 'danger',
            text: '连接失败',
            title: '点击查看排查指引与详细错误',
            clickable: true,
            errorDetails: { url: targetUrl, message: rawMessage },
            suggestedUrl: null,
        });
        logConnectionFailure({
            scope: logScope,
            providerType: propsRef.current.providerType,
            url: targetUrl,
            message: rawMessage,
            rawError,
        });
        Toast.error(toastMessage);
    };

    const runPing = async (snapshot: ConnectionCardData): Promise<ProviderHealthResult | null> => {
        const testPing = propsRef.current.onTestPing;
        if (!testPing || isDisposedRef.current) {
            return null;
        }

        if (pingAbortRef.current) {
            pingAbortRef.current.abort();
        }
        const controller = new AbortController();
        pingAbortRef.current = controller;

        setStatusState({
            variant: 'info',
            text: '检测中...',
            clickable: false,
            errorDetails: null,
            suggestedUrl: null,
        });
        setIsTesting(true);

        try {
            const result = await testPing(snapshot.serverUrl, snapshot.apiKey, controller.signal);
            if (isDisposedRef.current || pingAbortRef.current !== controller || controller.signal.aborted) {
                return null;
            }
            if (result.status === 'ok') {
                const latencyText = result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : '';
                setStatusState({
                    variant: 'success',
                    text: `已连接${latencyText}`,
                    title: result.message || undefined,
                    clickable: false,
                    errorDetails: null,
                    suggestedUrl: null,
                });
                emitHealthUpdate(result);
            } else if (result.suggestedUrl) {
                const rawMsg = result.message || `检测到可用地址: ${result.suggestedUrl}`;
                setStatusState({
                    variant: 'warning',
                    text: '地址需补全',
                    title: rawMsg,
                    clickable: true,
                    errorDetails: { url: snapshot.serverUrl, message: rawMsg },
                    suggestedUrl: result.suggestedUrl,
                });
                Toast.info('检测到可用地址，点击「应用」补全后即可连接');
                emitHealthUpdate(result);
            } else {
                const rawMsg = result.message || '网络连接异常';
                handleConnectionFailure(
                    'ConnectionCard',
                    '服务连接失败，请点击状态徽标或前往「日志与统计」查看详情',
                    rawMsg,
                    snapshot.serverUrl
                );
                emitHealthUpdate(result);
            }
            return result;
        } catch (err) {
            if (
                isDisposedRef.current ||
                pingAbortRef.current !== controller ||
                controller.signal.aborted ||
                (err instanceof DOMException && err.name === 'AbortError')
            ) {
                return null;
            }
            const msg = err instanceof Error ? err.message : String(err || '网络异常');
            handleConnectionFailure(
                'ConnectionCard',
                '服务连接失败，请点击状态徽标或前往「日志与统计」查看详情',
                msg,
                snapshot.serverUrl,
                err
            );
            const failureResult: ProviderHealthResult = { status: 'error', message: msg };
            emitHealthUpdate(failureResult);
            return failureResult;
        } finally {
            if (!isDisposedRef.current && pingAbortRef.current === controller) {
                pingAbortRef.current = null;
                setIsTesting(false);
            }
        }
    };

    const runFetchAssets = async (snapshot: ConnectionCardData): Promise<AssetFetchResult | null> => {
        const fetchAssets = propsRef.current.onFetchAssets;
        if (!fetchAssets || isDisposedRef.current) {
            return null;
        }

        if (assetAbortRef.current) {
            assetAbortRef.current.abort();
        }
        const controller = new AbortController();
        assetAbortRef.current = controller;
        setIsTesting(true);

        try {
            const res = await fetchAssets(snapshot.serverUrl, snapshot.apiKey, controller.signal);
            if (isDisposedRef.current || assetAbortRef.current !== controller || controller.signal.aborted) {
                return null;
            }
            return res;
        } catch (err) {
            if (
                isDisposedRef.current ||
                assetAbortRef.current !== controller ||
                controller.signal.aborted ||
                (err instanceof DOMException && err.name === 'AbortError')
            ) {
                return null;
            }
            const msg = err instanceof Error ? err.message : String(err || '网络异常');
            handleConnectionFailure(
                'ConnectionCard/Assets',
                '获取模型列表失败，请点击状态徽标或前往「日志与统计」查看详情',
                msg,
                snapshot.serverUrl,
                err
            );
            emitHealthUpdate({ status: 'error', message: msg });
            return null;
        } finally {
            if (!isDisposedRef.current && assetAbortRef.current === controller) {
                assetAbortRef.current = null;
                setIsTesting(false);
            }
        }
    };

    const runPingAndSync = async (snapshot: ConnectionCardData) => {
        const pingResult = await runPing(snapshot);
        if (!isDisposedRef.current && pingResult?.status === 'ok' && propsRef.current.onFetchAssets) {
            await runFetchAssets(snapshot);
        }
    };

    const applySuggestedUrl = () => {
        const nextUrl = statusState.suggestedUrl;
        if (!nextUrl || isDisposedRef.current) {
            return;
        }
        const nextData: ConnectionCardData = {
            ...latestDataRef.current,
            serverUrl: nextUrl,
        };
        commitLocalData(nextData);
        void runPingAndSync(nextData);
    };

    const activePreset = props.providerPresets?.find((p) => p.id === localData.activePresetId);
    const isUrlHidden = activePreset?.urlEditable === false;
    const hasAssetSync = Boolean(props.onFetchAssets);
    const cardClasses = ['da-connection-card', props.className || ''].filter(Boolean).join(' ');

    const badgeNode = (
        <span
            className={`da-badge da-badge--${statusState.variant}${statusState.clickable ? ' is-clickable' : ''}`}
            title={statusState.title}
            onClick={() => {
                if (statusState.errorDetails) {
                    void showConnectionDiagnosticsModal({
                        url: statusState.errorDetails.url,
                        message: statusState.errorDetails.message,
                        providerType: props.providerType,
                    });
                }
            }}
        >
            <span className="da-badge__dot" />
            <span className="da-badge__text">{statusState.text}</span>
        </span>
    );

    const actionButtonNode = (
        <ButtonControl
            label={hasAssetSync ? '测试连接/同步模型' : '测试连接'}
            variant="primary"
            size="sm"
            loading={isTesting}
            className="da-connection-btn--sync"
            onClick={async () => {
                await runPingAndSync(latestDataRef.current);
            }}
        />
    );

    return (
        <CardView
            title={props.title ?? '服务连接'}
            subtitle={props.subtitle}
            dirty={props.dirty}
            className={cardClasses}
            badges={badgeNode}
            actions={actionButtonNode}
        >
            {presetOptions.length > 0 && (
                <FormFieldView
                    label={props.presetLabel ?? '服务商'}
                    tooltip={props.presetTooltip ?? '选择云端生图服务商或自定义服务地址'}
                >
                    <SelectControl
                        value={localData.activePresetId ?? presetOptions[0]?.value ?? ''}
                        options={presetOptions}
                        onChange={(presetId) => {
                            if (props.onPresetChange) {
                                // 清空比对快照以便外部回写同内容连接信息也能正常同步
                                prevPropJsonRef.current = '';
                                const accepted = props.onPresetChange(presetId);
                                if (accepted === false) {
                                    return false;
                                }
                                const nextData: ConnectionCardData = {
                                    ...latestDataRef.current,
                                    activePresetId: presetId,
                                };
                                latestDataRef.current = nextData;
                                setLocalData(nextData);
                                return undefined;
                            }
                            const matched = props.providerPresets?.find((p) => p.id === presetId);
                            const nextData: ConnectionCardData = {
                                ...latestDataRef.current,
                                activePresetId: presetId,
                                serverUrl: matched ? matched.defaultUrl : latestDataRef.current.serverUrl,
                            };
                            commitLocalData(nextData);
                            return undefined;
                        }}
                    />
                </FormFieldView>
            )}

            <FormFieldView
                label="服务地址"
                tooltip="生图后端的 HTTP/WebSocket 基础地址。本地部署时通常为 http://127.0.0.1:端口；若跨设备访问需配置局域网地址、端口映射或公网 IP。"
                hidden={isUrlHidden}
                dirty={props.dirty}
                className={isUrlHidden ? 'da-hidden' : undefined}
            >
                <TextInputControl
                    value={localData.serverUrl}
                    placeholder={props.urlPlaceholder ?? 'http://127.0.0.1:8188'}
                    clearable={true}
                    dirty={props.dirty}
                    onChange={(val) => {
                        commitLocalData({
                            ...latestDataRef.current,
                            serverUrl: val,
                        });
                    }}
                />
            </FormFieldView>

            <div className={`da-connection-suggestion${statusState.suggestedUrl ? '' : ' da-hidden'}`}>
                <span
                    className="da-connection-suggestion__text"
                    title={statusState.suggestedUrl || undefined}
                >
                    {statusState.suggestedUrl ? `检测到可用地址: ${statusState.suggestedUrl}` : ''}
                </span>
                <ButtonControl
                    label="应用"
                    variant="primary"
                    size="sm"
                    className="da-connection-suggestion__btn"
                    onClick={() => applySuggestedUrl()}
                />
            </div>

            {props.showApiKey && (
                <FormFieldView
                    label="API Key"
                    tooltip={
                        props.apiKeyTooltip ??
                        '访问受保护云端接口所需的认证凭证（如 Bearer Token / API Key）。在向后端发送请求时自动附加在 Authorization 请求头中。'
                    }
                    dirty={props.dirty}
                >
                    <TextInputControl
                        value={localData.apiKey ?? ''}
                        placeholder={props.apiKeyPlaceholder ?? '输入 API Key 或访问令牌'}
                        type="password"
                        clearable={true}
                        onChange={(val) => {
                            commitLocalData({
                                ...latestDataRef.current,
                                apiKey: val,
                            });
                        }}
                    />
                </FormFieldView>
            )}
        </CardView>
    );
}
