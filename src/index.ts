/**
 * ST-DrawAssistant 工作台视图装配与导出。
 */

import { settingsStore } from './store/settings-store';
import { themeService } from './ui/theme';
import { SettingsModal } from './ui/modal/settings-modal';
import { registerDefaultViews } from './ui/views/registry';

export type * from '@types';
export * from './config/constants';
export * from './util';
export * from './store';
export * from './provider';
export * from './pipeline';
export * from './ui';

export function createWorkspaceModal(): SettingsModal {
    themeService.bindTarget();
    themeService.applyCurrentTheme();
    themeService.listenSettings();
    const modal = new SettingsModal();
    registerDefaultViews(modal);
    return modal;
}

export { settingsStore };
