/**
 * @module ui/views/comfyui-tab
 * @description ComfyUI 专属配置面板视图 (包含服务器连接、模型/采样器选择、工作流管理与注入节点映射)
 */

import { ObservableStore } from '../../core/state/store';
import { DrawAssistantSettings, LoraItem } from '../../core/state/store-types';
import { ControlFactory, createFieldRow } from '../components/controls';
import { bindPresetToolbar } from '../components/preset-toolbar';
import { openBlueprintModal } from '../components/blueprint-modal';
import { FeedbackService } from '../feedback-service';
import { IDisposable } from '../../core/foundation/disposable';

/**
 * 构建并渲染 ComfyUI 后端引擎配置面板
 *
 * @param store 全局响应式状态配置中心实例
 * @returns 包含生命周期清理能力的 ComfyUI 配置面板 DOM 根节点
 */
export function createComfyUITabView(store: ObservableStore<DrawAssistantSettings>): HTMLElement & IDisposable {
    const controls = new ControlFactory();
    const container = document.createElement('div') as unknown as HTMLElement & IDisposable;
    container.className = 'da-tab-pane da-comfyui-tab';

    const settings = store.getState();

    // ── C1: API 服务连接 ───────────────────────────────────────────────────
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'da-input da-control-fixed-180';
    urlInput.style.flex = '1';
    urlInput.value = settings.serverUrl ?? 'http://127.0.0.1:8188';
    urlInput.addEventListener('change', () => {
        const val = urlInput.value.trim();
        if (val) store.set('serverUrl', val);
    });

    const testBtn = document.createElement('button');
    testBtn.className = 'da-btn secondary';
    testBtn.style.width = '100px';
    testBtn.style.flexShrink = '0';
    testBtn.textContent = '测试连接';

    // 预声明各模型选择框引用
    const modelSelect = document.createElement('select');
    modelSelect.className = 'da-select da-control-fixed-180';
    const clipSelect = document.createElement('select');
    clipSelect.className = 'da-select da-control-fixed-180';
    const vaeSelect = document.createElement('select');
    vaeSelect.className = 'da-select da-control-fixed-180';
    const samplerSelect = document.createElement('select');
    samplerSelect.className = 'da-select da-control-fixed-180';
    const schedulerSelect = document.createElement('select');
    schedulerSelect.className = 'da-select da-control-fixed-180';
    const loraAddSelect = document.createElement('select');
    loraAddSelect.className = 'da-select da-control-fixed-180';

    const populateSelect = (selectEl: HTMLSelectElement, list: string[] = [], currentVal = '', emptyLabel = '未选择') => {
        selectEl.innerHTML = '';
        if (emptyLabel) {
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = emptyLabel;
            if (!currentVal) emptyOpt.selected = true;
            selectEl.appendChild(emptyOpt);
        }
        list.forEach((item) => {
            const opt = document.createElement('option');
            opt.value = item;
            opt.textContent = item;
            if (item === currentVal) opt.selected = true;
            selectEl.appendChild(opt);
        });
    };

    populateSelect(modelSelect, settings.cachedModels, settings.ckptName, '未选择');
    populateSelect(clipSelect, settings.cachedClips, settings.clipName, '未选择');
    populateSelect(vaeSelect, settings.cachedVaes, settings.vaeName, '未选择');
    populateSelect(samplerSelect, settings.cachedSamplers, settings.samplerName, '未选择');
    populateSelect(schedulerSelect, settings.cachedSchedulers, settings.scheduler, '未选择');
    populateSelect(loraAddSelect, settings.cachedLoras, '', '(选择 Lora 模型)');

    testBtn.onclick = async () => {
        testBtn.disabled = true;
        testBtn.textContent = '连接中...';
        const base = (store.get('serverUrl') || 'http://127.0.0.1:8188').replace(/\/+$/, '');
        try {
            const resStats = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(5000) });
            if (!resStats.ok) throw new Error('ComfyUI 服务未响应');

            const resInfo = await fetch(`${base}/object_info`, { signal: AbortSignal.timeout(10000) });
            if (resInfo.ok) {
                const info = await resInfo.json();
                const models = info['CheckpointLoaderSimple']?.input?.required?.ckpt_name?.[0] || [];
                const clips = info['CLIPLoader']?.input?.required?.clip_name?.[0] || [];
                const vaes = info['VAELoader']?.input?.required?.vae_name?.[0] || [];
                const samplers = info['KSampler']?.input?.required?.sampler_name?.[0] || [];
                const schedulers = info['KSampler']?.input?.required?.scheduler?.[0] || [];
                const loras = info['LoraLoader']?.input?.required?.lora_name?.[0] || [];

                store.set('cachedModels', models);
                store.set('cachedClips', clips);
                store.set('cachedVaes', vaes);
                store.set('cachedSamplers', samplers);
                store.set('cachedSchedulers', schedulers);
                store.set('cachedLoras', loras);

                populateSelect(modelSelect, models, store.get('ckptName'), '未选择');
                populateSelect(clipSelect, clips, store.get('clipName'), '未选择');
                populateSelect(vaeSelect, vaes, store.get('vaeName'), '未选择');
                populateSelect(samplerSelect, samplers, store.get('samplerName'), '未选择');
                populateSelect(schedulerSelect, schedulers, store.get('scheduler'), '未选择');
                populateSelect(loraAddSelect, loras, '', '(选择 Lora 模型)');

                FeedbackService.toast(`🟢 ComfyUI 连接成功！已拉取：${models.length} 模型、${loras.length} LoRA、${samplers.length} 采样器`);
            }
        } catch (err: any) {
            FeedbackService.toast(`🔴 ComfyUI 连接失败: ${err.message || '网络无法连接'}`, true);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '测试连接';
        }
    };

    const cardC1 = controls.createCard(
        'API 服务连接',
        (body) => {
            const row = createFieldRow({
                label: 'ComfyUI API 服务地址',
                helpTooltip: 'ComfyUI 服务端根地址 (例如 http://127.0.0.1:8188)。',
                control: [urlInput, testBtn]
            });
            body.appendChild(row);
        },
        '配置 ComfyUI HTTP 服务根地址，测试连通性并自动拉取后端全量模型与 Lora 列表'
    );

    // ── C2: 局部方案快捷切换栏 ───────────────────────────────────────────────
    const cardC2 = controls.createCard(
        '局部方案快捷切换',
        (body) => {
            body.appendChild(
                controls.createSelect({
                    label: '模型参数方案',
                    helpTooltip: '顶部分步快捷切换底模、CLIP、VAE 解码器、分辨率及采样算法步数预设。',
                    value: settings.comfyModelProfileId ?? '',
                    items: [
                        { value: '', label: '(未关联/自定义)' },
                        ...(settings.comfyModelProfiles || []).map((p) => ({ value: p.id, label: p.name }))
                    ],
                    onChange: (val: string) => store.set('comfyModelProfileId', val)
                })
            );

            body.appendChild(
                controls.createSelect({
                    label: '提示词方案',
                    helpTooltip: '顶部分步快捷切换正负向词与 Lora 追加配置预设。',
                    value: settings.comfyPromptProfileId ?? '',
                    items: [
                        { value: '', label: '(未关联/自定义)' },
                        ...(settings.comfyPromptProfiles || []).map((p) => ({ value: p.id, label: p.name }))
                    ],
                    onChange: (val: string) => store.set('comfyPromptProfileId', val)
                })
            );

            body.appendChild(
                controls.createSelect({
                    label: '文生图工作流',
                    helpTooltip: '顶部分步快捷切换主渲染流程 API 工作流预设。',
                    value: settings.comfyTxt2ImgWorkflowId ?? '',
                    items: [
                        { value: '', label: '(未关联/自定义)' },
                        ...(settings.comfyTxt2ImgWorkflows || []).map((p) => ({ value: p.id, label: p.name }))
                    ],
                    onChange: (val: string) => store.set('comfyTxt2ImgWorkflowId', val)
                })
            );

            body.appendChild(
                controls.createSelect({
                    label: '局部重绘工作流',
                    helpTooltip: '顶部分步快捷切换 Inpaint 局部修图 API 工作流预设。',
                    value: settings.comfyInpaintWorkflowId ?? '',
                    items: [
                        { value: '', label: '(未关联/自定义)' },
                        ...(settings.comfyInpaintWorkflows || []).map((p) => ({ value: p.id, label: p.name }))
                    ],
                    onChange: (val: string) => store.set('comfyInpaintWorkflowId', val)
                })
            );
        },
        '在 ComfyUI 面板顶部直接快速切换并装载模型参数、提示词、文生图及局部重绘方案'
    );

    // ── C3: 模型与采样参数配置 ────────────────────────────────────────────────
    const cardC3 = controls.createCard(
        '模型与采样参数配置',
        (body) => {
            const toolbar = bindPresetToolbar({
                adapter: {
                    label: '模型参数',
                    getProfiles: () => (store.get('comfyModelProfiles') || []).map((p) => ({ id: p.id, name: p.name, data: p.data })),
                    getInitialId: () => store.get('comfyModelProfileId') || '',
                    createProfile: (name, data: any) => {
                        const id = `model_${Date.now()}`;
                        const current = store.get('comfyModelProfiles') || [];
                        store.set('comfyModelProfiles', [...current, { id, name, data }]);
                        store.set('comfyModelProfileId', id);
                        return id;
                    },
                    saveProfile: (id, data: any) => {
                        const current = store.get('comfyModelProfiles') || [];
                        store.set(
                            'comfyModelProfiles',
                            current.map((p) => (p.id === id ? { ...p, data } : p))
                        );
                    },
                    renameProfile: (id, newName) => {
                        const current = store.get('comfyModelProfiles') || [];
                        store.set(
                            'comfyModelProfiles',
                            current.map((p) => (p.id === id ? { ...p, name: newName } : p))
                        );
                    },
                    deleteProfile: (id) => {
                        const current = store.get('comfyModelProfiles') || [];
                        store.set(
                            'comfyModelProfiles',
                            current.filter((p) => p.id !== id)
                        );
                        store.set('comfyModelProfileId', '');
                        return '';
                    },
                    resetToDefault: () => {
                        store.set('comfyModelProfiles', []);
                        store.set('comfyModelProfileId', '');
                    }
                },
                getCurrentData: () => ({
                    ckptName: store.get('ckptName'),
                    clipName: store.get('clipName'),
                    vaeName: store.get('vaeName'),
                    width: store.get('width'),
                    height: store.get('height'),
                    steps: store.get('steps'),
                    cfgScale: store.get('cfgScale'),
                    samplerName: store.get('samplerName'),
                    scheduler: store.get('scheduler'),
                    checkpointPositivePrefix: store.get('checkpointPositivePrefix'),
                    checkpointNegativePrefix: store.get('checkpointNegativePrefix')
                }),
                applyData: (id) => {
                    const profile = (store.get('comfyModelProfiles') || []).find((p) => p.id === id);
                    if (profile?.data) {
                        const d = profile.data;
                        if (d.ckptName) store.set('ckptName', d.ckptName);
                        if (d.clipName) store.set('clipName', d.clipName);
                        if (d.vaeName) store.set('vaeName', d.vaeName);
                        if (d.width) store.set('width', d.width);
                        if (d.height) store.set('height', d.height);
                        if (d.steps) store.set('steps', d.steps);
                        if (d.cfgScale) store.set('cfgScale', d.cfgScale);
                        if (d.samplerName) store.set('samplerName', d.samplerName);
                        if (d.scheduler) store.set('scheduler', d.scheduler);
                    }
                },
                onRefresh: () => {}
            });
            body.appendChild(toolbar);

            // 主模型
            modelSelect.addEventListener('change', () => store.set('ckptName', modelSelect.value));
            body.appendChild(
                createFieldRow({
                    label: '主模型 (Checkpoint)',
                    helpTooltip: '从 ComfyUI 后端包含 CheckpointLoaderSimple, UNETLoader 等合并的所有可用模型。',
                    control: modelSelect
                })
            );

            // CLIP 编码器
            clipSelect.addEventListener('change', () => store.set('clipName', clipSelect.value));
            body.appendChild(
                createFieldRow({
                    label: 'CLIP 文本编码器',
                    helpTooltip: '独立 CLIP 文本编码器（如 clip-l, t5xxl 等）。未选择时使用 Checkpoint 自带的 CLIP。',
                    control: clipSelect
                })
            );

            // VAE 解码器
            vaeSelect.addEventListener('change', () => store.set('vaeName', vaeSelect.value));
            body.appendChild(
                createFieldRow({
                    label: 'VAE 解码器',
                    helpTooltip: '独立 VAE 图像解码器。未选择时使用 Checkpoint 自带的 VAE。',
                    control: vaeSelect
                })
            );

            // 宽度与高度
            body.appendChild(
                controls.createSlider({
                    label: '生图宽度 (Width, px)',
                    min: 256,
                    max: 2048,
                    step: 64,
                    value: settings.width ?? 1024,
                    onChange: (val: number) => store.set('width', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '生图高度 (Height, px)',
                    min: 256,
                    max: 2048,
                    step: 64,
                    value: settings.height ?? 1024,
                    onChange: (val: number) => store.set('height', val)
                })
            );

            // 步数与 CFG
            body.appendChild(
                controls.createSlider({
                    label: '采样步数 (Steps)',
                    min: 1,
                    max: 100,
                    step: 1,
                    value: settings.steps ?? 28,
                    onChange: (val: number) => store.set('steps', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '提示词引导系数 (CFG Scale)',
                    min: 1.0,
                    max: 20.0,
                    step: 0.5,
                    value: settings.cfgScale ?? 6.5,
                    onChange: (val: number) => store.set('cfgScale', val)
                })
            );

            // 采样器与调度器
            samplerSelect.addEventListener('change', () => store.set('samplerName', samplerSelect.value));
            body.appendChild(
                createFieldRow({
                    label: '采样器 (Sampler)',
                    control: samplerSelect
                })
            );

            schedulerSelect.addEventListener('change', () => store.set('scheduler', schedulerSelect.value));
            body.appendChild(
                createFieldRow({
                    label: '调度器 (Scheduler)',
                    control: schedulerSelect
                })
            );

            // 底模专属前缀
            body.appendChild(
                controls.createInput({
                    label: '底模专属正向提示词前缀',
                    placeholder: '例如: anime style, vibrant colors',
                    value: settings.checkpointPositivePrefix ?? '',
                    onChange: (val: string) => store.set('checkpointPositivePrefix', val)
                })
            );

            body.appendChild(
                controls.createInput({
                    label: '底模专属负向提示词前缀',
                    placeholder: '例如: realistic, photo, realistic skin',
                    value: settings.checkpointNegativePrefix ?? '',
                    onChange: (val: string) => store.set('checkpointNegativePrefix', val)
                })
            );
        },
        '配置底模 Checkpoint、文本编码器与 VAE 解码器，并设定分辨率与 KSampler 采样参数'
    );

    // ── C4: 提示词模板与 Lora 增强 ───────────────────────────────────────────
    const cardC4 = controls.createCard(
        '提示词模板与 Lora 增强',
        (body) => {
            const toolbar = bindPresetToolbar({
                adapter: {
                    label: '提示词',
                    getProfiles: () => (store.get('comfyPromptProfiles') || []).map((p) => ({ id: p.id, name: p.name, data: p.data })),
                    getInitialId: () => store.get('comfyPromptProfileId') || '',
                    createProfile: (name, data: any) => {
                        const id = `prompt_${Date.now()}`;
                        const current = store.get('comfyPromptProfiles') || [];
                        store.set('comfyPromptProfiles', [...current, { id, name, data }]);
                        store.set('comfyPromptProfileId', id);
                        return id;
                    },
                    saveProfile: (id, data: any) => {
                        const current = store.get('comfyPromptProfiles') || [];
                        store.set(
                            'comfyPromptProfiles',
                            current.map((p) => (p.id === id ? { ...p, data } : p))
                        );
                    },
                    renameProfile: (id, newName) => {
                        const current = store.get('comfyPromptProfiles') || [];
                        store.set(
                            'comfyPromptProfiles',
                            current.map((p) => (p.id === id ? { ...p, name: newName } : p))
                        );
                    },
                    deleteProfile: (id) => {
                        const current = store.get('comfyPromptProfiles') || [];
                        store.set(
                            'comfyPromptProfiles',
                            current.filter((p) => p.id !== id)
                        );
                        store.set('comfyPromptProfileId', '');
                        return '';
                    },
                    resetToDefault: () => {
                        store.set('comfyPromptProfiles', []);
                        store.set('comfyPromptProfileId', '');
                    }
                },
                getCurrentData: () => ({
                    promptPrefix: store.get('promptPrefix'),
                    negativePrefix: store.get('negativePrefix'),
                    promptSuffix: store.get('promptSuffix'),
                    loras: store.get('loras')
                }),
                applyData: (id) => {
                    const profile = (store.get('comfyPromptProfiles') || []).find((p) => p.id === id);
                    if (profile?.data) {
                        const d = profile.data;
                        if (d.promptPrefix) store.set('promptPrefix', d.promptPrefix);
                        if (d.negativePrefix) store.set('negativePrefix', d.negativePrefix);
                        if (d.promptSuffix) store.set('promptSuffix', d.promptSuffix);
                        if (d.loras) store.set('loras', d.loras);
                    }
                },
                onRefresh: () => {}
            });
            body.appendChild(toolbar);

            body.appendChild(
                controls.createInput({
                    label: '全局正向提示词前缀',
                    placeholder: '自动追加在正向提示词开头...',
                    value: settings.promptPrefix ?? '',
                    onChange: (val: string) => store.set('promptPrefix', val)
                })
            );

            body.appendChild(
                controls.createInput({
                    label: '全局负向提示词前缀',
                    placeholder: '自动追加在负向提示词开头...',
                    value: settings.negativePrefix ?? '',
                    onChange: (val: string) => store.set('negativePrefix', val)
                })
            );

            body.appendChild(
                controls.createInput({
                    label: '全局正向提示词后缀',
                    placeholder: '自动追加在正向提示词末尾...',
                    value: settings.promptSuffix ?? '',
                    onChange: (val: string) => store.set('promptSuffix', val)
                })
            );

            // LoRA 列表容器
            const loraListContainer = document.createElement('div');
            loraListContainer.style.marginTop = '12px';

            const renderLoras = () => {
                loraListContainer.innerHTML = '';
                const loras: LoraItem[] = store.get('loras') || [];
                loras.forEach((l, idx) => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.alignItems = 'center';
                    row.style.gap = '8px';
                    row.style.marginBottom = '6px';

                    const nameSpan = document.createElement('span');
                    nameSpan.style.flex = '1';
                    nameSpan.style.fontSize = '0.88em';
                    nameSpan.textContent = l.name;

                    const weightInput = document.createElement('input');
                    weightInput.type = 'number';
                    weightInput.className = 'da-input';
                    weightInput.style.width = '70px';
                    weightInput.step = '0.05';
                    weightInput.value = String(l.weight);
                    weightInput.onchange = () => {
                        const current = store.get('loras') || [];
                        const next = [...current];
                        if (next[idx]) {
                            next[idx].weight = parseFloat(weightInput.value) || 1.0;
                            store.set('loras', next);
                        }
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'da-btn danger';
                    delBtn.style.padding = '2px 8px';
                    delBtn.textContent = '✕';
                    delBtn.onclick = () => {
                        const next = (store.get('loras') || []).filter((_, i) => i !== idx);
                        store.set('loras', next);
                        renderLoras();
                    };

                    row.appendChild(nameSpan);
                    row.appendChild(weightInput);
                    row.appendChild(delBtn);
                    loraListContainer.appendChild(row);
                });
            };

            const addLoraRow = document.createElement('div');
            addLoraRow.style.display = 'flex';
            addLoraRow.style.gap = '8px';
            addLoraRow.style.marginTop = '8px';

            const addBtn = document.createElement('button');
            addBtn.className = 'da-btn secondary';
            addBtn.textContent = '+ 添加 LoRA';
            addBtn.onclick = () => {
                const name = loraAddSelect.value;
                if (!name) return;
                const current = store.get('loras') || [];
                store.set('loras', [...current, { name, weight: 1.0 }]);
                renderLoras();
            };

            addLoraRow.appendChild(loraAddSelect);
            addLoraRow.appendChild(addBtn);

            body.appendChild(
                createFieldRow({
                    label: '追加 LoRA 列表',
                    helpTooltip: '配置自动追加至生图提示词或 ComfyUI LoraLoader 的 LoRA 列表。',
                    control: addLoraRow
                })
            );

            body.appendChild(loraListContainer);
            renderLoras();
        },
        '配置正负向提示词模板、全局变量占位符与 LoRA 模型追加与权重调节'
    );

    // ── C5: 文生图工作流配置 ─────────────────────────────────────────────────
    const cardC5 = controls.createCard(
        '文生图工作流配置',
        (body) => {
            const blueprintBtn = document.createElement('button');
            blueprintBtn.className = 'da-btn primary';
            blueprintBtn.style.marginBottom = '12px';
            blueprintBtn.textContent = '🎨 查看与编辑工作流蓝图 (Blueprint)';
            blueprintBtn.onclick = () => {
                openBlueprintModal(JSON.stringify(store.get('workflowJson') || {}, null, 2), (updated) => {
                    try {
                        store.set('workflowJson', JSON.parse(updated));
                    } catch {}
                }, 'txt2img');
            };
            body.appendChild(blueprintBtn);

            // 节点插槽映射
            const injection = settings.workflowInjection || {
                positiveNodeId: '6',
                positiveField: 'text',
                negativeNodeId: '7',
                negativeField: 'text',
                widthNodeId: '5',
                widthField: 'width',
                heightNodeId: '5',
                heightField: 'height',
                kSamplerNodeId: '3',
                saveImageNodeId: '9'
            };

            const mappingGrid = document.createElement('div');
            mappingGrid.style.display = 'grid';
            mappingGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
            mappingGrid.style.gap = '8px';
            mappingGrid.style.marginBottom = '12px';

            const addMappingField = (label: string, key: keyof typeof injection, defVal: string) => {
                const row = createFieldRow({
                    label,
                    type: 'text',
                    value: (injection[key] as string) || defVal,
                    onChange: (val) => {
                        const cur = store.get('workflowInjection') || injection;
                        store.set('workflowInjection', { ...cur, [key]: String(val) });
                    }
                });
                mappingGrid.appendChild(row);
            };

            addMappingField('正向词节点 ID', 'positiveNodeId', '6');
            addMappingField('负向词节点 ID', 'negativeNodeId', '7');
            addMappingField('采样器节点 ID', 'kSamplerNodeId', '3');
            addMappingField('尺寸 Latent 节点 ID', 'widthNodeId', '5');
            addMappingField('图像输出节点 ID', 'saveImageNodeId', '9');

            body.appendChild(mappingGrid);

            const wfInput = controls.createInput({
                label: '文生图 API 工作流 JSON',
                type: 'textarea',
                value: JSON.stringify(settings.workflowJson || {}, null, 2),
                placeholder: '粘贴 ComfyUI Save (API Format) 导出的 JSON 工作流...',
                onChange: (val: string) => {
                    try {
                        const parsed = JSON.parse(val);
                        store.set('workflowJson', parsed);
                    } catch {}
                }
            });
            body.appendChild(wfInput);
        },
        '配置文生图主渲染流程的 ComfyUI API 格式工作流 JSON 与插槽节点映射'
    );

    // ── C6: 局部重绘工作流配置 ───────────────────────────────────────────────
    const cardC6 = controls.createCard(
        '局部重绘工作流配置',
        (body) => {
            body.appendChild(
                controls.createSlider({
                    label: '重绘重绘幅度 (Denoising Strength)',
                    min: 0.0,
                    max: 1.0,
                    step: 0.05,
                    value: settings.inpaintDenoise ?? 0.75,
                    onChange: (val: number) => store.set('inpaintDenoise', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '蒙版模糊像素 (Mask Blur, px)',
                    min: 0,
                    max: 64,
                    step: 2,
                    value: settings.inpaintMaskBlur ?? 4,
                    onChange: (val: number) => store.set('inpaintMaskBlur', val)
                })
            );

            body.appendChild(
                controls.createSlider({
                    label: '蒙版外扩膨胀 (Grow Mask, px)',
                    min: 0,
                    max: 32,
                    step: 1,
                    value: settings.inpaintGrowMask ?? 0,
                    onChange: (val: number) => store.set('inpaintGrowMask', val)
                })
            );

            const inpaintWfInput = controls.createInput({
                label: '局部重绘 API 工作流 JSON',
                type: 'textarea',
                value: JSON.stringify(settings.inpaintWorkflowJson || {}, null, 2),
                placeholder: '粘贴 ComfyUI 局部重绘 (Inpaint) API 格式工作流...',
                onChange: (val: string) => {
                    try {
                        const parsed = JSON.parse(val);
                        store.set('inpaintWorkflowJson', parsed);
                    } catch {}
                }
            });
            body.appendChild(inpaintWfInput);
        },
        '配置 Inpaint 局部重绘流程的 API 工作流、重绘幅度与蒙版羽化参数'
    );

    container.appendChild(cardC1);
    container.appendChild(cardC2);
    container.appendChild(cardC3);
    container.appendChild(cardC4);
    container.appendChild(cardC5);
    container.appendChild(cardC6);

    container.dispose = () => {
        // 资源释放
    };

    return container;
}
