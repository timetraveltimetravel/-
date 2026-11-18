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

// 글자가 있는 페이지: 텍스트 변환의 시험에 사용한다.
const SENTENCES = [
  '스크롤 캡처는 화면을 순서대로 저장하는 프로그램입니다.',
  '사용자는 버튼 하나로 캡처를 시작하고 정지합니다.',
  '프로그램은 겹친 부분을 자르고 사진을 이어 붙입니다.',
  '개인정보는 브라우저 밖으로 나가지 않습니다.',
  '2026년 11월 15일 기준으로 시험 12개가 통과했습니다.',
  'The quick brown fox jumps over the lazy dog.',
  '가격은 12,500원이고 할인율은 15%입니다.',
];
pages['/text'] = () => `<!doctype html><title>긴 기사 예시</title><style>
    body { margin: 0; font: 16px/1.7 sans-serif; color: #222; }
    nav { position: sticky; top: 0; background: #1f3a8a; color: #fff; padding: 14px 24px; font-weight: 700; }
    main { max-width: 720px; margin: 0 auto; padding: 8px 24px 80px; }
    h2 { margin-top: 32px; }
  </style><nav>사이트 메뉴</nav><main><h1>긴 기사 예시</h1>${Array.from({ length: 8 }, (_, i) =>
    `<h2>${i + 1}. 섹션 제목</h2><p>${SENTENCES.slice(i % 4, (i % 4) + 4).join(' ')}</p><p>${SENTENCES.slice((i + 2) % 5, ((i + 2) % 5) + 3).join(' ')}</p>`).join('')}</main>`;

