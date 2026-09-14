# ST-DrawAssistant 扩展开发模板

本目录提供了一个自包含、与插件核心解耦的扩展开发参考模板。

## 设计原则

1. **单向依赖原则**
   扩展模块仅依赖根目录 `@types` 下导出的标准类型声明（如 `DrawAssistantExtension`、`ExtensionContext` 等），绝不直接引入 `src/store/*`、`src/function/*` 或 `src/ui/*` 等核心内部私有实现。

2. **配置存储隔离原则**
   扩展不直接篡改或注入主插件配置字典，而是通过上下文提供的 `context.storage` 访问受限于自身扩展 ID 的独立命名空间。所保存的配置自动持久化于主配置的 `extensionCustomSettings[extensionId]` 下。

3. **故障隔离原则**
   扩展在初始化、生命周期切换或钩子执行过程中的任何未捕获异常均由扩展管理中心拦截隔离并记录警告日志，保证主插件核心流程与其他已注册扩展不受影响。

## 目录结构

```text
sample-extension/
├── manifest.json  # 扩展元数据描述文件
├── index.ts       # 扩展标准入口，实现 DrawAssistantExtension 接口
├── enhancer.ts    # 独立业务逻辑实现
└── README.md      # 开发与使用文档
```

## 生命周期说明

- **`init(context: ExtensionContext)`**：扩展被激活或注册时调用，传入标准受控上下文，包含隔离配置访问器 `context.storage`、流水线钩子 `context.hooks` 与独立日志器 `context.log`。
- **`onToggle(enabled: boolean)`**：用户在常规设置面板切换该扩展开关时触发。
- **`dispose()`**：扩展注销或插件卸载时触发，用于释放事件监听与内部状态。
