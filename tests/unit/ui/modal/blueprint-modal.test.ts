import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlueprintModal, openBlueprintModal } from '../../../../src/ui/modal/blueprint-modal';

describe('BlueprintModal 蓝图可视化节点编辑器测试', () => {
    let modal: BlueprintModal;

    const sampleWorkflowJson = JSON.stringify({
        '3': {
            class_type: 'KSampler',
            inputs: {
                seed: 123456,
                steps: 20,
                cfg: 7.5,
                sampler_name: 'euler',
                scheduler: 'normal',
                denoise: 1,
                model: ['4', 0],
                positive: ['6', 0],
                negative: ['7', 0],
                latent_image: ['5', 0],
            },
        },
        '4': {
            class_type: 'CheckpointLoaderSimple',
            inputs: {
                ckpt_name: 'v1-5-pruned.ckpt',
            },
        },
        '6': {
            class_type: 'CLIPTextEncode',
            inputs: {
                text: 'masterpiece, high quality, 1girl',
                clip: ['4', 1],
            },
        },
        '7': {
            class_type: 'CLIPTextEncode',
            inputs: {
                text: 'bad quality, blurry',
                clip: ['4', 1],
            },
        },
    });

    beforeEach(() => {
        document.body.innerHTML = '';
        modal = new BlueprintModal();
    });

    afterEach(() => {
        modal.dispose();
    });

    it('有效 JSON 能成功打开蓝图弹窗，挂载遮罩与节点卡片', () => {
        expect(modal.isOpen()).toBe(false);

        const ok = modal.open(sampleWorkflowJson);
        expect(ok).toBe(true);
        expect(modal.isOpen()).toBe(true);

        const backdrop = document.querySelector('.da-blueprint-backdrop') as HTMLElement;
        expect(backdrop).not.toBeNull();

        const badge = backdrop.querySelector('.da-header-badge');
        expect(badge?.textContent).toBe('4 个节点');

        const miniCards = backdrop.querySelectorAll('.da-blueprint-mini-card');
        expect(miniCards.length).toBe(4);
    });

    it('非法语法 JSON 返回 false 且不启动弹窗', () => {
        const ok = modal.open('{ invalid json string');
        expect(ok).toBe(false);
        expect(modal.isOpen()).toBe(false);
        expect(document.querySelector('.da-blueprint-backdrop')).toBeNull();
    });

    it('点击节点卡片能激活选中态并更新右侧检视面板', () => {
        modal.open(sampleWorkflowJson);

        const card3 = document.querySelector('[data-node-id="3"]') as HTMLElement;
        expect(card3).not.toBeNull();
        expect(card3.classList.contains('is-active')).toBe(false);

        card3.click();
        const activeCard = document.querySelector('[data-node-id="3"]') as HTMLElement;
        expect(activeCard.classList.contains('is-active')).toBe(true);

        const inspectorSummary = document.querySelector('.da-blueprint-node-summary');
        expect(inspectorSummary?.textContent).toContain('KSampler');
        expect(inspectorSummary?.textContent).toContain('#3');

        const fieldRows = document.querySelectorAll('.da-blueprint-field-row');
        expect(fieldRows.length).toBeGreaterThan(0);
    });

    it('在输入框聚焦时点击宏变量胶囊能正确填入变量', () => {
        modal.open(sampleWorkflowJson);

        const card6 = document.querySelector('[data-node-id="6"]') as HTMLElement;
        card6.click();

        const textInput = document.querySelector(
            'textarea[data-input-field-key="text"]'
        ) as HTMLTextAreaElement;
        expect(textInput).not.toBeNull();

        // 模拟聚焦
        textInput.focus();

        // 点击正向提示词胶囊按钮
        const capsuleBtns = document.querySelectorAll(
            '.da-blueprint-capsule-btn'
        );
        expect(capsuleBtns.length).toBeGreaterThan(0);

        const promptCapsule = Array.from(capsuleBtns).find((btn) =>
            btn.textContent?.includes('%prompt%')
        ) as HTMLButtonElement;
        expect(promptCapsule).toBeDefined();

        promptCapsule.click();
        expect(textInput.value).toBe('%prompt%');
    });

    it('点击保存工作流修改能格式化 JSON 并执行回调', () => {
        const onSave = vi.fn();
        modal.open(sampleWorkflowJson, onSave);

        const card6 = document.querySelector('[data-node-id="6"]') as HTMLElement;
        card6.click();

        const textInput = document.querySelector(
            'textarea[data-input-field-key="text"]'
        ) as HTMLTextAreaElement;
        textInput.value = '%prompt%';
        textInput.dispatchEvent(new Event('input'));

        const saveBtn = Array.from(document.querySelectorAll('.da-blueprint-footer .da-btn')).find(
            (b) => b.textContent?.includes('保存')
        ) as HTMLButtonElement;
        expect(saveBtn).toBeDefined();

        saveBtn.click();
        expect(onSave).toHaveBeenCalledTimes(1);

        const savedJson = onSave.mock.calls[0][0];
        const parsed = JSON.parse(savedJson);
        expect(parsed['6'].inputs.text).toBe('%prompt%');
        expect(modal.isOpen()).toBe(false);
    });

    it('openBlueprintModal 便捷单例函数能正常调起弹窗', () => {
        const ok = openBlueprintModal(sampleWorkflowJson);
        expect(ok).toBe(true);

        const backdrop = document.querySelector('.da-blueprint-backdrop');
        expect(backdrop).not.toBeNull();
    });
});
