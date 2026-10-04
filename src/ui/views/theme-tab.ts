/**
 * 外观与主题专属选项卡主视图 (ThemeTabView)。
 *
 * @remarks
 * 负责呈现界面主题选择与视觉个性化调节能力：
 * 1. 主题预设方案卡片：展示 8 套出厂精选主题，点击即时预览并持久化应用；
 * 2. 视觉细节微调卡片：提供品牌主色色块挑选、圆角规格与毛玻璃虚化强度的实时滑块微调；
 * 3. 动态 CSS 变量注入：依托 ThemeService 实现零 DOM 重建的响应式设计令牌更新；
 * 4. 主题参数重置：支持一键清除个性化微调，恢复所选主题的默认参数。
 */

import type { SettingsView, Disposable } from '../types';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { Slider } from '../components/slider';
import { FormField } from '../components/form-field';
import { settingsStore } from '../../store/settings-store';
import { themeService } from '../theme/theme-service';

/** 常用品牌主色快捷色板 */
const ACCENT_COLOR_PALETTE = [
    { label: '科技蓝', color: '#3b82f6' },
    { label: '极光紫', color: '#8b5cf6' },
    { label: '青空碧', color: '#06b6d4' },
    { label: '翡翠绿', color: '#10b981' },
    { label: '暖杏金', color: '#f59e0b' },
    { label: '蔷薇粉', color: '#f43f5e' },
];

export class ThemeTabView implements SettingsView {
    public readonly id = 'theme';
    public readonly title = '外观与主题';
    public readonly element: HTMLElement;

    private readonly disposables: Disposable[] = [];
    private themeCardsContainer!: HTMLElement;
    private radiusSlider!: Slider;
    private blurSlider!: Slider;

    public constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane da-view-theme';

