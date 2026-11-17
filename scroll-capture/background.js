import { CHECK_PERIOD_MINUTES, SETTLE_MS, decide, readDiskVersion } from './update.js';

// 아이콘을 누르면 측면 패널을 연다.
// 아이콘을 누르는 동작이 현재 탭에 대한 캡처 권한(activeTab)을 준다.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ---------- 자동 업데이트 ----------
// 폴더의 manifest.json의 버전이 실행 중인 버전과 다르면 확장 프로그램을 다시 로드한다.
// 측면 패널이 열려 있으면 다시 로드하지 않는다. 캡처한 사진이 없어지기 때문이다.

const UPDATE_ALARM = 'sc-update-check';
const MANIFEST_URL = chrome.runtime.getURL('manifest.json');
const LOADED_VERSION = chrome.runtime.getManifest().version;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 확장 프로그램의 페이지(측면 패널)가 열려 있는지 확인한다.
async function panelOpen() {
  const contexts = await chrome.runtime.getContexts({});
  return contexts.some((context) => context.contextType !== 'BACKGROUND');
}

async function runUpdateCheck() {
  const first = await readDiskVersion(MANIFEST_URL);
  if (decide({ loaded: LOADED_VERSION, first }) === 'none') return { action: 'none', version: first };
  await sleep(SETTLE_MS);
  const second = await readDiskVersion(MANIFEST_URL);
  const action = decide({ loaded: LOADED_VERSION, first, second, panelOpen: await panelOpen() });
  if (action === 'notify') {
    chrome.runtime.sendMessage({ type: 'sc-update-available', version: second }).catch(() => {});
  }
  if (action === 'reload') chrome.runtime.reload();
  return { action, version: second };
}

// 확인을 한 번에 한 개만 수행한다.
let checking = null;
function checkForUpdate() {
  checking ??= runUpdateCheck().finally(() => {
    checking = null;
  });
  return checking;
}
self.__scUpdate = { check: checkForUpdate }; // 시험이 이것을 사용한다

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate();
});

// 측면 패널이 열릴 때 이 메시지를 보낸다.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'sc-update-check') checkForUpdate();
});

chrome.alarms.get(UPDATE_ALARM).then((alarm) => {
  if (alarm?.periodInMinutes === CHECK_PERIOD_MINUTES) return;
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
});

// 서비스 워커가 시작할 때마다 확인한다.
checkForUpdate();
