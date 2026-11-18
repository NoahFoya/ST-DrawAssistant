/**
 * 全局 Window 对象扩展类型声明。
 *
 * @remarks
 * 扩展全局 Window 接口，声明 `window.SillyTavern` 宿主全局入口。
 * 宿主环境中的 `window.SillyTavern` 在脚本加载极早期可能尚未完成挂载，建议使用可选链安全访问。
 */

import type { SillyTavernContext } from './st/context';

declare global {
    interface Window {
        /** SillyTavern 宿主全局入口命名空间 */
        SillyTavern?: {
            /** 获取宿主当前运行上下文 (只读冻结对象) */
            getContext(): SillyTavernContext;
            readonly [key: string]: unknown;
        };
        /** SillyTavern 宿主全局提供的宏替换函数 */
        substituteParams?: (text: string) => string;
    }
}

export {};
