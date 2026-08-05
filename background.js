// ===== 全局状态 =====
var extractedResults = { basic: [], permit: [], complete: [] };
var detailCompleteFlags = { basic: false, permit: false, complete: false };
var stopFlags = { basic: false, permit: false, complete: false };
var detailTabs = new Map(); // tabId -> { type, created }

// ===== 🔴 全局串行队列：仿真点击一次只能跑一个，彻底杜绝竞态/重复打开/监听器互相干扰 =====
var simulateQueue = []; // 待执行项: { message, sender, sendResponse }
var simulateQueueRunning = false;
function runNextSimulate() {
  if (simulateQueueRunning) return;
  if (simulateQueue.length === 0) return;
  simulateQueueRunning = true;
  var next = simulateQueue.shift();
  console.log('[bg] 🎯 仿真队列: 开始执行, 剩余队列=' + simulateQueue.length);
  // 复用现有处理函数（包装成 doFindClickAndExtractDetail）
  doFindClickAndExtractDetail(next.message, next.sender, function (resp) {
    try { next.sendResponse(resp); } catch (e) {}
    simulateQueueRunning = false;
    // 500ms 后再出队，给浏览器清理 tab、GC 的喘息时间
    setTimeout(runNextSimulate, 500);
  });
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
            callback(true);
            return;
        }
        console.log('[bg]  ping 无响应，主动注入 content.js');
        try {
            chrome.scripting.executeScript(
                { target: { tabId: tabId }, files: ['content.js'] },
                function (results) {
                    if (chrome.runtime.lastError || !results) {
                        console.error('[bg]  注入失败:', chrome.runtime.lastError ? chrome.runtime.lastError.message : '未知错误');
                        callback(false);
                    } else {
                        console.log('[bg]  注入成功，等待 1200ms 让 content 完全初始化');
                        setTimeout(function () { callback(true); }, 1200);
                    }
                }
            );
        } catch (e) {
            console.error('[bg]  注入异常:', e);
            callback(false);
        }
    });
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
    console.log('[bg] ⭐ openAndExtractDetail 收到请求: type=' + type + ', rowIndex=' + rowIndex + ', url=' + url.slice(0, 120));

    if (!url || !type) {
      sendResponse({ success: false, error: '缺少参数' });
      return true;
    }

    if (stopFlags[type]) {
      sendResponse({ success: false, error: '用户已停止' });
      return true;
    }

    // =========================================================================
    // 🔴✅ 方案一：basic / permit 优先走纯接口 fetch（0 干扰，不开新 tab！）
    //   - 成功：直接返回，完全不产生新 tab，用户 0 感知
    //   - 失败（没 code / 没 skypt tab / 接口错 / 字段少）：fallback 到原来的开 tab 逻辑兜底
    // =========================================================================
    if (type === 'basic' || type === 'permit') {
      var codeToFetch = '';
      try {
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
        } catch (eu1) {}
        if (!codeToFetch) {
          var rx = type === 'basic' ? /[?&]projectCode=([^&#]+)/ : /[?&]permitCode=([^&#]+)/;
          var m = url.match(rx);
          if (m) codeToFetch = decodeURIComponent(m[1]);
        }
      } catch (euBig) {}
      codeToFetch = (codeToFetch || '').trim();

      if (codeToFetch) {
        console.log('[bg] 🚀 ' + type + ' 优先尝试纯接口（不开tab）: code=' + codeToFetch);
        _findAnySkyptTab(function (tab) {
          if (!tab || !tab.id) {
            console.log('[bg]  ⚠️ 无可用 skypt tab → fallback 开新 tab');
            fallbackCreateTab();
            return;
          }
          ensureContentScript(tab.id, tab.url, function (ok) {
            if (!ok) {
              console.log('[bg]  ⚠️ content 注入失败 → fallback 开新 tab');
              fallbackCreateTab();
              return;
            }
            var fetchTimeoutT = null;
            var fallbackStarted = false;
            try {
              fetchTimeoutT = setTimeout(function () {
                if (fallbackStarted) return;
                fallbackStarted = true;
                console.log('[bg]  ⚠️ fetch 超时(25s) → fallback 开新 tab');
                fallbackCreateTab();
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
                if (fallbackStarted) return;
                if (chrome.runtime.lastError) {
                  console.warn('[bg]  ⚠️ fetch sendMessage 失败: ' + chrome.runtime.lastError.message + ' → fallback 开新 tab');
                  fallbackStarted = true;
                  fallbackCreateTab();
                  return;
                }
                var fc = (resp && resp.data) ? Object.keys(resp.data).length : 0;
                if (resp && (resp.success === true) && fc >= 2) {
                  console.log('[bg] 🟢 ' + type + ' 纯接口提取成功！(字段数=' + fc + '，不开新 tab，用户0感知) via=' + (resp.via || ''));
                  if (!extractedResults[type]) extractedResults[type] = [];
                  extractedResults[type][rowIndex] = resp.data || {};
                  sendResponse({ success: true, data: resp.data || {}, fieldCount: fc, via: 'api-fetch' });
                } else {
                  console.warn('[bg]  ⚠️ 接口返回字段数=' + fc + '太少，fallback 开新 tab。error=' + (resp && resp.error ? resp.error : ''));
                  fallbackStarted = true;
                  fallbackCreateTab();
                }
              });
            } catch (eSend) {
              console.warn('[bg]  ⚠️ sendMessage 异常 → fallback 开新 tab:', eSend);
              if (!fallbackStarted) { fallbackStarted = true; fallbackCreateTab(); }
            }
          });
        });
        return true; // 异步！
      } else {
        console.log('[bg]  ⚠️ ' + type + ' URL 里没找到 code，fallback 开新 tab');
      }
    }

    // ====== 🔴 fallback（兜底）：原来的开 tab + 注入 + DOM 提取逻辑（完全保留） ======
    function fallbackCreateTab() {
    chrome.tabs.create({ url: url, active: false }, function (tab) {
      if (chrome.runtime.lastError || !tab || !tab.id) {
        var err = chrome.runtime.lastError ? chrome.runtime.lastError.message : '创建标签失败';
        console.error('[bg] 创建标签失败:', err);
        sendResponse({ success: false, error: err });
        return;
      }

      var tabId = tab.id;
      detailTabs.set(tabId, { type: type, created: Date.now() });
      console.log('[bg]  已创建标签页 tabId=' + tabId);

      var waited = 0;
      var waitInterval = 400;
      var maxWait = 15000;
      var scriptInjected = false;
      var finished = false;

      function cleanupAndSend(result) {
          if (finished) return;
          finished = true;
          detailTabs.delete(tabId);
          var dataSize = result && result.data ? Object.keys(result.data).length : 0;
          console.log('[bg] 🔚 详情提取完成 tabId=' + tabId + ', success=' + (result && result.success) + ', 字段数=' + dataSize + (result && result.error ? ', error=' + result.error : ''));
          try {
              chrome.tabs.remove(tabId, function () {
                  sendResponse(result);
              });
          } catch (e) {
              sendResponse(result);
          }
      }

      function sendExtractMessage() {
        if (stopFlags[type]) {
          cleanupAndSend({ success: false, error: '用户已停止' });
          return;
        }
        console.log('[bg]  发送 extractDetail 消息给 tabId=' + tabId + ', type=' + type);
        chrome.tabs.sendMessage(tabId, { action: 'extractDetail', type: type }, function (resp) {
          if (chrome.runtime.lastError) {
            var errmsg = chrome.runtime.lastError.message;
            console.warn('[bg]   sendMessage 失败: ' + errmsg + ', waited=' + waited);
            if (waited < maxWait + 3000) {
              waited += 800;
              setTimeout(sendExtractMessage, 800);
              return;
            }
            cleanupAndSend({ success: false, error: '无法与页面通信: ' + errmsg });
            return;
          }

          var data = (resp && resp.data) ? resp.data : {};
          var fc = Object.keys(data).length;
          console.log('[bg]   收到响应，字段数=' + fc, data);

          if (fc < 5 && !sendExtractMessage._retried) {
            sendExtractMessage._retried = true;
            console.log('[bg]   字段数=' + fc + '太少（DOM未渲染完），1500ms 后重试一次');
            waited += 1500;
            setTimeout(sendExtractMessage, 1500);
            return;
          }

          if (!extractedResults[type]) extractedResults[type] = [];
          extractedResults[type][rowIndex] = data;

          cleanupAndSend({ success: true, data: data });
        });
      }

      function tryInjectAndExtract() {
        if (stopFlags[type]) {
          cleanupAndSend({ success: false, error: '用户已停止' });
          return;
        }

        chrome.tabs.get(tabId, function (t) {
          if (chrome.runtime.lastError || !t) {
            console.error('[bg]  标签页不存在 tabId=' + tabId);
            cleanupAndSend({ success: false, error: '标签页不存在' });
            return;
          }

          if (t.status === 'complete' || waited >= maxWait) {
            console.log('[bg]  页面 status=' + t.status + ', waited=' + waited + 'ms → 开始注入+提取');
            if (!scriptInjected) {
              ensureContentScript(tabId, url, function (ok) {
                scriptInjected = true;
                if (ok) {
                  setTimeout(sendExtractMessage, 2500);
                } else {
                  if (waited < maxWait + 2000) {
                    waited += 1000;
                    setTimeout(tryInjectAndExtract, 1000);
                  } else {
                    console.warn('[bg]  注入失败，返回空结果');
                    cleanupAndSend({ success: true, data: {} });
                  }
                }
              });
            } else {
              sendExtractMessage();
            }
          } else {
            waited += waitInterval;
            if (waited % 2000 === 0) console.log('[bg]  等待页面加载... tabId=' + tabId + ', waited=' + waited + 'ms, status=' + t.status);
            setTimeout(tryInjectAndExtract, waitInterval);
          }
        });
      }

      setTimeout(tryInjectAndExtract, 1000);
    });
    } // end fallbackCreateTab
    // basic/permit 走到这里（没 code 或之前代码还没执行），手动调一下 fallback（但一般前面 codeToFetch 判断已经覆盖了）
    if (!(type === 'basic' || type === 'permit') || !codeToFetch) {
      fallbackCreateTab();
    }
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
    // 关闭所有详情标签
    detailTabs.forEach(function (info, tabId) {
      if (!message.type || info.type === message.type) {
        try { chrome.tabs.remove(tabId); } catch (e) {}
        detailTabs.delete(tabId);
      }
    });
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

  // ============ 🔴 仿真点击列表项目名称进入详情页提取（入全局串行队列）============
  if (message.action === 'findClickAndExtractDetail') {
    var locator = message.locator || {};
    console.log('[bg] 🖱️ findClickAndExtractDetail 收到请求并入队: type=' + message.type + ', 项目名=' + (locator.projectName || '?') + ', 当前队列长度=' + (simulateQueue.length + 1));
    simulateQueue.push({ message: message, sender: sender, sendResponse: sendResponse });
    setTimeout(runNextSimulate, 0);
    return true; // 异步 sendResponse
  }

  sendResponse({ success: false, error: '未知操作' });
  return true;
});

