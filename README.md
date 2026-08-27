# ST DrawAssistant

> **SillyTavern 文生图扩展插件** — 在 SillyTavern 聊天界面中，通过 AI 生成与对话上下文相关的图像。

[![Version](https://img.shields.io/badge/version-0.1.0--dev-blue)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 功能概述

- 📸 **一键生图**：在聊天消息旁点击按钮，即可基于当前上下文生成图像
- 🔌 **多后端支持**：ComfyUI（主要）、Stable Diffusion WebUI（计划中）
- 🗄️ **本地存储**：图像以 Blob 存于 IndexedDB，聊天文件保持轻量
- 🎨 **主题自适应**：引用 SillyTavern 主题 CSS 变量，自动适配亮/暗色主题
- ⚙️ **无强制依赖**：核心功能不依赖服务端插件，可直连后端运行

---

## 安装要求

- **SillyTavern**：最新 `release` 分支版本
- **Node.js**：>= 20.0.0（用于构建，运行时不需要）
- **图像生成后端**：ComfyUI 或 Stable Diffusion WebUI（至少一个）

---

## 安装步骤

### 1. 克隆仓库

将本项目克隆到 SillyTavern 的第三方扩展目录：

```bash
cd /path/to/SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/your-username/ST-DrawAssistant.git
```

> ⚠️ 目录名必须保持为 `ST-DrawAssistant`，与 `manifest.json` 的 `name` 字段一致。

### 2. 安装依赖并构建

```bash
cd ST-DrawAssistant
npm install
npm run build
```

构建产物输出到 `dist/index.js`。

### 3. 启动 SillyTavern

重启（或刷新）SillyTavern，在扩展菜单（Extensions →）中应出现 **ST DrawAssistant**。

---

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run build` | 生产模式构建（压缩） |
| `npm run dev` | 开发模式监听（文件变化时自动重新构建） |
| `npm run build:dev` | 开发模式单次构建（含 source map） |
| `npm run type-check` | TypeScript 类型检查（不生成文件） |

### 开发工作流

```bash
# 终端 1：监听构建
npm run dev

# 终端 2：在 SillyTavern 中开发
# → 修改 src/ 下的文件后，Webpack 自动重新构建
# → 刷新 SillyTavern 页面即可看到最新代码
```

---

## 项目结构

```
ST-DrawAssistant/
├── src/
│   ├── index.ts                # 扩展入口（APP_READY 初始化）
│   ├── core/
│   │   ├── constants.ts        # 全局常量（MODULE_NAME 等）
│   │   └── context.ts          # SillyTavern 宿主上下文封装
│   ├── settings/
│   │   ├── types.ts            # DrawAssistantSettings 接口
│   │   ├── defaults.ts         # 默认值
│   │   └── manager.ts          # 设置读写管理
│   ├── drivers/
│   │   ├── types.ts            # ImageDriver 统一接口
│   │   ├── base.ts             # BaseDriver 抽象基类
│   │   ├── comfyui.ts          # ComfyUI 驱动
│   │   └── factory.ts          # 驱动工厂
│   └── ui/
│       └── settings-panel.ts   # 设置面板 UI 控制器
├── templates/
│   └── settings.html           # 设置面板 HTML 模板
├── styles/
│   └── main.css                # 扩展样式（引用 ST 主题变量）
├── dist/                       # 构建产物（gitignored）
├── manifest.json               # SillyTavern 扩展元数据
├── package.json
├── tsconfig.json
└── webpack.config.js
```

---

## 后端配置

### ComfyUI

1. 启动 ComfyUI：`python main.py --listen 0.0.0.0 --port 8188`
2. 在 ST DrawAssistant 设置面板中填写服务地址：`http://127.0.0.1:8188`
3. 点击「测试连接」确认连通

---

## 开发阶段规划

| 阶段 | 状态 | 内容 |
|------|------|------|
| P0：核心基础 | 🚧 进行中 | 构建骨架、设置管理、驱动接口、楼层按钮 |
| P1：体验完善 | ⏳ 计划中 | IndexedDB 存储、完整设置 UI、提示词引擎 |
| P2：扩展能力 | ⏳ 计划中 | 斜杠命令、变体管理、服务端插件 |
| P3：打磨发布 | ⏳ 计划中 | 内存优化、错误处理、文档完善 |

---

## License

[MIT](./LICENSE)
