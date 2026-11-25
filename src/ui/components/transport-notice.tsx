/**
 * TauriTavern 代理不兼容提示条组件 (TauriRelayNotice)。
 *
 * 统一承载主设置页与快捷面板中的 TauriTavern `/proxy/` 限制警告与一键切回直连操作。
 */

import type { VNode } from 'preact';

export interface TauriRelayNoticeProps {
    /** 紧凑模式（用于悬浮球快捷面板） */
    compact?: boolean;
    /** 禁用态 */
    disabled?: boolean;
    /** 点击一键切换为浏览器直连回调 */
    onSwitchToDirect: () => void;
}

/**
 * 在当前宿主不支持 SillyTavern `/proxy/` 接口时渲染阻塞提醒与快速切换按钮。
 */
export function TauriRelayNotice(props: TauriRelayNoticeProps): VNode {
    const className = props.compact
        ? 'da-transport-notice da-transport-notice--compact'
        : 'da-transport-notice';

    return (
        <div className={className} role="alert">
            <span className="da-transport-notice__text">
                {props.compact ? (
                    <>
                        <strong>TauriTavern 不支持「酒馆代理」：</strong>
                        请切回「浏览器直连」。
                    </>
                ) : (
                    <>
                        <strong>当前宿主（TauriTavern）不支持「酒馆代理」：</strong>
                        宿主机壳未提供 `/proxy/` 转发接口，继续使用将直接报错拦截，请切换为「浏览器直连」。
                    </>
                )}
            </span>
            <button
                type="button"
                className="da-transport-notice__action"
                disabled={props.disabled}
                onClick={props.onSwitchToDirect}
            >
                {props.compact ? '切为直连' : '切换为浏览器直连'}
            </button>
        </div>
    );
}