// ============ 🔴 仿真点击的真正执行函数（被全局串行队列调用）============
function doFindClickAndExtractDetail(message, sender, qCallback) {
  var locator = message.locator || {};
  var type = message.type;
  var rowIndex = message.rowIndex || 0;

  if (!locator || !locator.listUrl) {
    qCallback({ success: false, error: '缺少定位器或列表URL' });
    return;
  }
  if (stopFlags[type]) {
    qCallback({ success: false, error: '用户已停止' });
    return;
  }

  // 🔴✅ 竣工验收备案(type=complete)：优先「接口纯 fetch」（拿到数字ID → 0干扰不弹Modal）；拿不到 ID 才 fallback 到「点列表弹 Modal」兜底
  if (type === 'complete') {
    var doneCalled_c = false;
    function done_c(result) {
      if (doneCalled_c) return;
      doneCalled_c = true;
      var dataSize = (result && result.data) ? Object.keys(result.data).length : 0;
      var via = (result && result.via) ? ('[via=' + result.via + '] ') : '';
      console.log('[bg] 🧾✅ 竣工验收备案(type=complete)提取完成 ' + via + 'success=' + (result && result.success) + ', 字段数=' + dataSize + (result && result.error ? ', error=' + result.error : ''));
      qCallback(result);
    }
    var accId = '';
    try {
      accId = String((locator.acceptanceId !== undefined && locator.acceptanceId !== null) ? locator.acceptanceId : '').trim();
      if (!accId && message.listRow && message.listRow._acceptanceId) accId = String(message.listRow._acceptanceId || '').trim();
    } catch (eAcc) { accId = ''; }

    // 1) 找 locator.listUrl 对应的 tab（就是我们的列表页）
    chrome.tabs.query({ url: '*://skypt.gdcic.net/*' }, function (allTabs) {
      var listTab = null;
      for (var i = 0; i < allTabs.length; i++) {
        var t = allTabs[i];
        if (t && t.url && (t.url === locator.listUrl || t.url.split('#')[0] === locator.listUrl.split('#')[0] || (t.url.indexOf('/project?type=6') !== -1 && locator.listUrl.indexOf('/project?type=6') !== -1))) {
          listTab = t; break;
        }
      }
      if (!listTab) {
        for (var j = 0; j < allTabs.length; j++) {
          var tt = allTabs[j];
          if (tt && tt.url && tt.url.indexOf('openplatform/') !== -1 && tt.url.indexOf('/project?type=6') !== -1) {
            listTab = tt; break;
          }
        }
      }
      if (!listTab || !listTab.id) {
        done_c({ success: false, error: '找不到竣工验收备案列表页 tab' });
        return;
      }

      var listTabId = listTab.id;
      console.log('[bg] 🧾 找到竣工验收备案列表页 tabId=' + listTabId + ', url=' + listTab.url + (accId ? ', 有数字ID=' + accId + ' → 优先走接口' : ', 无数字ID → fallback弹Modal'));

      ensureContentScript(listTabId, listTab.url, function (ok) {
        if (!ok) {
          done_c({ success: false, error: 'content script 注入失败 tabId=' + listTabId });
          return;
        }

        // =========================================================================
        // 🔴✅ 路径 A（优先）：有数字 acceptanceId → 纯接口 fetch（0 干扰，不弹 Modal）
        //     真实接口：GET /api/openplatform/projectAcceptanceArchive/get/{数字ID}（来自用户cURL）
        // =========================================================================
        if (accId && /^\d+$/.test(accId)) {
          var fetchAccTimeout = null;
          var accFallbackStarted = false;
          try {
            fetchAccTimeout = setTimeout(function () {
              if (accFallbackStarted) return;
              accFallbackStarted = true;
              console.warn('[bg] 🧾 接口超时（25s）→ fallback 弹 Modal');
              fallbackClickAndModal();
            }, 25000);
          } catch (eTM) {}
          try {
            var listRowForApi = (locator.listRow && typeof locator.listRow === 'object') ? locator.listRow : (message.listRow || {});
            chrome.tabs.sendMessage(listTabId, {
              action: 'fetchDetail',
              type: 'complete',
              code: accId,
              extra: { listRow: listRowForApi }
            }, function (resp) {
              try { if (fetchAccTimeout) { clearTimeout(fetchAccTimeout); fetchAccTimeout = null; } } catch (eClr) {}
              if (accFallbackStarted) return;
              if (chrome.runtime.lastError) {
                console.warn('[bg] 🧾 接口 sendMessage 失败 → fallback 弹 Modal: ' + chrome.runtime.lastError.message);
                accFallbackStarted = true;
                fallbackClickAndModal();
                return;
              }
              var fc = (resp && resp.data) ? Object.keys(resp.data).length : 0;
              if (resp && resp.success && fc >= 3) {
                done_c({ success: true, data: resp.data || {}, fieldCount: fc, via: 'api-fetch' });
              } else {
                console.warn('[bg] 🧾 接口返回字段数=' + fc + '太少（需≥3）→ fallback 弹 Modal。error=' + (resp && resp.error ? resp.error : ''));
                accFallbackStarted = true;
                fallbackClickAndModal();
              }
            });
          } catch (eSendApi) {
            console.warn('[bg] 🧾 接口调用异常 → fallback 弹 Modal:', eSendApi);
            if (!accFallbackStarted) { accFallbackStarted = true; fallbackClickAndModal(); }
          }
          return;
        }

        // =========================================================================
        // 🔴 路径 B（兜底）：没数字 ID / 接口失败 → 走原来的仿真点链接 + 弹 Modal 提取
        // =========================================================================
        fallbackClickAndModal();

        function fallbackClickAndModal() {
          var contentTimeout = setTimeout(function () {
            done_c({ success: false, error: '竣工验收备案 content 提取超时(35s)', data: {}, via: 'modal-fallback' });
          }, 35000);
          setTimeout(function () {
            chrome.tabs.sendMessage(listTabId, { action: 'extractCompleteModal', rowIndex: rowIndex, locator: locator }, function (resp) {
              try { clearTimeout(contentTimeout); } catch (e) {}
              if (chrome.runtime.lastError) {
                console.warn('[bg] 🧾 sendMessage extractCompleteModal 失败: ' + chrome.runtime.lastError.message);
                done_c({ success: false, error: chrome.runtime.lastError.message, data: {}, via: 'modal-fallback' });
                return;
              }
              var out = resp || { success: false, error: '无响应' };
              out.via = (out.via ? out.via : 'modal');
              done_c(out);
            });
          }, 300);
        }
      });
    });

    return; // 🔴 竣工验收备案：到这里就结束了，下面的 basic/permit 逻辑完全不执行！
  }

  // 下面保持原样（basic/permit 仿真点击：创建新 tab + 监听跳转 + 提取）
  var listTabId = null;
  var newDetailTabId = null;
  var waited = 0;
  var scriptInjected = false;
  var clickFinished = false;
  var clickFinishedAt = 0;  // 🔴 新增：记录点击发生时间戳，做时间窗口过滤
  var finished = false;
  var checkTimer = null;
  var createdTabIds = [];
  var toRemove = []; // 🔴 移到外层：待清理的 tabIds，checkCandidateDetailTabs 会追加多余重复打开的
    var MAX_WAIT = 30000;
    var STARTED_AT = Date.now(); // 🔴 新增：本任务开始时间，用于兜底扫尾 tab

    function cleanupAndSend(result) {
      if (finished) return;
      finished = true;
      if (checkTimer) { try { clearInterval(checkTimer); } catch (e) {} checkTimer = null; }
      try { chrome.tabs.onCreated.removeListener(handleTabCreated); } catch (e) {}

      // 两个核心 tab（显式识别的）加入清理列表（toRemove 里已经有 checkCandidateDetailTabs 追加的多余 tab 了）
      if (listTabId && toRemove.indexOf(listTabId) === -1) toRemove.push(listTabId);
      if (newDetailTabId && toRemove.indexOf(newDetailTabId) === -1) toRemove.push(newDetailTabId);
      detailTabs.delete(listTabId);
      detailTabs.delete(newDetailTabId);
      var dataSize = result && result.data ? Object.keys(result.data).length : 0;
      console.log('[bg] 🖱️🔚 仿真提取完成 success=' + (result && result.success) + ', 字段数=' + dataSize + (result && result.error ? ', error=' + result.error : '') + ', 清理所有tabs:', toRemove);

      function doCloseExplicitThenSweepAndCallback() {
        // 1. 先关显式识别到的两个 tab
        function closeNext() {
          if (toRemove.length === 0) {
            // 2. 🔴 兜底扫尾：把"本任务开始后创建的、skypt域名、不是当前激活、URL包含列表或详情特征"的 tab 也都关掉
            try {
              chrome.tabs.query({}, function (allTabs) {
                var sweeped = [];
                var now = Date.now();
                for (var i = 0; i < allTabs.length; i++) {
                  var t = allTabs[i];
                  if (!t || !t.id) continue;
                  if (t.active) continue; // 不关掉用户正在看的
                  if (t.pinned) continue;
                  var u = t.url || '';
                  if (u.indexOf('skypt.gdcic.net/openplatform/') === -1) continue;
                  // 只关我们这个任务"开始之后"可能产生的临时 tab（创建时间我们拿不到，就用 tab.id 在 detailTabs 里记录过的 或 URL特征匹配）
                  var looksLikeOurTempTab = false;
                  if (u.indexOf('/project?type=') !== -1 && u !== locator.listUrl) looksLikeOurTempTab = true; // 另一个列表页（重复打开的）
                  if (u.indexOf('/detail?') !== -1 && u.indexOf('projectId=') === -1) looksLikeOurTempTab = true; // 重复的详情页
                  // 另外：在 detailTabs Map 里但 toRemove 里没有的（就是前面竞态遗留的）
                  if (detailTabs.has(t.id) && toRemove.indexOf(t.id) === -1) looksLikeOurTempTab = true;
                  if (looksLikeOurTempTab) sweeped.push(t.id);
                }
                if (sweeped.length > 0) {
                  console.log('[bg] 🖱️🧹 兜底扫尾清理多余 tabIds:', sweeped);
                  var left = sweeped.slice();
                  function rmNext() {
                    if (left.length === 0) { qCallback(result); return; }
                    var nx = left.shift();
                    try {
                      chrome.tabs.remove(nx, function () {
                        if (chrome.runtime.lastError) { /* ignore */ }
                        detailTabs.delete(nx);
                        rmNext();
                      });
                    } catch (e) { rmNext(); }
                  }
                  rmNext();
                } else {
                  qCallback(result);
                }
              });
            } catch (sweepErr) {
              qCallback(result);
            }
            return;
          }
          var nx = toRemove.shift();
          try {
            chrome.tabs.remove(nx, function () {
              if (chrome.runtime.lastError) { /* ignore */ }
              closeNext();
            });
          } catch (e) { closeNext(); }
        }
        closeNext();
      }
      doCloseExplicitThenSweepAndCallback();
    }

    // 🎯 监听所有新创建的 tab —— 🔴 严格的 clickFinished 之后才记录 + 时间窗口过滤
    function handleTabCreated(tab) {
      if (!tab || !tab.id || finished) return;
      if (listTabId && tab.id === listTabId) return;
      // 🔴 关键：只有 clickFinished=true（用户点了项目名称）之后创建的新 tab 才可能是详情页！
      // 坚决丢弃 clickFinished=false 时我们自己创建的临时列表 tab！
      if (!clickFinished) return;
      var now = Date.now();
      if (clickFinishedAt > 0 && (now - clickFinishedAt) > 15000) {
        // 点击发生超过 15 秒后再出现的新 tab，大概率不是我们的
        return;
      }
      createdTabIds.push(tab.id);
      console.log('[bg] 🖱️   [onCreated ✅有效] tabId=' + tab.id + ', 距点击=' + (clickFinishedAt ? (now - clickFinishedAt) : '?') + 'ms, url=' + (tab.url || '(加载中)'));
    }

    function sendExtractMessage(detailTabId) {
      if (stopFlags[type]) { cleanupAndSend({ success: false, error: '用户已停止' }); return; }
      console.log('[bg] 🖱️   发送 extractDetail 给详情 tabId=' + detailTabId);
      ensureContentScript(detailTabId, 'https://skypt.gdcic.net/openplatform/', function (ok) {
        if (!ok) {
          if (waited < MAX_WAIT) {
            waited += 700;
            setTimeout(function () { sendExtractMessage(detailTabId); }, 700);
          } else {
            cleanupAndSend({ success: false, error: '详情页注入content失败' });
          }
          return;
        }
        setTimeout(function () {
          chrome.tabs.sendMessage(detailTabId, { action: 'extractDetail', type: type }, function (resp) {
            if (chrome.runtime.lastError) {
              console.warn('[bg] 🖱️   详情tab sendMessage 失败: ' + chrome.runtime.lastError.message + ', waited=' + waited);
              if (waited < MAX_WAIT) {
                waited += 700;
                setTimeout(function () { sendExtractMessage(detailTabId); }, 700);
              } else {
                cleanupAndSend({ success: false, error: '无法与详情页通信' });
              }
              return;
            }
            var data = (resp && resp.data) ? resp.data : {};
            var sz = Object.keys(data).length;
            console.log('[bg] 🖱️   收到响应字段数=' + sz, sz > 0 ? data : '(空)');
            if (sz === 0 && waited < MAX_WAIT / 2) {
              waited += 1000;
              setTimeout(function () { sendExtractMessage(detailTabId); }, 1000);
              return;
            }
            if (!extractedResults[type]) extractedResults[type] = [];
            extractedResults[type][rowIndex] = data;
            cleanupAndSend({ success: true, data: data });
          });
        }, 1200);
      });
    }

    function checkCandidateDetailTabs() {
      if (finished || !clickFinished) return;
      chrome.tabs.query({}, function (allTabs) {
        if (finished) return;
        var candidate = null;
        var normListUrl = locator.listUrl.split('#')[0] + locator.listUrl.split('#')[1];
        // 优先：onCreated 捕获到的、且不是列表页 URL，且是详情页风格的 tab
        for (var i = createdTabIds.length - 1; i >= 0; i--) {
          var t = null;
          for (var k = 0; k < allTabs.length; k++) {
            if (allTabs[k].id === createdTabIds[i]) { t = allTabs[k]; break; }
          }
          if (!t) continue;
          var u = t.url || '';
          if (u.indexOf('skypt.gdcic.net') === -1) continue;
          // 🔴 严格：候选详情页必须不是列表页（列表页不能当详情页用）
          if (u.indexOf('/project?type=') !== -1) continue; // 列表页
          if (u.indexOf('/permit?') !== -1) continue;
          if (u.indexOf('/complete?') !== -1) continue;
          // 🔴 最好是包含 detail 关键词的（真·详情页）
          if (u.indexOf('detail') !== -1 || u.indexOf('projectId=') !== -1 || u.indexOf('projCode=') !== -1 || u.indexOf('id=') !== -1) {
            candidate = t;
            break;
          }
        }
        // 兜底1：找 openerTabId === listTabId 的
        if (!candidate) {
          for (var j = 0; j < allTabs.length; j++) {
            if (allTabs[j].openerTabId === listTabId) {
              var u2 = allTabs[j].url || '';
              if (u2.indexOf('/project?type=') === -1) {
                candidate = allTabs[j]; break;
              }
            }
          }
        }
        // 兜底2：如果列表 tab 自己 URL 变了（原地跳转）
        if (!candidate && listTabId) {
          chrome.tabs.get(listTabId, function (lt) {
            if (finished) return;
            if (lt && lt.url && lt.url.indexOf('/project?type=') === -1 && lt.url.indexOf('skypt.gdcic.net') !== -1) {
              sendExtractMessage(listTabId);
            } else if (waited >= MAX_WAIT) {
              cleanupAndSend({ success: false, error: '等待详情页超时' });
            }
          });
          return;
        }
        if (candidate) {
          newDetailTabId = candidate.id;
          console.log('[bg] 🖱️   ✅ 确定详情页 tabId=' + candidate.id + ', url=' + candidate.url);
          // 🔴 额外保护：把 createdTabIds 里除了这个详情页外的其它（可能是重复打开的错误 tab）也加入待关列表
          for (var ii = 0; ii < createdTabIds.length; ii++) {
            var extraId = createdTabIds[ii];
            if (extraId !== newDetailTabId && extraId !== listTabId && toRemove.indexOf(extraId) === -1) {
              toRemove.push(extraId);
              console.log('[bg] 🖱️   附带清理多余候选 tabId=' + extraId);
            }
          }
          sendExtractMessage(candidate.id);
          if (checkTimer) { try { clearInterval(checkTimer); } catch (e) {} checkTimer = null; }
        } else if (waited >= MAX_WAIT) {
          cleanupAndSend({ success: false, error: '找不到新详情页tab' });
        }
      });
    }

    function tryClickRow() {
      if (finished) return;
      if (stopFlags[type]) { cleanupAndSend({ success: false, error: '用户已停止' }); return; }
      waited += 500;

      chrome.tabs.get(listTabId, function (t) {
        if (finished) return;
        if (chrome.runtime.lastError || !t) {
          cleanupAndSend({ success: false, error: '列表页标签已丢失' });
          return;
        }

        if (!scriptInjected) {
          ensureContentScript(listTabId, locator.listUrl, function (ok) {
            scriptInjected = true;
            if (!ok) {
              if (waited < MAX_WAIT / 2) {
                setTimeout(tryClickRow, 800);
              } else {
                cleanupAndSend({ success: false, error: '注入content失败' });
              }
              return;
            }
            setTimeout(tryClickRow, 400);
          });
          return;
        }

        if (!clickFinished) {
          if (t.status !== 'complete' && waited < 4000) {
            setTimeout(tryClickRow, 500);
            return;
          }
          console.log('[bg] 🖱️   发送 findClickRow 消息给列表 tabId=' + listTabId + ', waited=' + waited);
          chrome.tabs.sendMessage(listTabId, { action: 'findClickRow', locator: locator }, function (resp) {
            if (finished) return;
            if (chrome.runtime.lastError) {
              console.warn('[bg] 🖱️   findClickRow sendMessage 失败: ' + chrome.runtime.lastError.message);
              if (waited < MAX_WAIT / 2) setTimeout(tryClickRow, 600);
              else cleanupAndSend({ success: false, error: '查找行失败' });
              return;
            }
            if (resp && resp.success) {
              clickFinished = true;
              clickFinishedAt = Date.now(); // 🔴 记录点击时间，做时间窗口过滤
              waited += 500;
              console.log('[bg] 🖱️   点击成功，等待详情页新标签创建... clickFinishedAt=' + clickFinishedAt);
              if (!checkTimer) checkTimer = setInterval(checkCandidateDetailTabs, 700);
              setTimeout(checkCandidateDetailTabs, 1500);
            } else if (waited < MAX_WAIT / 2) {
              console.warn('[bg] 🖱️   未找到行，重试... err=' + (resp && resp.error ? resp.error : ''));
              setTimeout(tryClickRow, 700);
            } else {
              cleanupAndSend({ success: false, error: resp && resp.error ? resp.error : '找不到匹配行' });
            }
          });
        }
      });
    }

    // 🚀 启动：先绑定 onCreated（防止漏掉），再创建临时列表页
    chrome.tabs.onCreated.addListener(handleTabCreated);
    setTimeout(function () {
      try { chrome.tabs.onCreated.removeListener(handleTabCreated); } catch (e) {}
      if (!finished) cleanupAndSend({ success: false, error: '总超时' });
    }, MAX_WAIT + 5000);

    chrome.tabs.create({ url: locator.listUrl, active: false }, function (tab) {
      if (chrome.runtime.lastError || !tab || !tab.id) {
        var err = chrome.runtime.lastError ? chrome.runtime.lastError.message : '创建标签失败';
        console.error('[bg] 🖱️ 创建列表标签失败:', err);
        try { chrome.tabs.onCreated.removeListener(handleTabCreated); } catch (e) {}
        qCallback({ success: false, error: err });
        return;
      }
      listTabId = tab.id;
      detailTabs.set(listTabId, { type: type, created: Date.now() });
      console.log('[bg] 🖱️ 已创建临时列表标签 tabId=' + listTabId);
      setTimeout(tryClickRow, 1500);
    });
}

// （doFindClickAndExtractDetail 结束）

console.log('✅ background.js 已加载');