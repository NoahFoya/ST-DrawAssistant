/**
 * 云端生图服务「自定义请求参数 (JSON)」状态控制器。
 */

import { signal, type Signal } from '@preact/signals';
import type { DrawingPresetData } from '@types';
import { Toast } from '../feedback/toast';
import type { PresetController } from './preset-controller';

/**
 * 校验自定义请求体 JSON 字符串是否为合法的非数组纯对象（空字符串视为合法）。
 */
export function isValidCustomBodyJson(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) {
        return true;
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
        return false;
    }
}

/**
 * 统一维护云端服务「自定义请求参数 (JSON)」输入状态、合法性信号与生命周期同步。
 */
export class CustomBodyJsonController {
    public readonly rawInput: Signal<string>;
    public readonly isValid: Signal<boolean>;

    public constructor(private readonly presetController: PresetController<DrawingPresetData>) {
        const initialJson = (presetController.draftConfig.value.customBodyJson as string) || '';
        this.rawInput = signal<string>(initialJson);
        this.isValid = signal<boolean>(true);
        this.syncValidity(initialJson);
    }

    public syncValidity(raw: string): boolean {
        const valid = isValidCustomBodyJson(raw);
        this.isValid.value = valid;
        this.presetController.setFieldInvalid('customBodyJson', !valid);
        return valid;
    }

    public syncFromDraft(raw?: string): void {
        const nextJson =
            raw ?? ((this.presetController.draftConfig.value.customBodyJson as string) || '');
        this.rawInput.value = nextJson;
        this.syncValidity(nextJson);
    }

    public handleInput(raw: string): void {
        this.rawInput.value = raw;
        this.syncValidity(raw);
        this.presetController.updateDraft('customBodyJson', raw.trim());
    }

    public syncOnActivate(): void {
        if (!this.presetController.isDirty.value) {
            this.syncFromDraft();
        } else {
            this.syncValidity(this.rawInput.value);
        }
    }

    public validateBeforeSave(): boolean {
        if (this.isValid.value) {
            return true;
        }
        Toast.show('自定义请求参数 (JSON) 语法无效，请修正后再保存', { level: 'error' });
        return false;
    }
}
