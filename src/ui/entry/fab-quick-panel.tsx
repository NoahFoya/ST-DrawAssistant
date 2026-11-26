/**
 * 悬浮球快捷设置面板 (FabQuickPanel)。
 *
 * @remarks
 * 容器与锚点定位外壳：管理悬浮面板开闭、视口贴边定位、外部点击/Esc 关停以及 4 栏分页切换；
 * 业务状态与配置修改委托给 `QuickPanelState` (`src/ui/state/quick-panel-state.ts`)，
 * 各分页视图渲染拆分于 `src/ui/entry/quick-panel/`。
 */

import { render, type VNode } from 'preact';
import { EXTENSION_VERSION } from '../../config/constants';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { computeAnchoredPosition, getViewportRect, viewportService } from '../layout/viewport';
import { QuickPanelState, type QuickPanelTabId } from '../state/quick-panel-state';
import {
    QuickGeneralTab,
    QuickProviderTab,
    QuickPromptsTab,
    QuickMaterialsTab,
} from './quick-panel';
import type { Disposable } from '../types';

export type { QuickPanelTabId };

export interface FabQuickPanelOptions {
    /** 锚定的悬浮球 DOM 元素 */
    readonly anchorElement: HTMLElement;
    /** 点击「主设置」按钮触发打开主设置弹窗回调 */
    readonly onOpenMainSettings?: () => void;
}

const QUICK_PANEL_TABS: ReadonlyArray<{ id: QuickPanelTabId; label: string }> = [
    { id: 'general', label: '插件设置' },
    { id: 'provider', label: '服务设置' },
    { id: 'prompts', label: '提示词' },
    { id: 'materials', label: '素材管理' },
];

interface QuickPanelShellProps {
    readonly state: QuickPanelState;
    readonly onClose: () => void;
    readonly onOpenMainSettings?: () => void;
    readonly onPositionChange: () => void;
}

