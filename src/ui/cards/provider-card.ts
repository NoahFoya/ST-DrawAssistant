/**
 * ST-DrawAssistant 生图服务提供方配置卡片。
 *
 * @remarks
 * 管理后端引擎选择 (ComfyUI / SD-WebUI / NovelAI / OpenAI)、
 * 服务基础地址、宿主中继模式与鉴权密钥，支持一键连通性检测。
 */

import { CardBase } from './card-base';
import {
    createFormField,
    createTextInput,
    createSelect,
    createToggle,
    createButton,
} from '../components';
import { settingsStore } from '../../store/settings-store';
import { providerRegistry } from '../../provider/registry';
import { eventBus } from '../../util/event-bus';
import type { ProviderType } from '@types';

export class ProviderCard extends CardBase {
    private activeProvider: ProviderType;
    private baseUrlInput: ReturnType<typeof createTextInput> | null = null;
    private apiKeyInput: ReturnType<typeof createTextInput> | null = null;
    private relayToggle: ReturnType<typeof createToggle> | null = null;
    private testBtn: ReturnType<typeof createButton> | null = null;
    private apiKeyFieldElement: HTMLElement | null = null;

    constructor() {
        super({
            title: '生图后端服务配置',
            badge: '网络连接',
        });

        this.activeProvider = settingsStore.getSettings().activeProvider;
        this.buildFields();
    }

    private getCurrentProviderConfig(): { baseUrl: string; useHostRelay?: boolean; apiKey?: string } {
        const cfg = settingsStore.getProviderConfig<Record<string, unknown>>(this.activeProvider);
        return {
            baseUrl: typeof cfg?.baseUrl === 'string' ? cfg.baseUrl : '',
            useHostRelay: Boolean(cfg?.useHostRelay),
            apiKey: typeof cfg?.apiKey === 'string' ? cfg.apiKey : '',
        };
    }

    private updateCurrentProviderConfig(updates: Record<string, unknown>): void {
        settingsStore.setProviderConfig(this.activeProvider, updates);
    }

