/**
 * @module ui/components/footer-bar
 * @description 设置面板底部动作栏组件 (FooterBar)
 *
 * 职责：
 * - 实时心跳探测服务器连接状态与延迟 (10s 轮询)
 * - 实时监控扩展 JS Heap 内存开销 (3s 轮询)
 * - 自动化定时器生命周期清理
 */
/**
 * 渲染并挂载底栏组件
 */
export declare function renderFooterBar(): HTMLElement;
/** 停止轮询（销毁面板时调用） */
export declare function stopTelemetry(): void;
/** 显式立即刷新底栏服务器连通性检测状态 */
export declare function refreshFooterStatus(): void;
//# sourceMappingURL=footer-bar.d.ts.map