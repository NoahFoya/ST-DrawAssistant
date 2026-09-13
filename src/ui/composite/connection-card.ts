/**
 * 后端健康检查与连接卡片组件 (ConnectionCard)
 * 遵循 UI_LAYOUT_PREVIEW.md 第四节第 2 条：
 * 展示后端服务地址、连通性状态指示灯、响应延迟与一键连通性探测及远端资产拉取更新。
 */

import type { HealthCheckFn, ConnectionCardStatus } from '@types';
import { createButton, ButtonHandle } from '../components/button';
import { createBadge, BadgeHandle } from '../components/feedback';
import { createTextInput, createPasswordInput, TextInputHandle, PasswordInputHandle } from '../components/input';
import { createFormField, FormFieldHandle } from '../components/form-field';
import { Toast } from '../components/feedback';

export interface TokenFieldOptions {
    value: string;
    label?: string;
    helpText?: string;
    placeholder?: string;
    onChange: (token: string) => void;
}

export interface ConnectionCardOptions {
    engineName: string;
    baseUrl: string;
    onCheckHealth: HealthCheckFn;
    editableUrl?: boolean;
    onChangeBaseUrl?: (url: string) => void;
    tokenField?: TokenFieldOptions;
    onAssetUpdate?: (assets: Record<string, unknown>, summary?: string) => void;
    autoCheck?: boolean;
    className?: string;
}

export interface ConnectionCardHandle {
    readonly element: HTMLElement;
    checkConnection(): Promise<void>;
    setBaseUrl(url: string): void;
    getBaseUrl(): string;
    dispose(): void;
}

