/**
 * @module ui/views/theme-tab
 * @description 外观主题定制面板视图 (ThemeTabView)
 */

import { ConfigStore } from '../../core';
import {
    createCard,
    createCardHeader,
    createRow,
    createFieldLabel
} from '../layout/container-factory';
import {
    createColorPicker,
    createNumberInput,
    bindPresetToolbar,
    PresetToolbarElement,
    PresetToolbarAdapter,
    PresetItem
} from '../controls';
import { ThemeService, DEFAULT_THEME_DATA, ThemeData, FALLBACK_SAFE_THEME } from '../foundation/theme-service';
import { FeedbackService } from '../feedback/feedback';
import { BaseTabView } from '../foundation/tab-view';

export class ThemeTabView extends BaseTabView {
    private _currentThemeData: ThemeData;
    private _toolbarEl?: PresetToolbarElement;

    constructor(private readonly _store: ConfigStore) {
        super('da-theme-tab');
        this._currentThemeData = { ...this._getActiveThemeData() };
        this._buildCards();
    }

    private _getActiveThemeId(): string {
        return this._store.get('themePreset') || 'dark';
    }

    private _getActiveThemeData(): ThemeData {
        const themeService = ThemeService.getInstance();
        if (themeService) {
            return themeService.getCurrentTheme();
        }
        return { ...FALLBACK_SAFE_THEME };
    }

    private _buildCards(): void {
        // 1. 预设主题工具栏卡片
        this._buildPresetToolbarCard();

        // 2. 核心色彩配置卡片
        this._buildColorCard();

        // 3. 视觉质感与毛玻璃卡片
        this._buildEffectsCard();
    }

    private _buildPresetToolbarCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '主题预设方案',
            description: '快速切换、新建、重命名或重置界面视觉配色方案'
        });
        card.header.appendChild(header);

        const customThemes = this._store.get('customThemes') || [];
        const presetItems: PresetItem<unknown>[] = customThemes.map((t: any) => ({
            id: t.id,
            name: t.name,
            data: t.tokens || t.data || {}
        }));

        const adapter: PresetToolbarAdapter<unknown> = {
            label: '外观主题',
            getProfiles: () => presetItems,
            getInitialId: () => this._getActiveThemeId(),
            createProfile: (name: string, data: unknown) => {
                const newId = `theme_${Date.now()}`;
                const cur = this._store.get('customThemes') || [];
                const next = [...cur, { id: newId, name, tokens: (data as Record<string, string>) || {} }];
                this._store.set('customThemes', next);
                return newId;
            },
            saveProfile: (id: string, data: unknown) => {
                const cur = this._store.get('customThemes') || [];
                const idx = cur.findIndex((t: any) => t.id === id);
                if (idx >= 0) {
                    const next = [...cur];
                    next[idx] = { ...next[idx], tokens: (data as Record<string, string>) || {} };
                    this._store.set('customThemes', next);
                }
            },
            renameProfile: (id: string, newName: string) => {
                const cur = this._store.get('customThemes') || [];
                const idx = cur.findIndex((t: any) => t.id === id);
                if (idx >= 0) {
                    const next = [...cur];
                    next[idx] = { ...next[idx], name: newName };
                    this._store.set('customThemes', next);
                }
            },
            deleteProfile: (id: string) => {
                const cur = this._store.get('customThemes') || [];
                const next = cur.filter((t: any) => t.id !== id);
                this._store.set('customThemes', next);
                return next[0]?.id || 'dark';
            },
            onSelect: (presetId: string) => {
                this._store.set('themePreset', presetId);
                ThemeService.applyCurrentThemeToNode(document.documentElement);
                FeedbackService.toastSuccess(`已激活主题：${presetId}`);
            }
        };

        this._toolbarEl = bindPresetToolbar({
            adapter,
            getCurrentData: () => this._currentThemeData
        });
        card.body.appendChild(this._toolbarEl);
        this._root.appendChild(card.root);
    }

    private _buildColorCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '界面色彩定制',
            description: '配置主调高光、背景色板与文字对比度'
        });
        card.header.appendChild(header);

        const colorFields: Array<{ key: keyof ThemeData; label: string; def: string }> = [
            { key: 'accentColor', label: '强调主色 (Accent)', def: DEFAULT_THEME_DATA.accentColor },
            { key: 'bgPrimary', label: '主背景色 (Primary BG)', def: DEFAULT_THEME_DATA.bgPrimary },
            { key: 'bgSecondary', label: '卡片背景色 (Secondary BG)', def: DEFAULT_THEME_DATA.bgSecondary },
            { key: 'textPrimary', label: '正文文字颜色 (Text)', def: DEFAULT_THEME_DATA.textPrimary },
            { key: 'borderColor', label: '边框分界线颜色 (Border)', def: DEFAULT_THEME_DATA.borderColor }
        ];

        for (const f of colorFields) {
            const row = createRow(['fill', 'auto'], { align: 'center' });
            const label = createFieldLabel({ title: f.label });
            row.slots[0].appendChild(label);

            const curVal = String(this._currentThemeData[f.key] || f.def);
            const picker = createColorPicker({
                value: curVal,
                onChange: (val) => {
                    (this._currentThemeData as any)[f.key] = val;
                    ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
                }
            });
            row.slots[1].appendChild(picker);
            card.body.appendChild(row.root);
        }

        this._root.appendChild(card.root);
    }

    private _buildEffectsCard(): void {
        const card = createCard({ hoverable: true });
        const header = createCardHeader({
            title: '毛玻璃质感与圆角',
            description: '调节界面模糊度、圆角弧度与不透明度'
        });
        card.header.appendChild(header);

        // 模糊度
        const blurRow = createRow(['fill', 'auto'], { align: 'center' });
        blurRow.slots[0].appendChild(createFieldLabel({ title: '毛玻璃模糊半径 (Blur)' }));
        const blurInput = createNumberInput({
            value: Number(this._currentThemeData.blurRadius ?? 18),
            min: 0,
            max: 40,
            step: 1,
            unit: 'px',
            onChange: (val) => {
                this._currentThemeData.blurRadius = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
            }
        });
        blurRow.slots[1].appendChild(blurInput);
        card.body.appendChild(blurRow.root);

        // 圆角
        const radiusRow = createRow(['fill', 'auto'], { align: 'center' });
        radiusRow.slots[0].appendChild(createFieldLabel({ title: '界面圆角大小 (Radius)' }));
        const radiusInput = createNumberInput({
            value: Number(this._currentThemeData.borderRadius ?? 10),
            min: 0,
            max: 24,
            step: 1,
            unit: 'px',
            onChange: (val) => {
                this._currentThemeData.borderRadius = val;
                ThemeService.applyThemeVariables(this._currentThemeData, document.documentElement);
            }
        });
        radiusRow.slots[1].appendChild(radiusInput);
        card.body.appendChild(radiusRow.root);

        this._root.appendChild(card.root);
    }
}
