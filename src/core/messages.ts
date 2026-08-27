/**
 * @module core/messages
 * @description ST-DrawAssistant 全局 UI 提示消息与文案字典模块
 *
 * 统一维护全库 Toast 提示、确认对话框、草稿未保存警示等文案，规避代码散落硬编码字符串。
 */

export const UI_MESSAGES = {
    // ── 通用 / 系统级提示 ──
    GENERAL_SAVED: {
        title: '系统设置',
        message: '通用配置已保存并即刻生效',
    },
    SETTING_RESET_CONFIRM: {
        title: '清空图库数据库确认',
        message: '警告：确认要永久清空本地所有已保存的生成图片与缓存索引吗？此操作不可撤销！',
        confirmText: '确定重置',
    },
    STORAGE_CLEARED: {
        title: 'Starlight DrawAssistant',
        message: '本地图库数据库已成功彻底清空。',
    },
    CONFIG_IMPORTED: {
        title: '全局配置导入',
        message: '全局配置已成功导入并刷新应用。',
    },

    // ── 未保存草稿防呆与防丢失提示 ──
    UNSAVED_BADGE_HINT: '⚠️ 当前方案存在未保存的修改，请点击【保存方案】生效',

    // ── 预设方案操作提示 ──
    THEME_SAVED: { title: '主题方案', message: '外观主题方案已成功保存！' },
    THEME_REMOVED: { title: '主题方案', message: '选中主题预设已移除。' },
    MODEL_PROFILE_SAVED: { title: '模型参数方案', message: '模型参数方案已成功保存！' },
    PROMPT_PROFILE_SAVED: { title: '提示词方案', message: '提示词方案已成功保存！' },
    WORKFLOW_PROFILE_SAVED: { title: '工作流方案', message: '文生图工作流方案已成功保存！' },
    INPAINT_WORKFLOW_SAVED: { title: '重绘工作流方案', message: '重绘工作流方案已成功保存！' },

    // ── 提示输入对话框文案 ──
    PROMPT: {
        NEW_THEME: { title: '新建自定义主题', message: '请输入自定义主题名称：', defaultValue: '我的专属暗黑主题', placeholder: '主题名称' },
        RENAME_THEME: { title: '重命名主题', message: '请输入新的主题名称：' },
        NEW_MODEL: { title: '新建模型参数方案', message: '请输入新模型参数预设名称：', defaultValue: '我的专用模型方案', placeholder: '模型方案名称' },
        RENAME_MODEL: { title: '重命名模型参数方案', message: '请输入新的预设名称：' },
        NEW_PROMPT: { title: '新建提示词方案', message: '请输入新提示词预设名称：', defaultValue: '我的画风词库', placeholder: '提示词方案名称' },
        RENAME_PROMPT: { title: '重命名提示词方案', message: '请输入新的预设名称：' },
        NEW_WORKFLOW: { title: '新建文生图工作流预设', message: '请输入新工作流预设名称：', defaultValue: '我的自定义 Workflow', placeholder: '工作流预设名称' },
        RENAME_WORKFLOW: { title: '重命名工作流预设', message: '请输入新的预设名称：' },
        NEW_INPAINT: { title: '新建重绘工作流预设', message: '请输入新重绘工作流预设名称：', defaultValue: '我的 Inpaint Workflow', placeholder: '重绘工作流名称' },
        RENAME_INPAINT: { title: '重命名重绘工作流预设', message: '请输入新的预设名称：' },
    },

    // ── 确认删除对话框文案 ──
    CONFIRM_DELETE: {
        THEME: { title: '删除主题预设确认', message: '确定要删除当前选中的自定义主题方案吗？此操作不可撤销！' },
        MODEL: { title: '删除模型参数预设确认', message: '确定要删除当前选中的模型参数预设吗？此操作不可撤销！' },
        PROMPT: { title: '删除提示词预设确认', message: '确定要删除当前选中的提示词预设吗？此操作不可撤销！' },
        WORKFLOW: { title: '删除工作流预设确认', message: '确定要删除当前选中的文生图工作流预设吗？此操作不可撤销！' },
        INPAINT: { title: '删除重绘工作流预设确认', message: '确定要删除当前重绘工作流预设吗？此操作不可撤销！' },
        GALLERY_BATCH: (count: number) => ({ title: '批量删除确认', message: `确认批量永久删除选中的 ${count} 张图片吗？此操作不可撤销！` }),
        ISOLATED_IMAGES: { title: '清理孤立废图确认', message: '确认扫描并清理删除所有未在当前聊天消息中被引用的孤立废图数据吗？此操作不可撤销！' },
        RESET_STATS: { title: '重置生图统计确认', message: '确认清空所有历史生图统计数据吗？此操作不可撤销！' },
        DELETE_IMAGE: (id: string) => ({ title: '删除图片确认', message: `确认永久删除图像 #${id} 吗？此操作不可撤销！` }),
    },
};
