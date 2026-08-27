/**
 * @module drivers/factory
 * @description 图像生成驱动对象简单工厂 (Driver Factory)
 *
 * 设计模式：简单工厂模式 (Simple Factory Pattern)
 *
 * 核心职责：
 * - 根据 settings.provider 动态实例化对应的 ImageDriver 驱动实现类
 * - 隔离驱动创建过程，使 TaskManager 与 UI 上层视图解耦
 *
 * 扩展新后端规范：
 * 1. 在 src/drivers/ 下新建子类继承 BaseDriver 并实现 ImageDriver 契约
 * 2. 在此工厂 createDriver 的 switch 分支中完成注册
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