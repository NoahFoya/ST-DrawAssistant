# Starlight DrawAssistant (ST-DrawAssistant)

> **SillyTavern 上下文感知 AI 绘图扩展** — 为酒馆对话场景打造的智能化 AI 图像生成插件。

[![Version](https://img.shields.io/badge/version-v0.3.4-blue.svg)](./src/config/changelog.json)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green.svg)](https://www.gnu.org/licenses/gpl-3.0.html)
[![Author](https://img.shields.io/badge/Author-NoahFoya-orange.svg)](https://github.com/NoahFoya)

---

## 🌟 功能特色

- 💬 **上下文智能生图**：自动感知对话内容与画图指令，在消息下方挂载原生生成按键与进度条。
- 🎨 **主流生图引擎支持**：原生支持对接 ComfyUI 与 Stable Diffusion WebUI 后端。
- 🖌️ **可视化提示词与蓝图编辑器**：提供拖拽式节点网格画布、画质预设与提示词调整功能。
- 🖼️ **本地图像管理与查看**：生成的图片本地独立托管，提供图像详情查看与提示词一键复制，不卡顿聊天记录。
- 🌗 **自适应主题外观**：内置 5 套精美主题，自动融入酒馆界面风格。

---

## 📦 插件安装

> 💡 **无需配置编译环境**：本插件已预构建完成。直接在酒馆界面粘贴链接安装即可使用，**无需安装 Node.js 或执行命令行**。

1. 打开并登录 **SillyTavern**。
2. 依次点击顶部菜单：**扩展 (Extensions)** ➔ **扩展管理 (Extension Management)**。
3. 在 **从 URL 安装 (Install Extension)** 框中粘贴链接：
   ```text
   https://github.com/NoahFoya/ST-DrawAssistant.git
   ```
4. 点击 **安装 (Install)** 按钮，完成后**刷新酒馆页面**即可使用。

---

## 🔌 后端连接配置

在酒馆侧边栏点击 **【打开绘图助手主面板】** 进入设置：

### ComfyUI 后端
1. 启动 ComfyUI（默认服务地址 `http://127.0.0.1:8188`）。
2. 在插件设置中选择 `ComfyUI` 后端并填入地址。
3. 点击 **【测试连接】**，提示成功即可开始画图。

### Stable Diffusion WebUI 后端
1. 启动 SD WebUI 时添加 `--api` 参数（默认服务地址 `http://127.0.0.1:7860`）。
2. 在插件设置中选择 `SD WebUI` 驱动，填入服务地址并保存。

---

## 🛠️ 开发者指南

如果您希望进行二次开发、修改源码或参与贡献，请参阅独立的开发者文档：

👉 **[开发者指南 (DEVELOPMENT.md)](./DEVELOPMENT.md)**

---

## 📜 许可协议与致谢

- **开源协议**：本项目基于 [GPL-3.0 License](https://www.gnu.org/licenses/gpl-3.0.html) 开源。
- **致谢**：感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern)、[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 与 [Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) 社区。
