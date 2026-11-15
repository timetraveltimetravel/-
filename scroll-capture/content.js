// 페이지 스크립트: 스크롤 위치를 읽고, 자동 스크롤을 수행한다.
// 측면 패널이 이 파일을 현재 탭에 넣는다.
(() => {
  if (window.__scrollCapture) return;

  const state = {
    scroller: null,
    hidden: [], // [요소, 원래 visibility 값, 원래 우선순위]
    timer: null,
    listening: false,
  };

  const docScroller = () => document.scrollingElement || document.documentElement;
  const isDoc = (el) => el === docScroller();

  // 스크롤 영역을 찾는다. 페이지 전체가 스크롤되지 않으면 가장 큰 안쪽 영역을 사용한다.
  function findScroller() {
    const doc = docScroller();
    if (doc.scrollHeight - doc.clientHeight > 1) return doc;
    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight - el.clientHeight <= 1) continue;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      if (w * h > bestArea) {
        best = el;
        bestArea = w * h;
      }
    }
    return best || doc;
  }

  function metrics() {
    const el = state.scroller || docScroller();
    const doc = isDoc(el);
    let rect;
    if (doc) {
      // 스크롤바를 제외한 화면 영역
      rect = { x: 0, y: 0, w: el.clientWidth, h: el.clientHeight };
    } else {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.left + el.clientLeft);
      const y = Math.max(0, r.top + el.clientTop);
      rect = {
        x,
        y,
        w: Math.min(innerWidth, r.left + el.clientLeft + el.clientWidth) - x,
        h: Math.min(innerHeight, r.top + el.clientTop + el.clientHeight) - y,
      };
    }
    return {
      scrollY: doc ? window.scrollY : el.scrollTop,
      scrollHeight: el.scrollHeight,
      maxScrollY: Math.max(0, el.scrollHeight - el.clientHeight),
      rect,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      dpr: window.devicePixelRatio,
      isDoc: doc,
      title: document.title,
      url: location.href,
    };
  }

  // 화면을 다시 그린 후에 값을 돌려준다.
  const afterPaint = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

  function onScroll(event) {
    const target = event.target === document ? docScroller() : event.target;
    if (target !== state.scroller) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'sc-scroll-idle', metrics: metrics() }).catch(() => {});
    }, 180);
  }

  function listen(on) {
    if (on === state.listening) return;
    state.listening = on;
    if (on) document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    else {
      document.removeEventListener('scroll', onScroll, { capture: true });
      clearTimeout(state.timer);
    }
  }

  // 화면에 고정된 요소(메뉴, 알림 띠)를 숨긴다.
  // mode 'bottom': 화면 아래쪽에 고정된 요소만 숨긴다 (첫 사진 전에 사용).
  // mode 'all':    고정된 요소를 모두 숨긴다 (첫 사진 다음에 사용).
  function hideFixed(mode) {
    if (!document.body) return;
    const done = new Set(state.hidden.map((h) => h[0]));
    for (const el of document.body.querySelectorAll('*')) {
      if (done.has(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (mode === 'bottom') {
        if (cs.position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight / 2 || r.height > innerHeight / 2) continue;
      }
      state.hidden.push([
        el,
        el.style.getPropertyValue('visibility'),
        el.style.getPropertyPriority('visibility'),
      ]);
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  function showFixed() {
    for (const [el, value, priority] of state.hidden) {
      if (value) el.style.setProperty('visibility', value, priority);
      else el.style.removeProperty('visibility');
    }
    state.hidden = [];
  }

  const scrollTarget = () => {
    const el = state.scroller || docScroller();
    return {
      read: () => (isDoc(el) ? window.scrollY : el.scrollTop),
      to: (top) => (isDoc(el) ? window : el).scrollTo({ top, behavior: 'instant' }),
    };
  };

  // 다음 화면 그리기를 기다린다. 탭이 화면에 없으면 화면 그리기가 없다. 그 경우에는 시간으로 기다린다.
  const nextFrame = () =>
    new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 100);
    });

  // 이동 경로를 따라서 스크롤한다. path: [[시간(ms), 이동한 거리(px)], ...]
  async function scrollPath(path) {
    const { read, to } = scrollTarget();
    const start = read();
    const startedAt = performance.now();
    const last = path[path.length - 1];
    let i = 1;
    for (;;) {
      await nextFrame();
      const t = performance.now() - startedAt;
      if (t >= last[0]) break;
      while (i < path.length - 1 && path[i][0] <= t) i += 1;
      const [t0, y0] = path[i - 1];
      const [t1, y1] = path[i];
      const ratio = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
      to(start + y0 + (y1 - y0) * ratio);
    }
    to(start + last[1]);
  }

  async function handle(msg) {
    switch (msg.type) {
      case 'sc-init':
        state.scroller = findScroller();
        listen(true);
        return metrics();
      case 'sc-metrics':
        return metrics();
      case 'sc-scroll-by': {
        const { read, to } = scrollTarget();
        to(read() + msg.dy);
        await afterPaint();
        return metrics();
      }
      case 'sc-scroll-path':
        await scrollPath(msg.path);
        await afterPaint();
        return metrics();
      case 'sc-hide-fixed':
        hideFixed(msg.mode);
        await afterPaint();
        return metrics();
      case 'sc-stop':
        listen(false);
        showFixed();
        await afterPaint();
        return metrics();
      default:
        return undefined;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('sc-')) return false;
    if (msg.type === 'sc-scroll-idle') return false;
    handle(msg).then(sendResponse, () => sendResponse(undefined));
    return true; // 응답을 나중에 보낸다
  });

  window.__scrollCapture = true;
})();