        this.buildLayout();
    }

    private buildLayout(): void {
        const presetCard = this.buildThemePresetCard();
        const customizeCard = this.buildCustomizeCard();

        this.element.appendChild(presetCard.element);
        this.element.appendChild(customizeCard.element);

        this.disposables.push(presetCard, customizeCard);
    }

    // 1. 主题预设方案选择卡片

    private buildThemePresetCard(): Card {
        const card = new Card({
            title: '主题预设方案',
            subtitle: '精选 8 套出厂视觉主题，点击卡片即时全量切换设计令牌',
            collapsible: true,
            defaultCollapsed: false,
        });

        const body = card.getBodyElement();

        this.themeCardsContainer = document.createElement('div');
        this.themeCardsContainer.className = 'da-theme-grid';
        this.themeCardsContainer.style.display = 'grid';
        this.themeCardsContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(210px, 1fr))';
        this.themeCardsContainer.style.gap = '12px';
        this.themeCardsContainer.style.marginTop = '4px';

        this.renderThemeCards();
        body.appendChild(this.themeCardsContainer);

        return card;
    }

    private renderThemeCards(): void {
        this.themeCardsContainer.innerHTML = '';
        const themes = themeService.getAvailableThemes();
        const currentThemeId = (settingsStore.get('themePreset') as string) || 'dark';

        for (const item of themes) {
            const cardEl = document.createElement('div');
            cardEl.className = 'da-theme-card';
            cardEl.setAttribute('data-id', item.id);
            cardEl.style.padding = '12px';
            cardEl.style.borderRadius = 'var(--da-radius-md, 8px)';
            cardEl.style.background = 'var(--da-bg-card, rgba(255, 255, 255, 0.04))';
            cardEl.style.border = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.08))';
            cardEl.style.cursor = 'pointer';
            cardEl.style.transition = 'all 0.2s var(--da-ease)';
            cardEl.style.display = 'flex';
            cardEl.style.flexDirection = 'column';
            cardEl.style.gap = '10px';

            const isActive = item.id === currentThemeId;
            if (isActive) {
                cardEl.classList.add('is-active');
                cardEl.style.borderColor = 'var(--da-accent-color, #3b82f6)';
                cardEl.style.boxShadow = '0 0 14px rgba(var(--da-accent-rgb, 59, 130, 246), 0.35)';
            }

            // (1) 顶部名称与深浅模式标签
            const headerRow = document.createElement('div');
            headerRow.style.display = 'flex';
            headerRow.style.alignItems = 'center';
            headerRow.style.justifyContent = 'space-between';

            const titleSpan = document.createElement('span');
            titleSpan.style.fontSize = '14px';
            titleSpan.style.fontWeight = '600';
            titleSpan.textContent = item.name;

            const modeBadge = document.createElement('span');
            const isLight = item.id === 'light' || item.id === 'sky-light';
            modeBadge.style.fontSize = '11px';
            modeBadge.style.padding = '1px 6px';
            modeBadge.style.borderRadius = '10px';
            modeBadge.style.background = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
            modeBadge.textContent = isLight ? '日间' : '夜间';

            headerRow.appendChild(titleSpan);
            headerRow.appendChild(modeBadge);
            cardEl.appendChild(headerRow);

            // (2) 中部色板预览条
            const paletteRow = document.createElement('div');
            paletteRow.style.display = 'flex';
            paletteRow.style.alignItems = 'center';
            paletteRow.style.gap = '6px';
            paletteRow.style.height = '24px';
            paletteRow.style.padding = '4px';
            paletteRow.style.borderRadius = '4px';
            paletteRow.style.background = item.data.bgPrimary || '#181b24';

            const createColorDot = (color?: string, flex = 1) => {
                const dot = document.createElement('div');
                dot.style.height = '100%';
                dot.style.flex = String(flex);
                dot.style.borderRadius = '2px';
                dot.style.background = color || 'transparent';
                return dot;
            };

            paletteRow.appendChild(createColorDot(item.data.bgCard, 2));
            paletteRow.appendChild(createColorDot(item.data.accentColor, 1));
            paletteRow.appendChild(createColorDot(item.data.accentCyan, 1));
            paletteRow.appendChild(createColorDot(item.data.textPrimary, 1));

            cardEl.appendChild(paletteRow);

            // 点击切换主题
            cardEl.addEventListener('click', () => {
                this.selectTheme(item.id);
            });

            this.themeCardsContainer.appendChild(cardEl);
        }
    }

    private selectTheme(themeId: string): void {
        settingsStore.set('themePreset', themeId);
        themeService.applyTheme(themeId);
        this.renderThemeCards();
    }

    // 2. 视觉细节微调卡片

    private buildCustomizeCard(): Card {
        const card = new Card({
            title: '视觉细节微调',
            subtitle: '按使用习惯调整品牌主色、圆角大小与毛玻璃虚化强度，参数即时生效',
            collapsible: true,
            defaultCollapsed: false,
        });

        // (1) 品牌主色快捷微调
        const colorRow = document.createElement('div');
        colorRow.style.display = 'flex';
        colorRow.style.gap = '10px';
        colorRow.style.flexWrap = 'wrap';
        colorRow.style.padding = '4px 0';

        for (const item of ACCENT_COLOR_PALETTE) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'da-accent-chip';
            btn.title = item.label;
            btn.style.width = '28px';
            btn.style.height = '28px';
            btn.style.borderRadius = '50%';
            btn.style.background = item.color;
            btn.style.border = '2px solid transparent';
            btn.style.cursor = 'pointer';
            btn.style.transition = 'transform 0.15s var(--da-ease)';

            btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'scale(1.15)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'scale(1)';
            });
            btn.addEventListener('click', () => {
                themeService.applyCurrentTheme({ accentColor: item.color });
            });

            colorRow.appendChild(btn);
        }

        const colorField = new FormField({
            label: '品牌主色微调',
            tooltip: '快速将当前主题的强调色变更为指定色调',
            control: colorRow,
        });

        // (2) 界面圆角大小调节
        this.radiusSlider = new Slider({
            min: 0,
            max: 20,
            step: 2,
            value: 10,
            unit: 'px',
            onChange: (val) => {
                themeService.applyCurrentTheme({
                    borderRadius: val,
                    radiusCard: val,
                    radiusModal: Math.min(24, val + 2),
                });
            },
        });
        const radiusField = new FormField({
            label: '界面圆角偏好',
            tooltip: '控制窗口、卡片与输入控件的边缘弧度 (0px ~ 20px)',
            control: this.radiusSlider,
            width: 'w-240',
        });

        // (3) 毛玻璃虚化强度调节
        this.blurSlider = new Slider({
            min: 0,
            max: 30,
            step: 2,
            value: 18,
            unit: 'px',
            onChange: (val) => {
                themeService.applyCurrentTheme({
                    blurModal: val,
                    blurPanel: val,
                });
            },
        });
        const blurField = new FormField({
            label: '毛玻璃虚化强度',
            tooltip: '调整模态弹窗与浮层背后的高斯虚化半径 (0px ~ 30px)',
            control: this.blurSlider,
            width: 'w-240',
        });

        // (4) 底部重置按钮
        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.justifyContent = 'flex-end';
        actionRow.style.marginTop = '12px';

        const resetBtn = new Button({
            label: '↺ 恢复当前主题默认',
            variant: 'ghost',
            size: 'sm',
            onClick: () => {
                this.radiusSlider.setValue(10);
                this.blurSlider.setValue(18);
                themeService.applyCurrentTheme();
            },
        });
        actionRow.appendChild(resetBtn.element);

        card.appendContent([
            colorField.element,
            radiusField.element,
            blurField.element,
            actionRow,
        ]);

        this.disposables.push(colorField, radiusField, blurField, this.radiusSlider, this.blurSlider, resetBtn);
        return card;
    }

    public activate(): void {
        this.renderThemeCards();
    }

    public deactivate(): void {
        // 离开选项卡
    }

    public dispose(): void {
        for (const item of this.disposables) {
            item.dispose();
        }
        this.disposables.length = 0;
        this.element.innerHTML = '';
        this.element.remove();
    }
}
