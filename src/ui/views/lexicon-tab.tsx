/**
 * 词库选项卡视图 (LexiconTab / createLexiconTabView)。
 *
 * @remarks
 * 纯本地联想词库管理界面（无预设管理器、无酒馆上下文注入设置）：
 * 1. 数据保存于浏览器 IndexedDB (`st_draw_assistant_lexicon`)，
 *    独立于「提示词 -> 词汇指导」，专门为编辑框输入联想提供数据源；
 * 2. 词汇文件 (`files`)：在统一单行列表中展示按需载入的预置 Danbooru 词库分片（默认未载入）与手动导入文件
 *    （支持 Tagcomplete CSV、双列中英 CSV/TSV/TXT 与 JSON），支持原地载入/卸载、独立启停与清空管理；
 * 3. 自定义词汇 (`custom`)：支持表格样式数据网格编辑、尾部空白行自增、右键/长按菜单插入与多行文本解析。
 */

import type { VNode } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { LocalLexiconFileMeta, LocalCustomWordItem } from '@types';
import type { Disposable } from '../types';
import {
    createPreactSettingsView,
    CardView,
    SwitchControl,
    ButtonControl,
    SegmentedControlView,
    type StatefulSettingsView,
} from '../framework';
import type { LocalLexiconStorage } from '../../store/local-lexicon-storage';
import { Toast } from '../feedback/toast';
import { createPointAnchorRect, openFloatingSurface } from '../layout/floating-sheet';
import { LexiconState, type LexiconSubTab } from '../state/lexicon-state';

export type { LexiconSubTab };

export interface LexiconLifecycleBridge {
    onActivate?: () => void;
    onDeactivate?: () => void;
    onDispose?: () => void;
}

export interface LexiconTabProps {
    state: LexiconState;
    lifecycleBridge?: LexiconLifecycleBridge;
}

