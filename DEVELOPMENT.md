# ST-DrawAssistant 开发者指南 (Developer Guide)

本指南面向二次开发者与代码贡献者，提供本地开发环境准备、源码构建调试命令以及底层架构扩展指引。

---

## 🛠️ 环境准备

开发与编译本项目需要具备以下环境：

- **Node.js**：>= 20.0.0
- **TypeScript**：>= 5.5.0
- **打包工具**：Webpack 5

---

## 📦 源码克隆与安装

请将存储库克隆至 SillyTavern 的第三方扩展开发路径：

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/NoahFoya/ST-DrawAssistant.git
cd ST-DrawAssistant
npm install
```

---

## ⚙️ 常用构建与测试命令

| 命令 | 描述 |
| :--- | :--- |
| `npm run dev` | 启动开发监听模式，文件变更时自动重新编译生成 `dist/index.js` |
| `npm run build` | 执行生产环境编译打包，优化并输出打包产物 |
| `npm run type-check` | 运行 TypeScript 静态类型检查 |
| `npm run test` | 运行 Vitest 单元测试套件 |

---

## 🏗️ 架构扩展指引

### 1. 新增生图后端驱动 (Provider Driver)
生图驱动层采用抽象工厂模式。
- 在 `src/drivers/` 目录下创建继承自 `BaseDriver` 的类（如 `MyEngineDriver.ts`）。
- 实现 `ImageDriver` 接口方法（`testConnection`、`generate`、`cancelTask`、`getSamplers`）。
- 在 `src/drivers/factory.ts` 中注册对应的 Provider 标识即可完成接入。

### 2. 新增外观主题预设 (Theme Preset)
主题系统基于声明式 JSON 配置。
- 在 `src/config/presets/themes/` 目录下添加符合规范的 JSON 文件（如 `my-theme.json`）。
- 定义 `id`、`name`、`bgPrimary`、`accentColor` 等标准配色 Token 属性。
- 系统启动时主题引擎会自动读取并动态装载。

### 3. 新增自包含扩展模块 (Extension Bundle)
进阶功能支持采用模块化包架构。
- 在 `src/extensions/` 目录下创建独立的子文件夹（如 `src/extensions/my-feature/`）。
- 包内独立组织类型契约 (`types.ts`)、存储逻辑与 UI 视图。
- 通过 `index.ts` 导出入口，保持与核心基础设施解耦。
