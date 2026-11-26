/**
 * 素材管理选项卡视图 (MaterialsTab)。
 *
 * @remarks
 * 纯声明式 Preact JSX 视图骨架，完整业务逻辑与信号状态托管于 `MaterialsState` (`src/ui/state/materials-state.ts`)：
 * 1. 角色管理 / 服装管理 / 启用设置 / 解析设置 / 变量与宏管理 五子页签；
 * 2. 通过 `useEffect` 为本地标签编辑框绑定/释放委托式自动联想浮层。
 */

import type { VNode } from 'preact';
import { useRef, useLayoutEffect } from 'preact/hooks';
import {
    createPreactSettingsView,
    SegmentedControlView,
    type StatefulSettingsView,
} from '../framework';
import { bindDelegatedTagAutocomplete } from '../composite/tag-autocomplete';
import {
    MaterialsState,
    type MaterialsSubTab,
    DEFAULT_SANDBOX_SAMPLE,
    createEmptyActivationTemplate,
} from '../state/materials-state';
import { evaluatePresetDataDirty } from '../state/preset-controller';
import {
    CHAR_PART_GROUPS,
    OUTFIT_PART_GROUPS,
} from './materials/material-types';
import { promptInjector } from '../../pipeline/prompt-injector';
import { CharacterPanel } from './materials/character-panel';
import { OutfitPanel } from './materials/outfit-panel';
import { ActivationPanel } from './materials/activation-panel';
import { ExtractionPanel } from './materials/extraction-panel';
import { FormatPanel } from './materials/format-panel';

export {
    type MaterialsSubTab,
    CHAR_PART_GROUPS,
    OUTFIT_PART_GROUPS,
    DEFAULT_SANDBOX_SAMPLE,
    createEmptyActivationTemplate,
    evaluatePresetDataDirty,
};

export function MaterialsTab(props: { state: MaterialsState }): VNode {
    const { state } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const currentTab = state.subTab.value;

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const delegation = bindDelegatedTagAutocomplete(
            el,
            '.da-material-tag-textarea, .da-material-tag-input',
            { mode: 'lexicon-only' }
        );
        return () => {
            delegation.dispose();
        };
    }, []);

    return (
        <div ref={containerRef} className="da-materials-view-container">
            <div className="da-subtab-nav-bar">
                <SegmentedControlView
                    size="lg"
                    value={currentTab}
                    options={[
                        { label: '角色管理', value: 'characters' },
                        { label: '服装管理', value: 'outfits' },
                        { label: '启用设置', value: 'activation' },
                        { label: '解析设置', value: 'extraction' },
                        { label: '变量与宏管理', value: 'format' },
                    ]}
                    onChange={(val) => {
                        state.subTab.value = val as MaterialsSubTab;
                    }}
                />
            </div>

            {currentTab === 'characters' && (
                <CharacterPanel
                    charController={state.charController}
                    outfitController={state.outfitController}
                    avatarUrlsSignal={state.avatarUrlsSignal}
                    charGroupExpanded={state.charGroupExpanded}
                    selectedOutfitToBind={state.selectedOutfitToBind}
                    onAction={(action, id) =>
                        state.handleMaterialToolbarAction('character', action, id)
                    }
                    onImportFiles={(files) =>
                        void state.handleMaterialImportFiles('character', files)
                    }
                    onUploadAvatar={(file) => state.uploadAvatar('character', file)}
                    onRemoveAvatar={() => state.removeDraftAvatar('character')}
                    onEnsureAvatarLoaded={(avatarId) => state.ensureAvatarLoaded(avatarId)}
                />
            )}
            {currentTab === 'outfits' && (
                <OutfitPanel
                    outfitController={state.outfitController}
                    avatarUrlsSignal={state.avatarUrlsSignal}
                    outfitGroupExpanded={state.outfitGroupExpanded}
                    onAction={(action, id) =>
                        state.handleMaterialToolbarAction('outfit', action, id)
                    }
                    onImportFiles={(files) =>
                        void state.handleMaterialImportFiles('outfit', files)
                    }
                    onUploadAvatar={(file) => state.uploadAvatar('outfit', file)}
                    onRemoveAvatar={() => state.removeDraftAvatar('outfit')}
                    onEnsureAvatarLoaded={(avatarId) => state.ensureAvatarLoaded(avatarId)}
                />
            )}
            {currentTab === 'activation' && (
                <ActivationPanel
                    charController={state.charController}
                    outfitController={state.outfitController}
                    activationController={state.activationController}
                    materialConfigSignal={state.materialConfigSignal}
                    onAction={(action, id) =>
                        state.handleMaterialToolbarAction('activation', action, id)
                    }
                    onImportFiles={(files) =>
                        void state.handleMaterialImportFiles('activation', files)
                    }
                />
            )}
            {currentTab === 'extraction' && (
                <ExtractionPanel
                    extractionController={state.extractionController}
                    charController={state.charController}
                    outfitController={state.outfitController}
                    sandboxText={state.sandboxText}
                    onArchivesApplied={() => {
                        if (!state.activationController.isDirty.value) {
                            state.activationController.reloadFromStore();
                        }
                        state.syncVisibleAvatars();
                        void promptInjector.scheduleSyncToHost();
                    }}
                />
            )}
            {currentTab === 'format' && (
                <FormatPanel
                    formatController={state.formatController}
                    activeMacroRuleKind={state.activeMacroRuleKind}
                    activeTemplateKind={state.activeTemplateKind}
                    isVariablesDrawerOpen={state.isVariablesDrawerOpen}
                    expandedMacroRuleIds={state.expandedMacroRuleIds}
                />
            )}
        </div>
    );
}

export function createMaterialsTabView(): StatefulSettingsView<MaterialsState> {
    const state = new MaterialsState();
    return createPreactSettingsView<MaterialsState>({
        id: 'materials',
        title: '素材管理',
        className: 'da-tab-pane da-view-materials',
        state,
        render: () => <MaterialsTab state={state} />,
        onActivate: () => state.activate(),
        onDispose: () => state.dispose(),
        hasUnsavedChanges: () => state.hasUnsavedChanges(),
        saveUnsavedChanges: () => state.saveUnsavedChanges(),
        discardUnsavedChanges: () => state.discardUnsavedChanges(),
    });
}
