/**
 * 基础布局容器工厂 (Layout Container Factory)
 * 提供行 (Row)、列 (Col)、卡片 (Card) 等通用布局容器的构建与插槽空间划分。
 * 容器仅专注于 DOM 结构呈现，不耦合具体业务数据流，
 * 同时提供字段标签 (createFieldLabel) 与卡片头部 (createCardHeader) 的通用组件构建。
 */

import { OverlayHost } from '../foundation/overlay-host';

/**
 * 弹性插槽宽度与对齐策略
 * - 'full' / 'fill': 撑满 100% 宽度；
 * - 'left': 左侧自适应对齐插槽（flex: 1 1 auto，向左对齐）；
 * - 'right': 右侧控件插槽（flex: 0 0 auto，向右对齐）；
 * - 'half-left' / 'half-right' / 'half': 等分 50% 宽度插槽；
 * - 'third' (33.333%) / 'two-third' (66.666%): 三等分比例插槽；
 * - 'center': 水平居中插槽；
 * - 'auto': 随内容自适应尺寸；
 * - number: 显式权重比例（如 1, 2, 3）。
 */
export type SlotPolicy =
    | 'full'
    | 'fill'
    | 'left'
    | 'right'
    | 'half-left'
    | 'half-right'
    | 'half'
    | 'third'
    | 'two-third'
    | 'auto'
    | 'center'
    | number;

export interface ContainerResult {
    /** 根容器节点 (.da-row 或 .da-col) */
    readonly root: HTMLElement;
    /** 分配的插槽节点数组（按顺序索引） */
    readonly slots: readonly HTMLElement[];
}

export interface CardResult {
    /** 卡片根容器节点 (.da-card) */
    readonly root: HTMLElement;
    /** 卡片头部插槽 (.da-card__header) */
    readonly header: HTMLElement;
    /** 卡片主体内容插槽 (.da-card__body) */
    readonly body: HTMLElement;
}

export interface RowOptions {
    /** 自定义间距 (如 '8px' 或 'var(--da-space-lg)') */
    gap?: string;
    /** 纵向对齐策略：top | center (默认) | bottom */
    align?: 'top' | 'center' | 'bottom';
    /** 是否启用卡片内部条目分割线与悬停效果 */
    divided?: boolean;
    /** 是否包含标准内边距 */
    padded?: boolean;
    /** 是否允许弹性折行 (针对移动端或窄容器) */
    wrap?: boolean;
    /** 附加自定义 CSS 类名 */
    className?: string;
}

export interface CardOptions {
    /** 是否启用鼠标悬停高亮动画 (默认 true) */
    hoverable?: boolean;
    /** 是否支持点击头部折叠/展开 (默认 false) */
    collapsible?: boolean;
    /** 初始是否处于折叠状态 (默认 false) */
    defaultCollapsed?: boolean;
    /** 附加自定义 CSS 类名 */
    className?: string;
}

export interface FieldLabelOptions {
    /** 字段主标题文本 */
    title: string;
    /** 关联的目标输入控件 DOM ID，点击标签文本可直接激活或聚焦控件 */
    forId?: string;
    /** 字段次要详细描述说明 */
    description?: string;
    /** 帮助释义气泡文本 */
    helpTooltip?: string;
    /** 标题行右侧自定义辅助操作节点 */
    headerAction?: HTMLElement;
}

export interface CardHeaderOptions {
    /** 卡片主标题文本 */
    title: string;
    /** 卡片用途描述说明 */
    description?: string;
    /** 卡片右上角操作区节点 */
    action?: HTMLElement;
}

/**
 * 创建水平弹性行容器，并根据策略分配插槽
 *
 * @param slotsConfig 插槽数量或策略数组 (如 2 或 ['left', 'right'])
 * @param options 容器对齐、间距与样式配置项
 * @returns 包含根容器和插槽列表的结果对象
 */
