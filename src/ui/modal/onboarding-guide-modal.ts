/**
 * 三段式分场景使用引导弹窗 (OnboardingGuideModal)。
 *
 * @remarks
 * 1. 按功能模块拆分为「插件设置引导」「服务端设置引导（6 个生图服务独立说明）」「提示词设置引导」三大单页卡片板块；
 * 2. 首次进入对应页面自动定位并弹出，也可由设置顶栏 ? 图标按当前页面自动定位重开并自由切换查阅；
 * 3. 接入 OverlayStack 集中层级管理，支持 Esc 键、遮罩点击与一键「我知道了」退出。
 */

import type { ProviderType } from '@types';
import type { Disposable } from '../types';
import { bindBackdropDismiss, overlayStack } from '../framework/overlay-stack';
import { renderIcon } from '../components/icons';

export type GuideSectionId = 'plugin' | 'provider' | 'prompts';

export interface OnboardingGuideModalOptions {
    /** 初始激活的引导板块（默认 'plugin'） */
    readonly section?: GuideSectionId;
    /** 当 section 为 'provider' 时的初始选中服务端（默认 'comfyui'） */
    readonly provider?: ProviderType;
    /** 关闭回调 */
    readonly onClose?: () => void;
}

interface GuideCardSpec {
    readonly title: string;
    readonly badge?: string;
    readonly badgeMuted?: boolean;
    readonly highlight?: boolean;
    readonly bullets: ReadonlyArray<{ readonly lead?: string; readonly body: string }>;
}

interface GuideFlowNode {
    readonly step: string;
    readonly title: string;
    readonly desc: string;
}

interface GuidePageContent {
    readonly kicker: string;
    readonly title: string;
    readonly subtitle: string;
    readonly flowNodes?: readonly GuideFlowNode[];
    readonly cards: readonly GuideCardSpec[];
}

interface GuideSectionMeta {
    readonly id: GuideSectionId;
    readonly num: string;
    readonly label: string;
}

interface GuideProviderMeta {
    readonly id: ProviderType;
    readonly label: string;
}

const GUIDE_SECTIONS: readonly GuideSectionMeta[] = [
    { id: 'plugin', num: '1', label: '插件设置引导' },
    { id: 'provider', num: '2', label: '服务端设置引导' },
    { id: 'prompts', num: '3', label: '提示词设置引导' },
];

const GUIDE_PROVIDERS: readonly GuideProviderMeta[] = [
    { id: 'comfyui', label: 'ComfyUI' },
    { id: 'sdwebui', label: 'SD-WebUI' },
    { id: 'novelai', label: 'NovelAI' },
    { id: 'openai', label: 'OpenAI 兼容' },
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'grok', label: 'xAI Grok' },
];

const PLUGIN_GUIDE_CONTENT: GuidePageContent = {
    kicker: 'ST-DrawAssistant 使用引导 · 插件设置引导',
    title: '快速上手：插件怎么配合酒馆出图？',
    subtitle: '插件只负责串联酒馆对话与外部画图工具；配好连接即可在聊天里自动生成与看图',
    flowNodes: [
        {
            step: '01 选好生图服务',
            title: '填写地址或密钥',
            desc: '选好你要用的生图服务，去对应服务页填好地址或 API Key',
        },
        {
            step: '02 教 AI 出图（可选）',
            title: '提示词与世界书',
            desc: '默认已开故事插画引导，已有外部世界书也可随时关掉',
        },
        {
            step: '03 识别生图指令',
            title: '抓出画图标签',
            desc: '自动识别消息里的生图标记，支持手动点击或自动出图',
        },
        {
            step: '04 看图与微调重绘',
            title: '聊天内看图与编辑',
            desc: '图片直接留在聊天楼层里，支持放大看图、微调词重绘与局部重绘',
        },
    ],
    cards: [
        {
            title: '1. 使用前提与连接方式',
            highlight: true,
            badge: '必看前提',
            bullets: [
                {
                    lead: '使用前提（不自带模型）',
                    body: '插件本身不含任何画图模型；先在「插件设置」选好要用的「生图服务」，再切到该服务页填好地址或 API Key 并测试连接。',
                },
                {
                    lead: '连接方式（推荐浏览器直连）',
                    body: '默认「浏览器直连」响应最快；如果遇到跨域拦截，或远程 HTTPS 酒馆无法直接连本地 HTTP 服务，请切为「酒馆代理」（需在 SillyTavern `config.yaml` 打开 `enableCorsProxy: true`；若启用 `privateAddressWhitelist` 且访问本地/内网地址须将 IP 加入 `allowedRanges`。注意 TauriTavern 外壳不支持 `/proxy/`，请保持直连）。',
                },
                {
                    lead: '悬浮球快捷面板（可选）',
                    body: '可在「悬浮球」页开启快捷面板，随时快速修改常用服务参数与开关。',
                },
            ],
        },
        {
            title: '2. 聊天看图、提示词清洗与本地保存',
            badge: '交互说明',
            badgeMuted: true,
            bullets: [
                {
                    lead: '识别标记与正负向分隔',
                    body: '默认按 `image### 正向词 | 负向词 ###` 识别 AI 写的生图指令（支持内部多行与换行排版）；如需兼容部分模型习惯，可在下方调整起止标记。',
                },
                {
                    lead: '提示词去重、标点与空行整理',
                    body: '「提示词 Tags 自动去重」与「标点与空行自动整理」默认开启，分别负责纯英文标签去重、重复标点清理及空白行压缩，并完整保留中英文自然句式与有效换行；「中文标点转英文逗号」默认关闭以保留中文自然语义。',
                },
                {
                    lead: '隐藏思考与清理历史标记',
                    body: '「绘图与设计思考」与两项历史清理开关会同步写入酒馆全局正则，使过程草稿与旧标记不占用后续对话上下文（停用本插件后仍会在酒馆中持续生效）。',
                },
                {
                    lead: '图片保存、看图与词库定位',
                    body: '生成的图片保存在浏览器本地，不会撑大酒馆聊天存档；聊天里点图片可看大图，右键或长按可重绘或局部涂抹修改。侧边栏「词库」只用于自己改框时查词联想，不会发给 AI。',
                },
            ],
        },
    ],
};

