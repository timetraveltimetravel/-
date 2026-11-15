// 자동 스크롤 동작 계산의 단위 시험.  실행: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacer, buildPath, fullStep, SPEED_DELAY_MS } from '../pace.js';

// 같은 값을 반복해서 만드는 난수 함수
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 화면 높이 700의 페이지에서 동작을 n번 계산한다. 캡처 위치(frontier)를 실제와 같이 추적한다.
function simulate(seed, n, viewHeight = 700) {
  const pacer = createPacer('random', seeded(seed));
  const full = fullStep(viewHeight);
  let y = 0;
  let frontier = 0;
  const moves = [];
  for (let i = 0; i < n; i += 1) {
    const room = frontier + full - y;
    const move = pacer.next({ viewHeight, room, canGoUp: y > 40 });
    moves.push({ ...move, room, from: y });
    y = Math.max(0, y + move.dy);
    if (y > frontier) frontier = y; // 새 내용이 있으면 캡처한다
  }
  return moves;
}

test('일정한 속도: 화면 한 개보다 조금 작은 거리를 한 번에 이동한다', () => {
  const fast = createPacer('fast').next({ viewHeight: 700, room: 692 });
  assert.deepEqual(fast, { kind: 'jump', dy: 692, path: null, pause: SPEED_DELAY_MS.fast });
  assert.equal(createPacer('slow').next({ viewHeight: 700, room: 692 }).pause, SPEED_DELAY_MS.slow);
  assert.equal(createPacer('unknown').next({ viewHeight: 700, room: 692 }).pause, SPEED_DELAY_MS.normal);
  assert.equal(createPacer('fast').next({ viewHeight: 700, room: 100 }).dy, 100);
});

test('자연스러운 속도: 누락 영역이 생기는 거리를 이동하지 않는다', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const m of simulate(seed, 300)) {
      if (m.dy > 0) assert.ok(m.dy <= m.room, `dy ${m.dy}, room ${m.room}`);
    }
  }
});

test('자연스러운 속도: 끌기, 튕기기, 휠 돌리기를 모두 사용한다', () => {
  const kinds = new Set(simulate(7, 200).map((m) => m.kind));
  assert.deepEqual([...kinds].sort(), ['drag', 'flick', 'wheel']);
});

test('자연스러운 속도: 가끔 위로 이동한다. 두 번 계속 위로 이동하지 않는다', () => {
  const moves = simulate(11, 400);
  const ups = moves.filter((m) => m.dy < 0);
  assert.ok(ups.length > 20 && ups.length < 120, `위로 이동 ${ups.length}번`);
  for (let i = 1; i < moves.length; i += 1) {
    assert.ok(!(moves[i].dy < 0 && moves[i - 1].dy < 0), `${i}번째 동작`);
  }
  assert.ok(moves.slice(0, 2).every((m) => m.dy > 0), '처음 두 동작은 아래로 이동한다');
  for (const m of ups) assert.ok(-m.dy >= 700 * 0.08 - 1 && -m.dy <= 700 * 0.38 + 1, `위로 ${-m.dy}px`);
});

test('자연스러운 속도: 위로 이동할 수 없으면 위로 이동하지 않는다', () => {
  const pacer = createPacer('random', seeded(3));
  for (let i = 0; i < 200; i += 1) {
    assert.ok(pacer.next({ viewHeight: 700, room: 692, canGoUp: false }).dy > 0);
  }
});

test('자연스러운 속도: 이동 거리와 멈춤 시간이 매번 다르다', () => {
  const moves = simulate(5, 200).filter((m) => m.dy > 0);
  assert.ok(new Set(moves.map((m) => m.dy)).size > 60);
  assert.ok(new Set(moves.map((m) => m.pause)).size > 60);
  assert.ok(moves.some((m) => m.pause < 200), '손을 떼지 않고 계속 끄는 동작이 없다');
  assert.ok(moves.some((m) => m.pause > 2500), '길게 멈추는 동작이 없다');
});

test('이동 경로: 0에서 시작하고, dy에서 끝나고, 시간이 증가한다', () => {
  for (const kind of ['drag', 'flick', 'wheel']) {
    for (const dy of [-200, 60, 480]) {
      const path = buildPath(kind, dy, seeded(dy + kind.length));
      assert.deepEqual(path[0], [0, 0]);
      assert.equal(path.at(-1)[1], dy);
      for (let i = 1; i < path.length; i += 1) {
        assert.ok(path[i][0] > path[i - 1][0], '시간이 증가하지 않는다');
        // 한 동작 안에서는 방향이 바뀌지 않는다.
        assert.ok((path[i][1] - path[i - 1][1]) * Math.sign(dy) >= -0.011, `${kind} ${dy}`);
      }
    }
  }
});

test('끌기: 천천히 이동한다 (1초에 600 픽셀보다 느리다)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const path = buildPath('drag', 500, seeded(seed));
    for (let i = 4; i < path.length; i += 1) {
      const speed = ((path[i][1] - path[i - 4][1]) / (path[i][0] - path[i - 4][0])) * 1000;
      assert.ok(speed < 600, `속도 ${Math.round(speed)}px/s`);
    }
    assert.ok(path.at(-1)[0] >= 1000, `시간 ${path.at(-1)[0]}ms`);
  }
});

test('튕기기: 빠르게 시작하고 천천히 멈춘다', () => {
  for (const seed of [1, 2, 3]) {
    const path = buildPath('flick', 500, seeded(seed));
    const half = path.find(([t]) => t >= path.at(-1)[0] / 2);
    assert.ok(half[1] > 500 * 0.7, `시간의 반에서 ${half[1]}px`);
  }
});

test('휠 돌리기: 이동 사이에 멈춘다', () => {
  const path = buildPath('wheel', 400, seeded(9));
  let still = 0;
  for (let i = 1; i < path.length - 1; i += 1) if (path[i][1] === path[i - 1][1]) still += 1;
  assert.ok(still >= 3, `멈춘 프레임 ${still}개`);
});

test('같은 난수는 같은 동작을 만든다', () => {
  assert.deepEqual(simulate(42, 30), simulate(42, 30));
});
