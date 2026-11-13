/**
 * 局部/全量恢复出厂设置独立模态弹窗 (ResetFactoryModal)。
 *
 * @remarks
 * 负责细粒度勾选并恢复出厂初始设置：
 * 1. 双层分类架构：划分为「核心配置与预设（12项）」与「本地数据与缓存（2项高危）」两大卡片；
 * 2. 复合选项映射：将四大提示词通道整合为复合项、提取与格式规则整合为复合项，并在执行时完整展开；
 * 3. 预设快捷操作：提供「全选 (不含本地数据)」、「仅预设配置」、「仅基础设置」、「清空选择」快捷动作；
 * 4. 键盘与栈管理：接入 OverlayStack 栈式管理，支持 Esc 键快捷取消与遮罩点击关闭。
 */

import type { Disposable } from '../types';
import { settingsStore, type ResetPartialOptions } from '../../store/settings-store';
import { renderIcon } from '../components/icons';
import { overlayStack } from '../framework/overlay-stack';
import { Toast } from '../feedback/toast';
import { logger } from '../../util/logger';

export interface ResetFactoryModalOptions {
    /** 恢复完成后的回调 */
    readonly onResetSuccess?: () => void;
    /** 弹窗关闭回调 */
    readonly onClose?: () => void;
}

/** 恢复出厂设置前端勾选键值（包含 12 项核心配置/预设与 2 项高危本地数据） */
export type ResetOptionKey =
    // 基础与界面设置
    | 'general'
    | 'providers'
    | 'ui'
    | 'themePresets'
    // 生图核心预设
    | 'drawingPresets'
    | 'promptPresets'
    | 'workflowPresets'
    | 'promptChannels'
    // 素材库档案与规则
    | 'characterPresets'
    | 'outfitPresets'
    | 'materialActivationPresets'
    | 'materialExtractionAndFormat'
    // 本地持久化数据与缓存 (谨慎操作)
    | 'resetLocalLexicon'
    | 'resetLocalGallery';

interface ResetOptionDef {
    readonly key: ResetOptionKey;
    readonly label: string;
    readonly desc: string;
    readonly defaultChecked: boolean;
    readonly isDanger?: boolean;
}

interface ResetGroupDef {
    readonly title: string;
    readonly subtitle: string;
    readonly options: ResetOptionDef[];
}

const RESET_GROUPS: ResetGroupDef[] = [
    {
        title: '核心配置与预设',
        subtitle: '共 12 项设置与预设，选定项目将恢复为出厂默认值并重载官方推荐预设',
        options: [
            {
                key: 'general',
                label: '全局基础设置',
                desc: '生图总开关、通信传输模式、任务超时、生图标记与卡片联动规则',
                defaultChecked: true,
            },
            {
                key: 'providers',
                label: '生图后端服务配置',
                desc: 'SD-WebUI / ComfyUI / NovelAI / OpenAI 服务的连接地址与参数',
                defaultChecked: true,
            },
            {
                key: 'ui',
                label: '界面交互与排版设置',
                desc: '悬浮球外观、大图预览、楼层动作栏、图片动作面板与展示排版',
                defaultChecked: true,
            },
            {
                key: 'themePresets',
                label: '界面主题预设',
                desc: '官方内置色彩、毛玻璃背景与对比度主题预设',
                defaultChecked: true,
            },
            {
                key: 'drawingPresets',
                label: '生图参数预设',
                desc: '内置初始采样器、CFG、步数、分辨率等参考生图参数预设',
                defaultChecked: true,
            },
            {
                key: 'promptPresets',
                label: '提示词模板预设',
                desc: '正向/负向提示词参考模板与默认 LoRA 挂载规则',
                defaultChecked: true,
            },
            {
                key: 'workflowPresets',
                label: 'ComfyUI 工作流预设',
                desc: '内置参考 ComfyUI 工作流 API 图结构与节点映射',
                defaultChecked: true,
            },
            {
                key: 'promptChannels',
                label: '提示词四大通道预设',
                desc: '包含故事插画、词汇指导、素材创作与素材注入四大通道参考模板与启用状态',
                defaultChecked: true,
            },
            {
                key: 'characterPresets',
                label: '角色档案库',
                desc: '内置示例角色档案、基础特征与各部位标签模板',
                defaultChecked: true,
            },
            {
                key: 'outfitPresets',
                label: '服装档案库',
                desc: '内置示例服装档案、基础特征与各部位标签模板',
                defaultChecked: true,
            },
            {
                key: 'materialActivationPresets',
                label: '素材启用预设',
                desc: '素材激活预设、触发模式及判定规则',
                defaultChecked: true,
            },
            {
                key: 'materialExtractionAndFormat',
                label: '楼层提取与格式预设',
                desc: '楼层素材提取规则、起止标记、宏映射规则与部位宏定义',
                defaultChecked: true,
            },
        ],
    },
    {
        title: '本地持久化数据与缓存 (谨慎操作)',
        subtitle: '包含本地已持久化的词库与图库数据，清空后无法撤销，请谨慎操作',
        options: [
            {
                key: 'resetLocalLexicon',
                label: '清空本地 IndexedDB 联想词库',
                desc: '清空所有已导入的词库文件与自定义词汇表（默认不勾选）',
                defaultChecked: false,
                isDanger: true,
            },
            {
                key: 'resetLocalGallery',
                label: '清空本地 IndexedDB 生成图库与图片缓存',
                desc: '清空本地已生成的历史图像记录、元数据与 Blob 缓存（默认不勾选）',
                defaultChecked: false,
                isDanger: true,
            },
        ],
    },
];

