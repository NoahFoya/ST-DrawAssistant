/**
 * @module core/messages
 * @description ST-DrawAssistant 全局 UI 提示消息与文案字典模块
 *
 * 统一维护全库 Toast 提示、确认对话框、草稿未保存警示等文案，规避代码散落硬编码字符串。
 */
export declare const UI_MESSAGES: {
    GENERAL_SAVED: {
        title: string;
        message: string;
    };
    SETTING_RESET_CONFIRM: {
        title: string;
        message: string;
        confirmText: string;
    };
    STORAGE_CLEARED: {
        title: string;
        message: string;
    };
    CONFIG_IMPORTED: {
        title: string;
        message: string;
    };
    UNSAVED_BADGE_HINT: string;
    THEME_SAVED: {
        title: string;
        message: string;
    };
    THEME_REMOVED: {
        title: string;
        message: string;
    };
    MODEL_PROFILE_SAVED: {
        title: string;
        message: string;
    };
    PROMPT_PROFILE_SAVED: {
        title: string;
        message: string;
    };
    WORKFLOW_PROFILE_SAVED: {
        title: string;
        message: string;
    };
    INPAINT_WORKFLOW_SAVED: {
        title: string;
        message: string;
    };
    PROMPT: {
        NEW_THEME: {
            title: string;
            message: string;
            defaultValue: string;
            placeholder: string;
        };
        RENAME_THEME: {
            title: string;
            message: string;
        };
        NEW_MODEL: {
            title: string;
            message: string;
            defaultValue: string;
            placeholder: string;
        };
        RENAME_MODEL: {
            title: string;
            message: string;
        };
        NEW_PROMPT: {
            title: string;
            message: string;
            defaultValue: string;
            placeholder: string;
        };
        RENAME_PROMPT: {
            title: string;
            message: string;
        };
        NEW_WORKFLOW: {
            title: string;
            message: string;
            defaultValue: string;
            placeholder: string;
        };
        RENAME_WORKFLOW: {
            title: string;
            message: string;
        };
        NEW_INPAINT: {
            title: string;
            message: string;
            defaultValue: string;
            placeholder: string;
        };
        RENAME_INPAINT: {
            title: string;
            message: string;
        };
    };
    CONFIRM_DELETE: {
        THEME: {
            title: string;
            message: string;
        };
        MODEL: {
            title: string;
            message: string;
        };
        PROMPT: {
            title: string;
            message: string;
        };
        WORKFLOW: {
            title: string;
            message: string;
        };
        INPAINT: {
            title: string;
            message: string;
        };
        GALLERY_BATCH: (count: number) => {
            title: string;
            message: string;
        };
        ISOLATED_IMAGES: {
            title: string;
            message: string;
        };
        RESET_STATS: {
            title: string;
            message: string;
        };
        DELETE_IMAGE: (id: string) => {
            title: string;
            message: string;
        };
    };
};
//# sourceMappingURL=messages.d.ts.map