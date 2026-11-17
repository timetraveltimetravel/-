// 자동 업데이트의 판단 (순수 함수).
//
// 예약 작업(auto-update/pull.ps1)이 git으로 새 파일을 폴더에 받는다.
// 확장 프로그램은 폴더의 manifest.json을 읽고, 버전이 실행 중인 버전과 다르면 스스로 다시 로드한다.
// 확장 프로그램은 외부로 요청을 보내지 않는다.

// 폴더의 버전을 확인하는 간격 (분)
export const CHECK_PERIOD_MINUTES = 5;
// 버전이 다르면 이 시간을 기다리고 다시 읽는다. git이 파일을 쓰는 중에는 다시 로드하지 않는다.
export const SETTLE_MS = 3000;

// Chrome의 버전 형식: 점으로 구분한 숫자 1~4개
export function isVersion(value) {
  return typeof value === 'string' && /^\d+(\.\d+){0,3}$/.test(value);
}

// 폴더의 manifest.json에서 버전을 읽는다. 읽지 못하면 null.
export async function readDiskVersion(url, fetchFn = fetch) {
  try {
    const response = await fetchFn(url, { cache: 'no-store' });
    const manifest = await response.json();
    return isVersion(manifest.version) ? manifest.version : null;
  } catch {
    return null; // 파일을 쓰는 중이거나, 내용이 잘못되었다
  }
}

// 할 일을 결정한다.
//   loaded: 실행 중인 버전
//   first, second: 폴더의 버전을 두 번 읽은 값 (second는 SETTLE_MS 후의 값)
//   panelOpen: 측면 패널이 열려 있다 (캡처한 사진이 메모리에 있을 수 있다)
// 결과:
//   'none'   폴더의 버전이 실행 중인 버전과 같다. 또는 읽지 못했다
//   'wait'   파일이 바뀌는 중이다. 다음 확인에서 다시 판단한다
//   'notify' 측면 패널이 열려 있다. 다시 로드하지 않고, 패널에 알린다
//   'reload' 다시 로드한다
// 버전이 낮아진 때에도 다시 로드한다 (이전 버전으로 되돌린 경우).
export function decide({ loaded, first, second, panelOpen }) {
  if (!isVersion(first) || first === loaded) return 'none';
  if (second !== first) return 'wait';
  return panelOpen ? 'notify' : 'reload';
}
