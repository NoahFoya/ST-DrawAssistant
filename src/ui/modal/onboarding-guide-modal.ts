/**
 * 初次使用引导与功能联动说明弹窗 (OnboardingGuideModal)。
 *
 * @remarks
 * 1. 纯说明图文分步向导：聚焦讲解插件通用工作机制、默认开关状态、真实环境配置前提及各模块关联；
 * 2. 严格区分插件机制与作者附带预设：不绑定或硬编码具体默认提示词正文，预设均定位为可参照修改的起始模板；
 * 3. 接入 OverlayStack 集中层级管理，支持 Esc 键、遮罩点击与顶栏关闭，且可由顶栏帮助按钮随时重新唤起。
 */

import type { Disposable } from '../types';
import { overlayStack } from '../framework/overlay-stack';
import { renderIcon } from '../components/icons';

export interface OnboardingGuideModalOptions {
    /** 初始打开的步骤索引（从 0 开始，默认 0） */
    readonly initialStep?: number;
    /** 关闭回调 */
    readonly onClose?: () => void;
}

interface GuideCardSpec {
    readonly title: string;
    readonly badge?: string;
    readonly badgeMuted?: boolean;
    readonly highlight?: boolean;
    readonly text?: string;
    readonly bullets?: ReadonlyArray<{ readonly lead?: string; readonly body: string }>;
}

interface GuideFlowNode {
    readonly step: string;
    readonly title: string;
    readonly desc: string;
}

interface GuideStepSpec {
    readonly shortLabel: string;
    readonly title: string;
    readonly subtitle: string;
    readonly flowNodes?: readonly GuideFlowNode[];
    readonly cards: readonly GuideCardSpec[];
}

