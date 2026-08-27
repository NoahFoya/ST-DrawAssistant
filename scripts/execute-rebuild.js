const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

function run(cmd) {
  console.log(`> ${cmd}`);
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (out.trim()) console.log(out.trim());
}

const milestones = [
  {
    version: 'v0.1.0',
    source: '2a0698c',
    message: [
      'feat(release): v0.1.0 — 插件基础架构搭建与 ComfyUI 生图对接',
      '',
      '- 插件接入：对接 SillyTavern 扩展 API，监听会话加载与消息接收等事件',
      '- 生图驱动：实现 ComfyUI 绘图接口调用，支持 WebSocket 实时进度追踪与图片数据接收',
      '- 任务管理：建立生图任务调度机制，支持任务排队与状态跟踪',
      '- 界面嵌入：在聊天消息楼层底部原位添加生图按钮与生成进度条',
      '- 设置面板：支持配置绘图服务器地址、图像参数（尺寸、步数、CFG、采样器）与提示词前缀'
    ].join('\n')
  },
  {
    version: 'v0.2.0',
    source: 'e983459',
    message: [
      'feat(release): v0.2.0 — 蓝图可视化编辑器、生图统计看板与主题系统',
      '',
      '- 蓝图编辑器：新增网格画布编辑器，支持拖拽缩放、节点参数配置与提示词变量绑定',
      '- 统计看板：新增生图数据统计，可视化展示生图总量、成功率与生成耗时趋势',
      '- 主题系统：新增 5 套界面主题（黑曜极光、蓝天白云、翡翠深林、赛博霓虹、macOS 暮光）',
      '- 本地缓存：接入 IndexedDB 本地数据库存储图片，支持 WebP 缩略图缓存，减轻对话数据负担',
      '- 图片详情：新增图片信息面板，支持单独查看和复制正反向提示词与生成参数'
    ].join('\n')
  },
  {
    version: 'v0.3.0',
    source: '13224a0',
    message: [
      'feat(release): v0.3.0 — SD-WebUI 引擎支持、角色管理器与提示词流水线',
      '',
      '- 引擎扩展：新增 Stable Diffusion WebUI (AUTOMATIC1111) 生图支持，与 ComfyUI 并列可选',
      '- 角色管理：新增角色管理器扩展，支持角色卡导入、画风预设、服装搭配与提示词自动注入',
      '- 语法支持：支持 ComfyUI WeiLin LoRA 标签格式（<wlr:name:model:clip:trigger>）解析',
      '- 架构优化：引入事件总线与资源释放机制，构建提示词处理流水线',
      '- 控件扩充：重构通用 UI 控件库与弹窗组件'
    ].join('\n')
  },
  {
    version: 'v0.3.5',
    source: '47aac25',
    message: [
      'feat(release): v0.3.5 — 核心代码分层重构、驱动基类抽象与图片存储优化',
      '',
      '- 架构重构：代码重组为核心层、领域层、界面层与扩展层，清理废弃历史模块',
      '- 驱动基类：抽象通用生图驱动基类，统一请求超时、异常拦截与 ComfyUI 任务中断',
      '- 存储优化：升级本地存储适配器，支持 SHA-256 图片去重与存储空间上限自动清理',
      '- 变量管理：独立提示词模板变量模块，预设配置文件统一迁移至 config/presets/ 目录',
      '- 单元测试：新增 Vitest 自动化测试套件，覆盖核心业务逻辑与驱动功能'
    ].join('\n')
  },
  {
    version: 'v0.4.0',
    source: '5f012a4',
    message: [
      'feat(release): v0.4.0 — 多后端支持、LoRA 管理器与在线更新功能',
      '',
      '- 后端扩展：新增 OpenAI 兼容接口与 NovelAI V4 绘图支持',
      '- LoRA 管理：新增独立 LoRA 管理器，支持模型与触发词权重精细调节及缺失检测提示',
      '- 变量辅助：支持工作流变量输入推荐与变量格式自动校验',
      '- 在线更新：支持 CSRF 鉴权、后台自动检测新版本与插件内一键更新',
      '- 预设保护：引入预设编辑副本机制，编辑中未保存的配置不会意外覆盖原预设',
      '- 样式整理：设置界面全面组件化，内联样式迁移至 CSS 样式表'
    ].join('\n')
  },
  {
    version: 'v0.5.0',
    source: 'staging/clean-v0.5.0',
    message: [
      'feat(release): v0.5.0 — 界面组件分层、布局系统重写与代码整理',
      '',
      '- 组件分层：将界面拆分为基础控件、布局容器、复合组件与页面视图四个独立层级',
      '- 布局重写：新增网格容器组件，支持多种对齐排版，表单控件支持响应式自适应宽度',
      '- 主题修复：清除浅色模式下的硬编码色值，明暗主题切换即时生效、颜色正常',
      '- 更新修复：对接 SillyTavern 原生扩展更新接口，解决版本更新提示不准确的问题',
      '- 面板重组：ComfyUI 规范为 5 大功能卡片，LoRA 开关与名称同行显示，操作按钮归位头部',
      '- 代码优化：统一样式类命名规范，删除残留废弃模块与跨层直接引用，构建开启 Source Map'
    ].join('\n')
  }
];

console.log('=== Step 1: Checkout main and reset to initial commit ===');
run('git checkout main');
run('git reset --hard ebd7e6b');

milestones.forEach((m, idx) => {
  console.log(`\n=== Batch ${idx + 1} / 6: Rebuilding ${m.version} from ${m.source} ===`);
  const msgFile = path.join(os.tmpdir(), `milestone_msg_${idx + 1}.txt`);
  fs.writeFileSync(msgFile, m.message, 'utf8');

  run('git rm -rf .');
  run(`git checkout ${m.source} -- .`);
  run('git add -A');
  run(`git commit -F "${msgFile}"`);
  run(`git tag -f -a ${m.version} HEAD -m "Release ${m.version}"`);
});

console.log('\n=== Step 3: Align dev branch to main ===');
run('git checkout dev');
run('git reset --hard main');
run('git checkout main');

console.log('\n=== All Batches Successfully Rebuilt ===');