const PROVIDER_GUIDE_MAP: Record<ProviderType, GuidePageContent> = {
    comfyui: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'ComfyUI 新手入门：跨域配置与工作流选型',
        subtitle: '按启动方式配置好跨域参数，分清 Checkpoint 与 UNet 工作流怎么选',
        cards: [
            {
                title: '1. 先开跨域参数（连不上必看）',
                highlight: true,
                badge: '必看前提',
                bullets: [
                    {
                        lead: '为什么常连不上',
                        body: '酒馆网页和 ComfyUI（默认 `http://127.0.0.1:8188`）端口不同，不开启跨域权限会被浏览器拦截，无法直连。',
                    },
                    {
                        lead: '秋叶绘世整合包启动器',
                        body: '打开启动器进入「高级选项 / 启动参数」，开启允许跨域访问，或在额外启动参数栏填写 `--enable-cors-header *`（同局域网手机或平板访问请同步勾选开放远程连接）。',
                    },
                    {
                        lead: '官方便携包 (Windows)',
                        body: '右键编辑 `run_nvidia_gpu.bat`（或 `run_cpu.bat`），在 `main.py` 后加上 `--listen 127.0.0.1 --enable-cors-header *`（需同局域网访问可将 `127.0.0.1` 改为 `0.0.0.0`）。',
                    },
                    {
                        lead: '桌面版、重启检查与远程酒馆',
                        body: 'Desktop 版可在服务设置附加 `--enable-cors-header *`。改完后务必重启 ComfyUI，先确认浏览器能直接打开 `http://127.0.0.1:8188`，再到插件点「测试连接/同步模型」。若酒馆在远程 HTTPS 域名而 ComfyUI 在本机，可改用「酒馆代理」（需确保 `enableCorsProxy: true` 且 `privateAddressWhitelist` 放行本机地址；注意 ComfyUI 局部重绘需上传图片表单，仅支持「浏览器直连」，且 TauriTavern 宿主不支持酒馆代理）。',
                    },
                ],
            },
            {
                title: '2. 内置原生工作流与 LoRA 说明',
                badge: '工作流基础',
                bullets: [
                    {
                        lead: '工作流怎么运行',
                        body: '插件内置「默认 Checkpoint 模型文生图」与「默认 UNet 模型文生图」两套原生工作流，生图时会自动填入模型、提示词、尺寸、步数、CFG 和种子，并动态串联内置 `LoraLoader` 节点加载底部提示词预设里配置的 LoRA。',
                    },
                    {
                        lead: 'Checkpoint 底模 vs UNet 分立模型',
                        body: 'SDXL / Illustrious / NoobAI / Pony 单文件整合大模型（位于 `checkpoints/` 目录）选 `默认 Checkpoint 模型文生图`，CLIP 与 VAE 保持「使用模型内置」；Flux / Qwen-Image / MOSS / Anima 等分立模型（位于 `unet/` 或 `diffusion_models/` 目录）选 `默认 UNet 模型文生图`，并在「模型配置」指定配套 CLIP 与 VAE（特殊架构可在「打开蓝图」切换加载器类型）。',
                    },
                    {
                        lead: 'WeiLin 节点插件（可选增强）',
                        body: '若导入并使用了含 `WeiLinPromptUI` 节点的自定义工作流以启用触发词权重（Trigger）等精细控制，生图时会按 `<wlr:...>` 语法发送（服务端须安装 `ComfyUI-WeiLin` 插件）；默认原生工作流直接使用标准节点运行。',
                    },
                ],
            },
            {
                title: '3. 导入自己的外部工作流（记住两步）',
                badge: '进阶导入',
                bullets: [
                    {
                        lead: '第 1 步 · 导出 API 格式 JSON（不要用普通保存）',
                        body: '新版 ComfyUI 网页点击顶部 `工作流 (Workflow) → 导出 (API) / Export (API)`；旧版网页先在右上角设置打开 `Enable Dev mode Options`，再点 `Save (API Format)`。普通保存带网页坐标的 JSON 无法直接运行。',
                    },
                    {
                        lead: '第 2 步 · 自动映射与蓝图微调',
                        body: '到底部「ComfyUI 工作流设置」导入后，点击「格式化变量」就能自动识别参数位置；如需手工调整连线或加载器设置，点「打开蓝图」保存后再到上方选中。',
                    },
                ],
            },
            {
                title: '4. 局部重绘与常见报错排查',
                badge: '排障速查',
                badgeMuted: true,
                bullets: [
                    {
                        lead: '局部重绘工作流',
                        body: '需要用涂抹画板做局部重绘时，请在底部导入带底图与蒙版输入节点的 API 工作流，并在上方「局部重绘工作流」选中绑定。',
                    },
                    {
                        lead: '报错或找不到模型怎么查',
                        body: '生图失败时，错误弹窗和侧边栏「日志与统计」会直接指出具体哪个节点或模型出了问题；补齐插件或增删模型后，重新点一下「测试连接/同步模型」刷新即可。',
                    },
                ],
            },
        ],
    },
    sdwebui: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'Stable Diffusion WebUI / Forge 配置指引',
        subtitle: '开启 API 与跨域参数即可直连，原生支持高清修复与画板局部重绘',
        cards: [
            {
                title: '1. 启动参数前提（A1111 / Forge / reForge）',
                highlight: true,
                badge: '必选参数',
                bullets: [
                    {
                        lead: '必加启动参数',
                        body: '编辑启动脚本（如 `webui-user.bat`），在启动参数里务必同时加上 `--api` 和 `--cors-allow-origins=*`。',
                    },
                    {
                        lead: '填入地址并同步清单',
                        body: '本地默认地址一般为 `http://127.0.0.1:7860`，填好后点击「测试连接/同步模型」即可自动拉取底模、VAE、采样器与 LoRA。',
                    },
                ],
            },
            {
                title: '2. 常用参数与高清修复推荐',
                badge: '参数推荐',
                bullets: [
                    {
                        lead: 'VAE 与 Clip Skip',
                        body: '自带烘焙 VAE 的底模选 `自动匹配 (automatic)` 即可；二次元 / Illustrious / Pony 模型推荐 `CLIP 跳过层数` 设 `2`，写实与标准 SDXL 模型多设 `1`。',
                    },
                    {
                        lead: '高清修复 (Hires. fix)',
                        body: '想进一步细化人物五官与细节可开启高清修复：二次元常用放大算法 `R-ESRGAN 4x+ Anime6B`，二次步数 `10~20`，重绘幅度建议 `0.35~0.50`。',
                    },
                ],
            },
            {
                title: '3. LoRA、轮询与局部重绘',
                badge: '功能特点',
                badgeMuted: true,
                bullets: [
                    {
                        lead: 'LoRA 触发与提示词轮询',
                        body: '底部「提示词预设」支持添加多个 LoRA 并设为常驻或关键词自动触发；将上方的「提示词预设」切为「使用轮询」，还能在多套画风间随机抽取。',
                    },
                    {
                        lead: '原生局部重绘',
                        body: '对聊天图片右键或长按打开局部重绘画板即可直接涂抹修改，无需额外配置工作流。',
                    },
                ],
            },
        ],
    },
    novelai: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'NovelAI 云端生图配置指引',
        subtitle: '自动适配 V4 / V4.5 / V5 原生权重写法与 V3 经典参数',
        cards: [
            {
                title: '1. 账号密钥与网络连接',
                highlight: true,
                badge: '连接配置',
                bullets: [
                    {
                        lead: '填写 API Token',
                        body: '官方地址已内置，在 API Key 填入 NovelAI 账号设置里生成的访问密钥（Persistent API Token）即可，无需拉取模型列表。',
                    },
                    {
                        lead: '直连受阻怎么处理',
                        body: '若国内浏览器直连官方域名超时，使用标准 SillyTavern Node 版时可在「插件设置」切换为「酒馆代理」（须开启 `enableCorsProxy: true`）；若使用 TauriTavern 等不支持 `/proxy/` 的宿主环境，请保持「浏览器直连」并将上方「服务商」改成「自定义服务」填入允许跨域的中转地址。',
                    },
                ],
            },
            {
                title: '2. V4 / V4.5 / V5 权重转换与推荐搭配',
                badge: 'V4+ 适配',
                bullets: [
                    {
                        lead: '圆括号权重自动转换',
                        body: '开启「权重语法自动转换」后，插件会自动把 `(tag:1.2)` 等常见括号转为 V4 / V4.5 / V5 原生的 `1.2::tag::` 写法（选用 V3 老模型时则自动兼容为 `{...}` / `[...]`）。',
                    },
                    {
                        lead: '官方推荐组合与画师串轮询',
                        body: '推荐选用 `NAI Diffusion V4.5 Full` + `k_euler_ancestral` + `karras` 调度器；可将「提示词预设」设为「使用轮询」在内置多组画师串间随机切换。',
                    },
                ],
            },
            {
                title: '3. V3 模型与 V4+ 模型设置区别',
                badge: '型号区分',
                badgeMuted: true,
                bullets: [
                    {
                        lead: 'SMEA 与焦黑抑制仅 V3 适用',
                        body: '只有选用 V3 系列模型时才支持下方的 `SMEA 采样增强`（高分辨率选 `SMEA + DYN`）与 `焦黑抑制 (Decrisper)`；V4 / V4.5 / V5 模型已内置优化，界面会自动禁用这两项以免误开影响画质。',
                    },
                ],
            },
        ],
    },
    openai: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'OpenAI 兼容接口配置指引',
        subtitle: '支持官方 OpenAI (GPT Image / DALL-E 3)、硅基流动及 OneAPI 等标准中转站',
        cards: [
            {
                title: '1. 服务商模板与中转站适配',
                highlight: true,
                badge: '接口对接',
                bullets: [
                    {
                        lead: '官方与常用中转切换',
                        body: '内置 `OpenAI 官方`、`SiliconFlow 硅基流动` 与「自定义服务」；接入第三方中转站时选择自定义，填写服务地址（通常以 `/v1` 结尾）与 API Key 即可。',
                    },
                    {
                        lead: '获取或手填模型名称',
                        body: '点「测试连接/拉取模型」可自动列出支持的生图模型；若部分中转站未开放模型查询列表，直接在「自定义模型标识」里填好模型名即可使用。',
                    },
                ],
            },
            {
                title: '2. 模型特性与自然语言提示词',
                badge: '使用要点',
                bullets: [
                    {
                        lead: 'GPT Image vs DALL-E 3 参数差异',
                        body: '`GPT Image` 系列支持生成画质、透明背景与输出格式切换，分辨率支持「自动 (由模型决定)」或指定尺寸；`DALL-E 3` 支持画质 (`standard/hd`) 与风格 (`vivid/natural`) 调整。',
                    },
                    {
                        lead: '直接用自然句子描述画面（推荐切换故事插画预设）',
                        body: '这类模型更擅长阅读自然语言长句：建议去「提示词 → 故事插画」切换为「故事插画 · 中文自然语义」或「故事插画 · 自然语言」；默认生图配置不绑定多余前后缀，需要统一画风时可在提示词预设中选用「日系二次元 / 半写实厚涂 / 电影感摄影 / 唯美水彩插画」。',
                    },
                ],
            },
            {
                title: '3. 自定义请求参数（进阶可选）',
                badge: '扩展参数',
                badgeMuted: true,
                bullets: [
                    {
                        lead: '按需补充额外参数',
                        body: '如果中转或特定模型要求额外传参，可在底部「自定义请求参数 JSON」补充标准 JSON 键值，普通使用留空即可。',
                    },
                ],
            },
        ],
    },
    gemini: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'Google Gemini 生图配置指引',
        subtitle: '对接 Gemini 官方或中转生图模型，按所选模型自动显示对应画质选项',
        cards: [
            {
                title: '1. 官方直连与中转代理',
                highlight: true,
                badge: '接口对接',
                bullets: [
                    {
                        lead: '切换官方或自定代理',
                        body: '支持 `Google Gemini 官方` 与「自定义中转 / 代理」；填写 API Key 后点「测试连接/拉取模型」，会自动筛选出支持画图的模型（含 `gemini-2.5-flash-image`、`nano-banana` 等）。',
                    },
                    {
                        lead: '手动指定新模型',
                        body: '如果使用了未出现在下拉菜单的新版或别名模型，可直接填写「自定义模型标识」。',
                    },
                ],
            },
            {
                title: '2. 画幅比例与分辨率档位联动',
                badge: '能力适配',
                bullets: [
                    {
                        lead: '直接选择画幅比例',
                        body: '通过「画幅比例」直接决定横图、竖图或方图构图，也可选「自动 (由模型决定)」。',
                    },
                    {
                        lead: '分辨率随模型自动显隐',
                        body: '`2.5 Flash Image` 仅支持默认尺寸，界面会自动隐藏清晰度栏；`3.1 Flash` 支持 `512px / 1K / 2K / 4K`；`3 Pro` 支持 `1K / 2K / 4K`；不支持固定分档时可选「自动」。',
                    },
                ],
            },
            {
                title: '3. 自然语言提示词与扩展参数',
                badge: '推荐搭配',
                badgeMuted: true,
                bullets: [
                    {
                        lead: '推荐搭配自然语义预设',
                        body: '建议去「提示词 → 故事插画」选用「故事插画 · 中文自然语义」或「故事插画 · 自然语言」；默认生图配置不绑定多余前后缀，如需限定画风可在提示词预设中选择日系二次元、半写实厚涂、电影感摄影或唯美水彩插画，有特殊请求参数可填在底部「自定义请求参数 JSON」。',
                    },
                ],
            },
        ],
    },
    grok: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'xAI Grok Imagine 配置指引',
        subtitle: '支持 Grok Imagine 系列模型原生画幅比例与 1K / 2K 分辨率切换',
        cards: [
            {
                title: '1. 连接与可用模型',
                highlight: true,
                badge: '接口对接',
                bullets: [
                    {
                        lead: '官方与代理切换',
                        body: '支持 `xAI Grok 官方` 与「自定义中转 / 代理」，已内置 `grok-imagine-image`、`2.0`、`pro` 及经典 `grok-2-image-1212`。',
                    },
                    {
                        lead: '拉取或手填模型名',
                        body: '填写 API Key 后可点击「测试连接/拉取模型」获取最新列表，或通过「自定义模型标识」覆盖目标模型名。',
                    },
                ],
            },
            {
                title: '2. 画幅比例与 1K / 2K 分辨率联动',
                badge: '能力适配',
                bullets: [
                    {
                        lead: '按模型支持度自动显示',
                        body: '`grok-imagine-image` 系列支持原生的「画幅比例」（可选「自动 (由模型决定)」或具体比例）与 `1K / 2K`「分辨率档位」切换；切回旧版 `grok-2-image` 模型时会自动隐藏不支持的选项。',
                    },
                ],
            },
            {
                title: '3. 自然语言描述与扩展参数',
                badge: '输入特点',
                badgeMuted: true,
                bullets: [
                    {
                        lead: '完整保留中文与英文长句（推荐切换故事插画预设）',
                        body: '直接用中英文自然句段描述画面即可，建议将「提示词 → 故事插画」切换为「中文自然语义」或「自然语言」；默认不绑定前后缀，也可按需选择快捷画风或向底部「自定义请求参数 JSON」补充额外字段。',
                    },
                ],
            },
        ],
    },
};

