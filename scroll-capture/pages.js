// 여러 페이지의 캡처: 페이지를 넘기는 판단 (순수 함수).
//
// 자동 스크롤이 페이지의 끝에서 끝나면, 프로그램은 사진을 저장하고, 사용자가 지정한 영역을 누른다.
// 그 다음에 새 페이지를 기다리고, 자동 스크롤을 다시 시작한다.

// 영역을 누른 후에 페이지가 바뀌는 것을 기다리는 최대 시간
export const TURN_TIMEOUT_MS = 15_000;
// 새 페이지의 내용이 멈추는 것을 기다리는 최대 시간
export const SETTLE_TIMEOUT_MS = 15_000;

export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_TURN_WAIT_S = 2;

// 입력 값을 범위 안의 수로 바꾼다. 수가 아니면 기본값을 사용한다.
export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (value === '' || value === null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// 페이지가 바뀌었는지 판단한다.
//   docId: 페이지 스크립트의 번호. 새 문서를 불러오면 바뀐다
//   url:   주소. 주소만 바꾸는 사이트(SPA)에서 바뀐다
//   hash:  내용의 요약. 주소가 같고 내용만 바뀌는 사이트에서 바뀐다
export function pageChanged(before, after) {
  if (!before || !after) return false;
  return before.docId !== after.docId || before.url !== after.url || before.hash !== after.hash;
}

// 이미 캡처한 주소로 다시 이동했는지 판단한다 ("이전" 버튼을 누른 경우 등).
// 주소가 바뀌지 않는 사이트에서는 판단할 수 없다. 그 경우에는 최대 페이지 수가 반복을 끝낸다.
export function isRevisit(visited, before, after) {
  return after.url !== before.url && visited.has(after.url);
}

// 지정한 영역을 사용자에게 보여주는 글
export function describeTarget(target) {
  if (!target) return '';
  if (target.mode === 'point') {
    return `화면의 위치 (왼쪽에서 ${Math.round(target.fx * 100)}%, 위에서 ${Math.round(target.fy * 100)}%)`;
  }
  const name = target.text || target.label;
  return name ? `"${name}"` : `<${target.tag}> 요소`;
}
