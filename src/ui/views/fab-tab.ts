/**
 * 悬浮球专属设置选项卡主视图 (FabTabView)。
 *
 * @remarks
 * 负责管理屏幕常驻悬浮操作球 (FAB) 的行为控制与视觉外观：
 * 1. 行为与停靠控制卡片：常驻显隐开关、贴边自动吸附开关、不透明度滑块调节与一键恢复默认停靠位置；
 * 2. 图标外观定制卡片：4 款精选内置矢量 SVG 图标切换、自定义外部网络图片/头像输入与实时圆形预览；
 * 3. 广播联动：配置项修改即时持久化至 settingsStore 并广播事件，悬浮球实时更新呈现。
 */

import type { SettingsView, Disposable } from '../types';
import { Card } from '../components/card';
import { Switch } from '../components/switch';
import { Slider } from '../components/slider';
import { TextInput } from '../components/text-input';
import { Button } from '../components/button';
import { FormField } from '../components/form-field';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { FAB_BUILTIN_ICONS } from '../modal/fab';

interface BuiltinIconItem {
    id: string;
    label: string;
    svg: string;
}

const BUILTIN_ICON_LIST: BuiltinIconItem[] = [
    { id: 'palette', label: '调色盘', svg: FAB_BUILTIN_ICONS.palette },
    { id: 'sparkles', label: '星光魔法', svg: FAB_BUILTIN_ICONS.sparkles },
    { id: 'image', label: '画作图像', svg: FAB_BUILTIN_ICONS.image },
    { id: 'brush', label: '艺术画笔', svg: FAB_BUILTIN_ICONS.brush },
];

export class FabTabView implements SettingsView {
    public readonly id = 'fab';
    public readonly title = '悬浮球设置';
    public readonly element: HTMLElement;

    private readonly disposables: Disposable[] = [];

    // 行为控制控件
    private visibleSwitch!: Switch;
    private autoSnapSwitch!: Switch;
    private opacitySlider!: Slider;

    // 图标定制控件
    private iconChipsContainer!: HTMLElement;
    private customUrlInput!: TextInput;
    private avatarPreviewImg!: HTMLImageElement;
    private avatarPreviewSvg!: HTMLElement;

    public constructor() {
        this.element = document.createElement('div');
        this.element.className = 'da-tab-pane da-view-fab';

        this.buildLayout();
    }

    private buildLayout(): void {
        const controlCard = this.buildControlCard();
        const appearanceCard = this.buildAppearanceCard();

        this.element.appendChild(controlCard.element);
        this.element.appendChild(appearanceCard.element);

        this.disposables.push(controlCard, appearanceCard);
    }

    // 1. 悬浮球行为与停靠控制卡片

    private buildControlCard(): Card {
        const card = new Card({
            title: '悬浮球控制与停靠',
            subtitle: '管理屏幕常驻悬浮快捷入口的显隐状态、贴边吸附与不透明度',
            collapsible: true,
            defaultCollapsed: false,
        });

        const trigger = settingsStore.get('ui')?.trigger;

        // (1) 启用常驻悬浮球
        this.visibleSwitch = new Switch({
            value: trigger?.visible ?? true,
            onChange: (checked) => {
                this.updateTriggerSetting({ visible: checked });
            },
        });
        const visibleField = new FormField({
            label: '启用常驻悬浮球',
            tooltip: '在屏幕边缘保留便捷的常驻悬浮操作入口，点击即可呼出本面板',
            control: this.visibleSwitch,
            width: 'w-toggle',
        });

        // (2) 贴边自动吸附
        this.autoSnapSwitch = new Switch({
            value: trigger?.autoSnap ?? false,
            onChange: (checked) => {
                this.updateTriggerSetting({ autoSnap: checked });
            },
        });
        const snapField = new FormField({
            label: '贴边自动吸附',
            tooltip: '释放拖拽后平滑吸附贴靠至屏幕最近的左侧或右侧边缘',
            control: this.autoSnapSwitch,
            width: 'w-toggle',
        });

        // (3) 悬浮球不透明度
        const currentOpacity = Math.round(((trigger?.opacity ?? 0.95) * 100));
        this.opacitySlider = new Slider({
            min: 20,
            max: 100,
            step: 5,
            value: currentOpacity,
            unit: '%',
            onChange: (val) => {
                this.updateTriggerSetting({ opacity: Number((val / 100).toFixed(2)) });
            },
        });
        const opacityField = new FormField({
            label: '悬浮球不透明度',
            tooltip: '调节未选中时的半透明视觉强度 (20% ~ 100%)',
            control: this.opacitySlider,
            width: 'w-240',
        });

        // (4) 一键恢复默认停靠位置
        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.justifyContent = 'flex-end';
        actionRow.style.marginTop = '12px';

        const resetPosBtn = new Button({
            label: '↺ 恢复默认停靠位置',
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
                eventBus.emit('ui:reset-fab-position');
            },
        });
        actionRow.appendChild(resetPosBtn.element);

        card.appendContent([
            visibleField.element,
            snapField.element,
            opacityField.element,
            actionRow,
        ]);

