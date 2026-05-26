/**
 * Loading shell HTML：preview 站入口请求（带 query token）返回此 shell，
 * shell 内 JS 用 fetch + ReadableStream 监听 HTML 真实下载进度，
 * 跟随进度驱动一个 PM 搬砖火柴人前进，完成后 document.open/write 替换文档。
 *
 * R3 改进：
 * - 进度阶段映射：启动 10% / 收到 headers 20% / chunks 20-85% / read done 90% / 预加载 90-100%
 * - 最低显示时长 600ms 保护：用 Promise.all 等流程与 sleep(600) 双完成
 * - 满载后停 250ms 视觉确认（"小人到达终点"）再 document.write
 * - worker.style.left transition 150ms linear（chunk 间隔可能 < 200ms，避免追不上 fill）
 * - .track 加 overflow:hidden（修 indet 模式 margin-left 溢出 bug）
 * - role="progressbar" + aria-valuenow（a11y）
 * - @media (prefers-reduced-motion: reduce) 动画停摆（前庭敏感用户友好）
 * - 完成态 worker animation paused（站定不再走步）
 * - P2 FOUC 消除留 [R3 轮 2 增量]
 */
export function renderLoadingShell(cleanPath: string): string {
  // 用 JSON.stringify 安全嵌入，防 XSS（cleanPath 来自 nextUrl.pathname 已校验，但再保险一道）
  const targetLiteral = JSON.stringify(cleanPath);
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>加载中…</title>
<meta name="referrer" content="no-referrer">
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;
     background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
     color:#171717}
.wrap{display:flex;flex-direction:column;align-items:center;gap:14px}
.pct{font-size:12px;color:#737373;font-variant-numeric:tabular-nums;letter-spacing:0.02em;
     min-width:36px;text-align:center}
.track{position:relative;width:360px;max-width:calc(100vw - 40px);
       height:2px;background:#e5e5e5;border-radius:1px;overflow:hidden}
.fill{height:100%;width:0;background:#171717;border-radius:1px;
      transition:width 240ms cubic-bezier(0.25,0.46,0.45,0.94)}
.worker{position:absolute;bottom:0;left:0;width:14px;height:22px;
        transform:translateX(-50%);
        transition:left 150ms linear;
        pointer-events:none;
        overflow:visible}
.worker svg{display:block;overflow:visible;stroke:#171717;stroke-width:1.2;
            stroke-linecap:round;fill:none}
.worker .brick{fill:#171717;stroke:none;
               animation:pm-brick 0.4s ease-in-out infinite;
               transform-origin:7px 1px}
.worker .leg-l{transform-origin:7px 13px;
               animation:pm-walk-l 0.5s linear infinite}
.worker .leg-r{transform-origin:7px 13px;
               animation:pm-walk-r 0.5s linear infinite}
@keyframes pm-walk-l{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(12deg)}}
@keyframes pm-walk-r{0%,100%{transform:rotate(12deg)}50%{transform:rotate(-12deg)}}
@keyframes pm-brick{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.indet .fill{width:30%;animation:pm-slide 1.2s ease-in-out infinite}
@keyframes pm-slide{0%{margin-left:-30%}100%{margin-left:100%}}
/* 完成态：小人站定不走，砖头停颤（强制零旋转避免冻结在中间帧"半弯腿"） */
body[data-prd-shell="ready"] .worker .leg-l,
body[data-prd-shell="ready"] .worker .leg-r{animation:none;transform:rotate(0deg)}
body[data-prd-shell="ready"] .worker .brick{animation:none;transform:translateY(0)}
.err{font-family:system-ui;color:#b91c1c;padding:40px 20px;text-align:center;line-height:1.7}
.err small{color:#737373;display:block;margin-top:8px;font-size:12px}
/* 前庭敏感用户友好 */
@media (prefers-reduced-motion: reduce) {
  .worker .leg-l, .worker .leg-r, .worker .brick { animation: none }
  .fill, .worker { transition: none }
  .indet .fill { animation: none; width: 100% }
}
</style>
</head>
<body data-prd-shell="loading">
<div class="wrap">
  <div class="pct" id="pct">0%</div>
  <div class="track" id="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="预览加载进度">
    <div class="fill" id="fill"></div>
    <div class="worker" id="worker">
      <svg viewBox="0 0 14 22" width="14" height="22" aria-hidden="true">
        <rect class="brick" x="2" y="0" width="10" height="2.6" rx="0.4"/>
        <circle cx="7" cy="6" r="1.8"/>
        <line x1="7" y1="8" x2="7" y2="13"/>
        <line x1="7" y1="9" x2="3.5" y2="4.5"/>
        <line x1="7" y1="9" x2="10.5" y2="4.5"/>
        <line class="leg-l" x1="7" y1="13" x2="4.5" y2="20"/>
        <line class="leg-r" x1="7" y1="13" x2="9.5" y2="20"/>
      </svg>
    </div>
  </div>
</div>
<script>
(async function(){
  var TARGET = ${targetLiteral};
  var track = document.getElementById('track');
  var fill = document.getElementById('fill');
  var worker = document.getElementById('worker');
  var pct = document.getElementById('pct');

  function setProgress(p){
    var clamped = Math.max(0, Math.min(p, 1));
    var percent = Math.round(clamped * 100);
    fill.style.width = (clamped * 100) + '%';
    worker.style.left = (clamped * 100) + '%';
    pct.textContent = percent + '%';
    track.setAttribute('aria-valuenow', String(percent));
  }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function fail(msg){
    document.body.setAttribute('data-prd-shell','error');
    var safe = String(msg).replace(/[<>&]/g, function(c){
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;';
    });
    document.body.innerHTML = '<div class="err">加载失败：' + safe +
      '<small>关闭当前窗口，回到主站重新点击该文件即可重试</small></div>';
  }

  // 阶段 1：IIFE 启动 → 10%（消除 0% 静止感）
  setProgress(0.10);
  var minHold = sleep(600);  // 最低显示时长保护

  try {
    var res = await fetch(TARGET, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) { fail('HTTP ' + res.status); return; }

    // 阶段 2：拿到 headers → 20%
    setProgress(0.20);
    var total = Number(res.headers.get('content-length') || 0);
    var reader = res.body.getReader();
    var chunks = [];
    var loaded = 0;
    if (!total) track.classList.add('indet');

    while (true) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      loaded += step.value.byteLength;
      if (total) {
        // 阶段 3：chunks 流入 → 20-85% 之间映射
        var p = 0.20 + (loaded / total) * 0.65;
        setProgress(p);
      } else {
        pct.textContent = (loaded / 1024).toFixed(0) + ' KB';
      }
    }

    // 阶段 4：read done → 90%
    // 修：先 remove indet class 避免 setProgress 写 width 与 indet animation 冲突
    track.classList.remove('indet');
    setProgress(0.90);

    // 解码 HTML（charset 从 Content-Type 提取，默认 utf-8 兼容非 UTF-8 demo）
    var charset = 'utf-8';
    var ct = res.headers.get('content-type') || '';
    var m = /charset=([^;\\s]+)/i.exec(ct);
    if (m && m[1]) charset = m[1].toLowerCase();
    var buf = new Uint8Array(loaded);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) {
      buf.set(chunks[i], off);
      off += chunks[i].byteLength;
    }
    var html;
    try { html = new TextDecoder(charset).decode(buf); }
    catch (_) { html = new TextDecoder('utf-8').decode(buf); }

    // 阶段 5：解析 HTML 找同源 stylesheet 触发 preload 消除 FOUC
    // 跨域 stylesheet / <script src> / 字体不处理（preload 跨域要 crossorigin 属性，复杂；
    // FOUC 主因是同源 CSS 未到位）
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var sameOriginCss = [];
      var links = doc.querySelectorAll('link[rel="stylesheet"][href]');
      for (var li = 0; li < links.length; li++) {
        var href = links[li].getAttribute('href');
        if (!href) continue;
        try {
          var abs = new URL(href, TARGET);
          if (abs.origin === location.origin) sameOriginCss.push(abs.href);
        } catch (_) { /* invalid url 忽略 */ }
      }
      if (sameOriginCss.length > 0) {
        var preloadPromises = sameOriginCss.map(function(url){
          return new Promise(function(resolve){
            var link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'style';
            link.href = url;
            link.onload = resolve;
            link.onerror = resolve;  // 失败也 resolve，不阻塞
            document.head.appendChild(link);
          });
        });
        // 800ms timeout 兜底（跨网情况 preload 死等不可接受）
        var timeout = sleep(800);
        // 分块爬升 90→97（让用户看到"在加载样式"反馈）
        setProgress(0.94);
        await Promise.race([Promise.all(preloadPromises), timeout]);
        setProgress(0.97);
      }
    } catch (_) {
      // DOMParser / preload 任一异常都 fail-open 不阻塞主流程
    }

    // 等最低显示时长完成（即使 fetch 极快也保证小人完整出场）
    await minHold;

    // 阶段 6：满载 → 100% + 完成态停 250ms 视觉确认（"小人到达终点"）
    setProgress(1);
    document.body.setAttribute('data-prd-shell','ready');
    await sleep(250);

    // 阶段 7：document.write 替换文档
    document.body.setAttribute('data-prd-shell','done');
    // 去掉 ?token 防 referrer 泄漏（不刷新页面）
    try { history.replaceState(null, '', TARGET); } catch (_) {}
    document.open();
    document.write(html);
    document.close();
  } catch (err) {
    fail((err && err.message) || err);
  }
})();
</script>
</body>
</html>`;
}
