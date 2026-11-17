// 자동 업데이트 판단의 단위 시험.  실행: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_PERIOD_MINUTES, SETTLE_MS, decide, isVersion, readDiskVersion } from '../update.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('isVersion: 점으로 구분한 숫자 1~4개만 버전이다', () => {
  for (const good of ['1', '0.4.0', '1.2.3.4', '10.20.30']) assert.equal(isVersion(good), true, good);
  for (const bad of ['', '1.', '.1', '1.2.3.4.5', '0.4.0-beta', 'abc', null, undefined, 4]) {
    assert.equal(isVersion(bad), false, String(bad));
  }
});

test('decide: 폴더의 버전이 실행 중인 버전과 같으면 아무것도 하지 않는다', () => {
  assert.equal(decide({ loaded: '0.4.0', first: '0.4.0', second: '0.4.0', panelOpen: false }), 'none');
  assert.equal(decide({ loaded: '0.4.0', first: '0.4.0' }), 'none');
});

test('decide: 폴더의 버전을 읽지 못하면 아무것도 하지 않는다', () => {
  assert.equal(decide({ loaded: '0.4.0', first: null, second: '0.5.0', panelOpen: false }), 'none');
  assert.equal(decide({ loaded: '0.4.0', first: 'broken', second: 'broken', panelOpen: false }), 'none');
});

test('decide: 두 번 읽은 값이 다르면 기다린다 (파일이 바뀌는 중)', () => {
  assert.equal(decide({ loaded: '0.4.0', first: '0.5.0', second: '0.6.0', panelOpen: false }), 'wait');
  assert.equal(decide({ loaded: '0.4.0', first: '0.5.0', second: null, panelOpen: false }), 'wait');
  assert.equal(decide({ loaded: '0.4.0', first: '0.5.0', second: '0.4.0', panelOpen: false }), 'wait');
});

test('decide: 새 버전이 있고 측면 패널이 닫혀 있으면 다시 로드한다', () => {
  assert.equal(decide({ loaded: '0.4.0', first: '0.5.0', second: '0.5.0', panelOpen: false }), 'reload');
});

test('decide: 측면 패널이 열려 있으면 다시 로드하지 않고 알린다', () => {
  assert.equal(decide({ loaded: '0.4.0', first: '0.5.0', second: '0.5.0', panelOpen: true }), 'notify');
});

test('decide: 버전이 낮아진 때에도 다시 로드한다', () => {
  assert.equal(decide({ loaded: '0.4.0', first: '0.3.0', second: '0.3.0', panelOpen: false }), 'reload');
});

test('readDiskVersion: manifest의 버전을 읽는다. 캐시를 사용하지 않는다', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return { json: async () => ({ version: '1.2.3' }) };
  };
  assert.equal(await readDiskVersion('x://manifest.json', fetchFn), '1.2.3');
  assert.deepEqual(calls, [{ url: 'x://manifest.json', options: { cache: 'no-store' } }]);
});

test('readDiskVersion: 읽지 못하면 null', async () => {
  const fail = async () => {
    throw new Error('no file');
  };
  const broken = async () => ({
    json: async () => {
      throw new SyntaxError('half-written file');
    },
  });
  const noVersion = async () => ({ json: async () => ({ name: 'x' }) });
  const badVersion = async () => ({ json: async () => ({ version: '1.x' }) });
  for (const fetchFn of [fail, broken, noVersion, badVersion]) {
    assert.equal(await readDiskVersion('x://manifest.json', fetchFn), null);
  }
});

test('상수: 확인 간격과 대기 시간', () => {
  assert.ok(CHECK_PERIOD_MINUTES >= 1 && CHECK_PERIOD_MINUTES <= 60);
  // 서비스 워커는 30초 동안 일이 없으면 종료한다. 대기 시간은 그것보다 짧아야 한다.
  assert.ok(SETTLE_MS >= 1000 && SETTLE_MS < 30_000);
});

test('manifest: 자동 업데이트에 필요한 설정이 있다', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(isVersion(manifest.version), true);
  assert.ok(manifest.permissions.includes('alarms'));
  assert.equal(manifest.background.type, 'module');
  // 자동 업데이트는 권한을 추가하지 않는다: 사이트 권한이 없어야 한다.
  assert.equal(manifest.host_permissions, undefined);
});

test('auto-update/*.ps1: BOM이 있는 UTF-8이다 (Windows PowerShell 5.1이 한글을 읽는 조건)', async () => {
  const dir = join(ROOT, 'auto-update');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.ps1'));
  assert.deepEqual(files.sort(), ['install.ps1', 'pull.ps1', 'uninstall.ps1']);
  for (const name of files) {
    const bytes = await readFile(join(dir, name));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], name);
  }
});
