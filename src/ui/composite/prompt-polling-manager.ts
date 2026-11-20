/**
 * 提示词预设轮询候选池管理组件 (PromptPollingManager)。
 *
 * @remarks
 * 参照 LoraManager 交互规范构建，供四大生图服务视图在「提示词预设 = 使用轮询」时共享复用：
 * 1. 顶部工具栏：支持一键添加全部当前服务预设、全部启用/停用、清空候选池；
 * 2. 添加行：通过下拉框选择提示词预设并添加至当前绘画预设的专属轮询池；
 * 3. 条目列表：展示每项预设的启用开关、名称、正向前缀摘要及失效警示，支持单项移除。
 */

import type { PresetItem, PromptPollingPoolItem, PromptPresetData } from '@types';
import type { Disposable, UIComponent } from '../types';
import type { BadgeVariant } from '../components/badge';
import { Button } from '../components/button';
import { Select } from '../components/select';
import { Switch } from '../components/switch';
import { renderIcon } from '../components/icons';
import { normalizePresetNameKey } from '../../store/settings-store';

export interface PromptPollingManagerOptions {
    /** 当前服务可用的全部提示词预设列表 */
    availablePresets: PresetItem<PromptPresetData>[];
    /** 当前绘画预设保存的轮询池条目列表 */
    initialItems?: PromptPollingPoolItem[];
    /** 候选池内容变更回调 */
    onChange?: (items: PromptPollingPoolItem[]) => void;
    /** 是否嵌入在独立弹窗等外层容器中（启用后隐藏外框、冗余标题与顶栏清空按钮） */
    embedded?: boolean;
    /** 附加类名 */
    className?: string;
}

export interface PromptPollingPoolSummary {
    readonly validEnabledCount: number;
    readonly hasInvalidEntries: boolean;
    readonly isInvalid: boolean;
    readonly managerLabel: string;
    readonly entryLabel: string;
    readonly badgeVariant: BadgeVariant;
}

/** 按预设 ID 或规范化名称匹配当前可用的提示词预设 */
export function resolvePollingPoolPreset(
    entry: PromptPollingPoolItem,
    availablePresets: readonly PresetItem<PromptPresetData>[]
): PresetItem<PromptPresetData> | undefined {
    const byId = availablePresets.find((p) => p.id === entry.presetId);
    if (byId) return byId;
    if (entry.presetName) {
        const nameKey = normalizePresetNameKey(entry.presetName);
        return availablePresets.find((p) => normalizePresetNameKey(p.name) === nameKey);
    }
    return undefined;
}

/** 汇总轮询候选池的启用统计与徽标语义状态 */
export function summarizePromptPollingPool(
    items: readonly PromptPollingPoolItem[] | undefined,
    availablePresets: readonly PresetItem<PromptPresetData>[]
): PromptPollingPoolSummary {
    const list = Array.isArray(items) ? items : [];
    let validEnabledCount = 0;
    let hasInvalidEntries = false;
    for (const entry of list) {
        const matched = resolvePollingPoolPreset(entry, availablePresets);
        if (!matched) {
            hasInvalidEntries = true;
        } else if (entry.enabled !== false) {
            validEnabledCount++;
        }
    }

    if (list.length === 0) {
        return {
            validEnabledCount: 0,
            hasInvalidEntries: false,
            isInvalid: false,
            managerLabel: `未指定池 · 自动轮询全部 (${availablePresets.length} 项)`,
            entryLabel: `默认轮询全部 (${availablePresets.length})`,
            badgeVariant: 'neutral',
        };
    }

    if (validEnabledCount === 0) {
        return {
            validEnabledCount: 0,
            hasInvalidEntries,
            isInvalid: true,
            managerLabel: '已配置但无启用项 (将拦截生成)',
            entryLabel: '无可用启用项',
            badgeVariant: 'danger',
        };
    }

    return {
        validEnabledCount,
        hasInvalidEntries,
        isInvalid: false,
        managerLabel: `已启用 ${validEnabledCount} / ${list.length} 项${hasInvalidEntries ? ' · 含失效项' : ''}`,
        entryLabel: `已启用 ${validEnabledCount} / ${list.length} 项${hasInvalidEntries ? ' (含失效)' : ''}`,
        badgeVariant: hasInvalidEntries ? 'warning' : 'primary',
    };
}

