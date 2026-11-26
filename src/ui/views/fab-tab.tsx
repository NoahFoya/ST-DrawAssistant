/**
 * 悬浮球选项卡视图 (FabTab)。
 *
 * @remarks
 * 基于 Preact JSX 与 Fine-Grained Signals 声明式构建：
 * 1. 基础配置卡片：常驻显隐开关、启用快捷面板开关、不透明度数值输入与停靠位置重置按钮；
 * 2. 图标与外观卡片：预设图标切换、自定义圆形头像本地上传与绘图动效选择。
 */

import { useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import type { SettingsView } from '../types';
import type { DrawAssistantSettings } from '../../store/settings-store';
import {
    createPreactSettingsView,
    CardView,
    FormFieldView,
    SwitchControl,
    NumberInputControl,
    SelectControl,
    ButtonControl,
} from '../framework';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';
import { Toast } from '../feedback/toast';

type FabAnimationOption = NonNullable<DrawAssistantSettings['ui']['fab']['animationType']>;

export const FAB_ANIMATION_OPTIONS: readonly { value: FabAnimationOption; label: string }[] = [
    { value: 'starlight', label: '星光环绕' },
    { value: 'orbit-ring', label: '流光环绕' },
    { value: 'aurora-pulse', label: '呼吸脉冲' },
    { value: 'ripple', label: '波纹扩散' },
    { value: 'none', label: '禁用' },
];

export const FAB_BUILTIN_ICONS: Record<string, string> = {
    palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`,
    image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    brush: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>`,
};

interface BuiltinIconItem {
    id: string;
    label: string;
    svg: string;
}

const BUILTIN_ICON_LIST: BuiltinIconItem[] = [
    { id: 'palette', label: '调色盘', svg: FAB_BUILTIN_ICONS.palette },
    { id: 'sparkles', label: '星星', svg: FAB_BUILTIN_ICONS.sparkles },
    { id: 'image', label: '画作', svg: FAB_BUILTIN_ICONS.image },
    { id: 'brush', label: '画笔', svg: FAB_BUILTIN_ICONS.brush },
];

function isCustomFabIcon(icon: string): boolean {
    return (
        icon.startsWith('data:image') ||
        icon.startsWith('http://') ||
        icon.startsWith('https://')
    );
}

function updateFabSettings(
    patch: Partial<{
        visible: boolean;
        opacity: number;
        icon: string;
        animationType: FabAnimationOption;
        quickPanelEnabled: boolean;
    }>
): void {
    const currentFab = settingsStore.get('ui')?.fab || {
        visible: true,
        opacity: 0.95,
        icon: 'palette',
        animationType: 'starlight' as FabAnimationOption,
        quickPanelEnabled: false,
    };
    settingsStore.updateUi({
        fab: {
            ...currentFab,
            ...patch,
        },
    });
}

function handleFabIconFileChange(inputEl: HTMLInputElement): void {
    const file = inputEl.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Toast.show('请选择有效的图片文件', { level: 'error' });
        inputEl.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = reader.result as string;
        if (dataUrl) {
            updateFabSettings({ icon: dataUrl });
            Toast.show('已成功更新悬浮球自定义头像', { level: 'success' });
        }
        inputEl.value = '';
    };
    reader.onerror = () => {
        Toast.show('读取图片文件失败', { level: 'error' });
        inputEl.value = '';
    };
    reader.readAsDataURL(file);
}

