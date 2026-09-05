/**
 * @file tests/client/ui/controls.test.ts
 * @description FormRenderer 与 InputControls 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigStore } from '../../../src/client/core';
import {
    FormRenderer,
    createToggle,
    createSelect,
    createNumberInput,
    createTextInput,
    createSlider,
    createSegmentedControl,
    analyzeAndReplaceWorkflowVariables
} from '../../../src/client/ui/controls';

describe('UI Controls & FormRenderer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('InputControls 纯控件', () => {
        it('Toggle 能够正确响应值与触发 onChange', () => {
            const onChange = vi.fn();
            const toggle = createToggle({ value: false, onChange });

            expect(toggle.getValue()).toBe(false);
            toggle.setValue(true);
            expect(toggle.getValue()).toBe(true);

            toggle.inputElement.checked = false;
            toggle.inputElement.dispatchEvent(new Event('change'));
            expect(onChange).toHaveBeenCalledWith(false);

            toggle.dispose();
        });

        it('Select 能够正确设置 options 与选值', () => {
            const onChange = vi.fn();
            const select = createSelect({
                value: 'opt1',
                options: [
                    { label: '选项1', value: 'opt1' },
                    { label: '选项2', value: 'opt2' }
                ],
                onChange
            });

            expect(select.getValue()).toBe('opt1');
            select.setValue('opt2');
            expect(select.getValue()).toBe('opt2');

            select.inputElement.value = 'opt1';
            select.inputElement.dispatchEvent(new Event('change'));
            expect(onChange).toHaveBeenCalledWith('opt1');

            select.dispose();
        });

        it('NumberInput 能够 clamp 数值范围', () => {
            const onChange = vi.fn();
            const num = createNumberInput({
                value: 50,
                min: 0,
                max: 100,
                step: 5,
                unit: 'px',
                onChange
            });

            expect(num.getValue()).toBe(50);
            num.setValue(150); // 超出上限
            expect(num.getValue()).toBe(100);

            num.setValue(-20); // 低于下限
            expect(num.getValue()).toBe(0);

            num.dispose();
        });

        it('SegmentedControl 能够正确切换分段项', () => {
            const onChange = vi.fn();
            const seg = createSegmentedControl({
                value: 'tab1',
                items: [
                    { label: '第一项', value: 'tab1' },
                    { label: '第二项', value: 'tab2' }
                ],
                onChange
            });

            expect(seg.getValue()).toBe('tab1');
            seg.setValue('tab2');
            expect(seg.getValue()).toBe('tab2');

            seg.dispose();
        });
    });

    describe('FormRenderer 声明式表单', () => {
        it('能够根据 Schema 渲染 card 与行，并实现数据双向绑定', () => {
            const store = new ConfigStore();
            const renderer = new FormRenderer(store);

            const card = renderer.renderCard({
                title: '通用设置',
                description: '核心参数',
                rows: [
                    {
                        key: 'enabled',
                        type: 'toggle',
                        label: '总开关'
                    },
                    {
                        key: 'maxStoredImages',
                        type: 'number',
                        label: '存储上限',
                        min: 0,
                        max: 1000
                    }
                ]
            });

            document.body.appendChild(card);

            const toggleHandle = renderer.getHandle('enabled');
            expect(toggleHandle).toBeDefined();
            expect(toggleHandle.getValue()).toBe(true);

            // 修改控件值 -> 写回 store
            toggleHandle.setValue(false);
            toggleHandle.inputElement.dispatchEvent(new Event('change'));
            expect(store.get('enabled')).toBe(false);

            // 修改 store -> 驱动控件
            store.set('enabled', true);
            expect(toggleHandle.getValue()).toBe(true);

            renderer.dispose();
        });
    });

    describe('ComfyUI 变量占位符分析', () => {
        it('能够正确识别标准 ComfyUI KSampler 节点并替换宏变量', () => {
            const jsonStr = JSON.stringify({
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": 123456,
                        "steps": 20,
                        "cfg": 7.0,
                        "sampler_name": "euler",
                        "scheduler": "normal"
                    }
                }
            });

            const res = analyzeAndReplaceWorkflowVariables(jsonStr);
            expect(res.success).toBe(true);
            expect(res.replaced.length).toBe(5);

            const parsed = JSON.parse(res.formattedJson);
            expect(parsed["3"].inputs.seed).toBe('%seed%');
            expect(parsed["3"].inputs.steps).toBe('%steps%');
            expect(parsed["3"].inputs.cfg).toBe('%cfg%');
            expect(parsed["3"].inputs.sampler_name).toBe('%sampler_name%');
            expect(parsed["3"].inputs.scheduler).toBe('%scheduler%');
        });
    });
});
