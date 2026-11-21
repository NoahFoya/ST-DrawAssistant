/**
 * 云端生图服务选项卡共用辅助模块。
 */

import { signal, type Signal } from '@preact/signals';
import type { VNode } from 'preact';
import type { DrawingPresetData } from '@types';
import { CardView, TextareaControl } from '../framework';
import { Toast } from '../feedback/toast';
import type { PresetController } from '../viewmodels';

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

export interface CustomBodyJsonCardProps {
    readonly controller: CustomBodyJsonController;
    readonly dirtyFields: ReadonlySet<string>;
    readonly invalidFields: ReadonlySet<string>;
    readonly placeholder: string;
}

/**
 * 云端服务共用的「自定义请求参数 (JSON)」设置卡片。
 */
export function CustomBodyJsonCard(props: CustomBodyJsonCardProps): VNode {
    const { controller, dirtyFields, invalidFields, placeholder } = props;
    const isJsonDirty = dirtyFields.has('customBodyJson');
    const isJsonInvalid = !controller.isValid.value || invalidFields.has('customBodyJson');

    return (
        <CardView title="自定义请求参数 (JSON)">
            <div className="da-textarea-row">
                <div className="da-textarea-header">
                    <label className="da-field-label">JSON 附加参数</label>
                    <span className="da-field-help">
                        可选填入合法 JSON 对象，生图请求时将合并至请求体顶层
                    </span>
                </div>
                <TextareaControl
                    className="da-custom-body-json"
                    monospace
                    rows={4}
                    dirty={isJsonDirty}
                    invalid={isJsonInvalid}
                    placeholder={placeholder}
                    value={controller.rawInput.value}
                    onChange={(val) => controller.handleInput(val)}
                    onBlur={(val) => controller.handleInput(val)}
                />
            </div>
        </CardView>
    );
}