const GUIDE_STEPS: readonly GuideStepSpec[] = [
    {
        shortLabel: '总体流程',
        title: '插件定位与核心工作流程',
        subtitle: '理解酒馆对话、提示词配置、生图服务与素材管理各自承担的职责',
        flowNodes: [
            {
                step: '01 环境配置',
                title: '对接生图后端',
                desc: '按实际运行环境设置服务地址、连接方式与本地模型参数',
            },
            {
                step: '02 上下文注入',
                title: '插件通道或外部世界书',
                desc: '可选向酒馆注入提示词，告知 AI 何时以及用何种标记输出指令',
            },
            {
                step: '03 标记识别',
                title: '捕获正文生图指令',
                desc: '按配置的起止标记扫描消息，自动挂载楼层操作按钮或触发出图',
            },
            {
                step: '04 图像管理',
                title: '楼层展示与图库留存',
                desc: '生成结果回显到对话楼层，并归档至独立的本地图库供预览重绘',
            },
        ],
        cards: [
            {
                title: '需结合用户实际运行环境完成基础配置',
                highlight: true,
                badge: '使用前置',
                text: '插件无法替你预设本机硬件与服务环境。首次使用前，请先在「常规设置」与左侧对应「生图引擎」页面中，根据你实际使用的后端（ComfyUI / SD-WebUI / NovelAI / OpenAI 兼容）填写接口地址或密钥，确定浏览器直连或酒馆代理方式，并同步你本地实际安装的模型、LoRA 或工作流节点。',
            },
            {
                title: '默认预设均为可参照修改的起始模板',
                badge: '自由定制',
                badgeMuted: true,
                text: '插件安装后附带的出图参数、工作流、提示词预设与示例角色/服装档案，仅作为方便快速体验的起始模板；插件本身对你的提示词正文格式不做强制限定，你可参考默认预设的结构自由修改、另存或替换。',
            },
        ],
    },
    {
        shortLabel: '提示词与世界书',
        title: '提示词通道机制与外部世界书共存',
        subtitle: '明确四大分类模块的底层统一机制、默认开关策略以及如何配合第三方世界书',
        cards: [
            {
                title: '四大分类共用同一套底层注入机制',
                highlight: true,
                badge: '核心认知',
                text: '侧边栏「提示词」下的「故事插画」「词汇指导」「素材创作」「素材注入」四个子页，在底层运行的是完全相同的条目触发与酒馆注入机制（均支持常驻或关键词触发、插入深度与顺序控制、注释剥离以及素材变量插槽）。拆分为四个分类只是为了便于功能归类和分别开关；若你更习惯统一编写，也可以将多条提示词合并放在同一启用预设中。',
            },
            {
                title: '初次安装的默认启用状态',
                badge: '默认策略',
                bullets: [
                    {
                        lead: '默认开启「故事插画」',
                        body: '作为开箱主通道，安装后默认处于启用状态，可参考其中结构按需调整；',
                    },
                    {
                        lead: '其余三项默认关闭',
                        body: '「词汇指导」「素材创作」「素材注入」默认处于关闭状态，避免占用额外上下文，请根据个人需要前往「提示词 → 启用设置」手动开启；',
                    },
                    {
                        lead: '使用外部绘画世界书时可全部关闭',
                        body: '如果你在酒馆中已挂载了外部绘画世界书，无需再注入本插件自带提示词，可前往「提示词 → 启用设置」关闭全部通道，插件仍会照常识别消息标记并生图。',
                    },
                ],
            },
        ],
    },
    {
        shortLabel: '环境与楼层出图',
        title: '生图引擎、正文标记捕获与本地图库',
        subtitle: '了解插件如何从对话提取生图指令、连接后端出图并保存资产',
        cards: [
            {
                title: '正文生图指令识别规则（可自定义）',
                badge: '楼层交互',
                text: '无论上下文提示词来自本插件预设还是外部世界书，插件只依据「常规设置 → 交互与触发」中配置的「生图开始标记 / 结束标记」（默认 `image###` 与 `###`）从对话楼层识别指令，并以英文管道符 `|` 区分正负向提示词。若你修改了 AI 的输出格式，记得将这两个标记保持一致。',
            },
            {
                title: '网络代理适配与状态检测',
                badge: '环境适配',
                badgeMuted: true,
                text: '当浏览器直连本地服务遇到跨域（CORS）或 HTTPS 混合内容拦截时，可在「常规设置」将连接方式切换为「酒馆代理」（需确保酒馆后端 config.yaml 已开启 enableCorsProxy）。主窗体左下角的状态栏会持续展示当前激活引擎的连通状态与响应延迟，方便排查连接问题。',
            },
            {
                title: '楼层呈现、快捷操作面板与图库',
                bullets: [
                    {
                        lead: '手动 / 自动触发',
                        body: '可在「常规设置」选择点击楼层按钮手动生图，或在 AI 回复完成时自动触发生成；',
                    },
                    {
                        lead: '楼层交互与本地存储',
                        body: '出图后可直接在楼层点击放大预览（灯箱），或通过右键 / 长按呼出编辑与重新生成面板；所有生成记录与完整参数统一留存在「本地图库」，不额外膨胀聊天记录体积。',
                    },
                ],
            },
        ],
    },
    {
        shortLabel: '素材与词库联动',
        title: '素材库、动态变量与词库辅助定位',
        subtitle: '分清「注入给 AI 的素材联动」与「纯本地编辑器联想词库」的边界',
        cards: [
            {
                title: '素材库与动态变量联动',
                highlight: true,
                badge: '角色与服装一致性',
                bullets: [
                    {
                        lead: '模板建档规则',
                        body: '可在「素材库」参考内置示例整理角色与服装标签；其中专属触发词字段对应 Danbooru 已收录同人角色/服饰标识，自设原创内容留空即可；',
                    },
                    {
                        lead: '触发方式与变量插槽',
                        body: '在「素材库 → 启用设置」为条目设定「关键词触发」或「常驻触发」后，插件会依据「格式与宏」配置实时渲染 `{{角色启用列表}}`、`{{服装启用列表}}`、`{{角色可用宏列表}}`、`{{服装可用宏列表}}` 等变量，供任意已开启的提示词条目引用；',
                    },
                    {
                        lead: '生图宏自动展开与档案自动提取',
                        body: '发送生图请求前，插件会自动将正文指令中的 `$名称-宏$` 展开为对应部位标签；开启「解析设置」中的自动提取后，插件还可按设定的起止标记与字段键名从 AI 回复中抓取新档案弹窗确认收录。',
                    },
                ],
            },
            {
                title: '「词库」与「提示词 → 词汇指导」完全解耦',
                badge: '纯本地辅助',
                badgeMuted: true,
                text: '侧边栏「词库」是仅保存在浏览器 IndexedDB 中的本地检索与输入联想工具（支持导入 CSV / JSON 词表），只在你手动编写或修改提示词文本框时提供标签补全，不会自动向大语言模型发送任何上下文。',
            },
        ],
    },
];