const PROMPTS_GUIDE_CONTENT: GuidePageContent = {
    kicker: 'ST-DrawAssistant 使用引导 · 提示词设置引导',
    title: '怎么教 AI 输出画图词？提示词与素材搭配',
    subtitle: '像内置小型世界书一样按需开关；已有外部绘画世界书时也能一键全关共存',
    cards: [
        {
            title: '1. 插件提示词、外部世界书与「词库」的分工',
            highlight: true,
            badge: '必看概念',
            bullets: [
                {
                    lead: '四个子页分别管什么',
                    body: '「故事插画」（主引导，教 AI 何时及如何写画图词）、「词汇指导」（常见 tag 参考词库）、「素材创作」（让 AI 顺便输出新角色/服装档案）、「素材注入」（把当前启用的人物和衣服清单发给 AI），触发机制与酒馆世界书一致。',
                },
                {
                    lead: '默认只开「故事插画」省上下文',
                    body: '初次安装默认只开「故事插画」（内置标准标签、NovelAI V4.5、英文自然语言与「中文自然语义」），其余三项默认关闭，不会白耗对话 Token。',
                },
                {
                    lead: '已有外部绘画世界书怎么用',
                    body: '如果你自己在酒馆已经挂了一套绘画世界书，到「提示词 → 启用设置」把四项全关掉就行，插件依然会正常抓取对话里的生图指令并画图。',
                },
                {
                    lead: '别和侧边栏「词库」混淆',
                    body: '左侧「词库」只是你自己手动改提示词时查单词联想用的，绝对不会发送给大模型。',
                },
            ],
        },
        {
            title: '2. 素材管理（角色/服装预设）与简写宏怎么用',
            badge: '角色一致性',
            bullets: [
                {
                    lead: '按部位与穿衣状态建档',
                    body: '在「素材管理」为常用角色和服装按部位填写词条，支持 `通用词|[状态]词` 区分常驻特征、穿衣与露出状态；有专用画师或角色触发词填进触发词栏，原创设定留空即可。',
                },
                {
                    lead: '何时自动启用于上下文',
                    body: '去「素材管理 → 启用设置」为档案选择「关键词触发」或「常驻」（还能直接绑定酒馆角色卡，切换角色卡自动跟随切换），系统会实时汇总成 `{{角色启用列表}}`、`{{服装启用列表}}` 等变量插进开启的提示词里喂给 AI。',
                },
                {
                    lead: 'AI 引用简写宏与自动录卡',
                    body: '让 AI 在生图指令里简写 `角色名($角色名-宏-状态$)`，提交画图前插件会自动展开成完整标签；在「解析设置」开启提取后，遇到 AI 新生成的角色或服装档案还会弹窗提示一键存入素材库。',
                },
            ],
        },
    ],
};

