/**
 * 表单行容器与分块布局组件
 * 严格遵循 38px 标准表单行高规范，行内严禁混入冗长副标题，所有说明收敛至悬停提示气泡。
 */

import { IControlHandle } from './types';

export interface FormFieldOptions {
    /** 字段左侧主标签文本 */
    label: string;
    /** 字段悬停帮助说明文本 (可选，若提供则挂载小问号气泡) */
    helpText?: string;
    /** 右侧操作槽挂载的控件元素或控件 Handle */
    control: HTMLElement | IControlHandle<any>;
    /** 表单行布局排布：标准行 (row) / 垂直多行堆叠 (stacked) / 全宽行 (full) */
    layout?: 'row' | 'stacked' | 'full';
    /** 自定义补充 CSS 类名 */
    className?: string;
    /** 标签关联的输入控件 ID */
    forId?: string;
}

export interface FormFieldHandle {
    readonly element: HTMLElement;
    readonly labelElement: HTMLLabelElement;
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

    // 1. 左侧标题区
    const labelWrap = document.createElement('div');
    labelWrap.className = 'da-form-label-wrap';

    const label = document.createElement('label');
    label.className = 'da-form-label';
    label.textContent = options.label;
    if (options.forId) {
        label.htmlFor = options.forId;
    }
    labelWrap.appendChild(label);

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
        helpBtn.textContent = '?';

        helpBtn.addEventListener('mouseenter', () => {
            if (!text) return;
            helpTooltip = document.createElement('div');
            helpTooltip.className = 'da-help-bubble';
            helpTooltip.textContent = text;
            document.body.appendChild(helpTooltip);

            const rect = helpBtn!.getBoundingClientRect();
            let left = rect.left + rect.width / 2;
            let top = rect.top - 8;

            helpTooltip.style.left = `${left}px`;
            helpTooltip.style.top = `${top}px`;
            helpTooltip.style.transform = 'translate(-50%, -100%)';
        });

        helpBtn.addEventListener('mouseleave', () => {
            if (helpTooltip) {
                helpTooltip.remove();
                helpTooltip = null;
            }
        });

        labelWrap.appendChild(helpBtn);
    };

    if (options.helpText) {
        setupHelp(options.helpText);
    }
    row.appendChild(labelWrap);

    // 2. 右侧操作插槽
    const slot = document.createElement('div');
    slot.className = 'da-slot--right';

    const controlEl = 'element' in options.control ? options.control.element : options.control;
    slot.appendChild(controlEl);
    row.appendChild(slot);

    return {
        element: row,
        labelElement: label,
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
    append(child: HTMLElement | FormFieldHandle): void;
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
