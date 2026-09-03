# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-09-03

### Security
- `server`: 服务端代理增加目标地址白名单机制，支持特定域名与 CIDR 网段匹配，防范未授权的代理转发与 SSRF 访问风险。
- `config`: 本地配置文件 `config/config.json` 加入 `.gitignore` 避免意外提交敏感密钥，并补充配置模板 `config.example.json`。

### Fixed
- `host`: 宿主事件监听支持延迟绑定，解决插件启动先于酒馆就绪时的注册报错，并在插件销毁时清理轮询计时器。
- `storage`: 图片临时链接池（`ImageUrlPool`）合并重复的并发加载任务，避免并发请求同一图片时重复生成 Object URL 导致内存泄漏。
- `storage`: 本地存储（`IndexedDbStore`）优化大图列表分页查询，先检索基础信息切片再按需加载图片内容，防止一次性读取所有图片导致浏览器内存溢出。
- `network`: 规范请求头解析逻辑，支持传入标准的 `Headers` 实例；发送 `FormData` 时保留浏览器原生的 boundary 分隔符。

### Changed
- `architecture`: 规范项目目录结构，清晰划分前端（`src/client`）、服务端（`src/server`）与公共模块（`src/common`），解决服务端代码依赖前端代码的问题。
- `domain`: 预留业务逻辑目录（`src/client/domain`）与界面交互目录（`src/client/ui`），为后续接入多生图引擎与 UI 组件做好结构准备。
- `build`: 配置 `@common`、`@client`、`@server` 导入别名，测试目录与源码结构保持一致。
- `docs`: 规范代码注释与 JSDoc 文档说明。

### Tests
- 扩充测试用例覆盖安全校验、并发加载与宿主就绪等场景，62 项单元测试全部通过。

## [0.1.1] - 2026-09-02

### Added
- `config`: 实现配置状态管理中心（`ConfigStore`），支持多引擎配置隔离与属性变更监听。
- `storage`: 实现基于 IndexedDB 的本地图片持久化存储，以及带引用计数与延迟回收的 Object URL 缓存池。
- `network`: 支持直连与服务端代理两种请求模式，自动处理 CSRF 校验标头与安全防护。
- `host`: 封装酒馆上下文接口，支持在消息 extra 中安全存储插件数据并防抖保存。
- `events`: 引入轻量级事件总线与统一的资源销毁（dispose）机制。

## [0.1.0] - 2026-09-01

### Added
- Initialized ST-DrawAssistant architectural refactor scaffold.
- Configured dual-target Webpack build pipeline for SillyTavern browser UI extension (`dist/index.js`) and Node.js server plugin (`server/index.js`).
- Defined standard SillyTavern `manifest.json` and sidebar `settings.html` template.
- Implemented idempotent frontend bootstrap lifecycle and server plugin `info/init/exit` contract.
- Established design tokens in `styles/main.css`.
- Added GPL-3.0 License and repository governance files.
