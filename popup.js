// ===== 全局状态 =====
let currentData = { basic: [], permit: [], complete: [], merge: [] };
let stopRequested = { basic: false, permit: false, complete: false };
let isExtracting = { basic: false, permit: false, complete: false };
let uploadedData = { basic: [], permit: [], complete: [] };       // 去重上传 Tab 用（和之前保持兼容）
let retryCount = { basic: 0, permit: 0, complete: 0 };
const MAX_RETRIES = 15; // 最多重试 15 次（约 20 秒）

// ===== 🔴✅ 合并 Tab 新数据结构（彻底分离 提取数据 / 上传数据 / 主表）=====
// queriedData：从 3 个提取 Tab 同步过来的「查询/提取到的数据」（原 currentData.basic/permit/complete 的副本）
let queriedData = { basic: [], permit: [], complete: [] };
// mergeUploadedData：合并 Tab 上传的 CSV（三表上传 + 主表上传），和 queriedData 分离
let mergeUploadedData = { basic: [], permit: [], complete: [], master: [] };
// masterOriginalFields：主表原始字段顺序（导出主表时尽量保留原字段顺序，兼容用户原表）
let masterOriginalFields = [];
// CHANGE_NOTE_FIELD：变更备注列名（固定！方便多次追加）
const CHANGE_NOTE_FIELD = '变更备注';

// ===== 字段定义 =====
const BASIC_FIELDS = [
    '项目名称', '建设单位', '组织机构代码', '项目所在地', '详细地址', '立项文号',
    '立项级别', '立项批复机关', '立项批复时间', '总投资（万元）',
    '总面积/长度（平方米/米）', '建设规模', '建设性质', '工程用途',
    '计划开工日期', '数据等级', '省级项目编号'
];

const PERMIT_FIELDS = [
    '工程名称', '施工许可证编号', '省级项目编号', '建设单位', '建设地址', '建设规模',
    '合同价格', '工程总承包单位', '勘察单位', '设计单位', '施工单位',
    '监理单位', '建设单位项目负责人', '工程总承包项目经理',
    '勘察单位项目负责人', '设计单位项目负责人', '施工单位项目负责人',
    '总监理工程师', '合同工期', '状态', '备注', '发证机关', '数据等级'
];

const COMPLETE_FIELDS = [
    '工程名称', '省级竣工验收备案编号', '竣工验收备案编号', '省级项目编号', '备案机关', '结构体系',
    '实际造价（万元）', '实际面积（平方米）', '实际开工日期',
    '实际竣工日期', '数据等级'
];

