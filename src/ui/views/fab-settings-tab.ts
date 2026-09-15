/**
 * 悬浮球设置面板 (FABSettingsTab)
 *
 * 功能：
 * 1. 悬浮球设置：显隐开关、不透明度复合滑块、自动靠边吸附；
 * 2. 预设图标网格：支持 6 款内置矢量图标单选；
 * 3. 自定义图标：圆形头像预览、本地图片选择、网络 URL 输入与还原默认；
 * 4. 坐标重置：一键将悬浮球恢复至视口右下角初始位置。
 *
 * Tips：
 * 1. 变更透明度与图标时即时通知外部悬浮球实例刷新预览；
 * 2. 上传自定义图片时限制为图片格式并转换为 DataURL 保存。
 */

import { createElement } from '../../util/dom';
import { createFormField, createCard } from '../components/form-field';
import { createToggle } from '../components/toggle';
import { createSlider } from '../components/slider';
import { createTextInput } from '../components/input';
import { createButton } from '../components/button';
import { getIconSvg } from '../components/icons';
import type { SettingsStore } from '../../store/settings';

export interface FABSettingsTabOptions {
    onResetPosition?: () => void;
    onIconChange?: (iconOrUrl: string) => void;
    onOpacityChange?: (opacity: number) => void;
    onVisibilityChange?: (visible: boolean) => void;
    onAutoSnapChange?: (autoSnap: boolean) => void;
}

export interface FABSettingsTabHandle {
    readonly element: HTMLElement;
    dispose(): void;
}

const PRESET_FAB_ICONS = [
    { id: 'palette', name: '调色盘', icon: 'palette' },
    { id: 'image', name: '画框', icon: 'image' },
    { id: 'edit', name: '画笔', icon: 'edit' },
    { id: 'sparkles', name: '星芒', icon: 'sparkles' },
    { id: 'star', name: '星标', icon: 'star' },
    { id: 'eye', name: '视界', icon: 'eye' }
];

