/**
 * @module ui/tabs/character-tab
 * @description 角色管理主面板 UI 组件
 */

import {
    getCharacterProfiles,
    getCharacterProfileById,
    upsertCharacterProfile,
    deleteCharacterProfile
} from '../../storage/character-store';
import type { CharacterProfile } from '../../types/character';

/**
 * 简易 Token 计算辅助函数（基于逗号分割的 tag 粗估）
 */
function countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return text.split(/,|\n/).map(t => t.trim()).filter(Boolean).length;
}

/**
 * 渲染角色管理 Tab 节点
 */
export function renderCharacterTab(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'ch-tab-character';
    container.className = 'da-tab-pane da-character-tab';

    // 1. 顶部子导航栏 (Sub-Nav)
    const subNav = document.createElement('div');
    subNav.className = 'da-sub-nav';
    subNav.style.display = 'flex';
    subNav.style.gap = '8px';
    subNav.style.marginBottom = '16px';
    subNav.style.borderBottom = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';
    subNav.style.paddingBottom = '8px';

    const subTabs = [
        { id: 'ch-sub-tab-character-settings', label: '1. 角色设定', active: true },
        { id: 'ch-sub-tab-outfit-settings', label: '2. 服装设定', active: false },
        { id: 'ch-sub-tab-character-enable', label: '3. 设定启用管理', active: false },
        { id: 'ch-sub-tab-injection-templates', label: '4. 注入模板管理', active: false }
    ];

    subTabs.forEach(st => {
        const btn = document.createElement('button');
        btn.className = `da-btn secondary ${st.active ? 'active' : ''}`;
        btn.style.fontSize = '0.85em';
        btn.style.padding = '4px 12px';
        btn.textContent = st.label;
        btn.setAttribute('data-sub-tab', st.id);

        btn.addEventListener('click', () => {
            subNav.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            container.querySelectorAll<HTMLElement>('.da-sub-tab-content').forEach(pane => {
                pane.style.display = pane.id === st.id ? 'block' : 'none';
            });
        });

        subNav.appendChild(btn);
    });

    container.appendChild(subNav);

    // 2. 子界面 1：角色设定 (`#ch-sub-tab-character-settings`)
    const pane1 = renderCharacterSettingsPane();
    pane1.id = 'ch-sub-tab-character-settings';
    pane1.className = 'da-sub-tab-content';
    pane1.style.display = 'block';
    container.appendChild(pane1);

    // 3. 子界面 2：服装设定 (占位)
    const pane2 = document.createElement('div');
    pane2.id = 'ch-sub-tab-outfit-settings';
    pane2.className = 'da-sub-tab-content da-section-card';
    pane2.style.display = 'none';
    pane2.innerHTML = '<h3 style="text-align:center; padding:30px;">服装设定（等待按序规划后实现）</h3>';
    container.appendChild(pane2);

    // 4. 子界面 3：设定启用管理 (占位)
    const pane3 = document.createElement('div');
    pane3.id = 'ch-sub-tab-character-enable';
    pane3.className = 'da-sub-tab-content da-section-card';
    pane3.style.display = 'none';
    pane3.innerHTML = '<h3 style="text-align:center; padding:30px;">设定启用管理（等待按序规划后实现）</h3>';
    container.appendChild(pane3);

    // 5. 子界面 4：注入模板管理 (占位)
    const pane4 = document.createElement('div');
    pane4.id = 'ch-sub-tab-injection-templates';
    pane4.className = 'da-sub-tab-content da-section-card';
    pane4.style.display = 'none';
    pane4.innerHTML = '<h3 style="text-align:center; padding:30px;">注入模板管理（等待按序规划后实现）</h3>';
    container.appendChild(pane4);

    return container;
}

/**
 * 渲染子界面 1：角色设定内容
 */