/** 截断提示词摘要文本，避免长串画师标签撑破条目行 */
function summarizePromptPreset(preset?: PresetItem<PromptPresetData>): string {
    if (!preset?.data) return '';
    const prefix = (preset.data.positivePrefix || '').trim();
    const suffix = (preset.data.positiveSuffix || '').trim();
    const preview = prefix || suffix;
    if (!preview) return '空模板（仅基础设置）';
    return preview.length > 68 ? `${preview.slice(0, 65)}...` : preview;
}

export class PromptPollingManager implements UIComponent, Disposable {
    public readonly element: HTMLElement;

    private availablePresets: PresetItem<PromptPresetData>[] = [];
    private items: PromptPollingPoolItem[] = [];
    private readonly onChangeCallback?: (items: PromptPollingPoolItem[]) => void;

    private readonly statusBadgeEl: HTMLElement;
    private readonly addSelect: Select;
    private readonly addBtn: Button;
    private readonly addAllBtn: Button;
    private readonly toggleAllBtn: Button;
    private readonly clearBtn: Button;
    private readonly listContainer: HTMLElement;
    private readonly rowDisposers: Disposable[] = [];

    public constructor(options: PromptPollingManagerOptions) {
        this.availablePresets = Array.isArray(options.availablePresets)
            ? [...options.availablePresets]
            : [];
        this.items = Array.isArray(options.initialItems)
            ? options.initialItems.map((it) => ({ ...it }))
            : [];
        this.onChangeCallback = options.onChange;

        const isEmbedded = Boolean(options.embedded);

        this.element = document.createElement('div');
        this.element.className = [
            'da-polling-panel',
            isEmbedded ? 'da-polling-panel--embedded' : '',
            options.className,
        ]
            .filter(Boolean)
            .join(' ');

        // 1. 面板头部标题与快捷批量操作
        const header = document.createElement('div');
        header.className = 'da-polling-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'da-polling-title-wrap';

        if (!isEmbedded) {
            const titleEl = document.createElement('span');
            titleEl.className = 'da-polling-title';
            titleEl.textContent = '轮询候选池';
            titleWrap.appendChild(titleEl);
        }

        this.statusBadgeEl = document.createElement('span');
        this.statusBadgeEl.className = 'da-polling-badge';
        titleWrap.appendChild(this.statusBadgeEl);
        header.appendChild(titleWrap);

        const quickActions = document.createElement('div');
        quickActions.className = 'da-polling-quick-actions';

        this.addAllBtn = new Button({
            label: '添加全部',
            variant: 'secondary',
            size: 'sm',
            onClick: () => this.handleAddAll(),
        });
        this.toggleAllBtn = new Button({
            label: '全启/全停',
            variant: 'ghost',
            size: 'sm',
            onClick: () => this.handleToggleAll(),
        });
        this.clearBtn = new Button({
            label: '清空',
            variant: 'ghost',
            size: 'sm',
            onClick: () => this.handleClear(),
        });

        quickActions.appendChild(this.addAllBtn.element);
        quickActions.appendChild(this.toggleAllBtn.element);
        if (!isEmbedded) {
            quickActions.appendChild(this.clearBtn.element);
        }
        header.appendChild(quickActions);
        this.element.appendChild(header);

        // 2. 下拉检索添加栏
        const addBar = document.createElement('div');
        addBar.className = 'da-polling-add-bar';

        this.addSelect = new Select({
            placeholder: '选择提示词预设加入轮询池...',
            options: [],
        });
        this.addBtn = new Button({
            label: '添加',
            variant: 'secondary',
            size: 'sm',
            onClick: () => this.handleAddSelected(),
        });

        addBar.appendChild(this.addSelect.element);
        addBar.appendChild(this.addBtn.element);
        this.element.appendChild(addBar);

        // 3. 候选条目容器
        this.listContainer = document.createElement('div');
        this.listContainer.className = 'da-polling-list';
        this.element.appendChild(this.listContainer);

        this.renderAll();
    }