export function createRow(
    slotsConfig: number | readonly SlotPolicy[],
    options?: RowOptions
): ContainerResult {
    const root = document.createElement('div');
    const alignClass = options?.align === 'top'
        ? 'da-row--align-top'
        : (options?.align === 'bottom' ? 'da-row--align-bottom' : 'da-row--center-y');
    const dividedClass = options?.divided ? 'da-row--divided' : '';
    const paddedClass = options?.padded ? 'da-pad-md' : '';
    const wrapClass = options?.wrap ? 'da-row--wrap' : '';
    root.className = `da-row ${alignClass} ${dividedClass} ${paddedClass} ${wrapClass} ${options?.className ?? ''}`.trim();

    if (options?.gap) {
        root.style.gap = options.gap;
    }

    const policies: readonly SlotPolicy[] = typeof slotsConfig === 'number'
        ? Array(slotsConfig).fill('fill')
        : slotsConfig;

    const slots: HTMLElement[] = [];
    const totalNumeric = policies.reduce((acc: number, p) => typeof p === 'number' ? acc + p : acc, 0);

    for (let i = 0; i < policies.length; i++) {
        const policy = policies[i];
        const slot = document.createElement('div');
        slot.className = 'da-slot';

        // 依据插槽在行中的位置，自动赋予位置对齐类名
        if (policies.length > 1) {
            if (i === 0) {
                slot.classList.add('da-slot--start');
            } else if (i === policies.length - 1) {
                slot.classList.add('da-slot--end');
            } else {
                slot.classList.add('da-slot--center');
            }
        }

        switch (policy) {
            case 'full':
            case 'fill':
                slot.classList.add('da-slot--full', 'da-slot--fill');
                break;
            case 'left':
                slot.classList.add('da-slot--left');
                break;
            case 'right':
                slot.classList.add('da-slot--right');
                break;
            case 'half-left':
                slot.classList.add('da-slot--half-left');
                break;
            case 'half-right':
                slot.classList.add('da-slot--half-right');
                break;
            case 'half':
                slot.classList.add('da-slot--half');
                break;
            case 'third':
                slot.classList.add('da-slot--third');
                break;
            case 'two-third':
                slot.classList.add('da-slot--two-third');
                break;
            case 'auto':
                slot.classList.add('da-slot--auto');
                break;
            case 'center':
                slot.classList.add('da-slot--center');
                break;
            default:
                if (typeof policy === 'number' && totalNumeric > 0) {
                    const ratio = policy / totalNumeric;
                    slot.style.flex = `${policy} 1 0%`;
                    slot.style.maxWidth = `${(ratio * 100).toFixed(3)}%`;
                } else {
                    slot.classList.add('da-slot--fill');
                }
                break;
        }

        root.appendChild(slot);
        slots.push(slot);
    }

    return { root, slots };
}

/**
 * 创建垂直弹性列容器
 *
 * @param count 垂直插槽数量
 * @param options 列间距与自定义样式类
 * @returns 包含根容器和插槽列表的结果对象
 */
export function createCol(
    count: number,
    options?: { gap?: string; className?: string }
): ContainerResult {
    const root = document.createElement('div');
    root.className = `da-col ${options?.className ?? ''}`.trim();
    if (options?.gap) {
        root.style.gap = options.gap;
    }

    const slots: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
        const slot = document.createElement('div');
        slot.className = 'da-slot';
        root.appendChild(slot);
        slots.push(slot);
    }

    return { root, slots };
}

/**
 * 创建卡片容器 (分配头部和主体插槽)
 *
 * @param options 卡片悬停与样式配置
 * @returns 包含 root, header, body 的卡片外壳对象
 */
export function createCard(options?: CardOptions): CardResult {
    const root = document.createElement('div');
    const hoverClass = options?.hoverable !== false ? 'da-card--hoverable' : '';
    root.className = `da-card ${hoverClass} ${options?.className ?? ''}`.trim();

    const header = document.createElement('div');
    header.className = 'da-card__header';

    const body = document.createElement('div');
    body.className = 'da-card__body';

    if (options?.collapsible) {
        header.classList.add('da-card__header--collapsible');
        if (options.defaultCollapsed) {
            root.classList.add('da-card--collapsed');
            body.style.display = 'none';
        }
        header.addEventListener('click', () => {
            const isCollapsed = root.classList.toggle('da-card--collapsed');
            body.style.display = isCollapsed ? 'none' : '';
        });
    }

    root.appendChild(header);
    root.appendChild(body);

    return { root, header, body };
}

/**
 * 创建表单字段标签组 (包含主标题、帮助说明气泡与次要描述)
 * 若提供 forId，主标题渲染为 <label for="...">，点击文本可直接激活或聚焦对应控件。
 * 帮助问号按钮保持在 label 外部同级排布，防止点击查看说明时意外触发表单控件。
 */
