/**
 * @module ui/floor-button
 * @description 楼层生图按钮控制器
 *
 * 职责：
 * 1. 扫描 AI 消息文本，识别 `image###提示词###` 占位符
 * 2. 将占位符替换为交互式生图按钮
 * 3. 管理按钮状态机（DEFAULT → LOADING → PROGRESS → DONE/ERROR）
 * 4. 点击按钮触发生图，点击进行中的按钮可取消
 *
 * 占位符格式（用户配置）：
 *   默认起始：image###
 *   默认结束：###
 *   示例：image###1girl, cityscape, night###
 *
 * DOM 注入生命周期：
 * 每次 CHARACTER_MESSAGE_RENDERED 事件触发时，扫描新渲染的消息楼层，
 * 识别占位符并注入按钮 DOM。按钮与 TaskManager 通过 taskId 绑定，
 * 任务完成后 ImageDB 落盘，图片原位挂载到消息楼层容器。
 */
import { TaskManager } from '../task/manager';
import type { ImageDriver } from '../drivers/types';
import type { DrawAssistantSettings } from '../settings/types';
/**
 * 扫描一条 AI 消息，查找所有占位符并注入生图按钮
 *
 * @param messageElement 消息 DOM 元素（.mes）
 * @param messageIndex 该消息在 chat 数组中的索引
 * @param taskManager TaskManager 实例
 * @param driver 当前图像驱动
 * @param settings 扩展设置
 */
export declare function injectFloorButtons(messageElement: HTMLElement, messageIndex: number, taskManager: TaskManager, driver: ImageDriver, settings: DrawAssistantSettings): void;
//# sourceMappingURL=floor-button.d.ts.map