// ===== 🔴✅ 需求2：仅导出列表数据的字段定义（和需求2用户指定的顺序完全一致，每列都有别名兜底匹配）=====
const LIST_ONLY_FIELDS = {
    basic: [
        // 用户指定：项目名称、所在市、省级项目编号、项目分类、建设单位、数据等级
        { key: '项目名称',   aliases: ['项目名称', '工程名称'] },
        { key: '所在市',     aliases: ['所在市', '项目所在地', '城市', '所在地', '所在城市'] },
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
        { key: '工程名称',             aliases: ['工程名称', '项目名称'] },
        { key: '竣工验收备案编号',     aliases: ['竣工验收备案编号', '备案编号', '省级竣工验收备案编号'] },
        { key: '省级项目编号',         aliases: ['省级项目编号'] },
        { key: '竣工验收备案机关',     aliases: ['竣工验收备案机关', '备案机关'] },
        { key: '数据等级',             aliases: ['数据等级', '等级', '分级'] }
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
        if (!modeEl || !startEl || !endEl) return;
        const mode = modeEl.value || 'range';
        if (mode === 'range') {
            startEl.disabled = false;
            endEl.disabled = false;
            startEl.title = '';
            endEl.title = '';
        } else {
            startEl.disabled = true;
            endEl.disabled = true;
            if (mode === 'current') {
                startEl.title = '选择了「仅当前页」，自动使用页面当前打开页号';
                endEl.title = '选择了「仅当前页」，自动使用页面当前打开页号';
            } else {
                startEl.title = '选择了「全部页」，自动从第 1 页抓到最后一页';
                endEl.title = '选择了「全部页」，自动从第 1 页抓到最后一页';
            }
        }
    } catch (e) { console.warn('[pageMode] sync 失败:', e); }
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

// 🔴✅ 合并 Tab：实时刷新顶部统计条（区分 提取数据 / 上传数据；同步 currentData → queriedData）
function refreshMergeStats() {
    try {
        // Step 0：同步其他 Tab 提取的数据到 queriedData（用户可能在基本信息 Tab 刚提取完切过来）
        ['basic', 'permit', 'complete'].forEach(t => {
            if (currentData[t] && currentData[t].length > 0) {
                // 如果 queriedData 长度和 currentData 不一致（说明有新提取数据）→ 覆盖更新
                if (queriedData[t].length !== currentData[t].length) {
                    queriedData[t] = currentData[t].slice(); // 复制一份，互不干扰
                }
            }
        });

        const b = safeGetElement('merge-stats-basic');
        if (b) b.textContent = ((queriedData.basic || []).length || 0) + ' / ' + ((mergeUploadedData.basic || []).length || 0);
        const p = safeGetElement('merge-stats-permit');
        if (p) p.textContent = ((queriedData.permit || []).length || 0) + ' / ' + ((mergeUploadedData.permit || []).length || 0);
        const c = safeGetElement('merge-stats-complete');
        if (c) c.textContent = ((queriedData.complete || []).length || 0) + ' / ' + ((mergeUploadedData.complete || []).length || 0);
        const m = safeGetElement('merge-stats-master');
        if (m) m.textContent = ((mergeUploadedData.master || []).length || 0);
        const mm = safeGetElement('merge-stats-merge');
        if (mm) mm.textContent = ((currentData && currentData.merge) || []).length;
    } catch (e) { console.warn('refreshMergeStats 失败:', e); }
}

// 🔴✅ 合并 Tab：处理 CSV 上传（三表 basic/permit/complete + 主表 master）→ 写入 mergeUploadedData，不覆盖查询数据！
function handleMergeUploadFile(type, file) {
    if (!file) return;
    const typeLabelMap = { basic: '基本信息', permit: '施工许可', complete: '竣工验收备案', master: '主表' };
    const typeLabel = typeLabelMap[type] || type;
    const infoEl = safeGetElement('merge-upload-info-' + type);
    try {
        if (infoEl) { infoEl.style.color = '#1890ff'; infoEl.textContent = '⏳ 正在解析文件: ' + (file.name || ''); }
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = ev.target && ev.target.result ? String(ev.target.result) : '';
                const rows = parseCSV(text);
                if (!rows || rows.length === 0) {
                    if (infoEl) { infoEl.style.color = '#ff4d4f'; infoEl.textContent = '❌ 解析失败：CSV没有数据行！文件=' + file.name; }
                    updateStatus('merge-status', '❌ ' + typeLabel + ' CSV解析失败：没有数据行，请检查文件格式。', 'error');
                    return;
                }
                // 🔴 写入 mergeUploadedData[type]，绝不覆盖 queriedData（提取数据独立保存！）
                mergeUploadedData[type] = rows;
                // 如果是主表，顺便记录它的原始字段顺序（导出时保留用户原表列顺序）
                if (type === 'master') {
                    masterOriginalFields = [];
                    const usedMasterField = new Set();
                    function pushMasterField(k) {
                        if (!k || usedMasterField.has(k)) return;
                        usedMasterField.add(k);
                        masterOriginalFields.push(k);
                    }
                    // 从第一行收集字段顺序
                    if (rows[0]) Object.keys(rows[0]).forEach(pushMasterField);
                    // 如果 CSV 行数为 1 且那行是空的，再兜底遍历所有行
                    if (masterOriginalFields.length < 10) {
                        rows.forEach(r => { if (r) Object.keys(r).forEach(pushMasterField); });
                    }
                }
                refreshMergeStats();
                if (infoEl) {
                    infoEl.style.color = '#389e0d';
                    infoEl.textContent = '✅ ' + (type === 'master' ? '主表已加载 ' : '解析成功 ') + rows.length + ' 条（文件：' + file.name + '）';
                }
                const hint = type === 'master'
                    ? '✅ 主表已加载！生成合并表时将以主表为基准，自动生成变更备注。'
                    : '✅ ' + typeLabel + ' CSV 解析成功！共 ' + rows.length + ' 条。将与查询数据自动合并去重。';
                updateStatus('merge-status', hint, 'success');
                console.log('[mergeUpload] ✅ type=' + type + ' 上传成功：' + rows.length + '行，文件=' + file.name);
            } catch (eInner) {
                console.error('[mergeUpload] 解析异常:', eInner);
                if (infoEl) { infoEl.style.color = '#ff4d4f'; infoEl.textContent = '❌ 解析异常: ' + (eInner.message || String(eInner)); }
                updateStatus('merge-status', '❌ ' + typeLabel + ' CSV解析异常：' + (eInner.message || String(eInner)), 'error');
            }
        };
        reader.onerror = () => {
            if (infoEl) { infoEl.style.color = '#ff4d4f'; infoEl.textContent = '❌ 文件读取失败'; }
            updateStatus('merge-status', '❌ ' + typeLabel + ' 文件读取失败！', 'error');
        };
        reader.readAsText(file, 'utf-8');
    } catch (e) {
        console.error('[mergeUpload] 外层异常:', e);
        if (infoEl) { infoEl.style.color = '#ff4d4f'; infoEl.textContent = '❌ 处理失败: ' + (e.message || String(e)); }
    }
}

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
    const key = type === 'basic' ? '项目名称' : (type === 'complete' ? '工程名称' : '施工许可证编号');
    return [...data].sort((a, b) => (a[key] || '').toString().localeCompare(b[key] || '', 'zh-CN'));
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
function sendToContent(message, callback, fallbackCallback, errorCallback) {
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
                if (gotData && actualPage > 0 && actualPage !== currentPage) {
                    console.warn('[popup] ⚠️ 翻页错乱：请求页=' + currentPage + ', 实际抓到的页=' + actualPage + ' → 这一页数据丢弃，重抓！');
                    retryCount[type]++;
                    if (retryCount[type] >= 3) {
                        console.warn('[popup] ⚠️ 翻页重抓超过3次，放弃这一页继续下一页');
                        retryCount[type] = 0;
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
                // 🔴✅ API 直取方案（type=basic）适配：处理新增字段
                // 1. resp.duplicate = true → 本页与上一页 100% 重复，后端截断！立即停止翻页
                // 2. resp.totalPages / resp.total → 真实总页数/总条数，更新 totalPages 让进度准确
                // 3. resp.via === 'api' / resp.needCaptcha → 日志和提示
                // ================================================================
                var viaApi = resp && resp.via === 'api';
                var forceStop = false;
                if (resp && resp.duplicate === true) {
                    forceStop = true;
                    console.warn('[popup] ⚠️ 后端深度分页截断！第' + currentPage + '页与上一页完全重复 → 停止翻页，已有数据=' + allListResults.length + ' 条');
                    try {
                        updateStatus(statusId,
                            '⚠️ 触发后端深度分页保护（连续重复页）！已停止翻页。建议：全部页模式 + 取消筛选条件抓全量，然后本地 Excel 里筛选。\n' +
                            '—— 当前已获取 ' + allListResults.length + ' 条数据，进入详情提取...',
                            'warn');
                    } catch (e) {}
                }
                if (viaApi && resp && typeof resp.totalPages === 'number' && resp.totalPages > 0) {
                    // 用 API 返回的真实总页数覆盖用户设置的 endPage（可能是 9999）
                    var newTotalPages = resp.totalPages;
                    if (type === 'basic' && filters && filters.pageMode === 'all') {
                        if (newTotalPages > totalPages) {
                            // API 返回的总页数比原来 DOM 探测到的更准 → 用新的
                            console.log('[popup] 📊 API 返回真实总页数：totalPages=' + totalPages + ' → 更新为 ' + newTotalPages);
                            totalPages = newTotalPages;
                        } else if (newTotalPages < totalPages && !forceStop) {
                            totalPages = newTotalPages;
                        }
                    } else if (type === 'basic' && newTotalPages < totalPages && !forceStop) {
                        // 有筛选条件时，API 返回的总页数可能更少
                        totalPages = Math.min(totalPages, newTotalPages);
                    }
                }
                if (viaApi && resp && resp.total) {
                    try { console.log('[popup] 📊 API 返回总条数: total=' + resp.total + ', 筛选条件:', resp.filterParams || {}); } catch (e) {}
                }

                if (gotData && !forceStop) {
                    var viaStr = viaApi ? ('[API' + (resp.needCaptcha ? '+验证码' : '') + ']') : '[DOM]';
                    console.log('[popup] 📄 ' + viaStr + ' 第' + currentPage + '页抓取成功（请求=' + currentPage + ', 实际=' + (actualPage || '?') + '）+ ' + resp.data.length + ' 条 → 累计=' + (allListResults.length + resp.data.length));
                    allListResults = allListResults.concat(resp.data);
                } else if (forceStop) {
                    // 重复页不追加数据（会导致重复）
                } else if (resp && resp.error) {
                    console.warn('[popup] 📄 第' + currentPage + '页抓失败: ' + resp.error);
                } else {
                    console.log('[popup] 📄 第' + currentPage + '页无数据（可能已到最后一页）');
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
                        updateStatus(statusId, '⚠️ 未提取到任何数据，请检查筛选条件。', 'error');
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

    console.log('[popup] 📄 startDetailPhase: 列表总数=' + allListResults.length + ', 有detailUrl的=' + totalDetail);
    if (rowsWithUrl.length > 0) {
        console.log('[popup]  前3条的详情URL示例:', rowsWithUrl.slice(0, 3).map((r, i) => ({
            idx: i,
            name: r['项目名称'] || r['工程名称'] || '?',
            id: r['省级项目编号'] || r['施工许可证编号'] || '?',
            detailUrl: r.detailUrl
        })));
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

        // 📄 设置超时时间
        // 🔴 直接构造真实URL的情况占绝大多数，速度快；仿真点击极少才会触发
        const isSimulate = row.detailUrl === '__SIMULATE_CLICK__';
        const timeoutMs = isSimulate ? 60000 : 25000;
        if (idx < 2) console.log(`[popup]   详情${idx+1} 超时设置=${timeoutMs/1000}s, isSimulate=${isSimulate}`);
        let msgTimeout = setTimeout(function () {
            console.warn(`[popup]   详情${idx+1}(idx=${idx}) 超时（${timeoutMs/1000}s），填空结果继续...`);
            // 🔴 超时不丢位置，填空对象占住，保证后续位置不错位
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
            // （isSimulate 在 msgTimeout 声明上方已定义）
            if (isSimulate) {
                // 仿真点击：传定位器给 background
                chrome.runtime.sendMessage(
                    { action: 'findClickAndExtractDetail', locator: row._locator, type: type, rowIndex: idx, listRow: row },
                    (resp) => {
                        try { clearTimeout(msgTimeout); } catch (e) {}
                        if (phaseFinished) return;
                        if (stopRequested[type]) { finishPhase(); return; }
                        const fieldCount = (resp && resp.data) ? Object.keys(resp.data).length : 0;
                        // 🔴✅ 不管成功失败，一律按 idx 占位置，保证数组顺序严格等于 rowsWithUrl 顺序！
                        if (resp && resp.data && typeof resp.data === 'object') {
                            currentDetailResults[idx] = resp.data;
                        } else {
                            currentDetailResults[idx] = {};
                        }
                        if (resp && resp.success && resp.data && fieldCount > 0) {
                            if (idx < 3) console.log(`[popup]   详情${idx+1}(idx=${idx})（仿真点击）提取成功(${fieldCount}字段):`, resp.data);
                            else if (idx === 3) console.log(`[popup]   后面详情的日志不再逐条打印...`);
                        } else {
                            console.warn(`[popup]   详情${idx+1}(idx=${idx})（仿真点击）失败/空，填空占位。success=${resp && resp.success}, fields=${fieldCount}`, resp && resp.error ? 'error=' + resp.error : '');
                        }
                        processedCount++;
                        if (currentIdx >= rowsWithUrl.length && processedCount >= totalDetail) {
                            setTimeout(finishPhase, 200);
                        } else {
                            setTimeout(processNextDetailItem, 50);
                        }
                    }
                );
            } else {
                chrome.runtime.sendMessage(
                    { action: 'openAndExtractDetail', url: row.detailUrl, type: type, rowIndex: idx, listRow: row },
                    (resp) => {
                        try { clearTimeout(msgTimeout); } catch (e) {}
                        if (phaseFinished) return;
                        if (stopRequested[type]) { finishPhase(); return; }
                        const fieldCount = (resp && resp.data) ? Object.keys(resp.data).length : 0;
                        // 🔴✅ 不管成功失败，一律按 idx 占位置，并发回调打乱也不会错位！
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
            }
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

    // 🔴✅ 并发设置：
    // 1. type=complete（竣工验收备案）：100% 强制并发=1！因为是在同一个列表 tab 里点链接→弹 Modal，
    //    同时点两行会导致弹窗覆盖、前一个关不掉、定位错乱，完全死锁！
    // 2. 仿真点击(__SIMULATE_CLICK__)的 basic/permit 也只能串行
    // 3. 有真实 href 的 basic/permit 才能并发=2（开新 tab 互不干扰）
    const hasSimulate = type === 'complete' || rowsWithUrl.some(r => r.detailUrl === '__SIMULATE_CLICK__');
    const concurrency = hasSimulate ? 1 : 2;
    console.log(`[popup] 📄 类型=${type}, 并发设置=${concurrency}(1=串行/2=并行), 存在仿真点击项=${hasSimulate}`);
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

        isExtracting[type] = false;
        if (stopBtn) stopBtn.style.display = 'none';

        if (stopRequested[type]) {
            updateStatus(statusId, `⏹ 已停止。已保存 ${currentData[type].length} 条数据${detailCnt > 0 ? '（含 ' + detailCnt + ' 条详情）' : ''}。`, '');
        } else {
            updateStatus(statusId, `✅ 提取完成！共 ${currentData[type].length} 条数据${detailCnt > 0 ? '（含 ' + detailCnt + ' 条详情）' : ''}。`, 'success');
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
        isExtracting[type] = false;
        if (stopBtn) stopBtn.style.display = 'none';
        updateStatus(statusId, `✅ 提取完成（仅列表数据）！共 ${currentData[type].length} 条。`, 'success');
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
// ===== 基本信息 Tab =====
// ============================================================
const basicExtractBtn = safeGetElement('basic-extract');
if (basicExtractBtn) {
    basicExtractBtn.addEventListener('click', () => {
        const baseFilters = {
            projectName: (safeGetElement('basic-projectName')?.value || '').trim(),
            unit: (safeGetElement('basic-unit')?.value || '').trim(),
            code: (safeGetElement('basic-code')?.value || '').trim(),
            city: (safeGetElement('basic-city')?.value || '').trim(),
            startPage: Math.max(1, Number(safeGetElement('basic-startPage')?.value) || 1),
            endPage: Math.max(1, Number(safeGetElement('basic-endPage')?.value) || 1),
            // 🔴✅ 新增：抓取模式（api/dom）+ API 模式每页条数
            fetchMode: (safeGetElement('basic-fetchMode')?.value || 'api'),
            apiPageSize: Math.min(500, Math.max(10, Number(safeGetElement('basic-apiPageSize')?.value) || 100))
        };
        buildFiltersAndDoExtract('basic', baseFilters);
    });
}
const basicStopBtn = safeGetElement('basic-stop');
if (basicStopBtn) basicStopBtn.addEventListener('click', () => stopExtract('basic'));

const basicPreviewBtn = safeGetElement('basic-preview');
if (basicPreviewBtn) {
    basicPreviewBtn.addEventListener('click', () => {
        if (!currentData.basic || currentData.basic.length === 0) {
            updateStatus('basic-status', '⚠️ 暂无数据，请先执行提取操作。', '');
            return;
        }
        renderTable('basic-table', currentData.basic, BASIC_FIELDS);
        updateStatus('basic-status', `📋 预览共 ${currentData.basic.length} 条数据。`, 'success');
    });
}
const basicExportBtn = safeGetElement('basic-export');
if (basicExportBtn) {
    basicExportBtn.addEventListener('click', () => {
        if (!currentData.basic || currentData.basic.length === 0) {
            updateStatus('basic-status', '⚠️ 暂无数据可导出！', '');
            return;
        }
        const isNumber = (f) => f === '总投资（万元）' || f === '总面积/长度（平方米/米）';
        const csv = generateCSV(currentData.basic, BASIC_FIELDS, isNumber);
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        downloadCSV(csv, '基本信息_' + date + '.csv');
        updateStatus('basic-status', `💾 CSV已导出！共 ${currentData.basic.length} 条。`, 'success');
    });
}
const basicClearBtn = safeGetElement('basic-clear');
if (basicClearBtn) {
    basicClearBtn.addEventListener('click', () => {
        currentData.basic = [];
        try { chrome.runtime.sendMessage({ action: 'clearResults', type: 'basic' }); } catch (e) {}
        const tbl = safeGetElement('basic-table');
        if (tbl) { tbl.style.display = 'none'; tbl.innerHTML = ''; }
        updateStatus('basic-status', '🗑 数据已清空。');
    });
}

// ============================================================
// ===== 施工许可 Tab =====
// ============================================================
const permitExtractBtn = safeGetElement('permit-extract');
if (permitExtractBtn) {
    permitExtractBtn.addEventListener('click', () => {
        const baseFilters = {
            projectName: (safeGetElement('permit-projectName')?.value || '').trim(),
            code: (safeGetElement('permit-code')?.value || '').trim(),
            permitNo: (safeGetElement('permit-permitNo')?.value || '').trim(),
            authority: (safeGetElement('permit-authority')?.value || '').trim(),
            startDate: safeGetElement('permit-startDate')?.value || '',
            endDate: safeGetElement('permit-endDate')?.value || '',
            city: (safeGetElement('permit-city')?.value || '').trim(),
            startPage: Math.max(1, Number(safeGetElement('permit-startPage')?.value) || 1),
            endPage: Math.max(1, Number(safeGetElement('permit-endPage')?.value) || 1)
        };
        buildFiltersAndDoExtract('permit', baseFilters);
    });
}
const permitStopBtn = safeGetElement('permit-stop');
if (permitStopBtn) permitStopBtn.addEventListener('click', () => stopExtract('permit'));

const permitPreviewBtn = safeGetElement('permit-preview');
if (permitPreviewBtn) {
    permitPreviewBtn.addEventListener('click', () => {
        if (!currentData.permit || currentData.permit.length === 0) {
            updateStatus('permit-status', '⚠️ 暂无数据，请先执行提取操作。', '');
            return;
        }
        renderTable('permit-table', currentData.permit, PERMIT_FIELDS);
        updateStatus('permit-status', `📋 预览共 ${currentData.permit.length} 条数据。`, 'success');
    });
}
const permitExportBtn = safeGetElement('permit-export');
if (permitExportBtn) {
    permitExportBtn.addEventListener('click', () => {
        if (!currentData.permit || currentData.permit.length === 0) {
            updateStatus('permit-status', '⚠️ 暂无数据可导出！', '');
            return;
        }
        const csv = generateCSV(currentData.permit, PERMIT_FIELDS, (f) => f === '合同价格');
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        downloadCSV(csv, '施工许可_' + date + '.csv');
        updateStatus('permit-status', `💾 CSV已导出！共 ${currentData.permit.length} 条。`, 'success');
    });
}
const permitClearBtn = safeGetElement('permit-clear');
if (permitClearBtn) {
    permitClearBtn.addEventListener('click', () => {
        currentData.permit = [];
        try { chrome.runtime.sendMessage({ action: 'clearResults', type: 'permit' }); } catch (e) {}
        const tbl = safeGetElement('permit-table');
        if (tbl) { tbl.style.display = 'none'; tbl.innerHTML = ''; }
        updateStatus('permit-status', '🗑 数据已清空。');
    });
}

// ============================================================
// ===== 竣工验收备案 Tab =====
// ============================================================
const completeExtractBtn = safeGetElement('complete-extract');
if (completeExtractBtn) {
    completeExtractBtn.addEventListener('click', () => {
        const baseFilters = {
            projectName: (safeGetElement('complete-projectName')?.value || '').trim(),
            code: (safeGetElement('complete-code')?.value || '').trim(),
            authority: (safeGetElement('complete-authority')?.value || '').trim(),
            recordNo: (safeGetElement('complete-recordNo')?.value || '').trim(),
            startPage: Math.max(1, Number(safeGetElement('complete-startPage')?.value) || 1),
            endPage: Math.max(1, Number(safeGetElement('complete-endPage')?.value) || 1)
        };
        buildFiltersAndDoExtract('complete', baseFilters);
    });
}
const completeStopBtn = safeGetElement('complete-stop');
if (completeStopBtn) completeStopBtn.addEventListener('click', () => stopExtract('complete'));

const completePreviewBtn = safeGetElement('complete-preview');
if (completePreviewBtn) {
    completePreviewBtn.addEventListener('click', () => {
        if (!currentData.complete || currentData.complete.length === 0) {
            updateStatus('complete-status', '⚠️ 暂无数据，请先执行提取操作。', '');
            return;
        }
        renderTable('complete-table', currentData.complete, COMPLETE_FIELDS);
        updateStatus('complete-status', `📋 预览共 ${currentData.complete.length} 条数据。`, 'success');
    });
}
const completeExportBtn = safeGetElement('complete-export');
if (completeExportBtn) {
    completeExportBtn.addEventListener('click', () => {
        if (!currentData.complete || currentData.complete.length === 0) {
            updateStatus('complete-status', '⚠️ 暂无数据可导出！', '');
            return;
        }
        const isNumber = (f) => f === '实际造价（万元）' || f === '实际面积（平方米）';
        const csv = generateCSV(currentData.complete, COMPLETE_FIELDS, isNumber);
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        downloadCSV(csv, '竣工验收备案_' + date + '.csv');
        updateStatus('complete-status', `💾 CSV已导出！共 ${currentData.complete.length} 条。`, 'success');
    });
}
const completeClearBtn = safeGetElement('complete-clear');
if (completeClearBtn) {
    completeClearBtn.addEventListener('click', () => {
        currentData.complete = [];
        try { chrome.runtime.sendMessage({ action: 'clearResults', type: 'complete' }); } catch (e) {}
        const tbl = safeGetElement('complete-table');
        if (tbl) { tbl.style.display = 'none'; tbl.innerHTML = ''; }
        updateStatus('complete-status', '🗑 数据已清空。');
    });
}

// ============================================================
// ===== 显示方式切换（侧边栏 / 弹窗 / 新窗口） =====
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
// ===== 合并导出 Tab =====
// ============================================================
let lastFinalFields = []; // 🔴 记录生成合并表时最终字段顺序（导出直接复用，避免重复计算 + 保证主表列顺序保留）
const mergeGenerateBtn = safeGetElement('merge-generate');
if (mergeGenerateBtn) {
    mergeGenerateBtn.addEventListener('click', () => {
        // ========== Step 0：同步 currentData → queriedData，并判断有没有数据 ==========
        refreshMergeStats();
        const qBasic    = queriedData.basic    || [];
        const qPermit   = queriedData.permit   || [];
        const qComplete = queriedData.complete || [];
        const uBasic    = mergeUploadedData.basic    || [];
        const uPermit   = mergeUploadedData.permit   || [];
        const uComplete = mergeUploadedData.complete || [];
        const hasMaster = (mergeUploadedData.master && mergeUploadedData.master.length > 0);

        if ((qBasic.length + qPermit.length + qComplete.length +
             uBasic.length + uPermit.length + uComplete.length) === 0) {
            updateStatus('merge-status', '⚠️ 请先提取或上传至少一类数据（基本信息 / 施工许可 / 竣工验收备案）。', '');
            return;
        }

        // ========== Step 1：🔴 需求2 — 同名表优先合并去重（查询数据 + 上传CSV → 各类型一张去重后新表）==========
        const finalBasic    = mergeSameType(qBasic, uBasic, 'basic');
        const finalPermit   = mergeSameType(qPermit, uPermit, 'permit');
        const finalComplete = mergeSameType(qComplete, uComplete, 'complete');
        console.log('[merge] Step1-同名表合并后：basic=' + finalBasic.length + ' permit=' + finalPermit.length + ' complete=' + finalComplete.length);

        // ========== Step 2：三表交叉合并（沿用原有 1:N 关联逻辑，确保兼容）==========
        const projectCodeField = '省级项目编号';
        const projectNameField = '工程名称';
        const PREFIX_BASIC    = '';
        const PREFIX_PERMIT   = '许可_';
        const PREFIX_COMPLETE = '竣工_';
        // 计算重名字段
        const allFieldCount = {};
        BASIC_FIELDS.forEach(f    => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
        PERMIT_FIELDS.forEach(f   => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
        COMPLETE_FIELDS.forEach(f => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
        const dupFieldSet = new Set(Object.keys(allFieldCount).filter(f => allFieldCount[f] >= 2));
        dupFieldSet.delete(projectCodeField);
        dupFieldSet.delete(projectNameField);
        function renameField(source, fieldName) {
            if (!dupFieldSet.has(fieldName)) return fieldName;
            if (source === 'basic')    return PREFIX_BASIC + fieldName;
            if (source === 'permit')   return PREFIX_PERMIT + fieldName;
            if (source === 'complete') return PREFIX_COMPLETE + fieldName;
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

        // basic / complete 索引
        const basicByCode = {};
        finalBasic.forEach(r => {
            const code = r[projectCodeField];
            if (code) { (basicByCode[code] = basicByCode[code] || []).push(r); }
        });
        const completeByName = {};
        finalComplete.forEach(r => {
            const name = r[projectNameField];
            if (name) { (completeByName[name] = completeByName[name] || []).push(r); }
        });

        // 主线：施工许可 → permit × basic × complete 1:N 展开
        let freshMerged = [];
        const usedBasicCode = new Set();
        const usedCompleteName = new Set();
        finalPermit.forEach(permitRow => {
            const code = permitRow[projectCodeField];
            const name = permitRow[projectNameField];
            let basics = code && basicByCode[code] ? basicByCode[code] : [null];
            if (basics.length === 0) basics = [null];
            let completes = name && completeByName[name] ? completeByName[name] : [null];
            if (completes.length === 0) completes = [null];
            basics.forEach(bRow => {
                if (bRow && code) usedBasicCode.add(code);
                completes.forEach(cRow => {
                    if (cRow && name) usedCompleteName.add(name);
                    const row = {};
                    Object.assign(row, prefixRow(bRow, 'basic'));
                    Object.assign(row, prefixRow(permitRow, 'permit'));
                    Object.assign(row, prefixRow(cRow, 'complete'));
                    if (!row[projectCodeField]) row[projectCodeField] = (bRow && bRow[projectCodeField]) || (cRow && cRow[projectCodeField]) || code || '';
                    if (!row[projectNameField]) row[projectNameField] = (permitRow && permitRow[projectNameField]) || (bRow && bRow[projectNameField]) || (cRow && cRow[projectNameField]) || name || '';
                    freshMerged.push(row);
                });
            });
        });
        // 补没匹配到的 basic
        finalBasic.forEach(bRow => {
            const code = bRow[projectCodeField];
            if (code && usedBasicCode.has(code)) return;
            const row = prefixRow(bRow, 'basic');
            if (!row[projectCodeField]) row[projectCodeField] = code || '';
            if (!row[projectNameField]) row[projectNameField] = bRow[projectNameField] || '';
            freshMerged.push(row);
            if (code) usedBasicCode.add(code);
        });
        // 补没匹配到的 complete
        finalComplete.forEach(cRow => {
            const name = cRow[projectNameField];
            if (name && usedCompleteName.has(name)) return;
            const code = cRow[projectCodeField];
            const basics = code && basicByCode[code] ? basicByCode[code] : [null];
            basics.forEach(bRow => {
                const row = {};
                Object.assign(row, prefixRow(bRow, 'basic'));
                Object.assign(row, prefixRow(cRow, 'complete'));
                if (!row[projectCodeField]) row[projectCodeField] = (bRow && bRow[projectCodeField]) || code || '';
                if (!row[projectNameField]) row[projectNameField] = name || (bRow && bRow[projectNameField]) || '';
                freshMerged.push(row);
                if (name) usedCompleteName.add(name);
            });
        });
        // 兜底：完全没 permit 只有 basic+complete → 按工程名称/项目编号关联
        if (finalPermit.length === 0 && finalBasic.length > 0 && finalComplete.length > 0) {
            freshMerged = [];
            const usedC = new Set();
            finalBasic.forEach(bRow => {
                const code = bRow[projectCodeField];
                const name = bRow[projectNameField];
                let completes = name && completeByName[name] ? completeByName[name] : null;
                if (!completes && code) {
                    const cc = finalComplete.filter(c => c[projectCodeField] === code);
                    if (cc.length > 0) completes = cc;
                }
                if (!completes) completes = [null];
                completes.forEach(cRow => {
                    const row = {};
                    Object.assign(row, prefixRow(bRow, 'basic'));
                    Object.assign(row, prefixRow(cRow, 'complete'));
                    if (!row[projectCodeField]) row[projectCodeField] = code || '';
                    if (!row[projectNameField]) row[projectNameField] = name || (cRow && cRow[projectNameField]) || '';
                    freshMerged.push(row);
                    const cn = cRow && cRow[projectNameField];
                    if (cn) usedC.add(cn);
                });
            });
            finalComplete.forEach(cRow => {
                const n = cRow[projectNameField];
                if (n && usedC.has(n)) return;
                const row = prefixRow(cRow, 'complete');
                if (!row[projectCodeField]) row[projectCodeField] = cRow[projectCodeField] || '';
                if (!row[projectNameField]) row[projectNameField] = n || '';
                freshMerged.push(row);
                if (n) usedC.add(n);
            });
        }
        console.log('[merge] Step2-三表交叉后 freshMerged.length=' + freshMerged.length);

        // ========== Step 3：构建完整字段列表（含变更备注），给 freshMerged 所有行补全 ==========
        const fullBuild = buildFullMergedFieldList();
        const fullFields = fullBuild.finalFields;
        freshMerged = freshMerged.map(r => padRowToFullFields(r, fullFields));

        // ========== Step 4：🔴 需求3 — 主表模式 / 普通模式 ==========
        let finalMergedRows = [];
        let finalDisplayFields = [];
        const ts = nowStr();

        if (hasMaster) {
            // ========== 🔴 主表模式：以主表为基准 ==========
            const masterRows = mergeUploadedData.master.slice();
            // 1) 主表本身也要补齐完整字段（缺啥补啥，方便后续对比）
            const paddedMaster = masterRows.map(mr => padRowToFullFields(mr, fullFields));
            // 2) freshMerged 按外键指纹建立索引 → 给主表快速找匹配
            const freshByFP = {};    // 指纹 → 行数组（1:N）
            const freshByCode = {};  // 单独项目编号 → 行数组（兜底）
            const freshUsed = new Set(); // 已被主表匹配过的 freshMerged 下标，剩下的追加
            freshMerged.forEach((fr, idx) => {
                const fp = rowMatchFingerprint(fr);
                if (fp.key) { (freshByFP[fp.key] = freshByFP[fp.key] || []).push({ r: fr, i: idx }); }
                if (fp.code) { (freshByCode[fp.code] = freshByCode[fp.code] || []).push({ r: fr, i: idx }); }
            });

            // 3) 遍历主表，给每一行找匹配 + 计算变更 + 追加备注
            paddedMaster.forEach(mRow => {
                const outRow = Object.assign({}, mRow); // 以主表原字段值为基准
                // 先补齐三表字段（如果主表缺的，值保持空，变更备注里如果有会写「新增」）
                fullFields.forEach(f => {
                    if (!Object.prototype.hasOwnProperty.call(outRow, f) || outRow[f] === undefined || outRow[f] === null) {
                        outRow[f] = '';
                    }
                });
                const mFP = rowMatchFingerprint(mRow);
                let matchArr = [];
                if (mFP.key && freshByFP[mFP.key]) matchArr = freshByFP[mFP.key];
                else if (mFP.code && freshByCode[mFP.code]) matchArr = freshByCode[mFP.code];

                if (matchArr.length === 0) {
                    // 主表有，但本次 freshMerged 没有匹配 → 备注「本次无匹配数据」
                    const note = `1、在${ts}本条记录（${mFP.code || ''} ${mFP.name || ''}）在本次查询与上传合并结果中无匹配数据`;
                    const prev = String(outRow[CHANGE_NOTE_FIELD] || '').trim();
                    outRow[CHANGE_NOTE_FIELD] = prev ? (prev + '\n' + note) : note;
                } else {
                    // 取匹配度最高的第一个匹配（CN_ > C_ > N_），主表是 1:1 保留
                    const first = matchArr[0];
                    freshUsed.add(first.i);
                    const fr = first.r;
                    // 以主表为基准 → 先拷贝主表原值 outRow，再计算差异
                    const diffs = calcRowDiffs(outRow, fr, fullFields, ts);
                    if (diffs.length > 0) {
                        // 序号从已有备注推断
                        const prev = String(outRow[CHANGE_NOTE_FIELD] || '').trim();
                        let startIdx = 1;
                        if (prev) {
                            // 把上一条最后一个 "N、" 里的 N 取出来 + 1
                            const m = prev.match(/(\d+)[、\.．]/g);
                            if (m && m.length > 0) {
                                const last = m[m.length - 1].replace(/[^\d]/g, '');
                                const n = parseInt(last, 10);
                                if (!isNaN(n)) startIdx = n + 1;
                            }
                        }
                        const newNotes = diffs.map((d, i) => (startIdx + i) + '、' + d);
                        outRow[CHANGE_NOTE_FIELD] = prev ? (prev + '\n' + newNotes.join('\n')) : newNotes.join('\n');
                    }
                    // 🔴 以主表为基准 → 只在主表某字段为空时，才用 freshMerged 的有值字段覆盖（用户明确要求主表为基准，所以绝不覆盖有值的！）
                    Object.keys(fr).forEach(k => {
                        const v = fr[k];
                        if (v === undefined || v === null) return;
                        const sv = String(v).trim();
                        if (sv === '') return;
                        const cur = outRow[k];
                        const scur = (cur === undefined || cur === null) ? '' : String(cur).trim();
                        if (scur === '') {
                            outRow[k] = v; // 主表该列空，才填充
                        }
                    });
                    // 最后再次补齐（主表自定义列 + 完整字段都在）
                    fullFields.forEach(f => {
                        if (!Object.prototype.hasOwnProperty.call(outRow, f)) outRow[f] = '';
                    });
                }
                finalMergedRows.push(outRow);
            });

            // 4) freshMerged 里没被主表匹配到的 → 全部追加为「新增记录」
            freshMerged.forEach((fr, idx) => {
                if (freshUsed.has(idx)) return;
                const fFP = rowMatchFingerprint(fr);
                const outRow = padRowToFullFields(fr, fullFields);
                // 新增：字段有值的都视为「新增」（简化处理：只给一条总备注，不逐个字段列，避免变更备注爆炸）
                const note = `1、在${ts}新增了本条记录（${fFP.code || ''} ${fFP.name || ''}），共${Object.keys(fr).filter(k => k !== CHANGE_NOTE_FIELD && fr[k] !== undefined && fr[k] !== null && String(fr[k]).trim() !== '').length}个字段有数据`;
                outRow[CHANGE_NOTE_FIELD] = note;
                finalMergedRows.push(outRow);
            });

            // 5) 最终字段顺序：【主表原始字段顺序】→ 补【fullFields 里主表没的字段】→ 变更备注放最后
            const ffs = [];
            const addedFF = new Set();
            function pushFF(name) { if (!name || addedFF.has(name)) return; addedFF.add(name); ffs.push(name); }
            // 主表原始列优先（去重）
            (masterOriginalFields || []).forEach(k => pushFF(k));
            // fullFields 里没出现过的全部补进去（保证三表字段齐全！）
            fullFields.forEach(f => { if (f !== CHANGE_NOTE_FIELD) pushFF(f); });
            // 自定义列（finalMergedRows 里可能有主表用户自己加的列）
            finalMergedRows.forEach(r => { if (r) Object.keys(r).forEach(k => pushFF(k)); });
            // 变更备注一定在最后！
            if (addedFF.has(CHANGE_NOTE_FIELD)) {
                // 如果主表原始列里已经有变更备注，移到最后
                const pos = ffs.indexOf(CHANGE_NOTE_FIELD);
                if (pos >= 0) ffs.splice(pos, 1);
            }
            ffs.push(CHANGE_NOTE_FIELD);
            finalDisplayFields = ffs;
        } else {
            // ========== 普通模式（无主表）：沿用原有融合，但补全所有字段 + 变更备注 ==========
            finalMergedRows = freshMerged.map(r => {
                const row = Object.assign({}, r);
                // 变更备注：记录是在什么时候合并出来的（没有历史数据没法比具体差异，但保证列存在）
                const hasAny = Object.keys(row).some(k => k !== CHANGE_NOTE_FIELD && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '');
                if (hasAny) {
                    const prev = String(row[CHANGE_NOTE_FIELD] || '').trim();
                    const note = `1、在${ts}通过查询与上传合并生成该记录（融合模式，未上传主表）`;
                    row[CHANGE_NOTE_FIELD] = prev ? (prev + '\n' + note) : note;
                }
                return row;
            });
            // 最终字段顺序：fullFields（三表齐全 + 变更备注末尾），再加 freshMerged 里可能存在的自定义列
            const ffs = [];
            const addedFF = new Set();
            function pushFF(name) { if (!name || addedFF.has(name)) return; addedFF.add(name); ffs.push(name); }
            fullFields.forEach(f => pushFF(f));
            finalMergedRows.forEach(r => { if (r) Object.keys(r).forEach(k => pushFF(k)); });
            // 变更备注移到最后
            if (addedFF.has(CHANGE_NOTE_FIELD)) {
                const pos = ffs.indexOf(CHANGE_NOTE_FIELD);
                if (pos >= 0) ffs.splice(pos, 1);
            }
            ffs.push(CHANGE_NOTE_FIELD);
            finalDisplayFields = ffs;
        }

        // ========== Step 5：收尾（渲染 + 状态 + 统计）==========
        // 导出字段也用 finalDisplayFields（主表模式保留原列顺序，普通模式三表齐全）
        lastFinalFields = finalDisplayFields.slice();
        currentData.merge = finalMergedRows;
        renderTable('merge-table', finalMergedRows, finalDisplayFields);
        refreshMergeStats();

        const modeText = hasMaster ? `（主表模式：${mergeUploadedData.master.length}条 + 新合并追加${Math.max(0, finalMergedRows.length - mergeUploadedData.master.length)}条）` : '（融合模式，未上传主表）';
        updateStatus('merge-status',
            `✅ 合并完成！共 ${finalMergedRows.length} 条 ${modeText}` +
            ` | 同名表合并后：基本信息=${finalBasic.length} 施工许可=${finalPermit.length} 竣工验收=${finalComplete.length}` +
            ` | 重名字段${dupFieldSet.size}个已加前缀`,
            'success');
    });
}

// 🔴✅ 合并 Tab：绑定 4 个上传区域（basic/permit/complete/master）的 click 和 change
['basic', 'permit', 'complete', 'master'].forEach(type => {
    const area = document.querySelector('[data-upload="' + type + '"]');
    const fileInp = document.querySelector('[data-file="' + type + '"]');
    if (area && fileInp) {
        area.addEventListener('click', (e) => {
            if (e.target && e.target.tagName === 'INPUT') return;
            fileInp.click();
        });
        fileInp.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            handleMergeUploadFile(type, f);
        });
    }
    // 🔴 需求1：单独删除某个类型的上传（三表 basic/permit/complete）
    const clearBtn = document.querySelector('[data-clear-upload="' + type + '"]');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const labelMap = { basic: '基本信息上传', permit: '施工许可上传', complete: '竣工验收备案上传' };
            mergeUploadedData[type] = [];
            const info = safeGetElement('merge-upload-info-' + type);
            if (info) { info.style.color = ''; info.textContent = type === 'basic' || type === 'permit' || type === 'complete' ? '尚未上传' : '尚未上传主表（未上传则按原有逻辑融合）'; }
            const fi = document.querySelector('[data-file="' + type + '"]');
            if (fi) try { fi.value = ''; } catch (e) {}
            refreshMergeStats();
            updateStatus('merge-status', '🗑 已删除【' + (labelMap[type] || type) + '】的数据，不影响查询数据和其他类型上传。');
        });
    }
});

// 🔴 需求1：删除主表上传
const mergeClearMasterBtn = safeGetElement('merge-clear-master');
if (mergeClearMasterBtn) {
    mergeClearMasterBtn.addEventListener('click', () => {
        mergeUploadedData.master = [];
        masterOriginalFields = [];
        const info = safeGetElement('merge-upload-info-master');
        if (info) { info.style.color = ''; info.textContent = '尚未上传主表（未上传则按原有逻辑融合）'; }
        const fi = document.querySelector('[data-file="master"]');
        if (fi) try { fi.value = ''; } catch (e) {}
        refreshMergeStats();
        updateStatus('merge-status', '🗑 已删除主表，后续生成合并表将按融合模式（无主表）进行。');
    });
}

// 🔴 需求1：🧹 清空查询数据（仅 queriedData + 同步清 currentData，不影响上传）
const mergeClearQueriedBtn = safeGetElement('merge-clear-queried');
if (mergeClearQueriedBtn) {
    mergeClearQueriedBtn.addEventListener('click', () => {
        queriedData.basic = [];
        queriedData.permit = [];
        queriedData.complete = [];
        currentData.basic = [];
        currentData.permit = [];
        currentData.complete = [];
        currentData.merge = [];
        const tbl = safeGetElement('merge-table');
        if (tbl) { tbl.style.display = 'none'; tbl.innerHTML = ''; try { delete tbl._filterState; } catch (e) {} }
        // 也通知后台清空持久化（切 Tab 不会回来）
        try {
            ['basic', 'permit', 'complete'].forEach(t => {
                chrome.runtime.sendMessage({ action: 'saveResults', type: t, data: [] });
            });
        } catch (eS) {}
        refreshMergeStats();
        updateStatus('merge-status', '🧹 已清空查询/提取的基本信息、施工许可、竣工验收备案数据（上传的CSV与主表保留）。');
    });
}

// 🔴✅ 合并 Tab：「清空上传的三表」按钮（只清 mergeUploadedData.basic/permit/complete，保留主表和查询）
const mergeClearUploadBtn = safeGetElement('merge-clearUpload');
if (mergeClearUploadBtn) {
    mergeClearUploadBtn.addEventListener('click', () => {
        mergeUploadedData.basic = [];
        mergeUploadedData.permit = [];
        mergeUploadedData.complete = [];
        currentData.merge = [];
        ['basic', 'permit', 'complete'].forEach(t => {
            const info = safeGetElement('merge-upload-info-' + t);
            if (info) { info.style.color = ''; info.textContent = '尚未上传'; }
            const fi = document.querySelector('[data-file="' + t + '"]');
            if (fi) try { fi.value = ''; } catch (e) {}
        });
        const tbl = safeGetElement('merge-table');
        if (tbl) { tbl.style.display = 'none'; tbl.innerHTML = ''; try { delete tbl._filterState; } catch (e) {} }
        refreshMergeStats();
        updateStatus('merge-status', '♻️ 已清空上传的三表CSV数据（查询数据与主表保留）。');
    });
}

// 🔴✅ 合并 Tab：打开时自动刷新统计条（用户可能在其他 Tab 提取了数据过来）
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab === 'merge') { refreshMergeStats(); }
    });
});

const mergeExportBtn = safeGetElement('merge-export');
if (mergeExportBtn) {
    mergeExportBtn.addEventListener('click', () => {
        if (!currentData.merge || currentData.merge.length === 0) {
            updateStatus('merge-status', '⚠️ 请先点击"生成合并表"。', '');
            return;
        }
        // 🔴 优先使用生成合并表时的 finalDisplayFields（主表模式保留原列顺序；普通模式三表全字段）
        let fields = Array.isArray(lastFinalFields) && lastFinalFields.length > 0
            ? lastFinalFields.slice()
            : buildFullMergedFieldList().finalFields;
        // 兜底：如果当前 data 里有字段不在 fields 里，也要补上（用户自定义列），但变更备注保持最后
        const hasCN = fields.indexOf(CHANGE_NOTE_FIELD) >= 0;
        if (hasCN) {
            const p = fields.indexOf(CHANGE_NOTE_FIELD);
            fields.splice(p, 1);
        }
        const added = new Set(fields);
        (currentData.merge || []).forEach(r => {
            if (!r) return;
            Object.keys(r).forEach(k => {
                if (!added.has(k) && k !== CHANGE_NOTE_FIELD) {
                    added.add(k);
                    fields.push(k);
                }
            });
        });
        fields.push(CHANGE_NOTE_FIELD);

        const csv = generateCSV(currentData.merge, fields, () => false);
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const hasMasterTag = (mergeUploadedData.master && mergeUploadedData.master.length > 0) ? '_主表模式' : '';
        downloadCSV(csv, '合并数据' + hasMasterTag + '_' + date + '.csv');
        updateStatus('merge-status', `💾 合并CSV已导出！共 ${currentData.merge.length} 条（${fields.length}列）。`, 'success');
    });
}

// 🔴✅ 合并 Tab：「清空全部」按钮（查询 + 上传三表 + 主表 + 合并结果 全部清空）
const mergeClearBtn = safeGetElement('merge-clear');
if (mergeClearBtn) {
    mergeClearBtn.addEventListener('click', () => {
        queriedData.basic = []; queriedData.permit = []; queriedData.complete = [];
        currentData.basic = []; currentData.permit = []; currentData.complete = []; currentData.merge = [];
        mergeUploadedData.basic = []; mergeUploadedData.permit = []; mergeUploadedData.complete = []; mergeUploadedData.master = [];
        masterOriginalFields = [];
        lastFinalFields = [];
        try {
            ['basic', 'permit', 'complete'].forEach(t => {
                chrome.runtime.sendMessage({ action: 'saveResults', type: t, data: [] });
            });
        } catch (eS) {}
        ['basic', 'permit', 'complete', 'master'].forEach(t => {
            const info = safeGetElement('merge-upload-info-' + t);
            if (info) {
                info.style.color = '';
                info.textContent = (t === 'master')
                    ? '尚未上传主表（未上传则按原有逻辑融合）'
                    : '尚未上传';
            }
            const fi = document.querySelector('[data-file="' + t + '"]');
            if (fi) try { fi.value = ''; } catch (e) {}
        });
        const tbl = safeGetElement('merge-table');
        if (tbl) { tbl.style.display = 'none'; tbl.innerHTML = ''; try { delete tbl._filterState; } catch (e) {} }
        refreshMergeStats();
        updateStatus('merge-status', '🗑 已全部清空（查询数据 / 上传三表 / 主表 / 合并结果）。');
    });
}

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

// 2) 三表各自的去重主键（同名表内用这些字段判断「是不是同一条」，全相同才认为重复）
const DEDUP_KEYS = {
    basic:    ['省级项目编号', '项目名称', '建设单位'],
    permit:   ['省级项目编号', '工程名称', '施工许可证编号'],
    complete: ['省级项目编号', '工程名称', '省级竣工验收备案编号', '竣工验收备案编号']
};
// 主表匹配外键（因为主表可能是任意合并导出结果，字段名带前缀）
const MASTER_KEY_FIELDS = ['省级项目编号', '工程名称', '项目名称',
                          '许可_工程名称', '竣工_工程名称', '许可_省级项目编号', '竣工_省级项目编号'];

// 3) 计算任意一行的「去重指纹」（返回可比较字符串）
function rowFingerprint(row, keyFields) {
    if (!row) return '__null__';
    try {
        const parts = (keyFields || []).map(k => {
            const v = row[k];
            if (v === undefined || v === null) return '';
            return String(v).replace(/\s+/g, '').trim();
        });
        return parts.join('||');
    } catch (e) { return '__err__'; }
}

// 4) 同名表合并去重（queried + uploaded → 合并后，查询数据优先保留）
function mergeSameType(queriedArr, uploadedArr, type) {
    const keys = DEDUP_KEYS[type] || ['省级项目编号', '项目名称', '工程名称'];
    const queried  = Array.isArray(queriedArr)  ? queriedArr  : [];
    const uploaded = Array.isArray(uploadedArr) ? uploadedArr : [];
    const out = [];
    const seen = new Set();
    // 查询数据先入（保留最新提取的）
    queried.forEach(r => {
        const fp = rowFingerprint(r, keys);
        if (seen.has(fp)) return;
        seen.add(fp);
        out.push(Object.assign({}, r));
    });
    // 上传数据后入（只有查询里没有的才加）
    uploaded.forEach(r => {
        const fp = rowFingerprint(r, keys);
        if (seen.has(fp)) return;
        seen.add(fp);
        out.push(Object.assign({}, r));
    });
    return out;
}

// 5) 生成「完整三表合并字段列表」（所有基本信息 + 施工许可 + 竣工验收字段，重名加前缀，保证齐全）
function buildFullMergedFieldList() {
    const projectCodeField = '省级项目编号';
    const projectNameField = '工程名称';
    const PREFIX_BASIC    = '';
    const PREFIX_PERMIT   = '许可_';
    const PREFIX_COMPLETE = '竣工_';
    const allFieldCount = {};
    BASIC_FIELDS.forEach(f    => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
    PERMIT_FIELDS.forEach(f   => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
    COMPLETE_FIELDS.forEach(f => allFieldCount[f] = (allFieldCount[f] || 0) + 1);
    const dupFieldSet = new Set(Object.keys(allFieldCount).filter(f => allFieldCount[f] >= 2));
    dupFieldSet.delete(projectCodeField);
    dupFieldSet.delete(projectNameField);
    function renameField(source, fieldName) {
        if (!dupFieldSet.has(fieldName)) return fieldName;
        if (source === 'basic')    return PREFIX_BASIC + fieldName;
        if (source === 'permit')   return PREFIX_PERMIT + fieldName;
        if (source === 'complete') return PREFIX_COMPLETE + fieldName;
        return fieldName;
    }
    const finalFields = [];
    const added = new Set();
    function pushField(name) { if (added.has(name)) return; added.add(name); finalFields.push(name); }
    pushField(projectCodeField);
    pushField(projectNameField);
    BASIC_FIELDS.forEach(f => {
        if (f !== projectCodeField && f !== projectNameField) pushField(renameField('basic', f));
    });
    PERMIT_FIELDS.forEach(f => {
        if (f !== projectCodeField && f !== projectNameField) pushField(renameField('permit', f));
    });
    COMPLETE_FIELDS.forEach(f => {
        if (f !== projectCodeField && f !== projectNameField) pushField(renameField('complete', f));
    });
    // 🔴 变更备注列放最后！
    pushField(CHANGE_NOTE_FIELD);
    return { finalFields, dupFieldSet, renameField };
}

// 6) 给一行数据补齐所有 fullFields（缺失的字段填空，方便后续对比差异）
function padRowToFullFields(row, fullFields, defaultVal) {
    const dv = defaultVal === undefined ? '' : defaultVal;
    const out = {};
    fullFields.forEach(f => { out[f] = dv; });
    if (row) {
        Object.keys(row).forEach(k => {
            if (k === undefined || k === null) return;
            const v = row[k];
            // 兼容：如果字段名带前缀的，优先匹配；否则直接赋值
            if (Object.prototype.hasOwnProperty.call(out, k)) {
                out[k] = (v === undefined || v === null) ? dv : v;
            } else {
                // 可能是老导出的字段名（没有前缀），尝试找同义词（只做基础映射，避免误写）
                const basicSynonyms = {
                    '数据等级': '数据等级', '建设单位': '建设单位', '项目所在地': '项目所在地',
                    '建设规模': '建设规模'
                };
                if (basicSynonyms[k] && Object.prototype.hasOwnProperty.call(out, basicSynonyms[k])
                    && (out[basicSynonyms[k]] === '' || out[basicSynonyms[k]] === null || out[basicSynonyms[k]] === undefined)) {
                    out[basicSynonyms[k]] = (v === undefined || v === null) ? dv : v;
                }
                // 其他字段不丢，直接追加（主表用户自定义列）
                out[k] = (v === undefined || v === null) ? dv : v;
            }
        });
    }
    return out;
}

// 7) 任意一行「提取外键指纹」（给主表找匹配用：优先 省级项目编号 + 工程名称；其次 省级项目编号 + 项目名称；再次 单独项目编号）
function rowMatchFingerprint(row) {
    if (!row) return { key: '', code: '', name: '' };
    const pick = kArr => {
        for (let i = 0; i < kArr.length; i++) {
            const v = row[kArr[i]];
            if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
        }
        return '';
    };
    const code = pick(['省级项目编号', '许可_省级项目编号', '竣工_省级项目编号']);
    const name = pick(['工程名称', '项目名称', '许可_工程名称', '竣工_工程名称']);
    let key = '';
    if (code && name) key = 'CN_' + code + '||' + name;
    else if (code) key = 'C_' + code;
    else if (name) key = 'N_' + name;
    else {
        // 兜底：建设单位 + 其他组合
        const org = pick(['建设单位', '许可_建设单位']);
        if (org) key = 'O_' + org;
    }
    return { key, code, name };
}

// 8) 比较 oldRow vs newRow 的差异 → 返回变更备注条目数组（每一条都是中文描述，序号外部加）
function calcRowDiffs(oldRow, newRow, fullFields, timestamp) {
    const diffs = [];
    const ts = timestamp || nowStr();
    if (!fullFields || fullFields.length === 0) return diffs;
    // 只比较「非系统列」（跳过变更备注自身、跳过 undefined/null/空完全相同的）
    const compareFields = fullFields.filter(f => f !== CHANGE_NOTE_FIELD);
    compareFields.forEach(f => {
        let vOld = (oldRow && Object.prototype.hasOwnProperty.call(oldRow, f)) ? oldRow[f] : '';
        let vNew = (newRow && Object.prototype.hasOwnProperty.call(newRow, f)) ? newRow[f] : '';
        if (vOld === undefined || vOld === null) vOld = '';
        if (vNew === undefined || vNew === null) vNew = '';
        const sOld = String(vOld).replace(/\s+/g, ' ').trim();
        const sNew = String(vNew).replace(/\s+/g, ' ').trim();
        if (sOld === sNew) return; // 完全相同 → 无变更
        // 新增（旧空新有）
        if (sOld === '' && sNew !== '') {
            diffs.push(`在${ts}新增了${f}字段的"${sNew}"数据`);
            return;
        }
        // 修改（都有值但不同）
        if (sOld !== '' && sNew !== '') {
            diffs.push(`在${ts}${f}字段的信息从"${sOld}"变为了"${sNew}"`);
            return;
        }
        // 清空（旧有新空）
        if (sOld !== '' && sNew === '') {
            diffs.push(`在${ts}清空了${f}字段的"${sOld}"数据`);
            return;
        }
    });
    return diffs;
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
// 1) pageMode change → 同步禁用/启用页码框，初始化一次
['basic', 'permit', 'complete'].forEach(type => {
    const modeEl = safeGetElement(type + '-pageMode');
    if (modeEl) {
        try { syncPageModeInputs(type); } catch (e) {} // 初始值同步一次
        modeEl.addEventListener('change', () => {
            try { syncPageModeInputs(type); } catch (e) {}
            console.log('[pageMode] ' + type + ' → ' + modeEl.value);
        });
    }
    // 2) 「➕ 添加」按钮（省级项目编号下拉添加当前输入值）
    const addBtn = document.querySelector('.btn-combo[data-type="' + type + '"][data-action="addCode"]');
    if (addBtn) {
        addBtn.addEventListener('click', () => handleAddCodeBtn(type));
    }
    // 3) 「💾 仅导出列表CSV」按钮（需求2）
    const expListBtn = safeGetElement(type + '-exportList');
    if (expListBtn) {
        expListBtn.addEventListener('click', () => {
            if (!currentData[type] || currentData[type].length === 0) {
                updateStatus(type + '-status', '⚠️ 暂无数据可导出！请先点击「开始提取」。', '');
                return;
            }
            const headers = LIST_ONLY_HEADERS[type] ? LIST_ONLY_HEADERS[type].slice() : [];
            if (!headers || headers.length === 0) {
                updateStatus(type + '-status', '❌ 类型 ' + type + ' 没有配置仅列表字段！', 'error');
                return;
            }
            // 把每条数据按别名映射成用户指定的字段名
            const mappedRows = currentData[type].map(row => extractListOnlyRow(type, row));
            const typeLabelMap = { basic: '基本信息_仅列表', permit: '施工许可_仅列表', complete: '竣工验收备案_仅列表' };
            const csv = generateCSV(mappedRows, headers, () => false);
            const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            downloadCSV(csv, (typeLabelMap[type] || type) + '_' + date + '.csv');
            updateStatus(type + '-status', '💾 仅列表CSV已导出！共 ' + mappedRows.length + ' 条（列数：' + headers.length + '）。', 'success');
            console.log('[exportList] ✅ ' + type + ' 导出仅列表CSV ' + mappedRows.length + '行 ' + headers.length + '列');
        });
    }
});

// ============================================================
// ===== Tab 切换 =====
// ============================================================
document.querySelectorAll('.tabs .tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        const target = e.target.getAttribute('data-tab');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const content = safeGetElement('tab-' + target);
        if (content) content.classList.add('active');
    });
});

console.log('✅ popup.js 已加载完成');