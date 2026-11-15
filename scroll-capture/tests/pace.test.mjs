// 자동 스크롤 속도 계산의 단위 시험.  실행: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMove, SPEED_DELAY_MS } from '../pace.js';

test('일정한 속도: 화면 한 개보다 조금 작은 거리를 한 번에 이동한다', () => {
  assert.deepEqual(nextMove('fast', 700), { dy: 692, duration: 0, pause: SPEED_DELAY_MS.fast });
  assert.deepEqual(nextMove('slow', 700), { dy: 692, duration: 0, pause: SPEED_DELAY_MS.slow });
  assert.equal(nextMove('unknown', 700).pause, SPEED_DELAY_MS.normal);
});

test('불규칙한 속도: 거리, 이동 시간, 멈춤 시간이 매번 다르다', () => {
  const moves = Array.from({ length: 200 }, () => nextMove('random', 700));
  for (const key of ['dy', 'duration', 'pause']) {
    assert.ok(new Set(moves.map((m) => m[key])).size > 50, `${key} 값의 종류가 적다`);
  }
});

test('불규칙한 속도: 이동 거리는 화면 한 개보다 항상 작다 (누락 영역이 없다)', () => {
  for (const r of [0, 0.5, 0.999999]) {
    for (const h of [200, 613, 1200]) {
      const m = nextMove('random', h, () => r);
      assert.ok(m.dy >= 40 && m.dy < h, `dy ${m.dy}, 화면 ${h}`);
      assert.ok(m.duration >= 250 && m.duration <= 900);
      assert.ok(m.pause >= 600 && m.pause <= 5500);
    }
  }
});

test('불규칙한 속도: 가끔 길게 멈춘다', () => {
  const short = nextMove('random', 700, () => 0.5);
  const seq = [0.5, 0.5, 0.5, 0.01, 0.5];
  let i = 0;
  const long = nextMove('random', 700, () => seq[i++]);
  assert.equal(short.pause, 1300);
  assert.equal(long.pause, 1300 + 2500);
});
