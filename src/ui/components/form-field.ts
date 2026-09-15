/**
 * 表单字段容器与分组卡片组件 (FormField, FormSection, SectionGroup, Card)
 *
 * 功能：
 * 1. 统一表单字段标签、交互控件插槽与帮助提示气泡的排版结构；
 * 2. 提供标准行 (row)、多行堆叠 (stacked) 与全宽行 (full) 三种布局形态；
 * 3. 提供表单分块容器 (FormSection)、可折叠分组 (SectionGroup) 与卡片外壳 (Card)。
 *
 * Tips：
 * 1. 控件挂载容器根据 widthVariant 限制尺寸阶梯，防止界面水平溢出；
 * 2. 帮助提示气泡统一采用无侵入悬浮浮层，避免破坏表单垂直节奏。
 */

import type { IControlHandle } from '@types';

export interface FormFieldOptions {
    /** 字段左侧主标签文本 */
    label: string;
    /** 字段悬停帮助说明文本 (可选，若提供则挂载小问号气泡) */
    helpText?: string;
    /** 右侧操作槽挂载的控件元素或控件 Handle */
    control: HTMLElement | IControlHandle<any>;
    /** 表单行布局排布：标准行 (row) / 垂直多行堆叠 (stacked) / 全宽行 (full) */
    layout?: 'row' | 'stacked' | 'full';
    /** 控件插槽宽度阶梯规格：'full' (240px) / 'half' (120px) / 'compact' (80px) / 'toggle' (38px) / 'auto' */
    widthVariant?: 'full' | 'half' | 'compact' | 'toggle' | 'auto' | 'w-240' | 'w-120' | 'w-80';
    /** 自定义补充 CSS 类名 */
    className?: string;
    /** 标签关联的输入控件 ID */
    forId?: string;
}

export interface FormFieldHandle {
    readonly element: HTMLElement;
    readonly labelElement: HTMLLabelElement;
    readonly labelBoxElement: HTMLElement;
    readonly slotElement: HTMLElement;
    readonly control: HTMLElement | IControlHandle<any>;
    setLabel(text: string): void;
    setHelpText(text?: string): void;
    setVisible(visible: boolean): void;
    dispose(): void;
}

/**
 * 创建标准 38px 表单行容器
 */
export function createFormField(options: FormFieldOptions): FormFieldHandle {
    const row = document.createElement('div');
    row.className = 'da-form-row';

    if (options.layout === 'stacked') {
        row.classList.add('da-form-row--stacked');
    } else if (options.layout === 'full') {
        row.classList.add('da-form-row--full');
    }
    if (options.className) {
        row.classList.add(options.className);
    }

    // 1. 左侧标题区 (.da-label-box)
    const labelBox = document.createElement('div');
    labelBox.className = 'da-label-box';

    const label = document.createElement('label');
    label.className = 'da-form-label';
    label.textContent = options.label;
    if (options.forId) {
        label.htmlFor = options.forId;
    }
    labelBox.appendChild(label);

    // 悬停提示图标挂载
    let helpBtn: HTMLButtonElement | null = null;
    let helpTooltip: HTMLElement | null = null;

    const setupHelp = (text?: string) => {
        if (helpBtn) {
            helpBtn.remove();
            helpBtn = null;
        }
        if (!text) return;

        helpBtn = document.createElement('button');
        helpBtn.type = 'button';
        helpBtn.className = 'da-help-btn';
        helpBtn.setAttribute('aria-label', text);
        helpBtn.tabIndex = -1;
        helpBtn.textContent = '?';

        helpBtn.addEventListener('mouseenter', () => {
            if (!text) return;
            if (helpTooltip) {
                helpTooltip.remove();
            }
            helpTooltip = document.createElement('div');
            helpTooltip.className = 'da-help-bubble';
            helpTooltip.textContent = text;
            document.body.appendChild(helpTooltip);

            const rect = helpBtn!.getBoundingClientRect();
            const left = Math.max(12, Math.min(window.innerWidth - 272, rect.left + rect.width / 2 - 130));
            const showAbove = rect.top > 70;
            const top = showAbove ? (rect.top - 8) : (rect.bottom + 8);

            helpTooltip.style.position = 'fixed';
            helpTooltip.style.left = `${left}px`;
            helpTooltip.style.top = `${top}px`;
            if (showAbove) {
                helpTooltip.classList.add('da-help-bubble--top');
                helpTooltip.style.transform = 'translateY(-100%)';
            } else {
                helpTooltip.style.transform = 'translateY(0)';
            }
        });

        helpBtn.addEventListener('mouseleave', () => {
            if (helpTooltip) {
                helpTooltip.remove();
                helpTooltip = null;
            }
        });

        labelBox.appendChild(helpBtn);
    };

    if (options.helpText) {
        setupHelp(options.helpText);
    }
    row.appendChild(labelBox);

    // 2. 右侧操作插槽 (.da-slot--right)
    const slot = document.createElement('div');
    slot.className = 'da-slot--right';

    if (options.widthVariant) {
        switch (options.widthVariant) {
            case 'full':
            case 'w-240':
                slot.classList.add('da-slot--w-240');
                break;
            case 'half':
            case 'w-120':
                slot.classList.add('da-slot--w-120');
                break;
            case 'compact':
            case 'w-80':
                slot.classList.add('da-slot--w-80');
                break;
            case 'toggle':
                slot.classList.add('da-slot--w-toggle');
                break;
        }
    }

    const controlEl = 'element' in options.control ? options.control.element : options.control;
    slot.appendChild(controlEl);
    row.appendChild(slot);

    return {
        element: row,
        labelElement: label,
        labelBoxElement: labelBox,
        slotElement: slot,
        control: options.control,
        setLabel(text: string): void {
            label.textContent = text;
        },
        setHelpText(text?: string): void {
            setupHelp(text);
        },
        setVisible(visible: boolean): void {
            row.style.display = visible ? '' : 'none';
        },
        dispose(): void {
            if (helpTooltip) {
                helpTooltip.remove();
                helpTooltip = null;
            }
            if ('dispose' in options.control && typeof options.control.dispose === 'function') {
                options.control.dispose();
            }
            row.remove();
        }
    };
}

