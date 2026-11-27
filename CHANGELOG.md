# 更新日志 (Changelog)

本文档面向仓库开发者，记录 `ST-DrawAssistant` 各版本的模块演进、接口变更与关键问题修复；面向插件用户的精简更新说明内置于 [config/changelog.json](./config/changelog.json)。

---

## [1.6.0] - 2026-11-27

### 新增特性
- **图库独立重绘通道与工作台**：扩展 `GenerationOrchestrator` 支持 `gallery` 投递目标与 `regeneration-planner.ts` 参数回放方案，`ImageActionPanel` 与 `GalleryState` 统一接入「复现原参数 / 按当前配置」及固定/随机种子切换。
- **元数据写入与灯箱历史对比**：新增 `src/util/image-metadata.ts`，支持 PNG 文本块、WebP RIFF `VP8X/EXIF` 与 JPEG `APP1 EXIF` 的绘图参数读取与补写；`LightboxModal` 支持同一插槽重绘历史翻页对比及「设为当前」恢复，常态保持浏览器原生 `<img>` 拖拽。
- **三段式分层新手引导**：重写 `OnboardingGuideModal`，按插件设置、6 个服务端与提示词设置分为三板块，支持 3 步摘要、折叠排障说明与底栏页签跳转。

### 变更与重构
- **单向分层与领域/宿主抽离**：将代码依赖统一规范为 `entry -> ui -> pipeline -> provider / store -> host / util -> domain`。抽离 `src/domain/` 纯规则层（`lora-syntax`、`keyword-matcher`、`preset/`、`provider-specs/`）、`src/host/` 宿主边界适配层（`HostEventBridge`）、`src/pipeline/` 协调器（`FloorCoordinator`、`PresetTransferService`），并将 `SettingsStore` 拆分为 `SettingsRepository`、`PresetRepository` 与 `PresetLifecycle`。
- **UI 声明式迁移与状态层拆分**：将复合组件、设置页签及 `FabQuickPanel`（拆分为 `src/ui/entry/quick-panel/`）统一迁移至 Preact + Signals 与无 DOM 状态层 `src/ui/state/`；移除旧式视图模型适配层及冗余命令式输入组件（`form-field.ts`、`text-input.ts`）；统一 `ViewportService` 与 `floating-sheet.ts` 两阶段视口锚定定位。
- **服务商档位与存储规格统一**：将云端服务商档案预设与切换补丁统一归集至 `src/domain/provider-specs/service-profiles.ts`；本地 `imageQuality` 规范为 6 档存储格式，并结合真实魔数与 MIME 类型处理文件下载后缀。
- **预设与更新流程优化**：重写 `config/presets/prompt-channels.json`（改为简明清单式 `<imagethink>` / `<designthink>`，消除多人重复计数标签与自然语言“写实”偏置，明确剧情变化优先于档案、画面文字忠于原文、`DESCRIPTION` 与结构化标签分工、状态可见边界与搭配及局部缺失回退规则）、整理 `vocab-guidance.json` 与 `material-formats.json`、完善 `prompts.json` 自然语言风格句式（保留 NovelAI 画师串原样）并将 `drawing.json` 云端模型默认画幅调为 `auto`，同时优化 `UpdateService` 取消控制与 `CHARACTER_MESSAGE_RENDERED` 自动生图稳定时机。

### 问题修复
- 修复 `TagAutocomplete` 在句中、已有标签前或闭合 `$...$` 宏内触发补全时覆盖光标右侧文本的问题（改为仅向前扫描前缀起点并锁定 `replaceEnd`）。
- 修复设置弹窗切换选项卡时的未保存更改拦截、图像异步加载生命周期竞态、局部重绘负向词联动与跨会话切换回写问题。

---

## [1.5.0] - 2026-11-25

### 新增特性
- **楼层图片三态展示**：扩展 `ui.imageDisplay.displayMode`（`normal` / `blur` / `collapse`），支持单条折叠栏独立展开收起并与 `FabQuickPanel` 同步。
- **角色卡检索与云端自动画幅**：`activation-panel.tsx` 引入 `SearchableSelectControl` 支持实时筛选与解绑；OpenAI（GPT Image 及兼容通道）、Gemini 与 Grok 统一支持 `auto` 画幅/分辨率由模型决定。

### 变更与重构
- **角色状态词语义调整（破坏性变更）**：将 `CharacterPartState` 与预置数据中的默认遮蔽态 `clothed` 统一替换为 `covered`，分离身体遮蔽度与服装穿戴描述；将 `PromptPipeline` 的标签去重 (`cleanPrompt`) 与标点空行整理 (`cleanPromptPunctuation`) 拆分为独立开关，支持多行/空行分块生图指令提取。
- **ComfyUI 原生 LoRA 节点注入**：新增 `src/provider/comfyui/lora-graph-injector.ts`，在内置 Checkpoint / UNet 两套原生工作流中依据 `/object_info` 动态串联 `LoraLoader` / `LoraLoaderModelOnly`，并对 `.gguf` 与 `Nunchaku` 量化工作流提供显式拦截报错。
- **网络异常诊断增强**：完善 `HttpClient` 与 `BaseGenerationProvider` 对反向代理故障与 TauriTavern 宿主的错误解析，新增 `TauriRelayNotice` 切回提示。

