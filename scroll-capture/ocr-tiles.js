// 긴 사진을 조각으로 나누는 위치를 계산한다.
// 이 파일은 브라우저 API를 사용하지 않는다. 그래서 Node에서 시험할 수 있다.

// 줄 한 개의 모든 픽셀이 같은 색이면 그 줄에는 글자가 없다.
// data: RGBA 픽셀 (Uint8ClampedArray), width: 사진의 너비, row: 줄 번호
export function isBlankRow(data, width, row, tolerance = 6) {
  const start = row * width * 4;
  const r = data[start];
  const g = data[start + 1];
  const b = data[start + 2];
  for (let x = 1; x < width; x += 1) {
    const i = start + x * 4;
    if (Math.abs(data[i] - r) > tolerance || Math.abs(data[i + 1] - g) > tolerance || Math.abs(data[i + 2] - b) > tolerance) {
      return false;
    }
  }
  return true;
}

// 사진의 띠(height 줄) 안에서 조각을 나누는 줄 번호를 찾는다.
// target에 가장 가까운, 글자가 없는 줄의 묶음을 찾고, 그 묶음의 가운데를 돌려준다.
// 글자가 없는 줄이 없으면 target을 돌려준다 (글자 줄을 자를 수 있다).
export function nextCut(data, width, height, target) {
  let best = -1;
  let bestDistance = Infinity;
  let row = 0;
  while (row < height) {
    if (!isBlankRow(data, width, row)) {
      row += 1;
      continue;
    }
    let end = row;
    while (end + 1 < height && isBlankRow(data, width, end + 1)) end += 1;
    // 묶음 [row, end] 안에서 target에 가장 가까운 줄. 묶음의 끝에서 1줄 안쪽을 사용한다.
    const lo = Math.min(row + 1, end);
    const hi = Math.max(end - 1, row);
    const candidate = Math.min(Math.max(target, lo), hi);
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
    row = end + 1;
  }
  return best === -1 ? target : best;
}
