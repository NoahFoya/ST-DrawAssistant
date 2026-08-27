/**
 * @module extensions/character-manager/constants
 * @description 角色与服装预设管理扩展专属常量定义模块 (业务扩展层独立自主管理)
 *
 * 设计意图：
 * - 声明角色管理扩展全局唯一标识符；
 * - 集中管理角色、服装、规则方案在宿主中的持久化存储键名；
 * - 集中声明扩展层专属示范预设文件清单常量，与核心层物理隔离。
 */
/** 角色管理扩展全局唯一标识符 */
export declare const CHARACTER_MANAGER_EXTENSION_ID = "character-manager";
/**
 * 角色与服装管理扩展专属持久化存储键名集中常量字典
 */
export declare const CHARACTER_STORAGE_KEYS: Readonly<{
    INITIALIZED: "st_da_cm_initialized_v1";
    CHARACTERS: "st_da_character_profiles_v1";
    OUTFITS: "st_da_outfit_profiles_v1";
    SCHEMES: "st_da_enable_schemes_v1";
    TEMPLATES: "st_da_injection_templates_v1";
    FORMULAS: "st_da_regex_formula_schemes_v1";
    ACTIVE_FORMULA_ID: "st_da_active_regex_formula_scheme_id_v1";
}>;
/** 角色与服装设置持久化在酒馆中的独立存储键名 (兼容别名) */
export declare const CHARACTER_STORAGE_KEY: "st_da_character_profiles_v1";
export declare const OUTFIT_STORAGE_KEY: "st_da_outfit_profiles_v1";
//# sourceMappingURL=constants.d.ts.map