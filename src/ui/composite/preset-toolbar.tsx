/**
 * 预设管理工具栏 (PresetToolbar)。
 *
 * @remarks
 * 基于 Preact JSX 组合预设受控下拉框与 8 项标准图标操作（保存、另存为、重命名、重置、导入、导出、批量导出、删除）：
 * 1. 状态感知响应：配置脏状态驱动保存高亮、重置使能与下拉框脏指示；
 * 2. 未保存修改确认：由 `onAction` 返回 `false` 或 `Promise<false>` 时自动回退选中项；
 * 3. 规范文件导入：支持多选及合集 JSON 批量导入，并触发解析回调。
 */

import type { VNode } from 'preact';
import { useRef } from 'preact/hooks';
import type { SelectOption } from '../components/select';
import { ICONS } from '../components/icons';
import { ButtonControl, SelectControl } from '../framework/controls';

/** 预设操作动作类型 */
export type PresetActionType =
    | 'select'
    | 'new'
    | 'save'
    | 'saveAs'
    | 'rename'
    | 'import'
    | 'export'
    | 'exportAll'
    | 'reset'
    | 'delete';

/** 预设条目数据结构 */
export interface PresetToolbarItem {
    /** 预设唯一标识 */
    id: string;
    /** 预设展示名称 */
    name: string;
}

/** 预设工具栏组件属性 */
export interface PresetToolbarProps {
    /** 预设列表 */
    presets: PresetToolbarItem[];
    /** 当前激活的预设 ID */
    activePresetId: string;
    /** 是否处于未保存脏状态 */
    dirty?: boolean;
    /** 脏状态悬停提示 */
    dirtyHint?: string;
    /** 操作事件回调函数（返回 false 或 Promise<false> 可阻止 select 切换并回退） */
    onAction?: (
        action: PresetActionType,
        presetId: string
    ) => void | boolean | Promise<void | boolean>;
    /** 批量/多文件导入自定义解析回调 */
    onImportFiles?: (files: File[]) => void;
    /** 附加 CSS 类名 */
    className?: string;
}

/** 将内部预设列表映射为 SelectControl 所需的选项列表 */
export function buildPresetToolbarOptions(
    items: PresetToolbarItem[],
    activeId: string
): SelectOption[] {
    if (items.length === 0) {
        if (activeId) {
            return [{ label: activeId, value: activeId }];
        }
        return [{ label: '未选择预设', value: '' }];
    }
    const options: SelectOption[] = items.map((p) => ({
        label: p.name,
        value: p.id,
    }));
    if (activeId && !items.some((p) => p.id === activeId)) {
        options.unshift({
            label: activeId,
            value: activeId,
        });
    }
    return options;
}

export function PresetToolbar(props: PresetToolbarProps): VNode {
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const activeId = props.activePresetId || '';
    const isDirty = Boolean(props.dirty);
    const hasActive = Boolean(activeId && props.presets.some((p) => p.id === activeId));
    const isInvalid = Boolean(activeId && !props.presets.some((p) => p.id === activeId));
    const selectTooltip = isInvalid
        ? `预设不存在或已失效 (ID: ${activeId})`
        : props.dirtyHint || (isDirty ? '当前预设存在未保存的修改' : '');

    const options = buildPresetToolbarOptions(props.presets, activeId);
    const rootClass = ['da-preset-toolbar', props.className || ''].filter(Boolean).join(' ');
    const selectWrapperClass = ['da-preset-select-wrapper', isDirty ? 'is-dirty' : '']
        .filter(Boolean)
        .join(' ');

    const emitAction = (action: PresetActionType, targetId = activeId) => {
        return props.onAction?.(action, targetId);
    };

    return (
        <div className={rootClass}>
            <div className="da-preset-toolbar-left">
                <div className={selectWrapperClass} title={selectTooltip}>
                    <SelectControl
                        value={activeId}
                        options={options}
                        dirty={isDirty}
                        invalid={isInvalid}
                        tooltip={selectTooltip}
                        onChange={(newId) => emitAction('select', newId)}
                    />
                </div>
            </div>

            <div className="da-preset-toolbar-right">
                <ButtonControl
                    variant="icon"
                    tooltip="保存预设修改"
                    className={`da-preset-btn--save${isDirty ? ' is-dirty' : ''}`}
                    icon={ICONS.save}
                    disabled={!hasActive && props.presets.length > 0 && !isDirty}
                    onClick={() => void emitAction('save')}
                />
                <ButtonControl
                    variant="icon"
                    tooltip="新建 / 另存为新预设"
                    icon={ICONS.plus}
                    onClick={() => void emitAction('saveAs')}
                />
                <ButtonControl
                    variant="icon"
                    tooltip="重命名当前预设"
                    icon={ICONS.edit}
                    disabled={!hasActive}
                    onClick={() => void emitAction('rename')}
                />
                <ButtonControl
                    variant="icon"
                    tooltip="重置修改 (放弃草稿并恢复为当前预设初始值)"
                    icon={ICONS.refresh}
                    disabled={!hasActive || !isDirty}
                    onClick={() => void emitAction('reset')}
                />
                <ButtonControl
                    variant="icon"
                    tooltip="导入预设 (支持多选 / 合集 JSON)"
                    icon={ICONS.fileImport}
                    onClick={() => fileInputRef.current?.click()}
                />
                <ButtonControl
                    variant="icon"
                    tooltip="导出当前预设 (JSON)"
                    icon={ICONS.fileExport}
                    disabled={!hasActive}
                    onClick={() => void emitAction('export')}
                />
                <ButtonControl
                    variant="icon"
                    tooltip="批量导出全部预设 (JSON)"
                    icon={ICONS.batchExport}
                    disabled={props.presets.length === 0}
                    onClick={() => void emitAction('exportAll')}
                />
                <ButtonControl
                    variant="icon"
                    tooltip="删除当前预设"
                    className="da-preset-btn--danger"
                    icon={ICONS.trash}
                    disabled={!hasActive}
                    onClick={() => void emitAction('delete')}
                />
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    multiple={true}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const inputEl = e.currentTarget as HTMLInputElement;
                        const files = inputEl.files ? Array.from(inputEl.files) : [];
                        if (files.length > 0) {
                            if (props.onImportFiles) {
                                props.onImportFiles(files);
                            } else {
                                void emitAction('import');
                            }
                            inputEl.value = '';
                        }
                    }}
                />
            </div>
        </div>
    );
}