export interface FormSectionOptions {
    title: string;
    description?: string;
    className?: string;
}

export interface FormSectionHandle {
    readonly element: HTMLElement;
    readonly titleElement: HTMLElement;
    readonly contentElement: HTMLElement;
    addFormField(field: HTMLElement | FormFieldHandle): void;
    dispose(): void;
}

/**
 * 创建表单分块区域容器 (Section)
 */
export function createFormSection(options: FormSectionOptions): FormSectionHandle {
    const section = document.createElement('div');
    section.className = 'da-form-section';
    if (options.className) section.classList.add(options.className);

    const header = document.createElement('div');
    header.className = 'da-form-section__header';

    const title = document.createElement('div');
    title.className = 'da-form-section__title';
    title.textContent = options.title;
    header.appendChild(title);

    if (options.description) {
        const desc = document.createElement('div');
        desc.className = 'da-form-section__desc';
        desc.textContent = options.description;
        header.appendChild(desc);
    }
    section.appendChild(header);

    const content = document.createElement('div');
    content.className = 'da-form-section__content';
    section.appendChild(content);

    return {
        element: section,
        titleElement: title,
        contentElement: content,
        addFormField(field: HTMLElement | FormFieldHandle): void {
            const el = 'element' in field ? field.element : field;
            content.appendChild(el);
        },
        dispose(): void {
            section.remove();
        }
    };
}

export interface SectionGroupOptions {
    title: string;
    description?: string;
    badgeText?: string;
    collapsible?: boolean;
    initiallyCollapsed?: boolean;
    headerActions?: HTMLElement;
    className?: string;
    onChange?: (isOpen: boolean) => void;
}

export interface SectionGroupHandle {
    readonly element: HTMLElement;
    readonly headerElement: HTMLElement;
    readonly titleElement: HTMLElement;
    readonly contentElement: HTMLElement;
    readonly arrowElement: HTMLElement;
    addFormField(field: HTMLElement | FormFieldHandle): void;
    setOpen(isOpen: boolean): void;
    isOpen(): boolean;
    toggle(): void;
    setBadge(badgeText?: string): void;
    dispose(): void;
}

/**
 * 创建次级折叠分组容器 (SectionGroup)
 * 32px 紧凑标题栏、左侧旋转指示箭头与受控展开收起状态机
 */
export function createSectionGroup(options: SectionGroupOptions): SectionGroupHandle {
    const group = document.createElement('div');
    group.className = 'da-section-group';
    if (options.className) group.classList.add(options.className);

    let isExpanded = !options.initiallyCollapsed;
    group.classList.toggle('is-collapsed', !isExpanded);
    group.classList.toggle('is-open', isExpanded);

    const header = document.createElement('div');
    header.className = 'da-section-group__header';

    // 旋转指示箭头
    const arrow = document.createElement('span');
    arrow.className = 'da-section-group__arrow';
    arrow.textContent = '▾';
    header.appendChild(arrow);

    // 标题文本
    const title = document.createElement('span');
    title.className = 'da-section-group__title';
    title.textContent = options.title;
    header.appendChild(title);

    // 可选状态徽标
    let badgeSpan: HTMLSpanElement | null = null;
    if (options.badgeText) {
        badgeSpan = document.createElement('span');
        badgeSpan.className = 'da-section-group__badge';
        badgeSpan.textContent = options.badgeText;
        header.appendChild(badgeSpan);
    }

    // 可选操作按钮槽
    if (options.headerActions) {
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'da-section-group__actions';
        actionsWrap.appendChild(options.headerActions);
        header.appendChild(actionsWrap);
    }

    group.appendChild(header);

    // 子表单行承载内容区
    const content = document.createElement('div');
    content.className = 'da-section-group__content';
    group.appendChild(content);

    const applyOpenState = (open: boolean) => {
        isExpanded = open;
        group.classList.toggle('is-collapsed', !open);
        group.classList.toggle('is-open', open);
        options.onChange?.(open);
    };

    const isCollapsible = options.collapsible !== false;
    if (isCollapsible) {
        header.addEventListener('click', (e) => {
            if (options.headerActions && options.headerActions.contains(e.target as Node)) {
                return;
            }
            applyOpenState(!isExpanded);
        });
    }

    return {
        element: group,
        headerElement: header,
        titleElement: title,
        contentElement: content,
        arrowElement: arrow,
        addFormField(field: HTMLElement | FormFieldHandle): void {
            const el = 'element' in field ? field.element : field;
            content.appendChild(el);
        },
        setOpen(isOpen: boolean): void {
            applyOpenState(isOpen);
        },
        isOpen(): boolean {
            return isExpanded;
        },
        toggle(): void {
            applyOpenState(!isExpanded);
        },
        setBadge(badgeText?: string): void {
            if (badgeText) {
                if (!badgeSpan) {
                    badgeSpan = document.createElement('span');
                    badgeSpan.className = 'da-section-group__badge';
                    header.insertBefore(badgeSpan, options.headerActions ? header.lastChild : null);
                }
                badgeSpan.textContent = badgeText;
            } else if (badgeSpan) {
                badgeSpan.remove();
                badgeSpan = null;
            }
        },
        dispose(): void {
            group.remove();
        }
    };
}

