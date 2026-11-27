/**
 * 三段式分场景使用引导弹窗 (OnboardingGuideModal)。
 *
 * @remarks
 * 1. 按功能模块拆分为「插件设置引导」「服务端设置引导（6 个生图服务独立说明）」「提示词设置引导」三大单页板块；
 * 2. 采用渐进分层阅读设计：首页浓缩为「3 步跑通清单」与精炼要点卡，复杂配置与排障细则收进默认折叠区；
 * 3. 首次进入对应页面自动定位并弹出，也可由设置顶栏 ? 图标重开，并支持底部直达对应配置页面；
 * 4. 接入 OverlayStack 集中层级管理，支持 Esc 键、遮罩点击与「我知道了」退出。
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
    /** 点击底部「前往配置页」快捷跳转回调 */
    readonly onNavigateTarget?: (targetTabId: string) => void;
}

interface GuideCardSpec {
    readonly title: string;
    readonly badge?: string;
    readonly badgeMuted?: boolean;
    readonly highlight?: boolean;
    readonly bullets: ReadonlyArray<{ readonly lead?: string; readonly body: string }>;
}

interface GuideDetailBlock {
    readonly summary: string;
    readonly badge?: string;
    readonly items: ReadonlyArray<{ readonly lead?: string; readonly body: string }>;
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
    readonly flowNodes: readonly GuideFlowNode[];
    readonly cards: readonly GuideCardSpec[];
    readonly details?: readonly GuideDetailBlock[];
    readonly targetTabId: string;
    readonly targetLabel: string;
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
    title: '3 步快速上手：在酒馆聊天里生成图片',
    subtitle: '插件本身不内置画图模型，只需连上外部本地或云端服务即可开始出图',
    targetTabId: 'general',
    targetLabel: '前往「插件设置」',
    flowNodes: [
        {
            step: '步骤 01',
            title: '选定并连上生图服务',
            desc: '选好「生图服务」后切到对应页填写地址或 API Key 并点测连接',
        },
        {
            step: '步骤 02',
            title: '开启故事插画提示词',
            desc: '默认已开启「故事插画」教 AI 输出指令；若自有绘画世界书可按需关掉',
        },
        {
            step: '步骤 03',
            title: '在楼层出图与编辑',
            desc: '发送对话后点「点击生图」（或开自动出图），支持看大图、拖拽分享与重绘',
        },
    ],
    cards: [
        {
            title: '核心前提与连接建议',
            highlight: true,
            badge: '必看',
            bullets: [
                {
                    lead: '默认用「浏览器直连」',
                    body: '本机跑图或常见云端接口直接用直连最快；只有远端 HTTPS 酒馆连本地 HTTP 服务被浏览器拦下时，才需要切到「酒馆代理」。',
                },
                {
                    lead: '图片保存与跨应用分享',
                    body: '图片存在当前浏览器里，不会撑大聊天记录；支持拖入 QQ 等桌面应用、点编辑角落调整重绘，下载原图还可保留绘图参数供 ComfyUI 查看。',
                },
            ],
        },
        {
            title: '日常实用功能',
            badge: '按需开启',
            badgeMuted: true,
            bullets: [
                {
                    lead: '自动出图与悬浮球快捷面板',
                    body: '开启「AI 回复后自动出图」可免手动点击；到「悬浮球」打开快捷面板后，单击悬浮球就能快速微调画幅和开关。',
                },
                {
                    lead: '词库与全局正则是分开的',
                    body: '左侧「词库」只管手打输入框时的联想补全，不会发给 AI；思考内容折叠与历史标记清理则会自动同步进酒馆正则库。',
                },
            ],
        },
    ],
    details: [
        {
            summary: '展开细节：酒馆代理白名单、TauriTavern 限制与标记清洗说明',
            badge: '进阶详情',
            items: [
                {
                    lead: '「酒馆代理」启用前提',
                    body: '需要在 SillyTavern `config.yaml` 打开 `enableCorsProxy: true`；若同时启用了 `privateAddressWhitelist`，访问本机或局域网服务时要把对应 IP 加进 `allowedRanges`。',
                },
                {
                    lead: 'TauriTavern 与局部重绘限制',
                    body: 'TauriTavern 桌面/移动外壳不提供 `/proxy/` 转发，请保持「浏览器直连」；ComfyUI 局部重绘需要上传图片表单，也仅支持「浏览器直连」。',
                },
                {
                    lead: '生图标记与标点整理',
                    body: '默认按 `image### 正向 | 负向 ###` 识别指令（支持内部多行与分块）。「提示词 Tags 自动去重」与「标点与空行自动整理」默认开启，「中文标点转英文逗号」默认关闭以保留中文自然语义。',
                },
                {
                    lead: '思考隐藏与历史清理机制',
                    body: '「绘图与设计思考」显示方式与历史标记清理会写入酒馆全局正则，仅隐藏过程标签或减少后续上下文开销（停用本插件后仍可在酒馆中持续生效）。',
                },
            ],
        },
    ],
};

