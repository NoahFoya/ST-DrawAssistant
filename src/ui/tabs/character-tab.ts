/**
 * @module ui/tabs/character-tab
 * @description 角色管理主面板 UI 组件 (角色设定 + 服装设定 + 设定启用管理 + 注入模板管理)
 */

import {
    getCharacterProfiles,
    getCharacterProfileById,
    upsertCharacterProfile,
    deleteCharacterProfile,
    getOutfitProfiles,
    getOutfitProfileById,
    upsertOutfitProfile,
    deleteOutfitProfile,
    getEnableSchemes,
    getEnableSchemeById,
    upsertEnableScheme,
    deleteEnableScheme,
    getInjectionTemplates,
    getInjectionTemplateById,
    upsertInjectionTemplate,
    deleteInjectionTemplate
} from '../../storage/character-store';
import type { CharacterProfile, OutfitProfile, EnableSchemeProfile, InjectionTemplateScheme, InjectionMatchRule } from '../../types/character';
import { checkCharacterCardConflict } from '../../core/character-event-listener';

/**
 * 简易 Token 计算辅助函数（基于逗号分割的 tag 粗估）
 */
function countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return text.split(/,|\n/).map(t => t.trim()).filter(Boolean).length;
}

/**
 * 辅助创建仅图标按钮 (带 tooltip 提示)
 */
