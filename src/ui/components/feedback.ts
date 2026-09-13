/**
 * 反馈与指示基元组件
 * 包含全局非阻塞 Toast 提示、字段悬浮帮助气泡、状态徽标与标签胶囊。
 */

import type { FeedbackVariant, IconName } from '@types';
import { createIconElement } from './icons';

// ==================== 1. 全局非阻塞 Toast 提示 ====================

export interface ToastOptions {
    message: string;
    type?: FeedbackVariant;
    durationMs?: number;
}

export class Toast {
    private static activeElement: HTMLElement | null = null;
    private static timer: ReturnType<typeof setTimeout> | null = null;

    public static show(options: ToastOptions | string): void {
        const message = typeof options === 'string' ? options : options.message;
        const type = typeof options === 'string' ? 'info' : (options.type ?? 'info');
        const durationMs = typeof options === 'string' ? 2500 : (options.durationMs ?? 2500);

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.activeElement) {
            this.activeElement.remove();
            this.activeElement = null;
        }

        if (typeof document === 'undefined') return;

        const toast = document.createElement('div');
        toast.className = 'da-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');

        const iconMap: Record<FeedbackVariant, IconName> = {
            success: 'check',
            error: 'alert',
            warn: 'alert',
            info: 'help',
            muted: 'help'
        };

        const iconEl = createIconElement(iconMap[type] || 'help', 14);
        toast.appendChild(iconEl);

        const textSpan = document.createElement('span');
        textSpan.className = 'da-toast__text';
        textSpan.textContent = message;
        toast.appendChild(textSpan);

        document.body.appendChild(toast);
        this.activeElement = toast;

        this.timer = setTimeout(() => {
            if (this.activeElement === toast) {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.2s ease';
                setTimeout(() => {
                    toast.remove();
                    if (this.activeElement === toast) {
                        this.activeElement = null;
                    }
                }, 200);
            }
        }, durationMs);
    }

    public static success(message: string, durationMs?: number): void {
        this.show({ message, type: 'success', durationMs });
    }

    public static error(message: string, durationMs?: number): void {
        this.show({ message, type: 'error', durationMs: durationMs ?? 4000 });
    }

    public static warn(message: string, durationMs?: number): void {
        this.show({ message, type: 'warn', durationMs });
    }

    public static info(message: string, durationMs?: number): void {
        this.show({ message, type: 'info', durationMs });
    }
}

// ==================== 2. 字段悬浮释义帮助气泡 HelpBubble ====================

export interface HelpBubbleHandle {
    readonly element: HTMLElement;
    setText(text: string): void;
    dispose(): void;
}

export function createHelpBubble(text: string): HelpBubbleHandle {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'da-help-btn';
    btn.setAttribute('aria-label', text);
    btn.textContent = '?';

    let currentText = text;
    let bubble: HTMLElement | null = null;

    const showBubble = () => {
        if (!currentText || typeof document === 'undefined') return;
        if (bubble) bubble.remove();

        bubble = document.createElement('div');
        bubble.className = 'da-help-bubble';
        bubble.textContent = currentText;
        document.body.appendChild(bubble);

        const rect = btn.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();

        let left = rect.left + rect.width / 2;
        let top = rect.top - 8;

        // 视口边界碰撞检测，防止左右超出屏幕
        const halfWidth = bubbleRect.width / 2;
        if (left - halfWidth < 10) {
            left = halfWidth + 10;
        } else if (left + halfWidth > window.innerWidth - 10) {
            left = window.innerWidth - halfWidth - 10;
        }

        // 顶部空间不足时翻转到下方展示
        if (top - bubbleRect.height < 10) {
            top = rect.bottom + 8;
            bubble.style.transform = 'translate(-50%, 0)';
        } else {
            bubble.style.transform = 'translate(-50%, -100%)';
        }

        bubble.style.left = `${left}px`;
        bubble.style.top = `${top}px`;
    };

    const hideBubble = () => {
        if (bubble) {
            bubble.remove();
            bubble = null;
        }
    };

    btn.addEventListener('mouseenter', showBubble);
    btn.addEventListener('mouseleave', hideBubble);

    return {
        element: btn,
        setText(newText: string): void {
            currentText = newText;
            btn.setAttribute('aria-label', newText);
        },
        dispose(): void {
            hideBubble();
            btn.removeEventListener('mouseenter', showBubble);
            btn.removeEventListener('mouseleave', hideBubble);
            btn.remove();
        }
    };
}

// ==================== 3. 状态徽标与小圆点 Badge ====================

export interface BadgeOptions {
    text: string;
    variant?: FeedbackVariant;
    pulseDot?: boolean;
    className?: string;
}

export interface BadgeHandle {
    readonly element: HTMLElement;
    setText(text: string): void;
    setVariant(variant: FeedbackVariant): void;
}

export function createBadge(options: BadgeOptions): BadgeHandle {
    const badge = document.createElement('span');
    badge.className = 'da-badge';
    if (options.className) badge.classList.add(options.className);

    const updateVariantClass = (v: FeedbackVariant) => {
        badge.classList.remove('da-badge--success', 'da-badge--warn', 'da-badge--error', 'da-badge--info', 'da-badge--muted');
        badge.classList.add(`da-badge--${v}`);
    };

    updateVariantClass(options.variant ?? 'info');

    let textNode = document.createTextNode(options.text);

    if (options.pulseDot) {
        const dot = document.createElement('span');
        dot.className = 'da-badge__dot';
        badge.appendChild(dot);
    }
    badge.appendChild(textNode);

    return {
        element: badge,
        setText(text: string): void {
            textNode.textContent = text;
        },
        setVariant(v: FeedbackVariant): void {
            updateVariantClass(v);
        }
    };
}

// ==================== 4. 标签胶囊 Chip ====================

export interface ChipOptions {
    text: string;
    selected?: boolean;
    removable?: boolean;
    onClick?: () => void;
    onRemove?: () => void;
}

export interface ChipHandle {
    readonly element: HTMLElement;
    setSelected(selected: boolean): void;
    setText(text: string): void;
    dispose(): void;
}

export function createChip(options: ChipOptions): ChipHandle {
    const chip = document.createElement('span');
    chip.className = 'da-chip';
    if (options.selected) chip.classList.add('is-selected');

    const textSpan = document.createElement('span');
    textSpan.className = 'da-chip__text';
    textSpan.textContent = options.text;
    chip.appendChild(textSpan);

    let removeBtn: HTMLButtonElement | null = null;
    if (options.removable) {
        chip.classList.add('da-chip--removable');
        removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'da-chip__remove';
        removeBtn.setAttribute('aria-label', `移除标签 ${options.text}`);
        removeBtn.appendChild(createIconElement('close', 10));

        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            options.onRemove?.();
        });
        chip.appendChild(removeBtn);
    }

    const onClick = () => {
        options.onClick?.();
    };
    chip.addEventListener('click', onClick);

    return {
        element: chip,
        setSelected(selected: boolean): void {
            chip.classList.toggle('is-selected', selected);
        },
        setText(text: string): void {
            textSpan.textContent = text;
        },
        dispose(): void {
            chip.removeEventListener('click', onClick);
            chip.remove();
        }
    };
}
