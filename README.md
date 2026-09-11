# Starlight DrawAssistant (ST-DrawAssistant)

> **SillyTavern 上下文感知 AI 绘图扩展** — 为酒馆对话场景打造的智能化 AI 图像生成插件。

[![Version](https://img.shields.io/badge/version-v0.2.0-blue.svg)](./package.json)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-green.svg)](https://www.gnu.org/licenses/gpl-3.0.html)
[![Author](https://img.shields.io/badge/Author-NoahFoya-orange.svg)](https://github.com/NoahFoya)

---

## 🌟 功能特色

- 💬 **上下文智能生图**：自动感知对话内容与画图指令，在消息下方挂载原生生成按键与进度条。
- 🎨 **多后端生图引擎支持**：原生对接 ComfyUI、Stable Diffusion WebUI、NovelAI 及兼容 OpenAI 规范的各类云端生图服务。
- 🖌️ **提示词流水线与图像编辑**：支持正负向切分、角色卡 LoRA 提取，内置 ComfyUI 蓝图可视化与局部重绘 (Inpaint) 画布。
- 🖼️ **三层存储与生图画廊**：以本地 IndexedDB 为基础底座，支持叠加保存至酒馆服务器或内嵌聊天记录，提供图库浏览与参数溯源。
- 🌗 **自适应设计系统**：采用 ITCSS 架构与变量设计令牌，统一 38px 表单交互基准，提供深浅双色、5 款定制主题与全端响应式适配。

---

## 📦 插件安装

1. 打开并登录 **SillyTavern**。
2. 依次点击顶部菜单：**扩展 (Extensions)** ➔ **扩展管理 (Extension Management)**。
3. 在 **从 URL 安装 (Install Extension)** 框中粘贴本仓库链接。
4. 点击 **安装 (Install)** 按钮，完成后**刷新酒馆页面**即可使用。

---

## 📜 许可协议与致谢

- **开源协议**：本项目基于 [GPL-3.0 License](https://www.gnu.org/licenses/gpl-3.0.html) 开源。
- **致谢**：感谢 [SillyTavern](https://github.com/SillyTavern/SillyTavern)、[ComfyUI](https://github.com/comfyanonymous/ComfyUI) 与 [Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) 社区。