    private buildFields(): void {
        // 1. 提供方下拉选择器
        const providerSelect = this.registerChild(
            createSelect<ProviderType>({
                value: this.activeProvider,
                options: [
                    { label: 'ComfyUI 节点工作流引擎', value: 'comfyui' },
                    { label: 'SD-WebUI / Forge 接口', value: 'sdwebui' },
                    { label: 'NovelAI 官方绘画接口', value: 'novelai' },
                    { label: 'OpenAI 兼容生图接口', value: 'openai' },
                ],
                onChange: (val) => {
                    this.activeProvider = val;
                    settingsStore.update({ activeProvider: val });
                    this.refreshProviderFields();
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '生图引擎提供方',
                description: '选择目标执行生成任务的计算服务或云端平台',
                control: providerSelect,
                slotWidth: '240',
            }).element
        );

        const currentCfg = this.getCurrentProviderConfig();

        // 2. 服务基础地址 (Base URL)
        this.baseUrlInput = this.registerChild(
            createTextInput({
                value: currentCfg.baseUrl,
                placeholder: 'http://127.0.0.1:8188',
                onChange: (val) => {
                    this.updateCurrentProviderConfig({ baseUrl: val.trim() });
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: '服务基础地址 (Base URL)',
                description: '本地或远程生图服务监听的主机地址与端口',
                control: this.baseUrlInput,
                slotWidth: '240',
            }).element
        );

        // 3. 宿主中继模式 (Host Relay)
        this.relayToggle = this.registerChild(
            createToggle({
                checked: currentCfg.useHostRelay,
                onChange: (checked) => {
                    this.updateCurrentProviderConfig({ useHostRelay: checked });
                },
            })
        );
        this.bodyElement.appendChild(
            createFormField({
                label: 'SillyTavern 宿主中继',
                description: '经由 SillyTavern 服务端转发请求，绕过跨域 (CORS) 或局域网限制',
                tooltip: '当浏览器直接连后端报 CORS 错误或混合内容阻止时，请开启此项',
                control: this.relayToggle,
                slotWidth: 'toggle',
            }).element
        );

        // 4. API 密钥 (针对云端服务)
        this.apiKeyInput = this.registerChild(
            createTextInput({
                type: 'password',
                value: currentCfg.apiKey || '',
                placeholder: 'sk-... / Bearer Token',
                onChange: (val) => {
                    this.updateCurrentProviderConfig({ apiKey: val.trim() });
                },
            })
        );
        const apiKeyField = createFormField({
            label: 'API 访问密钥 (Key / Token)',
            description: '云端多模态接口或受鉴权保护服务所需的访问凭证',
            control: this.apiKeyInput,
            slotWidth: '240',
        });
        this.apiKeyFieldElement = apiKeyField.element;
        this.bodyElement.appendChild(this.apiKeyFieldElement);

        // 5. 连通性测试操作行
        const testActionRow = document.createElement('div');
        testActionRow.classList.add('da-card-actions-right');

        this.testBtn = this.registerChild(
            createButton({
                text: '测试服务连通性',
                variant: 'secondary',
                size: 'sm',
                onClick: async () => {
                    await this.testConnection();
                },
            })
        );
        testActionRow.appendChild(this.testBtn.element);
        this.bodyElement.appendChild(testActionRow);

        this.updateApiKeyVisibility();
    }

    private updateApiKeyVisibility(): void {
        if (!this.apiKeyFieldElement) return;
        const needsKey = this.activeProvider === 'novelai' || this.activeProvider === 'openai';
        this.apiKeyFieldElement.hidden = !needsKey;
    }

    private refreshProviderFields(): void {
        const cfg = this.getCurrentProviderConfig();
        if (this.baseUrlInput) {
            this.baseUrlInput.setValue(cfg.baseUrl);
            if (this.activeProvider === 'comfyui') {
                this.baseUrlInput.element.placeholder = 'http://127.0.0.1:8188';
            } else if (this.activeProvider === 'sdwebui') {
                this.baseUrlInput.element.placeholder = 'http://127.0.0.1:7860';
            } else if (this.activeProvider === 'novelai') {
                this.baseUrlInput.element.placeholder = 'https://image.novelai.net';
            } else {
                this.baseUrlInput.element.placeholder = 'https://api.openai.com';
            }
        }
        if (this.relayToggle) {
            this.relayToggle.setValue(Boolean(cfg.useHostRelay));
        }
        if (this.apiKeyInput) {
            this.apiKeyInput.setValue(cfg.apiKey || '');
        }
        this.updateApiKeyVisibility();
    }

    private async testConnection(): Promise<void> {
        if (!this.testBtn) return;
        this.testBtn.setLoading(true);
        this.testBtn.setText('正在检测...');

        try {
            const provider = providerRegistry.getProvider(this.activeProvider);
            if (!provider) {
                throw new Error(`未找到标识为 ${this.activeProvider} 的生图提供方`);
            }

            if (typeof provider.checkHealth !== 'function') {
                throw new Error(`当前提供方 ${this.activeProvider} 未支持连通性探测`);
            }
            const isHealthy = await provider.checkHealth();
            if (isHealthy) {
                this.testBtn.setText('连接成功 ✓');
                eventBus.emit('toast:show', {
                    type: 'success',
                    message: `${this.activeProvider} 服务连通正常`,
                });
            } else {
                this.testBtn.setText('无法连接 ✕');
                eventBus.emit('toast:show', {
                    type: 'error',
                    message: `${this.activeProvider} 服务未就绪或未响应`,
                });
            }
        } catch (err) {
            this.testBtn.setText('检测失败 ✕');
            eventBus.emit('toast:show', {
                type: 'error',
                message: `连通性检测异常: ${err instanceof Error ? err.message : String(err)}`,
            });
        } finally {
            this.testBtn.setLoading(false);
            setTimeout(() => {
                this.testBtn?.setText('测试服务连通性');
            }, 3000);
        }
    }
}
