// 사진을 이어 붙이는 계획을 계산한다.
// 이 파일은 브라우저 API를 사용하지 않는다. 그래서 Node에서 시험할 수 있다.

// Chrome은 캔버스의 한 변과 면적을 제한한다. 이 값은 그 제한보다 작다.
export const MAX_CANVAS_SIDE = 30000;
export const MAX_CANVAS_AREA = 250_000_000;

// 사진 한 장의 최대 높이(픽셀)를 계산한다.
export function chunkLimit(width) {
  const byArea = Math.floor(MAX_CANVAS_AREA / Math.max(1, width));
  return Math.max(1, Math.min(MAX_CANVAS_SIDE, byArea));
}

// CSS 픽셀 한 개에 해당하는 사진 픽셀의 수를 계산한다.
// 화면의 크기(vw, vh)는 정수로 반올림한 값이다. 그래서 "사진 크기 / 화면 크기"는
// 화면 배율이 정수가 아닐 때 정확하지 않다. 화면 배율(dpr)이 사진의 크기와 맞으면
// 그 값을 사용한다.
export function captureScale(c) {
  if (c.dpr > 0 && Math.abs(c.width - c.vw * c.dpr) <= c.dpr && Math.abs(c.height - c.vh * c.dpr) <= c.dpr) {
    return { sx: c.dpr, sy: c.dpr };
  }
  return { sx: c.width / c.vw, sy: c.height / c.vh };
}

// captures: [{ y, rect: {x, y, w, h}, vw, vh, dpr, width, height }]
//   y      스크롤 위치 (CSS 픽셀)
//   rect   화면 안에서 스크롤 영역의 위치와 크기 (CSS 픽셀)
//   vw, vh 화면의 크기 (CSS 픽셀)
//   dpr    화면 배율 (없어도 된다)
//   width, height 캡처한 사진의 크기 (사진 픽셀)
//
// 결과:
//   width, height  이어 붙인 사진의 크기 (사진 픽셀)
//   segments       [{ index, srcX, srcY, srcW, srcH, dstY }] 각 사진에서 사용하는 부분
//   gaps           캡처하지 않은 영역의 수
//   chunks         [{ top, height }] 사진이 너무 길 때 나누는 구간
export function planStitch(captures, maxChunk = MAX_CANVAS_SIDE) {
  const items = captures
    .map((c, index) => {
      const { sx, sy } = captureScale(c);
      const srcX = Math.round(c.rect.x * sx);
      const srcY = Math.round(c.rect.y * sy);
      return {
        index,
        top: Math.round(c.y * sy),
        srcX,
        srcY,
        srcW: Math.min(c.width - srcX, Math.round(c.rect.w * sx)),
        srcH: Math.min(c.height - srcY, Math.round(c.rect.h * sy)),
      };
    })
    .filter((i) => i.srcW > 0 && i.srcH > 0)
    .sort((a, b) => a.top - b.top || a.index - b.index);

  const segments = [];
  let covered = null; // 이미 사용한 영역의 아래쪽 끝 (페이지 위치, 사진 픽셀)
  let outY = 0;
  let gaps = 0;
  let width = Infinity;

  for (const item of items) {
    const bottom = item.top + item.srcH;
    if (covered !== null && bottom <= covered) continue; // 새 내용이 없다
    let cropTop = 0;
    if (covered !== null) {
      if (item.top > covered) gaps += 1;
      else cropTop = covered - item.top; // 앞의 사진과 겹친 부분을 자른다
    }
    const srcH = item.srcH - cropTop;
    segments.push({
      index: item.index,
      srcX: item.srcX,
      srcY: item.srcY + cropTop,
      srcW: item.srcW,
      srcH,
      dstY: outY,
    });
    outY += srcH;
    covered = bottom;
    width = Math.min(width, item.srcW);
  }

  if (!segments.length) return { width: 0, height: 0, segments, gaps: 0, chunks: [] };

  const chunks = [];
  const limit = Math.max(1, Math.floor(maxChunk));
  for (let top = 0; top < outY; top += limit) {
    chunks.push({ top, height: Math.min(limit, outY - top) });
  }
  return { width, height: outY, segments, gaps, chunks };
}

// 구간 한 개에 들어가는 부분만 계산한다.
export function segmentsInChunk(plan, chunk) {
  const out = [];
  const chunkBottom = chunk.top + chunk.height;
  for (const s of plan.segments) {
    const top = Math.max(s.dstY, chunk.top);
    const bottom = Math.min(s.dstY + s.srcH, chunkBottom);
    if (bottom <= top) continue;
    out.push({
      index: s.index,
      srcX: s.srcX,
      srcY: s.srcY + (top - s.dstY),
      srcW: plan.width,
      srcH: bottom - top,
      dstY: top - chunk.top,
    });
  }
  return out;
}
