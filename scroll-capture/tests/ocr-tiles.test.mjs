// 텍스트 변환에서 사진을 조각으로 나누는 위치의 단위 시험.  실행: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlankRow, nextCut } from '../ocr-tiles.js';

// 줄 번호의 목록에 "글자"(검은 픽셀)가 있는 사진을 만든다.
function image(width, height, inkRows) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const row of inkRows) {
    const i = (row * width + Math.floor(width / 2)) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return data;
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

test('모든 픽셀이 같은 색인 줄은 글자가 없는 줄이다', () => {
  const data = image(20, 4, [2]);
  assert.equal(isBlankRow(data, 20, 1), true);
  assert.equal(isBlankRow(data, 20, 2), false);
});

test('작은 색 차이(압축 잡음)는 글자로 보지 않는다', () => {
  const data = image(20, 2, []);
  data[4 * 5] = 251;
  assert.equal(isBlankRow(data, 20, 0), true);
});

test('목표 위치가 글자 줄 안에 있으면 가장 가까운 빈 줄에서 나눈다', () => {
  // 글자: 0~39, 50~99. 빈 줄: 40~49.
  const data = image(10, 100, [...range(0, 39), ...range(50, 99)]);
  const cut = nextCut(data, 10, 100, 60);
  assert.ok(cut >= 41 && cut <= 48, `나누는 줄 ${cut}`);
});

test('목표 위치가 빈 줄이면 그 위치에서 나눈다', () => {
  const data = image(10, 100, [...range(0, 20), ...range(80, 99)]);
  assert.equal(nextCut(data, 10, 100, 50), 50);
});

test('빈 줄이 없으면 목표 위치에서 나눈다', () => {
  const data = image(10, 100, range(0, 99));
  assert.equal(nextCut(data, 10, 100, 50), 50);
});
