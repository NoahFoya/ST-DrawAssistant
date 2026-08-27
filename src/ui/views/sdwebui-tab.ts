/**
 * @module ui/views/sdwebui-tab
 * @description Stable Diffusion WebUI (A1111) 专属配置面板视图 (包含服务连通性、采样参数与高清修复设置)
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings } from '../../core/state/store-types';
import { ControlFactory, createFieldRow } from '../components/controls';
import { bindPresetToolbar } from '../components/preset-toolbar';
import { FeedbackService } from '../feedback-service';
import { IDisposable } from '../../core/foundation/disposable';

/**
 * 构建并渲染 SD-WebUI 后端引擎配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的 SD-WebUI 配置面板 DOM 根节点
 */
export function createSdWebUITabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable {
    const controls = new ControlFactory();
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-sdwebui-tab';

    const settings = store.getState();

    // ── S1: API 服务连接 ───────────────────────────────────────────────────
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'da-input da-control-fixed-180';
    urlInput.style.flex = '1';
    urlInput.value = settings.sdWebUrl ?? 'http://127.0.0.1:7860';
    urlInput.addEventListener('change', () => {
        const val = urlInput.value.trim();
        if (val) store.set('sdWebUrl', val);
    });

    const testBtn = document.createElement('button');
    testBtn.className = 'da-btn secondary';
    testBtn.style.width = '100px';
    testBtn.style.flexShrink = '0';
    testBtn.textContent = '测试连接';

    const modelSelect = document.createElement('select');
    modelSelect.className = 'da-select da-control-fixed-180';
    const samplerSelect = document.createElement('select');
    samplerSelect.className = 'da-select da-control-fixed-180';

    const populateSelect = (selectEl: HTMLSelectElement, list: string[] = [], currentVal = '') => {
        selectEl.innerHTML = '';
        list.forEach((item) => {
            const opt = document.createElement('option');
            opt.value = item;
            opt.textContent = item;
            if (item === currentVal) opt.selected = true;
            selectEl.appendChild(opt);
        });
    };

    populateSelect(modelSelect, settings.cachedModels, settings.sdModelCheckpoint);
    populateSelect(samplerSelect, settings.cachedSamplers, settings.sdSamplerName);

    testBtn.onclick = async () => {
        testBtn.disabled = true;
        testBtn.textContent = '连接中...';
        const base = (store.get('sdWebUrl') || 'http://127.0.0.1:7860').replace(/\/+$/, '');
        try {
            const resModels = await fetch(`${base}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(6000) });
            const resSamplers = await fetch(`${base}/sdapi/v1/samplers`, { signal: AbortSignal.timeout(6000) });

            if (resModels.ok && resSamplers.ok) {
                const modelsData = await resModels.json();
                const samplersData = await resSamplers.json();

                const models = (modelsData || []).map((m: any) => m.title || m.model_name);
                const samplers = (samplersData || []).map((s: any) => s.name);

                store.set('cachedModels', models);
                store.set('cachedSamplers', samplers);

                populateSelect(modelSelect, models, store.get('sdModelCheckpoint') || '');
                populateSelect(samplerSelect, samplers, store.get('sdSamplerName') || '');

                FeedbackService.toast(`🟢 SD-WebUI 连接成功！已拉取：${models.length} 个模型、${samplers.length} 个采样算法。`);
            } else {
                throw new Error('服务返回状态异常');
            }
        } catch (err: any) {
            FeedbackService.toast(`🔴 SD-WebUI 连接失败: ${err.message || '网络连接异常'}`, true);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '测试连接';
        }
    };

    const cardS1 = controls.createCard(
        'API 服务连接',
        (body) => {
            body.appendChild(
                createFieldRow({
                    label: 'SD-WebUI API 服务地址',
                    helpTooltip: 'Stable Diffusion WebUI (AUTOMATIC1111) API 服务根地址 (例如 http://127.0.0.1:7860)。',
                    control: [urlInput, testBtn]
                })
            );
        },
        '配置 SD-WebUI HTTP 接口地址，测试连通性并自动拉取后端全量模型与采样器列表'
    );

    // ── S2: 模型与采样参数配置 ────────────────────────────────────────────────
    const cardS2 = controls.createCard(
        '模型与采样参数配置',
        (body) => {
            const toolbar = bindPresetToolbar({
                adapter: {
                    label: 'SD方案',
                    getProfiles: () => (store.get('sdProfiles') || []).map((p: any) => ({ id: p.id, name: p.name, data: p.data })),
                    getInitialId: () => store.get('sdProfileId') || '',
                    createProfile: (name, data: any) => {
                        const id = `sd_${Date.now()}`;
                        const current = store.get('sdProfiles') || [];
                        store.set('sdProfiles', [...current, { id, name, data }]);
                        store.set('sdProfileId', id);
                        return id;
                    },
                    saveProfile: (id, data: any) => {
                        const current = store.get('sdProfiles') || [];
                        store.set(
                            'sdProfiles',
                            current.map((p: any) => (p.id === id ? { ...p, data } : p))
                        );
                    },
                    renameProfile: (id, newName) => {
                        const current = store.get('sdProfiles') || [];
                        store.set(
                            'sdProfiles',
                            current.map((p: any) => (p.id === id ? { ...p, name: newName } : p))
                        );
                    },
                    deleteProfile: (id) => {
                        const current = store.get('sdProfiles') || [];
                        store.set(
                            'sdProfiles',
                            current.filter((p: any) => p.id !== id)
                        );
                        store.set('sdProfileId', '');
                        return '';
                    },
                    resetToDefault: () => {
                        store.set('sdProfiles', []);
                        store.set('sdProfileId', '');
                    }
                },
                getCurrentData: () => ({
                    sdModelCheckpoint: store.get('sdModelCheckpoint'),
                    sdSamplerName: store.get('sdSamplerName'),
                    width: store.get('width'),
                    height: store.get('height'),
                    steps: store.get('steps'),
                    cfgScale: store.get('cfgScale'),
                    sdClipSkip: store.get('sdClipSkip')
                }),
                applyData: (id) => {
                    const profile = (store.get('sdProfiles') || []).find((p: any) => p.id === id);
                    if (profile?.data) {
                        const d = profile.data;
                        if (d.sdModelCheckpoint) store.set('sdModelCheckpoint', d.sdModelCheckpoint);
                        if (d.sdSamplerName) store.set('sdSamplerName', d.sdSamplerName);
                        if (d.width) store.set('width', d.width);
                        if (d.height) store.set('height', d.height);
                        if (d.steps) store.set('steps', d.steps);
                        if (d.cfgScale) store.set('cfgScale', d.cfgScale);
                        if (d.sdClipSkip) store.set('sdClipSkip', d.sdClipSkip);
                    }
                },
                onRefresh: () => {}
            });
            body.appendChild(toolbar);

            modelSelect.addEventListener('change', () => store.set('sdModelCheckpoint', modelSelect.value));
            body.appendChild(
                createFieldRow({
                    label: '主模型 (Checkpoint)',
                    control: modelSelect
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '生图宽度 (Width, px)',
                    min: 256,
                    max: 2048,
                    step: 64,
                    value: settings.width ?? 512,
                    onChange: (val: number) => store.set('width', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '生图高度 (Height, px)',
                    min: 256,
                    max: 2048,
                    step: 64,
                    value: settings.height ?? 768,
                    onChange: (val: number) => store.set('height', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '采样步数 (Steps)',
                    min: 1,
                    max: 100,
                    step: 1,
                    value: settings.steps ?? 20,
                    onChange: (val: number) => store.set('steps', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '提示词引导系数 (CFG Scale)',
                    min: 1.0,
                    max: 30.0,
                    step: 0.5,
                    value: settings.cfgScale ?? 7.0,
                    onChange: (val: number) => store.set('cfgScale', val)
                })
            );

            samplerSelect.addEventListener('change', () => store.set('sdSamplerName', samplerSelect.value));
            body.appendChild(
                createFieldRow({
                    label: '采样器 (Sampler)',
                    control: samplerSelect
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: 'CLIP Skip (跳层)',
                    min: 1,
                    max: 12,
                    step: 1,
                    value: settings.sdClipSkip ?? 2,
                    onChange: (val: number) => store.set('sdClipSkip', val)
                })
            );
        },
        '配置主模型 Checkpoint、生图分辨率、采样步数、CFG 系数与 CLIP Skip 跳层'
    );

    // ── S3: 提示词模板与通用增强 ─────────────────────────────────────────────
    const cardS3 = controls.createCard(
        '提示词模板与通用增强',
        (body) => {
            body.appendChild(
                controls.createInput({
                    label: '正向提示词模板',
                    type: 'textarea',
                    value: settings.promptTemplate ?? '{prompt}',
                    onChange: (val: string) => store.set('promptTemplate', val)
                })
            );

            body.appendChild(
                controls.createInput({
                    label: '负向提示词模板',
                    type: 'textarea',
                    value: settings.negativePromptTemplate ?? 'lowres, bad anatomy, bad hands',
                    onChange: (val: string) => store.set('negativePromptTemplate', val)
                })
            );
        },
        '配置默认的正反向提示词模板、高画质通用前缀与全局宏变量展开'
    );

    // ── S4: 局部重绘与高清修复 (Inpaint & Hires.Fix) ───────────────────────────
    const cardS4 = controls.createCard(
        '局部重绘与高清修复',
        (body) => {
            body.appendChild(
                controls.createSlider({
                    label: '重绘幅度 (Denoising Strength)',
                    min: 0.0,
                    max: 1.0,
                    step: 0.05,
                    value: settings.inpaintDenoise ?? 0.7,
                    onChange: (val: number) => store.set('inpaintDenoise', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '蒙版模糊 (Mask Blur, px)',
                    min: 0,
                    max: 64,
                    step: 2,
                    value: settings.inpaintMaskBlur ?? 4,
                    onChange: (val: number) => store.set('inpaintMaskBlur', val)
                })
            );

            body.appendChild(
                controls.createToggle({
                    label: '启用高清修复 (Hires.fix)',
                    helpTooltip: '在 txt2img 流程中先以低分辨率生成潜在空间图像，再通过高阶放大算法进行二次细化。',
                    value: settings.sdEnableHires ?? false,
                    onChange: (val: boolean) => store.set('sdEnableHires', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '高清修复放大倍数 (Upscale By)',
                    min: 1.0,
                    max: 4.0,
                    step: 0.25,
                    value: settings.sdHiresUpscaleBy ?? 2.0,
                    onChange: (val: number) => store.set('sdHiresUpscaleBy', val)
                })
            );
        },
        '配置 Inpaint 局部重绘重绘幅度、蒙版羽化以及 txt2img 二阶段高清修复 (Hires.fix) 参数'
    );

    container.appendChild(cardS1);
    container.appendChild(cardS2);
    container.appendChild(cardS3);
    container.appendChild(cardS4);

    container.dispose = () => {
        // 资源清理
    };

    return container;
}

export const createSDWebUITabView = createSdWebUITabView;
