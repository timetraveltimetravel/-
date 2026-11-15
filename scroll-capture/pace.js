// 자동 스크롤의 다음 동작을 계산한다.
// 이 파일은 브라우저 API를 사용하지 않는다. 그래서 Node에서 시험할 수 있다.

// 일정한 속도: 스크롤한 후에 기다리는 시간 (밀리초)
export const SPEED_DELAY_MS = { slow: 1500, normal: 900, fast: 600 };

const FRAME_MS = 16;

// 화면 한 개에서 한 번에 이동할 수 있는 최대 거리 (CSS 픽셀).
// 이 거리보다 많이 이동하면 캡처하지 않은 영역이 생긴다.
export function fullStep(viewHeight) {
  return Math.max(40, Math.floor(viewHeight) - 8);
}

// 속도의 목록(프레임마다 한 개)을 이동 경로로 바꾼다.
// 결과: [[시간(ms), 이동한 거리(px)], ...]. 첫 값은 [0, 0], 마지막 값은 [전체 시간, dy].
function toPath(speeds, dy) {
  let total = 0;
  for (const v of speeds) total += v;
  if (total <= 0) return [[0, 0], [FRAME_MS, dy]];
  const path = [[0, 0]];
  let sum = 0;
  for (let i = 0; i < speeds.length; i += 1) {
    sum += speeds[i];
    path.push([(i + 1) * FRAME_MS, Math.round(((dy * sum) / total) * 100) / 100]);
  }
  path[path.length - 1][1] = dy;
  return path;
}

// 끌기: 화면을 누른 채로 천천히 이동한다. 속도는 거의 일정하고, 조금 흔들린다.
// 가끔 손가락이 잠시 멈춘다.
function dragSpeeds(distance, between, random) {
  const speed = between(140, 420); // 1초에 이동하는 픽셀
  const duration = Math.min(4000, Math.max(350, (distance / speed) * 1000));
  const frames = Math.max(4, Math.round(duration / FRAME_MS));
  const rampIn = between(120, 220);
  const rampOut = between(150, 300);
  const period = between(500, 1100);
  const phase = between(0, Math.PI * 2);
  const hesitates = random() < 0.22 && duration > 900;
  const holdAt = between(0.3, 0.7) * duration;
  const holdFor = between(120, 350);
  const speeds = [];
  for (let i = 0; i < frames; i += 1) {
    const t = (i + 0.5) * FRAME_MS;
    let v = 1 + 0.18 * Math.sin((t / period) * Math.PI * 2 + phase);
    v *= Math.min(1, t / rampIn, (duration - t) / rampOut);
    if (hesitates) {
      const d = Math.abs(t - holdAt) / (holdFor / 2);
      if (d < 1) v *= 0.05 + 0.95 * d * d; // 잠시 멈춘다
    }
    speeds.push(Math.max(0, v));
  }
  return speeds;
}

// 튕기기: 빠르게 시작하고, 천천히 멈춘다.
function flickSpeeds(distance, between) {
  const duration = between(520, 1100);
  const frames = Math.max(4, Math.round(duration / FRAME_MS));
  const rise = between(50, 90);
  const decay = between(3.5, 5.5);
  const speeds = [];
  for (let i = 0; i < frames; i += 1) {
    const t = (i + 0.5) * FRAME_MS;
    speeds.push(t < rise ? t / rise : Math.exp((-decay * (t - rise)) / (duration - rise)));
  }
  return speeds;
}

// 휠 돌리기: 짧은 이동을 여러 번 한다. 이동 사이에 짧게 멈춘다.
function wheelSpeeds(distance, between, random) {
  const notches = Math.max(1, Math.round(distance / between(85, 115)));
  const speeds = [];
  for (let n = 0; n < notches; n += 1) {
    const frames = Math.max(3, Math.round(between(110, 170) / FRAME_MS));
    for (let i = 0; i < frames; i += 1) speeds.push(1 - i / frames); // 빠르게 시작하고 멈춘다
    if (n < notches - 1) {
      const gap = random() < 0.15 ? between(250, 500) : between(30, 140);
      for (let i = 0; i < Math.round(gap / FRAME_MS); i += 1) speeds.push(0);
    }
  }
  return speeds;
}