export class OnboardingGuideModal implements Disposable {
    private isDisposed = false;
    private currentStep = 0;
    private backdropEl?: HTMLElement;
    private kickerEl?: HTMLElement;
    private titleEl?: HTMLElement;
    private subtitleEl?: HTMLElement;
    private bodyEl?: HTMLElement;
    private progressEl?: HTMLElement;
    private prevBtn?: HTMLButtonElement;
    private nextBtn?: HTMLButtonElement;
    private stepPillEls: HTMLButtonElement[] = [];
    private keydownHandler?: (e: KeyboardEvent) => void;

    public constructor(private readonly options: OnboardingGuideModalOptions = {}) {
        const total = GUIDE_STEPS.length;
        const requested = options.initialStep ?? 0;
        this.currentStep = Math.max(0, Math.min(total - 1, requested));
        this.renderDom();
    }

    private renderDom(): void {
        if (typeof document === 'undefined') {
            return;
        }

        // 1. 全屏背景遮罩
        const backdrop = document.createElement('div');
        backdrop.className = 'da-onboarding-backdrop st-da-root';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.setAttribute('aria-label', 'ST-DrawAssistant 使用引导');
        this.backdropEl = backdrop;

        // 2. 弹窗主体卡片容器
        const panel = document.createElement('div');
        panel.className = 'da-onboarding-panel';
        panel.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        backdrop.appendChild(panel);

        // 3. 顶部标题区
        const header = document.createElement('div');
        header.className = 'da-onboarding-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'da-onboarding-title-group';

        const kicker = document.createElement('span');
        kicker.className = 'da-onboarding-kicker';
        this.kickerEl = kicker;

        const title = document.createElement('h3');
        title.className = 'da-onboarding-title';
        this.titleEl = title;

        const subtitle = document.createElement('p');
        subtitle.className = 'da-onboarding-subtitle';
        this.subtitleEl = subtitle;

        titleGroup.appendChild(kicker);
        titleGroup.appendChild(title);
        titleGroup.appendChild(subtitle);
        header.appendChild(titleGroup);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-modal-close-btn da-onboarding-close-btn';
        closeBtn.setAttribute('aria-label', '关闭使用引导');
        closeBtn.title = '关闭引导 (Esc)';
        closeBtn.innerHTML = renderIcon('close', 15);
        closeBtn.addEventListener('click', () => this.handleClose());
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // 4. 顶部四步导航胶囊
        const stepper = document.createElement('div');
        stepper.className = 'da-onboarding-stepper';
        this.stepPillEls = [];

        GUIDE_STEPS.forEach((step, idx) => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'da-onboarding-step-pill';
            pill.setAttribute('data-step-index', String(idx));

            const num = document.createElement('span');
            num.className = 'da-onboarding-step-num';
            num.textContent = String(idx + 1);

            const label = document.createElement('span');
            label.className = 'da-onboarding-step-label';
            label.textContent = step.shortLabel;

            pill.appendChild(num);
            pill.appendChild(label);
            pill.addEventListener('click', () => {
                this.goToStep(idx);
            });

            stepper.appendChild(pill);
            this.stepPillEls.push(pill);
        });
        panel.appendChild(stepper);

        // 5. 正文内容滚动容器
        const body = document.createElement('div');
        body.className = 'da-onboarding-body';
        this.bodyEl = body;
        panel.appendChild(body);

        // 6. 底部分页操作栏
        const footer = document.createElement('div');
        footer.className = 'da-onboarding-footer';

        const progress = document.createElement('span');
        progress.className = 'da-onboarding-footer__progress';
        this.progressEl = progress;

