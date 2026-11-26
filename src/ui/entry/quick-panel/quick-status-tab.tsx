/**
 * 悬浮球快捷面板 - 插件基础与显示设置页 (`general`)。
 */

import type { VNode } from 'preact';
import type {
    ImageDisplayMode,
    ImageStorageQuality,
    ProviderType,
    ThinkingDisplayMode,
    TransportMode,
} from '@types';
import { PROVIDER_SELECT_OPTIONS } from '../../../domain';
import { detectHostRuntime, TRANSPORT_MODE_OPTIONS } from '../../../util/http-client';
import { TauriRelayNotice } from '../../components';
import {
    SwitchControl,
    SelectControl,
    SegmentedControlView,
} from '../../framework';
import { QuickSection, QuickFormRow, type QuickPanelSubViewProps } from './quick-shared';

export function QuickGeneralTab(props: QuickPanelSubViewProps): VNode {
    const { state, settings: s } = props;
    const enabled = s.enabled !== false;
    const activeProvider = (s.activeProvider || 'comfyui') as ProviderType;
    const transport = (s.transport || 'direct') as TransportMode;
    const cancelOnChatChange = s.cancelOnChatChange ?? true;
    const cancelOnSwipe = s.cancelOnSwipe ?? true;
    const autoGenerate = Boolean(s.autoGenerate);
    const hideButtonOnDone = Boolean(s.ui?.floorButton?.hideOnDone);
    const imageActionPanelEnabled = s.ui?.imageActionPanel?.enabled ?? true;
    const lightboxEnabled = s.ui?.lightbox?.enabled ?? true;
    const cleanPrompt = s.cleanPrompt ?? true;
    const cleanPromptPunctuation = s.cleanPromptPunctuation ?? true;
    const normalizeChinesePunctuation = Boolean(s.normalizeChinesePunctuation);
    const thinkingMode: ThinkingDisplayMode = s.thinkingDisplayMode || 'show';
    const cleanHistoryThinking = Boolean(s.cleanHistoryThinking);
    const cleanHistoryMarkup = Boolean(s.cleanHistoryMarkup);

    const img = s.ui?.imageDisplay;
    const align = (img?.align || 'center') as 'center' | 'flex-start' | 'flex-end';
    const objectFit = (img?.objectFit || 'contain') as 'contain' | 'cover' | 'none';
    const rounded = img?.rounded ?? true;
    const displayMode: ImageDisplayMode = img?.displayMode || 'normal';
    const hostRuntime = detectHostRuntime();
    const showTauriRelayNotice = transport === 'relay' && !hostRuntime.supportsRelayProxy;

    const imageQuality = (s.imageQuality || 'original') as ImageStorageQuality;
    const saveToServer = Boolean(s.saveToServer);

    return (
        <div className="da-fqp-tab-content" data-tab="general">
            <QuickSection title="基础配置">
                <QuickFormRow label="启用插件">
                    <SwitchControl
                        value={enabled}
                        onChange={(val) => state.setEnabled(val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="生图服务" disabled={!enabled}>
                    <SelectControl
                        value={activeProvider}
                        disabled={!enabled}
                        options={[...PROVIDER_SELECT_OPTIONS]}
                        onChange={(val) => state.setSetting('activeProvider', val as ProviderType)}
                    />
                </QuickFormRow>
                <QuickFormRow label="连接方式" disabled={!enabled}>
                    <SegmentedControlView
                        value={transport}
                        disabled={!enabled}
                        options={[...TRANSPORT_MODE_OPTIONS]}
                        onChange={(val) => state.setSetting('transport', val as TransportMode)}
                    />
                </QuickFormRow>
                {showTauriRelayNotice && (
                    <TauriRelayNotice
                        compact
                        disabled={!enabled}
                        onSwitchToDirect={() => state.setSetting('transport', 'direct')}
                    />
                )}
                <QuickFormRow label="切换聊天时取消任务" disabled={!enabled}>
                    <SwitchControl
                        value={cancelOnChatChange}
                        disabled={!enabled}
                        onChange={(val) => state.setSetting('cancelOnChatChange', val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="重 roll 时取消旧分支任务" disabled={!enabled}>
                    <SwitchControl
                        value={cancelOnSwipe}
                        disabled={!enabled}
                        onChange={(val) => state.setSetting('cancelOnSwipe', val)}
                    />
                </QuickFormRow>
            </QuickSection>

            <QuickSection title="交互与触发">
                <QuickFormRow label="AI 回复后自动出图" disabled={!enabled}>
                    <SwitchControl
                        value={autoGenerate}
                        disabled={!enabled}
                        onChange={(val) => state.setSetting('autoGenerate', val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="出图后隐藏按钮" disabled={!enabled}>
                    <SwitchControl
                        value={hideButtonOnDone}
                        disabled={!enabled}
                        onChange={(val) => state.updateUiFloorHideOnDone(val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="图片编辑面板" disabled={!enabled}>
                    <SwitchControl
                        value={imageActionPanelEnabled}
                        disabled={!enabled}
                        onChange={(val) => state.updateUiImageActionPanelEnabled(val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="点击查看大图" disabled={!enabled}>
                    <SwitchControl
                        value={lightboxEnabled}
                        disabled={!enabled}
                        onChange={(val) => state.updateUiLightboxEnabled(val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="提示词 Tags 自动去重" disabled={!enabled}>
                    <SwitchControl
                        value={cleanPrompt}
                        disabled={!enabled}
                        onChange={(val) => state.setSetting('cleanPrompt', val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="标点与空行自动整理" disabled={!enabled}>
                    <SwitchControl
                        value={cleanPromptPunctuation}
                        disabled={!enabled}
                        onChange={(val) => state.setSetting('cleanPromptPunctuation', val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="中文标点转英文逗号" disabled={!enabled}>
                    <SwitchControl
                        value={normalizeChinesePunctuation}
                        disabled={!enabled}
                        onChange={(val) => state.setSetting('normalizeChinesePunctuation', val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="绘图与设计思考">
                    <SegmentedControlView
                        value={thinkingMode}
                        options={[
                            { label: '显示', value: 'show' },
                            { label: '折叠', value: 'collapse' },
                            { label: '隐藏', value: 'hide' },
                        ]}
                        onChange={(val) =>
                            state.setThinkingDisplayMode(val as ThinkingDisplayMode)
                        }
                    />
                </QuickFormRow>
                <QuickFormRow label="清理历史绘图与设计思考">
                    <SwitchControl
                        value={cleanHistoryThinking}
                        onChange={(val) => state.setCleanHistoryThinking(val)}
                    />
                </QuickFormRow>
                <QuickFormRow label="清理历史生图与档案标记">
                    <SwitchControl
                        value={cleanHistoryMarkup}
                        onChange={(val) => state.setCleanHistoryMarkup(val)}
                    />
                </QuickFormRow>
            </QuickSection>

            <QuickSection title="图片显示">
                <QuickFormRow label="对齐方式" disabled={!enabled}>
                    <SegmentedControlView
                        value={align}
                        disabled={!enabled}
                        options={[
                            { label: '靠左', value: 'flex-start' },
                            { label: '居中', value: 'center' },
                            { label: '靠右', value: 'flex-end' },
                        ]}
                        onChange={(val) =>
                            state.updateUiImageDisplay({
                                align: val as 'center' | 'flex-start' | 'flex-end',
                            })
                        }
                    />
                </QuickFormRow>
                <QuickFormRow label="缩放模式" disabled={!enabled}>
                    <SegmentedControlView
                        value={objectFit}
                        disabled={!enabled}
                        options={[
                            { label: '完整', value: 'contain' },
                            { label: '裁剪', value: 'cover' },
                            { label: '原始', value: 'none' },
                        ]}
                        onChange={(val) =>
                            state.updateUiImageDisplay({
                                objectFit: val as 'contain' | 'cover' | 'none',
                            })
                        }
                    />
                </QuickFormRow>
                <QuickFormRow label="圆角显示" disabled={!enabled}>
                    <SwitchControl
                        value={rounded}
                        disabled={!enabled}
                        onChange={(val) => state.updateUiImageDisplay({ rounded: val })}
                    />
                </QuickFormRow>
                <QuickFormRow label="显示模式" disabled={!enabled}>
                    <SegmentedControlView
                        value={displayMode}
                        disabled={!enabled}
                        options={[
                            { label: '正常', value: 'normal' },
                            { label: '模糊', value: 'blur' },
                            { label: '折叠', value: 'collapse' },
                        ]}
                        onChange={(val) =>
                            state.updateUiImageDisplay({ displayMode: val as ImageDisplayMode })
                        }
                    />
                </QuickFormRow>
            </QuickSection>

            <QuickSection title="存储设置">
                <QuickFormRow label="图片存储格式" disabled={!enabled}>
                    <SelectControl
                        value={imageQuality}
                        disabled={!enabled}
                        options={[
                            { label: '原始格式 (无损)', value: 'original' },
                            { label: 'WebP 高质量 (90%)', value: 'webp-high' },
                            { label: 'WebP 均衡压缩 (80%)', value: 'webp-medium' },
                        ]}
                        onChange={(val) =>
                            state.setSetting('imageQuality', val as ImageStorageQuality)
                        }
                    />
                </QuickFormRow>
                <QuickFormRow label="同步转存至酒馆" disabled={!enabled}>
                    <SwitchControl
                        value={saveToServer}
                        disabled={!enabled}
                        onChange={(val) => state.setSetting('saveToServer', val)}
                    />
                </QuickFormRow>
            </QuickSection>
        </div>
    );
}
