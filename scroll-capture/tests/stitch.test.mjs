// 이어 붙이기 계획의 단위 시험.  실행: node --test tests/stitch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { planStitch, segmentsInChunk, chunkLimit } from '../stitch.js';

const shot = (y, extra = {}) => ({
  y,
  rect: { x: 0, y: 0, w: 985, h: 700 },
  vw: 1000,
  vh: 700,
  width: 1000,
  height: 700,
  ...extra,
});

test('겹친 부분을 자른다', () => {
  const plan = planStitch([shot(0), shot(400), shot(1000)]);
  assert.equal(plan.width, 985);
  assert.equal(plan.height, 1700);
  assert.equal(plan.gaps, 0);
  assert.deepEqual(
    plan.segments.map((s) => [s.index, s.srcY, s.srcH, s.dstY]),
    [[0, 0, 700, 0], [1, 300, 400, 700], [2, 100, 600, 1100]],
  );
});

test('캡처 순서와 관계없이 위치 순서로 정렬한다', () => {
  const plan = planStitch([shot(1000), shot(0), shot(400)]);
  assert.deepEqual(plan.segments.map((s) => s.index), [1, 2, 0]);
  assert.equal(plan.height, 1700);
});

test('새 내용이 없는 사진은 사용하지 않는다', () => {
  const plan = planStitch([shot(0), shot(0.4), shot(700)]);
  assert.deepEqual(plan.segments.map((s) => s.index), [0, 2]);
});

test('캡처하지 않은 영역을 센다', () => {
  const plan = planStitch([shot(0), shot(900)]);
  assert.equal(plan.gaps, 1);
  assert.equal(plan.height, 1400);
});

test('화면 배율을 계산에 넣는다', () => {
  const hi = { width: 2000, height: 1400 };
  const plan = planStitch([shot(0, hi), shot(650.5, hi)]);
  assert.equal(plan.width, 1970);
  assert.equal(plan.height, 1400 + 1301);
  assert.equal(plan.segments[1].srcY, 1400 - 1301);
});

test('화면 배율이 정수가 아니면 dpr 값을 사용한다', () => {
  // 창 1000x613 (사진 픽셀), 배율 1.5: 화면의 크기는 667x409로 반올림된다.
  const odd = { vw: 667, vh: 409, dpr: 1.5, width: 1000, height: 613, rect: { x: 0, y: 0, w: 667, h: 409 } };
  const plan = planStitch([shot(0, odd), shot(400, odd), shot(800, odd)]);
  assert.equal(plan.height, 1200 + 613);
  assert.deepEqual(plan.segments.map((s) => s.srcY), [0, 13, 13]);
});

test('dpr 값이 사진의 크기와 맞지 않으면 사진의 크기로 계산한다', () => {
  const zoomed = { dpr: 1, width: 2000, height: 1400 };
  const plan = planStitch([shot(0, zoomed), shot(700, zoomed)]);
  assert.equal(plan.height, 2800);
});

test('안쪽 스크롤 영역만 사용한다', () => {
  const inner = { rect: { x: 200, y: 50, w: 600, h: 650 } };
  const plan = planStitch([shot(0, inner), shot(600, inner)]);
  assert.equal(plan.width, 600);
  assert.equal(plan.height, 1250);
  assert.deepEqual(
    plan.segments.map((s) => [s.srcX, s.srcY, s.srcH]),
    [[200, 50, 650], [200, 100, 600]],
  );
});

test('긴 사진을 여러 장으로 나눈다', () => {
  const plan = planStitch([shot(0), shot(700), shot(1400)], 1000);
  assert.deepEqual(plan.chunks, [{ top: 0, height: 1000 }, { top: 1000, height: 1000 }, { top: 2000, height: 100 }]);
  const second = segmentsInChunk(plan, plan.chunks[1]);
  assert.deepEqual(
    second.map((s) => [s.index, s.srcY, s.srcH, s.dstY]),
    [[1, 300, 400, 0], [2, 0, 600, 400]],
  );
});

test('사진 한 장의 최대 높이는 캔버스 제한보다 작다', () => {
  assert.equal(chunkLimit(1000), 30000);
  assert.ok(chunkLimit(20000) * 20000 <= 250_000_000);
});

test('사진이 없으면 빈 계획을 돌려준다', () => {
  assert.deepEqual(planStitch([]), { width: 0, height: 0, segments: [], gaps: 0, chunks: [] });
});