const BUILDERS = { drag: dragSpeeds, flick: flickSpeeds, wheel: wheelSpeeds };

// 이동 경로를 만든다. kind: 'drag' | 'flick' | 'wheel', dy: 이동 거리 (음수이면 위로 이동한다)
export function buildPath(kind, dy, random = Math.random) {
  const between = (lo, hi) => lo + (hi - lo) * random();
  return toPath(BUILDERS[kind](Math.abs(dy), between, random), dy);
}

// 자동 스크롤의 동작을 차례로 계산하는 객체를 만든다.
// speed: 'slow' | 'normal' | 'fast' | 'random'
// random: 0 이상 1 미만의 수를 돌려주는 함수
//
// next({ viewHeight, room, canGoUp }) → { kind, dy, path, pause }
//   viewHeight 스크롤 영역의 높이 (CSS 픽셀)
//   room       캡처하지 않은 영역이 생기지 않는 최대 이동 거리 (CSS 픽셀)
//   canGoUp    위로 이동할 수 있으면 true
//   kind       'jump' | 'drag' | 'flick' | 'wheel'
//   dy         이동 거리. 음수이면 위로 이동한다
//   path       이동 경로. null이면 한 번에 이동한다
//   pause      이동한 후에 멈추는 시간 (밀리초)
export function createPacer(speed, random = Math.random) {
  const between = (lo, hi) => lo + (hi - lo) * random();
  const pick = (weights) => {
    let r = random();
    for (const [name, weight] of weights) {
      r -= weight;
      if (r < 0) return name;
    }
    return weights[weights.length - 1][0];
  };
  let steps = 0;
  let lastKind = null;
  let lastWasUp = false;

  function next({ viewHeight, room, canGoUp = false }) {
    const full = fullStep(viewHeight);
    const limit = Math.max(0, Math.floor(room));
    if (speed !== 'random') {
      return { kind: 'jump', dy: Math.min(full, limit), path: null, pause: SPEED_DELAY_MS[speed] ?? SPEED_DELAY_MS.normal };
    }
    steps += 1;

    // 가끔 위로 돌아간다. 사람은 앞의 내용을 다시 본다.
    if (canGoUp && !lastWasUp && steps > 2 && random() < 0.16) {
      lastWasUp = true;
      const kind = pick([['drag', 0.5], ['wheel', 0.3], ['flick', 0.2]]);
      const dy = -Math.round(viewHeight * between(0.08, 0.38));
      return { kind, dy, path: buildPath(kind, dy, random), pause: Math.round(between(250, 900)) };
    }
    lastWasUp = false;

    // 사람은 같은 동작을 몇 번 반복한다.
    const kind = lastKind && random() < 0.5 ? lastKind : pick([['drag', 0.5], ['flick', 0.25], ['wheel', 0.25]]);
    lastKind = kind;
    let distance;
    if (kind === 'drag') distance = viewHeight * between(0.25, 0.85);
    else if (kind === 'flick') distance = viewHeight * between(0.45, 0.95);
    else distance = Math.round(between(2, 5.99)) * between(85, 115);
    const dy = Math.min(limit, Math.max(40, Math.round(distance)));

    let pause;
    if (kind === 'drag' && random() < 0.45) pause = between(30, 150); // 손을 떼지 않고 계속 끈다
    else if (kind === 'drag') pause = between(400, 1800);
    else if (kind === 'flick') pause = between(300, 1500);
    else pause = between(250, 1200);
    if (random() < 0.1) pause += between(1500, 3500); // 가끔 길게 멈추고 읽는다

    return { kind, dy, path: dy > 0 ? buildPath(kind, dy, random) : null, pause: Math.round(pause) };
  }

  return { speed, next };
}