    /** 同步最新可用提示词列表与已绑定池数据（静默刷新不回传 onChange） */
    public sync(
        availablePresets: PresetItem<PromptPresetData>[],
        items: PromptPollingPoolItem[] | undefined
    ): void {
        const nextPresets = Array.isArray(availablePresets) ? [...availablePresets] : [];
        const nextItems = Array.isArray(items) ? items.map((it) => ({ ...it })) : [];

        const samePresets =
            nextPresets.length === this.availablePresets.length &&
            nextPresets.every(
                (p, idx) =>
                    p.id === this.availablePresets[idx]?.id &&
                    p.name === this.availablePresets[idx]?.name &&
                    p.data?.positivePrefix === this.availablePresets[idx]?.data?.positivePrefix &&
                    p.data?.positiveSuffix === this.availablePresets[idx]?.data?.positiveSuffix
            );
        const sameItems =
            nextItems.length === this.items.length &&
            nextItems.every(
                (it, idx) =>
                    it.presetId === this.items[idx]?.presetId &&
                    it.enabled === this.items[idx]?.enabled &&
                    it.presetName === this.items[idx]?.presetName
            );

        if (samePresets && sameItems) {
            return;
        }

        this.availablePresets = nextPresets;
        this.items = nextItems;
        this.renderAll();
    }

    /** 获取当前候选池条目快照 */
    public getItems(): PromptPollingPoolItem[] {
        return this.items.map((it) => ({ ...it }));
    }

    /** 替换当前候选池条目并刷新界面（不触发 onChange） */
    public setItems(items: PromptPollingPoolItem[]): void {
        this.items = Array.isArray(items) ? items.map((it) => ({ ...it })) : [];
        this.renderAll();
    }

    private resolvePresetForEntry(entry: PromptPollingPoolItem): PresetItem<PromptPresetData> | undefined {
        return resolvePollingPoolPreset(entry, this.availablePresets);
    }

    private emitChange(): void {
        const snapshot = this.items.map((it) => ({ ...it }));
        this.renderAll();
        this.onChangeCallback?.(snapshot);
    }

    private handleAddSelected(): void {
        const targetId = this.addSelect.getValue();
        if (!targetId) return;
        const preset = this.availablePresets.find((p) => p.id === targetId);
        if (!preset) return;
        if (this.items.some((it) => it.presetId === preset.id)) return;

        this.items.push({
            presetId: preset.id,
            presetName: preset.name,
            enabled: true,
        });
        this.emitChange();
    }

    private handleAddAll(): void {
        if (this.availablePresets.length === 0) return;
        const existingIds = new Set(this.items.map((it) => it.presetId));
        let changed = false;
        for (const preset of this.availablePresets) {
            if (!existingIds.has(preset.id)) {
                this.items.push({
                    presetId: preset.id,
                    presetName: preset.name,
                    enabled: true,
                });
                existingIds.add(preset.id);
                changed = true;
            }
        }
        if (changed) {
            this.emitChange();
        }
    }

    private handleToggleAll(): void {
        if (this.items.length === 0) return;
        const allEnabled = this.items.every((it) => it.enabled !== false);
        this.items = this.items.map((it) => ({
            ...it,
            enabled: !allEnabled,
        }));
        this.emitChange();
    }

    private handleClear(): void {
        if (this.items.length === 0) return;
        this.items = [];
        this.emitChange();
    }

    private disposeRows(): void {
        for (const d of this.rowDisposers) {
            d.dispose();
        }
        this.rowDisposers.length = 0;
    }

