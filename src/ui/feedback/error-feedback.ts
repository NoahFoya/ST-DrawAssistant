/**
 * 统一错误日志记录与连接诊断辅助模块。
 *
 * @remarks
 * 将运行期/网络/接口/文件读取异常的详细上下文统一写入 logger，
 * 避免将原始报错文本直接写入轻量 Toast 弹窗；同时为连接卡片与设置底栏提供一致的诊断弹窗。
 */

import type { ProviderType, TransportMode } from '@types';
import { settingsStore } from '../../store/settings-store';
import {
    buildTransportTroubleshootingLines,
    detectHostRuntime,
} from '../../util/http-client';
import { logger } from '../../util/logger';
import { ConfirmDialog } from './confirm-dialog';
import { Toast } from './toast';

export interface ConnectionErrorLogContext {
    /** 触发模块标识 */
    readonly scope: string;
    /** 生图服务类型 */
    readonly providerType?: ProviderType;
    /** 请求目标地址 */
    readonly url?: string;
    /** 结构化错误描述 */
    readonly message: string;
    /** 原始异常对象（可选） */
    readonly rawError?: unknown;
}

export interface ConnectionDiagnosticsOptions {
    /** 请求目标地址 */
    readonly url: string;
    /** 错误详情文本 */
    readonly message: string;
    /** 所属生图服务类型 */
    readonly providerType?: ProviderType;
    /** 可选的「重新检测」触发回调；传入时渲染双按钮确认弹窗 */
    readonly onRetry?: () => void;
}

/**
 * 统一写入运行时异常日志，并向用户展示固定简短的引导 Toast。
 */
export function reportRuntimeError(
    logTag: string,
    toastMessage: string,
    detail?: unknown,
    level: 'error' | 'warn' = 'error'
): void {
    if (level === 'warn') {
        if (detail !== undefined) {
            logger.warn(logTag, detail);
        } else {
            logger.warn(logTag);
        }
    } else if (detail !== undefined) {
        logger.error(logTag, detail);
    } else {
        logger.error(logTag);
    }
    Toast.error(toastMessage);
}

/**
 * 将服务连接或模型同步失败详情按统一格式写入全局日志缓冲区。
 */
export function logConnectionFailure(ctx: ConnectionErrorLogContext): void {
    const provider =
        ctx.providerType ?? (settingsStore.get('activeProvider') as ProviderType | undefined) ?? 'unknown';
    const targetUrl = ctx.url || '(未填写/使用默认地址)';
    const transport = (settingsStore.get('transport') || 'direct') as TransportMode;
    const summary = `[${ctx.scope}][${provider}] (${transport}) [${targetUrl}] 连接失败: ${ctx.message}`;
    if (ctx.rawError !== undefined) {
        logger.error(summary, ctx.rawError);
    } else {
        logger.error(summary);
    }
}

/**
 * 弹出统一的服务连接排查与错误详情模态对话框。
 */
export async function showConnectionDiagnosticsModal(
    options: ConnectionDiagnosticsOptions
): Promise<boolean> {
    const transport = (settingsStore.get('transport') || 'direct') as TransportMode;
    const hostRuntime = detectHostRuntime();
    const providerType =
        options.providerType ?? (settingsStore.get('activeProvider') as ProviderType | undefined);
    const tips = buildTransportTroubleshootingLines({
        transport,
        providerType,
        hostRuntime,
    });
    const transportLabel = transport === 'relay' ? '酒馆代理 (relay)' : '浏览器直连 (direct)';
    const formattedMsg = [
        `【请求地址】\n${options.url || '(未填写/使用默认地址)'}`,
        `\n【当前通道】\n${transportLabel} · ${hostRuntime.hostLabel}`,
        `\n【错误详情】\n${options.message}`,
        `\n【排查建议】\n${tips.join('\n')}`,
    ].join('\n');
    const copyText = `服务类型: ${providerType || 'unknown'}\n连接方式: ${transportLabel}\n宿主环境: ${hostRuntime.hostLabel}\n服务地址: ${options.url}\n错误信息: ${options.message}`;

    if (options.onRetry) {
        const retry = await ConfirmDialog.confirm({
            title: '服务连接排查指引',
            message: formattedMsg,
            confirmText: '重新检测',
            cancelText: '关闭',
            copyText,
        });
        if (retry) {
            options.onRetry();
        }
        return retry;
    }

    return ConfirmDialog.info({
        title: '服务连接排查指引',
        message: formattedMsg,
        confirmText: '我知道了',
        copyText,
    });
}
