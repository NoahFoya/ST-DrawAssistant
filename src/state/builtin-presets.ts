/**
 * 内置出厂预设定义
 * 静态导入自 config/default-settings.json，提供各业务模块使用的初始不可变预设源。
 */

import defaultSettingsJson from '../../config/default-settings.json';
import { PresetsArchiveData, PresetItem } from '../types';

export const BUILTIN_PRESETS: PresetsArchiveData = defaultSettingsJson.presets as unknown as PresetsArchiveData;

export const BUILTIN_PRESET_THEMES: PresetItem[] = BUILTIN_PRESETS.themes;
export const BUILTIN_PROMPTS: PresetItem[] = BUILTIN_PRESETS.prompts;
export const BUILTIN_WORKFLOWS: PresetItem[] = BUILTIN_PRESETS.workflows;
export const BUILTIN_DRAWING: Record<string, PresetItem[]> = BUILTIN_PRESETS.drawing;
