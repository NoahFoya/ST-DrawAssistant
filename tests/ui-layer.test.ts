// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    html,
    safe,
    ControlFactory,
    ModalService,
    ThemeService,
    SettingsModal
} from '../src/ui';
import { ObservableStore, migrateSettings, UIRegistry } from '../src/core';

describe('Batch 4: UI Layer Tests (Specification Aligned)', () => {
    describe('HTML Security & Templating', () => {
        it('should escape malicious XSS scripts by default', () => {
            const maliciousInput = '<script>alert("xss")</script>';
            const output = html`<div class="user-content">${maliciousInput}</div>`;
            expect(output).toBe('<div class="user-content">&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>');
        });

        it('should preserve safe HTML strings', () => {
            const rawSafe = safe('<span>safe badge</span>');
            const output = html`<div>${rawSafe}</div>`;
            expect(output).toBe('<div><span>safe badge</span></div>');
        });
    });

    describe('ControlFactory Component Creation', () => {
        it('should create switch control with correct structure', () => {
            const factory = new ControlFactory();
            let changedVal = false;
            const row = factory.createSwitch({
                label: '启用自动生图',
                value: false,
                onChange: (v) => {
                    changedVal = v;
                }
            });

            expect(row.classList.contains('da-field-row')).toBe(true);
            const input = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
            expect(input).toBeDefined();
            expect(input.checked).toBe(false);
        });

        it('should create section card with builder pattern', () => {
            const factory = new ControlFactory();
            const card = factory.createCard('测试分组', (body) => {
                const p = document.createElement('p');
                p.textContent = '卡片内部文字';
                body.appendChild(p);
            });

            expect(card.classList.contains('da-section-card')).toBe(true);
            expect(card.textContent).toContain('测试分组');
            expect(card.textContent).toContain('卡片内部文字');
        });
    });

    describe('ModalService Stack & Z-Index', () => {
        it('should manage modal stack and close correctly', () => {
            const service = new ModalService();
            const modalEl1 = document.createElement('div');
            const modalEl2 = document.createElement('div');

            const h1 = service.open(modalEl1);
            expect(service.getOpenCount()).toBe(1);

            const h2 = service.open(modalEl2);
            expect(service.getOpenCount()).toBe(2);

            expect(Number(modalEl2.style.zIndex)).toBeGreaterThan(Number(modalEl1.style.zIndex));

            h2.dispose();
            expect(service.getOpenCount()).toBe(1);

            h1.dispose();
            expect(service.getOpenCount()).toBe(0);
        });
    });

    describe('ThemeService Dynamic CSS Variables', () => {
        it('should apply theme variables to target element', () => {
            const store = new ObservableStore(migrateSettings({ themePreset: 'cyberpunk' }));
            const themeService = new ThemeService(store);
            const target = document.createElement('div');

            themeService.applyTheme(undefined, target);
            expect(target.style.getPropertyValue('--da-accent-color')).toBe('#05ffa1');

            themeService.dispose();
        });
    });

    describe('SettingsModal Dynamic Slot Rendering', () => {
        it('should dynamically render registered tabs conforming to TabSlotDescriptor', () => {
            const uiRegistry = new UIRegistry();
            const modalService = new ModalService();
            const store = new ObservableStore(migrateSettings({}));

            let tabRendered = false;
            uiRegistry.registerTab({
                id: 'custom-extension-tab',
                title: '扩展管理',
                icon: '🧩',
                render: (container) => {
                    tabRendered = true;
                    const div = document.createElement('div');
                    div.textContent = '扩展内容已挂载';
                    container.appendChild(div);
                }
            });

            const settingsModal = new SettingsModal({
                uiRegistry,
                modalService,
                store
            });

            settingsModal.open('custom-extension-tab');
            expect(tabRendered).toBe(true);

            settingsModal.close();
            settingsModal.dispose();
        });
    });
});