        this.disposables.push(
            this.visibleSwitch,
            visibleField,
            this.autoSnapSwitch,
            snapField,
            this.opacitySlider,
            opacityField,
            resetPosBtn
        );
        return card;
    }

    // 2. 悬浮球图标与外观定制卡片

    private buildAppearanceCard(): Card {
        const card = new Card({
            title: '图标与外观样式',
            subtitle: '选择精选内置矢量图标，或配置外部网络图片作为专属头像',
            collapsible: true,
            defaultCollapsed: false,
        });

        const currentIcon = (settingsStore.get('ui')?.trigger?.icon as string) || 'palette';
        const isCustomUrl = currentIcon.startsWith('http://') || currentIcon.startsWith('https://') || currentIcon.startsWith('data:image');

        // (1) 内置矢量图标选择器
        this.iconChipsContainer = document.createElement('div');
        this.iconChipsContainer.className = 'da-fab-icon-grid';

        this.renderIconChips(isCustomUrl ? '' : currentIcon);
        const iconField = new FormField({
            label: '预设矢量图标',
            tooltip: '点击切换不同主题样式的简约矢量图标',
            control: this.iconChipsContainer,
        });

        // (2) 自定义图片/头像 URL
        const wrapper = document.createElement('div');
        wrapper.className = 'da-fab-custom-icon-wrapper';

        // 圆形头像预览区
        const avatarBox = document.createElement('div');
        avatarBox.className = 'da-fab-preview-avatar';

        this.avatarPreviewImg = document.createElement('img');
        this.avatarPreviewImg.alt = '预览';
        this.avatarPreviewImg.style.display = 'none';

        this.avatarPreviewSvg = document.createElement('div');
        this.avatarPreviewSvg.className = 'da-fab-icon';
        this.avatarPreviewSvg.style.display = 'flex';

        avatarBox.appendChild(this.avatarPreviewImg);
        avatarBox.appendChild(this.avatarPreviewSvg);

        // 输入控件
        this.customUrlInput = new TextInput({
            value: isCustomUrl ? currentIcon : '',
            placeholder: 'https://example.com/avatar.png',
            clearable: true,
            debounceMs: 250,
            onChange: (val) => {
                this.handleCustomUrlChange(val.trim());
            },
        });

        wrapper.appendChild(avatarBox);
        wrapper.appendChild(this.customUrlInput.element);

        const customField = new FormField({
            label: '自定义网络头像图片',
            tooltip: '输入完整的图片 URL 作为悬浮球图案；清空则恢复上方选择的预设图标',
            control: wrapper,
        });

        // 初始同步头像预览
        this.updateAvatarPreview(currentIcon);

        card.appendContent([
            iconField.element,
            customField.element,
        ]);

        this.disposables.push(iconField, customField, this.customUrlInput);
        return card;
    }

    private renderIconChips(activeIconId: string): void {
        this.iconChipsContainer.innerHTML = '';

        for (const item of BUILTIN_ICON_LIST) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'da-fab-icon-chip';
            chip.setAttribute('data-id', item.id);
            chip.setAttribute('title', item.label);
            chip.innerHTML = item.svg;

            if (item.id === activeIconId) {
                chip.classList.add('is-active');
            }

            chip.addEventListener('click', () => {
                // 清空自定义输入并切换为预设图标
                this.customUrlInput.setValue('');
                this.updateTriggerSetting({ icon: item.id });

                this.renderIconChips(item.id);
                this.updateAvatarPreview(item.id);
            });

            this.iconChipsContainer.appendChild(chip);
        }
    }

    private handleCustomUrlChange(url: string): void {
        if (url) {
            this.updateTriggerSetting({ icon: url });
            this.renderIconChips('');
            this.updateAvatarPreview(url);
        } else {
            // 缺省使用 palette 预设
            this.updateTriggerSetting({ icon: 'palette' });
            this.renderIconChips('palette');
            this.updateAvatarPreview('palette');
        }
    }

    private updateAvatarPreview(icon: string): void {
        const isUrl = icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:image');
        if (isUrl) {
            this.avatarPreviewImg.src = icon;
            this.avatarPreviewImg.style.display = 'block';
            this.avatarPreviewSvg.style.display = 'none';
        } else {
            this.avatarPreviewImg.style.display = 'none';
            this.avatarPreviewSvg.style.display = 'flex';
            this.avatarPreviewSvg.innerHTML = FAB_BUILTIN_ICONS[icon] ?? FAB_BUILTIN_ICONS.palette;
        }
    }

    private updateTriggerSetting(patch: Partial<{ visible: boolean; autoSnap: boolean; opacity: number; icon: string }>): void {
        const currentUi = settingsStore.get('ui') || {};
        settingsStore.set('ui', {
            ...currentUi,
            trigger: {
                ...(currentUi.trigger || {}),
                ...patch,
            },
        });
    }

    public activate(): void {
        const trigger = settingsStore.get('ui')?.trigger;
        if (trigger) {
            this.visibleSwitch.setValue(trigger.visible ?? true, { silent: true });
            this.autoSnapSwitch.setValue(trigger.autoSnap ?? false, { silent: true });
            this.opacitySlider.setValue(Math.round((trigger.opacity ?? 0.95) * 100), { silent: true });

            const icon = trigger.icon || 'palette';
            const isUrl = icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:image');
            this.renderIconChips(isUrl ? '' : icon);
            this.customUrlInput.setValue(isUrl ? icon : '', { silent: true });
            this.updateAvatarPreview(icon);
        }
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
