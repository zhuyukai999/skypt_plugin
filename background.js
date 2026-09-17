// ===== 全局状态 =====
var extractedResults = { basic: [], permit: [], complete: [] };
var detailCompleteFlags = { basic: false, permit: false, complete: false };
var stopFlags = { basic: false, permit: false, complete: false };

// ===== 🔴天眼查补全：stop flag =====
var tianyanchaStopFlag = false;

function findAnyTianyanchaTab(callback) {
  try {
    chrome.tabs.query({ url: ['*://pro.tianyancha.com/*','*://www.tianyancha.com/*','*://tianyancha.com/*'] }, function (tabs) {
      if (!tabs || !tabs.length) { callback(null); return; }
      var first = null;
      var active = null;
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        if (!t || !t.id || !t.url) continue;
        if (!first) first = t;
        if (t.active) active = t;
      }
      callback(active || first);
    });
  } catch (e) { callback(null); }
}

// ===== 🔴✅✅✅ 显示模式切换（弹窗/侧边栏/新窗口）终极统一处理 =====
// Chrome MV3 三种形态的正确打开方式：
//  1. popup 模式：chrome.action.setPopup({popup:'popup.html'})  → 点图标直接出弹窗（Chrome 原生）
//  2. sidebar 模式：chrome.action.setPopup({popup:''}) + sidePanel.setPanelBehavior({openPanelOnActionClick:true}) → 点图标开侧边栏
//  3. window 模式：chrome.action.setPopup({popup:''})  → 点图标触发 onClicked → chrome.windows.create({type:'popup'}) 开新窗口
// （⚠️ 关键：只要设置了 default_popup/setPopup 有值，chrome.action.onClicked 就【完全不会触发】！）
var _displayModeApplying = false;

// 🔴✅ 用户要求：选择某模式后，「其他模式」的插件窗口/侧边栏自动关闭，绝不残留！
// 判断某窗口是否是我们插件开的「window 模式」独立新窗口（820x640 大 popup）
function isOurWindowModeWin(win) {
    if (!win) return false;
    var wt = win.type || '';
    if (wt !== 'popup') return false;
    var w = win.width || 0;
    var h = win.height || 0;
    return (w >= 650 && w <= 950 && h >= 500 && h <= 780);
}
// 关闭「window 模式」的所有独立窗口（切到 popup/sidebar 时必须清掉！）
function closeAllWindowModeWindows(excludeWindowId, cb) {
    try {
        if (!chrome.windows || !chrome.windows.getAll) { cb && cb(); return; }
        chrome.windows.getAll({ windowTypes: ['popup'] }, function (all) {
            if (!all || !all.length) { cb && cb(); return; }
            var remain = all.length;
            var done = function () { remain--; if (remain <= 0) cb && cb(); };
            for (var i = 0; i < all.length; i++) {
                var w = all[i];
                if (!w || (excludeWindowId && w.id === excludeWindowId)) { done(); continue; }
                if (isOurWindowModeWin(w)) {
                    try { chrome.windows.remove(w.id, function () { done(); }); continue; } catch (eRm) {}
                }
                done();
            }
        });
        return;
    } catch (e) { console.warn('[bg] closeAllWindowModeWindows 异常:', e.message || e); }
    cb && cb();
}
function applyDisplayMode(mode) {
    if (_displayModeApplying) return;
    try { _displayModeApplying = true; } catch (e) {}
    mode = String(mode || 'popup').trim();
    if (['popup','sidebar','window'].indexOf(mode) === -1) mode = 'popup';
    console.log('[bg] 🖥️ applyDisplayMode → 应用模式: ' + mode);

    try {
        // Step 0: 🔴✅✅✅ 先关其他形态的残留窗口！
        //   - 切到 popup / sidebar → 必须清光 window 模式的 820×640 独立窗！防止两个形态共存！
        if (mode !== 'window') { try { closeAllWindowModeWindows(null); } catch (eC) {} }

        // Step 1: 处理 setPopup（default_popup 动态化）
        // - popup 模式：需要 popup，点图标直接弹（onClicked 不会触发，正常）
        // - sidebar / window 模式：必须清空 popup，才能让 onClicked 监听器生效！
        if (mode === 'popup') {
            try { chrome.action.setPopup && chrome.action.setPopup({ popup: 'popup.html' }); } catch (e1) { console.warn('[bg] setPopup(popup) 失败:', e1.message || e1); }
        } else {
            try { chrome.action.setPopup && chrome.action.setPopup({ popup: '' }); } catch (e2) { console.warn('[bg] setPopup(空) 失败:', e2.message || e2); }
        }

        // Step 2: 处理 sidePanel 行为 + path（URL 带 mode=sidebar 参数，popup.js 读参数 100% 准！）
        // - sidebar 模式：点图标自动开侧边栏（Chrome 原生行为，最快）
        // - popup/window 模式：关闭自动开侧边栏
        try {
            if (chrome.sidePanel) {
                // 🔴✅✅✅ 侧边栏固定加载带参数的 URL → 保证侧边栏里"显示方式"永远是侧边栏！
                if (chrome.sidePanel.setOptions) {
                    chrome.sidePanel.setOptions({ path: 'popup.html?mode=sidebar' }).catch(function (e) { console.warn('[bg] sidePanel.setOptions 失败:', e.message || e); });
                }
                if (chrome.sidePanel.setPanelBehavior) {
                    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === 'sidebar' }).catch(function (e) { console.warn('[bg] setPanelBehavior 失败:', e.message || e); });
                }
            }
        } catch (eSide) {}
    } finally {
        setTimeout(function () { try { _displayModeApplying = false; } catch (e) {} }, 50);
    }
}