export class OnboardingGuideModal implements Disposable {
    private isDisposed = false;
    private activeSection: GuideSectionId;
    private activeProvider: ProviderType;

    private backdropEl?: HTMLElement;
    private unbindBackdrop?: () => void;
    private kickerEl?: HTMLElement;
    private titleEl?: HTMLElement;
    private subtitleEl?: HTMLElement;
    private providerBarEl?: HTMLElement;
    private bodyEl?: HTMLElement;
    private sectionPillEls = new Map<GuideSectionId, HTMLButtonElement>();
    private providerPillEls = new Map<ProviderType, HTMLButtonElement>();
    private keydownHandler?: (e: KeyboardEvent) => void;

    public constructor(private readonly options: OnboardingGuideModalOptions = {}) {
        this.activeSection = options.section ?? 'plugin';
        this.activeProvider = options.provider ?? 'comfyui';
        this.renderDom();
    }

    private renderDom(): void {
        if (typeof document === 'undefined') {
            return;
        }

        // 1. 弹窗背景遮罩
        const backdrop = document.createElement('div');
        backdrop.className = 'da-modal-backdrop da-onboarding-backdrop st-da-root';
        backdrop.setAttribute('role', 'dialog');
        backdrop.setAttribute('aria-modal', 'true');
        backdrop.setAttribute('aria-label', 'ST-DrawAssistant 使用引导');
        this.backdropEl = backdrop;

        // 2. 弹窗主体卡片容器
        const panel = document.createElement('div');
        panel.className = 'da-onboarding-panel';
        panel.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        backdrop.appendChild(panel);

        // 3. 顶部标题区
        const header = document.createElement('div');
        header.className = 'da-onboarding-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'da-onboarding-title-group';

        const kicker = document.createElement('span');
        kicker.className = 'da-onboarding-kicker';
        this.kickerEl = kicker;

        const title = document.createElement('h3');
        title.className = 'da-onboarding-title';
        this.titleEl = title;

        const subtitle = document.createElement('p');
        subtitle.className = 'da-onboarding-subtitle';
        this.subtitleEl = subtitle;

        titleGroup.appendChild(kicker);
        titleGroup.appendChild(title);
        titleGroup.appendChild(subtitle);
        header.appendChild(titleGroup);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'da-modal-close-btn da-onboarding-close-btn';
        closeBtn.setAttribute('aria-label', '关闭使用引导');
        closeBtn.title = '关闭引导 (Esc)';
        closeBtn.innerHTML = renderIcon('close', 15);
        closeBtn.addEventListener('click', () => this.handleClose());
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // 4. 顶层三大引导板块导航胶囊
        const sectionsBar = document.createElement('div');
        sectionsBar.className = 'da-onboarding-sections';
        this.sectionPillEls.clear();

        for (const sec of GUIDE_SECTIONS) {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'da-onboarding-section-pill';
            pill.setAttribute('data-guide-section', sec.id);

            const num = document.createElement('span');
            num.className = 'da-onboarding-section-num';
            num.textContent = sec.num;

            const label = document.createElement('span');
            label.className = 'da-onboarding-section-label';
            label.textContent = sec.label;

            pill.appendChild(num);
            pill.appendChild(label);
            pill.addEventListener('click', () => {
                this.selectSection(sec.id);
            });

            sectionsBar.appendChild(pill);
            this.sectionPillEls.set(sec.id, pill);
        }
        panel.appendChild(sectionsBar);

        // 5. 服务端设置引导专属 6 服务商二级胶囊栏
        const providerBar = document.createElement('div');
        providerBar.className = 'da-onboarding-provider-bar';
        this.providerBarEl = providerBar;
        this.providerPillEls.clear();

        for (const prov of GUIDE_PROVIDERS) {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'da-onboarding-provider-pill';
            pill.setAttribute('data-guide-provider', prov.id);
            pill.textContent = prov.label;
            pill.addEventListener('click', () => {
                this.selectSection('provider', prov.id);
            });
            providerBar.appendChild(pill);
            this.providerPillEls.set(prov.id, pill);
        }
        panel.appendChild(providerBar);

        // 6. 正文内容滚动容器
        const body = document.createElement('div');
        body.className = 'da-onboarding-body';
        this.bodyEl = body;
        panel.appendChild(body);

        // 7. 底部确认栏
        const footer = document.createElement('div');
        footer.className = 'da-onboarding-footer';

        const hintEl = document.createElement('span');
        hintEl.className = 'da-onboarding-footer__hint';
        hintEl.textContent = '可随时点击顶栏 ? 图标重看，或切换上方标签查阅其他部分';

        const actions = document.createElement('div');
        actions.className = 'da-onboarding-footer__actions';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'da-btn da-btn--primary da-btn--sm da-onboarding-confirm-btn';
        confirmBtn.textContent = '我知道了';
        confirmBtn.addEventListener('click', () => this.handleClose());

        actions.appendChild(confirmBtn);
        footer.appendChild(hintEl);
        footer.appendChild(actions);
        panel.appendChild(footer);

        document.body.appendChild(backdrop);

        // 8. 绑定浮层栈、遮罩点击与 Esc 关闭
        overlayStack.push(
            'onboarding-guide-modal',
            () => this.handleClose(),
            () => this.dispose()
        );

        this.unbindBackdrop = bindBackdropDismiss(backdrop, () => this.handleClose());

        this.keydownHandler = (e: KeyboardEvent) => {
            if (!overlayStack.isTop('onboarding-guide-modal')) {
                return;
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const order: readonly GuideSectionId[] = ['plugin', 'provider', 'prompts'];
                const curIdx = order.indexOf(this.activeSection);
                const delta = e.key === 'ArrowLeft' ? -1 : 1;
                const nextIdx = curIdx + delta;
                if (nextIdx >= 0 && nextIdx < order.length) {
                    e.preventDefault();
                    this.selectSection(order[nextIdx]);
                }
            }
        };
        window.addEventListener('keydown', this.keydownHandler);

        this.renderCurrentContent();
    }

