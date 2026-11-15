// 실제 Chromium에서 확장 프로그램을 시험한다.
// 실행: node tests/e2e.mjs            (모든 시험)
//       node tests/e2e.mjs auto long  (이름에 이 단어가 있는 시험만)
//
// 시험은 도구 모음의 아이콘을 누를 수 없다. 그래서 시험용 복사본의 manifest에
// 모든 사이트 권한을 추가한다. 배포하는 manifest는 이 권한을 사용하지 않는다.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEW = { width: 1000, height: 700 };
const ROW = 50;
const HEADER = 60;
const filters = process.argv.slice(2);

// ---------- 시험 페이지 ----------

const rowColor = (i) => [(i * 37 + 20) % 256, (i * 91 + 70) % 256, (i * 53 + 120) % 256];
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rowsHtml = (from, count) =>
  Array.from({ length: count }, (_, k) => `<div class="row" style="background:${css(rowColor(from + k))}">${from + k}</div>`).join('');

const BASE_CSS = `
  html, body { margin: 0; }
  body { font: 14px sans-serif; }
  .row { height: ${ROW}px; padding-left: 300px; line-height: ${ROW}px; color: #fff; }
  .header { position: sticky; top: 0; height: ${HEADER}px; background: rgb(255,0,255); }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; height: 40px; background: rgb(0,255,255); }
`;

const pages = {
  // 일반 페이지: 위에 고정되는 메뉴와 아래에 고정된 띠가 있다.
  '/plain': (q) => `<!doctype html><title>일반 페이지: 시험/1</title><style>${BASE_CSS}</style>
    <div class="header">menu</div>${rowsHtml(0, Number(q.get('rows') || 100))}<div class="bar">bar</div>`,
  // 무한 스크롤 페이지: 끝에 도달하면 행을 추가한다.
  '/infinite': () => `<!doctype html><title>무한 스크롤</title><style>${BASE_CSS}</style>
    <div class="header">menu</div><div id="list">${rowsHtml(0, 30)}</div>
    <script>
      const color = (i) => 'rgb(' + [(i*37+20)%256, (i*91+70)%256, (i*53+120)%256].join(',') + ')';
      let next = 30, busy = false;
      addEventListener('scroll', () => {
        if (busy || next >= 120) return;
        if (innerHeight + scrollY < document.documentElement.scrollHeight - 5) return;
        busy = true;
        setTimeout(() => {
          for (let k = 0; k < 30; k++, next++) {
            const d = document.createElement('div');
            d.className = 'row'; d.style.background = color(next); d.textContent = next;
            document.getElementById('list').append(d);
          }
          busy = false;
        }, 400);
      });
    </script>`,
  // 안쪽 영역에서 스크롤하는 페이지 (대화 화면과 같은 구조).
  '/inner': () => `<!doctype html><title>안쪽 스크롤</title><style>${BASE_CSS}
      html, body { height: 100%; overflow: hidden; }
      .top { height: 50px; background: rgb(10,10,10); }
      .wrap { display: flex; height: calc(100% - 50px); }
      .side { width: 200px; background: rgb(40,40,40); }
      #list { flex: 1; overflow-y: auto; }
      .row { padding-left: 100px; }
    </style>
    <div class="top"></div><div class="wrap"><div class="side"></div><div id="list">${rowsHtml(0, 80)}</div></div>`,
};

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const make = pages[url.pathname];
    if (!make) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(make(url.searchParams));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// ---------- 브라우저 ----------

async function launch({ scale, locale = 'C.UTF-8' } = {}) {
  const work = await mkdtemp(join(tmpdir(), 'scroll-capture-'));
  const ext = join(work, 'ext');
  await cp(ROOT, ext, { recursive: true, filter: (src) => !src.includes(`${ROOT}/tests`) });
  const manifestPath = join(ext, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const context = await chromium.launchPersistentContext(join(work, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport: null,
    env: { ...process.env, LANG: locale, LC_ALL: locale },
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      `--window-size=${VIEW.width},${VIEW.height}`,
      ...(scale ? [`--force-device-scale-factor=${scale}`] : []),
    ],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  return { context, worker, work };
}

// 페이지를 열고, 그 탭을 대상으로 하는 측면 패널을 다른 창에 연다.
async function open(browser, url) {
  const { context, worker } = browser;
  const page = context.pages()[0];
  await page.goto(url);
  const tabId = await worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
  const [panel] = await Promise.all([
    context.waitForEvent('page'),
    worker.evaluate(
      (id) => chrome.windows.create({ url: `sidepanel.html?tabId=${id}`, type: 'popup', width: 420, height: 900, focused: false }),
      tabId,
    ),
  ]);
  await panel.waitForSelector('#toggle');
  return { page, panel };
}

const captureCount = (panel) => panel.evaluate(() => window.__scDebug.captures.length);
const viewOf = (page) => page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));