const PROVIDER_GUIDE_MAP: Record<ProviderType, GuidePageContent> = {
    comfyui: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'ComfyUI 上手清单：开跨域 ➔ 测连接 ➔ 选工作流',
        subtitle: '90% 连不上是因为没加跨域参数；先确认工作流选 Checkpoint 还是 UNet',
        targetTabId: 'comfyui',
        targetLabel: '前往 ComfyUI 设置',
        flowNodes: [
            {
                step: '步骤 01',
                title: '启动器开启跨域',
                desc: '给 ComfyUI 加上 `--enable-cors-header *` 后重启服务端',
            },
            {
                step: '步骤 02',
                title: '测试连接并同步模型',
                desc: '填入 `http://127.0.0.1:8188`，点击卡片右上角拉取底模与采样器',
            },
            {
                step: '步骤 03',
                title: '匹配模型与工作流',
                desc: '单文件整合模型选 Checkpoint 工作流；Flux/Qwen 等分立模型选 UNet 并配齐 CLIP/VAE',
            },
        ],
        cards: [
            {
                title: '先做这两件事就能出图',
                highlight: true,
                badge: '快速跑通',
                bullets: [
                    {
                        lead: '浏览器先确认地址可访问',
                        body: '确认本机浏览器能直接打开 `http://127.0.0.1:8188`，再到插件里填好同地址点「测试连接/同步模型」。',
                    },
                    {
                        lead: '分清 Checkpoint 与 UNet 工作流',
                        body: 'SDXL / Illustrious / NoobAI / Pony 单文件整合底模选「默认 Checkpoint 模型文生图」（CLIP/VAE 留内置即可）；Flux / Qwen-Image / MOSS / Anima 等分立底模选「默认 UNet 模型文生图」并指定配套 CLIP 和 VAE。',
                    },
                    {
                        lead: '怎么固定自己的画风',
                        body: '默认「故事插画」不带画质词，需要固定风格起手式和 LoRA 请在当前页最底部的「提示词预设」配置。',
                    },
                ],
            },
        ],
        details: [
            {
                summary: '展开细节：不同启动方式跨域命令、导入自用工作流 (API) 与局部重绘排障',
                badge: '展开排障',
                items: [
                    {
                        lead: '秋叶绘世整合包启动器',
                        body: '在启动器「高级选项 / 启动参数」开启允许跨域访问，或在额外参数填入 `--enable-cors-header *`（同局域网手机平板访问请同步勾选开放远程连接）。',
                    },
                    {
                        lead: '官方便携包与桌面版 (Windows / Desktop)',
                        body: '便携包编辑 `run_nvidia_gpu.bat` 在 `main.py` 后加上 `--listen 127.0.0.1 --enable-cors-header *`（局域网访问将 `127.0.0.1` 改为 `0.0.0.0`）；Desktop 版在设置附加 `--enable-cors-header *`。',
                    },
                    {
                        lead: '导出并用好自己的工作流（记住 Export API）',
                        body: '新版网页点顶部 `工作流 (Workflow) → 导出 (API) / Export (API)`；旧版网页先开设置里的 `Enable Dev mode Options` 再点 `Save (API Format)`（普通 Save 导出的 JSON 无法运行）。导入底部管理区后点「格式化变量」或「打开蓝图」调整加载器。',
                    },
                    {
                        lead: 'WeiLin 节点、局部重绘与报错排查',
                        body: '自定义工作流含 `WeiLinPromptUI` 时将按 `<wlr:...>` 发送，需确保服务端安装 `ComfyUI-WeiLin` 插件；局部重绘需在底部导入含底图和蒙版节点的工作流并绑定；失败时报错弹窗会直接定位出问题的节点名称。',
                    },
                ],
            },
        ],
    },
    sdwebui: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'SD-WebUI / Forge 上手清单：开 API 与跨域即可直连',
        subtitle: '原生支持高清修复、LoRA 关键词触发以及画板局部重绘',
        targetTabId: 'sdwebui',
        targetLabel: '前往 SD-WebUI 设置',
        flowNodes: [
            {
                step: '步骤 01',
                title: '补充启动参数',
                desc: '启动脚本加入 `--api --cors-allow-origins=*` 后重启',
            },
            {
                step: '步骤 02',
                title: '同步底模与采样器',
                desc: '地址填 `http://127.0.0.1:7860` 并点击「测试连接/同步模型」',
            },
            {
                step: '步骤 03',
                title: '配置起手式与 LoRA',
                desc: '在底部「提示词预设」设置固定正负向起手词并可开多画风轮询',
            },
        ],
        cards: [
            {
                title: '常用参数建议',
                highlight: true,
                badge: '上手要点',
                bullets: [
                    {
                        lead: 'VAE 与 Clip Skip 怎么填',
                        body: '自带烘焙 VAE 的底模保持 `自动匹配 (automatic)` 即可；二次元 / Illustrious / Pony 模型推荐 `CLIP 跳过层数` 设 `2`，传统写实或标准 SDXL 模型多设 `1`。',
                    },
                    {
                        lead: 'LoRA 触发与局部重绘',
                        body: '底部「提示词预设」内支持把多个 LoRA 设为常驻或关键词自动挂载，切「使用轮询」可多画风随机抽签；直接对聊天图片右键/长按即可打开画板做局部重绘。',
                    },
                ],
            },
        ],
        details: [
            {
                summary: '展开细节：webui-user.bat 启动参数位置与高清修复推荐数值',
                badge: '参数细节',
                items: [
                    {
                        lead: '启动脚本修改位置',
                        body: '编辑 `webui-user.bat`，在 `set COMMANDLINE_ARGS=` 后同时加上 `--api` 和 `--cors-allow-origins=*`。',
                    },
                    {
                        lead: '高清修复 (Hires. fix) 参考搭配',
                        body: '想进一步精细五官细节可开启高清修复：二次元常用算法 `R-ESRGAN 4x+ Anime6B`，二次步数 `10~20`，重绘幅度建议 `0.35~0.50`。',
                    },
                ],
            },
        ],
    },
    novelai: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'NovelAI 上手清单：填好访问密钥即可出图',
        subtitle: '官方地址已内置，自动适配 V4 / V4.5 / V5 原生权重与 V3 经典参数',
        targetTabId: 'novelai',
        targetLabel: '前往 NovelAI 设置',
        flowNodes: [
            {
                step: '步骤 01',
                title: '填入 API Token',
                desc: '粘贴 NovelAI 账户后台生成的 Persistent API Token（无需拉取模型列表）',
            },
            {
                step: '步骤 02',
                title: '选定模型与采样',
                desc: '推荐 `NAI Diffusion V4.5 Full` + `k_euler_ancestral` + `karras` 调度器',
            },
            {
                step: '步骤 03',
                title: '搭配画师串起手式',
                desc: '到底部「提示词预设」挑选官方画质/画师预设，或开启「使用轮询」',
            },
        ],
        cards: [
            {
                title: '权重语法与画风说明',
                highlight: true,
                badge: 'V4+ 适配',
                bullets: [
                    {
                        lead: '括号权重会自动转换',
                        body: '开启「权重语法自动转换」后，常规 `(tag:1.2)` 会自动转换成 V4 / V4.5 / V5 原生的 `1.2::tag::`（选用 V3 时自动兼容为 `{}` / `[]`）。',
                    },
                    {
                        lead: '国内直连超时怎么办',
                        body: '标准节点版酒馆可在「插件设置」切「酒馆代理」；若使用不支持代理的 TauriTavern 外壳，请将顶部「服务商」切为「自定义服务」填入允许跨域的中转地址。',
                    },
                ],
            },
        ],
        details: [
            {
                summary: '展开细节：V3 模型与 V4 / V4.5 / V5 专属参数差异',
                badge: '型号区别',
                items: [
                    {
                        lead: 'SMEA 与焦黑抑制仅 V3 适用',
                        body: '只有选用 V3 系列模型时才需要下方的 `SMEA 采样增强`（高分可选 `SMEA + DYN`）与 `焦黑抑制 (Decrisper)`；V4 / V4.5 / V5 已内置优化，切换至新版模型时界面会自动禁用这两项以防误开。',
                    },
                    {
                        lead: '关于 Full 与 Curated 模型',
                        body: '配合复杂画师串和多元构图优先选 `Full`；偏好标准简洁画面可选 `Curated`。',
                    },
                ],
            },
        ],
    },
    openai: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'OpenAI 兼容上手清单：支持官方与标准中转站',
        subtitle: '适配 GPT Image、DALL-E 3、硅基流动及 OneAPI 等常见兼容接口',
        targetTabId: 'openai',
        targetLabel: '前往 OpenAI 兼容设置',
        flowNodes: [
            {
                step: '步骤 01',
                title: '选择模板或自定地址',
                desc: '选 `OpenAI 官方`、`SiliconFlow` 或切「自定义服务」填 `/v1` 根地址与 Key',
            },
            {
                step: '步骤 02',
                title: '测试或手填模型名',
                desc: '点「测试连接/拉取模型」，中转未开放列表时可直接在「自定义模型标识」手填',
            },
            {
                step: '步骤 03',
                title: '切换自然语言提示词',
                desc: '强烈建议同步前往「提示词 → 故事插画」选「中文自然语义」或「自然语言」',
            },
        ],
        cards: [
            {
                title: '搭配建议与模型参数',
                highlight: true,
                badge: '关键搭配',
                bullets: [
                    {
                        lead: '画幅自适应「自动 (由模型决定)」',
                        body: 'GPT Image 与标准兼容接口均支持「自动 (由模型决定)」尺寸比例，由模型依描写自动决定横竖构图。',
                    },
                    {
                        lead: '默认生图不绑定多余前后缀',
                        body: '已内置日系二次元、半写实厚涂、电影感摄影、唯美水彩 4 套风格预设，需要统一画风时在底部「提示词预设」选用即可。',
                    },
                ],
            },
        ],
        details: [
            {
                summary: '展开细节：GPT Image 与 DALL-E 3 参数区别及扩展 JSON',
                badge: '扩展参数',
                items: [
                    {
                        lead: 'GPT Image vs DALL-E 3 专有参数',
                        body: '`GPT Image` 支持画质档位、透明背景（需搭配 png/webp）及输出格式；`DALL-E 3` 支持 `standard/hd` 画质与 `vivid/natural` 风格切换。',
                    },
                    {
                        lead: '自定义请求参数 JSON',
                        body: '仅当第三方中转站要求传入额外键值字段时才需在底部填写标准 JSON，常规情况留空即可。',
                    },
                ],
            },
        ],
    },
    gemini: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'Google Gemini 上手清单：按模型自动匹配分辨率',
        subtitle: '对接官方或中转接口，支持 2.5 Flash、3.1 Flash、3 Pro 与 nano-banana 系列',
        targetTabId: 'gemini',
        targetLabel: '前往 Gemini 设置',
        flowNodes: [
            {
                step: '步骤 01',
                title: '填写地址与 API Key',
                desc: '选择官方直连或自定义中转/代理地址后点击「测试连接/拉取模型」',
            },
            {
                step: '步骤 02',
                title: '选画幅比例与清晰度',
                desc: '选好「画幅比例」（可选「自动 (由模型决定)」）与界面显示出来的分辨率档位',
            },
            {
                step: '步骤 03',
                title: '改用自然语言故事预设',
                desc: '在「提示词 → 故事插画」启用「中文自然语义」或「自然语言」出图效果更佳',
            },
        ],
        cards: [
            {
                title: '型号能力与搭配要点',
                highlight: true,
                badge: '能力联动',
                bullets: [
                    {
                        lead: '清晰度会随模型自动显隐',
                        body: '各型号支持的能力不同，页面只展示当前模型真正支持的分辨率选项，未出现的模型名可用「自定义模型标识」填写。',
                    },
                    {
                        lead: '画风可控且默认纯净',
                        body: '默认配置不附加风格前后缀，想固定二次元、厚涂、实拍电影或水彩风格时，到底部「提示词预设」切换即可。',
                    },
                ],
            },
        ],
        details: [
            {
                summary: '展开细节：各型号分辨率档位支持对照与扩展 JSON',
                badge: '型号对照',
                items: [
                    {
                        lead: '分辨率支持清单',
                        body: '`2.5 Flash Image` 仅支持默认尺寸会自动隐藏清晰度栏；`3.1 Flash` 支持 `512px / 1K / 2K / 4K`；`3 Pro` 支持 `1K / 2K / 4K`；不支持固定分档时可选「自动」。',
                    },
                    {
                        lead: '扩展请求参数 JSON',
                        body: '需要传入 `safetySettings` 等高级参数时，可在底部「自定义请求参数 JSON」补充标准 JSON。',
                    },
                ],
            },
        ],
    },
    grok: {
        kicker: 'ST-DrawAssistant 使用引导 · 服务端设置引导',
        title: 'xAI Grok Imagine 上手清单：支持原生比例与 1K / 2K',
        subtitle: '内置 grok-imagine-image 系列及经典 grok-2-image 模型',
        targetTabId: 'grok',
        targetLabel: '前往 xAI Grok 设置',
        flowNodes: [
            {
                step: '步骤 01',
                title: '填入 xAI Key',
                desc: '选用官方或自定义中转代理地址，填入 Bearer Key 并测试拉取模型',
            },
            {
                step: '步骤 02',
                title: '确认比例与分辨率',
                desc: 'Imagine 系列可选原生「画幅比例」（含「自动 (由模型决定)」）与 `1K / 2K` 清晰度',
            },
            {
                step: '步骤 03',
                title: '搭配自然语言故事预设',
                desc: '到「提示词 → 故事插画」切为「中文自然语义」或「自然语言」描述长句',
            },
        ],
        cards: [
            {
                title: '模型与画风说明',
                highlight: true,
                badge: '使用要点',
                bullets: [
                    {
                        lead: '参数随模型自动适配',
                        body: '`grok-imagine-image` 系列开放原生比例（支持「自动 (由模型决定)」）与 `1K / 2K` 分辨率档位；切回旧版 `grok-2-image` 时不支持的选项会自动隐藏。',
                    },
                    {
                        lead: '直接描述自然长句',
                        body: '默认不绑定前后缀，需要固定整体视觉画风可在底部「提示词预设」挑选风格，额外字段可填入最下方 JSON 扩展框。',
                    },
                ],
            },
        ],
    },
};

