/**
 * @module ui/tabs/fab-settings-tab
 * @description FAB 快捷悬浮球外观与拖拽设置 Tab 组件
 *
 * 职责：
 * - 控制 FAB 悬浮球的显隐、图标主题与不透明度
 * - 提供拖拽记忆重置与交互响应设置
 */

import { createFieldRow } from '../components/field-row';
import { loadSettings, updateSettings } from '../../settings/manager';
import { applyFABStylesFromSettings, resetFABPosition, FAB_PRESET_ICONS } from '../fab';
import { openImageCropperModal } from '../components/image-cropper-modal';

/**
 * 渲染悬浮窗设置 Tab 内容节点
 */
export function renderFABSettingsTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-fab-settings-tab';

    const settings = loadSettings();

    // 顶部改动提示气泡
    const hintCard = document.createElement('div');
    hintCard.className = 'da-change-hint-badge';
    hintCard.style.display = 'none';
    hintCard.style.marginBottom = '12px';
    hintCard.style.padding = '8px 14px';
    hintCard.style.borderRadius = '8px';
    hintCard.style.background = 'rgba(0, 242, 254, 0.1)';
    hintCard.style.border = '1px solid rgba(0, 242, 254, 0.25)';
    hintCard.style.color = '#00f2fe';
    hintCard.style.fontSize = '0.85em';
    hintCard.style.fontWeight = '500';
    hintCard.style.transition = 'opacity 0.2s ease';
    hintCard.innerHTML = '<span>配置已即时自动保存并生效</span>';
    container.appendChild(hintCard);

    let changeHintTimer: number | null = null;
    const notifyChange = (): void => {
        hintCard.style.display = 'block';
        hintCard.style.opacity = '1';
        if (changeHintTimer) clearTimeout(changeHintTimer);
        changeHintTimer = window.setTimeout(() => {
            hintCard.style.opacity = '0';
            setTimeout(() => { hintCard.style.display = 'none'; }, 200);
        }, 2200);
    };

    // ── 卡片：悬浮窗参数配置 (全单行) ──────────────────────────────────────────
    const card = document.createElement('div');
    card.className = 'da-section-card';

    const header = document.createElement('div');
    header.className = 'da-section-header';
    header.innerHTML = `
        <span class="da-section-title">快捷悬浮球设置</span>
        <span class="da-section-desc">配置页面右下角悬浮球的展示外观、透明度与自定义图片图标</span>
    `;
    card.appendChild(header);

    // 1. 显隐开关
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'da-toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = settings.fabVisible ?? true;

    const sliderSpan = document.createElement('span');
    sliderSpan.className = 'da-slider';
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(sliderSpan);

    toggleInput.addEventListener('change', () => {
        updateSettings({ fabVisible: toggleInput.checked });
        applyFABStylesFromSettings();
        notifyChange();
    });

    card.appendChild(createFieldRow({
        label: '启用快捷悬浮球',
        control: toggleLabel,
    }));

    // 2. 透明度滑动条
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.className = 'da-input';
    opacityInput.style.width = '140px';
    opacityInput.min = '0.3';
    opacityInput.max = '1.0';
    opacityInput.step = '0.05';
    opacityInput.value = String(settings.fabOpacity ?? 0.9);

    const opacityValueSpan = document.createElement('span');
    opacityValueSpan.className = 'da-unit';
    opacityValueSpan.style.marginLeft = '8px';
    opacityValueSpan.textContent = `${Math.round((settings.fabOpacity ?? 0.9) * 100)}%`;

    opacityInput.addEventListener('input', () => {
        const val = parseFloat(opacityInput.value);
        opacityValueSpan.textContent = `${Math.round(val * 100)}%`;
        updateSettings({ fabOpacity: val });
        applyFABStylesFromSettings();
        notifyChange();
    });

    card.appendChild(createFieldRow({
        label: '悬浮球透明度',
        control: [opacityInput, opacityValueSpan],
    }));

    // 3. 悬浮球预设矢量 Icon 卡片选框
    const iconGrid = document.createElement('div');
    iconGrid.className = 'da-fab-icon-grid';

    const renderIconChips = () => {
        const curSettings = loadSettings();
        const activeKey = curSettings.fabCustomIcon ? null : (curSettings.fabIcon ?? 'palette');
        iconGrid.innerHTML = '';

        Object.entries(FAB_PRESET_ICONS).forEach(([key, item]) => {
            const chip = document.createElement('div');
            chip.className = `da-fab-icon-chip ${activeKey === key ? 'is-active' : ''}`;
            chip.innerHTML = `${item.svg}<span>${item.name}</span>`;
            chip.addEventListener('click', () => {
                updateSettings({ fabIcon: key, fabCustomIcon: undefined });
                applyFABStylesFromSettings();
                updateCustomIconPreview();
                renderIconChips();
                notifyChange();
            });
            iconGrid.appendChild(chip);
        });
    };

    renderIconChips();

    card.appendChild(createFieldRow({
        label: '预设图标',
        control: iconGrid,
    }));

    // 4. 自定义图片图标上传 & 交互式圆形裁剪器
    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = 'image/*';
    hiddenFileInput.style.display = 'none';

    const uploadIconBtn = document.createElement('button');
    uploadIconBtn.className = 'da-btn secondary';
    uploadIconBtn.style.padding = '4px 12px';
    uploadIconBtn.style.fontSize = '0.85em';
    uploadIconBtn.textContent = '上传图片并裁剪';

    const resetCustomIconBtn = document.createElement('button');
    resetCustomIconBtn.className = 'da-btn secondary';
    resetCustomIconBtn.style.padding = '4px 12px';
    resetCustomIconBtn.style.fontSize = '0.85em';
    resetCustomIconBtn.textContent = '恢复预设';

    const previewImg = document.createElement('img');
    previewImg.style.width = '28px';
    previewImg.style.height = '28px';
    previewImg.style.objectFit = 'cover';
    previewImg.style.borderRadius = '50%';
    previewImg.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    previewImg.style.display = 'none';

    const updateCustomIconPreview = (): void => {
        const curSettings = loadSettings();
        if (curSettings.fabCustomIcon) {
            previewImg.src = curSettings.fabCustomIcon;
            previewImg.style.display = 'inline-block';
            resetCustomIconBtn.style.display = 'inline-block';
        } else {
            previewImg.style.display = 'none';
            resetCustomIconBtn.style.display = 'none';
        }
    };
    updateCustomIconPreview();

    uploadIconBtn.addEventListener('click', () => {
        hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const rawBase64 = reader.result as string;
            openImageCropperModal({
                imageSrc: rawBase64,
                onConfirm: (croppedBase64) => {
                    updateSettings({ fabCustomIcon: croppedBase64 });
                    applyFABStylesFromSettings();
                    updateCustomIconPreview();
                    renderIconChips();
                    notifyChange();
                },
            });
            hiddenFileInput.value = '';
        };
        reader.readAsDataURL(file);
    });

    resetCustomIconBtn.addEventListener('click', () => {
        updateSettings({ fabCustomIcon: undefined });
        applyFABStylesFromSettings();
        updateCustomIconPreview();
        renderIconChips();
        notifyChange();
    });

    card.appendChild(createFieldRow({
        label: '自定义图标',
        control: [previewImg, uploadIconBtn, resetCustomIconBtn, hiddenFileInput],
    }));

    // 5. 重置位置按钮
    const resetBtn = document.createElement('button');
    resetBtn.className = 'da-btn secondary';
    resetBtn.style.padding = '4px 12px';
    resetBtn.style.fontSize = '0.85em';
    resetBtn.textContent = '重置右下角位置';
    resetBtn.addEventListener('click', () => {
        resetFABPosition();
        notifyChange();
        const win = window as unknown as { toastr?: { success?: (m: string, t?: string) => void } };
        if (win.toastr && typeof win.toastr.success === 'function') {
            win.toastr.success('悬浮球位置已恢复至右下角。', '快捷悬浮球');
        }
    });

    card.appendChild(createFieldRow({
        label: '重置显示位置',
        control: resetBtn,
    }));

    container.appendChild(card);
    return container;
}