### 问题修复
- 修复删除、编辑消息及重 roll 分支后队列任务错位或内联插槽掉至楼层底部的问题（新增 `reconcileTasksAfterMessageDelete` 与 `cancelOnSwipe` 分支任务取消）。

---

## [1.4.0] - 2026-11-24

### 新增特性
- **悬浮球快捷面板**：新增 `FabQuickPanel` 浮层，提供插件设置、服务设置、提示词与素材管理四分页快捷控制。
- **酒馆全局正则持久化**：新增 `HostRegexService`，将思考块展示方式（显示/折叠/隐藏）及历史思考与标记上下文清理开关同步写入宿主 `extensionSettings.regex`。
- **三段式使用引导与中文自然语义预设**：拆分为分场景 `OnboardingGuideModal`；`prompt-channels.json` 新增「中文自然语义」故事插画预设，新增默认关闭的 `normalizeChinesePunctuation` 转换选项。
- **LoRA 关键词触发与局部重绘画板增强**：支持单条 LoRA 独立切换常驻/关键词触发模式；`InpaintModal` 支持 `0.5x~5.0x` 缩放平移及 20 步撤销重做与空蒙版提交拦截。

### 变更与重构
- 将全界面滑动条控件替换为 `NumberInputControl` 步进输入组件，补充窄屏及移动端断点适配；扩展内置 ComfyUI Checkpoint / UNet 工作流模板与提交前必填校验。

---

## [1.3.0] - 2026-11-21

### 新增特性
- **原生接入 Google Gemini 与 xAI Grok**：新增 `GeminiProvider` 与 `GrokProvider`，独立实现 `:generateContent` / `images` 协议解析、按模型能力字段适配与公共云端工具模块 `cloud-provider-utils.ts`；新增英文自然语言故事插画预设。
- **预设批量导入导出与按需静态管理**：`SettingsStore` 与 `PresetToolbar` 支持 `st-da-preset-bundle` 合集及多文件批量导入导出；「关于」页支持按五大分类按需载入或卸载内置预设。
- **分享与引用校验**：支持楼层、灯箱与图库图片拖拽分享和剪贴板复制；`asset-matcher.ts` 新增缺失模型与预设引用失效检测。

---

## [1.2.0] - 2026-11-20

### 新增特性
- **独立轮询池管理**：新增 `PromptPollingModal` 与 `PromptPollingManager`，将「使用轮询」候选风格池管理从主服务表单中独立出来。
- **静默更新检测与选择性预设同步**：扩展 `UpdateService` 支持初始化静默检更、GitHub API 限流感知及 `manifest.json` 回退比对；分离「官方预设更新」与「恢复出厂设置」，支持仅补充或勾选覆盖。

### 变更与重构
- 按 NovelAI V4.5 规范调整默认采样 (`k_euler_ancestral`) 与调度 (`karras`)、开放调度器选择，更新 V4.5 质量后缀、负向提示词及画师组合预设。

---

## [1.1.0] - 2026-11-19

### 新增特性
- **全服务提示词预设轮询**：`PromptPipeline` 支持 `PROMPT_POLLING_PRESET_ID`（`__polling__`）轮询绑定，随机抽取并避开连续重复项，并将命中预设记录至生成元数据。
- **NovelAI 原生数值权重转换**：在 `PromptPipeline` 中实现 `convertNovelAIWeightSyntax()`，按模型架构自动转换括号权重为 `weight::tag::`（V4+）或 `{}` / `[]`（V3）。
- **分片词库按需加载**：新增 `StaticLexiconLoader` 与 `config/lexicon/`（10 组 Danbooru CSV 分片），首次安装默认不写入 IndexedDB，支持按分片动态载入与卸载。
- **版本更新提醒弹窗**：新增 `ChangelogModal` 消费 `config/changelog.json` 展示版本变更说明。

---

## [1.0.0] - 2026-11-18

### 新增特性
- **插件核心架构**：初始化 `manifest.json` 扩展定义与基于 `TypeScript + Preact + Webpack` 的分层实现，接入 SillyTavern 生命周期、会话消息索引与多服务商并发任务队列调度 (`GenerationOrchestrator`)。
- **多后端与双传输支持**：实现 ComfyUI、SD-WebUI / Forge、NovelAI 与 OpenAI 兼容 4 类引擎适配器及 `HttpClient`（支持浏览器直连与酒馆 `/proxy/` 转发及超时/重试控制）。
- **四通道提示词与素材宏体系**：实现 `PromptInjector` 四通道注入及 SillyTavern 世界书互转、角色/服装素材库管理、回复档案提取（`ArchiveExtractor`）及三段式简写宏展开（`MacroResolver`）。
- **本地存储、词库与交互界面**：完成 IndexedDB 分表本地图库（`ImageStorage`）、本地词表联想与筛选（`LocalLexiconStorage` / `TagAutocomplete`）、全屏灯箱与局部重绘画板、多套主题及可拖拽悬浮球入口。
