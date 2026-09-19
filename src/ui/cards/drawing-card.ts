/**
 * ST-DrawAssistant 绘图核心参数与模型预设卡片。
 *
 * @remarks
 * 管理图像宽高分辨率、采样步数、CFG 引导系数、去噪重绘强度
 * 及基底模型等生图核心参数。
 */

import { CardBase } from './card-base';
import {
    createFormField,
    createTextInput,
    createSlider,
    createButton,
    createSelect,
} from '../components';
import { settingsStore } from '../../store/settings-store';
import type { DrawingPresetData, PresetItem } from '@types';

export class DrawingCard extends CardBase {
    private currentPreset: PresetItem<DrawingPresetData>;

    constructor() {
        super({
            title: '绘图参数预设',
            badge: '生图引擎',
        });

        const activeProvider = settingsStore.getSettings().activeProvider;
        const drawingPresets = settingsStore.getPresets<DrawingPresetData>('drawing', activeProvider);

        if (drawingPresets.length > 0) {
            this.currentPreset = drawingPresets[0];
        } else {
            this.currentPreset = {
                id: 'default_drawing',
                name: '默认生图方案',
                data: {
                    width: 512,
                    height: 768,
                    steps: 28,
                    cfgScale: 7.0,
                    denoise: 1.0,
                    seed: -1,
                },
            };
        }

        this.buildFields();
    }

    private saveCurrentPreset(): void {
        const activeProvider = settingsStore.getSettings().activeProvider;
        settingsStore.savePreset('drawing', this.currentPreset, activeProvider);
    }

    private buildFields(): void {
        const data = this.currentPreset.data;

        // 1. 常用预设分辨率快速选择
        const sizePresetSelect = this.registerChild(
            createSelect<string>({
                value: `${data.width || 512}x${data.height || 768}`,
                options: [
                    { label: '竖版肖像 (512 × 768)', value: '512x768' },
                    { label: '竖版高清 (832 × 1216)', value: '832x1216' },
                    { label: '正方形 (512 × 512)', value: '512x512' },
                    { label: '正方形高清 (1024 × 1024)', value: '1024x1024' },
                    { label: '横版宽幅 (768 × 512)', value: '768x512' },
                    { label: '横版高清 (1216 × 832)', value: '1216x832' },
                    { label: '自定义尺寸', value: 'custom' },
                ],
                onChange: (val) => {
                    if (val === 'custom') return;
                    const parts = val.split('x');
                    const w = parseInt(parts[0], 10);
                    const h = parseInt(parts[1], 10);
                    if (!Number.isNaN(w) && !Number.isNaN(h)) {
                        this.currentPreset.data.width = w;
                        this.currentPreset.data.height = h;
                        widthInput.setValue(String(w));
                        heightInput.setValue(String(h));
                        this.saveCurrentPreset();
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '常用分辨率模板',
                description: '快速设定常用长宽比例',
                control: sizePresetSelect,
                slotWidth: '240',
            }).element
        );

        // 2. 图像宽度 (px)
        const widthInput = this.registerChild(
            createTextInput({
                type: 'number',
                value: data.width ?? 512,
                variant: 'number',
                min: 64,
                max: 4096,
                step: 64,
                onChange: (val) => {
                    const num = parseInt(val, 10);
                    if (!Number.isNaN(num) && num >= 64) {
                        this.currentPreset.data.width = num;
                        this.saveCurrentPreset();
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '图像宽度 (Width)',
                description: '生成图像像素宽度，建议为 64 或 8 的倍数',
                control: widthInput,
                slotWidth: '80',
            }).element
        );

        // 3. 图像高度 (px)
        const heightInput = this.registerChild(
            createTextInput({
                type: 'number',
                value: data.height ?? 768,
                variant: 'number',
                min: 64,
                max: 4096,
                step: 64,
                onChange: (val) => {
                    const num = parseInt(val, 10);
                    if (!Number.isNaN(num) && num >= 64) {
                        this.currentPreset.data.height = num;
                        this.saveCurrentPreset();
                    }
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '图像高度 (Height)',
                description: '生成图像像素高度，建议为 64 或 8 的倍数',
                control: heightInput,
                slotWidth: '80',
            }).element
        );

        // 4. 采样步数 (Steps)
        const stepsSlider = this.registerChild(
            createSlider({
                min: 1,
                max: 150,
                step: 1,
                value: data.steps ?? 28,
                onChange: (val) => {
                    this.currentPreset.data.steps = val;
                    this.saveCurrentPreset();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '采样步数 (Steps)',
                description: '扩散去噪迭代次数，数值越大细节越丰富但耗时更长',
                control: stepsSlider,
                slotWidth: '240',
            }).element
        );

        // 5. 提示词引导系数 (CFG Scale)
        const cfgSlider = this.registerChild(
            createSlider({
                min: 1.0,
                max: 30.0,
                step: 0.5,
                value: data.cfgScale ?? 7.0,
                onChange: (val) => {
                    this.currentPreset.data.cfgScale = val;
                    this.saveCurrentPreset();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '引导系数 (CFG Scale)',
                description: '控制生成图与提示词的相关度，推荐范围 5.0 ~ 9.0',
                control: cfgSlider,
                slotWidth: '240',
            }).element
        );

        // 6. 重绘去噪幅度 (Denoise)
        const denoiseSlider = this.registerChild(
            createSlider({
                min: 0.0,
                max: 1.0,
                step: 0.05,
                value: data.denoise ?? 1.0,
                onChange: (val) => {
                    this.currentPreset.data.denoise = val;
                    this.saveCurrentPreset();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '重绘幅度 (Denoise)',
                description: '图生图重绘或高清修复时的去噪强度，文生图默认 1.0',
                control: denoiseSlider,
                slotWidth: '240',
            }).element
        );

        // 7. 随机种子 (Seed)
        const seedInput = this.registerChild(
            createTextInput({
                type: 'number',
                value: data.seed ?? -1,
                variant: 'short',
                placeholder: '-1 表示随机',
                onChange: (val) => {
                    const num = parseInt(val, 10);
                    this.currentPreset.data.seed = Number.isNaN(num) ? -1 : num;
                    this.saveCurrentPreset();
                },
            })
        );

        const randomBtn = this.registerChild(
            createButton({
                text: '随机',
                size: 'sm',
                onClick: () => {
                    seedInput.setValue('-1', { triggerChange: true });
                },
            })
        );

        const seedBox = document.createElement('div');
        seedBox.classList.add('da-row--center-y');
        seedBox.appendChild(seedInput.element);
        seedBox.appendChild(randomBtn.element);

        this.bodyElement.appendChild(
            createFormField({
                label: '随机种子 (Seed)',
                description: '控制画面初始噪声，-1 为每次由引擎随机抽取',
                control: seedBox,
                slotWidth: '240',
            }).element
        );
    }
}
