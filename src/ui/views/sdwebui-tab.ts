/**
 * @module ui/views/sdwebui-tab
 * @description Stable Diffusion WebUI (AUTOMATIC1111) 生图后端配置面板视图 (SD-WebUI Tab) - 声明式 Schema 架构重构版
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import {
    FormRenderer,
    SectionCardSchema,
    createCollapsibleSection,
    createConnectionCard,
    createLoraManagerControl,
    SelectOptionItem
} from '../controls';
import { bindPresetToolbar } from '../presets';
import { FeedbackService } from '../feedback/feedback';
import type { IDriverRegistry } from '../../core/registry/driver-registry';
import { IDisposable } from '../../core/foundation/disposable';
import { DEFAULT_SDWEBUI_URL, SDWEBUI_SIZE_PRESETS } from '../../core/constants';
import { fetchSDWebUIModels } from '../../core/config/config-loader';

/**
 * 构建并渲染 SD-WebUI 后端引擎配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @param drivers 生图驱动注册中心抽象
 * @returns 包含生命周期清理能力的 SD-WebUI 配置面板 DOM 根节点
 */
export function createSDWebUITabView(
    store: ObservableStore<DrawAssistantSettings>,
    drivers?: IDriverRegistry
): HTMLElement & IDisposable {
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-sdwebui-tab';

    /**
     * 界面状态分层设计：
     * 1. draftStore (内存草稿)：用于承载下方 C3/C4/C5 参数输入框与滑块。
     *    用户在界面微调宽高、步数、CFG、Hires.fix 或切换方案时，仅在内存中更新草稿，绝不触发写盘；
     * 2. store (持久化中心)：用于记录当前选中的方案 ID 与已保存的方案列表。
     *    只有当用户明确点击工具栏的「保存方案」时，才将草稿数据存入方案列表并持久化落盘；
     * 3. 双渲染器：rendererDraft 绑定草稿，rendererMain 绑定持久化配置。
     */
    const draftStore = new ObservableStore<DrawAssistantSettings>({ ...store.getState() });
    const rendererDraft = new FormRenderer<DrawAssistantSettings>(draftStore);
    const rendererMain = new FormRenderer<DrawAssistantSettings>(store);

    /**
     * 将 SD 生图参数方案数据批量应用到草稿 Store（单次 update 避免多次 listener 触发）
     */
    const applySDProfileData = (d: any): void => {
        const patch: Partial<DrawAssistantSettings> = {};
        if (d.sdModelCheckpoint) patch.sdModelCheckpoint = d.sdModelCheckpoint;
        if (d.sdSamplerName) patch.sdSamplerName = d.sdSamplerName;
        if (d.sdSteps) patch.sdSteps = d.sdSteps;
        if (d.sdCfgScale) patch.sdCfgScale = d.sdCfgScale;
        if (d.sdWidth) patch.sdWidth = d.sdWidth;
        if (d.sdHeight) patch.sdHeight = d.sdHeight;
        if (d.sdClipSkip !== undefined) patch.sdClipSkip = d.sdClipSkip;
        if (d.sdDenoisingStrength !== undefined) patch.sdDenoisingStrength = d.sdDenoisingStrength;
        if (d.sdEnableHires !== undefined) patch.sdEnableHires = d.sdEnableHires;
        if (d.sdHiresUpscaler) patch.sdHiresUpscaler = d.sdHiresUpscaler;
        if (d.sdHiresUpscaleBy !== undefined) patch.sdHiresUpscaleBy = d.sdHiresUpscaleBy;
        if (d.sdHiresSteps !== undefined) patch.sdHiresSteps = d.sdHiresSteps;
        if (d.sdHiresDenoise !== undefined) patch.sdHiresDenoise = d.sdHiresDenoise;
        draftStore.update(patch);
    };

    // ── C1: API 服务连接卡片 ───────────────────────────────────────────────
    const cardC1 = createConnectionCard({
        title: 'API 服务连接',
        description: '配置 Stable Diffusion WebUI (A1111) HTTP 服务地址，测试连通性并拉取后端模型与 LoRA',
        url: store.get('sdWebUrl') || DEFAULT_SDWEBUI_URL,
        placeholder: 'http://127.0.0.1:7860',
        onUrlChange: (newUrl) => store.set('sdWebUrl', newUrl),
        onTest: async (url, btn) => {
            btn.disabled = true;
            btn.textContent = '连接中...';
            try {
                store.set('sdWebUrl', url);
                const driver = drivers?.get('sdwebui');
                if (!driver) {
                    FeedbackService.toastError('🔴 驱动未就绪: SD-WebUI 驱动未注册');
                    return;
                }

                const result = driver.checkConnection
                    ? await driver.checkConnection()
                    : { connected: await driver.ping(), latencyMs: 0 };

                if (result.connected) {
                    const syncResult = driver.syncAssets ? await driver.syncAssets(store) : { updatedCount: 0, summary: '', details: {} };
                    FeedbackService.toastSuccess(
                        `🟢 SD-WebUI 连接成功 (延迟 ${result.latencyMs ?? 0}ms)\n${syncResult.summary}`
                    );
                } else {
                    FeedbackService.toastError('🔴 SD-WebUI 连接失败: 无法访问后端服务');
                }
            } catch (err: any) {
                FeedbackService.toastError(`🔴 连接异常: ${err?.message || err}`);
            } finally {
                if (btn && btn.isConnected) {
                    btn.disabled = false;
                    btn.textContent = '测试连接';
                }
            }
        }
    });
    container.appendChild(cardC1);

    // ── C2: 局部方案快捷切换卡片 ─────────────────────────────────────────────
    const getSDProfiles = (): SelectOptionItem[] => [
        { label: '(未关联/自定义)', value: '' },
        ...(store.get('sdProfiles') || []).map((p) => ({ label: p.name, value: p.id }))
    ];

    const cardC2Schema: SectionCardSchema<DrawAssistantSettings> = {
        title: '局部方案快捷切换',
        description: '在 SD-WebUI 面板顶部直接快速切换并装载预设生图参数方案',
        rows: [
            {
                key: 'sdProfileId',
                type: 'select',
                label: '生图参数方案',
                helpTooltip: '顶部分步快捷切换 SD-WebUI 底模、采样算法、分辨率及 Hires.fix 参数预设。',
                options: getSDProfiles(),
                onChangeHook: (id) => {
                    if (id) {
                        const profile = (store.get('sdProfiles') || []).find((p) => p.id === id);
                        if (profile?.data) applySDProfileData(profile.data);
                    }
                }
            }
        ]
    };
    container.appendChild(rendererMain.renderCard(cardC2Schema));

    // ── C3: 基础生图与采样参数配置卡片 ───────────────────────────────────────
    const getCachedModels = (): SelectOptionItem[] => [
        { label: '未选择', value: '' },
        ...(store.get('cachedModels') || []).map((m) => ({ label: m, value: m }))
    ];
    const getCachedSamplers = (): SelectOptionItem[] =>
        (store.get('cachedSamplers') || ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ SDE Karras', 'DDIM']).map((s) => ({ label: s, value: s }));
    const getCachedUpscalers = (): SelectOptionItem[] =>
        (store.get('cachedUpscalers') || ['R-ESRGAN 4x+', 'R-ESRGAN 4x+ Anime6B', 'Latent', 'ESRGAN_4x', 'ScuNET']).map((u) => ({ label: u, value: u }));

    const toolbarC3 = bindPresetToolbar({
        adapter: {
            label: '生图参数',
            getProfiles: () => (store.get('sdProfiles') || []).map((p) => ({ id: p.id, name: p.name, data: p.data })),
            getInitialId: () => store.get('sdProfileId') || '',
            createProfile: (name, data: any) => {
                const id = `sd_profile_${Date.now()}`;
                const current = store.get('sdProfiles') || [];
                store.set('sdProfiles', [...current, { id, name, data }]);
                store.set('sdProfileId', id);
                return id;
            },
            saveProfile: (id, data: any) => {
                const current = store.get('sdProfiles') || [];
                store.set('sdProfiles', current.map((p) => (p.id === id ? { ...p, data } : p)));
            },
            renameProfile: (id, newName) => {
                const current = store.get('sdProfiles') || [];
                store.set('sdProfiles', current.map((p) => (p.id === id ? { ...p, name: newName } : p)));
            },
            deleteProfile: (id) => {
                const current = store.get('sdProfiles') || [];
                store.set('sdProfiles', current.filter((p) => p.id !== id));
                store.set('sdProfileId', '');
                return '';
            },
            resetToDefault: async () => {
                try {
                    const defaults = await fetchSDWebUIModels();
                    store.set('sdProfiles', defaults);
                    store.set('sdProfileId', defaults[0]?.id || '');
                } catch {
                    store.set('sdProfiles', []);
                    store.set('sdProfileId', '');
                }
            }
        },
        getCurrentData: () => ({
            sdModelCheckpoint: draftStore.get('sdModelCheckpoint'),
            sdSamplerName: draftStore.get('sdSamplerName'),
            sdSteps: draftStore.get('sdSteps'),
            sdCfgScale: draftStore.get('sdCfgScale'),
            sdWidth: draftStore.get('sdWidth'),
            sdHeight: draftStore.get('sdHeight'),
            sdClipSkip: draftStore.get('sdClipSkip'),
            sdDenoisingStrength: draftStore.get('sdDenoisingStrength'),
            sdEnableHires: draftStore.get('sdEnableHires'),
            sdHiresUpscaler: draftStore.get('sdHiresUpscaler'),
            sdHiresUpscaleBy: draftStore.get('sdHiresUpscaleBy'),
            sdHiresSteps: draftStore.get('sdHiresSteps'),
            sdHiresDenoise: draftStore.get('sdHiresDenoise')
        }),
        applyData: (id) => {
            const profile = (store.get('sdProfiles') || []).find((p) => p.id === id);
            if (profile?.data) applySDProfileData(profile.data);
        },
        onRefresh: () => {}
    });


    const cardC3Schema: SectionCardSchema<DrawAssistantSettings> = {
        title: '基础生图与采样参数配置',
        description: '配置 SD 模型 Checkpoint、采样器算法、分辨率及生成引导系数',
        rows: [
            {
                type: 'component',
                label: '生图参数方案管理',
                renderCustom: () => toolbarC3
            },
            {
                key: 'sdModelCheckpoint',
                type: 'select',
                label: '主模型 (Checkpoint)',
                helpTooltip: '从 SD-WebUI 后端读取的可用底模列表。',
                options: getCachedModels()
            },
            {
                key: 'sdSamplerName',
                type: 'select',
                label: '采样算法 (Sampler)',
                helpTooltip: '生成图像迭代使用的采样器。',
                options: getCachedSamplers()
            },
            {
                key: 'sdSteps',
                type: 'number',
                label: '采样步数 (Steps)',
                helpTooltip: '生成图像的去噪迭代步数。',
                min: 1,
                max: 150,
                step: 1,
                unit: '步'
            },
            {
                key: 'sdCfgScale',
                type: 'number',
                label: '提示词引导系数 (CFG Scale)',
                helpTooltip: '提示词引导相关性权重。',
                min: 1.0,
                max: 30.0,
                step: 0.5
            },
            {
                key: 'sdClipSkip',
                type: 'number',
                label: 'CLIP 跳过层数 (Clip Skip)',
                helpTooltip: '常用 1 (SD1.5/SDXL默认) 或 2 (二次元动漫模型)。',
                min: 1,
                max: 12,
                step: 1
            },
            {
                type: 'select',
                label: '分辨率尺寸预设',
                helpTooltip: '快捷选用推荐生成宽高比例，选择后自动同步至下方宽高输入框。',
                options: [...SDWEBUI_SIZE_PRESETS],
                onChangeHook: (val: string) => {
                    if (val !== 'custom') {
                        const [w, h] = val.split('x').map((n) => parseInt(n, 10));
                        if (w && h) draftStore.update({ sdWidth: w, sdHeight: h });
                    }
                }
            },
            {
                key: 'sdWidth',
                type: 'number',
                label: '生成宽度 (Width, px)',
                helpTooltip: '生成图像的物理像素宽度。',
                min: 64,
                max: 2048,
                step: 64,
                unit: 'px'
            },
            {
                key: 'sdHeight',
                type: 'number',
                label: '生成高度 (Height, px)',
                helpTooltip: '生成图像的物理像素高度。',
                min: 64,
                max: 2048,
                step: 64,
                unit: 'px'
            }
        ]
    };
    container.appendChild(rendererDraft.renderCard(cardC3Schema));

    // ── C4: 高清修复与图生图参数配置卡片 (Hires.fix) ──────────────────────────
    const cardC4Schema: SectionCardSchema<DrawAssistantSettings> = {
        title: '高清修复与图生图配置 (Hires.fix)',
        description: '配置 SD 高清修复超分辨率算法、放大倍率与图生图重绘重噪比',
        rows: [
            {
                key: 'sdEnableHires',
                type: 'toggle',
                label: '启用高清修复 (Hires.fix)',
                helpTooltip: '生成低分辨率初图后自动放大并执行二次采样修复微小瑕疵。'
            },
            {
                key: 'sdHiresUpscaler',
                type: 'select',
                label: '放大算法 (Upscaler)',
                helpTooltip: '高清修复使用的潜空间或超分辨率算法。',
                options: getCachedUpscalers()
            },
            {
                key: 'sdHiresUpscaleBy',
                type: 'number',
                label: '放大倍率 (Upscale By)',
                helpTooltip: '在基础分辨率上的放大倍数 (如 1.5x, 2.0x)。',
                min: 1.0,
                max: 4.0,
                step: 0.25
            },
            {
                key: 'sdHiresSteps',
                type: 'number',
                label: '高清修复步数 (Hires Steps)',
                helpTooltip: '二次高清采样的步数（0 表示与原采样步数相同）。',
                min: 0,
                max: 100,
                step: 1,
                unit: '步'
            },
            {
                key: 'sdHiresDenoise',
                type: 'number',
                label: '高清修复重噪比 (Hires Denoise)',
                helpTooltip: '二次采样的重噪强度（推荐 0.35 ~ 0.55）。',
                min: 0.1,
                max: 1.0,
                step: 0.05
            },
            {
                key: 'sdDenoisingStrength',
                type: 'number',
                label: '图生图通用重噪比 (Denoising Strength)',
                helpTooltip: '局部重绘与图生图基础去噪强度。',
                min: 0.05,
                max: 1.0,
                step: 0.05
            }
        ]
    };
    container.appendChild(rendererDraft.renderCard(cardC4Schema));

    // ── C5: 提示词模板与 LoRA 增强卡片 ──────────────────────────────────────
    const cardC5Schema: SectionCardSchema<DrawAssistantSettings> = {
        title: '提示词模板与 LoRA 增强',
        description: '维护正向前缀词、正向后缀词、负向词及 LoRA 动态选择与权重追加列表',
        rows: [
            {
                key: 'promptPrefix',
                type: 'input',
                label: '全局正向提示词前缀',
                helpTooltip: '自动拼接在 AI 楼层正向提示词的最前端。例如质量词、画风起手词等。',
                placeholder: 'masterpiece, best quality, highly detailed...'
            },
            {
                key: 'promptSuffix',
                type: 'input',
                label: '全局正向提示词后缀',
                helpTooltip: '自动拼接在 AI 楼层正向提示词的末尾。',
                placeholder: 'vibrant lighting, 8k resolution...'
            },
            {
                key: 'negativePrefix',
                type: 'input',
                label: '全局负向提示词',
                helpTooltip: '全局排除的不期望特征或画质瑕疵词。',
                placeholder: 'lowres, bad anatomy, worst quality, text, error...'
            },
            {
                type: 'component',
                label: '追加 LoRA 模型预设',
                renderCustom: () => {
                    return createCollapsibleSection({
                        summaryText: '追加 LoRA 模型预设',
                        defaultOpen: false,
                        renderBody: (loraBody) => {
                            const loraManager = createLoraManagerControl({
                                loras: draftStore.get('loras') || store.get('loras') || [],
                                cachedLoras: store.get('cachedLoras') || [],
                                showExtraWeights: false,
                                onChange: (newLoras) => {
                                    draftStore.set('loras', newLoras);
                                }
                            });
                            loraBody.appendChild(loraManager);
                        }
                    });
                }
            }
        ]
    };
    container.appendChild(rendererDraft.renderCard(cardC5Schema));

    container.dispose = () => {
        rendererDraft.dispose();
        rendererMain.dispose();
        draftStore.dispose();
    };

    return container;
}
