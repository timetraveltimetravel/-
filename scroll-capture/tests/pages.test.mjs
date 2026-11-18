// 여러 페이지 캡처의 판단의 단위 시험.  실행: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampNumber, pageChanged, isRevisit, describeTarget, TURN_TIMEOUT_MS, SETTLE_TIMEOUT_MS } from '../pages.js';

test('clampNumber: 범위 안의 수로 바꾼다. 수가 아니면 기본값을 사용한다', () => {
  assert.equal(clampNumber('5', 1, 500, 10), 5);
  assert.equal(clampNumber('0', 1, 500, 10), 1);
  assert.equal(clampNumber('9999', 1, 500, 10), 500);
  assert.equal(clampNumber('', 1, 500, 10), 10);
  assert.equal(clampNumber('abc', 1, 500, 10), 10);
  assert.equal(clampNumber(null, 1, 500, 10), 10);
  assert.equal(clampNumber('0', 0, 60, 2), 0); // 기다리는 시간 0초는 올바른 값이다
  assert.equal(clampNumber('1.5', 0, 60, 2), 1.5);
});

test('pageChanged: 문서, 주소, 내용 중에서 하나가 바뀌면 페이지가 바뀌었다', () => {
  const before = { docId: 'a', url: 'https://x/1', hash: '10:1' };
  assert.equal(pageChanged(before, { ...before }), false);
  assert.equal(pageChanged(before, { ...before, docId: 'b' }), true); // 새 문서 (같은 주소를 다시 불러온 경우)
  assert.equal(pageChanged(before, { ...before, url: 'https://x/2' }), true); // 주소만 바꾸는 사이트
  assert.equal(pageChanged(before, { ...before, hash: '12:9' }), true); // 내용만 바꾸는 사이트
  assert.equal(pageChanged(before, null), false); // 페이지를 불러오는 중이다
  assert.equal(pageChanged(null, before), false);
});

test('isRevisit: 이미 캡처한 주소로 이동한 것을 찾는다', () => {
  const visited = new Set(['https://x/1', 'https://x/2']);
  const at = (url) => ({ url });
  assert.equal(isRevisit(visited, at('https://x/2'), at('https://x/1')), true); // "이전" 버튼을 눌렀다
  assert.equal(isRevisit(visited, at('https://x/2'), at('https://x/3')), false);
  // 주소가 바뀌지 않는 사이트: 지금의 주소는 항상 캡처한 주소이다. 이것은 다시 방문한 것이 아니다.
  assert.equal(isRevisit(visited, at('https://x/2'), at('https://x/2')), false);
});

test('describeTarget: 지정한 영역을 글로 보여준다', () => {
  assert.equal(describeTarget(null), '');
  assert.equal(describeTarget({ mode: 'element', tag: 'a', text: '다음 화', label: '' }), '"다음 화"');
  assert.equal(describeTarget({ mode: 'element', tag: 'button', text: '', label: '다음 페이지' }), '"다음 페이지"');
  assert.equal(describeTarget({ mode: 'element', tag: 'button', text: '', label: '' }), '<button> 요소');
  assert.equal(describeTarget({ mode: 'point', fx: 0.904, fy: 0.5 }), '화면의 위치 (왼쪽에서 90%, 위에서 50%)');
});

test('상수: 기다리는 시간', () => {
  assert.ok(TURN_TIMEOUT_MS >= 5000 && TURN_TIMEOUT_MS <= 60_000);
  assert.ok(SETTLE_TIMEOUT_MS >= 5000 && SETTLE_TIMEOUT_MS <= 60_000);
});