function createIconButton(
    iconHtml: string,
    titleText: string,
    onClick: () => void,
    isDanger = false
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `da-icon-btn ${isDanger ? 'danger' : ''}`;
    btn.title = titleText;
    btn.style.height = '32px';
    btn.style.minWidth = '32px';
    btn.style.padding = '0 8px';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.boxSizing = 'border-box';
    btn.innerHTML = iconHtml;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
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
        { id: 'ch-sub-tab-character-settings', label: '角色设定', active: true },
        { id: 'ch-sub-tab-outfit-settings', label: '服装设定', active: false },
        { id: 'ch-sub-tab-character-enable', label: '设定启用管理', active: false },
        { id: 'ch-sub-tab-injection-templates', label: '注入模板管理', active: false }
    ];

    subTabs.forEach(st => {
        const btn = document.createElement('button');
        btn.className = `da-btn secondary ${st.active ? 'active' : ''}`;
        btn.style.fontSize = '0.85em';
        btn.style.padding = '4px 14px';
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

    // 3. 子界面 2：服装设定 (`#ch-sub-tab-outfit-settings`)
    const pane2 = renderOutfitSettingsPane();
    pane2.id = 'ch-sub-tab-outfit-settings';
    pane2.className = 'da-sub-tab-content';
    pane2.style.display = 'none';
    container.appendChild(pane2);

    // 4. 子界面 3：设定启用管理 (`#ch-sub-tab-character-enable`)
    const pane3 = renderCharacterEnablePane();
    pane3.id = 'ch-sub-tab-character-enable';
    pane3.className = 'da-sub-tab-content';
    pane3.style.display = 'none';
    container.appendChild(pane3);

    // 5. 子界面 4：注入模板管理 (`#ch-sub-tab-injection-templates`)
    const pane4 = renderInjectionTemplatesPane();
    pane4.id = 'ch-sub-tab-injection-templates';
    pane4.className = 'da-sub-tab-content';
    pane4.style.display = 'none';
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

    const sectionA = document.createElement('div');
    sectionA.className = 'da-section-card';

    const headerA = document.createElement('div');
    headerA.className = 'da-section-header';
    headerA.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-user-gear"></i> 角色预设管理</span>';
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

    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';

    const btnNew = createIconButton('<i class="fa-solid fa-plus"></i>', '新建预设', () => {
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

    const btnSave = createIconButton('<i class="fa-solid fa-save"></i>', '保存当前预设', () => {
        saveCurrentForm();
        alert('💾 角色预设已保存！');
    });

    const btnSaveAs = createIconButton('<i class="fa-solid fa-file-export"></i>', '另存为新预设', () => {
        const newName = prompt('另存为新预设名称：', `${currentProfile.nameCN || '角色'}_副本`);
        if (!newName) return;
        saveCurrentForm();
        const copy: CharacterProfile = {
            ...currentProfile,
            id: `char-${Date.now()}`,
            nameCN: newName,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        upsertCharacterProfile(copy);
        refreshPresetSelect();
        populateForm(copy);
    });

    const btnRename = createIconButton('<i class="fa-solid fa-pen"></i>', '重命名预设', () => {
        const newName = prompt('重命名角色中文名称：', currentProfile.nameCN);
        if (newName === null) return;
        currentProfile.nameCN = newName;
        upsertCharacterProfile(currentProfile);
        refreshPresetSelect();
    });

    const btnExport = createIconButton('<i class="fa-solid fa-upload"></i>', '导出当前角色预设', () => {
        saveCurrentForm();
        const jsonStr = JSON.stringify(currentProfile, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `character-${currentProfile.nameCN || currentProfile.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    const btnImport = createIconButton('<i class="fa-solid fa-download"></i>', '导入角色预设 JSON', () => {
        hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result as string) as CharacterProfile;
                if (!imported.nameCN && !imported.nameEN) throw new Error('无效的角色预设文件');
                imported.id = `char-${Date.now()}`;
                upsertCharacterProfile(imported);
                refreshPresetSelect();
                populateForm(imported);
                alert('📥 角色预设导入成功！');
            } catch {
                alert('❌ 导入失败：无法解析该 JSON 角色文件');
            }
            hiddenFileInput.value = '';
        };
        reader.readAsText(file);
    });

    const btnDelete = createIconButton('<i class="fa-solid fa-trash"></i>', '删除预设', () => {
        if (!confirm(`⚠️ 确定要删除角色预设 "${currentProfile.nameCN || currentProfile.id}" 吗？`)) return;
        deleteCharacterProfile(currentProfile.id);
        refreshPresetSelect();
        const first = getCharacterProfiles()[0];
        if (first) populateForm(first);
    }, true);

    controlsRow.appendChild(selectEl);
    controlsRow.appendChild(btnNew);
    controlsRow.appendChild(btnSave);
    controlsRow.appendChild(btnSaveAs);
    controlsRow.appendChild(btnRename);
    controlsRow.appendChild(btnExport);
    controlsRow.appendChild(btnImport);
    controlsRow.appendChild(btnDelete);
    controlsRow.appendChild(hiddenFileInput);

    sectionA.appendChild(controlsRow);
    root.appendChild(sectionA);

    const sectionB = document.createElement('div');
    sectionB.className = 'da-section-card';
    sectionB.style.display = 'flex';
    sectionB.style.flexDirection = 'column';
    sectionB.style.alignItems = 'center';
    sectionB.style.gap = '12px';

    const headerB = document.createElement('div');
    headerB.className = 'da-section-header';
    headerB.style.width = '100%';
    headerB.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-image"></i> 角色照片与配置</span>';
    sectionB.appendChild(headerB);

    const photoPreviewContainer = document.createElement('div');
    photoPreviewContainer.style.width = '160px';
    photoPreviewContainer.style.height = '160px';
    photoPreviewContainer.style.borderRadius = '8px';
    photoPreviewContainer.style.border = '1px dashed var(--da-border-color, rgba(255,255,255,0.2))';
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
    placeholderText.innerHTML = '<i class="fa-solid fa-image" style="font-size: 2em; opacity: 0.5;"></i>';

    photoPreviewContainer.appendChild(imgPreview);
    photoPreviewContainer.appendChild(placeholderText);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'da-btn secondary';
    uploadBtn.innerHTML = '<i class="fa-solid fa-upload"></i> 上传照片';
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
    sendPhotoLabel.appendChild(document.createTextNode('发送图片 (作为生图参考图)'));

    sectionB.appendChild(photoPreviewContainer);
    sectionB.appendChild(uploadBtn);
    sectionB.appendChild(sendPhotoLabel);
    sectionB.appendChild(fileInput);

    root.appendChild(sectionB);

    const sectionC = document.createElement('div');
    sectionC.className = 'da-section-card';
    sectionC.style.display = 'flex';
    sectionC.style.flexDirection = 'column';
    sectionC.style.gap = '12px';

    const headerC = document.createElement('div');
    headerC.className = 'da-section-header';
    headerC.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-sliders"></i> 角色详细参数与 Tag 变量</span>';
    sectionC.appendChild(headerC);

    const nameRow = document.createElement('div');
    nameRow.style.display = 'grid';
    nameRow.style.gridTemplateColumns = '1fr 1fr';
    nameRow.style.gap = '12px';

    const nameCNInput = createTextInput('角色中文名', 'char_nameCN', currentProfile.nameCN);
    const nameENInput = createTextInput('角色英文名', 'char_nameEN', currentProfile.nameEN);

    nameRow.appendChild(nameCNInput.wrapper);
    nameRow.appendChild(nameENInput.wrapper);
    sectionC.appendChild(nameRow);

    const tokenCard = document.createElement('div');
    tokenCard.style.padding = '10px 14px';
    tokenCard.style.borderRadius = '6px';
    tokenCard.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.2))';
    tokenCard.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';

    const tokenTitle = document.createElement('div');
    tokenTitle.style.fontWeight = 'bold';
    tokenTitle.style.fontSize = '0.85em';
    tokenTitle.style.marginBottom = '6px';
    tokenTitle.textContent = '全身组合 Token 动态统计 (角色特征 + 五官 + 上半身 + 下半身)';

    const tokenGrid = document.createElement('div');
    tokenGrid.style.display = 'grid';
    tokenGrid.style.gridTemplateColumns = '1fr 1fr';
    tokenGrid.style.gap = '6px';
    tokenGrid.style.fontSize = '0.85em';
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

        tokenFrontSFW.textContent = `正面 SFW 全身: ${traits + facial + upperSFW + lowerSFW}`;
        tokenFrontNSFW.textContent = `正面 NSFW 全身: ${traits + facial + upperNSFW + lowerNSFW}`;
        tokenBackSFW.textContent = `背面 SFW 全身: ${traits + facialBack + upperSFWBack + lowerSFWBack}`;
        tokenBackNSFW.textContent = `背面 NSFW 全身: ${traits + facialBack + upperNSFWBack + lowerNSFWBack}`;
    };

    Object.entries(fieldsMap).forEach(([id, info]) => {
        const value = (currentProfile[info.key] as string) || '';
        const fieldObj = createTextareaInput(info.label, id, value);
        textareasRecord[id] = fieldObj.textarea;
        fieldObj.textarea.addEventListener('input', updateTokenStats);
        sectionC.appendChild(fieldObj.wrapper);
    });

    root.appendChild(sectionC);

    const sectionD = document.createElement('div');
    sectionD.className = 'da-section-card';
    sectionD.style.display = 'flex';
    sectionD.style.flexDirection = 'column';
    sectionD.style.gap = '12px';

    const headerD = document.createElement('div');
    headerD.className = 'da-section-header';
    headerD.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-shirt"></i> 关联专属服装列表 ({outfits})</span>';
    sectionD.appendChild(headerD);

    const outfitListInput = createTextareaInput('服装列表（每行一个服装名称）', 'char_outfit_list', (currentProfile.outfitList || []).join('\n'));
    outfitListInput.textarea.rows = 4;
    sectionD.appendChild(outfitListInput.wrapper);

    const checkBtn = document.createElement('button');
    checkBtn.className = 'da-btn secondary';
    checkBtn.style.width = '100%';
    checkBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> 检测服装是否存在';

    const checkResultBox = document.createElement('div');
    checkResultBox.style.display = 'none';
    checkResultBox.style.padding = '10px';
    checkResultBox.style.borderRadius = '6px';
    checkResultBox.style.fontSize = '0.85em';
    checkResultBox.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.2))';
    checkResultBox.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';

    checkBtn.addEventListener('click', () => {
        const rawLines = outfitListInput.textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
        if (rawLines.length === 0) {
            checkResultBox.style.display = 'block';
            checkResultBox.innerHTML = '<span style="color: #ff9800;">⚠️ 服装列表中暂未填写任何服装名称</span>';
            return;
        }
        const registeredOutfits = getOutfitProfiles();
        const results = rawLines.map(name => {
            const exists = registeredOutfits.some(o => o.nameCN === name || o.nameEN === name);
            return { name, exists };
        });

        let html = '<div style="font-weight: bold; margin-bottom: 6px;">服装存在性检测结果：</div>';
        results.forEach(r => {
            if (r.exists) {
                html += `<div style="color: #4caf50;">✅ [已注册] ${r.name}</div>`;
            } else {
                html += `<div style="color: #f44336;">❌ [未找到] ${r.name} (将在服装设定中未定义)</div>`;
            }
        });
        checkResultBox.innerHTML = html;
        checkResultBox.style.display = 'block';
    });

    sectionD.appendChild(checkBtn);
    sectionD.appendChild(checkResultBox);

    const selectorContainer = document.createElement('div');
    selectorContainer.style.marginTop = '8px';
    selectorContainer.style.display = 'flex';
    selectorContainer.style.flexDirection = 'column';
    selectorContainer.style.gap = '6px';

    const selectorLabel = document.createElement('label');
    selectorLabel.style.fontSize = '0.85em';
    selectorLabel.style.color = 'var(--da-text-secondary, #aaa)';
    selectorLabel.textContent = '从服装预设库中选择添加';

    const selectorRow = document.createElement('div');
    selectorRow.style.display = 'flex';
    selectorRow.style.gap = '8px';
    selectorRow.style.alignItems = 'center';

    const outfitSelect = document.createElement('select');
    outfitSelect.id = 'char_outfit_selector';
    outfitSelect.className = 'da-select';
    outfitSelect.style.flex = '1';

    const refreshOutfitSelect = () => {
        const outfits = getOutfitProfiles();
        outfitSelect.innerHTML = '';
        if (outfits.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(暂无已知服装预设)';
            outfitSelect.appendChild(opt);
        } else {
            outfits.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.nameCN || o.nameEN;
                opt.textContent = `${o.nameCN} (${o.nameEN || '无英文名'})`;
                outfitSelect.appendChild(opt);
            });
        }
    };

    refreshOutfitSelect();

    const refreshOutfitBtn = createIconButton('<i class="fa-solid fa-rotate-right"></i>', '刷新服装预设列表', () => {
        refreshOutfitSelect();
    });

    const addOutfitBtn = document.createElement('button');
    addOutfitBtn.className = 'da-btn primary';
    addOutfitBtn.style.whiteSpace = 'nowrap';
    addOutfitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加服装';

    addOutfitBtn.addEventListener('click', () => {
        const val = outfitSelect.value;
        if (!val) return;
        const currentText = outfitListInput.textarea.value;
        const existingLines = currentText.split('\n').map(s => s.trim()).filter(Boolean);
        if (existingLines.includes(val)) {
            alert(`ℹ️ 服装 "${val}" 已存在于列表中`);
            return;
        }
        existingLines.push(val);
        outfitListInput.textarea.value = existingLines.join('\n');
    });

    selectorRow.appendChild(outfitSelect);
    selectorRow.appendChild(refreshOutfitBtn);
    selectorRow.appendChild(addOutfitBtn);

    selectorContainer.appendChild(selectorLabel);
    selectorContainer.appendChild(selectorRow);
    sectionD.appendChild(selectorContainer);

    root.appendChild(sectionD);

    const saveCurrentForm = () => {
        currentProfile.nameCN = nameCNInput.input.value;
        currentProfile.nameEN = nameENInput.input.value;
        currentProfile.sendPhoto = sendPhotoCheckbox.checked;

        Object.entries(fieldsMap).forEach(([id, info]) => {
            (currentProfile[info.key] as string) = textareasRecord[id]?.value || '';
        });

        currentProfile.outfitList = outfitListInput.textarea.value.split('\n').map(s => s.trim()).filter(Boolean);

        upsertCharacterProfile(currentProfile);
    };

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
        checkResultBox.style.display = 'none';
        updateTokenStats();
    };

    selectEl.addEventListener('change', () => {
        const found = getCharacterProfileById(selectEl.value);
        if (found) populateForm(found);
    });

    populateForm(currentProfile);
    return root;
}

/**
 * 渲染子界面 2：服装设定内容 (极简精简版)
 */
function renderOutfitSettingsPane(): HTMLElement {
    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '16px';

    let currentOutfit: OutfitProfile = getOutfitProfiles()[0];

    const sectionA = document.createElement('div');
    sectionA.className = 'da-section-card';

    const headerA = document.createElement('div');
    headerA.className = 'da-section-header';
    headerA.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-shirt"></i> 服装预设管理</span>';
    sectionA.appendChild(headerA);

    const controlsRow = document.createElement('div');
    controlsRow.style.display = 'flex';
    controlsRow.style.gap = '8px';
    controlsRow.style.alignItems = 'center';
    controlsRow.style.flexWrap = 'wrap';

    const selectEl = document.createElement('select');
    selectEl.id = 'outfit_preset_id';
    selectEl.className = 'da-select';
    selectEl.style.flex = '1';
    selectEl.style.minWidth = '180px';

    const refreshOutfitPresetSelect = () => {
        const outfits = getOutfitProfiles();
        selectEl.innerHTML = '';
        outfits.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.nameCN ? `${o.nameCN} (${o.nameEN || '未命名'})` : o.nameEN || o.id;
            selectEl.appendChild(opt);
        });
        if (outfits.some(o => o.id === currentOutfit.id)) {
            selectEl.value = currentOutfit.id;
        } else if (outfits[0]) {
            currentOutfit = outfits[0];
            selectEl.value = currentOutfit.id;
        }
    };

    refreshOutfitPresetSelect();

    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';

    const btnNew = createIconButton('<i class="fa-solid fa-plus"></i>', '新建服装预设', () => {
        const name = prompt('请输入新服装名称（中文/英文）：');
        if (!name) return;
        const newO: OutfitProfile = {
            id: `outfit-${Date.now()}`,
            nameCN: name,
            nameEN: name,
            upperBody: '',
            upperBodyBack: '',
            fullBody: '',
            fullBodyBack: ''
        };
        upsertOutfitProfile(newO);
        refreshOutfitPresetSelect();
        populateForm(newO);
    });

    const btnSave = createIconButton('<i class="fa-solid fa-save"></i>', '保存当前服装预设', () => {
        saveCurrentForm();
        alert('💾 服装预设已保存！');
    });

    const btnSaveAs = createIconButton('<i class="fa-solid fa-file-export"></i>', '另存为新服装预设', () => {
        const newName = prompt('另存为新服装名称：', `${currentOutfit.nameCN || '服装'}_副本`);
        if (!newName) return;
        saveCurrentForm();
        const copy: OutfitProfile = {
            ...currentOutfit,
            id: `outfit-${Date.now()}`,
            nameCN: newName,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        upsertOutfitProfile(copy);
        refreshOutfitPresetSelect();
        populateForm(copy);
    });

    const btnRename = createIconButton('<i class="fa-solid fa-pen"></i>', '重命名服装', () => {
        const newName = prompt('重命名服装中文名称：', currentOutfit.nameCN);
        if (newName === null) return;
        currentOutfit.nameCN = newName;
        upsertOutfitProfile(currentOutfit);
        refreshOutfitPresetSelect();
    });

    const btnExport = createIconButton('<i class="fa-solid fa-upload"></i>', '导出服装预设 JSON', () => {
        saveCurrentForm();
        const jsonStr = JSON.stringify(currentOutfit, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `outfit-${currentOutfit.nameCN || currentOutfit.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    const btnImport = createIconButton('<i class="fa-solid fa-download"></i>', '导入服装预设 JSON', () => {
        hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result as string) as OutfitProfile;
                if (!imported.nameCN && !imported.nameEN) throw new Error('无效的服装预设文件');
                imported.id = `outfit-${Date.now()}`;
                upsertOutfitProfile(imported);
                refreshOutfitPresetSelect();
                populateForm(imported);
                alert('📥 服装预设导入成功！');
            } catch {
                alert('❌ 导入失败：无法解析该 JSON 服装文件');
            }
            hiddenFileInput.value = '';
        };
        reader.readAsText(file);
    });

    const btnDelete = createIconButton('<i class="fa-solid fa-trash"></i>', '删除服装预设', () => {
        if (!confirm(`⚠️ 确定要删除服装预设 "${currentOutfit.nameCN || currentOutfit.id}" 吗？`)) return;
        deleteOutfitProfile(currentOutfit.id);
        refreshOutfitPresetSelect();
        const first = getOutfitProfiles()[0];
        if (first) populateForm(first);
    }, true);

    controlsRow.appendChild(selectEl);
    controlsRow.appendChild(btnNew);
    controlsRow.appendChild(btnSave);
    controlsRow.appendChild(btnSaveAs);
    controlsRow.appendChild(btnRename);
    controlsRow.appendChild(btnExport);
    controlsRow.appendChild(btnImport);
    controlsRow.appendChild(btnDelete);
    controlsRow.appendChild(hiddenFileInput);

    sectionA.appendChild(controlsRow);
    root.appendChild(sectionA);

    const sectionB = document.createElement('div');
    sectionB.className = 'da-section-card';
    sectionB.style.display = 'flex';
    sectionB.style.flexDirection = 'column';
    sectionB.style.gap = '12px';

    const headerB = document.createElement('div');
    headerB.className = 'da-section-header';
    headerB.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-sliders"></i> 服装详细参数与 Tag 变量</span>';
    sectionB.appendChild(headerB);

    const nameRow = document.createElement('div');
    nameRow.style.display = 'grid';
    nameRow.style.gridTemplateColumns = '1fr 1fr';
    nameRow.style.gap = '12px';

    const nameCNInput = createTextInput('服装中文名', 'outfit_nameCN', currentOutfit.nameCN);
    const nameENInput = createTextInput('服装英文名', 'outfit_nameEN', currentOutfit.nameEN);

    nameRow.appendChild(nameCNInput.wrapper);
    nameRow.appendChild(nameENInput.wrapper);
    sectionB.appendChild(nameRow);

    const tokenCard = document.createElement('div');
    tokenCard.style.padding = '10px 14px';
    tokenCard.style.borderRadius = '6px';
    tokenCard.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.2))';
    tokenCard.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.1))';

    const tokenTitle = document.createElement('div');
    tokenTitle.style.fontWeight = 'bold';
    tokenTitle.style.fontSize = '0.85em';
    tokenTitle.style.marginBottom = '6px';
    tokenTitle.textContent = '服装全身组合 Token 动态统计 (上半身 + 下半身)';

    const tokenGrid = document.createElement('div');
    tokenGrid.style.display = 'grid';
    tokenGrid.style.gridTemplateColumns = '1fr 1fr';
    tokenGrid.style.gap = '6px';
    tokenGrid.style.fontSize = '0.85em';
    tokenGrid.style.color = 'var(--da-text-secondary, #ccc)';

    const tokenFront = document.createElement('div');
    const tokenBack = document.createElement('div');

    tokenGrid.appendChild(tokenFront);
    tokenGrid.appendChild(tokenBack);

    tokenCard.appendChild(tokenTitle);
    tokenCard.appendChild(tokenGrid);
    sectionB.appendChild(tokenCard);

    const fieldsMap: Record<string, { label: string; key: keyof OutfitProfile }> = {
        outfit_upperBody: { label: '上半身(正面) {upperBody}', key: 'upperBody' },
        outfit_upperBodyBack: { label: '上半身(背面) {upperBodyBack}', key: 'upperBodyBack' },
        outfit_fullBody: { label: '下半身服装(正面) {lowerBody}', key: 'fullBody' },
        outfit_fullBodyBack: { label: '下半身(背面) {lowerBodyBack}', key: 'fullBodyBack' }
    };

    const textareasRecord: Record<string, HTMLTextAreaElement> = {};

    const updateTokenStats = () => {
        const upper = countTokens(textareasRecord.outfit_upperBody?.value || '');
        const upperBack = countTokens(textareasRecord.outfit_upperBodyBack?.value || '');
        const lower = countTokens(textareasRecord.outfit_fullBody?.value || '');
        const lowerBack = countTokens(textareasRecord.outfit_fullBodyBack?.value || '');

        tokenFront.textContent = `正面全身: ${upper + lower} Tokens`;
        tokenBack.textContent = `背面全身: ${upperBack + lowerBack} Tokens`;
    };

    Object.entries(fieldsMap).forEach(([id, info]) => {
        const value = (currentOutfit[info.key] as string) || '';
        const fieldObj = createTextareaInput(info.label, id, value);
        textareasRecord[id] = fieldObj.textarea;
        fieldObj.textarea.addEventListener('input', updateTokenStats);
        sectionB.appendChild(fieldObj.wrapper);
    });

    root.appendChild(sectionB);

    const saveCurrentForm = () => {
        currentOutfit.nameCN = nameCNInput.input.value;
        currentOutfit.nameEN = nameENInput.input.value;

        Object.entries(fieldsMap).forEach(([id, info]) => {
            (currentOutfit[info.key] as string) = textareasRecord[id]?.value || '';
        });

        upsertOutfitProfile(currentOutfit);
    };

    const populateForm = (o: OutfitProfile) => {
        currentOutfit = o;
        nameCNInput.input.value = o.nameCN || '';
        nameENInput.input.value = o.nameEN || '';

        Object.entries(fieldsMap).forEach(([id, info]) => {
            if (textareasRecord[id]) {
                textareasRecord[id].value = (o[info.key] as string) || '';
            }
        });

        updateTokenStats();
    };

    selectEl.addEventListener('change', () => {
        const found = getOutfitProfileById(selectEl.value);
        if (found) populateForm(found);
    });

    populateForm(currentOutfit);
    return root;
}

/**
 * 渲染子界面 3：设定启用管理内容
 */
function renderCharacterEnablePane(): HTMLElement {
    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '16px';

    let currentScheme: EnableSchemeProfile = getEnableSchemes()[0];

    const sectionA = document.createElement('div');
    sectionA.className = 'da-section-card';

    const headerA = document.createElement('div');
    headerA.className = 'da-section-header';
    headerA.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-list-check"></i> 设定启用方案管理</span>';
    sectionA.appendChild(headerA);

    const controlsRow = document.createElement('div');
    controlsRow.style.display = 'flex';
    controlsRow.style.gap = '8px';
    controlsRow.style.alignItems = 'center';
    controlsRow.style.flexWrap = 'wrap';

    const selectEl = document.createElement('select');
    selectEl.id = 'enable_scheme_id';
    selectEl.className = 'da-select';
    selectEl.style.flex = '1';
    selectEl.style.minWidth = '180px';

    const refreshSchemeSelect = () => {
        const schemes = getEnableSchemes();
        selectEl.innerHTML = '';
        schemes.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            selectEl.appendChild(opt);
        });
        if (schemes.some(s => s.id === currentScheme.id)) {
            selectEl.value = currentScheme.id;
        } else if (schemes[0]) {
            currentScheme = schemes[0];
            selectEl.value = currentScheme.id;
        }
    };

    refreshSchemeSelect();

    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';

    const btnNew = createIconButton('<i class="fa-solid fa-plus"></i>', '新建设定启用方案', () => {
        const name = prompt('请输入新启用方案名称：');
        if (!name) return;
        const newS: EnableSchemeProfile = {
            id: `scheme-${Date.now()}`,
            name,
            boundCharacterCards: '',
            boundChatId: '',
            characterRules: {},
            outfitRules: {}
        };
        upsertEnableScheme(newS);
        refreshSchemeSelect();
        populateForm(newS);
    });

    const btnSave = createIconButton('<i class="fa-solid fa-save"></i>', '保存当前方案', () => {
        saveCurrentForm();
        alert('💾 设定启用方案已保存！');
    });

    const btnSaveAs = createIconButton('<i class="fa-solid fa-file-export"></i>', '另存为新方案', () => {
        const newName = prompt('另存为新方案名称：', `${currentScheme.name}_副本`);
        if (!newName) return;
        saveCurrentForm();
        const copy: EnableSchemeProfile = {
            ...currentScheme,
            id: `scheme-${Date.now()}`,
            name: newName,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        upsertEnableScheme(copy);
        refreshSchemeSelect();
        populateForm(copy);
    });

    const btnRename = createIconButton('<i class="fa-solid fa-pen"></i>', '重命名方案', () => {
        const newName = prompt('重命名方案名称：', currentScheme.name);
        if (newName === null) return;
        currentScheme.name = newName;
        upsertEnableScheme(currentScheme);
        refreshSchemeSelect();
    });

    const btnExport = createIconButton('<i class="fa-solid fa-upload"></i>', '导出方案 JSON', () => {
        saveCurrentForm();
        const jsonStr = JSON.stringify(currentScheme, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `enable-scheme-${currentScheme.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    const btnImport = createIconButton('<i class="fa-solid fa-download"></i>', '导入方案 JSON', () => {
        hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result as string) as EnableSchemeProfile;
                if (!imported.name) throw new Error('无效的方案文件');
                imported.id = `scheme-${Date.now()}`;
                upsertEnableScheme(imported);
                refreshSchemeSelect();
                populateForm(imported);
                alert('📥 启用方案导入成功！');
            } catch {
                alert('❌ 导入失败：无法解析该 JSON 方案文件');
            }
            hiddenFileInput.value = '';
        };
        reader.readAsText(file);
    });

    const btnDelete = createIconButton('<i class="fa-solid fa-trash"></i>', '删除方案', () => {
        if (!confirm(`⚠️ 确定要删除方案 "${currentScheme.name}" 吗？`)) return;
        deleteEnableScheme(currentScheme.id);
        refreshSchemeSelect();
        const first = getEnableSchemes()[0];
        if (first) populateForm(first);
    }, true);

    controlsRow.appendChild(selectEl);
    controlsRow.appendChild(btnNew);
    controlsRow.appendChild(btnSave);
    controlsRow.appendChild(btnSaveAs);
    controlsRow.appendChild(btnRename);
    controlsRow.appendChild(btnExport);
    controlsRow.appendChild(btnImport);
    controlsRow.appendChild(btnDelete);
    controlsRow.appendChild(hiddenFileInput);

    sectionA.appendChild(controlsRow);
    root.appendChild(sectionA);

    const sectionB = document.createElement('div');
    sectionB.className = 'da-section-card';
    sectionB.style.display = 'flex';
    sectionB.style.flexDirection = 'column';
    sectionB.style.gap = '12px';

    const headerB = document.createElement('div');
    headerB.className = 'da-section-header';
    headerB.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-link"></i> 绑定角色卡与聊天分流 (绑定解耦)</span>';
    sectionB.appendChild(headerB);

    const cardBindRow = document.createElement('div');
    cardBindRow.className = 'da-field-col';
    cardBindRow.style.display = 'flex';
    cardBindRow.style.flexDirection = 'column';
    cardBindRow.style.gap = '4px';

    const cardBindLabel = document.createElement('label');
    cardBindLabel.style.fontSize = '0.85em';
    cardBindLabel.style.color = 'var(--da-text-secondary, #aaa)';
    cardBindLabel.textContent = '绑定角色卡列表（在列表中匹配的角色卡自动启用本方案，每行一个记录。格式：角色卡名称 或 角色卡名称|chatId）';

    const cardBindInput = document.createElement('textarea');
    cardBindInput.className = 'da-textarea';
    cardBindInput.rows = 4;
    cardBindInput.style.width = '100%';
    cardBindInput.style.boxSizing = 'border-box';
    cardBindInput.placeholder = '输入要绑定的酒馆角色卡名称，每行一个\n例如：\n爱丽丝\n鲍勃|chat-20260806-001';
    cardBindInput.value = currentScheme.boundCharacterCards || '';

    cardBindInput.addEventListener('change', () => {
        const lines = cardBindInput.value.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach(val => {
            const conflictScheme = checkCharacterCardConflict(val, currentScheme.id);
            if (conflictScheme) {
                alert(`⚠️ 改绑冲突提醒：记录 "${val}" 原本已在另一方案 "${conflictScheme}" 中绑定！保存后将改绑至当前方案。`);
            }
        });
    });

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '4px';

    const btnAddChar = document.createElement('button');
    btnAddChar.className = 'da-btn secondary';
    btnAddChar.style.fontSize = '0.85em';
    btnAddChar.innerHTML = '<i class="fa-solid fa-user-plus"></i> 追加当前角色';

    btnAddChar.addEventListener('click', () => {
        const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string } } };
        const name2 = win.SillyTavern?.getContext?.()?.name2;
        if (name2) {
            const existingLines = cardBindInput.value.split('\n').map(l => l.trim()).filter(Boolean);
            if (existingLines.includes(name2)) {
                alert(`ℹ️ 当前角色卡 "${name2}" 已存在于绑定列表中`);
                return;
            }
            existingLines.push(name2);
            cardBindInput.value = existingLines.join('\n');

            const conflictScheme = checkCharacterCardConflict(name2, currentScheme.id);
            if (conflictScheme) {
                alert(`🎯 已追加当前角色卡: "${name2}"\n⚠️ 注意：该记录原本已被另一方案 "${conflictScheme}" 绑定！保存后将改绑至当前方案。`);
            } else {
                alert(`🎯 已追加当前酒馆角色卡: "${name2}"`);
            }
        } else {
            alert('ℹ️ 未检测到活动的酒馆角色卡');
        }
    });

    const btnAddCharChat = document.createElement('button');
    btnAddCharChat.className = 'da-btn secondary';
    btnAddCharChat.style.fontSize = '0.85em';
    btnAddCharChat.innerHTML = '<i class="fa-solid fa-link"></i> 追加角色+聊天ID';

    btnAddCharChat.addEventListener('click', () => {
        const win = window as unknown as { SillyTavern?: { getContext?: () => { name2?: string; chatId?: string } } };
        const stCtx = win.SillyTavern?.getContext?.();
        const name2 = stCtx?.name2;
        const chatId = stCtx?.chatId || '';

        if (name2) {
            const entry = chatId ? `${name2}|${chatId}` : name2;
            const existingLines = cardBindInput.value.split('\n').map(l => l.trim()).filter(Boolean);
            if (existingLines.includes(entry)) {
                alert(`ℹ️ 当前记录 "${entry}" 已存在于绑定列表中`);
                return;
            }
            existingLines.push(entry);
            cardBindInput.value = existingLines.join('\n');

            const conflictScheme = checkCharacterCardConflict(entry, currentScheme.id);
            if (conflictScheme) {
                alert(`🎯 已追加角色+聊天ID: "${entry}"\n⚠️ 注意：该记录原本已被另一方案 "${conflictScheme}" 绑定！保存后将改绑至当前方案。`);
            } else {
                alert(`🎯 已追加角色+聊天ID: "${entry}"`);
            }
        } else {
            alert('ℹ️ 未检测到活动的酒馆角色卡或聊天 ID');
        }
    });

    btnRow.appendChild(btnAddChar);
    btnRow.appendChild(btnAddCharChat);

    cardBindRow.appendChild(cardBindLabel);
    cardBindRow.appendChild(cardBindInput);
    cardBindRow.appendChild(btnRow);
    sectionB.appendChild(cardBindRow);

    root.appendChild(sectionB);

    // ── 区块 C与D：角色与服装规则列表 ────────────────────────────────────────
    const sectionC = document.createElement('div');
    sectionC.className = 'da-section-card';
    sectionC.style.display = 'flex';
    sectionC.style.flexDirection = 'column';
    sectionC.style.gap = '12px';

    const headerC = document.createElement('div');
    headerC.className = 'da-section-header';
    headerC.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-user-check"></i> 角色启用控制与注入规则</span>';
    sectionC.appendChild(headerC);

    const characterRulesContainer = document.createElement('div');
    characterRulesContainer.style.display = 'flex';
    characterRulesContainer.style.flexDirection = 'column';
    characterRulesContainer.style.gap = '8px';

    sectionC.appendChild(characterRulesContainer);
    root.appendChild(sectionC);

    const sectionD = document.createElement('div');
    sectionD.className = 'da-section-card';
    sectionD.style.display = 'flex';
    sectionD.style.flexDirection = 'column';
    sectionD.style.gap = '12px';

    const headerD = document.createElement('div');
    headerD.className = 'da-section-header';
    headerD.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-shirt"></i> 服装启用控制与注入规则</span>';
    sectionD.appendChild(headerD);

    const outfitRulesContainer = document.createElement('div');
    outfitRulesContainer.style.display = 'flex';
    outfitRulesContainer.style.flexDirection = 'column';
    outfitRulesContainer.style.gap = '8px';

    sectionD.appendChild(outfitRulesContainer);
    root.appendChild(sectionD);

    const renderRulesLists = () => {
        characterRulesContainer.innerHTML = '';
        outfitRulesContainer.innerHTML = '';

        const allChars = getCharacterProfiles();
        const allOutfits = getOutfitProfiles();

        currentScheme.characterRules = currentScheme.characterRules || {};
        currentScheme.outfitRules = currentScheme.outfitRules || {};

        if (allChars.length === 0) {
            characterRulesContainer.innerHTML = '<div style="color:#888; font-size:0.85em;">暂无保存的角色预设</div>';
        } else {
            allChars.forEach(char => {
                // 默认策略：若规则字典中未找到，则默认为 enabled: false (禁用)
                const ruleConfig = currentScheme.characterRules[char.id] || { enabled: false, rule: 'ALL' };

                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.justifyContent = 'space-between';
                row.style.padding = '8px 12px';
                row.style.borderRadius = '6px';
                row.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.2))';
                row.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.08))';

                // 左侧：角色名称
                const left = document.createElement('div');
                left.style.display = 'flex';
                left.style.alignItems = 'center';
                left.style.gap = '8px';

                const nameSpan = document.createElement('span');
                nameSpan.style.fontSize = '0.9em';
                nameSpan.textContent = char.nameCN ? `${char.nameCN} (${char.nameEN || '未命名'})` : char.nameEN;
                left.appendChild(nameSpan);

                // 右侧：规则选择器 + 启用按钮（移动至右侧控制区）
                const right = document.createElement('div');
                right.style.display = 'flex';
                right.style.alignItems = 'center';
                right.style.gap = '8px';

                const ruleSelect = document.createElement('select');
                ruleSelect.className = 'da-select';
                ruleSelect.style.fontSize = '0.8em';
                ruleSelect.style.padding = '2px 8px';

                const optAll = document.createElement('option');
                optAll.value = 'ALL';
                optAll.textContent = 'ALL (无条件注入)';

                const optMatch = document.createElement('option');
                optMatch.value = 'match';
                optMatch.textContent = 'match (匹配上下文才注入)';

                ruleSelect.appendChild(optAll);
                ruleSelect.appendChild(optMatch);
                ruleSelect.value = ruleConfig.rule || 'ALL';

                ruleSelect.addEventListener('change', () => {
                    ruleConfig.rule = ruleSelect.value as InjectionMatchRule;
                    currentScheme.characterRules[char.id] = ruleConfig;
                });

                const toggleBtn = document.createElement('button');
                const updateToggleStyle = () => {
                    if (ruleConfig.enabled) {
                        toggleBtn.className = 'da-btn primary';
                        toggleBtn.style.padding = '3px 10px';
                        toggleBtn.style.fontSize = '0.8em';
                        toggleBtn.style.minWidth = '75px';
                        toggleBtn.innerHTML = '<i class="fa-solid fa-toggle-on"></i> 已启用';
                    } else {
                        toggleBtn.className = 'da-btn secondary';
                        toggleBtn.style.padding = '3px 10px';
                        toggleBtn.style.fontSize = '0.8em';
                        toggleBtn.style.opacity = '0.6';
                        toggleBtn.style.minWidth = '75px';
                        toggleBtn.innerHTML = '<i class="fa-solid fa-toggle-off"></i> 已禁用';
                    }
                };
                updateToggleStyle();

                toggleBtn.addEventListener('click', () => {
                    ruleConfig.enabled = !ruleConfig.enabled;
                    currentScheme.characterRules[char.id] = ruleConfig;
                    updateToggleStyle();
                });

                right.appendChild(ruleSelect);
                right.appendChild(toggleBtn);

                row.appendChild(left);
                row.appendChild(right);
                characterRulesContainer.appendChild(row);
            });
        }

        if (allOutfits.length === 0) {
            outfitRulesContainer.innerHTML = '<div style="color:#888; font-size:0.85em;">暂无保存的服装预设</div>';
        } else {
            allOutfits.forEach(outfit => {
                // 默认策略：若规则字典中未找到，则默认为 enabled: false (禁用)
                const ruleConfig = currentScheme.outfitRules[outfit.id] || { enabled: false, rule: 'match' };

                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.justifyContent = 'space-between';
                row.style.padding = '8px 12px';
                row.style.borderRadius = '6px';
                row.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.2))';
                row.style.border = '1px solid var(--da-border-color, rgba(255,255,255,0.08))';

                // 左侧：服装名称
                const left = document.createElement('div');
                left.style.display = 'flex';
                left.style.alignItems = 'center';
                left.style.gap = '8px';

                const nameSpan = document.createElement('span');
                nameSpan.style.fontSize = '0.9em';
                nameSpan.textContent = outfit.nameCN ? `${outfit.nameCN} (${outfit.nameEN || '未命名'})` : outfit.nameEN;
                left.appendChild(nameSpan);

                // 右侧：规则选择器 + 启用按钮（移动至右侧控制区）
                const right = document.createElement('div');
                right.style.display = 'flex';
                right.style.alignItems = 'center';
                right.style.gap = '8px';

                const ruleSelect = document.createElement('select');
                ruleSelect.className = 'da-select';
                ruleSelect.style.fontSize = '0.8em';
                ruleSelect.style.padding = '2px 8px';

                const optMatch = document.createElement('option');
                optMatch.value = 'match';
                optMatch.textContent = 'match (匹配服装名才注入)';

                const optAll = document.createElement('option');
                optAll.value = 'ALL';
                optAll.textContent = 'ALL (无条件注入)';

                ruleSelect.appendChild(optMatch);
                ruleSelect.appendChild(optAll);
                ruleSelect.value = ruleConfig.rule || 'match';

                ruleSelect.addEventListener('change', () => {
                    ruleConfig.rule = ruleSelect.value as InjectionMatchRule;
                    currentScheme.outfitRules[outfit.id] = ruleConfig;
                });

                const toggleBtn = document.createElement('button');
                const updateToggleStyle = () => {
                    if (ruleConfig.enabled) {
                        toggleBtn.className = 'da-btn primary';
                        toggleBtn.style.padding = '3px 10px';
                        toggleBtn.style.fontSize = '0.8em';
                        toggleBtn.style.minWidth = '75px';
                        toggleBtn.innerHTML = '<i class="fa-solid fa-toggle-on"></i> 已启用';
                    } else {
                        toggleBtn.className = 'da-btn secondary';
                        toggleBtn.style.padding = '3px 10px';
                        toggleBtn.style.fontSize = '0.8em';
                        toggleBtn.style.opacity = '0.6';
                        toggleBtn.style.minWidth = '75px';
                        toggleBtn.innerHTML = '<i class="fa-solid fa-toggle-off"></i> 已禁用';
                    }
                };
                updateToggleStyle();

                toggleBtn.addEventListener('click', () => {
                    ruleConfig.enabled = !ruleConfig.enabled;
                    currentScheme.outfitRules[outfit.id] = ruleConfig;
                    updateToggleStyle();
                });

                right.appendChild(ruleSelect);
                right.appendChild(toggleBtn);

                row.appendChild(left);
                row.appendChild(right);
                outfitRulesContainer.appendChild(row);
            });
        }
    };

    const saveCurrentForm = () => {
        currentScheme.boundCharacterCards = cardBindInput.value;

        // 极简存储策略：只记录 enabled: true 的实体
        const cleanCharRules: Record<string, { enabled: boolean; rule: InjectionMatchRule }> = {};
        Object.entries(currentScheme.characterRules || {}).forEach(([id, cfg]) => {
            if (cfg && cfg.enabled) {
                cleanCharRules[id] = cfg;
            }
        });
        currentScheme.characterRules = cleanCharRules;

        const cleanOutfitRules: Record<string, { enabled: boolean; rule: InjectionMatchRule }> = {};
        Object.entries(currentScheme.outfitRules || {}).forEach(([id, cfg]) => {
            if (cfg && cfg.enabled) {
                cleanOutfitRules[id] = cfg;
            }
        });
        currentScheme.outfitRules = cleanOutfitRules;

        upsertEnableScheme(currentScheme);
    };

    const populateForm = (scheme: EnableSchemeProfile) => {
        currentScheme = scheme;
        cardBindInput.value = scheme.boundCharacterCards || '';
        renderRulesLists();
    };

    selectEl.addEventListener('change', () => {
        const found = getEnableSchemeById(selectEl.value);
        if (found) populateForm(found);
    });

    populateForm(currentScheme);
    return root;
}

/**
 * 渲染子界面 4：注入模板管理内容 (3 大模板 + 变量工具栏 + 0ms 实时预览)
 */
function renderInjectionTemplatesPane(): HTMLElement {
    const root = document.createElement('div');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '16px';

    let currentTpl: InjectionTemplateScheme = getInjectionTemplates()[0];
    let activeTextarea: HTMLTextAreaElement | null = null;

    // ── 区块 A：模板方案管理区 ───────────────────────────────────────────────
    const sectionA = document.createElement('div');
    sectionA.className = 'da-section-card';

    const headerA = document.createElement('div');
    headerA.className = 'da-section-header';
    headerA.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-folder-tree"></i> 注入模板方案管理</span>';
    sectionA.appendChild(headerA);

    const controlsRow = document.createElement('div');
    controlsRow.style.display = 'flex';
    controlsRow.style.gap = '8px';
    controlsRow.style.alignItems = 'center';
    controlsRow.style.flexWrap = 'wrap';

    const selectEl = document.createElement('select');
    selectEl.id = 'injection_template_preset_id';
    selectEl.className = 'da-select';
    selectEl.style.flex = '1';
    selectEl.style.minWidth = '180px';

    const refreshTplSelect = () => {
        const list = getInjectionTemplates();
        selectEl.innerHTML = '';
        list.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            selectEl.appendChild(opt);
        });
        if (list.some(t => t.id === currentTpl.id)) {
            selectEl.value = currentTpl.id;
        } else if (list[0]) {
            currentTpl = list[0];
            selectEl.value = currentTpl.id;
        }
    };

    refreshTplSelect();

    const hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.accept = '.json';
    hiddenFileInput.style.display = 'none';

    const btnNew = createIconButton('<i class="fa-solid fa-plus"></i>', '新建模板方案', () => {
        const name = prompt('请输入新注入模板方案名称：');
        if (!name) return;
        const newT: InjectionTemplateScheme = {
            id: `tpl-${Date.now()}`,
            name,
            characterListTemplate: '',
            innerOutfitTemplate: '',
            commonCharacterListTemplate: '',
            enableOutfitListTemplate: ''
        };
        upsertInjectionTemplate(newT);
        refreshTplSelect();
        populateForm(newT);
    });

    const btnSave = createIconButton('<i class="fa-solid fa-save"></i>', '保存当前模板方案', () => {
        saveCurrentForm();
        alert('💾 注入模板方案已保存！');
    });

    const btnSaveAs = createIconButton('<i class="fa-solid fa-file-export"></i>', '另存为新方案', () => {
        const newName = prompt('另存为新方案名称：', `${currentTpl.name}_副本`);
        if (!newName) return;
        saveCurrentForm();
        const copy: InjectionTemplateScheme = {
            ...currentTpl,
            id: `tpl-${Date.now()}`,
            name: newName,
            isSystemPreset: false
        };
        upsertInjectionTemplate(copy);
        refreshTplSelect();
        populateForm(copy);
    });

    const btnRename = createIconButton('<i class="fa-solid fa-pen"></i>', '重命名方案', () => {
        if (currentTpl.isSystemPreset) {
            alert('ℹ️ 系统预置方案不可重命名');
            return;
        }
        const newName = prompt('重命名方案名称：', currentTpl.name);
        if (newName === null) return;
        currentTpl.name = newName;
        upsertInjectionTemplate(currentTpl);
        refreshTplSelect();
    });

    const btnExport = createIconButton('<i class="fa-solid fa-upload"></i>', '导出模板方案 JSON', () => {
        saveCurrentForm();
        const jsonStr = JSON.stringify(currentTpl, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `injection-template-${currentTpl.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    const btnImport = createIconButton('<i class="fa-solid fa-download"></i>', '导入模板方案 JSON', () => {
        hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener('change', () => {
        const file = hiddenFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result as string) as InjectionTemplateScheme;
                if (!imported.name) throw new Error('无效的模板方案文件');
                imported.id = `tpl-${Date.now()}`;
                imported.isSystemPreset = false;
                upsertInjectionTemplate(imported);
                refreshTplSelect();
                populateForm(imported);
                alert('📥 模板方案导入成功！');
            } catch {
                alert('❌ 导入失败：无法解析该 JSON 模板文件');
            }
            hiddenFileInput.value = '';
        };
        reader.readAsText(file);
    });

    const btnDelete = createIconButton('<i class="fa-solid fa-trash"></i>', '删除方案', () => {
        if (currentTpl.isSystemPreset) {
            alert('⚠️ 系统预置方案不可删除');
            return;
        }
        if (!confirm(`⚠️ 确定要删除方案 "${currentTpl.name}" 吗？`)) return;
        deleteInjectionTemplate(currentTpl.id);
        refreshTplSelect();
        const first = getInjectionTemplates()[0];
        if (first) populateForm(first);
    }, true);

    controlsRow.appendChild(selectEl);
    controlsRow.appendChild(btnNew);
    controlsRow.appendChild(btnSave);
    controlsRow.appendChild(btnSaveAs);
    controlsRow.appendChild(btnRename);
    controlsRow.appendChild(btnExport);
    controlsRow.appendChild(btnImport);
    controlsRow.appendChild(btnDelete);
    controlsRow.appendChild(hiddenFileInput);

    const descNote = document.createElement('small');
    descNote.style.display = 'block';
    descNote.style.marginTop = '6px';
    descNote.style.color = 'var(--da-text-secondary, #888)';
    descNote.style.fontSize = '0.85em';
    descNote.textContent = '系统预置方案不可直接重命名或删除。模板中用 {变量名} 作为占位符，整行占位符全空时该行会被自动剔除。';

    sectionA.appendChild(controlsRow);
    sectionA.appendChild(descNote);
    root.appendChild(sectionA);

    // ── 区块 B：3 大模板格式配置 + 变量一键插入面板 ─────────────────────────
    const sectionB = document.createElement('div');
    sectionB.style.display = 'flex';
    sectionB.style.gap = '16px';
    sectionB.style.flexWrap = 'wrap';

    // 左侧：3 个模板框
    const leftCard = document.createElement('div');
    leftCard.className = 'da-section-card';
    leftCard.style.flex = '1';
    leftCard.style.minWidth = '300px';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'da-section-header';
    headerLeft.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-sliders"></i> 3 大模板格式配置</span>';
    leftCard.appendChild(headerLeft);

    const tplCharList = createTextareaInput('1. 角色启用列表模板 (对应 {{角色启用列表}}，每个角色渲染一次)', 'tpl_characterListTemplate', currentTpl.characterListTemplate);
    tplCharList.textarea.rows = 7;

    const tplInnerOutfit = createTextareaInput('2. 角色专属服装模板 (填充至 {outfits} 占位符处)', 'tpl_innerOutfitTemplate', currentTpl.innerOutfitTemplate);
    tplInnerOutfit.textarea.rows = 4;

    const tplOutfitList = createTextareaInput('3. 服装启用列表模板 (对应 {{服装启用列表}}，每个服装渲染一次)', 'tpl_enableOutfitListTemplate', currentTpl.enableOutfitListTemplate);
    tplOutfitList.textarea.rows = 5;

    [tplCharList, tplInnerOutfit, tplOutfitList].forEach(obj => {
        obj.textarea.addEventListener('focus', () => {
            activeTextarea = obj.textarea;
        });
        obj.textarea.addEventListener('input', () => {
            updateLivePreview();
        });
    });

    // 默认初始焦点
    activeTextarea = tplCharList.textarea;

    leftCard.appendChild(tplCharList.wrapper);
    leftCard.appendChild(tplInnerOutfit.wrapper);
    leftCard.appendChild(tplOutfitList.wrapper);
    sectionB.appendChild(leftCard);

    // 右侧：变量点击插入面板
    const rightCard = document.createElement('div');
    rightCard.className = 'da-section-card';
    rightCard.style.width = '280px';
    rightCard.style.minWidth = '240px';
    rightCard.style.display = 'flex';
    rightCard.style.flexDirection = 'column';

    const headerRight = document.createElement('div');
    headerRight.className = 'da-section-header';
    headerRight.innerHTML = '<span class="da-section-title"><i class="fa-solid fa-code"></i> 变量一键插入</span>';
    rightCard.appendChild(headerRight);

    const varTabRow = document.createElement('div');
    varTabRow.style.display = 'flex';
    varTabRow.style.gap = '8px';
    varTabRow.style.marginBottom = '8px';

    const varTabCharBtn = document.createElement('button');
    varTabCharBtn.className = 'da-btn secondary active';
    varTabCharBtn.style.flex = '1';
    varTabCharBtn.style.fontSize = '0.85em';
    varTabCharBtn.innerHTML = '<i class="fa-solid fa-user"></i> 角色变量';

    const varTabOutfitBtn = document.createElement('button');
    varTabOutfitBtn.className = 'da-btn secondary';
    varTabOutfitBtn.style.flex = '1';
    varTabOutfitBtn.style.fontSize = '0.85em';
    varTabOutfitBtn.innerHTML = '<i class="fa-solid fa-shirt"></i> 服装变量';

    varTabRow.appendChild(varTabCharBtn);
    varTabRow.appendChild(varTabOutfitBtn);
    rightCard.appendChild(varTabRow);

    const varPanelChar = document.createElement('div');
    varPanelChar.style.display = 'flex';
    varPanelChar.style.flexDirection = 'column';
    varPanelChar.style.gap = '4px';
    varPanelChar.style.overflowY = 'auto';
    varPanelChar.style.maxHeight = '420px';

    const varPanelOutfit = document.createElement('div');
    varPanelOutfit.style.display = 'none';
    varPanelOutfit.style.flexDirection = 'column';
    varPanelOutfit.style.gap = '4px';
    varPanelOutfit.style.overflowY = 'auto';
    varPanelOutfit.style.maxHeight = '420px';

    varTabCharBtn.addEventListener('click', () => {
        varTabCharBtn.classList.add('active');
        varTabOutfitBtn.classList.remove('active');
        varPanelChar.style.display = 'flex';
        varPanelOutfit.style.display = 'none';
    });

    varTabOutfitBtn.addEventListener('click', () => {
        varTabOutfitBtn.classList.add('active');
        varTabCharBtn.classList.remove('active');
        varPanelOutfit.style.display = 'flex';
        varPanelChar.style.display = 'none';
    });

    const createVarButton = (vTag: string, vDesc: string): HTMLButtonElement => {
        const b = document.createElement('button');
        b.className = 'da-btn secondary';
        b.style.textAlign = 'left';
        b.style.fontSize = '0.8em';
        b.style.padding = '4px 8px';
        b.textContent = `${vTag}　${vDesc}`;

        b.addEventListener('click', () => {
            if (!activeTextarea) activeTextarea = tplCharList.textarea;
            const start = activeTextarea.selectionStart;
            const end = activeTextarea.selectionEnd;
            const text = activeTextarea.value;
            activeTextarea.value = text.substring(0, start) + vTag + text.substring(end);
            activeTextarea.selectionStart = activeTextarea.selectionEnd = start + vTag.length;
            activeTextarea.focus();
            updateLivePreview();
        });
        return b;
    };

    // 角色变量面板列表
    const charVars = [
        { tag: '{nameCN}', desc: '中文名称' },
        { tag: '{nameEN}', desc: '英文名称' },
        { tag: '{traits}', desc: '角色特征' },
        { tag: '{facial}', desc: '五官(正面)' },
        { tag: '{facialBack}', desc: '五官(背面)' },
        { tag: '{upperSFW}', desc: '上半身 SFW(正面)' },
        { tag: '{upperSFWBack}', desc: '上半身 SFW(背面)' },
        { tag: '{lowerSFW}', desc: '下半身 SFW(正面)' },
        { tag: '{lowerSFWBack}', desc: '下半身 SFW(背面)' },
        { tag: '{upperNSFW}', desc: '上半身 NSFW(正面)' },
        { tag: '{upperNSFWBack}', desc: '上半身 NSFW(背面)' },
        { tag: '{lowerNSFW}', desc: '下半身 NSFW(正面)' },
        { tag: '{lowerNSFWBack}', desc: '下半身 NSFW(背面)' },
        { tag: '{negative}', desc: '负向提示词' },
        { tag: '{outfits}', desc: '专属服装展开位' }
    ];

    charVars.forEach(cv => varPanelChar.appendChild(createVarButton(cv.tag, cv.desc)));

    // 服装变量面板列表
    const outfitVars = [
        { tag: '{nameCN}', desc: '中文名称' },
        { tag: '{nameEN}', desc: '英文名称' },
        { tag: '{upperBody}', desc: '上半身(正面)' },
        { tag: '{upperBodyBack}', desc: '上半身(背面)' },
        { tag: '{lowerBody}', desc: '下半身(正面)' },
        { tag: '{lowerBodyBack}', desc: '下半身(背面)' }
    ];

    outfitVars.forEach(ov => varPanelOutfit.appendChild(createVarButton(ov.tag, ov.desc)));

    rightCard.appendChild(varPanelChar);
    rightCard.appendChild(varPanelOutfit);
    sectionB.appendChild(rightCard);
    root.appendChild(sectionB);

    // ── 区块 C：0ms 实时预览区 ───────────────────────────────────────────────
    const sectionC = document.createElement('div');
    sectionC.className = 'da-section-card';
    sectionC.style.display = 'flex';
    sectionC.style.flexDirection = 'column';
    sectionC.style.gap = '10px';

    const headerC = document.createElement('div');
    headerC.className = 'da-section-header';
    headerC.style.display = 'flex';
    headerC.style.justifyContent = 'space-between';
    headerC.style.alignItems = 'center';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'da-section-title';
    titleSpan.innerHTML = '<i class="fa-solid fa-eye"></i> 样例数据 0ms 实时渲染预览';

    const refreshPreviewBtn = document.createElement('button');
    refreshPreviewBtn.className = 'da-btn primary';
    refreshPreviewBtn.style.fontSize = '0.8em';
    refreshPreviewBtn.style.padding = '3px 10px';
    refreshPreviewBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> 刷新预览';

    headerC.appendChild(titleSpan);
    headerC.appendChild(refreshPreviewBtn);
    sectionC.appendChild(headerC);

    const previewTextarea = document.createElement('textarea');
    previewTextarea.className = 'da-textarea';
    previewTextarea.rows = 10;
    previewTextarea.readOnly = true;
    previewTextarea.style.background = 'var(--da-bg-secondary, rgba(0,0,0,0.3))';
    previewTextarea.style.fontFamily = 'monospace';
    previewTextarea.style.fontSize = '0.85em';
    previewTextarea.placeholder = '预览区域...';

    sectionC.appendChild(previewTextarea);
    root.appendChild(sectionC);

    // 样例数据渲染逻辑
    const updateLivePreview = () => {
        const charTpl = tplCharList.textarea.value;
        const innerOutfitTpl = tplInnerOutfit.textarea.value;
        const outfitTpl = tplOutfitList.textarea.value;

        // 样例专属服装
        const innerOutfitsRendered = innerOutfitTpl
            .replace(/{nameCN}/g, '水手服')
            .replace(/{nameEN}/g, 'Sailor Suit')
            .replace(/{upperBody}/g, 'white sailor collar')
            .replace(/{lowerBody}/g, 'blue pleated skirt');

        // 样例角色渲染
        const charRendered = charTpl
            .replace(/{nameCN}/g, '爱丽丝')
            .replace(/{nameEN}/g, 'Alice')
            .replace(/{traits}/g, '1girl, long blond hair, blue eyes')
            .replace(/{facial}/g, 'smiling, blush')
            .replace(/{facialBack}/g, 'long blond hair from back')
            .replace(/{upperSFW}/g, 'blue dress, white apron')
            .replace(/{upperSFWBack}/g, 'white apron bow')
            .replace(/{lowerSFW}/g, 'white stockings, black shoes')
            .replace(/{lowerSFWBack}/g, 'white stockings back')
            .replace(/{upperNSFW}/g, '')
            .replace(/{upperNSFWBack}/g, '')
            .replace(/{lowerNSFW}/g, '')
            .replace(/{lowerNSFWBack}/g, '')
            .replace(/{negative}/g, 'worst quality, bad anatomy')
            .replace(/{outfits}/g, innerOutfitsRendered);

        // 样例通用服装渲染
        const outfitRendered = outfitTpl
            .replace(/{nameCN}/g, '女仆装')
            .replace(/{nameEN}/g, 'Maid Dress')
            .replace(/{upperBody}/g, 'black maid dress, white apron')
            .replace(/{upperBodyBack}/g, 'apron ribbon back')
            .replace(/{lowerBody}/g, 'frilled skirt, white socks')
            .replace(/{lowerBodyBack}/g, 'frilled skirt back');

        // 过滤空行的简易处理演示
        const cleanChar = charRendered.split('\n').filter(line => !line.includes('{}') && line.trim() !== '').join('\n');
        const cleanOutfit = outfitRendered.split('\n').filter(line => !line.includes('{}') && line.trim() !== '').join('\n');

        previewTextarea.value = `=== 【{{角色启用列表}}】渲染效果 ===\n${cleanChar}\n\n=== 【{{服装启用列表}}】渲染效果 ===\n${cleanOutfit}`;
    };

    refreshPreviewBtn.addEventListener('click', updateLivePreview);

    const saveCurrentForm = () => {
        currentTpl.characterListTemplate = tplCharList.textarea.value;
        currentTpl.innerOutfitTemplate = tplInnerOutfit.textarea.value;
        currentTpl.enableOutfitListTemplate = tplOutfitList.textarea.value;
        upsertInjectionTemplate(currentTpl);
    };

    const populateForm = (tpl: InjectionTemplateScheme) => {
        currentTpl = tpl;
        tplCharList.textarea.value = tpl.characterListTemplate || '';
        tplInnerOutfit.textarea.value = tpl.innerOutfitTemplate || '';
        tplOutfitList.textarea.value = tpl.enableOutfitListTemplate || '';
        updateLivePreview();
    };

    selectEl.addEventListener('change', () => {
        const found = getInjectionTemplateById(selectEl.value);
        if (found) populateForm(found);
    });

    populateForm(currentTpl);
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