// ===== 初始化：确保默认显示方式正确 =====
try {
    chrome.runtime.onInstalled.addListener(function (details) {
        chrome.storage.sync.get(['displayMode'], function (result) {
            var mode = (result && result.displayMode) ? result.displayMode : 'popup';
            if (!result || !result.displayMode) {
                chrome.storage.sync.set({ displayMode: mode });
            }
            applyDisplayMode(mode);
        });
    });
    // Service Worker 启动时也立即应用一次（最关键！之前的问题就在这里：onInstalled 只有安装/更新才触发，SW 冷启动后 setPopup 是 manifest 里的 popup.html，所以侧边栏模式永远显示弹窗！）
    chrome.storage.sync.get(['displayMode'], function (result) {
        var mode = (result && result.displayMode) ? result.displayMode : 'popup';
        if (!result || !result.displayMode) {
            chrome.storage.sync.set({ displayMode: mode });
        }
        applyDisplayMode(mode);
    });
} catch (e) {
    console.warn('[bg] 初始化显示模式失败:', e.message || e);
}

// ===== 唯一的 action onClicked 监听器（sidebar 也能走这里兜底，window 模式必须走这里） =====
//  ⚠️  这里的逻辑只会在 setPopup({popup:''}) 清空后才会触发！
var _actionClickedLocked = false;
try {
    chrome.action.onClicked.addListener(function (tab) {
        if (_actionClickedLocked) return;
        try { _actionClickedLocked = true; } catch (e) {}
        setTimeout(function () { try { _actionClickedLocked = false; } catch (e) {} }, 800);

        chrome.storage.sync.get(['displayMode'], function (result) {
            var mode = (result && result.displayMode) ? result.displayMode : 'popup';
            var wid = tab && tab.windowId ? tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
            console.log('[bg] 🖱️ action.onClicked 触发，当前模式=' + mode + ', tab.windowId=' + wid);

            if (mode === 'sidebar' && chrome.sidePanel && chrome.sidePanel.open) {
                // 侧边栏兜底（主要靠 openPanelOnActionClick=true 自动打开，这里只是加保险）
                try { chrome.sidePanel.open({ windowId: wid }).catch(function (e) { console.warn('[bg] sidePanel.open 失败:', e.message || e); }); }
                catch (eSide) {}
            } else if (mode === 'window') {
                // 🔴✅ 新窗口模式：点图标 → 开一个独立窗口（type:'popup'，无边框但像窗口一样可拖动）
                // 🔴✅✅✅ 关键：URL 加 ?mode=window 参数！popup.js 里读 URL 参数就能 100% 准确判断是 window 模式（再也不用猜宽度！）
                try {
                    chrome.windows.create({
                        url: chrome.runtime.getURL('popup.html') + '?mode=window',
                        type: 'popup',
                        width: 820,
                        height: 640,
                        focused: true
                    }, function (win) {
                        if (chrome.runtime.lastError || !win) {
                            console.warn('[bg] windows.create 失败（fallback 到 sidebar/popup）:', chrome.runtime.lastError && chrome.runtime.lastError.message);
                            try {
                                if (chrome.sidePanel && chrome.sidePanel.open) {
                                    chrome.sidePanel.open({ windowId: wid }).catch(function () {});
                                }
                            } catch (eFb) {}
                        }
                    });
                } catch (eWin) {
                    console.warn('[bg] windows.create 异常:', eWin.message || eWin);
                }
            }
            // popup 模式：因为 setPopup 已经设置了 popup.html，所以这里根本不会触发，Chrome 原生弹 popup
        });
    });
} catch (e) {
    console.warn('[bg] action.onClicked 注册失败:', e.message || e);
}

