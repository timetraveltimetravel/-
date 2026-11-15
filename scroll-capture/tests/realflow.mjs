// 실제 사용 경로의 시험: 아이콘을 누르는 동작 → 측면 패널 → 캡처 → 저장.
// 이 시험은 사이트 권한을 추가하지 않는다. 배포하는 manifest의 권한(activeTab)만 사용한다.
//
// 시험은 도구 모음의 아이콘을 누를 수 없다. 그래서 시험용 복사본에 단축키를 추가한다.
// 단축키는 아이콘을 누르는 것과 같은 동작이다.
//
// 필요한 것: Xvfb, python3, python-xlib (pip install python-xlib)
// 실행: xvfb-run -a -s "-screen 0 1400x900x24" node tests/realflow.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ROWS = 80;
const ROW = 50;

const assert = (cond, text) => {
  if (!cond) throw new Error(text);
};

const rows = Array.from({ length: ROWS }, (_, i) =>
  `<div style="height:${ROW}px;background:rgb(${(i * 37 + 20) % 256},${(i * 91 + 70) % 256},${(i * 53 + 120) % 256})">${i}</div>`).join('');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>real flow</title><style>body{margin:0}</style>${rows}`);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

const work = await mkdtemp(join(tmpdir(), 'scroll-capture-real-'));
const ext = join(work, 'ext');
await cp(ROOT, ext, { recursive: true, filter: (src) => !src.includes(`${ROOT}/tests`) });
const manifestPath = join(ext, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.commands = { _execute_action: { suggested_key: { default: 'Ctrl+Shift+Y' } } };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  channel: 'chromium',
  headless: false,
  viewport: null,
  env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1300,800', '--window-position=0,0'],
});

let failed = false;
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const page = context.pages()[0];
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.bringToFront();

  // 아이콘을 누르기 전: 확장 프로그램은 이 페이지에 접근할 수 없다.
  const access = () =>
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => 1 });
        return true;
      } catch {
        return false;
      }
    });
  assert((await access()) === false, '아이콘을 누르기 전에 페이지에 접근할 수 있다');

  await page.waitForTimeout(500);
  execFileSync('python3', [join(HERE, 'sendkey.py')], { env: process.env });

  // 측면 패널이 열릴 때까지 기다린다.
  const cdp = await context.newCDPSession(page);
  let target;
  for (let i = 0; i < 40 && !target; i += 1) {
    await page.waitForTimeout(250);
    const { targetInfos } = await cdp.send('Target.getTargets');
    target = targetInfos.find((t) => t.url.includes('sidepanel.html'));
  }
  assert(target, '측면 패널이 열리지 않았다');
  const kinds = await worker.evaluate(async () => (await chrome.runtime.getContexts({})).map((c) => c.contextType));
  assert(kinds.includes('SIDE_PANEL'), `측면 패널의 종류 ${kinds}`);
  assert((await access()) === true, '아이콘을 누른 후에 페이지에 접근할 수 없다');

  // Playwright는 측면 패널을 페이지로 보여주지 않는다. 그래서 CDP로 측면 패널에 연결한다.
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let seq = 0;
  const waiting = new Map();
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    const msg = JSON.parse(event.message);
    const done = waiting.get(msg.id);
    if (done) {
      waiting.delete(msg.id);
      done(msg);
    }
  });
  const call = async (method, params) => {
    const id = (seq += 1);
    const reply = new Promise((ok) => waiting.set(id, ok));
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
    const msg = await reply;
    if (msg.error) throw new Error(JSON.stringify(msg.error));
    return msg.result;
  };
  const inPanel = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  await inPanel(`document.getElementById('speed').value = 'fast'; document.getElementById('auto').click(); 1`);
  let status;
  for (let i = 0; i < 160; i += 1) {
    await page.waitForTimeout(500);
    status = JSON.parse(await inPanel(`JSON.stringify({ capturing: __scDebug.capturing, count: __scDebug.captures.length })`));
    if (i > 3 && !status.capturing) break;
  }
  assert(!status.capturing && status.count >= 2, `캡처 상태 ${JSON.stringify(status)}`);

  await inPanel(`document.getElementById('save').click(); 1`);
  for (let i = 0; i < 80; i += 1) {
    await page.waitForTimeout(250);
    if (await inPanel('!__scDebug.saving && __scDebug.lastSaved.length > 0')) break;
  }
  const saved = JSON.parse(await inPanel(`(async () => {
    const { filename, blob } = __scDebug.lastSaved[0];
    const bitmap = await createImageBitmap(blob);
    const downloads = await chrome.downloads.search({});
    return JSON.stringify({ filename, bytes: blob.size, width: bitmap.width, height: bitmap.height,
      downloads: downloads.map((d) => [d.state, d.fileSize]), panelWidth: innerWidth });
  })()`));
  assert(saved.height === ROWS * ROW, `높이 ${saved.height}, 기대 ${ROWS * ROW}`);
  assert(saved.downloads.length === 1 && saved.downloads[0][0] === 'complete' && saved.downloads[0][1] === saved.bytes,
    `다운로드 ${JSON.stringify(saved.downloads)}`);

  if (process.env.SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  console.log(`통과  실제 사용 경로: 측면 패널(너비 ${saved.panelWidth}px)에서 사진 ${status.count}장 → ${saved.width}x${saved.height}px, 파일 "${saved.filename}"`);
} catch (error) {
  failed = true;
  console.log(`실패  실제 사용 경로\n      ${error.message.split('\n')[0]}`);
} finally {
  await context.close().catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
  server.close();
}
process.exit(failed ? 1 : 0);
