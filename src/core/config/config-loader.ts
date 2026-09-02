/**
 * @module core/config/config-loader
 * @description 静态出厂预设与扩展元数据加载服务
 */

import { Logger } from '../logging/logger';

export interface ExtensionAboutInfo {
    displayName: string;
    version: string;
    description: string;
    author: string;
    license: string;
}

export class ConfigLoader {
    private static readonly _logger = new Logger('ConfigLoader');

    /** 获取插件基础关于信息 */
    public static getAboutInfo(): ExtensionAboutInfo {
        return {
            displayName: 'ST-DrawAssistant',
            version: '0.1.1',
            description: 'SillyTavern 全功能 AI 绘画增强助手',
            author: 'ST-DrawAssistant Team',
            license: 'GPL-3.0'
        };
    }

    /**
     * 加载静态预设文件数据
     *
     * @param presetPath 相对配置路径
     */
    public static async loadStaticJson<T = unknown>(presetPath: string): Promise<T | null> {
        try {
            const response = await fetch(presetPath);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return (await response.json()) as T;
        } catch (err) {
            ConfigLoader._logger.warn(`读取静态预设文件失败 [${presetPath}]`, err);
            return null;
        }
    }
}