export function FabTab(): VNode {
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const fab = settingsStore.signals.ui.value?.fab;
    const visible = fab?.visible ?? true;
    const opacity = fab?.opacity ?? 0.95;
    const opacityPct = Math.round(opacity * 100);
    const quickPanelEnabled = Boolean(fab?.quickPanelEnabled);
    const currentIcon = (fab?.icon as string) || 'palette';
    const rawAnim = fab?.animationType as string | undefined;
    const currentAnim: FabAnimationOption = FAB_ANIMATION_OPTIONS.some(
        (opt) => opt.value === rawAnim
    )
        ? (rawAnim as FabAnimationOption)
        : 'starlight';
    const isCustom = isCustomFabIcon(currentIcon);

    return (
        <>
            <CardView title="基础配置">
                <FormFieldView label="启用悬浮球" width="w-toggle">
                    <SwitchControl
                        value={visible}
                        onChange={(checked) => updateFabSettings({ visible: checked })}
                    />
                </FormFieldView>

                <FormFieldView label="悬浮球不透明度" width="w-240">
                    <NumberInputControl
                        min={20}
                        max={100}
                        step={5}
                        precision={0}
                        value={opacityPct}
                        unit="%"
                        onChange={(val) =>
                            updateFabSettings({
                                opacity: Number((val / 100).toFixed(2)),
                            })
                        }
                    />
                </FormFieldView>

                <FormFieldView label="悬浮球位置">
                    <ButtonControl
                        label="重置默认位置"
                        variant="secondary"
                        onClick={() => {
                            eventBus.emit('ui:reset-fab-position');
                            Toast.show('已重置悬浮球停靠位置', { level: 'info' });
                        }}
                    />
                </FormFieldView>

                <FormFieldView
                    label="启用快捷面板"
                    width="w-toggle"
                    tooltip="开启后单击悬浮球可展开或收起快捷面板，快速切换生图服务、预设与高频开关；双击悬浮球或点击面板顶栏「主设置」可直接打开主设置窗口。"
                >
                    <SwitchControl
                        value={quickPanelEnabled}
                        onChange={(checked) =>
                            updateFabSettings({ quickPanelEnabled: checked })
                        }
                    />
                </FormFieldView>
            </CardView>

            <CardView title="图标与外观">
                <FormFieldView label="预设图标">
                    <div className="da-fab-icon-grid">
                        {BUILTIN_ICON_LIST.map((item) => {
                            const isActive = !isCustom && currentIcon === item.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`da-fab-icon-chip${isActive ? ' is-active' : ''}`}
                                    data-id={item.id}
                                    title={item.label}
                                    dangerouslySetInnerHTML={{ __html: item.svg }}
                                    onClick={() => updateFabSettings({ icon: item.id })}
                                />
                            );
                        })}
                    </div>
                </FormFieldView>

                <FormFieldView
                    label="自定义图标"
                    tooltip="支持上传本地图片（PNG / JPG / WebP）作为悬浮球头像，图片保存在浏览器本地并自动居中裁切。"
                >
                    <div className="da-fab-custom-icon-wrapper">
                        <div className={`da-fab-preview-avatar${isCustom ? ' has-custom' : ''}`}>
                            {isCustom ? (
                                <img alt="自定义头像预览" src={currentIcon} />
                            ) : (
                                <div
                                    className="da-fab-icon"
                                    dangerouslySetInnerHTML={{
                                        __html:
                                            FAB_BUILTIN_ICONS[currentIcon] ??
                                            FAB_BUILTIN_ICONS.palette,
                                    }}
                                />
                            )}
                        </div>

                        <div className="da-fab-action-group">
                            <ButtonControl
                                label={isCustom ? '更换图片' : '上传本地图片'}
                                variant="secondary"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                            />
                            {isCustom && (
                                <ButtonControl
                                    label="移除"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        updateFabSettings({ icon: 'palette' });
                                        Toast.show('已移除自定义头像，恢复预设图标', {
                                            level: 'info',
                                        });
                                    }}
                                />
                            )}
                        </div>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="da-hidden"
                            onChange={(e) =>
                                handleFabIconFileChange(e.currentTarget as HTMLInputElement)
                            }
                        />
                    </div>
                </FormFieldView>

                <FormFieldView label="绘图动效" width="w-240">
                    <SelectControl
                        value={currentAnim}
                        options={[...FAB_ANIMATION_OPTIONS]}
                        onChange={(val) =>
                            updateFabSettings({ animationType: val as FabAnimationOption })
                        }
                    />
                </FormFieldView>
            </CardView>
        </>
    );
}

export function createFabTabView(): SettingsView {
    return createPreactSettingsView({
        id: 'fab',
        title: '悬浮球',
        className: 'da-tab-pane da-view-fab',
        render: () => <FabTab />,
    });
}
