/**
 * 统一矢量图标定义模块 (Icons)。
 *
 * @remarks
 * 提供全插件统一规格的内联 SVG 矢量图标，替代散落的 Emoji 字符与重复内联定义：
 * - 严格区分保存（`save`，软盘图标）与下载（`download`，下箭头指向托盘）；
 * - 预设导入导出采用标准对称托盘箭头对（`import` / `upload` 向上箭头导入，`export` / `download` 向下箭头导出）；
 * - 元信息统一使用圆圈感叹号（`info`，`!` 图标）；
 * - 收藏统一使用星标描边（`star`）与星标实心（`starFilled`）。
 */

const SVG_PATHS = {
    /** 软盘保存图标（用于保存预设/配置） */
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>',
    /** 下箭头下载图标（用于下载图片/文件到本地） */
    download:
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    /** 上箭头上传图标 */
    upload:
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
    /** 导入图标（托盘向上箭头，用于从本地载入预设文件） */
    import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
    /** 导出图标（托盘向下箭头，用于将预设导出下载到本地） */
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    /** 文件导入图标（向内箭头进入文件，与 SillyTavern fa-file-import 风格一致） */
    fileImport:
        '<path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M2 15h10"></path><path d="m9 18 3-3-3-3"></path>',
    /** 文件导出图标（向外箭头离开文件，与 SillyTavern fa-file-export 风格一致） */
    fileExport:
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 15h10"></path><path d="m18 11 4 4-4 4"></path>',
    /** 元信息感叹号 `!` 图标（圆圈内感叹号） */
    info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
    /** 帮助问号 `?` 图标（圆圈内问号，用于使用引导与规则说明） */
    helpCircle:
        '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    /** 未收藏描边星标 */
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>',
    /** 已收藏实心星标 */
    starFilled:
        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"></polygon>',
    /** 新建/添加加号 */
    plus: '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
    /** 减号 */
    minus: '<line x1="5" y1="12" x2="19" y2="12"></line>',
    /** 确认对勾 */
    check: '<polyline points="20 6 9 17 4 12"></polyline>',
    /** 复制 */
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    /** 编辑/重命名 */
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>',
    /** 外发/导出/外部链接 */
    external:
        '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
    /** 刷新/重置/重新生成 */
    refresh:
        '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    /** 删除垃圾桶 */
    trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
    /** 关闭叉号 */
    close: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    /** 参数调节/微调重绘滑杆 */
    sliders:
        '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line>',
    /** 画笔/涂抹工具 */
    brush:
        '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"></path><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"></path>',
    /** 橡皮擦 */
    eraser:
        '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"></path><path d="M22 21H7"></path><path d="m5 11 9 9"></path>',
    /** 搜索放大镜 */
    search: '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
    /** 放大 */
    zoomIn:
        '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line>',
    /** 缩小 */
    zoomOut:
        '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line>',
    /** 图像图标 */
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>',
    /** 调色盘/绘画 */
    palette:
        '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>',
    /** 星光/生成 */
    sparkles:
        '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path>',
    /** 警告三角 */
    alertTriangle:
        '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    /** 警告图标别名 */
    warning:
        '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    /** 时钟/排队等待 */
    clock: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
    /** 禁用/空圆斜杠 */
    ban: '<circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>',
    /** 标签 */
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
    /** 左箭头 */
    chevronLeft: '<polyline points="15 18 9 12 15 6"></polyline>',
    /** 右箭头 */
    chevronRight: '<polyline points="9 18 15 12 9 6"></polyline>',
    /** 下拉箭头 */
    chevronDown: '<polyline points="6 9 12 15 18 9"></polyline>',
    /** 上下双箭头（展开全部） */
    chevronsUpDown: '<polyline points="7 15 12 20 17 15"></polyline><polyline points="7 9 12 4 17 9"></polyline>',
    /** 向内双箭头（折叠全部） */
    chevronsDownUp: '<polyline points="7 20 12 15 17 20"></polyline><polyline points="7 4 12 9 17 4"></polyline>',
    /** 排序/按顺序重排 */
    arrowUpDown: '<polyline points="7 10 12 5 17 10"></polyline><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="17 14 12 19 7 14"></polyline>',
    /** 开关/批量启用禁用 */
    toggleRight: '<rect x="1" y="5" width="22" height="14" rx="7" ry="7"></rect><circle cx="16" cy="12" r="3"></circle>',
    /** 竖向拖动手柄 (6 点阵) */
    grip: '<circle cx="9" cy="6" r="1.5" fill="currentColor"></circle><circle cx="9" cy="12" r="1.5" fill="currentColor"></circle><circle cx="9" cy="18" r="1.5" fill="currentColor"></circle><circle cx="15" cy="6" r="1.5" fill="currentColor"></circle><circle cx="15" cy="12" r="1.5" fill="currentColor"></circle><circle cx="15" cy="18" r="1.5" fill="currentColor"></circle>',
    /** 明文眼睛 */
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
    /** 密文眼睛划线 */
    eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>',
} as const;

export type IconName = keyof typeof SVG_PATHS;

/**
 * 生成指定尺寸的 SVG 矢量图标字符串。
 *
 * @param name 图标名称
 * @param size 像素宽高尺寸，默认 14
 */
export function renderIcon(name: IconName, size = 14): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG_PATHS[name]}</svg>`;
}

/** 默认 14×14 规格的标准矢量图标字典 */
export const ICONS: Readonly<Record<IconName, string>> = {
    save: renderIcon('save', 14),
    download: renderIcon('download', 14),
    upload: renderIcon('upload', 14),
    import: renderIcon('import', 14),
    export: renderIcon('export', 14),
    fileImport: renderIcon('fileImport', 14),
    fileExport: renderIcon('fileExport', 14),
    info: renderIcon('info', 14),
    helpCircle: renderIcon('helpCircle', 14),
    star: renderIcon('star', 14),
    starFilled: renderIcon('starFilled', 14),
    plus: renderIcon('plus', 14),
    minus: renderIcon('minus', 14),
    check: renderIcon('check', 14),
    copy: renderIcon('copy', 14),
    edit: renderIcon('edit', 14),
    external: renderIcon('external', 14),
    refresh: renderIcon('refresh', 14),
    trash: renderIcon('trash', 14),
    close: renderIcon('close', 14),
    sliders: renderIcon('sliders', 14),
    brush: renderIcon('brush', 14),
    eraser: renderIcon('eraser', 14),
    search: renderIcon('search', 14),
    zoomIn: renderIcon('zoomIn', 14),
    zoomOut: renderIcon('zoomOut', 14),
    image: renderIcon('image', 14),
    palette: renderIcon('palette', 14),
    sparkles: renderIcon('sparkles', 14),
    alertTriangle: renderIcon('alertTriangle', 14),
    warning: renderIcon('warning', 14),
    clock: renderIcon('clock', 14),
    ban: renderIcon('ban', 14),
    tag: renderIcon('tag', 14),
    chevronLeft: renderIcon('chevronLeft', 14),
    chevronRight: renderIcon('chevronRight', 14),
    chevronDown: renderIcon('chevronDown', 14),
    chevronsUpDown: renderIcon('chevronsUpDown', 14),
    chevronsDownUp: renderIcon('chevronsDownUp', 14),
    arrowUpDown: renderIcon('arrowUpDown', 14),
    toggleRight: renderIcon('toggleRight', 14),
    grip: renderIcon('grip', 14),
    eye: renderIcon('eye', 14),
    eyeOff: renderIcon('eyeOff', 14),
};