        const actions = document.createElement('div');
        actions.className = 'da-onboarding-footer__actions';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'da-btn da-btn--ghost da-btn--sm da-onboarding-prev-btn';
        prevBtn.textContent = '上一步';
        prevBtn.addEventListener('click', () => {
            this.goToStep(this.currentStep - 1);
        });
        this.prevBtn = prevBtn;

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'da-btn da-btn--primary da-btn--sm da-onboarding-next-btn';
        nextBtn.addEventListener('click', () => {
            if (this.currentStep >= GUIDE_STEPS.length - 1) {
                this.handleClose();
            } else {
                this.goToStep(this.currentStep + 1);
            }
        });
        this.nextBtn = nextBtn;

        actions.appendChild(prevBtn);
        actions.appendChild(nextBtn);
        footer.appendChild(progress);
        footer.appendChild(actions);
        panel.appendChild(footer);

        document.body.appendChild(backdrop);

        // 7. 绑定浮层栈、遮罩点击与左右方向键翻页
        overlayStack.push('onboarding-guide-modal', () => this.handleClose());

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                this.handleClose();
            }
        });

        this.keydownHandler = (e: KeyboardEvent) => {
            if (!overlayStack.isTop('onboarding-guide-modal')) {
                return;
            }
            if (e.key === 'ArrowLeft' && this.currentStep > 0) {
                e.preventDefault();
                this.goToStep(this.currentStep - 1);
            } else if (e.key === 'ArrowRight' && this.currentStep < GUIDE_STEPS.length - 1) {
                e.preventDefault();
                this.goToStep(this.currentStep + 1);
            }
        };
        window.addEventListener('keydown', this.keydownHandler);

        this.renderCurrentStep();
    }

    /**
     * 切换引导步骤（自动限制在合法页码范围内）。
     *
     * @param stepIndex 目标步骤索引（从 0 开始）
     */
    public goToStep(stepIndex: number): void {
        if (this.isDisposed) {
            return;
        }
        const clamped = Math.max(0, Math.min(GUIDE_STEPS.length - 1, stepIndex));
        if (clamped === this.currentStep && this.bodyEl?.childElementCount) {
            return;
        }
        this.currentStep = clamped;
        this.renderCurrentStep();
    }

    /** 获取当前激活步骤索引（从 0 开始） */
    public getCurrentStep(): number {
        return this.currentStep;
    }

    private renderCurrentStep(): void {
        const step = GUIDE_STEPS[this.currentStep];
        if (!step || !this.bodyEl) {
            return;
        }

        if (this.kickerEl) {
            this.kickerEl.textContent = `ST-DrawAssistant 使用引导 · 第 ${this.currentStep + 1} / ${GUIDE_STEPS.length} 步`;
        }
        if (this.titleEl) {
            this.titleEl.textContent = step.title;
        }
        if (this.subtitleEl) {
            this.subtitleEl.textContent = step.subtitle;
        }

        this.stepPillEls.forEach((pill, idx) => {
            const isActive = idx === this.currentStep;
            pill.classList.toggle('is-active', isActive);
            pill.setAttribute('aria-current', isActive ? 'step' : 'false');
        });

        this.bodyEl.innerHTML = '';

        // 可选横向工作流示意图
        if (step.flowNodes && step.flowNodes.length > 0) {
            const flowWrap = document.createElement('div');
            flowWrap.className = 'da-onboarding-flow';

            step.flowNodes.forEach((node, idx) => {
                const nodeEl = document.createElement('div');
                nodeEl.className = 'da-onboarding-flow-node';

                const stepBadge = document.createElement('span');
                stepBadge.className = 'da-onboarding-flow-step';
                stepBadge.textContent = node.step;

                const nodeTitle = document.createElement('div');
                nodeTitle.className = 'da-onboarding-flow-title';
                nodeTitle.textContent = node.title;

                const nodeDesc = document.createElement('div');
                nodeDesc.className = 'da-onboarding-flow-desc';
                nodeDesc.textContent = node.desc;

                nodeEl.appendChild(stepBadge);
                nodeEl.appendChild(nodeTitle);
                nodeEl.appendChild(nodeDesc);
                flowWrap.appendChild(nodeEl);

                if (idx < step.flowNodes!.length - 1) {
                    const arrow = document.createElement('div');
                    arrow.className = 'da-onboarding-flow-arrow';
                    arrow.innerHTML = renderIcon('chevronRight', 14);
                    flowWrap.appendChild(arrow);
                }
            });

            this.bodyEl.appendChild(flowWrap);
        }

        // 说明信息卡片组
        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'da-onboarding-cards';

        for (const cardSpec of step.cards) {
            const cardEl = document.createElement('section');
            cardEl.className = cardSpec.highlight
                ? 'da-onboarding-card da-onboarding-card--highlight'
                : 'da-onboarding-card';

            const cardHeader = document.createElement('div');
            cardHeader.className = 'da-onboarding-card__header';

            const cardTitle = document.createElement('h4');
            cardTitle.className = 'da-onboarding-card__title';
            cardTitle.textContent = cardSpec.title;
            cardHeader.appendChild(cardTitle);

            if (cardSpec.badge) {
                const badge = document.createElement('span');
                badge.className = cardSpec.badgeMuted
                    ? 'da-onboarding-card__badge da-onboarding-card__badge--muted'
                    : 'da-onboarding-card__badge';
                badge.textContent = cardSpec.badge;
                cardHeader.appendChild(badge);
            }

            cardEl.appendChild(cardHeader);

            if (cardSpec.text) {
                const p = document.createElement('p');
                p.className = 'da-onboarding-card__text';
                this.appendFormattedText(p, cardSpec.text);
                cardEl.appendChild(p);
            }

            if (cardSpec.bullets && cardSpec.bullets.length > 0) {
                const ul = document.createElement('ul');
                ul.className = 'da-onboarding-card__list';
                for (const bullet of cardSpec.bullets) {
                    const li = document.createElement('li');
                    if (bullet.lead) {
                        const strong = document.createElement('strong');
                        strong.textContent = `${bullet.lead}：`;
                        li.appendChild(strong);
                    }
                    this.appendFormattedText(li, bullet.body);
                    ul.appendChild(li);
                }
                cardEl.appendChild(ul);
            }

            cardsWrap.appendChild(cardEl);
        }

        this.bodyEl.appendChild(cardsWrap);
        this.bodyEl.scrollTop = 0;

        if (this.progressEl) {
            this.progressEl.textContent = `${this.currentStep + 1} / ${GUIDE_STEPS.length}（可随时点击顶栏 ? 图标重看）`;
        }

        if (this.prevBtn) {
            this.prevBtn.disabled = this.currentStep === 0;
        }

        if (this.nextBtn) {
            const isLast = this.currentStep >= GUIDE_STEPS.length - 1;
            this.nextBtn.textContent = isLast ? '完成引导' : '下一步';
        }
    }

    /** 将文本中的反引号行内标记安全渲染为 <code> 节点，避免 innerHTML XSS 风险 */
    private appendFormattedText(container: HTMLElement, rawText: string): void {
        const segments = rawText.split(/(`[^`]+`)/g);
        for (const seg of segments) {
            if (!seg) continue;
            if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
                const codeEl = document.createElement('code');
                codeEl.className = 'da-onboarding-inline-code';
                codeEl.textContent = seg.slice(1, -1);
                container.appendChild(codeEl);
            } else {
                container.appendChild(document.createTextNode(seg));
            }
        }
    }

    private handleClose(): void {
        const onClose = this.options.onClose;
        this.dispose();
        onClose?.();
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        overlayStack.remove('onboarding-guide-modal');

        if (this.keydownHandler && typeof window !== 'undefined') {
            window.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = undefined;
        }

        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
        this.stepPillEls = [];
    }
}

/**
 * 打开初次使用引导弹窗。
 *
 * @param options 引导窗配置项
 * @returns 资源释放句柄
 */
export function openOnboardingGuideModal(
    options: OnboardingGuideModalOptions = {}
): OnboardingGuideModal {
    return new OnboardingGuideModal(options);
}
