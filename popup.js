try {
// ===== 全局状态 =====
let currentData = { basic: [], permit: [], complete: [], merge: [], permitBasicMerge: [] };
let stopRequested = { basic: false, permit: false, complete: false };
let isExtracting = { basic: false, permit: false, complete: false };
let uploadedData = { basic: [], permit: [], complete: [] };       // 去重上传 Tab 用（和之前保持兼容）
let retryCount = { basic: 0, permit: 0, complete: 0 };
// 🔴🔗 兼容模式「🔗 提取合并表」一键两步钩子：true 表示 doExtract(permit) 完成后，自动触发 permitMergeBasicFromPermitRows 生成合并表
let pendingPermitMergeAutoStep2 = false;
const MAX_RETRIES = 15; // 最多重试 15 次（约 20 秒）

// ===== 🔴🚧 合并导出 Tab 旧实现已全部删除（按本次需求清空），保留接口桩给后续重构 =====
// 旧变量 queriedData / mergeUploadedData / masterOriginalFields / CHANGE_NOTE_FIELD 已移除。
// 新接口统一挂在 window.__mergeAPI 下（定义在文件末尾），后续重构时直接基于此接口实现。
// 说明：
//   · 施工许可 Tab 的「🔗 提取合并表 / 💾 导出合并表CSV」走 currentData.permitBasicMerge，
//     完全独立，不受本次清空合并导出 Tab 的影响。
//   · 天眼查补全 Tab 的补全结果统一写入 currentData.basic / currentData.permit，
//     不再维护旧的 queriedData 副本。

// ===== 字段定义 =====
const BASIC_FIELDS = [
    '项目名称', '省级项目编号', '项目分类', '建设单位', '组织机构代码',
    '项目所在地', '所在市', '详细地址', '立项文号', '立项级别',
    '立项批复机关', '立项批复时间', '总投资（万元）', '总面积/长度（平方米/米）',
    '建设规模', '建设性质', '工程用途', '计划开工日期', '数据等级'
];

const PERMIT_FIELDS = [
    // ✅ 用户指定的施工许可单独导出顺序：1-23
    // 1工程  2施工许  3省编号  4合同价  5建设地址  6建设规模  7建设单位  8工程总承  9勘察 10设计 11施工 12监理
    '工程名称', '施工许可证编号', '省级项目编号', '合同价格', '建设地址', '建设规模', '建设单位', '工程总承包单位', '勘察单位', '设计单位', '施工单位', '监理单位',
    // 13建设单负 14总承项经 15勘察负 16设计负 17施工负 18总监 19合同工期 20状态 21备注 22发证机关 23数据等级
    '建设单位项目负责人', '工程总承包项目经理', '勘察单位项目负责人', '设计单位项目负责人', '施工单位项目负责人',
    '总监理工程师', '合同工期', '状态', '备注', '发证机关', '数据等级'
];

const COMPLETE_FIELDS = [
    // ✅ 合并导出最后一段的字段顺序（用户明确给出）：省级竣工验收备案编号 → 竣工验收备案编号 → 备案机关 → 结构体系 → 实际造价 → 实际面积 → 实际开工 → 实际竣工 → 数据等级
    '省级竣工验收备案编号', '竣工验收备案编号', '备案机关', '结构体系',
    '实际造价（万元）', '实际面积（平方米）', '实际开工日期',
    '实际竣工日期', '数据等级',
    // 注意：工程名称、省级项目编号是和 basic/permit 连接用的桥接列，在合并时会去重，放在末尾避免打乱前面的顺序
    '工程名称', '省级项目编号'
];

// ===== 🔴✅ 需求2：仅导出列表数据的字段定义（和需求2用户指定的顺序完全一致，每列都有别名兜底匹配）=====
const LIST_ONLY_FIELDS = {
    basic: [
        // 用户指定：项目名称、所在市、省级项目编号、项目分类、建设单位、数据等级
        { key: '项目名称',   aliases: ['项目名称', '工程名称'] },
        // ✅ 所在市别名：去掉「项目所在地」（因为现在两者是完全不同的字段：所在市=列表单列数据；项目所在地=详情页省+市+区拼接）
        { key: '所在市',     aliases: ['所在市', '城市', '所在地', '所在城市'] },
        { key: '省级项目编号', aliases: ['省级项目编号'] },
        { key: '项目分类',   aliases: ['项目分类', '分类'] },
        { key: '建设单位',   aliases: ['建设单位'] },
        { key: '数据等级',   aliases: ['数据等级', '等级', '分级'] }
    ],
    permit: [
        // 用户指定：施工许可证编号、工程名称、省级项目编号、发证机关、数据等级
        { key: '施工许可证编号', aliases: ['施工许可证编号', '许可证编号'] },
        { key: '工程名称',       aliases: ['工程名称', '项目名称'] },
        { key: '省级项目编号',   aliases: ['省级项目编号'] },
        { key: '发证机关',       aliases: ['发证机关', '发证机构'] },
        { key: '数据等级',       aliases: ['数据等级', '等级', '分级'] }
    ],
    complete: [
        // 用户指定：工程名称、竣工验收备案编号、省级项目编号、竣工验收备案机关、数据等级
        // ✅ 注意：绝对不能把省级竣工验收备案编号 和 竣工验收备案编号 的别名混在一起！
        //   省级竣工验收备案编号 = provinceArchiveCode（列表里能找到的省级编号，如 4407832503100001-JX-001）
        //   竣工验收备案编号 = archiveCode（点列表里的「竣工验收备案编号」弹窗弹出的 archiveCode，如 开建验备2026-115）
        { key: '工程名称',                 aliases: ['工程名称', '项目名称'] },
        { key: '省级竣工验收备案编号',     aliases: ['省级竣工验收备案编号', '省级备案编号'] },
        { key: '竣工验收备案编号',         aliases: ['竣工验收备案编号', '备案编号'] },
        { key: '省级项目编号',             aliases: ['省级项目编号'] },
        { key: '竣工验收备案机关',         aliases: ['竣工验收备案机关', '备案机关'] },
        { key: '数据等级',                 aliases: ['数据等级', '等级', '分级'] }
    ]
};
// 仅列表导出 CSV 的表头名（就是上面每一项的 key，保持用户指定的名字）
const LIST_ONLY_HEADERS = {
    basic:    LIST_ONLY_FIELDS.basic.map(f => f.key),
    permit:   LIST_ONLY_FIELDS.permit.map(f => f.key),
    complete: LIST_ONLY_FIELDS.complete.map(f => f.key)
};
// 需求2 辅助：给一行数据，按 LIST_ONLY_FIELDS[type] 里的 aliases 找实际值，返回{key:用户指定表头, value:值}
function extractListOnlyRow(type, row) {
    const defs = LIST_ONLY_FIELDS[type] || [];
    const out = {};
    defs.forEach(def => {
        let found = '';
        if (row[def.key] !== undefined && row[def.key] !== null && String(row[def.key]).trim() !== '') {
            found = row[def.key];
        } else {
            for (let i = 0; i < def.aliases.length; i++) {
                const al = def.aliases[i];
                if (row[al] !== undefined && row[al] !== null && String(row[al]).trim() !== '') {
                    found = row[al];
                    break;
                }
            }
        }
        out[def.key] = found === '' ? '' : found;
    });
    return out;
}

// ===== 🔴✅ 需求1：省级项目编号下拉（可持久化 + 默认 441601/441602 + 「➕ 添加」按钮动态新增）=====
const CODE_LIST_STORAGE_PREFIX = 'sjfpt_code_list_'; // localStorage key 前缀：sjfpt_code_list_basic / permit / complete
const DEFAULT_CODE_LIST = ['441601', '441602'];
// 加载某类型的编号列表（localStorage，无则默认值）
function loadCodeList(type) {
    try {
        const raw = localStorage.getItem(CODE_LIST_STORAGE_PREFIX + type);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) return arr.slice();
        }
    } catch (e) { console.warn('[codeList] 加载失败，用默认值:', e); }
    return DEFAULT_CODE_LIST.slice();
}
// 保存某类型的编号列表
function saveCodeList(type, list) {
    try {
        localStorage.setItem(CODE_LIST_STORAGE_PREFIX + type, JSON.stringify(list || []));
    } catch (e) { console.warn('[codeList] 保存失败:', e); }
}
// 把某类型的编号列表渲染到对应 <datalist>
function renderCodeDatalist(type) {
    const dl = document.getElementById(type + '-code-list');
    if (!dl) return;
    const list = loadCodeList(type);
    dl.innerHTML = '';
    list.forEach(code => {
        if (!code || String(code).trim() === '') return;
        const opt = document.createElement('option');
        opt.value = String(code);
        dl.appendChild(opt);
    });
}
// 需求1 「➕ 添加」按钮 handler：把当前 input.value 非空值加入列表（去重），持久化 + 重渲染
function handleAddCodeBtn(type) {
    const input = document.getElementById(type + '-code');
    if (!input) return;
    const val = (input.value || '').trim();
    if (!val) {
        alert('请先在「省级项目编号」输入框中输入要添加的值！');
        return;
    }
    let list = loadCodeList(type);
    if (list.indexOf(val) !== -1) {
        alert('「' + val + '」已经在下啦列表中了！');
        return;
    }
    list.push(val);
    saveCodeList(type, list);
    renderCodeDatalist(type);
    // 保持输入框内容不变（用户可以继续用这个值搜）
    try { updateStatus(type + '-status', '✅ 已添加「' + val + '」到省级项目编号下拉选项（共' + list.length + '个）。', 'success'); } catch (e) {}
    console.log('[codeList] ✅ ' + type + ' 添加=' + val + ', 列表共=' + list.length + '个');
}
// 初始化：页面一打开就给三个 tab 渲染 datalist
['basic', 'permit', 'complete'].forEach(t => { try { renderCodeDatalist(t); } catch (e) {} });

// ===== 🔴✅ 需求3：查询范围 pageMode 辅助 =====
// 当 pageMode 变了，同步禁用/启用「起始页码/结束页码」输入框
function syncPageModeInputs(type) {
    try {
        const modeEl = document.getElementById(type + '-pageMode');
        const startEl = document.getElementById(type + '-startPage');
        const endEl = document.getElementById(type + '-endPage');
        const fetchModeEl = document.getElementById(type + '-fetchMode');
        if (!modeEl || !startEl || !endEl) return;

        const pageMode = modeEl.value || 'range';
        // 🔴 极速模式：强制起始页=1 且禁用；兼容模式才能改起始页
        const isRapidMode = fetchModeEl && (fetchModeEl.value === 'api' || fetchModeEl.value === 'smart');
        if (isRapidMode) {
            startEl.value = '1';   // 强制重置为 1
            startEl.disabled = true;
            startEl.title = '🚀 极速模式固定从第 1 页开始抓取（如需跳页，请切换到兼容模式）';
        } else if (pageMode === 'range') {
            startEl.disabled = false;
            startEl.title = '';
        } else {
            startEl.disabled = true;
            if (pageMode === 'current') startEl.title = '选择了「仅当前页」，自动使用页面当前打开页号';
            else startEl.title = '选择了「全部页」，自动从第 1 页抓到最后一页';
        }

        // 结束页码：极速模式下也允许用户自由设置（抓 1-N 页），仅"current"禁用
        if (pageMode === 'current') {
            endEl.disabled = true;
            endEl.title = '选择了「仅当前页」，自动使用页面当前打开页号';
        } else if (isRapidMode) {
            endEl.disabled = false;
            endEl.title = '🚀 极速模式：抓取第 1 页 到 第 N 页（N 可自由修改）';
        } else {
            endEl.disabled = false;
            endEl.title = '';
        }
    } catch (e) { console.warn('[pageMode] sync 失败:', e); }
}

// 🔴 抓取模式切换（极速 / 兼容）
//    dom 兼容（默认）：显示「查询范围+起止页码」整行，隐藏「提取总条数」输入框 & 「获取全部数据」按钮
//    api 极速：隐藏「查询范围+起止页码」整行，显示「提取总条数」输入框 & 「获取全部数据」按钮
function syncFetchModeInputs(type) {
    try {
        const fetchModeEl = safeGetElement(type + '-fetchMode');
        const isRapid = !!(fetchModeEl && (fetchModeEl.value === 'api' || fetchModeEl.value === 'smart'));

        // 所有 tab 共用 body.rapid-mode（3 个 tab 一起控制，防止切 tab 乱显示）
        if (isRapid) document.body.classList.add('rapid-mode');
        else document.body.classList.remove('rapid-mode');

        // 每页条数输入框 → 兼容模式下灰掉禁用
        const psInput = safeGetElement(type + '-apiPageSize');
        if (psInput) {
            psInput.disabled = !isRapid;
            psInput.title = isRapid
                ? '填写本次需要抓取的总数据条数（相当于 endPage × 每页条数）'
                : '仅极速模式下可编辑（当前为兼容模式）';
        }

        // 「📥 获取全部数据」按钮 → 仅极速模式可见
        const allBtn = safeGetElement(type + '-extractAll');
        if (allBtn) allBtn.style.display = isRapid ? '' : 'none';

        // permit Tab：合并表相关按钮（🔗 提取合并表）→ 兼容模式/极速模式都可用
        if (type === 'permit') {
            const mergeBtn = safeGetElement('permit-extractMerge');
            if (mergeBtn) mergeBtn.style.display = ''; // 两种模式都显示
        }

        // 保持原有 pageMode 禁用逻辑（兼容模式下 range/current/all 规则继续生效）
        try { syncPageModeInputs(type); } catch (e) {}
    } catch (e) { console.warn('[fetchMode] sync 失败:', e); }
}

// ===== 工具函数 =====
function showProgress(elementId, percent) {
    try {
        const bar = document.getElementById(elementId);
        if (!bar) return;
        bar.style.display = 'block';
        const fill = bar.querySelector('.progress-bar-fill');
        if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    } catch (e) { console.warn('进度条更新失败:', e); }
}

function hideProgress(elementId) {
    try {
        const bar = document.getElementById(elementId);
        if (bar) bar.style.display = 'none';
    } catch (e) {}
}

// ===== 天眼查补全：单位后缀列「锚定插入到对应基础单位列后面」公共函数（合并导出 Tab + 施工许可合并表 + 天眼查补全 apply 阶段共用）
//   参数：
//     mergedFields: string[]                     → 原有字段数组（按基础字段顺序），会被修改并返回
//     addedFieldSet: Set<string> | null          → 已加入字段的 Set，传 null 时内部根据 mergedFields 自动构建
//     allColsSource: string[] | Object[] | Set<string> → 全部候选列来源（若传 Object[] 会自动扫 rows.keys）
//     opts.appendCustomColsAtEnd: boolean (默认 true) → 处理完锚定插入后，是否把剩余自定义列追加到末尾
//     opts.prefixTycRule: Array<{role:string[], anchor:string[]}> | null (默认 null → 用内置 6 角色)
//     opts.keepSuffixes: string[] | null (默认 null → 用内置 5 个：社会信用代码、电话、法人、地址、成立日期，不含 _匹配单位名)
//   返回：{ fields: string[], addedSet: Set<string> }
//   关键：自动过滤 _匹配单位名 列（因为是天眼查补全过程中多余辅助列）
var TYC_DEFAULT_KEEP_SUFFIX = ['社会信用代码', '电话', '法人', '地址', '成立日期'];
var TYC_DEFAULT_ROLE_ANCHOR = [
    // ✅ 建设单位：优先跟在「许可_建设单位」后面（permit 侧冲突字段，用户明确要求）；只有没查 permit 时才 fallback 到 basic 侧纯「建设单位」后
    { role: ['建设单位'], anchor: ['许可_建设单位', '建设单位'] },
    // ✅ 其余 5 类单位：真实 mergedFields 里是纯列名（因为 PERMIT_FIELDS 有但 BASIC_FIELDS 没有 → 不重名 → 不加许可_前缀），所以 anchor 优先纯列名；兼容旧合并表才兜底「许可_」前缀
    { role: ['工程总承包单位', '许可_工程总承包单位'], anchor: ['工程总承包单位', '许可_工程总承包单位'] },
    { role: ['勘察单位', '许可_勘察单位'], anchor: ['勘察单位', '许可_勘察单位'] },
    { role: ['设计单位', '许可_设计单位'], anchor: ['设计单位', '许可_设计单位'] },
    { role: ['施工单位', '许可_施工单位'], anchor: ['施工单位', '许可_施工单位'] },
    { role: ['监理单位', '许可_监理单位'], anchor: ['监理单位', '许可_监理单位'] }
];
function anchorInsertTycColumnsIntoFields(mergedFields, addedFieldSet, allColsSource, opts) {
    opts = opts || {};
    var keepSuffixes = Array.isArray(opts.keepSuffixes) ? opts.keepSuffixes.slice() : TYC_DEFAULT_KEEP_SUFFIX.slice();
    var roleAnchor = Array.isArray(opts.prefixTycRule) ? opts.prefixTycRule : TYC_DEFAULT_ROLE_ANCHOR.slice();
    var appendCustom = opts.appendCustomColsAtEnd !== false;
    // 1. 构建 addedSet
    var addedSet = (addedFieldSet instanceof Set) ? new Set(addedFieldSet) : new Set((Array.isArray(mergedFields) ? mergedFields : []));
    var fields = Array.isArray(mergedFields) ? mergedFields.slice() : [];
    function pushF(name) { if (name == null) return; if (!addedSet.has(name)) { addedSet.add(name); fields.push(String(name)); } }
    // 2. 构建 allColSet（所有候选列）
    var allColSet = new Set();
    if (allColsSource instanceof Set) {
        allColsSource.forEach(function(k) { if (k != null) allColSet.add(String(k)); });
    } else if (Array.isArray(allColsSource) && allColsSource.length > 0 && (typeof allColsSource[0] === 'string' || allColsSource[0] instanceof String)) {
        allColsSource.forEach(function(k) { if (k != null) allColSet.add(String(k)); });
    } else {
        // rows：扫每个 row 的 keys
        (allColsSource || []).forEach(function(r) {
            if (!r || typeof r !== 'object') return;
            try { Object.keys(r).forEach(function(k) { allColSet.add(k); }); } catch (_) {}
        });
    }
    // 3. 对每个角色：找 anchor + 收集对应 5 个补全列 + 锚定插入
    roleAnchor.forEach(function(rule) {
        var anchorCol = null;
        for (var ai = 0; ai < rule.anchor.length; ai++) {
            if (addedSet.has(rule.anchor[ai])) { anchorCol = rule.anchor[ai]; break; }
        }
        if (!anchorCol) return;
        var tycCols = [];
        (rule.role || []).forEach(function(rolePrefix) {
            keepSuffixes.forEach(function(suf) {
                var cand1 = rolePrefix + '_' + suf;
                if (allColSet.has(cand1) && !addedSet.has(cand1)) { tycCols.push(cand1); allColSet.delete(cand1); }
            });
        });
        if (tycCols.length === 0) return;
        var idx = fields.indexOf(anchorCol);
        if (idx < 0) { tycCols.forEach(pushF); return; }
        var left = fields.slice(0, idx + 1);
        var right = fields.slice(idx + 1);
        tycCols.forEach(function(col) {
            if (!addedSet.has(col)) { addedSet.add(col); left.push(col); }
        });
        fields = left.concat(right);
    });
    // 4. 剩余自定义列（不在 addedSet 里的 + 在 allColSet 里的）→ 追加末尾
    if (appendCustom) {
        allColSet.forEach(function(col) {
            if (col == null) return;
            // ✅ 显式过滤：_匹配单位名 相关的天眼查辅助匹配列（用户说多余，不要出现在最终表里）
            if (String(col).endsWith('_匹配单位名')) return;
            pushF(col);
        });
    }
    return { fields: fields, addedSet: addedSet };
}

function updateStatus(elementId, message, type) {
    try {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.className = 'status' + (type ? ' ' + type : '');
        el.textContent = message;
    } catch (e) { console.warn('状态更新失败:', e); }
}

function renderTable(elementId, data, fields) {
    try {
        const tableWrapper = document.getElementById(elementId);
        if (!tableWrapper) return;
        if (!data || data.length === 0) {
            tableWrapper.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">暂无数据</div>';
            tableWrapper.style.display = 'block';
            return;
        }
        // 🔴✅ 新功能：每列筛选值存储（闭包），筛选框 change 时重绘 tbody（不重新生成整个 table，保留筛选框内容）
        if (!tableWrapper._filterState) tableWrapper._filterState = {};
        const filterState = tableWrapper._filterState;
        // 应用筛选：算出可见行索引数组
        const visibleIdx = [];
        for (let ri = 0; ri < data.length; ri++) {
            let ok = true;
            for (let fi = 0; fi < fields.length; fi++) {
                const fName = fields[fi];
                const kw = filterState[fName];
                if (!kw) continue;
                const val = data[ri][fName] !== undefined && data[ri][fName] !== null ? String(data[ri][fName]) : '';
                if (val.toLowerCase().indexOf(kw.toLowerCase()) === -1) { ok = false; break; }
            }
            if (ok) visibleIdx.push(ri);
        }
        const resultCount = visibleIdx.length;

        // ========== 表头：sticky 冻结 + 每列筛选输入框（两层 thead） ==========
        let html = '<table class="data-table" style="border-collapse: separate;">';
        html += '<thead style="position: sticky; top: 0; z-index: 10;">';
        // 第一层：字段名（冻结第一行）
        html += '<tr style="background: linear-gradient(180deg,#fafafa 0%,#f0f5ff 100%);">';
        fields.forEach(f => { html += `<th style="position: sticky; top: 0; z-index: 20; border: 1px solid #e8e8e8; border-top: none; padding: 10px 12px; font-weight: 600; color: #262626; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.06);">${f}</th>`; });
        html += '</tr>';
        // 第二层：筛选输入框（也冻结）
        html += '<tr style="background:#fffbe6;">';
        fields.forEach(f => {
            const curKw = filterState[f] || '';
            html += `<th style="position: sticky; top: 36px; z-index: 20; border: 1px solid #ffe58f; border-top: none; padding: 4px 6px; background:#fffbe6;">
                <input type="text" data-filter-field="${f}" value="${curKw.replace(/"/g, '&quot;')}" placeholder="🔍 筛选${f.length > 6 ? '' : f}..."
                    style="width:100%; padding:3px 6px; font-size:11px; border:1px solid #d9d9d9; border-radius:3px; outline:none; background:#fff;" />
            </th>`;
        });
        html += '</tr></thead>';
        html += '<tbody>';
        // ========== 数据行 ==========
        if (resultCount === 0) {
            html += `<tr><td colspan="${fields.length}" style="padding:24px; text-align:center; color:#8c8c8c;">🔍 当前筛选条件下无匹配数据（共${data.length}条）</td></tr>`;
        } else {
            visibleIdx.forEach((ri, dispIdx) => {
                const row = data[ri];
                html += `<tr data-row-idx="${ri}" style="${dispIdx % 2 === 0 ? 'background:#fff;' : 'background:#fafbfc;'}">`;
                fields.forEach(f => {
                    const val = row[f] !== undefined && row[f] !== null ? row[f] : '';
                    const safeStr = String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    html += `<td title="${safeStr}" style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;">${safeStr}</td>`;
                });
                html += '</tr>';
            });
        }
        html += '</tbody></table>';
        // 底部统计条
        html += `<div style="padding:6px 12px; background:#f6ffed; border-top:1px solid #b7eb8f; font-size:11px; color:#389e0d; position: sticky; bottom: 0; z-index: 9;">
            📊 总 ${data.length} 条 &nbsp;|&nbsp; 🔍 匹配 ${resultCount} 条 &nbsp;|&nbsp; 📐 共 ${fields.length} 列
        </div>`;

        tableWrapper.innerHTML = html;
        tableWrapper.style.display = 'block';

        // ========== 绑定筛选输入框事件：输入即实时筛选 ==========
        const filterInputs = tableWrapper.querySelectorAll('input[data-filter-field]');
        filterInputs.forEach(inp => {
            const fName = inp.getAttribute('data-filter-field');
            // 让输入框内容保持焦点和光标位置（因为我们是重新生成HTML，所以这里简单处理）
            inp.addEventListener('input', () => {
                filterState[fName] = (inp.value || '').trim();
                renderTable(elementId, data, fields); // 递归重绘（会保留 filterState，因为存在 tableWrapper 上）
                // 重新渲染后把焦点还给这个输入框，并把光标放在末尾
                setTimeout(() => {
                    const newInp = tableWrapper.querySelector('input[data-filter-field="' + fName + '"]');
                    if (newInp) {
                        newInp.focus();
                        try { const L = newInp.value.length; newInp.setSelectionRange(L, L); } catch (e) {}
                    }
                }, 0);
            });
        });
    } catch (e) { console.warn('表格渲染失败:', e); }
}

// 🔴🚧 合并 Tab 旧实现（refreshMergeStats / handleMergeUploadFile）已删除，
// 后续重构通过 window.__mergeAPI 暴露对应方法。

function generateCSV(data, fields, isNumberFn) {
    const isNumber = isNumberFn || (() => false);
    const headers = fields.map(f => `"${f}"`).join(',');
    const rows = data.map(row => {
        return fields.map(f => {
            let val = row[f] !== undefined && row[f] !== null ? String(row[f]) : '';
            val = val.replace(/"/g, '""').replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
            if (isNumber(f) && val && !isNaN(Number(val.replace(/,/g, '')))) {
                return val.replace(/,/g, '');
            }
            return `"${val}"`;
        }).join(',');
    });
    return '\uFEFF' + headers + '\n' + rows.join('\n');
}

function downloadCSV(csv, filename) {
    try {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) { alert('CSV导出失败: ' + e.message); }
}

function sortData(data, type) {
    if (!data || data.length === 0) return [];
    // 施工许可：去掉接口多余字段「日期」「所在城市」（用户明确指定，不影响其他字段）
    const cleaned = (type === 'permit')
        ? data.map(r => {
            if (!r || typeof r !== 'object') return r;
            try {
                if ('日期' in r) delete r['日期'];
                if ('所在城市' in r) delete r['所在城市'];
            } catch (e) {}
            return r;
          })
        : data;
    const key = type === 'basic' ? '项目名称' : (type === 'complete' ? '工程名称' : '施工许可证编号');
    return [...cleaned].sort((a, b) => (a[key] || '').toString().localeCompare(b[key] || '', 'zh-CN'));
}

function isInUploadedData(row, uploaded, dedupFields) {
    if (!uploaded || uploaded.length === 0) return false;
    return uploaded.some(u => {
        return dedupFields.every(field => {
            const a = row[field] || '';
            const b = u[field] || '';
            return String(a).trim() === String(b).trim();
        });
    });
}

function safeGetElement(id) {
    return document.getElementById(id);
}

// ===== 发送消息到 content script =====
//    新增第5个参数 progressCallback：支持异步长任务的进度推送
//    content 端发 message = {__progress: true, data: {...}} 时不进入 callback，转进 progressCallback
function sendToContent(message, callback, fallbackCallback, errorCallback, progressCallback) {
    try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                if (errorCallback) errorCallback('未找到活动标签页');
                else if (fallbackCallback) fallbackCallback();
                return;
            }
            const tab = tabs[0];
            const tabId = tab.id;
            const tabUrl = tab.url || '';
            if (!tabId) {
                if (errorCallback) errorCallback('无效的标签页 ID');
                return;
            }
            console.log('[popup] sendToContent: tabId=' + tabId + ' url=' + tabUrl + ' action=' + (message && message.action));

            // 先尝试直接发消息
            chrome.tabs.sendMessage(tabId, message, (resp) => {
                if (!chrome.runtime.lastError) {
                    // 🔴 异步进度：content 不直接 return result，而是先发多条 __progress
                    if (resp && resp.__progress === true) {
                        if (progressCallback) try { progressCallback(resp.data || {}); } catch (e) {}
                        return;  // 不进入 callback，继续等下一次消息 / 最终结果
                    }
                    // 如果 content.js 初始化有错误，这里能看到 initError
                    if (resp && resp.initError) {
                        console.error('[popup] content.js 有初始化错误:', resp.initError);
                    }
                    if (callback) callback(resp);
                    return;
                }
                console.warn('[popup] content script 未就绪，尝试重新注入:', chrome.runtime.lastError.message);
                // content script 不存在 → 手动注入
                try {
                    chrome.scripting.executeScript(
                        { target: { tabId: tabId }, files: ['content.js'] },
                        (results) => {
                            if (chrome.runtime.lastError || !results) {
                                const injectErr = chrome.runtime.lastError ? chrome.runtime.lastError.message : '未知错误';
                                console.error('[popup] 注入失败:', injectErr);
                                // 给用户更明确的提示
                                if (tabUrl.indexOf('skypt.gdcic.net') === -1 && tabUrl.indexOf('chrome://') === -1) {
                                    if (errorCallback) errorCallback('当前页面不在 skypt.gdcic.net 域名下，无法提取数据。\n当前 URL: ' + tabUrl);
                                } else {
                                    if (errorCallback) errorCallback('无法在当前页面运行脚本。请刷新页面（F5）后重试！\n如果仍失败，请在 chrome://extensions/ 中"重新加载"本扩展。');
                                }
                                return;
                            }
                            console.log('[popup] 注入成功，等待监听器注册...');
                            // 注入成功后等待更长时间（1.2s），确保 content.js 的 IIFE 完整执行
                            setTimeout(() => {
                                chrome.tabs.sendMessage(tabId, message, (resp2) => {
                                    if (chrome.runtime.lastError) {
                                        console.error('[popup] 二次通信失败:', chrome.runtime.lastError.message);
                                        if (errorCallback) errorCallback('注入后仍无法通信。请：\n1. 按 F5 刷新当前页面\n2. 等待页面完全加载后再试\n3. 或在 chrome://extensions/ 重新加载扩展后刷新页面');
                                        else if (fallbackCallback) fallbackCallback();
                                        return;
                                    }
                                    // 🔴 进度推送（注入分支也要处理）
                                    if (resp2 && resp2.__progress === true) {
                                        if (progressCallback) try { progressCallback(resp2.data || {}); } catch (e) {}
                                        return;
                                    }
                                    if (resp2 && resp2.initError) {
                                        console.error('[popup] content.js 初始化错误:', resp2.initError);
                                    }
                                    if (callback) callback(resp2);
                                });
                            }, 1200);
                        }
                    );
                } catch (e) {
                    console.error('[popup] 注入异常:', e);
                    if (errorCallback) errorCallback(e.message);
                    else if (fallbackCallback) fallbackCallback();
                }
            });
        });
    } catch (err) {
        if (errorCallback) errorCallback(err.message);
        else if (fallbackCallback) fallbackCallback();
    }
}

// ===== 停止操作 =====
function stopExtract(type) {
    stopRequested[type] = true;
    try { chrome.runtime.sendMessage({ action: 'stop', type: type }); } catch (e) {}
    updateStatus(type + '-status', '⏹ 用户已停止。已提取的数据可预览或导出。', '');
    const stopBtn = safeGetElement(type + '-stop');
    if (stopBtn) stopBtn.style.display = 'none';
    // 不隐藏进度条，保留当前状态
    isExtracting[type] = false;
}

// ===== 提取主流程 =====
function doExtract(type, filters) {
    if (isExtracting[type]) {
        updateStatus(type + '-status', '⚠️ 正在提取中，请稍候或点击停止...', '');
        return;
    }

    // 初始化状态
    stopRequested[type] = false;
    retryCount[type] = 0;
    isExtracting[type] = true;
    try { chrome.runtime.sendMessage({ action: 'resetStop', type: type }); } catch (e) {}
    try { chrome.runtime.sendMessage({ action: 'clearResults', type: type }); } catch (e) {}

    const progressId = type + '-progress';
    const statusId = type + '-status';
    const stopBtn = safeGetElement(type + '-stop');
    if (stopBtn) stopBtn.style.display = 'inline-block';

    // 检查页面是否正确
    updateStatus(statusId, '🔍 正在检测页面...');
    showProgress(progressId, 3);

    sendToContent(
        { action: 'checkPage', type: type },
        (resp) => {
            if (stopRequested[type]) { isExtracting[type] = false; return; }
            // resp = { valid: bool, pageType: 'list'|'detail'|'unknown'|'other', listKind: 'basic'|'permit'|'complete' }
            if (resp && resp.valid) {
                updateStatus(statusId, '✅ 页面已就绪，开始提取...');
                setTimeout(() => processListPhase(type, filters, statusId, progressId, stopBtn), 300);
            } else if (resp && resp.pageType === 'other') {
                updateStatus(statusId, '❌ 请先在浏览器中打开正确的网站页面（skypt.gdcic.net）！', 'error');
                hideProgress(progressId);
                isExtracting[type] = false;
                if (stopBtn) stopBtn.style.display = 'none';
            } else {
                // 未知页面，仍尝试提取（可能是目标页面但内容尚未完全加载）
                updateStatus(statusId, '⚠️ 页面类型不确定，仍尝试提取...');
                setTimeout(() => processListPhase(type, filters, statusId, progressId, stopBtn), 500);
            }
        },
        () => {
            // content script 未响应 - 可能页面未加载好或内容脚本未注入
            updateStatus(statusId, '❌ 无法连接到页面内容脚本。请确保：\n1. 当前标签页是 skypt.gdcic.net 网站\n2. 页面已完全加载\n3. 必要时刷新页面后重试', 'error');
            hideProgress(progressId);
            isExtracting[type] = false;
            if (stopBtn) stopBtn.style.display = 'none';
        },
        (errMsg) => {
            updateStatus(statusId, '❌ 页面通信失败: ' + errMsg, 'error');
            hideProgress(progressId);
            isExtracting[type] = false;
            if (stopBtn) stopBtn.style.display = 'none';
        }
    );
}

function processListPhase(type, filters, statusId, progressId, stopBtn) {
    let currentPage = filters.startPage;
    let totalPages = filters.endPage;
    let allListResults = [];
    let processedPageCount = 0;
    const totalPagesStep = Math.max(1, totalPages - currentPage + 1);
    let finalMsgShown = false;

    function processNextPage() {
        if (stopRequested[type]) { finishExtraction(type, allListResults, [], statusId, progressId, stopBtn); return; }

        if (currentPage > totalPages) {
            // 列表阶段完成
            if (allListResults.length === 0) {
                updateStatus(statusId, '⚠️ 未提取到任何列表数据，请检查筛选条件或页面是否正确。', 'error');
                hideProgress(progressId);
                isExtracting[type] = false;
                if (stopBtn) stopBtn.style.display = 'none';
                return;
            }
            startDetailPhase(type, allListResults, statusId, progressId, stopBtn);
            return;
        }

        updateStatus(statusId, `🔍 正在提取第 ${currentPage}/${totalPages} 页列表...（已获取 ${allListResults.length} 条）`);
        const listPercent = Math.round((processedPageCount / totalPagesStep) * 60);
        showProgress(progressId, listPercent);

        sendToContent(
            { action: 'extractList', type: type, page: currentPage, filters: filters },
            (resp) => {
                if (stopRequested[type]) { finishExtraction(type, allListResults, [], statusId, progressId, stopBtn); return; }

                // 🔴✅ 翻页错乱防御：actualPage = content实际抓到的页；如果≠请求页currentPage，就重抓这一页！
                //     避免把第3页数据当成第1页加进去导致错乱
                var actualPage = resp && resp.currentPage ? Number(resp.currentPage) : 0;
                var gotData = resp && resp.data && resp.data.length > 0;

                // 🔴 极速模式 via=api：actualPage 永远是 targetPage=1（因为 content.js 内部一次性 pageNum=1&pageSize=总条数）
                //    如果请求页 currentPage != 1 且 actualPage=1 → 代表这已经是第 2+ 次翻页请求了，但 content 返回的还是旧的合并数据
                //    → 直接 forceStop 忽略重复请求数据（否则 1→2→3→4→1→2→3→4 死循环，每页 Network 都重复两次）
                if (viaApi && gotData && currentPage > 1 && actualPage === 1) {
                    console.warn('[popup] 🛑 via=api 但 currentPage=' + currentPage + ' >1，实际 actualPage=1 → 判定为 popup 误翻页，丢弃本次重复数据并 forceStop！');
                    forceStop = true;
                    gotData = false;  // 不加这重复数据
                }

                if (!forceStop && gotData && actualPage > 0 && actualPage !== currentPage) {
                    console.warn('[popup] ⚠️ 翻页错乱：请求页=' + currentPage + ', 实际抓到的页=' + actualPage + ' → 这一页数据丢弃，重抓！');
                    retryCount[type]++;
                    if (retryCount[type] >= 3) {
                        if (viaApi) {
                            // via=api：重试 3 次仍然 actualPage!=currentPage → content.js 已经把所有数据一次性返回并结束，再翻页只会循环
                            console.warn('[popup] ⚠️ via=api，翻页重抓超过3次 → 代表 content.js 已一次性完成，停止翻页');
                            retryCount[type] = 0;
                            forceStop = true;
                        } else {
                            console.warn('[popup] ⚠️ 翻页重抓超过3次，放弃这一页继续下一页');
                            retryCount[type] = 0;
                        }
                    } else {
                        updateStatus(statusId, `🔄 翻页错乱！请求页=${currentPage}, 实际页=${actualPage} → 重抓中(${retryCount[type]}/3)...`);
                        // 把 currentPage 恢复到这一页重新处理（因为后面会 currentPage++，所以-- 后又++ 回到原页）
                        currentPage--;
                        setTimeout(processNextPage, 1500);
                        return;
                    }
                }

                retryCount[type] = 0; // 成功后重置重试计数

                // ================================================================
                // 🔴✅ 用户中止爬取（从验证码悬浮层点了"中止爬取"）
                // ================================================================
                if (resp && resp.aborted === true) {
                    console.warn('[popup] 🚫 用户中止爬取！停止翻页，当前已有 ' + allListResults.length + ' 条');
                    try {
                        updateStatus(statusId, '🚫 用户中止了爬取，停止翻页。已获取 ' + allListResults.length + ' 条数据，直接进入详情提取（如有）...', 'warn');
                    } catch (e) {}
                    stopRequested[type] = true; // 设置停止标志
                    // 立即跳到详情阶段（相当于完成列表阶段）
                    if (allListResults.length === 0) {
                        updateStatus(statusId, '🚫 用户中止爬取，暂无数据。', 'error');
                        hideProgress(progressId);
                        isExtracting[type] = false;
                        if (stopBtn) stopBtn.style.display = 'none';
                        return;
                    }
                    startDetailPhase(type, allListResults, statusId, progressId, stopBtn);
                    return;
                }

                // ================================================================
                // 🔴 极速模式：content.js 已经合并为「pageNum=1&pageSize=结束页×每页条数」一次性拉完
                //    不再存在「逐页循环+每页弹验证码」，这里只做一次性结果的处理：
                //      • 无论有没有筛选，若总数据>300 都会被截断 → 提醒一次，不再重复翻页
                //      • 无筛选时，totalPages=1，循环自然结束
                // ================================================================
                var viaApi = resp && resp.via === 'api';
                var forceStop = false;
                var HARD_LIMIT_FILTERED = 300;
                var hasFilterOn = !!(resp && resp.hasFilter === true);

                // 🔴✅【重要】先把本页数据 accumulate 进去，再判断 forceStop！
                //    之前逻辑错误：先 forceStop=true 再判断 "!forceStop 才 concat" → 导致 300 截断时拿到了 300 条数据却全部丢掉！
                var apiFailed = (resp && resp.success === false) || (resp && resp.error);
                if (gotData && !apiFailed) {
                    var viaStr = viaApi ? ('[API' + (resp.needCaptcha ? '+验证码' : '') + ']') : '[DOM]';
                    console.log('[popup] 📄 ' + viaStr + ' 第' + currentPage + '页抓取成功（请求=' + currentPage + ', 实际=' + (actualPage || '?') + '）+ ' + resp.data.length + ' 条 → 累计=' + (allListResults.length + resp.data.length));
                    allListResults = allListResults.concat(resp.data);
                } else if (apiFailed) {
                    // 🔴 极速模式 API 失败（用户要求禁止回退 DOM，所以这里直接 forceStop + 暴露真实错误，不要拿"未提取到数据"掩盖）
                    forceStop = true;
                    finalMsgShown = true;
                    var errTxt = (resp && resp.error) ? String(resp.error) : '极速模式失败';
                    console.error('[popup] 📄 第' + currentPage + '页极速模式 API 失败（不再回退 DOM）：' + errTxt + ' via=' + (resp && resp.via ? resp.via : ''));
                    try {
                        var viaTag = (resp && resp.via) ? (' [' + resp.via + ']') : '';
                        updateStatus(statusId, '❌ 极速模式失败' + viaTag + '：' + errTxt, 'error');
                    } catch (e) {}
                    gotData = false;
                } else if (resp && resp.error) {
                    console.warn('[popup] 📄 第' + currentPage + '页抓失败: ' + resp.error);
                } else {
                    console.log('[popup] 📄 第' + currentPage + '页无数据（可能已到最后一页）');
                }

                if (resp && resp.partialSuccess === true) {
                    var got = Number(resp.partialActualCount || allListResults.length) || 0;
                    var wanted = Number(resp.partialWantedCount || 0) || 0;
                    var errPartial = (resp && resp.error) ? String(resp.error) : '';
                    console.warn('[popup] ⚠️ 无筛选一次性部分成功：想要 ' + wanted + ' 条，实际 API 返回 ' + got + ' 条' + (errPartial ? ('，原因：' + errPartial) : ''));
                    try {
                        var pMsg = '⚠️ 【极速模式·无筛选】部分成功\n\n' +
                            '预期抓取 ' + wanted + ' 条，实际成功拿到 ' + got + ' 条。\n\n' +
                            (errPartial ? ('原因：' + errPartial + '\n\n') : '') +
                            '✅ 建议：如需更多真实数据，请缩小抓取范围或分批抓取。\n\n' +
                            '—— 当前已获取 ' + allListResults.length + ' 条，进入详情提取...';
                        updateStatus(statusId, pMsg, 'warn');
                        finalMsgShown = true;
                    } catch (e) {}
                }
                else if (resp && (resp.beyondLimit === true || resp.truncated === true || resp.filteredLimitReached === true)) {
                    forceStop = true;
                    finalMsgShown = true;
                    var hl = Number(resp.hardLimit || HARD_LIMIT_FILTERED);
                    var rt = Number(resp.realTotal || resp.total || 0);
                    console.warn('[popup] ⚠️ 极速模式一次性拉完截断（无论有无筛选都适用）：beyondLimit=' + !!resp.beyondLimit + ', truncated=' + !!resp.truncated + ', realTotal=' + rt + ', hardLimit=' + hl + ', 本次已积累数据=' + allListResults.length);
                    try {
                        var warn = '⚠️ 【极速模式】服务器分页上限提醒\n\n'
                            + (rt > 0 ? ('命中 ' + rt + ' 条数据。\n') : '')
                            + '服务器已封死：无论有没有筛选条件，最多只能返回前 ' + hl + ' 条真实数据（第 ' + (hl + 1) + ' 条起全部返回与第 1 页重复的假数据，并非没抓到）。\n\n'
                            + '—— 当前已获取 ' + allListResults.length + ' 条真实数据，进入详情提取...';
                        updateStatus(statusId, warn, 'warn');
                    } catch (e) {}
                }
                else if (!forceStop && resp && resp.duplicate === true) {
                    forceStop = true;
                    console.warn('[popup] ⚠️ 出现重复页 → 停止，已有=' + allListResults.length);
                    try { updateStatus(statusId, '⚠️ 触发后端重复页保护 → 停止。服务器已封死 301+ 条全为重复数据，本次最多只抓取前 300 条真实数据。', 'warn'); } catch (e) {}
                }

                if (viaApi) {
                    // 🔴 极速模式 via='api' 时，content.js 已经按「一次性请求」或「内部逐页」合并成了一页数据返回。
                    //    因此无论 resp.totalPages 是什么，popup 层必须强制 totalPages = 1，
                    //    绝对不能继续翻下一页！否则会造成「content 内部逐页 + popup 同时翻页」双重请求，
                    //    表现就是 Network 里每页重复出现两次，且页码循环 1→2→3→4→1→2→3→4...
                    console.log('[popup] 🛑 via=api，强制 totalPages=1，content.js 已内部合并数据，popup 不再翻页');
                    totalPages = 1;
                }
                if (viaApi && resp && resp.total) {
                    try { console.log('[popup] 📊 API 返回总条数: total=' + resp.total + ', 筛选条件:', resp.filterParams || {}); } catch (e) {}
                }

                // 🔴✅ 需求3 全部页模式自动停止：如果这一页没返回数据（0条），说明已经到最后一页了，
                //     不要再跑到 endPage=9999 了，直接强制让 currentPage>totalPages 进入完成分支！
                var isAllMode = filters && filters.pageMode === 'all';
                if (forceStop) {
                    // 🔴 强制停止（连续重复页触发）
                    currentPage = totalPages + 1;
                } else if (isAllMode && !gotData) {
                    console.log('[popup] 📄 全部页模式：第' + currentPage + '页空数据 → 已到最后一页，自动停止翻页！');
                    try {
                        updateStatus(statusId, '✅ 全部页模式：第' + currentPage + '页无数据，判定为最后一页，停止翻页...（已获取 ' + allListResults.length + ' 条）');
                    } catch (e) {}
                    // 强制跳到结束
                    currentPage = totalPages + 1;
                }

                processedPageCount++;
                const nextPercent = isAllMode
                    ? Math.min(60, Math.round(60 * (0.5 + 0.5 * processedPageCount / Math.max(1, processedPageCount + 1))))  // all模式进度递增
                    : Math.round((processedPageCount / totalPagesStep) * 60);
                showProgress(progressId, nextPercent);

                currentPage++;
                if (currentPage <= totalPages) {
                    setTimeout(processNextPage, 500);
                } else {
                    // 列表阶段完成
                    if (allListResults.length === 0) {
                        // 🔴 如果 beyondLimit / truncated 已显示了详细的终止消息，不要再用通用提示覆盖
                        if (!finalMsgShown) {
                            updateStatus(statusId, '⚠️ 未提取到任何数据，请检查筛选条件。', 'error');
                        }
                        hideProgress(progressId);
                        isExtracting[type] = false;
                        if (stopBtn) stopBtn.style.display = 'none';
                    } else {
                        console.log('[popup] ✅ 列表阶段完成：共请求页=' + (isAllMode ? ('(全部页模式,实际处理' + processedPageCount + '页)') : totalPagesStep) + ', 实际总条数=' + allListResults.length);
                        startDetailPhase(type, allListResults, statusId, progressId, stopBtn);
                    }
                }
            },
            () => {
                // fallback: 通信失败，重试
                retryCount[type]++;
                if (retryCount[type] >= MAX_RETRIES || stopRequested[type]) {
                    if (allListResults.length > 0) {
                        updateStatus(statusId, `⚠️ 翻页通信超时，已有 ${allListResults.length} 条数据，进入详情提取...`);
                        setTimeout(() => startDetailPhase(type, allListResults, statusId, progressId, stopBtn), 1000);
                    } else {
                        updateStatus(statusId, '❌ 与页面通信失败。请刷新目标网页后重试。', 'error');
                        hideProgress(progressId);
                        isExtracting[type] = false;
                        if (stopBtn) stopBtn.style.display = 'none';
                    }
                    return;
                }
                updateStatus(statusId, `🔄 第 ${currentPage} 页通信失败，重试中...（${retryCount[type]}/${MAX_RETRIES}）`);
                setTimeout(processNextPage, 1200);
            },
            (errMsg) => {
                retryCount[type]++;
                if (retryCount[type] >= MAX_RETRIES || stopRequested[type]) {
                    if (allListResults.length > 0) {
                        updateStatus(statusId, `⚠️ 通信失败，已有 ${allListResults.length} 条数据，继续...`);
                        setTimeout(() => startDetailPhase(type, allListResults, statusId, progressId, stopBtn), 1000);
                    } else {
                        updateStatus(statusId, '❌ 通信错误: ' + errMsg, 'error');
                        hideProgress(progressId);
                        isExtracting[type] = false;
                        if (stopBtn) stopBtn.style.display = 'none';
                    }
                    return;
                }
                setTimeout(processNextPage, 1500);
            }
        );
    }

    processNextPage();
}

function startDetailPhase(type, allListResults, statusId, progressId, stopBtn) {
    const rowsWithUrl = allListResults.filter(r => r.detailUrl && String(r.detailUrl).length > 5);
    const totalDetail = rowsWithUrl.length;

    console.log('[popup] 📄 startDetailPhase: 列表总数=' + allListResults.length + ', 有有效detailUrl=' + totalDetail);
    if (rowsWithUrl.length > 0) {
        console.log('[popup]  前3条的详情URL示例:', rowsWithUrl.slice(0, 3).map((r, i) => {
            const dump = {
                idx: i,
                name: r['项目名称'] || r['工程名称'] || '?',
                id: r['省级项目编号'] || r['施工许可证编号'] || r['竣工验收备案编号'] || '?',
                detailUrl: r.detailUrl
            };
            Object.keys(r).forEach(k => { if (k.startsWith('_')) dump[k] = r[k]; });
            return dump;
        }));
        // 🔴 诊断：把完整行 dump 到全局变量，用户直接 a1,a2,a3 看每条
        try {
            window.__dbgRows = rowsWithUrl.slice(0, 5);
            console.log('%c[popup] 🐛 DEBUG 变量已挂载：window.__dbgRows (前5条)，直接在Console输入 __dbgRows[0] 查看第一条完整对象', 'background:#ff4d4f;color:#fff;padding:2px 6px;border-radius:3px;');
        } catch (e) {}
    }

    if (totalDetail === 0) {
        updateStatus(statusId, `⚠️ 列表中未找到详情页链接，仅保存列表数据（${allListResults.length} 条）`);
        const dedupFields = type === 'basic' ? ['省级项目编号', '项目名称']
            : (type === 'permit' ? ['施工许可证编号', '省级项目编号']
                : ['省级项目编号', '工程名称']);

        const uploadedList = uploadedData[type] || [];
        const finalData = uploadedList.length > 0
            ? allListResults.filter(r => !isInUploadedData(r, uploadedList, dedupFields))
            : allListResults;

        currentData[type] = sortData(finalData, type);
        // 🔴✅ 普通提取（极速模式「开始提取」）成功后：如果是 permit Tab，清空上一次「🔗 提取合并表」的缓存
        // 否则预览按钮会优先显示旧的合并表，用户误以为新的 permit 提取没生效
        if (type === 'permit' && currentData.permitBasicMerge) {
            try { delete currentData.permitBasicMerge; } catch (eDel) { currentData.permitBasicMerge = null; }
        }
        isExtracting[type] = false;
        if (stopBtn) stopBtn.style.display = 'none';
        updateStatus(statusId, `✅ 提取完成！共 ${currentData[type].length} 条列表数据。`, 'success');
        showProgress(progressId, 100);
        setTimeout(() => hideProgress(progressId), 1500);
        return;
    }

    updateStatus(statusId, `📄 正在打开 ${totalDetail} 个详情页提取详细信息...`);
    showProgress(progressId, 65);

    let processedCount = 0;
    let currentIdx = 0;
    // 🔴✅ 核心修复：定长数组 + 按 idx 存，并发回调顺序打乱也不会错位！
    // （之前 push 顺序依赖 callback 顺序，并发=2 下 100% 错乱，导致位置匹配错误）
    let currentDetailResults = new Array(rowsWithUrl.length).fill(null);
    let timeoutHandle = null;
    let phaseFinished = false;

    function finishPhase() {
        if (phaseFinished) return;
        phaseFinished = true;
        if (timeoutHandle) { try { clearTimeout(timeoutHandle); } catch (e) {} }
        // 🔴 收尾：任何还没填充的位置（null/undefined）填成空对象
        // 保证 detailResults.length === rowsWithUrl.length，位置匹配 100% 准确
        for (let ii = 0; ii < currentDetailResults.length; ii++) {
            if (currentDetailResults[ii] === null || currentDetailResults[ii] === undefined) {
                currentDetailResults[ii] = {};
            }
        }
        finishExtraction(type, allListResults, currentDetailResults, statusId, progressId, stopBtn);
    }

    function processNextDetailItem() {
        if (phaseFinished) return;
        if (stopRequested[type]) {
            finishPhase();
            return;
        }

        if (currentIdx >= rowsWithUrl.length) {
            // 🔴 达到总数时，必须等 processedCount 也真正达标才 finish，不能立即结束
            // 否则并发=2 下还没 callback 回来的会被 finishPhase 填成空对象，之后 callback 被 phaseFinished=true 拦截
            if (processedCount >= totalDetail) {
                finishPhase();
            }
            return;
        }

        const row = rowsWithUrl[currentIdx];
        const idx = currentIdx;
        currentIdx++;

        const pct = 65 + Math.round((processedCount / Math.max(totalDetail, 1)) * 33);
        showProgress(progressId, pct);
        const rowLabel = row['省级项目编号'] || row['施工许可证编号'] || row['项目名称'] || row['工程名称'] || '';
        updateStatus(statusId, `📄 详情 (${processedCount + 1}/${totalDetail}) ${String(rowLabel).slice(0, 30)}...`);

        const timeoutMs = 25000;
        if (idx < 2) console.log(`[popup]   详情${idx+1} 超时设置=${timeoutMs/1000}s`);
        let msgTimeout = setTimeout(function () {
            console.warn(`[popup]   详情${idx+1}(idx=${idx}) 超时（${timeoutMs/1000}s），填空结果继续...`);
            if (currentDetailResults[idx] === null || currentDetailResults[idx] === undefined) {
                currentDetailResults[idx] = {};
            }
            processedCount++;
            if (currentIdx >= rowsWithUrl.length && processedCount >= totalDetail) {
                setTimeout(finishPhase, 200);
            } else {
                setTimeout(processNextDetailItem, 100);
            }
        }, timeoutMs);

        try {
            chrome.runtime.sendMessage(
                { action: 'openAndExtractDetail', url: row.detailUrl, type: type, rowIndex: idx, listRow: row },
                (resp) => {
                    try { clearTimeout(msgTimeout); } catch (e) {}
                    if (phaseFinished) return;
                    if (stopRequested[type]) { finishPhase(); return; }
                    const fieldCount = (resp && resp.data) ? Object.keys(resp.data).length : 0;
                    if (resp && resp.data && typeof resp.data === 'object') {
                        currentDetailResults[idx] = resp.data;
                    } else {
                        currentDetailResults[idx] = {};
                    }
                    if (resp && resp.success && resp.data && fieldCount > 0) {
                        if (idx < 3) {
                            console.log(`[popup]   详情${idx+1}(idx=${idx})提取成功(${fieldCount}字段):`, resp.data);
                        } else if (idx === 3) {
                            console.log(`[popup]   后面详情的日志不再逐条打印，等待全部完成...`);
                        }
                    } else {
                        console.warn(`[popup]   详情${idx+1}(idx=${idx})提取结果为空/失败，填空占位保证位置不错乱。success=${resp && resp.success}, fields=${fieldCount}`, resp && resp.data, resp && resp.error ? 'error=' + resp.error : '');
                    }
                    processedCount++;
                    if (currentIdx >= rowsWithUrl.length && processedCount >= totalDetail) {
                        setTimeout(finishPhase, 200);
                    } else {
                        setTimeout(processNextDetailItem, 50);
                    }
                }
            );
        } catch (e) {
            console.error(`[popup]   详情${idx+1}(idx=${idx}) sendMessage异常，填空占位:`, e);
            try { clearTimeout(msgTimeout); } catch (e2) {}
            // 🔴 异常也不能丢位置！
            currentDetailResults[idx] = {};
            processedCount++;
            if (currentIdx >= rowsWithUrl.length && processedCount >= totalDetail) {
                setTimeout(finishPhase, 200);
            } else {
                setTimeout(processNextDetailItem, 200);
            }
        }
    }

    const maxPhaseTimeout = Math.max(60000, totalDetail * 3000);
    timeoutHandle = setTimeout(function () {
        updateStatus(statusId, '⚠️ 详情提取超时，用已有数据继续...');
        finishPhase();
    }, Math.min(maxPhaseTimeout, 300000));

    // 并发设置：竣工验收备案（纯接口）与 basic/permit 都并发=2
    const concurrency = 2;
    console.log(`[popup] 📄 类型=${type}, 并发设置=${concurrency}`);
    for (let i = 0; i < concurrency; i++) {
        setTimeout(processNextDetailItem, i * 500);
    }
}

function finishExtraction(type, allListResults, detailResults, statusId, progressId, stopBtn) {
    try {
        showProgress(progressId, 98);
        updateStatus(statusId, '📊 正在合并列表与详情数据...');
        const detailCnt = detailResults ? detailResults.length : 0;
        console.log('[popup] 📊 finishExtraction: 列表条数=' + allListResults.length + ', 详情条数=' + detailCnt);
        if (detailCnt > 0) {
            console.log('[popup]  详情字段数统计 (前5条):', detailResults.slice(0, 5).map((d, i) => ({
                idx: i,
                fieldCount: Object.keys(d).length,
                fields: Object.keys(d)
            })));
        }

        // 🔴✅✅✅ 终极防错位：complete 用「省级竣工验收备案编号」当主 id！
        // (之前用「省级项目编号」是一对多，同编号的 3 条备案会在索引里互相覆盖！3 条详情变 1 条，posIdx 再一递补，全错位...)
        const idField = type === 'basic' ? '省级项目编号'
            : (type === 'permit' ? '施工许可证编号'
                : '省级竣工验收备案编号');
        const secondIdField = type === 'basic' ? '项目名称'
            : (type === 'permit' ? '工程名称'
                : '竣工验收备案编号');
        const thirdIdField = type === 'complete' ? '_acceptanceId'
            : (type === 'permit' ? '_permitId'
                : '');
        const dedupFields = type === 'basic' ? ['省级项目编号', '项目名称']
            : (type === 'permit' ? ['施工许可证编号', '省级项目编号']
                : ['省级项目编号', '工程名称']);

        // 规范化字符串：去除空白字符、全角符号等干扰
        function normalizeId(s) {
            if (!s) return '';
            return String(s).replace(/[\s\u00a0\u3000\-\.，,、\r\n\t]/g, '').trim();
        }

        // 🔴✅ 详情 → 多层索引（数组存！同 key 不覆盖！）
        // 之前用 {idKey: d} 是对象写法，同 key 最后一个覆盖前面的 → complete 省级项目编号相同的 3 条只存下 1 条！
        const detailById = {};      // key -> [详情1, 详情2, ...]
        const detailBySecond = {};  // key -> [详情1, 详情2, ...]
        const detailByThird = {};   // key -> [详情1, 详情2, ...]
        const detailListRaw = [];

        if (detailResults && detailResults.length > 0) {
            for (let di = 0; di < detailResults.length; di++) {
                const d = detailResults[di] || {};
                const idKey = normalizeId(d[idField]);
                if (idKey) { (detailById[idKey] = detailById[idKey] || []).push({ d: d, idx: di }); }
                const secondKey = normalizeId(d[secondIdField]);
                if (secondKey) { (detailBySecond[secondKey] = detailBySecond[secondKey] || []).push({ d: d, idx: di }); }
                if (thirdIdField) {
                    const thirdKey = normalizeId(d[thirdIdField]);
                    if (thirdKey) { (detailByThird[thirdKey] = detailByThird[thirdKey] || []).push({ d: d, idx: di }); }
                }
                detailListRaw.push({ d: d, idx: di });
            }
        }

        // 🔴✅ 给 rowsWithUrl（有 detailUrl 的列表行）按顺序分配「唯一位置标记」
        // 彻底取消 posIdx 位置匹配（之前的 posIdx 是列表行循环里全局递增，只要有一行没匹配上就会错位！）
        // 现在：rowsWithUrl[i] ↔ detailListRaw[i] 一一对应，我们按数组下标来分配 match，不会跳格！
        const rowsWithUrlNow = allListResults.filter(r => r.detailUrl && String(r.detailUrl).length > 5);
        // 建立「详情使用情况」，用掉的标记，避免同一个详情被两条列表行复用（极端情况）
        const detailUsed = new Array(detailListRaw.length).fill(false);

        // 合并：遍历列表数据，匹配详情（优先级：第三层ID → 主ID → 次ID → rowsWithUrl精准位置对应）
        const mergedList = allListResults.map((row, rowIdxInAll) => {
            const rid = normalizeId(row[idField]);
            const rsec = normalizeId(row[secondIdField]);
            const rthird = thirdIdField ? normalizeId(row[thirdIdField]) : '';
            // 找这个 row 在 rowsWithUrlNow 中的下标（精准位置匹配用）
            let posInRowsWithUrl = -1;
            for (let wi = 0; wi < rowsWithUrlNow.length; wi++) {
                if (rowsWithUrlNow[wi] === row) { posInRowsWithUrl = wi; break; }
            }
            let matched = null;
            let foundIdx = -1;

            // [优先级 1] complete 的 _acceptanceId 数字 id 最稳定（接口查的，100% 唯一）
            if (rthird && detailByThird[rthird]) {
                for (let ci = 0; ci < detailByThird[rthird].length; ci++) {
                    if (!detailUsed[detailByThird[rthird][ci].idx]) {
                        matched = detailByThird[rthird][ci].d;
                        foundIdx = detailByThird[rthird][ci].idx;
                        break;
                    }
                }
            }
            // [优先级 2] 主ID（complete=省级竣工验收备案编号，permit=施工许可证编号）
            if (!matched && rid && detailById[rid]) {
                for (let ci = 0; ci < detailById[rid].length; ci++) {
                    if (!detailUsed[detailById[rid][ci].idx]) {
                        matched = detailById[rid][ci].d;
                        foundIdx = detailById[rid][ci].idx;
                        break;
                    }
                }
            }
            // [优先级 3] 次ID（complete=竣工验收备案编号，permit=工程名称）
            if (!matched && rsec && detailBySecond[rsec]) {
                for (let ci = 0; ci < detailBySecond[rsec].length; ci++) {
                    if (!detailUsed[detailBySecond[rsec][ci].idx]) {
                        matched = detailBySecond[rsec][ci].d;
                        foundIdx = detailBySecond[rsec][ci].idx;
                        break;
                    }
                }
            }
            // [优先级 4] 只有当该行确实在 rowsWithUrlNow 中 → 用 posInRowsWithUrl 精准对应 detailListRaw[posInRowsWithUrl]
            // ❌ 彻底取消原来的全局 posIdx 递增（原来的 posIdx 会跳格，只要有一行匹配到了就会 posIdx++ 导致后面全错位）
            if (!matched && row.detailUrl && posInRowsWithUrl >= 0 && posInRowsWithUrl < detailListRaw.length && !detailUsed[posInRowsWithUrl]) {
                matched = detailListRaw[posInRowsWithUrl].d;
                foundIdx = posInRowsWithUrl;
            }
            // 标记该详情已被使用（避免被其他行复用）
            if (foundIdx >= 0) detailUsed[foundIdx] = true;

            const result = {};
            Object.keys(row).forEach(k => {
                // 🔴 过滤内部辅助字段，不写入导出数据
                if (k === 'detailUrl' || k === '_locator') return;
                result[k] = row[k];
            });
            if (matched) {
                // 🔴✅✅✅ 终极强保护：这些字段只要列表里已经写了 key（即使值是空串），详情页永远不能改！
                // 因为：
                // 1. 这些字段是列表里 100% 有值的（省级竣工验收备案编号是列表列来的，省级项目编号/工程名称等也是）
                // 2. 防止极端情况：详情匹配错位（比如 B 的详情贴给 A），把 A 列表里正确值覆盖成 B 的值！
                // ⚠️ 注意：「竣工验收备案编号」故意不在这里！因为：
                //    - 现在列表接口 lookup 已经直接把 archiveCode（开建验备2026-115）填到 row 的这个 key 里了
                //    - 如果列表 lookup 没匹配到/没值（currentPage 不在 list?pageSize=100 范围内），详情 API 返回的 archiveCode 也必须能写进来
                //    - 有「看起来是真实备案号（和省级编号不一样）」的判断兜底，不会把假值写进来
                const LIST_PROTECT_FIELDS = new Set([
                    '数据等级', '等级', '分级',
                    '工程名称', '项目名称',
                    '施工许可证编号', '许可证编号', '省级项目编号',
                    '发证机关', '备案机关', '所在城市', '所在市', '日期', '发证日期',
                    // 🔴✅ 列表独有字段：详情绝对不能覆盖！
                    '省级竣工验收备案编号'
                ]);
                Object.keys(matched).forEach(k => {
                    if (k === 'detailUrl' || k === '_locator' || k.startsWith('_')) return;
                    // 🔴 强保护：只要列表 result 里有这个字段 key → 详情一律不改！
                    if (LIST_PROTECT_FIELDS.has(k) && (k in result)) return;
                    // 其它字段：仅当 result 里没有 或 值为空/纯空白 时才允许详情补充
                    if (!(k in result) || !result[k] || String(result[k]).trim() === '') {
                        result[k] = matched[k];
                    }
                });

                // 🔴✅ 竣工验收备案专用字段归一（用户最新要求！2026-07-26 修正）：
                // - 列表 type=6 表格里「竣工验收备案编号」列  →  我们存为「省级竣工验收备案编号」（省级编号）
                // - 列表接口 list 返回的 archiveCode（开建验备2026-115）/ 详情 get/{id} 返回的 archiveCode  →  存为「竣工验收备案编号」
                // → 两个独立字段，互不覆盖！
                if (type === 'complete') {
                    const listProvincialNo = String(result['省级竣工验收备案编号'] || '').trim();
                    const detailProvincialNo = String(matched['省级竣工验收备案编号'] || '').trim();
                    const detailRealRecNo = String(matched['竣工验收备案编号'] || matched['备案编号'] || '').trim();

                    // 1) 省级竣工验收备案编号：列表的值优先！只有列表是空的才用详情补
                    if (!listProvincialNo && detailProvincialNo) {
                        result['省级竣工验收备案编号'] = detailProvincialNo;
                    }

                    // 2) 竣工验收备案编号：详情/接口里的 archiveCode 是真实值（如「开建验备2026-115」）
                    //    🔴✅ 只要详情里的 archiveCode「不是省级编号」→ 就写入！（不再强依赖 listProvincialNo 有值）
                    if (detailRealRecNo) {
                        const detNorm = normalizeId(detailRealRecNo);
                        const listProvNorm = normalizeId(listProvincialNo);
                        const detProvNorm = normalizeId(detailProvincialNo);
                        const sameAsListProv = listProvNorm && (detNorm === listProvNorm);
                        const sameAsDetProv = detProvNorm && (detNorm === detProvNorm);
                        const looksLikeFakeProvincialCopy = sameAsListProv || sameAsDetProv;

                        if (!looksLikeFakeProvincialCopy) {
                            // ✅ 详情值和省级编号不一样 → 是真实普通备案号（开建验备...）→ 无条件覆盖
                            result['竣工验收备案编号'] = detailRealRecNo;
                        } else if (!result['竣工验收备案编号'] || String(result['竣工验收备案编号']).trim() === '') {
                            // 只有当 result 本身是空时，才允许和省级编号相同的值写进来（极端接口映射）
                            result['竣工验收备案编号'] = detailRealRecNo;
                        }
                    } else {
                        // 详情没拿到真实备案号：如果 result 里的这个 key 其实是和省级编号一模一样的重复值（之前误写的/错位值），就强制清空掉！
                        const cur = String(result['竣工验收备案编号'] || '').trim();
                        if (cur) {
                            const curNorm = normalizeId(cur);
                            const listProvNorm = normalizeId(listProvincialNo);
                            const detProvNorm = normalizeId(detailProvincialNo);
                            const isFake = (curNorm && listProvNorm && curNorm === listProvNorm) || (curNorm && detProvNorm && curNorm === detProvNorm);
                            if (isFake) {
                                delete result['竣工验收备案编号'];
                                result['竣工验收备案编号'] = '';
                            }
                        }
                    }

                    // 3) 备案机关别名兜底：用户在需求2里把「备案机关」导出列名叫「竣工验收备案机关」
                    //    如果 result['备案机关'] 有值但「竣工验收备案机关」没值 → 顺便同步一份（便于LIST_ONLY导出别名匹配）
                    if (!result['竣工验收备案机关']) {
                        const auth = String(result['备案机关'] || matched['备案机关'] || matched['竣工验收备案机关'] || '').trim();
                        if (auth) result['竣工验收备案机关'] = auth;
                    }
                }
            }
            return result;
        });

        // 应用上传去重
        const uploadedList = uploadedData[type] || [];
        const finalData = uploadedList.length > 0
            ? mergedList.filter(r => !isInUploadedData(r, uploadedList, dedupFields))
            : mergedList;

        currentData[type] = sortData(finalData, type);
        // 🔴✅ 普通提取（极速模式「开始提取」）成功后：如果是 permit Tab，清空上一次「🔗 提取合并表」的缓存
        if (type === 'permit' && currentData.permitBasicMerge) {
            try { delete currentData.permitBasicMerge; } catch (eDel) { currentData.permitBasicMerge = null; }
        }

        isExtracting[type] = false;
        if (stopBtn) stopBtn.style.display = 'none';

        if (stopRequested[type]) {
            updateStatus(statusId, `⏹ 已停止。已保存 ${currentData[type].length} 条数据${detailCnt > 0 ? '（含 ' + detailCnt + ' 条详情）' : ''}。`, '');
            // 🔴🔗 停止状态：一键两步钩子失效，清掉
            pendingPermitMergeAutoStep2 = false;
        } else {
            updateStatus(statusId, `✅ 提取完成！共 ${currentData[type].length} 条数据${detailCnt > 0 ? '（含 ' + detailCnt + ' 条详情）' : ''}。`, 'success');
            // 🔴🔗 兼容模式「🔗 提取合并表」一键两步 Step1（DOM 抓 permit 单表）完成 → 自动触发 Step2（反查 basic + 合并）
            if (type === 'permit' && pendingPermitMergeAutoStep2) {
                pendingPermitMergeAutoStep2 = false;
                const step2Type = type;
                updateStatus(statusId, '🔗 Step1(DOM 提取 permit) 完成，共 ' + currentData[step2Type].length + ' 条 → 500ms 后自动启动 Step2（按省级项目编号反查基本信息生成合并表）...', 'success');
                setTimeout(function () {
                    try { handlePermitExtractMerge(step2Type, true); } catch (eStep2) {
                        console.error('[permitMerge] 自动 Step2 触发失败：', eStep2);
                        updateStatus(step2Type + '-status', '⚠️ 自动触发合并失败，请手动再次点「🔗 提取合并表」继续。错误：' + String(eStep2 && eStep2.message || eStep2), 'warn');
                    }
                }, 500);
            }
        }
        showProgress(progressId, 100);
        setTimeout(() => hideProgress(progressId), 1500);
    } catch (err) {
        console.error('合并数据失败:', err);
        // 退而求其次 - 只保存列表数据
        const idField = type === 'basic' ? '省级项目编号' : (type === 'complete' ? '省级竣工验收备案编号' : '施工许可证编号');
        const dedupFields = type === 'basic' ? ['省级项目编号', '项目名称']
            : (type === 'permit' ? ['施工许可证编号', '省级项目编号']
                : ['省级项目编号', '工程名称']);
        const uploadedList = uploadedData[type] || [];
        const cleanList = allListResults.map(r => {
            const c = {};
            Object.keys(r).forEach(k => { if (k !== 'detailUrl') c[k] = r[k]; });
            return c;
        });
        const finalData = uploadedList.length > 0
            ? cleanList.filter(r => !isInUploadedData(r, uploadedList, dedupFields))
            : cleanList;
        currentData[type] = sortData(finalData, type);
        // 🔴✅ 普通提取（极速模式「开始提取」）成功后：如果是 permit Tab，清空上一次「🔗 提取合并表」的缓存
        if (type === 'permit' && currentData.permitBasicMerge) {
            try { delete currentData.permitBasicMerge; } catch (eDel) { currentData.permitBasicMerge = null; }
        }
        isExtracting[type] = false;
        if (stopBtn) stopBtn.style.display = 'none';
        // 🔴🔗 catch 保底分支也要处理钩子（保底分支只保存了列表，可能没有详情字段「省级项目编号」→ 即使触发也可能匹配不上 basic，但仍然尝试）
        if (type === 'permit' && pendingPermitMergeAutoStep2 && !stopRequested[type]) {
            pendingPermitMergeAutoStep2 = false;
            const step2TypeB = type;
            updateStatus(statusId, `✅ 提取完成（仅列表数据，catch 兜底）！共 ${currentData[type].length} 条 → 自动尝试生成合并表...`, 'warn');
            setTimeout(function () {
                try { handlePermitExtractMerge(step2TypeB, true); } catch (eStep2B) {
                    console.error('[permitMerge] 自动 Step2(catch分支) 触发失败：', eStep2B);
                }
            }, 500);
        } else {
            pendingPermitMergeAutoStep2 = false;
            updateStatus(statusId, `✅ 提取完成（仅列表数据）！共 ${currentData[type].length} 条。`, 'success');
        }
        showProgress(progressId, 100);
        setTimeout(() => hideProgress(progressId), 1500);
    }
}

// ============================================================
// ===== 🔴✅ 需求3 公共辅助：根据 pageMode 组装 startPage/endPage，再 doExtract =====
//        - range:    用用户填的 startPage/endPage
//        - current:  先向 content 发 getPageInfo 拿 currentPage，start=end=currentPage
//        - all:      start=1, end=9999, processListPhase 抓空/少数据时自动停
// ============================================================
function buildFiltersAndDoExtract(type, baseFilters) {
    var statusId = type + '-status';
    var progressId = type + '-progress';
    var stopBtn = safeGetElement(type + '-stop');

    // 🔴✅ 「获取全部数据」调用时标记了 _skipPageMode → 直接按传进来的 start/end 走，不读 pageMode
    if (baseFilters && baseFilters._skipPageMode === true) {
        if (!baseFilters.startPage || baseFilters.startPage < 1) baseFilters.startPage = 1;
        if (!baseFilters.endPage || baseFilters.endPage < baseFilters.startPage) baseFilters.endPage = baseFilters.startPage;
        console.log('[pageMode] ' + type + ' → [快速提取] 忽略 pageMode，强制按指定范围 ' + baseFilters.startPage + ' ~ ' + baseFilters.endPage);
        baseFilters.pageMode = 'range';
        doExtract(type, baseFilters);
        return;
    }

    var modeEl = safeGetElement(type + '-pageMode');
    var pageMode = (modeEl && modeEl.value) ? modeEl.value : 'range';
    baseFilters.pageMode = pageMode; // 存入 filters，后面 processListPhase 知道是 all 模式要自动停

    if (pageMode === 'range') {
        // ---- 指定页码范围 ----
        if (!baseFilters.startPage || baseFilters.startPage < 1) baseFilters.startPage = 1;
        if (!baseFilters.endPage || baseFilters.endPage < 1) baseFilters.endPage = baseFilters.startPage;
        if (baseFilters.startPage > baseFilters.endPage) {
            [baseFilters.startPage, baseFilters.endPage] = [baseFilters.endPage, baseFilters.startPage];
        }
        console.log('[pageMode] ' + type + ' → 指定范围 ' + baseFilters.startPage + ' ~ ' + baseFilters.endPage);
        doExtract(type, baseFilters);
        return;
    }

    if (pageMode === 'all') {
        // ---- 全部页：start=1, end=9999（processListPhase 会自动在空页/不足页停止）----
        baseFilters.startPage = 1;
        baseFilters.endPage = 9999;
        updateStatus(statusId, '🔄 模式：全部页 → 从第 1 页自动抓到最后一页...');
        console.log('[pageMode] ' + type + ' → 全部页，start=1, end=9999，空页自动停');
        doExtract(type, baseFilters);
        return;
    }

    if (pageMode === 'current') {
        // ---- 仅当前页：先发 getPageInfo 问 content 当前页号是多少 ----
        updateStatus(statusId, '🔄 模式：仅当前页 → 正在向页面查询当前页号...');
        console.log('[pageMode] ' + type + ' → 仅当前页，发 getPageInfo 查当前页');
        sendToContent(
            { action: 'getPageInfo', type: type },
            (resp) => {
                var cur = 1;
                try { cur = Number(resp && resp.currentPage) || 1; } catch (e) { cur = 1; }
                if (cur < 1) cur = 1;
                baseFilters.startPage = cur;
                baseFilters.endPage = cur;
                updateStatus(statusId, '✅ 仅当前页：检测到当前是第 ' + cur + ' 页，开始提取...');
                console.log('[pageMode] ' + type + ' → 仅当前页，content 返回 currentPage=' + cur);
                doExtract(type, baseFilters);
            },
            () => {
                // 通信失败，兜底：start=end=1
                console.warn('[pageMode] ' + type + ' → 仅当前页 通信失败，兜底抓第 1 页');
                updateStatus(statusId, '⚠️ 获取当前页号失败，兜底提取第 1 页...');
                baseFilters.startPage = 1;
                baseFilters.endPage = 1;
                doExtract(type, baseFilters);
            },
            (errMsg) => {
                console.warn('[pageMode] ' + type + ' → 仅当前页 通信错误=' + errMsg + '，兜底抓第 1 页');
                baseFilters.startPage = 1;
                baseFilters.endPage = 1;
                doExtract(type, baseFilters);
            }
        );
        return;
    }

    // 兜底：range
    if (!baseFilters.startPage || baseFilters.startPage < 1) baseFilters.startPage = 1;
    if (!baseFilters.endPage || baseFilters.endPage < baseFilters.startPage) baseFilters.endPage = baseFilters.startPage;
    doExtract(type, baseFilters);
}

// ============================================================
// ===== 📥 获取全部数据（仅极速模式）=====
//   A. 有筛选：
//       - 预请求 total → 若 total > 300：提醒"第301条起和第1页重复，本次只抓前300条"，再继续
//       - 然后 1 次请求 pageNum=1&pageSize=min(total, 300)（仅 1 次验证码）
//   B. 无筛选：
//       - 预请求 total → 弹确认框（数据量大、耗时长、100条/页逐页），让用户二次确认
//       - 调用 content 新增的 rapidFetchAllPageByPage action，100条/页逐页拉（每页可能弹验证码）
// ============================================================
// ====== 🔴✅ 公共：用户点击「获取全部数据」时，无论有没有筛选条件，都使用这个统一的 300 条截断策略 ======
//   规则（实测后确认：无论有无筛选都一样）：
//     • probeTotal ≤300       → 拿 probeTotal 条（全部真实数据）
//     • probeTotal >300       → 截断到 300 条 + 弹窗告知用户"301 条后全是重复（服务器封死了，任何方式都无法绕过）"
//     • 两种情况都走：一次性 API 抓取（endPage=1）
//     • 有筛选才可能要填 1 次验证码；无筛选不用验证码
function _resolveFilteredExtractAll(type, probeTotal, hardLimit, statusId) {
    const HL = Math.max(1, Number(hardLimit) || 300);
    const total = Math.max(0, Number(probeTotal) || 0);
    if (total > HL) {
        updateStatus(statusId, '⚠️ 命中 ' + total + ' 条数据。服务器第 ' + (HL + 1) + ' 条起全部重复，本次仅获取前 ' + HL + ' 条真实数据。', 'warn');
        try {
            const go = confirm('⚠️ 【极速模式】服务器分页上限\n\n' +
                '命中 ' + total + ' 条数据。\n\n' +
                '服务器已封死（无论有没有筛选条件都一样）：\n' +
                '  最多只能返回前 ' + HL + ' 条真实数据，\n' +
                '  从第 ' + (HL + 1) + ' 条开始，返回的全部都是与第 1 页完全重复的假数据（服务器分页机制，任何方式都无法绕过）。\n\n' +
                '👉 本次操作仅获取前 ' + HL + ' 条真实数据。\n\n' +
                '是否继续？');
            if (!go) { updateStatus(statusId, '已取消「获取全部数据」。', ''); return false; }
        } catch (e) {}
        _doExtractAllNormal(type, 1, 1, HL);
        return true;
    }
    updateStatus(statusId, '✅ 命中 ' + total + ' 条（≤' + HL + '），一次性抓取全部数据...', 'success');
    _doExtractAllNormal(type, 1, 1, Math.max(1, total || 100));
    return true;
}

function handleExtractAll(type) {
    const statusId = type + '-status';
    const progressId = type + '-progress';
    const stopBtn = safeGetElement(type + '-stop');
    const fm = safeGetElement(type + '-fetchMode')?.value || 'dom';
    if (fm !== 'api' && fm !== 'smart') {
        updateStatus(statusId, '⚠️ 「获取全部数据」仅在「🚀 极速模式」下可用，请先切换抓取模式。', 'error');
        try { alert('「获取全部数据」仅在 🚀 极速模式下可用。\n\n请先切换抓取模式再点击。'); } catch (e) {}
        return;
    }

    updateStatus(statusId, '🔍 正在查询总数据条数（预请求，无需验证码）...', '');
    // 🔴 把 popup 自己的筛选输入也传给 probeTotal，避免只看 DOM 漏判 hasFilter
    const probeFilters = collectTabFilters(type);
    console.log('[extractAll] ' + type + ' → 发 probeTotal 预请求, popup filters:', probeFilters);
    sendToContent(
        { action: 'probeTotal', type: type, filters: probeFilters },
        (resp) => {
            const probeTotal = Math.max(0, Number(resp && resp.total) || 0);
            const hasFilter = !!(resp && resp.hasFilter === true);
            const HARD_LIMIT = 300;
            console.log('[extractAll] ' + type + ' → probeTotal=' + probeTotal + ', hasFilter=' + hasFilter);

            if (hasFilter) {
                // --------------- 分支 A：有筛选 → 走与 content 截断策略完全一致的公共函数 ---------------
                _resolveFilteredExtractAll(type, probeTotal, HARD_LIMIT, statusId);
                return;
            }

            // --------------- 分支 B：无筛选 ---------------
            if (!probeTotal) {
                updateStatus(statusId, '⚠️ 暂未查询到数据总量，稍后再试。', 'error');
                return;
            }
            const HL_NO_FILTER = 300;
            const willGet = Math.min(probeTotal, HL_NO_FILTER);
            const overMax = probeTotal > HL_NO_FILTER;
            const warn =
                '🚀 【极速模式·无筛选】获取全部数据 — 二次确认\n\n' +
                '当前共 ' + probeTotal + ' 条数据。\n\n' +
                '🔧 抓取方式：一次性 pageNum=1&pageSize=' + willGet + '\n\n' +
                '⚠️ 最新服务器限制（已实测确认）：\n' +
                '   无论有没有筛选条件，服务器从第 ' + (HL_NO_FILTER + 1) + ' 条起就开始返回与第 1 页完全重复的假数据，\n' +
                '   因此 **无筛选也最多只能拿到前 ' + HL_NO_FILTER + ' 条真实数据**，超过 ' + HL_NO_FILTER + ' 的部分无法获取。\n\n' +
                (overMax ? ('👉 本次数据共 ' + probeTotal + ' 条 → 自动仅抓取前 ' + HL_NO_FILTER + ' 条真实数据（' + (probeTotal - HL_NO_FILTER) + ' 条被服务器封死为重复数据，无法获取）。\n\n') : '') +
                '✅ 无筛选不用验证码，几秒就能完成。\n\n' +
                '点击「确定」开始抓取，点击「取消」放弃本次操作。';
            try {
                const go = confirm(warn);
                if (!go) { updateStatus(statusId, '已取消「获取全部数据」。', ''); return; }
            } catch (e) {}

            updateStatus(statusId, '🚀 开始抓取数据（一次性 pageSize=' + willGet + '）...' + (overMax ? '（服务器封死第 ' + (HL_NO_FILTER + 1) + '+ 条，仅抓前 ' + HL_NO_FILTER + ' 条真实数据）' : ''), '');
            stopBtn && stopBtn.style.display !== 'none' || (stopBtn && (stopBtn.style.display = ''));
            sendToContent(
                { action: 'rapidFetchAllPageByPage', type: type, totalEstimated: probeTotal },
                (res) => {
                    const ok = !!(res && res.success);
                    const rows = (ok && res && res.data && Array.isArray(res.data)) ? res.data : [];
                    currentData[type] = sortData(rows, type);
                    try { chrome.runtime.sendMessage({ action: 'saveResults', type: type, data: rows }); } catch (e) {}
                    updateStatus(statusId,
                        ok ? ('✅ 列表抓取完成！共 ' + rows.length + ' 条，进入详情提取...')
                           : ('❌ 列表抓取失败：' + ((res && res.error) || '未知')),
                        ok ? 'success' : 'error');
                    try { stopBtn && (stopBtn.style.display = 'none'); } catch (e) {}
                    try {
                        const pg = safeGetElement(progressId);
                        if (pg) { pg.style.display = 'none'; const bar = pg.querySelector('.progress-bar-fill'); if (bar) bar.style.width = '0%'; }
                    } catch (e) {}
                    if (ok && rows.length > 0) startDetailPhase(type, rows, statusId, progressId, stopBtn);
                },
                () => { updateStatus(statusId, '❌ 「获取全部数据」通信失败，请刷新页面重试。', 'error'); try { stopBtn && (stopBtn.style.display = 'none'); } catch (e) {} },
                (errMsg) => { updateStatus(statusId, '❌ 「获取全部数据」出错：' + (errMsg || '未知'), 'error'); try { stopBtn && (stopBtn.style.display = 'none'); } catch (e) {} },
                // 进度回调：content 会不断推 {progress:{currentPage,totalPages,currentCount,total}}
                (prog) => {
                    if (!prog || typeof prog !== 'object') return;
                    const curP = Number(prog.currentPage) || 0;
                    const totP = Number(prog.totalPages) || 0;
                    const curC = Number(prog.currentCount) || 0;
                    const totC = Number(prog.total) || 0;
                    const pct = totP > 0 ? Math.min(100, Math.max(0, curP / totP * 100)) : 0;
                    try {
                        const pg = safeGetElement(progressId);
                        if (pg) {
                            pg.style.display = '';
                            const bar = pg.querySelector('.progress-bar-fill');
                            if (bar) bar.style.width = pct.toFixed(1) + '%';
                        }
                    } catch (e) {}
                    // 🔴 如果服务器深度分页开始返回重复数据（serverDupStop=true），立刻显示醒目的黄色警告但不要卡死（后续 final callback 会继续进入详情）
                    if (prog.serverDupStop === true) {
                        var msgStop = prog.msg || ('服务器第 ' + curP + ' 页起返回重复数据（服务器分页限制），自动停止');
                        updateStatus(statusId, '⚠️ ' + msgStop, 'warn');
                        try { console.warn('[extractAll] content 端已触发 serverDupStop：', prog); } catch (e) {}
                        return;
                    }
                    updateStatus(statusId,
                        '🚀 抓取中... 第 ' + curP + (totP ? (' / ' + totP) : '') + ' 页' +
                        (totC ? ('，已抓取 ' + curC + ' / ' + totC + ' 条') : ('，已抓取 ' + curC + ' 条')),
                        '');
                }
            );
        },
        () => { updateStatus(statusId, '❌ 查询总条数通信失败，请确保当前在正确的数据页面，刷新后再试。', 'error'); },
        (errMsg) => { updateStatus(statusId, '❌ 查询总条数失败：' + (errMsg || '未知'), 'error'); }
    );
}
// ===== 🔴 3 个 Tab 的统一配置 & 绑定抽取（原来 3 段几乎相同代码合并）=====
// 每个 Tab：筛选字段 / 完整字段 / 文件名 / 导出时数字列判断 —— 全部集中在 TAB_CONFIG
const TAB_CONFIG = {
    basic: {
        label: '基本信息',
        filterKeys: ['projectName', 'unit', 'code', 'city'],
        fields: BASIC_FIELDS,
        listCsvHeaders: LIST_ONLY_HEADERS.basic,
        csvFilePrefix: '基本信息',
        listCsvPrefix: '基本信息_仅列表',
        isNumberField: (f) => f === '总投资（万元）' || f === '总面积/长度（平方米/米）'
    },
    permit: {
        label: '施工许可',
        filterKeys: ['projectName', 'code', 'permitNo', 'authority', 'startDate', 'endDate', 'city'],
        fields: PERMIT_FIELDS,
        listCsvHeaders: LIST_ONLY_HEADERS.permit,
        csvFilePrefix: '施工许可',
        listCsvPrefix: '施工许可_仅列表',
        isNumberField: (f) => f === '合同价格'
    },
    complete: {
        label: '竣工验收备案',
        filterKeys: ['projectName', 'code', 'authority', 'recordNo'],
        fields: COMPLETE_FIELDS,
        listCsvHeaders: LIST_ONLY_HEADERS.complete,
        csvFilePrefix: '竣工验收备案',
        listCsvPrefix: '竣工验收备案_仅列表',
        isNumberField: (f) => f === '实际造价（万元）' || f === '实际面积（平方米）'
    }
};

// ===== 公共：读取某个 Tab 当前输入的筛选条件 =====
function collectTabFilters(type) {
    const cfg = TAB_CONFIG[type];
    if (!cfg) return {};
    const filters = {};
    cfg.filterKeys.forEach(k => {
        const el = safeGetElement(type + '-' + k);
        let v = (el && el.value != null) ? el.value : '';
        if (k !== 'startDate' && k !== 'endDate') v = String(v || '').trim();
        if (v !== '' && v != null) filters[k] = v;
    });
    return filters;
}

// ===== 公共：构造"开始提取"按钮的 baseFilters（极速/兼容共用同一套逻辑）=====
function buildTabExtractFilters(type) {
    const fm = (safeGetElement(type + '-fetchMode')?.value || 'dom');
    const isRapid = (fm === 'api' || fm === 'smart');
    const base = collectTabFilters(type);
    base.fetchMode = fm;
    base.startPage = isRapid ? 1 : Math.max(1, Number(safeGetElement(type + '-startPage')?.value) || 1);
    base.endPage = isRapid ? 1 : Math.max(1, Number(safeGetElement(type + '-endPage')?.value) || 1);
    base.apiPageSize = isRapid
        ? Math.max(1, Number(safeGetElement(type + '-apiPageSize')?.value) || 100)
        : Math.min(500, Math.max(1, Number(safeGetElement(type + '-apiPageSize')?.value) || 100));
    return base;
}

// ===== 公共：「获取全部数据·有筛选」分支走的快速构造 + 调用 =====
function _doExtractAllNormal(type, sp, ep, ps) {
    const fm = safeGetElement(type + '-fetchMode')?.value || 'api';
    const base = collectTabFilters(type);
    base.fetchMode = fm;
    base.startPage = Number(sp) || 1;
    base.endPage = Number(ep) || 1;
    base.apiPageSize = Math.max(1, Number(ps) || 100);
    // 🔴✅ 「获取全部数据」是特殊操作，强制按指定的 start/end 抓取，不要被 pageMode='all' 或 'current' 覆盖
    //     否则用户选了 pageMode=全部页，这里设置 start=1,end=1 会被 buildFiltersAndDoExtract 覆写成 end=9999
    base._skipPageMode = true;
    buildFiltersAndDoExtract(type, base);
}

// ===== 核心：统一初始化一个 Tab 的所有按钮（提取/停止/预览/清空/导出完整/导出列表/获取全部）=====
function initTabButtons(type) {
    const cfg = TAB_CONFIG[type];
    if (!cfg) return;
    const statusId = type + '-status';
    const tableId = type + '-table';
    const listHeaders = cfg.listCsvHeaders || [];

    const extractBtn = safeGetElement(type + '-extract');
    if (extractBtn) extractBtn.addEventListener('click', () => {
        const base = buildTabExtractFilters(type);
        buildFiltersAndDoExtract(type, base);
    });

    const stopBtn = safeGetElement(type + '-stop');
    if (stopBtn) stopBtn.addEventListener('click', () => stopExtract(type));

    const previewBtn = safeGetElement(type + '-preview');
    if (previewBtn) previewBtn.addEventListener('click', () => {
        // permit Tab：
        //  1) 只要用户点过「🔗 提取合并表」且合并表有数据 → 优先预览合并表（含 basic + permit 字段，符合用户点击 🔗 的直觉）
        //  2) 否则：如果 currentData['permit'] 有 permit 单表，显示 permit 单表
        //  3) 否则：提示「暂无数据」
        // ✅🔴 防御性兜底：合并表 fields 若意外缺失「许可_」前缀的许可侧字段（导致只显示基本信息列），
        //      则改用行数据的实际 keys 渲染，确保施工许可字段不丢失。
        function _safePbmFields(rows, fields) {
            if (!rows || !rows.length) return fields || [];
            var fArr = Array.isArray(fields) && fields.length ? fields.slice() : [];
            var hasPermitCol = fArr.some(function(f) { return typeof f === 'string' && (f.indexOf('许可_') === 0 || f === '施工许可证编号' || f === '工程名称' || f === '合同价格'); });
            if (!hasPermitCol) {
                try {
                    var rowKeys = Object.keys(rows[0] || {});
                    if (rowKeys && rowKeys.length > fArr.length) return rowKeys;
                } catch (_e) {}
            }
            return fArr;
        }
        if (type === 'permit'
            && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows) && currentData.permitBasicMerge.rows.length > 0) {
            const rows = currentData.permitBasicMerge.rows;
            const fields = _safePbmFields(rows, (Array.isArray(currentData.permitBasicMerge.fields) && currentData.permitBasicMerge.fields.length > 0)
                ? currentData.permitBasicMerge.fields
                : Object.keys(rows[0] || {}));
            renderTable(tableId, rows, fields);
            updateStatus(statusId, '📋 预览「🔗 提取合并表」结果：共 ' + rows.length + ' 条（合并表，列数 ' + fields.length + '；basic 信息字段（如项目分类、建设规模、建设单位、总投资等）在前，许可_ 前缀列在后）。提示：可点「💾 导出合并表CSV」下载完整结果。', 'success');
            return;
        }
        if (type === 'permit' && (!currentData[type] || currentData[type].length === 0)
            && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows) && currentData.permitBasicMerge.rows.length > 0) {
            const rows = currentData.permitBasicMerge.rows;
            const fields = _safePbmFields(rows, (Array.isArray(currentData.permitBasicMerge.fields) && currentData.permitBasicMerge.fields.length > 0)
                ? currentData.permitBasicMerge.fields
                : Object.keys(rows[0] || {}));
            renderTable(tableId, rows, fields);
            updateStatus(statusId, '📋 预览「🔗 提取合并表」结果：共 ' + rows.length + ' 条（合并表，列数 ' + fields.length + '）。提示：可再点「💾 导出合并表CSV」下载完整结果。', 'success');
            return;
        }
        if (!currentData[type] || currentData[type].length === 0) {
            updateStatus(statusId, '⚠️ 暂无数据，请先执行提取操作。', '');
            return;
        }
        renderTable(tableId, currentData[type], cfg.fields);
        updateStatus(statusId, `📋 预览共 ${currentData[type].length} 条数据。`, 'success');
    });

    const exportBtn = safeGetElement(type + '-export');
    if (exportBtn) exportBtn.addEventListener('click', () => {
        // ✅ 需求：施工许可 Tab 的「💾 导出CSV（完整）」智能二合一
        // 优先：permitBasicMerge（用户点过「🔗 提取合并表」，因为两者缓存已互相覆盖，取当前最新的那份）
        // 否则：纯 permit 单表完整 CSV（list + details 合并）
        if (type === 'permit') {
            const hasMerge = !!(currentData && currentData.permitBasicMerge
                && Array.isArray(currentData.permitBasicMerge.rows)
                && currentData.permitBasicMerge.rows.length > 0);
            if (hasMerge) {
                const rows = currentData.permitBasicMerge.rows;
                var _pbmFields = Array.isArray(currentData.permitBasicMerge.fields) ? currentData.permitBasicMerge.fields : null;
                // ✅🔴 同预览兜底：若 fields 缺失许可侧字段，改用行数据 keys，避免导出的 CSV 只有基本信息列
                (function() {
                    if (!rows || !rows.length) return;
                    var fArr = Array.isArray(_pbmFields) && _pbmFields.length ? _pbmFields : [];
                    var hasPermitCol = fArr.some(function(f) { return typeof f === 'string' && (f.indexOf('许可_') === 0 || f === '施工许可证编号' || f === '工程名称' || f === '合同价格'); });
                    if (!hasPermitCol) {
                        try {
                            var rowKeys = Object.keys(rows[0] || {});
                            if (rowKeys && rowKeys.length > fArr.length) _pbmFields = rowKeys;
                        } catch (_e) {}
                    }
                })();
                const fields = _pbmFields;
                const basicNumFn = TAB_CONFIG.basic.isNumberField || (() => false);
                const permitNumFn = TAB_CONFIG.permit.isNumberField || (() => false);
                function isMergeNumber(f) {
                    if (!f) return false;
                    if (String(f).indexOf('许可_') === 0) {
                        const raw = String(f).substring(3);
                        return permitNumFn(raw);
                    }
                    return basicNumFn(f);
                }
                const finalF = Array.isArray(fields) && fields.length > 0 ? fields : Object.keys(rows[0] || {});
                const csv = generateCSV(rows, finalF, isMergeNumber);
                const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                downloadCSV(csv, '基本信息_施工许可_合并表_' + date + '.csv');
                updateStatus(statusId, '💾 CSV(完整)已导出：优先使用最新「🔗 提取合并表」数据！共 ' + rows.length + ' 条，列数 ' + finalF.length + '。', 'success');
                return;
            }
        }
        if (!currentData[type] || currentData[type].length === 0) {
            updateStatus(statusId, '⚠️ 暂无数据可导出！', '');
            return;
        }
        const csv = generateCSV(currentData[type], cfg.fields, cfg.isNumberField || (() => false));
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        downloadCSV(csv, cfg.csvFilePrefix + '_' + date + '.csv');
        updateStatus(statusId, `💾 CSV已导出！共 ${currentData[type].length} 条。`, 'success');
    });

    const expListBtn = safeGetElement(type + '-exportList');
    if (expListBtn) expListBtn.addEventListener('click', () => {
        if (!currentData[type] || currentData[type].length === 0) {
            updateStatus(statusId, '⚠️ 暂无数据可导出！请先点击「开始提取」。', '');
            return;
        }
        if (!listHeaders || listHeaders.length === 0) {
            updateStatus(statusId, '❌ 类型 ' + type + ' 没有配置仅列表字段！', 'error');
            return;
        }
        const mappedRows = currentData[type].map(row => extractListOnlyRow(type, row));
        const csv = generateCSV(mappedRows, listHeaders, () => false);
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        downloadCSV(csv, cfg.listCsvPrefix + '_' + date + '.csv');
        updateStatus(statusId, '💾 仅列表CSV已导出！共 ' + mappedRows.length + ' 条（列数：' + listHeaders.length + '）。', 'success');
    });

    const clearBtn = safeGetElement(type + '-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        currentData[type] = [];
        // permit 清空时顺带把合并表也清空（因为合并表是从 permit 派生的，并且结构是 {rows,fields}，不是数组）
        if (type === 'permit') {
            try { delete currentData.permitBasicMerge; } catch (e) { currentData.permitBasicMerge = null; }
        }
        try { chrome.runtime.sendMessage({ action: 'clearResults', type: type }); } catch (e) {}
        const tbl = safeGetElement(tableId);
        if (tbl) { tbl.style.display = 'none'; tbl.innerHTML = ''; }
        updateStatus(statusId, '🗑 数据已清空。');
        // 刷新「💾 导出合并表CSV」按钮可用状态
        if (type === 'permit') try { syncFetchModeInputs('permit'); } catch (e) {}
    });

    const extractAllBtn = safeGetElement(type + '-extractAll');
    if (extractAllBtn) extractAllBtn.addEventListener('click', () => handleExtractAll(type));

    // permit Tab：绑定「🔗 提取合并表」（旧「💾 导出合并表CSV」按钮已和主导出按钮合并为「💾 导出CSV（完整）」，不再单独处理）
    if (type === 'permit') {
        const mergeBtn = safeGetElement('permit-extractMerge');
        if (mergeBtn) mergeBtn.addEventListener('click', () => handlePermitExtractMerge(type));
    }
}

// ===== 🔴🔗 施工许可「提取合并表」主流程 =====
// fromAutoStep2: true 表示由「一键两步」的 finishExtraction 钩子自动触发（Step1 完成后的 Step2），此时不应清空 permit 缓存
function handlePermitExtractMerge(type, fromAutoStep2) {
    const statusId = type + '-status';
    const progressId = type + '-progress';
    const stopBtn = safeGetElement(type + '-stop');
    const fmEl = safeGetElement(type + '-fetchMode');
    const fm = fmEl ? String(fmEl.value || 'dom') : 'dom';
    if (isExtracting[type]) {
        updateStatus(statusId, '⚠️ 正在进行中的提取任务尚未完成，请等待或先停止。', '');
        return;
    }

    // ===== 公共合并规则 + 写入 currentData + 渲染（100% 复用原来的「合并导出」规则，极速/兼容 都走这一套）=====
    function buildMergeAndRender(permitRowsClipped, basicRowsClipped, stats) {
        try { isExtracting[type] = false; } catch (e) {}
        try { if (stopBtn) stopBtn.style.display = 'none'; } catch (e) {}
        // ✅ 直接引用顶部全局常量（和 BASIC_FIELDS / PERMIT_FIELDS 100% 同步，再也不会出现顺序/字段不同步的问题）
        const BASIC_FIELDS_REF = Array.isArray(BASIC_FIELDS) ? BASIC_FIELDS.slice() : [
            '项目名称','省级项目编号','项目分类','建设单位','组织机构代码',
            '项目所在地','所在市','详细地址','立项文号','立项级别',
            '立项批复机关','立项批复时间','总投资（万元）','总面积/长度（平方米/米）',
            '建设规模','建设性质','工程用途','计划开工日期','数据等级'
        ];
        const PERMIT_FIELDS_REF = Array.isArray(PERMIT_FIELDS) ? PERMIT_FIELDS.slice() : [
            '工程名称','施工许可证编号','省级项目编号','合同价格','建设地址','建设规模','建设单位','工程总承包单位','勘察单位','设计单位','施工单位','监理单位',
            '建设单位项目负责人','工程总承包项目经理','勘察单位项目负责人','设计单位项目负责人','施工单位项目负责人',
            '总监理工程师','合同工期','状态','备注','发证机关','数据等级'
        ];
        const PROJECT_CODE_FIELD = '省级项目编号';
        const basicFieldSet = new Set(BASIC_FIELDS_REF);
        const dupFieldSet = new Set();
        for (const k of PERMIT_FIELDS_REF) {
            if (basicFieldSet.has(k) && k !== PROJECT_CODE_FIELD) dupFieldSet.add(k);
        }
        function renameField(srcSide, fieldName) {
            if (srcSide === 'permit' && dupFieldSet.has(fieldName)) return '许可_' + fieldName;
            return fieldName;
        }
        const permitRows = Array.isArray(permitRowsClipped) ? permitRowsClipped : [];
        const basicRows = Array.isArray(basicRowsClipped) ? basicRowsClipped : [];
        const basicByCode = {};
        for (const bRow of basicRows) {
            const code = (bRow && bRow[PROJECT_CODE_FIELD]) ? String(bRow[PROJECT_CODE_FIELD]).trim() : '';
            if (!code) continue;
            if (!basicByCode[code]) basicByCode[code] = [];
            basicByCode[code].push(bRow);
        }
        function buildChangeNote(br, pr) {
            const notes = [];
            if (br && pr) {
                if (br['建设单位'] && pr['建设单位'] && String(br['建设单位']) !== String(pr['建设单位'])) {
                    notes.push('建设单位不同(基本信息为' + br['建设单位'] + '，许可为' + pr['建设单位'] + ')');
                }
                if (br['建设规模'] && pr['建设规模'] && String(br['建设规模']) !== String(pr['建设规模'])) {
                    notes.push('建设规模不同');
                }
                if (br['数据等级'] && pr['数据等级'] && String(br['数据等级']) !== String(pr['数据等级'])) {
                    notes.push('数据等级不同(基本信息为' + br['数据等级'] + '，许可为' + pr['数据等级'] + ')');
                }
            }
            if (!br) notes.push('未找到匹配的基本信息(省级项目编号为空或不存在)');
            if (!pr) notes.push('未找到匹配的施工许可');
            return notes.join('；');
        }
        const finalFields = [];
        const finalFieldSet = {};
        function pushField(f) { if (!finalFieldSet[f]) { finalFieldSet[f] = true; finalFields.push(f); } }
        for (const k of BASIC_FIELDS_REF) pushField(renameField('basic', k));
        for (const k of PERMIT_FIELDS_REF) pushField(renameField('permit', k));
        // ✅ 用户明确要求：施工许可合并表删除「变更备注」字段
        // pushField('变更备注');
        // ✅ 天眼查补全后缀列：锚定插入到对应基础单位列后面（permit 合并表 fields 也按统一规则排）
        (function() {
            var initSet = new Set(Object.keys(finalFieldSet));
            var ans = anchorInsertTycColumnsIntoFields(finalFields, initSet, [], { appendCustomColsAtEnd: false });
            if (Array.isArray(ans.fields) && ans.fields.length >= finalFields.length) {
                // 有变更时直接替换
                finalFields.length = 0;
                ans.fields.forEach(function(f) { finalFields.push(f); });
            }
        })();
        const mergedRows = [];
        for (const pr of permitRows) {
            const code = (pr && pr[PROJECT_CODE_FIELD]) ? String(pr[PROJECT_CODE_FIELD]).trim() : '';
            const matchedBasicArr = code && basicByCode[code] && basicByCode[code].length > 0 ? basicByCode[code] : [null];
            for (const br of matchedBasicArr) {
                const row = {};
                for (const f of BASIC_FIELDS_REF) {
                    row[renameField('basic', f)] = (br && br[f] !== undefined && br[f] !== null) ? String(br[f]) : '';
                }
                for (const f of PERMIT_FIELDS_REF) {
                    row[renameField('permit', f)] = (pr && pr[f] !== undefined && pr[f] !== null) ? String(pr[f]) : '';
                }
                // ✅ 用户明确要求：施工许可合并表删除「变更备注」字段
                // row['变更备注'] = buildChangeNote(br, pr);
                try { delete row['项目经理注册号']; delete row['许可_项目经理注册号']; } catch (e) {}
                mergedRows.push(row);
            }
        }
        const permitRowsFinal = permitRows.map(function (r) {
            const out = {};
            if (!r) return out;
            for (const k of PERMIT_FIELDS_REF) out[k] = (r[k] !== undefined && r[k] !== null) ? String(r[k]) : '';
            return out;
        });
        // ✅ 写入 currentData.permitBasicMerge（预览/导出都优先读这个）
        currentData.permitBasicMerge = { rows: mergedRows, fields: finalFields };
        // ✅ 需求 2：同步一份到 currentData.merge / currentData.mergeFields
        //     作用：① 施工许可提取合并表 ↔ 合并导出 queried 缓存互通，用户分不清哪个都能得到最新的；
        //           ② 合并导出 Tab 选「融合已查询数据」时，这份合并表会参与后续三表/多表合并；
        //           ③ 天眼查补全里 target='merge' 选「合并导出」时优先读 currentData.merge（也就是最新这份 permitBasicMerge）
        currentData.merge = Array.isArray(mergedRows) ? mergedRows.slice() : [];
        currentData.mergeFields = Array.isArray(finalFields) ? finalFields.slice() : [];
        try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
        currentData[type] = sortData(permitRowsFinal, type);
        try {
            const tblId = type + '-table';
            const tbl = safeGetElement(tblId);
            if (tbl) {
                if (mergedRows.length > 0) {
                    renderTable(tblId, mergedRows, finalFields, TAB_CONFIG.complete.isNumberField || (() => false));
                } else if (permitRowsFinal.length > 0) {
                    renderTable(tblId, permitRowsFinal, TAB_CONFIG[type].fields, TAB_CONFIG[type].isNumberField || (() => false));
                }
                tbl.style.display = '';
            }
        } catch (eTbl) {}
        try { syncFetchModeInputs('permit'); } catch (eSync) {}
        const permitTotal = Number(stats.permitTotal) || 0;
        const permitGot = Number(stats.permitGot) || permitRowsFinal.length;
        const basicUniq = Number(stats.basicUniq) || basicRows.length;
        const viaDom = stats.via === 'dom';
        showProgress(progressId, 100);
        setTimeout(() => hideProgress(progressId), 1500);
        let fetchDesc = '';
        if (viaDom) {
            fetchDesc = '✅ 「🔗 提取合并表」完成！（兼容模式：基于当前已提取的 permit 单表 + 按省级项目编号反查基本信息）\n\n';
            fetchDesc += '施工许可：当前已提取 ' + permitGot + ' 条（兼容模式手动 DOM 翻页提取）。\n';
        } else {
            const overLimit = permitTotal > 300;
            fetchDesc = '✅ 「🔗 提取合并表」完成！\n\n';
            fetchDesc += '施工许可：命中 ' + permitTotal + ' 条，实际抓取 ' + permitGot + ' 条（' + (overLimit ? '超过服务器 300 条硬上限，已自动截断，301+ 全为重复' : '一次性 pageSize 抓取') + '）。\n';
        }
        fetchDesc +=
            '按「省级项目编号」去重匹配：' + basicUniq + ' 个基本信息。\n' +
            '1:N 合并表（以施工许可展开，规则完全等同于「合并导出」）：' + mergedRows.length + ' 条 × ' + finalFields.length + ' 列。\n\n' +
            '👉 字段说明（与合并导出 Tab 完全一致）：\n' +
            '  · 重名字段（建设单位 / 建设规模 / 数据等级 等）：施工许可侧已加「许可_」前缀\n' +
            '  · 连接键：「省级项目编号」仅 1 列（两侧同值，无需前缀）\n' +
            '  · 最后一列「变更备注」：自动记录差异情况（单位/规模/等级是否不一致、未匹配基本信息等）\n\n' +
            '👉 操作指引：\n' +
            '  · 点「📋 预览数据」→ 显示合并结果\n' +
            '  · 点「💾 导出合并表CSV」→ 下载最终合并表\n' +
            '  · 点「🗑 清空数据」→ 同时清空 permit 单表 + 合并表';
        updateStatus(statusId, fetchDesc, 'success');
        try {
            console.log('[permitMergeBasic] 最终：permit=' + permitRowsFinal.length + ', basic=' + basicRows.length + ', merged=' + mergedRows.length + ', cols=' + finalFields.length + ', via=' + (viaDom ? '兼容模式(DOM→反查basic)' : '极速模式(API→反查basic)'));
            if (mergedRows.length > 0) {
                console.log('[permitMergeBasic] 首行字段：', finalFields);
                console.log('[permitMergeBasic] 首行内容(前2000字)：', JSON.stringify(mergedRows[0] || {}).substring(0, 2000));
            }
        } catch (eC) {}
    }

    // ===== 分支 1：🚀 极速模式（api/smart）→ 一次性接口抓取 permit + 反查 basic（原有逻辑，只是合并规则抽到 buildMergeAndRender）=====
    if (fm === 'api' || fm === 'smart') {
        const baseFilters = buildTabExtractFilters(type);
        const wantTotal = Math.max(1, Number(baseFilters.apiPageSize) || 100);
        if (wantTotal > 300) {
            try {
                const go = confirm('⚠️ 【分段抓取·建议】\n\n你填写的「提取数据总条数」是 ' + wantTotal + ' 条。\n\n由于服务器已封死：无论有没有筛选，301+ 全是重复数据，即使填超过 300 条也只会返回前 300 条真实数据。\n\n推荐：用开始日期/结束日期（按月/季度）+ 所在城市，把每段数据量控制在 300 条以内，再配合「🔗 提取合并表」分段抓取，合并后得到完整数据。\n\n是否继续？（继续将按 300 条上限自动截断）');
                if (!go) { updateStatus(statusId, '已取消「🔗 提取合并表」。'); return; }
            } catch (e) {}
        } else {
            updateStatus(statusId, '🔗 开始抓取合并表（极速模式）：施工许可 ' + wantTotal + ' 条 + 按省级项目编号反查基本信息...');
        }
        isExtracting[type] = true;
        stopRequested[type] = false;
        if (stopBtn) stopBtn.style.display = '';
        showProgress(progressId, 10);

        sendToContent(
            { action: 'permitFetchMergeBasic', type: type, filters: baseFilters, apiPageSize: wantTotal },
            (resp) => {
                if (!resp || !resp.success) {
                    try { isExtracting[type] = false; } catch (e) {}
                    try { if (stopBtn) stopBtn.style.display = 'none'; } catch (e) {}
                    const errMsg = (resp && resp.error) ? String(resp.error) : '未知错误';
                    updateStatus(statusId, '❌ 「🔗 提取合并表」失败：' + errMsg, 'error');
                    try { alert('合并表抓取失败：\n' + errMsg); } catch (e2) {}
                    hideProgress(progressId);
                    return;
                }
                buildMergeAndRender(resp.permitRows, resp.basicRows, {
                    permitTotal: resp.permitTotal,
                    permitGot: resp.permitFetched,
                    basicUniq: resp.basicUniqCount,
                    via: 'api'
                });
            },
            () => {
                try { isExtracting[type] = false; } catch (e) {}
                try { if (stopBtn) stopBtn.style.display = 'none'; } catch (e) {}
                updateStatus(statusId, '❌ 「🔗 提取合并表」通信超时，请刷新目标施工许可页面后重试。', 'error');
                try { hideProgress(progressId); } catch (e) {}
            },
            (errMsg) => {
                try { isExtracting[type] = false; } catch (e) {}
                try { if (stopBtn) stopBtn.style.display = 'none'; } catch (e) {}
                updateStatus(statusId, '❌ 「🔗 提取合并表」出错：' + (errMsg || '未知'), 'error');
                try { hideProgress(progressId); } catch (e) {}
            },
            () => {}
        );
        return;
    }

    // ===== 分支 2：🐢 兼容模式（dom）→ 一键两步！=====
    //  Step 1: 若 currentData.permit 为空 → 复用 buildFiltersAndDoExtract（=「🔍 开始提取」的 DOM 翻页+详情提取），挂钩子等它完成
    //  Step 2: finishExtraction 抓到 permit 后，通过 pendingPermitMergeAutoStep2 钩子自动走下面的「已有 permit → 反查 basic」分支
    // ✅🔴 修复：兼容模式下每次点击「提取合并表」都必须用当前页码范围重新抓取 permit，
    //      不能复用旧缓存（否则用户改了页码范围后合并表数据不更新）。
    //      但 fromAutoStep2=true 时（一键两步的 Step2 自动回调）不能清空，否则会无限循环重新提取。
    if (!fromAutoStep2) {
        try {
            if (Array.isArray(currentData[type])) currentData[type] = [];
            if (currentData.permitBasicMerge) { try { delete currentData.permitBasicMerge; } catch (eD) { currentData.permitBasicMerge = null; } }
        } catch (eClr) {}
    }
    const existingPermitRows = Array.isArray(currentData[type]) ? currentData[type] : [];
    if (existingPermitRows.length === 0) {
        // 🚀 一键两步：先自动调「开始提取」抓 permit，完成后自动再合并（100% 复用按钮点击逻辑，零重写）
        pendingPermitMergeAutoStep2 = true;
        updateStatus(statusId, '🔗 一键两步已启动（兼容模式）→ Step1：自动触发「DOM 翻页 + 详情提取」抓取施工许可（等同于先点「🔍 开始提取」）。\n      Step1 完成后会自动启动 Step2（反查基本信息 + 生成合并表），请耐心等待...', 'success');
        const base = buildTabExtractFilters(type);
        // buildFiltersAndDoExtract 内部会走 pageMode → doExtract → processListPhase → startDetailPhase → finishExtraction
        // finishExtraction 里的钩子会自动调 handlePermitExtractMerge 二次，进入 existingPermitRows.length>0 分支
        try { buildFiltersAndDoExtract(type, base); } catch (eStep1) {
            pendingPermitMergeAutoStep2 = false;
            console.error('[permitMerge] 自动 Step1 触发失败：', eStep1);
            updateStatus(statusId, '❌ 自动启动 DOM 提取失败：' + String(eStep1 && eStep1.message || eStep1), 'error');
            try { alert('一键两步启动失败：\n' + String(eStep1 && eStep1.message || eStep1) + '\n\n可以先手动点「🔍 开始提取」抓 permit，再点「🔗 提取合并表」继续。'); } catch (eA) {}
        }
        return;
    }
    // DOM 模式下 permit 单表已有（Step1 完成）→ 正式开始 Step2：反查 basic + 合并
    isExtracting[type] = true;
    stopRequested[type] = false;
    if (stopBtn) stopBtn.style.display = '';
    showProgress(progressId, 10);
    const uniqPreview = new Set();
    for (const r of existingPermitRows) { const c = String(r && r['省级项目编号'] || '').trim(); if (c) uniqPreview.add(c); }
    updateStatus(statusId, '🔗 开始生成合并表（兼容模式 Step2）：已有 permit ' + existingPermitRows.length + ' 条 / 去重省级项目编号 ' + uniqPreview.size + ' 个，正在反查基本信息...');
    sendToContent(
        { action: 'permitMergeBasicFromPermitRows', type: type, permitRows: existingPermitRows },
        (resp) => {
            if (!resp || !resp.success) {
                try { isExtracting[type] = false; } catch (e) {}
                try { if (stopBtn) stopBtn.style.display = 'none'; } catch (e) {}
                const errMsg = (resp && resp.error) ? String(resp.error) : '未知错误';
                updateStatus(statusId, '❌ 「🔗 提取合并表(兼容模式)」失败：' + errMsg, 'error');
                try { alert('合并表生成失败：\n' + errMsg); } catch (e2) {}
                hideProgress(progressId);
                return;
            }
            buildMergeAndRender(resp.permitRows, resp.basicRows, {
                permitTotal: resp.permitTotal,
                permitGot: resp.permitFetched,
                basicUniq: resp.basicUniqCount,
                via: 'dom'
            });
        },
        () => {
            try { isExtracting[type] = false; } catch (e) {}
            try { if (stopBtn) stopBtn.style.display = 'none'; } catch (e) {}
            updateStatus(statusId, '❌ 「🔗 提取合并表(兼容模式)」通信超时，请刷新目标页面后重试。', 'error');
            try { hideProgress(progressId); } catch (e) {}
        },
        (errMsg) => {
            try { isExtracting[type] = false; } catch (e) {}
            try { if (stopBtn) stopBtn.style.display = 'none'; } catch (e) {}
            updateStatus(statusId, '❌ 「🔗 提取合并表(兼容模式)」出错：' + (errMsg || '未知'), 'error');
            try { hideProgress(progressId); } catch (e) {}
        },
        () => {}
    );
}

(function initAllTabs() {
    initTabButtons('basic');
    initTabButtons('permit');
    initTabButtons('complete');
})();

// ============================================================
// ===== 显示方式切换（侧边栏 / 弹窗 / 新窗口）=====
// ============================================================
(function initDisplayModeSelector() {
    const displayModeSelect = safeGetElement('displayMode');
    if (!displayModeSelect) return;

    const DEFAULT_MODE = 'popup';
    const USER_SET_KEY = 'displayModeUserSet';  // 标记用户是否主动选择过

    // 🔴✅✅✅ 终极形态判断：读 URL 参数（100% 准确！根本不用猜！）
    // background 打开 window 时会加 ?mode=window；其他进入方式会加 ?mode=sidebar（见 background.js 切换逻辑）
    function getModeFromUrl() {
        try {
            var qs = new URLSearchParams(window.location.search || '');
            var m = qs.get('mode');
            if (m === 'window' || m === 'sidebar' || m === 'popup') return m;
        } catch (eu) {}
        return null;
    }

    // 🔴✅ 第一步：判断当前 popup 真实是以哪种形态打开的！
    function detectActualMode(cb) {
        // 1. 优先读 URL 参数：100% 准！
        var fromUrl = getModeFromUrl();
        if (fromUrl) {
            cb && cb(fromUrl);
            return;
        }

        // 2. URL 没加参数（popup 原生点扩展图标进来的、或旧逻辑打开的）→ 用窗口特征精准判断
        var vw = window.innerWidth || document.documentElement.clientWidth || 0;
        try {
            chrome.windows.getCurrent(function (win) {
                var winType = win && win.type ? win.type : '';
                var w = win && win.width ? win.width : vw;
                var h = win && win.height ? win.height : 0;
                var guessed;
                if (winType === 'popup') {
                    // popup 类型：大窗口是 window 模式（820x640），小窗口是浏览器 action 原生 popup
                    if (w >= 700 && h >= 500) guessed = 'window';
                    else guessed = 'popup';
                } else {
                    // normal 类型：一定嵌在浏览器主窗口里
                    // 侧边栏宽度 <=600px（Chrome 默认+用户拉宽都在这个范围）
                    if (vw > 0 && vw <= 600) guessed = 'sidebar';
                    else guessed = 'popup';
                }
                cb && cb(guessed);
            });
            return;
        } catch (e) {}
        cb && cb(DEFAULT_MODE);
    }

    // 先临时设 DEFAULT（防止闪）
    displayModeSelect.value = DEFAULT_MODE;

    // 🔴✅ 第二步：优先用「实际打开形态」→ 再 fallback 到用户存的值
    detectActualMode(function (actualMode) {
        const el = safeGetElement('displayMode');
        if (!el) return;
        const validModes = ['popup', 'sidebar', 'window'];
        if (validModes.indexOf(actualMode) === -1) actualMode = DEFAULT_MODE;

        // 如果用户明确主动选过某种模式，再对比一下实际形态：
        // - 如果实际形态 == 用户存的模式 → 就用它（完美一致）
        // - 如果实际形态 != 用户存的模式 → **以实际形态为准**（因为用户可能是点扩展图标用 popup 方式进来的，
        //   而之前存的是 sidebar，这时如果强行显示 sidebar 会误导用户）
        try {
            chrome.storage.sync.get([USER_SET_KEY, 'displayMode'], function (result) {
                var finalMode = actualMode; // 默认以实际为准
                var userSet = result && result[USER_SET_KEY];
                var saved = result && result.displayMode;

                // 唯一沿用用户存储的情况：存储的是 sidebar/window 且实际形态刚好就是它（说明是通过 sidebar/window 进来的）
                if (userSet && saved && validModes.indexOf(saved) !== -1 && saved === actualMode) {
                    finalMode = saved;
                }
                // 如果实际是 popup，但用户存的是 window/sidebar → 就用实际的 popup，不要误导
                el.value = finalMode;
                // 顺便把实际形态同步到 storage（但不改 userSet 标记，避免覆盖用户明确选择的意图）
                try { chrome.storage.sync.set({ displayMode: finalMode }); } catch (e) {}
            });
        } catch (eSt) {
            el.value = actualMode;
        }
    });

    // 监听用户主动更改
    displayModeSelect.addEventListener('change', function () {
        const mode = displayModeSelect.value;

        // 保存用户选择（同时设置 userSet 标记，表示用户主动选过）
        try {
            chrome.storage.sync.set({ displayMode: mode, displayModeUserSet: true });
        } catch (e) {}

        if (mode === 'sidebar') {
            try {
                if (!(chrome.sidePanel && chrome.sidePanel.open)) {
                    alert('当前 Chrome 版本不支持侧边栏 API，请升级到 Chrome 114+ 或选择「弹窗」模式。');
                    displayModeSelect.value = DEFAULT_MODE;
                    chrome.storage.sync.set({ displayMode: DEFAULT_MODE });
                    return;
                }

                // 🔴✅✅✅ 丝滑切换：
                // 先判断当前窗口是什么类型：
                //  - 如果是独立新窗口（winType=popup，820x640 大窗口）→ 必须在【用户正在使用的主浏览器窗口（normal 类型）】里开侧边栏！
                //    之前用 WINDOW_ID_CURRENT 是错的！新窗口的 WINDOW_ID_CURRENT 是它自己（popup 类型），Chrome 不让在 popup 里开侧边栏 → 只会失败然后关掉新窗口，看起来像"缩回去"
                //  - 如果已经在 normal 浏览器窗口里（popup/sidebar 嵌在里面）→ 直接 WINDOW_ID_CURRENT
                try {
                    chrome.windows.getCurrent(function (curWin) {
                        var curWinType = curWin && curWin.type ? curWin.type : '';
                        var curW = curWin && curWin.width ? curWin.width : 0;
                        var curH = curWin && curWin.height ? curWin.height : 0;
                        var curIsWindowMode = (curWinType === 'popup' && curW >= 700 && curH >= 500);

                        var targetWindowId = null;
                        function openSidebarOnTargetAndCloseCur(tid) {
                            try {
                                // 🔴✅ 侧边栏 URL 也加 mode=sidebar 参数，保证侧边栏里"显示方式"永远是侧边栏！（100% 准）
                                chrome.sidePanel.setOptions({
                                    path: 'popup.html?mode=sidebar'
                                }).catch(function () {});
                                chrome.sidePanel.open({ windowId: tid }, function () {
                                    var err = chrome.runtime.lastError;
                                    if (err) {
                                        console.warn('[popup] sidePanel.open 失败:', err.message);
                                        alert('打开侧边栏失败，请重试：' + err.message);
                                        detectActualMode(function (m) { displayModeSelect.value = m; });
                                        return;
                                    }
                                    // ✅🔴✅ 侧边栏打开成功 → 不管当前是【原生浏览器小 popup】还是【独立新窗口】，一律立刻关闭！
                                    // （之前只关新窗口，导致"弹窗和侧边栏一起存在"的问题！彻底删掉 if 限制！）
                                    try { window.close(); } catch (eClose) {
                                        // 兜底：原生 popup 有时 window.close() 被拦截？尝试再 setTimeout 执行一次
                                        setTimeout(function () { try { window.close(); } catch (e) {} }, 100);
                                    }
                                });
                            } catch (eS) {
                                alert('打开侧边栏失败: ' + eS.message);
                                detectActualMode(function (m) { displayModeSelect.value = m; });
                            }
                        }

                        if (curIsWindowMode) {
                            // ✅ 当前在独立新窗口（window 模式）→ 找「用户正在用的 normal 主窗口」
                            // （lastFocused=true 优先选最近聚焦的）
                            chrome.windows.getAll({ windowTypes: ['normal'], populate: false }, function (normalWins) {
                                var bestWin = null;
                                if (normalWins && normalWins.length > 0) {
                                    // 优先 focused=true 的
                                    for (var i = 0; i < normalWins.length; i++) {
                                        if (normalWins[i].focused) { bestWin = normalWins[i]; break; }
                                    }
                                    if (!bestWin) bestWin = normalWins[0];
                                }
                                if (bestWin && bestWin.id) {
                                    openSidebarOnTargetAndCloseCur(bestWin.id);
                                } else {
                                    // 找不到 normal 窗口（极端情况）→ 新建一个 normal 窗口？
                                    // 兜底：直接 WINDOW_ID_CURRENT 尝试（大概率失败，但至少有提示）
                                    openSidebarOnTargetAndCloseCur(chrome.windows.WINDOW_ID_CURRENT);
                                }
                            });
                        } else {
                            // ✅ 已经在 normal 窗口里（当前是 popup 原生弹窗 / 已经在 sidebar 里）→ WINDOW_ID_CURRENT 就是主窗口 id
                            openSidebarOnTargetAndCloseCur(chrome.windows.WINDOW_ID_CURRENT);
                        }
                    });
                } catch (err) {
                    alert('切换到侧边栏失败: ' + err.message);
                    detectActualMode(function (m) { displayModeSelect.value = m; });
                }
            } catch (outerErr) {
                alert('切换到侧边栏失败: ' + outerErr.message);
                detectActualMode(function (m) { displayModeSelect.value = m; });
            }
        } else if (mode === 'window') {
            try {
                // 🔴✅ 新窗口也加 mode=window，保证"显示方式"永远是新窗口！
                chrome.windows.create({
                    url: chrome.runtime.getURL('popup.html') + '?mode=window',
                    type: 'popup',
                    width: 820,
                    height: 640,
                    focused: true
                }, function (win) {
                    if (chrome.runtime.lastError || !win) {
                        alert('打开新窗口失败，请使用「弹窗」模式。');
                        detectActualMode(function (m) { displayModeSelect.value = m; });
                        chrome.storage.sync.set({ displayMode: displayModeSelect.value });
                        return;
                    }
                    // 先打开新窗口成功了 → 再关当前旧的
                    try { window.close(); } catch (e) {}
                });
            } catch (err) {
                alert('打开新窗口失败: ' + err.message);
                detectActualMode(function (m) { displayModeSelect.value = m; });
                chrome.storage.sync.set({ displayMode: displayModeSelect.value });
            }
        } else {
            // 🔴✅ 选择「弹窗」模式（popup）：
            //   Chrome 限制：browser action popup 只能通过用户点扩展图标打开，代码无法主动打开
            //   ✅ 用户要求：选择弹窗模式后，其他模式的插件自动关闭！
            //     1. 侧边栏里选弹窗 → 立刻关侧边栏内容（window.close()）
            //     2. 新窗口里选弹窗 → 立刻关新窗口（window.close()）
            //     3. background 同步关掉其他形态的独立窗（防止有漏网的 820×640 还开着）
            try {
                // 先发消息让 background 关掉其他模式的窗口（独立新窗口）
                try {
                    chrome.runtime.sendMessage({ action: 'closeOtherModeWindows', targetMode: 'popup' }, function () {});
                } catch (eMsg) {}

                // 关当前这个容器（侧边栏 / 新窗口）→ 100% 都关，不弹提示！
                // （侧边栏里执行 window.close() 会关掉侧边栏的内容页，Chrome 侧边栏容器也会自动收起或空白，用户感知是关了）
                var closed = false;
                try {
                    window.close();
                    closed = true;
                } catch (eClose) {}

                // 兜底：如果 window.close() 被 Chrome 拦截（原生浏览器 popup 有时会拦），提示用户但不打扰
                if (!closed) {
                    setTimeout(function () {
                        try { window.close(); } catch (e2) {}
                    }, 150);
                }
            } catch (eA) {
                try { window.close(); } catch (e2) {}
            }
        }
    });
})();

// ============================================================
// ===== 🔴✅ 公共：合并「基本信息 × 施工许可」1:N（沿用 merge Tab 原有合并规则，保证字段重命名/前缀完全一致！）=====
//   - basic 字段前缀（重名字段加前缀）：空字符串 ''（与 merge-generate 一致 PREFIX_BASIC=''）
//   - permit 字段前缀（重名字段加前缀）：'许可_'
//   - 主键：省级项目编号（不加重名字段前缀）、工程名称（也不重命名）
//   - 展开方向（1:N）：以 permit 为主线（1 basic × N permit → 结果展开 N 条，permit 每一条都占一行，没有 basic 匹配到就空）
//   - 返回 { mergedRows, finalFields }
function buildMergeBasicPermit(finalBasicRows, finalPermitRows) {
    const projectCodeField = '省级项目编号';
    const projectNameField = '工程名称';
    const PREFIX_BASIC    = '';
    const PREFIX_PERMIT   = '许可_';
    // 计算重名字段（只有在两边都出现的才加前缀）
    const allFieldCount = {};
    BASIC_FIELDS.forEach(f    => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
    PERMIT_FIELDS.forEach(f   => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
    const dupFieldSet = new Set(Object.keys(allFieldCount).filter(f => allFieldCount[f] >= 2));
    dupFieldSet.delete(projectCodeField);  // 连接键：不加前缀
    dupFieldSet.delete(projectNameField);  // 连接键：不加前缀
    function renameField(source, fieldName) {
        if (!dupFieldSet.has(fieldName)) return fieldName;
        if (source === 'basic')    return PREFIX_BASIC + fieldName;
        if (source === 'permit')   return PREFIX_PERMIT + fieldName;
        return fieldName;
    }
    function prefixRow(row, source) {
        if (!row) return {};
        const out = {};
        Object.keys(row).forEach(k => {
            const newK = renameField(source, k);
            out[newK] = row[k];
        });
        return out;
    }
    // basic 按省级项目编号建索引（1 个编号可能对应多条 basic 记录？通常项目编号唯一，但兼容数组兜底）
    const basicByCode = {};
    (finalBasicRows || []).forEach(r => {
        const code = r[projectCodeField];
        if (code) { (basicByCode[code] = basicByCode[code] || []).push(r); }
    });
    // 最终字段顺序：先 basic 全部按 BASIC_FIELDS，再 permit 全部按 PERMIT_FIELDS（重名字段加前缀）
    const finalFields = [];
    BASIC_FIELDS.forEach(f => {
        const nf = renameField('basic', f);
        if (finalFields.indexOf(nf) === -1) finalFields.push(nf);
    });
    PERMIT_FIELDS.forEach(f => {
        const nf = renameField('permit', f);
        if (finalFields.indexOf(nf) === -1) finalFields.push(nf);
    });
    // 主线：permit × basic 展开（每条 permit 一行，1:N）
    const merged = [];
    (finalPermitRows || []).forEach(permitRow => {
        const code = permitRow[projectCodeField];
        const name = permitRow[projectNameField];
        let basics = code && basicByCode[code] ? basicByCode[code] : [null];
        if (basics.length === 0) basics = [null];
        basics.forEach(bRow => {
            const row = {};
            Object.assign(row, prefixRow(bRow, 'basic'));
            Object.assign(row, prefixRow(permitRow, 'permit'));
            // 关键：连接列强制补齐，保证不会因为 basic=null 丢失 permit 自己已有的 code/name
            if (!row[projectCodeField]) row[projectCodeField] = (bRow && bRow[projectCodeField]) || (permitRow && permitRow[projectCodeField]) || code || '';
            if (!row[projectNameField]) row[projectNameField] = (permitRow && permitRow[projectNameField]) || (bRow && bRow[projectNameField]) || name || '';
            merged.push(row);
        });
    });
    return { mergedRows: merged, finalFields: finalFields };
}

// ============================================================
// ===== 合并导出 Tab（全新实现：多表自动识别 + 主表基准 + 外键合并）
// 说明：施工许可 Tab 的「🔗 提取合并表 / 💾 导出合并表CSV」走 currentData.permitBasicMerge，
//       和这里的合并导出 Tab 是两套独立能力，本次不做任何改动。
// 外键约定（用户明确指定）：
//   · 基本信息 × 施工许可：一对多，以「省级项目编号」为外键
//   · 基本信息 × 竣工验收备案：一对多，以「省级项目编号」为外键
//   · 施工许可 × 竣工验收备案：一对一，以「工程名称」为外键
// ============================================================
(function __mergeMain() {
    'use strict';

    // ---------- 识别规则：通过字段集合判断上传表属于什么类型 ----------
    const T_RULES = {
        // 基本信息：只有 基本信息 特征字段（建设单位、项目名称、项目所在地 等），且绝对不含 施工许可专属字段（施工许可证编号、勘察/设计/监理等 6 类单位）
        basic: {
            must:   ['省级项目编号', '项目名称', '建设单位'],
            forbid: ['施工许可证编号', '勘察单位', '设计单位', '施工单位', '监理单位', '工程总承包单位',
                     '省级竣工验收备案编号', '竣工验收备案编号', '竣工验收日期', '实际竣工日期', '备案机关'],
            label: '基本信息表'
        },
        // 施工许可：包含 施工许可证编号 或 至少 2 个许可侧单位
        permit: {
            must:   ['省级项目编号', '工程名称'],
            oneOf:  ['施工许可证编号', '勘察单位', '设计单位', '施工单位', '监理单位', '工程总承包单位', '合同价格', '建设规模'],
            forbid: ['省级竣工验收备案编号', '竣工验收备案编号', '竣工验收日期', '实际竣工日期'],
            label: '施工许可表'
        },
        // 竣工验收备案：含备案编号/竣工验收日期 任一
        complete: {
            must:   ['省级项目编号', '工程名称'],
            oneOf:  ['省级竣工验收备案编号', '竣工验收备案编号', '竣工验收日期', '实际竣工日期', '备案机关'],
            forbid: ['施工许可证编号'],
            label: '竣工验收备案表'
        },
        // 基本 + 施工 融合表：同时命中 basic + permit 的 must，且不命中 complete
        fusion: {
            must:   ['省级项目编号'],
            both:   [
                // 至少 1 个 basic 侧独有字段（非 overlap）
                ['数据等级', '项目分类', '行业类别', '建设依据', '项目所在地', '总投资(万元)', '计划开工时间', '计划竣工时间'],
                // 至少 1 个 permit 侧独有字段
                ['施工许可证编号', '勘察单位', '设计单位', '监理单位', '工程总承包单位', '合同工期', '合同价格']
            ],
            forbid: ['省级竣工验收备案编号', '竣工验收备案编号', '竣工验收日期'],
            label: '基本信息+施工许可 融合表'
        }
    };

    // 天眼查补全后缀（命中这些后缀说明表已经被天眼查补全过）
    const TYC_SUFFIXES = ['_社会信用代码', '_电话', '_法人', '_地址', '_成立日期'];
    // 三表自身去重键
    const DEDUP = {
        basic:    ['省级项目编号'],
        permit:   ['省级项目编号', '工程名称', '施工许可证编号'],
        complete: ['省级项目编号', '工程名称', '省级竣工验收备案编号', '竣工验收备案编号']
    };

    // ---------- 内部 state ----------
    const _state = {
        master: null,          // { file:string, rows:[], fields:[], detectedAs?:string }
        batches: [],           // 多表上传：每一项 { file:string, batchId, type:'basic'|'permit'|'complete'|'fusion', rows:[], fields:[], confidence:number, notes:[] }
        errors: [],            // 识别失败：{ file, reason }
        // queried.tyc：{ basic:[], permit:[], complete:[], permitBasicMerge:[] }
        //   basic/permit/complete = 三个 Tab 各自点「天眼查补全」后，补全了天眼查字段的行
        //   permitBasicMerge = 施工许可 Tab 点「🔗 提取合并表」→ 再天眼查补全后的 rows（即 基本信息+施工许可 融合后带天眼查）
        queried: { basic: [], permit: [], complete: [], tyc: { basic: [], permit: [], complete: [], permitBasicMerge: [] } },
        // srcEnabled：UI 4 个 checkbox 的勾选状态
        srcEnabled: { basic: true, permit: true, complete: true, tyc: true },
        last: null,            // { rows:[], fields:[] }
    };

    // ---------- 工具 ----------
    function uq(a) { return Array.isArray(a) ? a.filter(function(v, i, arr) { return i === arr.indexOf(v); }) : []; }
    function pickFirst(row, keys) {
        if (!row || !keys) return '';
        for (var i = 0; i < keys.length; i++) {
            var v = row[keys[i]];
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
    }
    function norm(s) { return (s === undefined || s === null) ? '' : String(s).replace(/\s+/g, '').trim(); }
    function fp(row, keys) { return (keys || []).map(function(k) { return norm(row ? row[k] : ''); }).join('||'); }
    function hasTyc(headers) {
        var hh = headers || [];
        for (var i = 0; i < hh.length; i++) {
            for (var j = 0; j < TYC_SUFFIXES.length; j++) {
                if (typeof hh[i] === 'string' && hh[i].indexOf(TYC_SUFFIXES[j]) >= 0) return true;
            }
        }
        return false;
    }
    function dedupByKeys(rows, keys) {
        var out = [], seen = new Set(), dupCount = 0;
        (rows || []).forEach(function(r) {
            var f = fp(r, keys);
            if (seen.has(f)) { dupCount++; return; }
            seen.add(f); out.push(Object.assign({}, r));
        });
        return { rows: out, dup: dupCount };
    }
    // ---------- 分层优先级去重：按 tiers 数组顺序（前=优先级更高）入队，遇到重复 key 自动丢弃低层行 ----------
    //   规则：tiers = [ {rows:[], label?:string}, ... ]，下标 0 优先级最高（先入 seen，低层撞 key 直接丢）
    //   返回：{ rows:[], dup: {label|'unknown': dupCount}, totalDup }
    function dedupByKeysTiered(tiers, keys) {
        var out = [];
        var seen = new Set();
        var dup = {};
        var totalDup = 0;
        (tiers || []).forEach(function(t) {
            if (!t || !Array.isArray(t.rows)) return;
            var lbl = t.label || 'unknown';
            t.rows.forEach(function(r) {
                if (!r || typeof r !== 'object') return;
                var f = fp(r, keys);
                if (seen.has(f)) {
                    totalDup++;
                    dup[lbl] = (dup[lbl] || 0) + 1;
                    return;
                }
                seen.add(f);
                out.push(Object.assign({}, r));
            });
        });
        return { rows: out, dup: dup, totalDup: totalDup, uniqueKeys: seen.size };
    }
    // ---------- 行级全字段签名 + 全局去重（解决用户：重复数据即所有字段都相同，不写入最终合并表）----------
    //   rowFullSignature: 按 fields 顺序，把行对应字段值（trim+空归一化）用 "\x1f" 分隔拼接，保证"字段顺序不同但值相同"不撞，"所有字段相同"签名一定相同
    //   ignoreKeys: 可选，跳过一些字段（比如变更备注 / 天眼查临时列）
    function rowFullSignature(row, fields, ignoreKeys) {
        if (!row || typeof row !== 'object') return '';
        var ign = null;
        if (Array.isArray(ignoreKeys) && ignoreKeys.length) {
            ign = new Set(ignoreKeys);
        } else if (ignoreKeys && typeof ignoreKeys === 'object') {
            ign = ignoreKeys instanceof Set ? ignoreKeys : new Set(Object.keys(ignoreKeys));
        }
        var parts = [];
        if (Array.isArray(fields) && fields.length) {
            for (var i = 0; i < fields.length; i++) {
                var f = fields[i];
                if (ign && ign.has(f)) continue;
                var v = row[f];
                if (v === undefined || v === null) { parts.push(''); continue; }
                var s = String(v).trim();
                parts.push(s);
            }
        } else {
            var keys = Object.keys(row);
            keys.sort();
            for (var j = 0; j < keys.length; j++) {
                var k = keys[j];
                if (ign && ign.has(k)) continue;
                var vv = row[k];
                if (vv === undefined || vv === null) { parts.push(''); continue; }
                parts.push(String(vv).trim());
            }
        }
        return parts.join('\x1f');
    }
    function dedupRowsFull(rows, fields, ignoreKeys) {
        var out = [];
        var seen = new Set();
        var dupCount = 0;
        (rows || []).forEach(function(r) {
            if (!r || typeof r !== 'object') return;
            var sig = rowFullSignature(r, fields, ignoreKeys);
            if (seen.has(sig)) { dupCount++; return; }
            seen.add(sig);
            out.push(r);
        });
        return { rows: out, dup: dupCount, unique: seen.size };
    }
    // ---------- 天眼查补全行提取工具：给定 rows + fields/headers，判断是否含天眼查后缀列，有就保留 ----------
    function extractTycRows(rows, fieldHint) {
        if (!Array.isArray(rows) || !rows.length) return [];
        // 优先用 fieldHint（fields/headers）判断，其次用 rows[0] 的 key 判断
        var hasSuffix = false;
        if (Array.isArray(fieldHint) && fieldHint.length) {
            hasSuffix = hasTyc(fieldHint);
        } else if (rows[0] && typeof rows[0] === 'object') {
            hasSuffix = hasTyc(Object.keys(rows[0]));
        }
        if (!hasSuffix) return [];
        return rows.filter(function(r) { return r && typeof r === 'object'; });
    }

    // ---------- 核心：自动识别表类型 ----------
    // 返回 { ok:true, type, label, confidence, notes, rows } 或 { ok:false, reason }
    function detectTableType(rawHeaders, rows) {
        var headers = uq((rawHeaders || []).map(function(h) { return String(h || '').trim(); }).filter(function(h) { return h !== ''; }));
        if (!headers.length) return { ok: false, reason: '表头为空，无法识别' };
        if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'CSV 没有数据行（仅有表头），至少需要 1 行数据才能识别' };
        if (headers.length < 3) return { ok: false, reason: '字段数过少（仅 ' + headers.length + ' 列），三类标准表最少列数：基本信息≥11列、施工许可≥21列、竣工验收≥11列，请检查表头字段名是否正确或是否存在多余空列' };

        var headSet = new Set(headers);
        var tyc = hasTyc(headers);
        var notes = [];
        if (tyc) notes.push('检测到天眼查补全后缀列（_社会信用代码 / _电话 / _法人 等），识别为「已补全」版本，后续合并时会原样保留所有补全列，不会裁剪');

        // 按类型逐个判定（fusion > complete > permit > basic）
        var scores = {};

        function matchRule(rule, type) {
            var mustMiss = (rule.must || []).filter(function(m) { return !headSet.has(m); });
            if (mustMiss.length) return { pass: false, miss: mustMiss };
            if (rule.forbid && rule.forbid.some(function(f) { return headSet.has(f); })) return { pass: false, forbid: true };
            var oneOfOk = true;
            if (rule.oneOf && rule.oneOf.length) oneOfOk = rule.oneOf.some(function(o) { return headSet.has(o); });
            if (!oneOfOk) return { pass: false, oneOfMiss: rule.oneOf };
            var bothOk = true;
            if (rule.both && rule.both.length) {
                bothOk = rule.both.every(function(group) { return group.some(function(o) { return headSet.has(o); }); });
            }
            if (!bothOk) return { pass: false, bothMiss: rule.both };
            // 计算匹配度（匹配 must/oneOf/both 的比例）
            var want = (rule.must || []).length + (rule.oneOf ? 1 : 0) + (rule.both ? rule.both.length : 0);
            var got  = (rule.must || []).filter(function(m) { return headSet.has(m); }).length + (oneOfOk ? 1 : 0) + (bothOk ? (rule.both || []).length : 0);
            var confidence = want ? Math.round(100 * got / want) : 50;
            // 额外加：标准字段命中比例加分
            var std = { basic: BASIC_FIELDS, permit: PERMIT_FIELDS, complete: COMPLETE_FIELDS };
            if (type === 'fusion') {
                var stdFusion = BASIC_FIELDS.concat(PERMIT_FIELDS);
                var hit = stdFusion.filter(function(f) { return headSet.has(f); }).length;
                confidence = Math.min(100, confidence + Math.round(60 * hit / stdFusion.length));
            } else if (std[type]) {
                var _hit = std[type].filter(function(f) { return headSet.has(f); }).length;
                confidence = Math.min(100, confidence + Math.round(40 * _hit / std[type].length));
            }
            return { pass: true, confidence: confidence };
        }

        // 1. fusion 先判
        var rFusion = matchRule(T_RULES.fusion, 'fusion');
        if (rFusion.pass) {
            // 二次核验：不允许 同时 有 complete 侧专属字段（forbid 已拦）+ 至少 basic 侧 3 个字段、permit 侧 5 个字段
            var basicHit = BASIC_FIELDS.filter(function(f) { return headSet.has(f); }).length;
            var permitHit = PERMIT_FIELDS.filter(function(f) { return headSet.has(f); }).length;
            if (basicHit < 3 || permitHit < 5) {
                scores.fusion = { pass: false, reason: 'fusion 命中但 basic 字段仅命中' + basicHit + '/≥3 且 permit 字段仅命中' + permitHit + '/≥5，更可能是独立的 basic 或 permit 单表' };
            } else {
                return { ok: true, type: 'fusion', label: T_RULES.fusion.label + (tyc ? '（含天眼查补全）' : ''),
                         confidence: rFusion.confidence, notes: notes, headers: headers };
            }
        }
        // 2. complete
        var rComplete = matchRule(T_RULES.complete, 'complete');
        if (rComplete.pass) {
            return { ok: true, type: 'complete', label: T_RULES.complete.label + (tyc ? '（含天眼查补全）' : ''),
                     confidence: rComplete.confidence, notes: notes, headers: headers };
        }
        // 3. permit（含天眼查补全施工许可表）
        var rPermit = matchRule(T_RULES.permit, 'permit');
        if (rPermit.pass) {
            var labelPermit = T_RULES.permit.label;
            if (tyc) {
                // 进一步判断：是不是「天眼查补全施工许可表」（主特征：列数明显 ≥ 标准 PERMIT_FIELDS.length + 且包含 ≥ 1 个 建设单位_社会信用代码 等）
                labelPermit = '天眼查补全施工许可表';
            }
            return { ok: true, type: 'permit', label: labelPermit, confidence: rPermit.confidence, notes: notes, headers: headers };
        }
        // 4. basic
        var rBasic = matchRule(T_RULES.basic, 'basic');
        if (rBasic.pass) {
            return { ok: true, type: 'basic', label: T_RULES.basic.label + (tyc ? '（含天眼查补全）' : ''),
                     confidence: rBasic.confidence, notes: notes, headers: headers };
        }

        // ====== 识别失败：给出具体原因 ======
        var reasons = [];
        // 列数诊断
        reasons.push('【列数】当前 CSV 共 ' + headers.length + ' 列；标准列数参考：基本信息 ' + BASIC_FIELDS.length + ' 列 / 施工许可 ' + PERMIT_FIELDS.length + ' 列 / 竣工验收 ' + COMPLETE_FIELDS.length + ' 列（融合表≥' + (BASIC_FIELDS.length + 8) + ' 列）');
        // must 缺失诊断
        ['basic', 'permit', 'complete'].forEach(function(t) {
            var rule = T_RULES[t];
            var missM = (rule.must || []).filter(function(m) { return !headSet.has(m); });
            if (missM.length) reasons.push('【' + rule.label + '】必填关键字段缺失：' + missM.join('、'));
        });
        // forbid 冲突
        ['basic', 'permit', 'complete'].forEach(function(t) {
            var rule = T_RULES[t];
            var hasF = (rule.forbid || []).filter(function(f) { return headSet.has(f); });
            if (hasF.length) reasons.push('【' + rule.label + '】包含禁止字段（表明它更可能是其他类型）：' + hasF.join('、'));
        });
        // 疑似字段名错误：提示「近似但不相等」的常见错写
        var allStd = BASIC_FIELDS.concat(PERMIT_FIELDS).concat(COMPLETE_FIELDS);
        var maybe = [];
        headers.forEach(function(h) {
            if (!h) return;
            if (allStd.indexOf(h) >= 0) return;
            // 简单近似：长度差≤2 & 含 编号/名称/单位/日期/时间 等关键字
            allStd.forEach(function(s) {
                if (Math.abs(s.length - h.length) <= 2 && (s.indexOf(h) >= 0 || h.indexOf(s) >= 0 ||
                    (/\d/.test(h) && /\d/.test(s) && h.replace(/\d+/g, '') === s.replace(/\d+/g, '')))) {
                    maybe.push('CSV 表头 "' + h + '" 疑似想写标准字段 "' + s + '"');
                }
            });
        });
        if (maybe.length) reasons.push('【疑似字段名错误】' + uq(maybe).slice(0, 8).join('；') + (maybe.length > 8 ? '（还有 ' + (maybe.length - 8) + ' 条未显示）' : ''));
        reasons.push('当前 CSV 表头：' + headers.join(' | '));
        return { ok: false, reason: reasons.join('\n') };
    }

    // ---------- 融合表拆分：一份 fusion rows → basic 侧 1:N 展开前的 basicRows + permitRows ----------
    function splitFusion(rows, headers) {
        // 基本思路：按「行粒度」拆成两条 —— 只要该行有 basic 侧字段就当 basic，有 permit 侧就当 permit
        var basicKeys = BASIC_FIELDS.slice();
        var permitKeys = PERMIT_FIELDS.slice();
        var basicOut = [], permitOut = [];
        (rows || []).forEach(function(r) {
            var bRow = {}, pRow = {}, hasB = false, hasP = false;
            Object.keys(r).forEach(function(k) {
                if (basicKeys.indexOf(k) >= 0) { bRow[k] = r[k]; hasB = true; }
                else if (permitKeys.indexOf(k) >= 0) { pRow[k] = r[k]; hasP = true; }
                else {
                    // 天眼查补全列或自定义列：两端都塞（防止拆分后丢失）
                    bRow[k] = r[k]; pRow[k] = r[k];
                }
            });
            // 保证外键同步
            var code = r['省级项目编号'] || '';
            var name = r['工程名称'] || r['项目名称'] || '';
            if (hasB && code) { if (!bRow['项目名称']) bRow['项目名称'] = name || ''; basicOut.push(bRow); }
            if (hasP && (code || name)) { if (!pRow['项目名称']) pRow['项目名称'] = name || ''; permitOut.push(pRow); }
        });
        return { basic: basicOut, permit: permitOut };
    }

    // ============================================================
    // ===== window.__mergeAPI 对外接口（严格按需求：无兜底，失败返回详细原因）
    // ============================================================
    window.__mergeAPI = {
        _state: _state,

        // 同步 3 个 Tab 的 currentData 查询结果
        syncCurrentData: function() {
            try {
                ['basic', 'permit', 'complete'].forEach(function(t) {
                    _state.queried[t] = Array.isArray(currentData[t]) ? currentData[t].slice() : [];
                });
                // ============================================================
                // ✅ 同步天眼查补全行到 _state.queried.tyc（供合并导出 checkbox 使用）
                //   识别规则：如果 rows 里/fields 里含「社会信用代码 / 电话 / 法人 / 地址 / 成立日期」5 种天眼查后缀列 → 视为天眼查补全后的行
                //   分类：
                //      tyc.basic = currentData.basic 带天眼查后缀的行
                //      tyc.permit = currentData.permit 带天眼查后缀的行
                //      tyc.complete = currentData.complete 带天眼查后缀的行
                //      tyc.permitBasicMerge = (currentData.permitBasicMerge.rows 优先) 或 (currentData.merge) 带天眼查后缀的合并表行
                // ============================================================
                if (!_state.queried.tyc || typeof _state.queried.tyc !== 'object') _state.queried.tyc = { basic: [], permit: [], complete: [], permitBasicMerge: [] };
                _state.queried.tyc.basic = extractTycRows(_state.queried.basic, null);
                _state.queried.tyc.permit = extractTycRows(_state.queried.permit, null);
                _state.queried.tyc.complete = extractTycRows(_state.queried.complete, null);
                _state.queried.tyc.permitBasicMerge = [];
                if (currentData && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows)) {
                    _state.queried.tyc.permitBasicMerge = extractTycRows(currentData.permitBasicMerge.rows, currentData.permitBasicMerge.fields);
                }
                // 兜底：currentData.merge 里也可能有天眼查补全（合并导出 Tab 之前生成过合并表，再天眼查补全 target=merge 的场景），合并进 permitBasicMerge（去重前）
                if (!_state.queried.tyc.permitBasicMerge.length && Array.isArray(currentData.merge) && currentData.merge.length) {
                    _state.queried.tyc.permitBasicMerge = extractTycRows(currentData.merge, currentData.mergeFields || null);
                }
                return Promise.resolve({ ok: true, queried: _state.queried });
            } catch (e) { return Promise.reject(new Error('同步查询数据失败：' + String(e.message || e))); }
        },

        // 上传 CSV（File 对象，返回解析结果）
        _parseCSVFile: function(file) {
            return new Promise(function(res, rej) {
                try {
                    if (!file) return rej(new Error('文件为空'));
                    var reader = new FileReader();
                    reader.onload = function(ev) {
                        try {
                            var text = (ev && ev.target && ev.target.result) ? String(ev.target.result) : '';
                            var rows = parseCSV(text);
                            if (!rows || rows.length === 0) return rej(new Error('CSV 无数据行'));
                            var headers = Object.keys(rows[0] || {});
                            res({ rows: rows, headers: headers, file: file.name || '' });
                        } catch (eInner) { rej(new Error('解析失败：' + String(eInner.message || eInner))); }
                    };
                    reader.onerror = function() { rej(new Error('文件读取失败（IO）')); };
                    reader.readAsText(file, 'utf-8');
                } catch (e) { rej(new Error('读取异常：' + String(e.message || e))); }
            });
        },

        // 上传主表（只能一份；会覆盖之前的主表）
        uploadMaster: function(file) {
            var self = this;
            return this._parseCSVFile(file).then(function(d) {
                if (!d.headers.length) throw new Error('主表表头为空');
                // 主表不强制识别类型，但至少要有一个外键字段
                var fk = ['省级项目编号', '工程名称', '项目名称'].filter(function(k) { return d.headers.indexOf(k) >= 0; });
                if (fk.length === 0) throw new Error('主表缺少必要的外键列（至少包含「省级项目编号」「工程名称」「项目名称」三选一，否则无法匹配三表行）。\n当前主表表头：' + d.headers.join(' | '));
                if (!d.rows.length) throw new Error('主表没有数据行，无法作为合并基准');
                // 尝试识别（失败也不拒，只是备注 masterDetectedAs=null）
                var det = detectTableType(d.headers, d.rows);
                _state.master = {
                    file: d.file, rows: d.rows.slice(), fields: d.headers.slice(),
                    detectedAs: det.ok ? det.type : null, detectedLabel: det.ok ? det.label : '(未识别为标准三表类型，按自定义主表处理)'
                };
                return { ok: true, master: _state.master, note: det.ok ? ('主表被识别为：' + det.label + '，可信度 ' + det.confidence + '%') : ('主表未命中标准三表类型，按「自定义主表」处理（保留所有列 + 以外键匹配三表）') };
            });
        },

        // 批量上传：一次 files（FileList 或 array），每个文件自动识别类型，成功进入 batches，失败进入 errors
        uploadMulti: function(files) {
            var self = this;
            var arr = [];
            for (var i = 0; files && i < files.length; i++) arr.push(files[i]);
            if (!arr.length) return Promise.reject(new Error('未选择任何文件'));
            var errs = [];
            var oks = [];
            var todo = arr.slice();
            function next() {
                if (!todo.length) {
                    oks.forEach(function(ok) { _state.batches.push(ok); });
                    errs.forEach(function(er) { _state.errors.push(er); });
                    return Promise.resolve({
                        ok: true,
                        success: oks,
                        failed: errs,
                        total: arr.length
                    });
                }
                var f = todo.shift();
                return self._parseCSVFile(f).then(function(d) {
                    var det = detectTableType(d.headers, d.rows);
                    if (!det.ok) { errs.push({ file: d.file, reason: det.reason }); return next(); }
                    var batchId = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
                    var b = {
                        batchId: batchId, file: d.file, type: det.type, label: det.label,
                        rows: d.rows.slice(), fields: d.headers.slice(),
                        confidence: det.confidence, notes: det.notes || []
                    };
                    oks.push(b);
                    return next();
                }).catch(function(err) {
                    errs.push({ file: f ? (f.name || '未知文件.csv') : '未知文件.csv', reason: String(err.message || err) });
                    return next();
                });
            }
            return next();
        },

        // ✅ 新功能：删除主表（用户要求"可以单独删除上传的主表"）
        removeMaster: function() {
            try {
                _state.master = null;
                var i = safeGetElement('merge-master-file'); if (i) i.value = '';
                return { ok: true };
            } catch (e) { return { ok: false, error: String(e.message || e) }; }
        },

        // ✅ 新功能：批量删除指定 batchIds（"删除选中的"；单条删除也调这个传 [batchId]）
        removeBatches: function(batchIds) {
            try {
                var set = new Set();
                if (Array.isArray(batchIds)) batchIds.forEach(function(id) { if (id) set.add(String(id)); });
                var before = (_state.batches || []).length;
                _state.batches = (_state.batches || []).filter(function(b) { return !set.has(String(b.batchId)); });
                var removed = before - _state.batches.length;
                return { ok: true, removed: removed, remaining: _state.batches.length };
            } catch (e) { return { ok: false, error: String(e.message || e), removed: 0, remaining: 0 }; }
        },

        // ================= 核心：生成合并表 =================
        generate: function(opts) {
            var options = opts || {};
            try {
                var keepUnmatched = String(options.keepUnmatchedMaster) !== '0' && options.keepUnmatchedMaster !== false;
                // ✅ UI 4 个 checkbox：优先从 opts.srcEnabled 取（外部调用传参），否则读 UI 实时勾选状态，再否则 fall back _state.srcEnabled
                var enabled = { basic: true, permit: true, complete: true, tyc: true };
                if (options.srcEnabled && typeof options.srcEnabled === 'object') {
                    ['basic', 'permit', 'complete', 'tyc'].forEach(function(k) { if (options.srcEnabled[k] !== undefined) enabled[k] = !!options.srcEnabled[k]; });
                } else {
                    try {
                        ['basic', 'permit', 'complete', 'tyc'].forEach(function(k) {
                            var cb = document.getElementById('merge-src-' + k);
                            if (cb) enabled[k] = !!cb.checked;
                        });
                    } catch (_eCb) {}
                }
                Object.assign(_state.srcEnabled, enabled);

                // ============================================================
                // ✅ 需求 3 条优先级规则（分层优先级 tiers 数组，下标 0 优先级最高）：
                //
                //   规则 B（最高优先）：施工许可里的纯 permit 数据 vs 施工许可里的合并表（permitBasicMerge / permitBasicMerge 天眼查补全版）重复 → 合并表优先（因为已经合并了，字段更全）
                //   规则 A：basic/complete ↔ 天眼查补全数据重复 → 天眼查补全数据优先（因为数据更全，带社会信用代码/电话/法人/地址/成立日期）
                //   规则 fallback： queried 三表纯数据 > 上传 CSV
                //
                //   tiers 的下标数字越小优先级越高，dedupByKeysTiered 先入 seen，低层重复行直接丢弃（保留高优先级行）
                // ============================================================

                // ---- Step A. 从上传 batches 拆出 basic/permit/complete 三类原始上传行（fusion 拆两份） ----
                var uploadedRaw = { basic: [], permit: [], complete: [] };
                var uploadedCount = { basic: 0, permit: 0, complete: 0, fusion: 0 };
                (_state.batches || []).forEach(function(b) {
                    if (!b || !b.type) return;
                    if (b.type === 'fusion') {
                        var sp = splitFusion(b.rows, b.fields);
                        uploadedRaw.basic = uploadedRaw.basic.concat(sp.basic);
                        uploadedRaw.permit = uploadedRaw.permit.concat(sp.permit);
                        uploadedCount.fusion++;
                    } else if (uploadedRaw[b.type]) {
                        uploadedRaw[b.type] = uploadedRaw[b.type].concat(b.rows);
                        uploadedCount[b.type]++;
                    }
                });

                // ---- Step B. permitBasicMerge 特殊处理（需求规则 B：合并表比纯 permit 优先） ----
                //   permitBasicMerge（施工许可 Tab「🔗 提取合并表」得到的 基本信息+施工许可 融合表，可能带/不带天眼查补全）
                //   拆分成两部分：
                //      permitBasicMerge.basic = 每行里挑 BASIC_FIELDS 里存在的字段 + 天眼查「建设单位_」前缀列
                //      permitBasicMerge.permit = 每行里挑 PERMIT_FIELDS 里存在的字段（冲突列优先取「许可_」前缀）+ 天眼查 5 类许可侧单位列前缀（许可_工程总承包单位_社会信用代码 等）
                var pbm = null;  // { rows:[], fields:[] }
                var pbmTiersBasicRows = [];   // 拆出的 basic 部分 → 进 basic 的 P0
                var pbmTiersPermitRows = [];  // 拆出的 permit 部分 → 进 permit 的 P0
                try {
                    if (currentData && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows) && currentData.permitBasicMerge.rows.length) {
                        pbm = { rows: currentData.permitBasicMerge.rows.slice(), fields: (Array.isArray(currentData.permitBasicMerge.fields) ? currentData.permitBasicMerge.fields.slice() : null) };
                    } else if (
                        // ✅🔴 根因修复（第二次/第三次生成条数虚高 10→30→40 膨胀）：
                        //   旧兜底：只要 currentData.merge 带 许可_建设单位 就当 pbm 拆 basic/permit 当 P0 入队 → 但合并导出 Tab 自己生成合并表后，
                        //         会写入 currentData.merge = mergedRows（包含 basic+permit+complete 所有字段 + 变更备注），下一次生成再拆回去 → 回环累加！
                        //   修复：currentData.merge 是合并导出自己生成的（标记 __lastMergeFromMergeExport = true）时，跳过兜底，不允许当 pbm 输入
                        Array.isArray(currentData.merge) && currentData.merge.length
                        && Array.isArray(currentData.mergeFields) && currentData.mergeFields.length
                        && (currentData.__lastMergeFromMergeExport !== true)
                    ) {
                        var hasLabs = (currentData.mergeFields || []).some(function(f) { return f === '许可_建设单位'; });
                        if (hasLabs) pbm = { rows: currentData.merge.slice(), fields: currentData.mergeFields.slice() };
                    }
                } catch (_ePbm) { pbm = null; }
                if (pbm && pbm.rows && pbm.rows.length) {
                    var basicSet = new Set(BASIC_FIELDS || []);
                    var permitSet = new Set(PERMIT_FIELDS || []);
                    var dupStdSet = new Set();
                    BASIC_FIELDS.forEach(function(f) { if (permitSet.has(f) || (COMPLETE_FIELDS || []).indexOf(f) >= 0) dupStdSet.add(f); });
                    PERMIT_FIELDS.forEach(function(f) { if ((COMPLETE_FIELDS || []).indexOf(f) >= 0) dupStdSet.add(f); });
                    pbm.rows.forEach(function(row) {
                        if (!row || typeof row !== 'object') return;
                        // permitBasicMerge → basic 部分（P0 最高优先级）
                        var bRow = {};
                        BASIC_FIELDS.forEach(function(f) { if (row[f] !== undefined) bRow[f] = row[f]; });
                        // 天眼查补全里「建设单位_」前缀的列，是 basic 侧建设单位的补全信息，一起进 pbm basic
                        Object.keys(row).forEach(function(k) {
                            if (typeof k === 'string' && k.indexOf('建设单位_') === 0) bRow[k] = row[k];
                        });
                        // 如果拆出的 basic 部分至少带省级项目编号才算有效（否则丢掉，避免空 basic 占坑）
                        if (norm(bRow['省级项目编号']) || norm(bRow['项目名称'])) pbmTiersBasicRows.push(bRow);
                        // permitBasicMerge → permit 部分（P0 最高优先级）
                        var pRow = {};
                        PERMIT_FIELDS.forEach(function(f) {
                            if (['省级项目编号', '项目名称', '工程名称'].indexOf(f) >= 0) {
                                if (row[f] !== undefined) pRow[f] = row[f];
                                return;
                            }
                            if (dupStdSet.has(f)) {
                                // 冲突列优先取「许可_」前缀列（用户明确说合并表里冲突字段用 许可_ 列名）
                                var kPre = '许可_' + f;
                                if (row[kPre] !== undefined) pRow[f] = row[kPre];
                                else if (row[f] !== undefined) pRow[f] = row[f];
                            } else {
                                if (row[f] !== undefined) pRow[f] = row[f];
                            }
                        });
                        // 天眼查补全里「许可_工程总承包单位_ / 许可_勘察单位_ / ...」→ 因为 unitCols.merge 已改成「建设单位」加许可_ 前缀，其余 5 类单位用纯列名
                        // 但为了兼容旧写法（如果用户之前合并表里确实有「许可_工程总承包单位_社会信用代码」这种旧列）也一并搬过来
                        Object.keys(row).forEach(function(k) {
                            if (typeof k !== 'string') return;
                            var isPermitTyc = false;
                            if (k.indexOf('工程总承包单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('勘察单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('设计单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('施工单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('监理单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('许可_工程总承包单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('许可_勘察单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('许可_设计单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('许可_施工单位_') === 0) isPermitTyc = true;
                            else if (k.indexOf('许可_监理单位_') === 0) isPermitTyc = true;
                            if (isPermitTyc) pRow[k] = row[k];
                        });
                        // 至少带外键才算有效 permit 行
                        if (norm(pRow['省级项目编号']) || norm(pRow['施工许可证编号']) || norm(pRow['工程名称'])) pbmTiersPermitRows.push(pRow);
                    });
                }

                // ---- Step C. 为 basic / permit / complete 三表分别构建分层 tiers → 去重得到 source ----
                var tyc = (_state.queried && _state.queried.tyc) ? _state.queried.tyc : { basic: [], permit: [], complete: [], permitBasicMerge: [] };
                // tyc.permitBasicMerge = 天眼查补全 target=merge 后得到的「施工许可合并表 + 天眼查补全字段」的行（100% 带天眼查补全，用户明确选中要用）
                // 🔴✅ 优先级必须比「未补全的 currentData.permitBasicMerge」更高！
                //     dedupByKeysTiered 是"先入 seen，先入的保留"，所以我们必须把 tyc.permitBasicMerge 拆出来的行放 pbmTiersXXXRows 最前面，去重时优先保留带天眼查补全的行
                if (Array.isArray(tyc.permitBasicMerge) && tyc.permitBasicMerge.length) {
                    var _tycBasicRows = [];   // 带天眼查的合并表 → 拆 basic 部分（放最前）
                    var _tycPermitRows = [];  // 带天眼查的合并表 → 拆 permit 部分（放最前）
                    var dupStdSet2 = new Set();
                    BASIC_FIELDS.forEach(function(f) { if (PERMIT_FIELDS.indexOf(f) >= 0 || (COMPLETE_FIELDS || []).indexOf(f) >= 0) dupStdSet2.add(f); });
                    PERMIT_FIELDS.forEach(function(f) { if ((COMPLETE_FIELDS || []).indexOf(f) >= 0) dupStdSet2.add(f); });
                    tyc.permitBasicMerge.forEach(function(row) {
                        if (!row || typeof row !== 'object') return;
                        var bRow = {};
                        BASIC_FIELDS.forEach(function(f) { if (row[f] !== undefined) bRow[f] = row[f]; });
                        Object.keys(row).forEach(function(k) { if (typeof k === 'string' && k.indexOf('建设单位_') === 0) bRow[k] = row[k]; });
                        if (norm(bRow['省级项目编号']) || norm(bRow['项目名称'])) _tycBasicRows.push(bRow);
                        var pRow = {};
                        PERMIT_FIELDS.forEach(function(f) {
                            if (['省级项目编号', '项目名称', '工程名称'].indexOf(f) >= 0) { if (row[f] !== undefined) pRow[f] = row[f]; return; }
                            if (dupStdSet2.has(f)) { var kPre = '许可_' + f; if (row[kPre] !== undefined) pRow[f] = row[kPre]; else if (row[f] !== undefined) pRow[f] = row[f]; }
                            else if (row[f] !== undefined) pRow[f] = row[f];
                        });
                        Object.keys(row).forEach(function(k) {
                            if (typeof k !== 'string') return;
                            var isPermitTyc = (k.indexOf('工程总承包单位_') === 0) || (k.indexOf('勘察单位_') === 0) || (k.indexOf('设计单位_') === 0) || (k.indexOf('施工单位_') === 0) || (k.indexOf('监理单位_') === 0)
                                || (k.indexOf('许可_工程总承包单位_') === 0) || (k.indexOf('许可_勘察单位_') === 0) || (k.indexOf('许可_设计单位_') === 0) || (k.indexOf('许可_施工单位_') === 0) || (k.indexOf('许可_监理单位_') === 0);
                            if (isPermitTyc) pRow[k] = row[k];
                        });
                        if (norm(pRow['省级项目编号']) || norm(pRow['施工许可证编号']) || norm(pRow['工程名称'])) _tycPermitRows.push(pRow);
                    });
                    // ✅ 头插！合并：带天眼查补全的（更全）优先 → 未补全旧 pbm 行在后 → dedup 保留更全的
                    pbmTiersBasicRows   = _tycBasicRows.concat(pbmTiersBasicRows || []);
                    pbmTiersPermitRows  = _tycPermitRows.concat(pbmTiersPermitRows || []);
                }

                var source = { basic: [], permit: [], complete: [] };
                var dedupStat = {};
                // ========= basic 分层 tiers =========
                var basicTiers = [];
                if (enabled.basic || enabled.tyc) {
                    // ✅ P0（规则 B 最高优先）：permitBasicMerge / tyc.permitBasicMerge 拆出的 basic 行
                    //      → 本质是「用户显式点了施工许可合并表 或 天眼查补全了合并表」得到的，不属于三表 checkbox 管辖的纯 basic/permit/complete 数据
                    //      → 只要 外层 if（basic 或 tyc 任一勾选）成立 就入队，不能再受 enabled.basic gate 限制（否则用户只勾天眼查补全时 P0 全被丢弃！）
                    basicTiers.push({ rows: pbmTiersBasicRows, label: 'pbm.basic(P0)' });
                    if (enabled.tyc)   basicTiers.push({ rows: tyc.basic || [], label: 'tyc.basic(P1)' });  // P1 规则 A 天眼查补全的 basic
                    if (enabled.basic) basicTiers.push({ rows: _state.queried.basic || [], label: 'queried.basic(P2)' }); // P2 三 Tab 纯查询的 basic
                    if (enabled.basic) basicTiers.push({ rows: uploadedRaw.basic, label: 'uploaded.basic(P3)' }); // P3 上传的 basic
                }
                var basicTiersDedup = dedupByKeysTiered(basicTiers, DEDUP.basic || ['省级项目编号']);
                source.basic = basicTiersDedup.rows;
                dedupStat.basic = {
                    raw: basicTiers.reduce(function(s, t) { return s + (t.rows ? t.rows.length : 0); }, 0),
                    after: basicTiersDedup.rows.length, dup: basicTiersDedup.totalDup, perTierDup: basicTiersDedup.dup
                };

                // ========= permit 分层 tiers =========
                var permitTiers = [];
                if (enabled.permit || enabled.tyc) {
                    // ✅ P0（规则 B 最高优先）：permitBasicMerge / tyc.permitBasicMerge 拆出的 permit 行
                    //      → 同上：只要外层 if（permit 或 tyc 任一勾选）成立就入队，不能再受 enabled.permit gate 限制
                    permitTiers.push({ rows: pbmTiersPermitRows, label: 'pbm.permit(P0)' });
                    if (enabled.tyc)    permitTiers.push({ rows: tyc.permit || [], label: 'tyc.permit(P1)' });  // P1 规则 A 天眼查补全的 permit
                    if (enabled.permit) permitTiers.push({ rows: _state.queried.permit || [], label: 'queried.permit(P2)' }); // P2 纯查询 permit
                    if (enabled.permit) permitTiers.push({ rows: uploadedRaw.permit, label: 'uploaded.permit(P3)' }); // P3 上传 permit
                }
                var permitTiersDedup = dedupByKeysTiered(permitTiers, DEDUP.permit || ['省级项目编号', '工程名称', '施工许可证编号']);
                source.permit = permitTiersDedup.rows;
                dedupStat.permit = {
                    raw: permitTiers.reduce(function(s, t) { return s + (t.rows ? t.rows.length : 0); }, 0),
                    after: permitTiersDedup.rows.length, dup: permitTiersDedup.totalDup, perTierDup: permitTiersDedup.dup
                };

                // ========= complete 分层 tiers =========
                var completeTiers = [];
                if (enabled.complete || enabled.tyc) {
                    if (enabled.tyc)      completeTiers.push({ rows: tyc.complete || [], label: 'tyc.complete(P1)' }); // P1 规则 A 天眼查补全的 complete
                    if (enabled.complete) completeTiers.push({ rows: _state.queried.complete || [], label: 'queried.complete(P2)' }); // P2 纯查询 complete
                    if (enabled.complete) completeTiers.push({ rows: uploadedRaw.complete, label: 'uploaded.complete(P3)' }); // P3 上传 complete
                }
                var completeTiersDedup = dedupByKeysTiered(completeTiers, DEDUP.complete || ['省级项目编号', '工程名称', '省级竣工验收备案编号', '竣工验收备案编号']);
                source.complete = completeTiersDedup.rows;
                dedupStat.complete = {
                    raw: completeTiers.reduce(function(s, t) { return s + (t.rows ? t.rows.length : 0); }, 0),
                    after: completeTiersDedup.rows.length, dup: completeTiersDedup.totalDup, perTierDup: completeTiersDedup.dup
                };

                // 保存 enabled 状态（供刷新显示）
                dedupStat.srcEnabled = Object.assign({}, enabled);

                // 2. 建索引
                // basic 索引：Map<code, basicRow>（basic 省级项目编号唯一）
                var basicByCode = new Map();
                (source.basic || []).forEach(function(r) {
                    var c = norm(r['省级项目编号']);
                    if (!c) return;
                    if (!basicByCode.has(c)) basicByCode.set(c, r);
                });
                // permit 索引：Map<code, permitRows[]>（1:N）
                var permitsByCode = new Map();
                // permit 额外索引：Map<工程名称, permitRow>（用于 complete 一对一匹配）
                var permitByName = new Map();
                (source.permit || []).forEach(function(r) {
                    var c = norm(r['省级项目编号']);
                    var n = norm(r['工程名称']);
                    if (c) {
                        var arr = permitsByCode.get(c) || [];
                        arr.push(r); permitsByCode.set(c, arr);
                    }
                    if (n && !permitByName.has(n)) permitByName.set(n, r); // 同名工程只保留第一条
                });
                // complete 索引：Map<工程名称, completeRow>（一对一）
                var completeByName = new Map();
                (source.complete || []).forEach(function(r) {
                    var n = norm(r['工程名称']);
                    if (!n) return;
                    if (!completeByName.has(n)) completeByName.set(n, r);
                });

                // 3. 决定输出行顺序 & 字段顺序
                var mergedRows = [];
                var mergedFields = [];
                var addedField = new Set();
                function pushF(name) { if (!addedField.has(name)) { addedField.add(name); mergedFields.push(name); } }
                var masterRows = null;
                var masterFields = null;
                if (_state.master && _state.master.rows && _state.master.rows.length) {
                    masterRows = _state.master.rows; masterFields = _state.master.fields;
                }
                // 字段顺序：
                //   A. 若有主表：masterFields 全部 → 外键列优先；
                //   B. 三表标准字段（basic + permit + complete）→ 重名加前缀；
                //   C. 天眼查补全后缀列：按「单位角色 → 5个标准后缀列」锚定插入到对应基础单位列后面（不再丢到末尾）
                //   D. 剩余自定义列
                //   E. 变更备注（接口占位）
                if (masterFields) masterFields.forEach(pushF);
                var dupStd = new Set();
                // ✅ 计算 三表重名字段（basic 侧不重名直接出；permit 侧重名加「许可_」前缀；complete 侧重名加「竣工_」前缀）
                BASIC_FIELDS.forEach(function(f) {
                    if (PERMIT_FIELDS.indexOf(f) >= 0 || COMPLETE_FIELDS.indexOf(f) >= 0) dupStd.add(f);
                });
                PERMIT_FIELDS.forEach(function(f) {
                    if (COMPLETE_FIELDS.indexOf(f) >= 0) dupStd.add(f);
                });
                // ✅ 不再预先 push 3 个外键列！严格按 BASIC_FIELDS 原始顺序（项目名称 第 1、省级项目编号 第 2 → 用户明确要求）
                BASIC_FIELDS.forEach(function(f) { pushF(f); });
                // ✅ permit 段：跳过「省级项目编号」（basic 段已有，1 列足够）；「工程名称」保留，是 permit 段第 1 列（用户明确要求）
                PERMIT_FIELDS.forEach(function(f) {
                    if (f === '省级项目编号') return;
                    pushF(dupStd.has(f) ? ('许可_' + f) : f);
                });
                // ✅ complete 段：跳过「工程名称」「省级项目编号」（basic 段已有）；用户指定的顺序：省级竣工验收备案编号 → 竣工验收备案编号 → 备案机关 → ... → 竣工_数据等级
                COMPLETE_FIELDS.forEach(function(f) {
                    if (f === '省级项目编号' || f === '工程名称') return;
                    pushF(dupStd.has(f) ? ('竣工_' + f) : f);
                });
                // ✅ 调用公共函数：天眼查补全后缀列 → 锚定插入到对应基础单位列后面 + 过滤 _匹配单位名列
                //   allColsSource 传「masterRows + source.basic/permit/complete 四组 rows」，公共函数会自动扫 keys
                (function() {
                    var allRows = [];
                    if (masterRows) allRows = allRows.concat(masterRows);
                    allRows = allRows.concat(source.basic || []).concat(source.permit || []).concat(source.complete || []);
                    var ans = anchorInsertTycColumnsIntoFields(mergedFields, addedField, allRows, { appendCustomColsAtEnd: true });
                    mergedFields = ans.fields;
                    addedField = ans.addedSet;
                })();
                pushF('变更备注');

                // ✅🔴 根因修复（第一次生成合并表时，变更备注后多出：省级施工许可证编号/建设单位组织机构代码/...等 9 个旧遗留字段，第二次点才消失）
                //   根因：上传的合并表 CSV 里带了旧版本遗留列（黑名单里的字段）→ 它们不在 BASIC/PERMIT/COMPLETE 标准集合、不在天眼查补全后缀列，
                //         被 anchorInsertTycColumnsIntoFields(appendCustomColsAtEnd: true) 扫到并追加到变更备注后面；第二次生成时 masterRows 变成标准列就没了。
                //   修复 3 层硬拦截（保证第一次/第二次结果永远一致）：
                //     【第 1 层】mergedFields 构造完（列头）→ 立刻从列头 + addedField 剔除黑名单字段
                //     【第 2 层】写 out 行数据时（模式1/2 末尾）→ 从 out 对象删除黑名单 key（即使 masterRows 里有数据也不会写入最终行）
                //     【第 3 层】保存 _state.last 前 → 再对 mergedFields 做一次兜底过滤
                //   黑名单和 inferOriginalFields 里的 DETAIL_GARBAGE_BLACKLIST 保持完全一致（省级施工许可证编号、发证日期等 20 个旧版本"详情独有垃圾字段"）
                // ✅🔴 再追加 10 个新识别的旧版本遗留字段（备案日期、建筑面积平方米类、建设地点省市区县类、项目审批级别、报送单位）→ 用户报告"第一次点生成出现，第二次消失"
                var MERGE_EXPORT_BLACKLIST_FIELDS = new Set([
                    '省级施工许可证编号', '建设单位组织机构代码', '施工单位组织机构代码', '勘察单位组织机构代码', '设计单位组织机构代码', '监理单位组织机构代码',
                    '结构体系', '合同价格（万元）', '合同金额', '合同面积（平方米）', '合同面积', '合同开工日期', '合同竣工日期', '发证日期',
                    '项目分类', '建设规模文本', '合同工期天数', '监理资质', '施工资质', '设计资质', '勘察资质', '工程总承包资质',
                    '中标通知书编号', '中标金额', '招标方式', '资金来源', '建设规模明细', '建设性质明细',
                    '备案日期', '建筑面积（平方米）', '建设规模及内容', '占地面积（平方米）', '建设地点省', '建设地点市', '建设地点区县', '建设地点', '项目审批级别', '报送单位'
                ]);
                // 第 1 层：列头过滤（从 mergedFields 里删掉黑名单字段，同时从 addedField 里删掉 → 避免后续 pushF 时判断已 added 出错）
                (function() {
                    var newFields = [];
                    for (var _fbi = 0; _fbi < mergedFields.length; _fbi++) {
                        var _fname = mergedFields[_fbi];
                        if (MERGE_EXPORT_BLACKLIST_FIELDS.has(_fname)) {
                            addedField.delete(_fname);
                            continue;
                        }
                        newFields.push(_fname);
                    }
                    mergedFields = newFields;
                })();
                var _mergedFieldsSet = new Set(Array.isArray(mergedFields) ? mergedFields : []);
                // ✅ 变更备注 3 条规则 公共工具函数（顺序必须放在最前！因为 _noteSegment 里会调用 _fmtNoteDate，后面所有变更备注逻辑都依赖它们）
                function _fmtNoteDate(d) {
                    var dt = d instanceof Date ? d : new Date();
                    function p2(n) { return (n < 10 ? '0' : '') + n; }
                    return dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()) + ' ' + p2(dt.getHours()) + ':' + p2(dt.getMinutes());
                }
                function _noteParseMaxSeq(text) {
                    if (!text || typeof text !== 'string') return 0;
                    var maxSeq = 0;
                    var reg = /(?:^|[；;\n\r])\s*(\d+)\s*[、.,．]/g;
                    var m = null;
                    while ((m = reg.exec(text)) !== null) {
                        var s = parseInt(m[1], 10);
                        if (!isNaN(s) && s > maxSeq) maxSeq = s;
                    }
                    return maxSeq;
                }
                function _noteRenumberSegments(text, startSeq) {
                    if (!text || typeof text !== 'string') return { nextSeq: Number(startSeq) || 1, text: '' };
                    var s0 = Number(startSeq) || 1;
                    var curSeq = s0;
                    function replacer(match, lead, digits, sep) {
                        var n = curSeq++;
                        return (lead || '') + String(n) + (sep || '、');
                    }
                    var newText = text.replace(/(^|[；;\n\r]\s*)(\d+)\s*([、.,．])/g, replacer);
                    return { nextSeq: curSeq, text: newText };
                }
                function _noteCollectAddedFields(beforeObj, afterObj, mergedFieldsSet) {
                    var list = [];
                    if (!beforeObj || !afterObj || typeof beforeObj !== 'object' || typeof afterObj !== 'object') return list;
                    Object.keys(afterObj).forEach(function(k) {
                        if (typeof k !== 'string') return;
                        if (k === '变更备注') return;
                        if (mergedFieldsSet && !mergedFieldsSet.has(k)) return;
                        var va = afterObj[k];
                        var sa = (va === undefined || va === null) ? '' : String(va).trim();
                        if (!sa) return;
                        var vb = beforeObj[k];
                        var sb = (vb === undefined || vb === null) ? '' : String(vb).trim();
                        if (!sb) list.push(k);
                    });
                    return list;
                }
                function _noteSegment(seq, timeStr, fieldsAdded, sourceLabel) {
                    var src = sourceLabel || '';
                    if (!Array.isArray(fieldsAdded) || fieldsAdded.length === 0) {
                        if (!src) return '';
                        return String(seq) + '、' + String(timeStr || _fmtNoteDate()) + ' 加入合并表（' + src + '）';
                    }
                    var names = fieldsAdded.join(', ');
                    return String(seq) + '、' + String(timeStr || _fmtNoteDate()) + ' 加入合并表的字段的名称：' + names + (src ? '（来源：' + src + '）' : '');
                }
                function _noteAppend(existingNote, newSegmentText) {
                    if (!newSegmentText || typeof newSegmentText !== 'string') return existingNote || '';
                    var base = (existingNote && typeof existingNote === 'string') ? existingNote : '';
                    if (!base) return newSegmentText;
                    return base + '；' + newSegmentText;
                }
                function _snapObj(o, mergedFieldsArr) {
                    var snap = {};
                    if (!o || typeof o !== 'object') return snap;
                    if (Array.isArray(mergedFieldsArr)) {
                        for (var _i = 0; _i < mergedFieldsArr.length; _i++) {
                            var f = mergedFieldsArr[_i];
                            if (f === '变更备注') continue;
                            snap[f] = (o[f] === undefined || o[f] === null) ? '' : String(o[f]);
                        }
                    } else {
                        Object.keys(o).forEach(function(k) {
                            if (k === '变更备注') return;
                            snap[k] = (o[k] === undefined || o[k] === null) ? '' : String(o[k]);
                        });
                    }
                    return snap;
                }
                // 【第 2 层 行级清理工具函数】写每行 out 末尾时调用：从 out 对象里删除所有黑名单字段（即使 masterRows/b/p/c 里有也不写）+ 同时把所有非 mergedFields 列的值清空
                function _cleanMergeOutRow(out) {
                    if (!out || typeof out !== 'object') return out;
                    try {
                        Object.keys(out).forEach(function(k) {
                            if (typeof k !== 'string') return;
                            // 黑名单字段 → 直接删除
                            if (MERGE_EXPORT_BLACKLIST_FIELDS.has(k)) { delete out[k]; return; }
                            // 非 mergedFields 里的其他列 → 置空（防止数据泄露到导出列之外，也避免 dedupRowsFull 按对象 keys 扫到多余字段）
                            if (!_mergedFieldsSet.has(k) && k !== '变更备注') { out[k] = ''; }
                        });
                    } catch (_e2) {}
                    return out;
                }
                var _noteNowStr = _fmtNoteDate(new Date());

                // ---------- 合并主逻辑 ----------
                var noteCtxBase = { basicByCode: basicByCode, permitsByCode: permitsByCode, permitByName: permitByName, completeByName: completeByName };
                // 🔴✅ 修复核心 bug：三表写标准列后，把 basic/permit/complete 行里实际带的天眼查补全列搬到 out（否则 fields 里有列名但数据全空！）
                //   规则：只有 out 当前列为空 + mergedFields 里包含该列（防止越界写）+ srcRow 列值非空 → 才写入；优先级更高的 tier 写过的数据不会被覆盖
                var TYCSuffix = TYC_DEFAULT_KEEP_SUFFIX.slice();
                var TYCSuffixSet = new Set(TYCSuffix);
                var mergedFieldsSetTyc = new Set(mergedFields);
                function copyTycToOut(out, srcRow) {
                    if (!out || !srcRow || typeof srcRow !== 'object') return;
                    try {
                        Object.keys(srcRow).forEach(function(k) {
                            if (typeof k !== 'string') return;
                            // 只处理「5 个标准天眼查补全后缀」的列（避免误搬其他自定义列）
                            var lastU = k.lastIndexOf('_');
                            if (lastU <= 0) return;
                            var suf = k.substring(lastU + 1);
                            if (!TYCSuffixSet.has(suf)) return;
                            // mergedFields 里必须有该列（否则写进去用户也看不到）
                            if (!mergedFieldsSetTyc.has(k)) return;
                            // out 当前列为空才写，避免覆盖主表/更高级 tier 的值
                            if (out[k] !== '' && out[k] !== undefined && out[k] !== null) return;
                            var v = srcRow[k];
                            if (v === undefined || v === null) return;
                            var sv = String(v).trim();
                            if (!sv) return;
                            out[k] = sv;
                        });
                    } catch (_) {}
                }

                if (masterRows && masterRows.length) {
                    // ============== 模式 1：主表基准 ==============
                    // ✅🔴 模式 1 主键追踪集合（和模式 2 完全一样，避免：主表 10 条不匹配 basic/permit 时，查询到的 10 basic + 10 permit 全部丢失 → 应得到 30 条）
                    //   根因：旧模式 1 只遍历 masterRows → 查询到的 basic/permit 中没被主表匹配的独立行（共 20 条）根本没写入 mergedRows → 只剩 10 条主表
                    //   修复：模式 1 增加【第 2/3/4 阶段】遍历 basic 孤行 / permit 孤行 / complete 孤行，同时用 processedXXX 集合避免重复（主表处理过的不重复写）
                    var processedBasicCodes_M1 = new Set();     // basic 主键：省级项目编号
                    var processedPermitKeys_M1 = new Set();     // permit 主键：省级项目编号|工程名称
                    var processedCompleteNames_M1 = new Set();  // complete 主键：工程名称
                    function _permitKey_M1(pR) {
                        if (!pR) return '';
                        var c = norm(pR['省级项目编号']) || '';
                        var n = norm(pR['工程名称']) || '';
                        return c + '|' + n;
                    }
                    masterRows.forEach(function(mRow) {
                        // 先把主表 mRow 涉及的 basic code / permit key / complete name 记为"已处理"（第 2/3/4 阶段遇到就跳过，避免重复）
                        var mCode = norm(mRow['省级项目编号']);
                        var mName = norm(mRow['工程名称']) || norm(mRow['项目名称']);
                        if (mCode) processedBasicCodes_M1.add(mCode);
                        if (mName) processedCompleteNames_M1.add(mName);
                        var code = norm(mRow['省级项目编号']);
                        var name = norm(mRow['工程名称']) || norm(mRow['项目名称']);
                        var bMatch = code ? (basicByCode.get(code) || null) : null;
                        // permits：优先 code→list（1:N），没 code 再按 name→list
                        var pList = [];
                        if (code && permitsByCode.has(code)) pList = permitsByCode.get(code).slice();
                        else if (name) {
                            // 兜底：遍历 permit 收集同工程名
                            source.permit.forEach(function(p) {
                                if (norm(p['工程名称']) === name) pList.push(p);
                            });
                        }
                        // 模式 1 展开前：这一主行命中的 pList 全部标记"已处理"（避免第 3 阶段重复写入）
                        pList.forEach(function(p) {
                            var pk = _permitKey_M1(p);
                            if (pk) processedPermitKeys_M1.add(pk);
                        });
                        // ✅🔴 根因修复（用户：10→30 条）：pList 展开前先做「行级全字段去重」
                        //   场景：source.permit = P0（合并表拆出的 10 条）+ P1（天眼查补全 10 条）+ P2（施工许可 Tab 10 条），30 条内容几乎一样，按 code 分桶后同 code 下有 3 条相似 pRow
                        //   → dedupByKeysTiered 按 DEDUP.permit=['省级项目编号','工程名称','施工许可证编号'] 没去掉（因为三 key 指纹微差）
                        //   → 这里用全字段签名硬去重：只要所有字段值相同（trim后），只保留 1 条，expandCount 立刻从 3 → 1
                        (function() {
                            var dedupP = dedupRowsFull(pList, null, null);
                            if (dedupP.rows && dedupP.rows.length) pList = dedupP.rows;
                        })();
                        // 如果主表是「工程粒度」且只有一条 permit（name 命中），就不要再按 code 展开多条
                        var cList = [];
                        pList.forEach(function(p) {
                            var n = norm(p['工程名称']);
                            if (n && completeByName.has(n)) { cList.push(completeByName.get(n)); processedCompleteNames_M1.add(n); }
                            else if (name && completeByName.has(name)) { cList.push(completeByName.get(name)); processedCompleteNames_M1.add(name); }
                        });
                        // 唯一化 cList
                        var seenC = new Set();
                        cList = cList.filter(function(c) {
                            var k = norm(c['省级项目编号']) + '||' + norm(c['工程名称']);
                            if (seenC.has(k)) return false; seenC.add(k); return true;
                        });

                        // 决定展开次数：max(1, pList.length)
                        var expandCount = pList.length || 1;
                        var matchedAny = false;
                        for (var i = 0; i < expandCount; i++) {
                            var pRow = pList[i] || null;
                            var pName = pRow ? norm(pRow['工程名称']) : name;
                            var cRow = (pName && completeByName.has(pName)) ? completeByName.get(pName) : (cList[i] || (cList[0] ? cList[0] : null));
                            if (pName) processedCompleteNames_M1.add(pName);
                            if (bMatch || pRow || cRow) matchedAny = true;
                            // 写行：mRow 原样 → 叠加 b/p/c（三表字段映射带前缀，冲突字段不覆盖 mRow）
                            var out = {};
                            mergedFields.forEach(function(f) { out[f] = ''; });
                            if (mRow) Object.keys(mRow).forEach(function(k) { if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = (mRow[k] === undefined || mRow[k] === null) ? '' : mRow[k]; });

                            // ============== ✅ 模式 1（主表 mRow）变更备注：按 3 条规则 ==============
                            // 【基础】先读 mRow（作为基准主表）自带的变更备注 → 解析 maxSeq，后续编号从 maxSeq+1 开始
                            var _mNoteRaw = (mRow && mRow['变更备注']) || '';
                            // 🔴 规则 3：如果被叠加的 b/p/c 行本身也带变更备注 → 要「先重编号（起点 = mRow.maxSeq + 1）再衔接」，避免 A/B 交错
                            // 计算当前主表侧最大序号（含 mRow 本身）
                            var _currentMaxSeq = _noteParseMaxSeq(String(_mNoteRaw || ''));
                            var _note = String(_mNoteRaw || '');
                            // 🔴 规则 3 兜底：如果 mRow 本身没备注但带了非空字段 → 也算"首次写入主表段"，序号 1 记主表贡献字段（孤行 / 单表首次合并）
                            if (!_note) {
                                var _mFieldsAdded = [];
                                (function() {
                                    var blank = {};
                                    mergedFields.forEach(function(f) { if (f !== '变更备注') blank[f] = ''; });
                                    _mFieldsAdded = _noteCollectAddedFields(blank, out, _mergedFieldsSet);
                                })();
                                // 主表字段算 1 条：序号 1 + 时间 + 加入字段名
                                _currentMaxSeq = 1;
                                var _segM = _noteSegment(1, _noteNowStr, _mFieldsAdded, '主表');
                                if (_segM) _note = _segM;
                            }
                            var _nextSeq = Number(_currentMaxSeq) + 1;

                            // ① basic 段 写入（先拍快照 → 写 tier+copyTyc → 拍快照 → 收集新增字段 → append）
                            var _snapBefore = _snapObj(out, mergedFields);
                            if (bMatch) {
                                BASIC_FIELDS.forEach(function(f) {
                                    if (out[f] !== '' && out[f] !== undefined && out[f] !== null) return;
                                    if (bMatch[f] !== undefined && bMatch[f] !== null) out[f] = bMatch[f];
                                });
                                copyTycToOut(out, bMatch);
                                // 🔴 规则 3：bMatch 自带变更备注 → 先重编号（_nextSeq 起点）衔接
                                var _bNote = (bMatch && bMatch['变更备注']) ? String(bMatch['变更备注']) : '';
                                if (_bNote) {
                                    var _rnb = _noteRenumberSegments(_bNote, _nextSeq);
                                    if (_rnb.text) _note = _noteAppend(_note, _rnb.text);
                                    _nextSeq = Number(_rnb.nextSeq);
                                }
                            }
                            var _bAdded = _noteCollectAddedFields(_snapBefore, out, _mergedFieldsSet);
                            if (_bAdded.length) {
                                var _segB = _noteSegment(_nextSeq, _noteNowStr, _bAdded, '基本信息');
                                if (_segB) { _note = _noteAppend(_note, _segB); _nextSeq++; }
                            }

                            // ② permit 段 写入
                            var _snapBefore2 = _snapObj(out, mergedFields);
                            if (pRow) {
                                PERMIT_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号') return;
                                    var writeK = dupStd.has(f) ? ('许可_' + f) : f;
                                    if ((out[writeK] === '' || out[writeK] === undefined || out[writeK] === null) && pRow[f] !== undefined && pRow[f] !== null) {
                                        out[writeK] = pRow[f];
                                    }
                                });
                                copyTycToOut(out, pRow);
                                var _pNote = (pRow && pRow['变更备注']) ? String(pRow['变更备注']) : '';
                                if (_pNote) {
                                    var _rnp = _noteRenumberSegments(_pNote, _nextSeq);
                                    if (_rnp.text) _note = _noteAppend(_note, _rnp.text);
                                    _nextSeq = Number(_rnp.nextSeq);
                                }
                            }
                            var _pAdded = _noteCollectAddedFields(_snapBefore2, out, _mergedFieldsSet);
                            if (_pAdded.length) {
                                var _segP = _noteSegment(_nextSeq, _noteNowStr, _pAdded, '施工许可');
                                if (_segP) { _note = _noteAppend(_note, _segP); _nextSeq++; }
                            }

                            // ③ complete 段 写入
                            var _snapBefore3 = _snapObj(out, mergedFields);
                            if (cRow) {
                                COMPLETE_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号' || f === '工程名称') return;
                                    var writeK = dupStd.has(f) ? ('竣工_' + f) : f;
                                    if ((out[writeK] === '' || out[writeK] === undefined || out[writeK] === null) && cRow[f] !== undefined && cRow[f] !== null) {
                                        out[writeK] = cRow[f];
                                    }
                                });
                                copyTycToOut(out, cRow);
                                var _cNote = (cRow && cRow['变更备注']) ? String(cRow['变更备注']) : '';
                                if (_cNote) {
                                    var _rnc = _noteRenumberSegments(_cNote, _nextSeq);
                                    if (_rnc.text) _note = _noteAppend(_note, _rnc.text);
                                    _nextSeq = Number(_rnc.nextSeq);
                                }
                            }
                            var _cAdded = _noteCollectAddedFields(_snapBefore3, out, _mergedFieldsSet);
                            if (_cAdded.length) {
                                var _segC = _noteSegment(_nextSeq, _noteNowStr, _cAdded, '竣工验收备案');
                                if (_segC) { _note = _noteAppend(_note, _segC); _nextSeq++; }
                            }

                            // 兜底：旧接口占位保持向后兼容
                            try {
                                if (typeof window.__mergeBuildChangeNote === 'function') {
                                    var extNote = String(window.__mergeBuildChangeNote(mRow, {
                                        basic: bMatch, permit: pRow, complete: cRow, index: i, expandTotal: expandCount,
                                        fields: mergedFields, ctx: noteCtxBase, currentNote: _note, nextSeq: _nextSeq
                                    }) || '');
                                    if (extNote) _note = _noteAppend(_note, extNote);
                                }
                            } catch (eNote) { try { console.warn('[merge] 备注函数异常：', eNote); } catch (_) {} }
                            out = _cleanMergeOutRow(out);
                            out['变更备注'] = _note;
                            mergedRows.push(out);
                        }
                        if (!matchedAny && !keepUnmatched) {
                            // 用户选择不保留没匹配的 → 把最后 expandCount 个 masterRow 全 pop（只展开 expandCount=1 时等价 pop 一次）
                            for (var k = 0; k < expandCount; k++) mergedRows.pop();
                        }
                    });

                    // ---------- 模式 1 第 2 阶段：写入「查询到的 basic 中未被主表处理过的独立行」（10 条 basic 独立 → 不匹配 10 条主表的话，这 10 条之前全丢了） ----------
                    (source.basic || []).forEach(function(bR) {
                        var bCode = norm(bR['省级项目编号']);
                        if (!bCode) return;
                        if (processedBasicCodes_M1.has(bCode)) return;  // 第 1 阶段（主表）已处理 → 跳过，避免重复
                        processedBasicCodes_M1.add(bCode);
                        // 尝试匹配 permit/complete（虽然是 basic 孤行，但万一能匹配就合并，不丢数据）
                        var pList2 = [];
                        if (permitsByCode.has(bCode)) pList2 = permitsByCode.get(bCode).slice();
                        if (!pList2.length) (source.permit || []).forEach(function(pR2) { if (norm(pR2['省级项目编号']) === bCode) pList2.push(pR2); });
                        // 先标记这些 permit 已处理（避免第 3 阶段重复）
                        pList2.forEach(function(pR2) {
                            var pk2 = _permitKey_M1(pR2);
                            if (pk2) processedPermitKeys_M1.add(pk2);
                        });
                        if (pList2.length > 1) {
                            var dprM1B = dedupRowsFull(pList2, null, null);
                            if (dprM1B && dprM1B.rows && dprM1B.rows.length) pList2 = dprM1B.rows.concat([]);
                        }
                        if (!pList2.length) pList2 = [null];
                        pList2.forEach(function(pRow2) {
                            var en2 = pRow2 ? norm(pRow2['工程名称']) : '';
                            var cRow2 = en2 ? (completeByName.get(en2) || null) : null;
                            if (en2) processedCompleteNames_M1.add(en2);
                            var out2 = {};
                            mergedFields.forEach(function(f) { out2[f] = ''; });
                            // 【规则 1】孤行首次写入 → 假设主表 = basic
                            var _note2 = '';
                            var _nextSeq2 = 1;
                            BASIC_FIELDS.forEach(function(f) { if (bR[f] !== undefined) out2[f] = bR[f]; });
                            copyTycToOut(out2, bR);
                            var _blank2 = {};
                            mergedFields.forEach(function(f) { if (f !== '变更备注') _blank2[f] = ''; });
                            var _priAdded2 = _noteCollectAddedFields(_blank2, out2, _mergedFieldsSet);
                            var _segPri2 = _noteSegment(1, _noteNowStr, _priAdded2, '基本信息（假设主表，首次）');
                            if (_segPri2) _note2 = _segPri2;
                            _nextSeq2 = 2;
                            // permit 段
                            var _snapP2 = _snapObj(out2, mergedFields);
                            if (pRow2) {
                                PERMIT_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号') return;
                                    var wk = dupStd.has(f) ? ('许可_' + f) : f;
                                    if ((out2[wk] === '' || out2[wk] === undefined || out2[wk] === null) && pRow2[f] !== undefined) out2[wk] = pRow2[f];
                                });
                                copyTycToOut(out2, pRow2);
                            }
                            var _pAdded2 = _noteCollectAddedFields(_snapP2, out2, _mergedFieldsSet);
                            if (_pAdded2.length) {
                                var _segP2 = _noteSegment(_nextSeq2, _noteNowStr, _pAdded2, '施工许可');
                                if (_segP2) { _note2 = _noteAppend(_note2, _segP2); _nextSeq2++; }
                            }
                            // complete 段
                            var _snapC2 = _snapObj(out2, mergedFields);
                            if (cRow2) {
                                COMPLETE_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号' || f === '工程名称') return;
                                    var wk = dupStd.has(f) ? ('竣工_' + f) : f;
                                    if ((out2[wk] === '' || out2[wk] === undefined || out2[wk] === null) && cRow2[f] !== undefined) out2[wk] = cRow2[f];
                                });
                                copyTycToOut(out2, cRow2);
                            }
                            var _cAdded2 = _noteCollectAddedFields(_snapC2, out2, _mergedFieldsSet);
                            if (_cAdded2.length) {
                                var _segC2 = _noteSegment(_nextSeq2, _noteNowStr, _cAdded2, '竣工验收备案');
                                if (_segC2) { _note2 = _noteAppend(_note2, _segC2); _nextSeq2++; }
                            }
                            if (!out2['省级项目编号']) out2['省级项目编号'] = bCode;
                            if (!out2['工程名称'] && en2) out2['工程名称'] = en2;
                            out2 = _cleanMergeOutRow(out2);
                            out2['变更备注'] = _note2;
                            mergedRows.push(out2);
                        });
                    });

                    // ---------- 模式 1 第 3 阶段：写入「查询到的 permit 中未被第 1/2 阶段处理过的独立行」（10 条施工许可独立 不匹配主表/basic 的情况） ----------
                    (source.permit || []).forEach(function(pR3) {
                        var pk3 = _permitKey_M1(pR3);
                        if (!pk3) return;
                        if (processedPermitKeys_M1.has(pk3)) return;  // 已处理 → 跳过
                        processedPermitKeys_M1.add(pk3);
                        var code3 = norm(pR3['省级项目编号']) || '';
                        var en3 = norm(pR3['工程名称']) || '';
                        if (code3) processedBasicCodes_M1.add(code3);  // 对应 basic code 也记为处理过，避免第 2 阶段重复
                        if (en3) processedCompleteNames_M1.add(en3);
                        var bMatch3 = basicByCode.get(code3) || null;
                        var cRow3 = completeByName.get(en3) || null;
                        var out3 = {};
                        mergedFields.forEach(function(f) { out3[f] = ''; });
                        // 【规则 1】孤行首次写入 → 假设主表 = 施工许可
                        var _note3 = '';
                        var _nextSeq3 = 1;
                        PERMIT_FIELDS.forEach(function(f) {
                            if (f === '省级项目编号') return;
                            var wk = dupStd.has(f) ? ('许可_' + f) : f;
                            if (pR3[f] !== undefined && pR3[f] !== null) out3[wk] = pR3[f];
                        });
                        copyTycToOut(out3, pR3);
                        var _blank3 = {};
                        mergedFields.forEach(function(f) { if (f !== '变更备注') _blank3[f] = ''; });
                        var _priAdded3 = _noteCollectAddedFields(_blank3, out3, _mergedFieldsSet);
                        var _segPri3 = _noteSegment(1, _noteNowStr, _priAdded3, '施工许可（假设主表，首次）');
                        if (_segPri3) _note3 = _segPri3;
                        _nextSeq3 = 2;
                        // basic 段
                        var _snapB3 = _snapObj(out3, mergedFields);
                        if (bMatch3) {
                            BASIC_FIELDS.forEach(function(f) {
                                if ((out3[f] === '' || out3[f] === undefined || out3[f] === null) && bMatch3[f] !== undefined) out3[f] = bMatch3[f];
                            });
                            copyTycToOut(out3, bMatch3);
                        }
                        var _bAdded3 = _noteCollectAddedFields(_snapB3, out3, _mergedFieldsSet);
                        if (_bAdded3.length) {
                            var _segB3 = _noteSegment(_nextSeq3, _noteNowStr, _bAdded3, '基本信息');
                            if (_segB3) { _note3 = _noteAppend(_note3, _segB3); _nextSeq3++; }
                        }
                        // complete 段
                        var _snapC3 = _snapObj(out3, mergedFields);
                        if (cRow3) {
                            COMPLETE_FIELDS.forEach(function(f) {
                                if (f === '省级项目编号' || f === '工程名称') return;
                                var wk = dupStd.has(f) ? ('竣工_' + f) : f;
                                if ((out3[wk] === '' || out3[wk] === undefined || out3[wk] === null) && cRow3[f] !== undefined) out3[wk] = cRow3[f];
                            });
                            copyTycToOut(out3, cRow3);
                        }
                        var _cAdded3 = _noteCollectAddedFields(_snapC3, out3, _mergedFieldsSet);
                        if (_cAdded3.length) {
                            var _segC3 = _noteSegment(_nextSeq3, _noteNowStr, _cAdded3, '竣工验收备案');
                            if (_segC3) { _note3 = _noteAppend(_note3, _segC3); _nextSeq3++; }
                        }
                        if (!out3['省级项目编号']) out3['省级项目编号'] = code3;
                        if (!out3['工程名称']) out3['工程名称'] = en3;
                        out3 = _cleanMergeOutRow(out3);
                        out3['变更备注'] = _note3;
                        mergedRows.push(out3);
                    });

                    // ---------- 模式 1 第 4 阶段：写入「查询到的 complete 中未被第 1/2/3 阶段处理过的独立行」（complete 独立孤行兜底不丢失） ----------
                    (source.complete || []).forEach(function(cR4) {
                        var en4 = norm(cR4['工程名称']);
                        if (!en4) return;
                        if (processedCompleteNames_M1.has(en4)) return;
                        processedCompleteNames_M1.add(en4);
                        var code4 = norm(cR4['省级项目编号']) || '';
                        if (code4) processedBasicCodes_M1.add(code4);
                        var bMatch4 = basicByCode.get(code4) || null;
                        var pList4 = [];
                        if (code4 && permitsByCode.has(code4)) pList4 = permitsByCode.get(code4).slice();
                        if (!pList4.length) (source.permit || []).forEach(function(pR4) { if (norm(pR4['工程名称']) === en4) pList4.push(pR4); });
                        pList4.forEach(function(pR4) {
                            var pk4 = _permitKey_M1(pR4);
                            if (pk4) processedPermitKeys_M1.add(pk4);
                        });
                        if (pList4.length > 1) {
                            var dprM1C = dedupRowsFull(pList4, null, null);
                            if (dprM1C && dprM1C.rows && dprM1C.rows.length) pList4 = dprM1C.rows.concat([]);
                        }
                        if (!pList4.length) pList4 = [null];
                        pList4.forEach(function(pRow4) {
                            var out4 = {};
                            mergedFields.forEach(function(f) { out4[f] = ''; });
                            var _note4 = '';
                            var _nextSeq4 = 1;
                            COMPLETE_FIELDS.forEach(function(f) {
                                if (f === '省级项目编号') return;
                                var wk = dupStd.has(f) ? ('竣工_' + f) : f;
                                if (cR4[f] !== undefined && cR4[f] !== null) out4[wk] = cR4[f];
                            });
                            if (en4) out4['工程名称'] = en4;
                            copyTycToOut(out4, cR4);
                            var _blank4 = {};
                            mergedFields.forEach(function(f) { if (f !== '变更备注') _blank4[f] = ''; });
                            var _priAdded4 = _noteCollectAddedFields(_blank4, out4, _mergedFieldsSet);
                            var _segPri4 = _noteSegment(1, _noteNowStr, _priAdded4, '竣工验收备案（假设主表，首次）');
                            if (_segPri4) _note4 = _segPri4;
                            _nextSeq4 = 2;
                            var _snapB4 = _snapObj(out4, mergedFields);
                            if (bMatch4) {
                                BASIC_FIELDS.forEach(function(f) {
                                    if ((out4[f] === '' || out4[f] === undefined || out4[f] === null) && bMatch4[f] !== undefined) out4[f] = bMatch4[f];
                                });
                                copyTycToOut(out4, bMatch4);
                            }
                            var _bAdded4 = _noteCollectAddedFields(_snapB4, out4, _mergedFieldsSet);
                            if (_bAdded4.length) {
                                var _segB4 = _noteSegment(_nextSeq4, _noteNowStr, _bAdded4, '基本信息');
                                if (_segB4) { _note4 = _noteAppend(_note4, _segB4); _nextSeq4++; }
                            }
                            var _snapP4 = _snapObj(out4, mergedFields);
                            if (pRow4) {
                                PERMIT_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号') return;
                                    var wk = dupStd.has(f) ? ('许可_' + f) : f;
                                    if ((out4[wk] === '' || out4[wk] === undefined || out4[wk] === null) && pRow4[f] !== undefined) out4[wk] = pRow4[f];
                                });
                                copyTycToOut(out4, pRow4);
                            }
                            var _pAdded4 = _noteCollectAddedFields(_snapP4, out4, _mergedFieldsSet);
                            if (_pAdded4.length) {
                                var _segP4 = _noteSegment(_nextSeq4, _noteNowStr, _pAdded4, '施工许可');
                                if (_segP4) { _note4 = _noteAppend(_note4, _segP4); _nextSeq4++; }
                            }
                            if (!out4['省级项目编号']) out4['省级项目编号'] = code4;
                            if (!out4['工程名称']) out4['工程名称'] = en4;
                            out4 = _cleanMergeOutRow(out4);
                            out4['变更备注'] = _note4;
                            mergedRows.push(out4);
                        });
                    });
                } else {
                    // ============== 模式 2：无主表 → 以 permit 为主心（permit 有 N 条所以能 1:N 展开）==============
                    // 如果没有 permit，就退而 basic × complete（1:N 以 code）
                    // ✅🔴 修复：用户选了 3 张完全独立的表（basic/permit/complete 各 10 条，互不匹配），期望得到 30 条，
                    //      之前模式 2 只遍历 primaryList（permit）10 条 → 没有被 permit 匹配到的 basic 10 条 / complete 10 条直接丢失 → 只剩 10 条 permit
                    //   修复：3 阶段 + 已处理主键去重，保证所有 3 表的独立行都能做为「孤行」写入：
                    //      第 1 阶段：遍历 primaryList（permit 或 fallback basic），合并匹配的 basic/permit/complete
                    //                → 记录 processedBasicCodes / processedPermitKeys / processedCompleteNames
                    //      第 2 阶段：遍历 source.basic 中未被处理的 code → 作为 basic 孤行写入
                    //      第 3 阶段：遍历 source.complete 中未被处理的工程名称 → 作为 complete 孤行写入
                    var noPermitFallback = (source.permit || []).length === 0;
                    var primaryList = noPermitFallback ? (source.basic || []) : (source.permit || []);
                    if (!primaryList.length && (source.basic || []).length === 0 && (source.permit || []).length === 0 && (source.complete || []).length === 0) {
                        return Promise.reject(new Error(
                            '无主表模式下没有可合并的主心行。\n诊断：\n· 施工许可行数：' + (source.permit || []).length +
                            '\n· 基本信息行数：' + (source.basic || []).length +
                            '\n· 竣工验收行数：' + (source.complete || []).length +
                            '\n请至少上传/查询到 施工许可 或 基本信息 或 竣工验收备案 的一行数据。'
                        ));
                    }
                    // 记录 3 个已处理主键集合（避免重复写入，第 1 阶段处理过的后面阶段就跳过）
                    var processedBasicCodes = new Set();     // basic 的 code = 省级项目编号
                    var processedPermitKeys = new Set();     // permit 的主键 = code|工程名称
                    var processedCompleteNames = new Set();  // complete 的主键 = 工程名称
                    function _permitKey(pR) {
                        if (!pR) return '';
                        var c = norm(pR['省级项目编号']) || '';
                        var n = norm(pR['工程名称']) || '';
                        return c + '|' + n;
                    }

                    // ---------- 第 1 阶段：遍历 primaryList（permit 优先，fallback basic） ----------
                    if (primaryList && primaryList.length) {
                    primaryList.forEach(function(priRow) {
                        var code = norm(priRow['省级项目编号']);
                        var pname = noPermitFallback ? '' : norm(priRow['工程名称']);
                        // 这一轮 primaryList 处理的 basic/permit/complete 立刻记为已处理
                        if (code) processedBasicCodes.add(code);
                        if (!noPermitFallback) {
                            var pk1 = _permitKey(priRow);
                            if (pk1) processedPermitKeys.add(pk1);
                        } else {
                            // fallback = basic，priRow 本身就是 basic，code 已记
                        }
                        var bMatch = basicByCode.get(code) || null;
                        var pRows = noPermitFallback ? (permitsByCode.get(code) || []) : [priRow];
                        if (!pRows.length) pRows = [null];
                        // ✅🔴 同模式 1：fallback 到 basic 做主心时，permitsByCode.get(code) 可能返回多条「内容几乎一样」的 pRow，全字段去重避免展开重复
                        if (noPermitFallback && pRows.length > 1) {
                            var dedupPRows = dedupRowsFull(pRows, null, null);
                            if (dedupPRows.rows && dedupPRows.rows.length) pRows = dedupPRows.rows.concat([]);
                            if (!pRows.length) pRows = [null];
                        }
                        pRows.forEach(function(pRow) {
                            var en = pRow ? norm(pRow['工程名称']) : pname;
                            if (pRow) {
                                var pk2 = _permitKey(pRow);
                                if (pk2) processedPermitKeys.add(pk2);
                            }
                            var cRow = en ? (completeByName.get(en) || null) : null;
                            if (en) processedCompleteNames.add(en);
                            var out = {};
                            mergedFields.forEach(function(f) { out[f] = ''; });

                            // ============== ✅ 模式 2（无主表）变更备注：规则 3 兜底「假设主表」 = priRow（通常是施工许可 / 回退时 basic）==============
                            var _assumedMasterRow = null;
                            var _masterLabel = '';
                            if (!noPermitFallback) { _assumedMasterRow = priRow; _masterLabel = '施工许可'; }
                            else { _assumedMasterRow = priRow; _masterLabel = '基本信息'; }
                            // 假设主表先写自身字段（bMatch/pRow 后面再按「空才覆盖」规则叠加），保证：假设主表贡献的字段被计入序号 1
                            if (_assumedMasterRow && !noPermitFallback) {
                                // 主心 = permit → 先写 priRow 到 out（和后面 pRow 写的逻辑一致，避免重复）
                            }
                            var _priNoteRaw = (_assumedMasterRow && _assumedMasterRow['变更备注']) ? String(_assumedMasterRow['变更备注']) : '';
                            var _currentMaxSeq = _noteParseMaxSeq(_priNoteRaw);
                            var _note = String(_priNoteRaw || '');
                            var _nextSeq = Number(_currentMaxSeq) + 1;
                            // 【规则 1 / 规则 3 兜底】假设主表没自带备注 → 主表贡献字段序号 1 先写
                            if (!_note) {
                                // 先把假设主表的字段写出来 → 作为首次合并（序号 1）
                                if (_assumedMasterRow && !noPermitFallback) {
                                    PERMIT_FIELDS.forEach(function(f) {
                                        if (f === '省级项目编号') return;
                                        var wk = dupStd.has(f) ? ('许可_' + f) : f;
                                        if (priRow[f] !== undefined && priRow[f] !== null) out[wk] = priRow[f];
                                    });
                                    copyTycToOut(out, priRow);
                                } else if (_assumedMasterRow && noPermitFallback) {
                                    BASIC_FIELDS.forEach(function(f) { if (priRow[f] !== undefined) out[f] = priRow[f]; });
                                    copyTycToOut(out, priRow);
                                }
                                var _blank = {};
                                mergedFields.forEach(function(f) { if (f !== '变更备注') _blank[f] = ''; });
                                var _priAdded = _noteCollectAddedFields(_blank, out, _mergedFieldsSet);
                                _currentMaxSeq = 1;
                                _nextSeq = 2;
                                var _segPri = _noteSegment(1, _noteNowStr, _priAdded, _masterLabel + '（假设主表，首次）');
                                if (_segPri) _note = _segPri;
                            } else {
                                // 假设主表本身有备注 → 先把主表字段写了（保证合并结果主表字段全）
                                if (_assumedMasterRow && !noPermitFallback) {
                                    PERMIT_FIELDS.forEach(function(f) {
                                        if (f === '省级项目编号') return;
                                        var wk = dupStd.has(f) ? ('许可_' + f) : f;
                                        if (priRow[f] !== undefined && priRow[f] !== null && (out[wk] === '' || out[wk] === undefined)) out[wk] = priRow[f];
                                    });
                                    copyTycToOut(out, priRow);
                                } else if (_assumedMasterRow && noPermitFallback) {
                                    BASIC_FIELDS.forEach(function(f) { if (priRow[f] !== undefined && (out[f] === '' || out[f] === undefined)) out[f] = priRow[f]; });
                                    copyTycToOut(out, priRow);
                                }
                            }

                            // ① basic 段 叠加（假设主表如果就是 basic，则跳过 basic 段自身叠加避免重复记）
                            var _snapB = _snapObj(out, mergedFields);
                            var _skipBasic = noPermitFallback; // 假设主表是 basic → 刚才假设主表写入已经写完 basic，不要重复记
                            if (!_skipBasic && bMatch) {
                                BASIC_FIELDS.forEach(function(f) {
                                    if ((out[f] === '' || out[f] === undefined || out[f] === null) && bMatch[f] !== undefined) out[f] = bMatch[f];
                                });
                                copyTycToOut(out, bMatch);
                                var _bNote = (bMatch['变更备注']) ? String(bMatch['变更备注']) : '';
                                if (_bNote) {
                                    var _rnb = _noteRenumberSegments(_bNote, _nextSeq);
                                    if (_rnb.text) _note = _noteAppend(_note, _rnb.text);
                                    _nextSeq = Number(_rnb.nextSeq);
                                }
                            }
                            var _bAdded = _skipBasic ? [] : _noteCollectAddedFields(_snapB, out, _mergedFieldsSet);
                            if (_bAdded.length) {
                                var _segB = _noteSegment(_nextSeq, _noteNowStr, _bAdded, '基本信息');
                                if (_segB) { _note = _noteAppend(_note, _segB); _nextSeq++; }
                            }

                            // ② permit 段 叠加（假设主表如果就是 permit，则跳过）
                            var _snapP = _snapObj(out, mergedFields);
                            var _skipPermit = !noPermitFallback;
                            if (!_skipPermit && pRow) {
                                PERMIT_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号') return;
                                    var wk = dupStd.has(f) ? ('许可_' + f) : f;
                                    if ((out[wk] === '' || out[wk] === undefined || out[wk] === null) && pRow[f] !== undefined) out[wk] = pRow[f];
                                });
                                copyTycToOut(out, pRow);
                                var _pNote = (pRow['变更备注']) ? String(pRow['变更备注']) : '';
                                if (_pNote) {
                                    var _rnp = _noteRenumberSegments(_pNote, _nextSeq);
                                    if (_rnp.text) _note = _noteAppend(_note, _rnp.text);
                                    _nextSeq = Number(_rnp.nextSeq);
                                }
                            }
                            var _pAdded = _skipPermit ? [] : _noteCollectAddedFields(_snapP, out, _mergedFieldsSet);
                            if (_pAdded.length) {
                                var _segP = _noteSegment(_nextSeq, _noteNowStr, _pAdded, '施工许可');
                                if (_segP) { _note = _noteAppend(_note, _segP); _nextSeq++; }
                            }

                            // ③ complete 段 叠加
                            var _snapC = _snapObj(out, mergedFields);
                            if (cRow) {
                                COMPLETE_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号' || f === '工程名称') return;
                                    var wk = dupStd.has(f) ? ('竣工_' + f) : f;
                                    if ((out[wk] === '' || out[wk] === undefined || out[wk] === null) && cRow[f] !== undefined) out[wk] = cRow[f];
                                });
                                copyTycToOut(out, cRow);
                                var _cNote = (cRow['变更备注']) ? String(cRow['变更备注']) : '';
                                if (_cNote) {
                                    var _rnc = _noteRenumberSegments(_cNote, _nextSeq);
                                    if (_rnc.text) _note = _noteAppend(_note, _rnc.text);
                                    _nextSeq = Number(_rnc.nextSeq);
                                }
                            }
                            var _cAdded = _noteCollectAddedFields(_snapC, out, _mergedFieldsSet);
                            if (_cAdded.length) {
                                var _segC = _noteSegment(_nextSeq, _noteNowStr, _cAdded, '竣工验收备案');
                                if (_segC) { _note = _noteAppend(_note, _segC); _nextSeq++; }
                            }

                            if (!out['省级项目编号'] && code) out['省级项目编号'] = code;
                            if (!out['工程名称'] && en) out['工程名称'] = en;

                            // 兜底：旧接口占位保持向后兼容
                            try {
                                if (typeof window.__mergeBuildChangeNote === 'function') {
                                    var extNote = String(window.__mergeBuildChangeNote(null, {
                                        basic: bMatch, permit: pRow, complete: cRow, index: 0, expandTotal: 1,
                                        fields: mergedFields, ctx: noteCtxBase, currentNote: _note, nextSeq: _nextSeq
                                    }) || '');
                                    if (extNote) _note = _noteAppend(_note, extNote);
                                }
                            } catch (_e) {}
                            out = _cleanMergeOutRow(out);
                            out['变更备注'] = _note;
                            mergedRows.push(out);
                        });
                    });
                    }

                    // ---------- 第 2 阶段：写入「没被 primaryList 匹配到的 basic 独立行」（basic 10 条独立 没匹配 permit 的情况） ----------
                    (source.basic || []).forEach(function(bR) {
                        var bCode = norm(bR['省级项目编号']);
                        if (!bCode) return;
                        if (processedBasicCodes.has(bCode)) return;  // 第 1 阶段已经处理过 → 跳过（避免重复）
                        processedBasicCodes.add(bCode);
                        // 查有没有匹配的 permit/complete（虽然是独立 basic 行，但万一有匹配还是合并进来，避免丢数据）
                        var pList2 = [];
                        if (permitsByCode.has(bCode)) pList2 = permitsByCode.get(bCode).slice();
                        // 再兜底：permit 集合里扫 code 相同但没进 permitsByCode 的极端情况
                        if (!pList2.length) (source.permit || []).forEach(function(pR2) { if (norm(pR2['省级项目编号']) === bCode) pList2.push(pR2); });
                        if (pList2.length > 1) {
                            var dpr = dedupRowsFull(pList2, null, null);
                            if (dpr && dpr.rows && dpr.rows.length) pList2 = dpr.rows.concat([]);
                        }
                        if (!pList2.length) pList2 = [null];
                        pList2.forEach(function(pRow2) {
                            if (pRow2) {
                                var pk22 = _permitKey(pRow2);
                                if (pk22) processedPermitKeys.add(pk22);
                            }
                            var en2 = pRow2 ? norm(pRow2['工程名称']) : '';
                            var cRow2 = en2 ? (completeByName.get(en2) || null) : null;
                            if (en2) processedCompleteNames.add(en2);
                            var out2 = {};
                            mergedFields.forEach(function(f) { out2[f] = ''; });
                            // 【规则 1】孤行首次写入合并表 → 假设主表 = basic
                            var _note2 = '';
                            var _nextSeq2 = 1;
                            // 先写 basic 本身字段
                            BASIC_FIELDS.forEach(function(f) { if (bR[f] !== undefined) out2[f] = bR[f]; });
                            copyTycToOut(out2, bR);
                            var _blank2 = {};
                            mergedFields.forEach(function(f) { if (f !== '变更备注') _blank2[f] = ''; });
                            var _priAdded2 = _noteCollectAddedFields(_blank2, out2, _mergedFieldsSet);
                            var _segPri2 = _noteSegment(1, _noteNowStr, _priAdded2, '基本信息（假设主表，首次）');
                            if (_segPri2) _note2 = _segPri2;
                            _nextSeq2 = 2;
                            // permit 段
                            var _snapP2 = _snapObj(out2, mergedFields);
                            if (pRow2) {
                                PERMIT_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号') return;
                                    var wk = dupStd.has(f) ? ('许可_' + f) : f;
                                    if ((out2[wk] === '' || out2[wk] === undefined || out2[wk] === null) && pRow2[f] !== undefined) out2[wk] = pRow2[f];
                                });
                                copyTycToOut(out2, pRow2);
                            }
                            var _pAdded2 = _noteCollectAddedFields(_snapP2, out2, _mergedFieldsSet);
                            if (_pAdded2.length) {
                                var _segP2 = _noteSegment(_nextSeq2, _noteNowStr, _pAdded2, '施工许可');
                                if (_segP2) { _note2 = _noteAppend(_note2, _segP2); _nextSeq2++; }
                            }
                            // complete 段
                            var _snapC2 = _snapObj(out2, mergedFields);
                            if (cRow2) {
                                COMPLETE_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号' || f === '工程名称') return;
                                    var wk = dupStd.has(f) ? ('竣工_' + f) : f;
                                    if ((out2[wk] === '' || out2[wk] === undefined || out2[wk] === null) && cRow2[f] !== undefined) out2[wk] = cRow2[f];
                                });
                                copyTycToOut(out2, cRow2);
                            }
                            var _cAdded2 = _noteCollectAddedFields(_snapC2, out2, _mergedFieldsSet);
                            if (_cAdded2.length) {
                                var _segC2 = _noteSegment(_nextSeq2, _noteNowStr, _cAdded2, '竣工验收备案');
                                if (_segC2) { _note2 = _noteAppend(_note2, _segC2); _nextSeq2++; }
                            }
                            if (!out2['省级项目编号']) out2['省级项目编号'] = bCode;
                            if (!out2['工程名称'] && en2) out2['工程名称'] = en2;
                            out2 = _cleanMergeOutRow(out2);
                            out2['变更备注'] = _note2;
                            mergedRows.push(out2);
                        });
                    });

                    // ---------- 第 3 阶段：写入「没被第 1/2 阶段处理过的 permit 独立行」（理论上 rare，但兜底保证不漏） ----------
                    (source.permit || []).forEach(function(pR3) {
                        var pk3 = _permitKey(pR3);
                        if (!pk3) return;
                        if (processedPermitKeys.has(pk3)) return;  // 已处理 → 跳过
                        processedPermitKeys.add(pk3);
                        var code3 = norm(pR3['省级项目编号']) || '';
                        var en3 = norm(pR3['工程名称']) || '';
                        if (code3) processedBasicCodes.add(code3);  // 对应 basic code 也算处理过了，避免第 2 阶段重复
                        if (en3) processedCompleteNames.add(en3);
                        var bMatch3 = basicByCode.get(code3) || null;
                        var cRow3 = completeByName.get(en3) || null;
                        var out3 = {};
                        mergedFields.forEach(function(f) { out3[f] = ''; });
                        // 【规则 1】孤行首次写入合并表 → 假设主表 = 施工许可
                        var _note3 = '';
                        var _nextSeq3 = 1;
                        PERMIT_FIELDS.forEach(function(f) {
                            if (f === '省级项目编号') return;
                            var wk = dupStd.has(f) ? ('许可_' + f) : f;
                            if (pR3[f] !== undefined && pR3[f] !== null) out3[wk] = pR3[f];
                        });
                        copyTycToOut(out3, pR3);
                        var _blank3 = {};
                        mergedFields.forEach(function(f) { if (f !== '变更备注') _blank3[f] = ''; });
                        var _priAdded3 = _noteCollectAddedFields(_blank3, out3, _mergedFieldsSet);
                        var _segPri3 = _noteSegment(1, _noteNowStr, _priAdded3, '施工许可（假设主表，首次）');
                        if (_segPri3) _note3 = _segPri3;
                        _nextSeq3 = 2;
                        // basic 段
                        var _snapB3 = _snapObj(out3, mergedFields);
                        if (bMatch3) {
                            BASIC_FIELDS.forEach(function(f) {
                                if ((out3[f] === '' || out3[f] === undefined || out3[f] === null) && bMatch3[f] !== undefined) out3[f] = bMatch3[f];
                            });
                            copyTycToOut(out3, bMatch3);
                        }
                        var _bAdded3 = _noteCollectAddedFields(_snapB3, out3, _mergedFieldsSet);
                        if (_bAdded3.length) {
                            var _segB3 = _noteSegment(_nextSeq3, _noteNowStr, _bAdded3, '基本信息');
                            if (_segB3) { _note3 = _noteAppend(_note3, _segB3); _nextSeq3++; }
                        }
                        // complete 段
                        var _snapC3 = _snapObj(out3, mergedFields);
                        if (cRow3) {
                            COMPLETE_FIELDS.forEach(function(f) {
                                if (f === '省级项目编号' || f === '工程名称') return;
                                var wk = dupStd.has(f) ? ('竣工_' + f) : f;
                                if ((out3[wk] === '' || out3[wk] === undefined || out3[wk] === null) && cRow3[f] !== undefined) out3[wk] = cRow3[f];
                            });
                            copyTycToOut(out3, cRow3);
                        }
                        var _cAdded3 = _noteCollectAddedFields(_snapC3, out3, _mergedFieldsSet);
                        if (_cAdded3.length) {
                            var _segC3 = _noteSegment(_nextSeq3, _noteNowStr, _cAdded3, '竣工验收备案');
                            if (_segC3) { _note3 = _noteAppend(_note3, _segC3); _nextSeq3++; }
                        }
                        if (!out3['省级项目编号']) out3['省级项目编号'] = code3;
                        if (!out3['工程名称']) out3['工程名称'] = en3;
                        out3 = _cleanMergeOutRow(out3);
                        out3['变更备注'] = _note3;
                        mergedRows.push(out3);
                    });

                    // ---------- 第 4 阶段：写入「没被第 1/2/3 阶段处理过的 complete 独立行」（竣工验收 10 条独立，没匹配 permit 的情况 → 这就是你丢的那 10 条） ----------
                    (source.complete || []).forEach(function(cR4) {
                        var en4 = norm(cR4['工程名称']);
                        if (!en4) return;
                        if (processedCompleteNames.has(en4)) return;  // 已处理 → 跳过
                        processedCompleteNames.add(en4);
                        var code4 = norm(cR4['省级项目编号']) || '';
                        if (code4) processedBasicCodes.add(code4);
                        var bMatch4 = basicByCode.get(code4) || null;
                        // permit 匹配：先按 code，再兜底按工程名称
                        var pList4 = [];
                        if (code4 && permitsByCode.has(code4)) pList4 = permitsByCode.get(code4).slice();
                        if (!pList4.length) (source.permit || []).forEach(function(pR4) { if (norm(pR4['工程名称']) === en4) pList4.push(pR4); });
                        if (pList4.length > 1) {
                            var dpr4 = dedupRowsFull(pList4, null, null);
                            if (dpr4 && dpr4.rows && dpr4.rows.length) pList4 = dpr4.rows.concat([]);
                        }
                        if (!pList4.length) pList4 = [null];
                        pList4.forEach(function(pRow4) {
                            if (pRow4) {
                                var pk4 = _permitKey(pRow4);
                                if (pk4) processedPermitKeys.add(pk4);
                            }
                            var out4 = {};
                            mergedFields.forEach(function(f) { out4[f] = ''; });
                            // 【规则 1】孤行首次写入合并表 → 假设主表 = 竣工验收备案
                            var _note4 = '';
                            var _nextSeq4 = 1;
                            COMPLETE_FIELDS.forEach(function(f) {
                                if (f === '省级项目编号') return;  // code 最后兜底写
                                var wk = dupStd.has(f) ? ('竣工_' + f) : f;
                                if (cR4[f] !== undefined && cR4[f] !== null) out4[wk] = cR4[f];
                            });
                            // complete 的工程名称本身要写到标准列「工程名称」
                            if (en4) out4['工程名称'] = en4;
                            copyTycToOut(out4, cR4);
                            var _blank4 = {};
                            mergedFields.forEach(function(f) { if (f !== '变更备注') _blank4[f] = ''; });
                            var _priAdded4 = _noteCollectAddedFields(_blank4, out4, _mergedFieldsSet);
                            var _segPri4 = _noteSegment(1, _noteNowStr, _priAdded4, '竣工验收备案（假设主表，首次）');
                            if (_segPri4) _note4 = _segPri4;
                            _nextSeq4 = 2;
                            // basic 段
                            var _snapB4 = _snapObj(out4, mergedFields);
                            if (bMatch4) {
                                BASIC_FIELDS.forEach(function(f) {
                                    if ((out4[f] === '' || out4[f] === undefined || out4[f] === null) && bMatch4[f] !== undefined) out4[f] = bMatch4[f];
                                });
                                copyTycToOut(out4, bMatch4);
                            }
                            var _bAdded4 = _noteCollectAddedFields(_snapB4, out4, _mergedFieldsSet);
                            if (_bAdded4.length) {
                                var _segB4 = _noteSegment(_nextSeq4, _noteNowStr, _bAdded4, '基本信息');
                                if (_segB4) { _note4 = _noteAppend(_note4, _segB4); _nextSeq4++; }
                            }
                            // permit 段
                            var _snapP4 = _snapObj(out4, mergedFields);
                            if (pRow4) {
                                PERMIT_FIELDS.forEach(function(f) {
                                    if (f === '省级项目编号') return;
                                    var wk = dupStd.has(f) ? ('许可_' + f) : f;
                                    if ((out4[wk] === '' || out4[wk] === undefined || out4[wk] === null) && pRow4[f] !== undefined) out4[wk] = pRow4[f];
                                });
                                copyTycToOut(out4, pRow4);
                            }
                            var _pAdded4 = _noteCollectAddedFields(_snapP4, out4, _mergedFieldsSet);
                            if (_pAdded4.length) {
                                var _segP4 = _noteSegment(_nextSeq4, _noteNowStr, _pAdded4, '施工许可');
                                if (_segP4) { _note4 = _noteAppend(_note4, _segP4); _nextSeq4++; }
                            }
                            if (!out4['省级项目编号']) out4['省级项目编号'] = code4;
                            if (!out4['工程名称']) out4['工程名称'] = en4;
                            out4 = _cleanMergeOutRow(out4);
                            out4['变更备注'] = _note4;
                            mergedRows.push(out4);
                        });
                    });
                }

                // ✅🔴 最终合并结果全局全字段去重（严格满足用户：重复的数据即所有字段都相同，不会写入最终的合并表）
                var _beforeFinalDedup = mergedRows.length;
                var _finalDedup = dedupRowsFull(mergedRows, mergedFields, null);
                mergedRows = _finalDedup.rows.concat([]);
                var _afterFinalDedup = mergedRows.length;
                var _finalDup = _beforeFinalDedup - _afterFinalDedup;

                // 【第 3 层 兜底过滤 mergedFields】保存结果前最后过一遍黑名单（防止前面漏网）
                (function() {
                    var nf = [];
                    for (var _fbi2 = 0; _fbi2 < mergedFields.length; _fbi2++) {
                        var fn2 = mergedFields[_fbi2];
                        if (MERGE_EXPORT_BLACKLIST_FIELDS.has(fn2)) continue;
                        nf.push(fn2);
                    }
                    mergedFields = nf;
                    _mergedFieldsSet = new Set(mergedFields);
                })();

                // 保存结果
                _state.last = { rows: mergedRows, fields: mergedFields };
                currentData.merge = mergedRows.slice();
                currentData.mergeFields = mergedFields.slice();
                // ✅🔴 标记：这份 currentData.merge 是「合并导出 Tab 自己生成的」，Step B pbm 兜底检测到这个标记就跳过，避免回环累加导致第二次生成条数膨胀（10→30→40）
                currentData.__lastMergeFromMergeExport = true;
                return Promise.resolve({
                    ok: true,
                    rows: mergedRows,
                    fields: mergedFields,
                    stat: {
                        includeQueried: true,  // 兜底（旧代码兼容，实际上由 srcEnabled 控制）
                        srcEnabled: dedupStat.srcEnabled,
                        keepUnmatchedMaster: keepUnmatched,
                        queried: { basic: _state.queried.basic.length, permit: _state.queried.permit.length, complete: _state.queried.complete.length, tyc: (_state.queried.tyc || {}) },
                        uploadedCount: uploadedCount,
                        dedup: dedupStat,
                        afterSource: { basic: source.basic.length, permit: source.permit.length, complete: source.complete.length },
                        beforeFinalRowCount: _beforeFinalDedup,
                        finalRowDedupRemoved: _finalDup,
                        finalRowCount: mergedRows.length,
                        masterUsed: !!(masterRows && masterRows.length)
                    }
                });
            } catch (eTop) {
                return Promise.reject(new Error('生成合并表失败（顶层）：' + String(eTop.message || eTop)));
            }
        },

        // 导出 CSV
        exportCSV: function() {
            try {
                var gen = _state.last;
                if (!gen || !gen.rows || !gen.rows.length) return Promise.reject(new Error('还没有可导出的合并结果，请先点击「🔗 生成合并表」。'));
                // 合并导出 CSV：和 permit 合并表导出一致的数字列识别规则
                var basicNumFn = TAB_CONFIG.basic.isNumberField || (() => false);
                var permitNumFn = TAB_CONFIG.permit.isNumberField || (() => false);
                var completeNumFn = TAB_CONFIG.complete.isNumberField || (() => false);
                function isMergeNumber(f) {
                    if (!f) return false;
                    var fs = String(f);
                    if (fs.indexOf('许可_') === 0) {
                        var raw1 = fs.substring(3);
                        if (permitNumFn(raw1)) return true;
                        // 兜底：许可_ 前缀后还带角色_（比如 许可_施工单位_社会信用代码），取最后一段也当 permit 侧处理
                        var last1 = raw1.split('_').pop();
                        if (last1 !== raw1 && permitNumFn(last1)) return true;
                    }
                    if (fs.indexOf('竣工_') === 0) {
                        var raw2 = fs.substring(3);
                        if (completeNumFn(raw2)) return true;
                        var last2 = raw2.split('_').pop();
                        if (last2 !== raw2 && completeNumFn(last2)) return true;
                    }
                    if (basicNumFn(fs)) return true;
                    var last3 = fs.split('_').pop();
                    if (last3 !== fs && basicNumFn(last3)) return true;
                    return false;
                }
                var csv = generateCSV(gen.rows, gen.fields, isMergeNumber);
                var fn = '合并导出_' + (nowStr().replace(/[\s:]/g, '_')) + '.csv';
                downloadCSV(csv, fn);
                return Promise.resolve({ ok: true, file: fn, rows: gen.rows.length, fields: gen.fields.length });
            } catch (e) { return Promise.reject(new Error('导出失败：' + String(e.message || e))); }
        }
    };

    if (typeof Object.defineProperty === 'function' && window) {
        try { Object.defineProperty(window, '__mergeAPI_doc', {
            value: '合并导出 Tab 新 API。入口：window.__mergeAPI\n· uploadMaster(file):Promise  上传主表（单份）\n· removeMaster():Object  删除上传的主表（回到无主表模式）\n· uploadMulti(FileList):Promise  批量上传多 CSV，自动识别表类型（识别失败会进 errors 给出原因）\n· removeBatches(batchIds:Array):Object  删除批量上传中指定的文件（传 batchId 数组，支持单条或多条批量删除）\n· syncCurrentData():Promise   同步 basic/permit/complete 三个提取 Tab 的 currentData\n· generate(opts):Promise      主流程：收集→去重→外键合并→主表基准展开→变更备注\n· exportCSV():Promise         下载 CSV\n变更备注扩展：在控制台定义 window.__mergeBuildChangeNote = function(masterRow, {basic,permit,complete,index,expandTotal,fields,ctx}) { return "你的备注字符串"; } 即可（后续你告诉具体规则就正式写入）',
            writable: false, enumerable: true, configurable: false
        }); } catch (_e) {}
    }

    // ============================================================
    // ===== UI 绑定（文件点击/拖拽 + 按钮）
    // ============================================================
    function __bindUI() {
        function uStatus(html, cls) { updateStatus('merge-status', html, cls); }
        function showErrors(list) {
            var el = safeGetElement('merge-errors');
            if (!el) return;
            if (!list || !list.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
            var lines = list.map(function(e, i) {
                return '<div style="margin-bottom:6px;"><b style="color:#a94442;">' + (i + 1) + '. ' + (e.file || '未知文件') + '</b><br><pre style="margin:2px 0 0 12px;padding:0;background:transparent;border:0;white-space:pre-wrap;word-break:break-all;color:#922;">' + String(e.reason || '').replace(/</g, '&lt;') + '</pre></div>';
            }).join('');
            el.innerHTML = lines;
            el.style.display = 'block';
        }
        function refreshStatusSummary() {
            var parts = [];
            if (_state.master) parts.push('📌 主表：<b>' + _state.master.file + '</b>（' + _state.master.rows.length + ' 行，<i>' + (_state.master.detectedLabel || '自定义主表') + '</i>）');
            if (_state.batches && _state.batches.length) {
                var cnt = {};
                _state.batches.forEach(function(b) { cnt[b.type] = (cnt[b.type] || 0) + 1; });
                parts.push('📚 识别成功：<b>' + _state.batches.length + '</b> 份（' + Object.keys(cnt).map(function(k) {
                    return (T_RULES[k] ? T_RULES[k].label : k) + '×' + cnt[k];
                }).join('、') + '）');
            }
            if (_state.errors && _state.errors.length) parts.push('⚠️ 识别失败：<b style="color:#c0392b;">' + _state.errors.length + '</b> 份（详情见下方红色错误区）');
            var q = _state.queried;
            // ✅🔴 状态行施工许可数也含 permitBasicMerge（与 checkbox 计数一致，避免显示 0 误导）
            var _pbmLen = (currentData && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows)) ? currentData.permitBasicMerge.rows.length : 0;
            parts.push('🧩 查询数据同步：基本 ' + (q.basic || []).length + ' · 施工许可 ' + Math.max((q.permit || []).length, _pbmLen) + ' · 竣工 ' + (q.complete || []).length);
            if (_state.last && _state.last.rows) parts.push('✅ 已生成合并表：<b>' + _state.last.rows.length + '</b> 行 × ' + _state.last.fields.length + ' 列');
            // ✅ 刷新 4 个 checkbox 的计数显示
            try {
                function setCnt(id, n) {
                    var el = document.getElementById(id);
                    if (el) el.textContent = String(n | 0);
                }
                setCnt('merge-src-basic-cnt',    (q.basic || []).length);
                // ✅🔴 修复：施工许可计数需包含「施工许可 Tab 提取的合并表 permitBasicMerge.rows」
                //   因为天眼查补全 target=permit 且 kind=permitBasicMerge 时，会把 currentData.permit 清空（popup.js:4788），
                //   只保留 currentData.permitBasicMerge.rows。若只读 q.permit 就会显示 0，但实际合并时 Step B 会用 permitBasicMerge。
                //   取 max(纯permit, 合并表) 避免同一批数据被双重计数导致虚高。
                var _permitRaw = (q.permit || []).length;
                var _permitMerge = (currentData && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows)) ? currentData.permitBasicMerge.rows.length : 0;
                setCnt('merge-src-permit-cnt',   Math.max(_permitRaw, _permitMerge));
                setCnt('merge-src-complete-cnt', (q.complete || []).length);
                // ✅🔴 修复：天眼查补全计数需包含 tyc.permitBasicMerge（施工许可合并表经天眼查补全后的行）
                //   因为补全 target=permit(合并表) 时，补全行写回 currentData.permitBasicMerge，被 extractTycRows 提取到 tyc.permitBasicMerge，
                //   而非 tyc.permit（tyc.permit 来自 q.permit，已被清空）。漏算就会显示 0。
                var tyc = q.tyc || {};
                var tycTotal = (tyc.basic || []).length + (tyc.permit || []).length + (tyc.complete || []).length + (tyc.permitBasicMerge || []).length;
                setCnt('merge-src-tyc-cnt', tycTotal);
            } catch (_eCnt) {}
            // ✅🔴 新增：刷新主表信息 + 批量上传列表（带单条删除 + 全选/批量删除选中）
            try {
                var mi = safeGetElement('merge-master-info');
                if (mi) {
                    if (_state.master) {
                        mi.innerHTML = '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:nowrap;">'
                            + '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;">✅ 已上传：<b>' + _state.master.file + '</b>（' + _state.master.rows.length + ' 行，<i>' + (_state.master.detectedLabel || '自定义主表') + '</i>）</span>'
                            + '<button type="button" id="merge-master-del" class="btn btn-danger" style="padding:1px 10px;font-size:12px;height:auto;border-radius:4px;white-space:nowrap;flex:0 0 auto;line-height:1.4;">删除</button>'
                            + '</div>';
                        var btnMD = document.getElementById('merge-master-del');
                        if (btnMD) btnMD.addEventListener('click', function() {
                            if (!confirm('确定删除上传的主表吗？删除后将进入无主表模式。')) return;
                            var r = window.__mergeAPI.removeMaster();
                            if (r && r.ok) { refreshStatusSummary(); showErrors(_state.errors); uStatus('✅ 主表已删除（当前将按无主表模式合并）', 'success'); }
                            else uStatus('❌ 删除主表失败：' + ((r && r.error) || '未知错误'), 'error');
                        });
                    } else {
                        mi.innerHTML = '<div style="opacity:0.65;">（未上传主表，点击或拖拽 CSV 到上方区域作为合并基准）</div>';
                    }
                }
                var bl = safeGetElement('merge-batch-list');
                if (bl) {
                    if (!_state.batches || !_state.batches.length) {
                        bl.innerHTML = '<div style="opacity:0.65;padding:6px;">（尚未批量上传 CSV；如需删除，请先上传）</div>';
                    } else {
                        var rowsHtml = [];
                        rowsHtml.push('<div style="display:flex;align-items:center;gap:6px;padding:2px 4px;border-bottom:1px dashed #e5e7eb;margin-bottom:4px;">'
                            + '<span style="flex:0 0 40px;font-weight:bold;">序号</span>'
                            + '<span style="flex:1;font-weight:bold;">文件名 / 识别类型</span>'
                            + '<span style="flex:0 0 110px;font-weight:bold;text-align:right;">操作</span>'
                            + '</div>');
                        _state.batches.forEach(function(b, i) {
                            rowsHtml.push('<div style="display:flex;align-items:center;gap:6px;padding:4px;border-bottom:1px solid #f3f4f6;">'
                                + '<label style="flex:0 0 40px;cursor:pointer;display:flex;align-items:center;gap:4px;">'
                                + '<input type="checkbox" class="merge-batch-chk" value="' + String(b.batchId).replace(/"/g, '&quot;') + '">'
                                + (i + 1)
                                + '</label>'
                                + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
                                + '<b>' + String(b.file || '').replace(/</g, '&lt;') + '</b>'
                                + ' <span style="color:#1677ff;">[' + (b.label || b.type || '') + ']</span>'
                                + ' <span style="opacity:0.7;">· ' + (b.rows ? b.rows.length : 0) + ' 行</span>'
                                + '</span>'
                                + '<span style="flex:0 0 110px;text-align:right;">'
                                + '<button type="button" class="merge-batch-del-one btn btn-danger" data-id="' + String(b.batchId).replace(/"/g, '&quot;') + '" style="padding:1px 8px;font-size:12px;height:auto;border-radius:4px;">删除</button>'
                                + '</span>'
                                + '</div>');
                        });
                        bl.innerHTML = rowsHtml.join('');
                        // 单条删除
                        bl.querySelectorAll('.merge-batch-del-one').forEach(function(btn) {
                            btn.addEventListener('click', function() {
                                var id = btn.getAttribute('data-id') || '';
                                if (!id) return;
                                if (!confirm('确定删除此文件吗？')) return;
                                var r = window.__mergeAPI.removeBatches([id]);
                                if (r && r.ok) { refreshStatusSummary(); showErrors(_state.errors); uStatus('✅ 已删除 ' + (r.removed | 0) + ' 份（剩余 ' + (r.remaining | 0) + ' 份）', 'success'); }
                                else uStatus('❌ 删除失败：' + ((r && r.error) || '未知错误'), 'error');
                            });
                        });
                    }
                }
            } catch (_eList) {}
            uStatus(parts.join('　|　'), 'info');
        }
        // ✅ 新功能：批量上传区域的"全选"按钮（选所有 batches）和"删除选中"按钮
        try {
            var btnBatchSelAll = safeGetElement('merge-batch-selAll');
            if (btnBatchSelAll) btnBatchSelAll.addEventListener('click', function() {
                var chks = document.querySelectorAll('#merge-batch-list .merge-batch-chk');
                if (!chks || !chks.length) { uStatus('⚠️ 当前没有已上传的批量文件可供勾选', 'warn'); return; }
                var anyUnchecked = false;
                chks.forEach(function(c) { if (!c.checked) anyUnchecked = true; });
                chks.forEach(function(c) { c.checked = anyUnchecked; });
            });
            var btnBatchDelSel = safeGetElement('merge-batch-delSel');
            if (btnBatchDelSel) btnBatchDelSel.addEventListener('click', function() {
                var chks = document.querySelectorAll('#merge-batch-list .merge-batch-chk');
                var ids = [];
                chks.forEach(function(c) { if (c.checked && c.value) ids.push(String(c.value)); });
                if (!ids.length) { uStatus('⚠️ 请先勾选要删除的文件（可点上方「全选」）', 'warn'); return; }
                if (!confirm('确定删除选中的 ' + ids.length + ' 份文件吗？')) return;
                var r = window.__mergeAPI.removeBatches(ids);
                if (r && r.ok) { refreshStatusSummary(); showErrors(_state.errors); uStatus('✅ 已删除选中 ' + (r.removed | 0) + ' 份（剩余 ' + (r.remaining | 0) + ' 份）', 'success'); }
                else uStatus('❌ 删除选中失败：' + ((r && r.error) || '未知错误'), 'error');
            });
        } catch (_eBt) {}
        // ✅ 4 个 checkbox 勾选状态实时同步到 _state.srcEnabled + 刷新状态栏（点 checkbox 立即生效）
        try {
            ['basic', 'permit', 'complete', 'tyc'].forEach(function(k) {
                var cb = document.getElementById('merge-src-' + k);
                if (!cb) return;
                cb.addEventListener('change', function() {
                    try { _state.srcEnabled[k] = !!cb.checked; } catch (_) {}
                    refreshStatusSummary();
                });
            });
        } catch (_eCb) {}
        // ✅ 全选 / 全不选按钮：当前 4 个都勾上就「一键全不选」；只要有 1+ 个没勾 → 一键全选
        try {
            var btnSel = document.getElementById('merge-selAllNone');
            if (btnSel) {
                btnSel.addEventListener('click', function() {
                    var cbs = [];
                    ['basic', 'permit', 'complete', 'tyc'].forEach(function(k) {
                        var cb = document.getElementById('merge-src-' + k);
                        if (cb) cbs.push(cb);
                    });
                    if (!cbs.length) return;
                    var allChecked = cbs.every(function(cb) { return cb.checked; });
                    var newVal = !allChecked;  // 全勾 → 下一步是全不选；否则全选
                    cbs.forEach(function(cb) { cb.checked = newVal; });
                    try {
                        ['basic', 'permit', 'complete', 'tyc'].forEach(function(k) {
                            var cb = document.getElementById('merge-src-' + k);
                            if (cb) _state.srcEnabled[k] = !!cb.checked;
                        });
                    } catch (_) {}
                    refreshStatusSummary();
                });
            }
        } catch (_eSel) {}
        function bindUploadClick(areaId, inputId, onFiles, multiple) {
            var area = safeGetElement(areaId), inp = safeGetElement(inputId);
            if (!area || !inp) return;
            area.addEventListener('click', function() { inp.click(); });
            inp.addEventListener('change', function(ev) {
                var fs = ev && ev.target ? ev.target.files : null;
                if (!fs || !fs.length) return;
                var arr = []; for (var i = 0; i < fs.length; i++) arr.push(fs[i]);
                onFiles(multiple ? arr : arr[0]).catch(function(err) { alert('上传失败：' + String(err.message || err)); }).then(function() { refreshStatusSummary(); showErrors(_state.errors); });
                inp.value = '';
            });
            // 拖拽
            ['dragenter', 'dragover'].forEach(function(ev) {
                area.addEventListener(ev, function(e) { e.preventDefault(); e.stopPropagation(); try { area.style.borderColor = '#1677ff'; area.style.background = '#e6f4ff'; } catch (_) {} });
            });
            ['dragleave', 'drop'].forEach(function(ev) {
                area.addEventListener(ev, function(e) { e.preventDefault(); e.stopPropagation(); try { area.style.borderColor = ''; area.style.background = ''; } catch (_) {} });
            });
            area.addEventListener('drop', function(e) {
                var fs = e && e.dataTransfer ? e.dataTransfer.files : null;
                if (!fs || !fs.length) return;
                var arr = []; for (var i = 0; i < fs.length; i++) {
                    var n = fs[i].name || '';
                    if (/\.(csv)$/i.test(n) || !n) arr.push(fs[i]);
                }
                if (!arr.length) { alert('拖拽文件仅支持 .csv'); return; }
                onFiles(multiple ? arr : arr[0]).catch(function(err) { alert('拖拽上传失败：' + String(err.message || err)); }).then(function() { refreshStatusSummary(); showErrors(_state.errors); });
            });
        }

        // 主表上传
        bindUploadClick('merge-upload-master', 'merge-master-file', function(file) {
            return window.__mergeAPI.uploadMaster(file).then(function(r) {
                uStatus('✅ 主表上传成功：' + (r && r.master ? r.master.file : '') + '（' + (r && r.master ? r.master.rows.length : 0) + ' 行）。' + (r && r.note ? '<br>' + r.note : ''), 'success');
            });
        }, false);

        // 多表批量上传
        bindUploadClick('merge-upload-multi', 'merge-multi-file', function(files) {
            uStatus('⏳ 正在批量识别 ' + files.length + ' 个 CSV 的表类型（无兜底，识别失败会给出具体原因）…', 'info');
            return window.__mergeAPI.uploadMulti(files).then(function(r) {
                if (r.failed && r.failed.length) {
                    uStatus('⚠️ 批量上传完成：成功 ' + r.success.length + ' / 失败 ' + r.failed.length + ' / 总计 ' + r.total + '。失败原因详见下方红色错误区。', 'warn');
                    showErrors(_state.errors);
                } else {
                    uStatus('✅ 批量识别全部成功：' + r.success.length + ' 份 CSV（' + uq(r.success.map(function(s) { return s.label; })).join('、') + '）。', 'success');
                    showErrors(_state.errors);
                }
            });
        }, true);

        // 同步查询数据（每次切 Tab 时自动 sync 一次）
        try {
            document.querySelectorAll('.tabs .tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var key = tab.getAttribute('data-tab');
                    if (key === 'merge') {
                        window.__mergeAPI.syncCurrentData().then(function() { refreshStatusSummary(); }).catch(function(e) { uStatus('同步查询数据失败：' + String(e.message || e), 'error'); });
                    }
                });
            });
        } catch (_e) {}

        // 按钮：生成
        var btnGen = safeGetElement('merge-generate');
        if (btnGen) btnGen.addEventListener('click', function() {
            uStatus('⏳ 正在生成合并表…', 'info');
            // 生成前先主动 sync 一次三 Tab currentData + 天眼查补全行
            window.__mergeAPI.syncCurrentData().catch(function() { return Promise.resolve({ ok: false }); }).then(function() {
                var opts = {
                    keepUnmatchedMaster: (safeGetElement('merge-keep-unmatched-master') || {}).value
                };
                return window.__mergeAPI.generate(opts);
            }).then(function(r) {
                if (!r || !r.rows || !r.rows.length) {
                    uStatus('⚠️ 生成了 0 行结果（请检查：主表外键是否对不上三表？或是否需要开启「保留匹配不到的主表行」？或需要把对应数据源 checkbox 勾上？）。<br>统计：' +
                        (r && r.stat ? ('来源 basic=' + r.stat.afterSource.basic + '/permit=' + r.stat.afterSource.permit + '/complete=' + r.stat.afterSource.complete + '；上传批：fusion=' + r.stat.uploadedCount.fusion + '/basic=' + r.stat.uploadedCount.basic + '/permit=' + r.stat.uploadedCount.permit + '/complete=' + r.stat.uploadedCount.complete + '；数据源勾选：' + (Object.keys(r.stat.srcEnabled || {}).map(function(k) { return k + '=' + (r.stat.srcEnabled[k] ? '✅' : '❌'); }).join('、'))) : ''), 'warn');
                    return;
                }
                var tbl = safeGetElement('merge-table');
                if (tbl) { tbl.style.display = 'block'; renderTable('merge-table', r.rows, r.fields); }
                var s = r.stat || {};
                var srcEna = s.srcEnabled || {};
                uStatus('✅ 合并表生成成功：<b>' + s.finalRowCount + '</b> 行 × ' + r.fields.length + ' 列。来源 basic=' + s.afterSource.basic + '·permit=' + s.afterSource.permit + '·complete=' + s.afterSource.complete +
                    (s.masterUsed ? '（主表基准，保留主表所有自定义列 + 天眼查补全列）' : '（无主表，以施工许可为中心 1:N 展开）') +
                    '。优先级规则：施工许可合并表 > 天眼查补全行 > 三Tab 纯查询 > 上传CSV。' +
                    '。去重统计：basic 去重' + (s.dedup.basic ? (s.dedup.basic.dup + '（分层详情：' + JSON.stringify(s.dedup.basic.perTierDup || {}) + '）') : 0) +
                    '·permit去重' + (s.dedup.permit ? (s.dedup.permit.dup + '（分层详情：' + JSON.stringify(s.dedup.permit.perTierDup || {}) + '）') : 0) +
                    '·complete去重' + (s.dedup.complete ? (s.dedup.complete.dup + '（分层详情：' + JSON.stringify(s.dedup.complete.perTierDup || {}) + '）') : 0) +
                    '。数据源勾选：' + (['basic','permit','complete','tyc'].map(function(k) { return k + '=' + (srcEna[k] ? '✅' : '❌'); }).join('、')) +
                    '。<br>💡 变更备注列目前为「接口占位空值」，之后告诉我备注规则即可（或先在控制台定义 window.__mergeBuildChangeNote 试用）。', 'success');
                refreshStatusSummary();
            }).catch(function(err) {
                uStatus('❌ 合并失败：' + String(err.message || err), 'error');
                alert('❌ 合并生成失败，详细原因：\n\n' + String(err.message || err));
            });
        });

        // 按钮：导出
        var btnEx = safeGetElement('merge-export');
        if (btnEx) btnEx.addEventListener('click', function() {
            window.__mergeAPI.exportCSV().then(function(r) {
                uStatus('✅ 已导出合并表 CSV：' + (r && r.file ? r.file : '') + '（' + (r && r.rows ? r.rows : 0) + ' 行）', 'success');
            }).catch(function(err) { alert('导出失败：' + String(err.message || err)); });
        });

        // 启动：一次 sync + 初始状态
        window.__mergeAPI.syncCurrentData().then(function() { refreshStatusSummary(); }).catch(function() { refreshStatusSummary(); });
    }

    // DOMContentLoaded 后绑 UI（避免元素还没生成）
    try {
        if (document && document.readyState && document.readyState !== 'loading') __bindUI();
        else if (document && document.addEventListener) document.addEventListener('DOMContentLoaded', __bindUI);
        else setTimeout(__bindUI, 300);
    } catch (_eTop) { setTimeout(__bindUI, 400); }
})();

// ============================================================
// ===== 去重上传 Tab =====
// ============================================================
const uploadArea = safeGetElement('upload-area');
const uploadFile = safeGetElement('upload-file');
const uploadInfo = safeGetElement('upload-info');
const uploadType = safeGetElement('upload-type');
const uploadClearBtn = safeGetElement('upload-clear');

if (uploadArea && uploadFile && uploadInfo) {
    uploadArea.addEventListener('click', () => uploadFile.click());

    uploadFile.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = ev.target.result;
                const rows = parseCSV(text);
                const type = uploadType ? uploadType.value : 'basic';
                uploadedData[type] = rows;

                const typeName = type === 'basic' ? '基本信息' : type === 'permit' ? '施工许可' : '竣工验收备案';
                uploadInfo.textContent = `✅ 已上传 ${file.name}，共 ${rows.length} 条记录（${typeName}）。后续提取将自动排除这些记录。`;
                uploadInfo.style.color = '#389e0d';
            } catch (err) {
                uploadInfo.textContent = '❌ 解析CSV失败: ' + err.message;
                uploadInfo.style.color = '#cf1322';
            }
        };
        reader.onerror = () => {
            uploadInfo.textContent = '❌ 读取文件失败';
            uploadInfo.style.color = '#cf1322';
        };
        reader.readAsText(file, 'UTF-8');
    });

    if (uploadClearBtn) {
        uploadClearBtn.addEventListener('click', () => {
            const type = uploadType ? uploadType.value : 'basic';
            uploadedData[type] = [];
            if (uploadFile) uploadFile.value = '';
            uploadInfo.textContent = '已清除上传数据';
            uploadInfo.style.color = '#666';
        });
    }
}

// ============================================================
// ===== 🔴✅ 合并 Tab 新增工具函数（同名表合并去重 + 主表差异 + 完整字段）=====
// ============================================================
// 1) 生成当前时间字符串（给变更备注用，格式 YYYY-MM-DD HH:mm:ss）
function nowStr() {
    try {
        const d = new Date();
        const p = n => (n < 10 ? '0' + n : '' + n);
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
               p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    } catch (e) { return ''; }
}



// 简单 CSV 解析（支持 BOM、双引号、转义）
function parseCSV(text) {
    if (!text) return [];
    // 去除 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split(/\r?\n/);
    const rows = [];
    let headers = null;

    for (let li = 0; li < lines.length; li++) {
        if (!lines[li] || lines[li].trim() === '') continue;

        // 简单解析：按逗号分割，处理双引号包裹的内容
        const fields = [];
        let cur = '';
        let inQuotes = false;
        let i = 0;
        while (i < lines[li].length) {
            const ch = lines[li][i];
            if (ch === '"') {
                if (inQuotes && lines[li][i + 1] === '"') {
                    // 转义的双引号
                    cur += '"';
                    i += 2;
                    continue;
                }
                inQuotes = !inQuotes;
                i++;
            } else if (ch === ',' && !inQuotes) {
                fields.push(cur.trim());
                cur = '';
                i++;
            } else {
                cur += ch;
                i++;
            }
        }
        fields.push(cur.trim());

        if (headers === null) {
            headers = fields.map(f => f.replace(/"/g, '').trim());
        } else {
            const row = {};
            for (let h = 0; h < headers.length; h++) {
                row[headers[h]] = fields[h] || '';
            }
            rows.push(row);
        }
    }
    return rows;
}

// ============================================================
// ===== 🔴✅ 需求1/2/3 事件绑定（省级编号下拉添加、查询范围 pageMode、仅列表CSV导出）=====
// ============================================================
// 1) pageMode change + fetchMode change → 同步禁用/启用页码框，初始化一次
['basic', 'permit', 'complete'].forEach(type => {
    const modeEl = safeGetElement(type + '-pageMode');
    const fetchModeEl = safeGetElement(type + '-fetchMode');
    // 🔴 初始值同步一次（包含极速模式强制起始页=1，以及「获取全部数据」按钮显示/隐藏、整行隐藏）
    try { syncFetchModeInputs(type); } catch (e) {}
    try { syncPageModeInputs(type); } catch (e) {}
    if (modeEl) {
        modeEl.addEventListener('change', () => {
            try { syncPageModeInputs(type); } catch (e) {}
            console.log('[pageMode] ' + type + ' → ' + modeEl.value);
        });
    }
    // 🔴 抓取模式切换：极速/兼容 → 同步起始页禁用状态
    if (fetchModeEl) {
        fetchModeEl.addEventListener('change', () => {
            try { syncFetchModeInputs(type); } catch (e) {}
            console.log('[fetchMode] ' + type + ' → ' + fetchModeEl.value);
        });
    }
    // 2) 「➕ 添加」按钮（省级项目编号下拉添加当前输入值）
    const addBtn = document.querySelector('.btn-combo[data-type="' + type + '"][data-action="addCode"]');
    if (addBtn) {
        addBtn.addEventListener('click', () => handleAddCodeBtn(type));
    }
});

// ============================================================
// ===== Tab 切换 =====
// ============================================================
// 优先使用 HTML 内联兜底（popup.html 已在每个 .tab 上加了 onclick → window.__switchTab）
// 只有当 HTML 兜底未注入时，才在这里二次绑定（兼容老版本/手动改了 HTML 的情况）
if (typeof window.__switchTab !== 'function') {
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            var target = e.target && e.target.getAttribute ? e.target.getAttribute('data-tab') : '';
            if (!target) return;
            document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
            try { e.target.classList.add('active'); } catch (e1) {}
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const content = safeGetElement('tab-' + target);
            if (content) content.classList.add('active');
        });
    });
}

// ============================================================
// ===== 🔴天眼查补全 Tab（完整主逻辑）=====
// ============================================================
(function () {
    const STORAGE_CACHE_KEY = 'tianyancha_cache_v1';
    const SUB_KEYS = ['社会信用代码', '电话', '法人', '地址', '成立日期']; // 5 个新增字段
    const SUB_FIELD_MAP = { '社会信用代码': 'creditCode', '电话': 'phone', '法人': 'legalPerson', '地址': 'address', '成立日期': 'establishDate' };

    // 四个补全目标 → 各自的：单位列集合（列名 -> 前缀）
    //   每条记录形如：{ '建设单位': '广州XX开发公司', ... }
    //   我们会在「建设单位」字段后（该字段列位置的后面）插入 建设单位_社会信用代码、建设单位_电话、建设单位_法人、建设单位_地址、建设单位_成立日期 共 5 列
    const TARGET_UNIT_COLS = {
        basic:    { '建设单位': '建设单位_' },
        permit:   { '建设单位': '建设单位_', '工程总承包单位': '工程总承包单位_', '勘察单位': '勘察单位_', '设计单位': '设计单位_', '施工单位': '施工单位_', '监理单位': '监理单位_' },
        complete: { /* 竣工备案接口预占，暂不补字段；用户日后可扩充 */ },
        // 🔴✅ 合并表字段名严格对应用户给出的清单（注意：只有「建设单位」加了许可_前缀，其余 5 类单位均为纯列名）
        //     许可_建设单位（第19列） / 工程总承包单位（第23列） / 勘察单位（第24列） / 设计单位（第25列） / 施工单位（第26列） / 监理单位（第27列）
        merge:    { '许可_建设单位': '建设单位_', '工程总承包单位': '工程总承包单位_', '勘察单位': '勘察单位_', '设计单位': '设计单位_', '施工单位': '施工单位_', '监理单位': '监理单位_' }
    };

    // 运行态
    let tycRunning = false;
    let lastTarget = '';
    let lastFields = [];           // 补全后的 fields（含新插入列）
    let lastData = [];             // 补全后数据
    let lastDataBackup = null;     // 回滚用：当前 tab 的 queried/uploaded 备份（只备份我们可能改动的引用 + 做深拷贝）
    let backupAffected = null;     // { type:'permit', where:'queried' } 或 { type:'merge', where:'current' }

    // ---- 状态/进度小工具 ----
    function setStatus(msg, kind) { updateStatus('tyc-status', msg, kind); }
    function setStat(id, txt) { const el = safeGetElement(id); if (el) el.textContent = String(txt == null ? '' : txt); }
    function setProgress(cur, total) {
        const pb = safeGetElement('tyc-progress');
        const fill = pb ? pb.querySelector('.progress-bar-fill') : null;
        if (!pb || !fill) return;
        if (total <= 0) { pb.style.display = 'none'; fill.style.width = '0%'; return; }
        pb.style.display = 'block';
        const p = Math.max(0, Math.min(100, Math.round((cur / total) * 100)));
        fill.style.width = p + '%';
    }

    // ---- 缓存读写 ----
    function readCache() {
        try {
            const raw = localStorage.getItem(STORAGE_CACHE_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) { return {}; }
    }
    function writeCache(c) {
        try { localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(c || {})); } catch (e) {}
    }

    // ---- 根据当前 target 选择「要处理的数据 + 处理后写回哪里」 ----
    function resolveTargetContext(target) {
        target = String(target || 'permit').trim();
        if (!TARGET_UNIT_COLS[target]) target = 'permit';
        function pickSource(type) {
            // 🔴🚧 合并 Tab 旧实现（queriedData/mergeUploadedData）已移除，优先级简化为：
            // 提取 Tab 数据 currentData[type] > 去重上传 Tab 数据 uploadedData[type]（和旧的 uploadedData 含义一致，保留去重上传功能）
            if (Array.isArray(currentData[type]) && currentData[type].length) return currentData[type];
            if (Array.isArray(uploadedData[type]) && uploadedData[type].length) return uploadedData[type];
            return [];
        }
        if (target === 'basic') {
            const arr = pickSource('basic');
            return {
                target, rows: cloneArr(arr),
                original: arr,
                writeBack: (newRows, fields) => {
                    // ✅ 天眼查补全后：fields 按 anchor 规则重排（建设单位后插入 5 个补全列）+ 过滤 _匹配单位名
                    var fRawB = (Array.isArray(fields) && fields.length) ? fields.slice() : BASIC_FIELDS.slice();
                    var ansB = anchorInsertTycColumnsIntoFields(fRawB, null, newRows || [], { appendCustomColsAtEnd: true });
                    if (Array.isArray(currentData.basic)) currentData.basic = newRows.slice();
                    // 🔴🚧 同时同步到新合并接口的内部 queried 副本（保证后续合并导出重构时能拿到天眼查补全后的数据）
                    try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                    lastDataBackup = null;
                    try {
                        const tbl = safeGetElement('basic-table');
                        if (tbl && newRows.length) {
                            tbl.style.display = 'block';
                            renderTable('basic-table', newRows, ansB.fields || BASIC_FIELDS);
                        }
                    } catch (e) {}
                }
            };
        }
        if (target === 'permit') {
            // 🔴✅ 修复用户反馈：目标选「施工许可」时，要根据当前缓存里的"最新那张表"智能选数据源
            //     优先级：currentData.permitBasicMerge（用户刚点过「🔗 提取合并表」，合并表）
            //           → pickSource('permit')（纯施工许可单表）
            const hasBasicMerge = !!(currentData && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows) && currentData.permitBasicMerge.rows.length);
            let rowsSrc;
            let kind;
            let fieldsHint;
            let unitColsOverride = null;
            let permitBasicMergeOrigFields = null;
            if (hasBasicMerge) {
                rowsSrc = currentData.permitBasicMerge.rows;
                kind = 'permitBasicMerge';
                permitBasicMergeOrigFields = Array.isArray(currentData.permitBasicMerge.fields) && currentData.permitBasicMerge.fields.length ? currentData.permitBasicMerge.fields.slice() : null;
                fieldsHint = permitBasicMergeOrigFields;
                // ✅ 合并表有「许可_建设单位」等前缀列，用 merge 的 unitCols 映射（许可_XXX → 单位_前缀），这样天眼查补全才能扫到对应的 6 类单位
                unitColsOverride = TARGET_UNIT_COLS.merge || null;
            } else {
                rowsSrc = pickSource('permit');
                kind = 'purePermit';
                fieldsHint = PERMIT_FIELDS.slice();
            }
            return {
                target, rows: cloneArr(rowsSrc),
                original: rowsSrc,
                originalFieldsHint: fieldsHint || null,
                kind: kind,
                unitColsOverride: unitColsOverride,
                writeBack: (newRows, fields) => {
                    lastDataBackup = null;
                    try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                    if (kind === 'permitBasicMerge') {
                        // ✅ 需求 2 互覆盖：补全写回的是合并表 → 把纯 permit 单表缓存清空（避免用户误以为当前还是纯 permit）
                        try { if (Array.isArray(currentData.permit)) { currentData.permit = []; } } catch (e) {}
                        // ✅ 天眼查补全后：fields 按 anchor 规则重排 + 过滤 _匹配单位名列
                        var fRaw0 = (Array.isArray(fields) && fields.length) ? fields.slice() : (permitBasicMergeOrigFields || null);
                        var ans0 = anchorInsertTycColumnsIntoFields(fRaw0 || [], null, newRows || [], { appendCustomColsAtEnd: true });
                        const fSave = ans0.fields;
                        currentData.permitBasicMerge = { rows: newRows.slice(), fields: fSave };
                        // 同步一份到 currentData.merge / mergeFields：用户切到合并导出 Tab 点「融合已查询数据」也能拿到补全后的合并表
                        currentData.merge = newRows.slice();
                        if (fSave) currentData.mergeFields = fSave.slice();
                        try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                        // 预览：施工许可 Tab 展示补全后的合并表
                        try {
                            const tbl = safeGetElement('permit-table');
                            if (tbl && newRows.length) {
                                tbl.style.display = 'block';
                                renderTable('permit-table', newRows, fSave || newRows);
                            }
                        } catch (e) {}
                    } else {
                        // ✅ 需求 2 互覆盖 + 修复问题 2：补全写回的是纯 permit 单表 → 把旧的 permitBasicMerge 合并表缓存清掉！
                        // 否则施工许可 Tab 预览按钮看到 permitBasicMerge.rows 非空，会优先显示旧合并表，用户看到的就不是刚补全的纯 permit 单表了
                        try { if (currentData && currentData.permitBasicMerge) { try { delete currentData.permitBasicMerge; } catch (eDel) { currentData.permitBasicMerge = null; } } } catch (e) {}
                        // 同时 currentData.merge 如果是上次 permitBasicMerge 同步过去的也清掉，避免切合并导出 Tab 融合时拿到旧数据
                        try { if (Array.isArray(currentData.merge)) { currentData.merge = []; } if (Array.isArray(currentData.mergeFields)) { currentData.mergeFields = []; } } catch (e) {}
                        // ✅ 纯 permit 单表写回：fields 也按 anchor 规则重排（建设单位/施工单位/监理单位/设计单位/勘察单位 5 列后插入对应 5 个天眼查补全列）
                        var fRawP = (Array.isArray(fields) && fields.length) ? fields.slice() : PERMIT_FIELDS.slice();
                        var ansP = anchorInsertTycColumnsIntoFields(fRawP, null, newRows || [], { appendCustomColsAtEnd: true });
                        if (Array.isArray(currentData.permit)) currentData.permit = newRows.slice();
                        try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                        try {
                            const tbl = safeGetElement('permit-table');
                            if (tbl && newRows.length) {
                                tbl.style.display = 'block';
                                renderTable('permit-table', newRows, ansP.fields || PERMIT_FIELDS);
                            }
                        } catch (e) {}
                    }
                }
            };
        }
        if (target === 'complete') {
            const arr = pickSource('complete');
            return {
                target, rows: cloneArr(arr),
                original: arr,
                writeBack: (newRows, fields) => {
                    // ✅ 天眼查补全后：fields 按 anchor 规则重排（建设单位/施工单位/监理单位/设计单位/勘察单位 后插入对应 5 个补全列）+ 过滤 _匹配单位名
                    var fRawC = (Array.isArray(fields) && fields.length) ? fields.slice() : COMPLETE_FIELDS.slice();
                    var ansC = anchorInsertTycColumnsIntoFields(fRawC, null, newRows || [], { appendCustomColsAtEnd: true });
                    if (Array.isArray(currentData.complete)) currentData.complete = newRows.slice();
                    try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                    lastDataBackup = null;
                    try {
                        const tbl = safeGetElement('complete-table');
                        if (tbl && newRows.length) {
                            tbl.style.display = 'block';
                            renderTable('complete-table', newRows, ansC.fields || COMPLETE_FIELDS);
                        }
                    } catch (e) {}
                }
            };
        }
        // merge（新合并导出 Tab 的 currentData.merge 或 施工许可 Tab 的 currentData.permitBasicMerge）
        // 优先：currentData.merge（合并导出 Tab 生成的 3 表合并）→ 其次：currentData.permitBasicMerge（施工许可 Tab 提取的 基本+施工 合并表）
        let mergeRows = null;
        let mergeFields = null;
        let mergeKind = null; // 'newMerge' | 'permitBasicMerge'
        if (Array.isArray(currentData.merge) && currentData.merge.length) {
            mergeRows = currentData.merge;
            mergeFields = Array.isArray(currentData.mergeFields) && currentData.mergeFields.length ? currentData.mergeFields.slice() : null;
            mergeKind = 'newMerge';
        } else if (currentData && currentData.permitBasicMerge && Array.isArray(currentData.permitBasicMerge.rows) && currentData.permitBasicMerge.rows.length) {
            mergeRows = currentData.permitBasicMerge.rows;
            mergeFields = Array.isArray(currentData.permitBasicMerge.fields) && currentData.permitBasicMerge.fields.length ? currentData.permitBasicMerge.fields.slice() : null;
            mergeKind = 'permitBasicMerge';
        }
        if (mergeRows && mergeRows.length) {
            return {
                target, rows: cloneArr(mergeRows),
                original: mergeRows,
                originalFieldsHint: mergeFields || null, // 给 inferOriginalFields 优先用（避免插入字段顺序错乱）
                kind: mergeKind,
                writeBack: (newRows, fields) => {
                    lastDataBackup = null;
                    // ✅ 天眼查补全后，两种 mergeKind 都重排 fields（锚定天眼查列 + 过滤 _匹配单位名）
                    var fRawM = (Array.isArray(fields) && fields.length) ? fields.slice() : [];
                    var ansM = anchorInsertTycColumnsIntoFields(fRawM, null, newRows || [], { appendCustomColsAtEnd: true });
                    var fSaveM = ansM.fields;
                    if (mergeKind === 'newMerge') {
                        currentData.merge = newRows.slice();
                        if (Array.isArray(fSaveM) && fSaveM.length) currentData.mergeFields = fSaveM.slice();
                        // ✅ 天眼查补全后同步到 __mergeAPI 的最新 queried 副本 → 参与后续生成/导出
                        try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                    } else if (mergeKind === 'permitBasicMerge') {
                        // 写回：这就是施工许可 Tab「提取合并表」的缓存，用补全后的结果覆盖它
                        currentData.permitBasicMerge = { rows: newRows.slice(), fields: fSaveM };
                        // 同时也把这些补全结果同步到 currentData.merge（用户切合并导出 Tab 选了「融合已查询数据」时也能拿到）
                        currentData.merge = newRows.slice();
                        if (Array.isArray(fSaveM) && fSaveM.length) currentData.mergeFields = fSaveM.slice();
                        try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                    }
                }
            };
        }
        return {
            target, rows: [],
            original: [],
            writeBack: () => {},
            needsRegenMerge: true
        };
    }

    function cloneArr(a) {
        try { return JSON.parse(JSON.stringify(Array.isArray(a) ? a : [])); } catch (e) { return []; }
    }

    // ---- 从 fields 里推断「target 模式下的列顺序」：在每个单位列后面插入 5 个新列 ----
    function buildAugmentedFields(originalFields, unitCols) {
        // originalFields：基础字段顺序（字符串数组）
        // unitCols：{ '建设单位' : '建设单位_' , ... }
        const out = [];
        const added = new Set();
        function push(f) { if (!added.has(f)) { added.add(f); out.push(f); } }
        (originalFields || []).forEach(f => {
            push(f);
            const prefix = unitCols[f];
            if (prefix) {
                SUB_KEYS.forEach(sk => push(prefix + sk));
            }
        });
        // 兜底：若这些单位列不在 originalFields（如合并导出里字段名没命中），则把 5 个新列全追加到尾部
        Object.keys(unitCols).forEach(colName => {
            const prefix = unitCols[colName];
            if (!originalFields.includes(colName)) {
                SUB_KEYS.forEach(sk => push(prefix + sk));
            }
        });
        return out;
    }

    // ---- 对一行数据，把天眼查抓到的 info 按「单位列 + 前缀」写回 5 个字段 ----
    //   multiMode = 'first'（默认）：单公司 info 直接覆盖；'all'：info 是 [{companyLabel, info}, ...] 数组形式，按「公司A：xxx，公司B：xxx」拼接后写入
    function applyTycInfoToRow(row, unitColName, prefix, info, overwrite, multiMode) {
        if (!row) return;
        const mode = (multiMode === 'all') ? 'all' : 'first';
        // 先确认 info 是否真的是多公司数组
        const isMultiArr = (mode === 'all' && Array.isArray(info));
        // 🔴 模式切换兼容：如果这是 first 模式，但当前行已经存在的旧值是「上一次 all 模式」留下的拼接格式（含「xxx：yyy，」或多个「：」），
        //    即使 overwrite=false(keep)，也必须覆盖/清理，否则用户看到的是残留的 all 模式拼接值。
        function shouldForceOverwrite(curVal, thisMode) {
            if (thisMode !== 'first') return false;
            if (!curVal) return false;
            const s = String(curVal);
            // 拼接格式特征：包含「：」 并且 包含「，」；或者至少出现 2 次 中文冒号；或者冒号前面看起来像公司名（≥2字）且冒号后面不是空
            if (/：/.test(s) && /[，,；;]/.test(s)) return true;
            var colons = s.match(/：/g);
            if (colons && colons.length >= 2) return true;
            return false;
        }
        SUB_KEYS.forEach(sk => {
            const newKey = prefix + sk;
            const cur = String(row[newKey] == null ? '' : row[newKey]).trim();
            const forceOW = shouldForceOverwrite(cur, mode);
            if (!overwrite && !forceOW && cur) return;
            if (isMultiArr) {
                const parts = [];
                info.forEach(piece => {
                    if (!piece || !piece.info) return;
                    const v = String(piece.info[SUB_FIELD_MAP[sk]] == null ? '' : piece.info[SUB_FIELD_MAP[sk]]).trim();
                    if (!v) return;
                    const label = String(piece.companyLabel || piece.companyName || '').trim();
                    parts.push((label ? (label + '：') : '') + v);
                });
                row[newKey] = parts.join('，');
            } else {
                const newVal = info ? String(info[SUB_FIELD_MAP[sk]] == null ? '' : info[SUB_FIELD_MAP[sk]]).trim() : '';
                row[newKey] = newVal;
            }
        });
        // ✅ 用户反馈：「匹配单位名」是多余辅助列 → 不写入 rows（减少无用字段 + 不再出现在 fields 末尾）
        //   旧代码保留注释（以后需要回滚直接取消注释即可）
        // // 匹配单位名：first 模式保留 1 个；all 模式全部拼
        // const matchedKey = prefix + '匹配单位名';
        // const curMatched = String(row[matchedKey] == null ? '' : row[matchedKey]).trim();
        // const forceOW2 = shouldForceOverwrite(curMatched, mode);
        // if (!overwrite && !forceOW2 && curMatched) return;
        // if (isMultiArr) {
        //     const nameParts = [];
        //     info.forEach(piece => {
        //         if (!piece) return;
        //         var n = String(piece.info && piece.info.companyName ? piece.info.companyName : (piece.companyLabel || '')).trim();
        //         if (n) nameParts.push(n);
        //     });
        //     if (nameParts.length) row[matchedKey] = nameParts.join('，');
        // } else if (info && info.companyName) {
        //     row[matchedKey] = String(info.companyName).trim();
        // } else if (info) {
        //     // info 对象没 companyName 但 mode=first 且要清理旧值时，也把旧拼接值置空
        //     if (forceOW2) row[matchedKey] = '';
        // }
    }

    // ---- 拆分「多公司单元格」→ 单个公司名数组（6 类单位列共用：建设/工程总承包/勘察/设计/施工/监理）----
    //   支持的分隔符：中英文逗号 / 分号 / 顿号（用户真实常见格式）
    //   多公司模式=first：只返回第 1 家；all：返回全部
    function splitMultiCompanies(rawCell, multiMode) {
        try {
            const s = String(rawCell || '').replace(/\s+/g, ' ').trim();
            if (!s) return [];
            // 1) 按多种分隔符先切分
            var parts = s.split(/\s*[,，;；、]\s*/).map(x => String(x || '').trim()).filter(Boolean);
            if (!parts.length) parts = [s];
            // 2) 对每个单独的公司名，清理括号注释（头尾都可能有，如「（委托建设）XX公司」「XX公司（联合体）」）
            parts = parts.map(p => {
                let x = p;
                // 多轮清理：头、尾的括号，最多 5 层嵌套/并列
                for (let guard = 0; guard < 5; guard++) {
                    const before = x;
                    // 尾部括号：XX公司（委托建设）、XX公司(牵头)
                    x = x.replace(/[（(][^（）()]*[）)]\s*$/g, '').trim();
                    // 头部括号：（联合体）XX公司、(委托)XX公司
                    x = x.replace(/^[（(][^（）()]*[）)]\s*/g, '').trim();
                    if (x === before) break;
                }
                return x;
            }).filter(Boolean);
            if (!parts.length) parts = [s];
            const mode = (multiMode === 'all') ? 'all' : 'first';
            if (mode === 'first') return parts.slice(0, 1);
            // all 模式：空值过滤 + 去重相邻相同
            const out = [];
            const seen = new Set();
            parts.forEach(p => {
                const k = p.replace(/\s+/g, '');
                if (!k || seen.has(k)) return;
                seen.add(k);
                out.push(p);
            });
            return out;
        } catch (e) { return []; }
    }

    // ---- 真正调用 background 查单家公司 ----
    function tycQueryOne(companyName, matchMode) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({
                    action: 'tianyanchaQuery',
                    companyName: String(companyName || '').trim(),
                    matchMode: String(matchMode || 'smart')
                }, (resp) => {
                    if (chrome.runtime.lastError) { resolve({ success: false, error: chrome.runtime.lastError.message }); return; }
                    if (!resp || typeof resp !== 'object') { resolve({ success: false, error: '后台无响应' }); return; }
                    resolve(resp);
                });
            } catch (e) { resolve({ success: false, error: String(e && e.message || e) }); }
        });
    }

    // ---- 随机延迟 ----
    function randomSleep(secMin, secMax) {
        const a = Math.max(0.1, Number(secMin) || 3);
        const b = Math.max(a, Number(secMax) || 5);
        const ms = Math.round((a + Math.random() * (b - a)) * 1000);
        return new Promise(r => setTimeout(r, ms));
    }

    // ---- 主入口：开始补全 ----
    async function doStartTianyancha() {
        if (tycRunning) { setStatus('正在进行中，不能重复启动。如需停止请点「⏹ 停止」。', 'error'); return; }
        const targetEl = safeGetElement('tyc-target');
        const target = targetEl ? targetEl.value : 'permit';
        const minD = Number(safeGetElement('tyc-minDelay').value) || 3;
        const maxD = Number(safeGetElement('tyc-maxDelay').value) || 5;
        const matchMode = safeGetElement('tyc-matchMode').value || 'smart';
        const overwrite = (safeGetElement('tyc-overwrite').value || 'keep') === 'force';
        const skipCached = (safeGetElement('tyc-skipCached').value || '1') === '1';
        const multiMode = (safeGetElement('tyc-multiCompany').value || 'first') === 'all' ? 'all' : 'first';

        if (maxD < minD) { setStatus('❌ 最大间隔不能小于最小间隔。', 'error'); return; }

        // 1) 拿当前 target 的数据
        let ctx = resolveTargetContext(target);
        if (ctx.needsRegenMerge) {
            // 先尝试自动生成一次合并表（复用 permit tab 的逻辑）
            setStatus('🧪 合并表为空，正在自动生成合并表（基于 basic/permit/complete 当前数据）...');
            try {
                if (typeof buildFinalMergeTable === 'function') {
                    const got = buildFinalMergeTable();
                    if (got && Array.isArray(got.rows) && got.rows.length) {
                        currentData.merge = got.rows.slice();
                        ctx = resolveTargetContext(target);
                    }
                }
            } catch (e) {}
            if (!(ctx.rows && ctx.rows.length)) {
                setStatus('❌ 合并表仍为空：请先在「合并导出」Tab 点「生成合并表」得到有效数据后，再回到本页补全。', 'error');
                return;
            }
        }
        if (!ctx.rows || !ctx.rows.length) {
            const nameMap = { basic:'基本信息', permit:'施工许可', complete:'竣工验收备案', merge:'合并导出' };
            setStatus('❌ 当前「' + (nameMap[target]||target) + '」没有数据！请先到对应 Tab 提取或上传 CSV，再回到本页开始补全。', 'error');
            return;
        }
        const unitCols = Object.assign({}, (ctx && ctx.unitColsOverride) ? ctx.unitColsOverride : (TARGET_UNIT_COLS[target] || {}));
        const unitColNames = Object.keys(unitCols);
        if (!unitColNames.length) {
            setStatus('ℹ️ 「竣工验收备案」目前暂不补全任何字段（接口预占，可后续扩充）。无需执行查询。', 'info');
            lastTarget = target; lastFields = []; lastData = ctx.rows.slice();
            return;
        }

        // 2) 收集所有待查询单位（去重）→ 并建立反向索引
        //    key = normalized 单公司名（如 "深圳市福民丹坑股份合作公司"）
        //    needMap[key] = { displayName, usages: [{rowIdx, col, prefix, origLabel, partIndex, totalInCell}] }
        //      —— origLabel 是原始单元格文本（「A,B,C（委托建设）」），用于 all 模式最终拼接时按 1 个单元格整体写回
        //    另外保留 cellKey -> 单元集合（按原始单元格粒度，all 模式写回时要找到这一格的所有子公司结果）
        const needMap = {};
        const cellKeyToSubs = {}; // cellKey = `${rowIdx}__${col}` -> [needMap 的 key1, key2, ...] 顺序，按原始拆分顺序
        function normUnit(u) { try { return String(u || '').replace(/\s+/g,'').trim(); } catch (e) { return ''; } }
        ctx.rows.forEach((r, ri) => {
            unitColNames.forEach(col => {
                const raw = r[col];
                const display = String(raw || '').trim();
                if (!display) return;
                const cellKey = ri + '__' + col;
                const companies = splitMultiCompanies(display, multiMode); // 按模式：first=1 个；all=多个
                if (!companies.length) return;
                const subKeys = [];
                companies.forEach((companyLabel, idx) => {
                    const k = normUnit(companyLabel);
                    if (!k) return;
                    subKeys.push(k);
                    if (!needMap[k]) needMap[k] = { displayName: companyLabel, usages: [] };
                    if (!needMap[k].displayName) needMap[k].displayName = companyLabel;
                    needMap[k].usages.push({
                        rowIdx: ri,
                        col: col,
                        prefix: unitCols[col],
                        origLabel: display,     // 原始这一格整段，all 模式用来判断"是否同一个单元格"
                        cellKey: cellKey,
                        partIndex: idx,
                        totalInCell: companies.length
                    });
                });
                cellKeyToSubs[cellKey] = subKeys;
            });
        });
        const wantList = Object.keys(needMap);
        setStat('tyc-stat-want', wantList.length);
        if (!wantList.length) {
            setStatus('ℹ️ 目标数据中没有需要补全的单位名（6 类单位列全为空）。无需查询。', 'info');
            const originalFields = inferOriginalFields(ctx.rows, unitCols, ctx.originalFieldsHint);
            lastFields = buildAugmentedFields(originalFields, unitCols);
            lastData = ctx.rows;
            return;
        }

        // 3) 缓存初筛（缓存只按"单家公司名"key，与多公司模式无关；first/all 只影响写回拼接，不影响单家缓存）
        const cache = readCache();
        let cachedHits = 0;
        let cachedFailHits = 0; // 缓存命中但上一次是失败 → 会进入 pending 重查，仅统计展示
        const pending = [];
        const pendingNormKey = [];
        const seenPending = new Set();
        wantList.forEach(nk => {
            const item = needMap[nk];
            const cKey = item.displayName;
            const hit = cache[cKey];
            if (skipCached && hit && hit.success && hit.data) {
                cachedHits++;
                item.subInfos = [{ companyLabel: cKey, info: hit.data }];
                return;
            }
            if (skipCached && hit && hit.success === false) {
                // 缓存里是上次失败的 → 还是重新查（否则永远失败），但单独记个数，方便用户感知"上次有多少失败的现在重新尝试"
                cachedFailHits++;
            }
            if (!seenPending.has(cKey)) {
                seenPending.add(cKey);
                pending.push(cKey);
                pendingNormKey.push(nk);
            }
        });
        setStat('tyc-stat-cached', cachedHits);

        // 4) 逐家查询（单公司为粒度，保证进度条准确 & 去重）
        tycRunning = true;
        const startBtn = safeGetElement('tyc-start');
        const stopBtn = safeGetElement('tyc-stop');
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = '';
        const totalQ = pending.length;
        let doneQ = 0, okQ = 0, failQ = 0;
        const failedList = []; // 失败公司明细 [{name, error}]，用于最终 setStatus 列出 Top N
        setStat('tyc-stat-queried', doneQ + ' / ' + totalQ);
        setStat('tyc-stat-ok', okQ);
        setStat('tyc-stat-fail', failQ);
        setProgress(0, totalQ);
        setStatus('🔍 开始查询：共 ' + wantList.length + ' 家唯一单公司，其中缓存命中 ' + cachedHits + ' 家' + (cachedFailHits > 0 ? '（上次失败缓存 ' + cachedFailHits + ' 家，本次将重新尝试）' : '') + '，需天眼查 ' + totalQ + ' 家（多公司模式=' + (multiMode === 'all' ? '全部拼接' : '仅第 1 家') + '）。');
        lastDataBackup = cloneArr(ctx.original);
        backupAffected = { target: target, kind: ctx.kind || null, originalFieldsHint: ctx.originalFieldsHint || null };

        try {
            await chrome.runtime.sendMessage({ action: 'tianyanchaSetStop', stop: false });
            for (let pi = 0; pi < pending.length; pi++) {
                if (pi > 0) {
                    const stopState = await new Promise(r => chrome.runtime.sendMessage({ action: 'tianyanchaSetStop' }, x => r(x || {}))).catch(() => ({}));
                    if (stopState && stopState.stop) { break; }
                    await randomSleep(minD, maxD);
                }
                const cName = pending[pi];
                const nk = pendingNormKey[pi];
                setStatus(`[${pi + 1}/${totalQ}] 🔎 查询「${cName}」...`);
                const resp = await tycQueryOne(cName, matchMode);
                if (resp && resp.success && resp.data) {
                    okQ++;
                    const dataPayload = {
                        companyName: resp.data.companyName || '',
                        creditCode: resp.data.creditCode || '',
                        phone: resp.data.phone || '',
                        legalPerson: resp.data.legalPerson || '',
                        address: resp.data.address || '',
                        establishDate: resp.data.establishDate || '',
                        companyId: resp.data.companyId || '',
                        similarity: resp.data.similarity || 0,
                        matchMode: resp.data.matchMode || matchMode,
                        detailVia: resp.data.detailVia || ''
                    };
                    cache[cName] = { success: true, queriedAt: Date.now(), via: resp.via || '', data: dataPayload };
                    writeCache(cache);
                    const item = needMap[nk];
                    if (item) item.subInfos = [{ companyLabel: cName, info: dataPayload }];
                } else {
                    failQ++;
                    var errMsg = (resp && resp.error) || '未知错误';
                    try {
                        // 即使 DevTools 没开，也写一份到内存对象里，用户可在 setStatus 看到
                        failedList.push({ name: cName, error: errMsg });
                    } catch (e) {}
                    cache[cName] = Object.assign({}, cache[cName] || {}, {
                        success: false,
                        failAt: Date.now(),
                        error: errMsg,
                        debug: (resp && (resp.firstCandidateNames || resp.suggestHttpStatus)) ? { suggestHttpStatus: resp.suggestHttpStatus, suggestErr: resp.suggestErr, candidatesCount: resp.candidatesCount, firstCandidateNames: resp.firstCandidateNames } : undefined
                    });
                    writeCache(cache);
                }
                doneQ = pi + 1;
                setStat('tyc-stat-queried', doneQ + ' / ' + totalQ);
                setStat('tyc-stat-ok', okQ);
                setStat('tyc-stat-fail', failQ);
                setProgress(doneQ, totalQ);
                const stopState2 = await new Promise(r => chrome.runtime.sendMessage({ action: 'tianyanchaSetStop' }, x => r(x || {}))).catch(() => ({}));
                if (stopState2 && stopState2.stop) break;
            }
        } catch (eBig) {
            setStatus('❌ 补全过程异常：' + (eBig && eBig.message || String(eBig)), 'error');
        } finally {
            try { await chrome.runtime.sendMessage({ action: 'tianyanchaSetStop', stop: true }); } catch (e) {}
            tycRunning = false;
            if (startBtn) startBtn.style.display = '';
            if (stopBtn) stopBtn.style.display = 'none';
        }

        // 5) 按 cellKey 聚合 → 写回对应行
        //    first 模式：一个单元格只有 1 个子公司（subInfos 长度=1），直接写（兼容过去行为）
        //    all 模式：把一个单元格的所有子公司 subInfos 按原顺序拼成数组，再一次 applyTycInfoToRow 进入拼接分支
        try {
            const processedCellKeys = new Set();
            Object.keys(needMap).forEach(nk => {
                const item = needMap[nk];
                if (!item || !item.usages || !item.usages.length) return;
                const subInfos = Array.isArray(item.subInfos) ? item.subInfos : [];
                item.usages.forEach(usage => {
                    if (processedCellKeys.has(usage.cellKey)) return;
                    processedCellKeys.add(usage.cellKey);
                    // 聚合本单元格的所有子公司结果
                    const subKeys = cellKeyToSubs[usage.cellKey] || [];
                    // first 模式：只取当前这家（= 单元格拆分出的第一家）
                    if (multiMode !== 'all') {
                        const oneInfo = subInfos.length && subInfos[0] && subInfos[0].info ? subInfos[0].info : null;
                        applyTycInfoToRow(ctx.rows[usage.rowIdx], usage.col, usage.prefix, oneInfo, overwrite);
                    } else {
                        // all 模式：按原始拆分顺序组装成数组（某子公司失败 → 缺它，但其余按序展示）
                        const combined = [];
                        subKeys.forEach(sk => {
                            const sub = needMap[sk];
                            if (!sub) return;
                            if (sub.subInfos && sub.subInfos.length && sub.subInfos[0].info) {
                                combined.push({ companyLabel: sub.subInfos[0].companyLabel || sub.displayName, info: sub.subInfos[0].info });
                            }
                        });
                        if (combined.length) applyTycInfoToRow(ctx.rows[usage.rowIdx], usage.col, usage.prefix, combined, overwrite, 'all');
                        // 如果 combined 全失败 → 不写（保持原覆盖/保留策略）
                    }
                });
            });
        } catch (eWriteBack) {  }

        // 6) 生成增强字段列表 + 保存 lastData/lastFields + 写回原数据容器
        const originalFields = inferOriginalFields(ctx.rows, unitCols, ctx.originalFieldsHint);
        const augmentedFields = buildAugmentedFields(originalFields, unitCols);
        lastTarget = target;
        lastFields = augmentedFields.slice();
        lastData = ctx.rows.slice();
        try { ctx.writeBack(lastData, augmentedFields); } catch (e) {}
        try {
            const tbl = safeGetElement('tyc-table');
            if (tbl) {
                tbl.style.display = 'block';
                renderTable('tyc-table', lastData, lastFields);
            }
        } catch (e) {}
        // 失败明细持久化到 localStorage（DevTools 里随时可查）
        try {
            if (failedList && failedList.length) {
                localStorage.setItem('tyc-last-failed', JSON.stringify({ at: Date.now(), items: failedList }));
            } else {
                localStorage.removeItem('tyc-last-failed');
            }
        } catch (e) {}
        // 失败 Top N 摘要（最多展示前 8 家，防止一行爆长；超过 8 家提示 DevTools 看详情）
        var failSummary = '';
        if (failedList && failedList.length) {
            var topN = failedList.slice(0, 8).map(function (x, i) {
                var errShort = String(x.error || '').replace(/\s+/g, ' ').slice(0, 60);
                return (i + 1) + '.「' + x.name + '」: ' + errShort;
            }).join('；');
            failSummary = ' ⚠️ 失败明细（前' + Math.min(8, failedList.length) + '家）：' + topN + (failedList.length > 8 ? '（共 ' + failedList.length + ' 家，其余见 DevTools 或 localStorage.tyc-last-failed）' : '');
        }
        setStatus('✅ 补全完成：唯一单公司 ' + wantList.length + ' 家（缓存命中 ' + cachedHits + '，成功 ' + okQ + '，失败/跳过 ' + failQ + '，多公司模式=' + (multiMode === 'all' ? '全部拼接' : '仅第 1 家') + '）。可预览或导出 CSV。' + failSummary, failQ > 0 ? 'warning' : 'success');
    }

    // ---- 根据数据里实际已出现的列，推断原 fields 顺序（用户可能上传了自定义列名的 CSV，所以优先用实际出现的首行出现顺序） ----
    function inferOriginalFields(rows, unitCols, ctxHint) {
        const out = [];
        const added = new Set();
        function push(f) { if (!added.has(f)) { added.add(f); out.push(f); } }
        // 优先用：① ctx 传的 originalFieldsHint（施工许可 Tab 提取合并表的字段，带 许可_建设单位 位置）
        //         ② knownByTarget 的字段定义（合并导出 Tab 生成时的字段；basic/permit/complete 的标准字段集合）
        //         ③ 实际 rows 里有的列：按首次出现顺序，补齐那些「自定义/额外」列
        if (Array.isArray(ctxHint) && ctxHint.length) { ctxHint.forEach(push); }
        const knownByTarget = {
            basic: BASIC_FIELDS,
            permit: PERMIT_FIELDS,
            complete: COMPLETE_FIELDS,
            merge: (currentData && currentData.mergeFields) ? currentData.mergeFields : null
        };
        const target = lastTarget || safeGetElement('tyc-target').value;
        const known = knownByTarget[target];
        (known || []).forEach(push);
        // 🔴✅ 修复：用户反馈天眼查补全后 permit/basic/complete 表末尾多出"详情独有字段（省级施工许可证编号、发证日期、合同开工日期、合同竣工日期、合同金额、合同面积、结构体系、建设单位组织机构代码 等）"
        // 根因：这些字段是详情 API 抓取时 result[k] = matched[k] 把所有详情字段都塞到 row 对象里了（不在 BASIC_FIELDS / PERMIT_FIELDS / COMPLETE_FIELDS 标准列里），
        //      之前 inferOriginalFields 第③步"Object.keys(r) 扫真实 key"把它们当成"用户自定义列"补进来了，导致表末尾出现一堆多余列。
        // 策略：
        //   - target = basic / permit / complete（标准提取 Tab，有明确 known 标准字段集合）：
        //        ③ 步追加额外列时，只加「单位列集合（unitCols 里的键，确保用户上传 CSV 自定义单位列名时能覆盖）」+「非详情垃圾字段」
        //        → 对详情阶段常见"垃圾独有字段"一律黑名单过滤（不加入 fields），用户看到的就和标准 PERMIT_FIELDS/BASIC_FIELDS/COMPLETE_FIELDS 一致
        //   - target = merge（合并表 / 施工许可 Tab 提取合并表 / 合并导出）：
        //        ③ 步保留原兜底，因为合并表字段本身就是「basic 字段 + permit 字段（许可_前缀重名）+ 其他 44 列」的自定义集合
        const tycPrefixes = Object.values(unitCols || {});
        const unitColKeysSet = new Set(Object.keys(unitCols || {}));
        // 详情独有字段黑名单（施工许可详情 API 返回但不在 PERMIT_FIELDS 标准集合的那些字段名）
        //   用户明确列出：省级施工许可证编号、项目名称、建设单位组织机构代码、施工单位组织机构代码、结构体系、合同价格（万元）、合同金额、合同面积（平方米）、合同面积、建设性质、合同开工日期、合同竣工日期、发证日期
        const DETAIL_GARBAGE_BLACKLIST = new Set([
            '省级施工许可证编号', '建设单位组织机构代码', '施工单位组织机构代码', '勘察单位组织机构代码', '设计单位组织机构代码', '监理单位组织机构代码',
            '结构体系', '合同价格（万元）', '合同金额', '合同面积（平方米）', '合同面积', '合同开工日期', '合同竣工日期', '发证日期',
            '项目分类', '建设规模文本', '合同工期天数', '监理资质', '施工资质', '设计资质', '勘察资质', '工程总承包资质',
            '中标通知书编号', '中标金额', '招标方式', '资金来源', '建设规模明细', '建设性质明细'
        ]);
        // 🔴✅ 根本兜底：跨 Tab 标准字段"偷渡拦截"
        //   对 target=X（basic/permit/complete 三选一），凡是：
        //      字段 k ∈ (BASIC_FIELDS ∪ PERMIT_FIELDS ∪ COMPLETE_FIELDS) 但  k ∉ (known 即当前 target X 的标准字段)
        //   → 一律视为"别的 Tab 的标准字段偷渡到当前 Tab 表末尾"，直接丢弃。
        //   这样就从根本上杜绝：permit 详情 API 返回的"项目名称、建设性质"（它们本来是 BASIC_FIELDS 里的字段）混到 permit 表末尾的问题
        const ALL_KNOWN_STD_FIELDS = new Set([].concat(BASIC_FIELDS || [], PERMIT_FIELDS || [], COMPLETE_FIELDS || []));
        const CURRENT_TARGET_STD_FIELDS = new Set(Array.isArray(known) ? known : []);
        // 实际 rows 里有的列：按首次出现顺序，补齐那些「自定义/额外」列
        (rows || []).forEach(r => {
            if (!r || typeof r !== 'object') return;
            Object.keys(r).forEach(k => {
                // 把天眼查将要新增的前缀列先剔除（它们将由 buildAugmentedFields 按正确位置重新插入）
                const isTycCol = tycPrefixes.some(prefix => {
                    if (!prefix) return false;
                    return SUB_KEYS.some(sk => k === prefix + sk) || k === prefix + '匹配单位名';
                });
                if (isTycCol) return;
                // basic/permit/complete 三个标准 Tab 的"详情独有垃圾字段"黑名单过滤 → 不再加到 fields 末尾
                if (target === 'basic' || target === 'permit' || target === 'complete') {
                    // 用户上传 CSV 的自定义列场景：如果这个 key 是 unitCols 里需要扫的单位列（比如用户上传了一个「投资主体」列想让天眼查补）→ 保留
                    if (unitColKeysSet.has(k)) { push(k); return; }
                    // 如果 known（当前 target 标准字段集合）里本来就有 → 前面 (known||[]).forEach(push) 已经加过了，这里跳过（因为 added 已命中）
                    // 黑名单里的"详情垃圾独有字段" → 丢弃
                    if (DETAIL_GARBAGE_BLACKLIST.has(k)) return;
                    // 🔴✅ 新拦截：这是其他 Tab 的标准字段，却出现在当前 target 的 rows 里（典型：基本信息的「项目名称」「建设性质」被 permit 详情 API 带回来）
                    //          对当前 target 来说是多余字段 → 丢弃
                    if (ALL_KNOWN_STD_FIELDS.has(k) && !CURRENT_TARGET_STD_FIELDS.has(k)) return;
                    // 其余：如果是 known 里有的（必然已 added），push 会自动去重；
                    // 如果是 known 里没有的（用户上传 CSV 时带的真实自定义列，且不在黑名单、不是其他 Tab 偷渡字段）→ 允许加进来
                    push(k);
                } else {
                    // merge / 其他自定义 target：保留原行为（兜底追加）
                    push(k);
                }
            });
        });
        return out;
    }

    // ---- 预览 / 导出 ----
    function doPreview() {
        if (!lastData || !lastData.length) {
            setStatus('ℹ️ 还没有补全结果，先点「开始天眼查补全」吧。', 'info');
            return;
        }
        try {
            const tbl = safeGetElement('tyc-table');
            if (tbl) {
                tbl.style.display = 'block';
                renderTable('tyc-table', lastData, lastFields);
            }
        } catch (e) {}
        setStatus('📋 已预览补全结果：共 ' + lastData.length + ' 行，' + lastFields.length + ' 列。', 'success');
    }
    function doExport() {
        if (!lastData || !lastData.length) {
            setStatus('ℹ️ 还没有补全结果，先点「开始天眼查补全」吧。', 'info');
            return;
        }
        try {
            const csv = generateCSV(lastData, lastFields, () => false);
            const targetName = ({ basic: '基本信息', permit: '施工许可', complete: '竣工验收备案', merge: '合并导出' })[lastTarget || 'permit'] || '数据';
            const d = new Date();
            const p = n => (n < 10 ? '0' + n : '' + n);
            const date = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
            downloadCSV(csv, targetName + '_天眼查补全_' + date + '.csv');
            setStatus('💾 已导出 CSV：共 ' + lastData.length + ' 行 / ' + lastFields.length + ' 列。', 'success');
        } catch (e) {
            setStatus('❌ 导出失败：' + (e && e.message || String(e)), 'error');
        }
    }
    function doClearCache() {
        try { localStorage.removeItem(STORAGE_CACHE_KEY); } catch (e) {}
        setStatus('♻️ 本地天眼查缓存已清空（下次补全将强制重新查询）。', 'success');
    }
    function doStop() {
        if (!tycRunning) { setStatus('当前没有在跑的任务。'); return; }
        try { chrome.runtime.sendMessage({ action: 'tianyanchaSetStop', stop: true }); } catch (e) {}
        setStatus('⏹ 已收到停止请求，将在当前这一家查询完成后结束。', 'info');
    }
    function doRevert() {
        if (!lastDataBackup) { setStatus('ℹ️ 还没有可回滚的本次补全（或本次已写入原容器且已无备份）。', 'info'); return; }
        const target = backupAffected && backupAffected.target ? backupAffected.target : (lastTarget || 'permit');
        try {
            if (target === 'basic') {
                if (Array.isArray(currentData.basic)) currentData.basic = lastDataBackup.slice();
                try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                try { const tbl = safeGetElement('basic-table'); if (tbl && currentData.basic.length) { tbl.style.display='block'; renderTable('basic-table', currentData.basic, BASIC_FIELDS); } } catch (e) {}
            } else if (target === 'permit') {
                // 回滚分两种：纯 permit 单表 vs 施工许可 Tab 提取的合并表(permitBasicMerge)
                const pureColsOverride = !(backupAffected && backupAffected.kind === 'permitBasicMerge');
                if (pureColsOverride && Array.isArray(currentData.permit)) {
                    currentData.permit = lastDataBackup.slice();
                }
                if (backupAffected && backupAffected.kind === 'permitBasicMerge') {
                    // 回滚合并表：字段里去掉这次补全新增的天眼查列（merge 的 unitCols 前缀）
                    var mergePfxs = Object.values(TARGET_UNIT_COLS.merge || {});
                    var restoreFields = (Array.isArray(lastFields) && lastFields.length)
                        ? lastFields.filter(function(f) {
                            return !mergePfxs.some(function(pfx) {
                                return SUB_KEYS.some(function(sk) { return f === pfx + sk; }) || f === pfx + '匹配单位名';
                            });
                        }) : (backupAffected && Array.isArray(backupAffected.originalFieldsHint) ? backupAffected.originalFieldsHint.slice() : null);
                    currentData.permitBasicMerge = { rows: lastDataBackup.slice(), fields: restoreFields };
                    // 同步回滚 currentData.merge / mergeFields
                    currentData.merge = lastDataBackup.slice();
                    if (restoreFields) currentData.mergeFields = restoreFields.slice();
                    try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                    try {
                        const tbl = safeGetElement('permit-table');
                        if (tbl && lastDataBackup.length) {
                            tbl.style.display = 'block';
                            renderTable('permit-table', lastDataBackup.slice(), restoreFields || lastDataBackup);
                        }
                    } catch (e) {}
                } else {
                    try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                    try { const tbl = safeGetElement('permit-table'); if (tbl && currentData.permit.length) { tbl.style.display='block'; renderTable('permit-table', currentData.permit, PERMIT_FIELDS); } } catch (e) {}
                }
            } else if (target === 'merge') {
                // 合并导出（分两种来源回滚：新合并导出的 currentData.merge / 施工许可 Tab 提取的 permitBasicMerge）
                const restoreFields = (Array.isArray(lastFields) && lastFields.length)
                    ? lastFields.filter(function(f) {
                        // 回滚时把这次补全新增的天眼查列去掉
                        var prefixes = Object.values(TARGET_UNIT_COLS.merge || {});
                        return !prefixes.some(function(pfx) {
                            return SUB_KEYS.some(function(sk) { return f === pfx + sk; }) || f === pfx + '匹配单位名';
                        });
                    }) : null;
                currentData.merge = lastDataBackup.slice();
                if (restoreFields) currentData.mergeFields = restoreFields;
                // 如果本次是从 permitBasicMerge 进来的，还要把 permitBasicMerge 缓存一起回滚
                if (backupAffected && backupAffected.kind === 'permitBasicMerge') {
                    currentData.permitBasicMerge = { rows: lastDataBackup.slice(), fields: restoreFields };
                }
                try { if (window && window.__mergeAPI && typeof window.__mergeAPI.syncCurrentData === 'function') { window.__mergeAPI.syncCurrentData(); } } catch (eSync) {}
                try { const tbl = safeGetElement('merge-table'); if (tbl && currentData.merge.length && currentData.mergeFields && currentData.mergeFields.length) { tbl.style.display='block'; renderTable('merge-table', currentData.merge, currentData.mergeFields); } } catch (e) {}
            } else { /* complete: 暂不补，也无需回滚 */ }
            lastDataBackup = null;
            try {
                const tbl = safeGetElement('tyc-table');
                if (tbl) { tbl.style.display='none'; tbl.innerHTML=''; }
            } catch (e) {}
            lastData = []; lastFields = [];
            setStatus('↩️ 已回滚「' + ({basic:'基本信息',permit:'施工许可',complete:'竣工验收备案',merge:'合并导出'})[target] + '」到补全前状态。', 'success');
        } catch (e) {
            setStatus('❌ 回滚失败：' + (e && e.message || String(e)), 'error');
        }
    }

    // ---- 按钮绑定 ----
    function bind() {
        const st = safeGetElement('tyc-start');
        if (st) st.addEventListener('click', () => doStartTianyancha().catch(e => setStatus('❌ 异常：' + (e && e.message || String(e)), 'error')));
        const sp = safeGetElement('tyc-stop'); if (sp) sp.addEventListener('click', doStop);
        const pv = safeGetElement('tyc-preview'); if (pv) pv.addEventListener('click', doPreview);
        const ex = safeGetElement('tyc-export'); if (ex) ex.addEventListener('click', doExport);
        const cc = safeGetElement('tyc-clearCache'); if (cc) cc.addEventListener('click', doClearCache);
        const rv = safeGetElement('tyc-revert'); if (rv) rv.addEventListener('click', doRevert);

        // 初始化：切到天眼查 tab 时刷新「待查单位数」预览，给用户预期
        try {
            document.querySelectorAll('.tabs .tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const t = e.target.getAttribute && e.target.getAttribute('data-tab');
                    if (t !== 'tianyancha') return;
                    try {
                        const target = safeGetElement('tyc-target').value || 'permit';
                        const ctx = resolveTargetContext(target);
                        const unitCols = Object.assign({}, (ctx && ctx.unitColsOverride) ? ctx.unitColsOverride : (TARGET_UNIT_COLS[target] || {}));
                        const normUnit = u => String(u || '').replace(/\s+/g,'').trim();
                        const s = new Set();
                        (ctx.rows || []).forEach(r => {
                            Object.keys(unitCols).forEach(col => {
                                const k = normUnit(r[col]);
                                if (k) s.add(k);
                            });
                        });
                        setStat('tyc-stat-want', s.size);
                        setStat('tyc-stat-cached', '0');
                        setStat('tyc-stat-queried', '0 / 0');
                        setStat('tyc-stat-ok', '0');
                        setStat('tyc-stat-fail', '0');
                        setProgress(0, 0);
                        if (!(ctx.rows && ctx.rows.length)) {
                            const nameMap = { basic:'基本信息', permit:'施工许可', complete:'竣工验收备案', merge:'合并导出' };
                            setStatus('ℹ️ 检测到「' + (nameMap[target]||target) + '」当前还没有数据。请先到对应 Tab 提取或上传 CSV，再回到本页点击「开始天眼查补全」。', 'info');
                        } else if (!Object.keys(unitCols).length) {
                            setStatus('ℹ️ 竣工验收备案模式当前无需要补全的字段（接口预占，后续可扩充）。', 'info');
                        } else {
                            setStatus('✅ 已就绪：目标数据 ' + ctx.rows.length + ' 行，去重后待查单位约 ' + s.size + ' 家。点击「🔍 开始天眼查补全」开始查询。', 'success');
                        }
                    } catch (e) {}
                });
            });
        } catch (e) {}
    }
    bind();
})();

console.log('✅ popup.js 已加载完成');
} catch (__eTop) {
    var __m = 'popup.js 顶层加载异常：' + (__eTop && __eTop.message ? __eTop.message : String(__eTop));
    try { console.error(__m, __eTop && __eTop.stack ? __eTop.stack : __eTop); } catch (ee) {}
    try { alert(__m + '\\n\\n请将此报错截图反馈给开发者。\\n（Tab 切换功能仍可继续使用，已由 HTML 兜底保障）'); } catch (ea) {}
}