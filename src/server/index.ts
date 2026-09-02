/**
 * @module server/index
 * @description ST-DrawAssistant 服务端插件入口 (Node.js 运行域)
 * 遵循 SillyTavern Server Plugin 契约 (info, init, exit)
 */

import type { Router, Request, Response } from 'express';

export interface PluginInfo {
    id: string;
    name: string;
    description: string;
}

export const info: PluginInfo = {
    id: 'st-drawassistant',
    name: 'ST-DrawAssistant Server Plugin',
    description: 'Server-side proxy and credentials isolation for ST-DrawAssistant'
};

/**
 * 服务端插件初始化契约函数
 * @param router 宿主注入的专用 Express 路由器 (已挂载于 /api/plugins/st-drawassistant/)
 */
export async function init(router: Router): Promise<void> {
    console.info(`[${info.name}] 正在初始化服务端插件路由...`);

    // 基础健康检查接口 (/api/plugins/st-drawassistant/health)
    router.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            plugin: info.id,
            version: '0.1.1',
            timestamp: Date.now()
        });
    });

    console.info(`[${info.name}] 服务端插件就绪。`);
}

/**
 * 服务端插件退出/重载资源释放契约函数
 */
export async function exit(): Promise<void> {
    console.info(`[${info.name}] 正在清理服务端插件资源...`);
}