    private renderAll(): void {
        this.disposeRows();
        this.listContainer.innerHTML = '';

        // 更新待选下拉列表（排除已在池中的项）
        const inPoolIds = new Set(this.items.map((it) => it.presetId));
        const unadded = this.availablePresets.filter((p) => !inPoolIds.has(p.id));
        this.addSelect.setOptions(
            unadded.map((p) => ({
                value: p.id,
                label: p.name || p.id,
            }))
        );
        this.addSelect.setValue('', { silent: true });
        this.addSelect.setDisabled(unadded.length === 0);
        this.addBtn.setDisabled(unadded.length === 0);
        this.addAllBtn.setDisabled(unadded.length === 0);
        this.toggleAllBtn.setDisabled(this.items.length === 0);
        this.clearBtn.setDisabled(this.items.length === 0);

        // 统计有效启用条目并更新状态徽标
        const summary = summarizePromptPollingPool(this.items, this.availablePresets);
        this.statusBadgeEl.textContent = summary.managerLabel;
        if (this.items.length === 0) {
            this.statusBadgeEl.className = 'da-polling-badge';
        } else if (summary.validEnabledCount === 0 || summary.hasInvalidEntries) {
            this.statusBadgeEl.className = 'da-polling-badge da-polling-badge--warn';
        } else {
            this.statusBadgeEl.className = 'da-polling-badge da-polling-badge--active';
        }

        if (this.items.length === 0) {
            const emptyHint = document.createElement('div');
            emptyHint.className = 'da-polling-empty';
            emptyHint.textContent =
                '当前候选池为空：生图时将从当前服务的全部提示词预设中随机抽取。点击上方「添加全部」或下拉添加，即可像 LoRA 一样逐项勾选或停用特定画师串。';
            this.listContainer.appendChild(emptyHint);
            return;
        }

        for (let idx = 0; idx < this.items.length; idx++) {
            const entry = this.items[idx];
            const matched = this.resolvePresetForEntry(entry);

            const row = document.createElement('div');
            row.className = 'da-polling-item';
            if (!matched) {
                row.classList.add('da-polling-item--invalid');
            } else if (entry.enabled === false) {
                row.classList.add('da-polling-item--disabled');
            }

            const sw = new Switch({
                value: entry.enabled !== false,
                disabled: !matched,
                onChange: (checked) => {
                    this.items[idx] = {
                        ...entry,
                        ...(matched ? { presetId: matched.id, presetName: matched.name } : {}),
                        enabled: checked,
                    };
                    this.emitChange();
                },
            });
            this.rowDisposers.push(sw);

            const info = document.createElement('div');
            info.className = 'da-polling-item__info';

            const nameRow = document.createElement('div');
            nameRow.className = 'da-polling-item__name';
            nameRow.textContent = matched
                ? matched.name
                : `${entry.presetName || entry.presetId} (预设已删除/失效)`;
            info.appendChild(nameRow);

            const previewRow = document.createElement('div');
            previewRow.className = 'da-polling-item__preview';
            previewRow.textContent = matched
                ? summarizePromptPreset(matched)
                : '该提示词预设已不存在，建议移除或重新同步官方预设';
            info.appendChild(previewRow);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'da-polling-item__remove';
            removeBtn.title = '从轮询池移除';
            removeBtn.setAttribute('aria-label', '从轮询池移除');
            removeBtn.innerHTML = renderIcon('close', 14);
            removeBtn.addEventListener('click', () => {
                this.items.splice(idx, 1);
                this.emitChange();
            });

            row.appendChild(sw.element);
            row.appendChild(info);
            row.appendChild(removeBtn);
            this.listContainer.appendChild(row);
        }
    }

    public dispose(): void {
        this.disposeRows();
        this.addSelect.dispose();
        this.addBtn.dispose();
        this.addAllBtn.dispose();
        this.toggleAllBtn.dispose();
        this.clearBtn.dispose();
        this.element.parentElement?.removeChild(this.element);
    }
}
