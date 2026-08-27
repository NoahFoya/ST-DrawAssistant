/**
 * 驱动工厂
 *
 * 根据 settings.provider 动态实例化对应的驱动类。
 * 上层业务逻辑通过此工厂获取驱动实例，无需直接 import 具体驱动类。
 *
 * 扩展新后端的方式：
 *   1. 新建 src/drivers/xxx.ts，继承 BaseDriver 实现 ImageDriver
 *   2. 在此工厂的 switch 中注册
 */
import type { ImageDriver } from './types';
import type { DrawAssistantSettings } from '../settings/types';
import type { ImageProvider } from '../settings/types';
/**
 * 根据 provider 类型创建对应的驱动实例
 *
 * @param provider 后端类型标识
 * @param settings 完整的扩展设置（驱动需要 serverUrl、apiKey 等）
 * @returns 对应的 ImageDriver 实例
 * @throws {DriverError} 如果 provider 不受支持
 *
 * @example
 * const driver = createDriver(settings.provider, settings);
 * const info = await driver.checkConnection();
 */
export declare function createDriver(provider: ImageProvider, settings: DrawAssistantSettings): ImageDriver;
//# sourceMappingURL=factory.d.ts.map