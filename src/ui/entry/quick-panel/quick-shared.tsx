/**
 * 悬浮球快捷面板共享布局原语 (`QuickSection` / `QuickFormRow`)。
 */

import type { ComponentChildren, VNode } from 'preact';
import type { DrawAssistantSettings } from '../../../store/settings-store';
import type { QuickPanelState } from '../../state/quick-panel-state';

export interface QuickPanelSubViewProps {
    readonly state: QuickPanelState;
    readonly settings: DrawAssistantSettings;
}

export interface QuickSectionProps {
    readonly title: string;
    readonly hint?: string;
    readonly children: ComponentChildren;
}

export function QuickSection(props: QuickSectionProps): VNode {
    return (
        <div className="da-fqp-section">
            <div className="da-fqp-section__header">
                <span className="da-fqp-section__title">{props.title}</span>
                {props.hint && <span className="da-fqp-section__hint">{props.hint}</span>}
            </div>
            <div className="da-fqp-section__rows">{props.children}</div>
        </div>
    );
}

export interface QuickFormRowProps {
    readonly label: string;
    readonly disabled?: boolean;
    readonly children: ComponentChildren;
}

export function QuickFormRow(props: QuickFormRowProps): VNode {
    return (
        <div className={`da-fqp-row${props.disabled ? ' is-disabled' : ''}`}>
            <span className="da-fqp-row__label" title={props.label}>
                {props.label}
            </span>
            <div className="da-fqp-row__control">{props.children}</div>
        </div>
    );
}