export function createFieldLabel(options: FieldLabelOptions): HTMLElement {
    const group = document.createElement('div');
    group.className = 'da-field-label-group';

    const titleRow = document.createElement('div');
    titleRow.className = 'da-field-title-row';

    const titleEl = document.createElement(options.forId ? 'label' : 'span');
    titleEl.className = 'da-field-title';
    titleEl.textContent = options.title;
    if (options.forId) {
        (titleEl as HTMLLabelElement).htmlFor = options.forId;
    }
    titleRow.appendChild(titleEl);

    if (options.helpTooltip) {
        const helpBtn = document.createElement('button');
        helpBtn.type = 'button';
        helpBtn.className = 'da-help-btn';
        helpBtn.title = '查看详细说明';
        helpBtn.setAttribute('aria-label', '查看详细说明');
        helpBtn.textContent = '?';
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            OverlayHost.getInstance().showHelpBubble(helpBtn, options.helpTooltip!);
        });
        titleRow.appendChild(helpBtn);
    }

    if (options.headerAction) {
        titleRow.appendChild(options.headerAction);
    }

    group.appendChild(titleRow);

    if (options.description) {
        const descEl = document.createElement('span');
        descEl.className = 'da-field-desc';
        descEl.textContent = options.description;
        group.appendChild(descEl);
    }

    return group;
}

/**
 * 创建卡片头部组件 (包含主标题、副标题与操作区)
 */
export function createCardHeader(options: CardHeaderOptions): HTMLElement {
    const group = document.createElement('div');
    group.className = 'da-card-title-group';

    const titleEl = document.createElement('h3');
    titleEl.className = 'da-card-title';
    titleEl.textContent = options.title;
    group.appendChild(titleEl);

    if (options.description) {
        const descEl = document.createElement('div');
        descEl.className = 'da-card-desc';
        descEl.textContent = options.description;
        group.appendChild(descEl);
    }

    if (options.action) {
        const wrapper = document.createElement('div');
        wrapper.className = 'da-card-header-wrapper';
        wrapper.appendChild(group);
        wrapper.appendChild(options.action);
        return wrapper;
    }

    return group;
}

export interface SectionGroupOptions {
    /** 分组主标题 */
    title: string;
    /** 是否支持点击头部折叠/展开 (默认 true) */
    collapsible?: boolean;
    /** 初始是否处于展开状态 (默认 true) */
    defaultOpen?: boolean;
    /** 附加自定义 CSS 类名 */
    className?: string;
    /** 头部右侧辅助操作区或徽标节点 */
    action?: HTMLElement;
}

export interface SectionGroupResult {
    /** 分组根容器 (.da-section-group) */
    readonly root: HTMLElement;
    /** 分组头部 (.da-section-header) */
    readonly header: HTMLElement;
    /** 分组主体内容插槽 (.da-section-body) */
    readonly body: HTMLElement;
    /** 切换折叠/展开状态 */
    toggle: () => void;
    /** 显式设置折叠状态 */
    setCollapsed: (collapsed: boolean) => void;
    /** 当前是否折叠 */
    isCollapsed: () => boolean;
}

/**
 * 创建卡片内部分组容器 (Section Group)
 * 提供轻量、可折叠的分组标题头与流式内容主体插槽
 */
export function createSectionGroup(options: SectionGroupOptions): SectionGroupResult {
    const root = document.createElement('div');
    root.className = `da-section-group ${options.className ?? ''}`.trim();

    const header = document.createElement('div');
    header.className = 'da-section-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'da-section-title';
    titleEl.textContent = options.title;
    header.appendChild(titleEl);

    if (options.action) {
        header.appendChild(options.action);
    }

    const isCollapsible = options.collapsible !== false;
    let collapsed = options.defaultOpen === false;

    if (isCollapsible) {
        const arrow = document.createElement('span');
        arrow.className = 'da-section-arrow';
        arrow.textContent = '▾';
        header.appendChild(arrow);
    }

    const body = document.createElement('div');
    body.className = 'da-section-body';

    const setCollapsed = (val: boolean) => {
        collapsed = val;
        if (collapsed) {
            root.classList.add('da-section-group--collapsed');
            body.style.display = 'none';
        } else {
            root.classList.remove('da-section-group--collapsed');
            body.style.display = '';
        }
    };

    const toggle = () => {
        setCollapsed(!collapsed);
    };

    if (isCollapsible) {
        header.classList.add('da-section-header--collapsible');
        header.addEventListener('click', (e) => {
            if (options.action && options.action.contains(e.target as Node)) {
                return;
            }
            toggle();
        });
    }

    // 初始应用展开状态
    setCollapsed(collapsed);

    root.appendChild(header);
    root.appendChild(body);

    return {
        root,
        header,
        body,
        toggle,
        setCollapsed,
        isCollapsed: () => collapsed
    };
}
