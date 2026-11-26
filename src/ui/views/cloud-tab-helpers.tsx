/**
 * 云端生图服务选项卡共用辅助组件。
 */

import type { VNode } from 'preact';
import { CardView, TextareaControl } from '../framework';
import {
    CustomBodyJsonController,
    isValidCustomBodyJson,
} from '../state/custom-body-json-state';

export { CustomBodyJsonController, isValidCustomBodyJson };

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