// 글자 단위의 오류율: 편집 거리 / 정답의 글자 수. 빈칸과 줄 바꿈은 비교하지 않는다.
function errorRate(truth, text) {
  const a = truth.replace(/\s+/g, '');
  const b = text.replace(/\s+/g, '');
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] / a.length;
}

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
    channel: process.env.SC_CHANNEL || 'chromium',
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
async function runAuto(panel, speed = 'fast') {
  await panel.selectOption('#speed', speed);
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

test('natural: 자연스러운 속도로 스크롤하고, 누락 영역이 없이 캡처한다', async (browser, base) => {
  const rows = 100;
  const { page, panel } = await open(browser, `${base}/plain?rows=${rows}`);
  const view = await viewOf(page);
  // 같은 동작을 반복하도록 난수 함수를 바꾼다.
  await panel.evaluate(() => {
    let a = 20261115;
    window.__scDebug.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  // 스크롤의 움직임을 기록한다: [시간(ms), 위치(px)]
  await page.evaluate(() => {
    window.__track = [[performance.now(), scrollY]];
    addEventListener('scroll', () => window.__track.push([performance.now(), scrollY]), { passive: true });
  });
  await runAuto(panel, 'random');
  const track = await page.evaluate(() => window.__track);
  if (process.env.TRACK_FILE) await writeFile(process.env.TRACK_FILE, JSON.stringify(track));

  // 위로 이동한 횟수: 위치가 30px 이상 감소한 구간의 수
  let ups = 0;
  let peak = track[0][1];
  let falling = false;
  for (const [, y] of track) {
    if (y > peak) {
      peak = y;
      falling = false;
    } else if (!falling && peak - y >= 30) {
      ups += 1;
      falling = true;
    }
    if (falling && y >= peak) falling = false;
  }
  assert(ups >= 1, '위로 이동하지 않았다');
  // 부드러운 이동: 한 번에 화면의 1/3보다 많이 이동하지 않는다.
  let jump = 0;
  for (let k = 1; k < track.length; k += 1) jump = Math.max(jump, Math.abs(track[k][1] - track[k - 1][1]));
  assert(jump < view.h / 3, `한 번에 이동한 최대 거리 ${Math.round(jump)}px`);
  assert(track.length > 300, `기록한 위치 ${track.length}개`);

  const ys = await panel.evaluate(() => window.__scDebug.captures.map((c) => c.y).sort((a, b) => a - b));
  const steps = ys.slice(1).map((y, k) => Math.round(y - ys[k]));
  assert(steps.every((d) => d > 0 && d < view.h), `캡처 위치의 간격 ${steps}`);
  const files = await save(panel);
  const docHeight = HEADER + rows * ROW;
  assert(files[0].height === docHeight, `높이 ${files[0].height}, 기대 ${docHeight}`);
  const col = await checkColumn(panel, { x: 100, scale: 1, header: HEADER, rows });
  assert(col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  assert((await panel.textContent('#gaps')) === '0개', '누락 영역이 있다');
  const seconds = (track.at(-1)[0] - track[0][0]) / 1000;
  return `사진 ${ys.length}장, 위로 이동 ${ups}번, 기록한 위치 ${track.length}개, 한 번에 이동한 최대 거리 ${Math.round(jump)}px, 스크롤 시간 ${seconds.toFixed(1)}초`;
});

test('natural-inner: 자연스러운 속도로 안쪽 스크롤 영역과 무한 스크롤 페이지를 캡처한다', async (browser, base) => {
  const notes = [];
  for (const [path, rows, header, x] of [['/inner', 80, 0, 50], ['/infinite', 120, HEADER, 100]]) {
    const { panel } = await open(browser, `${base}${path}`);
    await runAuto(panel, 'random');
    const files = await save(panel);
    const want = header + rows * ROW;
    assert(files[0].height === want, `${path}: 높이 ${files[0].height}, 기대 ${want}`);
    const col = await checkColumn(panel, { x, scale: 1, header, rows });
    assert(col.bad === 0, `${path}: 색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
    assert((await panel.textContent('#gaps')) === '0개', `${path}: 누락 영역이 있다`);
    notes.push(`${path} 사진 ${await captureCount(panel)}장 → ${files[0].height}px`);
    await panel.close();
  }
  return notes.join(', ');
});

test('ocr: 사진 안의 글자를 텍스트로 변환하고 TXT 파일로 저장한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/text`);
  const truth = await page.evaluate(() => document.body.innerText);
  await runAuto(panel);
  await panel.click('#ocr');
  await panel.waitForFunction(() => window.__scDebug.ocr, null, { timeout: 15_000 });
  await panel.waitForFunction(() => !window.__scDebug.ocr, null, { timeout: 180_000 });
  assert(await panel.isVisible('#ocrText'), '텍스트 영역이 보이지 않는다');
  const text = await panel.inputValue('#ocrText');
  const rate = errorRate(truth, text);
  assert(rate < 0.08, `글자 오류율 ${(rate * 100).toFixed(1)}%`);
  for (const phrase of ['스크롤 캡처는 화면을 순서대로 저장하는 프로그램입니다.', 'quick brown fox']) {
    assert(text.includes(phrase), `변환한 텍스트에 "${phrase}"가 없다`);
  }
  // 변환은 브라우저 안에서 수행한다: 외부 주소로 요청을 보내지 않아야 한다.
  const external = await panel.evaluate(() =>
    performance.getEntriesByType('resource').map((e) => e.name).filter((u) => !u.startsWith('chrome-extension://') && !u.startsWith('data:') && !u.startsWith('blob:')));
  assert(external.length === 0, `외부 요청 ${external}`);

  await panel.click('#ocrSave');
  await panel.waitForFunction(() => !window.__scDebug.saving && window.__scDebug.lastSaved[0]?.filename.endsWith('.txt'), null, { timeout: 30_000 });
  const saved = await panel.evaluate(async () => {
    const { filename, blob } = window.__scDebug.lastSaved[0];
    return { filename, type: blob.type, body: await blob.text() };
  });
  assert(/^긴 기사 예시_\d{8}-\d{6}\.txt$/.test(saved.filename), `파일 이름 ${saved.filename}`);
  assert(saved.body.startsWith('제목: 긴 기사 예시\n주소: http://127.0.0.1'), `파일의 첫 부분 ${saved.body.slice(0, 60)}`);
  assert(saved.body.includes(text), '파일에 변환한 텍스트가 없다');
  return `글자 ${truth.replace(/\s+/g, '').length}개, 오류율 ${(rate * 100).toFixed(1)}%, 파일 "${saved.filename}"`;
});

test('ocr-stop: 텍스트 변환을 정지할 수 있다', async (browser, base) => {
  const { panel } = await open(browser, `${base}/text`);
  await runAuto(panel);
  await panel.click('#ocr');
  await panel.waitForFunction(() => window.__scDebug.ocr, null, { timeout: 15_000 });
  assert((await panel.textContent('#ocr')) === '변환 정지', '버튼의 글자가 "변환 정지"가 아니다');
  await panel.click('#ocr');
  await panel.waitForFunction(() => !window.__scDebug.ocr, null, { timeout: 60_000 });
  const status = await panel.textContent('#ocrStatus');
  assert(status === '변환을 정지했습니다.', status);
  assert(!(await panel.isVisible('#ocrText')), '정지한 후에 텍스트 영역이 보인다');
  return status;
});

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

// 시험용 복사본의 manifest.json의 버전을 바꾼다 (git pull이 새 버전을 받은 상태와 같다).
async function setDiskVersion(browser, version) {
  const manifestPath = join(browser.work, 'ext', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
const loadedVersion = (worker) => worker.evaluate(() => chrome.runtime.getManifest().version);

test('update: 폴더의 버전이 바뀌면 패널에 알리고, 패널을 닫은 후에 다시 로드한다', async (browser, base) => {
  const { context, worker } = browser;
  const { panel } = await open(browser, `${base}/plain?rows=20`);
  const before = await loadedVersion(worker);
  assert((await panel.textContent('#version')) === `버전 ${before}`, `버전 표시 ${await panel.textContent('#version')}`);

  // 버전이 같으면 아무것도 하지 않는다.
  const same = await worker.evaluate(() => self.__scUpdate.check());
  assert(same.action === 'none', `버전이 같을 때의 동작 ${same.action}`);
  assert(!(await panel.isVisible('#update')), '새 버전이 없는데 알림이 보인다');

  // 측면 패널이 열려 있다: 다시 로드하지 않고 알린다.
  const next = '99.0.1';
  await setDiskVersion(browser, next);
  const open1 = await worker.evaluate(() => self.__scUpdate.check());
  assert(open1.action === 'notify' && open1.version === next, `패널이 열려 있을 때의 동작 ${JSON.stringify(open1)}`);
  await panel.waitForSelector('#update:not([hidden])', { timeout: 5000 });
  const notice = await panel.textContent('#updateText');
  assert(notice.includes(next), `알림 ${notice}`);
  assert((await loadedVersion(worker)) === before, '패널이 열려 있는데 다시 로드했다');

  // 측면 패널을 닫았다: 다시 로드한다. 새 서비스 워커가 시작한다.
  await panel.close();
  const [reloaded] = await Promise.all([
    context.waitForEvent('serviceworker', { timeout: 30_000 }),
    worker.evaluate(() => { self.__scUpdate.check(); }).catch(() => {}),
  ]);
  const after = await loadedVersion(reloaded);
  assert(after === next, `다시 로드한 후의 버전 ${after}`);
  const settled = await reloaded.evaluate(() => self.__scUpdate.check());
  assert(settled.action === 'none', `다시 로드한 후의 동작 ${settled.action}`);
  return `버전 ${before} → ${after}`;
});

test('update-apply: "지금 적용"을 누르면 바로 다시 로드한다', async (browser, base) => {
  const { context, worker } = browser;
  const { panel } = await open(browser, `${base}/plain?rows=20`);
  const before = await loadedVersion(worker);
  const next = '99.0.2';
  await setDiskVersion(browser, next);
  // 패널을 다시 열면 패널이 확인을 요청한다.
  await panel.reload();
  await panel.waitForSelector('#update:not([hidden])', { timeout: 15_000 });
  const [reloaded] = await Promise.all([
    context.waitForEvent('serviceworker', { timeout: 30_000 }),
    panel.click('#updateApply').catch(() => {}),
  ]);
  const after = await loadedVersion(reloaded);
  assert(after === next, `다시 로드한 후의 버전 ${after}`);
  return `버전 ${before} → ${after}`;
});

// ---------- 여러 페이지 ----------

const BOOK_ROWS = 24;
const NAV_HEIGHT = 60;
const BOOK_HEIGHT = BOOK_ROWS * ROW + NAV_HEIGHT;
const NAV_CSS = `
  .navbar { display: flex; gap: 20px; align-items: center; height: ${NAV_HEIGHT}px; padding-left: 300px; background: rgb(30,30,30); }
  .navbar a, .navbar button { color: #fff; background: none; border: 1px solid #fff; padding: 4px 12px; font: inherit; }
`;

// 여러 쪽의 책: 아래쪽에 "이전", "다음" 링크가 있다. 첫 쪽에는 "이전"이 없고, 마지막 쪽에는 "다음"이 없다.
// loop=1: 마지막 쪽의 "다음"이 첫 쪽으로 이동한다.
// num=1:  링크의 글자에 쪽 번호가 있다 ("다음 2쪽"). 글자가 쪽마다 다르다.
pages['/book'] = (q) => {
  const p = Number(q.get('p') || 1);
  const last = Number(q.get('last') || 3);
  const loop = q.get('loop') === '1';
  const num = q.get('num') === '1';
  const link = (n, text) =>
    `<a class="nav" href="/book?p=${n}&last=${last}${loop ? '&loop=1' : ''}${num ? '&num=1' : ''}">${text}${num ? ` ${n}쪽` : ''}</a>`;
  const nav = (p > 1 ? link(p - 1, '이전') : '') + (p < last ? link(p + 1, '다음') : loop ? link(1, '다음') : '');
  return `<!doctype html><title>책 ${p}쪽</title><style>${BASE_CSS}${NAV_CSS}</style>
    ${rowsHtml((p - 1) * 100, BOOK_ROWS)}<div class="navbar">${nav}</div>`;
};

// 주소가 바뀌지 않는 사이트: "다음" 버튼이 내용만 바꾼다. 스크롤 위치는 그대로이다. 마지막 쪽에서 버튼을 사용할 수 없다.
pages['/spa'] = () => `<!doctype html><title>앱 1쪽</title><style>${BASE_CSS}${NAV_CSS}</style>
  <div id="list">${rowsHtml(0, BOOK_ROWS)}</div><div class="navbar"><button id="next" type="button">다음</button></div>
  <script>
    const color = (i) => 'rgb(' + [(i*37+20)%256, (i*91+70)%256, (i*53+120)%256].join(',') + ')';
    let p = 1;
    document.getElementById('next').addEventListener('click', () => {
      if (p >= 3) return;
      p += 1;
      const rows = [];
      for (let k = 0; k < ${BOOK_ROWS}; k++) {
        const i = (p - 1) * 100 + k;
        rows.push('<div class="row" style="background:' + color(i) + '">' + i + '</div>');
      }
      document.getElementById('list').innerHTML = rows.join('');
      document.title = '앱 ' + p + '쪽';
      if (p === 3) document.getElementById('next').disabled = true;
    });
  </script>`;

// 뷰어: 버튼이 없다. 화면의 오른쪽 부분을 누르면 다음 쪽으로 이동한다. 마지막 쪽에서는 아무 일도 없다.
pages['/viewer'] = (q) => {
  const p = Number(q.get('p') || 1);
  const last = Number(q.get('last') || 2);
  return `<!doctype html><title>뷰어 ${p}쪽</title><style>${BASE_CSS}</style>${rowsHtml((p - 1) * 100, BOOK_ROWS)}
    <script>
      document.addEventListener('click', (e) => {
        if (e.clientX > innerWidth * 0.7 && ${p} < ${last}) location.href = '/viewer?p=${p + 1}&last=${last}';
      });
    </script>`;
};

const debug = (panel) => panel.evaluate(() => {
  const s = window.__scDebug;
  return { picking: s.picking, target: s.nextTarget, pages: s.pages, turning: s.turning, message: document.getElementById('message').textContent };
});

// 측면 패널에서 "넘기는 영역 지정"을 누르고, 페이지에서 한 곳을 누른다.
async function pickTarget(panel, clickOnPage) {
  await panel.click('#pick');
  await panel.waitForFunction(() => window.__scDebug.picking, null, { timeout: 10_000 });
  await clickOnPage();
  await panel.waitForFunction(() => !window.__scDebug.picking && window.__scDebug.nextTarget, null, { timeout: 10_000 });
  return (await debug(panel)).target;
}

// 자동 스크롤을 시작하고, 여러 페이지의 캡처가 끝날 때까지 기다린다.
async function runPages(panel, { wait = '0.5', maxPages } = {}) {
  await panel.fill('#turnWait', wait);
  if (maxPages) await panel.fill('#maxPages', String(maxPages));
  await panel.selectOption('#speed', 'fast');
  await panel.click('#auto');
  await panel.waitForFunction(
    () => {
      const s = window.__scDebug;
      const done = /^페이지 \d+개를 저장했습니다/.test(document.getElementById('message').textContent);
      return done && !s.capturing && !s.auto && !s.turning;
    },
    null,
    { timeout: 180_000 },
  );
  return debug(panel);
}

const pageNumbers = (result) => result.pages.map((p) => Number(/(\d+)쪽/.exec(p.title)[1])).join(',');
// 각 페이지를 처음부터 끝까지 캡처했는지 확인한다.
// 자동 스크롤은 끝에서 2픽셀 안의 위치를 페이지의 끝으로 판단한다. 그래서 2픽셀까지의 차이를 허용한다.
const assertFullPages = (result) => {
  for (const p of result.pages) {
    const full = p.title.startsWith('뷰어') ? BOOK_ROWS * ROW : BOOK_HEIGHT;
    assert(p.positions[0] === 0, `"${p.title}"의 첫 캡처 위치 ${p.positions[0]}`);
    assert(p.height <= full && p.height >= full - 2, `"${p.title}"의 높이 ${p.height}, 기대 ${full}, 위치 ${p.positions}`);
  }
  const files = result.pages.flatMap((p) => p.files);
  assert(files.length === result.pages.length && new Set(files).size === files.length, `파일 ${files}`);
};

test('pages: 넘기는 영역을 누르고, 마지막 페이지까지 캡처하고 저장한다', async (browser, base) => {
  const start = `${base}/book?p=1&last=3`;
  const { page, panel } = await open(browser, start);

  // Esc 키는 지정을 취소한다.
  await panel.click('#pick');
  await panel.waitForFunction(() => window.__scDebug.picking);
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await panel.waitForFunction(() => !window.__scDebug.picking);
  assert((await debug(panel)).target === null, 'Esc 키를 눌렀는데 영역을 지정했다');

  // 지정할 때의 누름은 페이지에 전달하지 않는다. 스크롤 위치는 지정하기 전의 위치로 돌아간다.
  const target = await pickTarget(panel, () => page.locator('a.nav', { hasText: '다음' }).click());
  assert(target.mode === 'element' && target.text === '다음' && target.tag === 'a', `지정한 영역 ${JSON.stringify(target)}`);
  assert(page.url() === start, `지정 중에 페이지가 이동했다: ${page.url()}`);
  assert((await page.evaluate(() => scrollY)) === 0, '스크롤 위치가 돌아가지 않았다');
  assert((await panel.textContent('#nextInfo')).includes('"다음"'), await panel.textContent('#nextInfo'));
  assert((await page.locator('html > div').count()) === 0, '지정이 끝났는데 표시가 남아 있다');

  const result = await runPages(panel);
  assert(pageNumbers(result) === '1,2,3', `저장한 페이지 ${pageNumbers(result)}`);
  assertFullPages(result);
  assert(result.message.includes('페이지 3개') && result.message.includes('마지막 페이지'), result.message);
  assert(page.url().includes('p=3'), `마지막 주소 ${page.url()}`);
  return `${result.pages.map((p) => `${p.title} ${p.height}px`).join(', ')}. ${result.message}`;
});

test('pages-limit: 최대 페이지 수에서 정지하고, 영역을 누르지 않는다', async (browser, base) => {
  // 링크의 글자에 쪽 번호가 있다 ("다음 2쪽", "다음 3쪽"). 프로그램은 숫자를 제외하고 글자를 비교한다.
  const { page, panel } = await open(browser, `${base}/book?p=1&last=5&num=1`);
  const target = await pickTarget(panel, () => page.locator('a.nav', { hasText: '다음' }).click());
  assert(target.text === '다음 2쪽', `지정한 영역 ${JSON.stringify(target)}`);
  const result = await runPages(panel, { maxPages: 2 });
  assert(pageNumbers(result) === '1,2', `저장한 페이지 ${pageNumbers(result)}`);
  assert(result.message.includes('최대 페이지 수(2)'), result.message);
  assert(page.url().includes('p=2'), `마지막 주소 ${page.url()}`);
  return result.message;
});

test('pages-spa: 주소가 바뀌지 않는 사이트에서 새 내용을 처음부터 캡처한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/spa`);
  const target = await pickTarget(panel, () => page.locator('#next').click());
  assert(target.mode === 'element' && target.tag === 'button', `지정한 영역 ${JSON.stringify(target)}`);
  assert((await page.title()) === '앱 1쪽', '지정 중에 페이지가 바뀌었다');
  const result = await runPages(panel);
  assert(pageNumbers(result) === '1,2,3', `저장한 페이지 ${pageNumbers(result)}`);
  assertFullPages(result);
  assert(result.message.includes('이 페이지에 없습니다'), result.message);
  return result.message;
});

test('pages-point: 버튼이 아닌 곳을 지정하면 화면의 같은 위치를 누른다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/viewer?p=1&last=2`);
  const view = await viewOf(page);
  const target = await pickTarget(panel, () => page.mouse.click(Math.round(view.w * 0.9), 300));
  assert(target.mode === 'point' && Math.abs(target.fx - 0.9) < 0.01, `지정한 영역 ${JSON.stringify(target)}`);
  assert(page.url().includes('p=1'), '지정 중에 페이지가 이동했다');
  assert((await panel.inputValue('#pickMode')) === 'point', '누르는 방식의 표시');
  await panel.evaluate(() => { window.__scDebug.turnTimeoutMs = 3000; });
  const result = await runPages(panel);
  assert(pageNumbers(result) === '1,2', `저장한 페이지 ${pageNumbers(result)}`);
  assertFullPages(result);
  assert(result.message.includes('페이지가 바뀌지 않았습니다'), result.message);
  return result.message;
});

test('pages-loop: 이미 캡처한 주소로 이동하면 정지한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/book?p=1&last=2&loop=1`);
  await pickTarget(panel, () => page.locator('a.nav', { hasText: '다음' }).click());
  const result = await runPages(panel);
  assert(pageNumbers(result) === '1,2', `저장한 페이지 ${pageNumbers(result)}`);
  assert(result.message.includes('이미 캡처한 페이지'), result.message);
  return result.message;
});

test('pages-stop: 페이지를 넘기는 중에 "정지"를 누르면 끝낸다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/book?p=1&last=5`);
  await pickTarget(panel, () => page.locator('a.nav', { hasText: '다음' }).click());
  await panel.fill('#turnWait', '20');
  await panel.selectOption('#speed', 'fast');
  await panel.click('#auto');
  await panel.waitForFunction(() => window.__scDebug.turning && window.__scDebug.pages.length === 1, null, { timeout: 60_000 });
  assert((await panel.textContent('#toggle')) === '정지', '페이지를 넘기는 중의 버튼');
  assert((await panel.textContent('#state')) === '페이지 넘기는 중', await panel.textContent('#state'));
  await panel.click('#toggle');
  await panel.waitForFunction(() => !window.__scDebug.turning, null, { timeout: 30_000 });
  const result = await debug(panel);
  assert(result.pages.length === 1 && result.message.includes('정지했습니다'), result.message);
  assert((await panel.textContent('#toggle')) === '캡처 시작', '정지한 후의 버튼');
  return result.message;
});

// ---------- 일시정지, 정지, 저장할 것, 저장 폴더 ----------

const scrollYOf = (page) => page.evaluate(() => scrollY);
const waitRunEnd = (panel, timeout = 180_000) =>
  panel.waitForFunction(() => !window.__scDebug.run && !window.__scDebug.capturing, null, { timeout });

// 마지막으로 저장한 파일. 텍스트 파일은 내용도 읽는다.
const lastFiles = (panel) =>
  panel.evaluate(async () => {
    const out = [];
    for (const { filename, blob, folder } of window.__scDebug.lastSaved) {
      out.push({ filename, folder, type: blob.type, body: blob.type.startsWith('text/') ? await blob.text() : '' });
    }
    return out;
  });
const clickSave = async (panel) => {
  await panel.click('#save');
  await panel.waitForFunction(() => !window.__scDebug.saving && window.__scDebug.lastSaved.length > 0, null, { timeout: 120_000 });
  return lastFiles(panel);
};

test('pause: 일시정지하면 바로 멈추고, "계속"을 누르면 이어서 캡처한다', async (browser, base) => {
  const rows = 100;
  const { page, panel } = await open(browser, `${base}/plain?rows=${rows}`);
  await panel.selectOption('#speed', 'random');
  await panel.click('#auto');
  await panel.waitForFunction(() => window.__scDebug.captures.length >= 3, null, { timeout: 60_000, polling: 50 });
  await panel.click('#auto'); // 일시정지
  assert((await panel.textContent('#auto')) === '계속', `버튼 ${await panel.textContent('#auto')}`);
  assert((await panel.textContent('#state')) === '일시정지', `상태 ${await panel.textContent('#state')}`);
  // 진행 중인 이동은 바로 멈춘다. 이동 한 번은 보통 1~3초이다.
  await page.waitForTimeout(300);
  const y1 = await scrollYOf(page);
  await page.waitForTimeout(2500);
  const y2 = await scrollYOf(page);
  assert(y1 === y2, `일시정지 중에 화면이 움직였다: ${y1} → ${y2}`);
  assert(await panel.evaluate(() => window.__scDebug.run && window.__scDebug.capturing), '일시정지 중에 캡처를 끝냈다');

  // 계속: 빠른 속도로 바꾸고 끝까지 캡처한다. 결과 사진에 빈 곳이 없어야 한다.
  await panel.selectOption('#speed', 'fast');
  await panel.click('#auto');
  assert((await panel.textContent('#auto')) === '일시정지', '계속한 후의 버튼');
  await waitRunEnd(panel);
  const files = await save(panel);
  const docHeight = HEADER + rows * ROW;
  assert(files[0].height === docHeight, `높이 ${files[0].height}, 기대 ${docHeight}`);
  const col = await checkColumn(panel, { x: 100, scale: 1, header: HEADER, rows });
  assert(col.bad === 0, `색이 다른 픽셀 ${col.bad}개 ${JSON.stringify(col.samples)}`);
  assert((await panel.textContent('#gaps')) === '0개', `누락 영역 ${await panel.textContent('#gaps')}`);
  return `${y1}px에서 일시정지, 2.5초 동안 움직이지 않았다. 계속한 후 사진 ${await captureCount(panel)}장 → ${files[0].height}px`;
});

test('stop-now: "정지"를 누르면 스크롤이 바로 멈추고, 사진은 남는다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/plain?rows=100`);
  await panel.selectOption('#speed', 'random');
  await panel.click('#auto');
  await panel.waitForFunction(() => window.__scDebug.captures.length >= 3, null, { timeout: 60_000, polling: 50 });
  await panel.click('#toggle'); // 정지
  await waitRunEnd(panel, 10_000);
  const y1 = await scrollYOf(page);
  await page.waitForTimeout(2000);
  const y2 = await scrollYOf(page);
  assert(y1 === y2, `정지한 후에 화면이 움직였다: ${y1} → ${y2}`);
  const message = await panel.textContent('#message');
  assert(message === '정지했습니다.', message);
  assert((await panel.textContent('#toggle')) === '캡처 시작' && (await panel.textContent('#auto')) === '자동 스크롤', '정지한 후의 버튼');
  assert(!(await panel.isDisabled('#save')), '정지한 후에 "저장"을 누를 수 없다');
  return `${y1}px에서 정지, 사진 ${await captureCount(panel)}장이 남았다`;
});

test('pause-pages: 여러 페이지의 중간에 일시정지하고 계속한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/book?p=1&last=3`);
  await pickTarget(panel, () => page.locator('a.nav', { hasText: '다음' }).click());
  await panel.fill('#turnWait', '0.5');
  await panel.selectOption('#speed', 'slow');
  await panel.click('#auto');
  await panel.waitForFunction(
    () => {
      const s = window.__scDebug;
      return s.pages.length === 1 && s.auto && !s.turning;
    },
    null,
    { timeout: 60_000, polling: 50 },
  );
  await panel.click('#auto'); // 일시정지 (2쪽)
  await page.waitForTimeout(4000);
  const during = await debug(panel);
  assert(during.pages.length === 1 && page.url().includes('p=2'), `일시정지 중에 진행했다: 페이지 ${during.pages.length}개, ${page.url()}`);
  assert((await panel.textContent('#state')) === '일시정지', await panel.textContent('#state'));
  await panel.selectOption('#speed', 'fast');
  await panel.click('#auto'); // 계속
  await waitRunEnd(panel);
  const result = await debug(panel);
  assert(pageNumbers(result) === '1,2,3', `저장한 페이지 ${pageNumbers(result)}`);
  assertFullPages(result);
  return result.message;
});

pages['/novel'] = (q) => {
  const p = Number(q.get('p') || 1);
  const last = Number(q.get('last') || 2);
  const next = p < last ? `<a class="next" href="/novel?p=${p + 1}&last=${last}">다음 화</a>` : '';
  const body = Array.from({ length: 5 }, (_, i) => `<p>${SENTENCES.slice((i + p) % 4, ((i + p) % 4) + 3).join(' ')}</p>`).join('');
  return `<!doctype html><title>소설 ${p}화</title><style>
      body { margin: 0; font: 16px/1.7 sans-serif; color: #222; }
      main { max-width: 720px; margin: 0 auto; padding: 8px 24px 40px; }
      .next { display: inline-block; margin-top: 16px; padding: 8px 16px; border: 1px solid #222; color: #222; }
    </style><main><h1>${p}화</h1>${body}${next}</main>`;
};

test('save-text: 사진 대신 텍스트를 저장하고, 사진과 텍스트를 함께 저장할 수도 있다', async (browser, base) => {
  const { panel } = await open(browser, `${base}/text`);
  await runAuto(panel);
  await panel.check('input[name="content"][value="text"]');
  assert(await panel.isDisabled('input[name="format"][value="png"]'), '텍스트만 저장하는데 사진의 형식을 선택할 수 있다');
  const textOnly = await clickSave(panel);
  assert(textOnly.length === 1 && textOnly[0].filename.endsWith('.txt'), `파일 ${textOnly.map((f) => f.filename)}`);
  assert(textOnly[0].body.startsWith('제목: 긴 기사 예시\n'), textOnly[0].body.slice(0, 40));
  assert(textOnly[0].body.includes('스크롤 캡처는 화면을 순서대로 저장하는 프로그램입니다.'), '텍스트에 문장이 없다');
  const message = await panel.textContent('#message');
  assert(message === '텍스트 파일 1개를 "다운로드" 폴더에 저장했습니다.', message);

  await panel.check('input[name="content"][value="both"]');
  const both = await clickSave(panel);
  const names = both.map((f) => f.filename);
  assert(both.length === 2 && names[0].endsWith('_01.png') && names[1].endsWith('.txt'), `파일 ${names}`);
  assert(names[0].replace(/_01\.png$/, '') === names[1].replace(/\.txt$/, ''), `사진과 텍스트의 파일 이름이 다르다: ${names}`);
  return `텍스트만: ${textOnly[0].filename}. 둘 다: ${names.join(', ')}`;
});

test('pages-text: 여러 페이지에서 페이지마다 텍스트 파일을 저장한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/novel?p=1&last=2`);
  await pickTarget(panel, () => page.locator('a.next').click());
  await panel.check('input[name="content"][value="text"]');
  const result = await runPages(panel);
  const titles = result.pages.map((p) => p.title).join(',');
  assert(titles === '소설 1화,소설 2화', `저장한 페이지 ${titles}`);
  const files = result.pages.flatMap((p) => p.files);
  assert(files.length === 2 && files.every((f) => f.endsWith('.txt')), `파일 ${files}`);
  const [last] = await lastFiles(panel);
  assert(last.body.startsWith('제목: 소설 2화\n'), last.body.slice(0, 40));
  assert(SENTENCES.slice(0, 4).some((s) => last.body.includes(s)), '2화의 텍스트에 문장이 없다');
  return `${files.join(', ')}. ${result.message}`;
});

