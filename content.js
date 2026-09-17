// ============================================================
// 【ISOLATED world 顶层预定义】popup 通信 + 后面 refreshCaptchaImage 要读
// ============================================================
(function isolatedTopInit() {
    try {
        window.__PLUGIN_INJECTED_MARK__ = 1;
        window.__PLUGIN_CAPTCHA_LAST__ = window.__PLUGIN_CAPTCHA_LAST__ || null;
        window.__PLUGIN_RESPONSE_STORE__ = window.__PLUGIN_RESPONSE_STORE__ || [];
        window.__PLUGIN_ALL_RESPONSES__ = window.__PLUGIN_ALL_RESPONSES__ || [];
        window.__PLUGIN_PULL_CAPTCHA_FROM_MAIN__ = function () {
            try {
                window.postMessage({ __PLUGIN_CAPTCHA_PULL__: true, _t: Date.now() }, '*');
            } catch (e) {}
        };
        function _mergeLast(newLast) {
            if (!newLast) return;
            var cur = window.__PLUGIN_CAPTCHA_LAST__;
            if (!cur) { window.__PLUGIN_CAPTCHA_LAST__ = newLast; return; }
            var newHasKey = !!(newLast.kaptchaKey && newLast.kaptchaKey.length >= 8);
            var curHasKey = !!(cur.kaptchaKey && cur.kaptchaKey.length >= 8);
            if (newHasKey && !curHasKey) { window.__PLUGIN_CAPTCHA_LAST__ = newLast; return; }
            if (!newHasKey && curHasKey) { return; }
            if (newLast.time >= cur.time) { window.__PLUGIN_CAPTCHA_LAST__ = newLast; }
        }
        window.addEventListener('message', function (ev) {
            try {
                var d = ev.data || {};
                if (!d) return;
                if (d.__PLUGIN_CAPTCHA_SYNC__) {
                    if (d.last) _mergeLast(d.last);
                    if (Array.isArray(d.store)) window.__PLUGIN_RESPONSE_STORE__ = d.store;
                    if (Array.isArray(d.all)) window.__PLUGIN_ALL_RESPONSES__ = d.all;
                    if (d.log) console.log.apply(console, ['%c[MAIN→ISOLATED push]', 'background:#722ed1;color:#fff;padding:1px 4px;border-radius:2px;'].concat(d.log));
                    return;
                }
                if (d.__PLUGIN_CAPTCHA_PULL_RESP__) {
                    if (d.last) _mergeLast(d.last);
                    if (Array.isArray(d.store) && d.store.length > 0) window.__PLUGIN_RESPONSE_STORE__ = d.store;
                    if (Array.isArray(d.all) && d.all.length > 0) window.__PLUGIN_ALL_RESPONSES__ = d.all;
                    if (d.last || d.store) console.log('%c[MAIN→ISOLATED pull-resp]', 'background:#13c2c2;color:#fff;padding:1px 4px;border-radius:2px;', 'last.time=', d.last && d.last.time, 'key.len=', d.last && (d.last.kaptchaKey || '').length);
                }
            } catch (e) {}
        });
    } catch (eTop) {}
})();