    /**
     * 切换引导板块与（可选）服务端子项。
     */
    public selectSection(section: GuideSectionId, provider?: ProviderType): void {
        if (this.isDisposed) {
            return;
        }
        const nextProvider = provider ?? this.activeProvider;
        if (
            this.activeSection === section &&
            this.activeProvider === nextProvider &&
            this.bodyEl?.childElementCount
        ) {
            return;
        }
        this.activeSection = section;
        this.activeProvider = nextProvider;
        this.renderCurrentContent();
    }

    /** 获取当前激活的引导板块 */
    public getActiveSection(): GuideSectionId {
        return this.activeSection;
    }

    /** 获取当前选中的服务端类型 */
    public getActiveProvider(): ProviderType {
        return this.activeProvider;
    }

    private resolveCurrentContent(): GuidePageContent {
        if (this.activeSection === 'plugin') {
            return PLUGIN_GUIDE_CONTENT;
        }
        if (this.activeSection === 'prompts') {
            return PROMPTS_GUIDE_CONTENT;
        }
        return PROVIDER_GUIDE_MAP[this.activeProvider] ?? PROVIDER_GUIDE_MAP.comfyui;
    }

    private renderCurrentContent(): void {
        const content = this.resolveCurrentContent();
        if (!this.bodyEl) {
            return;
        }

        if (this.kickerEl) {
            this.kickerEl.textContent = content.kicker;
        }
        if (this.titleEl) {
            this.titleEl.textContent = content.title;
        }
        if (this.subtitleEl) {
            this.subtitleEl.textContent = content.subtitle;
        }

        for (const [id, pill] of this.sectionPillEls.entries()) {
            const isActive = id === this.activeSection;
            pill.classList.toggle('is-active', isActive);
            pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }

        if (this.providerBarEl) {
            this.providerBarEl.classList.toggle('is-hidden', this.activeSection !== 'provider');
        }

        for (const [id, pill] of this.providerPillEls.entries()) {
            const isActive = this.activeSection === 'provider' && id === this.activeProvider;
            pill.classList.toggle('is-active', isActive);
            pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }

        this.bodyEl.innerHTML = '';

        // 1. 可选横向工作流示意图（仅插件设置引导展示）
        if (content.flowNodes && content.flowNodes.length > 0) {
            const flowWrap = document.createElement('div');
            flowWrap.className = 'da-onboarding-flow';

            content.flowNodes.forEach((node, idx) => {
                const nodeEl = document.createElement('div');
                nodeEl.className = 'da-onboarding-flow-node';

                const stepBadge = document.createElement('span');
                stepBadge.className = 'da-onboarding-flow-step';
                stepBadge.textContent = node.step;

                const nodeTitle = document.createElement('div');
                nodeTitle.className = 'da-onboarding-flow-title';
                nodeTitle.textContent = node.title;

                const nodeDesc = document.createElement('div');
                nodeDesc.className = 'da-onboarding-flow-desc';
                nodeDesc.textContent = node.desc;

                nodeEl.appendChild(stepBadge);
                nodeEl.appendChild(nodeTitle);
                nodeEl.appendChild(nodeDesc);
                flowWrap.appendChild(nodeEl);

                if (idx < content.flowNodes!.length - 1) {
                    const arrow = document.createElement('div');
                    arrow.className = 'da-onboarding-flow-arrow';
                    arrow.innerHTML = renderIcon('chevronRight', 14);
                    flowWrap.appendChild(arrow);
                }
            });

            this.bodyEl.appendChild(flowWrap);
        }

        // 2. 说明信息卡片组
        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'da-onboarding-cards';

        for (const cardSpec of content.cards) {
            const cardEl = document.createElement('section');
            cardEl.className = cardSpec.highlight
                ? 'da-onboarding-card da-onboarding-card--highlight'
                : 'da-onboarding-card';

            const cardHeader = document.createElement('div');
            cardHeader.className = 'da-onboarding-card__header';

            const cardTitle = document.createElement('h4');
            cardTitle.className = 'da-onboarding-card__title';
            cardTitle.textContent = cardSpec.title;
            cardHeader.appendChild(cardTitle);

            if (cardSpec.badge) {
                const badge = document.createElement('span');
                badge.className = cardSpec.badgeMuted
                    ? 'da-onboarding-card__badge da-onboarding-card__badge--muted'
                    : 'da-onboarding-card__badge';
                badge.textContent = cardSpec.badge;
                cardHeader.appendChild(badge);
            }

            cardEl.appendChild(cardHeader);

            if (cardSpec.bullets.length > 0) {
                const ul = document.createElement('ul');
                ul.className = 'da-onboarding-card__list';
                for (const bullet of cardSpec.bullets) {
                    const li = document.createElement('li');
                    if (bullet.lead) {
                        const strong = document.createElement('strong');
                        strong.textContent = `${bullet.lead}：`;
                        li.appendChild(strong);
                    }
                    this.appendFormattedText(li, bullet.body);
                    ul.appendChild(li);
                }
                cardEl.appendChild(ul);
            }

            cardsWrap.appendChild(cardEl);
        }

        this.bodyEl.appendChild(cardsWrap);
        this.bodyEl.scrollTop = 0;
    }