let activeModalInstance: Disposable | null = null;

/**
 * 唤出局部/全量恢复出厂设置细分模态弹窗。
 *
 * @param options 配置参数
 * @returns 销毁句柄
 */
export function openResetFactoryModal(options: ResetFactoryModalOptions = {}): Disposable {
    if (typeof document === 'undefined') {
        return { dispose: () => {} };
    }

    if (activeModalInstance) {
        activeModalInstance.dispose();
        activeModalInstance = null;
    }

    let isDisposed = false;

    // 状态管理：各选项勾选状态映射表
    const stateMap = new Map<ResetOptionKey, boolean>();
    for (const group of RESET_GROUPS) {
        for (const opt of group.options) {
            stateMap.set(opt.key, opt.defaultChecked);
        }
    }

    // 1. 全屏遮罩外壳
    const backdrop = document.createElement('div');
    backdrop.className = 'da-modal-backdrop st-da-root da-reset-factory-backdrop';

    // 2. 居中模态面板
    const panel = document.createElement('div');
    panel.className = 'da-reset-factory-panel';

    // 3. 头部顶栏
    const header = document.createElement('div');
    header.className = 'da-reset-factory-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'da-reset-factory-title-group';

    const titleEl = document.createElement('h2');
    titleEl.className = 'da-reset-factory-title';
    titleEl.textContent = '恢复出厂设置';
    titleGroup.appendChild(titleEl);

    const subtitleEl = document.createElement('span');
    subtitleEl.className = 'da-reset-factory-subtitle';
    subtitleEl.textContent =
        '勾选需要重置的项目。选定分类将清空自建项并重新载入官方推荐静态文件，未勾选项完整保留。';
    titleGroup.appendChild(subtitleEl);

    header.appendChild(titleGroup);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'da-reset-factory-close';
    closeBtn.innerHTML = renderIcon('close', 16);
    closeBtn.setAttribute('aria-label', '关闭弹窗');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 4. 内容主体区域
    const body = document.createElement('div');
    body.className = 'da-reset-factory-body';

    // 快捷操作工具条
    const toolbar = document.createElement('div');
    toolbar.style.display = 'flex';
    toolbar.style.alignItems = 'center';
    toolbar.style.gap = '8px';
    toolbar.style.flexWrap = 'wrap';
    toolbar.style.paddingBottom = '10px';
    toolbar.style.borderBottom = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.08))';

    const toolbarLabel = document.createElement('span');
    toolbarLabel.style.fontSize = 'var(--da-font-size-xs, 0.78rem)';
    toolbarLabel.style.color = 'var(--da-text-secondary, rgba(255, 255, 255, 0.5))';
    toolbarLabel.textContent = '快捷勾选:';
    toolbar.appendChild(toolbarLabel);

    const createQuickBtn = (label: string, onClick: () => void) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'da-btn da-btn--secondary da-btn--sm';
        btn.style.padding = '2px 8px';
        btn.style.fontSize = 'var(--da-font-size-xs, 0.78rem)';
        btn.textContent = label;
        btn.onclick = onClick;
        return btn;
    };

    const checkboxRefs = new Map<ResetOptionKey, HTMLInputElement>();

    const updateCheckboxesUI = () => {
        for (const [key, cb] of checkboxRefs.entries()) {
            cb.checked = stateMap.get(key) ?? false;
        }
        updateFooterState();
    };

    toolbar.appendChild(
        createQuickBtn('全选 (不含本地数据)', () => {
            for (const key of stateMap.keys()) {
                stateMap.set(key, key !== 'resetLocalLexicon' && key !== 'resetLocalGallery');
            }
            updateCheckboxesUI();
        })
    );

    toolbar.appendChild(
        createQuickBtn('仅预设配置', () => {
            const presetKeys: ResetOptionKey[] = [
                'themePresets',
                'drawingPresets',
                'promptPresets',
                'workflowPresets',
                'promptChannels',
                'characterPresets',
                'outfitPresets',
                'materialActivationPresets',
                'materialExtractionAndFormat',
            ];
            for (const key of stateMap.keys()) {
                stateMap.set(key, presetKeys.includes(key));
            }
            updateCheckboxesUI();
        })
    );

    toolbar.appendChild(
        createQuickBtn('仅基础设置', () => {
            for (const key of stateMap.keys()) {
                stateMap.set(key, key === 'general' || key === 'providers' || key === 'ui');
            }
            updateCheckboxesUI();
        })
    );

    toolbar.appendChild(
        createQuickBtn('清空选择', () => {
            for (const key of stateMap.keys()) {
                stateMap.set(key, false);
            }
            updateCheckboxesUI();
        })
    );

    body.appendChild(toolbar);

    // 分组渲染复选项目
    for (const group of RESET_GROUPS) {
        const groupCard = document.createElement('div');
        groupCard.className = 'da-card';
        groupCard.style.padding = '14px 16px';
        groupCard.style.display = 'flex';
        groupCard.style.flexDirection = 'column';
        groupCard.style.gap = '10px';
        groupCard.style.background = 'var(--da-bg-card, rgba(255, 255, 255, 0.03))';
        groupCard.style.border = '1px solid var(--da-border-color, rgba(255, 255, 255, 0.07))';
        groupCard.style.borderRadius = 'var(--da-radius-medium, 10px)';

        const headerDiv = document.createElement('div');
        headerDiv.style.display = 'flex';
        headerDiv.style.flexDirection = 'column';
        headerDiv.style.gap = '2px';

        const groupTitle = document.createElement('div');
        groupTitle.style.fontSize = 'var(--da-font-size-sm, 0.86rem)';
        groupTitle.style.fontWeight = '600';
        groupTitle.style.color = 'var(--da-text-primary, #ffffff)';
        groupTitle.textContent = group.title;
        headerDiv.appendChild(groupTitle);

        const groupSubtitle = document.createElement('div');
        groupSubtitle.style.fontSize = 'var(--da-font-size-xs, 0.74rem)';
        groupSubtitle.style.color = 'var(--da-text-secondary, rgba(255, 255, 255, 0.5))';
        groupSubtitle.textContent = group.subtitle;
        headerDiv.appendChild(groupSubtitle);

        groupCard.appendChild(headerDiv);

        const optionsGrid = document.createElement('div');
        optionsGrid.style.display = 'grid';
        optionsGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        optionsGrid.style.gap = '8px';

        for (const opt of group.options) {
            const rowLabel = document.createElement('label');
            rowLabel.style.display = 'flex';
            rowLabel.style.alignItems = 'flex-start';
            rowLabel.style.gap = '8px';
            rowLabel.style.padding = '6px 8px';
            rowLabel.style.borderRadius = 'var(--da-radius-sm, 6px)';
            rowLabel.style.cursor = 'pointer';
            rowLabel.style.userSelect = 'none';
            rowLabel.style.transition = 'background-color 0.15s ease';

            rowLabel.onmouseenter = () => {
                rowLabel.style.backgroundColor = 'var(--da-bg-hover, rgba(255, 255, 255, 0.05))';
            };
            rowLabel.onmouseleave = () => {
                rowLabel.style.backgroundColor = 'transparent';
            };

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = stateMap.get(opt.key) ?? false;
            cb.style.marginTop = '3px';
            cb.style.cursor = 'pointer';
            cb.onchange = () => {
                stateMap.set(opt.key, cb.checked);
                updateFooterState();
            };
            checkboxRefs.set(opt.key, cb);
            rowLabel.appendChild(cb);

            const textContainer = document.createElement('div');
            textContainer.style.display = 'flex';
            textContainer.style.flexDirection = 'column';
            textContainer.style.gap = '2px';

            const optTitle = document.createElement('span');
            optTitle.style.fontSize = 'var(--da-font-size-sm, 0.84rem)';
            optTitle.style.fontWeight = '500';
            optTitle.style.color = opt.isDanger
                ? 'var(--da-text-danger, #f87171)'
                : 'var(--da-text-primary, #ffffff)';
            optTitle.textContent = opt.label;
            textContainer.appendChild(optTitle);

            const optDesc = document.createElement('span');
            optDesc.style.fontSize = 'var(--da-font-size-xs, 0.74rem)';
            optDesc.style.color = 'var(--da-text-secondary, rgba(255, 255, 255, 0.5))';
            optDesc.style.lineHeight = '1.35';
            optDesc.textContent = opt.desc;
            textContainer.appendChild(optDesc);

            rowLabel.appendChild(textContainer);
            optionsGrid.appendChild(rowLabel);
        }

        groupCard.appendChild(optionsGrid);
        body.appendChild(groupCard);
    }

    panel.appendChild(body);

    // 5. 底部操作栏
    const footer = document.createElement('div');
    footer.className = 'da-reset-factory-footer';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'da-reset-factory-footer__left';

    const countSpan = document.createElement('span');
    footerLeft.appendChild(countSpan);
    footer.appendChild(footerLeft);

    const footerRight = document.createElement('div');
    footerRight.className = 'da-reset-factory-footer__right';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'da-btn da-btn--secondary da-btn--sm';
    cancelBtn.textContent = '取消';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'da-btn da-btn--danger da-btn--sm';
    confirmBtn.textContent = '执行恢复';

    footerRight.appendChild(cancelBtn);
    footerRight.appendChild(confirmBtn);
    footer.appendChild(footerRight);
    panel.appendChild(footer);

    function updateFooterState(): void {
        let selectedCount = 0;
        let hasDanger = false;
        for (const [key, checked] of stateMap.entries()) {
            if (checked) {
                selectedCount++;
                if (key === 'resetLocalLexicon' || key === 'resetLocalGallery') {
                    hasDanger = true;
                }
            }
        }
        countSpan.textContent = `已勾选 ${selectedCount} 项${hasDanger ? ' (含高危本地数据)' : ''}`;
        confirmBtn.disabled = selectedCount === 0;
        confirmBtn.textContent = selectedCount === 0 ? '请勾选项目' : `恢复所选 (${selectedCount})`;
    }

    updateFooterState();
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // 6. 事件绑定与销毁
    const dispose = () => {
        if (isDisposed) return;
        isDisposed = true;
        overlayStack.remove('reset-factory-modal');
        backdrop.remove();
        if (activeModalInstance?.dispose === dispose) {
            activeModalInstance = null;
        }
        options.onClose?.();
    };

    activeModalInstance = { dispose };
    overlayStack.push('reset-factory-modal', () => dispose());

    closeBtn.onclick = () => dispose();
    cancelBtn.onclick = () => dispose();
    backdrop.onclick = (e) => {
        if (e.target === backdrop) {
            dispose();
        }
    };

    confirmBtn.onclick = async () => {
        const isPromptChannels = stateMap.get('promptChannels') ?? false;
        const isExtractionAndFormat = stateMap.get('materialExtractionAndFormat') ?? false;

        const selectedOptions: ResetPartialOptions = {
            general: stateMap.get('general') ?? false,
            providers: stateMap.get('providers') ?? false,
            ui: stateMap.get('ui') ?? false,
            themePresets: stateMap.get('themePresets') ?? false,
            drawingPresets: stateMap.get('drawingPresets') ?? false,
            promptPresets: stateMap.get('promptPresets') ?? false,
            workflowPresets: stateMap.get('workflowPresets') ?? false,
            promptStoryPresets: isPromptChannels,
            promptCharacterPresets: isPromptChannels,
            promptVocabPresets: isPromptChannels,
            promptMaterialPresets: isPromptChannels,
            characterPresets: stateMap.get('characterPresets') ?? false,
            outfitPresets: stateMap.get('outfitPresets') ?? false,
            materialActivationPresets: stateMap.get('materialActivationPresets') ?? false,
            materialExtractionPresets: isExtractionAndFormat,
            materialFormatPresets: isExtractionAndFormat,
            resetLocalLexicon: stateMap.get('resetLocalLexicon') ?? false,
            resetLocalGallery: stateMap.get('resetLocalGallery') ?? false,
        };

        const activeCount = Object.values(selectedOptions).filter(Boolean).length;
        if (activeCount === 0) {
            Toast.warning('请至少勾选一个需要恢复的项目');
            return;
        }

        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        confirmBtn.textContent = '正在恢复...';

        try {
            await settingsStore.resetPartialToDefaults(selectedOptions);
            Toast.success('已成功恢复选定的配置与预设！');
            options.onResetSuccess?.();
            dispose();
        } catch (err) {
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            updateFooterState();
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('[ResetFactoryModal] 恢复出厂设置异常:', err);
            Toast.error(`恢复出厂设置失败: ${msg}`);
        }
    };

    return { dispose };
}
