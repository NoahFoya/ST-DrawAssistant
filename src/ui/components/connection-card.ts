/**
 * 后端连接测试与地址配置卡片 (ConnectionCard)
 * 由通用卡片容器、卡片头部、地址输入框与连通性测试按钮组合构建，
 * 并支持基于驱动协议需求挂载 API Key / Token 等凭据扩展栏。
 */

import { IDisposable } from '../../types';
import { createCard, createCardHeader, createRow, createFieldLabel } from '../layout/container-factory';

/** 驱动凭据扩展配置：针对需认证驱动 (如 NovelAI, OpenAI) 挂载凭据输入栏 */
export interface ConnectionCredentialExtension {
    /** 凭据显示名称 (如 'API Key' 或 'API Token') */
    title: string;
    /** 悬停提示说明 */
    helpTooltip?: string;
    /** 凭据用途说明 (向后兼容) */
    description?: string;
    /** 当前凭据值 */
    value?: string;
    /** 输入占位提示 */
    placeholder?: string;
    /** 凭据变更回调 */
    onChange: (newValue: string) => void;
}

/**
 * 后端连接配置卡片配置项
 */
export interface ConnectionCardOptions {
    /** 卡片标题 */
    title: string;
    /** 卡片描述说明 */
    description?: string;
    /** 绑定的目标地址 */
    url?: string;
    /** 当前生效地址 */
    currentUrl?: string;
    /** 默认回退地址 */
    defaultUrl?: string;
    /** 输入框占位文本 */
    placeholder?: string;
    /** 测试按钮文字 (默认: '测试连接') */
    buttonText?: string;
    /** URL 变更回调 */
    onUrlChange: (newUrl: string) => void;
    /** 点击测试连接回调 (支持接收卡片句柄协同状态流转) */
    onTest: (url: string, btn: HTMLButtonElement, card?: ConnectionCardElement) => Promise<void>;
    /** 驱动凭据扩展 (针对需鉴权驱动挂载凭据输入栏) */
    credentialExtension?: ConnectionCredentialExtension;
}

export type ConnectionFieldTarget = 'all' | 'url' | 'credential';

export interface ConnectionCardElement extends HTMLElement, IDisposable {
    input: HTMLInputElement;
    testBtn: HTMLButtonElement;
    credentialInput?: HTMLInputElement;
    toggleEyeBtn?: HTMLButtonElement;
    setStatus: (status: 'idle' | 'testing' | 'success' | 'error', text?: string) => void;
    setDirty: (isDirty: boolean, target?: ConnectionFieldTarget) => void;
    setError: (hasError: boolean, tooltip?: string, target?: ConnectionFieldTarget) => void;
    resetBaseline: () => void;
}

interface FieldInternalState {
    baseline: string;
    isDirty: boolean;
    hasError: boolean;
    errorTooltip: string;
}

/**
 * 统一根据脏值与失效状态更新输入框的类名与悬浮提示。
 * 规则：失效 (invalid) 优先级高于修改 (dirty)；无状态时自动清除 title 属性，避免互相覆盖冲突。
 */
function updateFieldVisual(field: HTMLInputElement, state: FieldInternalState): void {
    field.classList.toggle('is-invalid', state.hasError);
    field.classList.toggle('is-dirty', state.isDirty && !state.hasError);

    if (state.hasError) {
        field.title = state.errorTooltip;
    } else if (state.isDirty) {
        field.title = '已修改';
    } else {
        field.removeAttribute('title');
    }
}

/**
 * 创建标准后端连接配置卡片
 *
 * @param options 连接卡片配置项
 * @returns 强化卡片容器 DOM 节点 (包含 input, testBtn, 可选凭据栏, 状态反馈方法与 dispose 契约)
 */
