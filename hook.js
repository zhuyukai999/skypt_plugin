(function(){
try{
    window.__PLUGIN_INJECTED_MARK__ = 1;
    window.__PLUGIN_CAPTCHA_LAST__ = window.__PLUGIN_CAPTCHA_LAST__ || null;
    window.__PLUGIN_RESPONSE_STORE__ = window.__PLUGIN_RESPONSE_STORE__ || [];
    window.__PLUGIN_ALL_RESPONSES__ = window.__PLUGIN_ALL_RESPONSES__ || [];
    window.__PLUGIN_DUMP_CAPTCHA__ = function(){
        var list = window.__PLUGIN_RESPONSE_STORE__ || [];
        console.groupCollapsed("%c🐞 【调试工具】验证码响应记录", "background:#ff4d4f;color:#fff;padding:2px 8px;border-radius:4px;");
        console.log("INJECTED?", window.__PLUGIN_INJECTED_MARK__ === 1 ? "✅ 是" : "❌ content.js未注入！");
        console.log("__PLUGIN_CAPTCHA_LAST__ =", window.__PLUGIN_CAPTCHA_LAST__);
        for(var di=0; di<list.length; di++){
            var it = list[di];
            console.log("--- #"+di+" layer="+(it.layer||"?")+" URL="+(it.url||"").substring(0,120));
            console.log("JSON=", it.json);
            if(it.textHead) console.log("head=", it.textHead);
        }
        console.log("最近30条URL=", window.__PLUGIN_ALL_RESPONSES__);
        console.groupEnd();
        return list;
    };
    window.__PLUGIN_PULL_CAPTCHA_FROM_MAIN__ = function(){
        try{ window.postMessage({ __PLUGIN_CAPTCHA_PULL_RESP__: true, last: window.__PLUGIN_CAPTCHA_LAST__, store: (window.__PLUGIN_RESPONSE_STORE__||[]).slice(-10), all: (window.__PLUGIN_ALL_RESPONSES__||[]).slice(-30) }, "*"); }catch(e){}
    };
    function _syncIso(extraLog){ try{ var m = { __PLUGIN_CAPTCHA_SYNC__: true, last: window.__PLUGIN_CAPTCHA_LAST__, store: window.__PLUGIN_RESPONSE_STORE__.slice(-10), all: window.__PLUGIN_ALL_RESPONSES__.slice(-30) }; if(extraLog) m.log = extraLog; window.postMessage(m, "*"); }catch(e){} }
    window.addEventListener("message", function(ev){ try{ var dd = ev.data || {}; if(!dd || !dd.__PLUGIN_CAPTCHA_PULL__) return; window.postMessage({ __PLUGIN_CAPTCHA_PULL_RESP__: true, last: window.__PLUGIN_CAPTCHA_LAST__, store: window.__PLUGIN_RESPONSE_STORE__.slice(-10), all: window.__PLUGIN_ALL_RESPONSES__.slice(-30) }, "*"); }catch(e){} });
    console.log("%c✅ MAIN world 顶层预定义/Hook 注入成功", "background:#1890ff;color:#fff;padding:2px 6px;border-radius:3px;");

    if(!window.__PLUGIN_CAPTCHA_HOOK_INSTALLED__){
        window.__PLUGIN_CAPTCHA_HOOK_INSTALLED__ = true;
        function _extract(obj, layer, url){
            if(!obj || typeof obj !== "object") return null;
            var fk="", fi="";
            (function sn(o, d, lk, sib){
                if(fi && fk || !o || d>12) return;
                if(typeof o === "string"){
                    if(o.length>500 && !fi && /^data:image|^\/9j\/|^iVBORw0KGg/i.test(o)){
                        fi = o;
                        if(!fk && sib) for(var b=0; b<sib.length; b++){
                            var k=sib[b][0], v=sib[b][1];
                            if(typeof v!=="string" || v.length<8 || v.length>128) continue;
                            if(/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/.test(v)){ fk = v; break; }
                            if(v.length>=16 && /key|kapt|capt|id|uuid|token|code|valid|verif|nonce|sign|random/i.test(k)){ fk = v; break; }
                        }
                        return;
                    }
                    if(!fk && typeof o==="string" && o.length>=8 && o.length<=128){
                        if(/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/.test(o)) fk = o;
                        else if(o.length>=16 && /key|kapt|capt|id|uuid|token|code|valid|verif|nonce|sign|random|secret/i.test(lk||"")) fk = o;
                    }
                    return;
                }
                if(Array.isArray(o)){ for(var a=0; a<Math.min(o.length,50); a++) sn(o[a], d+1, lk, null); return; }
                var ks = Object.keys(o), sp = [];
                for(var i=0; i<ks.length; i++){ var kk=ks[i], vv; try{ vv = o[kk]; }catch(e){ continue; } if(typeof vv === "string") sp.push([kk, vv]); }
                for(var j=0; j<ks.length; j++){ try{ sn(o[ks[j]], d+1, ks[j], sp); }catch(e){ continue; } if(fi && fk) return; }
            })(obj, 0, "", null);
            if(fi && !/^data:image/.test(fi)) fi = "data:image/jpeg;base64," + fi;
            return (fi || fk) ? { kaptchaKey: fk, image: fi, layer: layer, url: url || "" } : null;
        }
        function _rec(method, url, len){ try{ window.__PLUGIN_ALL_RESPONSES__.push({ t: Date.now(), method: method, url: (url||"").substring(0,240), len: len||0 }); if(window.__PLUGIN_ALL_RESPONSES__.length>30) window.__PLUGIN_ALL_RESPONSES__.shift(); }catch(e){} }
        function _commit(res, json, head){
            if(!res) return;
            try{ window.__PLUGIN_RESPONSE_STORE__.push({ t: Date.now(), layer: res.layer||"", url: res.url||"", json: json, textHead: head||"" }); if(window.__PLUGIN_RESPONSE_STORE__.length>10) window.__PLUGIN_RESPONSE_STORE__.shift(); }catch(e){}
            if(res.image){
                var _nl = { time: Date.now(), kaptchaKey: res.kaptchaKey || "", image: res.image, from: (res.layer||"layer") + (res.url ? ("→" + String(res.url).substring(0,120)) : "") };
                var _cur = window.__PLUGIN_CAPTCHA_LAST__;
                var _nh = !!(res.kaptchaKey && res.kaptchaKey.length >= 8);
                var _ch = !!(_cur && _cur.kaptchaKey && _cur.kaptchaKey.length >= 8);
                if(!_cur || _nh) window.__PLUGIN_CAPTCHA_LAST__ = _nl;
                else if(!_nh && !_ch && _nl.time >= (_cur.time||0)) window.__PLUGIN_CAPTCHA_LAST__ = _nl;
                if(!res.kaptchaKey) _syncIso(["[captcha-hit] ⚠️ 有图没Key！执行:", "window.__PLUGIN_DUMP_CAPTCHA__()", res]);
                else _syncIso(["[captcha-hit] ✅ layer="+res.layer+" IMG.len="+res.image.length+" KEY.len="+(res.kaptchaKey||"").length]);
            }
        }
        function _procJsonStr(text, layer, url){ if(!text || text.length<200) return; _rec(layer, url, text.length); var j; try{ j=JSON.parse(text); }catch(e){ return; } var r=_extract(j, layer, url); if(r) _commit(r, j, text.substring(0,500)); }
        function _procObj(obj, layer, url){ if(!obj || typeof obj !== "object") return; var raw; try{ raw = JSON.stringify(obj); }catch(e){ raw = ""; } _rec(layer, url, raw.length); var r=_extract(obj, layer, url); if(r && r.image) _commit(r, obj, raw.substring(0,500)); }
        function axHook(){ if(!window.axios || !window.axios.interceptors || window.__AXIOS_HIJACKED_BY_PLUGIN__) return; window.__AXIOS_HIJACKED_BY_PLUGIN__ = true; window.axios.interceptors.response.use(function(resp){ try{ var data = resp && resp.data !== undefined ? resp.data : null; var url = resp && resp.config ? resp.config.url : ""; if(typeof data === "string") _procJsonStr(data, "axios", url); else _procObj(data, "axios", url); }catch(e){} return resp; }, function(err){ return Promise.reject(err); }); console.log("[captcha-hook] ✅ axios 已挂载"); }
        axHook(); (function retryAx(times){ if(times<=0) return; setTimeout(function(){ axHook(); retryAx(times-1); }, 1500); })(5);
        try{ var _o = XMLHttpRequest.prototype.open, _s = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.open = function(m,u){ this.__u = u; return _o.apply(this, arguments); }; XMLHttpRequest.prototype.send = function(){ this.addEventListener && this.addEventListener("load", function(){ _procJsonStr(this.responseText, "xhr", this.__u); }); return _s.apply(this, arguments); }; console.log("[captcha-hook] ✅ xhr 已挂载"); }catch(e){}
        try{ var _f = window.fetch; if(_f){ window.fetch = function(u, opts){ return _f.apply(this, arguments).then(function(r){ try{ r.clone().text().then(function(t){ _procJsonStr(t, "fetch", typeof u === "string" ? u : u && u.url); }).catch(function(){}); }catch(e){} return r; }); }; console.log("[captcha-hook] ✅ fetch 已挂载"); } }catch(e){}
        try{ var sel = ".search-module-wrap img.valid-img, img.valid-img, #app img[src^=\"data:image\"]"; function _imgCheck(el){ if(!el) return; var s = (el.getAttribute && el.getAttribute("src")) || el.src || ""; if(s.length<500 || !/^data:image|^\/9j\//i.test(s)) return; if(window.__PLUGIN_CAPTCHA_LAST__ && window.__PLUGIN_CAPTCHA_LAST__.image === s) return; _commit({ kaptchaKey: "", image: s, layer: "DOM", url: "(DOM img.src)" }, null, null); } function _poll(){ try{ var imgs = document.querySelectorAll(sel); for(var i=0; i<imgs.length; i++) _imgCheck(imgs[i]); }catch(e){} } new MutationObserver(function(muts){ for(var i=0; i<muts.length; i++){ var m=muts[i]; if(m.type==="attributes" && m.attributeName==="src") _imgCheck(m.target); if(m.addedNodes) for(var j=0; j<m.addedNodes.length; j++){ var n=m.addedNodes[j]; if(n && 1===n.nodeType && "IMG"===n.tagName) _imgCheck(n); } } }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] }); setInterval(_poll, 400); setTimeout(_poll, 100); console.log("[captcha-hook] ✅ DOM 监听已挂载"); }catch(e){}
    }
}catch(bigE){ console.warn("[MAIN-world inject top] 异常:", bigE); }
})();