export function createConnectionCard(options: ConnectionCardOptions): ConnectionCardHandle {
    const card = document.createElement('div');
    card.className = 'da-connection-card da-card';
    if (options.className) card.classList.add(options.className);

    let currentUrl = options.baseUrl;
    let abortController: AbortController | null = null;
    const disposers: (() => void)[] = [];
    const regDisposer = (h?: { dispose?: () => void }) => {
        if (h && typeof h.dispose === 'function') {
            disposers.push(() => h.dispose!());
        }
    };

    // 1. 顶部状态与信息行
    const header = document.createElement('div');
    header.className = 'da-connection-card__header';

    const infoBox = document.createElement('div');
    infoBox.className = 'da-connection-card__info';

    const titleEl = document.createElement('div');
    titleEl.className = 'da-connection-card__title';
    titleEl.textContent = `${options.engineName} 服务连接`;

    const urlEl = document.createElement('div');
    urlEl.className = 'da-connection-card__url';
    urlEl.textContent = currentUrl || '未配置服务地址';

    infoBox.appendChild(titleEl);
    if (!options.editableUrl && !options.onChangeBaseUrl) {
        infoBox.appendChild(urlEl);
    }

    // 状态徽标与延迟标签
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'da-connection-card__badge-wrap';

    const latencyEl = document.createElement('span');
    latencyEl.className = 'da-connection-card__latency';
    latencyEl.style.display = 'none';

    const badge: BadgeHandle = createBadge({
        text: '未检测',
        variant: 'muted',
        pulseDot: false
    });

    badgeWrap.appendChild(latencyEl);
    badgeWrap.appendChild(badge.element);

    header.appendChild(infoBox);
    header.appendChild(badgeWrap);
    card.appendChild(header);

    // 2. 服务地址与测试连接行 (可编辑模式)
    let urlInputHandle: TextInputHandle | null = null;
    let testBtn: ButtonHandle;

    testBtn = createButton({
        text: '测试连接',
        variant: 'secondary',
        size: 'sm',
        icon: 'refresh',
        onClick: () => {
            handleCheck();
        }
    });
    regDisposer(testBtn);

    if (options.editableUrl || options.onChangeBaseUrl) {
        const urlRow = document.createElement('div');
        urlRow.className = 'da-connection-card__input-row';
        urlRow.style.display = 'flex';
        urlRow.style.alignItems = 'center';
        urlRow.style.gap = '8px';
        urlRow.style.padding = '8px 12px';

        urlInputHandle = createTextInput({
            value: currentUrl,
            placeholder: `请输入 ${options.engineName} 服务地址 (如 http://127.0.0.1:...)`,
            variant: 'normal',
            onChange: (val) => {
                currentUrl = val.trim();
                urlEl.textContent = currentUrl || '未配置服务地址';
                options.onChangeBaseUrl?.(currentUrl);
            }
        });
        regDisposer(urlInputHandle);

        const inputWrapper = document.createElement('div');
        inputWrapper.style.flex = '1';
        inputWrapper.appendChild(urlInputHandle.element);

        urlRow.appendChild(inputWrapper);
        urlRow.appendChild(testBtn.element);
        card.appendChild(urlRow);
    }

    // 3. 可选凭据扩展行 (如 NovelAI API Token)
    let tokenHandle: PasswordInputHandle | null = null;
    if (options.tokenField) {
        const tokenWrap = document.createElement('div');
        tokenWrap.className = 'da-connection-card__token-row';
        tokenWrap.style.padding = '0 12px 8px 12px';

        tokenHandle = createPasswordInput({
            value: options.tokenField.value,
            placeholder: options.tokenField.placeholder || '请输入 API Token / 密钥...',
            onChange: (val) => {
                options.tokenField?.onChange(val);
            }
        });
        regDisposer(tokenHandle);

        const tokenFormField: FormFieldHandle = createFormField({
            label: options.tokenField.label || 'API Token',
            helpText: options.tokenField.helpText || '访问该生图引擎所需的私有 API 认证凭据',
            control: tokenHandle
        });
        regDisposer(tokenFormField);

        tokenWrap.appendChild(tokenFormField.element);
        card.appendChild(tokenWrap);
    }

    // 4. 诊断反馈与资产更新摘要区 (默认收起)
    const feedbackEl = document.createElement('div');
    feedbackEl.className = 'da-connection-card__feedback';
    feedbackEl.style.display = 'none';
    card.appendChild(feedbackEl);

    // 5. 若非编辑模式，则将按钮置于底部操作栏
    if (!options.editableUrl && !options.onChangeBaseUrl) {
        const actions = document.createElement('div');
        actions.className = 'da-connection-card__actions';
        actions.appendChild(testBtn.element);
        card.appendChild(actions);
    }

    const updateStatus = (status: ConnectionCardStatus, message?: string, latencyMs?: number, assetsSummary?: string) => {
        card.classList.remove('is-online', 'is-offline', 'is-checking');

        if (status === 'checking') {
            card.classList.add('is-checking');
            badge.setText('检测与拉取中...');
            badge.setVariant('warn');
            latencyEl.style.display = 'none';
            feedbackEl.style.display = 'none';
            testBtn.setLoading(true, '检测中...');
        } else if (status === 'online') {
            card.classList.add('is-online');
            badge.setText('连接正常');
            badge.setVariant('success');
            testBtn.setLoading(false);

            if (typeof latencyMs === 'number') {
                latencyEl.textContent = `${latencyMs} ms`;
                latencyEl.style.display = '';
            }

            if (assetsSummary) {
                feedbackEl.textContent = `✓ 已连通 (${latencyMs ?? 0}ms) · ${assetsSummary}`;
                feedbackEl.style.color = 'var(--da-success, #10b981)';
                feedbackEl.style.display = '';
            } else {
                feedbackEl.style.display = 'none';
            }
        } else if (status === 'offline') {
            card.classList.add('is-offline');
            badge.setText('连接失败');
            badge.setVariant('error');
            testBtn.setLoading(false);
            latencyEl.style.display = 'none';

            if (message) {
                feedbackEl.textContent = `✗ ${message}`;
                feedbackEl.style.color = 'var(--da-danger, #ef4444)';
                feedbackEl.style.display = '';
            }
        } else {
            badge.setText('未检测');
            badge.setVariant('muted');
            testBtn.setLoading(false);
            latencyEl.style.display = 'none';
            feedbackEl.style.display = 'none';
        }
    };

    const handleCheck = async () => {
        if (!currentUrl) {
            updateStatus('offline', '服务地址未配置，请输入有效地址');
            Toast.warn('请先输入服务地址');
            return;
        }

        if (abortController) {
            abortController.abort();
        }
        abortController = new AbortController();

        updateStatus('checking');

        try {
            const result = await options.onCheckHealth(abortController.signal);
            if (result.ok) {
                updateStatus('online', undefined, result.latencyMs, result.assetsSummary);
                const toastMsg = result.assetsSummary
                    ? `${options.engineName} 连通成功 (${result.latencyMs ?? 0}ms) · ${result.assetsSummary}`
                    : `${options.engineName} 连接正常 (${result.latencyMs ?? 0}ms)`;
                Toast.success(toastMsg);

                if (result.assets) {
                    options.onAssetUpdate?.(result.assets, result.assetsSummary);
                }
            } else {
                updateStatus('offline', result.message || '连接失败，请确认服务已启动');
                Toast.error(result.message || '连接失败，请检查服务状态');
            }
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            const errMsg = err?.message || '网络连接异常';
            updateStatus('offline', errMsg);
            Toast.error(errMsg);
        } finally {
            abortController = null;
        }
    };

    if (options.autoCheck && currentUrl) {
        handleCheck();
    }

    return {
        element: card,
        async checkConnection(): Promise<void> {
            await handleCheck();
        },
        setBaseUrl(url: string): void {
            currentUrl = url;
            if (urlInputHandle) {
                urlInputHandle.setValue(url);
            }
            urlEl.textContent = currentUrl || '未配置服务地址';
            updateStatus('idle');
        },
        getBaseUrl(): string {
            return currentUrl;
        },
        dispose(): void {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
            for (const d of disposers) {
                d();
            }
            card.remove();
        }
    };
}