// 자동 스크롤을 시작하고, 프로그램이 캡처를 정지할 때까지 기다린다.
async function runAuto(panel) {
  await panel.selectOption('#speed', 'fast');
  await panel.click('#auto');
  await panel.waitForFunction(() => window.__scDebug.auto, null, { timeout: 15_000 });
  await waitIdle(panel);
}
const waitIdle = (panel, timeout = 180_000) =>
  panel.waitForFunction(() => !window.__scDebug.capturing && !window.__scDebug.auto, null, { timeout });

async function save(panel, { format = 'png', mode = 'long' } = {}) {
  await panel.check(`input[name="format"][value="${format}"]`);
  await panel.check(`input[name="mode"][value="${mode}"]`);
  await panel.click('#save');
  await panel.waitForFunction(() => !window.__scDebug.saving && window.__scDebug.lastSaved.length > 0, null, { timeout: 120_000 });
  return panel.evaluate(async () => {
    const out = [];
    for (const { filename, blob } of window.__scDebug.lastSaved) {
      const bitmap = await createImageBitmap(blob);
      out.push({ filename, type: blob.type, bytes: blob.size, width: bitmap.width, height: bitmap.height });
      bitmap.close();
    }
    return out;
  });
}

// 저장한 사진의 한 세로줄을 읽고, 각 픽셀의 색이 기대하는 색인지 확인한다.
// 사진 여러 장은 위에서 아래로 이어진 것으로 본다.
function checkColumn(panel, { x, scale, header, rows, tolerance = 3 }) {
  return panel.evaluate(
    async ({ x, scale, header, rows, tolerance, ROW }) => {
      const color = (i) => [(i * 37 + 20) % 256, (i * 91 + 70) % 256, (i * 53 + 120) % 256];
      const expected = (cssY) => {
        if (cssY < header) return [255, 0, 255];
        const i = Math.floor((cssY - header) / ROW);
        return i < rows ? color(i) : null;
      };
      let offset = 0;
      let bad = 0;
      const samples = [];
      for (const { blob } of window.__scDebug.lastSaved) {
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(1, bitmap.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, Math.round(x * scale), 0, 1, bitmap.height, 0, 0, 1, bitmap.height);
        const data = ctx.getImageData(0, 0, 1, bitmap.height).data;
        for (let y = 0; y < bitmap.height; y += 1) {
          const cssY = (offset + y + 0.5) / scale;
          // 배율이 1이 아니면 행의 경계에 있는 픽셀은 두 색이 섞인다. 그 픽셀은 확인하지 않는다.
          if (scale !== 1) {
            const edge = cssY < header ? header - cssY : (cssY - header) % ROW;
            if (edge < 1.5 || ROW - edge < 1.5 || Math.abs(cssY - header) < 1.5) continue;
          }
          const want = expected(cssY);
          if (!want) continue;
          const got = [data[y * 4], data[y * 4 + 1], data[y * 4 + 2]];
          if (want.some((v, k) => Math.abs(v - got[k]) > tolerance)) {
            bad += 1;
            if (samples.length < 5) samples.push({ y: offset + y, want, got });
          }
        }
        offset += bitmap.height;
        bitmap.close();
      }
      return { total: offset, bad, samples };
    },
    { x, scale, header, rows, tolerance, ROW },
  );
}

// ---------- 시험 ----------

const tests = [];
const test = (name, fn, options = {}) => tests.push({ name, fn, options });
const assert = (cond, text) => {
  if (!cond) throw new Error(text);
};

