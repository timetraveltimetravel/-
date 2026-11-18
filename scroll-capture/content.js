// 페이지 스크립트: 스크롤 위치를 읽고, 자동 스크롤을 수행하고, 다음 페이지로 넘기는 영역을 누른다.
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

  // ---------- 다음 페이지로 넘기는 영역 ----------

  // 이 문서의 번호. 새 문서를 불러오면 페이지 스크립트를 다시 넣고, 번호가 바뀐다.
  const docId = Math.random().toString(36).slice(2);

  function hashText(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return `${text.length}:${h >>> 0}`;
  }

  // 페이지가 바뀌었는지 판단할 때 사용하는 정보
  function pageInfo() {
    const text = document.body ? document.body.textContent : '';
    return {
      docId,
      url: location.href,
      title: document.title,
      ready: document.readyState,
      hash: hashText(text.length > 300_000 ? text.slice(0, 300_000) : text),
    };
  }

  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const labelOf = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.querySelector('img[alt]')?.getAttribute('alt') || '')
      .trim()
      .slice(0, 60);
  const classOf = (el) => el.getAttribute('class') || '';

  const CLICKABLE = 'a, button, [role="button"], input[type="button"], input[type="submit"], summary, [onclick]';

  // 사용자가 누른 위치에서, 누를 수 있는 요소를 찾는다. 없으면 null.
  function clickableFrom(raw) {
    const known = raw.closest(CLICKABLE);
    if (known) return known;
    // 손 모양의 커서는 누를 수 있는 요소의 표시이다. 그 커서를 지정한 가장 바깥쪽 요소를 사용한다.
    if (getComputedStyle(raw).cursor !== 'pointer') return null;
    let el = raw;
    while (
      el.parentElement &&
      el.parentElement !== document.body &&
      el.parentElement !== document.documentElement &&
      getComputedStyle(el.parentElement).cursor === 'pointer'
    ) {
      el = el.parentElement;
    }
    return el;
  }

  // 요소를 다시 찾을 때 사용하는 CSS 선택자
  function cssPath(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      // 긴 숫자가 있는 id는 페이지마다 다를 수 있다. 그 id는 사용하지 않는다.
      if (node.id && !/\d{3,}/.test(node.id)) {
        const byId = `#${CSS.escape(node.id)}`;
        if (document.querySelectorAll(byId).length === 1) {
          parts.unshift(byId);
          break;
        }
      }
      let part = node.localName;
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.localName === node.localName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  // 사용자가 누른 영역을 기록한다.
  //   mode 'element': 누를 수 있는 요소이다. 다음 페이지에서 같은 요소를 찾아서 누른다
  //   mode 'point':   누를 수 있는 요소가 아니다 (뷰어의 화면 등). 화면의 같은 위치를 누른다
  function describeTarget(raw, x, y) {
    const clickable = clickableFrom(raw);
    const el = clickable || raw;
    return {
      mode: clickable ? 'element' : 'point',
      selector: cssPath(el),
      tag: el.localName,
      text: textOf(el),
      label: labelOf(el),
      className: classOf(el),
      fx: x / innerWidth,
      fy: y / innerHeight,
    };
  }

  function usable(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    // 마지막 페이지에서는 "다음" 버튼이 사용할 수 없는 상태인 경우가 많다.
    return !el.closest('[disabled], [aria-disabled="true"], .disabled');
  }

  // 글자의 숫자는 페이지마다 다를 수 있다 ("다음 (13화)"). 그래서 숫자를 제외하고 비교한다.
  // 글자가 숫자뿐이면 (쪽 번호) 그대로 비교한다.
  const loose = (text) => (/^[\d\s]*$/.test(text) ? text : text.replace(/\d+/g, '#'));
  const sameName = (el, target) => {
    if (el.localName !== target.tag) return false;
    if (target.text) return loose(textOf(el)) === loose(target.text);
    if (target.label) return loose(labelOf(el)) === loose(target.label);
    return classOf(el) === target.className; // 글자가 없는 버튼 (아이콘)
  };

  // 기록한 요소를 이 페이지에서 찾는다. 없으면 null.
  // 페이지마다 요소의 위치가 다를 수 있다 (첫 페이지에는 "이전" 버튼이 없다). 그래서 글자가 같은 요소만 사용한다.
  // 같은 위치에 있는 다른 글자의 요소는 사용하지 않는다. 그 요소는 "이전" 버튼일 수 있다.
  function findTarget(target) {
    let bySelector = [];
    try {
      bySelector = [...document.querySelectorAll(target.selector)];
    } catch {
      // 선택자를 사용할 수 없다
    }
    let found = bySelector.find((el) => sameName(el, target) && usable(el));
    if (!found && (target.text || target.label)) {
      found = [...document.querySelectorAll(target.tag)].find((el) => sameName(el, target) && usable(el));
    }
    return found || null;
  }

  // 요소에 누름 동작을 보낸다. 사이트가 실제 입력만 받으면(isTrusted) 이 동작은 효과가 없다.
  function clickAt(el, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  async function clickTarget(target) {
    if (target.mode === 'point') {
      const x = Math.round(target.fx * innerWidth);
      const y = Math.round(target.fy * innerHeight);
      const el = document.elementFromPoint(x, y);
      if (!el) return { ok: false };
      clickAt(el, x, y);
      return { ok: true };
    }
    const el = findTarget(target);
    if (!el) return { ok: false };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await nextFrame();
    const r = el.getBoundingClientRect();
    clickAt(el, r.left + r.width / 2, r.top + r.height / 2);
    return { ok: true };
  }

  // 영역을 지정하는 상태: 사용자가 페이지의 한 곳을 누르면 그 영역을 기록한다. 페이지는 그 누름을 받지 않는다.
  let pick = null;

  function stopPick() {
    if (!pick) return;
    pick.remove();
    pick = null;
  }

  function startPick() {
    stopPick();
    const { read, to } = scrollTarget();
    const startY = read();

    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;left:0;top:0;width:0;height:0;' +
      'border:2px solid #2563eb;background:rgba(37,99,235,.18);border-radius:3px;';
    const tip = document.createElement('div');
    tip.textContent = '다음 페이지로 넘기는 영역을 누르십시오. 취소: Esc 키';
    tip.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;left:50%;top:10px;transform:translateX(-50%);' +
      'padding:8px 14px;border-radius:8px;background:#1b1f24;color:#fff;font:600 14px/1.4 system-ui,sans-serif;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);white-space:nowrap;';
    document.documentElement.append(box, tip);

    const elementOf = (event) => (event.target instanceof Element ? event.target : document.documentElement);
    const block = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onMove = (event) => {
      const raw = elementOf(event);
      const r = (clickableFrom(raw) || raw).getBoundingClientRect();
      const left = Math.max(0, r.left);
      const top = Math.max(0, r.top);
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${Math.max(0, Math.min(innerWidth, r.right) - left)}px`;
      box.style.height = `${Math.max(0, Math.min(innerHeight, r.bottom) - top)}px`;
    };
    const onClick = (event) => {
      block(event);
      const target = describeTarget(elementOf(event), event.clientX, event.clientY);
      stopPick();
      to(startY); // 지정하기 전의 스크롤 위치로 돌아간다
      chrome.runtime.sendMessage({ type: 'sc-picked', target }).catch(() => {});
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      block(event);
      stopPick();
      chrome.runtime.sendMessage({ type: 'sc-pick-cancelled' }).catch(() => {});
    };
    const blocked = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu'];
    const options = { capture: true };
    document.addEventListener('mousemove', onMove, options);
    document.addEventListener('click', onClick, options);
    document.addEventListener('keydown', onKey, options);
    for (const type of blocked) document.addEventListener(type, block, options);

    pick = {
      remove() {
        document.removeEventListener('mousemove', onMove, options);
        document.removeEventListener('click', onClick, options);
        document.removeEventListener('keydown', onKey, options);
        for (const type of blocked) document.removeEventListener(type, block, options);
        box.remove();
        tip.remove();
      },
    };
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
      case 'sc-page-info':
        return pageInfo();
      case 'sc-pick-start':
        startPick();
        return { ok: true };
      case 'sc-pick-stop':
        stopPick();
        return { ok: true };
      case 'sc-find-target':
        return { ok: msg.target.mode === 'point' || Boolean(findTarget(msg.target)) };
      case 'sc-click-target':
        return clickTarget(msg.target);
      case 'sc-scroll-top':
        // 새 페이지를 처음부터 캡처한다. 주소만 바꾸는 사이트는 스크롤 위치를 유지할 수 있다.
        state.scroller = findScroller();
        scrollTarget().to(0);
        await nextFrame();
        return metrics();
      default:
        return undefined;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('sc-')) return false;
    if (msg.type === 'sc-scroll-idle' || msg.type === 'sc-picked' || msg.type === 'sc-pick-cancelled') return false;
    handle(msg).then(sendResponse, () => sendResponse(undefined));
    return true; // 응답을 나중에 보낸다
  });

  window.__scrollCapture = true;
})();
