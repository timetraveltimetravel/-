// 측면 패널: 캡처를 제어하고, 사진을 보관하고, 파일로 저장한다.
import { planStitch, segmentsInChunk, chunkLimit, captureScale } from './stitch.js';
import { createPacer, fullStep } from './pace.js';
import { recognizeCanvas, stopOcr, upscaleFor } from './ocr.js';
import {
  TURN_TIMEOUT_MS,
  SETTLE_TIMEOUT_MS,
  DEFAULT_MAX_PAGES,
  DEFAULT_TURN_WAIT_S,
  clampNumber,
  pageChanged,
  isRevisit,
  describeTarget,
} from './pages.js';

// Chrome은 1초 동안의 화면 캡처 횟수를 제한한다 (현재 값: 2회).
// 그래서 캡처 사이에 이 시간을 기다린다.
const CAPTURES_PER_SECOND = chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND || 2;
const CAPTURE_INTERVAL_MS = Math.ceil(1000 / CAPTURES_PER_SECOND) + 100;
// 페이지의 끝에서 새 내용을 기다리는 시간
const END_WAIT_MS = 2000;
const JPEG_QUALITY = 0.92;

const $ = (id) => document.getElementById(id);
const ui = {
  state: $('state'),
  toggle: $('toggle'),
  auto: $('auto'),
  speed: $('speed'),
  maxScreens: $('maxScreens'),
  hideFixed: $('hideFixed'),
  count: $('count'),
  length: $('length'),
  gaps: $('gaps'),
  message: $('message'),
  thumbs: $('thumbs'),
  empty: $('empty'),
  save: $('save'),
  reset: $('reset'),
  ocr: $('ocr'),
  ocrStatus: $('ocrStatus'),
  ocrText: $('ocrText'),
  ocrActions: $('ocrActions'),
  ocrSave: $('ocrSave'),
  ocrCopy: $('ocrCopy'),
  update: $('update'),
  updateText: $('updateText'),
  updateApply: $('updateApply'),
  version: $('version'),
  nextInfo: $('nextInfo'),
  pick: $('pick'),
  pickClear: $('pickClear'),
  pickMode: $('pickMode'),
  maxPages: $('maxPages'),
  turnWait: $('turnWait'),
};

const state = {
  tabId: null,
  windowId: null,
  url: '',
  title: '',
  capturing: false,
  auto: false,
  saving: false,
  ocr: false, // 텍스트 변환 중
  ocrStop: false,
  captures: [], // { y, rect, vw, vh, dpr, width, height, blob }
  lastCaptureAt: 0,
  chain: Promise.resolve(),
  lastSaved: [], // 시험에서 결과를 확인할 때 사용한다
  random: Math.random, // 시험에서 같은 동작을 반복할 때 다른 함수로 바꾼다
  nextTarget: null, // 다음 페이지로 넘기는 영역. 페이지 스크립트가 만든다
  picking: false, // 사용자가 영역을 지정하는 중
  turning: false, // 페이지를 넘기는 중 (저장, 누르기, 새 페이지 기다리기)
  cancelTurn: false,
  pages: [], // 이번 자동 스크롤에서 저장한 페이지: { url, title, captures, height, files }
  visited: new Set(), // 이번 자동 스크롤에서 캡처한 주소
  turnTimeoutMs: TURN_TIMEOUT_MS, // 시험에서 짧은 값으로 바꾼다
};
window.__scDebug = state;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function say(text, kind = '') {
  ui.message.textContent = text;
  ui.message.dataset.kind = kind;
}

