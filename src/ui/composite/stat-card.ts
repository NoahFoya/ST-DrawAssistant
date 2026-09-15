/**
 * 统计指标卡片与数据网格组件 (StatCard & StatGrid)
 *
 * 功能：
 * 1. 渲染单个关键指标卡片 (createStatCard)，展示数值、单位与辅助说明；
 * 2. 提供指标卡片自适应网格容器 (createStatGrid)，支持 2/3/4 列布局；
 * 3. 支持成功、警告、错误与信息四种状态变体高亮。
 *
 * Tips：
 * 1. 数值变更时通过 setValue 仅更新文本节点，避免整卡重绘引起的闪烁；
 * 2. 适用于画廊存储占用、累计生成数量及性能耗时统计。
 */

import type { StatItemModel } from '@types';

export interface StatCardHandle {
    readonly element: HTMLElement;
    setValue(val: string | number, unit?: string): void;
    setVariant(variant?: 'success' | 'warn' | 'error' | 'info'): void;
    dispose(): void;
}

export function createStatCard(item: StatItemModel): StatCardHandle {
    const card = document.createElement('div');
    card.className = 'da-stat-card';
    if (item.variant) {
        card.classList.add(`da-stat-card--${item.variant}`);
    }

    const valEl = document.createElement('div');
    valEl.className = 'da-stat-card__val';

    let numText = document.createTextNode(String(item.value));
    valEl.appendChild(numText);

    let unitEl: HTMLElement | null = null;
    if (item.unit) {
        unitEl = document.createElement('span');
        unitEl.className = 'da-stat-card__unit';
        unitEl.textContent = ` ${item.unit}`;
        valEl.appendChild(unitEl);
    }
    card.appendChild(valEl);

    const labelEl = document.createElement('div');
    labelEl.className = 'da-stat-card__label';
    labelEl.textContent = item.label;
    card.appendChild(labelEl);

    if (item.hint) {
        const hintEl = document.createElement('div');
        hintEl.className = 'da-stat-card__hint';
        hintEl.textContent = item.hint;
        card.appendChild(hintEl);
    }

    return {
        element: card,
        setValue(val: string | number, unit?: string): void {
            numText.textContent = String(val);
            if (unit !== undefined) {
                if (!unitEl) {
                    unitEl = document.createElement('span');
                    unitEl.className = 'da-stat-card__unit';
                    valEl.appendChild(unitEl);
                }
                unitEl.textContent = unit ? ` ${unit}` : '';
            }
        },
        setVariant(variant?: 'success' | 'warn' | 'error' | 'info'): void {
            card.classList.remove('da-stat-card--success', 'da-stat-card--warn', 'da-stat-card--error', 'da-stat-card--info');
            if (variant) {
                card.classList.add(`da-stat-card--${variant}`);
            }
        },
        dispose(): void {
            card.remove();
        }
    };
}

export interface StatGridHandle {
    readonly element: HTMLElement;
    updateItem(index: number, val: string | number, unit?: string): void;
    dispose(): void;
}

export function createStatGrid(items: StatItemModel[], columns: 3 | 4 = 4): StatGridHandle {
    const grid = document.createElement('div');
    grid.className = 'da-stat-grid';
    if (columns === 3) {
        grid.classList.add('da-stat-grid--3-cols');
    }

    const cardHandles = items.map((item) => {
        const handle = createStatCard(item);
        grid.appendChild(handle.element);
        return handle;
    });

    return {
        element: grid,
        updateItem(index: number, val: string | number, unit?: string): void {
            if (cardHandles[index]) {
                cardHandles[index].setValue(val, unit);
            }
        },
        dispose(): void {
            cardHandles.forEach((c) => c.dispose());
            grid.remove();
        }
    };
}
