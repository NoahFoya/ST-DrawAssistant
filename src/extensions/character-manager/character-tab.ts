/**
 * @module extensions/character-manager/character-tab
 * @description 角色与服装设定管理主面板 (5 大独立子页面 + 专属预设工具栏)
 */

import { CharacterStorage } from './storage';
import { ControlFactory, createFieldRow, bindPresetToolbar } from '../../ui';
import {
    createCharacterPresetAdapter,
    createOutfitPresetAdapter,
    createEnableSchemePresetAdapter,
    createInjectionTemplatePresetAdapter,
    createRegexFormulaPresetAdapter
} from './adapters';
import {
    CharacterProfile,
    OutfitProfile,
    EnableSchemeProfile,
    InjectionTemplateScheme,
    RegexFormulaScheme
} from './types';

export function createCharacterTabView(
    storage: CharacterStorage,
    controls: ControlFactory = new ControlFactory()
): HTMLElement {
    const container = document.createElement('div');
    container.className = 'da-tab-pane da-character-tab';

    // ── 顶部 5 大子 Tab 导航栏 ──
    const navBar = document.createElement('div');
    navBar.className = 'da-sub-tab-nav';

    const subTabs = [
        { id: 'character', title: '👤 角色卡设定' },
        { id: 'outfit', title: '👗 服装设定' },
        { id: 'scheme', title: '⚡ 启用方案' },
        { id: 'template', title: '📝 注入模板' },
        { id: 'formula', title: '🧩 正则宏公式' }
    ];

    const contentArea = document.createElement('div');
    contentArea.className = 'da-sub-tab-content';

    let activeSubTabId = 'character';
    const subPanes: Record<string, HTMLElement> = {};

    subPanes.character = createCharacterPane(storage, controls);
    subPanes.outfit = createOutfitPane(storage, controls);
    subPanes.scheme = createEnableSchemePane(storage, controls);
    subPanes.template = createInjectionTemplatePane(storage, controls);
    subPanes.formula = createRegexFormulaPane(storage, controls);

    const switchSubTab = (id: string) => {
        activeSubTabId = id;
        navBar.querySelectorAll('.da-sub-tab-btn').forEach((btn) => {
            const b = btn as HTMLButtonElement;
            if (b.dataset.subTabId === id) {
                b.className = 'da-btn primary da-sub-tab-btn';
            } else {
                b.className = 'da-btn secondary da-sub-tab-btn';
            }
        });

        contentArea.innerHTML = '';
        if (subPanes[id]) {
            contentArea.appendChild(subPanes[id]);
        }
    };

    subTabs.forEach((tab) => {
        const btn = document.createElement('button');
        btn.className = `da-btn ${tab.id === activeSubTabId ? 'primary' : 'secondary'} da-sub-tab-btn`;
        btn.dataset.subTabId = tab.id;
        btn.textContent = tab.title;
        btn.onclick = () => switchSubTab(tab.id);
        navBar.appendChild(btn);
    });

    container.appendChild(navBar);
    container.appendChild(contentArea);
    switchSubTab('character');

    return container;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 角色卡设定子页面 (搭载 createCharacterPresetAdapter)
// ═══════════════════════════════════════════════════════════════════════════════
function createCharacterPane(storage: CharacterStorage, controls: ControlFactory): HTMLElement {
    const pane = document.createElement('div');
    pane.className = 'da-sub-pane da-character-pane';

    let currentProfile = storage.getCharacters()[0];

    const nameCNInput = document.createElement('input');
    nameCNInput.className = 'da-input';
    const nameENInput = document.createElement('input');
    nameENInput.className = 'da-input';
    const originInput = document.createElement('input');
    originInput.className = 'da-input';

    const bodyTraitsArea = document.createElement('textarea');
    bodyTraitsArea.className = 'da-textarea';
    bodyTraitsArea.rows = 2;

    const facialArea = document.createElement('textarea');
    facialArea.className = 'da-textarea';
    facialArea.rows = 2;
    const facialBackArea = document.createElement('textarea');
    facialBackArea.className = 'da-textarea';
    facialBackArea.rows = 2;

    const upperSFWArea = document.createElement('textarea');
    upperSFWArea.className = 'da-textarea';
    upperSFWArea.rows = 2;
    const upperSFWBackArea = document.createElement('textarea');
    upperSFWBackArea.className = 'da-textarea';
    upperSFWBackArea.rows = 2;
    const sideSFWArea = document.createElement('textarea');
    sideSFWArea.className = 'da-textarea';
    sideSFWArea.rows = 2;
    const lowerSFWArea = document.createElement('textarea');
    lowerSFWArea.className = 'da-textarea';
    lowerSFWArea.rows = 2;
    const lowerSFWBackArea = document.createElement('textarea');
    lowerSFWBackArea.className = 'da-textarea';
    lowerSFWBackArea.rows = 2;

    const upperNSWFArea = document.createElement('textarea');
    upperNSWFArea.className = 'da-textarea';
    upperNSWFArea.rows = 2;
    const lowerNSWFArea = document.createElement('textarea');
    lowerNSWFArea.className = 'da-textarea';
    lowerNSWFArea.rows = 2;

    const negativeArea = document.createElement('textarea');
    negativeArea.className = 'da-textarea';
    negativeArea.rows = 2;

    const populateForm = (p: CharacterProfile) => {
        currentProfile = p;
        nameCNInput.value = p.nameCN || '';
        nameENInput.value = p.nameEN || '';
        originInput.value = p.charOrigin || '';
        bodyTraitsArea.value = p.bodyTraits || '';
        facialArea.value = p.facialFeatures || '';
        facialBackArea.value = p.facialFeaturesBack || '';
        upperSFWArea.value = p.upperBodySFW || '';
        upperSFWBackArea.value = p.upperBodySFWBack || '';
        sideSFWArea.value = p.sideBodySFW || '';
        lowerSFWArea.value = p.lowerBodySFW || '';
        lowerSFWBackArea.value = p.lowerBodySFWBack || '';
        upperNSWFArea.value = p.upperBodyNSFW || '';
        lowerNSWFArea.value = p.lowerBodyNSFW || '';
        negativeArea.value = p.negativePrompt || '';
    };

    const collectForm = (): CharacterProfile => ({
        ...currentProfile,
        nameCN: nameCNInput.value.trim(),
        nameEN: nameENInput.value.trim(),
        charOrigin: originInput.value.trim(),
        bodyTraits: bodyTraitsArea.value.trim(),
        facialFeatures: facialArea.value.trim(),
        facialFeaturesBack: facialBackArea.value.trim(),
        upperBodySFW: upperSFWArea.value.trim(),
        upperBodySFWBack: upperSFWBackArea.value.trim(),
        sideBodySFW: sideSFWArea.value.trim(),
        lowerBodySFW: lowerSFWArea.value.trim(),
        lowerBodySFWBack: lowerSFWBackArea.value.trim(),
        upperBodyNSFW: upperNSWFArea.value.trim(),
        upperBodyNSFWBack: currentProfile.upperBodyNSFWBack || '',
        lowerBodyNSFW: lowerNSWFArea.value.trim(),
        lowerBodyNSFWBack: currentProfile.lowerBodyNSFWBack || '',
        negativePrompt: negativeArea.value.trim(),
        outfitList: currentProfile.outfitList || []
    });

    const toolbar = bindPresetToolbar({
        adapter: createCharacterPresetAdapter(storage),
        getCurrentData: collectForm,
        applyData: (id) => {
            const found = storage.getCharacters().find((c) => c.id === id);
            if (found) populateForm(found);
        },
        onRefresh: () => {}
    });

    pane.appendChild(toolbar);

    // 基础信息卡片
    pane.appendChild(
        controls.createCard('基础身份信息', (body) => {
            body.appendChild(createFieldRow({ label: '角色中文名', helpTooltip: '绑定宏变量 {nameCN}', control: nameCNInput }));
            body.appendChild(createFieldRow({ label: '英文标识/名称', helpTooltip: '绑定宏变量 {nameEN}', control: nameENInput }));
            body.appendChild(createFieldRow({ label: '角色世界观/原作名', helpTooltip: '同人设定填写，绑定宏变量 {origin}', control: originInput }));
            body.appendChild(createFieldRow({ label: '固有身体特征', helpTooltip: '肤色/身材体型/固定印记，绑定宏变量 {bodyTraits}', control: bodyTraitsArea }));
        })
    );

    // 面部特征卡片
    pane.appendChild(
        controls.createCard('头面部特征', (body) => {
            body.appendChild(createFieldRow({ label: '五官外貌 (正面)', helpTooltip: '发型/发色/眼瞳/面部特征，绑定 {facial}', control: facialArea }));
            body.appendChild(createFieldRow({ label: '头部特征 (背面)', helpTooltip: '发型背面/后脑勺，绑定 {facialBack}', control: facialBackArea }));
        })
    );

    // SFW 裸体姿态特征卡片
    pane.appendChild(
        controls.createCard('SFW 姿态体态特征', (body) => {
            body.appendChild(createFieldRow({ label: '上半身 SFW (正面)', helpTooltip: '胸口/锁骨/手臂，绑定 {upperSFW}', control: upperSFWArea }));
            body.appendChild(createFieldRow({ label: '上半身 SFW (背面)', helpTooltip: '美背/肩胛骨，绑定 {upperSFWBack}', control: upperSFWBackArea }));
            body.appendChild(createFieldRow({ label: '侧身身体 SFW', helpTooltip: '侧身腰线/侧影，绑定 {sideSFW}', control: sideSFWArea }));
            body.appendChild(createFieldRow({ label: '下半身 SFW (正面)', helpTooltip: '腿部/小腿，绑定 {lowerSFW}', control: lowerSFWArea }));
            body.appendChild(createFieldRow({ label: '下半身 SFW (背面)', helpTooltip: '腿部背面，绑定 {lowerSFWBack}', control: lowerSFWBackArea }));
        })
    );

    // NSFW 私密特征与专属负面卡片
    pane.appendChild(
        controls.createCard('NSFW 特征与专属负面', (body) => {
            body.appendChild(createFieldRow({ label: '上半身 NSFW (正面)', helpTooltip: '裸胸/乳房，绑定 {upperNSFW}', control: upperNSWFArea }));
            body.appendChild(createFieldRow({ label: '下半身 NSFW (正面)', helpTooltip: '私处/臀部，绑定 {lowerNSFW}', control: lowerNSWFArea }));
            body.appendChild(createFieldRow({ label: '角色专属负面词', helpTooltip: '负面词，绑定 {negative}', control: negativeArea }));
        })
    );

    if (currentProfile) populateForm(currentProfile);
    return pane;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 服装设定子页面 (搭载 createOutfitPresetAdapter)
// ═══════════════════════════════════════════════════════════════════════════════
function createOutfitPane(storage: CharacterStorage, controls: ControlFactory): HTMLElement {
    const pane = document.createElement('div');
    pane.className = 'da-sub-pane da-outfit-pane';

    let currentOutfit = storage.getOutfits()[0];

    const nameCNInput = document.createElement('input');
    nameCNInput.className = 'da-input';
    const nameENInput = document.createElement('input');
    nameENInput.className = 'da-input';

    const headAccArea = document.createElement('textarea');
    headAccArea.className = 'da-textarea';
    headAccArea.rows = 2;
    const upperBodyArea = document.createElement('textarea');
    upperBodyArea.className = 'da-textarea';
    upperBodyArea.rows = 2;
    const upperBodyBackArea = document.createElement('textarea');
    upperBodyBackArea.className = 'da-textarea';
    upperBodyBackArea.rows = 2;
    const lowerBodyArea = document.createElement('textarea');
    lowerBodyArea.className = 'da-textarea';
    lowerBodyArea.rows = 2;
    const lowerBodyBackArea = document.createElement('textarea');
    lowerBodyBackArea.className = 'da-textarea';
    lowerBodyBackArea.rows = 2;
    const footwearArea = document.createElement('textarea');
    footwearArea.className = 'da-textarea';
    footwearArea.rows = 2;
    const accessoriesArea = document.createElement('textarea');
    accessoriesArea.className = 'da-textarea';
    accessoriesArea.rows = 2;

    const populateForm = (o: OutfitProfile) => {
        currentOutfit = o;
        nameCNInput.value = o.nameCN || '';
        nameENInput.value = o.nameEN || '';
        headAccArea.value = o.headAccessory || '';
        upperBodyArea.value = o.upperBody || '';
        upperBodyBackArea.value = o.upperBodyBack || '';
        lowerBodyArea.value = o.lowerBody || '';
        lowerBodyBackArea.value = o.lowerBodyBack || '';
        footwearArea.value = o.footwear || '';
        accessoriesArea.value = o.accessories || '';
    };

    const collectForm = (): OutfitProfile => ({
        ...currentOutfit,
        nameCN: nameCNInput.value.trim(),
        nameEN: nameENInput.value.trim(),
        headAccessory: headAccArea.value.trim(),
        upperBody: upperBodyArea.value.trim(),
        upperBodyBack: upperBodyBackArea.value.trim(),
        lowerBody: lowerBodyArea.value.trim(),
        lowerBodyBack: lowerBodyBackArea.value.trim(),
        footwear: footwearArea.value.trim(),
        accessories: accessoriesArea.value.trim()
    });

    const toolbar = bindPresetToolbar({
        adapter: createOutfitPresetAdapter(storage),
        getCurrentData: collectForm,
        applyData: (id) => {
            const found = storage.getOutfits().find((o) => o.id === id);
            if (found) populateForm(found);
        },
        onRefresh: () => {}
    });

    pane.appendChild(toolbar);

    pane.appendChild(
        controls.createCard('服装基础与头部配饰', (body) => {
            body.appendChild(createFieldRow({ label: '服装中文名', helpTooltip: '绑定变量 {nameCN}', control: nameCNInput }));
            body.appendChild(createFieldRow({ label: '服装英文标识', helpTooltip: '绑定变量 {nameEN}', control: nameENInput }));
            body.appendChild(createFieldRow({ label: '头部/面部饰品', helpTooltip: '发饰/眼镜/帽子，绑定 {headAcc}', control: headAccArea }));
        })
    );

    pane.appendChild(
        controls.createCard('上身与下身核心穿着', (body) => {
            body.appendChild(createFieldRow({ label: '上半身服装 (正面)', helpTooltip: '衬衫/夹克/连衣裙上身，绑定 {upperBody}', control: upperBodyArea }));
            body.appendChild(createFieldRow({ label: '上半身服装 (背面)', helpTooltip: '服装后背，绑定 {upperBodyBack}', control: upperBodyBackArea }));
            body.appendChild(createFieldRow({ label: '下半身服装 (正面)', helpTooltip: '百褶裙/短裤/长裤，绑定 {lowerBody}', control: lowerBodyArea }));
            body.appendChild(createFieldRow({ label: '下半身服装 (背面)', helpTooltip: '裙子/裤子背面，绑定 {lowerBodyBack}', control: lowerBodyBackArea }));
        })
    );

    pane.appendChild(
        controls.createCard('鞋袜履饰与全身配件', (body) => {
            body.appendChild(createFieldRow({ label: '腿部鞋袜履饰', helpTooltip: '丝袜/短袜/皮鞋/靴子，绑定 {footwear}', control: footwearArea }));
            body.appendChild(createFieldRow({ label: '全身配饰与手部配件', helpTooltip: '手套/腰饰/挎包/挂件，绑定 {accessories}', control: accessoriesArea }));
        })
    );

    if (currentOutfit) populateForm(currentOutfit);
    return pane;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 启用方案子页面 (搭载 createEnableSchemePresetAdapter)
// ═══════════════════════════════════════════════════════════════════════════════
function createEnableSchemePane(storage: CharacterStorage, controls: ControlFactory): HTMLElement {
    const pane = document.createElement('div');
    pane.className = 'da-sub-pane da-scheme-pane';

    let currentScheme = storage.getSchemes()[0];

    const boundCharInput = document.createElement('input');
    boundCharInput.className = 'da-input';
    const boundChatInput = document.createElement('input');
    boundChatInput.className = 'da-input';

    const charRulesBox = document.createElement('div');
    charRulesBox.className = 'da-rules-box';
    const outfitRulesBox = document.createElement('div');
    outfitRulesBox.className = 'da-rules-box';

    const renderRules = () => {
        charRulesBox.innerHTML = '';
        outfitRulesBox.innerHTML = '';

        const characters = storage.getCharacters();
        const outfits = storage.getOutfits();

        characters.forEach((char) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '6px 0';
            row.style.borderBottom = '1px solid var(--da-border-color)';

            const label = document.createElement('span');
            label.textContent = `${char.nameCN} (${char.nameEN || char.id})`;

            const sel = document.createElement('select');
            sel.className = 'da-select';
            sel.innerHTML = `
                <option value="">(禁用)</option>
                <option value="ALL">ALL (始终全局注入)</option>
                <option value="match">match (仅宏匹配时注入)</option>
            `;
            sel.value = currentScheme.characterRules?.[char.id] || '';
            sel.onchange = () => {
                if (!currentScheme.characterRules) currentScheme.characterRules = {};
                if (sel.value) {
                    currentScheme.characterRules[char.id] = sel.value as any;
                } else {
                    delete currentScheme.characterRules[char.id];
                }
            };

            row.appendChild(label);
            row.appendChild(sel);
            charRulesBox.appendChild(row);
        });

        outfits.forEach((outfit) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '6px 0';
            row.style.borderBottom = '1px solid var(--da-border-color)';

            const label = document.createElement('span');
            label.textContent = `${outfit.nameCN} (${outfit.nameEN || outfit.id})`;

            const sel = document.createElement('select');
            sel.className = 'da-select';
            sel.innerHTML = `
                <option value="">(禁用)</option>
                <option value="ALL">ALL (始终全局注入)</option>
                <option value="match">match (仅宏匹配时注入)</option>
            `;
            sel.value = currentScheme.outfitRules?.[outfit.id] || '';
            sel.onchange = () => {
                if (!currentScheme.outfitRules) currentScheme.outfitRules = {};
                if (sel.value) {
                    currentScheme.outfitRules[outfit.id] = sel.value as any;
                } else {
                    delete currentScheme.outfitRules[outfit.id];
                }
            };

            row.appendChild(label);
            row.appendChild(sel);
            outfitRulesBox.appendChild(row);
        });
    };

    const populateForm = (s: EnableSchemeProfile) => {
        currentScheme = s;
        boundCharInput.value = s.boundCharacterCards || '';
        boundChatInput.value = s.boundChatId || '';
        renderRules();
    };

    const collectForm = (): EnableSchemeProfile => ({
        ...currentScheme,
        boundCharacterCards: boundCharInput.value.trim(),
        boundChatId: boundChatInput.value.trim() || undefined,
        characterRules: { ...(currentScheme.characterRules || {}) },
        outfitRules: { ...(currentScheme.outfitRules || {}) }
    });

    const toolbar = bindPresetToolbar({
        adapter: createEnableSchemePresetAdapter(storage),
        getCurrentData: collectForm,
        applyData: (id) => {
            const found = storage.getSchemes().find((s) => s.id === id);
            if (found) populateForm(found);
        },
        onRefresh: () => renderRules()
    });

    pane.appendChild(toolbar);

    pane.appendChild(
        controls.createCard('绑定作用域', (body) => {
            body.appendChild(
                createFieldRow({
                    label: '绑定酒馆角色卡名称',
                    helpTooltip: '多张角色卡以逗号或换行分隔，留空则为全局生效方案',
                    control: boundCharInput
                })
            );
            body.appendChild(
                createFieldRow({
                    label: '绑定聊天 ID (可选)',
                    helpTooltip: '指定特定聊天上下文生效，留空不限制',
                    control: boundChatInput
                })
            );
        })
    );

    pane.appendChild(
        controls.createCard('角色注入规则白名单', (body) => {
            body.appendChild(charRulesBox);
        })
    );

    pane.appendChild(
        controls.createCard('服装注入规则白名单', (body) => {
            body.appendChild(outfitRulesBox);
        })
    );

    if (currentScheme) populateForm(currentScheme);
    return pane;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 注入模板子页面 (搭载 createInjectionTemplatePresetAdapter)
// ═══════════════════════════════════════════════════════════════════════════════
function createInjectionTemplatePane(storage: CharacterStorage, controls: ControlFactory): HTMLElement {
    const pane = document.createElement('div');
    pane.className = 'da-sub-pane da-template-pane';

    let currentTpl = storage.getTemplates()[0];

    const charTplArea = document.createElement('textarea');
    charTplArea.className = 'da-textarea';
    charTplArea.rows = 2;
    const outfitTplArea = document.createElement('textarea');
    outfitTplArea.className = 'da-textarea';
    outfitTplArea.rows = 2;
    const commonCharTplArea = document.createElement('textarea');
    commonCharTplArea.className = 'da-textarea';
    commonCharTplArea.rows = 2;
    const commonOutfitTplArea = document.createElement('textarea');
    commonOutfitTplArea.className = 'da-textarea';
    commonOutfitTplArea.rows = 2;

    const populateForm = (t: InjectionTemplateScheme) => {
        currentTpl = t;
        charTplArea.value = t.characterListTemplate || '';
        outfitTplArea.value = t.innerOutfitTemplate || '';
        commonCharTplArea.value = t.commonCharacterListTemplate || '';
        commonOutfitTplArea.value = t.enableOutfitListTemplate || '';
    };

    const collectForm = (): InjectionTemplateScheme => ({
        ...currentTpl,
        characterListTemplate: charTplArea.value.trim(),
        innerOutfitTemplate: outfitTplArea.value.trim(),
        commonCharacterListTemplate: commonCharTplArea.value.trim(),
        enableOutfitListTemplate: commonOutfitTplArea.value.trim()
    });

    const toolbar = bindPresetToolbar({
        adapter: createInjectionTemplatePresetAdapter(storage),
        getCurrentData: collectForm,
        applyData: (id) => {
            const found = storage.getTemplates().find((t) => t.id === id);
            if (found) populateForm(found);
        },
        onRefresh: () => {}
    });

    pane.appendChild(toolbar);

    pane.appendChild(
        controls.createCard('提示词槽位拼装模板', (body) => {
            body.appendChild(
                createFieldRow({
                    label: '角色列表项模板',
                    helpTooltip: '支持 {nameEN}, {bodyTraits}, {facial}, {upperSFW}, {lowerSFW} 等插槽',
                    control: charTplArea
                })
            );
            body.appendChild(
                createFieldRow({
                    label: '角色专属服装内嵌模板',
                    helpTooltip: '支持 {headAcc}, {upperBody}, {lowerBody}, {footwear}, {accessories}',
                    control: outfitTplArea
                })
            );
            body.appendChild(
                createFieldRow({
                    label: '通用角色列表项模板',
                    helpTooltip: '全局 ALL 注入时的拼装模板',
                    control: commonCharTplArea
                })
            );
            body.appendChild(
                createFieldRow({
                    label: '通用服装列表项模板',
                    helpTooltip: '全局 ALL 注入时的服装拼装模板',
                    control: commonOutfitTplArea
                })
            );
        })
    );

    if (currentTpl) populateForm(currentTpl);
    return pane;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 正则宏公式子页面 (搭载 createRegexFormulaPresetAdapter)
// ═══════════════════════════════════════════════════════════════════════════════
function createRegexFormulaPane(storage: CharacterStorage, controls: ControlFactory): HTMLElement {
    const pane = document.createElement('div');
    pane.className = 'da-sub-pane da-formula-pane';

    let currentScheme = storage.getFormulas()[0];
    const formulasContainer = document.createElement('div');
    formulasContainer.className = 'da-formulas-container';

    const renderFormulasList = () => {
        formulasContainer.innerHTML = '';
        const rules = currentScheme.characterMacroRules?.formulas || [];

        rules.forEach((formula, idx) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.flexDirection = 'column';
            item.style.gap = '6px';
            item.style.padding = '10px';
            item.style.marginBottom = '8px';
            item.style.background = 'var(--da-bg-card, rgba(255, 255, 255, 0.04))';
            item.style.borderRadius = 'var(--da-radius-small, 8px)';
            item.style.border = '1px solid var(--da-border-color)';

            const row1 = document.createElement('div');
            row1.style.display = 'flex';
            row1.style.justifyContent = 'space-between';
            row1.style.alignItems = 'center';

            const title = document.createElement('span');
            title.style.fontWeight = 'bold';
            title.textContent = `#${idx + 1} ${formula.name}`;

            const delBtn = document.createElement('button');
            delBtn.className = 'da-btn danger';
            delBtn.style.padding = '2px 8px';
            delBtn.style.fontSize = '0.8em';
            delBtn.textContent = '删除';
            delBtn.onclick = () => {
                currentScheme.characterMacroRules.formulas.splice(idx, 1);
                renderFormulasList();
            };

            row1.appendChild(title);
            row1.appendChild(delBtn);

            const patternInput = document.createElement('input');
            patternInput.className = 'da-input';
            patternInput.placeholder = '触发后缀 (如 -from_behind)';
            patternInput.value = formula.pattern || '';
            patternInput.onchange = () => {
                formula.pattern = patternInput.value.trim();
            };

            const varsInput = document.createElement('input');
            varsInput.className = 'da-input';
            varsInput.placeholder = '注入变量属性名，逗号分隔 (如 facialFeaturesBack, upperBodySFWBack)';
            varsInput.value = (formula.outputVars || []).join(', ');
            varsInput.onchange = () => {
                formula.outputVars = varsInput.value.split(',').map((v) => v.trim()).filter(Boolean);
            };

            item.appendChild(row1);
            item.appendChild(createFieldRow({ label: '匹配后缀 Pattern', control: patternInput }));
            item.appendChild(createFieldRow({ label: '展开变量 OutputVars', control: varsInput }));

            formulasContainer.appendChild(item);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'da-btn secondary';
        addBtn.textContent = '➕ 添加新宏规则分支';
        addBtn.onclick = () => {
            if (!currentScheme.characterMacroRules) {
                currentScheme.characterMacroRules = { fixedVars: ['nameEN'], formulas: [] };
            }
            currentScheme.characterMacroRules.formulas.push({
                id: `rule_${Date.now()}`,
                name: `新规则 ${currentScheme.characterMacroRules.formulas.length + 1}`,
                enabled: true,
                pattern: '-new_tag',
                outputVars: ['facialFeatures']
            });
            renderFormulasList();
        };
        formulasContainer.appendChild(addBtn);
    };

    const populateForm = (f: RegexFormulaScheme) => {
        currentScheme = f;
        renderFormulasList();
    };

    const collectForm = (): RegexFormulaScheme => ({
        ...currentScheme
    });

    const toolbar = bindPresetToolbar({
        adapter: createRegexFormulaPresetAdapter(storage),
        getCurrentData: collectForm,
        applyData: (id) => {
            const found = storage.getFormulas().find((f) => f.id === id);
            if (found) populateForm(found);
        },
        onRefresh: () => renderFormulasList()
    });

    pane.appendChild(toolbar);

    pane.appendChild(
        controls.createCard('角色宏后缀公式规则 (Macro Formula Rules)', (body) => {
            body.appendChild(formulasContainer);
        })
    );

    if (currentScheme) populateForm(currentScheme);
    return pane;
}