// ===== 监听 storage 变化，实时应用显示模式（用户在 UI 下拉切换时立刻生效） =====
try {
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'sync' && changes.displayMode && changes.displayMode.newValue) {
            applyDisplayMode(changes.displayMode.newValue);
        }
    });
} catch (e) {}

// ===== 工具函数：确保 content script 已注入 =====
function _findAnySkyptTab(callback) {
  try {
    chrome.tabs.query({ url: '*://skypt.gdcic.net/*' }, function (tabs) {
      if (!tabs || tabs.length === 0) { callback(null); return; }
      // 优先用激活的（如果是 skypt），否则用第一个 type=6/5/1 列表页，最后兜底第一个
      var first = null;
      var listPage = null;
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        if (!t || !t.id || !t.url) continue;
        if (!first) first = t;
        if (t.url.indexOf('/project?type=') !== -1) { listPage = t; break; }
      }
      callback(listPage || first);
    });
  } catch (e) { callback(null); }
}

function ensureContentScript(tabId, url, callback) {
    console.log('[bg] ensureContentScript: tabId=' + tabId + ', url=' + (url || '').slice(0, 100));
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, function (resp) {
        if (!chrome.runtime.lastError && resp && resp.pong) {
            console.log('[bg]  ping 成功，content 已就绪' + (resp.initError ? '（但有initError:' + resp.initError + '）' : ''));
            // 即使 content 已就绪，也确保 hook.js 注入到 MAIN world
            ensureHookInMainWorld(tabId, function() { callback(true); });
            return;
        }
        console.log('[bg]  ping 无响应，主动注入 content.js + hook.js');
        try {
            chrome.scripting.executeScript(
                { target: { tabId: tabId }, files: ['content.js'] },
                function (results) {
                    if (chrome.runtime.lastError || !results) {
                        console.error('[bg]  content.js 注入失败:', chrome.runtime.lastError ? chrome.runtime.lastError.message : '未知错误');
                        callback(false);
                    } else {
                        console.log('[bg]  content.js 注入成功，注入 hook.js 到 MAIN world');
                        ensureHookInMainWorld(tabId, function() {
                            setTimeout(function () { callback(true); }, 800);
                        });
                    }
                }
            );
        } catch (e) {
            console.error('[bg]  注入异常:', e);
            callback(false);
        }
    });
}

function ensureHookInMainWorld(tabId, callback) {
    try {
        chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: false },
            files: ['hook.js'],
            world: 'MAIN'
        }, function(results) {
            if (chrome.runtime.lastError) {
                var errMsg = chrome.runtime.lastError.message || '';
                if (errMsg.indexOf('not allowed') !== -1 || errMsg.indexOf('Cannot access') !== -1) {
                    console.warn('[bg]  hook.js MAIN world 注入被拒（可能是受限页面），跳过: ' + errMsg);
                    callback(true);
                } else {
                    console.warn('[bg]  hook.js MAIN world 注入失败: ' + errMsg);
                    callback(false);
                }
            } else {
                console.log('[bg]  hook.js 已注入到 MAIN world');
                callback(true);
            }
        });
    } catch (e) {
        console.warn('[bg]  ensureHookInMainWorld 异常:', e);
        callback(false);
    }
}