function renderCharacterSettingsPane(): HTMLElement {
    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '16px';

    let currentProfile: CharacterProfile = getCharacterProfiles()[0];

    // ── 区域 A：角色预设控制栏 ───────────────────────────────────────────────
    const sectionA = document.createElement('div');
    sectionA.className = 'da-section-card';

    const headerA = document.createElement('div');
    headerA.className = 'da-section-header';
    headerA.innerHTML = '<span class="da-section-title">角色预设管理</span>';
    sectionA.appendChild(headerA);

    const controlsRow = document.createElement('div');
    controlsRow.style.display = 'flex';
    controlsRow.style.gap = '8px';
    controlsRow.style.alignItems = 'center';
    controlsRow.style.flexWrap = 'wrap';

    const selectEl = document.createElement('select');
    selectEl.id = 'character_preset_id';
    selectEl.className = 'da-select';
    selectEl.style.flex = '1';
    selectEl.style.minWidth = '180px';

    const refreshPresetSelect = () => {
        const profiles = getCharacterProfiles();
        selectEl.innerHTML = '';
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nameCN ? `${p.nameCN} (${p.nameEN || '未命名'})` : p.nameEN || p.id;
            selectEl.appendChild(opt);
        });
        if (profiles.some(p => p.id === currentProfile.id)) {
            selectEl.value = currentProfile.id;
        } else if (profiles[0]) {
            currentProfile = profiles[0];
            selectEl.value = currentProfile.id;
        }
    };

    refreshPresetSelect();

    // 按钮动作组件
    const btnNew = document.createElement('button');
    btnNew.className = 'da-btn secondary';
    btnNew.textContent = '➕ 新建';

    const btnSave = document.createElement('button');
    btnSave.className = 'da-btn primary';
    btnSave.textContent = '💾 保存';

    const btnSaveAs = document.createElement('button');
    btnSaveAs.className = 'da-btn secondary';
    btnSaveAs.textContent = '📄 另存为';

    const btnRename = document.createElement('button');
    btnRename.className = 'da-btn secondary';
    btnRename.textContent = '✏️ 重命名';

    const btnExport = document.createElement('button');
    btnExport.className = 'da-btn secondary';
    btnExport.textContent = '📤 导出';

    const btnImport = document.createElement('button');
    btnImport.className = 'da-btn secondary';
    btnImport.textContent = '📥 导入';

    const btnDelete = document.createElement('button');
    btnDelete.className = 'da-btn danger';
    btnDelete.textContent = '🗑️ 删除';

    controlsRow.appendChild(selectEl);
    controlsRow.appendChild(btnNew);
    controlsRow.appendChild(btnSave);
    controlsRow.appendChild(btnSaveAs);
    controlsRow.appendChild(btnRename);
    controlsRow.appendChild(btnExport);
    controlsRow.appendChild(btnImport);
    controlsRow.appendChild(btnDelete);

    sectionA.appendChild(controlsRow);
    root.appendChild(sectionA);

    // ── 区域 B：角色照片区 ───────────────────────────────────────────────────
    const sectionB = document.createElement('div');
    sectionB.className = 'da-section-card';
    sectionB.style.display = 'flex';
    sectionB.style.flexDirection = 'column';
    sectionB.style.alignItems = 'center';
    sectionB.style.gap = '12px';

    const headerB = document.createElement('div');
    headerB.className = 'da-section-header';
    headerB.style.width = '100%';
    headerB.innerHTML = '<span class="da-section-title">角色照片与配置</span>';
    sectionB.appendChild(headerB);

    const photoPreviewContainer = document.createElement('div');
    photoPreviewContainer.style.width = '160px';
    photoPreviewContainer.style.height = '160px';
    photoPreviewContainer.style.borderRadius = '8px';
    photoPreviewContainer.style.border = '1px dashed var(--da-border-color, #444)';
    photoPreviewContainer.style.display = 'flex';
    photoPreviewContainer.style.alignItems = 'center';
    photoPreviewContainer.style.justifyContent = 'center';
    photoPreviewContainer.style.overflow = 'hidden';
    photoPreviewContainer.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.2))';

    const imgPreview = document.createElement('img');
    imgPreview.style.maxWidth = '100%';
    imgPreview.style.maxHeight = '100%';
    imgPreview.style.objectFit = 'contain';
    imgPreview.style.display = 'none';

    const placeholderText = document.createElement('span');
    placeholderText.style.fontSize = '0.85em';
    placeholderText.style.color = 'var(--da-text-secondary, #888)';
    placeholderText.textContent = '暂无照片';

    photoPreviewContainer.appendChild(imgPreview);
    photoPreviewContainer.appendChild(placeholderText);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'da-btn secondary';
    uploadBtn.textContent = '🖼️ 上传照片';
    uploadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const url = reader.result as string;
            currentProfile.photoUrl = url;
            imgPreview.src = url;
            imgPreview.style.display = 'block';
            placeholderText.style.display = 'none';
        };
        reader.readAsDataURL(file);
    });

    const sendPhotoLabel = document.createElement('label');
    sendPhotoLabel.style.display = 'inline-flex';
    sendPhotoLabel.style.alignItems = 'center';
    sendPhotoLabel.style.gap = '6px';
    sendPhotoLabel.style.fontSize = '0.9em';
    sendPhotoLabel.style.cursor = 'pointer';

    const sendPhotoCheckbox = document.createElement('input');
    sendPhotoCheckbox.type = 'checkbox';
    sendPhotoCheckbox.id = 'char_send_photo';
    sendPhotoCheckbox.checked = !!currentProfile.sendPhoto;

    sendPhotoLabel.appendChild(sendPhotoCheckbox);
    sendPhotoLabel.appendChild(document.createTextNode('发送图片 (作为生图参考)'));

    sectionB.appendChild(photoPreviewContainer);
    sectionB.appendChild(uploadBtn);
    sectionB.appendChild(sendPhotoLabel);
    sectionB.appendChild(fileInput);

    root.appendChild(sectionB);

    // ── 区域 C：角色详细参数与 Token 动态监控 ──────────────────────────────
    const sectionC = document.createElement('div');
    sectionC.className = 'da-section-card';
    sectionC.style.display = 'flex';
    sectionC.style.flexDirection = 'column';
    sectionC.style.gap = '12px';

    const headerC = document.createElement('div');
    headerC.className = 'da-section-header';
    headerC.innerHTML = '<span class="da-section-title">角色详细参数与 Tag 变量</span>';
    sectionC.appendChild(headerC);

    // 中英文名
    const nameRow = document.createElement('div');
    nameRow.style.display = 'grid';
    nameRow.style.gridTemplateColumns = '1fr 1fr';
    nameRow.style.gap = '12px';

    const nameCNInput = createTextInput('角色中文名', 'char_nameCN', currentProfile.nameCN);
    const nameENInput = createTextInput('角色英文名', 'char_nameEN', currentProfile.nameEN);

    nameRow.appendChild(nameCNInput.wrapper);
    nameRow.appendChild(nameENInput.wrapper);
    sectionC.appendChild(nameRow);

    // 全身组合 Token 统计看板
    const tokenCard = document.createElement('div');
    tokenCard.style.padding = '10px';
    tokenCard.style.borderRadius = '6px';
    tokenCard.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.2))';
    tokenCard.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';

    const tokenTitle = document.createElement('div');
    tokenTitle.style.fontWeight = 'bold';
    tokenTitle.style.fontSize = '0.85em';
    tokenTitle.style.marginBottom = '6px';
    tokenTitle.textContent = '全身组合 Token 动态统计';

    const tokenGrid = document.createElement('div');
    tokenGrid.style.display = 'grid';
    tokenGrid.style.gridTemplateColumns = '1fr 1fr';
    tokenGrid.style.gap = '6px';
    tokenGrid.style.fontSize = '0.8em';
    tokenGrid.style.color = 'var(--da-text-secondary, #ccc)';

    const tokenFrontSFW = document.createElement('div');
    const tokenFrontNSFW = document.createElement('div');
    const tokenBackSFW = document.createElement('div');
    const tokenBackNSFW = document.createElement('div');

    tokenGrid.appendChild(tokenFrontSFW);
    tokenGrid.appendChild(tokenFrontNSFW);
    tokenGrid.appendChild(tokenBackSFW);
    tokenGrid.appendChild(tokenBackNSFW);

    tokenCard.appendChild(tokenTitle);
    tokenCard.appendChild(tokenGrid);
    sectionC.appendChild(tokenCard);

    // 11 项 Tag 文本框
    const fieldsMap: Record<string, { label: string; key: keyof CharacterProfile }> = {
        char_characterTraits: { label: '角色特征 {traits}', key: 'characterTraits' },
        char_facialFeatures: { label: '五官外貌(正面) {facial}', key: 'facialFeatures' },
        char_facialFeaturesBack: { label: '五官外貌(背面) {facialBack}', key: 'facialFeaturesBack' },
        char_upperBodySFW: { label: '上半身 SFW(正面) {upperSFW}', key: 'upperBodySFW' },
        char_upperBodySFWBack: { label: '上半身 SFW(背面) {upperSFWBack}', key: 'upperBodySFWBack' },
        char_fullBodySFW: { label: '下半身 SFW(正面) {lowerSFW}', key: 'fullBodySFW' },
        char_fullBodySFWBack: { label: '下半身 SFW(背面) {lowerSFWBack}', key: 'fullBodySFWBack' },
        char_upperBodyNSFW: { label: '上半身 NSFW(正面) {upperNSFW}', key: 'upperBodyNSFW' },
        char_upperBodyNSFWBack: { label: '上半身 NSFW(背面) {upperNSFWBack}', key: 'upperBodyNSFWBack' },
        char_fullBodyNSFW: { label: '下半身 NSFW(正面) {lowerNSFW}', key: 'fullBodyNSFW' },
        char_fullBodyNSFWBack: { label: '下半身 NSFW(背面) {lowerNSFWBack}', key: 'fullBodyNSFWBack' },
        char_negative: { label: '负面提示词 {negative}', key: 'negativePrompt' }
    };

    const textareasRecord: Record<string, HTMLTextAreaElement> = {};

    const updateTokenStats = () => {
        const traits = countTokens(textareasRecord.char_characterTraits?.value || '');
        const facial = countTokens(textareasRecord.char_facialFeatures?.value || '');
        const facialBack = countTokens(textareasRecord.char_facialFeaturesBack?.value || '');
        const upperSFW = countTokens(textareasRecord.char_upperBodySFW?.value || '');
        const upperSFWBack = countTokens(textareasRecord.char_upperBodySFWBack?.value || '');
        const lowerSFW = countTokens(textareasRecord.char_fullBodySFW?.value || '');
        const lowerSFWBack = countTokens(textareasRecord.char_fullBodySFWBack?.value || '');
        const upperNSFW = countTokens(textareasRecord.char_upperBodyNSFW?.value || '');
        const upperNSFWBack = countTokens(textareasRecord.char_upperBodyNSFWBack?.value || '');
        const lowerNSFW = countTokens(textareasRecord.char_fullBodyNSFW?.value || '');
        const lowerNSFWBack = countTokens(textareasRecord.char_fullBodyNSFWBack?.value || '');

        tokenFrontSFW.textContent = `正面 SFW 全身: ${traits + facial + upperSFW + lowerSFW} Tokens`;
        tokenFrontNSFW.textContent = `正面 NSFW 全身: ${traits + facial + upperNSFW + lowerNSFW} Tokens`;
        tokenBackSFW.textContent = `背面 SFW 全身: ${traits + facialBack + upperSFWBack + lowerSFWBack} Tokens`;
        tokenBackNSFW.textContent = `背面 NSFW 全身: ${traits + facialBack + upperNSFWBack + lowerNSFWBack} Tokens`;
    };

    Object.entries(fieldsMap).forEach(([id, info]) => {
        const value = (currentProfile[info.key] as string) || '';
        const fieldObj = createTextareaInput(info.label, id, value);
        textareasRecord[id] = fieldObj.textarea;
        fieldObj.textarea.addEventListener('input', updateTokenStats);
        sectionC.appendChild(fieldObj.wrapper);
    });

    root.appendChild(sectionC);

    // ── 区域 D：角色专属服装列表管理 ────────────────────────────────────────
    const sectionD = document.createElement('div');
    sectionD.className = 'da-section-card';
    sectionD.style.display = 'flex';
    sectionD.style.flexDirection = 'column';
    sectionD.style.gap = '12px';

    const headerD = document.createElement('div');
    headerD.className = 'da-section-header';
    headerD.innerHTML = '<span class="da-section-title">关联专属服装列表 ({outfits})</span>';
    sectionD.appendChild(headerD);

    const outfitListInput = createTextareaInput('专属服装名称列表（每行一个）', 'char_outfit_list', (currentProfile.outfitList || []).join('\n'));
    sectionD.appendChild(outfitListInput.wrapper);

    const checkBtn = document.createElement('button');
    checkBtn.className = 'da-btn secondary';
    checkBtn.textContent = '✔️ 检测服装是否存在';
    sectionD.appendChild(checkBtn);

    root.appendChild(sectionD);

    // 加载与绑定当前数据到表单
    const populateForm = (p: CharacterProfile) => {
        currentProfile = p;
        nameCNInput.input.value = p.nameCN || '';
        nameENInput.input.value = p.nameEN || '';
        sendPhotoCheckbox.checked = !!p.sendPhoto;

        if (p.photoUrl) {
            imgPreview.src = p.photoUrl;
            imgPreview.style.display = 'block';
            placeholderText.style.display = 'none';
        } else {
            imgPreview.style.display = 'none';
            placeholderText.style.display = 'block';
        }

        Object.entries(fieldsMap).forEach(([id, info]) => {
            if (textareasRecord[id]) {
                textareasRecord[id].value = (p[info.key] as string) || '';
            }
        });

        outfitListInput.textarea.value = (p.outfitList || []).join('\n');
        updateTokenStats();
    };

    selectEl.addEventListener('change', () => {
        const found = getCharacterProfileById(selectEl.value);
        if (found) populateForm(found);
    });

    // 按钮事件组
    btnSave.addEventListener('click', () => {
        currentProfile.nameCN = nameCNInput.input.value;
        currentProfile.nameEN = nameENInput.input.value;
        currentProfile.sendPhoto = sendPhotoCheckbox.checked;

        Object.entries(fieldsMap).forEach(([id, info]) => {
            (currentProfile[info.key] as string) = textareasRecord[id]?.value || '';
        });

        currentProfile.outfitList = outfitListInput.textarea.value.split('\n').map(s => s.trim()).filter(Boolean);

        upsertCharacterProfile(currentProfile);
        refreshPresetSelect();
        alert('💾 角色预设保存成功！');
    });

    btnNew.addEventListener('click', () => {
        const name = prompt('请输入新角色名称（中文/英文）：');
        if (!name) return;
        const newP: CharacterProfile = {
            id: `char-${Date.now()}`,
            nameCN: name,
            nameEN: name,
            characterTraits: '',
            facialFeatures: '',
            facialFeaturesBack: '',
            upperBodySFW: '',
            upperBodySFWBack: '',
            fullBodySFW: '',
            fullBodySFWBack: '',
            upperBodyNSFW: '',
            upperBodyNSFWBack: '',
            fullBodyNSFW: '',
            fullBodyNSFWBack: '',
            negativePrompt: '',
            outfitList: []
        };
        upsertCharacterProfile(newP);
        refreshPresetSelect();
        populateForm(newP);
    });

    btnDelete.addEventListener('click', () => {
        if (!confirm(`⚠️ 确定要删除角色预设 "${currentProfile.nameCN || currentProfile.id}" 吗？`)) return;
        deleteCharacterProfile(currentProfile.id);
        refreshPresetSelect();
        const first = getCharacterProfiles()[0];
        if (first) populateForm(first);
    });

    populateForm(currentProfile);
    return root;
}

function createTextInput(label: string, id: string, value: string): { wrapper: HTMLElement; input: HTMLInputElement } {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-field-col';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';

    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.style.fontSize = '0.85em';
    lbl.style.color = 'var(--da-text-secondary, #aaa)';
    lbl.textContent = label;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'da-input';
    input.value = value;

    wrapper.appendChild(lbl);
    wrapper.appendChild(input);
    return { wrapper, input };
}

function createTextareaInput(label: string, id: string, value: string): { wrapper: HTMLElement; textarea: HTMLTextAreaElement } {
    const wrapper = document.createElement('div');
    wrapper.className = 'da-field-col';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';

    const lbl = document.createElement('label');
    lbl.htmlFor = id;
    lbl.style.fontSize = '0.85em';
    lbl.style.color = 'var(--da-text-secondary, #aaa)';
    lbl.textContent = label;

    const textarea = document.createElement('textarea');
    textarea.id = id;
    textarea.className = 'da-textarea';
    textarea.rows = 2;
    textarea.style.resize = 'vertical';
    textarea.value = value;

    wrapper.appendChild(lbl);
    wrapper.appendChild(textarea);
    return { wrapper, textarea };
}
