/**
 * @module ui/tabs/comfyui-tab
 * @description ComfyUI 生图引擎配置 Tab 组件
 *
 * 职责：
 * - Card 1: API 服务连接与连通性测试 (单行，弹出气泡反馈，自动拉取后端模型与 Lora)
 * - Card 2: 全局方案预设 (模型/提示词/文生图/重绘工作流关联)
 * - Card 3: 模型与生图参数方案 (绘图模型/CLIP/VAE/采样器/调度器/尺寸/步数/CFG/模型专用正负向词)
 * - Card 4: 提示词与 Lora 方案 (正向前缀/正向后缀/负向词/Lora下拉+权重+添加按钮+已加列表)
 * - Card 5: 文生图工作流预设 (预设工具栏/蓝图编辑器/API JSON)
 * - Card 6: 局部重绘工作流预设 (预设工具栏/蓝图编辑器/API JSON)
 *
 * 规范参考：
 * - .agents/Skills/comfyui-api-reference/SKILL.md (ComfyUI 后端 API 规范)
 */

import { createFieldRow } from '../components/field-row';
import { renderPresetToolbar } from '../components/preset-toolbar';
import { openBlueprintModal } from '../components/blueprint-modal';
import { loadSettings, updateSettings } from '../../settings/manager';
import { createDriver } from '../../drivers/factory';
import { logger } from '../../core/logger';
import type {
    DrawAssistantSettings,
    ModelProfileData,
    PromptProfileData,
    GlobalProfileData,
    LoraItem,
} from '../../settings/types';
import { escapeHtmlAttr } from '../../utils/html';

/** 辅助通知工具：优先触发 ST toastr，无 toastr 时控制台与气泡日志降级 */
function showToastNotice(message: string, title = 'ComfyUI 连接测试', isSuccess = true): void {
    const win = window as unknown as { toastr?: { success?: (m: string, t?: string) => void; error?: (m: string, t?: string) => void; info?: (m: string, t?: string) => void } };
    if (win.toastr) {
        if (isSuccess && typeof win.toastr.success === 'function') {
            win.toastr.success(message, title);
            return;
        }
        if (!isSuccess && typeof win.toastr.error === 'function') {
            win.toastr.error(message, title);
            return;
        }
    }
    logger.info(`[${title}] ${message}`);
}

/**
 * 激活应用指定的模型参数方案数据至全局配置
 *
 * @param id 模型方案唯一 ID
 */
function applyModelProfile(id: string): void {
    const settings = loadSettings();
    const profiles = settings.comfyModelProfiles ?? [];
    const item = profiles.find(p => p.id === id);
    const patch: Partial<DrawAssistantSettings> = { comfyModelProfileId: id };
    if (item && item.data) {
        const d = item.data;
        if (d.ckptName !== undefined) patch.ckptName = d.ckptName;
        if (d.clipName !== undefined) patch.clipName = d.clipName;
        if (d.vaeName !== undefined) patch.vaeName = d.vaeName;
        if (d.width !== undefined) patch.width = d.width;
        if (d.height !== undefined) patch.height = d.height;
        if (d.steps !== undefined) patch.steps = d.steps;
        if (d.cfgScale !== undefined) patch.cfgScale = d.cfgScale;
        if (d.samplerName !== undefined) patch.samplerName = d.samplerName;
        if (d.scheduler !== undefined) patch.scheduler = d.scheduler;
        if (d.checkpointPositivePrefix !== undefined) patch.checkpointPositivePrefix = d.checkpointPositivePrefix;
        if (d.checkpointNegativePrefix !== undefined) patch.checkpointNegativePrefix = d.checkpointNegativePrefix;
    }
    updateSettings(patch);
}

function applyPromptProfile(id: string): void {
    const settings = loadSettings();
    const profiles = settings.comfyPromptProfiles ?? [];
    const item = profiles.find(p => p.id === id);
    const patch: Partial<DrawAssistantSettings> = { comfyPromptProfileId: id };
    if (item && item.data) {
        const d = item.data;
        if (d.promptPrefix !== undefined) patch.promptPrefix = d.promptPrefix;
        if (d.negativePrefix !== undefined) patch.negativePrefix = d.negativePrefix;
        if (d.promptSuffix !== undefined) patch.promptSuffix = d.promptSuffix;
        if (d.loras !== undefined) patch.loras = d.loras;
    }
    updateSettings(patch);
}

function applyWorkflowProfile(id: string, target: 'txt2img' | 'inpaint' = 'txt2img'): void {
    const settings = loadSettings();
    const profiles = settings.comfyWorkflows ?? [];
    const item = profiles.find(p => p.id === id);
    const patch: Partial<DrawAssistantSettings> = target === 'txt2img'
        ? { comfyTxt2ImgWorkflowId: id }
        : { comfyInpaintWorkflowId: id };
    if (item && item.data && item.data.json !== undefined) {
        if (target === 'txt2img') patch.workflowJson = item.data.json;
        else patch.inpaintWorkflowJson = item.data.json;
    }
    updateSettings(patch);
}

function applyGlobalProfile(id: string): void {
    const settings = loadSettings();
    const profiles = settings.globalProfiles ?? [];
    const item = profiles.find(p => p.id === id);
    const patch: Partial<DrawAssistantSettings> = { globalProfileId: id };
    if (item && item.data) {
        const d = item.data;
        if (d.modelProfileId) patch.comfyModelProfileId = d.modelProfileId;
        if (d.promptProfileId) patch.comfyPromptProfileId = d.promptProfileId;
        if (d.txt2imgWorkflowId) patch.comfyTxt2ImgWorkflowId = d.txt2imgWorkflowId;
        if (d.inpaintWorkflowId) patch.comfyInpaintWorkflowId = d.inpaintWorkflowId;
        updateSettings(patch);

        if (d.modelProfileId) applyModelProfile(d.modelProfileId);
        if (d.promptProfileId) applyPromptProfile(d.promptProfileId);
        if (d.txt2imgWorkflowId) applyWorkflowProfile(d.txt2imgWorkflowId, 'txt2img');
        if (d.inpaintWorkflowId) applyWorkflowProfile(d.inpaintWorkflowId, 'inpaint');
    } else {
        updateSettings(patch);
    }
}