function render() {
  const mode = state.auto ? 'auto' : state.capturing ? 'capturing' : state.turning ? 'turning' : 'idle';
  ui.state.dataset.state = mode;
  ui.state.textContent = { idle: '대기 중', capturing: '캡처 중', auto: '자동 스크롤 중', turning: '페이지 넘기는 중' }[mode];
  ui.toggle.textContent = state.capturing || state.turning ? '정지' : '캡처 시작';
  ui.auto.textContent = state.auto ? '자동 스크롤 정지' : '자동 스크롤';
  const busy = state.saving || state.ocr || state.turning;
  ui.toggle.disabled = busy && !state.turning; // 페이지를 넘기는 중에는 이 버튼이 정지 버튼이다
  ui.auto.disabled = busy || state.picking;

  const plan = planStitch(state.captures);
  ui.count.textContent = `${state.captures.length}장`;
  ui.length.textContent = `${plan.height.toLocaleString('ko-KR')} px`;
  ui.gaps.textContent = `${plan.gaps}개`;
  ui.empty.hidden = state.captures.length > 0;

  const has = state.captures.length > 0;
  ui.save.disabled = !has || busy;
  ui.reset.disabled = !has || busy || state.capturing;
  ui.ocr.disabled = !has || state.saving || state.turning;
  ui.ocr.textContent = state.ocr ? '변환 정지' : '텍스트 변환';
  ui.ocrSave.disabled = busy;
  ui.updateApply.disabled = busy;

  const target = state.nextTarget;
  ui.nextInfo.textContent = target
    ? `자동 스크롤이 끝나면 사진을 저장하고, 이 영역을 누릅니다: ${describeTarget(target)}`
    : '넘기는 영역을 지정하지 않았습니다. 자동 스크롤은 한 페이지에서 끝납니다.';
  ui.pick.textContent = state.picking ? '지정 취소' : '넘기는 영역 지정';
  ui.pick.disabled = busy || state.capturing;
  ui.pickClear.disabled = !target || busy || state.capturing;
  ui.pickMode.disabled = !target || busy || state.capturing;
  if (target) ui.pickMode.value = target.mode;
}