const PROMPTS_GUIDE_CONTENT: GuidePageContent = {
    kicker: 'ST-DrawAssistant 使用引导 · 提示词设置引导',
    title: '提示词与素材分工：怎么让 AI 画出准确一致的角色？',
    subtitle: '仅默认开启「故事插画」，其余三项按需启用；自有外部世界书也可随时全关共存',
    targetTabId: 'prompts',
    targetLabel: '前往「提示词」设置',
    flowNodes: [
        {
            step: '步骤 01',
            title: '选合拍的故事预设',
            desc: '二次元标签模型选「标准标签 / NovelAI」，自然语言模型切「中文自然语义 / 自然语言」',
        },
        {
            step: '步骤 02',
            title: '在服务页定好画风',
            desc: '到对应生图服务页底部「提示词预设」设置画质与固定画风起手式',
        },
        {
            step: '步骤 03',
            title: '按需开启素材档案',
            desc: '需要长期稳定人物长相和衣着时，再录入「素材管理」并开启「素材注入」',
        },
    ],
    cards: [
        {
            title: '四个子页与「词库」的分工',
            highlight: true,
            badge: '必看概念',
            bullets: [
                {
                    lead: '「提示词」管发给 AI 的内容',
                    body: '「故事插画」负责教 AI 什么时候写、怎么写画图指令（如想只用外部绘画世界书，到「提示词 → 启用设置」全关掉即可，插件仍会自动抓图）。',
                },
                {
                    lead: '「词库」只负责本地手打联想',
                    body: '左侧「词库」只在自己改框时查词补全用，不会发送给大语言模型占用对话空间。',
                },
                {
                    lead: '默认不写画质与画风词（防止画风偏移）',
                    body: '内置「故事插画」只管写清情节画面、构图、人物和光影；固定画风与画质起手式统一放在生图服务页底部的「提示词预设」里管理。',
                },
            ],
        },
    ],
    details: [
        {
            summary: '展开细节：固定画风与画质起手式、三段式简写宏与自动建档说明',
            badge: '进阶用法',
            items: [
                {
                    lead: '固定画风与画质起手式',
                    body: '前往所用生图服务页底部的「提示词预设」填好正向起手前缀、后缀和负向词，支持绑定多画风并开启「使用轮询」，能有效避免每次生成出现画风偏移。',
                },
                {
                    lead: '素材建档按状态分层',
                    body: '在「素材管理」填写角色和服装各部位词条，支持 `通用词|[状态]词` 区分角色身体遮蔽态（`covered` / `exposed` / `nude`，均不含衣物）和服装穿脱态（`intact` / `disheveled`），原创无专用触发词时触发栏留空。',
                },
                {
                    lead: '关联角色卡与简写宏展开',
                    body: '在「素材管理 → 启用设置」选中「常驻」或「关键词触发」（可绑定酒馆角色卡随对话自动切换），启用的资料会通过 `{{角色启用列表}}` 与 `{{服装启用列表}}` 发给 AI，AI 只需写 `角色名($角色名-宏-状态$)`，生图前自动展开。开启「解析设置」还可在 AI 输出新设定时弹窗自动录入。',
                },
                {
                    lead: '其他三项可选提示词说明',
                    body: '「词汇指导」补充常见 Danbooru 标签词表参考；「素材创作」引导 AI 按结构化格式自动生成新角色和服装档案；「素材注入」负责把已启用的材料清单与宏规则带入对话。',
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
    private gotoBtnEl?: HTMLButtonElement;
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
        hintEl.textContent = '可随时点击顶栏 ? 图标重看';

        const actions = document.createElement('div');
        actions.className = 'da-onboarding-footer__actions';

        if (this.options.onNavigateTarget) {
            const gotoBtn = document.createElement('button');
            gotoBtn.type = 'button';
            gotoBtn.className = 'da-btn da-btn--secondary da-btn--sm da-onboarding-goto-btn';
            gotoBtn.addEventListener('click', () => {
                const targetTabId = this.resolveCurrentContent().targetTabId;
                const onNavigate = this.options.onNavigateTarget;
                this.handleClose();
                onNavigate?.(targetTabId);
            });
            this.gotoBtnEl = gotoBtn;
            actions.appendChild(gotoBtn);
        }

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
        if (this.gotoBtnEl) {
            this.gotoBtnEl.textContent = content.targetLabel;
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

        // 3. 默认折叠的细节与排障扩展区块
        if (content.details && content.details.length > 0) {
            for (const detailSpec of content.details) {
                const detailsEl = document.createElement('details');
                detailsEl.className = 'da-onboarding-details';

                const summaryEl = document.createElement('summary');
                summaryEl.className = 'da-onboarding-details__summary';

                const summaryLeft = document.createElement('span');
                summaryLeft.className = 'da-onboarding-details__summary-text';
                summaryLeft.textContent = detailSpec.summary;
                summaryEl.appendChild(summaryLeft);

                if (detailSpec.badge) {
                    const badgeEl = document.createElement('span');
                    badgeEl.className = 'da-onboarding-card__badge da-onboarding-card__badge--muted';
                    badgeEl.textContent = detailSpec.badge;
                    summaryEl.appendChild(badgeEl);
                }

                detailsEl.appendChild(summaryEl);

                const ul = document.createElement('ul');
                ul.className = 'da-onboarding-card__list da-onboarding-details__list';
                for (const item of detailSpec.items) {
                    const li = document.createElement('li');
                    if (item.lead) {
                        const strong = document.createElement('strong');
                        strong.textContent = `${item.lead}：`;
                        li.appendChild(strong);
                    }
                    this.appendFormattedText(li, item.body);
                    ul.appendChild(li);
                }
                detailsEl.appendChild(ul);
                this.bodyEl.appendChild(detailsEl);
            }
        }

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
        this.gotoBtnEl = undefined;
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
