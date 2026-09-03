/**
 * @module core/network/types
 * @description 客户端与服务端辅助插件通信数据格式定义
 */

export { ProxyRelayPayload, ProxyErrorPayload } from '../../../common';

/** 服务端辅助插件信息声明 */
export interface ServerPluginInfo {
    id: string;
    name: string;
    description: string;
    version?: string;
}
