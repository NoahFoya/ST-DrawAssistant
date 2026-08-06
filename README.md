# Starlight DrawAssistant (ST-DrawAssistant)

> **SillyTavern 上下文感知 AI 文生图扩展插件** — 为 SillyTavern 酒馆对话场景打造的高性能、多后端自适应 AI 图像生成与可视化工作流编排插件。

[![Version](https://img.shields.io/badge/version-v0.2.0-blue.svg)](./src/presets/changelog.json)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green.svg)](https://www.gnu.org/licenses/gpl-3.0.html)
[![Author](https://img.shields.io/badge/Author-NoahFoya-orange.svg)](https://github.com/NoahFoya)

---

## 📖 面向使用者指南 (User Guide)

### ✨ 核心功能亮点

* 📸 **上下文感知生图**：在聊天对话中点击楼层按键，插件将智能解析当前对话上下文与提示词，自动调用 AI 生图后端生成对应图像。
* 🧩 **可视化蓝图编辑器**：内置点阵网格交互画布（支持 0.5x ~ 1.8x 缩放），将复杂生图工作流抽象为 220px 识别徽章节点卡片，点击唤出右侧属性编辑抽屉，轻松编辑提示词与绑定变量胶囊。
* 📊 **绘图统计与极客看板**：提供 2×2 规范 KPI 概览看板（任务总数、成功率、平均耗时、异常统计）、常用模型偏好条形图与【日 / 周 / 月 / 季】趋势 SVG 波形无缝切换。
* 🎨 **自适应外观主题**：内置 5 套精调独立外观预设（黑曜极光、蓝天白云、翡翠深林、赛博霓虹、macOS 暮光），HEX 与 RGB 双变量引擎支持 0ms 拖动全屏变色实时预览，自动匹配酒馆外观风格。
* 🗄️ **轻量化图库管理**：图像 Blob 与 300×300 缩略图全量独立保存在本地浏览器 IndexedDB 数据库中，对话记录仅保存 UUID 索引，彻底解决聊天文件膨胀卡顿问题。
* 🏛️ **酒馆侧边栏原生嵌入**：100% 接入 SillyTavern 侧边栏原生 `inline-drawer` 折叠抽屉菜单，集成版本号与一键快捷入口。

---

### 📦 极简一键安装 (无须命令行 / 即装即用)

End Users **无需安装 Node.js、无需使用命令行、无需执行打包**，直接在 SillyTavern 界面即可完成一键安装：

1. 打开并登录您的 **SillyTavern**。
2. 点击顶部导航栏的 **扩展菜单 (Extensions)** ➔ 进入 **扩展管理 (Extension Management)**。
3. 在 **从 URL 安装 (Install Extension)** 输入框中粘贴本项目的 Git 链接：
   ```text
   https://github.com/NoahFoya/ST-DrawAssistant.git
   ```
4. 点击 **安装 (Install)** 按钮，待安装完成后 **刷新 SillyTavern 页面** 即可开启体验！

---

### 🔌 生图后端连接配置

安装完成后，点击酒馆侧边栏抽屉中的 **【打开绘图助手主面板】**，在设置页配置您的生图后端：

* **ComfyUI 后端**：
  1. 启动 ComfyUI 并开启 API 监听端口（默认 `http://127.0.0.1:8188`）。
  2. 在插件主面板的后端配置中将服务地址填入 `http://127.0.0.1:8188`。
  3. 点击 **【测试连接】**，提示连通成功即可发起生图。
* **Stable Diffusion WebUI 后端**：
  1. 启动 SD-WebUI 并带上 `--api` 启动参数。
  2. 在设置中选择 `SD WebUI` 驱动，服务地址填入 `http://127.0.0.1:7860` 并保存。

---

## 💻 面向二次开发者指南 (Developer Guide)

### 🛠️ 源码开发环境准备

* **Node.js**：>= 20.0.0
* **TypeScript**：>= 5.5.0
* **构建工具**：Webpack 5

将仓库克隆至 SillyTavern 的第三方扩展开发目录：

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/NoahFoya/ST-DrawAssistant.git
cd ST-DrawAssistant
npm install
```

---

### 🛠️ 常用构建与调试命令

| 命令 | 说明 |
| :--- | :--- |
| `npm run dev` | 开启增量监听构建（文件变更时自动热重新打包 `dist/index.js`） |
| `npm run build` | 生产模式编译打包（执行代码压缩与静态资源优化） |
| `npm run type-check` | 执行 TypeScript 静态类型检查（不输出文件，用于 CI 校验） |

---

### 🏗️ 二次开发扩展指引

#### 1. 新增生图后端驱动 (New Backend Driver)
系统的生图驱动层采用工厂模式与强类型契约抽象：
- 在 `src/drivers/` 目录下新建继承自 `BaseDriver` 的类（如 `MyEngineDriver.ts`）。
- 实现 `ImageDriver` 接口所固定的契约方法（`testConnection`、`generate`、`cancelTask`、`getSamplers`）。
- 在 `src/drivers/factory.ts` 中注册该 Provider 标识即可。

#### 2. 新增外观主题预设 (New Theme Preset)
系统的外观主题采用 JSON 声明式 Token 配置：
- 在 `src/presets/themes/` 目录下创建符合规范的 JSON 文件（如 `my-theme.json`）。
- 定义 `id`、`name`、`bgPrimary`、`bgSecondary`、`accentColor` 等标准配色属性。
- 启动时主题引擎会自动动态扫描加载该主题，无需修改任何 UI 结构代码。

---

## 📜 GPL-3.0 开源协议与版权声明

### 许可协议条款

本项目基于 **[GNU General Public License v3.0 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.html)** 协议开源。

**Copyright (C) 2026 NoahFoya & ST-DrawAssistant Contributors**

1. **开源强互惠 (Copyleft)**：任何个人或组织均可免费使用、学习、修改与分发本项目。**凡基于本项目源码进行的二次开发、衍生修改、功能扩展或组合分发，其衍生作品的源代码必须同样以 GPL-3.0 协议完整公开**。
2. **版权声明保留**：在二次开发、衍生修改版本或二次分发中，**必须在源码和副本中完整保留原作者 NoahFoya 的版权声明与 GPL-3.0 许可全文**。
3. **免责声明 (No Warranty)**：本软件按“原样 (AS IS)”提供，作者 NoahFoya 与贡献者不提供任何形式的明示或暗示保证，亦不承担任何因使用或修改本软件产生的直接、间接或附带损失与赔偿责任。

### 第三方致谢与商标声明

* 感谢 **[SillyTavern](https://github.com/SillyTavern/SillyTavern)** 官方社区提供的强大扩展宿主生态。
* 感谢 **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** 与 **[Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui)** 生态提供的 AI 图像生成驱动支持。
* 本项目中所引用的图标、商标及社区标识版权均归各自官方版权方所有。