// ===== 消息监听 =====
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  // 🔴✅ 用户选择某模式后，主动关掉其他形态的窗口（不共存！）
  if (message.action === 'closeOtherModeWindows') {
    try {
      var targetMode = String(message.targetMode || '').trim();
      // 切到 popup/sidebar：清掉 window 模式的 820×640 独立窗
      if (targetMode !== 'window') {
        closeAllWindowModeWindows(sender && sender.tab && sender.tab.windowId ? sender.tab.windowId : null, function () {
          try { sendResponse && sendResponse({ success: true }); } catch (e) {}
        });
        return true;
      }
    } catch (eCloseMsg) {}
    try { sendResponse && sendResponse({ success: true }); } catch (e2) {}
    return true;
  }

  if (message.action === 'openAndExtractDetail') {
    var url = message.url;
    var type = message.type;
    var rowIndex = message.rowIndex || 0;
    var _dbgReason = ''; // 🔴 诊断：记录为什么 fallback 到开 tab
    console.log('%c[bg] ⭐ openAndExtractDetail 收到请求: type=' + type + ', rowIndex=' + rowIndex + ', url=' + (url || '').slice(0, 200), 'background:#1677ff;color:#fff;padding:2px 6px;border-radius:3px;');

    if (!url || !type) {
      sendResponse({ success: false, error: '缺少参数' });
      return true;
    }

    if (stopFlags[type]) {
      sendResponse({ success: false, error: '用户已停止' });
      return true;
    }

    // =========================================================================
    // 🔴✅ 唯一主路径：basic / permit / complete 全部走纯接口 fetch（0 干扰，不开新 tab，完全禁用仿真点击兜底！）
    // =========================================================================
    if (type === 'basic' || type === 'permit' || type === 'complete') {
      var codeToFetch = '';
      try {
        // 🔴 complete：不从 URL 解析，直接从 listRow._acceptanceId 拿数字 ID（列表 API 的 src.id）
        if (type === 'complete') {
          try {
            if (message && message.listRow && message.listRow._acceptanceId) {
              codeToFetch = String(message.listRow._acceptanceId || '').trim();
            }
          } catch (eCA) {}
          if (!/^\d+$/.test(codeToFetch)) codeToFetch = '';
        } else {
          try {
            var urlObj = new URL(url);
            var hash = urlObj.hash || '';
            var qpIdx = hash.indexOf('?');
            if (qpIdx !== -1) {
              var qs = hash.slice(qpIdx + 1);
              var sp = new URLSearchParams(qs);
              if (type === 'basic') codeToFetch = sp.get('projectCode') || '';
              if (type === 'permit') codeToFetch = sp.get('permitCode') || '';
            }
          } catch (eu1) { _dbgReason += 'urlParseErr(' + (eu1 && eu1.message || eu1) + ') '; }
          if (!codeToFetch) {
            var rx = type === 'basic' ? /[?&]projectCode=([^&#]+)/ : /[?&]permitCode=([^&#]+)/;
            var m = url.match(rx);
            if (m) codeToFetch = decodeURIComponent(m[1]);
          }
        }
      } catch (euBig) { _dbgReason += 'bigUrlErr(' + (euBig && euBig.message || euBig) + ') '; }
      codeToFetch = (codeToFetch || '').trim();

      if (codeToFetch) {
        console.log('[bg] 🚀 ' + type + ' 纯接口提取（不开tab，无兜底）: code=' + codeToFetch);
        _findAnySkyptTab(function (tab) {
          if (!tab || !tab.id) {
            _dbgReason += 'noSkyptTab ';
            console.warn('[bg] ❌ 提取失败：无可用 skypt tab。reason=' + _dbgReason);
            sendResponse({ success: false, data: {}, error: '无可用 skypt 页面（列表页被关了？）：' + _dbgReason });
            return;
          }
          ensureContentScript(tab.id, tab.url, function (ok) {
            if (!ok) {
              _dbgReason += 'contentInjectFail ';
              console.warn('[bg] ❌ 提取失败：content 注入失败。reason=' + _dbgReason);
              sendResponse({ success: false, data: {}, error: 'content 注入失败：' + _dbgReason });
              return;
            }
            var fetchTimeoutT = null;
            var done = false;
            try {
              fetchTimeoutT = setTimeout(function () {
                if (done) return;
                done = true;
                _dbgReason += 'fetchTimeout25s ';
                console.warn('[bg] ❌ 提取失败：超时(25s)。reason=' + _dbgReason);
                sendResponse({ success: false, data: {}, error: '纯接口请求超时(25s)：' + _dbgReason });
              }, 25000);
            } catch (eST) {}

            var extra = {};
            try {
              if (message && message.listRow && typeof message.listRow === 'object') {
                if (type === 'basic') extra.listLevel = message.listRow['数据等级'] || '';
                if (type === 'permit') {
                  extra.listLevel = message.listRow['数据等级'] || '';
                  extra.listProjectName = message.listRow['工程名称'] || '';
                }
                if (type === 'complete') {
                  extra.listLevel = message.listRow['数据等级'] || '';
                  extra.listProjectName = message.listRow['工程名称'] || '';
                }
              }
            } catch (eEX) {}

            try {
              chrome.tabs.sendMessage(tab.id, {
                action: 'fetchDetail',
                type: type,
                code: codeToFetch,
                extra: extra
              }, function (resp) {
                try { if (fetchTimeoutT) { clearTimeout(fetchTimeoutT); fetchTimeoutT = null; } } catch (eClr) {}
                if (done) return;
                if (chrome.runtime.lastError) {
                  done = true;
                  _dbgReason += 'sendMsgFail(' + chrome.runtime.lastError.message + ') ';
                  console.warn('[bg] ❌ 提取失败：sendMessage 异常。reason=' + _dbgReason);
                  sendResponse({ success: false, data: {}, error: 'sendMessage 失败：' + _dbgReason });
                  return;
                }
                var fc = (resp && resp.data) ? Object.keys(resp.data).length : 0;
                console.log('[bg] ℹ️ fetchDetail 回调: success=' + (resp && resp.success) + ', fieldCount=' + fc + ', respKeys=' + (resp ? Object.keys(resp).join(',') : '-') + ', error=' + (resp && resp.error ? resp.error : ''));
                if (resp && (resp.success === true) && fc >= 3) {
                  done = true;
                  console.log('[bg] 🟢 ' + type + ' 纯接口提取成功！(字段数=' + fc + '，不开新 tab，无兜底) via=' + (resp.via || ''));
                  if (!extractedResults[type]) extractedResults[type] = [];
                  extractedResults[type][rowIndex] = resp.data || {};
                  sendResponse({ success: true, data: resp.data || {}, fieldCount: fc, via: 'api-fetch' });
                } else {
                  done = true;
                  _dbgReason += 'fieldCountLow(' + fc + ', need≥3) ';
                  if (resp && resp.error) _dbgReason += 'respErr(' + resp.error + ') ';
                  console.warn('[bg] ❌ 提取失败：接口返回字段数=' + fc + ' 太少 或 success≠true。reason=' + _dbgReason, resp);
                  sendResponse({ success: false, data: {}, error: '纯接口返回无效（字段数=' + fc + '，需≥3）：' + _dbgReason });
                }
              });
            } catch (eSend) {
              if (!done) {
                done = true;
                _dbgReason += 'sendMsgException(' + (eSend && eSend.message || eSend) + ') ';
                console.warn('[bg] ❌ 提取失败：sendMessage 抛异常。reason=' + _dbgReason, eSend);
                sendResponse({ success: false, data: {}, error: 'sendMessage 异常：' + _dbgReason });
              }
            }
          });
        });
        return true; // 异步！
      } else {
        _dbgReason += 'noCode(url=' + url.slice(0, 200) + ') ';
        console.warn('[bg] ❌ 提取失败：没找到有效 code（basic=projectCode, permit=permitCode, complete=数字acceptanceId）。reason=' + _dbgReason);
        sendResponse({ success: false, data: {}, error: '无法定位详情主键：' + _dbgReason });
        return true;
      }
    }

    // ====== 🔴 已完全禁用仿真点击兜底（开 tab + 注入 + DOM 提取）======
    function fallbackCreateTab() {
      console.warn('[bg] 🚫 【已禁用】仿真点击/开新tab兜底 已被弃用！不再 fallback。type=' + type + ', url=' + (url || '').slice(0, 200));
      sendResponse({ success: false, data: {}, error: '已弃用仿真点击兜底方案（当前仅支持纯接口详情提取）' });
    }
    fallbackCreateTab(); // 兼容其他未知分支，确保一定有 sendResponse
    return true;
  }

  if (message.action === 'getResults') {
    sendResponse(JSON.parse(JSON.stringify(extractedResults)));
    return true;
  }
  if (message.action === 'setResults') {
    if (message.type) {
      extractedResults[message.type] = message.data || [];
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'clearResults') {
    if (message.type) {
      extractedResults[message.type] = [];
      detailCompleteFlags[message.type] = false;
      stopFlags[message.type] = false;
    } else {
      extractedResults = { basic: [], permit: [], complete: [] };
      detailCompleteFlags = { basic: false, permit: false, complete: false };
      stopFlags = { basic: false, permit: false, complete: false };
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'stop') {
    if (message.type) {
      stopFlags[message.type] = true;
    } else {
      stopFlags = { basic: true, permit: true, complete: true };
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'resetStop') {
    if (message.type) {
      stopFlags[message.type] = false;
    } else {
      stopFlags = { basic: false, permit: false, complete: false };
    }
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'detailComplete') {
    if (message.type) detailCompleteFlags[message.type] = true;
    sendResponse({ success: true });
    return true;
  }
  if (message.action === 'getDetailStatus') {
    sendResponse({
      complete: detailCompleteFlags[message.type] || false,
      count: (extractedResults[message.type] || []).filter(function (x) { return x && Object.keys(x).length > 0; }).length
    });
    return true;
  }

  // ====== 🔴天眼查补全：stop 开关 ======
  //   message.stop 有 3 种情况：
  //     true  → 设为停止
  //     false → 重置为未停止（开始新任务前）
  //     undefined（不传）→ 仅读取，不修改（popup 轮询判断是否该 break）
  if (message.action === 'tianyanchaSetStop') {
    if (message.stop === true || message.stop === false) {
      tianyanchaStopFlag = !!message.stop;
    }
    sendResponse({ success: true, stop: tianyanchaStopFlag });
    return true;
  }

  // ====== 🔴天眼查补全：在天眼查 tab 里执行 suggest + 详情解析 ======
  if (message.action === 'tianyanchaQuery') {
    var companyName = String(message.companyName || '').trim();
    if (!companyName) { sendResponse({ success: false, error: '公司名为空' }); return true; }
    (function () {
      try {
        findAnyTianyanchaTab(function (tab) {
          if (!tab || !tab.id) {
            sendResponse({ success: false, error: '未找到天眼查标签页（请先打开并登录 pro.tianyancha.com）' });
            return;
          }
          ensureContentScript(tab.id, tab.url, function (ok) {
            if (!ok) {
              sendResponse({ success: false, error: '天眼查 content.js 注入失败' });
              return;
            }
            var done = false;
            var tm = null;
            try {
              tm = setTimeout(function () {
                if (done) return;
                done = true;
                sendResponse({ success: false, error: '天眼查查询超时(60s)' });
              }, 60000);
            } catch (eTm) {}
            try {
              chrome.tabs.sendMessage(tab.id, {
                action: 'queryTianyancha',
                companyName: companyName,
                matchMode: message.matchMode || 'smart'
              }, function (resp) {
                try { if (tm) { clearTimeout(tm); tm = null; } } catch (eClr) {}
                if (done) return;
                done = true;
                if (chrome.runtime.lastError) {
                  sendResponse({ success: false, error: '天眼查通信失败: ' + chrome.runtime.lastError.message });
                  return;
                }
                sendResponse(resp || { success: false, error: '天眼查无响应' });
              });
            } catch (eSend) {
              try { if (tm) { clearTimeout(tm); tm = null; } } catch (eClr2) {}
              if (done) return;
              done = true;
              sendResponse({ success: false, error: '天眼查发送异常: ' + (eSend && eSend.message || eSend) });
            }
          });
        });
      } catch (eBig) { sendResponse({ success: false, error: String(eBig && eBig.message || eBig) }); }
    })();
    return true; // 异步
  }

  // ============ 🔴 【已完全弃用】仿真点击列表项目名称进入详情页提取 ============
  if (message.action === 'findClickAndExtractDetail') {
    var locator = message.locator || {};
    console.warn('[bg] 🚫 【已禁用】仿真点击 findClickAndExtractDetail 已弃用！不再点列表/弹Modal/开新tab。type=' + message.type + ', 项目名=' + (locator.projectName || '?'));
    sendResponse({ success: false, data: {}, error: '仿真点击已弃用（当前仅支持纯接口详情提取）' });
    return true;
  }

  sendResponse({ success: false, error: '未知操作' });
  return true;
});

console.log('✅ background.js 已加载');