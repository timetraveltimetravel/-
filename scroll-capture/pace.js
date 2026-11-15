// 자동 스크롤의 다음 동작(이동 거리, 이동 시간, 멈춤 시간)을 계산한다.
// 이 파일은 브라우저 API를 사용하지 않는다. 그래서 Node에서 시험할 수 있다.

// 일정한 속도: 스크롤한 후에 기다리는 시간 (밀리초)
export const SPEED_DELAY_MS = { slow: 1500, normal: 900, fast: 600 };

// speed: 'slow' | 'normal' | 'fast' | 'random'
// viewHeight: 스크롤 영역의 높이 (CSS 픽셀)
// random: 0 이상 1 미만의 수를 돌려주는 함수
//
// 결과: { dy, duration, pause }
//   dy       이동 거리 (CSS 픽셀). 화면 한 개보다 항상 작다. 그래서 누락 영역이 없다.
//   duration 이동하는 시간 (밀리초). 0이면 한 번에 이동한다.
//   pause    이동한 후에 멈추는 시간 (밀리초)
export function nextMove(speed, viewHeight, random = Math.random) {
  const full = Math.max(40, Math.floor(viewHeight) - 8);
  if (speed !== 'random') {
    return { dy: full, duration: 0, pause: SPEED_DELAY_MS[speed] ?? SPEED_DELAY_MS.normal };
  }
  // 불규칙한 속도: 사람이 읽으면서 스크롤하는 것과 같이, 거리와 시간이 매번 다르다.
  const between = (lo, hi) => lo + (hi - lo) * random();
  const dy = Math.max(40, Math.round(full * between(0.35, 0.95)));
  const duration = Math.round(between(250, 900));
  let pause = between(600, 2000);
  if (random() < 0.15) pause += between(1500, 3500); // 가끔 길게 멈춘다
  return { dy, duration, pause: Math.round(pause) };
}
