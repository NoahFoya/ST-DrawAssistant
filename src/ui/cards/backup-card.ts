/**
 * ST-DrawAssistant 配置备份、导入与数据重置卡片。
 *
 * @remarks
 * 提供配置数据全量导出至 JSON、外部方案导入与出厂默认配置恢复能力。
 */

import { CardBase } from './card-base';
import { createFormField, createButton } from '../components';
import { ConfirmDialog } from '../feedback';
import { settingsStore } from '../../store/settings-store';
import { eventBus } from '../../util/event-bus';

export class BackupCard extends CardBase {
    constructor() {
        super({
            title: '配置备份与数据重置',
            badge: '数据管理',
        });

        this.buildFields();
    }

    private buildFields(): void {
        // 1. 导出配置按钮
        const exportBtn = this.registerChild(
            createButton({
                text: '导出全量配置 JSON',
                variant: 'secondary',
                size: 'sm',
                onClick: () => {
                    this.exportConfigFile();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '备份插件配置',
                description: '将当前全部提供方设置、提示词方案与绘图预设导出为 JSON 文件',
                control: exportBtn,
                slotWidth: '240',
            }).element
        );

        // 2. 导入配置按钮与隐藏 input[type="file"]
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.hidden = true;
        this.bodyElement.appendChild(fileInput);

        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target?.result as string;
                if (!text) return;

                const result = settingsStore.importSettings(text);
                if (result.success) {
                    eventBus.emit('toast:show', {
                        type: 'success',
                        message: '配置导入成功并已生效',
                    });
                } else {
                    eventBus.emit('toast:show', {
                        type: 'error',
                        message: `配置导入失败: ${result.error}`,
                    });
                }
                fileInput.value = '';
            };
            reader.readAsText(file);
        });

        const importBtn = this.registerChild(
            createButton({
                text: '导入配置文件',
                variant: 'secondary',
                size: 'sm',
                onClick: () => {
                    fileInput.click();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '恢复备份配置',
                description: '从本地已有的 JSON 备份文件中恢复配置数据',
                control: importBtn,
                slotWidth: '240',
            }).element
        );

        // 3. 恢复出厂推荐预设
        const restorePresetsBtn = this.registerChild(
            createButton({
                text: '恢复推荐预设',
                variant: 'secondary',
                size: 'sm',
                onClick: async () => {
                    const confirmed = await ConfirmDialog.show({
                        title: '恢复推荐预设',
                        message: '确定要将提示词模板、绘图参数与主题恢复为官方推荐方案吗？未保存至其他方案的改动将被覆盖。',
                        confirmText: '确认恢复',
                        cancelText: '取消',
                    });
                    if (confirmed) {
                        settingsStore.restoreDefaultPresets();
                        eventBus.emit('toast:show', {
                            type: 'info',
                            message: '已重新写入出厂推荐预设方案',
                        });
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '恢复预设方案',
                description: '保留通用配置，仅恢复推荐的绘图参数、提示词模板与主题',
                control: restorePresetsBtn,
                slotWidth: '240',
            }).element
        );

        // 4. 重置全部配置 (危险操作)
        const resetAllBtn = this.registerChild(
            createButton({
                text: '重置所有设置',
                variant: 'danger',
                size: 'sm',
                onClick: async () => {
                    const confirmed = await ConfirmDialog.show({
                        title: '恢复出厂状态',
                        message: '确定要将所有设置恢复至初始出厂状态吗？清除所有自定义改动与提供方配置，该操作不可逆！',
                        confirmText: '确认完全重置',
                        cancelText: '取消',
                        danger: true,
                    });
                    if (confirmed) {
                        settingsStore.resetToDefaults();
                        eventBus.emit('toast:show', {
                            type: 'warn',
                            message: '已完全重置所有配置项',
                        });
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '出厂重置',
                description: '清除所有自定义改动与提供方配置，重置为插件初始安装状态',
                control: resetAllBtn,
                slotWidth: '240',
            }).element
        );
    }

    private exportConfigFile(): void {
        const json = settingsStore.exportSettings();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st-drawassistant-settings-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        eventBus.emit('toast:show', {
            type: 'success',
            message: '配置已导出为 JSON 文件',
        });
    }
}