test('auto: 일반 페이지를 자동 스크롤로 캡처하고 긴 사진 한 장으로 저장한다', async (browser, base) => {
  const rows = 100;
  const { page, panel } = await open(browser, `${base}/plain?rows=${rows}`);
  await runAuto(panel);
  const docHeight = HEADER + rows * ROW;
  const files = await save(panel);
  assert(files.length === 1, `파일 수 ${files.length}`);
  assert(files[0].type === 'image/png', files[0].type);
  assert(/^일반 페이지 시험 1_\d{8}-\d{6}_01\.png$/.test(files[0].filename), `파일 이름 ${files[0].filename}`);
  assert(files[0].height === docHeight, `높이 ${files[0].height}, 기대 ${docHeight}`);
  const col = await checkColumn(panel, { x: 100, scale: 1, header: HEADER, rows });
  assert(col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  const gaps = await panel.textContent('#gaps');
  assert(gaps === '0개', `누락 영역 ${gaps}`);
  // 정지한 후에 고정 메뉴가 다시 보여야 한다.
  const visible = await page.evaluate(() =>
    [...document.querySelectorAll('.header, .bar')].map((el) => getComputedStyle(el).visibility).join(','));
  assert(visible === 'visible,visible', `고정 메뉴 복구 ${visible}`);
  return `사진 ${await captureCount(panel)}장 → ${files[0].width}x${files[0].height}px`;
});

test('manual: 수동 스크롤을 캡처하고 겹친 부분을 자른다', async (browser, base) => {
  const rows = 100;
  const { page, panel } = await open(browser, `${base}/plain?rows=${rows}`);
  await panel.click('#toggle');
  await panel.waitForFunction(() => window.__scDebug.captures.length === 1);
  await page.mouse.move(400, 300);
  const steps = [300, 450, 137, 520, 380, 610, 205];
  for (let i = 0; i < steps.length; i += 1) {
    await page.mouse.wheel(0, steps[i]);
    await panel.waitForFunction((n) => window.__scDebug.captures.length === n, i + 2, { timeout: 15_000 });
  }
  await panel.click('#toggle');
  await waitIdle(panel);
  const scrolled = steps.reduce((a, b) => a + b, 0);
  const view = await viewOf(page);
  const files = await save(panel);
  assert(files[0].height === scrolled + view.h, `높이 ${files[0].height}, 기대 ${scrolled + view.h}`);
  const col = await checkColumn(panel, { x: 100, scale: 1, header: HEADER, rows });
  assert(col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  return `사진 ${steps.length + 1}장 → ${files[0].width}x${files[0].height}px`;
});

test('manual-fast: 캡처 사이에 빠르게 스크롤하면 누락 영역을 경고한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/plain?rows=100`);
  await panel.click('#toggle');
  await panel.waitForFunction(() => window.__scDebug.captures.length === 1);
  await page.evaluate(() => window.scrollTo(0, 2000));
  await panel.waitForFunction(() => window.__scDebug.captures.length === 2, null, { timeout: 15_000 });
  await panel.click('#toggle');
  await waitIdle(panel);
  const gaps = await panel.textContent('#gaps');
  assert(gaps === '1개', `누락 영역 ${gaps}`);
  return `누락 영역 ${gaps}`;
});

test('infinite: 무한 스크롤 페이지에서 새 내용을 기다리고 끝까지 캡처한다', async (browser, base) => {
  const rows = 120;
  const { panel } = await open(browser, `${base}/infinite`);
  await runAuto(panel);
  const docHeight = HEADER + rows * ROW;
  const files = await save(panel);
  assert(files[0].height === docHeight, `높이 ${files[0].height}, 기대 ${docHeight}`);
  const col = await checkColumn(panel, { x: 100, scale: 1, header: HEADER, rows });
  assert(col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  return `사진 ${await captureCount(panel)}장 → ${files[0].width}x${files[0].height}px`;
});

test('inner: 안쪽 스크롤 영역만 캡처한다', async (browser, base) => {
  const rows = 80;
  const { panel } = await open(browser, `${base}/inner`);
  await runAuto(panel);
  const files = await save(panel);
  assert(files[0].height === rows * ROW, `높이 ${files[0].height}, 기대 ${rows * ROW}`);
  assert(files[0].width <= VIEW.width - 200, `너비 ${files[0].width}`);
  const col = await checkColumn(panel, { x: 50, scale: 1, header: 0, rows });
  assert(col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  return `사진 ${await captureCount(panel)}장 → ${files[0].width}x${files[0].height}px`;
});

test('each: 화면별 여러 장을 JPEG로 저장하고 다운로드를 끝낸다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/plain?rows=40`);
  await runAuto(panel);
  const view = await viewOf(page);
  const count = await captureCount(panel);
  const files = await save(panel, { format: 'jpeg', mode: 'each' });
  assert(files.length === count, `파일 ${files.length}개, 사진 ${count}장`);
  assert(files.every((f) => f.type === 'image/jpeg' && f.filename.endsWith('.jpg')), '형식이 JPEG가 아니다');
  assert(files.every((f) => f.width === view.w && f.height === view.h), '사진의 크기가 화면과 다르다');
  // 다운로드가 끝나고 파일이 디스크에 있는지 확인한다.
  // Playwright는 다운로드한 파일을 임시 이름으로 저장한다. 그래서 파일의 크기를 비교한다.
  let done = [];
  for (let i = 0; i < 60 && done.length < files.length; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const items = await panel.evaluate(() => chrome.downloads.search({}));
    done = items.filter((d) => d.state === 'complete');
  }
  assert(done.length === files.length, `끝난 다운로드 ${done.length}개`);
  const onDisk = [];
  for (const d of done) onDisk.push((await stat(d.filename)).size);
  const sorted = (list) => [...list].sort((a, b) => a - b).join(',');
  assert(sorted(onDisk) === sorted(files.map((f) => f.bytes)), `파일 크기 ${sorted(onDisk)}`);
  return `파일 ${files.length}개 저장, 디스크에서 확인`;
});

test('filename: 시스템이 한글 파일 이름을 거부하면 영문 이름으로 저장한다', async (browser, base) => {
  const { panel } = await open(browser, `${base}/plain?rows=20`);
  await runAuto(panel);
  const files = await save(panel);
  assert(/^scroll-capture_\d{8}-\d{6}_01\.png$/.test(files[0].filename), `파일 이름 ${files[0].filename}`);
  const message = await panel.textContent('#message');
  assert(message.includes('저장했습니다'), message);
  return `파일 이름 ${files[0].filename}`;
}, { locale: 'C' });

test('limit: 최대 화면 수에서 자동 스크롤을 정지한다', async (browser, base) => {
  const { panel } = await open(browser, `${base}/plain?rows=200`);
  await panel.fill('#maxScreens', '3');
  await runAuto(panel);
  const count = await captureCount(panel);
  assert(count === 3, `사진 ${count}장`);
  return `사진 ${count}장에서 정지`;
});

test('long: 매우 긴 페이지는 사진을 여러 장으로 나눈다', async (browser, base) => {
  const rows = 660; // 60 + 660 * 50 = 33,060px
  const { panel } = await open(browser, `${base}/plain?rows=${rows}`);
  await runAuto(panel);
  const docHeight = HEADER + rows * ROW;
  const files = await save(panel);
  assert(files.length === 2, `파일 수 ${files.length}`);
  assert(files[0].height === 30000 && files[1].height === docHeight - 30000, `높이 ${files.map((f) => f.height)}`);
  const col = await checkColumn(panel, { x: 100, scale: 1, header: HEADER, rows });
  assert(col.total === docHeight && col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  return `사진 ${await captureCount(panel)}장 → 파일 2개 (${files.map((f) => f.height).join(' + ')}px)`;
});

test('scale: 화면 배율 1.5에서 이음매가 정확하다', async (browser, base) => {
  const rows = 100;
  const { page, panel } = await open(browser, `${base}/plain?rows=${rows}`);
  const view = await viewOf(page);
  assert(view.dpr === 1.5, `배율 ${view.dpr}`);
  await runAuto(panel);
  const files = await save(panel);
  const want = (HEADER + rows * ROW) * 1.5;
  assert(Math.abs(files[0].height - want) <= 1, `높이 ${files[0].height}, 기대 ${want}`);
  const col = await checkColumn(panel, { x: 100, scale: 1.5, header: HEADER, rows });
  assert(col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  return `사진 ${await captureCount(panel)}장 → ${files[0].width}x${files[0].height}px`;
}, { scale: 1.5 });

test('quota: 캡처 간격은 Chrome의 캡처 제한보다 길다', async (browser, base) => {
  const { panel } = await open(browser, `${base}/plain?rows=100`);
  const perSecond = await panel.evaluate(() => chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND);
  assert(perSecond === 2, `Chrome의 제한 값 ${perSecond}`);
  // 캡처 시각을 기록하고, 1초 동안의 캡처 횟수를 확인한다.
  await panel.evaluate(() => {
    window.__times = [];
    const original = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
    chrome.tabs.captureVisibleTab = (...args) => {
      window.__times.push(performance.now());
      return original(...args);
    };
  });
  await runAuto(panel);
  const times = await panel.evaluate(() => window.__times);
  let worst = 0;
  for (let i = 0; i < times.length; i += 1) {
    worst = Math.max(worst, times.filter((t) => t >= times[i] && t < times[i] + 1000).length);
  }
  assert(times.length >= 8 && worst <= perSecond, `1초 동안 최대 ${worst}회 (캡처 ${times.length}회)`);
  return `Chrome의 제한: 1초에 ${perSecond}회. 측정 값: 1초에 최대 ${worst}회 (캡처 ${times.length}회)`;
});

// ---------- 실행 ----------

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0;
for (const t of tests) {
  if (filters.length && !filters.some((f) => t.name.includes(f))) continue;
  const browser = await launch(t.options);
  const started = Date.now();
  try {
    const note = await t.fn(browser, base);
    console.log(`통과  ${t.name}\n      ${note} (${((Date.now() - started) / 1000).toFixed(1)}초)`);
  } catch (error) {
    failed += 1;
    console.log(`실패  ${t.name}\n      ${error.message.split('\n')[0]}`);
  } finally {
    await browser.context.close().catch(() => {});
    await rm(browser.work, { recursive: true, force: true }).catch(() => {});
  }
}
server.close();
console.log(failed ? `\n시험 ${failed}개가 실패했습니다.` : '\n모든 시험이 통과했습니다.');
process.exit(failed ? 1 : 0);