// 内容脚本 - 页面数据提取
(function () {
    // 顶层 try-catch：即使部分代码出错，也要保证消息监听器能注册
    try {
    console.log('🚀 content.js 开始执行，URL:', window.location.href);

    // ===== 公共：汉字公共字符计数（模糊匹配用）=====
    function _commonChars(a, b) {
        if (!a || !b) return 0;
        var setA = {};
        for (var ci = 0; ci < a.length; ci++) {
            if (/[\u4e00-\u9fa5]/.test(a[ci])) setA[a[ci]] = true;
        }
        var cnt = 0;
        for (var cj = 0; cj < b.length; cj++) {
            if (setA[b[cj]]) cnt++;
        }
        return cnt;
    }

    // 允许重新注入：每次都要重新注册监听器（旧的监听器在 MV3 重新注入后可能失效）
    var alreadyLoaded = !!window.__extractScriptLoaded;
    window.__extractScriptLoaded = true;
    if (alreadyLoaded) {
        console.log('📌 content.js 重新注入，重新注册监听器');
    }

    // ===== URL / 页面类型识别 =====

    function getTypeFromUrl() {
        var url = window.location.href;
        var hashMatch = url.match(/[#?&]type=(\d+)/);
        if (hashMatch) return hashMatch[1];
        try {
            var urlObj = new URL(url);
            var t = urlObj.searchParams.get('type');
            if (t) return t;
        } catch (e) {}
        if (url.indexOf('#') !== -1) {
            try {
                var hashPart = url.substring(url.indexOf('#') + 1);
                var hashUrl = new URL('http://temp.com/' + hashPart);
                var fromHash = hashUrl.searchParams.get('type');
                if (fromHash) return fromHash;
            } catch (e) {}
        }
        return null;
    }

    function isListPage() {
        var type = getTypeFromUrl();
        if (type === '1' || type === '5' || type === '6') return type;
        // 如果没有type但有表格，也可能是列表页（SPA路由后）
        var headers = safeGetHeaders();
        if (headers.length > 0) {
            if (headers.some(function (h) { return h.indexOf('项目名称') !== -1; })) return '1';
            if (headers.some(function (h) { return h.indexOf('许可证编号') !== -1; })) return '5';
            if (headers.some(function (h) { return h.indexOf('备案编号') !== -1; })) return '6';
        }
        return null;
    }

    function isDetailPage() {
        // 详情页：URL中有 project/ 相关路径，并且无 type=1/5/6，同时页面有详细信息字段
        var url = window.location.href;
        var type = getTypeFromUrl();
        if (type === '1' || type === '5' || type === '6') return null;
        // 如果是 skypt.gdcic.net 下的项目详情页（可能是 hash 路由 /project/detail?id=xxx 或 /web/project/detail/xxx）
        if (url.indexOf('skypt.gdcic.net') === -1) return null;
        // 检查页面内容特征（通过详情字段判断）
        var text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        if (text.indexOf('组织机构代码') !== -1 || text.indexOf('项目名称') !== -1 ||
            (text.indexOf('总投资') !== -1 && text.indexOf('立项') !== -1)) {
            return 'basic';
        }
        if ((text.indexOf('建设单位') !== -1 && text.indexOf('施工许可证编号') !== -1) ||
            (text.indexOf('建设单位') !== -1 && text.indexOf('合同价格') !== -1) ||
            (text.indexOf('建设单位') !== -1 && text.indexOf('监理单位') !== -1)) {
            return 'permit';
        }
        if (text.indexOf('备案机关') !== -1 && text.indexOf('实际造价') !== -1) {
            return 'complete';
        }
        return null;
    }

    // ===== 通用表格/单元格工具 =====

    function safeGetHeaders() {
        try {
            var tables = document.querySelectorAll('table');
            for (var i = 0; i < tables.length; i++) {
                var table = tables[i];
                var thead = table.querySelector('thead');
                var headerRows = thead ? thead.querySelectorAll('tr') : table.querySelectorAll('tr');
                if (headerRows.length > 0) {
                    var headers = [];
                    var cells = headerRows[0].querySelectorAll('th,td');
                    for (var j = 0; j < cells.length; j++) {
                        var txt = (cells[j].innerText || cells[j].textContent || '').trim();
                        headers.push(txt);
                    }
                    if (headers.length > 1) return headers;
                }
            }
        } catch (e) {}
        return [];
    }

    function getTableRows() {
        try {
            var tables = document.querySelectorAll('table');
            for (var i = 0; i < tables.length; i++) {
                var table = tables[i];
                var tbody = table.querySelector('tbody');
                var rows = tbody ? tbody.querySelectorAll('tr') : table.querySelectorAll('tr');
                if (rows.length > 0) {
                    var validRows = [];
                    for (var j = 0; j < rows.length; j++) {
                        var cells = rows[j].querySelectorAll('td');
                        if (cells.length > 1) validRows.push(rows[j]);
                    }
                    if (validRows.length > 0) return validRows;
                }
            }
        } catch (e) {}
        return [];
    }

    function getCellText(cell) {
        if (!cell) return '';
        try {
            var clone = cell.cloneNode(true);
            var buttons = clone.querySelectorAll('button, .ant-btn, a[role="button"]');
            for (var i = 0; i < buttons.length; i++) {
                buttons[i].remove();
            }
            return (clone.innerText || clone.textContent || '').trim();
        } catch (e) {
            return (cell.innerText || cell.textContent || '').trim();
        }
    }

    // 从单元格获取链接（最关键：读 href / router-link 的 to / onclick 中的 URL）
    // 检查 URL 是否是"项目/工程"类的详情页（排除企业详情页、建设单位详情页等）
    function isProjectDetailUrl(url) {
        if (!url) return false;
        var s = String(url);
        // 黑名单：企业/公司/单位 详情页绝对不能用
        var blackList = ['enterprise/detail', 'enterprise/', 'company/', 'corp/', 'org/', 'organ', '/unit/', 'buildunit', 'contractor', 'supplier', 'orgCode=', 'orgName='];
        for (var i = 0; i < blackList.length; i++) {
            if (s.indexOf(blackList[i]) !== -1) return false;
        }
        // 白名单：明确是项目/工程/许可证/备案详情页
        var whiteList = [
            'project/detail', 'project/', 'detail?', 'detail/', '/project/', 'proDetail', 'itemDetail', '/detail/',
            // 施工许可（#/web/permit?permitCode=XXX）
            '/permit?', 'permit?', 'permitCode=', 'permitId=', 'permitNo=',
            // 竣工验收备案（一般是 #/web/complete?recordCode=XXX 或 recordNo=）
            '/complete?', 'complete?', 'recordCode=', 'recordNo=', 'recordId=', 'completeId=',
            'projectId=', 'projectCode=', 'projId=', 'projCode='
        ];
        for (var j = 0; j < whiteList.length; j++) {
            if (s.indexOf(whiteList[j]) !== -1) return true;
        }
        // 既不在黑名单也不在白名单 → 谨慎，先不采用（避免误取建设单位等链接）
        return false;
    }

    function getUrlFromCell(cell) {
        if (!cell) return null;
        // 1) <a href="...">
        var a = cell.querySelector('a');
        if (a) {
            var href = a.href || a.getAttribute('href') || '';
            if (href && href !== '#' && !href.startsWith('javascript:')) {
                // 如果是 hash 路由（#/开头），补全为完整 URL
                if (href.startsWith('#')) {
                    var base = window.location.origin + window.location.pathname;
                    return base + href;
                }
                return href;
            }
        }
        // 2) 元素本身是 <a>
        if (cell.tagName && cell.tagName.toLowerCase() === 'a') {
            var href2 = cell.href || cell.getAttribute('href') || '';
            if (href2 && href2 !== '#' && !href2.startsWith('javascript:')) {
                if (href2.startsWith('#')) {
                    var base2 = window.location.origin + window.location.pathname;
                    return base2 + href2;
                }
                return href2;
            }
        }
        // 3) <router-link :to="..."> or any element with data-href / data-url / data-link
        var withTo = cell.querySelector('[to]');
        if (withTo) {
            var to = withTo.getAttribute('to');
            if (to) {
                if (to.startsWith('http')) return to;
                return window.location.origin + (to.startsWith('/') ? to : '/' + to);
            }
        }
        // 4) data-* 属性
        var attrs = ['data-href', 'data-url', 'data-link', 'data-detail-url', 'data-detail'];
        for (var i = 0; i < attrs.length; i++) {
            var val = cell.getAttribute(attrs[i]);
            if (val) {
                if (val.startsWith('http')) return val;
                if (val.startsWith('#')) {
                    return window.location.origin + window.location.pathname + val;
                }
                return window.location.origin + (val.startsWith('/') ? val : '/' + val);
            }
        }
        // 5) 从 onclick 中提取 URL
        var clickable = cell.querySelector('[onclick]') || (cell.getAttribute && cell.getAttribute('onclick') ? cell : null);
        if (clickable) {
            var onclick = clickable.getAttribute('onclick') || '';
            // 匹配单引号或双引号包裹的 URL
            var m = onclick.match(/['"](https?:\/\/[^'"]+)['"]/);
            if (m) return m[1];
            var m2 = onclick.match(/['"](\/[^'"]*detail[^'"]*)['"]/i);
            if (m2) {
                if (m2[1].startsWith('http')) return m2[1];
                return window.location.origin + m2[1];
            }
            var m3 = onclick.match(/['"](#[^'"]+)['"]/);
            if (m3) return window.location.origin + window.location.pathname + m3[1];
        }
        return null;
    }

    function getColIndex(headers, keywords) {
        for (var k = 0; k < keywords.length; k++) {
            for (var i = 0; i < headers.length; i++) {
                if (headers[i] && headers[i].indexOf(keywords[k]) !== -1) return i;
            }
        }
        return -1;
    }

    function fuzzyMatch(text, keyword) {
        if (!keyword) return true;
        if (!text) return false;
        return text.toString().toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
    }

    function filterByDate(dateStr, startDate, endDate) {
        if (!startDate && !endDate) return true;
        if (!dateStr) return false;
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        if (startDate && d < new Date(startDate)) return false;
        if (endDate && d > new Date(endDate)) return false;
        return true;
    }

    // ===== 列表页：提取行数据 + 详情页URL =====

    // ================================================================
    // 🔴✅ 新增 方案二：API 直取 JSON，彻底绕过后端 300 条深度分页截断
    //      支持：用户填写的筛选条件 + 验证码识别（页面浮层让用户输入）
    // ================================================================

    // ---------- 工具：连续重复页检测（兜底防护） ----------
    var _apiLastPageFingerprint = '';
    var _apiSeenProjectCodes = {}; // 🔴 跨页全局：见过的 projectCode 集合
    function _isApiPageDuplicate(curRows, options) {
        var opt = options || {};
        if (!Array.isArray(curRows) || curRows.length === 0) return false;
        var fp = curRows.map(function (r) {
            return (r.projectCode || r.id || '') + '||' + (r.projectName || '');
        }).join('###');
        var dup = (fp === _apiLastPageFingerprint && fp !== '');
        _apiLastPageFingerprint = fp;

        // 🔴 跨页重叠检测：前 N 条中有多少条见过
        var sawDupCount = 0;
        // 🔴 skipOverlapCheck：极速模式 permit/complete 传 true，跳过此检测（防止误判）
        if (!opt.skipOverlapCheck) {
            var checkN = Math.min(5, curRows.length);
            for (var i = 0; i < checkN; i++) {
                var pc = (curRows[i] && (curRows[i].projectCode || curRows[i].constructionPermitCode || curRows[i].archiveCode || curRows[i].id)) || '';
                if (pc && _apiSeenProjectCodes[pc]) sawDupCount++;
            }
        }
        // 登记见过的唯一键（更健壮：多种主键候选，防止空值大量登记——但现在 pc 非空才登记所以OK）
        for (var j = 0; j < curRows.length; j++) {
            var key = (curRows[j] && (curRows[j].projectCode || curRows[j].constructionPermitCode || curRows[j].archiveCode || curRows[j].id)) || '';
            if (key) _apiSeenProjectCodes[key] = true;
        }

        // 🔴 跨页重叠必须 ≥ 3 条才判重复（原来是 1 条！太容易误判）
        //    精准模式下：有验证码时可能真的返回前一页；但极速模式下一般是 skipOverlapCheck=true
        var sawDup = sawDupCount >= 3;
        if (dup || sawDup) {
            console.warn('[api-dup] ⚠️ 判定重复页：连续指纹dup=' + dup + ', 前5条见过数=' + sawDupCount + ' (阈值≥3), curRows.length=' + curRows.length);
            return true;
        }
        if (opt.debug) {
            console.log('[api-dup] ℹ️ 正常页：连续指纹不同，前5条重叠=' + sawDupCount + '/5, rows=' + curRows.length);
        }
        return false;
    }

    // 🔴 重置 API 检测状态（用户每轮新的抓取任务开始前调用）
    function _resetApiDupState() {
        _apiLastPageFingerprint = '';
        _apiSeenProjectCodes = {};
    }

    // ---------- 工具：检查用户是否填了任何筛选条件 ----------
    function hasAnyFilterCondition() {
        try {
            var wrap = document.querySelector('.search-module-wrap');
            if (!wrap) return false;
            var inputs = wrap.querySelectorAll('input.ant-input');
            for (var i = 0; i < inputs.length; i++) {
                var ph = (inputs[i].getAttribute && inputs[i].getAttribute('placeholder')) || '';
                if (ph.indexOf('验证码') !== -1) continue;
                var v = (inputs[i].value || '').trim();
                if (v) return true;
            }
            var selects = wrap.querySelectorAll('.ant-select.select');
            for (var j = 0; j < selects.length; j++) {
                var selTxt = (selects[j].innerText || '').trim();
                if (selTxt && selTxt.indexOf('请选择') === -1 && selTxt !== '') return true;
            }
        } catch (e) {}
        return false;
    }

    // 4 层验证码捕获：axios / xhr / fetch / DOM-MutationObserver
    (function installGlobalCaptchaHook() {
        try {
            if (window.__PLUGIN_CAPTCHA_HOOK_INSTALLED__) return;
            window.__PLUGIN_CAPTCHA_HOOK_INSTALLED__ = true;

            function _extract(obj, layer, url) {
                if (!obj || typeof obj !== 'object') return null;
                var fk = '', fi = '';
                (function sn(o, d, lk, sib) {
                    if (fi && fk || !o || d > 12) return;
                    if (typeof o === 'string') {
                        if (o.length > 500 && !fi && /^data:image|^\/9j\/|^iVBORw0KGg/i.test(o)) {
                            fi = o;
                            if (!fk && sib) for (var b = 0; b < sib.length; b++) {
                                var k = sib[b][0], v = sib[b][1];
                                if (typeof v !== 'string' || v.length < 8 || v.length > 128) continue;
                                if (/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/.test(v)) { fk = v; break; }
                                if (v.length >= 16 && /key|kapt|capt|id|uuid|token|code|valid|verif|nonce|sign|random/i.test(k)) { fk = v; break; }
                            }
                            return;
                        }
                        if (!fk && typeof o === 'string' && o.length >= 8 && o.length <= 128) {
                            if (/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/.test(o)) fk = o;
                            else if (o.length >= 16 && /key|kapt|capt|id|uuid|token|code|valid|verif|nonce|sign|random|secret/i.test(lk || '')) fk = o;
                        }
                        return;
                    }
                    if (Array.isArray(o)) { for (var a = 0; a < Math.min(o.length, 50); a++) sn(o[a], d + 1, lk, null); return; }
                    var ks = Object.keys(o), sp = [];
                    for (var i = 0; i < ks.length; i++) { var kk = ks[i], vv; try { vv = o[kk]; } catch (e) { continue; } if (typeof vv === 'string') sp.push([kk, vv]); }
                    for (var j = 0; j < ks.length; j++) {
                        try { sn(o[ks[j]], d + 1, ks[j], sp); } catch (e) { continue; }
                        if (fi && fk) return;
                    }
                })(obj, 0, '', null);
                if (fi && !/^data:image/.test(fi)) fi = 'data:image/jpeg;base64,' + fi;
                return (fi || fk) ? { kaptchaKey: fk, image: fi, layer: layer, url: url || '' } : null;
            }
            function _rec(method, url, len) {
                try {
                    window.__PLUGIN_ALL_RESPONSES__.push({ t: Date.now(), method: method, url: (url || '').substring(0, 240), len: len || 0 });
                    if (window.__PLUGIN_ALL_RESPONSES__.length > 30) window.__PLUGIN_ALL_RESPONSES__.shift();
                } catch (e) {}
            }
            function _commit(res, json, head) {
                if (!res) return;
                try {
                    window.__PLUGIN_RESPONSE_STORE__.push({ t: Date.now(), layer: res.layer || '', url: res.url || '', json: json, textHead: head || '' });
                    if (window.__PLUGIN_RESPONSE_STORE__.length > 10) window.__PLUGIN_RESPONSE_STORE__.shift();
                } catch (e) {}
                if (res.image) {
                    var newHasKey = !!(res.kaptchaKey && res.kaptchaKey.length >= 8);
                    var newLast = { time: Date.now(), kaptchaKey: res.kaptchaKey || '', image: res.image, from: (res.layer || 'layer') + (res.url ? ('→' + String(res.url).substring(0, 120)) : '') };
                    var cur = window.__PLUGIN_CAPTCHA_LAST__;
                    var curHasKey = !!(cur && cur.kaptchaKey && cur.kaptchaKey.length >= 8);
                    var imgChanged = !(cur && cur.image === newLast.image);
                    if (!cur || newHasKey) {
                        window.__PLUGIN_CAPTCHA_LAST__ = newLast;
                    } else if (!newHasKey && !curHasKey && newLast.time >= (cur.time || 0)) {
                        window.__PLUGIN_CAPTCHA_LAST__ = newLast;
                    }
                    // 🔴 精简日志：只有「有Key」或者「图片真的变了」时才打印；DOM层重复的无Key图片静默
                    if (newHasKey) {
                        console.log('%c[captcha-hit] ✅ layer=' + res.layer + ' IMG.len=' + res.image.length + ' KEY.len=' + (res.kaptchaKey || '').length + ' ✅有Key', 'background:#52c41a;color:#fff;padding:1px 4px;border-radius:2px;');
                    } else if (imgChanged && res.layer !== 'DOM') {
                        console.log('%c[captcha-hit] ⚠️ layer=' + res.layer + ' IMG.len=' + res.image.length + ' 无Key（可点击验证码图片刷新获取Key）', 'background:#faad14;color:#fff;padding:1px 4px;border-radius:2px;');
                    }
                }
            }
            function _procJsonStr(text, layer, url) {
                if (!text || text.length < 200) return;
                _rec(layer, url, text.length);
                var j; try { j = JSON.parse(text); } catch (e) { return; }
                var r = _extract(j, layer, url); if (r) _commit(r, j, text.substring(0, 500));
            }
            function _procObj(obj, layer, url) {
                if (!obj || typeof obj !== 'object') return;
                var raw; try { raw = JSON.stringify(obj); } catch (e) { raw = ''; }
                _rec(layer, url, raw.length);
                var r = _extract(obj, layer, url); if (r && r.image) _commit(r, obj, raw.substring(0, 500));
            }
            // Layer1: axios
            function axHook() {
                if (!window.axios || !window.axios.interceptors || window.__AXIOS_HIJACKED_BY_PLUGIN__) return;
                window.__AXIOS_HIJACKED_BY_PLUGIN__ = true;
                window.axios.interceptors.response.use(function (resp) {
                    try {
                        var data = resp && resp.data !== undefined ? resp.data : null;
                        var url = resp && resp.config ? resp.config.url : '';
                        if (typeof data === 'string') _procJsonStr(data, 'axios', url); else _procObj(data, 'axios', url);
                    } catch (e) {}
                    return resp;
                }, function (err) { return Promise.reject(err); });
                console.log('[captcha-hook] ✅ axios 已挂载');
            }
            axHook();
            // Vue 的 axios 可能晚挂载，每 1.5s 试一次，试 5 次共 7.5s
            (function retryAx(times) { if (times <= 0) return; setTimeout(function () { axHook(); retryAx(times - 1); }, 1500); })(5);

            // Layer2: XHR
            try {
                var _o = XMLHttpRequest.prototype.open, _s = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return _o.apply(this, arguments); };
                XMLHttpRequest.prototype.send = function () {
                    this.addEventListener && this.addEventListener('load', function () { _procJsonStr(this.responseText, 'xhr', this.__u); });
                    return _s.apply(this, arguments);
                };
                console.log('[captcha-hook] ✅ xhr 已挂载');
            } catch (e) {}

            // Layer3: fetch
            try {
                var _f = window.fetch;
                if (_f) {
                    window.fetch = function (u, opts) {
                        return _f.apply(this, arguments).then(function (r) {
                            try { r.clone().text().then(function (t) { _procJsonStr(t, 'fetch', typeof u === 'string' ? u : u && u.url); }).catch(function () {}); } catch (e) {}
                            return r;
                        });
                    };
                    console.log('[captcha-hook] ✅ fetch 已挂载');
                }
            } catch (e) {}

            // Layer4: DOM MutationObserver + 轮询
            try {
                var sel = '.search-module-wrap img.valid-img, img.valid-img, #app img[src^="data:image"]';
                function _imgCheck(el) {
                    if (!el) return;
                    var s = (el.getAttribute && el.getAttribute('src')) || el.src || '';
                    if (s.length < 500 || !/^data:image|^\/9j\//i.test(s)) return;
                    if (window.__PLUGIN_CAPTCHA_LAST__ && window.__PLUGIN_CAPTCHA_LAST__.image === s) return;
                    _commit({ kaptchaKey: '', image: s, layer: 'DOM', url: '(DOM img.src)' }, null, null);
                }
                function _poll() { try { var imgs = document.querySelectorAll(sel); for (var i = 0; i < imgs.length; i++) _imgCheck(imgs[i]); } catch (e) {} }
                new MutationObserver(function (muts) {
                    for (var i = 0; i < muts.length; i++) {
                        var m = muts[i];
                        if (m.type === 'attributes' && m.attributeName === 'src') _imgCheck(m.target);
                        if (m.addedNodes) for (var j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n && 1 === n.nodeType && 'IMG' === n.tagName) _imgCheck(n); }
                    }
                }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
                setInterval(_poll, 400); setTimeout(_poll, 100);
                console.log('[captcha-hook] ✅ DOM 监听已挂载');
            } catch (e) {}
        } catch (e) { console.warn('[captcha-hook] 异常:', e); }
    })();

    // ---------- 工具：从 DOM 收集筛选参数（深度递归 Vue 实例取 cityId / projectClassId）----------
    function collectFilterParamsFromDom() {
        var params = { projectName: '', cityId: '', cityText: '', orgName: '', projectClassId: '', projectClassText: '', projectCode: '' };
        try {
            var wrap = document.querySelector('.search-module-wrap');
            if (!wrap) return params;
            var inputs = wrap.querySelectorAll('input.ant-input');
            for (var i = 0; i < inputs.length; i++) {
                var ph = (inputs[i].getAttribute && inputs[i].getAttribute('placeholder')) || '';
                var v = (inputs[i].value || '').trim();
                if (ph.indexOf('项目名称') !== -1) params.projectName = v;
                else if (ph.indexOf('建设单位') !== -1) params.orgName = v;
                else if (ph.indexOf('省级项目编号') !== -1) params.projectCode = v;
            }
            // 深度递归：从任意 DOM 元素的 __vue__ 上找 value / cityId / projectClassId
            function deepFindVueValue(dom, wantKeyPart) {
                try {
                    if (!dom) return null;
                    var seen = new WeakSet();
                    var stack = [];
                    if (dom.__vue__) stack.push(dom.__vue__);
                    while (stack.length > 0) {
                        var obj = stack.pop();
                        if (!obj || typeof obj !== 'object' || seen.has(obj)) continue;
                        seen.add(obj);
                        var keys = Object.keys(obj);
                        for (var k = 0; k < keys.length; k++) {
                            var kk = keys[k];
                            if (/^\$|^_/.test(kk) && kk !== '$data' && kk !== '_data') continue;
                            var val = null;
                            try { val = obj[kk]; } catch (eAcc) { continue; }
                            if (val && typeof val === 'object') { stack.push(val); continue; }
                            if (typeof val === 'string' && val && new RegExp(wantKeyPart, 'i').test(kk)) { return val; }
                        }
                        if (obj.$parent) stack.push(obj.$parent);
                        if (obj.$children && Array.isArray(obj.$children)) for (var c = 0; c < obj.$children.length; c++) stack.push(obj.$children[c]);
                    }
                } catch (e) {}
                return null;
            }
            var allSelects = wrap.querySelectorAll('.ant-select.select');
            if (allSelects.length >= 1) {
                try {
                    var sel1 = allSelects[0].querySelector('.ant-select-selection-selected-value');
                    if (sel1) params.cityText = (sel1.getAttribute && sel1.getAttribute('title')) || (sel1.innerText || '').trim();
                    var cv = deepFindVueValue(allSelects[0], 'city|value');
                    if (cv && /^\d+$/.test(cv)) params.cityId = cv;
                    if (!params.cityId && allSelects[0].__vue__) {
                        for (var t = 0; t < 8; t++) {
                            var tv = (allSelects[0].__vue__['_v' + t] || allSelects[0].__vue__['s' + t]);
                            if (typeof tv === 'string' && /^\d+$/.test(tv)) { params.cityId = tv; break; }
                        }
                    }
                } catch (eVue1) {}
            }
            if (allSelects.length >= 2) {
                try {
                    var sel2 = allSelects[1].querySelector('.ant-select-selection-selected-value');
                    if (sel2) params.projectClassText = (sel2.getAttribute && sel2.getAttribute('title')) || (sel2.innerText || '').trim();
                    var pv = deepFindVueValue(allSelects[1], 'projectClass|class|value');
                    if (pv && /^\d+$/.test(pv)) params.projectClassId = pv;
                } catch (eVue2) {}
            }
            // 最终兜底：如果 cityText 有但是 cityId 没有，尝试在 window localStorage / sessionStorage 查
            if (params.cityText && !params.cityId) {
                try {
                    var cityMap = { '广州市': '440100', '韶关市': '440200', '深圳市': '440300', '珠海市': '440400', '汕头市': '440500', '佛山市': '440600', '江门市': '440700', '湛江市': '440800', '茂名市': '440900', '肇庆市': '441200', '惠州市': '441300', '梅州市': '441400', '汕尾市': '441500', '河源市': '441600', '阳江市': '441700', '清远市': '441800', '东莞市': '441900', '中山市': '442000', '潮州市': '445100', '揭阳市': '445200', '云浮市': '445300' };
                    if (cityMap[params.cityText]) params.cityId = cityMap[params.cityText];
                } catch (eMap) {}
            }
        } catch (e) { console.warn('[filter-collect] 异常:', e.message || e); }
        console.log('[filter-collect] ✅ 收集到筛选参数:', params);
        return params;
    }

    // ---------- 工具：刷新验证码 ✅✅✅ 最终版：只走「DOM 点击 + 全局 Hook 拦截」 ✅✅✅
    //          因为我们主动请求 /captcha/get 返回 404！
    //          所以改用 Vue 内部真实逻辑：点页面的验证码图片 <img class="valid-img">
    //          让 Vue 用自己的 axios 去请求真实验证码 URL，然后我们全局 Hook 拦截响应，
    //          从响应 JSON 里拿 {kaptchaKey, imageBase64}，100% 和后端对应
    // -----------------------------------------------------------------------
    function refreshCaptchaImage(cb) {
        var fallbackDomImage = '';
        try {
            var domImg = document.querySelector('.search-module-wrap img.valid-img');
            if (domImg) fallbackDomImage = domImg.getAttribute('src') || '';
        } catch (e) {}

        // 先清旧的 hook 缓存
        window.__PLUGIN_CAPTCHA_LAST__ = null;

        var hookStart = Date.now();
        var pullIssued = false;
        function getHookResult() {
            var h = window.__PLUGIN_CAPTCHA_LAST__;
            if (h && h.time >= hookStart && h.image) return h;
            // 兜底：1.5s 后还没通过 MAIN world 的 PUSH 同步过来，就主动发一次 PULL 拉（避免 postMessage 漏消息的 race condition）
            if (!pullIssued && Date.now() - hookStart >= 1500) {
                pullIssued = true;
                try {
                    if (typeof window.__PLUGIN_PULL_CAPTCHA_FROM_MAIN__ === 'function') {
                        console.log('[captcha-refresh] 🔃 未等到 PUSH，主动向 MAIN world PULL 一次...');
                        window.__PLUGIN_PULL_CAPTCHA_FROM_MAIN__();
                    }
                } catch (ePull) {}
            }
            return null;
        }

        // Step 1: 先试着在「最近 30 条响应记录」里找已经有过验证码图的 URL，
        //         能找到的话可以推断真实接口 URL，以后优先用这个（仅做提示）
        try {
            var recent = window.__PLUGIN_ALL_RESPONSES__ || [];
            for (var ri = recent.length - 1; ri >= 0; ri--) {
                var r = recent[ri];
                if (r && r.len > 5000 && /img|image|captcha|kaptcha|valid|code|verif/i.test(r.url || '')) {
                    console.log('[captcha-refresh] 💡 推断真实验证码接口 URL (历史):', r.url);
                }
            }
        } catch (eR) {}

        // Step 2: 点击 DOM 图片 1 次触发 Vue 内部真实刷新，全局 Hook 拦截响应
        try {
            var imgEl = document.querySelector('.search-module-wrap img.valid-img');
            if (imgEl) {
                try {
                    imgEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                } catch (eEvt1) { try { imgEl.click(); } catch (eClick1) {} }
            }
        } catch (eBigDom) { console.warn('[captcha-refresh] ❌ 无法点击 DOM 验证码图片:', eBigDom); }

        // Step 3: 轮询 Hook 缓存（先等 300ms 再开始查，给 Vue 点击后发请求留足时间）
        //         最长等 5.5s，Vue 的 axios 有时候会因为网络抖动晚一点回来
        var waited = 0;
        var tick = 150;
        var deadline = 5500;
        var firstLoop = true;
        function waitLoop() {
            if (firstLoop) { firstLoop = false; setTimeout(waitLoop, 300); return; }
            var h = getHookResult();
            if (h) {
                var finalKey = h.kaptchaKey || '';
                var finalImg = h.image || '';
                if (finalImg && !finalKey) try {
                    console.log('[captcha-refresh] ⚠️ 抓到了图但没抓到 key。最近 30 条响应 URL 摘要（Debug）:', (window.__PLUGIN_ALL_RESPONSES__ || []).map(function (x) { return x.url + '(' + x.len + ')'; }));
                } catch (e3) {}
                console.log('[captcha-refresh] ✅ Hook 拦截成功！kaptchaKey.len=' + (finalKey || '').length + ', from=' + h.from);
                cb && cb({ src: finalImg || fallbackDomImage, kaptchaKey: finalKey, mode: (h.from || 'HOOK-OK') });
                return;
            }
            waited += tick;
            if (waited >= deadline) {
                var domSrc2 = fallbackDomImage;
                try {
                    var d2 = document.querySelector('.search-module-wrap img.valid-img');
                    if (d2) domSrc2 = d2.getAttribute('src') || domSrc2;
                } catch (e) {}
                console.warn('[captcha-refresh] ⚠️ 超时(5.5s Hook 没抓到)。 fallback 使用 DOM 当前图, 最后 10 条 URL:', (window.__PLUGIN_ALL_RESPONSES__ || []).slice(-10));
                cb && cb({ src: domSrc2, kaptchaKey: '', mode: 'TIMEOUT-FALLBACK-DOM' });
                return;
            }
            setTimeout(waitLoop, tick);
        }
        waitLoop();
    }

    // ---------- 工具：在页面上创建验证码输入浮层（✅ 最终版：浮层内部自己维护 kaptchaKey，保证图-key 100%对应）----------
    function showCaptchaPrompt(base64ImgFallback, tipMsg, retries, callback) {
        try {
            var oldBox = document.getElementById('__plugin_captcha_box__');
            if (oldBox) try { oldBox.parentNode.removeChild(oldBox); } catch (e) {}

            var tip = tipMsg || '请输入下方验证码后点击「确认」';
            if (retries > 0) tip = '❌ 验证码错误或已失效，请刷新后重新输入！（已重试' + retries + '次）\n' + tipMsg;

            var box = document.createElement('div');
            box.id = '__plugin_captcha_box__';
            box.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;' +
                'background:#fff;border:2px solid #1890ff;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.3);' +
                'width:460px;font-family:"Microsoft YaHei",sans-serif;';
            box.innerHTML = '' +
                '<div style="font-size:18px;font-weight:600;color:#1890ff;margin-bottom:12px;">🔐 爬虫插件：验证码输入</div>' +
                '<div id="__plugin_cap_status__" style="font-size:12px;color:#999;margin-bottom:8px;">⏳ 正在从接口获取最新验证码...</div>' +
                '<div style="font-size:13px;color:#666;margin-bottom:16px;white-space:pre-wrap;line-height:1.6;">' + tip + '</div>' +
                '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
                '  <img id="__plugin_captcha_img__" src="' + (base64ImgFallback || '') + '" style="width:140px;height:50px;border:1px solid #ddd;border-radius:6px;cursor:pointer;opacity:0.5;" title="点击图片刷新">' +
                '  <button id="__plugin_captcha_refresh__" style="padding:6px 12px;background:#f0f0f0;border:1px solid #d9d9d9;border-radius:4px;cursor:pointer;font-size:13px;">🔄 刷新验证码</button>' +
                '</div>' +
                '<input id="__plugin_captcha_input__" type="text" placeholder="请输入5位验证码" maxlength="10" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid #d9d9d9;border-radius:6px;font-size:16px;letter-spacing:4px;box-sizing:border-box;margin-bottom:16px;outline:none;">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;margin-bottom:4px;">' +
                '  <button id="__plugin_captcha_abort__" style="padding:10px;background:#fff1f0;color:#cf1322;border:1px solid #ffa39e;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;grid-column:span 2;">🚫 中止本次爬取</button>' +
                '  <button id="__plugin_captcha_cancel__" style="padding:10px;background:#f5f5f5;border:1px solid #d9d9d9;border-radius:6px;cursor:pointer;font-size:14px;">取消（本页回退DOM方案）</button>' +
                '  <button id="__plugin_captcha_ok__" style="padding:10px;background:#1890ff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">确认开始抓取</button>' +
                '</div>';
            document.body.appendChild(box);

            var input = document.getElementById('__plugin_captcha_input__');
            var imgEl = document.getElementById('__plugin_captcha_img__');
            var statusEl = document.getElementById('__plugin_cap_status__');
            // 浮层内唯一真相：当前验证码对应的 kaptchaKey
            var currentCapKey = '';
            var currentCaptchaLoaded = false;

            function setStatus(txt, color) {
                try {
                    statusEl.innerText = txt;
                    statusEl.style.color = color || '#999';
                } catch (e) {}
            }
            function applyCaptchaToUi(res) {
                if (!res) return;
                if (res.src && imgEl) { imgEl.src = res.src; imgEl.style.opacity = '1'; }
                if (res.kaptchaKey) {
                    currentCapKey = res.kaptchaKey;
                    setStatus('✅ 验证码已就绪(kaptchaKey=' + (res.mode || '?') + ', len=' + currentCapKey.length + ')。请输入后点确认', '#52c41a');
                    currentCaptchaLoaded = true;
                } else if (res.src) {
                    currentCapKey = '';
                    setStatus('⚠️ 已刷新图片，但未能解析到 kaptchaKey（len=0），可能导致后端报「已过期」。建议重试刷新。', '#faad14');
                    currentCaptchaLoaded = true;
                }
            }
            // 浮层内统一刷新入口：点击页面验证码图片触发 Vue 内部真实刷新，全局 Hook 拦截响应
            function refreshInPrompt(doneCb) {
                setStatus('⏳ 正在点击页面验证码图片，等待 Vue 内部刷新并拦截响应...', '#1890ff');
                currentCaptchaLoaded = false;
                try {
                    refreshCaptchaImage(function (res) {
                        applyCaptchaToUi(res);
                        doneCb && doneCb(res);
                    });
                } catch (e) {
                    setStatus('❌ refreshCaptchaImage 异常: ' + (e.message || e), '#ff4d4f');
                    doneCb && doneCb(null);
                }
            }
            imgEl.addEventListener('click', function () { refreshInPrompt(); });
            document.getElementById('__plugin_captcha_refresh__').addEventListener('click', function () { refreshInPrompt(); });
            // 浮层一打开，**立刻自己请求一次**（不再依赖外层传的 base64ImgFallback，它只是占位）
            refreshInPrompt(function () { try { setTimeout(function () { input.focus(); input.select(); }, 100); } catch (eFo) {} });

            input.addEventListener('keydown', function (e) { if (e.keyCode === 13) document.getElementById('__plugin_captcha_ok__').click(); });

            document.getElementById('__plugin_captcha_ok__').addEventListener('click', function () {
                var code = (input.value || '').trim().toUpperCase();
                if (!code) { input.style.borderColor = '#ff4d4f'; return; }
                if (!currentCaptchaLoaded) { alert('⏳ 验证码图片加载中，请稍候再点确认...'); return; }
                try { box.parentNode.removeChild(box); } catch (e) {}
                console.log('[captcha-prompt] ✅ 用户提交 code=' + code + ', kaptchaKey=' + (currentCapKey || '(空)') + ' (len=' + (currentCapKey || '').length + ')');
                callback && callback({ code: code, canceled: false, aborted: false, kaptchaKey: currentCapKey });
            });
            document.getElementById('__plugin_captcha_cancel__').addEventListener('click', function () {
                try { box.parentNode.removeChild(box); } catch (e) {}
                callback && callback({ code: '', canceled: true, aborted: false, kaptchaKey: '' });
            });
            document.getElementById('__plugin_captcha_abort__').addEventListener('click', function () {
                try { box.parentNode.removeChild(box); } catch (e) {}
                console.warn('[captcha] 🚫 用户点击「中止爬取」');
                callback && callback({ code: '', canceled: true, aborted: true, kaptchaKey: '' });
            });
        } catch (bigE) {
            console.error('[captcha-prompt] 异常:', bigE);
            var c = prompt(tipMsg || '请输入页面上的验证码（留空=取消，输入ABORT=中止爬取）：');
            if (c === null || c === undefined) callback && callback({ code: '', canceled: true, aborted: false, kaptchaKey: '' });
            else if (String(c).toUpperCase() === 'ABORT') callback && callback({ code: '', canceled: true, aborted: true, kaptchaKey: '' });
            else callback && callback({ code: (c || '').trim().toUpperCase(), canceled: !c, aborted: false, kaptchaKey: '' });
        }
    }

    // ================================================================
    // 🔴⚡ 极速模式·有筛选（原精准模式合并后：支持筛选条件 + 页面条数 + API直取 + 重复页提醒）
    // ================================================================

    // 通用：从 DOM 拿当前选择的每页条数（10 / 20 / 30 / 40，找不到就 10）
    function getDomPageSize() {
        var ps = 10;
        try {
            var selText = '';
            var sel = document.querySelector('.ant-pagination-options-size-changer .ant-select-selection-selected-value, .ant-pagination-size-changer .ant-select-selection-selected-value');
            if (sel) selText = (sel.getAttribute && sel.getAttribute('title')) || (sel.innerText || sel.textContent || '').trim();
            if (!selText) {
                var sel2 = document.querySelector('.ant-pagination-options-size-changer, .ant-pagination-size-changer');
                if (sel2 && sel2.innerText) selText = (sel2.innerText || '').replace(/\s+/g, '');
            }
            var m = (selText || '').match(/(\d+)(条|\/|\/页|条\/页)?/);
            if (m && m[1]) {
                var n = parseInt(m[1]);
                if ([10, 20, 30, 40, 50, 100].indexOf(n) !== -1) ps = n;
            }
        } catch (e) { console.warn('[getDomPageSize] 异常, 默认10:', e.message || e); }
        return ps;
    }

    // 精准模式：3 种类型的 「placeholder 关键字 → 后端参数名」 映射表
    // （跟 extractPermitList / extractCompleteList 里 DOM 解析的 filters 字段名保持一致）
    var SMART_FILTER_MAPS = {
        basic: [
            { ph: '项目名称',       qKey: 'projectName' },
            { ph: '建设单位',       qKey: 'orgName' },
            { ph: '省级项目编号',   qKey: 'projectCode' },
            { ph: '所在城市',       qKey: 'cityId',     isSelect: true, altTextKey: 'cityText' },
            { ph: '项目分类',       qKey: 'projectClassId', isSelect: true, altTextKey: 'projectClassText' }
        ],
        permit: [
            { ph: '工程名称',           qKey: 'projectName' },
            { ph: '省级项目编号',       qKey: 'projectCode' },
            { ph: '施工许可证编号',     qKey: 'constructionPermitCode' },
            { ph: '发证机关',           qKey: 'authorizeOrgName' },
            { ph: '开始日期',           qKey: 'beginTime',  isDate: true },
            { ph: '结束日期',           qKey: 'endTime',    isDate: true },
            { ph: '所在城市',           qKey: 'cityCode',   isSelect: true, altTextKey: 'city' }
        ],
        complete: [
            { ph: '工程名称',               qKey: 'projectName' },
            { ph: '省级项目编号',           qKey: 'projectCode' },
            { ph: '竣工验收备案机关',       qKey: 'archiveOrgName' },
            { ph: '竣工验收备案编号',       qKey: 'provinceArchiveCode' }
        ]
    };

    function _getApiEndpoint(type) {
        if (type === 'basic')    return '/api/openplatform/project/list';
        if (type === 'permit')   return '/api/openplatform/constructionPermit/list';
        if (type === 'complete') return '/api/openplatform/projectAcceptanceArchive/list';
        return null;
    }

    function _getCityIdMap() {
        return { '广州市': '440100', '韶关市': '440200', '深圳市': '440300', '珠海市': '440400', '汕头市': '440500', '佛山市': '440600', '江门市': '440700', '湛江市': '440800', '茂名市': '440900', '肇庆市': '441200', '惠州市': '441300', '梅州市': '441400', '汕尾市': '441500', '河源市': '441600', '阳江市': '441700', '清远市': '441800', '东莞市': '441900', '中山市': '442000', '潮州市': '445100', '揭阳市': '445200', '云浮市': '445300' };
    }

    function collectSmartFilterParams(type) {
        var params = {};
        var cfg = SMART_FILTER_MAPS[type] || [];
        if (cfg.length === 0) return params;
        try {
            var wrap = document.querySelector('.search-module-wrap');
            if (!wrap) return params;

            // 深度递归：从任意 DOM 元素的 __vue__ 上找 value / cityId / classId
            function deepFindVueValue(dom, wantKeyPart) {
                try {
                    if (!dom) return null;
                    var seen = new WeakSet();
                    var stack = [];
                    if (dom.__vue__) stack.push(dom.__vue__);
                    while (stack.length > 0) {
                        var obj = stack.pop();
                        if (!obj || typeof obj !== 'object' || seen.has(obj)) continue;
                        seen.add(obj);
                        var keys = Object.keys(obj);
                        for (var k = 0; k < keys.length; k++) {
                            var kk = keys[k];
                            if (/^\$|^_/.test(kk) && kk !== '$data' && kk !== '_data') continue;
                            var val = null;
                            try { val = obj[kk]; } catch (eAcc) { continue; }
                            if (val && typeof val === 'object') { stack.push(val); continue; }
                            if (typeof val === 'string' && val && new RegExp(wantKeyPart, 'i').test(kk)) return val;
                        }
                        if (obj.$parent) stack.push(obj.$parent);
                        if (obj.$children && Array.isArray(obj.$children)) for (var c = 0; c < obj.$children.length; c++) stack.push(obj.$children[c]);
                    }
                } catch (e) {}
                return null;
            }

            // 先处理 input 文本框
            var inputs = wrap.querySelectorAll('input.ant-input');
            for (var i = 0; i < inputs.length; i++) {
                var ph = (inputs[i].getAttribute && inputs[i].getAttribute('placeholder')) || '';
                var v = (inputs[i].value || '').trim();
                if (!ph) continue;
                for (var j = 0; j < cfg.length; j++) {
                    if (cfg[j].isSelect || cfg[j].isDate) continue;
                    if (ph.indexOf(cfg[j].ph) !== -1) {
                        params[cfg[j].qKey] = v;
                        break;
                    }
                }
            }

            // 处理 input[type=date] 日期框（Vue 用的 ant-input 不一定是 date picker，再单独找 ant-calendar 相关的）
            var dateInputs = wrap.querySelectorAll('input[type="date"], .ant-calendar-input, input[placeholder*="日期"]');
            for (var di = 0; di < dateInputs.length; di++) {
                var dph = (dateInputs[di].getAttribute && dateInputs[di].getAttribute('placeholder')) || '';
                var dv = (dateInputs[di].value || '').trim();
                if (!dv) continue;
                for (var dj = 0; dj < cfg.length; dj++) {
                    if (!cfg[dj].isDate) continue;
                    if (dph.indexOf(cfg[dj].ph) !== -1 || (!dph && (dv.indexOf('-') !== -1 || /^\d{4}/.test(dv)))) {
                        var d = dv.substring(0, 10);
                        // 🔴 严格只按 SMART_FILTER_MAPS 里写的 qKey 填（permit 必须只填 beginTime/endTime，别多填 beginDate 等冗余参数 → 接口会直接返回 total=0）
                        params[cfg[dj].qKey] = d;
                        break;
                    }
                }
            }

            // 处理 select 下拉（所在城市、项目分类等）—— 跟 basic 原来的 collectFilterParamsFromDom 逻辑一致
            var allSelects = wrap.querySelectorAll('.ant-select.select');
            var selectIdx = 0;
            for (var si = 0; si < cfg.length; si++) {
                if (!cfg[si].isSelect) continue;
                var selDom = allSelects[selectIdx++];
                if (!selDom) continue;
                try {
                    var textEl = selDom.querySelector('.ant-select-selection-selected-value');
                    var textVal = textEl ? ((textEl.getAttribute && textEl.getAttribute('title')) || (textEl.innerText || '').trim()) : '';
                    var idVal = deepFindVueValue(selDom, 'city|class|value|id');
                    if (!idVal && (cfg[si].qKey === 'cityId' || cfg[si].qKey === 'cityCode') && textVal) {
                        var cityMap = _getCityIdMap();
                        if (cityMap[textVal]) idVal = cityMap[textVal];
                    }
                    if (idVal && /^\d+$/.test(idVal)) {
                        // 🔴 严格只填 SMART_FILTER_MAPS 里写的那一个城市数字字段
                        //   permit 只认 cityCode（多了 cityId → 接口 total=0）
                        //   basic 只认 cityId
                        params[cfg[si].qKey] = idVal;
                    }
                    if (textVal && cfg[si].altTextKey) params[cfg[si].altTextKey] = textVal;
                } catch (eSel) {}
            }
        } catch (e) { console.warn('[collectSmartFilterParams:' + type + '] 异常:', e.message || e); }
        console.log('[smart-filter] ✅ type=' + type + ' 收集到 DOM 筛选参数:', params);
        return params;
    }

    function _hasAnyFilter(fp) {
        if (!fp) return false;
        for (var k in fp) {
            if (!fp.hasOwnProperty(k)) continue;
            var v = fp[k];
            if (typeof v === 'string' && v.trim() !== '') return true;
            if (typeof v === 'number') return true;
        }
        return false;
    }

    function _buildFilterQueryString(fp) {
        if (!fp) return '';
        var parts = [];
        for (var k in fp) {
            if (!fp.hasOwnProperty(k)) continue;
            var v = fp[k];
            if (v === null || v === undefined || v === '') continue;
            if (typeof v === 'string' && v.trim() === '') continue;
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
        }
        return parts.length > 0 ? ('&' + parts.join('&')) : '';
    }

    // ---------- 极速模式·有筛选/无筛选：真正发送请求 + 验证码处理（重试3次，失败直接返回错误，不再回退 DOM） ----------
    //   🔴 最新实测（用户确认）：服务器从第 301 条起，**无论有没有筛选条件**，都返回与第 1 页完全重复的数据
    //      → 因此不再做任何拆分请求，pageSize 上限统一 = 300，超过就截断
    //      → 极速模式 1 次请求（pageNum=1&pageSize=≤300）：有筛选时填 1 次验证码，无筛选不用验证码
    function fetchListRapidFilteredApi(type, pageNum, pageSize, filterParams, outerDoneCallback, extraFlags) {
        var endpoint = _getApiEndpoint(type);
        if (!endpoint) { outerDoneCallback && outerDoneCallback({ success: false, error: '未知 type=' + type }); return; }
        var origin = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || window.location.origin || 'https://skypt.gdcic.net';
        var basePath = window.location.pathname || '/openplatform/';
        var hasFilter = _hasAnyFilter(filterParams);
        var filterQs = hasFilter ? _buildFilterQueryString(filterParams) : '';
        var retriesLeft = 3;
        var pn = Number(pageNum) || 1;
        var ps = Number(pageSize) || 10;
        var captchaPromptShown = false;
        function guardTry(caller) {
            if (captchaPromptShown && retriesLeft < 2) {
                console.warn('%c[rapid:' + type + '-guard] 🚫 已弹过验证码且已重试至少1次，不再重弹！失败直接回退DOM',
                    'background:#faad14;color:#000;font-weight:bold;');
                return false;
            }
            return true;
        }

        function tryNow() {
            if (!guardTry('tryNow')) { onFailRapid('验证码重试次数用完，直接回退 DOM'); return; }
            var needCap = hasFilter;
            var baseQs = '';
            if (needCap) {
                var typeName = { basic: '基本信息', permit: '施工许可', complete: '竣工验收' }[type] || type;
                var filterDesc = _buildFilterDescRapid(filterParams);
                var tipMsg = '【极速模式·有筛选】' + typeName + ' · 抓 ' + ps + ' 条\n筛选：' + filterDesc + '\n请输入 5 位验证码后点「确认开始抓取」';
                var isTruncated = !!(extraFlags && extraFlags.truncated);
                if (isTruncated) {
                    var realT = extraFlags.realTotal || '?';
                    var hLim = extraFlags.hardLimit || ps;
                    tipMsg += '\n⚠️ 筛选后共 ' + realT + ' 条，但服务器第 ' + (hLim + 1) + ' 条起就和第 1 页数据重复（服务器分页机制，任何方式都无法绕过）';
                    tipMsg += '\n🎯 本次只获取前 ' + hLim + ' 条真实数据，填完这 1 次验证码即可抓完';
                    tipMsg += '\n💡 如需全部：清空筛选条件 → 极速模式抓全量 → Excel 本地筛选';
                } else if (ps > 40) {
                    tipMsg += '\n🎯 本次一共 ' + ps + ' 条，填完这 1 次验证码全部抓完！';
                }
                var retryCount = 3 - retriesLeft;
                captchaPromptShown = true;
                showCaptchaPrompt('', tipMsg, retryCount, function (capRes) {
                    if (capRes && capRes.aborted) {
                        outerDoneCallback && outerDoneCallback({ success: false, error: '用户中止', aborted: true });
                        return;
                    }
                    if (capRes && (capRes.canceled || !capRes.code)) {
                        console.warn('[rapid:' + type + '] 用户取消验证码 → 回退 DOM 方案');
                        _fallbackDomRapid();
                        return;
                    }
                    var capCode = capRes && capRes.code ? capRes.code.trim().toUpperCase() : '';
                    var capKey = capRes && capRes.kaptchaKey ? capRes.kaptchaKey : '';
                    baseQs = 'pageNum=' + pn + '&pageSize=' + ps + '&kaptcha=' + encodeURIComponent(capCode) + '&kaptchaKey=' + encodeURIComponent(capKey) + '&flag=true';
                    sendReqRapid(baseQs + filterQs);
                });
            } else {
                baseQs = 'pageNum=' + pn + '&pageSize=' + ps + '&kaptchaKey=&flag=false';
                sendReqRapid(baseQs);
            }
        }

        function _buildFilterDescRapid(fp) {
            if (!fp) return '无';
            var parts = [];
            var map = {
                projectName: '项目名', projectCode: '省编号', constructionPermitCode: '许可证号',
                authorizeOrgName: '发证机关', archiveOrgName: '备案机关', provinceArchiveCode: '备案号',
                orgName: '建设单位',
                beginDate: '开始', endDate: '结束', beginTime: '开始', endTime: '结束',
                cityText: '城市', city: '城市', cityCode: '城市', cityId: '城市', projectClassText: '分类'
            };
            for (var k in fp) {
                if (!fp.hasOwnProperty(k)) continue;
                var v = fp[k];
                if (v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')) continue;
                var label = map[k] || k;
                parts.push(label + '=' + (String(v).length > 10 ? String(v).slice(0, 8) + '…' : v));
                if (parts.length >= 4) break;
            }
            return parts.length === 0 ? '无' : parts.join(', ');
        }

        function sendReqRapid(qs) {
            var url = origin + endpoint + '?' + qs;
            console.log('%c[rapid:' + type + '-api] 请求 page=' + pn + ', size=' + ps + (hasFilter ? ' [带筛选+验证码]' : ' [无筛选]') + ' → ' + url, 'color:#722ed1;font-weight:bold;');
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, false);
                xhr.withCredentials = true;
                xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
                xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                xhr.send(null);
                if (xhr.status !== 200) { onFailRapid('HTTP ' + xhr.status); return; }
                var text = xhr.responseText || '';
                var json = {};
                try { json = JSON.parse(text || '{}'); } catch (eP) { onFailRapid('JSON解析失败: ' + text.substring(0, 200)); return; }
                var isCaptchaErr = (json.code === 500 && /验证码|已过期|kaptcha|无效|错误/i.test(json.msg || '')) ||
                    ((json.code === 400 || json.code === 401 || json.code === 403) && /验证码|kaptcha/i.test(json.msg || ''));
                if (isCaptchaErr) {
                    if (retriesLeft > 0 && guardTry('sendReqRapid.isCaptchaErr')) {
                        retriesLeft--;
                        console.warn('[rapid:' + type + '-api] 验证码错误/过期（' + (json.msg || '') + '），重刷重试（剩余重试次数=' + retriesLeft + '）');
                        setTimeout(tryNow, 300);
                    } else {
                        console.warn('[rapid:' + type + '-api] 验证码错误或重试保护触发 → 回退 DOM，不再弹验证码');
                        onFailRapid('验证码连续错误: ' + (json.msg || ''));
                    }
                    return;
                }
                if (json.code !== 0 && json.code !== 200) {
                    console.warn('%c[rapid:' + type + '-api] ⚠️ 接口非验证码错误 code=' + json.code + ', msg=' + (json.msg || '') + ' → 整体回退 DOM 方案', 'background:#faad14;color:#000;font-weight:bold;');
                    onFailRapid(json.msg || '接口错误 code=' + json.code); return;
                }
                var rows = [];
                if (Array.isArray(json.rows)) rows = json.rows;
                else if (json.data && Array.isArray(json.data.rows)) rows = json.data.rows;
                else if (json.data && Array.isArray(json.data)) rows = json.data;
                var total = parseInt(String(json.total || 0)) || 0;
                if (!total && json.data && typeof json.data === 'object') {
                    var dt = parseInt(String(json.data.total || 0)) || 0;
                    if (dt) total = dt;
                    else if (json.data.pageInfo) {
                        var dpi = parseInt(String(json.data.pageInfo.total || 0)) || 0;
                        if (dpi) total = dpi;
                    }
                }
                // 🔴 服务器隐形 pageSize 上限保护：如果用户请求 pageSize>300，接口只返回 10 条
                //    但我们在进入这里前已经通过 _calcFilteredLimit 把 requestSize 限制在了 ≤300
                //    如果仍然出现 returned<ps*0.5，意味着筛选参数可能不被服务器识别，回退 DOM 并提示
                var returned = rows.length;
                if (hasFilter && ps > 40 && returned < 12 && returned < ps * 0.5) {
                    console.warn('%c[rapid:' + type + '-api] ⚠️ 服务器实际返回条数异常！请求 pageSize=' + ps + '，实际只返回 ' + returned + ' 条 → 可能筛选参数名不正确，接口无法识别',
                        'background:#ff4d4f;color:#fff;font-weight:bold;');
                }
                var duplicate = _isApiPageDuplicate(rows, extraFlags ? (extraFlags.dupOpts || {}) : {});
                var mapper = _getRowMapper(type) || function (r) { return r; };
                var mapped = rows.map(function (src) { return mapper(src, origin, basePath); });
                var extraInfo = '';
                if (extraFlags && extraFlags.truncated) extraInfo += ' [⚠️ 已截断，只返回前' + (extraFlags.hardLimit || 300) + '条，真实总数=' + (extraFlags.realTotal || '?') + ']';
                if (duplicate) extraInfo += ' [⚠️ 本页与上一页重复]';
                console.log('[rapid:' + type + '-api] ✅ page=' + pn + ' rows=' + mapped.length + ', total=' + total + extraInfo);
                _finalizeSuccessResponse(mapped, total, duplicate);
            } catch (e) {
                console.error('%c[rapid:' + type + '-api] ❌ 请求异常：' + (e.message || String(e)) + ' → 回退DOM',
                    'background:#ff4d4f;color:#fff;font-weight:bold;');
                onFailRapid(e.message || String(e));
            }
        }

        function _finalizeSuccessResponse(finalMapped, total, duplicate) {
            var finalData = Array.isArray(finalMapped) ? finalMapped : [];
            var finTotal = Math.max(0, Number(total) || 0);
            var resp = {
                success: true,
                via: 'api',
                data: finalData,
                total: finTotal,
                totalPages: 1,
                pageSize: ps,
                duplicate: !!duplicate,
                needCaptcha: hasFilter,
                filterParams: filterParams || {},
                aborted: false,
                hasFilter: hasFilter
            };
            if (extraFlags) {
                if (extraFlags.truncated === true) resp.truncated = true;
                if (extraFlags.beyondLimit === true) resp.beyondLimit = true;
                if (extraFlags.filteredLimitReached === true) resp.filteredLimitReached = true;
                if (typeof extraFlags.realTotal === 'number') resp.realTotal = extraFlags.realTotal;
                if (typeof extraFlags.hardLimit === 'number') resp.hardLimit = extraFlags.hardLimit;
                if (extraFlags.filteredLimitMsg) resp.filteredLimitMsg = extraFlags.filteredLimitMsg;
            }
            outerDoneCallback && outerDoneCallback(resp);
        }

        function onFailRapid(err) {
            console.error('%c[rapid:' + type + '-api] ❌ API 方案失败: ' + err + '（⚠️ 已禁用 DOM 回退，直接返回错误给用户）',
                'background:#ff4d4f;color:#fff;font-weight:bold;');
            try {
                var W = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
                W.__SJKFPT_LAST_API_FAIL_REASON__ = '[rapid:' + type + '-api] ' + (err || '未知错误');
            } catch (e) {}
            // 🔴 用户明确要求：做不到就做不到，不要回退 DOM（那只会偷偷拿到当前页10条，误导判断以为成功了）
            outerDoneCallback && outerDoneCallback({
                success: false,
                error: (err || '未知错误'),
                via: 'api-fail',
                _noFallback: true,
                data: [],
                total: 0
            });
        }

        function _fallbackDomRapid() {
            // 🔴 完全禁用 DOM 回退：onFailRapid 直接返回错误，不再偷偷读当前页 10 条 DOM 数据
            onFailRapid('_fallbackDomRapid 已禁用，请根据控制台报错排查极速模式 API 问题');
        }

        tryNow();
    }

    // 🔴 旧 fetchListRapidFiltered（逐页请求遗留函数）已彻底删除！逻辑已合并到 fetchListRapid 顶层入口统一一次性拉完

    // 缺少 basic 的映射函数（之前可能没公开）—— 补齐 _mapBasicRowFromApi（极速模式共用）
    function _mapBasicRowFromApi(src, origin, basePath) {
        var code = String(src.projectCode || '');
        var name = String(src.projectName || '');
        // 🔴 buildUnit 是数组 [{orgName:"xxx", orgTypeId:1, orgCode:"xxx"}, ...]，不能直接 String()
        var buildUnitNames = [];
        var buildUnitArr = src.buildUnit;
        if (Array.isArray(buildUnitArr) && buildUnitArr.length > 0) {
            for (var bu = 0; bu < buildUnitArr.length; bu++) {
                var buItem = buildUnitArr[bu];
                if (buItem && buItem.orgName) buildUnitNames.push(String(buItem.orgName));
            }
        }
        var buildUnit = buildUnitNames.length > 0 ? buildUnitNames.join('、') : String(src.constructOrgName || '');
        var city = String(src.city || src.cityText || '');
        var row = {
            '项目名称': name,
            '省级项目编号': code,
            // ✅ 列表级：只有 city 文本，没有省/区 → 写入标准列「所在市」
            '所在市': city,
            // ✅ 项目所在地：详情接口抓取后回填（省+市+区 拼接），列表阶段留空
            '项目所在地': '',
            '项目分类': src.projectClass || src.projectClassName || src.projectClassText || '',
            '建设单位': buildUnit,
            // 🔴 保留原 fetchBasicListViaApiReal 里供详情提取用的内部字段（详情查询可能依赖 _apiId）
            '_apiProjectClassId': src.projectClassId || '',
            '_apiCityId': src.cityId || '',
            '_apiDataLevel': src.dataLevel || '',
            '_apiId': src.id || ''
        };
        if (src.dataLevel) row['数据等级'] = _stringifyDataLevel(src.dataLevel);
        // 🔴 详情 URL：必须跟原来 fetchBasicListViaApiReal 完全一致 /openplatform/#/web/project/detail?projectCode=xxx
        //    错误格式（/web/projectDetail）会导致详情匹配失败 → 触发仿真点击弹新窗口 → 卡死
        if (code) {
            row.detailUrl = origin + '/openplatform/#/web/project/detail?projectCode=' + encodeURIComponent(code);
        }
        return row;
    }

    // ---------- 核心：通用 3 种类型的真实 API 直取（无筛选/无验证码） ----------
    function fetchListViaApiReal(type, pageNum, pageSize, dupOpts) {
        var cfg = _getApiListConfig(type);
        if (!cfg) return { success: false, error: '未知 type=' + type };
        var pn = Number(pageNum) || 1;
        var ps = Number(pageSize) || 100;
        var dOpt = dupOpts || {};
        var origin = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || window.location.origin || 'https://skypt.gdcic.net';
        var basePath = window.location.pathname || '/openplatform/';
        var mapper = _getRowMapper(type);
        if (!mapper) return { success: false, error: '无 mapper, type=' + type };

        var qs = 'pageNum=' + pn + '&pageSize=' + ps + '&kaptchaKey=&flag=false';
        var url = origin + cfg.path + '?' + qs;
        var tag = '[' + type + '-api]';
        console.log('%c' + tag + ' 请求 page=' + pn + ', size=' + ps + ' → ' + url, 'color:#1890ff;font-weight:bold;');

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.send(null);
            if (xhr.status !== 200) return { success: false, error: 'HTTP ' + xhr.status };
            var text = xhr.responseText || '';
            var json = {};
            try { json = JSON.parse(text || '{}'); } catch (eP) {
                return { success: false, error: 'JSON解析失败: ' + text.substring(0, 200) };
            }
            if (json.code !== 0 && json.code !== 200) {
                return { success: false, error: (json.msg || '接口返回错误 code=' + json.code) };
            }
            var rows = [];
            if (Array.isArray(json.rows)) rows = json.rows;
            else if (json.data && Array.isArray(json.data.rows)) rows = json.data.rows;
            else if (json.data && Array.isArray(json.data)) rows = json.data;
            var total = parseInt(String(json.total || 0)) || 0;
            var respPageNum = parseInt(String(json.pageNum || pn)) || pn;

            var mapped = rows.map(function (src) { return mapper(src, origin, basePath); });
            // 🔴 duplicate 检测：如果调用方传了 dupOpts 就用调用方的；否则用 config 里的默认值
            var skipOv = typeof dOpt.skipOverlapCheck === 'boolean' ? dOpt.skipOverlapCheck : !!cfg.skipOverlap;
            var isDup = _isApiPageDuplicate(rows, { skipOverlapCheck: skipOv, debug: true });
            console.log(tag + ' ✅ page=' + pn + ' 返回 rows=' + mapped.length + ', total=' + total + ', duplicate=' + isDup + ' (skipOverlap=' + skipOv + ')');
            return {
                success: true,
                data: mapped,
                rawRows: rows,
                total: total,
                pageNum: respPageNum,
                pageSize: ps,
                totalPages: total > 0 ? Math.ceil(total / ps) : 0,
                duplicate: isDup
            };
        } catch (e) {
            return { success: false, error: e.message || String(e) };
        }
    }

    // ---------- 🔴✅ 极速模式【唯一顶层入口】（深度融合精准 + 一次性拉完，不再逐页弹验证码） ----------
    //
    //   🔴 核心设计（用户明确要求）：
    //      因为极速模式已经固定「起始页=1」，所以用户选的 1-N 页 × 每页M条 = 总条数 N*M
    //      → **直接 pageNum=1&pageSize=总条数**，一次请求完，填一次验证码（有筛选时）即可！
    //      → 响应强制 totalPages=1，防止 popup 继续翻下一页弹第二次验证码
    //
    //   分支 A：无筛选条件（smartHasFilter=false）
    //     • 总条数 = endPage × apiPageSize（上限 5000，防止请求过大）
    //     • 无验证码、flag=false、普通 API（pageNum=1&pageSize=总条数）
    //     • 无 300 条限制，但深度分页后服务器会循环重复，插件会自动停
    //
    //   分支 B：有筛选条件（smartHasFilter=true）
    //     • 先预请求 total（pageSize=1，无验证码）得到真实命中数
    //     • 计算「理论总条数」= min(用户想抓的总数, 300) —— 有筛选时服务器第 301 条起就和第 1 页完全重复
    //     • 若「理论总条数 < 用户起始条号」 → 拒绝（不弹验证码浪费时间）
    //     • 否则 → pageNum=1&pageSize=理论总条数 一次拉完（弹 1 次验证码）
    //     • 若被 300 截断了 → truncated=true + 弹窗提示用户（第301条起无法通过有筛选API获取真实新数据）
    // ---------- 🔴✅ 公共：根据 Tab 类型返回「popup 别名 → API 真实参数名」映射表 ----------
    //   所有"把 popup 人类友好 key 转成真实请求 key"的地方（probeTotal / fetchListRapid）
    //   都必须走这里，保证全局一套映射！
    //   ⚠️ 注意：permit 接口对参数名非常严格，多余参数会导致 total=0！
    //            所以这里只映射真实需要的 key，不再"兼容填充"一堆冗余参数
    function _getPopupToApiAliasMap(type) {
        if (type === 'basic') {
            return {
                unit: 'orgName',                               // 建设单位
                code: 'projectCode',                           // 省级项目编号
                city: 'cityText',                              // 所在城市（文本；数字ID 在下面统一加）
                startDate: 'beginDate',                        // 基本信息日期用 beginDate
                endDate:   'endDate'                           // 基本信息日期用 endDate
            };
        }
        if (type === 'permit') {
            return {
                code: 'projectCode',                           // 省级项目编号
                permitNo: 'constructionPermitCode',            // 施工许可证编号
                authority: 'authorizeOrgName',                 // 发证机关
                startDate: 'beginTime',                        // permit 用 beginTime / endTime（严格按 cURL）
                endDate:   'endTime',
                city: 'city'                                   // permit 城市文本用 city（cURL 里城市只传 cityCode）
            };
        }
        if (type === 'complete') {
            return {
                code: 'projectCode',                           // 省级项目编号
                authority: 'archiveOrgName',                   // 竣工验收备案机关（注意不是 permit 的 authorizeOrgName）
                recordNo:  'provinceArchiveCode'               // 省级竣工验收备案编号
            };
        }
        return {};
    }
    // ---------- 🔴✅ 公共：每个 Tab "日期 / 城市" 真实接受的参数名（从 SMART_FILTER_MAPS 推断，保证配置即真相） ----------
    //   permit：日期用 beginTime/endTime，城市数字代码用 cityCode（严格按 cURL！多一个参数 total=0）
    //   basic： 日期用 beginDate/endDate，城市数字代码用 cityId
    //   complete：无日期，无城市
    function _getTabRealParamNames(type) {
        var dateStart = 'beginTime';
        var dateEnd = 'endTime';
        var cityNum = 'cityCode';
        var cityText = 'city';
        if (type === 'basic') {
            dateStart = 'beginDate';
            dateEnd = 'endDate';
            cityNum = 'cityId';
            cityText = 'cityText';
        }
        if (type === 'complete') {
            dateStart = null; dateEnd = null; cityNum = null; cityText = null;
        }
        return { dateStart: dateStart, dateEnd: dateEnd, cityNum: cityNum, cityText: cityText };
    }
    // ---------- 🔴✅ 公共：把 popup filters 用上面别名映射合并进 fp（严格模式：只填真实需要的参数，不再冗余填充） ----------
    function _mergePopupFiltersIntoFp(type, fp, incomingFilters) {
        if (!fp) fp = {};
        var flt = incomingFilters || {};
        var SYSTEM_KEYS = { fetchMode: true, startPage: true, endPage: true, apiPageSize: true, pageNum: true, pageSize: true, pageMode: true, _skipPageMode: true };
        var alias = _getPopupToApiAliasMap(type);
        var pn = _getTabRealParamNames(type);
        for (var ik in flt) {
            if (!flt.hasOwnProperty(ik) || SYSTEM_KEYS[ik]) continue;
            var iv = String(flt[ik] || '').trim();
            if (!iv) continue;
            var realKey = (alias && alias[ik]) ? alias[ik] : ik;
            // 🔴 日期：只填该 Tab 真正接受的那一个字段名（不再 beginTime+beginDate+startDate 全塞）
            var isDateField = (ik === 'startDate' || ik === 'endDate' || /[Dd]ate$|[Tt]ime$/.test(realKey));
            if (isDateField) {
                var dv = iv.substring(0, 10);
                if ((ik === 'startDate' || realKey === 'beginTime' || realKey === 'beginDate' || realKey === 'startDate') && pn.dateStart) {
                    fp[pn.dateStart] = dv;
                } else if ((ik === 'endDate' || realKey === 'endTime' || realKey === 'endDate') && pn.dateEnd) {
                    fp[pn.dateEnd] = dv;
                } else if (!/^[Dd]ate/.test(realKey)) {
                    fp[realKey] = dv;
                }
                // 城市字段：先填文本；同时查 cityMap → 只填该 Tab 真正接受的 cityNum 字段（cityCode 或 cityId，不再两个都塞）
            } else if (ik === 'city' || realKey === 'cityText' || realKey === 'city') {
                if (pn.cityText) fp[pn.cityText] = iv;
                try {
                    var cm = _getCityIdMap();
                    if (cm && cm[iv] && pn.cityNum) fp[pn.cityNum] = cm[iv];
                } catch (eCi) {}
            } else {
                fp[realKey] = iv;
            }
        }
        return fp;
    }

    // ---------- 🔴✅ 公共：根据「筛选后命中总数」+「用户想抓取条数」计算截断策略 ----------
    //   - hardLimit 固定 300（服务器有筛选分页极限：第 301 条起就和第 1 页重复，无法拿到真实新数据）
    //   - totalOverLimit：只要筛选命中总数 > hardLimit 就为 true（用于提示用户"301 条后会重复"）
    //   - truncatedForUser：用户需求条数超过 hardLimit（真被截断了，实际只能拿到 300 条真实数据）
    //   - requestSize：实际请求 pageSize = min(用户想抓, hardLimit)
    function _calcFilteredLimit(probeTotal, userWantedCount, hardLimit) {
        var HL = Math.max(1, Number(hardLimit) || 300);
        var total = Math.max(0, Number(probeTotal) || 0);
        var want = Math.max(1, Number(userWantedCount) || 1);
        var effectiveMax = Math.min(want, total || want);
        var totalOverLimit = (total > HL);
        var truncatedForUser = (effectiveMax > HL);
        var requestSize = Math.min(HL, effectiveMax);
        return {
            hardLimit: HL,
            probeTotal: total,
            userWantedCount: want,
            effectiveMax: effectiveMax,
            totalOverLimit: totalOverLimit,
            truncatedForUser: truncatedForUser,
            requestSize: requestSize,
            truncInfo: totalOverLimit ? { truncated: true, realTotal: total, hardLimit: HL, truncatedForUser: truncatedForUser } : null
        };
    }

    function fetchListRapid(type, pageNum, outerDoneCallback, incomingFilters) {
        try {
            var fp = collectSmartFilterParams(type);
            var flt = incomingFilters || {};
            var cfg = _getApiListConfig(type);
            var domFnMap = { 'basic': extractBasicList, 'permit': extractPermitList, 'complete': extractCompleteList };
            if (!cfg) { outerDoneCallback && outerDoneCallback({ success: false, error: '未知 type=' + type }); return; }

            // 🔴✅ 融合 popup 输入框传来的筛选条件（统一走公共函数）
            fp = _mergePopupFiltersIntoFp(type, fp, flt);
            var smartHasFilter = _hasAnyFilter(fp);

            // 🔴 极速模式固定 startPage=1，直接按 endPage 算总数据量，一次性 pageNum=1&pageSize=总数 拉完
            var userPsInput = Math.max(1, Number(flt.apiPageSize) || 100);
            var userEndPage = Math.max(1, Number(flt.endPage) || Number(pageNum) || 1);
            var HARD_LIMIT_FILTERED = 300;     // 有筛选时服务器极限（第301条起就和第1页重复，无法获取真实新数据）
            var pn = Number(pageNum) || 1;
            var userWantedTotal = userEndPage * userPsInput;

            console.log('%c[rapid:' + type + '] 🚀 极速模式【一次性拉完】：pageNum=1&pageSize=' + userWantedTotal +
                '（用户 endPage=' + userEndPage + ', 每页=' + userPsInput + '）, hasFilter=' + smartHasFilter + ', filterParams=',
                'background:#1890ff;color:#fff;font-weight:bold;', fp);

            // ------------ 包装 done：强制 totalPages=1，彻底阻止 popup 继续翻下一页弹验证码 ------------
            var doneFinal = function (res) {
                if (res && res.success) {
                    if (!res.totalPages || res.totalPages > 1) console.log('[rapid:' + type + '] 🔒 强制 totalPages=1（原=' + res.totalPages + '），popup 不会再请求下一页');
                    res.totalPages = 1;
                    if (typeof res.hasFilter === 'undefined') res.hasFilter = !!smartHasFilter;
                }
                outerDoneCallback && outerDoneCallback(res);
            };

            // ================================================================
            // 🔴 分支 A：无筛选 → 同样最多前 300 条真实数据（服务器已封死，第 301 条起不管有没有筛选都重复）
            //     请求策略：pageNum=1&pageSize=min(用户期望, 300) 一次性请求
            // ================================================================
            if (!smartHasFilter) {
                var HARD_LIMIT_NO_FILTER = 300;   // 和有筛选共用同一上限（服务器已统一封死 301+ 全重复）
                var wantNoFilter = Math.max(0, Number(userWantedTotal) || 0);
                var oneShotSizeNoFilter = wantNoFilter > 0
                    ? Math.min(wantNoFilter, HARD_LIMIT_NO_FILTER)
                    : Math.min(100, HARD_LIMIT_NO_FILTER);
                var truncatedToHardLimit = wantNoFilter > HARD_LIMIT_NO_FILTER;
                console.log('%c[rapid:' + type + '-A] 🟢 无筛选 → 一次性请求：pageNum=1&pageSize=' + oneShotSizeNoFilter +
                    (truncatedToHardLimit ? ('（用户期望 ' + wantNoFilter + ' 条 > 服务器硬上限 ' + HARD_LIMIT_NO_FILTER + '，已自动截断：服务器第 301 条起不管有没有筛选全部返回重复数据）') : ''),
                    'color:#52c41a;font-weight:bold;');
                var rawRes = fetchListViaApiReal(type, 1, oneShotSizeNoFilter, { skipOverlapCheck: true, debug: true });
                if (rawRes && rawRes.success) {
                    var finalData = (rawRes.data && Array.isArray(rawRes.data)) ? rawRes.data.slice(0, oneShotSizeNoFilter) : [];
                    var respBuild = {
                        success: true,
                        via: 'api',
                        data: finalData,
                        total: rawRes.total,
                        totalPages: 1,
                        pageSize: oneShotSizeNoFilter,
                        duplicate: false,
                        needCaptcha: false,
                        filterParams: cfg.emptyFilter || {},
                        aborted: false,
                        hasFilter: false
                    };
                    if (truncatedToHardLimit) {
                        // 超过 300：和有筛选一样透传 beyondLimit/filteredLimitReached，popup 会自动显示黄色警告 + forceStop
                        respBuild.beyondLimit = true;
                        respBuild.filteredLimitReached = true;
                        respBuild.realTotal = Math.max(Number(rawRes.total) || wantNoFilter, wantNoFilter);
                        respBuild.hardLimit = HARD_LIMIT_NO_FILTER;
                        respBuild.filteredLimitMsg = '已截断至前 ' + HARD_LIMIT_NO_FILTER + ' 条（服务器第 301 条起全部重复，与筛选条件无关）';
                        respBuild.partialSuccess = true;
                        respBuild.partialWantedCount = wantNoFilter;
                        respBuild.partialActualCount = finalData.length;
                        respBuild.error = '服务器第 301 条起全部返回重复数据（无论有没有筛选条件）。期望 ' + wantNoFilter + ' 条，本次仅返回前 ' + HARD_LIMIT_NO_FILTER + ' 条真实数据，无法获取更多。';
                    }
                    doneFinal(respBuild);
                    return;
                }
                // 🔴 失败直接返回错误，不再回退 DOM
                console.error('[rapid:' + type + '-A] ❌ API 失败：' + ((rawRes && rawRes.error) || '未知') + '（不再回退 DOM）');
                doneFinal({
                    success: false,
                    error: ((rawRes && rawRes.error) || '未知错误'),
                    via: 'api-fail',
                    data: [],
                    total: 0,
                    totalPages: 1,
                    _noFallback: true
                });
                return;
            }

            // ================================================================
            // 🔴 分支 B：有筛选 → 预请求 total → 若 >300 就截断到 300 → 一次拉完（1次验证码）
            // ================================================================
            var origin = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || window.location.origin || 'https://skypt.gdcic.net';
            var endpoint = cfg.path;
            var filterQs = _buildFilterQueryString(fp);
            var probeQs = 'pageNum=1&pageSize=1&kaptcha=&kaptchaKey=&flag=false';
            var probeUrl = origin + endpoint + '?' + probeQs + filterQs;
            console.log('[rapid:' + type + '-B] 🔍 有筛选：先预请求 total（无验证码） → ' + probeUrl);

            try {
                var pXhr = new XMLHttpRequest();
                pXhr.open('GET', probeUrl, false);
                pXhr.withCredentials = true;
                pXhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
                pXhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                pXhr.send(null);
                var pText = pXhr.responseText || '';
                var pJson = {};
                try { pJson = JSON.parse(pText || '{}'); } catch (eP) {}
                var probeTotal = parseInt(String(pJson && (pJson.total || (pJson.data && pJson.data.total)) || 0)) || 0;
                console.log('[rapid:' + type + '-B] ✅ 预请求命中：total=' + probeTotal);

                var userWantRec = userEndPage * userPsInput;
                var limitCalc = _calcFilteredLimit(probeTotal, userWantRec, HARD_LIMIT_FILTERED);
                var requestSize = limitCalc.requestSize;
                var totalOverLimit = limitCalc.totalOverLimit;
                var truncatedForUser = limitCalc.truncatedForUser;

                console.log('%c[rapid:' + type + '-B] 🔴 有筛选一次性：totalOverLimit=' + totalOverLimit +
                    ', 用户想抓 ' + userWantRec + ' 条，实际命中 ' + probeTotal + ' 条，最终请求 pageNum=1&pageSize=' + requestSize +
                    (truncatedForUser ? ('（用户需求>' + HARD_LIMIT_FILTERED + ' 被强制截断到' + HARD_LIMIT_FILTERED + '）') : (totalOverLimit ? ('（total>' + HARD_LIMIT_FILTERED + '，提示用户第' + (HARD_LIMIT_FILTERED + 1) + '条就重复，本次只抓前' + requestSize + '条真实数据）') : '')),
                    (truncatedForUser ? 'background:#fa8c16;color:#fff;font-weight:bold;' : (totalOverLimit ? 'background:#faad14;color:#fff;font-weight:bold;' : 'background:#52c41a;color:#fff;font-weight:bold;')));

                fetchListRapidFilteredApi(type, 1, requestSize, fp, function (res) {
                    if (res && res.success) {
                        if (limitCalc.truncInfo) {
                            res.filteredLimitReached = true;
                            res.filteredLimitMsg = '已截断至前 ' + HARD_LIMIT_FILTERED + ' 条（服务器第 ' + (HARD_LIMIT_FILTERED + 1) + ' 条起与第 1 页重复，与筛选条件无关）';
                            if (typeof limitCalc.truncInfo.realTotal === 'number') res.realTotal = limitCalc.truncInfo.realTotal;
                            if (typeof limitCalc.truncInfo.hardLimit === 'number') res.hardLimit = limitCalc.truncInfo.hardLimit;
                            res.beyondLimit = true;
                        }
                    }
                    doneFinal(res);
                }, limitCalc.truncInfo);
                return;
            } catch (pErr) {
                // 🔴 预请求异常（XHR 失败 / JSON 解析失败等）：也不要回退 DOM，直接返回错误，把问题暴露给用户看
                console.error('[rapid:' + type + '-B] ❌ 预请求异常（不再回退 DOM/不再兜底请求）：', pErr.message || pErr);
                outerDoneCallback && outerDoneCallback({
                    success: false,
                    error: '预请求 total 失败: ' + (pErr && pErr.message ? pErr.message : String(pErr)),
                    via: 'api-probe-fail',
                    _noFallback: true,
                    data: [],
                    total: 0
                });
                return;
            }
        } catch (eBig) {
            // 🔴 顶层异常：同样直接返回错误，不要回退 DOM（之前 SERVER_SINGLE_PAGE_HARD_LIMIT 未定义 就是到这里偷偷回退 DOM 只拿 10 条，害你判断失误）
            console.error('[rapid:' + type + '] ❌ 极速模式顶层异常（不再回退 DOM）：', eBig && eBig.message ? eBig.message : eBig, eBig && eBig.stack ? eBig.stack : '');
            outerDoneCallback && outerDoneCallback({
                success: false,
                error: '极速模式异常: ' + ((eBig && eBig.message) || String(eBig)),
                via: 'api-fatal',
                _noFallback: true,
                data: [],
                total: 0
            });
        }
    }

    // ---------- 通用：3 种类型的直取配置 ----------
    function _getApiListConfig(type) {
        if (type === 'basic') {
            return {
                path: '/api/openplatform/project/list',
                emptyFilter: { projectName: '', projectCode: '', orgName: '', cityId: '', cityText: '', projectClassId: '', projectClassText: '', beginDate: '', endDate: '' },
                skipOverlap: false   // basic 类型是旧逻辑，保留重叠检测（防止深度截断）
            };
        }
        if (type === 'permit') {
            return {
                path: '/api/openplatform/constructionPermit/list',
                emptyFilter: { projectName: '', code: '', permitNo: '', authority: '', startDate: '', endDate: '', city: '' },
                skipOverlap: true    // permit/complete 极速模式默认跳过重叠检测（防止误判丢第二页）
            };
        }
        if (type === 'complete') {
            return {
                path: '/api/openplatform/projectAcceptanceArchive/list',
                emptyFilter: { projectName: '', code: '', authority: '', recordNo: '' },
                skipOverlap: true
            };
        }
        return null;
    }
    function _getRowMapper(type) {
        if (type === 'basic') return _mapBasicRowFromApi;
        if (type === 'permit') return _mapPermitRowFromApi;
        if (type === 'complete') return _mapCompleteRowFromApi;
        return null;
    }

    // 🔴✅ 统一把「数据等级」转成字符串：API 返回可能是 {code,name}/{value,label}/{...} 对象（否则页面显示 [object Object]）
    function _stringifyDataLevel(v) {
        if (v === null || v === undefined) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return String(v);
        if (typeof v === 'boolean') return v ? '是' : '否';
        if (typeof v === 'object') {
            try {
                var name = v.name || v.label || v.text || v.value || v.code || v.level || '';
                if (name !== '' && name !== null && name !== undefined) {
                    if (typeof name === 'string' || typeof name === 'number') return String(name);
                }
                return JSON.stringify(v);
            } catch (e) {
                try { return JSON.stringify(v); } catch (e2) { return '[object Object]'; }
            }
        }
        try { return String(v); } catch (e) { return ''; }
    }

    function _mapPermitRowFromApi(src, origin, basePath) {
        var row = {
            '工程名称': src.projectName || '',
            '施工许可证编号': src.constructionPermitCode || '',
            '省级项目编号': src.projectCode || '',
            '发证机关': src.authorizeOrgName || '',
            '日期': (src.authorizeDate || '').substring(0, 10),
            '所在城市': src.city || '',
            '数据等级': _stringifyDataLevel(src.dataLevel)
        };
        if (row['施工许可证编号']) {
            row.detailUrl = origin + basePath + '#/web/permit?permitCode=' + encodeURIComponent(row['施工许可证编号']);
        }
        return row;
    }

    function _mapCompleteRowFromApi(src, origin, basePath) {
        var accId = String(src.id || '');
        var row = {
            '工程名称': src.projectName || '',
            '省级项目编号': src.projectCode || '',
            '备案机关': src.archiveOrgName || '',
            '竣工验收备案编号': src.archiveCode || '',
            '省级竣工验收备案编号': src.provinceArchiveCode || '',
            '数据等级': _stringifyDataLevel(src.dataLevel),
            // 🔴 pure API 用：background 从 message.listRow._acceptanceId 取（不用走仿真点击/_locator 了）
            '_acceptanceId': accId
        };
        // 🔴 真实 URL 格式（随便造的，只要通过 rowsWithUrl 的 length>5 检查即可；真正取详情用 listRow._acceptanceId 纯接口）
        if (accId && /^\d+$/.test(accId)) {
            row.detailUrl = origin + '/openplatform/#/web/projectAcceptanceArchive/detail?id=' + encodeURIComponent(accId);
        }
        return row;
    }

    function fetchListViaApiReal(type, pageNum, pageSize, dupOpts) {
        var cfg = _getApiListConfig(type);
        if (!cfg) return { success: false, error: '未知 type=' + type };
        var pn = Number(pageNum) || 1;
        var ps = Number(pageSize) || 100;
        var dOpt = dupOpts || {};
        var origin = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || window.location.origin || 'https://skypt.gdcic.net';
        var basePath = window.location.pathname || '/openplatform/';

        // 🔴 致命 BUG 修复：之前写死 permit/complete 二选一，完全没考虑 basic → 被当成 complete 映射 → __SIMULATE_CLICK__ 弹新窗口卡死！
        var mapper = _getRowMapper(type);
        if (!mapper) return { success: false, error: '未找到 mapper 函数（type=' + type + '）' };

        var qs = 'pageNum=' + pn + '&pageSize=' + ps + '&kaptchaKey=&flag=false';
        var url = origin + cfg.path + '?' + qs;
        console.log('%c[' + type + '-api] 请求 page=' + pn + ', size=' + ps + ' → ' + url, 'color:#1890ff;font-weight:bold;');

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.send(null);
            if (xhr.status !== 200) return { success: false, error: 'HTTP ' + xhr.status };
            var text = xhr.responseText || '';
            var json = {};
            try { json = JSON.parse(text || '{}'); } catch (eP) {
                return { success: false, error: 'JSON解析失败: ' + text.substring(0, 200) };
            }
            if (json.code !== 0 && json.code !== 200) {
                return { success: false, error: (json.msg || '接口返回错误 code=' + json.code) };
            }
            var rows = [];
            if (Array.isArray(json.rows)) rows = json.rows;
            else if (json.data && Array.isArray(json.data.rows)) rows = json.data.rows;
            else if (json.data && Array.isArray(json.data)) rows = json.data;
            var total = parseInt(String(json.total || 0)) || 0;

            var mapped = rows.map(function (src) { return mapper(src, origin, basePath); });
            // 🔴 overlap 策略：调用方显式指定 > cfg 默认值。basic=false(开检测防截断), permit/complete=true(关检测防误判丢页)
            var shouldSkip = (typeof dOpt.skipOverlapCheck === 'boolean') ? dOpt.skipOverlapCheck : !!cfg.skipOverlap;
            var dupArg = { skipOverlapCheck: shouldSkip, debug: true };
            var isDup = _isApiPageDuplicate(rows, dupArg);
            console.log('[' + type + '-api] ✅ page=' + pn + ' 返回 rows=' + mapped.length + ', total=' + total + ', duplicate=' + isDup + ' (skipOverlap=' + shouldSkip + ')');
            return {
                success: true,
                data: mapped,
                rawRows: rows,
                total: total,
                pageSize: ps,
                totalPages: total > 0 ? Math.ceil(total / ps) : 0,
                duplicate: isDup
            };
        } catch (e) {
            return { success: false, error: e.message || String(e) };
        }
    }

    function extractBasicList(filters, page) {
        var rows = getTableRows();
        var headers = safeGetHeaders();
        console.log('[basic-list] 提取列表: 行数=' + rows.length + ', 表头=', headers);
        var result = [];

        var idxName = getColIndex(headers, ['项目名称']);
        var idxUnit = getColIndex(headers, ['建设单位']);
        var idxCode = getColIndex(headers, ['项目编号', '省级项目编号']);
        var idxCity = getColIndex(headers, ['所在市', '城市', '所在地']);
        var idxClass = getColIndex(headers, ['项目分类']);

        for (var r = 0; r < rows.length; r++) {
            var cells = rows[r].querySelectorAll('td');
            if (cells.length < 3) continue;

            var projectName = idxName !== -1 ? getCellText(cells[idxName]) : '';
            var unit = idxUnit !== -1 ? getCellText(cells[idxUnit]) : '';
            var code = idxCode !== -1 ? getCellText(cells[idxCode]) : '';
            var city = idxCity !== -1 ? getCellText(cells[idxCity]) : '';
            var projClass = idxClass !== -1 ? getCellText(cells[idxClass]) : '';

            if (!fuzzyMatch(projectName, filters.projectName)) continue;
            if (!fuzzyMatch(unit, filters.unit)) continue;
            if (!fuzzyMatch(code, filters.code)) continue;
            if (!fuzzyMatch(city, filters.city)) continue;

            var detailUrl = idxName !== -1 ? getUrlFromCell(cells[idxName]) : null;
            if (!detailUrl || !isProjectDetailUrl(detailUrl)) {
                for (var c = 0; c < cells.length; c++) {
                    var url = getUrlFromCell(cells[c]);
                    if (url && isProjectDetailUrl(url)) { detailUrl = url; break; }
                }
            }
            if (detailUrl && !isProjectDetailUrl(detailUrl)) { detailUrl = null; }

            var rowData = {
                '项目名称': projectName,
                '建设单位': unit,
                '省级项目编号': code,
                // ✅ 所在市：列表页有「所在市」列 → 直接写入标准列「所在市」（用户明确：列表里就能找到，本应是这个字段的数据）
                '所在市': city,
                // ✅ 项目所在地：列表页 DOM 抓不到 province/city/division 拼接 → 先留空，详情页接口抓取后会回填为 省+市+区
                '项目所在地': ''
            };
            if (detailUrl) {
                rowData.detailUrl = detailUrl;
            } else if (code && code.trim() !== '') {
                // 🔴✅ 终极方案！！
                // 从 popup 的日志中发现真实详情页URL格式就是 /web/project/detail?projectCode=XXXXX
                // 这里的 XXXXX 正好就是我们列表页已经拿到的「省级项目编号」！！
                // 直接用它拼URL，完美！稳定！100%正确！不再需要仿真点击！
                var baseOrigin = window.location.origin || 'https://skypt.gdcic.net';
                var basePath = window.location.pathname || '/openplatform/';
                // 取 #/web/... hash 之前的基础路径 + 拼接详情 hash
                rowData.detailUrl = baseOrigin + basePath + '#/web/project/detail?projectCode=' + encodeURIComponent(code.trim());
                console.log('[basic-list] ✅ 构造详情URL (code=' + code + '): ' + rowData.detailUrl);
            }
            // 🔴 已完全弃用仿真点击：没 code 时干脆不设置 detailUrl（popup 会过滤掉，进入详情阶段直接跳过）

            result.push(rowData);
        }
        console.log('[basic-list] 提取结果: 共' + result.length + '条, 有构造URL=' + result.filter(function (x) { return x.detailUrl && x.detailUrl.indexOf('projectCode=') !== -1; }).length);
        if (result.length > 0) {
            console.log('[basic-list] 前3条定位:', result.slice(0, 3).map(function (r, i) {
                if (!r.detailUrl) return ('[无detailUrl' + i + '] ' + r['项目名称'] + ' | ' + r['省级项目编号']);
                return ('[URL' + i + '] ' + (r.detailUrl || '').slice(0, 120));
            }));
        }
        return result;
    }

    function extractPermitList(filters, page) {
        var rows = getTableRows();
        var headers = safeGetHeaders();
        var result = [];

        var idxName = getColIndex(headers, ['工程名称']);
        var idxPermit = getColIndex(headers, ['许可证编号', '施工许可证编号']);
        var idxCode = getColIndex(headers, ['项目编号', '省级项目编号']);
        var idxAuth = getColIndex(headers, ['发证机关']);
        var idxDate = getColIndex(headers, ['发证日期', '日期']);
        var idxCity = getColIndex(headers, ['所在市', '城市']);
        var idxLevel = getColIndex(headers, ['数据等级', '等级', '分级']);

        for (var r = 0; r < rows.length; r++) {
            var cells = rows[r].querySelectorAll('td');
            if (cells.length < 3) continue;

            var projectName = idxName !== -1 ? getCellText(cells[idxName]) : '';
            var permitNo = idxPermit !== -1 ? getCellText(cells[idxPermit]) : '';
            var code = idxCode !== -1 ? getCellText(cells[idxCode]) : '';
            var authority = idxAuth !== -1 ? getCellText(cells[idxAuth]) : '';
            var date = idxDate !== -1 ? getCellText(cells[idxDate]) : '';
            var city = idxCity !== -1 ? getCellText(cells[idxCity]) : '';
            var level = idxLevel !== -1 ? getCellText(cells[idxLevel]) : '';

            if (!fuzzyMatch(projectName, filters.projectName)) continue;
            if (!fuzzyMatch(code, filters.code)) continue;
            if (!fuzzyMatch(permitNo, filters.permitNo)) continue;
            if (!fuzzyMatch(authority, filters.authority)) continue;
            if (!filterByDate(date, filters.startDate, filters.endDate)) continue;
            if (!fuzzyMatch(city, filters.city)) continue;

            var detailUrl = idxPermit !== -1 ? getUrlFromCell(cells[idxPermit]) : null;
            if (!detailUrl || !isProjectDetailUrl(detailUrl)) {
                for (var c = 0; c < cells.length; c++) {
                    var url = getUrlFromCell(cells[c]);
                    if (url && isProjectDetailUrl(url)) { detailUrl = url; break; }
                }
            }
            if (detailUrl && !isProjectDetailUrl(detailUrl)) { detailUrl = null; }

            var rowData = {
                '工程名称': projectName,
                '施工许可证编号': permitNo,
                '省级项目编号': code,
                '发证机关': authority,
                '日期': date,
                '所在城市': city,
                '数据等级': level  // 🔴 列表列里已经有「数据等级」了，直接保留，详情页根本不会有，所以 merge 时列表优先即可
            };
            if (detailUrl) {
                rowData.detailUrl = detailUrl;
            } else if (permitNo && permitNo.trim() !== '') {
                var baseOrigin = window.location.origin || 'https://skypt.gdcic.net';
                var basePath = window.location.pathname || '/openplatform/';
                rowData.detailUrl = baseOrigin + basePath + '#/web/permit?permitCode=' + encodeURIComponent(permitNo.trim());
                console.log('[permit-list] ✅ 构造施工许可详情URL (permitNo=' + permitNo + '): ' + rowData.detailUrl);
            } else if (code && code.trim() !== '') {
                // permitNo 缺失时用省级项目编号构造（极少数情况可能不匹配，但绝不用仿真点击）
                var baseOrigin2 = window.location.origin || 'https://skypt.gdcic.net';
                var basePath2 = window.location.pathname || '/openplatform/';
                rowData.detailUrl = baseOrigin2 + basePath2 + '#/web/permit?projectCode=' + encodeURIComponent(code.trim());
            }
            // 🔴 已完全弃用仿真点击：permitNo/code 都缺失时不设置 detailUrl（popup 会过滤跳过）

            result.push(rowData);
        }
        console.log('[permit-list] 提取结果: 共' + result.length + '条, 有构造URL=' + result.filter(function (x) { return x.detailUrl && (x.detailUrl.indexOf('permitCode=') !== -1 || x.detailUrl.indexOf('projectCode=') !== -1); }).length);
        if (result.length > 0) {
            console.log('[permit-list] 前3条 (含工程名称/数据等级):', result.slice(0, 3).map(function (r, i) {
                return {
                    i: i,
                    工程名称: r['工程名称'],
                    施工许可证编号: r['施工许可证编号'],
                    省级项目编号: r['省级项目编号'],
                    数据等级: r['数据等级'],
                    detailUrl: (r.detailUrl || '').slice(0, 120)
                };
            }));
        }
        return result;
    }

    function extractCompleteList(filters, page) {
        var rows = getTableRows();
        var headers = safeGetHeaders();
        var result = [];

        // =========================================================================
        // 🔴✅ 0 干扰核心：同步 XHR 抓一次后端完整列表接口 → 每条都带 id=1004xxxx（acceptanceId）
        //     不用弹 Modal、不用挖 Vue 私有属性！按【精准复合键】匹配 DOM 行，100% 拿到正确的 acceptanceId
        // =========================================================================
        // 🔴✅✅✅ 重大修复：相同 projectCode（省级项目编号）会有 N 条不同备案！
        //   之前用 listLookupByCode = {projectCode: wrap}（对象单值）→ 同编号的 2/3 条被覆盖，
        //   导致所有同编号的行都拿到【第一条的 id】→ 请求同一个详情，所有返回值一模一样！
        //   → 【改为数组存多条】+【按备案编号精准匹配】+【多级兜底】
        var listAllRows = [];                       // 原封不动存所有接口行（[{id,projectCode,archiveCode,provinceArchiveCode,...}, ...]）
        var listLookupByArchiveCode = {};           // key = archiveCode（普通备案号，100% 唯一！）→ value = wrap
        var listLookupByProvinceArchiveCode = {};   // key = provinceArchiveCode（省级备案号，100% 唯一！）→ value = wrap
        var listLookupByCodeMulti = {};             // key = projectCode → value = [wrap1, wrap2, ...]（数组！同编号多条不覆盖）
        var listLookupByNameMulti = {};             // key = projectName → value = [wrap1, ...]（数组）
        try {
            var listUrl = '/api/openplatform/projectAcceptanceArchive/list?pageNum=1&pageSize=100&kaptchaKey=&flag=false';
            try {
                var fullHref = window.location.href.split('#')[0] || '';
                if (fullHref.indexOf('://') !== -1) {
                    var mt = fullHref.match(/^(https?:\/\/[^/]+)/);
                    if (mt && mt[1]) listUrl = mt[1] + listUrl;
                }
            } catch (eU) {}
            var xhr = new XMLHttpRequest();
            xhr.open('GET', listUrl, false); // false = 同步（content script 允许用，一次轻量请求，完全不卡）
            xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.setRequestHeader('Pragma', 'no-cache');
            try { xhr.send(); } catch (eSend) {}
            if (xhr.status === 200 || xhr.status === 0) {
                try {
                    var listJson = JSON.parse(xhr.responseText || '{}');
                    var listRows = [];
                    if (listJson && listJson.data && Array.isArray(listJson.data.rows)) listRows = listJson.data.rows;
                    else if (listJson && listJson.data && Array.isArray(listJson.data)) listRows = listJson.data;
                    else if (listJson && Array.isArray(listJson.rows)) listRows = listJson.rows;
                    else if (listJson && Array.isArray(listJson.data)) listRows = listJson.data;
                    for (var li = 0; li < listRows.length; li++) {
                        var lr = listRows[li] || {};
                        var wrap = {
                            id: String(lr.id || ''),
                            projectCode: String(lr.projectCode || ''),
                            projectId: String(lr.projectId || ''),
                            projectName: String(lr.projectName || ''),
                            archiveCode: String(lr.archiveCode || ''),
                            provinceArchiveCode: String(lr.provinceArchiveCode || ''),
                            archiveOrgName: String(lr.archiveOrgName || ''),
                            dataLevel: String(lr.dataLevel || ''),
                            actualCose: String(lr.actualCose || ''),
                            actualArea: String(lr.actualArea || ''),
                            structuralSystem: String(lr.structuralSystem || ''),
                            beginDate: String(lr.beginDate || ''),
                            endDate: String(lr.endDate || ''),
                            constructionScale: String(lr.constructionScale || ''),
                            createTime: String(lr.createTime || ''),
                            updateTime: String(lr.updateTime || '')
                        };
                        listAllRows.push(wrap);
                        // 🔴✅ 备案编号是真正的唯一键！精准匹配，100% 不会拿错 ID
                        if (wrap.archiveCode) listLookupByArchiveCode[wrap.archiveCode] = wrap;
                        if (wrap.provinceArchiveCode) listLookupByProvinceArchiveCode[wrap.provinceArchiveCode] = wrap;
                        // 🔴✅ projectCode/projectName 一对多的情况 → 数组存！同 key 不覆盖
                        if (wrap.projectCode) { (listLookupByCodeMulti[wrap.projectCode] = listLookupByCodeMulti[wrap.projectCode] || []).push(wrap); }
                        if (wrap.projectName) { (listLookupByNameMulti[wrap.projectName] = listLookupByNameMulti[wrap.projectName] || []).push(wrap); }
                    }
                    console.log('[complete-list] ✅ 同步抓列表接口成功：共' + listRows.length + '条记录，采用【备案编号精准匹配】为主');
                } catch (eJson) {
                    console.warn('[complete-list] ⚠️ 列表接口 JSON 解析失败：', eJson);
                }
            }
        } catch (eBigXhr) {
            console.warn('[complete-list] ⚠️ 列表接口同步抓取失败，继续 fallback 从 DOM 挖 ID：', eBigXhr);
        }

        var idxName = getColIndex(headers, ['工程名称']);
        var idxCode = getColIndex(headers, ['项目编号', '省级项目编号']);
        var idxAuth = getColIndex(headers, ['备案机关']);
        var idxRecord = getColIndex(headers, ['备案编号', '竣工验收备案编号']);
        var idxLevel = getColIndex(headers, ['数据等级', '等级', '分级']);

        for (var r = 0; r < rows.length; r++) {
            var cells = rows[r].querySelectorAll('td');
            if (cells.length < 3) continue;

            var projectName = idxName !== -1 ? getCellText(cells[idxName]) : '';
            var code = idxCode !== -1 ? getCellText(cells[idxCode]) : '';
            var authority = idxAuth !== -1 ? getCellText(cells[idxAuth]) : '';
            var recordNo = idxRecord !== -1 ? getCellText(cells[idxRecord]) : '';
            var level = idxLevel !== -1 ? getCellText(cells[idxLevel]) : '';

            if (!fuzzyMatch(projectName, filters.projectName)) continue;
            if (!fuzzyMatch(code, filters.code)) continue;
            if (!fuzzyMatch(authority, filters.authority)) continue;
            if (!fuzzyMatch(recordNo, filters.recordNo)) continue;

            var detailUrl = idxRecord !== -1 ? getUrlFromCell(cells[idxRecord]) : null;
            if (!detailUrl || !isProjectDetailUrl(detailUrl)) {
                for (var c = 0; c < cells.length; c++) {
                    var url = getUrlFromCell(cells[c]);
                    if (url && isProjectDetailUrl(url)) { detailUrl = url; break; }
                }
            }
            if (detailUrl && !isProjectDetailUrl(detailUrl)) { detailUrl = null; }

            var rowData = {
                '工程名称': projectName,
                '省级项目编号': code,
                '备案机关': authority,
                // 🔴✅ 用户要求：列表(type=6)里的「竣工验收备案编号」列 → 存为「省级竣工验收备案编号」（因为这是省级编号）
            '省级竣工验收备案编号': recordNo,
            // 🔴✅ 接口的 archiveCode（如：开建验备2026-115）= 真正的「竣工验收备案编号」！
            // 只要接口 lookup 能匹配到，就直接塞进去（用户要的就是这个，之前因为我映射错了才空的！）
            '竣工验收备案编号': '',
            '数据等级': level
            };
            // 🔴✅ 优先尝试抓「数字 ID」→ 如果抓到，直接走接口（不用点弹 Modal，0 干扰）
            // 🔴✅✅✅ 重大修复：统一用 _matchedWrap（同一个对象）存【匹配到的接口行】，避免「数字ID用的是A行但字段补全用的是B行」的分裂错乱！
            var numericId = '';
            var _matchedWrap = null;

            // ======================================================
            // 多级精准匹配（同 projectCode 的多条备案绝对不会拿错 ID！）
            // ======================================================
            var normStr = function (s) { return String(s || '').replace(/[\s\u00a0\u3000\-\.,，、]/g, '').trim(); };

            // 【优先级 1（100% 精准！）】按 DOM 的 recordNo（列表里的"备案编号/竣工验收备案编号"列）匹配
            //   用户说明：列表 DOM 里的这个列显示的是省级编号 → 所以优先匹配 provinceArchiveCode，其次匹配 archiveCode
            if (!_matchedWrap && recordNo) {
                var rn = normStr(recordNo);
                try {
                    if (listLookupByProvinceArchiveCode[recordNo]) _matchedWrap = listLookupByProvinceArchiveCode[recordNo];
                    if (!_matchedWrap && listLookupByArchiveCode[recordNo]) _matchedWrap = listLookupByArchiveCode[recordNo];
                    // 归一化兜底匹配（有些 DOM 显示和接口值可能有空格/短横线差异）
                    if (!_matchedWrap) {
                        for (var _aki = 0; _aki < listAllRows.length; _aki++) {
                            var w_ = listAllRows[_aki];
                            if (w_ && (normStr(w_.provinceArchiveCode) === rn || normStr(w_.archiveCode) === rn)) {
                                _matchedWrap = w_; break;
                            }
                        }
                    }
                } catch (eP1) {}
            }

            // 【优先级 2】projectCode + projectName 双条件（同 projectCode 的多条用名称再筛）
            if (!_matchedWrap && code && projectName && listLookupByCodeMulti[code]) {
                try {
                    var arr2 = listLookupByCodeMulti[code];
                    var pn_ = normStr(projectName);
                    // 优先完全相等
                    for (var _k2 = 0; _k2 < arr2.length; _k2++) {
                        if (normStr(arr2[_k2].projectName) === pn_) { _matchedWrap = arr2[_k2]; break; }
                    }
                    // 再 fuzzy 包含
                    if (!_matchedWrap) {
                        for (var _k2b = 0; _k2b < arr2.length; _k2b++) {
                            var n2 = normStr(arr2[_k2b].projectName);
                            if (n2 && pn_ && (n2.indexOf(pn_) !== -1 || pn_.indexOf(n2) !== -1)) { _matchedWrap = arr2[_k2b]; break; }
                        }
                    }
                } catch (eP2) {}
            }

            // 【优先级 3】单独 projectName 匹配（再结合 code）
            if (!_matchedWrap && projectName && listLookupByNameMulti[projectName]) {
                try {
                    var arr3 = listLookupByNameMulti[projectName];
                    if (arr3.length === 1) { _matchedWrap = arr3[0]; }
                    else {
                        // 多条同名称：结合 projectCode 过滤
                        var c_ = normStr(code);
                        for (var _k3 = 0; _k3 < arr3.length; _k3++) {
                            if (c_ && normStr(arr3[_k3].projectCode) === c_) { _matchedWrap = arr3[_k3]; break; }
                        }
                    }
                } catch (eP3) {}
            }

            // 【优先级 4】只有 projectCode，多条时**按当前 DOM 行循环下标 r 在数组内分配**（同 r 取数组 r%len 的位置！）
            //    关键：不会所有行都拿第一条！
            if (!_matchedWrap && code && listLookupByCodeMulti[code]) {
                try {
                    var arr4 = listLookupByCodeMulti[code];
                    if (arr4.length === 1) { _matchedWrap = arr4[0]; }
                    else {
                        // 有多条同项目编号：用 DOM 行号 r 在 arr4 里做"分配偏移"，并优先取【还没被前面的 DOM 行占用过】的那一条
                        var _usedIdFlags = {};
                        for (var _ri = 0; _ri < result.length; _ri++) {
                            var _prevId = (result[_ri] && result[_ri]._acceptanceId) ? String(result[_ri]._acceptanceId) : '';
                            if (_prevId) _usedIdFlags[_prevId] = true;
                        }
                        var _pickIdx = -1;
                        // 先找未被用过的
                        for (var _k4 = 0; _k4 < arr4.length; _k4++) {
                            if (!_usedIdFlags[String(arr4[_k4].id || '')]) { _pickIdx = _k4; break; }
                        }
                        if (_pickIdx === -1) _pickIdx = (r) % arr4.length; // 全用过了就兜底
                        _matchedWrap = arr4[_pickIdx];
                    }
                } catch (eP4) {}
            }

            // 【优先级 5】还是没有 → 从 DOM 兜底挖（tr.attributes / innerHTML / onclick 等）
            if (_matchedWrap && _matchedWrap.id) {
                numericId = String(_matchedWrap.id || '');
            } else {
                try { numericId = _extractRowAnyNumericId(rows[r], recordNo); } catch (eId) { numericId = ''; }
                // 如果 DOM 兜底抓到了 numericId，尝试在 listAllRows 里找到对应的 wrap，用于后续字段补全
                if (numericId) {
                    try {
                        for (var _fi = 0; _fi < listAllRows.length; _fi++) {
                            if (String(listAllRows[_fi].id || '') === String(numericId)) { _matchedWrap = listAllRows[_fi]; break; }
                        }
                    } catch (eFindWrap) {}
                }
            }
            rowData._acceptanceId = numericId;

            // 🔴✅ 额外：如果接口 lookup 匹配到了，但列表 DOM 字段是空的，用接口数据补全（对应用户之前说的「列表 DOM 有字段漏显示」）
            //   🔴✅✅✅ 这里的 lrObj 必须就是上面找 numericId 时的同一个 _matchedWrap！
            //   （如果继续用老的 listLookupByCode[code] 单值字典，会出现"id 是 A 行的，但补的 archiveCode 是 B 行的"分裂错乱！）
            if (_matchedWrap) {
                try {
                    var lrObj = _matchedWrap;
                    if (lrObj) {
                        if (!rowData['工程名称'] && lrObj.projectName) rowData['工程名称'] = lrObj.projectName;
                        if (!rowData['省级项目编号'] && lrObj.projectCode) rowData['省级项目编号'] = lrObj.projectCode;
                        if (!rowData['备案机关'] && lrObj.archiveOrgName) rowData['备案机关'] = lrObj.archiveOrgName;
                        // 🔴✅✅✅ 按用户给的真实数据严格映射（2026-07-26 示例）：
                        //   接口 archiveCode = 开建验备2026-115  →  「竣工验收备案编号」（本地普通备案号！）
                        //   接口 provinceArchiveCode = 4407832503100001-JX-001  →  「省级竣工验收备案编号」
                        //   两个字段完全不相等，才是正确的！
                        if (!rowData['竣工验收备案编号'] && lrObj.archiveCode) rowData['竣工验收备案编号'] = lrObj.archiveCode;
                        if (!rowData['省级竣工验收备案编号'] && lrObj.provinceArchiveCode) rowData['省级竣工验收备案编号'] = lrObj.provinceArchiveCode;
                        if (!rowData['数据等级'] && lrObj.dataLevel) rowData['数据等级'] = lrObj.dataLevel;
                    }
                } catch (eFill) {}
            }
            // 🔴 已完全弃用仿真点击：有数字 acceptanceId 时造一个"过 rowsWithUrl 过滤"的虚拟 detailUrl；没 id 时不设置 detailUrl（popup 过滤跳过）
            if (numericId) {
                rowData.detailUrl = window.location.origin + (window.location.pathname || '/openplatform/') + '#/web/projectAcceptanceArchive/detail?id=' + encodeURIComponent(numericId);
            }

            result.push(rowData);
        }
        console.log('[complete-list] 提取结果: 共' + result.length + '条, 有数字ID=' + result.filter(function (x) { return (x._acceptanceId && x._acceptanceId !== ''); }).length);
        if (result.length > 0) {
            console.log('[complete-list] 前3条定位:', result.slice(0, 3).map(function (r, i) {
                if (r._acceptanceId && r._acceptanceId !== '') return ('[接口获取' + i + '] id=' + (r._acceptanceId || '') + ' | ' + r['工程名称'] + ' | ' + r['竣工验收备案编号']);
                return ('[URL' + i + '] ' + (r.detailUrl || '').slice(0, 120));
            }));
        }
        return result;
    }

    // ===== 详情页：提取字段（核心重写！限定作用域，避免其他板块干扰） =====

    // 规范化文本：去除多余空白
    function normText(s) {
        if (!s) return '';
        return String(s).replace(/[\u00a0\u3000]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // 规范化 label：去除末尾冒号
    function normLabel(s) {
        if (!s) return '';
        return String(s).replace(/[\u00a0\u3000]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/[:：]+$/, '')
            .replace(/^[:：]+/, '')
            .trim();
    }

    function isValidLabel(text) {
        if (!text) return false;
        if (text.length < 2 || text.length > 30) return false;
        if (text.indexOf('\n') !== -1 || text.indexOf('\r') !== -1) return false;
        if (/^[\d\s\-.,，。:：()（）\/\\]+$/.test(text)) return false;
        return /[\u4e00-\u9fa5]/.test(text);
    }

    function isValidValue(text) {
        if (!text) return false;
        if (text.length > 500) return false;
        if (/^(暂无数据|无数据|暂无|无|--|-|空|\s+)$/i.test(text)) return false;
        return text.length > 0;
    }

    // ===== 在给定作用域内，扫描 .row-item > .title + .content 结构（最关键的策略） =====
    function scanRowItems(rootEl, dict) {
        if (!rootEl) return;
        var items = rootEl.querySelectorAll('.info-row .row-item, .info-content .row-item, .row-item');
        for (var i = 0; i < items.length; i++) {
            // 必须有 .title 和 .content 两个直接子元素
            var titleEl = null;
            var contentEl = null;
            try {
                titleEl = items[i].querySelector(':scope > .title');
                contentEl = items[i].querySelector(':scope > .content');
            } catch (e) {}
            if (!titleEl) titleEl = items[i].querySelector('.title');
            if (!contentEl) contentEl = items[i].querySelector('.content');
            if (!titleEl || !contentEl) continue;

            var t = normLabel(titleEl.innerText || titleEl.textContent || '');
            if (!isValidLabel(t)) continue;
            var v = normText(contentEl.innerText || contentEl.textContent || '');
            if (isValidValue(v)) {
                // 只在 dict 中没有时写入（作用域越小的作用域优先级越高，外层不要覆盖内层）
                if (!dict[t]) dict[t] = v;
            }
        }
    }

    // ===== 在给定作用域内，扫描 HTML Table 中 td.label -> td 的结构 =====
    function scanTdLabelTable(rootEl, dict) {
        if (!rootEl) return;
        var trs = rootEl.querySelectorAll('table tr');
        for (var tri = 0; tri < trs.length; tri++) {
            var cells = trs[tri].querySelectorAll('td');
            if (cells.length < 2) continue;
            for (var ci = 0; ci < cells.length; ci++) {
                var c = cells[ci];
                var isLabel = false;
                if (c.className && String(c.className).indexOf('label') !== -1) isLabel = true;
                if (!isLabel) continue;

                var t = normLabel(c.innerText || c.textContent || '');
                if (!isValidLabel(t)) continue;

                for (var ci2 = ci + 1; ci2 < cells.length; ci2++) {
                    var v = normText(cells[ci2].innerText || cells[ci2].textContent || '');
                    if (isValidValue(v)) {
                        if (!dict[t]) dict[t] = v;
                        break;
                    }
                }
            }
        }
    }

    // ===== 通用表格扫描：即使没有 label class，也按"标签+值"的模式扫描 =====
    function scanGenericTable(rootEl, dict) {
        if (!rootEl) return;
        var trs = rootEl.querySelectorAll('table tr');
        for (var tri = 0; tri < trs.length; tri++) {
            var cells = trs[tri].querySelectorAll('td, th');
            if (cells.length < 2) continue;

            for (var ci = 0; ci < cells.length - 1; ci++) {
                var labelCell = cells[ci];
                var labelText = normLabel(labelCell.innerText || labelCell.textContent || '');

                if (!isValidLabel(labelText)) continue;

                for (var ci2 = ci + 1; ci2 < cells.length; ci2++) {
                    var valText = normText(cells[ci2].innerText || cells[ci2].textContent || '');
                    if (isValidValue(valText)) {
                        if (!dict[labelText]) dict[labelText] = valText;
                        break;
                    }
                }
            }
        }
    }

    // ===== 扫描 dl/dt/dd 结构（定义列表） =====
    function scanDefinitionList(rootEl, dict) {
        if (!rootEl) return;
        var dls = rootEl.querySelectorAll('dl');
        for (var i = 0; i < dls.length; i++) {
            var dts = dls[i].querySelectorAll('dt');
            var dds = dls[i].querySelectorAll('dd');
            for (var j = 0; j < dts.length && j < dds.length; j++) {
                var t = normLabel(dts[j].innerText || dts[j].textContent || '');
                if (!isValidLabel(t)) continue;
                var v = normText(dds[j].innerText || dds[j].textContent || '');
                if (isValidValue(v)) {
                    if (!dict[t]) dict[t] = v;
                }
            }
        }
    }

    // ===== 扫描任意"标签-值"配对的 div 结构（不依赖特定class） =====
    function scanGenericLabelValue(rootEl, dict) {
        if (!rootEl) return;
        var allDivs = rootEl.querySelectorAll('div');
        for (var i = 0; i < allDivs.length; i++) {
            var el = allDivs[i];
            var children = el.children;
            if (children.length < 2) continue;

            for (var ci = 0; ci < children.length - 1; ci++) {
                var c1 = children[ci];
                var c2 = children[ci + 1];
                if (!c1 || !c2) continue;

                var t = normLabel(c1.innerText || c1.textContent || '');
                if (!isValidLabel(t)) continue;

                var v = normText(c2.innerText || c2.textContent || '');
                if (isValidValue(v)) {
                    if (!dict[t]) dict[t] = v;
                }
            }
        }
    }

    // ===== 基本信息详情页：只在 .plate-wrap.base-info-point 板块内扫描 =====
    function buildBasicDetailDict() {
        var dict = {};
        var scopes = [];
        var scopeLabels = [];

        // ====== 【关键前置验证】：确认当前页面确实是项目详情页 ======
        // 注意：项目详情页里也可能出现建设单位的一些企业属性（如建设单位名、法人），所以门槛要放得很宽
        // 只有"大量企业特征词 + 极少项目特征词"才判定为企业页
        var bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        var enterpriseSignals = 0;
        ['处罚文件编号', '处罚机关', '处罚文号', '行政处罚决定书', '工商信息', '营业执照号码', '统一社会信用代码', '成立日期', '营业期限', '注册资本', '注册类型', '登记机关'].forEach(function (kw) {
            if (bodyText.indexOf(kw) !== -1) enterpriseSignals++;
        });
        // 只有明显的企业页词汇才算（上面是严格的企业页词，下面的"法定代表人"等在项目页也可能出现，不算入）
        var projectSignals = 0;
        ['组织机构代码', '立项文号', '立项批复', '立项级别', '建设性质', '工程用途', '计划开工', '计划竣工', '总投资（万元）', '建设规模'].forEach(function (kw) {
            if (bodyText.indexOf(kw) !== -1) projectSignals++;
        });
        // 放宽：企业信号≥7 且 项目信号≤0 才认为是纯企业页（宁放过不杀错）
        if (enterpriseSignals >= 7 && projectSignals <= 0) {
            console.warn('[basic-detail] ⚠️ 识别为企业/单位详情页（企业特征=' + enterpriseSignals + ', 项目特征=' + projectSignals + '），跳过提取以避免乱匹配');
            return dict;
        }
        console.log('[basic-detail] 页面特征: 企业信号=' + enterpriseSignals + ', 项目信号=' + projectSignals);

        // 策略1：精确定位 class 为 base-info-point 的板块
        var basePlate = document.querySelector('.plate-wrap.base-info-point, .base-info-point');
        if (basePlate) {
            scopes.push(basePlate);
            scopeLabels.push('base-info-point class');
        }

        // 策略2：找 plate-top 标题包含"基本信息"的板块
        if (scopes.length === 0) {
            var plates = document.querySelectorAll('.plate-wrap');
            for (var i = 0; i < plates.length; i++) {
                var titleH = plates[i].querySelector('.plate-top .title, .plate-top h2, .plate-title');
                if (titleH) {
                    var txt = normText(titleH.innerText || titleH.textContent || '');
                    if (txt === '基本信息' || txt.indexOf('基本信息') !== -1) {
                        scopes.push(plates[i]);
                        scopeLabels.push('标题匹配: ' + txt);
                        break;
                    }
                }
            }
        }

        // 策略3：通过常见项目关键词（如"组织机构代码"、"立项文号"）反向定位父板块
        if (scopes.length === 0) {
            var keywords = ['组织机构代码', '立项文号', '项目所在地', '总投资', '建设规模', '建设性质', '工程用途', '立项批复机关'];
            for (var ki = 0; ki < keywords.length; ki++) {
                var xpath = "//*[contains(text(),'" + keywords[ki] + "')]";
                var found = null;
                try {
                    var iter = document.evaluate(xpath, document, null, XPathResult.ANY_TYPE, null);
                    found = iter.iterateNext();
                } catch (e) {}
                if (found) {
                    var p = found;
                    for (var depth = 0; depth < 12 && p; depth++) {
                        if (p.className && String(p.className).match(/plate|wrap|content|info|detail/i)) {
                            scopes.push(p);
                            scopeLabels.push('关键词反向定位: ' + keywords[ki] + ' -> ' + String(p.className).slice(0, 60));
                            break;
                        }
                        p = p.parentElement;
                    }
                    if (scopes.length > 0) break;
                }
            }
        }

        // 策略4：找第一个 .plate-content / .info-content / .detail-content 容器
        if (scopes.length === 0) {
            var contentBox = document.querySelector('.plate-content, .info-content, .detail-content, .project-detail');
            if (contentBox) {
                scopes.push(contentBox);
                scopeLabels.push('通用content容器: ' + String(contentBox.className).slice(0, 80));
            }
        }

        // 最终 fallback：整个文档（这时会非常严格，不做宽松扫描）
        var isFallbackScope = scopes.length === 0;
        if (isFallbackScope) {
            scopes.push(document);
            scopeLabels.push('FALLBACK: 整个文档（将严格扫描）');
        }

        console.log('[basic-detail] 使用的作用域:', scopeLabels);

        // 按优先级执行精确扫描策略（所有作用域都跑）
        for (var s = 0; s < scopes.length; s++) {
            // 1) 最精确：.row-item 结构
            scanRowItems(scopes[s], dict);
            // 2) td.label 表格
            scanTdLabelTable(scopes[s], dict);
            // 3) 通用表格（只有明确找到 base-info-point 板块时才用，避免 fallback 时扫到企业表格）
            if (!isFallbackScope) scanGenericTable(scopes[s], dict);
            // 4) dl/dt/dd 定义列表
            if (!isFallbackScope) scanDefinitionList(scopes[s], dict);
        }

        // 如果在明确的基本信息板块里，提取字段仍然 < 5，补充通用扫描
        if (!isFallbackScope && Object.keys(dict).length < 5) {
            console.log('[basic-detail] 精确作用域提取字段太少(<5)，补充宽松扫描');
            for (var s2 = 0; s2 < scopes.length; s2++) {
                scanGenericTable(scopes[s2], dict);
                scanDefinitionList(scopes[s2], dict);
            }
        }

        // 【非常重要】：绝对禁止 document 全局的通用宽松扫描（避免扫到企业信息、处罚信息等不相关板块）
        // 仅当 dict 为空 + 确定有项目特征时才尝试全局扫描
        if (Object.keys(dict).length === 0 && projectSignals >= 2) {
            console.log('[basic-detail] 字段数为0但有项目特征，谨慎做一次全局精确扫描');
            scanTdLabelTable(document, dict);
        }

        console.log('[basic-detail] 最终字段字典 (共' + Object.keys(dict).length + '个字段):', dict);
        return dict;
    }

    // ===== 施工许可详情页：全文档扫描（和 basic 一样，因为 lookupField 有严格过滤，不会错） =====
    function buildPermitDetailDict() {
        var dict = {};
        // 1) 先尝试：如果页面有"电子证书"右侧的信息区域，优先扫那里（保证字段顺序/正确性最优）
        var scopes = [];
        var scopeLabels = [];
        // 常见的详情信息块容器
        var selectors = [
            '.certificate-detail-wrap', '.certificate-info',
            '.info-block', '.info-wrap',
            '.plate-wrap', '.detail-wrap', '.content-block'
        ];
        for (var si = 0; si < selectors.length; si++) {
            try {
                var el = document.querySelector(selectors[si]);
                if (el) { scopes.push(el); scopeLabels.push(selectors[si]); }
            } catch (e) {}
        }
        // 2) 加上 document 兜底（最后一个）
        scopes.push(document);
        scopeLabels.push('document(兜底)');

        console.log('[permit-detail] 使用的作用域:', scopeLabels);
        for (var s = 0; s < scopes.length; s++) {
            scanRowItems(scopes[s], dict);
            scanTdLabelTable(scopes[s], dict);
            scanGenericTable(scopes[s], dict);
            scanDefinitionList(scopes[s], dict);
            scanGenericLabelValue(scopes[s], dict);
        }

        // 3) 额外扫一遍所有 td.label（右侧信息表很多是 label-value 的 td 组合）
        try {
            var allTds = document.querySelectorAll('td');
            for (var ti = 0; ti < allTds.length; ti++) {
                var lt0 = normLabel(allTds[ti].innerText || allTds[ti].textContent || '');
                if (lt0 === '备注' && (!dict['备注'] || dict['备注'] === '')) {
                    var nx = allTds[ti].nextElementSibling;
                    while (nx && nx.tagName === 'TD') {
                        var rv0 = normText(nx.innerText || nx.textContent || '');
                        if (isValidValue(rv0)) { dict['备注'] = rv0; break; }
                        nx = nx.nextElementSibling;
                    }
                }
                // td 本身就是 label 的情况（第一列 label，第二列 value，colspan 拆分情况）
                if (isValidLabel(lt0) && lt0.length <= 15) {
                    var nextTd = allTds[ti].nextElementSibling;
                    if (nextTd && nextTd.tagName === 'TD') {
                        var vv = normText(nextTd.innerText || nextTd.textContent || '');
                        if (isValidValue(vv) && !dict[lt0]) {
                            // 不能是 label 类的文本（长度<15的话就作为候选，但要避免把下一行的 label 当 value）
                            if (vv.length >= 1 || lt0.length >= 2) dict[lt0] = vv;
                        }
                        // 跨两列的情况：比如「建设规模 / 合同价格」两个 label 在同一行，紧跟两个 value
                        var nextNextTd = nextTd.nextElementSibling;
                        if (nextNextTd && nextNextTd.tagName === 'TD') {
                            var lt1 = normLabel(nextTd.innerText || nextTd.textContent || '');
                            if (isValidLabel(lt1) && lt1.length <= 15) {
                                var vv1 = normText(nextNextTd.innerText || nextNextTd.textContent || '');
                                if (isValidValue(vv1) && !dict[lt1]) dict[lt1] = vv1;
                            }
                        }
                    }
                }
            }
        } catch (e) {}

        console.log('[permit-detail] 最终字段字典 (共' + Object.keys(dict).length + '个字段):', dict);
        return dict;
    }

    // ===== 竣工验收备案详情页（通用版） =====
    function buildCompleteDetailDict() {
        var dict = {};
        var scopes = [];
        var scopeLabels = [];
        var plates = document.querySelectorAll('.plate-wrap');
        for (var i = 0; i < plates.length; i++) {
            var titleH = plates[i].querySelector('.plate-top .title, .plate-top h2, .plate-title');
            if (titleH) {
                var txt = normText(titleH.innerText || titleH.textContent || '');
                if (txt.indexOf('基本信息') !== -1 || txt.indexOf('备案') !== -1) {
                    scopes.push(plates[i]);
                    scopeLabels.push('标题匹配: ' + txt);
                }
            }
        }
        if (scopes.length === 0) { scopes.push(document); scopeLabels.push('FALLBACK'); }
        console.log('[complete-detail] 使用的作用域:', scopeLabels);

        for (var s = 0; s < scopes.length; s++) {
            scanRowItems(scopes[s], dict);
            scanTdLabelTable(scopes[s], dict);
            scanGenericTable(scopes[s], dict);
            scanDefinitionList(scopes[s], dict);
        }

        if (Object.keys(dict).length < 5) {
            scanGenericTable(document, dict);
            scanGenericLabelValue(document, dict);
        }

        console.log('[complete-detail] 最终字段字典 (共' + Object.keys(dict).length + '个字段):', dict);
        return dict;
    }

    // 从字典中按字段名+别名查找（精确优先，别名其次）
    function lookupField(dict, field, aliases) {
        if (!dict) return '';
        var key = normLabel(field);
        var allKeys = Object.keys(dict);

        // 1. 精确匹配字典 label
        if (dict[key]) return dict[key];

        // 2. 精确匹配别名
        if (aliases && aliases.length > 0) {
            for (var a = 0; a < aliases.length; a++) {
                var alias = normLabel(aliases[a]);
                if (dict[alias]) return dict[alias];
            }
        }

        // 3. 严格的包含匹配：必须"主字段名完全被包含"或"label 完全被包含在 key 里"
        //    且 label 必须是纯字段名，不能包含多余的无关词（如"分类""角色"等就是错配信号）
        // 注意：只排除"分类/角色/处罚"这几个极容易把"项目名称 → 项目分类"的情况，"企业/注册/法人"不要排除（因为建设单位会有这些词）
        var badKeywords = ['分类', '角色', '处罚', '行政区划', '行业类别', '管理类型'];
        for (var ki = 0; ki < allKeys.length; ki++) {
            var k = allKeys[ki];
            if (k === key) return dict[k];

            // 快速排除：label 里有"处罚/分类/角色"这些明显不是项目详情字段的词，跳过
            var hasBad = false;
            for (var bi = 0; bi < badKeywords.length; bi++) {
                if (k.indexOf(badKeywords[bi]) !== -1) { hasBad = true; break; }
            }
            if (hasBad) continue;

            // 互相包含，长度差放宽到 10（比如"总投资"匹配"总投资（万元）"）
            if ((k.indexOf(key) !== -1 || key.indexOf(k) !== -1) && Math.abs(k.length - key.length) < 10) {
                // 额外校验：如果 value 太长且包含多个空格分隔的短语，很可能是扫错了相邻的 label
                var val = dict[k];
                if (typeof val === 'string' && val.length > 80) continue; // 放宽到 80 字符
                return dict[k];
            }
        }

        // 4. 别名严格匹配
        if (aliases && aliases.length > 0) {
            for (var a2 = 0; a2 < aliases.length; a2++) {
                var al2 = normLabel(aliases[a2]);
                if (dict[al2]) return dict[al2];
                for (var ki2 = 0; ki2 < allKeys.length; ki2++) {
                    var kk = allKeys[ki2];
                    var hasBad2 = false;
                    for (var bi2 = 0; bi2 < badKeywords.length; bi2++) {
                        if (kk.indexOf(badKeywords[bi2]) !== -1) { hasBad2 = true; break; }
                    }
                    if (hasBad2) continue;
                    if ((kk.indexOf(al2) !== -1 || al2.indexOf(kk) !== -1) && Math.abs(kk.length - al2.length) < 8) {
                        var val2 = dict[kk];
                        if (typeof val2 === 'string' && val2.length > 60) continue;
                        return dict[kk];
                    }
                }
            }
        }

        // 5. 模糊公共汉字匹配（只做最后兜底，并严格控制）
        var bestMatch = null;
        var bestScore = 0;
        // 公共汉字 >= 字段长度的 75% 才考虑（更严格）
        var minCommon = Math.max(3, Math.ceil(key.length * 0.75));
        for (var ki3 = 0; ki3 < allKeys.length; ki3++) {
            var k3 = allKeys[ki3];
            // 跳过有坏词的 label
            var hasBad3 = false;
            for (var bi3 = 0; bi3 < badKeywords.length; bi3++) {
                if (k3.indexOf(badKeywords[bi3]) !== -1) { hasBad3 = true; break; }
            }
            if (hasBad3) continue;
            // 公共汉字匹配
            var sc = _commonChars(key, k3);
            if (sc >= minCommon && sc > bestScore) {
                bestScore = sc;
                bestMatch = k3;
            }
        }
        if (bestMatch) {
            var val3 = dict[bestMatch];
            if (!(typeof val3 === 'string' && val3.length > 60)) {
                return dict[bestMatch];
            }
        }

        return '';
    }

    function extractBasicDetail() {
        var dict = buildBasicDetailDict();

        var fieldMap = {
            '项目名称': ['项目'],
            '建设单位': ['建设单位名称', '单位名称', '单位'],
            '省级项目编号': ['项目编号', '项目编码'],
            '组织机构代码': ['组织代码', '机构代码', '统一社会信用代码'],
            '项目分类': ['项目分类', '分类', '项目类别', '类别'],
            // ✅ 所在市：只匹配市一级的单字段别名（用户明确：列表里就能找到的单列数据）
            '所在市': ['所在市', '城市', '市', '所属市'],
            // ✅ 项目所在地：匹配省+市+区 或 「所在地区/所属地区」这种组合字段（详情页才有，需要拼接）
            '项目所在地': ['所在地', '所在地区', '所属地区', '建设地点'],
            '详细地址': ['地址', '项目地址', '工程地址'],
            '立项文号': ['立项批文号', '批准文号', '批文号'],
            '立项级别': ['立项等级', '项目级别', '项目等级'],
            '立项批复机关': ['立项批准机关', '批复机关', '批准机关', '审批机关'],
            '立项批复时间': ['立项批准时间', '批复时间', '批准时间', '审批时间'],
            '总投资（万元）': ['总投资', '总投资(万元)', '投资金额', '投资额', '总投资额'],
            '总面积/长度（平方米/米）': ['总面积', '建筑面积', '总面积(平方米)', '面积', '总建筑面积'],
            '建设规模': ['规模'],
            '建设性质': ['性质'],
            '工程用途': ['用途'],
            '计划开工日期': ['计划开工时间', '计划开工', '开工日期', '开工时间'],
            '数据等级': ['等级']
        };

        var result = {};
        var debugMatch = {};
        var names = Object.keys(fieldMap);
        for (var f = 0; f < names.length; f++) {
            var field = names[f];
            var val = lookupField(dict, field, fieldMap[field]);
            if (val) {
                result[field] = val;
                debugMatch[field] = val;
            } else {
                debugMatch[field] = '[未匹配]';
            }
        }
        console.log('[basic-detail] 字段匹配结果:', debugMatch);
        console.log('[basic-detail] 最终输出(' + Object.keys(result).length + '/' + names.length + '字段):', result);
        return result;
    }

    function extractPermitDetail() {
        var dict = buildPermitDetailDict();

        var fieldMap = {
            '施工许可证编号': ['许可证编号', '证书编号', '证号', '许可证号', '编号'],
            '工程名称': ['工程名称', '项目名称', '项目', '工程'],
            '省级项目编号': ['项目编号', '项目编码'],
            '建设单位': ['建设单位名称', '单位名称'],
            '建设地址': ['地址', '建设地点', '工程地址', '项目地址'],
            '建设规模': ['规模'],
            '合同价格': ['合同金额', '工程造价', '造价', '价格', '合同价款'],
            '工程总承包单位': ['工程总承包', '总承包单位', '总包单位', '总承包'],
            '勘察单位': ['勘察'],
            '设计单位': ['设计'],
            '施工单位': ['施工', '施工总承包单位'],
            '监理单位': ['监理'],
            '建设单位项目负责人': ['建设单位负责人', '建设单位项目负责人', '甲方负责人'],
            '工程总承包项目经理': ['总承包项目经理', '总包项目经理', 'EPC项目经理'],
            '勘察单位项目负责人': ['勘察项目负责人', '勘察负责人'],
            '设计单位项目负责人': ['设计项目负责人', '设计负责人'],
            '施工单位项目负责人': ['施工项目经理', '项目经理', '施工负责人'],
            '总监理工程师': ['总监', '总监理', '监理工程师'],
            '合同工期': ['工期', '施工工期'],
            '状态': ['当前状态', '项目状态', '证书状态'],
            '备注': [],
            '发证机关': ['发证机构', '发证部门'],
            '数据等级': ['等级']
        };

        var result = {};
        var debugMatch = {};
        var names = Object.keys(fieldMap);
        for (var f = 0; f < names.length; f++) {
            var field = names[f];
            var val = lookupField(dict, field, fieldMap[field]);
            if (val) {
                result[field] = val;
                debugMatch[field] = val;
            } else {
                debugMatch[field] = '[未匹配]';
            }
        }
        console.log('[permit-detail] 字段匹配结果:', debugMatch);
        console.log('[permit-detail] 最终输出(' + Object.keys(result).length + '/' + names.length + '字段):', result);
        return result;
    }

    function extractCompleteDetail() {
        var dict = buildCompleteDetailDict();
        var fieldMap = {
            // 🔴✅ 用户要求：详情页里的「竣工验收备案编号」→ 存为「竣工验收备案编号」（普通的备案编号）
            '竣工验收备案编号': ['备案编号', '验收备案编号', '省级竣工验收备案编号'],
            '备案机关': ['备案单位', '备案部门', '竣工验收备案机关', '备案机关名称'],
            '结构体系': ['结构'],
            '实际造价（万元）': ['实际造价', '造价', '实际金额', '结算造价', '决算造价'],
            '实际面积（平方米）': ['实际面积', '面积', '建筑面积', '实际建筑面积'],
            '实际开工日期': ['实际开工', '开工日期', '开工时间'],
            '实际竣工日期': ['实际竣工', '竣工日期', '竣工时间', '竣工验收日期', '验收日期'],
            '数据等级': ['等级'],
            '省级项目编号': ['项目编号', '项目编码']
        };
        var data = {};
        var debugMatch = {};
        var names = Object.keys(fieldMap);
        for (var f = 0; f < names.length; f++) {
            var field = names[f];
            var val = lookupField(dict, field, fieldMap[field]);
            if (val) {
                data[field] = val;
                debugMatch[field] = val;
            } else {
                debugMatch[field] = '[未匹配]';
            }
        }
        console.log('[complete-detail] 字段匹配结果:', debugMatch);
        console.log('[complete-detail] 最终输出(' + Object.keys(data).length + '/' + names.length + '字段):', data);
        return data;
    }

    // ===== 翻页功能 =====

    function goToPage(page, callback) {
        var targetPage = Number(page) || 1;
        if (targetPage <= 0) { callback && callback(true); return true; }

        var current = getCurrentPage();
        if (current === targetPage) {
            callback && callback(true);
            return true;
        }

        if (tryClickPageButton(targetPage)) {
            setTimeout(function () { callback && callback(true); }, 1200);
            return true;
        }

        if (tryUsePageInput(targetPage)) {
            setTimeout(function () { callback && callback(true); }, 1200);
            return true;
        }

        // 尝试连续翻页
        var steps = targetPage - (current || 1);
        var direction = steps > 0 ? 1 : -1;
        var remaining = Math.abs(steps);
        var stepFn = function () {
            if (remaining <= 0) { callback && callback(true); return; }
            if (tryClickNext(direction)) {
                remaining--;
                setTimeout(stepFn, 1000);
            } else {
                callback && callback(false);
            }
        };
        stepFn();
        return true;
    }

    function getCurrentPage() {
        var active = document.querySelector('.ant-pagination-item-active, .el-pagination .number.active');
        if (active) {
            var txt = (active.innerText || active.textContent || '').trim();
            var num = parseInt(txt);
            if (!isNaN(num)) return num;
        }
        var input = document.querySelector('.ant-pagination input, .el-pagination input');
        if (input && input.value) {
            var num2 = parseInt(input.value);
            if (!isNaN(num2)) return num2;
        }
        return 1;
    }

    function tryClickPageButton(page) {
        var btns = document.querySelectorAll('.ant-pagination-item, .el-pagination .number, [class*="pagination"] button');
        for (var i = 0; i < btns.length; i++) {
            var txt = (btns[i].innerText || btns[i].textContent || '').trim();
            if (txt === String(page)) {
                try { btns[i].click(); return true; } catch (e) { return false; }
            }
        }
        return false;
    }

    function tryUsePageInput(page) {
        var input = document.querySelector('.ant-pagination input, .el-pagination input');
        if (input) {
            input.focus();
            input.value = String(page);
            try {
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                // 查找"跳转"或"确定"按钮
                var btns = document.querySelectorAll('.ant-pagination button, .el-pagination button, .ant-pagination button, [class*="pagination"] button');
                for (var i = 0; i < btns.length; i++) {
                    var txt = (btns[i].innerText || btns[i].textContent || '').trim();
                    if (txt.indexOf('跳转') !== -1 || txt.indexOf('确定') !== -1 || txt.indexOf('Go') !== -1) {
                        btns[i].click();
                        return true;
                    }
                }
                // 尝试回车
                try {
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
                } catch (e) {}
                return true;
            } catch (e) { return false; }
        }
        return false;
    }

    function tryClickNext(direction) {
        // direction: 1 = next, -1 = prev
        var nextBtn = null;
        if (direction > 0) {
            nextBtn = document.querySelector('.ant-pagination-next, .el-pagination .el-pagination__next, .el-pagination .btn-next');
        } else {
            nextBtn = document.querySelector('.ant-pagination-prev, .el-pagination .el-pagination__prev, .el-pagination .btn-prev');
        }
        if (nextBtn && !nextBtn.classList.contains('ant-pagination-disabled') && !nextBtn.classList.contains('disabled')) {
            try { nextBtn.click(); return true; } catch (e) { return false; }
        }
        return false;
    }

    // ====== 🔴✅ 竣工验收备案：点行→等弹窗→提取基本信息→关弹窗（核心！）======
    function _getCompleteModalRoot() {
        // 🔴✅ 注意：querySelectorAll 不支持 :visible 伪类、不支持 [style*="xx"] 外层 :not() 通配！会直接抛 SyntaxError！
        // 所以改成 "宽松选择所有候选 → 原生 DOM 属性过滤（offsetWidth / getComputedStyle）"
        try {
            var selectors = [
                '.el-dialog',
                '.ant-modal',
                '.ant-modal-root .ant-modal-wrap',
                '[role="dialog"]',
                '.el-drawer',
                '.modal',
                '.dialog'
            ];
            var all = [];
            for (var s = 0; s < selectors.length; s++) {
                try {
                    var nl = document.querySelectorAll(selectors[s]);
                    for (var ni = 0; ni < nl.length; ni++) all.push(nl[ni]);
                } catch (ee) { /* ignore */ }
            }
            for (var i = 0; i < all.length; i++) {
                var el = all[i];
                if (!el) continue;
                // 可见性判定（原生方式！）
                if (el.offsetWidth === 0 && el.offsetHeight === 0) continue; // 不可见
                try {
                    if (el.hasAttribute && el.hasAttribute('aria-hidden') && String(el.getAttribute('aria-hidden')) === 'true') continue;
                    var cs = window.getComputedStyle(el);
                    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
                } catch (ee) {}
                // 内容必须有关键词
                var txt = (el.innerText || el.textContent || '').slice(0, 500);
                if (txt.indexOf('基本信息') !== -1) return el;
                if (txt.indexOf('竣工验收备案编号') !== -1) return el;
                if (txt.indexOf('省级竣工验收备案编号') !== -1) return el;
                if (txt.indexOf('实际造价') !== -1 && txt.indexOf('结构体系') !== -1) return el;
            }
            // 兜底：直接找包含基本信息标题的父元素
            try {
                var titles = document.querySelectorAll('div, span, h3, h4, h5, h6');
                for (var j = 0; j < titles.length; j++) {
                    var t = titles[j];
                    var tv = getCellText(t);
                    if (tv === '基本信息' || tv === '基本信息：') {
                        var root = t;
                        for (var up = 0; up < 10 && root && root.parentNode; up++) {
                            root = root.parentNode;
                            if (root && root.querySelector) {
                                var w = (root.innerText || '').length;
                                if (w > 200 && w < 8000) {
                                    try {
                                        var cs = window.getComputedStyle(root);
                                        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
                                    } catch (ee) {}
                                    return root;
                                }
                            }
                        }
                    }
                }
            } catch (ee) {}
        } catch (bigE) { console.error('[content] _getCompleteModalRoot 异常:', bigE); }
        return null;
    }

    function _closeCompleteModal(modalRoot) {
        try {
            var closeBtn = null;
            var closeSelectors = [
                '.el-dialog__headerbtn', '.el-dialog__close',
                '.ant-modal-close', '.ant-modal-close-x',
                '[aria-label="Close"]', '[aria-label="关闭"]',
                '.close', '.btn-close', 'button.close'
            ];
            if (modalRoot && modalRoot.querySelector) {
                for (var si = 0; si < closeSelectors.length; si++) {
                    try {
                        var cb = modalRoot.querySelector(closeSelectors[si]);
                        if (cb) { closeBtn = cb; break; }
                    } catch (ee) {}
                }
            }
            if (closeBtn) {
                try { closeBtn.click(); return true; } catch (e) {}
                try {
                    var ev = document.createEvent('MouseEvents');
                    ev.initEvent('click', true, true);
                    closeBtn.dispatchEvent(ev);
                    return true;
                } catch (e) {}
            }
            // 兜底：蒙层点击（或按 ESC）
            try {
                var overlays = document.querySelectorAll('.el-overlay, .v-modal, .ant-modal-mask, .modal-backdrop, .el-dialog__wrapper, .ant-modal-wrap');
                for (var k = 0; k < overlays.length; k++) {
                    var ov = overlays[k];
                    if (!ov) continue;
                    try {
                        var evd = document.createEvent('MouseEvents');
                        evd.initEvent('mousedown', true, true);
                        ov.dispatchEvent(evd);
                        var ev2 = document.createEvent('MouseEvents');
                        ev2.initEvent('click', true, true);
                        ov.dispatchEvent(ev2);
                        return true;
                    } catch (e) {}
                }
                // 按 ESC
                try {
                    var evk = document.createEvent('KeyboardEvent');
                    if (evk.initKeyboardEvent) {
                        evk.initKeyboardEvent('keydown', true, true, window, false, false, false, false, 27, 0);
                    } else {
                        evk.initEvent('keydown', true, true);
                        evk.keyCode = 27; evk.which = 27; evk.key = 'Escape';
                    }
                    document.dispatchEvent(evk);
                    var evk2 = document.createEvent('KeyboardEvent');
                    if (evk2.initKeyboardEvent) {
                        evk2.initKeyboardEvent('keyup', true, true, window, false, false, false, false, 27, 0);
                    } else {
                        evk2.initEvent('keyup', true, true);
                        evk2.keyCode = 27; evk2.which = 27; evk2.key = 'Escape';
                    }
                    document.dispatchEvent(evk2);
                    return true;
                } catch (e) {}
            } catch (e) {}
            return false;
        } catch (e) { return false; }
    }

    function _extractCompleteBasicFromModal(modalRoot) {
        var result = {};
        try {
            if (!modalRoot) return result;
            var root = modalRoot;

            // ========== 方式一：直接遍历字段名（用户给的精确红框字段名） ==========
            var fieldMap = [
                { keys: ['省级竣工验收备案编号'], out: '省级竣工验收备案编号' },
                { keys: ['竣工验收备案编号'], out: '竣工验收备案编号' },
                { keys: ['备案机关'], out: '备案机关' },
                { keys: ['结构体系'], out: '结构体系' },
                // 🔴✅ 实际造价：疯狂扩充所有可能的 label 写法！
                {
                    keys: ['实际造价', '实际造价（万元）', '实际造价(万元)', '实际造价 万元',
                        '工程总造价', '工程总造价（万元）', '工程总造价(万元)',
                        '总造价', '总造价（万元）', '总造价(万元)',
                        '竣工造价', '竣工总造价', '结算造价', '结算总造价',
                        '合同造价', '合同实际造价', '实际总造价', '工程实际造价'],
                    out: '实际造价（万元）',
                    numOnly: true,
                    unit: '万元'
                },
                {
                    keys: ['实际面积', '实际面积（平方米）', '实际面积(平方米)', '实际面积 ㎡', '实际面积 m²', '实际建筑面积', '建筑面积', '总建筑面积'],
                    out: '实际面积（平方米）',
                    numOnly: true,
                    unit: '平方米'
                },
                { keys: ['实际开工日期'], out: '实际开工日期' },
                { keys: ['实际竣工日期'], out: '实际竣工日期' },
                { keys: ['数据等级', '等级', '分级'], out: '数据等级' }
            ];

            // 🔴✅ 从一个文本里用正则提取数字（只取第一个像数字的）
            function pickNumberFromText(txt) {
                if (!txt) return '';
                var s = String(txt).replace(/[,，]/g, '');
                // 1. 纯数字（含小数点），或 数字 + 万/元/m2/㎡ 等
                var m1 = s.match(/(\d+(?:\.\d+)?)/);
                if (m1) {
                    var num = parseFloat(m1[1]);
                    if (!isNaN(num) && num >= 0) return m1[1];
                }
                // 2. 中文数字？（一般不会，略）
                return '';
            }
            // 🔴✅ 从文本里提取日期
            function pickDateFromText(txt) {
                if (!txt) return '';
                var s = String(txt);
                var md = s.match(/\d{4}[-\/年]\d{1,2}[-\/月]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?/);
                if (md) return md[0].replace(/[年月]/g, '-').replace(/日/g, '').trim();
                return '';
            }

            // DOM 所有可见文本节点 + 标签
            function walkAllLabelValuePairs(rootEl) {
                var allPairs = [];
                if (!rootEl || !rootEl.querySelectorAll) return allPairs;

                // 常见 UI 卡片式布局：标题(深色/粗体)在上，值在下，同一父容器里前后配对
                var allEls = rootEl.querySelectorAll('div, span, td, th, p, li');
                var arr = [];
                for (var ie = 0; ie < allEls.length; ie++) {
                    var e = allEls[ie];
                    if (!e || e.offsetWidth === 0) continue;
                    var childrenEls = e.querySelectorAll ? e.querySelectorAll('*') : [];
                    if (childrenEls.length > 12) continue;
                    var txt = getCellText(e);
                    if (!txt || txt.length > 120) continue;
                    arr.push({ el: e, txt: txt });
                }

                // 🔴✅ 新增：单个文本块 label+value 在一起！如「实际造价（万元）850.23 万元」或「实际造价：1200.50」
                for (var ib = 0; ib < arr.length; ib++) {
                    var blockTxt = arr[ib].txt;
                    if (!blockTxt || blockTxt.length < 4) continue;
                    for (var ifmB = 0; ifmB < fieldMap.length; ifmB++) {
                        var fdB = fieldMap[ifmB];
                        for (var ikB = 0; ikB < fdB.keys.length; ikB++) {
                            var k = fdB.keys[ikB];
                            if (!k || blockTxt.indexOf(k) === -1) continue;
                            // 1. 排除「刚好等于 key 本身」（会在后面滑动窗口配对，不抢）
                            var tClean = blockTxt.replace(/[:：]$/, '').trim();
                            if (tClean === k || tClean === (k + '：') || tClean === (k + ':')) continue;
                            // 2. 切出 key 后面的内容
                            var afterKey = blockTxt.slice(blockTxt.indexOf(k) + k.length);
                            afterKey = afterKey.replace(/^[\s:：\t]+/, '').trim();
                            if (!afterKey || afterKey.length < 1) continue;
                            // 3. 按长度/格式取
                            var val = '';
                            if (fdB.numOnly) {
                                val = pickNumberFromText(afterKey);
                            } else if (fdB.out.indexOf('日期') !== -1) {
                                val = pickDateFromText(afterKey);
                                if (!val) val = afterKey.split(/[\n\r\t]/)[0].trim().slice(0, 30);
                            } else {
                                // 其他字段：取下一个 field key 之前的内容
                                var nextKeyIdx = 9999999;
                                for (var jn = 0; jn < fieldMap.length; jn++) {
                                    for (var kn = 0; kn < fieldMap[jn].keys.length; kn++) {
                                        if (fieldMap[jn].keys[kn] === k) continue;
                                        var oi = afterKey.indexOf(fieldMap[jn].keys[kn]);
                                        if (oi > 0 && oi < nextKeyIdx) nextKeyIdx = oi;
                                    }
                                }
                                var seg = afterKey.slice(0, Math.min(nextKeyIdx, afterKey.length));
                                val = seg.split(/[\n\r\t]/)[0].trim().slice(0, 80);
                            }
                            if (val) {
                                allPairs.push({ labelKey: fdB.out, value: val, _from: 'single-block(' + k + ')' });
                            }
                            break;
                        }
                    }
                }

                // 文本出现顺序滑动配对：标签 → 后面紧跟的值（窗口扩大到 16 个元素）
                for (var ip = 0; ip < arr.length; ip++) {
                    var pLabel = arr[ip].txt;
                    var pLabelClean = pLabel ? pLabel.replace(/[:：]$/, '').trim() : '';
                    // 如果该文本疑似标签（命中关键词列表），就找它后面的值
                    for (var ifm = 0; ifm < fieldMap.length; ifm++) {
                        var fd = fieldMap[ifm];
                        var matchedKey = null;
                        for (var ik = 0; ik < fd.keys.length; ik++) {
                            var kk = fd.keys[ik];
                            // 🔴✅ 匹配：1）严格相等 2）clean 后相等 3）key >= 3字时，pLabel 包含 key（防止"实际造价 万元"和"实际造价"匹配不上）
                            if (pLabel === kk || pLabelClean === kk || pLabel === (kk + '：') || pLabel === (kk + ':')) {
                                matchedKey = kk; break;
                            }
                            if (!matchedKey && kk.length >= 4) {
                                var plSub = pLabelClean;
                                if (plSub && plSub.indexOf(kk) !== -1 && plSub.length <= kk.length + 6) {
                                    matchedKey = kk; break;
                                }
                            }
                        }
                        if (matchedKey) {
                            // 找接下来的 1~16 个中"不像标签"的文本（候选值）
                            var foundVal = null;
                            for (var step = 1; step <= 16 && ip + step < arr.length; step++) {
                                var candVal = arr[ip + step].txt;
                                if (!candVal || candVal.length > 160) continue;
                                // 不能是另一个字段名
                                var isAnotherLabel = false;
                                for (var jf = 0; jf < fieldMap.length; jf++) {
                                    for (var jk = 0; jk < fieldMap[jf].keys.length; jk++) {
                                        var jkc = fieldMap[jf].keys[jk];
                                        if (candVal === jkc || candVal.replace(/[:：]$/, '').trim() === jkc) {
                                            isAnotherLabel = true; break;
                                        }
                                    }
                                    if (isAnotherLabel) break;
                                }
                                if (isAnotherLabel) break; // 到下一个标签了，停
                                if (candVal && candVal !== pLabel && candVal !== matchedKey) {
                                    // 🔴✅ 按字段类型 clean 一下 value
                                    var finalVal = candVal;
                                    if (fd.numOnly) {
                                        var n = pickNumberFromText(candVal);
                                        if (!n) continue; // 这个值不是数字，跳过（可能是装饰文本），继续找下一个 step
                                        finalVal = n;
                                    } else if (fd.out.indexOf('日期') !== -1) {
                                        var d = pickDateFromText(candVal);
                                        if (d) finalVal = d;
                                    }
                                    foundVal = finalVal;
                                    break;
                                }
                            }
                            if (foundVal) {
                                allPairs.push({ labelKey: fd.out, value: foundVal, _from: 'slide-step-key=' + matchedKey });
                            }
                            break;
                        }
                    }
                }

                // 另外：表格布局（一行两列 label/value）
                var trs = rootEl.querySelectorAll('tr');
                for (var itr = 0; itr < trs.length; itr++) {
                    var tcells = trs[itr].querySelectorAll('td, th');
                    if (tcells.length >= 2) {
                        var lbl = getCellText(tcells[0]).replace(/[:：]$/, '').trim();
                        var val = getCellText(tcells[1]).trim();
                        if (lbl && val) {
                            for (var ifm2 = 0; ifm2 < fieldMap.length; ifm2++) {
                                var fd2 = fieldMap[ifm2];
                                for (var ik2 = 0; ik2 < fd2.keys.length; ik2++) {
                                    if (lbl === fd2.keys[ik2] || (fd2.keys[ik2].length >= 4 && lbl.indexOf(fd2.keys[ik2]) !== -1 && lbl.length <= fd2.keys[ik2].length + 6)) {
                                        var finalV2 = val;
                                        if (fd2.numOnly) {
                                            var nn2 = pickNumberFromText(val);
                                            if (!nn2) continue;
                                            finalV2 = nn2;
                                        } else if (fd2.out.indexOf('日期') !== -1) {
                                            var dd2 = pickDateFromText(val);
                                            if (dd2) finalV2 = dd2;
                                        }
                                        allPairs.push({ labelKey: fd2.out, value: finalV2, _from: 'tr-table-key=' + fd2.keys[ik2] });
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                return allPairs;
            }

            var pairs = walkAllLabelValuePairs(root);
            // 🔴✅ 调试：把所有识别到的 label-value 对打出来，方便知道字段名到底是什么！
            console.log('[content] 🔍 竣工验收弹窗所有识别到的 label-value 对（按来源）：',
                pairs.map(function (p) { return p.labelKey + '=' + String(p.value).slice(0, 40) + '  [' + (p._from || '') + ']'; }));

            for (var ipr = 0; ipr < pairs.length; ipr++) {
                var pr = pairs[ipr];
                if (!result[pr.labelKey] && pr.value) {
                    result[pr.labelKey] = pr.value;
                }
            }

            // ========== 方式二：直接精确查「key→val」两元素紧邻的 DOM 结构 ==========
            function findValueByLabel(labelText, opts) {
                opts = opts || {};
                try {
                    // XPath：完全相等的 label
                    var xpath = ".//*[normalize-space(text())='" + labelText + "' or normalize-space(text())='" + labelText + "：' or normalize-space(text())='" + labelText + ":']";
                    var iter = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                    var foundNodes = [];
                    var n;
                    while (n = iter.iterateNext()) foundNodes.push(n);
                    // 🔴✅ fallback：完全相等没找到时，用 contains 模糊找（label 前后可能有其他字符，如"★ 实际造价"）
                    if (foundNodes.length === 0 && labelText.length >= 4) {
                        try {
                            var xpContains = ".//*[contains(normalize-space(text()), '" + labelText + "')]";
                            var iterC = document.evaluate(xpContains, root, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                            while (n = iterC.iterateNext()) {
                                var t = getCellText(n);
                                if (t && t.length <= labelText.length + 8) foundNodes.push(n);
                            }
                        } catch (eC) {}
                    }

                    for (var ni = 0; ni < foundNodes.length; ni++) {
                        var node = foundNodes[ni];
                        // 往上找 4 层的父容器，再往下找"非标题类"的文本作为值
                        var p = node;
                        for (var up = 0; up < 5 && p && p.parentNode; up++) {
                            p = p.parentNode;
                            if (!p || !p.querySelectorAll) continue;
                            var sibs = p.children || [];
                            var foundIdx = -1;
                            for (var ic = 0; ic < sibs.length; ic++) {
                                try { if (sibs[ic].contains(node)) { foundIdx = ic; break; } } catch (eContain) {}
                            }
                            if (foundIdx !== -1) {
                                // 值在同一父节点的后面兄弟（可能隔几个，但最多 12）
                                for (var sb = foundIdx + 1; sb < Math.min(foundIdx + 12, sibs.length); sb++) {
                                    var sv = getCellText(sibs[sb]);
                                    if (!sv || sv === labelText || sv === (labelText + '：')) continue;
                                    var isLabel = false;
                                    for (var ifm3 = 0; ifm3 < fieldMap.length; ifm3++) {
                                        for (var ik3 = 0; ik3 < fieldMap[ifm3].keys.length; ik3++) {
                                            if (sv === fieldMap[ifm3].keys[ik3] || sv === fieldMap[ifm3].keys[ik3] + '：' || sv.replace(/[:：]$/, '').trim() === fieldMap[ifm3].keys[ik3]) {
                                                isLabel = true; break;
                                            }
                                        }
                                        if (isLabel) break;
                                    }
                                    if (isLabel) break;
                                    // 🔴✅ 按 numOnly/dateOnly 处理
                                    var finalSv = sv;
                                    if (opts.numOnly) {
                                        var nn = pickNumberFromText(sv);
                                        if (nn) finalSv = nn; else continue;
                                    } else if (opts.dateOnly) {
                                        var dd = pickDateFromText(sv);
                                        if (dd) finalSv = dd;
                                    }
                                    return finalSv;
                                }
                            }
                            // 或者 node 自己后面 sibling（同一层级）
                            var nextN = node;
                            for (var nxt = 0; nxt < 10; nxt++) {
                                nextN = nextN.nextSibling;
                                if (!nextN) break;
                                var nsv = '';
                                if (nextN.nodeType === 1) nsv = getCellText(nextN);
                                else if (nextN.nodeType === 3 && nextN.nodeValue) nsv = nextN.nodeValue.trim();
                                if (!nsv || nsv === labelText) continue;
                                var finalNsv = nsv;
                                if (opts.numOnly) {
                                    var nn2 = pickNumberFromText(nsv);
                                    if (nn2) finalNsv = nn2; else continue;
                                } else if (opts.dateOnly) {
                                    var dd2 = pickDateFromText(nsv);
                                    if (dd2) finalNsv = dd2;
                                }
                                return finalNsv;
                            }
                        }
                    }
                } catch (e) {}
                return '';
            }

            for (var if0 = 0; if0 < fieldMap.length; if0++) {
                var fdef = fieldMap[if0];
                if (result[fdef.out]) continue; // 前面方式一已经拿到就跳过
                var isDate = fdef.out.indexOf('日期') !== -1;
                for (var ik0 = 0; ik0 < fdef.keys.length; ik0++) {
                    var vv = findValueByLabel(fdef.keys[ik0], { numOnly: !!fdef.numOnly, dateOnly: isDate });
                    if (vv) { result[fdef.out] = vv; break; }
                }
            }

        } catch (bigE) { console.error('[content] _extractCompleteBasicFromModal 异常:', bigE); }
        return result;
    }

    // 🔴 仿真点击：已完全弃用（仅保留空壳函数避免引用报错，永远不会被调用）
    function clickCompleteRowAndExtractModal(rowIndex, locator, cb) {
        try { cb({ success: false, data: {}, error: '仿真点击已弃用', via: 'deprecated' }); }
        catch (ecb) {}
    }
    // 🔴 终极文本兜底：已完全弃用
    function _rescueExtractFromBodyText(loc) { return {}; }

    // =========================================================================
    // ===== 纯接口 fetch 拿 JSON（0 干扰，不弹不跳转）==============
    // =========================================================================
    var API_TEMPLATES = {
        basic:    { method: 'GET',  urlTpl: '/api/openplatform/project/getByPrjCode/{code}',                    paramIn: 'path' },
        permit:   { method: 'GET',  urlTpl: '/api/openplatform/constructionPermit/getByPermitCode/{code}',     paramIn: 'path' },
        complete: { method: 'GET',  urlTpl: '/api/openplatform/projectAcceptanceArchive/get/{code}',           paramIn: 'path' }
    };
    var API_FETCH_HEADERS = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    function _flattenObject(obj, prefix, out) {
        if (out === undefined) out = {};
        if (prefix === undefined) prefix = '';
        if (obj === null || obj === undefined) return out;
        if (typeof obj !== 'object') { out[prefix] = obj; return out; }
        if (Array.isArray(obj)) {
            if (obj.length <= 20) { for (var ai = 0; ai < obj.length; ai++) _flattenObject(obj[ai], prefix ? (prefix + '.' + ai) : String(ai), out); }
            else out[prefix] = obj;
            return out;
        }
        var keys = Object.keys(obj);
        for (var ki = 0; ki < keys.length; ki++) {
            var k = keys[ki];
            var fullKey = prefix ? (prefix + '.' + k) : k;
            try { _flattenObject(obj[k], fullKey, out); } catch (eF) {}
        }
        return out;
    }
    function _normKey(k) {
        if (!k) return '';
        return String(k).toLowerCase()
            .replace(/[_-]/g, '')
            .replace(/\.|\s/g, '');
    }
    function _buildApiReverseIndex(flat) {
        var idx = {};
        var keys = Object.keys(flat);
        for (var ki = 0; ki < keys.length; ki++) {
            var rawKey = keys[ki];
            var val = flat[rawKey];
            if (val === null || val === undefined) continue;
            if (typeof val === 'object') continue;
            var nk = _normKey(rawKey);
            if (!idx[nk]) idx[nk] = { rawKey: rawKey, val: val, fromFull: true };
            var lastDot = rawKey.lastIndexOf('.');
            var shortKey = lastDot !== -1 ? rawKey.slice(lastDot + 1) : rawKey;
            var nsk = _normKey(shortKey);
            if (!idx[nsk]) idx[nsk] = { rawKey: rawKey, val: val, fromShort: true };
        }
        return idx;
    }
    function _pickByKeywords(idx, keywords, cleanValue) {
        for (var ki = 0; ki < keywords.length; ki++) {
            var kw = keywords[ki];
            if (!kw) continue;
            var nkw = _normKey(kw);
            var hit = idx[nkw];
            if (hit && hit.val !== null && hit.val !== undefined && String(hit.val).trim() !== '') {
                var v = hit.val;
                if (cleanValue) {
                    v = String(v).replace(/[\u00a0\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
                    if (v === '-' || v === '—' || v === '/') v = '';
                }
                return v;
            }
        }
        return '';
    }
    function _pickNumberByKeywords(idx, keywords) {
        var v = _pickByKeywords(idx, keywords, true);
        if (!v) return '';
        var m = String(v).match(/-?\d+(\.\d+)?/);
        return m ? m[0] : String(v);
    }
    function _pickDateByKeywords(idx, keywords) {
        var v = _pickByKeywords(idx, keywords, true);
        if (!v) return '';
        var s = String(v);
        if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return s.slice(0, 10) + ' 00:00:00';
        if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) return s.replace(/\//g, '-').slice(0, 10) + ' 00:00:00';
        if (s.length >= 10) {
            var md = s.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
            if (md) return md[1] + '-' + (md[2].length === 1 ? '0' : '') + md[2] + '-' + (md[3].length === 1 ? '0' : '') + md[3] + ' 00:00:00';
        }
        try {
            var d = new Date(s);
            if (!isNaN(d.getTime())) {
                return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' 00:00:00';
            }
        } catch (eD) {}
        return s;
    }

    function mapBasicFromApi(rawJson, listLevel) {
        try {
            var data = (rawJson && rawJson.data !== undefined) ? rawJson.data : rawJson;
            var out = {};

            // 🔴✅✅✅ 【建设单位 / 组织机构代码 专门解析】—— 解决之前"基本信息建设单位全空"的根因：
            //   后端 basic 详情的真实结构是 data.buildUnit = [{orgTypeId, orgName, orgCode}, ...]（对象数组）
            //   _buildApiReverseIndex 把 buildUnit.0.orgName / buildUnit.1.orgName / ... 的 shortKey=orgName 全部冲突，
            //   idx['orgname'] 只会保留最先出现的那一个；如果数组里第一个不是 orgTypeId=1（建设单位），就会命中到勘察/设计/施工单位的名字，或者空值。
            //   解决：直接遍历原始 data 里所有数组字段（buildUnit / orgList / unitList / units / projectOrgs 等常见命名），按 orgTypeId==1 过滤后拼接。
            (function () {
                try {
                    var ARRAY_KEYS_TO_LOOK = ['buildUnit','orgList','unitList','units','projectOrgs','projectUnits','orgs','buildUnits','constructUnits','deptList','organizations','orgInfos','participants'];
                    var _names = [];
                    var _codes = [];
                    function scanOneArray(arr) {
                        if (!Array.isArray(arr) || arr.length === 0) return;
                        for (var i = 0; i < arr.length; i++) {
                            var it = arr[i];
                            if (!it || typeof it !== 'object') continue;
                            var tid = it['orgTypeId'] !== undefined ? Number(it['orgTypeId']) : NaN;
                            var oname = it['orgName'] !== undefined && it['orgName'] !== null ? String(it['orgName']).trim() : '';
                            var ocode = it['orgCode'] !== undefined && it['orgCode'] !== null ? String(it['orgCode']).trim() : '';
                            var wantIt = false;
                            if (tid === 1) wantIt = true;
                            if (!wantIt) {
                                try {
                                    var keys = Object.keys(it);
                                    for (var kk = 0; kk < keys.length; kk++) {
                                        var kn = String(keys[kk] || '').toLowerCase();
                                        if (kn === 'buildunittype' || kn === 'orgtypename' || kn === 'orgrole' || kn === 'type') {
                                            var tv = String(it[keys[kk]] || '').toLowerCase();
                                            if (tv && (tv.indexOf('建设') !== -1 || tv.indexOf('业主') !== -1 || tv.indexOf('建单') !== -1 || tv === '1' || tv === 'owner' || tv === 'build')) { wantIt = true; break; }
                                        }
                                    }
                                } catch (eK) {}
                            }
                            if (arr.length === 1 && !wantIt && oname) wantIt = true;
                            if (wantIt) {
                                if (oname && _names.indexOf(oname) === -1) _names.push(oname);
                                if (ocode && _codes.indexOf(ocode) === -1) _codes.push(ocode);
                            }
                        }
                    }
                    function walk(obj) {
                        if (!obj || typeof obj !== 'object') return;
                        if (Array.isArray(obj)) {
                            var _matchName = false;
                            try {
                                for (var ci = 0; ci < Math.min(obj.length, 5); ci++) {
                                    if (obj[ci] && typeof obj[ci] === 'object' && ('orgName' in obj[ci] || 'orgTypeId' in obj[ci] || 'orgCode' in obj[ci])) { _matchName = true; break; }
                                }
                            } catch (eMN) {}
                            if (_matchName) scanOneArray(obj);
                            return;
                        }
                        var ks = Object.keys(obj);
                        for (var ki = 0; ki < ks.length; ki++) {
                            var k = ks[ki];
                            if (k === '__v' || k === '_raw') continue;
                            var v = obj[k];
                            if (v && typeof v === 'object') {
                                if (ARRAY_KEYS_TO_LOOK.indexOf(k) !== -1 && Array.isArray(v)) scanOneArray(v);
                                walk(v);
                            }
                        }
                    }
                    walk(data);
                    try {
                        var tks = Object.keys(data || {});
                        for (var tki = 0; tki < tks.length; tki++) {
                            var tk = tks[tki];
                            if (!tk) continue;
                            var ntk = String(tk).toLowerCase();
                            if ((ntk.indexOf('build') === 0 || ntk.indexOf('unit') !== -1 || ntk.indexOf('org') !== -1 || ntk.indexOf('dept') !== -1) && Array.isArray(data[tk])) scanOneArray(data[tk]);
                        }
                    } catch (eTK) {}
                    mapBasicFromApi._lastBuildNames = _names.slice();
                    mapBasicFromApi._lastBuildCodes = _codes.slice();
                    out['建设单位'] = _names.length > 0 ? _names.join('、') : '';
                    out['组织机构代码'] = _codes.length > 0 ? _codes.join('、') : '';
                } catch (eBigOrg) {
                    console.warn('[api] basic buildUnit 扫描失败:', eBigOrg);
                    out['建设单位'] = '';
                    out['组织机构代码'] = '';
                }
            })();

            var flat = _flattenObject(data);
            var idx = _buildApiReverseIndex(flat);
            console.log('[api] 🟢 basic 接口扁平化索引 (部分):', Object.keys(idx).slice(0, 40), '共字段数=' + Object.keys(idx).length);
            try {
                if (mapBasicFromApi._lastBuildNames) console.log('[api] 🟢 basic 建设单位数组扫描命中 orgTypeId==1: name=[' + mapBasicFromApi._lastBuildNames.join('|') + '], code=[' + (mapBasicFromApi._lastBuildCodes||[]).join('|') + ']');
            } catch (eLg) {}
            out['项目名称'] = _pickByKeywords(idx, ['项目名称', 'projectName', 'prjName', 'prjname', 'name', 'projecttitle', 'prjTitle', 'title'], true);
            out['省级项目编号'] = _pickByKeywords(idx, ['省级项目编号', '项目编号', 'projectCode', 'prjCode', 'prjcode', 'code', 'projectNo', 'prjNo', 'projectID', 'projectcode'], true);
            // 建设单位/组织机构代码：以【数组按 orgTypeId==1 扫描】为主，_pickByKeywords 只做兜底（不覆盖已有值）
            var _tmpBuildUnit = out['建设单位'] || _pickByKeywords(idx, ['建设单位', '建设单位名称', '建设方', '业主单位', '业主', 'buildDept', 'buildUnit', 'builddept', 'constructionUnitName', 'buildCompany', 'buildUnitName', 'ownerUnit', 'ownerName', 'orgName', 'buildOrgName', 'owner'], true);
            out['建设单位'] = _tmpBuildUnit || '';
            var _tmpOrgCode = out['组织机构代码'] || _pickByKeywords(idx, ['组织机构代码', '统一社会信用代码', 'organizationCode', 'orgCode', 'socialCreditCode', 'creditCode', 'buildUnitOrgCode', 'orgCodeUnify', 'unifiedCreditCode'], true);
            out['组织机构代码'] = _tmpOrgCode || '';
            // 🔴✅ 项目分类：后端字段名是 projectClass，之前漏了
            out['项目分类'] = _pickByKeywords(idx, ['项目分类', 'projClassify', 'projType', 'projectType', 'projectClassify', 'projectCategory', 'projectClass', 'projClass', 'classify', 'category', 'projectKind'], true);
            out['国家标准行业'] = _pickByKeywords(idx, ['国家标准行业', '所属行业', '行业', 'industry', 'nationalStandardIndustry', 'industryType', 'industryName', 'gbIndustry', 'trade', 'businessType'], true);
            // 🔴✅ 备案日期：后端是 createTime（2015-12-11 入库时间=备案时间），之前关键词只有 createDate/createdAt，漏了 createTime
            out['备案日期'] = _pickDateByKeywords(idx, ['备案日期', 'recordDate', 'createDate', 'createdAt', 'recordTime', 'createTime', 'createDatetime', 'submitTime', 'submitDate', 'archiveTime', 'archiveDate', 'filingDate']);
            out['建设规模'] = _pickByKeywords(idx, ['建设规模', 'constructionScale', 'buildScale', 'projectScale', 'scale', 'scaleDesc', 'constructionSize', 'buildSize', 'projectSize'], true);
            // 🔴✅ DOM版字段12：总面积/长度（平方米/米）→ 对应 totalArea
            out['总面积/长度（平方米/米）'] = _pickNumberByKeywords(idx, ['总面积', '建筑面积', '总面积(平方米)', '总面积平方米', '面积', '总建筑面积', 'totalArea', 'buildArea', 'buildingArea', 'constructionArea', 'grossFloorArea', 'floorArea', 'siteArea', 'landArea', 'plotArea', 'area']);
            out['建筑面积（平方米）'] = out['总面积/长度（平方米/米）'];
            out['总投资（万元）'] = _pickNumberByKeywords(idx, ['总投资万元', '总投资', '总投资额', 'totalInvest', 'totalInvestment', 'investAmt', 'invest', 'totalInvestAmt', 'investTotal', 'investment', 'totalCapital', 'planInvest', 'plannedInvest', 'projectInvestment']);
            out['建设规模及内容'] = _pickByKeywords(idx, ['建设规模及内容', '建设内容及规模', '建设内容', 'content', 'projectContent', 'constructionContent', 'buildContent', 'scaleContent', 'contentDesc', 'projectDescription', 'description', 'projDesc'], true);
            if (!out['建设规模及内容'] && out['建设规模']) out['建设规模及内容'] = out['建设规模'];
            // 🔴✅ DOM版字段14：建设性质 → 对应 nature（新建/改扩建/改建）之前漏了！
            out['建设性质'] = _pickByKeywords(idx, ['建设性质', '性质', 'nature', 'buildNature', 'projectNature', 'constructionNature', 'natureType', 'projectProperty', 'buildProperty'], true);
            // 🔴✅ DOM版字段15：工程用途 → 对应 purpose（商业建筑/工业建筑/公共配套）之前漏了！
            out['工程用途'] = _pickByKeywords(idx, ['工程用途', '用途', 'purpose', 'projectPurpose', 'use', 'usage', 'projectUse', 'buildPurpose', 'buildingUsage', 'function', 'projectFunction', 'buildingPurpose', 'func'], true);
            // 🔴✅ DOM版字段16：计划开工日期 → 对应 planBeginDate 之前漏了！
            out['计划开工日期'] = _pickDateByKeywords(idx, ['计划开工日期', '计划开工时间', '计划开工', '开工日期', '开工时间', 'planBeginDate', 'planStartDate', 'planBeginTime', 'planStartTime', 'startDate', 'beginDate', 'plannedStartDate', 'scheduledStartDate', 'startTime']);
            var planEnd = _pickDateByKeywords(idx, ['计划竣工日期', '计划竣工时间', '计划完工', '竣工日期', '竣工时间', 'planEndDate', 'planFinishDate', 'planEndTime', 'planFinishTime', 'endDate', 'finishDate', 'plannedEndDate', 'scheduledEndDate']);
            if (planEnd) out['计划竣工日期'] = planEnd;
            out['结构体系'] = _pickByKeywords(idx, ['结构体系', '结构类型', 'structureType', 'structureSystem', 'structure', 'structType', 'structuralSystem', 'structuralType'], true);
            // 🔴✅ 占地面积：后端字段名是 totalArea（=建筑面积，暂时也先填到占地面积里，保证有值）
            out['占地面积（平方米）'] = _pickNumberByKeywords(idx, ['占地面积平方米', '占地面积', 'landArea', 'landAreaSquare', 'floorArea', 'siteArea', 'totalArea', 'buildArea', 'buildingArea', 'constructionArea', 'grossFloorArea', 'plotArea', 'landAreaM2', 'area']);
            var province = _pickByKeywords(idx, ['省份', '省', 'province', 'provinceName'], true);
            var city = _pickByKeywords(idx, ['所在市', '城市', '市', 'city', 'cityName'], true);
            var division = _pickByKeywords(idx, ['所在区', '区县', '区', '县', 'division', 'district', 'districtName', 'countyName', 'county'], true);
            var detailAddr = _pickByKeywords(idx, ['详细地址', '建设地点', '建设地址', '地址', 'address', 'buildAddress', 'projectAddress', 'constructionAddress', 'detailAddress', 'location', 'siteAddress', 'projectLocation', 'addr'], true);
            out['建设地点省'] = province;
            out['建设地点市'] = city;
            out['建设地点区县'] = division;
            // ✅ 所在市：= city（用户明确：列表里就能找到的单字段，就是这个）
            out['所在市'] = city || '';
            // ✅ 项目所在地：= province + city + division 拼接而成（用户明确：详情页里才有，需要三段拼接）
            out['项目所在地'] = normText((province || '') + (city || '') + (division || ''));
            // 🔴✅ DOM版字段6：详细地址 → 对应 address（之前漏了）
            out['详细地址'] = detailAddr;
            out['建设地点'] = normText((province || '') + (city || '') + (division || '') + (detailAddr || ''));
            if (detailAddr && !out['建设地点']) out['建设地点'] = detailAddr;
            // 🔴✅ 立项文号：后端字段名是 approvalCode，之前写的 approvalNo（不对），补上
            out['立项文号'] = _pickByKeywords(idx, ['立项文号', 'projectApprovalNo', 'approvalNo', 'approvalNumber', 'lixiangNo', 'approvalCode', 'projectApprovalCode', 'approveCode', 'lixiangCode', 'projectApprovalNum', 'approvalDocNo', 'approvalDocCode'], true);
            out['项目审批级别'] = _pickByKeywords(idx, ['项目审批级别', '审批级别', '审批层级', 'approvalLevel', 'approveLevel', 'approvalTier', 'projectApprovalLevel', 'examineLevel'], true);
            // 🔴✅ DOM版字段8：立项级别 → 和项目审批级别是同一个（approvalLevel），DOM版字段名就是立项级别
            out['立项级别'] = out['项目审批级别'];
            // 🔴✅ DOM版字段9：立项批复机关 → 对应 approvalUnit，同时赋给报送单位
            out['立项批复机关'] = _pickByKeywords(idx, ['立项批复机关', '立项批准机关', '批复机关', '批准机关', '审批机关', '报送单位', '上报单位', '申报单位', 'submitDept', 'submitUnit', 'reportUnit', 'approvalUnit', 'approveUnit', 'examineUnit', 'approvalAuthority', 'approveAuthority', 'declarationUnit', 'applyUnit'], true);
            out['报送单位'] = out['立项批复机关'];
            // 🔴✅ DOM版字段10：立项批复时间 → 对应 approvalDate（之前漏了！）
            out['立项批复时间'] = _pickDateByKeywords(idx, ['立项批复时间', '立项批准时间', '批复时间', '批准时间', '审批时间', 'approvalDate', 'approveDate', 'approvalTime', 'lixiangDate', 'projectApprovalDate']);
            // 🔴✅ 报送单位：后端字段名是 approvalUnit（审批机关=报送机关），补上
            out['报送单位'] = _pickByKeywords(idx, ['报送单位', '上报单位', '申报单位', 'submitDept', 'submitUnit', 'reportUnit', 'approvalUnit', 'approveUnit', 'examineUnit', 'approvalAuthority', 'approveAuthority', 'declarationUnit', 'applyUnit'], true);
            if (listLevel) out['数据等级'] = listLevel;
            else out['数据等级'] = _pickByKeywords(idx, ['数据等级', '数据分级', '等级', 'level', 'grade', 'dataLevel', 'dataGrade', 'datalevel', 'recordLevel']);
            // 列表行信息兜底（接口没返回时，用列表页已经抓到的外键顶上去）
            if (arguments.length >= 3) {
                try {
                    var listRow = arguments[2];
                    if (listRow && typeof listRow === 'object') {
                        var lrKeys = Object.keys(listRow);
                        for (var lk = 0; lk < lrKeys.length; lk++) {
                            var k = lrKeys[lk];
                            var lv = listRow[k];
                            if (!k || !lv || typeof lv !== 'string') continue;
                            if (lv.length < 1 || lv === '--' || lv === '—' || lv === 'N/A') continue;
                            if (k.indexOf('_') === 0) continue;
                            if (!out[k] || out[k] === '') out[k] = lv;
                        }
                    }
                } catch (eLr) {}
            }
            Object.keys(out).forEach(function (k) { if (out[k] === '' || out[k] === null || out[k] === undefined) delete out[k]; });
            console.log('[api] ✅ basic 映射结果 (字段数=' + Object.keys(out).length + '):', JSON.parse(JSON.stringify(out)));
            return out;
        } catch (bigE) {
            console.error('[api] basic 映射异常:', bigE);
            return {};
        }
    }

    function mapPermitFromApi(rawJson, listLevel, listProjectName) {
        try {
            var data = (rawJson && rawJson.data !== undefined) ? rawJson.data : rawJson;
            var flat = _flattenObject(data);
            var idx = _buildApiReverseIndex(flat);
            var allKeys = Object.keys(idx);
            console.log('[api] 🟡 permit 接口扁平化索引 (全量,共' + allKeys.length + '个):', allKeys);
            var out = {};
            // 1. 施工许可证编号 → constructionPermitCode
            out['施工许可证编号'] = _pickByKeywords(idx, ['施工许可证编号', '许可证编号', 'permitCode', 'permitNo', 'permitNumber', 'constructionPermitCode', 'constructPermitCode', 'permitcode', 'permitno'], true);
            // 2. 省级施工许可证编号 → 同许可证编号（无省/地市级区分时复用）
            out['省级施工许可证编号'] = _pickByKeywords(idx, ['省级施工许可证编号', '省级许可证编号', 'provincePermitCode', 'provincialPermitCode'], true) || out['施工许可证编号'];
            // 3. 工程名称 + 项目名称（同时输出两个，与 basic DOM 版对齐，避免 popup 合并丢失）
            out['工程名称'] = listProjectName || _pickByKeywords(idx, ['工程名称', '项目名称', 'projectName', 'prjName', 'name', 'engineeringName', 'projectname', 'prjname'], true);
            out['项目名称'] = listProjectName || _pickByKeywords(idx, ['项目名称', '工程名称', 'projectName', 'prjName', 'prjname', 'name', 'projecttitle', 'engineeringName', 'projectname'], true);
            // 4. 省级项目编号
            out['省级项目编号'] = _pickByKeywords(idx, ['省级项目编号', '项目编号', 'projectCode', 'prjCode', 'prjcode', 'code', 'projectNo', 'prjNo', 'projectID', 'projectcode'], true);
            // 5. 建设单位 → constructOrgName（关键词优先级：精确字段名 > 中文名）
            out['建设单位'] = _pickByKeywords(idx, ['constructOrgName', 'constructorgname', 'constructUnit', '建设单位', '建设单位名称', 'ownerOrg', 'ownerName', 'ownerUnit', 'buildDept', 'buildUnit', 'constructionUnitName', 'buildCompany', 'constructionUnit', 'owner', 'ownercompany', 'ownername', 'constructorgname'], true);
            // 6. 建设单位组织机构代码 → constructOrgId
            out['建设单位组织机构代码'] = _pickByKeywords(idx, ['constructOrgId', 'constructorgid', '建设单位组织机构代码', '建设单位代码', '建设单位信用代码', 'buildUnitCode', 'constructionUnitCode', 'ownerCode', 'ownerOrgId'], true);
            // 7. 施工单位 → buildOrgName
            out['施工单位'] = _pickByKeywords(idx, ['buildOrgName', 'buildorgname', '施工单位', '施工单位名称', '总承包单位', 'contractor', 'constructionCompany', 'buildCompanyName', 'generalContractor', 'gcUnit', 'buildUnitName', 'contractorOrg', 'contractorName', 'builderorgname', 'constructcompany', 'buildorgname'], true);
            // 8. 施工单位组织机构代码 → buildOrgId
            out['施工单位组织机构代码'] = _pickByKeywords(idx, ['buildOrgId', 'buildorgid', '施工单位组织机构代码', '施工单位代码', '施工单位信用代码', 'contractorCode', 'buildUnitCode', 'contractorOrgCode', 'contractorId', 'builderorgid'], true);
            // 9. 监理单位 → supervisorOrgName
            out['监理单位'] = _pickByKeywords(idx, ['supervisorOrgName', 'supervisororgname', '监理单位', '监理单位名称', 'supervisionUnit', 'supervisor', 'supervisionCompany', 'superviseUnit', 'supervisionOrgName', 'supervisionCompanyName', 'supervisorcompany', 'supervisionorgname', 'supervisororgname'], true);
            // 10. 设计单位 → designOrgName
            out['设计单位'] = _pickByKeywords(idx, ['designOrgName', 'designorgname', '设计单位', '设计单位名称', 'designUnit', 'designCompany', 'designer', 'designorgname', 'designcompany'], true);
            // 11. 勘察单位 → prospectingOrgName
            out['勘察单位'] = _pickByKeywords(idx, ['prospectingOrgName', 'prospectingorgname', '勘察单位', '勘察单位名称', 'surveyUnit', 'surveyCompany', 'reconnaissanceUnit', 'prospectOrgName', 'investigationUnit', 'investigationOrg', 'prospectingorgname', 'prospectorgname', 'surveyorgname'], true);
            // 12. 勘察设计单位（两个字段都没时才用通用名）
            out['勘察设计单位'] = _pickByKeywords(idx, ['勘察设计单位', '勘察设计', 'surveyDesignUnit', 'surveyAndDesignOrg'], true);
            // 13. 建设规模 → constructScale
            out['建设规模'] = _pickByKeywords(idx, ['constructScale', 'constructscale', '建设规模', 'constructionScale', 'buildScale', 'scale', 'projectScale', 'buildProjectScale', 'constructscale', 'scaleofconstruction'], true);
            // 14. 结构体系 → structure
            out['结构体系'] = _pickByKeywords(idx, ['结构体系', '结构类型', 'structureType', 'structureSystem', 'structure', 'structureForm', 'structSystem', 'structuralType', 'structuretype', 'structtype'], true);
            // 15. 合同价格（万元） → contractMoney（同时输出 合同价格 / 合同价格（万元） / 合同金额 三个列名，避免列名对不上）
            var _contractMoney = _pickNumberByKeywords(idx, ['contractMoney', 'contractmoney', '合同价格万元', '合同价格', '合同额', '合同总价', 'contractPrice', 'contractAmount', 'contractAmt', 'contractSum', 'contractCost', 'contractPriceWan', 'contractvalue', 'contractmoney']);
            if (_contractMoney && _contractMoney !== '') {
                out['合同价格（万元）'] = _contractMoney;
                out['合同价格'] = _contractMoney;
                out['合同金额'] = _contractMoney;
            }
            // 16. 合同面积（平方米） → area（同时输出 合同面积 / 合同面积（平方米） 两个）
            var _contractArea = _pickNumberByKeywords(idx, ['合同面积平方米', '合同面积', '建筑面积', 'contractArea', 'buildArea', 'buildingArea', 'area', 'constructArea', 'floorArea', 'buildingarea', 'floorspace']);
            if (_contractArea && _contractArea !== '') {
                out['合同面积（平方米）'] = _contractArea;
                out['合同面积'] = _contractArea;
            }
            // 17. 建设性质 → constructNature
            out['建设性质'] = _pickByKeywords(idx, ['constructNature', 'constructnature', '建设性质', '性质', 'nature', 'buildNature', 'projectNature', 'constructionNature', 'natureType', 'projectProperty', 'buildProperty', 'constructnature', 'natureofconstruction'], true);
            // 18. 合同工期：优先使用 beginDate ～ endDate（与网站展示一致，如 "2026-04-23 ～ 2026-12-31"）
            //     如果没有 beginDate/endDate，再尝试直接取合同工期字段；最后兜底用日期差推算天数
            var _duration = '';
            try {
                var _bd = _pickDateByKeywords(idx, ['beginDate', 'begindate', 'beginTime', '合同开工日期', '计划开工日期', '开工日期', 'contractStartDate', 'startDate', 'commenceDate', 'constructStartDate', 'planBeginDate', 'planStartDate', 'startdate']);
                var _ed = _pickDateByKeywords(idx, ['endDate', 'enddate', 'endTime', '合同竣工日期', '计划竣工日期', '计划完工日期', '竣工日期', 'contractEndDate', 'completeDate', 'finishDate', 'completionDate', 'constructEndDate', 'planCompleteDate', 'finishdate']);
                if (_bd && _ed) {
                    var _fmtBd = String(_bd || '').replace(/\s.*$/, '').trim();
                    var _fmtEd = String(_ed || '').replace(/\s.*$/, '').trim();
                    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(_fmtBd) && /^\d{4}-\d{1,2}-\d{1,2}$/.test(_fmtEd)) {
                        function padZero(n) { var s = String(n); return s.length === 1 ? '0' + s : s; }
                        var bp = _fmtBd.split('-'), ep = _fmtEd.split('-');
                        _duration = bp[0] + '-' + padZero(bp[1]) + '-' + padZero(bp[2]) + ' ～ ' + ep[0] + '-' + padZero(ep[1]) + '-' + padZero(ep[2]);
                    }
                }
            } catch (eRangeFmt) {}
            if (!_duration || _duration === '') {
                _duration = _pickByKeywords(idx, ['contractDuration', 'contractduration', 'planDays', 'plandays', 'durationDays', 'durationMonths', '计划工期', '合同工期', '工期', '施工工期', 'projectDuration', 'constructDuration', 'buildDuration', 'duration', 'totaldays', 'totalduration', 'contractperiod', 'constructionperiod'], true);
            }
            if (!_duration || _duration === '') {
                try {
                    var _s = _pickDateByKeywords(idx, ['begindate', '合同开工日期', '计划开工日期', '开工日期', 'contractStartDate', 'startDate', 'beginDate', 'commenceDate', 'constructStartDate', 'planBeginDate', 'planStartDate', 'startdate']);
                    var _e = _pickDateByKeywords(idx, ['enddate', '合同竣工日期', '计划竣工日期', '计划完工日期', '竣工日期', 'contractEndDate', 'endDate', 'completeDate', 'finishDate', 'completionDate', 'constructEndDate', 'planCompleteDate', 'finishdate']);
                    if (_s && _e) {
                        var _sd = new Date(String(_s).replace(/\//g, '-').replace(/\s.*/, ''));
                        var _ed = new Date(String(_e).replace(/\//g, '-').replace(/\s.*/, ''));
                        if (!isNaN(_sd.getTime()) && !isNaN(_ed.getTime()) && _ed >= _sd) {
                            var diffDay = Math.round((_ed.getTime() - _sd.getTime()) / 86400000);
                            if (diffDay > 0) _duration = diffDay + ' 日历天';
                        }
                    }
                } catch (eCalc) {}
            }
            if (_duration && _duration !== '') out['合同工期'] = _duration;
            // 19. 合同开工日期
            out['合同开工日期'] = _pickDateByKeywords(idx, ['合同开工日期', '计划开工日期', '开工日期', 'contractStartDate', 'startDate', 'beginDate', 'commenceDate', 'constructStartDate', 'planBeginDate', 'planStartDate', 'startdate', 'begindate', 'constructionstartdate', 'commencementdate']);
            // 20. 合同竣工日期
            out['合同竣工日期'] = _pickDateByKeywords(idx, ['合同竣工日期', '计划竣工日期', '计划完工日期', '竣工日期', 'contractEndDate', 'endDate', 'completeDate', 'finishDate', 'completionDate', 'constructEndDate', 'planCompleteDate', 'enddate', 'completedate', 'completiondate', 'finishdate', 'constructionenddate']);
            // 21. 发证机关 → authorizeOrgName
            out['发证机关'] = _pickByKeywords(idx, ['authorizeOrgName', 'authorizeorgname', '发证机关', '发证机关名称', 'issueAuthority', 'issueDept', 'licenseAuthority', 'issuingAuthority', 'authorityName', 'grantOrg', 'licenseOrgName', 'authorizeorgname', 'issuingauthority', 'issuedepartment', 'grantorgname'], true);
            // 22. 发证日期 → authorizeDate
            out['发证日期'] = _pickDateByKeywords(idx, ['发证日期', '发照日期', 'issueDate', 'licenseDate', 'certificateDate', 'grantDate', 'authorizeDate', 'certDate', 'issuedate', 'licensedate', 'authorizeissuedate', 'certificatedate']);
            // 23. 建设地址 → constructAddress
            out['建设地址'] = _pickByKeywords(idx, ['constructAddress', 'constructaddress', '建设地址', '工程地址', '地址', 'address', 'buildAddress', 'projectAddress', 'constructionAddress', 'siteAddress', 'location', 'projectSite', 'constructaddress', 'site', 'addressofconstruction', 'worksite'], true);
            // 24. 施工单位项目负责人 → buildManager（注意：接口里实际有 constructManager 是建设单位负责人！别搞混了！）
            out['施工单位项目负责人'] = _pickByKeywords(idx, ['buildManager', 'buildmanager', '施工单位项目负责人', '施工项目经理', '项目经理', '项目负责人', '施工负责人', 'projectManager', 'contractorManager', 'buildProjectManager', 'pmName', 'builderManager', 'buildmanager', 'constructionmanager', 'siteManager'], true);
            // 🔴✅ 用户明确不需要「项目经理注册号」，跳过（即使详情里有也不写入输出行）
            // 25. 项目经理注册号（身份证号/注册号，buildManagerId）—— 已停用
            // out['项目经理注册号'] = _pickByKeywords(idx, ['项目经理注册号', '项目经理证号', '项目经理身份证号', '项目经理资格证号', 'projectManagerId', 'pmId', 'buildManagerId', 'constructManagerId', 'pmRegNo', 'buildmanagerid', 'pmpid', 'projectmanagerid'], true);
            // 26. 总监理工程师 → supervisorManager（扩充关键词，可能名字叫什么都有！）
            out['总监理工程师'] = _pickByKeywords(idx, ['supervisor', 'supervisorid', 'supervisorManager', 'supervisormanager', '总监理工程师', '总监', '监理工程师', '总监工程师', 'chiefSupervisionEngineer', 'supervisorChief', 'chiefSupervisor', 'supervisionEngineer', 'supervisionManager', 'supervisingEngineer', 'supervisionChief', 'supervisionManagerName', 'supervisorEngineer', 'chiefEngineerSupervision', 'supervisionDirector', 'directorOfSupervision'], true);
            // 27. 建设单位项目负责人 → constructManager（之前搞错了，constructManager 才是建设单位负责人！）
            out['建设单位项目负责人'] = _pickByKeywords(idx, ['constructManager', 'constructmanager', '建设单位项目负责人', '建设单位负责人', '甲方负责人', '甲方项目经理', '业主项目负责人', 'ownerManager', 'constructProjectManager', 'buildOwnerManager', 'ownerProjectManager', 'constructmanager', 'ownermanager', 'clientmanager'], true);
            // 28. 勘察单位项目负责人 → prospectingManager
            out['勘察单位项目负责人'] = _pickByKeywords(idx, ['prospectingManager', 'prospectingmanager', '勘察单位项目负责人', '勘察项目负责人', '勘察负责人', 'surveyManager', 'prospectManager', 'investigationManager', 'prospectingmanager', 'surveymanager', 'prospectmanager', 'investigationmanager', 'reconnaissancemanager'], true);
            // 29. 设计单位项目负责人 → designManager
            out['设计单位项目负责人'] = _pickByKeywords(idx, ['designManager', 'designmanager', '设计单位项目负责人', '设计项目负责人', '设计负责人', 'designProjectManager', 'designerManager', 'designmanager', 'designerchief', 'designprincipal'], true);
            // 30. 工程总承包单位 → undertakeOrgName（再扩充关键词！可能接口叫 generalContractor/epcContractor/gc）
            out['工程总承包单位'] = _pickByKeywords(idx, ['undertakeOrgName', 'undertakeorgname', '工程总承包单位', '工程总承包', '总承包单位', '总包单位', '总承包', 'EPC单位', 'epcOrgName', 'generalContractorOrg', 'generalContractorName', 'generalContractorCompany', 'gcOrgName', 'epcContractorName', 'epcContractorOrg', 'turnkeyContractorName', 'undertakeorgname', 'generalcontractorname', 'epcname'], true);
            // 31. 工程总承包项目经理 → undertakeManager
            out['工程总承包项目经理'] = _pickByKeywords(idx, ['undertakeManager', 'undertakemanager', '工程总承包项目经理', '总承包项目经理', '总包项目经理', 'EPC项目经理', 'epcManager', 'generalContractorManager', 'gcManager', 'generalContractorPm', 'epcPm', 'turnkeyPm', 'undertakemanager', 'generalcmanager', 'epcprojectmanager'], true);
            // 32. 状态
            out['状态'] = _pickByKeywords(idx, ['状态', '当前状态', '项目状态', '证书状态', 'status', 'state', 'permitStatus', 'licenseStatus', 'validStatus', 'auditStatus', 'recordStatus', 'permitstatus', 'licensestatus', 'validity', 'stateofpermit'], true);
            // 33. 备注 → remark（质量/安全监督注册号在这里）
            out['备注'] = _pickByKeywords(idx, ['备注', 'remark', 'note', 'notes', 'comment', 'comments', 'description', 'memo', 'beizhu', 'remarks', 'remarkinfo', 'additionalinfo', 'remark1'], true);
            if (listLevel) out['数据等级'] = listLevel;
            else out['数据等级'] = _pickByKeywords(idx, ['数据等级', '数据分级', '等级', 'level', 'grade', 'dataLevel', 'dataGrade', 'datalevel', 'recordLevel'], true);
            Object.keys(out).forEach(function (k) { if (out[k] === '' || out[k] === null || out[k] === undefined) delete out[k]; });
            console.log('[api] ✅ permit 映射结果 (字段数=' + Object.keys(out).length + '):', JSON.parse(JSON.stringify(out)));
            return out;
        } catch (bigE) {
            console.error('[api] permit 映射异常:', bigE);
            return {};
        }
    }

    function mapCompleteFromApi(rawJson, listRow) {
        try {
            var data = (rawJson && rawJson.data !== undefined) ? rawJson.data : rawJson;
            var flat = _flattenObject(data);
            var idx = _buildApiReverseIndex(flat);
            var allKeys = Object.keys(idx);
            console.log('[api] 🔵 complete 接口扁平化索引 (全量,共' + allKeys.length + '个):', allKeys);
            var out = {};
            var lr = listRow || {};
            // 列名双写：避免 popup 合并时列名对不上
            var _pn = lr['工程名称'] || lr['项目名称'] || _pickByKeywords(idx, ['工程名称', '项目名称', 'projectName', 'prjName', 'prjname', 'name', 'projecttitle', 'engineeringName', 'projectname'], true);
            if (_pn) { out['工程名称'] = _pn; out['项目名称'] = _pn; }
            out['省级项目编号'] = lr['省级项目编号'] || lr['项目编号'] || _pickByKeywords(idx, ['省级项目编号', '项目编号', 'projectCode', 'prjCode', 'prjcode', 'code', 'projectNo', 'prjNo', 'projectID', 'projectcode'], true);
            // 🔴✅✅✅ 按用户 2026-07-26 真实示例数据 100% 对齐映射（绝不乱填/写反！）
            // 示例 JSON:
            //   provinceArchiveCode: "4407832503100001-JX-001"  →  省级竣工验收备案编号（用户要求列表列这个 key 存这个）
            //   archiveCode: "开建验备2026-115"                  →  竣工验收备案编号（普通本地备案号，用户要的！之前被我误删了才空！）
            var _local = _pickByKeywords(idx, ['archiveCode', 'archivecode', '竣工验收备案编号', '备案编号', '本地备案编号', 'recordNo', 'recordCode', 'acceptanceRecordNo', 'acceptanceRecordCode', 'archiveNo', 'acceptancerecordno', 'recordno', 'recordcode'], true);
            var _provFromApi = _pickByKeywords(idx, ['provinceArchiveCode', 'provincearchivecode', '省级竣工验收备案编号', '省级备案编号', 'provinceRecordNo', 'provincialRecordCode', 'recordCodeProvincial', 'acceptanceRecordCodeProvincial', 'provincialrecordcode', 'provincerecordno'], true);
            var _prov = lr['省级竣工验收备案编号'] || lr['竣工验收备案编号'] || _provFromApi;

            // 🔴 分别写两个 key，不能复用！两个值不一样才是正确的数据！
            if (_prov) out['省级竣工验收备案编号'] = _prov;
            if (_local) {
                out['竣工验收备案编号'] = _local;
                out['备案编号'] = _local;
            }
            out['备案机关'] = lr['备案机关'] || _pickByKeywords(idx, ['archiveOrgName', 'archiveorgname', '备案机关', '备案机关名称', 'acceptanceAuthority', 'recordAuthority', 'recordDept', 'archiveDept', 'archiveAuthority', 'acceptanceDept', 'recordauthority', 'acceptanceauthority', 'recorddept', 'archivedept'], true);
            // 备案日期 + 竣工验收日期
            out['备案日期'] = _pickDateByKeywords(idx, ['备案日期', '备案时间', '存档日期', 'recordDate', 'archiveDate', 'acceptanceArchiveDate', 'recordTime', 'archiveTime', 'acceptanceDate', 'recorddate', 'archivedate', 'acceptancedate', 'acceptancearchivedate']);
            if (!out['备案日期'] || out['备案日期'] === '') {
                out['备案日期'] = _pickDateByKeywords(idx, ['createTime', 'createtime', 'createBy', 'createby', 'create_date', '创建时间']);
            }
            out['竣工验收日期'] = _pickDateByKeywords(idx, ['竣工验收日期', '竣工验收时间', '验收日期', '验收时间', 'completionAcceptanceDate', 'acceptanceDate', 'finishAcceptanceDate', '竣工日期', 'completeDate', 'completionDate', 'acceptancedate', 'completiondate', 'completedate', 'acceptancecompletiondate']);
            // 五方主体：建设/施工/监理/设计/勘察
            out['建设单位'] = _pickByKeywords(idx, ['constructOrgName', 'constructorgname', 'constructUnit', '建设单位', '建设单位名称', 'ownerOrg', 'ownerName', 'ownerUnit', 'buildDept', 'buildUnit', 'constructionUnitName', 'buildCompany', 'constructionUnit', 'ownercompany', 'ownername', 'buildorgname'], true);
            out['建设单位组织机构代码'] = _pickByKeywords(idx, ['constructOrgId', 'constructorgid', '建设单位组织机构代码', '建设单位代码', '建设单位信用代码', 'buildUnitCode', 'constructionUnitCode', 'ownerCode', 'ownerOrgId'], true);
            out['施工单位'] = _pickByKeywords(idx, ['buildOrgName', 'buildorgname', '施工单位', '施工单位名称', '总承包单位', 'contractor', 'constructionCompany', 'buildCompanyName', 'generalContractor', 'gcUnit', 'buildUnitName', 'contractorOrg', 'contractorName', 'buildorgname'], true);
            out['施工单位组织机构代码'] = _pickByKeywords(idx, ['buildOrgId', 'buildorgid', '施工单位组织机构代码', '施工单位代码', '施工单位信用代码', 'contractorCode', 'buildUnitCode', 'contractorOrgCode', 'contractorId'], true);
            out['监理单位'] = _pickByKeywords(idx, ['supervisorOrgName', 'supervisororgname', '监理单位', '监理单位名称', 'supervisionUnit', 'supervisor', 'supervisionCompany', 'superviseUnit', 'supervisionOrgName', 'supervisionCompanyName', 'supervisororgname'], true);
            out['设计单位'] = _pickByKeywords(idx, ['designOrgName', 'designorgname', '设计单位', '设计单位名称', 'designUnit', 'designCompany', 'designer', 'designorgname'], true);
            out['勘察单位'] = _pickByKeywords(idx, ['prospectingOrgName', 'prospectingorgname', '勘察单位', '勘察单位名称', 'surveyUnit', 'surveyCompany', 'reconnaissanceUnit', 'prospectOrgName', 'investigationUnit', 'investigationOrg', 'prospectingorgname'], true);
            out['勘察设计单位'] = _pickByKeywords(idx, ['勘察设计单位', '勘察设计', 'surveyDesignUnit', 'surveyAndDesignOrg'], true);
            // 五方项目负责人
            out['施工单位项目负责人'] = _pickByKeywords(idx, ['buildManager', 'buildmanager', '施工单位项目负责人', '施工项目经理', '项目经理', '项目负责人', '施工负责人', 'projectManager', 'contractorManager', 'buildProjectManager', 'pmName', 'buildmanager', 'constructionmanager'], true);
            // 🔴✅ 用户明确不需要「项目经理注册号」，跳过（即使 basic 详情里有也不写入输出行）
            // out['项目经理注册号'] = _pickByKeywords(idx, ['项目经理注册号', '项目经理证号', '项目经理身份证号', '项目经理资格证号', 'projectManagerId', 'pmId', 'buildManagerId', 'buildmanagerid', 'constructManagerId', 'pmRegNo'], true);
            out['建设单位项目负责人'] = _pickByKeywords(idx, ['constructManager', 'constructmanager', '建设单位项目负责人', '建设单位负责人', '甲方负责人', '甲方项目经理', '业主项目负责人', 'ownerManager', 'constructProjectManager', 'buildOwnerManager', 'constructmanager', 'ownermanager', 'clientmanager'], true);
            out['总监理工程师'] = _pickByKeywords(idx, ['supervisor', 'supervisorid', 'supervisorManager', 'supervisormanager', '总监理工程师', '总监', '监理工程师', '总监工程师', 'supervisionManager', 'supervisionEngineer', 'chiefSupervisor', 'supervisionDirector', 'supervisionManagerName', 'chiefSupervisionEngineer', 'supervisorChief', 'supervisorengineer', 'supervisingEngineer'], true);
            out['勘察单位项目负责人'] = _pickByKeywords(idx, ['prospectingManager', 'prospectingmanager', '勘察单位项目负责人', '勘察项目负责人', '勘察负责人', 'surveyManager', 'prospectManager', 'investigationManager', 'prospectingmanager', 'surveymanager'], true);
            out['设计单位项目负责人'] = _pickByKeywords(idx, ['designManager', 'designmanager', '设计单位项目负责人', '设计项目负责人', '设计负责人', 'designProjectManager', 'designerManager', 'designmanager', 'designerchief'], true);
            // 工程总承包（如果有）
            out['工程总承包单位'] = _pickByKeywords(idx, ['undertakeOrgName', 'undertakeorgname', 'undertakeOrg', 'undertakeorg', 'generalContractor', 'generalcontractor', 'generalContractorName', 'gcOrg', 'gcorg', 'gcOrgName', 'epcContractor', 'epccontractor', 'epcOrgName', 'turnkeyContractor', 'turnkeycontractor', 'designBuildContractor', '工程总承包单位', '工程总承包', '总承包单位', '总包单位', '总承包', 'EPC单位', '总包'], true);
            out['工程总承包项目经理'] = _pickByKeywords(idx, ['undertakeManager', 'undertakemanager', 'undertakePm', 'generalContractorManager', 'gcManager', 'gcPm', 'generalContractorPm', 'epcManager', 'epcPm', 'turnkeyManager', 'turnkeyPm', '工程总承包项目经理', '总承包项目经理', '总包项目经理', 'EPC项目经理'], true);
            // 规模/造价/面积/结构/工期
            out['结构体系'] = _pickByKeywords(idx, ['structuralSystem', 'structuralsystem', '结构体系', '结构类型', 'structureType', 'structureSystem', 'structure', 'structureForm', 'structSystem', 'structuralType', 'structuretype'], true);
            out['建设规模'] = _pickByKeywords(idx, ['constructionScale', 'constructionscale', 'constructScale', 'constructscale', '建设规模', 'constructionScale', 'buildScale', 'scale', 'projectScale', 'buildProjectScale', 'constructscale', 'scaleofconstruction'], true);
            // 实际造价/合同价格：3 个列名（🔴✅ 真实后端字段 actualCose！不是 actualCost，少了个 t！）
            var _actualCost = _pickNumberByKeywords(idx, ['actualCose', 'actualcose', 'actualCost', '实际造价万元', '实际造价', '实际总造价', '竣工造价', '竣工总造价', '结算造价', '实际合同价格', 'actualPrice', 'actualInvest', 'finalCost', 'completionCost', 'settlementCost', 'realCost', 'actualcost', 'finalcost', 'settlementcost']);
            if (_actualCost && _actualCost !== '') {
                out['实际造价（万元）'] = _actualCost;
                out['实际造价'] = _actualCost;
                out['合同价格（万元）'] = _actualCost;
                out['合同价格'] = _actualCost;
                out['合同金额'] = _actualCost;
            }
            // 实际面积/合同面积：两个列名
            var _actualArea = _pickNumberByKeywords(idx, ['actualArea', 'actualarea', '实际面积平方米', '实际面积', '竣工面积', '实际建筑面积', 'actualBuildArea', 'completionArea', 'finalArea', 'realArea', 'actualBuildingArea', 'area', 'buildArea', 'buildingArea', 'floorArea', 'actualarea', 'completionarea']);
            if (_actualArea && _actualArea !== '') {
                out['实际面积（平方米）'] = _actualArea;
                out['实际面积'] = _actualArea;
                out['合同面积（平方米）'] = _actualArea;
                out['合同面积'] = _actualArea;
            }
            out['建设性质'] = _pickByKeywords(idx, ['constructNature', 'constructnature', '建设性质', '性质', 'nature', 'buildNature', 'projectNature', 'constructionNature', 'natureType', 'projectProperty', 'buildProperty', 'constructnature', 'natureofconstruction'], true);
            out['实际开工日期'] = _pickDateByKeywords(idx, ['beginDate', 'begindate', '实际开工日期', '实际开工', '开工日期', 'actualStartDate', 'realStartDate', 'actualBeginDate', 'actualCommenceDate', 'startDate', 'commenceDate', 'actualstartdate', 'realstartdate']);
            out['实际竣工日期'] = _pickDateByKeywords(idx, ['endDate', 'enddate', '实际竣工日期', '实际竣工', '竣工日期', '完工日期', 'actualEndDate', 'realEndDate', 'actualCompleteDate', 'actualFinishDate', 'actualCompletionDate', 'completionAcceptanceDate', 'completeDate', 'completionDate', 'finishdate', 'actualenddate', 'realenddate']);
            // 合同工期：如果接口有 begindate/enddate 或 startdate/enddate 就推算
            var _duration = _pickByKeywords(idx, ['实际工期', '合同工期', '工期', 'contractDuration', 'duration', 'durationDays', 'durationMonths', 'totaldays', 'totalduration', 'contractperiod', 'constructionperiod', 'schedule'], true);
            if (!_duration || _duration === '') {
                try {
                    var _s = _pickDateByKeywords(idx, ['beginDate', 'begindate', '实际开工日期', '开工日期', 'actualStartDate', 'realStartDate', 'actualBeginDate', 'actualCommenceDate', 'startDate', 'commenceDate']);
                    var _e = _pickDateByKeywords(idx, ['endDate', 'enddate', '实际竣工日期', '竣工日期', 'actualEndDate', 'realEndDate', 'actualCompleteDate', 'actualFinishDate', 'completionDate', 'completeDate', 'finishDate']);
                    if (_s && _e) {
                        var _sd = new Date(String(_s).replace(/\//g, '-').replace(/\s.*/, ''));
                        var _ed = new Date(String(_e).replace(/\//g, '-').replace(/\s.*/, ''));
                        if (!isNaN(_sd.getTime()) && !isNaN(_ed.getTime()) && _ed >= _sd) {
                            var _diffDay = Math.round((_ed.getTime() - _sd.getTime()) / 86400000);
                            if (_diffDay > 0) _duration = _diffDay + ' 日历天';
                        }
                    }
                } catch (eDur) {}
            }
            if (_duration && _duration !== '') out['合同工期'] = _duration;
            out['建设地址'] = _pickByKeywords(idx, ['constructAddress', 'constructaddress', '建设地址', '工程地址', '地址', 'address', 'buildAddress', 'projectAddress', 'constructionAddress', 'siteAddress', 'location', 'projectSite', 'constructaddress', 'site', 'addressofconstruction'], true);
            out['发证机关'] = out['备案机关'] || _pickByKeywords(idx, ['发证机关', '发证机关名称', 'issueAuthority', 'issueDept', 'licenseAuthority', 'issuingAuthority', 'authorityName', 'grantOrg', 'authorizeOrgName', 'authorizeorgname', 'issuingauthority'], true);
            out['发证日期'] = out['备案日期'] || _pickDateByKeywords(idx, ['发证日期', '发照日期', 'issueDate', 'licenseDate', 'certificateDate', 'grantDate', 'authorizeDate', 'certDate', 'issuedate', 'licensedate']);
            // 其他
            out['状态'] = _pickByKeywords(idx, ['状态', '当前状态', '项目状态', '证书状态', 'status', 'state', 'permitStatus', 'licenseStatus', 'validStatus', 'auditStatus', 'recordStatus', 'permitstatus', 'licensestatus', 'validity', 'stateofpermit'], true);
            out['备注'] = _pickByKeywords(idx, ['备注', 'remark', 'note', 'notes', 'comment', 'comments', 'description', 'memo', 'beizhu', 'remarks', 'remarkinfo', 'additionalinfo', 'remark1'], true);
            out['数据等级'] = lr['数据等级'] || _pickByKeywords(idx, ['数据等级', '数据分级', 'level', 'grade', 'dataLevel', 'datalevel'], true);
            // 列表行兜底：接口没返回的用 listRow 里有的顶上去
            try {
                var lrKeys = Object.keys(lr);
                for (var lk = 0; lk < lrKeys.length; lk++) {
                    var k = lrKeys[lk];
                    var lv = lr[k];
                    if (!k || !lv || typeof lv !== 'string') continue;
                    if (lv.length < 1 || lv === '--' || lv === '—' || lv === 'N/A') continue;
                    if (k.indexOf('_') === 0) continue;
                    if (!out[k] || out[k] === '') out[k] = lv;
                }
            } catch (eLr) {}
            // 去空
            Object.keys(out).forEach(function (k) { if (out[k] === '' || out[k] === null || out[k] === undefined) delete out[k]; });
            console.log('[api] ✅ complete 映射结果 (字段数=' + Object.keys(out).length + '):', JSON.parse(JSON.stringify(out)));
            return out;
        } catch (bigE) {
            console.error('[api] complete 映射异常:', bigE);
            return {};
        }
    }

    function fetchDetailFromApi(type, code, extra) {
        return new Promise(function (resolve) {
            var tpl = API_TEMPLATES[type];
            if (!tpl) { resolve({ success: false, error: '未知类型: ' + type }); return; }
            if (!code) { resolve({ success: false, error: 'code 为空' }); return; }
            var url = tpl.urlTpl.replace('{code}', encodeURIComponent(String(code)));
            if (url.indexOf('http') !== 0) {
                var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
                url = origin + url;
            }
            console.log('[api] 🚀 fetch: type=' + type + ', code=' + code + ', url=' + url);
            var controller = new AbortController();
            var timeoutTimer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 25000);
            fetch(url, {
                method: tpl.method,
                credentials: 'include',
                headers: API_FETCH_HEADERS,
                signal: controller.signal,
                cache: 'no-store'
            }).then(function (resp) {
                clearTimeout(timeoutTimer);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            }).then(function (rawJson) {
                console.log('[api] 🟢 rawJson(前1500字):', JSON.stringify(rawJson).slice(0, 1500));
                var out = {};
                if (type === 'basic') out = mapBasicFromApi(rawJson, extra && extra.listLevel);
                else if (type === 'permit') out = mapPermitFromApi(rawJson, extra && extra.listLevel, extra && extra.listProjectName);
                else if (type === 'complete') out = mapCompleteFromApi(rawJson, extra && extra.listRow);
                var cnt = Object.keys(out).length;
                resolve({ success: cnt >= 2, data: out, fieldCount: cnt, raw: rawJson });
            }).catch(function (err) {
                clearTimeout(timeoutTimer);
                console.error('[api] ❌ fetch 失败:', err);
                resolve({ success: false, error: (err && err.message) ? err.message : String(err), data: {}, fieldCount: 0 });
            });
        });
    }

    // 从列表行中提取可能存在的数字 ID（如 data-id, data-row-id, tr 的 key=数字, _acceptanceId 等）
    function _extractRowAnyNumericId(tr, recordNoHint) {
        try {
            if (!tr) return '';
            var attrs = tr.attributes || [];
            for (var ai = 0; ai < attrs.length; ai++) {
                try {
                    var a = attrs[ai];
                    var name = (a.name || '').toLowerCase();
                    var val = String(a.value || '');
                    if (/^-?\d{3,}$/.test(val)) return val;
                    if ((name === 'data-id' || name === 'data-row-key' || name === 'rowkey' || name === 'data-rowid' || name === 'data-acceptance-id' || name === 'data-archive-id' || name === 'data-key' || name.indexOf('id') !== -1) && /\d{3,}/.test(val)) {
                        var m = val.match(/\d{3,}/);
                        if (m) return m[0];
                    }
                } catch (eA) {}
            }
            try {
                var rawKey = tr.getAttribute && tr.getAttribute('data-row-key');
                if (rawKey && /^\d+$/.test(rawKey)) return rawKey;
                if (rawKey) {
                    var mm = String(rawKey).match(/^\s*(\d{3,})/);
                    if (mm) return mm[1];
                }
            } catch (eK) {}
            try {
                if (tr.__v_forKey !== undefined) {
                    var vs = String(tr.__v_forKey);
                    var mv = vs.match(/\d{4,}/);
                    if (mv) return mv[0];
                }
            } catch (eV) {}
            try {
                if (tr.__vue__ !== undefined) {
                    try {
                        var vdata = tr.__vue__ && tr.__vue__.$data ? tr.__vue__.$data : null;
                        if (vdata && vdata.row && vdata.row.id) {
                            var rid = String(vdata.row.id);
                            if (/^\d{3,}$/.test(rid)) return rid;
                        }
                        if (vdata && vdata.item && vdata.item.id) {
                            var iid = String(vdata.item.id);
                            if (/^\d{3,}$/.test(iid)) return iid;
                        }
                    } catch (eVue) {}
                }
            } catch (eVV) {}
            try {
                var innerAll = tr.innerHTML || '';
                if (innerAll) {
                    var mInner = innerAll.match(/\b(100\d{4,})\b/);
                    if (mInner) return mInner[1];
                }
            } catch (eInner) {}
            try {
                var allClicks = tr.querySelectorAll('[onclick], [@click], [v-on\\:click], .clickable, [class*="click"], a');
                for (var cci = 0; cci < allClicks.length; cci++) {
                    var el = allClicks[cci];
                    try {
                        var ov = el.outerHTML || '';
                        var mv1 = ov.match(/\b(100\d{4,})\b/);
                        if (mv1) return mv1[1];
                    } catch (eOV) {}
                    try {
                        var oncl = (el.getAttribute && (el.getAttribute('onclick') || el.getAttribute('@click') || el.getAttribute('v-on:click'))) || '';
                        if (oncl) {
                            var mclick = oncl.match(/\b(100\d{4,})\b/);
                            if (mclick) return mclick[1];
                            var m2 = oncl.match(/\b(\d{5,})\b/);
                            if (m2) return m2[1];
                        }
                    } catch (eON) {}
                }
            } catch (eClicks) {}
            try {
                var clickable = tr.querySelector('.clickText') || tr.querySelector('a') || tr.querySelector('[class*="link"]') || tr;
                if (clickable) {
                    var attrs2 = clickable.attributes || [];
                    for (var ci = 0; ci < attrs2.length; ci++) {
                        try {
                            var a2 = attrs2[ci];
                            var v2 = String(a2.value || '');
                            if (/^-?\d{4,}$/.test(v2)) return v2;
                            if ((a2.name || '').toLowerCase().indexOf('id') !== -1) {
                                var m2 = v2.match(/\d{4,}/);
                                if (m2) return m2[0];
                            }
                        } catch (eCA) {}
                    }
                    try {
                        var onclickAttr = clickable.getAttribute && clickable.getAttribute('onclick') || '';
                        if (onclickAttr) {
                            var m3 = onclickAttr.match(/\b(\d{4,})\b/);
                            if (m3) return m3[1];
                        }
                        var vueClick = clickable.getAttribute && (clickable.getAttribute('@click') || clickable.getAttribute('v-on:click')) || '';
                        if (vueClick) {
                            var m4 = vueClick.match(/\b(\d{4,})\b/);
                            if (m4) return m4[1];
                        }
                    } catch (eON) {}
                }
            } catch (eC) {}
            return '';
        } catch (bigE) {
            try {
                if (tr && tr.innerHTML) {
                    var mBig = (tr.innerHTML).match(/\b(100\d{4,})\b/);
                    if (mBig) return mBig[1];
                }
            } catch (e) {}
            return '';
        }
    }

    // ===== 消息通信（所有核心功能）=====
    // 🔴 Guard：极端情况下 chrome / chrome.runtime 可能 undefined（比如非扩展环境下调试），
    //           这里用 try + typeof 判断，绝对不能因为这一步崩了导致整个 DOM 提取方案也跑不了
    (function registerMsgListenersSafely() {
        if (typeof chrome === 'undefined' || !chrome || !chrome.runtime || !chrome.runtime.onMessage) {
            console.warn('[content] ⚠️ chrome.runtime.onMessage 不存在（非扩展环境？），消息监听未注册。DOM 提取仍可用。');
            return;
        }
        try {
            chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        try {
            if (message.action === 'ping') {
                sendResponse({ pong: true });
                return true;
            }
            if (message.action === 'debug') {
                sendResponse({
                    ok: true,
                    url: window.location.href,
                    headers: safeGetHeaders(),
                    hasBasePlate: !!document.querySelector('.plate-wrap.base-info-point, .base-info-point'),
                    plateCount: document.querySelectorAll('.plate-wrap').length,
                    bodySnippet: (document.body ? (document.body.innerText || '').slice(0, 200) : '')
                });
                return true;
            }

            // 纯接口 fetch 拿详情 JSON（0 干扰，不开 tab，不弹 Modal）
            if (message.action === 'fetchDetail') {
                (async function () {
                    try {
                        console.log('[content] 🎯 收到 fetchDetail: type=' + message.type + ', code=' + message.code);
                        var res = await fetchDetailFromApi(message.type, message.code, message.extra || {});
                        try { sendResponse({ success: res.success, data: res.data || {}, fieldCount: res.fieldCount || 0, error: res.error || '', via: 'api-fetch' }); }
                        catch (e) { console.warn('[content] fetchDetail sendResponse fail:', e); }
                    } catch (bigE) {
                        try { sendResponse({ success: false, data: {}, fieldCount: 0, error: String(bigE && bigE.message || bigE) }); } catch (e) {}
                    }
                })();
                return true;
            }

            // 🔴天眼查补全：在 pro.tianyancha.com 域名下执行「suggest→选公司→详情页5字段解析」
            //    返回 { success, data: { companyName(匹配到的实际全名), creditCode(统一社会信用代码), phone, legalPerson(法人), address, establishDate }, error, companyId }
            if (message.action === 'queryTianyancha') {
                (async function () {
                    try {
                        var queryName = String(message.companyName || '').trim();
                        var matchMode = String(message.matchMode || 'smart').trim();
                        if (!queryName) { try { sendResponse({ success: false, error: 'queryName 空' }); } catch (e) {} return; }
                        // 不在天眼查域名，拒绝执行（避免跨域/误伤）
                        var host = (window.location.hostname || '').toLowerCase();
                        if (host.indexOf('tianyancha.com') === -1) {
                            try { sendResponse({ success: false, error: '当前页非天眼查域名(host=' + host + ')' }); } catch (e) {} return;
                        }
                        // ========== Step 1: suggest.json 自动补全（带 HTTP 状态校验 + 1 次重试，应对天眼查临时 403/风控）==========
                        var origin2 = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || 'https://pro.tianyancha.com';
                        var ts = Date.now();
                        var suggestUrl = origin2 + '/fd-search/search/company/suggest.json?key=' + encodeURIComponent(queryName) + '&_=' + ts;
                        var suggestJson = null;
                        var suggestHttpStatus = 0;
                        var suggestRawText = '';
                        var suggestErr = '';
                        var SG_MAX_RETRY = 1; // 总共 1 + SG_MAX_RETRY = 2 次
                        for (var sgAttempt = 0; sgAttempt <= SG_MAX_RETRY; sgAttempt++) {
                            try {
                                if (sgAttempt > 0) {
                                    await new Promise(function (rsSG) { setTimeout(rsSG, 900 + Math.floor(Math.random() * 700)); });
                                }
                                var sgText = await new Promise(function (rs, rj) {
                                    try {
                                        var x = new XMLHttpRequest();
                                        x.open('GET', suggestUrl + (sgAttempt > 0 ? ('&__r=' + sgAttempt) : ''), true);
                                        x.withCredentials = true;
                                        x.setRequestHeader('Accept', 'application/json, text/plain, */*');
                                        x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                                        x.onload = function () {
                                            suggestHttpStatus = x.status || 0;
                                            if (suggestHttpStatus >= 200 && suggestHttpStatus < 400) {
                                                rs(x.responseText || '');
                                            } else {
                                                var prev = String(x.responseText || '').replace(/\s+/g, ' ').slice(0, 120);
                                                rj(new Error('suggest HTTP ' + suggestHttpStatus + (prev ? (' | ' + prev) : '')));
                                            }
                                        };
                                        x.onerror = function () { rj(new Error('suggest xhr onerror (CORS/风控/网络拦截)')); };
                                        x.timeout = 18000;
                                        x.ontimeout = function () { rj(new Error('suggest xhr timeout')); };
                                        x.send(null);
                                    } catch (eInr) { rj(eInr); }
                                });
                                suggestRawText = String(sgText || '').slice(0, 200);
                                try {
                                    suggestJson = JSON.parse(sgText || '{}');
                                    suggestErr = '';
                                    break; // 成功跳出
                                } catch (ep) {
                                    suggestErr = 'suggest parse fail: ' + (ep && ep.message || String(ep));
                                    suggestJson = null;
                                    // 解析失败 → 重试也没意义（格式不对），直接跳出循环用后面的 DOM/搜索页兜底
                                    break;
                                }
                            } catch (eSug) {
                                suggestErr = String(eSug && eSug.message || eSug);
                                // 最后一次失败，保留错误；否则继续重试
                                if (sgAttempt === SG_MAX_RETRY) {
                                    suggestJson = null;
                                } else {
                                    // 重试前清空，防止污染
                                    suggestJson = null;
                                    suggestRawText = '';
                                }
                            }
                        }
                        // 从 suggest 响应里抽 [{id, name}] 数组
                        var candidates = [];
                        (function pullCandidates(obj) {
                            try {
                                if (!obj || typeof obj !== 'object') return;
                                if (Array.isArray(obj)) { for (var ai2 = 0; ai2 < obj.length; ai2++) pullCandidates(obj[ai2]); return; }
                                var hasId = (obj.id || obj._id || obj.companyId || obj.data_id) !== undefined && (obj.id || obj._id || obj.companyId || obj.data_id) !== null && String(obj.id || obj._id || obj.companyId || obj.data_id) !== '';
                                var hasName = (obj.name || obj.companyName || obj.title || obj.js_text || obj.text || obj['js-text']) !== undefined;
                                if (hasId && hasName) {
                                    var cid = String(obj.id || obj._id || obj.companyId || obj.data_id || '').trim();
                                    var cname = String(obj.name || obj.companyName || obj.title || obj.js_text || obj.text || obj['js-text'] || '').trim();
                                    if (cid && cname && candidates.every(function (c) { return c.id !== cid; })) {
                                        try { cname = cname.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); } catch (eStrip) {}
                                        candidates.push({ id: cid, name: cname });
                                    }
                                }
                                var ks2 = Object.keys(obj);
                                for (var ki2 = 0; ki2 < ks2.length; ki2++) pullCandidates(obj[ks2[ki2]]);
                            } catch (ePull) {}
                        })(suggestJson);
                        // 如果 suggest.json 没捞到 → 兜底1：从当前 DOM 的下拉/历史抽；兜底2：天眼查搜索页 HTML 抓 companyId
                        if (candidates.length === 0) {
                            try {
                                var lis = document.querySelectorAll('li.toPageLi, li[data_id]');
                                for (var liI = 0; liI < Math.min(lis.length, 8); liI++) {
                                    var li = lis[liI];
                                    var did = String(li.getAttribute && li.getAttribute('data_id') ? li.getAttribute('data_id') : (li.dataset && li.dataset.id ? li.dataset.id : '') || '').trim();
                                    var txt = (li.innerText || li.textContent || '').replace(/\s+/g, ' ').trim();
                                    if (did && txt && candidates.every(function (c) { return c.id !== did; })) candidates.push({ id: did, name: txt });
                                }
                            } catch (eLis) {}
                        }
                        // 兜底2：fetch 天眼查搜索页，从搜索结果里抽 href="/company/{id}" 第一个结果（带 HTTP 校验 + 1 次重试）
                        if (candidates.length === 0) {
                            try {
                                var SEARCH_MAX = 1;
                                var searchHtml = '';
                                var searchUrl = origin2 + '/search?key=' + encodeURIComponent(queryName);
                                for (var sa = 0; sa <= SEARCH_MAX; sa++) {
                                    try {
                                        if (sa > 0) await new Promise(function (rss) { setTimeout(rss, 1100 + Math.floor(Math.random() * 700)); });
                                        var oneSh = await new Promise(function (rs2, rj2) {
                                            try {
                                                var sxp = new XMLHttpRequest();
                                                sxp.open('GET', searchUrl + (sa > 0 ? ('&__r=' + sa) : ''), true);
                                                sxp.withCredentials = true;
                                                sxp.setRequestHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
                                                sxp.timeout = 22000;
                                                sxp.onload = function () {
                                                    var ss = sxp.status || 0;
                                                    if (ss >= 200 && ss < 400) { rs2(sxp.responseText || ''); }
                                                    else { rj2(new Error('search HTTP ' + ss)); }
                                                };
                                                sxp.onerror = function () { rj2(new Error('search xhr onerror')); };
                                                sxp.ontimeout = function () { rj2(new Error('search xhr timeout')); };
                                                sxp.send(null);
                                            } catch (e) { rj2(e); }
                                        });
                                        if (oneSh && oneSh.length > 2000) { // 太短的 HTML 可能是风控页/跳转页
                                            searchHtml = oneSh;
                                            break;
                                        }
                                    } catch (eSearchAt) {
                                        // 搜索页本次尝试失败，进入下一轮
                                    }
                                }
                                if (searchHtml) {
                                    var sp2 = new DOMParser();
                                    var sdoc = sp2.parseFromString(searchHtml, 'text/html');
                                    try {
                                        var alinks = sdoc.querySelectorAll ? sdoc.querySelectorAll('a[href*="/company/"], a[href*="/business/"]') : [];
                                        for (var ali = 0; ali < Math.min(alinks.length, 30); ali++) {
                                            var hrefA = String(alinks[ali].getAttribute && alinks[ali].getAttribute('href') ? alinks[ali].getAttribute('href') : '').trim();
                                            var mm = hrefA.match(/\/(?:company|business)\/(\d+)/);
                                            if (mm) {
                                                var tName = (alinks[ali].innerText || alinks[ali].textContent || '').replace(/\s+/g, ' ').trim();
                                                if (!tName) tName = queryName;
                                                var idA = mm[1];
                                                if (idA && candidates.every(function (c) { return c.id !== idA; })) candidates.push({ id: idA, name: tName });
                                            }
                                        }
                                    } catch (eparse) {}
                                    // 正则兜底：搜索结果里直接出现 /company/12345
                                    if (candidates.length === 0) {
                                        var rids = searchHtml.match(/\/(?:company|business)\/(\d+)/g) || [];
                                        var rnames = [];
                                        try {
                                            var mt;
                                            var reAnchor = /<a[^>]+href=["']?\/(?:company|business)\/(\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
                                            while ((mt = reAnchor.exec(searchHtml)) !== null) {
                                                var plain = String(mt[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                                                rnames.push({ id: mt[1], name: plain || queryName });
                                            }
                                        } catch (e2) {}
                                        for (var ki = 0; ki < rnames.length && candidates.length < 10; ki++) {
                                            if (rnames[ki].id && rnames[ki].name && candidates.every(function (c) { return c.id !== rnames[ki].id; })) candidates.push(rnames[ki]);
                                        }
                                    }
                                }
                            } catch (eSearchFallback) {  }
                        }
                        // ========== Step 2: 按 matchMode 选一个候选 ==========
                        function normCoName(s) { try { return String(s || '').toLowerCase().replace(/\s+/g,'').replace(/[（(].*?[)）]/g,'').replace(/[·・\-—_.,，。、:：；;！!？?"'""'`~@#$%^&*+=<>\\\/{}\[\]|]/g,''); } catch (e) { return String(s || ''); } }
                        var chosen = null;
                        var similarity = 0;
                        var qN = normCoName(queryName);
                        function calcSim(a, b) {
                            if (!a || !b) return 0;
                            if (a === b) return 1;
                            if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
                                var shorter = Math.min(a.length, b.length);
                                var longer = Math.max(a.length, b.length);
                                return longer ? (shorter / longer) : 0;
                            }
                            var same = 0;
                            for (var ci = 0; ci < a.length; ci++) { if (b.indexOf(a.charAt(ci)) !== -1) same++; }
                            return (a.length + b.length) ? (2 * same / (a.length + b.length)) : 0;
                        }
                        if (candidates.length > 0) {
                            var bestI = -1, bestSim = 0;
                            for (var ci3 = 0; ci3 < candidates.length; ci3++) {
                                var cN = normCoName(candidates[ci3].name);
                                var sim = calcSim(qN, cN);
                                if (cN === qN) { chosen = candidates[ci3]; similarity = 1; break; }
                                if (sim > bestSim) { bestSim = sim; bestI = ci3; }
                            }
                            if (!chosen && bestI !== -1) {
                                if (matchMode === 'strict') {
                                    // strict 模式必须完全相等，否则不选
                                } else if (matchMode === 'first') {
                                    chosen = candidates[0];
                                    similarity = calcSim(qN, normCoName(candidates[0].name));
                                } else {
                                    // smart: 相似度 ≥0.7 才接受（否则用户可能搜索了"广州南沙开发建设"→ 但 suggest 里是另一家"南沙XX"，避免乱填）
                                    if (bestSim >= 0.7) { chosen = candidates[bestI]; similarity = bestSim; }
                                }
                            }
                        }
                        // 仍没命中：fallback 到 queryName 本身直接当详情URL？不行，详情必须数字ID；只能失败返回
                        if (!chosen) {
                            var bestSimReported = bestSim || 0;
                            var errDetail = '未命中候选列表(候选' + candidates.length + '条，matchMode=' + matchMode + '，bestSim=' + bestSimReported.toFixed(3) + '，suggestHttp=' + suggestHttpStatus + (suggestErr ? '，suggestErr=' + suggestErr : '') + (suggestRawText ? '，raw=' + JSON.stringify(suggestRawText) : '') + ')';
                            try { sendResponse({ success: false, error: errDetail, candidatesCount: candidates.length, suggestHttpStatus: suggestHttpStatus, suggestErr: suggestErr, suggestRawText: suggestRawText, firstCandidateNames: (candidates.slice(0, 5).map(function (c) { return c.name; })).join(' / ') }); } catch (e) {}
                            return;
                        }
                        var companyId = String(chosen.id || '').trim();
                        var matchedName = chosen.name || '';
                        // ========== Step 3: 取详情（两种方式：A. 已有 header 在当前页直接抓 /company/{id} 详情 JSON；B. fetch 详情页 HTML + DOM 解析） ==========
                        function parseDetailFromHtml(htmlStr) {
                            var out = { creditCode: '', phone: '', legalPerson: '', address: '', establishDate: '' };
                            function sanitizeLegalPerson(raw) {
                                try {
                                    var s = String(raw || '').replace(/\s+/g, ' ').trim();
                                    if (!s) return '';
                                    // 清除天眼查法人字段常见冗余尾部：
                                    //   「复制」「关联企业12」「关联企业12复制」「关注TA」「私信」「 查看简历 」等
                                    s = s.replace(/(复制|关注\s*T\s*A|私信|查看简历|企业名片|公司名片|工商信息|对外投资|任职信息|最新新闻|失信|被执行人|限制高消费|开庭公告|法院公告|裁判文书|行政处罚|环保处罚|税务违法|动产抵押|股权出质|网站备案|招聘|商标|专利|著作权|备案|年报|股东|主要人员|变更记录|公司热度|竞品|竞品公司)$/gi, '').trim();
                                    // 反复清洗（可能存在"关联企业13复制"，一次尾部正则可能只打掉一半）
                                    var keep = '';
                                    for (var guard = 0; guard < 6 && keep !== s; guard++) {
                                        keep = s;
                                        // 「关联企业」+ 可选数字（含中文数字）+ 可选「复制/关注/私信 等」尾
                                        s = s.replace(/(关联(?:企业|公司|机构|公司企业)?)\s*[0-9零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]*\s*(复制|关注\s*T\s*A|私信|查看简历)?\s*$/gi, '').trim();
                                        s = s.replace(/(复制|关注\s*T\s*A|私信|查看简历)$/gi, '').trim();
                                    }
                                    // 如果最后剩纯标点/空白或只有"法定代表人"等标签 → 清掉
                                    s = s.replace(/^(法定代表人|法人|法定代表|负责人|投资人|股东|董事长|执行董事|首席合伙人|总经理)\s*[:：\-\s]*/i, '').trim();
                                    // 只保留中文、字母、数字、·・空格、（）() 等常用姓名合法字符（丢 emoji / 奇怪字符）
                                    s = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9·・\.\s（）()\-—_]/g, '').trim();
                                    return s;
                                } catch (e) { return String(raw || '').trim(); }
                            }
                            try {
                                var dp = new DOMParser();
                                var ddoc = dp.parseFromString(htmlStr || '', 'text/html');
                                if (!ddoc || !ddoc.body) return out;
                                function pickText(selector, root) {
                                    try {
                                        var scope = root || ddoc;
                                        var el = scope.querySelector ? scope.querySelector(selector) : null;
                                        if (!el) return '';
                                        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                                    } catch (e) { return ''; }
                                }
                                function pickAllText(selector, root) {
                                    try {
                                        var scope = root || ddoc;
                                        var nl = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];
                                        var arr = [];
                                        for (var w = 0; w < nl.length; w++) {
                                            var t = (nl[w].innerText || nl[w].textContent || '').replace(/\s+/g, ' ').trim();
                                            if (t) arr.push(t);
                                        }
                                        return arr;
                                    } catch (e) { return []; }
                                }
                                // 按「标签文本」找对应 value：天眼查 header 是 label + value 的结构，列数不固定
                                //   keywords: ['标签1','标签2',...] 任一命中即返回对应 value
                                //   excludeSuffix: 从 value 尾部切掉的关键字（如"复制""更多""附近企业"）
                                //   fieldHint: 'tel'/'email'/'addr'/'ccode'/undefined → 只取对应类别的专属节点（防止电话栏里抽出邮箱）
                                function pickByLabel(keywords, excludeSuffix, fieldHint) {
                                    try {
                                        if (!keywords || !keywords.length) return '';
                                        var kws = keywords.map(function (k) { return String(k || '').trim(); }).filter(Boolean);
                                        if (!kws.length) return '';
                                        var hint = String(fieldHint || '').toLowerCase();
                                        // 天眼查 header 固定容器范围：detail-content → 3 个 detail-item（first/second/third）
                                        var scope = ddoc.querySelector('.index_detail-content__RCnTr') || ddoc.querySelector('#J_CompanyHeaderContent') || ddoc;
                                        var infoItems = scope.querySelectorAll ? scope.querySelectorAll('.index_detail-info-item__oAOqL, [class*="detail-info-item"]') : [];
                                        for (var idx = 0; idx < infoItems.length; idx++) {
                                            var it = infoItems[idx];
                                            var raw = (it.innerText || it.textContent || '').replace(/\s+/g, ' ').trim();
                                            if (!raw) continue;
                                            var hit = false;
                                            var labelEnd = -1;
                                            for (var ki = 0; ki < kws.length; ki++) {
                                                var kw = kws[ki];
                                                // 1) 优先找独立 label 节点（class 含 "detail-label"）里精确匹配（避免"法定代表人"误吃"法人"）
                                                var labelEls = it.querySelectorAll('[class*="detail-label"]');
                                                var matchedLabelNode = null;
                                                for (var li = 0; li < labelEls.length; li++) {
                                                    var lt = (labelEls[li].innerText || labelEls[li].textContent || '').replace(/\s+/g, '').replace(/[:：]/g, '');
                                                    if (lt && (lt === kw || lt.indexOf(kw) !== -1 || kw.indexOf(lt) !== -1)) {
                                                        matchedLabelNode = labelEls[li];
                                                        break;
                                                    }
                                                }
                                                if (matchedLabelNode) {
                                                    hit = true;
                                                    break;
                                                }
                                                // 2) 兜底：整个 info-item 文本前缀包含 "关键字："
                                                var re = new RegExp('^\\s*' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]');
                                                if (re.test(raw)) {
                                                    hit = true;
                                                    var pos = raw.indexOf('：');
                                                    if (pos === -1) pos = raw.indexOf(':');
                                                    labelEnd = pos;
                                                    break;
                                                }
                                            }
                                            if (!hit) continue;
                                            // 命中 → 取这个 info-item 的 value
                                            // 策略：按 fieldHint 只取对应类别专属 value 节点（防止「电话」标签下的「-」命中不了，却去旁边「邮箱」标签抽 mailto 链接）
                                            var valueText = '';
                                            if (hint === 'addr') {
                                                var addrNode = it.querySelector('[class*="detail-address-text"], [class*="address-moretext"], [class*="detail-address-content"]');
                                                if (addrNode) valueText = (addrNode.innerText || addrNode.textContent || '').replace(/\s+/g, ' ').trim();
                                            } else if (hint === 'tel') {
                                                var telNode = it.querySelector('[class*="detail-tel"] [class*="detail-tel"], [class*="detail-tel__"], [class*="phone__"], a[href^="tel:"]');
                                                if (telNode) valueText = (telNode.innerText || telNode.textContent || '').replace(/\s+/g, ' ').trim();
                                            } else if (hint === 'email') {
                                                var emailNode = it.querySelector('[class*="detail-email__"], a[href^="mailto:"]');
                                                if (emailNode) valueText = (emailNode.innerText || emailNode.textContent || '').replace(/\s+/g, ' ').trim();
                                            } else if (hint === 'ccode') {
                                                var ccNode = it.querySelector('[class*="detail-credit-code"]');
                                                if (ccNode) valueText = (ccNode.innerText || ccNode.textContent || '').replace(/\s+/g, ' ').trim();
                                            }
                                            // 兜底通用：没 hint 或 hint 对应节点没抽到 → 从 info-item 文本扣 label / 扣操作按钮尾巴
                                            if (!valueText) {
                                                var labelTxt = '';
                                                var ll = it.querySelectorAll('[class*="detail-label"]');
                                                for (var lli = 0; lli < ll.length; lli++) labelTxt += (ll[lli].innerText || ll[lli].textContent || '') + ' ';
                                                labelTxt = labelTxt.replace(/\s+/g, ' ').trim();
                                                valueText = raw;
                                                if (labelTxt) valueText = valueText.split(labelTxt).slice(-1).join('').trim();
                                                else if (labelEnd !== -1) valueText = valueText.slice(labelEnd + 1).trim();
                                            }
                                            // 去掉尾部操作/冗余词（复制、更多、附近企业、N 等）
                                            if (valueText) {
                                                var cuts = Array.isArray(excludeSuffix) && excludeSuffix.length ? excludeSuffix.slice() : ['复制', '关注TA', '私信', '查看简历'];
                                                cuts = cuts.concat(['附近企业', '更多', '企业名片', '查看地图']);
                                                for (var ci = 0; ci < cuts.length; ci++) {
                                                    var c = cuts[ci];
                                                    var cidx = valueText.lastIndexOf(c);
                                                    if (cidx !== -1) valueText = valueText.slice(0, cidx).trim();
                                                }
                                                valueText = valueText.replace(/\s+\d+\s*$/, '').trim();
                                                valueText = valueText.replace(/^[-—_|:：]+\s*/, '').trim();
                                            }
                                            if (valueText) return valueText;
                                        }
                                        return '';
                                    } catch (e) { return ''; }
                                }
                                // 1) 统一社会信用代码
                                var trySel = [
                                    '.index_detail-credit-code__fH1Ny',
                                    '.index_company-header-content__Ayzr2 .index_detail-credit-code__fH1Ny span',
                                    '[class*="creditcode"]', '[class*="credit-code"]',
                                    '#J_CompanyHeaderContent .index_detail-item-first__IS2_h .index_detail-info-item__oAOqL:first-child span span'
                                ];
                                for (var si = 0; si < trySel.length; si++) { var v = pickText(trySel[si]); if (v && /[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/.test(v)) { out.creditCode = v.match(/[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/)[0]; break; } }
                                if (!out.creditCode) {
                                    var byCC = pickByLabel(['统一社会信用代码', '社会信用代码', '统一信用代码', '信用代码', '组织机构代码', '工商注册号'], null, 'ccode');
                                    if (byCC) {
                                        var mCC = byCC.match(/[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/);
                                        if (mCC) out.creditCode = mCC[0];
                                    }
                                }
                                // 2) 法人
                                var lpSel = [
                                    '.index_legal-person-root__THrdz .index_link-click__NmHxP, .index_legal-person-root__THrdz .index_detail-value___x7WE',
                                    '#J_CompanyHeaderContent [class*="legal"] a, #J_CompanyHeaderContent [class*="legal"] [class*="value"]',
                                    '[class*="legalperson"] [class*="link-click"], [class*="legalPerson"] a'
                                ];
                                for (var si2 = 0; si2 < lpSel.length; si2++) { var v2 = pickText(lpSel[si2]); if (v2) { out.legalPerson = sanitizeLegalPerson(v2); break; } }
                                if (!out.legalPerson) {
                                    var byLP = pickByLabel(['法定代表人', '法人', '法定代表', '执行事务合伙人', '负责人', '投资人', '首席合伙人']);
                                    if (byLP) out.legalPerson = sanitizeLegalPerson(byLP);
                                }
                                // 3) 成立日期（不再硬编码 nth-of-type(4)，按标签文本扫描，列数任意变化都不怕）
                                var edSel = [
                                    '.index_detail-item-first__IS2_h .index_detail-info-item__oAOqL:nth-of-type(4) .index_detail-text__Ac9Py, .index_detail-item-first__IS2_h .index_detail-info-item__oAOqL:nth-of-type(4) .index_copy-val__Qdkxu',
                                    '#J_CompanyHeaderContent [class*="detail-item-first"] span:has(> :nth-child(4)) .index_detail-text__Ac9Py',
                                    '[class*="establish"] [class*="text"], [class*="establishDate"]'
                                ];
                                for (var si3 = 0; si3 < edSel.length; si3++) {
                                    var v3 = pickText(edSel[si3]);
                                    if (!v3) continue;
                                    var m3 = v3.match(/\d{4}[\-\/年.]\d{1,2}[\-\/月.]\d{1,2}/);
                                    if (m3) { out.establishDate = m3[0].replace(/[年月.]/g,'-').replace(/\/+/g,'-').replace(/\-+/g,'-').replace(/日/g,''); break; }
                                }
                                if (!out.establishDate) {
                                    var byED = pickByLabel(['成立日期', '成立时间', '注册日期', '登记日期', '核准日期', '发证日期']);
                                    if (byED) {
                                        var mED = byED.match(/\d{4}[\-\/年.]\d{1,2}[\-\/月.]\d{1,2}/);
                                        if (mED) out.establishDate = mED[0].replace(/[年月.]/g,'-').replace(/\/+/g,'-').replace(/\-+/g,'-').replace(/日/g,'');
                                    }
                                }
                                // 4) 电话（含格式校验：包含 @ 的直接丢掉；多号码取第 1 个非空）
                                function sanitizePhone(raw) {
                                    try {
                                        var s = String(raw || '').replace(/\s+/g, '').trim();
                                        if (!s) return '';
                                        // 明确拒绝邮箱、纯横线 - 等占位符
                                        if (/[@＠]/.test(s)) return '';
                                        if (/^[-—_|:：,.，。；;]+$/.test(s)) return '';
                                        // 如果有多个号码（逗号/分号分隔），取第一个非空
                                        var parts = s.split(/[,，;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
                                        if (!parts.length) return '';
                                        // 取第一个含数字的（过滤掉空字符串占位）
                                        for (var pi = 0; pi < parts.length; pi++) {
                                            if (/\d/.test(parts[pi])) return parts[pi];
                                        }
                                        return '';
                                    } catch (e) { return ''; }
                                }
                                var telSel = [
                                    '.index_detail-tel__fgpsE',
                                    '.index_detail-tel-content__nZ54h .index_detail-tel__fgpsE',
                                    '[class*="detail-tel-content"] [class*="detail-tel"]',
                                    '[class*="telContent"] [class*="tel"], [class*="phone"]'
                                ];
                                for (var si4 = 0; si4 < telSel.length; si4++) { var v4 = pickText(telSel[si4]); if (v4) { var sp4 = sanitizePhone(v4); if (sp4) { out.phone = sp4; break; } } }
                                if (!out.phone) {
                                    var byTel = pickByLabel(['电话', '座机', '联系电话'], null, 'tel');
                                    if (byTel) out.phone = sanitizePhone(byTel);
                                }
                                // 5) 地址（修复：加入短地址 -text- 类 + 标签文本扫描兜底；并且会自动切掉"附近企业 4"的尾部数字）
                                var addrSel = [
                                    '.index_detail-address-text__AaSjA',
                                    '.index_detail-address-moretext__9R_Z1',
                                    '.index_-address__Ai6MB .index_address-flex__umT58 .index_detail-address-text__AaSjA, .index_-address__Ai6MB .index_address-flex__umT58 .index_detail-address-moretext__9R_Z1',
                                    '[class*="detail-address-text"]',
                                    '[class*="detail-address-moretext"]',
                                    '[class*="address-moretext"]',
                                    '#J_CompanyHeaderContent [class*="-address"] [class*="address-flex"] [class*="text"], #J_CompanyHeaderContent [class*="-address"] [class*="address-flex"] [class*="moretext"]'
                                ];
                                for (var si5 = 0; si5 < addrSel.length; si5++) { var v5 = pickText(addrSel[si5]); if (v5) { out.address = v5; break; } }
                                if (!out.address) {
                                    var byAddr = pickByLabel(['地址', '注册地址', '企业地址', '公司地址', '办公地址', '经营地址'], null, 'addr');
                                    if (byAddr) out.address = byAddr;
                                }
                            } catch (eBigParse) {  }
                            return out;
                        }
                        var detailData = { creditCode: '', phone: '', legalPerson: '', address: '', establishDate: '' };
                        var detailVia = '';
                        var detailLastError = '';
                        // 优先 A：当前已经是这家公司的详情页（并且 URL 就是 id 匹配），直接从 document DOM 解析
                        try {
                            var curUrl = window.location.href || '';
                            var idFromUrl = '';
                            var mUrl = curUrl.match(/tianyancha\.com\/(?:company|search|business)\/(\d+)/i);
                            if (mUrl) idFromUrl = mUrl[1];
                            if (idFromUrl && idFromUrl === companyId) {
                                detailData = parseDetailFromHtml('<!doctype><html>' + (document.documentElement ? document.documentElement.outerHTML : document.body ? document.body.outerHTML : ''));
                                detailVia = 'current-dom';
                            }
                        } catch (eCur) {}
                        // 兜底 B：XHR 拉详情页 HTML（带 HTTP 状态校验 + 最多 2 次重试，解决「天眼查临时 403/风控 → 第二次再查就过」）
                        if (!detailVia) {
                            var detailUrl = origin2 + '/company/' + encodeURIComponent(companyId);
                            var MAX_RETRY = 2; // 总共尝试 1 + MAX_RETRY = 3 次
                            for (var attempt = 0; attempt <= MAX_RETRY; attempt++) {
                                try {
                                    if (attempt > 0) {
                                        // 重试间隔：1200ms + 0~800ms 抖动，避开固定频率被风控
                                        await new Promise(function (rsl) { setTimeout(rsl, 1200 + Math.floor(Math.random() * 800)); });
                                    }
                                    var attemptResult = await new Promise(function (rsd, rjd) {
                                        try {
                                            var xd = new XMLHttpRequest();
                                            xd.open('GET', detailUrl, true);
                                            xd.withCredentials = true;
                                            xd.setRequestHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
                                            xd.onload = function () {
                                                var st = xd.status || 0;
                                                // 200/2xx/304 算成功；302/301 跳到登录 → 失败；403/429/5xx → 失败；0（浏览器 CORS 拦截）→ 失败
                                                if (st >= 200 && st < 400) {
                                                    rsd({ ok: true, httpStatus: st, html: xd.responseText || '' });
                                                } else {
                                                    var preview = String(xd.responseText || '').replace(/\s+/g, ' ').slice(0, 120);
                                                    rjd(new Error('HTTP ' + st + (preview ? (' | ' + preview) : '')));
                                                }
                                            };
                                            xd.onerror = function () { rjd(new Error('xhr onerror (CORS/网络拦截/被风控封)')); };
                                            xd.timeout = 25000;
                                            xd.ontimeout = function () { rjd(new Error('xhr timeout (' + xd.timeout + 'ms)')); };
                                            xd.send(null);
                                        } catch (eInner) { rjd(eInner); }
                                    });
                                    var parsed = parseDetailFromHtml(attemptResult.html || '');
                                    var parsedFilled = !!(parsed.creditCode || parsed.phone || parsed.legalPerson || parsed.address || parsed.establishDate);
                                    if (!parsedFilled) {
                                        // HTML 取回来了但全空字段 → 可能是风控页（"请完成验证"）/ 登录跳转页 / 接口返回了空壳
                                        // → 这种情况也当失败，进入重试
                                        var htmlSample = String(attemptResult.html || '').replace(/\s+/g, ' ').slice(0, 200);
                                        throw new Error('详情HTML字段全空（可能风控/未登录/返回登录页） | HTTP ' + attemptResult.httpStatus + ' | snippet=' + htmlSample);
                                    }
                                    detailData = parsed;
                                    detailVia = 'xhr-html' + (attempt > 0 ? ('-retry' + attempt) : '');
                                    detailLastError = '';
                                    break; // 成功，跳出重试
                                } catch (eDetail) {
                                    detailLastError = (eDetail && eDetail.message ? eDetail.message : String(eDetail || ''));
                                }
                            }
                            if (!detailVia) {
                                detailVia = 'failed';
                            }
                        }
                        // ========== Step 4: 组装返回 ==========
                        var anyFilled = !!(detailData.creditCode || detailData.phone || detailData.legalPerson || detailData.address || detailData.establishDate);
                        var payload = {
                            companyName: matchedName,
                            queryName: queryName,
                            companyId: companyId,
                            similarity: Number(similarity) || 0,
                            candidatesCount: candidates.length,
                            matchMode: matchMode,
                            detailVia: detailVia,
                            detailLastError: detailLastError || '',
                            creditCode: detailData.creditCode || '',
                            phone: detailData.phone || '',
                            legalPerson: detailData.legalPerson || '',
                            address: detailData.address || '',
                            establishDate: detailData.establishDate || ''
                        };
                        var finalErr = '';
                        if (!anyFilled) {
                            if (detailVia === 'failed') {
                                finalErr = '详情抓取失败' + (detailLastError ? ('：' + detailLastError.replace(/\s+/g, ' ').slice(0, 180)) : '');
                            } else {
                                finalErr = '详情页无字段';
                            }
                        }
                        try { sendResponse({ success: anyFilled ? true : (detailVia === 'failed' ? false : true), data: payload, error: finalErr, via: detailVia, detailLastError: detailLastError || '' }); }
                        catch (eSe) {  }
                    } catch (tycBig) {
                        try { sendResponse({ success: false, error: String(tycBig && tycBig.message || tycBig) }); } catch (e) {}
                    }
                })();
                return true; // 异步
            }

            // 🔴 仿真点击消息：已完全弃用，直接返回失败
            if (message.action === 'findClickRow' || message.action === 'extractCompleteModal') {
                try { sendResponse({ success: false, data: {}, error: '仿真点击已弃用', via: 'deprecated' }); } catch (e) {}
                return false;
            }
            if (message.action === 'checkPage') {
                var listType = isListPage();
                var detailType = isDetailPage();
                if (listType) {
                    var map = { '1': 'basic', '5': 'permit', '6': 'complete' };
                    sendResponse({ valid: map[listType] === message.type, pageType: 'list', listKind: map[listType] });
                } else if (detailType) {
                    sendResponse({ valid: detailType === message.type, pageType: 'detail', detailKind: detailType });
                } else {
                    var url = window.location.href;
                    if (url.indexOf('skypt.gdcic.net') !== -1) {
                        sendResponse({ valid: false, pageType: 'unknown', url: url });
                    } else {
                        sendResponse({ valid: false, pageType: 'other' });
                    }
                }
                return true;
            }

            // 🔴✅ 需求3：获取当前页面信息（当前页码 + 总行数/总页数）
            if (message.action === 'getPageInfo') {
                try {
                    var curP = Number(getCurrentPage()) || 1;
                    var curRows = getTableRows().length;
                    var totalP = 1;
                    try {
                        // 尝试读 pagination 里显示的总页数（比如"共XX页"或最后一个数字按钮的数值）
                        var pgItems = document.querySelectorAll('.ant-pagination-item, .el-pagination .number, [class*="pagination"] [class*="item"]');
                        for (var pi = pgItems.length - 1; pi >= 0; pi--) {
                            var txt2 = (pgItems[pi].innerText || pgItems[pi].textContent || '').trim();
                            if (/^\d+$/.test(txt2)) { var nn = parseInt(txt2); if (nn > totalP) totalP = nn; }
                        }
                        // 优先找「共 X 页 / 总页数 X」这种文字
                        var totalTxt = (document.body ? (document.body.innerText || '') : '').match(/共\s*(\d+)\s*页|总页数\s*[:：]?\s*(\d+)|页数\s*[:：]\s*(\d+)/);
                        if (totalTxt) {
                            var foundN = Number(totalTxt[1] || totalTxt[2] || totalTxt[3]) || 0;
                            if (foundN > 1) totalP = Math.max(totalP, foundN);
                        }
                    } catch (eTp) {}
                    if (totalP < 1) totalP = 1;
                    var resp = { currentPage: curP, totalPages: totalP, rowCount: curRows, url: window.location.href };
                    console.log('[content] 📄 getPageInfo 返回:', resp);
                    sendResponse(resp);
                } catch (e) {
                    console.error('[content] getPageInfo 异常:', e);
                    sendResponse({ currentPage: 1, totalPages: 1, rowCount: 0, error: String(e.message || e) });
                }
                return true;
            }

            // 🔴 「获取全部数据」第1步：预请求 probeTotal（1条/pageSize=1，无验证码）拿到 total + hasFilter
            if (message.action === 'probeTotal') {
                (async function () {
                    try {
                        var msgType = message.type;
                        var cfg = _getApiListConfig(msgType);
                        if (!cfg) { sendResponse({ success: false, error: '未知 type=' + msgType, total: 0, hasFilter: false }); return; }
                        var fp = collectSmartFilterParams(msgType);
                        // 🔴 融合 popup 传过来的筛选（统一走公共函数）
                        var extraFp = (message && message.filters && typeof message.filters === 'object') ? message.filters : {};
                        fp = _mergePopupFiltersIntoFp(msgType, fp, extraFp);
                        var hasFilter = _hasAnyFilter(fp);
                        var origin = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || window.location.origin || 'https://skypt.gdcic.net';
                        var filterQs = _buildFilterQueryString(fp);
                        var probeUrl = origin + cfg.path + '?pageNum=1&pageSize=1&kaptcha=&kaptchaKey=&flag=false' + filterQs;
                        console.log('[content:probeTotal] type=' + msgType + ', hasFilter=' + hasFilter + ', url=' + probeUrl);
                        try {
                            var pXhr = new XMLHttpRequest();
                            pXhr.open('GET', probeUrl, true);
                            pXhr.withCredentials = true;
                            pXhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
                            pXhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                            pXhr.onload = function () {
                                try {
                                    var pText = pXhr.responseText || '';
                                    var pJson = {};
                                    try { pJson = JSON.parse(pText || '{}'); } catch (eP) {}
                                    var probeTotal = parseInt(String(pJson && (pJson.total || (pJson.data && pJson.data.total)) || 0)) || 0;
                                    console.log('[content:probeTotal] 返回 total=' + probeTotal + ', hasFilter=' + hasFilter);
                                    sendResponse({ success: true, total: probeTotal, hasFilter: hasFilter });
                                } catch (e) {
                                    sendResponse({ success: false, total: 0, hasFilter: hasFilter, error: String(e.message || e) });
                                }
                            };
                            pXhr.onerror = function () { sendResponse({ success: false, total: 0, hasFilter: hasFilter, error: 'xhr onerror' }); };
                            pXhr.send(null);
                        } catch (bigE) { sendResponse({ success: false, total: 0, hasFilter: hasFilter, error: String(bigE.message || bigE) }); }
                    } catch (eAll) { sendResponse({ success: false, total: 0, hasFilter: false, error: String(eAll.message || eAll) }); }
                })();
                return true;
            }

            // 🔴🔗 施工许可「提取合并表」：抓 permit(列表+详情) + basic(详情)，按 BASIC_FIELDS/PERMIT_FIELDS 白名单裁剪后回传 popup，合并逻辑 100% 复用 popup「合并导出」规范
            if (message.action === 'permitFetchMergeBasic') {
                (async function () {
                    try {
                        // 🔴 严格和 popup.js 最新 BASIC_FIELDS / PERMIT_FIELDS 对齐（缺项目分类/所在市会直接丢列！）
                        var PBM_BASIC_FIELDS = [
                            // ✅ 用户指定的施工许可合并表 basic 段顺序：1-19（和 popup BASIC_FIELDS 100% 一致）
                            '项目名称','省级项目编号','项目分类','建设单位','组织机构代码',
                            '项目所在地','所在市','详细地址','立项文号','立项级别',
                            '立项批复机关','立项批复时间','总投资（万元）','总面积/长度（平方米/米）',
                            '建设规模','建设性质','工程用途','计划开工日期','数据等级'
                        ];
                        var PBM_PERMIT_FIELDS = [
                            // ✅ 和 popup PERMIT_FIELDS 100% 一致（用户指定的顺序）
                            '工程名称','施工许可证编号','省级项目编号','合同价格','建设地址','建设规模','建设单位','工程总承包单位','勘察单位','设计单位','施工单位','监理单位',
                            '建设单位项目负责人','工程总承包项目经理','勘察单位项目负责人','设计单位项目负责人','施工单位项目负责人',
                            '总监理工程师','合同工期','状态','备注','发证机关','数据等级'
                        ];
                        var HARD_LIMIT_PBM = 300;
                        var userWantedPbm = Math.max(0, Number(message.apiPageSize) || 0) || 100;
                        var extraFpPbm = (message && message.filters && typeof message.filters === 'object') ? message.filters : {};
                        var baseOriginPbm = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || window.location.origin || 'https://skypt.gdcic.net';
                        var cfgPbm = _getApiListConfig('permit');
                        var smartFpPbm = collectSmartFilterParams('permit');
                        var fpPbm = _mergePopupFiltersIntoFp('permit', smartFpPbm, extraFpPbm);

                        // Step1: probe 总数
                        var probeTotalPbm = 0;
                        try {
                            var fp1 = _sanitizeFilterParams('permit', fpPbm || {});
                            var filterQs = _buildFilterQueryString(fp1);
                            var probeUrl = baseOriginPbm + cfgPbm.path + '?pageNum=1&pageSize=1&kaptcha=&kaptchaKey=&flag=false' + filterQs;
                            var pResp = await new Promise(function (resProbe) {
                                var px = new XMLHttpRequest();
                                px.open('GET', probeUrl, true);
                                px.withCredentials = true;
                                px.setRequestHeader('Accept', 'application/json, text/plain, */*');
                                px.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                                px.onload = function () {
                                    try {
                                        var tj = JSON.parse(px.responseText || '{}');
                                        var t = parseInt(String(tj && (tj.total || (tj.data && tj.data.total)) || 0)) || 0;
                                        resProbe({ success: true, total: t, raw: tj });
                                    } catch (eProbe) { resProbe({ success: false, total: 0, error: String(eProbe.message || eProbe) }); }
                                };
                                px.onerror = function () { resProbe({ success: false, total: 0, error: 'xhr onerror' }); };
                                px.timeout = 20000;
                                px.ontimeout = function () { resProbe({ success: false, total: 0, error: 'xhr timeout' }); };
                                px.send(null);
                            });
                            probeTotalPbm = Math.max(0, Number(pResp && pResp.total) || 0);
                        } catch (eProbe) { probeTotalPbm = 0; }
                        var totalOverLimitPbm = probeTotalPbm > HARD_LIMIT_PBM;
                        var effectiveTotal = (probeTotalPbm > 0) ? Math.max(probeTotalPbm, userWantedPbm) : userWantedPbm;
                        var requestSizePbm = Math.min(effectiveTotal, HARD_LIMIT_PBM);
                        if (requestSizePbm < 1) requestSizePbm = 10;
                        console.log('%c[content:permitMergeBasic] Step1 probe: total=' + probeTotalPbm + ', userWant=' + userWantedPbm + ', requestSize=' + requestSizePbm, 'color:#1677ff;font-weight:bold;');

                        // Step2: permit 列表（带验证码等待，15 分钟超时）
                        var listResult = null;
                        try {
                            listResult = await new Promise(function (resList, rejList) {
                                var called = false;
                                var timer = setTimeout(function () {
                                    if (called) return; called = true;
                                    rejList(new Error('列表抓取超时（15分钟内未完成验证码）'));
                                }, 15 * 60 * 1000);
                                function done(r) {
                                    if (called) return; called = true;
                                    try { clearTimeout(timer); } catch (e) {}
                                    resList(r || { success: false });
                                }
                                try { fetchListRapidFilteredApi('permit', 1, requestSizePbm, fpPbm, done, { skipOverlapCheck: true }); }
                                catch (eRun) {
                                    if (called) return; called = true;
                                    try { clearTimeout(timer); } catch (e) {}
                                    rejList(new Error('列表执行异常: ' + (eRun.message || eRun)));
                                }
                            });
                        } catch (eList) { listResult = { success: false, error: String(eList.message || eList) }; }
                        if (!listResult || !listResult.success || !listResult.data || !Array.isArray(listResult.data) || listResult.data.length === 0) {
                            sendResponse({
                                success: false,
                                error: '施工许可列表抓取失败：' + ((listResult && listResult.error) ? String(listResult.error) : '未获取到施工许可列表'),
                                permitTotal: probeTotalPbm,
                                _noFallback: true
                            });
                            return;
                        }
                        var permitListRows = listResult.data.slice(0, requestSizePbm);
                        console.log('[content:permitMergeBasic] Step2 permit 列表：' + permitListRows.length + ' 条');

                        // Step3: permit 详情（并发 fetchDetailFromApi）
                        var CONCURRENT_PD = 5;
                        var permitDetailResults = new Array(permitListRows.length);
                        for (var ipd = 0; ipd < permitDetailResults.length; ipd++) permitDetailResults[ipd] = {};
                        var curPdLock = { v: 0 };
                        var totalPd = permitListRows.length;
                        async function workerPd() {
                            while (true) {
                                var i = curPdLock.v++;
                                if (i >= totalPd) break;
                                var rPd = permitListRows[i];
                                var pdCode = (rPd && rPd['施工许可证编号']) ? String(rPd['施工许可证编号']) : '';
                                var pdName = (rPd && (rPd['项目名称'] || rPd['工程名称'])) ? String(rPd['项目名称'] || rPd['工程名称']) : '';
                                try {
                                    if (pdCode) {
                                        var respPd = await fetchDetailFromApi('permit', pdCode, { listLevel: rPd, listProjectName: pdName });
                                        if (respPd && respPd.success && respPd.data && Object.keys(respPd.data).length > 1) {
                                            permitDetailResults[i] = respPd.data;
                                            continue;
                                        }
                                    }
                                } catch (e) {}
                                permitDetailResults[i] = rPd ? Object.assign({}, rPd) : {};
                            }
                        }
                        var pdWs = [];
                        for (var w = 0; w < Math.min(CONCURRENT_PD, Math.max(totalPd, 1)); w++) pdWs.push(workerPd());
                        if (pdWs.length > 0) { await Promise.all(pdWs); }
                        console.log('[content:permitMergeBasic] Step3 permit 详情：' + totalPd + ' 条');

                        // Step4: permit 列表+详情合并（NEVER_OVERWRITE_FROM_DETAIL：数据等级不被详情脏值覆盖）
                        var NEVER_OVERWRITE = {
                            '数据等级': true, '工程名称': true, '施工许可证编号': true, '省级项目编号': true, 'detailUrl': true
                        };
                        var fullPermitRows = [];
                        try {
                            for (var im = 0; im < permitListRows.length; im++) {
                                var listR = permitListRows[im] || {};
                                var detR = permitDetailResults[im] || {};
                                var row = {};
                                Object.keys(listR).forEach(function (k) { row[k] = listR[k]; });
                                Object.keys(detR).forEach(function (k) {
                                    if (NEVER_OVERWRITE[k]) return;
                                    if (detR[k] !== undefined && detR[k] !== null && detR[k] !== '') row[k] = detR[k];
                                });
                                if ('数据等级' in row) row['数据等级'] = _stringifyDataLevel(row['数据等级']);
                                fullPermitRows.push(row);
                            }
                        } catch (eM) { fullPermitRows = permitListRows.slice(); }

                        // Step5: basic 详情（省级项目编号去重反查）
                        var uniqBasicCodes = [];
                        var seenCodes = {};
                        for (var ic = 0; ic < fullPermitRows.length; ic++) {
                            var c = (fullPermitRows[ic] && fullPermitRows[ic]['省级项目编号']) ? String(fullPermitRows[ic]['省级项目编号']).trim() : '';
                            if (!c) continue;
                            if (seenCodes[c]) continue;
                            seenCodes[c] = true; uniqBasicCodes.push(c);
                        }
                        var basicMap = {};
                        var CONCURRENT_BD = 5;
                        var curBdLock = { v: 0 };
                        async function workerBd() {
                            while (true) {
                                var i = curBdLock.v++;
                                if (i >= uniqBasicCodes.length) break;
                                var code = uniqBasicCodes[i];
                                try {
                                    var respBd = await fetchDetailFromApi('basic', code, { listLevel: null });
                                    if (respBd && respBd.success && respBd.data && Object.keys(respBd.data).length >= 2) {
                                        basicMap[code] = respBd.data;
                                        if ('数据等级' in basicMap[code]) basicMap[code]['数据等级'] = _stringifyDataLevel(basicMap[code]['数据等级']);
                                        continue;
                                    }
                                } catch (e) {}
                                basicMap[code] = { '省级项目编号': code };
                            }
                        }
                        var bdWs = [];
                        for (var wb = 0; wb < Math.min(CONCURRENT_BD, uniqBasicCodes.length); wb++) bdWs.push(workerBd());
                        if (bdWs.length > 0) { await Promise.all(bdWs); }
                        var basicSourceArr = Object.keys(basicMap).map(function (ck) { return basicMap[ck]; });
                        console.log('[content:permitMergeBasic] Step5 basic 详情：去重 ' + uniqBasicCodes.length + ' 个，成功 ' + basicSourceArr.length + ' 个');

                        // Step6: 【最终瘦身】按 PBM_BASIC_FIELDS / PBM_PERMIT_FIELDS 白名单裁剪（只发 popup 合并导出需要的列）
                        function clipRow(src, fields) {
                            var out = {};
                            if (!src || !fields) return out;
                            for (var i = 0; i < fields.length; i++) {
                                var k = fields[i];
                                if (k in src) {
                                    out[k] = (k === '数据等级') ? _stringifyDataLevel(src[k]) : src[k];
                                    if (out[k] === undefined || out[k] === null) out[k] = '';
                                } else out[k] = '';
                            }
                            return out;
                        }
                        var clippedPermit = [];
                        for (var ip = 0; ip < fullPermitRows.length; ip++) clippedPermit.push(clipRow(fullPermitRows[ip], PBM_PERMIT_FIELDS));
                        var clippedBasic = [];
                        for (var ib = 0; ib < basicSourceArr.length; ib++) clippedBasic.push(clipRow(basicSourceArr[ib], PBM_BASIC_FIELDS));

                        // ✅ 最终 sendResponse（仅此一次，无 progress 无 storage，白名单后只有 ~40KB 绝对不会超限）
                        sendResponse({
                            success: true,
                            permitRows: clippedPermit,   // PERMIT_FIELDS 23 列（popup 合并导出规范）
                            basicRows: clippedBasic,     // BASIC_FIELDS 17 列（popup 合并导出规范）
                            permitTotal: probeTotalPbm,
                            permitFetched: clippedPermit.length,
                            basicUniqCount: clippedBasic.length
                        });
                    } catch (eBigPbm) {
                        console.error('[content:permitMergeBasic] 致命错误:', eBigPbm);
                        sendResponse({
                            success: false,
                            error: '合并表抓取异常: ' + String(eBigPbm && eBigPbm.message || eBigPbm),
                            _noFallback: true
                        });
                    }
                })();
                return true;
            }

            // 🔴🔗 施工许可「提取合并表」兼容模式（DOM）：popup 已经用 DOM 方式抓完 permit 列表+详情，把 fullPermitRows 传进来 →
            //     content 只负责：按省级项目编号去重反查 basic → 按 PBM_*_FIELDS 白名单裁剪 → 返回 popup 合并
            if (message.action === 'permitMergeBasicFromPermitRows') {
                (async function () {
                    try {
                        var PBM_BASIC_FIELDS_D = [
                            // ✅ 和 popup BASIC_FIELDS 100% 一致（缺项目分类/所在市会直接丢列）
                            '项目名称','省级项目编号','项目分类','建设单位','组织机构代码',
                            '项目所在地','所在市','详细地址','立项文号','立项级别',
                            '立项批复机关','立项批复时间','总投资（万元）','总面积/长度（平方米/米）',
                            '建设规模','建设性质','工程用途','计划开工日期','数据等级'
                        ];
                        var PBM_PERMIT_FIELDS_D = [
                            // ✅ 和 popup PERMIT_FIELDS 100% 一致
                            '工程名称','施工许可证编号','省级项目编号','合同价格','建设地址','建设规模','建设单位','工程总承包单位','勘察单位','设计单位','施工单位','监理单位',
                            '建设单位项目负责人','工程总承包项目经理','勘察单位项目负责人','设计单位项目负责人','施工单位项目负责人',
                            '总监理工程师','合同工期','状态','备注','发证机关','数据等级'
                        ];
                        var inputPermit = Array.isArray(message.permitRows) ? message.permitRows : [];
                        if (inputPermit.length === 0) {
                            sendResponse({ success: false, error: '传入的 permit 数据为空，请先在兼容模式下点击「🔍 开始提取」抓取施工许可数据。', _noFallback: true });
                            return;
                        }
                        // 去重反查 basic（100% 复用 permitFetchMergeBasic Step5）
                        var uniqCodesD = [];
                        var seenCodesD = {};
                        for (var icd = 0; icd < inputPermit.length; icd++) {
                            var cd = (inputPermit[icd] && inputPermit[icd]['省级项目编号']) ? String(inputPermit[icd]['省级项目编号']).trim() : '';
                            if (!cd) continue;
                            if (seenCodesD[cd]) continue;
                            seenCodesD[cd] = true; uniqCodesD.push(cd);
                        }
                        var basicMapD = {};
                        var CONCURRENT_D = 5;
                        var curBdLockD = { v: 0 };
                        async function workerBD() {
                            while (true) {
                                var i = curBdLockD.v++;
                                if (i >= uniqCodesD.length) break;
                                var code = uniqCodesD[i];
                                try {
                                    var rbd = await fetchDetailFromApi('basic', code, { listLevel: null });
                                    if (rbd && rbd.success && rbd.data && Object.keys(rbd.data).length >= 2) {
                                        basicMapD[code] = rbd.data;
                                        if ('数据等级' in basicMapD[code]) basicMapD[code]['数据等级'] = _stringifyDataLevel(basicMapD[code]['数据等级']);
                                        continue;
                                    }
                                } catch (e) {}
                                basicMapD[code] = { '省级项目编号': code };
                            }
                        }
                        var wsD = [];
                        for (var wbd = 0; wbd < Math.min(CONCURRENT_D, Math.max(uniqCodesD.length, 1)); wbd++) wsD.push(workerBD());
                        if (wsD.length > 0) { await Promise.all(wsD); }
                        var basicSourceArrD = Object.keys(basicMapD).map(function (ck) { return basicMapD[ck]; });
                        // 白名单裁剪（100% 复用 permitFetchMergeBasic Step6）
                        function clipRowD(src, fields) {
                            var out = {};
                            if (!src || !fields) return out;
                            for (var i = 0; i < fields.length; i++) {
                                var k = fields[i];
                                if (k in src) {
                                    out[k] = (k === '数据等级') ? _stringifyDataLevel(src[k]) : src[k];
                                    if (out[k] === undefined || out[k] === null) out[k] = '';
                                } else out[k] = '';
                            }
                            return out;
                        }
                        var clippedPermitD = [];
                        for (var ipd = 0; ipd < inputPermit.length; ipd++) clippedPermitD.push(clipRowD(inputPermit[ipd], PBM_PERMIT_FIELDS_D));
                        var clippedBasicD = [];
                        for (var ibd = 0; ibd < basicSourceArrD.length; ibd++) clippedBasicD.push(clipRowD(basicSourceArrD[ibd], PBM_BASIC_FIELDS_D));
                        sendResponse({
                            success: true,
                            permitRows: clippedPermitD,
                            basicRows: clippedBasicD,
                            permitTotal: inputPermit.length,
                            permitFetched: clippedPermitD.length,
                            basicUniqCount: clippedBasicD.length,
                            via: 'dom-mergebuilder'
                        });
                    } catch (eBigDom) {
                        sendResponse({
                            success: false,
                            error: '合并表(basic反查)异常: ' + String(eBigDom && eBigDom.message || eBigDom),
                            _noFallback: true
                        });
                    }
                })();
                return true;
            }

            // 🔴 「获取全部数据」第2步：无筛选 → 一次性 pageNum=1&pageSize=总条数（彻底抛弃 100 条/页逐页，因为服务器第 4 页就返回第 1 页重复数据）
            if (message.action === 'rapidFetchAllPageByPage') {
                (async function () {
                    try {
                        var allType = message.type;
                        var cfgAll = _getApiListConfig(allType);
                        if (!cfgAll) { sendResponse({ success: false, data: [], error: '未知 type=' + allType, _noFallback: true }); return; }
                        var estimatedTotal = Math.max(0, Number(message.totalEstimated) || 0);

                        function progress(curPage, totalPages, curCount, totalEst) {
                            try {
                                sendResponse({
                                    __progress: true,
                                    data: { currentPage: curPage, totalPages: totalPages || 0, currentCount: curCount, total: totalEst || 0 }
                                });
                            } catch (e) {}
                        }

                        var originAll = (window.location.href.match(/^(https?:\/\/[^\/]+)/) || [])[1] || window.location.origin || 'https://skypt.gdcic.net';
                        var HL_ALL = 300;   // 🚀「获取全部数据」硬上限（实测确认：服务器无论有没有筛选，301+ 全重复）
                        var wantAll = Math.max(0, Number(estimatedTotal) || 0);
                        var psAll = wantAll > 0
                            ? Math.min(wantAll, HL_ALL)
                            : Math.min(100, HL_ALL);
                        var truncAll = wantAll > HL_ALL;
                        try { _resetApiDupState(); } catch (eDup) {}
                        console.log('%c[content:rapidFetchAll] 🚀 极速模式「获取全部数据」→ 一次性：pageNum=1&pageSize=' + psAll +
                            (truncAll ? ('（服务器 trueTotal=' + wantAll + ' > 硬上限 ' + HL_ALL + '，服务器从第 ' + (HL_ALL + 1) + ' 条起无论有没有筛选全部返回重复假数据，自动截断到前 ' + HL_ALL + ' 条真实数据）') : ''),
                            'color:#1677ff;color:#fff;font-weight:bold;');
                        progress(1, 1, 0, wantAll);
                        var firstR = fetchListViaApiReal(allType, 1, psAll, { skipOverlapCheck: true, debug: true });
                        if (!firstR || !firstR.success) {
                            console.error('[content:rapidFetchAll] 一次性请求失败：', (firstR && firstR.error) || '未知');
                            sendResponse({ success: false, data: [], error: '一次性请求失败: ' + ((firstR && firstR.error) || '未知'), _noFallback: true });
                            return;
                        }
                        var allRows = (firstR.data && Array.isArray(firstR.data)) ? firstR.data.slice(0, psAll) : [];
                        var trueTotal = (typeof firstR.total === 'number' && firstR.total > 0) ? firstR.total : wantAll;
                        var actualCount = allRows.length;
                        console.log('[content:rapidFetchAll] ✅ 一次性完成：trueTotal=' + trueTotal + ', 本次实际交付=' + actualCount + ' 条, 请求 pageSize=' + psAll);
                        progress(1, 1, actualCount, trueTotal);

                        // 超过硬上限（服务器 301+ 全重复）→ 推 serverDupStop 警告给 popup
                        if (truncAll) {
                            try {
                                sendResponse({
                                    __progress: true,
                                    data: {
                                        serverDupStop: true,
                                        currentPage: 1,
                                        totalPages: 1,
                                        currentCount: actualCount,
                                        total: trueTotal,
                                        msg: '服务器总数据 ' + trueTotal + ' 条。服务器已封死：无论有没有筛选条件，第 ' + (HL_ALL + 1) + ' 条起全是与第 1 页重复的假数据，无法获取更多。本次仅抓取前 ' + actualCount + ' 条真实数据（已自动去重/截断）。'
                                    }
                                });
                            } catch (ep) {}
                        }
                        // 最后返回数据给 popup（success=true，照常进入详情提取阶段）
                        sendResponse({
                            success: true,
                            data: allRows,
                            total: actualCount,
                            trueTotal: trueTotal,
                            pageSize: psAll,
                            hasFilter: false,
                            truncated: truncAll,
                            partialSuccess: truncAll,
                            partialWantedCount: wantAll,
                            partialActualCount: actualCount
                        });
                    } catch (eBigAll) {
                        console.error('[content:rapidFetchAll] 致命错误:', eBigAll);
                        sendResponse({ success: false, data: [], error: String(eBigAll && eBigAll.message || eBigAll), _noFallback: true });
                    }
                })();
                return true;
            }

            if (message.action === 'extractList') {
                var targetPage = Number(message.page) || 1;

                // 🔴 每轮任务的第 1 页：重置跨页去重状态
                if (targetPage === 1) {
                    try { _resetApiDupState(); } catch (eDup) {}
                }

                // ================================================================
                // 🔴 方案：API 直取 JSON（深度融合后：只有「极速模式」一套，自动识别筛选条件）
                //   fetchMode='smart' 或 fetchMode='api' 都走同一个入口 fetchListRapid（兼容老配置）
                //     • 无筛选条件 → 按 popup 的 pageNum=N&pageSize=M 正常分页（无验证码、无310条限制）
                //     • 有筛选条件 → 带筛选参数 + 验证码 + 310条极限判断 + 一次性优化（省验证码）
                // ================================================================
                var incomingFilters = message.filters || {};
                var fetchMode = String(incomingFilters.fetchMode || 'dom');
                var supportedApiTypes = { 'basic': true, 'permit': true, 'complete': true };
                var msgType = message.type;
                if (supportedApiTypes[msgType] && (fetchMode === 'smart' || fetchMode === 'api')) {
                    try {
                        function sendApiResp(res) {
                            try {
                                if (res && res.aborted) {
                                    console.warn('[content] 🚫 收到用户中止爬取标志，通知 popup 停止');
                                    sendResponse({ data: [], page: targetPage, currentPage: targetPage, rowCount: 0, aborted: true, via: res.via || 'api' });
                                } else if (res && res.success) {
                                    var info = '🟢 extractList via=' + res.via + ', page=' + targetPage + ', 条数=' + res.data.length + ', total=' + res.total;
                                    if (res.duplicate) info += ' [⚠️ 本页与上一页重复]';
                                    if (res.needCaptcha) info += ' [需验证码]';
                                    if (res.truncated) info += ' [⚠️ 截断，仅前N条]';
                                    if (res.beyondLimit) info += ' [🚫 超310条极限]';
                                    if (res.hasFilter === true) info += ' [有筛选]';
                                    if (res.hasFilter === false) info += ' [无筛选]';
                                    console.log('[content] ' + info);
                                    var baseResp = {
                                        data: res.data, page: targetPage, currentPage: targetPage,
                                        rowCount: res.data.length, via: res.via,
                                        total: res.total || 0, totalPages: res.totalPages || 0,
                                        pageSizeApi: res.pageSize || 0, duplicate: !!res.duplicate,
                                        needCaptcha: !!res.needCaptcha, filterParams: res.filterParams || {},
                                        aborted: false,
                                        // 🔴 透传"本次请求有没有带筛选条件"，让 popup 决定是否用"累计条数>310"的硬规则提醒
                                        hasFilter: (res.hasFilter === true)
                                    };
                                    if (res.truncated === true) baseResp.truncated = true;
                                    if (res.beyondLimit === true) baseResp.beyondLimit = true;
                                    if (typeof res.realTotal === 'number') baseResp.realTotal = res.realTotal;
                                    if (typeof res.hardLimit === 'number') baseResp.hardLimit = res.hardLimit;
                                    if (res.filteredLimitReached === true) baseResp.filteredLimitReached = true;
                                    if (res.filteredLimitMsg) baseResp.filteredLimitMsg = res.filteredLimitMsg;
                                    sendResponse(baseResp);
                                } else {
                                    console.warn('[content] 🔴 extractList API方案失败：', (res && res.error) || '未知');
                                    var errResp = { data: [], error: (res && res.error) || '未知错误', page: targetPage, rowCount: 0 };
                                    if (res && res.beyondLimit === true) {
                                        errResp.beyondLimit = true;
                                        if (typeof res.realTotal === 'number') errResp.realTotal = res.realTotal;
                                        if (typeof res.hardLimit === 'number') errResp.hardLimit = res.hardLimit;
                                    }
                                    sendResponse(errResp);
                                }
                            } catch (srErr) { console.error('[content] sendResponse 异常:', srErr); }
                        }

                        // 🔴 合并：统一调用 fetchListRapid（极速模式【唯一入口】，内部自动判断是否有筛选条件）
                        console.log('[content] 🚀 extractList type=' + msgType + ' → 极速模式（深度融合精准）, fetchMode=' + fetchMode + ', page=' + targetPage + ', filters=', incomingFilters);
                        fetchListRapid(msgType, targetPage, function (res) {
                            // 🔴 兜底补 hasFilter 字段（理论上 fetchListRapid 所有分支都已设置，这里只是最后保险）
                            if (res && res.success && typeof res.hasFilter === 'undefined') {
                                try {
                                    var fpCheck = collectSmartFilterParams(msgType);
                                    res.hasFilter = _hasAnyFilter(fpCheck);
                                } catch (eHf) { res.hasFilter = false; }
                            }
                            sendApiResp(res);
                        }, incomingFilters);
                        return true; // 必须异步 return true
                    } catch (apiBigErr) {
                        // 🔴 用户明确要求：极速模式（fetchMode=api/smart）API 失败就失败，不要再回退 DOM（回退只会拿到当前页 10 条，误导判断）
                        console.error('[content] 🔴 极速模式 extractList 顶层异常（不再回退 DOM）：', apiBigErr && apiBigErr.message ? apiBigErr.message : apiBigErr, apiBigErr && apiBigErr.stack ? apiBigErr.stack : '');
                        try {
                            sendResponse({
                                data: [],
                                error: '极速模式异常: ' + ((apiBigErr && apiBigErr.message) || String(apiBigErr)),
                                page: targetPage,
                                rowCount: 0,
                                via: 'api-fatal',
                                _noFallback: true
                            });
                        } catch (eSend) {}
                        return true; // 🔴 异步 return true，阻止 fallthrough 到 DOM 方案（彻底禁回退）
                    }
                } else if (supportedApiTypes[msgType] && fetchMode === 'dom') {
                    console.log('[content] 🔨 extractList type=' + msgType + ' → 用户选择了兼容模式（老方法 DOM 翻页），跳过 API 方案');
                }

                // ================================================================
                // fallback 方案：原有 DOM 翻页 + DOM 提取
                //     对 permit/complete 类型生效；basic 类型 API 失败时也会走到这里
                // ================================================================
                var doExtract = function () {
                    try {
                        var data = [];
                        var typeMap = { 'basic': extractBasicList, 'permit': extractPermitList, 'complete': extractCompleteList };
                        var fn = typeMap[message.type];
                        if (fn) data = fn(message.filters || {}, targetPage);
                        var actualPage = getCurrentPage();
                        console.log('[content] 📄 extractList[DOM方案] 完成：请求页=' + targetPage + ', 实际当前页=' + actualPage + ', 条数=' + data.length);
                        sendResponse({ data: data, page: targetPage, currentPage: actualPage, rowCount: data.length, via: 'dom' });
                    } catch (err) {
                        console.error('[content] extractList 失败:', err);
                        sendResponse({ data: [], error: err.message, page: targetPage });
                    }
                };

                // 🔴✅ 修复翻页错乱根因！targetPage=1 也要切页！（如果当前不是第1页必须切回去！）
                var currP = 1;
                try { currP = Number(getCurrentPage()) || 1; } catch (e) {}
                if (currP !== targetPage) {
                    console.log('[content] 📄[DOM方案] 当前页=' + currP + ' ≠ 请求页=' + targetPage + ' → 开始切页...');
                    var goToTimeout = null;
                    var goToDone = false;
                    try {
                        goToTimeout = setTimeout(function () {
                            if (goToDone) return;
                            goToDone = true;
                            console.warn('[content] ⚠️ 切页超时（8s），直接抓当前页');
                            setTimeout(doExtract, 500);
                        }, 8000);
                    } catch (eTM) {}
                    goToPage(targetPage, function (success) {
                        try { if (goToTimeout) clearTimeout(goToTimeout); } catch (eCl) {}
                        if (goToDone) return;
                        goToDone = true;
                        if (!success) {
                            console.warn('[content] ⚠️ 切页未成功，仍然继续抓（可能页码组件没找到）');
                        }
                        // 🔴✅ 切页成功后：验证当前页 === targetPage，且页面真的刷新了
                        var pollCount = 0;
                        var maxPoll = 12; // 最多等 6 秒
                        var lastRows = getTableRows().length;
                        var pollFn = function () {
                            try {
                                var realP = Number(getCurrentPage()) || 0;
                                var nowRows = getTableRows().length;
                                var rowsChanged = nowRows !== lastRows || pollCount >= 6; // 行数变了 or 等够了 3 秒
                                if ((realP === targetPage && rowsChanged) || pollCount >= maxPoll) {
                                    if (pollCount >= maxPoll && realP !== targetPage) {
                                        console.warn('[content] ⚠️ 切页轮询超时，当前页=' + realP + ' ≠ 请求页=' + targetPage + '，直接抓');
                                    } else {
                                        console.log('[content] 📄 切页完成：当前页=' + realP + ' === 请求页=' + targetPage + ', 行数=' + nowRows + ', 轮询=' + pollCount);
                                    }
                                    doExtract();
                                    return;
                                }
                                pollCount++;
                                setTimeout(pollFn, 500);
                            } catch (ePoll) {
                                console.error('[content] 切页轮询异常，直接抓：', ePoll);
                                doExtract();
                            }
                        };
                        setTimeout(pollFn, 500);
                    });
                    return true;
                } else {
                    console.log('[content] 📄[DOM方案] 当前页=' + currP + ' === 请求页=' + targetPage + ' → 直接抓');
                    doExtract();
                    return true;
                }
            }

            if (message.action === 'extractDetail') {
                console.log('[content] 📨 收到 extractDetail 请求: type=' + message.type + ', 当前URL=' + window.location.href);

                // 详情页是 SPA，可能需要等待内容渲染完成
                // 先等待 1200ms，然后检查关键元素是否出现，必要时再延长等待
                var maxWaitForRender = 6000;
                var waitedRender = 0;
                var waitStep = 500;
                function tryExtract() {
                    // 尝试等待基本信息板块出现（如果是 basic 类型）
                    var baseRendered = true;
                    if (message.type === 'basic') {
                        var hasPlate = document.querySelector('.plate-wrap, .base-info-point, .info-content, .detail-content');
                        var hasKeyText = (document.body ? (document.body.innerText || '').indexOf('组织机构代码') !== -1 : false);
                        baseRendered = !!hasPlate || hasKeyText;
                    }
                    if (message.type === 'permit') {
                        baseRendered = !!document.querySelector('.plate-wrap, .table-box, .certificate-detail-wrap');
                    }
                    if (message.type === 'complete') {
                        baseRendered = !!document.querySelector('.plate-wrap');
                    }

                    if (!baseRendered && waitedRender < maxWaitForRender) {
                        waitedRender += waitStep;
                        console.log('[content]   关键板块尚未渲染，继续等待... waited=' + waitedRender + 'ms');
                        setTimeout(tryExtract, waitStep);
                        return;
                    }

                    var data = {};
                    try {
                        if (message.type === 'basic') data = extractBasicDetail();
                        else if (message.type === 'permit') data = extractPermitDetail();
                        else if (message.type === 'complete') data = extractCompleteDetail();
                    } catch (e) {
                        console.error('[content] extractDetail 失败:', e);
                    }
                    console.log('[content] 📤 extractDetail 返回字段数=' + Object.keys(data).length, data);
                    sendResponse({ data: data, success: true });
                }
                setTimeout(tryExtract, 1200);
                return true;
            }

            if (message.action === 'getCurrentPage') {
                sendResponse({ page: getCurrentPage() });
                return true;
            }

            sendResponse({ success: false, error: '未知操作' });
        } catch (err) {
            console.error('[content] 消息处理异常:', err);
            try { sendResponse({ error: String(err.message || err) }); } catch (e2) {}
        }
        return true;
    });
    console.log('✅ 数据提取脚本已加载完毕');
        } catch (regErr) {
            console.error('[content] 注册消息监听失败:', regErr);
        }
    })();

    } catch (fatalErr) {
        // ========= 顶层 try-catch 的 catch 块：content.js 崩了也能响应 =========
        console.error('❌ content.js 初始化致命错误:', fatalErr);
        console.error('❌ 错误堆栈:', (fatalErr && fatalErr.stack) ? fatalErr.stack : '无堆栈');
        try {
            // 注册降级监听器 - 至少让 popup 能 ping 通并看到错误
            if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.addListener(function (msg, _s, sr) {
                    try {
                        if (msg.action === 'ping') {
                            sr({ pong: true, initError: String(fatalErr.message || fatalErr) });
                        } else {
                            sr({ error: 'content.js 初始化失败: ' + String(fatalErr.message || fatalErr) });
                        }
                    } catch (ee) {}
                    return true;
                });
                console.log('⚠️ 已注册降级监听器（可通过 ping 查看错误）');
            }
        } catch (ee) {
            console.error('连降级监听器都无法注册:', ee);
        }
    }
})();