export function renderComfyUITab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-comfyui-tab';

    const settings = loadSettings();

    // 顶部改动提示气泡
    const hintCard = document.createElement('div');
    hintCard.className = 'da-change-hint-badge';
    hintCard.style.display = 'none';
    hintCard.style.marginBottom = '12px';
    hintCard.style.padding = '8px 14px';
    hintCard.style.borderRadius = '8px';
    hintCard.style.background = 'rgba(0, 242, 254, 0.1)';
    hintCard.style.border = '1px solid rgba(0, 242, 254, 0.25)';
    hintCard.style.color = '#00f2fe';
    hintCard.style.fontSize = '0.85em';
    hintCard.style.fontWeight = '500';
    hintCard.style.transition = 'opacity 0.2s ease';
    hintCard.innerHTML = '<span>配置已即时自动保存并生效</span>';
    container.appendChild(hintCard);

    let changeHintTimer: number | null = null;
    const notifyChange = () => {
        hintCard.style.display = 'block';
        hintCard.style.opacity = '1';
        if (changeHintTimer) clearTimeout(changeHintTimer);
        changeHintTimer = window.setTimeout(() => {
            hintCard.style.opacity = '0';
            setTimeout(() => { hintCard.style.display = 'none'; }, 200);
        }, 2200);
    };

    const createSpan = (text: string) => {
        const s = document.createElement('span');
        s.textContent = text;
        return s;
    };

    const refreshTab = () => {
        const parent = container.parentElement;
        if (parent) {
            parent.innerHTML = '';
            parent.appendChild(renderComfyUITab());
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
            updateSettings({ serverUrl: val });
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

                // 统一更新 Checkpoint/UNet 模型列表
                if (models.length > 0) {
                    modelSelect.innerHTML = models.map(m => `<option value="${escapeHtmlAttr(m)}" ${m === activeSettings.ckptName ? 'selected' : ''}>${escapeHtmlAttr(m)}</option>`).join('');
                    if (!activeSettings.ckptName && models[0]) {
                        updateSettings({ ckptName: models[0] });
                    }
                }

                // 更新 CLIP
                if (clips.length > 0) {
                    clipSelect.innerHTML = `<option value="">(保持默认/未选择)</option>` + clips.map(c => `<option value="${escapeHtmlAttr(c)}" ${c === activeSettings.clipName ? 'selected' : ''}>${escapeHtmlAttr(c)}</option>`).join('');
                }

                // 更新 VAE
                if (vaes.length > 0) {
                    vaeSelect.innerHTML = `<option value="">(保持默认/未选择)</option>` + vaes.map(v => `<option value="${escapeHtmlAttr(v)}" ${v === activeSettings.vaeName ? 'selected' : ''}>${escapeHtmlAttr(v)}</option>`).join('');
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

                showToastNotice(`🟢 服务连接成功 (延迟 ${res.latencyMs ?? 0}ms)\n已成功自动更新：${models.length} 个绘图模型、${loras.length} 个 Lora、${samplers.length} 个采样算法方案。`, 'ComfyUI 连接测试成功', true);
            } else {
                showToastNotice(`🔴 服务连接失败: ${res.error ?? '无法访问后端服务'}`, 'ComfyUI 连接失败', false);
            }
        } catch (e) {
            showToastNotice(`🔴 连接发生异常: ${e instanceof Error ? e.message : String(e)}`, 'ComfyUI 连接异常', false);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '测试连接';
        }
    });

    cardC1.appendChild(createFieldRow({
        label: 'ComfyUI API 服务地址',
        helpTooltip: '部署 ComfyUI 的 HTTP 根地址。默认 http://127.0.0.1:8188',
        control: [urlInput, testBtn],
    }));

    container.appendChild(cardC1);

    // ── C2: 全局方案预设 ───────────────────────────────────────────────────
    const cardC2 = document.createElement('div');
    cardC2.className = 'da-section-card';

    const headerC2 = document.createElement('div');
    headerC2.className = 'da-section-header';
    headerC2.innerHTML = `
        <span class="da-section-title">全局方案预设</span>
        <span class="da-section-desc">快捷管理与一键切换全局组合方案（联动模型、提示词、文生图工作流与重绘工作流）</span>
    `;
    cardC2.appendChild(headerC2);

    const globalProfiles = settings.globalProfiles ?? [];
    const currentGlobalId = settings.globalProfileId ?? 'wai_global_default';

    const toolbarC2 = renderPresetToolbar({
        defaultName: 'Wai Illustrious 官方默认组合方案',
        profiles: globalProfiles,
        currentId: currentGlobalId,
        onSelect: (id) => {
            applyGlobalProfile(id);
            notifyChange();
            refreshTab();
        },
        onNew: () => {
            const name = prompt('请输入新全局方案名称:', '我的画风专属预设包');
            if (!name) return;
            const newId = `global_${Date.now()}`;
            const activeSettings = loadSettings();
            const currentData = {
                modelProfileId: activeSettings.comfyModelProfileId,
                promptProfileId: activeSettings.comfyPromptProfileId,
                txt2imgWorkflowId: activeSettings.comfyTxt2ImgWorkflowId,
                inpaintWorkflowId: activeSettings.comfyInpaintWorkflowId,
            };
            const newProfiles = [...globalProfiles, { id: newId, name: name.trim(), data: currentData }];
            updateSettings({ globalProfiles: newProfiles, globalProfileId: newId });
            notifyChange();
            refreshTab();
        },
        onSave: () => {
            const activeSettings = loadSettings();
            const updatedProfiles = [...globalProfiles];
            const existingIdx = updatedProfiles.findIndex(p => p.id === currentGlobalId);
            const currentData = {
                modelProfileId: activeSettings.comfyModelProfileId,
                promptProfileId: activeSettings.comfyPromptProfileId,
                txt2imgWorkflowId: activeSettings.comfyTxt2ImgWorkflowId,
                inpaintWorkflowId: activeSettings.comfyInpaintWorkflowId,
            };
            if (existingIdx >= 0) {
                updatedProfiles[existingIdx].data = currentData;
            } else {
                updatedProfiles.push({ id: currentGlobalId, name: '全局方案预设', data: currentData });
            }
            updateSettings({ globalProfiles: updatedProfiles });
            notifyChange();
            showToastNotice('全局方案预设已成功保存！', '全局方案预设', true);
        },
        onRename: () => {
            const item = globalProfiles.find(p => p.id === currentGlobalId);
            const newName = prompt('请输入新的全局方案名称:', item?.name || '全局方案预设');
            if (!newName) return;
            if (item) {
                item.name = newName.trim();
            } else {
                globalProfiles.push({ id: currentGlobalId, name: newName.trim(), data: {} });
            }
            updateSettings({ globalProfiles: globalProfiles });
            notifyChange();
            refreshTab();
        },
        onImport: (content, fileName) => {
            try {
                const parsed = JSON.parse(content) as GlobalProfileData;
                const newId = `global_${Date.now()}`;
                const profileName = fileName.replace(/\.json$/i, '');
                const newProfiles = [...globalProfiles, { id: newId, name: profileName, data: parsed }];
                updateSettings({ globalProfiles: newProfiles });
                applyGlobalProfile(newId);
                notifyChange();
                refreshTab();
                showToastNotice(`成功导入全局组合方案 [${profileName}]！`, '全局方案导入', true);
            } catch (err) {
                logger.error('全局方案 JSON 文件解析失败', err);
                showToastNotice('全局方案 JSON 文件解析失败！', '全局方案导入', false);
            }
        },
        onExport: () => {
            const item = globalProfiles.find(p => p.id === currentGlobalId);
            const activeSettings = loadSettings();
            const exportData = item && Object.keys(item.data).length > 0 ? item.data : {
                modelProfileId: activeSettings.comfyModelProfileId,
                promptProfileId: activeSettings.comfyPromptProfileId,
                txt2imgWorkflowId: activeSettings.comfyTxt2ImgWorkflowId,
                inpaintWorkflowId: activeSettings.comfyInpaintWorkflowId,
            };
            const jsonStr = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-da-global-profile-${currentGlobalId}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        onDelete: () => {
            if (!confirm('确定删除当前选中的全局组合方案吗？')) return;
            const updated = globalProfiles.filter(p => p.id !== currentGlobalId);
            const nextId = updated[0]?.id || 'wai_global_default';
            updateSettings({ globalProfiles: updated, globalProfileId: nextId });
            notifyChange();
            refreshTab();
        },
    });
    cardC2.appendChild(toolbarC2);

    // 关联：模型参数方案 (单独成行)
    const selectModelProfile = document.createElement('select');
    selectModelProfile.className = 'da-select';
    selectModelProfile.style.width = '100%';
    selectModelProfile.style.maxWidth = '360px';
    selectModelProfile.innerHTML = `<option value="">(未关联/自定义)</option>`;
    (settings.comfyModelProfiles ?? []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        selectModelProfile.appendChild(opt);
    });
    selectModelProfile.value = settings.comfyModelProfileId ?? '';
    selectModelProfile.addEventListener('change', () => {
        const val = selectModelProfile.value;
        updateSettings({ comfyModelProfileId: val });
        if (val) applyModelProfile(val);
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '模型参数方案关联',
        helpTooltip: '指定全局方案关联的底层模型、采样步数与 CFG 参数预设。',
        control: selectModelProfile,
    }));

    // 关联：提示词方案 (单独成行)
    const selectPromptProfile = document.createElement('select');
    selectPromptProfile.className = 'da-select';
    selectPromptProfile.style.width = '100%';
    selectPromptProfile.style.maxWidth = '360px';
    selectPromptProfile.innerHTML = `<option value="">(未关联/自定义)</option>`;
    (settings.comfyPromptProfiles ?? []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        selectPromptProfile.appendChild(opt);
    });
    selectPromptProfile.value = settings.comfyPromptProfileId ?? '';
    selectPromptProfile.addEventListener('change', () => {
        const val = selectPromptProfile.value;
        updateSettings({ comfyPromptProfileId: val });
        if (val) applyPromptProfile(val);
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '提示词方案关联',
        helpTooltip: '指定全局方案关联的正负向词及 Lora 追加预设。',
        control: selectPromptProfile,
    }));

    // 关联：文生图工作流方案 (单独成行)
    const selectTxt2ImgWorkflow = document.createElement('select');
    selectTxt2ImgWorkflow.className = 'da-select';
    selectTxt2ImgWorkflow.style.width = '100%';
    selectTxt2ImgWorkflow.style.maxWidth = '360px';
    selectTxt2ImgWorkflow.innerHTML = `<option value="">(未关联/自定义)</option>`;
    (settings.comfyWorkflows ?? []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        selectTxt2ImgWorkflow.appendChild(opt);
    });
    selectTxt2ImgWorkflow.value = settings.comfyTxt2ImgWorkflowId ?? '';
    selectTxt2ImgWorkflow.addEventListener('change', () => {
        const val = selectTxt2ImgWorkflow.value;
        updateSettings({ comfyTxt2ImgWorkflowId: val });
        if (val) applyWorkflowProfile(val, 'txt2img');
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '文生图工作流关联',
        helpTooltip: '指定用于常规文本生成图像的标准 ComfyUI 工作流。',
        control: selectTxt2ImgWorkflow,
    }));

    // 关联：重绘工作流方案 (单独成行)
    const selectInpaintWorkflow = document.createElement('select');
    selectInpaintWorkflow.className = 'da-select';
    selectInpaintWorkflow.style.width = '100%';
    selectInpaintWorkflow.style.maxWidth = '360px';
    selectInpaintWorkflow.innerHTML = `<option value="">(未关联/自定义)</option>`;
    (settings.comfyWorkflows ?? []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        selectInpaintWorkflow.appendChild(opt);
    });
    selectInpaintWorkflow.value = settings.comfyInpaintWorkflowId ?? '';
    selectInpaintWorkflow.addEventListener('change', () => {
        const val = selectInpaintWorkflow.value;
        updateSettings({ comfyInpaintWorkflowId: val });
        if (val) applyWorkflowProfile(val, 'inpaint');
        notifyChange();
        refreshTab();
    });

    cardC2.appendChild(createFieldRow({
        label: '局部重绘工作流关联',
        helpTooltip: '指定用于图像局部修补与重绘的 Inpainting 工作流。',
        control: selectInpaintWorkflow,
    }));

    container.appendChild(cardC2);

    // ── C3: 模型与生图参数方案 (全单行，含模型专用提示词) ────────────────────
    const cardC3 = document.createElement('div');
    cardC3.className = 'da-section-card';

    const headerC3 = document.createElement('div');
    headerC3.className = 'da-section-header';
    headerC3.innerHTML = `
        <span class="da-section-title">模型与生图参数方案</span>
        <span class="da-section-desc">管理 Checkpoint/UNet 合并模型、CLIP/VAE 驱动、尺寸步数、CFG 及模型契合专用正负向提示词</span>
    `;
    cardC3.appendChild(headerC3);

    const modelProfiles = settings.comfyModelProfiles ?? [];
    const currentModelId = settings.comfyModelProfileId ?? 'default';

    const toolbarC3 = renderPresetToolbar({
        defaultName: 'Wai Illustrious SDXL 默认模型预设',
        profiles: modelProfiles,
        currentId: currentModelId,
        onSelect: (id) => {
            applyModelProfile(id);
            notifyChange();
            refreshTab();
        },
        onNew: () => {
            const name = prompt('请输入新模型参数预设名称:', '我的专用模型方案');
            if (!name) return;
            const newId = `model_${Date.now()}`;
            const activeSettings = loadSettings();
            const currentData: ModelProfileData = {
                ckptName: activeSettings.ckptName,
                clipName: activeSettings.clipName,
                vaeName: activeSettings.vaeName,
                width: activeSettings.width,
                height: activeSettings.height,
                steps: activeSettings.steps,
                cfgScale: activeSettings.cfgScale,
                samplerName: activeSettings.samplerName,
                scheduler: activeSettings.scheduler,
                checkpointPositivePrefix: activeSettings.checkpointPositivePrefix,
                checkpointNegativePrefix: activeSettings.checkpointNegativePrefix,
            };
            const newProfiles = [...modelProfiles, { id: newId, name: name.trim(), data: currentData }];
            updateSettings({ comfyModelProfiles: newProfiles, comfyModelProfileId: newId });
            notifyChange();
            refreshTab();
        },
        onSave: () => {
            const activeSettings = loadSettings();
            const updatedProfiles = [...modelProfiles];
            const existingIdx = updatedProfiles.findIndex(p => p.id === currentModelId);
            const currentData: ModelProfileData = {
                ckptName: activeSettings.ckptName,
                clipName: activeSettings.clipName,
                vaeName: activeSettings.vaeName,
                width: activeSettings.width,
                height: activeSettings.height,
                steps: activeSettings.steps,
                cfgScale: activeSettings.cfgScale,
                samplerName: activeSettings.samplerName,
                scheduler: activeSettings.scheduler,
                checkpointPositivePrefix: activeSettings.checkpointPositivePrefix,
                checkpointNegativePrefix: activeSettings.checkpointNegativePrefix,
            };
            if (existingIdx >= 0) {
                updatedProfiles[existingIdx].data = currentData;
            } else {
                updatedProfiles.push({ id: currentModelId, name: '模型参数方案', data: currentData });
            }
            updateSettings({ comfyModelProfiles: updatedProfiles });
            notifyChange();
            showToastNotice('当前模型参数预设已成功保存！', '模型参数方案', true);
        },
        onRename: () => {
            const item = modelProfiles.find(p => p.id === currentModelId);
            const newName = prompt('请输入新的预设名称:', item?.name || '模型参数方案');
            if (!newName) return;
            if (item) {
                item.name = newName.trim();
            } else {
                modelProfiles.push({ id: currentModelId, name: newName.trim(), data: {} });
            }
            updateSettings({ comfyModelProfiles: modelProfiles });
            notifyChange();
            refreshTab();
        },
        onImport: (content, fileName) => {
            try {
                const parsed = JSON.parse(content) as ModelProfileData;
                const newId = `model_${Date.now()}`;
                const profileName = fileName.replace(/\.json$/i, '');
                const newProfiles = [...modelProfiles, { id: newId, name: profileName, data: parsed }];
                updateSettings({ comfyModelProfiles: newProfiles });
                applyModelProfile(newId);
                notifyChange();
                refreshTab();
                showToastNotice(`成功导入模型方案 [${profileName}]！`, '模型方案导入', true);
            } catch (err) {
                logger.error('模型方案 JSON 文件解析失败', err);
                showToastNotice('JSON 文件解析失败！', '模型方案导入', false);
            }
        },
        onExport: () => {
            const item = modelProfiles.find(p => p.id === currentModelId);
            const activeSettings = loadSettings();
            const exportData = item && Object.keys(item.data).length > 0 ? item.data : {
                ckptName: activeSettings.ckptName,
                clipName: activeSettings.clipName,
                vaeName: activeSettings.vaeName,
                width: activeSettings.width,
                height: activeSettings.height,
                steps: activeSettings.steps,
                cfgScale: activeSettings.cfgScale,
                samplerName: activeSettings.samplerName,
                scheduler: activeSettings.scheduler,
                checkpointPositivePrefix: activeSettings.checkpointPositivePrefix,
                checkpointNegativePrefix: activeSettings.checkpointNegativePrefix,
            };
            const jsonStr = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `comfy-model-profile-${currentModelId}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        onDelete: () => {
            if (!confirm('确定删除当前选中的模型参数预设吗？')) return;
            const updated = modelProfiles.filter(p => p.id !== currentModelId);
            const nextId = updated[0]?.id || 'default';
            updateSettings({ comfyModelProfiles: updated, comfyModelProfileId: nextId });
            notifyChange();
            refreshTab();
        },
    });
    cardC3.appendChild(toolbarC3);

    // 3.1 绘图模型 选择框 (简写为绘图模型，单独成行)
    modelSelect.className = 'da-select';
    modelSelect.style.width = '100%';
    modelSelect.style.maxWidth = '380px';
    if (settings.ckptName) {
        modelSelect.innerHTML = `<option value="${escapeHtmlAttr(settings.ckptName)}">${escapeHtmlAttr(settings.ckptName)}</option>`;
    } else {
        modelSelect.innerHTML = `<option value="">(请点击上文"测试连接"自动拉取模型)</option>`;
    }
    modelSelect.addEventListener('change', () => {
        updateSettings({ ckptName: modelSelect.value });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: '绘图模型',
        helpTooltip: '从 ComfyUI 后端包含 CheckpointLoaderSimple, UNETLoader, DiffusionModelLoader 等合并的所有可用模型。',
        control: modelSelect,
    }));

    // 3.2 CLIP 选择框 (单独成行)
    clipSelect.className = 'da-select';
    clipSelect.style.width = '100%';
    clipSelect.style.maxWidth = '380px';
    if (settings.clipName) {
        clipSelect.innerHTML = `<option value="${escapeHtmlAttr(settings.clipName)}">${escapeHtmlAttr(settings.clipName)}</option>`;
    } else {
        clipSelect.innerHTML = `<option value="">(保持默认/未选择)</option>`;
    }
    clipSelect.addEventListener('change', () => {
        updateSettings({ clipName: clipSelect.value });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: 'CLIP 驱动模型',
        helpTooltip: '独立选定的 CLIP 文本解析器模型（保持空白则使用 Workflow 默认值）。',
        control: clipSelect,
    }));

    // 3.3 VAE 选择框 (单独成行)
    vaeSelect.className = 'da-select';
    vaeSelect.style.width = '100%';
    vaeSelect.style.maxWidth = '380px';
    if (settings.vaeName) {
        vaeSelect.innerHTML = `<option value="${escapeHtmlAttr(settings.vaeName)}">${escapeHtmlAttr(settings.vaeName)}</option>`;
    } else {
        vaeSelect.innerHTML = `<option value="">(保持默认/未选择)</option>`;
    }
    vaeSelect.addEventListener('change', () => {
        updateSettings({ vaeName: vaeSelect.value });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: 'VAE 解码模型',
        helpTooltip: '独立选定的 VAE 解码器模型（保持空白则使用 Workflow 默认值）。',
        control: vaeSelect,
    }));

    // 3.4 采样器 (Sampler) 选择框 (单独成行)
    samplerSelect.className = 'da-select';
    samplerSelect.style.width = '100%';
    samplerSelect.style.maxWidth = '260px';
    samplerSelect.innerHTML = `
        <option value="euler_ancestral">euler_ancestral</option>
        <option value="euler">euler</option>
        <option value="dpmpp_2m">dpmpp_2m</option>
        <option value="dpmpp_sde">dpmpp_sde</option>
        <option value="ddim">ddim</option>
        <option value="uni_pc">uni_pc</option>
    `;
    samplerSelect.value = settings.samplerName ?? 'euler_ancestral';
    samplerSelect.addEventListener('change', () => {
        updateSettings({ samplerName: samplerSelect.value });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: '采样算法 (Sampler)',
        helpTooltip: 'KSampler 生成降噪算法名称。',
        control: samplerSelect,
    }));

    // 3.5 调度器 (Scheduler) 选择框 (单独成行)
    schedulerSelect.className = 'da-select';
    schedulerSelect.style.width = '100%';
    schedulerSelect.style.maxWidth = '260px';
    schedulerSelect.innerHTML = `
        <option value="normal">normal</option>
        <option value="karras">karras</option>
        <option value="exponential">exponential</option>
        <option value="sgm_uniform">sgm_uniform</option>
    `;
    schedulerSelect.value = settings.scheduler ?? 'normal';
    schedulerSelect.addEventListener('change', () => {
        updateSettings({ scheduler: schedulerSelect.value });
        notifyChange();
    });

    cardC3.appendChild(createFieldRow({
        label: '调度器 (Scheduler)',
        helpTooltip: 'KSampler 步长变化调度方案。',
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
            widthInput.value = String(w);
            heightInput.value = String(h);
            updateSettings({ width: w, height: h });
            notifyChange();
        }
    });

    cardC3.appendChild(createFieldRow({
        label: '分辨率尺寸预设',
        helpTooltip: '快捷选择常用标准宽高比例。',
        control: resPresetSelect,
    }));

    // 3.7 生成宽度 (单独成行)
    const saveWidth = () => {
        const val = parseInt(widthInput.value, 10);
        if (val > 0) {
            updateSettings({ width: val });
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
            updateSettings({ height: val });
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
            updateSettings({ steps: val });
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
            updateSettings({ cfgScale: val });
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
        updateSettings({ checkpointPositivePrefix: ckptPosTextarea.value.trim() });
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
        updateSettings({ checkpointNegativePrefix: ckptNegTextarea.value.trim() });
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

    const promptProfiles = settings.comfyPromptProfiles ?? [];
    const currentPromptId = settings.comfyPromptProfileId ?? 'default';

    const toolbarC4 = renderPresetToolbar({
        defaultName: '内置通用提示词方案',
        profiles: promptProfiles,
        currentId: currentPromptId,
        onSelect: (id) => {
            applyPromptProfile(id);
            notifyChange();
            refreshTab();
        },
        onNew: () => {
            const name = prompt('请输入新提示词预设名称:', '我的画风词库');
            if (!name) return;
            const newId = `prompt_${Date.now()}`;
            const activeSettings = loadSettings();
            const currentData: PromptProfileData = {
                promptPrefix: activeSettings.promptPrefix,
                negativePrefix: activeSettings.negativePrefix,
                promptSuffix: activeSettings.promptSuffix,
                loras: activeSettings.loras,
            };
            const newProfiles = [...promptProfiles, { id: newId, name: name.trim(), data: currentData }];
            updateSettings({ comfyPromptProfiles: newProfiles, comfyPromptProfileId: newId });
            notifyChange();
            refreshTab();
        },
        onSave: () => {
            const activeSettings = loadSettings();
            const updatedProfiles = [...promptProfiles];
            const existingIdx = updatedProfiles.findIndex(p => p.id === currentPromptId);
            const currentData: PromptProfileData = {
                promptPrefix: activeSettings.promptPrefix,
                negativePrefix: activeSettings.negativePrefix,
                promptSuffix: activeSettings.promptSuffix,
                loras: activeSettings.loras,
            };
            if (existingIdx >= 0) {
                updatedProfiles[existingIdx].data = currentData;
            } else {
                updatedProfiles.push({ id: currentPromptId, name: '提示词方案', data: currentData });
            }
            updateSettings({ comfyPromptProfiles: updatedProfiles });
            notifyChange();
            showToastNotice('当前提示词预设已成功保存！', '提示词方案', true);
        },
        onRename: () => {
            const item = promptProfiles.find(p => p.id === currentPromptId);
            const newName = prompt('请输入新的预设名称:', item?.name || '提示词方案');
            if (!newName) return;
            if (item) {
                item.name = newName.trim();
            } else {
                promptProfiles.push({ id: currentPromptId, name: newName.trim(), data: {} });
            }
            updateSettings({ comfyPromptProfiles: promptProfiles });
            notifyChange();
            refreshTab();
        },
        onImport: (content, fileName) => {
            try {
                const parsed = JSON.parse(content) as PromptProfileData;
                const newId = `prompt_${Date.now()}`;
                const profileName = fileName.replace(/\.json$/i, '');
                const newProfiles = [...promptProfiles, { id: newId, name: profileName, data: parsed }];
                updateSettings({ comfyPromptProfiles: newProfiles });
                applyPromptProfile(newId);
                notifyChange();
                refreshTab();
                showToastNotice(`成功导入提示词方案 [${profileName}]！`, '提示词方案导入', true);
            } catch (err) {
                logger.error('提示词方案 JSON 文件解析失败', err);
                showToastNotice('JSON 文件解析失败！', '提示词方案导入', false);
            }
        },
        onExport: () => {
            const item = promptProfiles.find(p => p.id === currentPromptId);
            const activeSettings = loadSettings();
            const exportData = item && Object.keys(item.data).length > 0 ? item.data : {
                promptPrefix: activeSettings.promptPrefix,
                negativePrefix: activeSettings.negativePrefix,
                promptSuffix: activeSettings.promptSuffix,
                loras: activeSettings.loras,
            };
            const jsonStr = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `comfy-prompt-profile-${currentPromptId}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        onDelete: () => {
            if (!confirm('确定删除当前选中的提示词预设吗？')) return;
            const updated = promptProfiles.filter(p => p.id !== currentPromptId);
            const nextId = updated[0]?.id || 'default';
            updateSettings({ comfyPromptProfiles: updated, comfyPromptProfileId: nextId });
            notifyChange();
            refreshTab();
        },
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
        updateSettings({ promptPrefix: posPrefixTextarea.value.trim() });
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
        updateSettings({ promptSuffix: posSuffixTextarea.value.trim() });
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
        updateSettings({ negativePrefix: negTextarea.value.trim() });
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

    // 4.4 Lora 动态选择与权重追加 (单独成行)
    loraAddSelect.className = 'da-select';
    loraAddSelect.style.width = '100%';
    loraAddSelect.style.maxWidth = '240px';
    loraAddSelect.innerHTML = `<option value="">(选择 Lora 模型)</option>`;

    const loraWeightInput = document.createElement('input');
    loraWeightInput.type = 'number';
    loraWeightInput.className = 'da-input';
    loraWeightInput.style.width = '70px';
    loraWeightInput.step = '0.1';
    loraWeightInput.value = '1.0';

    const addLoraBtn = document.createElement('button');
    addLoraBtn.className = 'da-btn secondary';
    addLoraBtn.textContent = '添加 Lora';

    const loraContainer = document.createElement('div');
    loraContainer.className = 'da-lora-list-container';
    loraContainer.style.display = 'flex';
    loraContainer.style.flexWrap = 'wrap';
    loraContainer.style.gap = '6px';
    loraContainer.style.marginTop = '8px';
    loraContainer.style.width = '100%';

    const currentLoras: LoraItem[] = settings.loras ?? [];

    const renderLoraList = () => {
        loraContainer.innerHTML = '';
        if (currentLoras.length === 0) {
            const emptySpan = document.createElement('span');
            emptySpan.style.color = 'var(--da-text-secondary)';
            emptySpan.style.fontSize = '0.85em';
            emptySpan.textContent = '暂未添加追加 Lora';
            loraContainer.appendChild(emptySpan);
            return;
        }

        currentLoras.forEach((item, idx) => {
            const tag = document.createElement('div');
            tag.style.display = 'inline-flex';
            tag.style.alignItems = 'center';
            tag.style.gap = '6px';
            tag.style.padding = '4px 10px';
            tag.style.borderRadius = '14px';
            tag.style.background = 'rgba(255,255,255,0.06)';
            tag.style.border = '1px solid var(--da-border-color)';
            tag.style.fontSize = '0.82em';

            const nameSpan = document.createElement('span');
            nameSpan.style.color = 'var(--da-text-primary)';
            nameSpan.textContent = item.name;

            const weightSpan = document.createElement('span');
            weightSpan.style.color = '#00f2fe';
            weightSpan.textContent = `(权重: ${item.weight})`;

            const delBtn = document.createElement('button');
            delBtn.style.background = 'none';
            delBtn.style.border = 'none';
            delBtn.style.color = '#ff5f56';
            delBtn.style.cursor = 'pointer';
            delBtn.style.padding = '0 2px';
            delBtn.style.fontSize = '1.1em';
            delBtn.style.lineHeight = '1';
            delBtn.title = '删除此 Lora';
            delBtn.textContent = '×';

            delBtn.addEventListener('click', () => {
                currentLoras.splice(idx, 1);
                updateSettings({ loras: [...currentLoras] });
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

    addLoraBtn.addEventListener('click', () => {
        const loraName = loraAddSelect.value.trim();
        if (!loraName) {
            showToastNotice('请先选择要添加的 Lora 模型！', 'Lora 选择提醒', false);
            return;
        }
        const w = parseFloat(loraWeightInput.value) || 1.0;
        currentLoras.push({ name: loraName, weight: w });
        updateSettings({ loras: [...currentLoras] });
        notifyChange();
        renderLoraList();
    });

    cardC4.appendChild(createFieldRow({
        label: 'Lora 选择与权重追加',
        helpTooltip: '选择 Lora 并指定权重强度，点击按钮添加至下方动态关联列表。',
        control: [loraAddSelect, createSpan(' 权重: '), loraWeightInput, addLoraBtn],
    }));

    cardC4.appendChild(createFieldRow({
        label: '已添加 Lora 列表',
        helpTooltip: '当前提示词方案中生效的追加 Lora 集合。',
        control: loraContainer,
        isBlock: true,
    }));

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

    const workflows = settings.comfyWorkflows ?? [];
    const currentWorkflowId = settings.comfyWorkflowProfileId ?? 'wai_txt2img_default';

    const workflowTextarea = document.createElement('textarea');
    workflowTextarea.className = 'da-textarea';
    workflowTextarea.style.width = '100%';
    workflowTextarea.style.height = '120px';
    workflowTextarea.style.fontFamily = 'var(--monoFontFamily, monospace)';
    workflowTextarea.style.fontSize = '0.85em';
    workflowTextarea.placeholder = '留空自动使用默认 Wai SDXL 工作流...';
    workflowTextarea.value = settings.workflowJson ?? '';
    const saveWorkflow = () => {
        updateSettings({ workflowJson: workflowTextarea.value.trim() });
        notifyChange();
    };
    workflowTextarea.addEventListener('change', saveWorkflow);
    workflowTextarea.addEventListener('blur', saveWorkflow);

    const toolbarC5 = renderPresetToolbar({
        defaultName: 'Wai 官方标准文生图工作流',
        profiles: workflows,
        currentId: currentWorkflowId,
        onSelect: (id) => {
            applyWorkflowProfile(id);
            notifyChange();
            refreshTab();
        },
        onNew: () => {
            const name = prompt('请输入新工作流预设名称:', '我的自定义 Workflow');
            if (!name) return;
            const newId = `wf_${Date.now()}`;
            const activeSettings = loadSettings();
            const currentJson = workflowTextarea.value.trim() || activeSettings.workflowJson || '';
            const newProfiles = [...workflows, { id: newId, name: name.trim(), data: { json: currentJson } }];
            updateSettings({ comfyWorkflows: newProfiles, comfyWorkflowProfileId: newId, workflowJson: currentJson });
            notifyChange();
            refreshTab();
        },
        onSave: () => {
            const activeSettings = loadSettings();
            const val = workflowTextarea.value.trim() || activeSettings.workflowJson || '';
            const updated = [...workflows];
            const existingIdx = updated.findIndex(p => p.id === currentWorkflowId);
            if (existingIdx >= 0) {
                updated[existingIdx].data = { json: val };
            } else {
                updated.push({ id: currentWorkflowId, name: '工作流预设', data: { json: val } });
            }
            updateSettings({ comfyWorkflows: updated, workflowJson: val });
            notifyChange();
            showToastNotice('工作流预设已成功保存！', '工作流方案', true);
        },
        onRename: () => {
            const item = workflows.find(p => p.id === currentWorkflowId);
            const newName = prompt('请输入新的预设名称:', item?.name || '工作流预设');
            if (!newName) return;
            if (item) {
                item.name = newName.trim();
            } else {
                workflows.push({ id: currentWorkflowId, name: newName.trim(), data: {} });
            }
            updateSettings({ comfyWorkflows: workflows });
            notifyChange();
            refreshTab();
        },
        onImport: (content, fileName) => {
            try {
                JSON.parse(content);
                const newId = `wf_${Date.now()}`;
                const profileName = fileName.replace(/\.json$/i, '');
                const newProfiles = [...workflows, { id: newId, name: profileName, data: { json: content } }];
                updateSettings({ comfyWorkflows: newProfiles, comfyWorkflowProfileId: newId, workflowJson: content });
                notifyChange();
                refreshTab();
                showToastNotice(`成功导入工作流方案 [${profileName}]！`, '工作流导入', true);
            } catch (err) {
                logger.error('工作流 JSON 导入解析失败', err);
                showToastNotice('Workflow JSON 语法错误，导入失败！', '工作流导入', false);
            }
        },
        onExport: () => {
            const item = workflows.find(p => p.id === currentWorkflowId);
            const activeSettings = loadSettings();
            const jsonStr = item?.data?.json || activeSettings.workflowJson || '{}';
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `comfy-workflow-${currentWorkflowId}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        onDelete: () => {
            if (!confirm('确定删除当前工作流预设吗？')) return;
            const updated = workflows.filter(p => p.id !== currentWorkflowId);
            const nextId = updated[0]?.id || 'wai_txt2img_default';
            updateSettings({ comfyWorkflows: updated, comfyWorkflowProfileId: nextId });
            notifyChange();
            refreshTab();
        },
    });
    cardC5.appendChild(toolbarC5);

    const openBlueprintBtn = document.createElement('button');
    openBlueprintBtn.className = 'da-btn primary';
    openBlueprintBtn.style.width = '160px';
    openBlueprintBtn.textContent = '打开蓝图编辑器';
    openBlueprintBtn.addEventListener('click', () => {
        const jsonStr = workflowTextarea.value.trim();
        openBlueprintModal(jsonStr, (updatedStr) => {
            workflowTextarea.value = updatedStr;
            updateSettings({ workflowJson: updatedStr });
            notifyChange();
            refreshTab();
        });
    });

    cardC5.appendChild(createFieldRow({
        label: '蓝图可视化编辑器',
        helpTooltip: '平滑弹出蓝图卡片图层，查看与绑定节点参数变量。',
        control: openBlueprintBtn,
    }));

    cardC5.appendChild(createFieldRow({
        label: '文生图 API 工作流 JSON',
        helpTooltip: 'ComfyUI 开启 Dev Mode 导出的 API 格式文生图工作流 JSON。',
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

    const inpaintWorkflowId = settings.comfyInpaintWorkflowId ?? 'wai_inpaint_default';

    const inpaintTextarea = document.createElement('textarea');
    inpaintTextarea.className = 'da-textarea';
    inpaintTextarea.style.width = '100%';
    inpaintTextarea.style.height = '120px';
    inpaintTextarea.style.fontFamily = 'var(--monoFontFamily, monospace)';
    inpaintTextarea.style.fontSize = '0.85em';
    inpaintTextarea.placeholder = '留空自动使用默认 Wai 局部重绘工作流...';
    inpaintTextarea.value = settings.inpaintWorkflowJson ?? '';

    const saveInpaintWorkflow = () => {
        updateSettings({ inpaintWorkflowJson: inpaintTextarea.value.trim() });
        notifyChange();
    };
    inpaintTextarea.addEventListener('change', saveInpaintWorkflow);
    inpaintTextarea.addEventListener('blur', saveInpaintWorkflow);

    // C6 补全遗漏的重绘工作流预设工具栏
    const toolbarC6 = renderPresetToolbar({
        defaultName: 'Wai 官方标准重绘工作流',
        profiles: workflows,
        currentId: inpaintWorkflowId,
        onSelect: (id) => {
            applyWorkflowProfile(id, 'inpaint');
            notifyChange();
            refreshTab();
        },
        onNew: () => {
            const name = prompt('请输入新重绘工作流预设名称:', '我的 Inpaint Workflow');
            if (!name) return;
            const newId = `wf_inpaint_${Date.now()}`;
            const activeSettings = loadSettings();
            const currentJson = inpaintTextarea.value.trim() || activeSettings.inpaintWorkflowJson || '';
            const newProfiles = [...workflows, { id: newId, name: name.trim(), data: { json: currentJson } }];
            updateSettings({ comfyWorkflows: newProfiles, comfyInpaintWorkflowId: newId, inpaintWorkflowJson: currentJson });
            notifyChange();
            refreshTab();
        },
        onSave: () => {
            const activeSettings = loadSettings();
            const val = inpaintTextarea.value.trim() || activeSettings.inpaintWorkflowJson || '';
            const updated = [...workflows];
            const existingIdx = updated.findIndex(p => p.id === inpaintWorkflowId);
            if (existingIdx >= 0) {
                updated[existingIdx].data = { json: val };
            } else {
                updated.push({ id: inpaintWorkflowId, name: '重绘工作流预设', data: { json: val } });
            }
            updateSettings({ comfyWorkflows: updated, inpaintWorkflowJson: val });
            notifyChange();
            showToastNotice('重绘工作流预设已成功保存！', '重绘工作流方案', true);
        },
        onRename: () => {
            const item = workflows.find(p => p.id === inpaintWorkflowId);
            const newName = prompt('请输入新的预设名称:', item?.name || '重绘工作流预设');
            if (!newName) return;
            if (item) {
                item.name = newName.trim();
            } else {
                workflows.push({ id: inpaintWorkflowId, name: newName.trim(), data: {} });
            }
            updateSettings({ comfyWorkflows: workflows });
            notifyChange();
            refreshTab();
        },
        onImport: (content, fileName) => {
            try {
                JSON.parse(content);
                const newId = `wf_inpaint_${Date.now()}`;
                const profileName = fileName.replace(/\.json$/i, '');
                const newProfiles = [...workflows, { id: newId, name: profileName, data: { json: content } }];
                updateSettings({ comfyWorkflows: newProfiles, comfyInpaintWorkflowId: newId, inpaintWorkflowJson: content });
                notifyChange();
                refreshTab();
                showToastNotice(`成功导入重绘工作流方案 [${profileName}]！`, '重绘工作流导入', true);
            } catch (err) {
                logger.error('重绘工作流 JSON 导入解析失败', err);
                showToastNotice('Workflow JSON 语法错误，导入失败！', '重绘工作流导入', false);
            }
        },
        onExport: () => {
            const item = workflows.find(p => p.id === inpaintWorkflowId);
            const activeSettings = loadSettings();
            const jsonStr = item?.data?.json || activeSettings.inpaintWorkflowJson || '{}';
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `comfy-inpaint-workflow-${inpaintWorkflowId}.json`;
            a.click();
            URL.revokeObjectURL(url);
        },
        onDelete: () => {
            if (!confirm('确定删除当前重绘工作流预设吗？')) return;
            const updated = workflows.filter(p => p.id !== inpaintWorkflowId);
            const nextId = updated[0]?.id || 'wai_inpaint_default';
            updateSettings({ comfyWorkflows: updated, comfyInpaintWorkflowId: nextId });
            notifyChange();
            refreshTab();
        },
    });
    cardC6.appendChild(toolbarC6);

    const openInpaintBlueprintBtn = document.createElement('button');
    openInpaintBlueprintBtn.className = 'da-btn primary';
    openInpaintBlueprintBtn.style.width = '160px';
    openInpaintBlueprintBtn.textContent = '打开蓝图编辑器';
    openInpaintBlueprintBtn.addEventListener('click', () => {
        const jsonStr = inpaintTextarea.value.trim();
        openBlueprintModal(jsonStr, (updatedStr) => {
            inpaintTextarea.value = updatedStr;
            updateSettings({ inpaintWorkflowJson: updatedStr });
            notifyChange();
            refreshTab();
        });
    });

    cardC6.appendChild(createFieldRow({
        label: '蓝图可视化编辑器',
        helpTooltip: '平滑弹出局部重绘蓝图图层，编辑节点属性与变量绑定。',
        control: openInpaintBlueprintBtn,
    }));

    cardC6.appendChild(createFieldRow({
        label: '重绘 API 工作流 JSON',
        helpTooltip: '用于 Mask 掩码抠图与 Inpaint 生成的 ComfyUI 工作流。',
        control: inpaintTextarea,
        isBlock: true,
    }));

    container.appendChild(cardC6);

    return container;
}