export function renderFABSettingsTab(
    settingsStore: SettingsStore,
    options: FABSettingsTabOptions = {}
): FABSettingsTabHandle {
    const root = createElement('div', { className: 'da-tab-pane' });
    const disposers: (() => void)[] = [];

    const regDisposer = (item: { dispose?(): void } | undefined | null) => {
        if (item && typeof item.dispose === 'function') {
            disposers.push(() => item.dispose!());
        }
    };

    const card = createCard({
        title: '悬浮球设置',
        iconSvg: getIconSvg('palette'),
        collapsible: false
    });
    regDisposer(card);

    const currentUi = settingsStore.get('ui') || {};
    const trigger = currentUi.trigger || {
        visible: true,
        opacity: 0.95,
        icon: 'palette',
        autoSnap: false
    };

    let activeIcon = trigger.icon || 'palette';

    // 1. 启用悬浮球
    const enableToggle = createToggle({
        value: trigger.visible ?? true,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const trg = ui.trigger || { visible: true, opacity: 0.95, icon: 'palette', autoSnap: false };
            settingsStore.update({
                ui: { ...ui, trigger: { ...trg, visible: val } }
            });
            options.onVisibilityChange?.(val);
        }
    });
    regDisposer(enableToggle);
    const enableField = createFormField({
        label: '启用悬浮球',
        helpText: '常驻屏幕边缘的生图快捷入口球，支持全屏自由拖拽',
        control: enableToggle
    });
    card.append(enableField);

    // 2. 悬浮球透明度 (升级复合滑块)
    const opacitySlider = createSlider({
        value: Math.round((trigger.opacity ?? 0.95) * 100),
        min: 20,
        max: 100,
        step: 5,
        unit: '%',
        onChange: (val) => {
            const opacityDecimal = val / 100;
            const ui = settingsStore.get('ui') || {};
            const trg = ui.trigger || { visible: true, opacity: 0.95, icon: 'palette', autoSnap: false };
            settingsStore.update({
                ui: { ...ui, trigger: { ...trg, opacity: opacityDecimal } }
            });
            options.onOpacityChange?.(opacityDecimal);
        }
    });
    regDisposer(opacitySlider);
    const opacityField = createFormField({
        label: '悬浮球透明度',
        helpText: '调整悬浮球的半透明度，避免遮挡聊天核心内容',
        control: opacitySlider
    });
    card.append(opacityField);

    // 3. 边缘自动吸附
    const autoSnapToggle = createToggle({
        value: trigger.autoSnap ?? false,
        onChange: (val) => {
            const ui = settingsStore.get('ui') || {};
            const trg = ui.trigger || { visible: true, opacity: 0.95, icon: 'palette', autoSnap: false };
            settingsStore.update({
                ui: { ...ui, trigger: { ...trg, autoSnap: val } }
            });
            options.onAutoSnapChange?.(val);
        }
    });
    regDisposer(autoSnapToggle);
    const autoSnapField = createFormField({
        label: '边缘自动吸附',
        helpText: '松开指针时自动平滑吸附贴靠屏幕左侧或右侧边缘',
        control: autoSnapToggle
    });
    card.append(autoSnapField);

    // 4. 预设图标网格
    const iconGridWrap = createElement('div', { className: 'da-form-row da-form-row--stacked' });
    const iconGridLabel = createElement('div', {
        className: 'da-form-label',
        textContent: '预设图标'
    });
    iconGridWrap.appendChild(iconGridLabel);

    const iconGrid = createElement('div', { className: 'da-fab-icon-grid' });
    const chipButtons: HTMLButtonElement[] = [];

    const updateChipActive = (iconId: string) => {
        chipButtons.forEach((btn) => {
            if (btn.dataset.iconId === iconId) {
                btn.classList.add('is-active');
            } else {
                btn.classList.remove('is-active');
            }
        });
        updateAvatarPreview(iconId);
    };

    for (const item of PRESET_FAB_ICONS) {
        const chip = createElement('button', {
            className: 'da-fab-icon-chip',
            dataset: { iconId: item.id }
        }) as HTMLButtonElement;
        chip.title = item.name;
        chip.innerHTML = getIconSvg(item.icon);

        if (item.id === activeIcon) {
            chip.classList.add('is-active');
        }

        chip.addEventListener('click', () => {
            activeIcon = item.id;
            updateChipActive(item.id);

            const ui = settingsStore.get('ui') || {};
            const trg = ui.trigger || { visible: true, opacity: 0.95, icon: 'palette', autoSnap: false };
            settingsStore.update({
                ui: { ...ui, trigger: { ...trg, icon: item.id } }
            });
            options.onIconChange?.(item.id);
        });

        chipButtons.push(chip);
        iconGrid.appendChild(chip);
    }
    iconGridWrap.appendChild(iconGrid);
    card.append(iconGridWrap);

    // 5. 自定义图标 (圆形头像预览 + 本地文件 + 网络链接)
    const customIconRow = createElement('div', { className: 'da-form-row da-form-row--stacked' });
    const customIconLabel = createElement('div', {
        className: 'da-form-label',
        textContent: '自定义图标或头像'
    });
    customIconRow.appendChild(customIconLabel);

    const customWrapper = createElement('div', { className: 'da-fab-custom-icon-wrapper' });

    // 头像圆形预览框
    const avatarPreview = createElement('div', { className: 'da-fab-preview-avatar' });
    customWrapper.appendChild(avatarPreview);

    function updateAvatarPreview(iconOrUrl: string) {
        avatarPreview.innerHTML = '';
        if (iconOrUrl.startsWith('http://') || iconOrUrl.startsWith('https://') || iconOrUrl.startsWith('data:image/')) {
            const img = document.createElement('img');
            img.src = iconOrUrl;
            img.alt = 'Avatar';
            avatarPreview.appendChild(img);
        } else {
            avatarPreview.innerHTML = getIconSvg(iconOrUrl || 'palette');
        }
    }
    updateAvatarPreview(activeIcon);

    // 隐藏的文件 input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                const base64Url = reader.result as string;
                activeIcon = base64Url;
                updateChipActive('');
                updateAvatarPreview(base64Url);

                const ui = settingsStore.get('ui') || {};
                const trg = ui.trigger || { visible: true, opacity: 0.95, icon: 'palette', autoSnap: false };
                settingsStore.update({
                    ui: { ...ui, trigger: { ...trg, icon: base64Url } }
                });
                options.onIconChange?.(base64Url);
            };
            reader.readAsDataURL(file);
        }
        fileInput.value = '';
    });
    customWrapper.appendChild(fileInput);

    // 选择本地图片按钮
    const chooseFileBtn = createButton({
        text: '选择本地图片',
        variant: 'secondary',
        size: 'sm',
        onClick: () => fileInput.click()
    });
    regDisposer(chooseFileBtn);
    customWrapper.appendChild(chooseFileBtn.element);

    // 还原预设按钮
    const resetIconBtn = createButton({
        text: '还原预设',
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
            activeIcon = 'palette';
            updateChipActive('palette');
            const ui = settingsStore.get('ui') || {};
            const trg = ui.trigger || { visible: true, opacity: 0.95, icon: 'palette', autoSnap: false };
            settingsStore.update({
                ui: { ...ui, trigger: { ...trg, icon: 'palette' } }
            });
            options.onIconChange?.('palette');
        }
    });
    regDisposer(resetIconBtn);
    customWrapper.appendChild(resetIconBtn.element);

    customIconRow.appendChild(customWrapper);

    // 网络图片链接输入框
    const urlInput = createTextInput({
        placeholder: '或在此填入网络图片链接: https://...',
        value: activeIcon.startsWith('http') ? activeIcon : '',
        onChange: (val: string) => {
            const trimmed = val.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                activeIcon = trimmed;
                updateChipActive('');
                updateAvatarPreview(trimmed);

                const ui = settingsStore.get('ui') || {};
                const trg = ui.trigger || { visible: true, opacity: 0.95, icon: 'palette', autoSnap: false };
                settingsStore.update({
                    ui: { ...ui, trigger: { ...trg, icon: trimmed } }
                });
                options.onIconChange?.(trimmed);
            }
        }
    });
    regDisposer(urlInput);
    customIconRow.appendChild(urlInput.element);
    card.append(customIconRow);

    // 6. 重置悬浮球位置
    const resetPosBtn = createButton({
        text: '重置为默认位置',
        variant: 'secondary',
        size: 'sm',
        onClick: () => {
            options.onResetPosition?.();
        }
    });
    regDisposer(resetPosBtn);
    const resetPosField = createFormField({
        label: '重置悬浮球位置',
        helpText: '当悬浮球被拖拽出屏幕边缘或不可见时，一键将其重置恢复到默认位置（右下角）',
        control: resetPosBtn.element
    });
    card.append(resetPosField);

    root.appendChild(card.element);

    return {
        element: root,
        dispose(): void {
            fileInput.remove();
            for (const fn of disposers) {
                try {
                    fn();
                } catch {
                    // 异常隔离
                }
            }
            root.remove();
        }
    };
}
