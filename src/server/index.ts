/**
 * @module server/index
 * @description ST-DrawAssistant 宿主服务端辅助插件入口 (Node.js 运行域)
 * 实现 SillyTavern Server Plugin 标准接口 (info, init, exit)
 */

import type { Router, Request, Response } from 'express';
import { PLUGIN_ID, EXTENSION_NAME, EXTENSION_VERSION } from '../common';
import { handleProxyRequest, abortAllActiveProxyRequests } from './proxy';
import { getConfiguredKeyStatus, saveServerConfig } from './server-config';

export interface PluginInfo {
    id: string;
    name: string;
    description: string;
}

export const info: PluginInfo = {
    id: PLUGIN_ID,
    name: `${EXTENSION_NAME} Server Plugin`,
    description: 'Server-side proxy relay and security guard for ST-DrawAssistant'
};

/**
 * 服务端辅助插件初始化函数
 * @param router 宿主注入的专用 Express 路由器 (已挂载于 /api/plugins/st-drawassistant/)
 */
export async function init(router: Router): Promise<void> {
    console.info(`[${info.name}] 正在初始化服务端辅助路由...`);

    router.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            plugin: info.id,
            version: EXTENSION_VERSION,
            configuredKeys: getConfiguredKeyStatus(),
            timestamp: Date.now()
        });
    });

    router.post('/proxy', (req: Request, res: Response) => {
        void handleProxyRequest(req, res);
    });

    router.post('/credentials', (req: Request, res: Response) => {
        try {
            const body = req.body || {};
            saveServerConfig({
                apiKeys: body.apiKeys || body.api_keys,
                endpoints: body.endpoints
            });
            res.json({
                success: true,
                configuredKeys: getConfiguredKeyStatus()
            });
        } catch (err: any) {
            res.status(500).json({
                success: false,
                error: err.message || String(err)
            });
        }
    });

    console.info(`[${info.name}] 服务端辅助代理路由已挂载就绪。`);
}

/**
 * 服务端辅助插件退出与资源释放函数
 */
export async function exit(): Promise<void> {
    console.info(`[${info.name}] 正在清理服务端辅助资源与连接...`);
    abortAllActiveProxyRequests();
    console.info(`[${info.name}] 资源清理完成。`);
}