function QuickPanelShell(props: QuickPanelShellProps): VNode {
    const { state, onClose, onOpenMainSettings, onPositionChange } = props;
    const settings = state.settingsSignal.value;
    const tab = state.activeTab.value;

    return (
        <div className="da-fqp-shell">
            {/* 1. 顶栏 Header */}
            <div className="da-fqp-header">
                <div className="da-fqp-header__left">
                    <span className="da-fqp-title">ST-DrawAssistant</span>
                    <span className="da-fqp-version">v{EXTENSION_VERSION}</span>
                </div>
                <div className="da-fqp-header__right">
                    <button
                        type="button"
                        className="da-fqp-header-btn"
                        title="打开主设置窗口 (或双击悬浮球)"
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                            onOpenMainSettings?.();
                        }}
                    >
                        主设置
                    </button>
                    <button
                        type="button"
                        className="da-fqp-close-btn"
                        title="关闭快捷面板 (Esc)"
                        aria-label="关闭快捷面板"
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        dangerouslySetInnerHTML={{ __html: renderIcon('close', 14) }}
                    />
                </div>
            </div>

            {/* 2. 四栏分页标签栏 */}
            <div className="da-fqp-tabs" role="tablist">
                {QUICK_PANEL_TABS.map((item) => {
                    const isActive = tab === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            data-tab={item.id}
                            className={`da-fqp-tab${isActive ? ' is-active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                state.setActiveTab(item.id);
                                onPositionChange();
                            }}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>

            {/* 3. 内容滚动区 */}
            <div className="da-fqp-body">
                {tab === 'general' && <QuickGeneralTab state={state} settings={settings} />}
                {tab === 'provider' && <QuickProviderTab state={state} settings={settings} />}
                {tab === 'prompts' && (
                    <QuickPromptsTab
                        state={state}
                        settings={settings}
                        onPositionChange={onPositionChange}
                    />
                )}
                {tab === 'materials' && (
                    <QuickMaterialsTab state={state} settings={settings} />
                )}
            </div>
        </div>
    );
}

export class FabQuickPanel implements Disposable {
    public readonly element: HTMLElement;
    public readonly state: QuickPanelState;

    private readonly options: FabQuickPanelOptions;
    private isOpenState = false;
    private unbindViewport: (() => void) | null = null;
    private unbindEscape: (() => void) | null = null;

    private readonly onDocumentPointerDownBound: (e: PointerEvent) => void;

    public constructor(options: FabQuickPanelOptions) {
        this.options = options;
        this.element =
            typeof document !== 'undefined'
                ? document.createElement('div')
                : ({} as HTMLElement);

        if (this.element.classList) {
            this.element.className = 'da-fab-quick-panel st-da-root da-hidden';
            this.element.setAttribute('role', 'dialog');
            this.element.setAttribute('aria-label', 'ST-DrawAssistant 快捷设置面板');
        }

        this.state = new QuickPanelState({
            onSettingsUpdated: () => {
                if (this.isOpenState) {
                    this.positionPanel();
                }
            },
        });

        this.onDocumentPointerDownBound = this.onDocumentPointerDown.bind(this);

        this.unbindViewport = viewportService.subscribe(() => {
            if (this.isOpenState) {
                this.positionPanel();
            }
        });

        this.unbindEscape = overlayStack.registerEscapeGuard(() => {
            if (!this.isOpenState) {
                return false;
            }
            this.close();
            return true;
        });

        this.mountPreact();
    }

    public isOpen(): boolean {
        return this.isOpenState;
    }

    public open(): void {
        if (this.isOpenState || typeof document === 'undefined') {
            return;
        }
        this.state.syncFromStore();
        this.isOpenState = true;

        if (!this.element.parentElement && document.body) {
            document.body.appendChild(this.element);
        }

        this.element.classList.remove('da-hidden');
        this.mountPreact();
        this.positionPanel();

        document.addEventListener('pointerdown', this.onDocumentPointerDownBound, true);
    }

    public close(): void {
        if (!this.isOpenState) {
            return;
        }
        this.isOpenState = false;
        this.element.classList?.add('da-hidden');
        if (typeof document !== 'undefined') {
            document.removeEventListener('pointerdown', this.onDocumentPointerDownBound, true);
        }
    }

    public toggle(): void {
        if (this.isOpenState) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * 基于悬浮球当前矩形与可视视口动态计算面板停靠位置。
     */
    public positionPanel(): void {
        if (!this.isOpenState || typeof window === 'undefined') {
            return;
        }
        const anchorRect = this.options.anchorElement.getBoundingClientRect?.();
        if (!anchorRect) {
            return;
        }

        const vp = getViewportRect();
        const panelWidth = Math.min(392, Math.max(280, vp.width - 20));
        const measuredHeight = this.element.offsetHeight || 440;
        const anchorCenterX = anchorRect.left + anchorRect.width / 2;
        const isRightHalf = anchorCenterX >= vp.left + vp.width / 2;
        const anchorCenterY = anchorRect.top + anchorRect.height / 2;
        const isBottomHalf = anchorCenterY >= vp.top + vp.height / 2;

        const pos = computeAnchoredPosition({
            anchorRect,
            floatingWidth: panelWidth,
            floatingHeight: Math.min(measuredHeight, 500),
            preferredPlacement: isBottomHalf ? 'top' : 'bottom',
            align: isRightHalf ? 'end' : 'start',
            gap: 10,
            margin: 10,
            viewport: vp,
        });

        this.element.style.width = `${Math.min(panelWidth, pos.maxWidth)}px`;
        this.element.style.maxHeight = `${Math.min(500, Math.max(240, pos.maxHeight))}px`;
        this.element.style.left = `${pos.left}px`;
        this.element.style.top = `${pos.top}px`;
    }

    private onDocumentPointerDown(e: PointerEvent): void {
        if (!this.isOpenState) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (
            this.element.contains(target) ||
            this.options.anchorElement.contains(target) ||
            target.closest?.('[data-da-floating-popover="true"]')
        ) {
            return;
        }
        this.close();
    }

    private mountPreact(): void {
        if (!this.element || typeof document === 'undefined') {
            return;
        }
        render(
            <QuickPanelShell
                state={this.state}
                onClose={() => this.close()}
                onOpenMainSettings={this.options.onOpenMainSettings}
                onPositionChange={() => this.positionPanel()}
            />,
            this.element
        );
    }

    public dispose(): void {
        this.close();
        this.state.dispose();
        if (this.unbindViewport) {
            this.unbindViewport();
            this.unbindViewport = null;
        }
        if (this.unbindEscape) {
            this.unbindEscape();
            this.unbindEscape = null;
        }
        if (this.element && typeof document !== 'undefined') {
            render(null, this.element);
            this.element.remove();
        }
    }
}