export interface CardOptions {
    title: string;
    iconSvg?: string;
    collapsible?: boolean;
    initiallyCollapsed?: boolean;
    headerActions?: HTMLElement;
    className?: string;
}

export interface CardHandle {
    readonly element: HTMLElement;
    readonly headerElement: HTMLElement;
    readonly bodyElement: HTMLElement;
    append(child: HTMLElement | FormFieldHandle | SectionGroupHandle | FormSectionHandle): void;
    setCollapsed(collapsed: boolean): void;
    isCollapsed(): boolean;
    dispose(): void;
}

/**
 * 创建通用卡片外壳容器 (.da-card)
 */
export function createCard(options: CardOptions): CardHandle {
    const card = document.createElement('div');
    card.className = 'da-card';
    if (options.className) card.classList.add(options.className);

    const header = document.createElement('div');
    header.className = 'da-card__header';
    if (options.collapsible) {
        header.classList.add('da-card__header--collapsible');
    }

    const titleWrap = document.createElement('div');
    titleWrap.className = 'da-card__title';
    titleWrap.style.display = 'flex';
    titleWrap.style.alignItems = 'center';
    titleWrap.style.gap = '8px';
    titleWrap.style.fontWeight = '600';
    titleWrap.style.fontSize = 'var(--da-font-size-base, 14px)';
    titleWrap.style.color = 'var(--da-text-primary)';

    if (options.iconSvg) {
        const iconSpan = document.createElement('span');
        iconSpan.style.display = 'inline-flex';
        iconSpan.style.alignItems = 'center';
        iconSpan.innerHTML = options.iconSvg;
        titleWrap.appendChild(iconSpan);
    }

    const titleText = document.createElement('span');
    titleText.textContent = options.title;
    titleWrap.appendChild(titleText);
    header.appendChild(titleWrap);

    if (options.headerActions) {
        header.appendChild(options.headerActions);
    }

    const body = document.createElement('div');
    body.className = 'da-card__body';

    let isCollapsed = !!options.initiallyCollapsed;
    if (isCollapsed) {
        card.classList.add('da-card--collapsed');
        body.style.display = 'none';
    }

    if (options.collapsible) {
        header.addEventListener('click', (e) => {
            if (options.headerActions && options.headerActions.contains(e.target as Node)) {
                return;
            }
            isCollapsed = !isCollapsed;
            if (isCollapsed) {
                card.classList.add('da-card--collapsed');
                body.style.display = 'none';
            } else {
                card.classList.remove('da-card--collapsed');
                body.style.display = '';
            }
        });
    }

    card.appendChild(header);
    card.appendChild(body);

    const fieldDisposers: (() => void)[] = [];

    return {
        element: card,
        headerElement: header,
        bodyElement: body,
        append(child: HTMLElement | FormFieldHandle): void {
            if ('element' in child) {
                body.appendChild(child.element);
                if (typeof child.dispose === 'function') {
                    fieldDisposers.push(() => child.dispose());
                }
            } else {
                body.appendChild(child);
            }
        },
        setCollapsed(collapsed: boolean): void {
            isCollapsed = collapsed;
            if (isCollapsed) {
                card.classList.add('da-card--collapsed');
                body.style.display = 'none';
            } else {
                card.classList.remove('da-card--collapsed');
                body.style.display = '';
            }
        },
        isCollapsed(): boolean {
            return isCollapsed;
        },
        dispose(): void {
            for (const fn of fieldDisposers) {
                try {
                    fn();
                } catch {
                    // 异常隔离
                }
            }
            card.remove();
        }
    };
}