export function createConnectionCard(options: ConnectionCardOptions): ConnectionCardElement {
    const card = createCard({ hoverable: true });
    const header = createCardHeader({
        title: options.title,
        description: options.description
    });
    card.header.appendChild(header);

    // 1. 服务地址与动作按钮行
    const targetUrl = options.url || options.currentUrl || options.defaultUrl || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'da-input da-input--text da-w-full';
    input.value = targetUrl;
    input.placeholder = options.placeholder || 'http://127.0.0.1:...';

    const urlState: FieldInternalState = {
        baseline: targetUrl,
        isDirty: false,
        hasError: false,
        errorTooltip: '已失效：无法连接到目标服务地址'
    };

    const syncUrl = () => {
        const trimmed = input.value.trim();
        options.onUrlChange(trimmed);
        // 用户主动修改输入内容时，自动解除前一次探测残留的失效状态
        if (urlState.hasError) {
            urlState.hasError = false;
        }
        urlState.isDirty = trimmed !== urlState.baseline;
        updateFieldVisual(input, urlState);
    };
    input.addEventListener('input', syncUrl);
    input.addEventListener('change', syncUrl);

    const defaultBtnText = options.buttonText || '测试连接';
    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'da-btn da-btn--secondary';
    testBtn.textContent = defaultBtnText;

    const credState: FieldInternalState = {
        baseline: options.credentialExtension?.value || '',
        isDirty: false,
        hasError: false,
        errorTooltip: '已失效：认证凭据无效'
    };

    let credentialInput: HTMLInputElement | undefined;

    const setStatus = (status: 'idle' | 'testing' | 'success' | 'error', text?: string) => {
        testBtn.classList.remove('is-loading', 'da-btn--success', 'da-btn--danger');
        if (status === 'testing') {
            testBtn.classList.add('is-loading');
            testBtn.disabled = true;
            testBtn.textContent = text || '连接中...';
        } else if (status === 'success') {
            testBtn.classList.add('da-btn--success');
            testBtn.disabled = false;
            testBtn.textContent = text || defaultBtnText;
            // 连通成功清除错误，并将当前输入固化为基准值
            urlState.hasError = false;
            urlState.baseline = input.value.trim();
            urlState.isDirty = false;
            updateFieldVisual(input, urlState);

            if (credentialInput) {
                credState.hasError = false;
                credState.baseline = credentialInput.value.trim();
                credState.isDirty = false;
                updateFieldVisual(credentialInput, credState);
            }
        } else if (status === 'error') {
            testBtn.classList.add('da-btn--danger');
            testBtn.disabled = false;
            testBtn.textContent = text || '连接失败';
            urlState.hasError = true;
            if (text) {
                urlState.errorTooltip = `已失效：${text}`;
            }
            updateFieldVisual(input, urlState);
        } else {
            testBtn.disabled = false;
            testBtn.textContent = text || defaultBtnText;
        }
    };

    const rootEl = card.root as ConnectionCardElement;

    const onTestClick = async () => {
        const trimmedUrl = input.value.trim();
        options.onUrlChange(trimmedUrl);
        if (credentialInput && options.credentialExtension) {
            options.credentialExtension.onChange(credentialInput.value.trim());
        }
        setStatus('testing');
        try {
            await options.onTest(trimmedUrl, testBtn, rootEl);
        } catch (err: any) {
            setStatus('error', err?.message || '连接失败');
        }
    };
    testBtn.addEventListener('click', onTestClick);

    const urlRow = createRow(['fill', 'auto'], {
        align: 'center',
        gap: '8px'
    });
    urlRow.slots[0].appendChild(input);
    urlRow.slots[1].appendChild(testBtn);
    card.body.appendChild(urlRow.root);

    // 2. 基于驱动需求挂载的凭据扩展行 (Token / API Key)
    let toggleEyeBtn: HTMLButtonElement | undefined;
    let syncCredential: (() => void) | undefined;
    let onToggleEye: (() => void) | undefined;

    if (options.credentialExtension) {
        const credExt = options.credentialExtension;
        const credId = `da-cred-input-${Math.random().toString(36).slice(2, 8)}`;
        const credRow = createRow(['left', 'right'], { align: 'center', divided: true });
        credRow.slots[0].appendChild(
            createFieldLabel({
                title: credExt.title,
                forId: credId,
                helpTooltip: credExt.helpTooltip,
                description: credExt.description
            })
        );

        const credContainer = document.createElement('div');
        credContainer.className = 'da-input-group';

        credentialInput = document.createElement('input');
        credentialInput.id = credId;
        credentialInput.type = 'password';
        credentialInput.className = 'da-input da-input--text da-w-full';
        credentialInput.value = credExt.value || '';
        credentialInput.placeholder = credExt.placeholder || '输入访问凭据...';

        syncCredential = () => {
            if (!credentialInput) return;
            const trimmed = credentialInput.value.trim();
            credExt.onChange(trimmed);
            if (credState.hasError) {
                credState.hasError = false;
            }
            credState.isDirty = trimmed !== credState.baseline;
            updateFieldVisual(credentialInput, credState);
        };
        credentialInput.addEventListener('input', syncCredential);
        credentialInput.addEventListener('change', syncCredential);

        const EYE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

        toggleEyeBtn = document.createElement('button');
        toggleEyeBtn.type = 'button';
        toggleEyeBtn.className = 'da-btn da-btn--secondary da-icon-btn';
        toggleEyeBtn.innerHTML = EYE_SVG;
        toggleEyeBtn.title = '显示/隐藏凭据';
        toggleEyeBtn.setAttribute('aria-label', '显示/隐藏凭据');

        onToggleEye = () => {
            if (!credentialInput || !toggleEyeBtn) return;
            if (credentialInput.type === 'password') {
                credentialInput.type = 'text';
                toggleEyeBtn.innerHTML = EYE_OFF_SVG;
            } else {
                credentialInput.type = 'password';
                toggleEyeBtn.innerHTML = EYE_SVG;
            }
        };
        toggleEyeBtn.addEventListener('click', onToggleEye);

        credContainer.appendChild(credentialInput);
        credContainer.appendChild(toggleEyeBtn);
        credRow.slots[1].appendChild(credContainer);
        card.body.appendChild(credRow.root);
    }

    rootEl.input = input;
    rootEl.testBtn = testBtn;
    rootEl.credentialInput = credentialInput;
    rootEl.toggleEyeBtn = toggleEyeBtn;
    rootEl.setStatus = setStatus;

    rootEl.setDirty = (isDirty: boolean, target: ConnectionFieldTarget = 'all') => {
        if (target === 'all' || target === 'url') {
            urlState.isDirty = isDirty;
            updateFieldVisual(input, urlState);
        }
        if (credentialInput && (target === 'all' || target === 'credential')) {
            credState.isDirty = isDirty;
            updateFieldVisual(credentialInput, credState);
        }
    };

    rootEl.setError = (hasError: boolean, tooltip?: string, target: ConnectionFieldTarget = 'url') => {
        if (target === 'all' || target === 'url') {
            urlState.hasError = hasError;
            if (tooltip) urlState.errorTooltip = tooltip;
            updateFieldVisual(input, urlState);
        }
        if (credentialInput && (target === 'all' || target === 'credential')) {
            credState.hasError = hasError;
            if (tooltip) credState.errorTooltip = tooltip;
            updateFieldVisual(credentialInput, credState);
        }
    };

    rootEl.resetBaseline = () => {
        urlState.baseline = input.value.trim();
        urlState.isDirty = false;
        urlState.hasError = false;
        updateFieldVisual(input, urlState);

        if (credentialInput) {
            credState.baseline = credentialInput.value.trim();
            credState.isDirty = false;
            credState.hasError = false;
            updateFieldVisual(credentialInput, credState);
        }
    };

    let isDisposed = false;
    rootEl.dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
        input.removeEventListener('input', syncUrl);
        input.removeEventListener('change', syncUrl);
        testBtn.removeEventListener('click', onTestClick);

        if (credentialInput && syncCredential) {
            credentialInput.removeEventListener('input', syncCredential);
            credentialInput.removeEventListener('change', syncCredential);
        }
        if (toggleEyeBtn && onToggleEye) {
            toggleEyeBtn.removeEventListener('click', onToggleEye);
        }

        rootEl.remove();
    };

    return rootEl;
}
