/**
 * 悬浮球设置选项卡视图 (FabTabView)。
 *
 * @remarks
 * 基于 Preact JSX 与 ReactiveSettingsBridge 声明式构建：
 * 1. 基础行为卡片：常驻显隐开关、不透明度滑块与停靠位置重置按钮；
 * 2. 图标与外观卡片：内置矢量图标切换、自定义圆形头像本地上传与互斥预览。
 */

import { useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import {
    PreactSettingsView,
    CardView,
    FormFieldView,
    SwitchControl,
    SliderControl,
    ButtonControl,
} from '../framework';
import { ReactiveSettingsBridge } from '../viewmodels';
import { eventBus } from '../../util/event-bus';
import { Toast } from '../feedback/toast';
import { FAB_BUILTIN_ICONS } from '../entry/fab';

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

export class FabTabView extends PreactSettingsView {
    public readonly id = 'fab';
    public readonly title = '悬浮球设置';

    private readonly bridge: ReactiveSettingsBridge;

    public constructor() {
        super('da-tab-pane da-view-fab');
        this.bridge = new ReactiveSettingsBridge(false);
        this.mountPreact();
    }

    private isCustomIcon(icon: string): boolean {
        return (
            icon.startsWith('data:image') ||
            icon.startsWith('http://') ||
            icon.startsWith('https://')
        );
    }

    private updateTrigger(patch: Partial<{ visible: boolean; opacity: number; icon: string }>): void {
        const currentTrigger = this.bridge.get('ui')?.trigger || {
            visible: true,
            opacity: 0.95,
            icon: 'palette',
        };
        this.bridge.updateUi({
            trigger: {
                ...currentTrigger,
                ...patch,
            },
        });
    }

    private handleFileChange(inputEl: HTMLInputElement): void {
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
                this.updateTrigger({ icon: dataUrl });
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

    protected renderContent(): VNode {
        const fileInputRef = useRef<HTMLInputElement | null>(null);

        const trigger = this.bridge.settings.value.ui?.trigger;
        const visible = trigger?.visible ?? true;
        const opacityPct = Math.round((trigger?.opacity ?? 0.95) * 100);
        const currentIcon = (trigger?.icon as string) || 'palette';
        const isCustom = this.isCustomIcon(currentIcon);

        return (
            <>
                <CardView title="基础行为">
                    <FormFieldView
                        label="启用悬浮球"
                        tooltip="在屏幕边缘保留常驻悬浮入口，点击可随时打开设置面板"
                        width="w-toggle"
                    >
                        <SwitchControl
                            value={visible}
                            onChange={(checked) => this.updateTrigger({ visible: checked })}
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="悬浮球透明度"
                        tooltip="调节悬浮球未悬停时的透明度 (20% ~ 100%)"
                        width="w-240"
                    >
                        <SliderControl
                            min={20}
                            max={100}
                            step={5}
                            value={opacityPct}
                            unit="%"
                            onChange={(val) =>
                                this.updateTrigger({
                                    opacity: Number((val / 100).toFixed(2)),
                                })
                            }
                        />
                    </FormFieldView>

                    <FormFieldView
                        label="悬浮球位置"
                        tooltip="将悬浮球停靠坐标恢复至屏幕默认吸附位置"
                    >
                        <ButtonControl
                            label="重置默认位置"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                eventBus.emit('ui:reset-fab-position');
                                Toast.show('已重置悬浮球停靠位置', { level: 'info' });
                            }}
                        />
                    </FormFieldView>
                </CardView>

                <CardView title="图标与外观">
                    <FormFieldView
                        label="内置图标"
                        tooltip="选择内置矢量图标作为悬浮球图案"
                    >
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
                                        onClick={() => this.updateTrigger({ icon: item.id })}
                                    />
                                );
                            })}
                        </div>
                    </FormFieldView>

                    <FormFieldView
                        label="自定义图标"
                        tooltip="上传本地图片作为悬浮球头像，自动裁剪为圆形显示"
                    >
                        <div className="da-fab-custom-icon-wrapper">
                            <div className="da-fab-preview-avatar">
                                <img
                                    alt="自定义头像预览"
                                    src={isCustom ? currentIcon : ''}
                                    style={{ display: isCustom ? 'block' : 'none' }}
                                />
                                <div
                                    className="da-fab-icon"
                                    style={{ display: isCustom ? 'none' : 'flex' }}
                                    dangerouslySetInnerHTML={{
                                        __html:
                                            FAB_BUILTIN_ICONS[currentIcon] ??
                                            FAB_BUILTIN_ICONS.palette,
                                    }}
                                />
                            </div>

                            <div className="da-fab-action-group">
                                <ButtonControl
                                    label={isCustom ? '更换图片' : '上传本地图片'}
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                />
                                <button
                                    type="button"
                                    className="da-btn da-btn--ghost da-btn--sm"
                                    style={{ display: isCustom ? 'inline-flex' : 'none' }}
                                    onClick={() => {
                                        this.updateTrigger({ icon: 'palette' });
                                        Toast.show('已移除自定义头像，恢复内置图标', {
                                            level: 'info',
                                        });
                                    }}
                                >
                                    <span className="da-btn__label">移除</span>
                                </button>
                            </div>

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) =>
                                    this.handleFileChange(e.currentTarget as HTMLInputElement)
                                }
                            />
                        </div>
                    </FormFieldView>
                </CardView>
            </>
        );
    }

    public override activate(): void {
        this.bridge.activate();
    }

    public override deactivate(): void {
        this.bridge.deactivate();
    }

    public override dispose(): void {
        this.bridge.dispose();
        super.dispose();
    }
}