    /** 将文本中的反引号行内标记安全渲染为 <code> 节点，避免 innerHTML XSS 风险 */
    private appendFormattedText(container: HTMLElement, rawText: string): void {
        const segments = rawText.split(/(`[^`]+`)/g);
        for (const seg of segments) {
            if (!seg) continue;
            if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
                const codeEl = document.createElement('code');
                codeEl.className = 'da-onboarding-inline-code';
                codeEl.textContent = seg.slice(1, -1);
                container.appendChild(codeEl);
            } else {
                container.appendChild(document.createTextNode(seg));
            }
        }
    }

    private handleClose(): void {
        const onClose = this.options.onClose;
        this.dispose();
        onClose?.();
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        overlayStack.remove('onboarding-guide-modal');

        if (this.unbindBackdrop) {
            this.unbindBackdrop();
            this.unbindBackdrop = undefined;
        }

        if (this.keydownHandler && typeof window !== 'undefined') {
            window.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = undefined;
        }

        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = undefined;
        this.providerBarEl = undefined;
        this.bodyEl = undefined;
        this.sectionPillEls.clear();
        this.providerPillEls.clear();
    }
}

/**
 * 打开三段式分场景使用引导弹窗。
 *
 * @param options 引导窗配置项
 * @returns 资源释放句柄
 */
export function openOnboardingGuideModal(
    options: OnboardingGuideModalOptions = {}
): OnboardingGuideModal {
    return new OnboardingGuideModal(options);
}