export function LexiconTab(props: LexiconTabProps): VNode {
    const { state, lifecycleBridge } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const draftBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focusCellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const contextMenuHandleRef = useRef<Disposable | null>(null);
    const isKeydownBoundRef = useRef(false);
    const isUnmountedRef = useRef(false);
    const touchStartRef = useRef({ x: 0, y: 0 });

    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && state.insertedDraft.value) {
            state.dismissInsertedDraft();
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
        }
    };

    const bindGlobalKeyDown = (): void => {
        if (isKeydownBoundRef.current || isUnmountedRef.current || typeof window === 'undefined') {
            return;
        }
        window.addEventListener('keydown', handleGlobalKeyDown, true);
        isKeydownBoundRef.current = true;
    };

    const unbindGlobalKeyDown = (): void => {
        if (!isKeydownBoundRef.current || typeof window === 'undefined') {
            return;
        }
        window.removeEventListener('keydown', handleGlobalKeyDown, true);
        isKeydownBoundRef.current = false;
    };

    const closeContextMenu = (): void => {
        if (contextMenuHandleRef.current) {
            const handle = contextMenuHandleRef.current;
            contextMenuHandleRef.current = null;
            handle.dispose();
        }
    };

    const focusCell = (rowSelector: string, col: 'tag' | 'cn', select = false): void => {
        if (typeof document === 'undefined' || isUnmountedRef.current) return;
        if (focusCellTimerRef.current) {
            clearTimeout(focusCellTimerRef.current);
        }
        focusCellTimerRef.current = setTimeout(() => {
            focusCellTimerRef.current = null;
            if (isUnmountedRef.current) return;
            const row = containerRef.current?.querySelector<HTMLElement>(rowSelector);
            const input = row?.querySelector<HTMLInputElement>(
                col === 'tag' ? '.da-lexicon-cell-tag' : '.da-lexicon-cell-cn'
            );
            if (input) {
                input.focus();
                if (select) {
                    input.select();
                }
            }
        }, 30);
    };

    const scheduleDraftBlurCommit = (): void => {
        if (draftBlurTimerRef.current) {
            clearTimeout(draftBlurTimerRef.current);
        }
        draftBlurTimerRef.current = setTimeout(() => {
            draftBlurTimerRef.current = null;
            const activeEl = document.activeElement;
            const inDraft = activeEl?.closest('.da-lexicon-inserted-row');
            if (!inDraft) {
                void state.commitInsertedDraftRow();
            }
        }, 120);
    };

    const handleCellPaste = async (
        e: ClipboardEvent,
        insertIndex: number
    ): Promise<void> => {
        const text = e.clipboardData?.getData('text') || '';
        if (text.includes('\n') || text.includes('\t')) {
            e.preventDefault();
            await state.applyMultiLinePasteText(text, insertIndex);
        }
    };

    const handleCommitTailDraftRow = async (autoFocusNext = false): Promise<void> => {
        const saved = await state.commitTailDraftRow();
        if (saved && autoFocusNext) {
            focusCell('.da-lexicon-tail-draft-row', 'tag');
        }
    };

    const openContextMenu = (
        clientX: number,
        clientY: number,
        item: LocalCustomWordItem,
        index: number,
        anchorEl?: HTMLElement | null
    ): void => {
        closeContextMenu();
        const anchorRect = anchorEl
            ? anchorEl.getBoundingClientRect()
            : createPointAnchorRect(clientX, clientY);

        contextMenuHandleRef.current = openFloatingSurface({
            stackId: 'lexicon-context-menu',
            title: item.tag ? `词条：${item.tag}` : '词条操作',
            anchorRect,
            preferredPlacement: 'bottom',
            align: anchorEl ? 'end' : 'start',
            desktopWidth: 190,
            estimatedHeight: 220,
            panelClassName: 'da-lexicon-context-menu',
            entries: [
                {
                    label: '复制英文 Tag',
                    onSelect: () => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            void navigator.clipboard.writeText(item.tag);
                            Toast.show(`已复制 Tag: ${item.tag}`, { level: 'success' });
                        }
                    },
                },
                {
                    label: '编辑此行',
                    onSelect: () => {
                        const escapedId =
                            typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                                ? CSS.escape(item.id)
                                : item.id.replace(/["\\]/g, '\\$&');
                        focusCell(
                            `.da-lexicon-custom-row[data-word-id="${escapedId}"]`,
                            'tag',
                            true
                        );
                    },
                },
                { type: 'divider' },
                {
                    label: '在上方插入行',
                    onSelect: () => {
                        state.beginInsertDraftAt(index);
                        focusCell('.da-lexicon-inserted-row', 'tag');
                    },
                },
                {
                    label: '在下方插入行',
                    onSelect: () => {
                        state.beginInsertDraftAt(index + 1);
                        focusCell('.da-lexicon-inserted-row', 'tag');
                    },
                },
                { type: 'divider' },
                {
                    label: '删除此词条',
                    danger: true,
                    onSelect: () => {
                        void state.deleteCustomWord(item.id);
                    },
                },
            ],
            onClose: () => {
                contextMenuHandleRef.current = null;
            },
        });
    };

    const handleRowContextMenu = (
        e: MouseEvent,
        item: LocalCustomWordItem,
        index: number
    ): void => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(e.clientX, e.clientY, item, index);
    };

    const handleRowTouchStart = (
        e: TouchEvent,
        item: LocalCustomWordItem,
        index: number
    ): void => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        touchTimerRef.current = setTimeout(() => {
            touchTimerRef.current = null;
            openContextMenu(touch.clientX, touch.clientY, item, index);
        }, 500);
    };

    const handleRowTouchMove = (e: TouchEvent): void => {
        if (!touchTimerRef.current) return;
        const touch = e.touches[0];
        if (!touch) return;
        if (
            Math.hypot(
                touch.clientX - touchStartRef.current.x,
                touch.clientY - touchStartRef.current.y
            ) > 10
        ) {
            clearTimeout(touchTimerRef.current);
            touchTimerRef.current = null;
        }
    };

    const handleRowTouchEnd = (): void => {
        if (touchTimerRef.current) {
            clearTimeout(touchTimerRef.current);
            touchTimerRef.current = null;
        }
    };

    useLayoutEffect(() => {
        isUnmountedRef.current = false;
        bindGlobalKeyDown();
        if (lifecycleBridge) {
            lifecycleBridge.onActivate = () => {
                bindGlobalKeyDown();
            };
            lifecycleBridge.onDeactivate = () => {
                unbindGlobalKeyDown();
                closeContextMenu();
            };
            lifecycleBridge.onDispose = () => {
                isUnmountedRef.current = true;
                unbindGlobalKeyDown();
                closeContextMenu();
                if (touchTimerRef.current) {
                    clearTimeout(touchTimerRef.current);
                    touchTimerRef.current = null;
                }
                if (draftBlurTimerRef.current) {
                    clearTimeout(draftBlurTimerRef.current);
                    draftBlurTimerRef.current = null;
                }
                if (focusCellTimerRef.current) {
                    clearTimeout(focusCellTimerRef.current);
                    focusCellTimerRef.current = null;
                }
            };
        }
        return () => {
            isUnmountedRef.current = true;
            unbindGlobalKeyDown();
            closeContextMenu();
            if (touchTimerRef.current) {
                clearTimeout(touchTimerRef.current);
                touchTimerRef.current = null;
            }
            if (draftBlurTimerRef.current) {
                clearTimeout(draftBlurTimerRef.current);
                draftBlurTimerRef.current = null;
            }
            if (focusCellTimerRef.current) {
                clearTimeout(focusCellTimerRef.current);
                focusCellTimerRef.current = null;
            }
            if (lifecycleBridge) {
                lifecycleBridge.onActivate = undefined;
                lifecycleBridge.onDeactivate = undefined;
                lifecycleBridge.onDispose = undefined;
            }
        };
    }, [state, lifecycleBridge]);

    const renderFilesSubPanel = (): VNode => {
        const files = state.filesMeta.value;
        const manifest = state.presetManifest.value;
        const manifestLoading = state.presetManifestLoading.value;
        const manifestError = state.presetManifestError.value;
        const busySet = state.busyPresetPackIds.value;

        const loadedPresetMap = new Map<string, LocalLexiconFileMeta>();
        for (const f of files) {
            if (f.presetPackId) {
                loadedPresetMap.set(f.presetPackId, f);
            }
        }

        const presetPacks = manifest?.packs ?? [];
        const renderedPresetIds = new Set(presetPacks.map((p) => p.id));
        const customOrExtraFiles = files.filter(
            (f) => !f.presetPackId || !renderedPresetIds.has(f.presetPackId)
        );
        const isAllEmpty =
            !manifestLoading && customOrExtraFiles.length === 0 && presetPacks.length === 0;
        const hasUnloadedPresetPacks = presetPacks.some((p) => !loadedPresetMap.has(p.id));
        const hasLoadedPresetPacks = presetPacks.some((p) => loadedPresetMap.has(p.id));
        const isAnyPackBusy = busySet.size > 0;

        return (
            <CardView
                className="da-card--padded"
                title={`词汇文件 (${files.length})`}
                subtitle="按需载入本地词库或导入自定义词表用于输入联想（支持 CSV / TSV / JSON）"
                actions={
                    <div className="da-extra-fields-toolbar">
                        {presetPacks.length > 0 && hasUnloadedPresetPacks && (
                            <ButtonControl
                                label="一键载入"
                                variant="secondary"
                                size="sm"
                                disabled={isAnyPackBusy}
                                onClick={() => void state.loadAllPresetPacks()}
                            />
                        )}
                        {presetPacks.length > 0 && hasLoadedPresetPacks && (
                            <ButtonControl
                                label="一键卸载"
                                variant="secondary"
                                size="sm"
                                disabled={isAnyPackBusy}
                                onClick={() => void state.unloadAllPresetPacks()}
                            />
                        )}
                        {files.length > 0 && (
                            <ButtonControl
                                label="清空全部"
                                variant="danger"
                                size="sm"
                                className="da-lexicon-clear-files-btn"
                                onClick={() => void state.clearAllFiles(files.length)}
                            />
                        )}
                        <ButtonControl
                            label="+ 导入文件"
                            variant="primary"
                            size="sm"
                            tooltip="支持导入 Danbooru/Tagcomplete 三列 CSV、双列中英 CSV/TSV 以及通用 JSON 词表（推荐 UTF-8 编码）。"
                            className="da-lexicon-import-file-btn"
                            onClick={() => fileInputRef.current?.click()}
                        />
                    </div>
                }
            >
                {manifestError && !manifest && (
                    <div className="da-empty-hint da-lexicon-preset-error-bar">
                        <span>本地词库清单读取失败：{manifestError}</span>
                        <ButtonControl
                            label="重试"
                            variant="secondary"
                            size="sm"
                            onClick={() => void state.ensurePresetManifestLoaded(true)}
                        />
                    </div>
                )}

                {manifestLoading && !manifest && (
                    <div className="da-empty-hint">正在读取本地词库清单...</div>
                )}

                {isAllEmpty ? (
                    <div className="da-empty-hint da-lexicon-empty-hint">
                        当前尚未载入任何词汇文件，点击右上角「+ 导入文件」可载入本地词表。
                    </div>
                ) : (
                    <div className="da-lexicon-files-list">
                        {customOrExtraFiles.map((file) => (
                            <div
                                key={file.id}
                                className="da-lexicon-file-row"
                                data-file-id={file.id}
                            >
                                <div className="da-lexicon-file-row__left">
                                    <SwitchControl
                                        value={Boolean(file.enabled)}
                                        onChange={(checked) => {
                                            void state.setFileEnabled(
                                                file.id,
                                                checked
                                            );
                                        }}
                                    />
                                    <span className="da-lexicon-file-name">
                                        <strong>{file.fileName}</strong>
                                    </span>
                                    <span className="da-lexicon-file-meta">
                                        {file.entryCount.toLocaleString()} 词条
                                    </span>
                                </div>
                                <div className="da-lexicon-file-row__right">
                                    <ButtonControl
                                        label="✕"
                                        variant="danger"
                                        size="sm"
                                        className="da-lexicon-delete-file-btn"
                                        onClick={() =>
                                            void state.deleteFile(file.id, file.fileName)
                                        }
                                    />
                                </div>
                            </div>
                        ))}

                        {presetPacks.map((pack) => {
                            const loadedMeta = loadedPresetMap.get(pack.id);
                            const isLoaded = Boolean(loadedMeta);
                            const isBusy = busySet.has(pack.id);

                            return (
                                <div
                                    key={pack.id}
                                    className={`da-lexicon-file-row${
                                        isLoaded ? '' : ' da-lexicon-file-row--unloaded'
                                    }`}
                                    data-preset-pack-id={pack.id}
                                    {...(loadedMeta ? { 'data-file-id': loadedMeta.id } : {})}
                                >
                                    <div className="da-lexicon-file-row__left">
                                        <SwitchControl
                                            value={isLoaded && Boolean(loadedMeta?.enabled)}
                                            disabled={!isLoaded || isBusy}
                                            onChange={(checked) => {
                                                if (loadedMeta) {
                                                    void state.setFileEnabled(
                                                        loadedMeta.id,
                                                        checked
                                                    );
                                                }
                                            }}
                                        />
                                        <span className="da-lexicon-file-name">
                                            <strong>{pack.displayName}</strong>
                                        </span>
                                        <span className="da-lexicon-file-meta">
                                            {pack.entryCount.toLocaleString()} 词条
                                        </span>
                                    </div>
                                    <div className="da-lexicon-file-row__right">
                                        {isLoaded ? (
                                            <ButtonControl
                                                label="卸载"
                                                variant="danger"
                                                size="sm"
                                                loading={isBusy}
                                                loadingText="卸载中..."
                                                disabled={isBusy}
                                                className="da-lexicon-preset-unload-btn"
                                                onClick={() => void state.unloadPresetPack(pack)}
                                            />
                                        ) : (
                                            <ButtonControl
                                                label="载入"
                                                variant="primary"
                                                size="sm"
                                                loading={isBusy}
                                                loadingText="载入中..."
                                                disabled={isBusy}
                                                className="da-lexicon-preset-load-btn"
                                                onClick={() => void state.loadPresetPack(pack)}
                                            />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardView>
        );
    };

    const renderCustomWordsSubPanel = (): VNode => {
        const allWords = state.customWords.value;
        const indexedWords = allWords.map((item, origIndex) => ({ item, origIndex }));
        const query = state.customSearchQuery.value.trim().toLowerCase();
        const filteredEntries = query
            ? indexedWords.filter(
                  ({ item }) =>
                      item.tag.toLowerCase().includes(query) ||
                      (item.cn || '').toLowerCase().includes(query)
              )
            : indexedWords;
        const visibleEntries = filteredEntries.slice(0, 120);
        const draft = state.insertedDraft.value;
        const isSearching = Boolean(query);

        // 渲染无任何多余按钮的纯单元格插入行
        const renderInsertedRow = () => {
            if (!draft) return null;
            return (
                <div
                    key="inserted-draft-row"
                    className="da-lexicon-grid-row da-lexicon-inserted-row"
                    data-row-index={draft.index}
                >
                    <input
                        type="text"
                        className="da-input da-lexicon-cell da-lexicon-cell-tag"
                        value={draft.tag}
                        placeholder="输入英文 Tag..."
                        autoFocus
                        onInput={(e) => {
                            if (state.insertedDraft.value) {
                                state.insertedDraft.value = {
                                    ...state.insertedDraft.value,
                                    tag: (e.currentTarget as HTMLInputElement).value,
                                };
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Tab' && !e.shiftKey) {
                                e.preventDefault();
                                focusCell('.da-lexicon-inserted-row', 'cn');
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                void state.commitInsertedDraftRow();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                state.dismissInsertedDraft();
                            }
                        }}
                        onBlur={() => scheduleDraftBlurCommit()}
                        onPaste={(e) => void handleCellPaste(e, draft.index)}
                    />
                    <input
                        type="text"
                        className="da-input da-lexicon-cell da-lexicon-cell-cn"
                        value={draft.cn}
                        placeholder="中文释义 (选填)..."
                        onInput={(e) => {
                            if (state.insertedDraft.value) {
                                state.insertedDraft.value = {
                                    ...state.insertedDraft.value,
                                    cn: (e.currentTarget as HTMLInputElement).value,
                                };
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                                e.preventDefault();
                                void state.commitInsertedDraftRow();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                state.dismissInsertedDraft();
                            }
                        }}
                        onBlur={() => scheduleDraftBlurCommit()}
                        onPaste={(e) => void handleCellPaste(e, draft.index)}
                    />
                    <span className="da-lexicon-row-placeholder-handle" />
                </div>
            );
        };

        return (
            <CardView
                className="da-card--padded"
                title={`自定义词库 (${allWords.length})`}
                subtitle="维护本地专用的生图 Tag 与中文释义，在提示词输入框中自动联想补全"
                actions={
                    <div className="da-extra-fields-toolbar">
                        <ButtonControl
                            label="+ 添加词条"
                            variant="primary"
                            size="sm"
                            className="da-lexicon-add-word-btn"
                            onClick={() => {
                                focusCell('.da-lexicon-tail-draft-row', 'tag');
                            }}
                        />
                        <ButtonControl
                            label={
                                state.showBatchBox.value
                                    ? '收起批量录入'
                                    : '批量录入 ▾'
                            }
                            variant="secondary"
                            size="sm"
                            className="da-lexicon-toggle-batch-btn"
                            onClick={() => {
                                state.showBatchBox.value = !state.showBatchBox.value;
                            }}
                        />
                        <ButtonControl
                            label="导出 JSON"
                            variant="secondary"
                            size="sm"
                            disabled={allWords.length === 0}
                            onClick={() => {
                                void state.handleExportCustomWords('json');
                            }}
                        />
                        <ButtonControl
                            label="导出 CSV"
                            variant="secondary"
                            size="sm"
                            disabled={allWords.length === 0}
                            onClick={() => {
                                void state.handleExportCustomWords('csv');
                            }}
                        />
                        {allWords.length > 0 && (
                            <ButtonControl
                                label="清空全部"
                                variant="danger"
                                size="sm"
                                className="da-lexicon-clear-custom-btn"
                                onClick={() => void state.clearCustomWords(allWords.length)}
                            />
                        )}
                    </div>
                }
            >
                {/* 1. 批量导入抽屉 */}
                {state.showBatchBox.value && (
                    <div className="da-lexicon-batch-box">
                        <textarea
                            className="da-textarea da-lexicon-batch-textarea"
                            rows={5}
                            value={state.batchPasteText.value}
                            placeholder={
                                '每行一条 (支持 tag,中文 或 - tag（中文）)，例如:\n- cowboy_shot（七分身/美式镜头）\nover_the_shoulder, 过肩视角\ndutch_angle'
                            }
                            onInput={(e) => {
                                state.batchPasteText.value = (
                                    e.currentTarget as HTMLTextAreaElement
                                ).value;
                            }}
                        />
                        <div className="da-extra-fields-toolbar">
                            <ButtonControl
                                label="确认批量解析并导入"
                                variant="primary"
                                size="sm"
                                className="da-lexicon-batch-import-btn"
                                onClick={() => {
                                    void state.runBatchImportCustomWords();
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* 2. 搜索过滤栏 */}
                {allWords.length > 0 && (
                    <div className="da-lexicon-filter-bar">
                        <input
                            type="text"
                            className="da-input da-lexicon-custom-search-input"
                            value={state.customSearchQuery.value}
                            placeholder="搜索自定义英文 Tag 或中文释义..."
                            onInput={(e) => {
                                state.customSearchQuery.value = (
                                    e.currentTarget as HTMLInputElement
                                ).value;
                            }}
                        />
                        {state.customSearchQuery.value && (
                            <button
                                type="button"
                                className="da-lexicon-search-clear-btn"
                                title="清除搜索"
                                onClick={() => {
                                    state.customSearchQuery.value = '';
                                }}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}

                {/* 3. 自定义词汇表格数据网格 */}
                <div className="da-lexicon-table-container">
                    <div className="da-lexicon-table-header">
                        <span className="da-lexicon-th-tag">英文 Tag</span>
                        <span className="da-lexicon-th-cn">中文释义 / 别名</span>
                        <span className="da-lexicon-th-action">操作</span>
                    </div>

                    <div className="da-lexicon-custom-list">
                        {allWords.length === 0 && !isSearching && (
                            <div className="da-lexicon-empty-state">
                                <div className="da-lexicon-empty-state__icon">
                                    <svg
                                        width="28"
                                        height="28"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.75"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                                        <line x1="7" y1="7" x2="7.01" y2="7" />
                                    </svg>
                                </div>
                                <div className="da-lexicon-empty-state__title">暂无自定义词条</div>
                                <div className="da-lexicon-empty-state__subtitle">
                                    可在下方直接输入 Tag 录入，或点击右上角「批量录入」导入已有词表
                                </div>
                            </div>
                        )}

                        {visibleEntries.map(({ item, origIndex }, idx) => (
                            <>
                                {draft && draft.index === origIndex && renderInsertedRow()}
                                <div
                                    key={item.id}
                                    className="da-lexicon-custom-row da-lexicon-grid-row"
                                    data-word-id={item.id}
                                    data-row-index={idx}
                                    onContextMenu={(e) =>
                                        handleRowContextMenu(e, item, origIndex)
                                    }
                                    onTouchStart={(e) =>
                                        handleRowTouchStart(e, item, origIndex)
                                    }
                                    onTouchMove={(e) => handleRowTouchMove(e)}
                                    onTouchEnd={() => handleRowTouchEnd()}
                                    onTouchCancel={() => handleRowTouchEnd()}
                                >
                                    <input
                                        type="text"
                                        className="da-input da-lexicon-cell da-lexicon-cell-tag"
                                        value={item.tag}
                                        placeholder="英文 Tag"
                                        onFocus={(e) => {
                                            state.cellBackupValue.value = (
                                                e.currentTarget as HTMLInputElement
                                            ).value;
                                        }}
                                        onBlur={(e) => {
                                            void state.handleExistingTagBlur(
                                                item,
                                                (e.currentTarget as HTMLInputElement)
                                                    .value
                                            );
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Tab' && !e.shiftKey) {
                                                e.preventDefault();
                                                focusCell(
                                                    `.da-lexicon-grid-row[data-row-index="${idx}"]`,
                                                    'cn'
                                                );
                                            } else if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (idx + 1 < visibleEntries.length) {
                                                    focusCell(
                                                        `.da-lexicon-grid-row[data-row-index="${idx + 1}"]`,
                                                        'tag'
                                                    );
                                                } else {
                                                    focusCell(
                                                        '.da-lexicon-tail-draft-row',
                                                        'tag'
                                                    );
                                                }
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).value = state.cellBackupValue.value;
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).blur();
                                            }
                                        }}
                                        onPaste={(e) => void handleCellPaste(e, origIndex)}
                                    />
                                    <input
                                        type="text"
                                        className="da-input da-lexicon-cell da-lexicon-cell-cn"
                                        value={item.cn || ''}
                                        placeholder="中文释义"
                                        onFocus={(e) => {
                                            state.cellBackupValue.value = (
                                                e.currentTarget as HTMLInputElement
                                            ).value;
                                        }}
                                        onBlur={(e) => {
                                            void state.handleExistingCnBlur(
                                                item,
                                                (e.currentTarget as HTMLInputElement)
                                                    .value
                                            );
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Tab' && !e.shiftKey) {
                                                e.preventDefault();
                                                if (idx + 1 < visibleEntries.length) {
                                                    focusCell(
                                                        `.da-lexicon-grid-row[data-row-index="${idx + 1}"]`,
                                                        'tag'
                                                    );
                                                } else {
                                                    focusCell(
                                                        '.da-lexicon-tail-draft-row',
                                                        'tag'
                                                    );
                                                }
                                            } else if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (idx + 1 < visibleEntries.length) {
                                                    focusCell(
                                                        `.da-lexicon-grid-row[data-row-index="${idx + 1}"]`,
                                                        'cn'
                                                    );
                                                } else {
                                                    focusCell(
                                                        '.da-lexicon-tail-draft-row',
                                                        'tag'
                                                    );
                                                }
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).value = state.cellBackupValue.value;
                                                (
                                                    e.currentTarget as HTMLInputElement
                                                ).blur();
                                            }
                                        }}
                                        onPaste={(e) => void handleCellPaste(e, origIndex)}
                                    />
                                    <div className="da-lexicon-row-actions">
                                        <button
                                            type="button"
                                            className="da-lexicon-row-del-btn"
                                            title="删除此词条"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void state.deleteCustomWord(
                                                    item.id,
                                                    `已删除词条: ${item.tag}`
                                                );
                                            }}
                                        >
                                            <svg
                                                width="13"
                                                height="13"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            className="da-lexicon-row-more-btn"
                                            title="更多操作 (复制 / 上下插入行)"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openContextMenu(
                                                    e.clientX,
                                                    e.clientY,
                                                    item,
                                                    origIndex,
                                                    e.currentTarget as HTMLElement
                                                );
                                            }}
                                        >
                                            ⋮
                                        </button>
                                    </div>
                                </div>
                            </>
                        ))}

                        {/* 在列表末尾处展开的插入行 */}
                        {draft &&
                            !visibleEntries.some((entry) => entry.origIndex === draft.index) &&
                            renderInsertedRow()}

                        {/* 搜索无匹配项提示 */}
                        {isSearching && visibleEntries.length === 0 && (
                            <div className="da-empty-hint">
                                未找到匹配的自定义词汇。
                            </div>
                        )}

                        {/* 4. 末端空白追加行 (Tail Blank Row) - 无独立提交按钮 */}
                        {!isSearching && (
                            <div
                                className="da-lexicon-custom-row da-lexicon-grid-row da-lexicon-tail-draft-row"
                                data-row-index={visibleEntries.length}
                            >
                                <input
                                    type="text"
                                    className="da-input da-lexicon-cell da-lexicon-cell-tag da-lexicon-tail-tag"
                                    value={state.tailDraft.value.tag}
                                    placeholder="+ 输入英文 Tag，Enter 保存"
                                    onInput={(e) => {
                                        state.tailDraft.value = {
                                            ...state.tailDraft.value,
                                            tag: (e.currentTarget as HTMLInputElement)
                                                .value,
                                        };
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Tab' && !e.shiftKey) {
                                            e.preventDefault();
                                            focusCell(
                                                '.da-lexicon-tail-draft-row',
                                                'cn'
                                            );
                                        } else if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void handleCommitTailDraftRow(true);
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            state.tailDraft.value = {
                                                ...state.tailDraft.value,
                                                tag: '',
                                            };
                                        }
                                    }}
                                    onBlur={() => {
                                        void handleCommitTailDraftRow(false);
                                    }}
                                    onPaste={(e) =>
                                        void handleCellPaste(
                                            e,
                                            allWords.length
                                        )
                                    }
                                />
                                <input
                                    type="text"
                                    className="da-input da-lexicon-cell da-lexicon-cell-cn da-lexicon-tail-cn"
                                    value={state.tailDraft.value.cn}
                                    placeholder="中文释义 (选填)"
                                    onInput={(e) => {
                                        state.tailDraft.value = {
                                            ...state.tailDraft.value,
                                            cn: (e.currentTarget as HTMLInputElement)
                                                .value,
                                        };
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === 'Enter' ||
                                            (e.key === 'Tab' && !e.shiftKey)
                                        ) {
                                            e.preventDefault();
                                            void handleCommitTailDraftRow(true);
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            state.tailDraft.value = {
                                                ...state.tailDraft.value,
                                                cn: '',
                                            };
                                        }
                                    }}
                                    onBlur={() => {
                                        void handleCommitTailDraftRow(false);
                                    }}
                                    onPaste={(e) =>
                                        void handleCellPaste(
                                            e,
                                            allWords.length
                                        )
                                    }
                                />
                                <span className="da-lexicon-row-placeholder-handle" />
                            </div>
                        )}
                    </div>
                </div>
            </CardView>
        );
    };

    const files = state.filesMeta.value;
    const enabledFilesCount = files.filter((f) => f.enabled).length;
    const enabledFileWordsCount = files
        .filter((f) => f.enabled)
        .reduce((sum, f) => sum + (f.entryCount || 0), 0);
    const customWordsCount = state.customWords.value.length;
    const currentSubTab = state.subTab.value;

    return (
        <div ref={containerRef} className="da-lexicon-view-container">
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.tsv,.txt,.json"
                className="da-hidden"
                onChange={(e) => {
                    const input = e.currentTarget as HTMLInputElement;
                    const fileList = Array.from(input.files || []);
                    input.value = '';
                    if (fileList.length > 0) {
                        void state.importFiles(fileList);
                    }
                }}
            />

            {/* 1. 子页分栏导航栏 */}
            <div className="da-subtab-nav-bar da-lexicon-subtab-bar">
                <SegmentedControlView
                    size="lg"
                    value={currentSubTab}
                    options={[
                        { label: `词汇文件 (${files.length})`, value: 'files' },
                        { label: `自定义词库 (${customWordsCount})`, value: 'custom' },
                    ]}
                    onChange={(val) => {
                        state.subTab.value = val as LexiconSubTab;
                    }}
                />
            </div>

            {/* 2. 顶部全景度量与索引就绪状态栏 */}
            <div className="da-lexicon-stat-banner">
                <div className="da-lexicon-stat-group">
                    <span className="da-lexicon-stat-pill">
                        <span className="da-lexicon-stat-label">词表文件:</span>
                        <strong className="da-lexicon-stat-val">
                            {enabledFilesCount} 启用 / 共 {files.length}
                        </strong>
                    </span>
                    <span className="da-lexicon-stat-pill">
                        <span className="da-lexicon-stat-label">外部词条:</span>
                        <strong className="da-lexicon-stat-val">
                            {enabledFileWordsCount.toLocaleString()}
                        </strong>
                    </span>
                    <span className="da-lexicon-stat-pill">
                        <span className="da-lexicon-stat-label">自定义词条:</span>
                        <strong className="da-lexicon-stat-val">
                            {customWordsCount.toLocaleString()}
                        </strong>
                    </span>
                    <span className="da-lexicon-stat-pill da-lexicon-stat-pill--ready">
                        <span className="da-lexicon-stat-dot" />
                        <span className="da-lexicon-stat-label">本地索引:</span>
                        <strong className="da-lexicon-stat-val">正常</strong>
                    </span>
                </div>
                <div className="da-lexicon-stat-actions">
                    <ButtonControl
                        label="重建索引"
                        variant="secondary"
                        size="sm"
                        className="da-lexicon-reindex-btn"
                        tooltip="从本地 IndexedDB 重新读取词库文件与自定义词条并重建检索索引；若标签联想未及时更新可点击刷新。"
                        onClick={() => void state.rebuildIndex()}
                    />
                </div>
            </div>

            {/* 3. 子页面卡片 */}
            {currentSubTab === 'files' && renderFilesSubPanel()}
            {currentSubTab === 'custom' && renderCustomWordsSubPanel()}
        </div>
    );
}

export function createLexiconTabView(
    storageInstance?: LocalLexiconStorage
): StatefulSettingsView<LexiconState> {
    const state = new LexiconState(storageInstance);
    const lifecycleBridge: LexiconLifecycleBridge = {};
    return createPreactSettingsView<LexiconState>({
        id: 'lexicon',
        title: '词库',
        className: 'da-tab-pane da-view-lexicon',
        state,
        render: () => <LexiconTab state={state} lifecycleBridge={lifecycleBridge} />,
        onActivate: () => {
            state.activate();
            lifecycleBridge.onActivate?.();
        },
        onDeactivate: () => {
            lifecycleBridge.onDeactivate?.();
        },
        onDispose: () => {
            lifecycleBridge.onDispose?.();
            state.dispose();
        },
    });
}