// 폴더 선택 창은 시험에서 사용할 수 없다. 그래서 브라우저 안의 저장소(OPFS)의 폴더를 선택한 것으로 바꾼다.
const stubPicker = (panel, name) =>
  panel.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory();
    window.showDirectoryPicker = async () => root.getDirectoryHandle(folder, { create: true });
  }, name);
const folderFiles = (panel, name) =>
  panel.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(folder);
    const out = [];
    for await (const [n, h] of dir.entries()) if (h.kind === 'file') out.push(n);
    return out.sort();
  }, name);
const chooseFolder = async (panel, name) => {
  await stubPicker(panel, name);
  await panel.click('#folderPick');
  await panel.waitForFunction((n) => window.__scDebug.folder?.name === n, name, { timeout: 10_000 });
};

test('folder: 선택한 폴더에 순서 번호를 붙여서 차례로 저장하고, 폴더를 기억한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/plain?rows=20`);
  // 폴더에 이미 7번 파일이 있다.
  await panel.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('캡처 모음', { create: true });
    const writable = await (await dir.getFileHandle('0007_이전 파일.txt', { create: true })).createWritable();
    await writable.write('x');
    await writable.close();
  });
  assert(await panel.isDisabled('#sequence'), '"다운로드" 폴더에서 순서 번호를 선택할 수 있다');
  await chooseFolder(panel, '캡처 모음');
  assert((await panel.textContent('#folderName')).includes('"캡처 모음"'), await panel.textContent('#folderName'));
  assert(!(await panel.isDisabled('#sequence')), '순서 번호를 선택할 수 없다');

  await runAuto(panel);
  const first = await clickSave(panel);
  assert(/^0008_일반 페이지 시험 1_\d{8}-\d{6}_01\.png$/.test(first[0].filename), `파일 이름 ${first[0].filename}`);
  assert(first[0].folder === '캡처 모음', `폴더 ${first[0].folder}`);
  const message = await panel.textContent('#message');
  assert(message === '사진 1장을 "캡처 모음" 폴더에 저장했습니다.', message);
  const second = await clickSave(panel);
  assert(second[0].filename.startsWith('0009_'), `두 번째 파일 ${second[0].filename}`);
  await panel.uncheck('#sequence');
  const third = await clickSave(panel);
  assert(/^일반 페이지 시험 1_/.test(third[0].filename), `번호가 없는 파일 ${third[0].filename}`);
  const names = await folderFiles(panel, '캡처 모음');
  const expected = ['0007_이전 파일.txt', first[0].filename, second[0].filename, third[0].filename].sort();
  assert(JSON.stringify(names) === JSON.stringify(expected), `폴더의 파일 ${names}`);

  // 측면 패널을 다시 열어도 폴더를 기억한다.
  await panel.reload();
  await panel.waitForFunction(() => window.__scDebug.folder?.name === '캡처 모음', null, { timeout: 10_000 });
  assert((await panel.textContent('#folderName')).includes('"캡처 모음"'), '다시 연 후의 저장 위치');
  await panel.click('#folderClear');
  assert((await panel.textContent('#folderName')) === '"다운로드" 폴더', await panel.textContent('#folderName'));
  await panel.waitForTimeout(300); // 기억을 지우는 것을 기다린다
  await panel.reload();
  await panel.waitForSelector('#toggle');
  await page.waitForTimeout(500);
  assert(await panel.evaluate(() => window.__scDebug.folder === null), '"다운로드 폴더 사용"을 누른 후에도 폴더를 기억한다');
  return `폴더의 파일: ${names.join(', ')}`;
});

test('folder-pages: 여러 페이지를 선택한 폴더에 0001, 0002, 0003 순서로 저장한다', async (browser, base) => {
  const { page, panel } = await open(browser, `${base}/book?p=1&last=3`);
  await chooseFolder(panel, '책');
  await pickTarget(panel, () => page.locator('a.nav', { hasText: '다음' }).click());
  const result = await runPages(panel);
  const names = await folderFiles(panel, '책');
  assert(names.length === 3 && names.every((n, i) => n.startsWith(`000${i + 1}_책 ${i + 1}쪽_`)), `폴더의 파일 ${names}`);
  assert(result.message.startsWith('페이지 3개를 저장했습니다.'), result.message);
  return names.join(', ');
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
