/**
 * @module ui/tabs/comfyui-tab
 * @description ComfyUI 引擎配置面板
 *
 * 职责：
 * - 提供服务连接测试与模型/Lora 列表拉取
 * - 管理模型参数、提示词模板、文生图与局部重绘工作流预设方案
 * - 支持工作流可视化浏览与自定义 API JSON 配置
 */

import { createFieldRow, bindPresetToolbar } from '../components/controls';
import { openBlueprintModal } from '../components/blueprint-modal';
import {
    loadSettings,
    applyProfileData,
    getEffectiveList,
} from '../../settings/manager';
import { patchSettings, settingsStore } from '../../state/app-store';
import { createDriver } from '../../drivers/factory';
import { escapeHtmlAttr } from '../../utils/html';
import { FeedbackService } from '../feedback-service';


export function renderComfyUITab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-comfyui-tab';

    const settings = loadSettings();

    /** 即时自动保存策略：交互控制触发 patchSettings 成功保存后发出反馈通知 */
    const notifyChange = () => {
        FeedbackService.notifySaved('comfyui');
    };

    const createSpan = (text: string) => {
        const s = document.createElement('span');
        s.textContent = text;
        return s;
    };

    const syncFieldsRef: { current?: () => void } = {};
    const updateToolbarsRef: { current?: () => void } = {};
    let populateProfileSelectsRef: { current: (() => void) | null } = { current: null };
    let renderLoraListRef: { current: (() => void) | null } = { current: null };

    const syncFormWithStore = () => {
        const s = loadSettings();
        if (urlInput && document.activeElement !== urlInput) {
            urlInput.value = s.serverUrl ?? 'http://127.0.0.1:8188';
        }
        if (syncFieldsRef.current) {
            syncFieldsRef.current();
        }
    };

    const refreshTab = () => {
        syncFormWithStore();
        if (populateProfileSelectsRef.current) {
            populateProfileSelectsRef.current();
        }
        if (updateToolbarsRef.current) {
            updateToolbarsRef.current();
        }
        if (renderLoraListRef.current) {
            renderLoraListRef.current();
        }
    };

    // ── C1: API 服务连接 ───────────────────────────────────────────────────
    const cardC1 = document.createElement('div');
    cardC1.className = 'da-section-card';

    const headerC1 = document.createElement('div');
    headerC1.className = 'da-section-header';
    headerC1.innerHTML = `
        <span class="da-section-title">API 服务连接</span>
        <span class="da-section-desc">配置 ComfyUI HTTP 服务根地址，测试连通性并自动拉取后端全量模型与 Lora 列表</span>
    `;
    cardC1.appendChild(headerC1);

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'da-input';
    urlInput.style.flex = '1';
    urlInput.style.maxWidth = '360px';
    urlInput.value = settings.serverUrl ?? 'http://127.0.0.1:8188';
    const saveUrl = () => {
        const val = urlInput.value.trim();
        if (val) {
            patchSettings({ serverUrl: val });
            notifyChange();
        }
    };
    urlInput.addEventListener('change', saveUrl);
    urlInput.addEventListener('blur', saveUrl);

    const testBtn = document.createElement('button');
    testBtn.className = 'da-btn secondary';
    testBtn.style.width = '100px';
    testBtn.style.flexShrink = '0';
    testBtn.textContent = '测试连接';

    // 前置声明各下拉框组件引用（供测试连接成功后联动填充）
    const modelSelect = document.createElement('select');
    const clipSelect = document.createElement('select');
    const vaeSelect = document.createElement('select');
    const samplerSelect = document.createElement('select');
    const schedulerSelect = document.createElement('select');
    const loraAddSelect = document.createElement('select');

    testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = '连接中...';
        try {
            saveUrl();
            const activeSettings = loadSettings();
            const driver = createDriver(activeSettings.provider, activeSettings);
            const res = await driver.checkConnection();
            if (res.connected) {
                // 并发拉取后端全部类型模型、CLIP、VAE、Sampler、Scheduler 及 Lora
                const [models, clips, vaes, samplers, schedulers, loras] = await Promise.all([
                    driver.getModels ? driver.getModels() : Promise.resolve([]),
                    driver.getClips ? driver.getClips() : Promise.resolve([]),
                    driver.getVaes ? driver.getVaes() : Promise.resolve([]),
                    driver.getSamplers ? driver.getSamplers() : Promise.resolve([]),
                    driver.getSchedulers ? driver.getSchedulers() : Promise.resolve([]),
                    driver.getLoras ? driver.getLoras() : Promise.resolve([]),
                ]);

                // 持久化缓存全量模型列表至设置项，避免重复测试链接
                patchSettings({
                    cachedModels: models.length > 0 ? models : activeSettings.cachedModels,
                    cachedClips: clips.length > 0 ? clips : activeSettings.cachedClips,
                    cachedVaes: vaes.length > 0 ? vaes : activeSettings.cachedVaes,
                    cachedSamplers: samplers.length > 0 ? samplers : activeSettings.cachedSamplers,
                    cachedSchedulers: schedulers.length > 0 ? schedulers : activeSettings.cachedSchedulers,
                    cachedLoras: loras.length > 0 ? loras : activeSettings.cachedLoras,
                });

                // 统一更新 Checkpoint/UNet 模型列表
                if (models.length > 0) {
                    modelSelect.innerHTML = models.map(m => `<option value="${escapeHtmlAttr(m)}" ${m === activeSettings.ckptName ? 'selected' : ''}>${escapeHtmlAttr(m)}</option>`).join('');
                    if (!activeSettings.ckptName && models[0]) {
                        patchSettings({ ckptName: models[0] });
                    }
                }

                // 更新 CLIP
                if (clips.length > 0) {
                    clipSelect.innerHTML = `<option value="">未选择</option>` + clips.map(c => `<option value="${escapeHtmlAttr(c)}" ${c === activeSettings.clipName ? 'selected' : ''}>${escapeHtmlAttr(c)}</option>`).join('');
                }

                // 更新 VAE
                if (vaes.length > 0) {
                    vaeSelect.innerHTML = `<option value="">未选择</option>` + vaes.map(v => `<option value="${escapeHtmlAttr(v)}" ${v === activeSettings.vaeName ? 'selected' : ''}>${escapeHtmlAttr(v)}</option>`).join('');
                }

                // 更新 Sampler
                if (samplers.length > 0) {
                    samplerSelect.innerHTML = samplers.map(s => `<option value="${escapeHtmlAttr(s)}" ${s === activeSettings.samplerName ? 'selected' : ''}>${escapeHtmlAttr(s)}</option>`).join('');
                }

                // 更新 Scheduler
                if (schedulers.length > 0) {
                    schedulerSelect.innerHTML = schedulers.map(sc => `<option value="${escapeHtmlAttr(sc)}" ${sc === activeSettings.scheduler ? 'selected' : ''}>${escapeHtmlAttr(sc)}</option>`).join('');
                }

                // 更新 Lora 下拉选择框
                if (loras.length > 0) {
                    loraAddSelect.innerHTML = `<option value="">(选择 Lora 模型)</option>` + loras.map(l => `<option value="${escapeHtmlAttr(l)}">${escapeHtmlAttr(l)}</option>`).join('');
                }

                FeedbackService.toastSuccess(`🟢 服务连接成功 (延迟 ${res.latencyMs ?? 0}ms)\n已成功自动更新：${models.length} 个绘图模型、${loras.length} 个 Lora、${samplers.length} 个采样算法方案。`, 'ComfyUI 连接测试成功');
            } else {
                FeedbackService.toastError(`🔴 服务连接失败: ${res.error ?? '无法访问后端服务'}`, 'ComfyUI 连接失败');
            }
        } catch (e) {
            FeedbackService.toastError(`🔴 连接发生异常: ${e instanceof Error ? e.message : String(e)}`, 'ComfyUI 连接异常');
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '测试连接';
        }
    });

    cardC1.appendChild(createFieldRow({
        label: 'ComfyUI API 服务地址',
        helpTooltip: 'ComfyUI 服务端根地址 (例如 http://127.0.0.1:8188)。',
        control: [urlInput, testBtn],
    }));

    container.appendChild(cardC1);

    // ── C2: 局部方案快捷切换栏 ───────────────────────────────────────────────
    const cardC2 = document.createElement('div');
    cardC2.className = 'da-section-card';

    const headerC2 = document.createElement('div');
    headerC2.className = 'da-section-header';
    headerC2.style.marginBottom = '12px';
    headerC2.innerHTML = `
        <span class="da-section-title">局部方案快捷切换</span>
        <span class="da-section-desc">在 ComfyUI 面板顶部直接快速切换并装载模型参数、提示词、文生图及局部重绘方案</span>
    `;
    cardC2.appendChild(headerC2);

    // 快捷 1：模型参数方案
    const selectModelProfile = document.createElement('select');
    selectModelProfile.className = 'da-select';
    selectModelProfile.style.width = '100%';
    selectModelProfile.style.maxWidth = '360px';

    selectModelProfile.addEventListener('change', () => {
        const val = selectModelProfile.value;
        if (val === (loadSettings().comfyModelProfileId ?? '')) return; // 同值防重阻断
        patchSettings({ comfyModelProfileId: val });
        if (val) applyProfileData('model', val);
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '模型参数方案',
        helpTooltip: '顶部分步快捷切换底模、CLIP、VAE 解码器、分辨率及采样算法步数预设。',
        control: selectModelProfile,
    }));

    // 快捷 2：提示词方案
    const selectPromptProfile = document.createElement('select');
    selectPromptProfile.className = 'da-select';
    selectPromptProfile.style.width = '100%';
    selectPromptProfile.style.maxWidth = '360px';

    selectPromptProfile.addEventListener('change', () => {
        const val = selectPromptProfile.value;
        if (val === (loadSettings().comfyPromptProfileId ?? '')) return; // 同值防重阻断
        patchSettings({ comfyPromptProfileId: val });
        if (val) applyProfileData('prompt', val);
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '提示词方案',
        helpTooltip: '顶部分步快捷切换正负向词与 Lora 追加配置预设。',
        control: selectPromptProfile,
    }));

    // 快捷 3：文生图工作流方案
    const selectTxt2ImgWorkflow = document.createElement('select');
    selectTxt2ImgWorkflow.className = 'da-select';
    selectTxt2ImgWorkflow.style.width = '100%';
    selectTxt2ImgWorkflow.style.maxWidth = '360px';

    selectTxt2ImgWorkflow.addEventListener('change', () => {
        const val = selectTxt2ImgWorkflow.value;
        if (val === (loadSettings().comfyTxt2ImgWorkflowId ?? '')) return; // 同值防重阻断
        patchSettings({ comfyTxt2ImgWorkflowId: val });
        if (val) applyProfileData('workflow', val);
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '文生图工作流',
        helpTooltip: '顶部分步快捷切换主渲染流程 API 工作流预设。',
        control: selectTxt2ImgWorkflow,
    }));

    // 快捷 4：局部重绘工作流方案
    const selectInpaintWorkflow = document.createElement('select');
    selectInpaintWorkflow.className = 'da-select';
    selectInpaintWorkflow.style.width = '100%';
    selectInpaintWorkflow.style.maxWidth = '360px';

    selectInpaintWorkflow.addEventListener('change', () => {
        const val = selectInpaintWorkflow.value;
        if (val === (loadSettings().comfyInpaintWorkflowId ?? '')) return; // 同值防重阻断
        patchSettings({ comfyInpaintWorkflowId: val });
        if (val) applyProfileData('inpaint', val);
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '局部重绘工作流',
        helpTooltip: '顶部分步快捷切换 Inpaint 局部修图 API 工作流预设。',
        control: selectInpaintWorkflow,
    }));

    container.appendChild(cardC2);

    /** 可重复构筑的 DOM Option Populate 函数（解决新建工作流/预设后下拉框选项未更新的数据不同步 Bug） */
    const populateProfileSelects = () => {
        const curSettings = loadSettings();

        // 1. 模型方案
        const curModelId = curSettings.comfyModelProfileId ?? '';
        selectModelProfile.innerHTML = `<option value="">(未关联/自定义)</option>`;
        (curSettings.comfyModelProfiles ?? []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === curModelId) opt.selected = true;
            selectModelProfile.appendChild(opt);
        });
        selectModelProfile.value = curModelId;

        // 2. 提示词方案
        const curPromptId = curSettings.comfyPromptProfileId ?? '';
        selectPromptProfile.innerHTML = `<option value="">(未关联/自定义)</option>`;
        (curSettings.comfyPromptProfiles ?? []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === curPromptId) opt.selected = true;
            selectPromptProfile.appendChild(opt);
        });
        selectPromptProfile.value = curPromptId;

        // 3. 文生图工作流方案
        const curTxt2ImgId = curSettings.comfyTxt2ImgWorkflowId ?? '';
        selectTxt2ImgWorkflow.innerHTML = `<option value="">(未关联/自定义)</option>`;
        (getEffectiveList('workflow')).forEach((p: any) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === curTxt2ImgId) opt.selected = true;
            selectTxt2ImgWorkflow.appendChild(opt);
        });
        selectTxt2ImgWorkflow.value = curTxt2ImgId;

        // 4. 重绘工作流方案
        const curInpaintId = curSettings.comfyInpaintWorkflowId ?? '';
        selectInpaintWorkflow.innerHTML = `<option value="">(未关联/自定义)</option>`;
        (getEffectiveList('inpaint')).forEach((p: any) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === curInpaintId) opt.selected = true;
            selectInpaintWorkflow.appendChild(opt);
        });
        selectInpaintWorkflow.value = curInpaintId;
    };

    // 初始填充
    populateProfileSelects();
    populateProfileSelectsRef.current = populateProfileSelects;

    // ── C3: 模型与采样参数配置 ────────────────────────────────────────────────
    const cardC3 = document.createElement('div');
    cardC3.className = 'da-section-card';
    cardC3.style.marginTop = '15px';

    const headerC3 = document.createElement('div');
    headerC3.className = 'da-section-header';
    headerC3.style.marginBottom = '12px';
    headerC3.innerHTML = `
        <span class="da-section-title">模型与采样参数配置</span>
        <span class="da-section-desc">配置底模 Checkpoint、文本编码器与 VAE 解码器，并设定分辨率与 KSampler 采样参数</span>
    `;
    cardC3.appendChild(headerC3);

    const toolbarC3 = bindPresetToolbar({
        category: 'model',
        getCurrentData: () => {
            const cur = loadSettings();
            return {
                ckptName: cur.ckptName,
                clipName: cur.clipName,
                vaeName: cur.vaeName,
                width: cur.width,
                height: cur.height,
                steps: cur.steps,
                cfgScale: cur.cfgScale,
                samplerName: cur.samplerName,
                scheduler: cur.scheduler,
                checkpointPositivePrefix: cur.checkpointPositivePrefix,
                checkpointNegativePrefix: cur.checkpointNegativePrefix,
                inpaintDenoise: cur.inpaintDenoise,
                inpaintMaskBlur: cur.inpaintMaskBlur,
                inpaintGrowMask: cur.inpaintGrowMask,
            };
        },
        applyData: (id: string) => {
            patchSettings({ comfyModelProfileId: id });
            applyProfileData('model', id);
        },
        onRefresh: () => refreshTab(),
    });
    cardC3.appendChild(toolbarC3);

    const populateSelectWithOptions = (
        selectEl: HTMLSelectElement,
        cachedList: string[] | undefined,
        currentVal: string | undefined,
        emptyLabel: string = '未选择'
    ) => {
        const list = cachedList && cachedList.length > 0 ? cachedList : [];
        const isMissing = Boolean(currentVal && list.length > 0 && !list.includes(currentVal));

        selectEl.innerHTML = '';
        if (emptyLabel) {
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = emptyLabel;
            if (!currentVal) emptyOpt.selected = true;
            selectEl.appendChild(emptyOpt);
        }

        if (currentVal && !list.includes(currentVal)) {
            const missingOpt = document.createElement('option');
            missingOpt.value = currentVal;
            missingOpt.textContent = `⚠️ ${currentVal} (未在后端列表中找到)`;
            missingOpt.selected = true;
            selectEl.appendChild(missingOpt);
        }

        list.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item;
            opt.textContent = item;
            if (item === currentVal) opt.selected = true;
            selectEl.appendChild(opt);
        });

        if (isMissing) {
            selectEl.classList.add('da-select-error');
            selectEl.title = `⚠️ 当前选中的资源 [${currentVal}] 未在后端列表中找到，请检查 ComfyUI 模型文件！`;
        } else {
            selectEl.classList.remove('da-select-error');
            selectEl.removeAttribute('title');
        }
    };

    // 3.1 绘图模型 选择框
    modelSelect.className = 'da-select';
    modelSelect.style.width = '100%';
    modelSelect.style.maxWidth = '380px';
    populateSelectWithOptions(modelSelect, settings.cachedModels, settings.ckptName, '未选择');
    modelSelect.addEventListener('change', () => {
        const val = modelSelect.value;
        if (val === (loadSettings().ckptName ?? '')) return; // 同值防重阻断
        patchSettings({ ckptName: val });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: '主模型 (Checkpoint)',
        helpTooltip: '从 ComfyUI 后端包含 CheckpointLoaderSimple, UNETLoader, DiffusionModelLoader 等合并的所有可用模型。',
        control: modelSelect,
    }));

    // 3.2 CLIP 选择框
    clipSelect.className = 'da-select';
    clipSelect.style.width = '100%';
    clipSelect.style.maxWidth = '380px';
    populateSelectWithOptions(clipSelect, settings.cachedClips, settings.clipName, '未选择');
    clipSelect.addEventListener('change', () => {
        const val = clipSelect.value;
        if (val === (loadSettings().clipName ?? '')) return; // 同值防重阻断
        patchSettings({ clipName: val });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: 'CLIP 文本编码器',
        helpTooltip: '指定独立 CLIP 文本编码器模型。若当前工作流已内置编码器或无需覆盖，留空未选择即可。',
        control: clipSelect,
    }));

    // 3.3 VAE 选择框
    vaeSelect.className = 'da-select';
    vaeSelect.style.width = '100%';
    vaeSelect.style.maxWidth = '380px';
    populateSelectWithOptions(vaeSelect, settings.cachedVaes, settings.vaeName, '未选择');
    vaeSelect.addEventListener('change', () => {
        const val = vaeSelect.value;
        if (val === (loadSettings().vaeName ?? '')) return; // 同值防重阻断
        patchSettings({ vaeName: val });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: 'VAE 图像解码器',
        helpTooltip: '指定独立 VAE 解码器模型。若已包含于底模中或无需覆盖，留空未选择即可。',
        control: vaeSelect,
    }));

    // 3.4 采样器 (Sampler) 选择框 (单独成行)
    samplerSelect.className = 'da-select';
    samplerSelect.style.width = '100%';
    samplerSelect.style.maxWidth = '260px';
    populateSelectWithOptions(
        samplerSelect,
        settings.cachedSamplers && settings.cachedSamplers.length > 0 ? settings.cachedSamplers : ['euler_ancestral', 'euler', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc'],
        settings.samplerName ?? 'euler_ancestral',
        ''
    );
    samplerSelect.addEventListener('change', () => {
        const val = samplerSelect.value;
        if (val === (loadSettings().samplerName ?? 'euler_ancestral')) return;
        patchSettings({ samplerName: val });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: '采样算法 (Sampler)',
        control: samplerSelect,
    }));

    // 3.5 调度器 (Scheduler) 选择框 (单独成行)
    schedulerSelect.className = 'da-select';
    schedulerSelect.style.width = '100%';
    schedulerSelect.style.maxWidth = '260px';
    populateSelectWithOptions(
        schedulerSelect,
        settings.cachedSchedulers && settings.cachedSchedulers.length > 0 ? settings.cachedSchedulers : ['normal', 'karras', 'exponential', 'sgm_uniform'],
        settings.scheduler ?? 'normal',
        ''
    );
    schedulerSelect.addEventListener('change', () => {
        const val = schedulerSelect.value;
        if (val === (loadSettings().scheduler ?? 'normal')) return;
        patchSettings({ scheduler: val });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: '调度器 (Scheduler)',
        control: schedulerSelect,
    }));

    // 3.6 分辨率预设 (单独成行)
    const resPresetSelect = document.createElement('select');
    resPresetSelect.className = 'da-select';
    resPresetSelect.style.width = '100%';
    resPresetSelect.style.maxWidth = '260px';
    resPresetSelect.innerHTML = `
        <option value="custom">自定义尺寸</option>
        <option value="1024x1024">方图 1024 × 1024 (1:1)</option>
        <option value="1024x1344">竖图 1024 × 1344 (3:4)</option>
        <option value="832x1216">竖图 832 × 1216 (2:3)</option>
        <option value="1216x832">横图 1216 × 832 (3:2)</option>
    `;

    const widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.className = 'da-input';
    widthInput.style.width = '140px';
    widthInput.step = '64';
    widthInput.value = String(settings.width ?? 1024);

    const heightInput = document.createElement('input');
    heightInput.type = 'number';
    heightInput.className = 'da-input';
    heightInput.style.width = '140px';
    heightInput.step = '64';
    heightInput.value = String(settings.height ?? 1344);

    resPresetSelect.addEventListener('change', () => {
        if (resPresetSelect.value !== 'custom') {
            const [w, h] = resPresetSelect.value.split('x').map(n => parseInt(n, 10));
            const curS = loadSettings();
            if (w === curS.width && h === curS.height) return;
            widthInput.value = String(w);
            heightInput.value = String(h);
            patchSettings({ width: w, height: h });
            notifyChange();
        }
    });

    cardC3.appendChild(createFieldRow({
        label: '分辨率尺寸预设',
        control: resPresetSelect,
    }));

    // 3.7 生成宽度 (单独成行)
    const saveWidth = () => {
        const val = parseInt(widthInput.value, 10);
        if (val > 0) {
            if (val === loadSettings().width) return;
            patchSettings({ width: val });
            notifyChange();
        }
    };
    widthInput.addEventListener('change', saveWidth);
    widthInput.addEventListener('blur', saveWidth);

    cardC3.appendChild(createFieldRow({
        label: '生成宽度 (Width)',
        helpTooltip: '图像生成宽度（单位：像素，推荐为 64 的整数倍）。',
        control: [widthInput, createSpan(' px')],
    }));

    // 3.8 生成高度 (单独成行)
    const saveHeight = () => {
        const val = parseInt(heightInput.value, 10);
        if (val > 0) {
            if (val === loadSettings().height) return;
            patchSettings({ height: val });
            notifyChange();
        }
    };
    heightInput.addEventListener('change', saveHeight);
    heightInput.addEventListener('blur', saveHeight);

    cardC3.appendChild(createFieldRow({
        label: '生成高度 (Height)',
        helpTooltip: '图像生成高度（单位：像素，推荐为 64 的整数倍）。',
        control: [heightInput, createSpan(' px')],
    }));

    // 3.9 采样步数 (单独成行)
    const stepsInput = document.createElement('input');
    stepsInput.type = 'number';
    stepsInput.className = 'da-input';
    stepsInput.style.width = '140px';
    stepsInput.min = '1';
    stepsInput.value = String(settings.steps ?? 18);
    const saveSteps = () => {
        const val = parseInt(stepsInput.value, 10);
        if (val > 0) {
            if (val === loadSettings().steps) return;
            patchSettings({ steps: val });
            notifyChange();
        }
    };
    stepsInput.addEventListener('change', saveSteps);
    stepsInput.addEventListener('blur', saveSteps);

    cardC3.appendChild(createFieldRow({
        label: '采样步数 (Steps)',
        helpTooltip: '迭代生成步数（SDXL 推荐 18-30 步）。',
        control: [stepsInput, createSpan(' 步')],
    }));

    // 3.10 CFG Scale (单独成行)
    const cfgInput = document.createElement('input');
    cfgInput.type = 'number';
    cfgInput.className = 'da-input';
    cfgInput.style.width = '140px';
    cfgInput.step = '0.5';
    cfgInput.value = String(settings.cfgScale ?? 6.0);
    const saveCfg = () => {
        const val = parseFloat(cfgInput.value);
        if (val > 0) {
            if (val === loadSettings().cfgScale) return;
            patchSettings({ cfgScale: val });
            notifyChange();
        }
    };
    cfgInput.addEventListener('change', saveCfg);
    cfgInput.addEventListener('blur', saveCfg);

    cardC3.appendChild(createFieldRow({
        label: 'CFG 引导强度 (Scale)',
        helpTooltip: '提示词引导相关度控制（SDXL 推荐 5.0 - 7.0）。',
        control: cfgInput,
    }));

    // 3.11 模型专用正向提示词 (归属于模型预设，单独成行)
    const ckptPosTextarea = document.createElement('textarea');
    ckptPosTextarea.className = 'da-textarea';
    ckptPosTextarea.style.width = '100%';
    ckptPosTextarea.style.height = '50px';
    ckptPosTextarea.style.resize = 'vertical';
    ckptPosTextarea.placeholder = '例如: masterpiece, best quality, anime style';
    ckptPosTextarea.value = settings.checkpointPositivePrefix ?? '';
    const saveCkptPos = () => {
        const val = ckptPosTextarea.value.trim();
        if (val === (loadSettings().checkpointPositivePrefix ?? '')) return;
        patchSettings({ checkpointPositivePrefix: val });
        notifyChange();
    };
    ckptPosTextarea.addEventListener('change', saveCkptPos);
    ckptPosTextarea.addEventListener('blur', saveCkptPos);

    cardC3.appendChild(createFieldRow({
        label: '模型专用正向提示词',
        helpTooltip: '绑定在此模型参数预设中的固有正向画风起手词（自动拼接在正向提示词最前）。',
        control: ckptPosTextarea,
        isBlock: true,
    }));

    // 3.12 模型专用负向提示词 (归属于模型预设，单独成行)
    const ckptNegTextarea = document.createElement('textarea');
    ckptNegTextarea.className = 'da-textarea';
    ckptNegTextarea.style.width = '100%';
    ckptNegTextarea.style.height = '50px';
    ckptNegTextarea.style.resize = 'vertical';
    ckptNegTextarea.placeholder = '例如: lowres, bad anatomy, worst quality';
    ckptNegTextarea.value = settings.checkpointNegativePrefix ?? '';
    const saveCkptNeg = () => {
        const val = ckptNegTextarea.value.trim();
        if (val === (loadSettings().checkpointNegativePrefix ?? '')) return;
        patchSettings({ checkpointNegativePrefix: val });
        notifyChange();
    };
    ckptNegTextarea.addEventListener('change', saveCkptNeg);
    ckptNegTextarea.addEventListener('blur', saveCkptNeg);

    cardC3.appendChild(createFieldRow({
        label: '模型专用负向提示词',
        helpTooltip: '绑定在此模型参数预设中的固有避坑负向词（自动拼接在负向提示词最前）。',
        control: ckptNegTextarea,
        isBlock: true,
    }));

    // 3.13 局部重绘 & 图生图参数折叠收纳 (默认闭合，避免过度平铺)
    const inpaintCollapsible = document.createElement('details');
    inpaintCollapsible.className = 'da-collapsible-section';

    const summaryInpaint = document.createElement('summary');
    summaryInpaint.className = 'da-collapsible-summary';
    summaryInpaint.innerHTML = '<i class="fa-solid fa-paintbrush"></i>局部重绘与图生图参数';

    const inpaintBody = document.createElement('div');
    inpaintBody.style.marginTop = '10px';

    const denoiseInput = document.createElement('input');
    denoiseInput.type = 'number';
    denoiseInput.className = 'da-input';
    denoiseInput.style.width = '140px';
    denoiseInput.step = '0.05';
    denoiseInput.min = '0.05';
    denoiseInput.max = '1.0';
    denoiseInput.value = String(settings.inpaintDenoise ?? 0.75);

    const saveDenoise = () => {
        const val = parseFloat(denoiseInput.value);
        if (!isNaN(val) && val > 0 && val <= 1.0) {
            if (val === loadSettings().inpaintDenoise) return;
            patchSettings({ inpaintDenoise: val });
            notifyChange();
        }
    };
    denoiseInput.addEventListener('change', saveDenoise);
    denoiseInput.addEventListener('blur', saveDenoise);

    inpaintBody.appendChild(createFieldRow({
        label: '重绘重噪比 (Denoise Scale)',
        helpTooltip: '局部重绘/图生图的重噪强度（0.05 ~ 1.0，推荐 0.6 ~ 0.85）。值越高变动幅度越大。',
        control: denoiseInput,
    }));

    // 蒙版羽化/模糊度 (Mask Blur)
    const blurInput = document.createElement('input');
    blurInput.type = 'number';
    blurInput.className = 'da-input';
    blurInput.style.width = '140px';
    blurInput.step = '1';
    blurInput.min = '0';
    blurInput.max = '64';
    blurInput.value = String(settings.inpaintMaskBlur ?? 8);

    const saveBlur = () => {
        const val = parseInt(blurInput.value, 10);
        if (!isNaN(val) && val >= 0) {
            if (val === loadSettings().inpaintMaskBlur) return;
            patchSettings({ inpaintMaskBlur: val });
            notifyChange();
        }
    };
    blurInput.addEventListener('change', saveBlur);
    blurInput.addEventListener('blur', saveBlur);

    inpaintBody.appendChild(createFieldRow({
        label: '蒙版羽化/模糊度 (Mask Blur)',
        helpTooltip: '局部重绘边缘的模糊过渡像素（0 ~ 64 px，推荐 4 ~ 12 px），避免生成硬边缘痕迹。',
        control: blurInput,
    }));

    // 蒙版膨胀扩展 (Mask Padding / Grow Mask)
    const growInput = document.createElement('input');
    growInput.type = 'number';
    growInput.className = 'da-input';
    growInput.style.width = '140px';
    growInput.step = '1';
    growInput.min = '0';
    growInput.max = '64';
    growInput.value = String(settings.inpaintGrowMask ?? 6);

    const saveGrow = () => {
        const val = parseInt(growInput.value, 10);
        if (!isNaN(val) && val >= 0) {
            if (val === loadSettings().inpaintGrowMask) return;
            patchSettings({ inpaintGrowMask: val });
            notifyChange();
        }
    };
    growInput.addEventListener('change', saveGrow);
    growInput.addEventListener('blur', saveGrow);

    inpaintBody.appendChild(createFieldRow({
        label: '蒙版膨胀扩展 (Grow Mask)',
        helpTooltip: '涂抹掩码向外自动扩展的外扩像素（0 ~ 64 px，推荐 4 ~ 8 px），保证边缘融合更自然。',
        control: growInput,
    }));

    inpaintCollapsible.appendChild(summaryInpaint);
    inpaintCollapsible.appendChild(inpaintBody);

    cardC3.appendChild(inpaintCollapsible);

    container.appendChild(cardC3);

    // ── C4: 提示词与 Lora 方案 (包含前缀/后缀/负向/Lora追加) ────────────────────
    const cardC4 = document.createElement('div');
    cardC4.className = 'da-section-card';

    const headerC4 = document.createElement('div');
    headerC4.className = 'da-section-header';
    headerC4.innerHTML = `
        <span class="da-section-title">提示词与 Lora 方案</span>
        <span class="da-section-desc">维护正向前缀词、正向后缀词、负向词及 Lora 动态选择与权重追加列表</span>
    `;
    cardC4.appendChild(headerC4);

    const toolbarC4 = bindPresetToolbar({
        category: 'prompt',
        getCurrentData: () => {
            const activeSettings = loadSettings();
            return {
                promptPrefix: activeSettings.promptPrefix,
                negativePrefix: activeSettings.negativePrefix,
                promptSuffix: activeSettings.promptSuffix,
                loras: activeSettings.loras,
            };
        },
        applyData: (id) => applyProfileData('prompt', id),
        onRefresh: () => refreshTab(),
    });
    cardC4.appendChild(toolbarC4);

    // 4.1 正向前缀提示词 (单独成行)
    const posPrefixTextarea = document.createElement('textarea');
    posPrefixTextarea.className = 'da-textarea';
    posPrefixTextarea.style.width = '100%';
    posPrefixTextarea.style.height = '50px';
    posPrefixTextarea.style.resize = 'vertical';
    posPrefixTextarea.placeholder = '例如: masterpiece, best quality';
    posPrefixTextarea.value = settings.promptPrefix ?? '';
    const savePosPrefix = () => {
        const val = posPrefixTextarea.value.trim();
        if (val === (loadSettings().promptPrefix ?? '')) return;
        patchSettings({ promptPrefix: val });
        notifyChange();
    };
    posPrefixTextarea.addEventListener('change', savePosPrefix);
    posPrefixTextarea.addEventListener('blur', savePosPrefix);

    cardC4.appendChild(createFieldRow({
        label: '正向前缀提示词',
        helpTooltip: '自动拼接在 AI 提取提示词的正向最前面。',
        control: posPrefixTextarea,
        isBlock: true,
    }));

    // 4.2 正向后缀提示词 (单独成行)
    const posSuffixTextarea = document.createElement('textarea');
    posSuffixTextarea.className = 'da-textarea';
    posSuffixTextarea.style.width = '100%';
    posSuffixTextarea.style.height = '50px';
    posSuffixTextarea.style.resize = 'vertical';
    posSuffixTextarea.placeholder = '例如: highly detailed, vibrant lighting';
    posSuffixTextarea.value = settings.promptSuffix ?? '';
    const savePosSuffix = () => {
        const val = posSuffixTextarea.value.trim();
        if (val === (loadSettings().promptSuffix ?? '')) return;
        patchSettings({ promptSuffix: val });
        notifyChange();
    };
    posSuffixTextarea.addEventListener('change', savePosSuffix);
    posSuffixTextarea.addEventListener('blur', savePosSuffix);

    cardC4.appendChild(createFieldRow({
        label: '正向后缀提示词',
        helpTooltip: '自动拼接在 AI 提取提示词的末尾。',
        control: posSuffixTextarea,
        isBlock: true,
    }));

    // 4.3 负向提示词 (单独成行)
    const negTextarea = document.createElement('textarea');
    negTextarea.className = 'da-textarea';
    negTextarea.style.width = '100%';
    negTextarea.style.height = '50px';
    negTextarea.style.resize = 'vertical';
    negTextarea.placeholder = '例如: lowres, bad anatomy, worst quality';
    negTextarea.value = settings.negativePrefix ?? '';
    const saveNeg = () => {
        const val = negTextarea.value.trim();
        if (val === (loadSettings().negativePrefix ?? '')) return;
        patchSettings({ negativePrefix: val });
        notifyChange();
    };
    negTextarea.addEventListener('change', saveNeg);
    negTextarea.addEventListener('blur', saveNeg);

    cardC4.appendChild(createFieldRow({
        label: '负向提示词',
        helpTooltip: '全局排除的不期望特征或画质瑕疵词。',
        control: negTextarea,
        isBlock: true,
    }));

    // 4.4 独立 Collapsible 折叠收纳区：追加 LoRA 模型预设 (WeiLin)
    const loraDetails = document.createElement('details');
    loraDetails.className = 'da-collapsible-section';
    loraDetails.style.marginTop = '12px';

    const loraSummary = document.createElement('summary');
    loraSummary.className = 'da-collapsible-summary';
    loraSummary.innerHTML = `🏷️ 追加 LoRA 模型预设 (WeiLin)`;
    loraDetails.appendChild(loraSummary);

    const loraBody = document.createElement('div');
    loraBody.style.paddingTop = '10px';
    loraBody.style.display = 'flex';
    loraBody.style.flexDirection = 'column';
    loraBody.style.gap = '10px';
    loraDetails.appendChild(loraBody);

    // 行 1：LoRA 模型选择框 + 添加到方案按钮 (合并同行)
    loraAddSelect.className = 'da-select';
    loraAddSelect.style.flex = '1';
    loraAddSelect.style.minWidth = '140px';
    if (settings.cachedLoras && settings.cachedLoras.length > 0) {
        loraAddSelect.innerHTML = `<option value="">(选择 LoRA 模型)</option>` + settings.cachedLoras.map(l => `<option value="${escapeHtmlAttr(l)}">${escapeHtmlAttr(l)}</option>`).join('');
    } else {
        loraAddSelect.innerHTML = `<option value="">(选择 LoRA 模型)</option>`;
    }

    const addLoraBtn = document.createElement('button');
    addLoraBtn.className = 'da-btn secondary';
    addLoraBtn.style.whiteSpace = 'nowrap';
    addLoraBtn.textContent = '➕ 添加到方案';

    const loraRow1 = document.createElement('div');
    loraRow1.style.display = 'flex';
    loraRow1.style.gap = '8px';
    loraRow1.style.alignItems = 'center';
    loraRow1.appendChild(loraAddSelect);
    loraRow1.appendChild(addLoraBtn);

    loraBody.appendChild(createFieldRow({
        label: '选择 LoRA 模型',
        helpTooltip: 'ComfyUI 提示词 LoRA 依赖 WeiLin-Comfyui-Tools 插件全能提示词编辑器节点解析 <wlr:名称:模型权重:CLIP权重:触发词权重> 标签，请确保 ComfyUI 中已安装该插件。',
        control: loraRow1,
    }));

    // 行 2：三列并排权重设定 (模型强度 | CLIP 强度 | 触发词强度)
    const loraModelWeightInput = document.createElement('input');
    loraModelWeightInput.type = 'number';
    loraModelWeightInput.className = 'da-input';
    loraModelWeightInput.style.width = '100%';
    loraModelWeightInput.step = '0.1';
    loraModelWeightInput.value = '1.0';

    const loraClipWeightInput = document.createElement('input');
    loraClipWeightInput.type = 'number';
    loraClipWeightInput.className = 'da-input';
    loraClipWeightInput.style.width = '100%';
    loraClipWeightInput.step = '0.1';
    loraClipWeightInput.value = '1.0';

    const loraTriggerWeightInput = document.createElement('input');
    loraTriggerWeightInput.type = 'number';
    loraTriggerWeightInput.className = 'da-input';
    loraTriggerWeightInput.style.width = '100%';
    loraTriggerWeightInput.step = '0.1';
    loraTriggerWeightInput.value = '1.0';

    const createWeightField = (lbl: string, inputEl: HTMLElement) => {
        const wrap = document.createElement('div');
        wrap.style.flex = '1';
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.gap = '4px';

        const labelSpan = document.createElement('span');
        labelSpan.style.fontSize = '0.8em';
        labelSpan.style.color = 'var(--da-text-secondary)';
        labelSpan.textContent = lbl;

        wrap.appendChild(labelSpan);
        wrap.appendChild(inputEl);
        return wrap;
    };

    const loraRow2 = document.createElement('div');
    loraRow2.style.display = 'flex';
    loraRow2.style.gap = '10px';
    loraRow2.style.width = '100%';
    loraRow2.appendChild(createWeightField('UNet 模型强度', loraModelWeightInput));
    loraRow2.appendChild(createWeightField('CLIP 文本强度', loraClipWeightInput));
    loraRow2.appendChild(createWeightField('触发词强度', loraTriggerWeightInput));

    loraBody.appendChild(createFieldRow({
        label: '三组权重设定',
        control: loraRow2,
        isBlock: true,
    }));

    // 行 3：视觉分隔线
    const loraDivider = document.createElement('div');
    loraDivider.style.margin = '4px 0';
    loraDivider.style.borderTop = '1px solid var(--da-border-color)';
    loraDivider.style.opacity = '0.5';
    loraBody.appendChild(loraDivider);

    // 行 4：已装载 LoRA 列表
    const loraContainer = document.createElement('div');
    loraContainer.className = 'da-lora-list-container';
    loraContainer.style.display = 'flex';
    loraContainer.style.flexWrap = 'wrap';
    loraContainer.style.gap = '8px';
    loraContainer.style.width = '100%';

    const renderLoraList = () => {
        const curSettings = loadSettings();
        const activeLoras: Array<{ name: string; weight: number; textWeight?: number; triggerWeight?: number }> = curSettings.loras ?? [];
        const cachedLoras = curSettings.cachedLoras ?? [];

        loraContainer.innerHTML = '';
        if (activeLoras.length === 0) {
            const emptySpan = document.createElement('span');
            emptySpan.style.color = 'var(--da-text-secondary)';
            emptySpan.style.fontSize = '0.85em';
            emptySpan.textContent = '当前提示词方案未添加追加 LoRA 模型';
            loraContainer.appendChild(emptySpan);
            return;
        }

        activeLoras.forEach((item, idx) => {
            const isMissing = Boolean(item.name && cachedLoras.length > 0 && !cachedLoras.includes(item.name));

            const tag = document.createElement('div');
            tag.style.display = 'inline-flex';
            tag.style.alignItems = 'center';
            tag.style.gap = '6px';
            tag.style.padding = '4px 10px';
            tag.style.borderRadius = '14px';
            tag.style.fontSize = '0.82em';

            tag.className = isMissing ? 'da-tag da-tag--error' : 'da-tag';
            if (isMissing) {
                tag.title = `⚠️ 预设引用的 LoRA 模型 [${item.name}] 未在 ComfyUI 后端找到！`;
            }

            const nameSpan = document.createElement('span');
            nameSpan.style.color = isMissing ? 'var(--da-color-error, #ff453a)' : 'var(--da-text-primary)';
            nameSpan.style.fontWeight = '500';
            nameSpan.textContent = isMissing ? `⚠️ ${item.name}` : item.name;

            const mw = item.weight ?? 1.0;
            const cw = item.textWeight ?? mw;
            const trw = item.triggerWeight ?? 1.0;

            const weightSpan = document.createElement('span');
            weightSpan.style.color = isMissing ? 'var(--da-color-error, #ff453a)' : 'var(--da-accent-color, #00f2fe)';
            weightSpan.textContent = `[模型: ${mw} | CLIP: ${cw} | 触发: ${trw}]`;

            const delBtn = document.createElement('button');
            delBtn.className = 'da-icon-btn danger';
            delBtn.style.width = '20px';
            delBtn.style.height = '20px';
            delBtn.style.fontSize = '0.9em';
            delBtn.style.lineHeight = '1';
            delBtn.title = '从当前方案中移除此 LoRA';
            delBtn.textContent = '×';

            delBtn.addEventListener('click', () => {
                const nextLoras = [...activeLoras];
                nextLoras.splice(idx, 1);
                patchSettings({ loras: nextLoras });
                notifyChange();
                renderLoraList();
            });

            tag.appendChild(nameSpan);
            tag.appendChild(weightSpan);
            tag.appendChild(delBtn);
            loraContainer.appendChild(tag);
        });
    };
    renderLoraList();
    renderLoraListRef.current = renderLoraList;

    addLoraBtn.addEventListener('click', () => {
        const rawLoraName = loraAddSelect.value.trim();
        if (!rawLoraName) return;

        const mw = parseFloat(loraModelWeightInput.value) || 1.0;
        const cw = parseFloat(loraClipWeightInput.value) || 1.0;
        const trw = parseFloat(loraTriggerWeightInput.value) || 1.0;

        const curLoras = [...(loadSettings().loras ?? [])];
        curLoras.push({ name: rawLoraName, weight: mw, textWeight: cw, triggerWeight: trw });
        patchSettings({ loras: curLoras });
        notifyChange();
        renderLoraList();
    });

    loraBody.appendChild(createFieldRow({
        label: '预设中已装载 LoRA 列表',
        control: loraContainer,
        isBlock: true,
    }));

    cardC4.appendChild(loraDetails);

    container.appendChild(cardC4);

    // ── C5: 文生图工作流预设方案 ─────────────────────────────────────────────
    const cardC5 = document.createElement('div');
    cardC5.className = 'da-section-card';

    const headerC5 = document.createElement('div');
    headerC5.className = 'da-section-header';
    headerC5.innerHTML = `
        <span class="da-section-title">文生图工作流预设</span>
        <span class="da-section-desc">维护标准文本生成图像 API Format Workflow JSON，支持通过蓝图可视化编辑器绑定变量</span>
    `;
    cardC5.appendChild(headerC5);

    const workflowTextarea = document.createElement('textarea');
    workflowTextarea.className = 'da-textarea';
    workflowTextarea.style.width = '100%';
    workflowTextarea.style.height = '120px';
    workflowTextarea.style.fontFamily = 'var(--monoFontFamily, monospace)';
    workflowTextarea.style.fontSize = '0.85em';
    workflowTextarea.placeholder = '请输入 API 格式文生图 Workflow JSON，或使用上方工具栏导入与选择工作流...';
    workflowTextarea.value = settings.workflowJson ?? '';
    const saveWorkflow = () => {
        const val = workflowTextarea.value.trim();
        if (val === (loadSettings().workflowJson ?? '')) return;
        patchSettings({ workflowJson: val });
        notifyChange();
    };
    workflowTextarea.addEventListener('change', saveWorkflow);
    workflowTextarea.addEventListener('blur', saveWorkflow);

    const toolbarC5 = bindPresetToolbar({
        category: 'workflow',
        getCurrentData: () => ({ json: workflowTextarea.value.trim() || loadSettings().workflowJson || '' }),
        applyData: (id) => applyProfileData('workflow', id),
        onRefresh: () => refreshTab(),
    });
    cardC5.appendChild(toolbarC5);

    const openBlueprintBtn = document.createElement('button');
    openBlueprintBtn.className = 'da-btn secondary';
    openBlueprintBtn.innerHTML = '<i class="fa-solid fa-sitemap" style="margin-right:4px;"></i>蓝图编辑器';
    openBlueprintBtn.addEventListener('click', () => {
        const jsonStr = workflowTextarea.value.trim();
        openBlueprintModal(jsonStr, (updatedStr) => {
            workflowTextarea.value = updatedStr;
            patchSettings({ workflowJson: updatedStr });
            notifyChange();
            refreshTab();
        }, 'txt2img');
    });

    cardC5.appendChild(createFieldRow({
        label: '文生图 API 工作流 JSON',
        headerAction: openBlueprintBtn,
        helpTooltip: 'ComfyUI 开启 Dev Mode 导出的 API 格式文生图工作流 JSON。可点击右上角按钮打开可视化蓝图。',
        control: workflowTextarea,
        isBlock: true,
    }));

    container.appendChild(cardC5);

    // ── C6: 局部重绘 (Inpaint) 工作流预设 ────────────────────────────────────
    const cardC6 = document.createElement('div');
    cardC6.className = 'da-section-card';

    const headerC6 = document.createElement('div');
    headerC6.className = 'da-section-header';
    headerC6.innerHTML = `
        <span class="da-section-title">局部重绘工作流预设</span>
        <span class="da-section-desc">配置用于图像局部抠图、修补与重绘的 API Format Workflow JSON</span>
    `;
    cardC6.appendChild(headerC6);

    const inpaintTextarea = document.createElement('textarea');
    inpaintTextarea.className = 'da-textarea';
    inpaintTextarea.style.width = '100%';
    inpaintTextarea.style.height = '120px';
    inpaintTextarea.style.fontFamily = 'var(--monoFontFamily, monospace)';
    inpaintTextarea.style.fontSize = '0.85em';
    inpaintTextarea.placeholder = '请输入 API 格式局部重绘 Workflow JSON，或使用上方工具栏导入与选择工作流...';
    inpaintTextarea.value = settings.inpaintWorkflowJson ?? '';

    const saveInpaintWorkflow = () => {
        const val = inpaintTextarea.value.trim();
        if (val === (loadSettings().inpaintWorkflowJson ?? '')) return;
        patchSettings({ inpaintWorkflowJson: val });
        notifyChange();
    };
    inpaintTextarea.addEventListener('change', saveInpaintWorkflow);
    inpaintTextarea.addEventListener('blur', saveInpaintWorkflow);

    const toolbarC6 = bindPresetToolbar({
        category: 'inpaint',
        getCurrentData: () => ({ json: inpaintTextarea.value.trim() || loadSettings().inpaintWorkflowJson || '' }),
        applyData: (id) => applyProfileData('inpaint', id),
        onRefresh: () => refreshTab(),
    });
    cardC6.appendChild(toolbarC6);

    const openInpaintBlueprintBtn = document.createElement('button');
    openInpaintBlueprintBtn.className = 'da-btn secondary';
    openInpaintBlueprintBtn.innerHTML = '<i class="fa-solid fa-sitemap" style="margin-right:4px;"></i>蓝图编辑器';
    openInpaintBlueprintBtn.addEventListener('click', () => {
        const jsonStr = inpaintTextarea.value.trim();
        openBlueprintModal(jsonStr, (updatedStr) => {
            inpaintTextarea.value = updatedStr;
            patchSettings({ inpaintWorkflowJson: updatedStr });
            notifyChange();
            refreshTab();
        }, 'inpaint');
    });

    cardC6.appendChild(createFieldRow({
        label: '重绘 API 工作流 JSON',
        headerAction: openInpaintBlueprintBtn,
        helpTooltip: '用于 Mask 掩码抠图与 Inpaint 生成的 ComfyUI 工作流。可点击右上角按钮打开可视化蓝图。',
        control: inpaintTextarea,
        isBlock: true,
    }));

    container.appendChild(cardC6);

    syncFieldsRef.current = () => {
        const s = loadSettings();
        if (selectModelProfile && document.activeElement !== selectModelProfile) selectModelProfile.value = s.comfyModelProfileId ?? '';
        if (selectPromptProfile && document.activeElement !== selectPromptProfile) selectPromptProfile.value = s.comfyPromptProfileId ?? '';
        if (selectTxt2ImgWorkflow && document.activeElement !== selectTxt2ImgWorkflow) selectTxt2ImgWorkflow.value = s.comfyTxt2ImgWorkflowId ?? '';
        if (selectInpaintWorkflow && document.activeElement !== selectInpaintWorkflow) selectInpaintWorkflow.value = s.comfyInpaintWorkflowId ?? '';

        if (modelSelect && document.activeElement !== modelSelect && s.ckptName) modelSelect.value = s.ckptName;
        if (clipSelect && document.activeElement !== clipSelect && s.clipName !== undefined) clipSelect.value = s.clipName;
        if (vaeSelect && document.activeElement !== vaeSelect && s.vaeName !== undefined) vaeSelect.value = s.vaeName;
        if (samplerSelect && document.activeElement !== samplerSelect && s.samplerName) samplerSelect.value = s.samplerName;
        if (schedulerSelect && document.activeElement !== schedulerSelect && s.scheduler) schedulerSelect.value = s.scheduler;

        if (widthInput && document.activeElement !== widthInput) widthInput.value = String(s.width ?? 1024);
        if (heightInput && document.activeElement !== heightInput) heightInput.value = String(s.height ?? 1344);
        if (stepsInput && document.activeElement !== stepsInput) stepsInput.value = String(s.steps ?? 18);
        if (cfgInput && document.activeElement !== cfgInput) cfgInput.value = String(s.cfgScale ?? 6.0);

        if (ckptPosTextarea && document.activeElement !== ckptPosTextarea) ckptPosTextarea.value = s.checkpointPositivePrefix ?? '';
        if (ckptNegTextarea && document.activeElement !== ckptNegTextarea) ckptNegTextarea.value = s.checkpointNegativePrefix ?? '';

        if (denoiseInput && document.activeElement !== denoiseInput) denoiseInput.value = String(s.inpaintDenoise ?? 0.75);
        if (blurInput && document.activeElement !== blurInput) blurInput.value = String(s.inpaintMaskBlur ?? 8);
        if (growInput && document.activeElement !== growInput) growInput.value = String(s.inpaintGrowMask ?? 6);

        if (posPrefixTextarea && document.activeElement !== posPrefixTextarea) posPrefixTextarea.value = s.promptPrefix ?? '';
        if (posSuffixTextarea && document.activeElement !== posSuffixTextarea) posSuffixTextarea.value = s.promptSuffix ?? '';
        if (negTextarea && document.activeElement !== negTextarea) negTextarea.value = s.negativePrefix ?? '';

        if (workflowTextarea && document.activeElement !== workflowTextarea) workflowTextarea.value = s.workflowJson ?? '';
        if (inpaintTextarea && document.activeElement !== inpaintTextarea) inpaintTextarea.value = s.inpaintWorkflowJson ?? '';
    };

    updateToolbarsRef.current = () => {
        const s = loadSettings();
        const models = getEffectiveList('model');
        const prompts = getEffectiveList('prompt');
        const txt2imgWorkflows = getEffectiveList('workflow');
        const inpaintWorkflows = getEffectiveList('inpaint');

        if (toolbarC3.refreshPresets) {
            toolbarC3.refreshPresets(models, s.comfyModelProfileId ?? '');
        }
        if (toolbarC4.refreshPresets) {
            toolbarC4.refreshPresets(prompts, s.comfyPromptProfileId ?? '');
        }
        if (toolbarC5.refreshPresets) {
            toolbarC5.refreshPresets(txt2imgWorkflows, s.comfyTxt2ImgWorkflowId ?? '');
        }
        if (toolbarC6.refreshPresets) {
            toolbarC6.refreshPresets(inpaintWorkflows, s.comfyInpaintWorkflowId ?? '');
        }
    };

    // ── 5. 响应式 Store 订阅与 IDisposable 清理契约 ───────────────────────────
    const unsubscribeStore = settingsStore.subscribe(() => {
        syncFormWithStore();
    });

    (container as HTMLElement & { dispose?: () => void }).dispose = () => {
        unsubscribeStore();
        FeedbackService.unregisterUnsavedProvider('comfyui');
    };

    return container;
}
