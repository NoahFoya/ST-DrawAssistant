/**
 * @module ui/tabs/character-tab
 * @description 角色管理主面板 UI 组件 (角色设定 + 服装设定)
 */

import {
    getCharacterProfiles,
    getCharacterProfileById,
    upsertCharacterProfile,
    deleteCharacterProfile,
    getOutfitProfiles,
    getOutfitProfileById,
    upsertOutfitProfile,
    deleteOutfitProfile
} from '../../storage/character-store';
import type { CharacterProfile, OutfitProfile } from '../../types/character';

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

    // ── 区域 A：角色预设控制栏 (极简图标化工具栏) ───────────────────────────
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

    // ── 区域 C：角色详细参数与 Token 动态监控 ──────────────────────────────
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

    // ── 区域 D：角色专属服装列表管理与添加控制 ─────────────────────────────
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

    // ── 区域 A：服装预设控制栏 (极简图标化工具栏) ───────────────────────────
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

    // ── 区域 B：服装详细参数与 Token 动态监控 ──────────────────────────────
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

    // 服装全身组合 Token 统计看板
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

    // 4 项服装 Tag 文本框
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