// 캡처 대상 탭을 찾는다. 주소의 tabId 값은 시험에서만 사용한다.
async function targetTab() {
  const forced = new URLSearchParams(location.search).get('tabId');
  if (forced) return chrome.tabs.get(Number(forced));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send(type, data = {}) {
  return chrome.tabs.sendMessage(state.tabId, { type, ...data });
}

function reset() {
  state.captures = [];
  state.lastSaved = [];
  ui.thumbs.replaceChildren();
  ui.ocrText.value = '';
  ui.ocrText.hidden = true;
  ui.ocrActions.hidden = true;
  ui.ocrStatus.textContent = '';
  say('');
  render();
}

async function addThumbnail(blob) {
  const bitmap = await createImageBitmap(blob, { resizeWidth: 176, resizeQuality: 'medium' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  ui.thumbs.append(canvas);
  canvas.scrollIntoView({ block: 'nearest' });
}

// 현재 화면을 한 번 캡처한다. 결과: 캡처할 때의 스크롤 정보, 또는 null.
async function captureOnce() {
  if (!state.capturing) return null;

  const wait = state.lastCaptureAt + CAPTURE_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  if (!state.capturing) return null;

  const [active] = await chrome.tabs.query({ active: true, windowId: state.windowId });
  if (!active || active.id !== state.tabId) {
    say('캡처 대상 탭이 화면에 없습니다. 그 탭을 다시 선택하십시오.', 'warn');
    return null;
  }

  const before = await send('sc-metrics');
  if (!before) throw new Error('no-page-script');
  const dataUrl = await chrome.tabs.captureVisibleTab(state.windowId, { format: 'png' });
  state.lastCaptureAt = Date.now();
  const after = await send('sc-metrics');
  if (!after) throw new Error('no-page-script');

  // 캡처 중에 화면이 움직였다. 이 사진은 버린다. 스크롤이 멈추면 다시 캡처한다.
  if (Math.abs(after.scrollY - before.scrollY) > 0.5) return null;
  // 같은 위치의 사진이 이미 있다.
  if (state.captures.some((c) => Math.abs(c.y - before.scrollY) < 1)) return before;

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const capture = {
    y: before.scrollY,
    rect: before.rect,
    vw: before.viewportW,
    vh: before.viewportH,
    dpr: before.dpr,
    width: bitmap.width,
    height: bitmap.height,
    blob,
  };
  bitmap.close();

  const first = state.captures[0];
  if (first && first.width !== capture.width) {
    say('창의 크기가 바뀌었습니다. 이 화면은 캡처하지 않았습니다.', 'warn');
    return before;
  }

  state.captures.push(capture);
  await addThumbnail(blob);
  say('');
  render();

  // 첫 사진 다음부터 고정 메뉴를 숨긴다.
  if (state.captures.length === 1 && ui.hideFixed.checked && before.isDoc) {
    await send('sc-hide-fixed', { mode: 'all' });
  }
  return before;
}

// 캡처를 한 번에 한 개만 수행한다.
function enqueueCapture() {
  const run = state.chain.then(captureOnce);
  state.chain = run.catch((error) => onFailure(error));
  return run;
}

function onFailure(error) {
  console.warn('[스크롤 캡처]', error);
  if (!state.capturing) return;
  state.capturing = false;
  state.auto = false;
  send('sc-stop').catch(() => {}); // 숨긴 고정 메뉴를 복구한다
  say('캡처를 정지했습니다. 페이지가 바뀌었거나 캡처 권한이 없습니다.', 'warn');
  render();
}

// sameTab: 지금의 캡처 대상 탭을 계속 사용한다 (다음 페이지로 넘긴 후).
async function start({ sameTab = false } = {}) {
  let tab;
  try {
    tab = sameTab ? await chrome.tabs.get(state.tabId) : await targetTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (error) {
    console.warn('[스크롤 캡처]', error);
    say('이 페이지는 캡처할 수 없습니다. 페이지에서 확장 프로그램 아이콘을 다시 누르십시오.', 'warn');
    return false;
  }

  state.tabId = tab.id;
  state.windowId = tab.windowId;
  const info = await send('sc-init');
  const url = info.url.split('#')[0];
  if (state.captures.length && url !== state.url) reset(); // 다른 페이지이면 새로 시작한다
  state.url = url;
  state.title = info.title;

  if (ui.hideFixed.checked && info.isDoc) {
    await send('sc-hide-fixed', { mode: state.captures.length ? 'all' : 'bottom' });
  }

  state.capturing = true;
  say('');
  render();
  try {
    await enqueueCapture();
  } catch {
    // onFailure가 이 오류를 처리했다
  }
  return state.capturing;
}

async function stop(text = '') {
  const wasCapturing = state.capturing;
  state.capturing = false;
  state.auto = false;
  render();
  await state.chain; // 진행 중인 캡처를 끝낸다
  if (wasCapturing) {
    try {
      await send('sc-stop');
    } catch {
      // 페이지가 이미 없다
    }
  }
  if (text) say(text);
  render();
}

// 결과: 끝난 이유. 'end' (페이지의 끝), 'limit' (최대 화면 수), 'stopped' (사용자가 정지), 'failed' (오류)
async function autoScroll() {
  state.auto = true;
  render();
  let pacer = createPacer(ui.speed.value, state.random);
  let finished = null;
  try {
    while (state.capturing && state.auto) {
      // 가장 아래쪽에서 캡처한 위치. 이 위치보다 아래에 있으면 새 내용이 있다.
      const frontier = () => state.captures.reduce((max, c) => Math.max(max, c.y), -Infinity);
      let info = await send('sc-metrics');
      if (info.scrollY > frontier() + 1) {
        info = (await enqueueCapture()) || info;
        if (!state.capturing || !state.auto) break;
      }
      if (!state.captures.length) {
        await sleep(300); // 첫 사진을 캡처하지 못했다. 다시 시도한다.
        continue;
      }
      const limit = Math.max(1, Number(ui.maxScreens.value) || 100);
      if (state.captures.length >= limit) {
        finished = { reason: 'limit', text: `최대 화면 수(${limit})에 도달했습니다. 캡처를 정지했습니다.` };
        break;
      }

      // 페이지의 끝이면 새 내용을 기다린다 (무한 스크롤).
      const front = frontier();
      if (Math.abs(info.scrollY - front) <= 1 && info.scrollY >= info.maxScrollY - 2) {
        const deadline = Date.now() + END_WAIT_MS;
        let grown = false;
        while (!grown && Date.now() < deadline && state.auto) {
          await sleep(250);
          const now = await send('sc-metrics');
          grown = now.maxScrollY > info.maxScrollY + 1;
        }
        if (!grown) {
          if (state.auto) finished = { reason: 'end', text: '페이지의 끝입니다. 캡처를 정지했습니다.' };
          break;
        }
        continue;
      }

      if (pacer.speed !== ui.speed.value) pacer = createPacer(ui.speed.value, state.random);
      const move = pacer.next({
        viewHeight: info.rect.h,
        room: front + fullStep(info.rect.h) - info.scrollY,
        canGoUp: info.scrollY > 40,
      });
      if (move.path) await send('sc-scroll-path', { path: move.path });
      else if (move.dy) await send('sc-scroll-by', { dy: move.dy });
      await sleep(move.pause);
    }
  } catch (error) {
    onFailure(error);
    return 'failed';
  }
  state.auto = false;
  render();
  if (finished) await stop(finished.text);
  return finished ? finished.reason : 'stopped';
}

// ---------- 여러 페이지 ----------

// 페이지에서 "다음 페이지로 넘기는 영역"을 지정한다. 사용자가 페이지의 한 곳을 누르면 페이지 스크립트가 sc-picked를 보낸다.
async function togglePick() {
  if (state.picking) {
    state.picking = false;
    send('sc-pick-stop').catch(() => {});
    say('');
    render();
    return;
  }
  try {
    const tab = await targetTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    state.tabId = tab.id;
    state.windowId = tab.windowId;
    await send('sc-pick-start');
  } catch (error) {
    console.warn('[스크롤 캡처]', error);
    say('이 페이지에서는 영역을 지정할 수 없습니다. 페이지에서 확장 프로그램 아이콘을 다시 누르십시오.', 'warn');
    return;
  }
  state.picking = true;
  say('페이지에서, 다음 페이지로 넘기는 영역을 누르십시오. 취소: Esc 키');
  render();
}

function clearPick() {
  state.nextTarget = null;
  render();
}

// 페이지의 정보를 읽는다. 새 문서이면 페이지 스크립트를 다시 넣는다. 읽지 못하면 null.
async function pageInfo() {
  try {
    const info = await send('sc-page-info');
    if (info) return info;
  } catch {
    // 새 문서에는 페이지 스크립트가 없다
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: ['content.js'] });
    return (await send('sc-page-info')) || null;
  } catch {
    return null; // 페이지를 불러오는 중이거나, 캡처 권한이 없다
  }
}

// 지정한 영역을 누르고, 새 페이지를 기다린다. 결과: 성공이면 '', 실패이면 이유.
async function goNext() {
  const before = await pageInfo();
  if (!before) return '페이지에 접근할 수 없습니다.';
  state.visited.add(before.url);

  const found = await send('sc-find-target', { target: state.nextTarget }).catch(() => null);
  if (!found?.ok) return '지정한 영역이 이 페이지에 없습니다. 마지막 페이지로 판단했습니다.';
  // 페이지가 바로 바뀌면 응답이 없다.
  send('sc-click-target', { target: state.nextTarget }).catch(() => {});

  // 페이지가 바뀌는 것을 기다린다.
  const deadline = Date.now() + state.turnTimeoutMs;
  let after = null;
  let lost = 0;
  while (!after && Date.now() < deadline) {
    await sleep(300);
    if (state.cancelTurn) return '정지했습니다.';
    const info = await pageInfo();
    if (info) {
      lost = 0;
      if (pageChanged(before, info)) after = info;
      continue;
    }
    const tab = await chrome.tabs.get(state.tabId).catch(() => null);
    if (!tab) return '탭을 닫았습니다.';
    // 페이지를 다 불러왔는데 접근할 수 없다: 캡처 권한이 없는 사이트이다.
    lost = tab.status === 'complete' ? lost + 1 : 0;
    if (lost >= 5) {
      return '다른 사이트로 이동했습니다. 캡처 권한이 없습니다. 그 페이지에서 확장 프로그램 아이콘을 다시 누르십시오.';
    }
  }
  if (!after) return '지정한 영역을 눌렀지만 페이지가 바뀌지 않았습니다. 마지막 페이지로 판단했습니다.';
  if (isRevisit(state.visited, before, after)) return '이미 캡처한 페이지로 이동했습니다.';

  // 새 페이지가 내용을 불러오는 것을 기다린다: 정해진 시간, 그 다음에 내용이 멈출 때까지.
  await sleep(clampNumber(ui.turnWait.value, 0, 60, DEFAULT_TURN_WAIT_S) * 1000);
  const settleUntil = Date.now() + SETTLE_TIMEOUT_MS;
  let last = after;
  let stable = 0;
  while (stable < 2 && Date.now() < settleUntil) {
    await sleep(400);
    if (state.cancelTurn) return '정지했습니다.';
    const tab = await chrome.tabs.get(state.tabId).catch(() => null);
    if (!tab) return '탭을 닫았습니다.';
    const info = await pageInfo();
    const same = info && info.docId === last.docId && info.hash === last.hash;
    stable = same && tab.status === 'complete' && info.ready === 'complete' ? stable + 1 : 0;
    if (info) last = info;
  }
  if (isRevisit(state.visited, before, last)) return '이미 캡처한 페이지로 이동했습니다.';
  await send('sc-scroll-top').catch(() => {});
  return '';
}

// 한 페이지의 자동 스크롤이 끝났다. 사진을 저장하고, 다음 페이지로 넘긴다.
// 결과: 다음 페이지의 캡처를 시작했으면 null, 끝냈으면 이유.
async function turnPage() {
  state.turning = true;
  state.cancelTurn = false;
  render();
  try {
    if (!(await save())) return '사진을 저장하지 못했습니다.';
    state.pages.push({
      url: state.url,
      title: state.title,
      captures: state.captures.length,
      positions: state.captures.map((c) => c.y),
      height: planStitch(state.captures).height,
      files: state.lastSaved.map((f) => f.filename),
    });
    const limit = clampNumber(ui.maxPages.value, 1, 500, DEFAULT_MAX_PAGES);
    if (state.pages.length >= limit) return `최대 페이지 수(${limit})에 도달했습니다.`;
    if (state.cancelTurn) return '정지했습니다.';

    const problem = await goNext();
    if (problem) return problem;

    reset(); // 다음 페이지의 사진을 새로 보관한다
    if (!(await start({ sameTab: true }))) return '다음 페이지를 캡처하지 못했습니다.';
    return null;
  } catch (error) {
    console.warn('[스크롤 캡처]', error);
    return '페이지를 넘기지 못했습니다.';
  } finally {
    state.turning = false;
    render();
  }
}

// 자동 스크롤을 수행한다. 넘기는 영역을 지정했으면, 페이지의 끝에서 다음 페이지로 넘기고 계속한다.
async function autoRun() {
  state.pages = [];
  state.visited = new Set();
  for (;;) {
    const reason = await autoScroll();
    if (reason !== 'end' || !state.nextTarget) return;
    const note = await turnPage();
    if (note === null) continue;
    say(`페이지 ${state.pages.length}개를 저장했습니다. ${note}`);
    render();
    return;
  }
}

// ---------- 저장 ----------

const FALLBACK_TITLE = 'scroll-capture';

// 파일 이름의 앞부분: "페이지 제목_날짜"
function fileBase(title) {
  const clean =
    (title || '')
      .replace(/[\\/:*?"<>|~\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 80) || FALLBACK_TITLE;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${clean}_${stamp}`;
}

async function toBlob(canvas, format) {
  if (format === 'jpeg') return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return canvas.convertToBlob({ type: 'image/png' });
}

function newCanvas(width, height, format) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff'; // JPEG에는 투명한 색이 없다
    ctx.fillRect(0, 0, width, height);
  }
  return { canvas, ctx };
}

// 긴 사진의 구간 한 개를 그린다.
async function drawChunk(plan, chunk, format) {
  const { canvas, ctx } = newCanvas(plan.width, chunk.height, format);
  for (const s of segmentsInChunk(plan, chunk)) {
    const bitmap = await createImageBitmap(state.captures[s.index].blob);
    ctx.drawImage(bitmap, s.srcX, s.srcY, s.srcW, s.srcH, 0, s.dstY, s.srcW, s.srcH);
    bitmap.close();
  }
  return canvas;
}

// 사진을 이어 붙여서 긴 사진을 만든다. 너무 길면 여러 장으로 나눈다.
async function buildLong(format) {
  const plan = planStitch(state.captures, chunkLimit(state.captures[0].width));
  const blobs = [];
  for (const chunk of plan.chunks) {
    blobs.push(await toBlob(await drawChunk(plan, chunk, format), format));
  }
  return blobs;
}

// 화면 한 개마다 사진 한 장을 만든다.
async function buildEach(format) {
  const sorted = [...state.captures].sort((a, b) => a.y - b.y);
  const blobs = [];
  for (const c of sorted) {
    if (format === 'png') {
      blobs.push(c.blob);
      continue;
    }
    const bitmap = await createImageBitmap(c.blob);
    const { canvas, ctx } = newCanvas(bitmap.width, bitmap.height, format);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    blobs.push(await toBlob(canvas, format));
  }
  return blobs;
}

async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// 파일을 "다운로드" 폴더에 저장한다. 결과: [{ filename, blob }]
// numbered: true이면 파일 이름의 끝에 번호를 붙인다.
async function saveFiles(blobs, ext, numbered) {
  const digits = Math.max(2, String(blobs.length).length);
  const name = (base, i) => (numbered ? `${base}_${String(i + 1).padStart(digits, '0')}.${ext}` : `${base}.${ext}`);
  let base = fileBase(state.title);
  const saved = [];
  for (let i = 0; i < blobs.length; i += 1) {
    try {
      await download(blobs[i], name(base, i));
    } catch (error) {
      // 일부 시스템은 페이지 제목의 글자를 파일 이름으로 사용하지 못한다.
      // 그 경우에는 영문 이름을 사용한다.
      if (i > 0 || !/filename/i.test(error?.message || '')) throw error;
      base = fileBase('');
      await download(blobs[i], name(base, i));
    }
    saved.push({ filename: name(base, i), blob: blobs[i] });
  }
  return saved;
}

// 결과: 저장했으면 true.
async function save() {
  if (!state.captures.length || state.saving) return false;
  if (state.capturing) await stop();
  state.saving = true;
  render();
  say('사진을 만드는 중입니다.');
  try {
    const format = document.querySelector('input[name="format"]:checked').value;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const blobs = mode === 'long' ? await buildLong(format) : await buildEach(format);
    state.lastSaved = await saveFiles(blobs, format === 'jpeg' ? 'jpg' : 'png', true);
    say(`사진 ${blobs.length}장을 "다운로드" 폴더에 저장했습니다.`);
    return true;
  } catch (error) {
    console.warn('[스크롤 캡처]', error);
    say('사진을 저장하지 못했습니다. 다시 시도하십시오.', 'warn');
    return false;
  } finally {
    state.saving = false;
    render();
  }
}

// ---------- 텍스트 변환 ----------

// 캡처한 사진 안의 글자를 텍스트로 변환한다. 변환은 브라우저 안에서 수행한다.
async function convertText() {
  if (state.ocr) {
    state.ocrStop = true; // 변환 정지
    return;
  }
  if (!state.captures.length || state.saving) return;
  if (state.capturing) await stop();
  state.ocr = true;
  state.ocrStop = false;
  render();
  ui.ocrStatus.dataset.kind = '';
  ui.ocrStatus.textContent = '글자 인식 엔진을 시작하는 중입니다.';
  try {
    const plan = planStitch(state.captures, chunkLimit(state.captures[0].width));
    const upscale = upscaleFor(captureScale(state.captures[0]).sy);
    const parts = [];
    let stopped = false;
    for (const chunk of plan.chunks) {
      const canvas = await drawChunk(plan, chunk, 'png');
      const text = await recognizeCanvas(canvas, {
        upscale,
        shouldStop: () => state.ocrStop,
        onProgress: (done) => {
          const percent = Math.round(((chunk.top + done) / plan.height) * 100);
          ui.ocrStatus.textContent = `텍스트로 변환하는 중입니다. ${percent}%`;
        },
      });
      if (text === null) {
        stopped = true;
        break;
      }
      if (text) parts.push(text);
    }
    if (stopped) {
      ui.ocrStatus.textContent = '변환을 정지했습니다.';
    } else {
      const text = parts.join('\n\n');
      ui.ocrText.value = text;
      ui.ocrText.hidden = false;
      ui.ocrActions.hidden = false;
      ui.ocrStatus.textContent = text
        ? `변환을 끝냈습니다. 글자 ${text.replace(/\s/g, '').length.toLocaleString('ko-KR')}개. 인식 오류가 있을 수 있습니다. 내용을 확인하십시오.`
        : '사진에서 글자를 찾지 못했습니다.';
    }
  } catch (error) {
    console.warn('[스크롤 캡처]', error);
    ui.ocrStatus.dataset.kind = 'warn';
    ui.ocrStatus.textContent = '텍스트로 변환하지 못했습니다. 다시 시도하십시오.';
  } finally {
    await stopOcr().catch(() => {}); // 엔진의 메모리를 해제한다
    state.ocr = false;
    render();
  }
}

// 변환한 텍스트를 TXT 파일로 저장한다. 파일의 첫 부분에 제목, 주소, 날짜를 기록한다.
async function saveText() {
  if (state.saving || state.ocr) return;
  state.saving = true;
  render();
  try {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    const head = `제목: ${state.title}\n주소: ${state.url}\n날짜: ${date}\n\n`;
    const blob = new Blob([head, ui.ocrText.value, '\n'], { type: 'text/plain;charset=utf-8' });
    state.lastSaved = await saveFiles([blob], 'txt', false);
    ui.ocrStatus.dataset.kind = '';
    ui.ocrStatus.textContent = '텍스트 파일을 "다운로드" 폴더에 저장했습니다.';
  } catch (error) {
    console.warn('[스크롤 캡처]', error);
    ui.ocrStatus.dataset.kind = 'warn';
    ui.ocrStatus.textContent = '텍스트 파일을 저장하지 못했습니다. 다시 시도하십시오.';
  } finally {
    state.saving = false;
    render();
  }
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(ui.ocrText.value);
  } catch {
    ui.ocrText.select(); // 클립보드 API를 사용할 수 없으면 이 방법을 사용한다
    document.execCommand('copy');
  }
  ui.ocrStatus.dataset.kind = '';
  ui.ocrStatus.textContent = '텍스트를 클립보드에 복사했습니다.';
}

// ---------- 자동 업데이트 ----------

// 폴더에 새 버전이 있다. 측면 패널이 열려 있는 동안에는 프로그램이 새 버전을 자동으로 적용하지 않는다.
function showUpdate(version) {
  ui.updateText.textContent =
    `새 버전이 있습니다 (${version}). 측면 패널을 닫으면 프로그램이 새 버전을 자동으로 적용합니다. ` +
    '"지금 적용"을 누르면 측면 패널이 닫히고, 캡처한 사진이 없어집니다. 사진을 먼저 저장하십시오.';
  ui.update.hidden = false;
}

// 확장 프로그램을 다시 로드한다. 측면 패널이 닫힌다.
async function applyUpdate() {
  if (state.saving || state.ocr) return;
  if (state.capturing) await stop();
  chrome.runtime.reload();
}

// ---------- 이벤트 ----------

ui.toggle.addEventListener('click', async () => {
  if (state.turning) {
    state.cancelTurn = true; // 페이지를 넘기는 일을 다음 확인 지점에서 끝낸다
    say('정지하는 중입니다.');
    return;
  }
  ui.toggle.disabled = true;
  if (state.capturing) await stop();
  else await start();
  render();
});

ui.auto.addEventListener('click', async () => {
  if (state.auto) {
    state.auto = false; // 캡처는 계속한다. 사용자가 수동으로 스크롤할 수 있다.
    render();
    return;
  }
  ui.auto.disabled = true;
  if (!state.capturing && !(await start())) {
    render();
    return;
  }
  autoRun();
});

ui.save.addEventListener('click', () => save());
ui.pick.addEventListener('click', togglePick);
ui.pickClear.addEventListener('click', clearPick);
ui.pickMode.addEventListener('change', () => {
  if (state.nextTarget) state.nextTarget.mode = ui.pickMode.value;
  render();
});
ui.reset.addEventListener('click', reset);
ui.ocr.addEventListener('click', convertText);
ui.ocrSave.addEventListener('click', saveText);
ui.ocrCopy.addEventListener('click', copyText);
ui.updateApply.addEventListener('click', applyUpdate);

// 수동 스크롤: 스크롤이 멈추면 페이지 스크립트가 이 메시지를 보낸다.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'sc-update-available') {
    showUpdate(msg.version);
    return;
  }
  if (msg?.type === 'sc-picked' || msg?.type === 'sc-pick-cancelled') {
    if (!state.picking || sender.tab?.id !== state.tabId) return;
    state.picking = false;
    if (msg.type === 'sc-picked') state.nextTarget = msg.target;
    say('');
    render();
    return;
  }
  if (msg?.type !== 'sc-scroll-idle') return;
  if (!state.capturing || state.auto) return;
  if (sender.tab?.id !== state.tabId) return;
  enqueueCapture();
});

// 캡처 대상 탭을 닫으면 캡처를 정지한다.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId && state.capturing) stop('탭을 닫았습니다. 캡처를 정지했습니다.');
});

ui.version.textContent = `버전 ${chrome.runtime.getManifest().version}`;
// 폴더에 새 버전이 있는지 확인한다. 새 버전이 있으면 background.js가 sc-update-available을 보낸다.
chrome.runtime.sendMessage({ type: 'sc-update-check' }).catch(() => {});

render();
