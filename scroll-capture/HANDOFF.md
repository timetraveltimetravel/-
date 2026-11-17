# 스크롤 캡처: 작업 인계 문서

이 문서는 다른 세션이 이 작업을 계속하기 위한 기록입니다.
이 문서는 대화의 원문이 아닙니다. 대화에서 한 요청, 결정, 작업, 측정 값을 정리한 것입니다.

- 작성일: 2026-11-16 (2026-11-17에 0.4.0의 내용을 추가)
- 현재 버전: 0.4.0
- 브랜치: `claude/wizardly-cannon-esdvrm`
- 사용 설명서: 같은 폴더의 `README.md`

## 1. 요약

"스크롤 캡처"는 Chrome 확장 프로그램입니다. 사용자가 웹 페이지를 스크롤할 때 화면을 캡처하고,
겹친 부분을 자르고, 긴 사진 한 장으로 이어 붙입니다. 사진 안의 글자를 텍스트로 변환할 수도 있습니다.

0.4.0은 자동 업데이트를 추가한 버전입니다. 사용자의 PC에 설치했고, 예약 작업을 등록했습니다.
0.4.0은 커밋하고 브랜치에 푸시했습니다. 실제 웹사이트에서는 아직 시험하지 않았습니다.

## 2. 요청의 기록 (시간 순서)

| 순서 | 사용자의 요청 | 수행한 작업 |
| --- | --- | --- |
| 1 | 웹에서 스크롤하면 내용을 텍스트로 변환하는 프로그램. 먼저 기획서를 작성 | 기획서를 작성했다 (텍스트를 페이지 구조에서 직접 읽는 방식) |
| 2 | 텍스트 방식이 아니고, 화면을 캡처해서 사진으로 저장하는 방식으로 변경 | 기획서를 캡처 방식으로 다시 작성했다 |
| 3 | 권장안으로 개발 시작 | 0.1.0: Chrome 확장 프로그램 첫 버전 |
| 4 | 사람과 같이 불규칙한 속도로 스크롤하는 항목, 그리고 텍스트 변환 기능 | 0.2.0: "불규칙" 속도, OCR 텍스트 변환 |
| 5 | 자동 스크롤이 뻑뻑하다. 누른 채로 천천히 내리기, 위아래 이동 등 더 자연스럽게 | 0.3.0: 손 동작을 조합하는 "자연스럽게 (사람처럼)" 속도 |
| 6 | 업데이트할 때 기존의 것을 업데이트하는 방법 | 방법 2개를 안내했다: 같은 폴더에 덮어쓰기, 또는 git |
| 7 | 방법 2(git)로 진행. 직접 실행 | 클라우드 세션은 사용자의 PC에 접근할 수 없다. 사용자의 PC에서 동작하는 세션이 필요하다 |
| 8 | 다른 세션이 계속할 수 있게 기록을 파일로 작성 | 이 문서 |
| 9 | 이 문서를 보고 자동 업데이트 기능을 추가 | 0.4.0: 사용자의 PC에 git으로 복제했다. 예약 작업의 스크립트와 확장 프로그램의 다시 로드 기능을 만들었다 |
| 10 | Chrome이 "매니페스트 파일이 없거나 읽을 수 없습니다"를 보고 | 사용자가 저장소의 최상위 폴더를 선택했다. `scroll-capture` 폴더를 선택하는 단계를 안내했고, 사용자가 로드했다 |
| 11 | 자동 업데이트 설정 | 예약 작업 `ScrollCapture-AutoUpdate`를 등록했다. 한 번 실행했고, 결과는 "변경 없음"이었다 |
| 12 | 0.4.0을 GitHub에 올리기 | 커밋 `6b3affd`를 브랜치에 푸시했다 |

## 3. 지금의 상태 (사용자의 PC)

- 설치 폴더: `C:UserslimitOneDrive바탕 화면scroll-capture-repo` (git 복제. 사용자가 이 위치로 옮겼다).
  Chrome에는 그 안의 `scroll-capture` 폴더를 로드했다.
- 이 폴더는 OneDrive가 동기화하는 폴더이다. OneDrive가 파일을 잠그면 `git pull`이 실패할 수 있다.
  문제가 있으면 `C:Userslimit` 아래로 옮긴다. 옮긴 후에는 `install.ps1`을 다시 실행하고, Chrome에서 다시 로드한다.
- 예약 작업 `ScrollCapture-AutoUpdate`를 등록했다 (60분 간격).
- 0.4.0은 커밋 `6b3affd`이다. 사용자가 승인했고, 브랜치에 푸시했다. 이 PC에는 git의 사용자 이름 설정이 없다.
  그래서 이전 커밋과 같은 작성자를 `git -c user.name=... -c user.email=...`로 지정했다.
- 이 폴더의 파일을 바꾸고 커밋하지 않으면, 원격 브랜치에 같은 파일을 바꾸는 커밋이 생긴 때에 `git pull --ff-only`가 실패한다.

업데이트의 순서:

1. 개발 세션이 변경을 브랜치에 푸시한다. `manifest.json`의 `version`을 올린다.
2. 예약 작업이 60분 안에 `git pull --ff-only`로 새 파일을 받는다.
3. 확장 프로그램이 5분 안에 폴더의 버전을 읽고, 다시 로드한다. 측면 패널이 열려 있으면 알림을 보여준다.

새 PC에 설치하는 순서:

1. `git clone -b claude/wizardly-cannon-esdvrm --single-branch https://github.com/timetraveltimetravel/-.git scroll-capture-repo`
2. 사용자가 `chrome://extensions`에서 `scroll-capture-repo/scroll-capture` 폴더를 로드한다.
   저장소의 최상위 폴더를 선택하면 Chrome이 "매니페스트 파일이 없거나 읽을 수 없습니다"를 보고한다.
3. `powershell -ExecutionPolicy Bypass -File scroll-capture-reposcroll-captureauto-updateinstall.ps1`

## 4. 저장소

- 저장소: `timetraveltimetravel/-` (공개). 이 저장소에는 관계없는 자료(조사 노트, 보고서, book)도 있다.
- 확장 프로그램의 모든 파일은 `scroll-capture/` 폴더에 있다.
- 작업 브랜치: `claude/wizardly-cannon-esdvrm`. 저장소의 기본 브랜치는 다른 브랜치이다.
- 풀 리퀘스트는 만들지 않았다. 사용자가 요청하지 않았다.
- 커밋: `0f403b6` (0.1.0), `9932561` (0.2.0), `4ba8ef7` (0.3.0), `6b3affd` (0.4.0). 이 문서의 커밋은 따로 있다.
- 커밋 메시지의 형식: `feat: 한국어 요약` + 변경 목록.

## 5. 파일 구성

| 파일 | 역할 |
| --- | --- |
| `manifest.json` | Manifest V3. 권한: `activeTab`, `scripting`, `sidePanel`, `downloads`, `alarms`. WebAssembly를 허용하는 CSP |
| `background.js` | 아이콘을 누르면 측면 패널을 연다 (`chrome.sidePanel.open`). 폴더의 버전을 확인하고, 다시 로드한다. ES 모듈이다 |
| `update.js` | 자동 업데이트의 판단 (순수 함수) |
| `auto-update/` | `pull.ps1` (git pull과 기록), `install.ps1`, `uninstall.ps1` (예약 작업의 등록과 제거) |
| `content.js` | 페이지 스크립트. 스크롤 영역을 찾고, 위치를 읽고, 이동 경로를 재생하고, 고정 메뉴를 숨긴다 |
| `sidepanel.html` / `.css` / `.js` | 측면 패널. 캡처, 사진 보관, 저장, 텍스트 변환을 제어한다 |
| `stitch.js` | 이어 붙이기 계획의 계산 (순수 함수) |
| `pace.js` | 자동 스크롤의 동작과 이동 경로의 계산 (순수 함수) |
| `ocr.js` | Tesseract.js로 사진을 텍스트로 변환한다 |
| `ocr-tiles.js` | 긴 사진을 조각으로 나누는 위치의 계산 (순수 함수) |
| `vendor/tesseract/` | Tesseract.js 7.0.0, tesseract.js-core 7.0.0 (simd-lstm), 언어 자료 kor, eng (4.0.0_best_int). 약 8MB |
| `tests/` | 자동 시험 |
| `README.md` | 설치, 사용 방법, 설정, 제한 사항 |

## 6. 구조와 설계

### 6.1 역할의 분리

- 측면 패널이 모든 것을 제어한다. 측면 패널은 열려 있는 동안 계속 동작한다. 서비스 워커는 아이콘 누름만 처리한다.
- 측면 패널은 `chrome.scripting.executeScript`로 `content.js`를 넣고, `chrome.tabs.sendMessage`로 명령을 보낸다.
- 메시지: `sc-init`, `sc-metrics`, `sc-scroll-by`, `sc-scroll-path`, `sc-hide-fixed`, `sc-stop` (패널 → 페이지),
  `sc-scroll-idle` (페이지 → 패널, 수동 스크롤이 멈춘 때).
- 캡처한 사진은 측면 패널의 메모리(Blob)에 있다. 서버와 영구 저장소는 사용하지 않는다.

### 6.2 캡처

- `chrome.tabs.captureVisibleTab`을 사용한다. Chrome은 이것을 1초에 2회로 제한한다
  (`chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`). 캡처 간격은 600ms이다.
- 캡처 전과 후에 스크롤 위치를 읽는다. 위치가 다르면 그 사진을 버린다. 그래서 화면이 멈춘 순간의 사진만 사용한다.
- 같은 위치의 사진은 한 번만 보관한다.
- 캡처는 한 번에 한 개만 수행한다 (Promise 줄).

### 6.3 이어 붙이기 (`stitch.js`)

- 사진을 스크롤 위치의 순서로 정렬한다. 각 사진에서 앞의 사진이 포함하지 않은 아래쪽 부분만 사용한다.
- 화면 배율: `devicePixelRatio`가 사진의 크기와 맞으면 그 값을 사용한다. 맞지 않으면 "사진 크기 / 화면 크기"를 사용한다.
  이유: 화면의 크기는 정수로 반올림된 값이다. 배율 1.5에서 "사진 크기 / 화면 크기"는 이음매에 오차를 만든다.
- 안쪽 스크롤 영역(대화 화면의 구조): 그 영역의 사각형만 잘라서 이어 붙인다.
- 페이지 전체가 스크롤될 때는 스크롤바를 제외한다 (`clientWidth`).
- 사진의 높이가 30,000 픽셀을 넘으면 여러 장으로 나눈다 (캔버스의 크기 제한).
- 캡처 위치 사이에 빈 영역이 있으면 "누락 영역"으로 센다.

### 6.4 고정 메뉴

- 첫 사진 전: 화면 아래쪽에 고정된 요소(쿠키 안내 등)만 숨긴다.
- 첫 사진 다음: `position: fixed`와 `sticky`인 요소를 모두 숨긴다.
- 정지하면 복구한다. 안쪽 스크롤 영역에서는 숨기지 않는다.

### 6.5 자동 스크롤 (`pace.js`, `sidepanel.js`의 `autoScroll`)

- 일정한 속도(느림, 보통, 빠름): 화면 높이 - 8픽셀을 한 번에 이동하고, 정해진 시간을 기다린다.
- "자연스럽게": `createPacer('random')`가 동작을 선택한다.
  - 끌기 (1초에 140~420픽셀, 속도의 흔들림, 22% 확률의 짧은 멈춤)
  - 계속 끌기 (끌기 다음의 멈춤 시간이 30~150ms. 45% 확률)
  - 튕기기 (빠른 시작, 지수 감속)
  - 휠 돌리기 (85~115픽셀의 이동을 2~5번)
  - 위로 돌아가기 (16% 확률, 화면의 8~38%. 두 번 계속하지 않는다. 처음 두 동작에는 없다)
  - 10% 확률로 1.5~3.5초를 더 멈춘다
- `pace.js`가 이동 경로 `[[시간, 거리], ...]`를 만들고, `content.js`가 화면 그리기(`requestAnimationFrame`)에 맞추어 재생한다.
- 누락 영역의 방지: `room = 가장 아래쪽 캡처 위치 + 한 번의 최대 거리 - 현재 위치`. 아래로 이동하는 거리는 `room`보다 작다.
- 현재 위치가 가장 아래쪽 캡처 위치보다 아래에 있을 때만 캡처한다. 위로 이동한 후에는 캡처하지 않는다.
- 페이지의 끝: `scrollY >= maxScrollY - 2`. 그 다음에 2초 동안 새 내용을 기다린다 (무한 스크롤). 새 내용이 없으면 정지한다.
- `state.random`은 난수 함수이다. 시험이 이것을 바꾸어서 같은 동작을 반복한다.

### 6.6 텍스트 변환 (`ocr.js`)

- 이어 붙인 긴 사진을 약 1,400픽셀 높이의 조각으로 나눈다. 나누는 위치는 글자가 없는 줄이다 (모든 픽셀이 같은 색).
- 확대 배율: `1.7 / 화면 배율` (최소 1, 최대 2). 본문 글자가 사진에서 약 24~28픽셀일 때 오류가 가장 적다.
- 엔진의 시작: `workerBlobURL: false`, `cacheMethod: 'none'`, `corePath`에 파일 이름을 직접 지정한다.
- 변환이 끝나면 엔진을 종료한다 (메모리 해제).
- 외부 요청은 없다. 시험이 이것을 확인한다.

### 6.7 저장

- `chrome.downloads.download`와 Blob 주소를 사용한다.
- 파일 이름: `페이지 제목_날짜-시각_번호.png`. 시스템이 그 이름을 거부하면 `scroll-capture_...`를 사용한다.
- TXT 파일의 첫 부분에 제목, 주소, 날짜를 기록한다.

### 6.8 자동 업데이트 (`update.js`, `background.js`, `auto-update/`)

- 압축해제된 확장 프로그램은 스스로 파일을 받을 수 없다. 그래서 파일을 받는 일은 Windows의 예약 작업이 한다.
- `pull.ps1`: `git pull --ff-only --quiet`. 결과를 `auto-update/update.log`에 기록한다 (마지막 200줄. git은 이 파일을 무시한다).
  git이 로그인 창을 열지 않게 한다 (`GIT_TERMINAL_PROMPT=0`).
- `install.ps1`: 예약 작업을 등록한다. 실행 파일은 `conhost.exe --headless powershell.exe ... -File pull.ps1`이다 (창이 보이지 않는다).
  시작 조건은 "한 번 + 60분마다 반복"이다. 로그온 시작 조건은 관리자 권한이 필요해서 사용하지 않는다.
  인수: `-TaskName`, `-IntervalMinutes` (5~1440).
- 확장 프로그램: `fetch(manifest.json, { cache: 'no-store' })`로 폴더의 버전을 읽는다. Chrome은 압축해제된 확장 프로그램의 파일을 매번 폴더에서 읽는다.
- 판단 (`decide`): 버전이 같으면 `none`. 다르면 3초 후에 다시 읽는다. 두 값이 다르면 `wait` (git이 파일을 쓰는 중).
  측면 패널이 열려 있으면 `notify`, 닫혀 있으면 `reload` (`chrome.runtime.reload()`).
- 버전이 낮아진 때에도 다시 로드한다. 버전이 같은 변경은 다시 로드하지 않는다.
- 확인하는 때: 서비스 워커의 시작, 알람 (`chrome.alarms`, 5분), 측면 패널이 열릴 때 (`sc-update-check`).
- 측면 패널이 열려 있는지: `chrome.runtime.getContexts`에 `BACKGROUND`가 아닌 것이 있다.
- 메시지: `sc-update-check` (패널 → 서비스 워커), `sc-update-available` (서비스 워커 → 패널).
- `self.__scUpdate.check()`는 시험이 사용한다.
- 확장 프로그램은 외부로 요청을 보내지 않는다. 사이트 권한을 추가하지 않았다.

## 7. 시험

```bash
node --test tests/*.test.mjs
```

```bash
node tests/e2e.mjs
```

```bash
xvfb-run -a -s "-screen 0 1400x900x24" node tests/realflow.mjs
```

- 단위 시험 39개: `stitch`, `pace`, `ocr-tiles`, `update`.
- 브라우저 시험 17개: auto, manual, manual-fast, infinite, inner, each, filename, limit, long, scale, natural, natural-inner, ocr, ocr-stop, quota, update, update-apply.
  이름의 일부로 선택할 수 있다 (예: `node tests/e2e.mjs natural ocr`). 전체 실행 시간은 약 5분이다.
- 실제 사용 경로 시험 1개: 아이콘 누름과 같은 동작 → 측면 패널 → 캡처 → 저장. 배포하는 권한만 사용한다.

### 시험 환경의 주의 사항

- 사용자의 PC (Windows 11)에서 Playwright의 Chromium (chromium-1255)은 시작하지 못했다 ("side-by-side configuration is incorrect"). 원인은 찾지 못했다.
  그래서 Edge를 사용했다: `SC_CHANNEL=msedge`. Playwright는 저장소 밖의 폴더에 설치하고, `NODE_PATH`로 지정했다.
- 이 환경(Windows, Edge)의 결과: 17개 중에서 15개 통과, 2개 실패. 실패한 2개는 0.3.0의 코드에서도 같은 값으로 실패한다. 0.4.0의 변경이 원인이 아니다.
  - `manual`: 높이 3198, 기대 3205. Windows의 Edge에서 휠의 이동 거리가 시험의 값과 7픽셀 다르다. 원인은 조사하지 않았다.
  - `filename`: Windows는 한글 파일 이름을 거부하지 않는다. 이 시험은 Linux의 C 로케일에서만 의미가 있다.
- `realflow.mjs`는 Xvfb가 필요하다. Windows에서는 실행하지 않았다. 0.4.0에서는 이 시험을 실행하지 않았다.
- `pull.ps1`과 `install.ps1`의 자동 시험은 없다. 임시 저장소(한글 경로)에서 손으로 시험했다:
  변경 없음, 새 버전, 이 PC에서 바꾼 파일과의 충돌, git 저장소가 아닌 폴더, 예약 작업의 등록과 실행과 제거.
- `*.ps1` 파일은 BOM이 있는 UTF-8이어야 한다. BOM이 없으면 Windows PowerShell 5.1이 한글을 잘못 읽는다. 단위 시험이 BOM을 확인한다.

- 브라우저 시험은 도구 모음의 아이콘을 누를 수 없다. 그래서 시험용 복사본의 manifest에 `host_permissions: <all_urls>`를 추가한다.
  배포하는 manifest에는 이 권한이 없다.
- 측면 패널을 일반 창으로 연다: `sidepanel.html?tabId=번호`. `tabId` 값은 시험에서만 사용한다.
- `window.__scDebug`는 측면 패널의 상태이다. 시험이 이것을 읽는다.
- 로케일이 C이면 Chrome이 한글 파일 이름을 거부한다 ("Invalid filename"). 시험은 `LANG=C.UTF-8`로 실행한다.
  `filename` 시험만 C 로케일을 사용한다.
- Playwright는 실제 측면 패널을 페이지로 보여주지 않는다. `realflow.mjs`는 CDP (`Target.attachToTarget`)로 연결한다.
- `realflow.mjs`는 시험용 복사본에 단축키(`_execute_action`, Ctrl+Shift+Y)를 추가하고, `sendkey.py` (python-xlib)로 키를 보낸다.
- 확장 프로그램은 `data:` 주소의 페이지에 스크립트를 넣을 수 없다. 시험 페이지는 로컬 HTTP 서버로 제공한다.
- headless Chromium에는 창의 틀이 있다. `--window-size=1000,700`에서 화면의 높이는 613이다. 시험은 화면의 크기를 페이지에서 읽는다.
- Playwright는 다운로드한 파일을 임시 이름으로 저장한다. 시험은 파일의 크기를 비교한다.
- headless Chromium은 캡처 횟수의 제한을 실행하지 않았다 (연속 6회 성공). 그래서 `quota` 시험은 제한 값의 상수와 실제 캡처 간격을 확인한다.

## 8. 측정 값

| 항목 | 값 |
| --- | --- |
| 자동 스크롤 "빠름", 5,060픽셀 페이지 | 사진 9장, 약 8초 |
| 자동 스크롤 "자연스럽게", 같은 페이지 | 사진 13장, 약 30초, 한 번에 이동한 최대 거리 44픽셀 |
| 33,060픽셀 페이지 | 사진 55장, 파일 2개 (30,000 + 3,060픽셀), 약 38초 |
| 텍스트 변환의 글자 오류율 | 0.5~3% (글꼴과 글자 크기에 따라 다르다) |
| 텍스트 변환의 시간 | 페이지 1,000픽셀에 약 3초 |
| Noto Sans KR 16px, 확대 1 / 1.5 / 2 | 오류율 2.96% / 1.51% / 2.20% |
| Noto Sans KR 13px, 확대 1 / 1.5 / 2 | 오류율 4.53% / 2.01% / 1.45% |
| Noto Sans KR 14px, 화면 배율 2, 확대 1 / 2 | 오류율 2.64% / 3.71% |

## 9. 결정한 사항

- 프로그램 형태: Chrome 확장 프로그램 (Manifest V3, 측면 패널).
- 권한: `activeTab`만 사용한다. 모든 사이트에 대한 상시 권한은 요청하지 않는다.
- 캡처한 사진과 텍스트를 외부로 보내지 않는다. 그래서 OCR 엔진과 언어 자료를 확장 프로그램 안에 넣었다.
- 텍스트 변환의 방식: 사진의 글자 인식(OCR). 사용자는 텍스트를 페이지에서 직접 읽는 방식을 캡처 방식으로 바꿨다.
  페이지에서 직접 읽는 방식은 오류가 없는 대안이다. 사용자에게 제안했고, 사용자는 아직 답하지 않았다.
- 인식 언어: 한국어, 영어.
- 프로그램은 로그인, 유료 결제, 캡처 방지 기능을 우회하지 않는다. "자연스럽게" 속도는 스크롤의 움직임만 바꾼다.
- 자동 스크롤의 최대 화면 수(기본값 100)는 기획서에 없던 설정이다. 끝이 없는 페이지에 필요해서 추가했다.

## 10. 아직 하지 않은 작업

- 실제 웹사이트에서의 시험. 사용자가 자주 사용하는 사이트 3~5개를 아직 받지 못했다.
- Linux에서 `realflow.mjs`의 실행 (0.4.0).
- 기획서의 구조 그림은 구성 요소 5개를 보여준다. 텍스트 변환 모듈은 그림에 없다.
- 기획서의 "나중" 항목: PDF 저장, 캡처 영역 선택, 클립보드에 사진 복사, 사이트별 규칙.
- Chrome 웹 스토어 등록 (git과 예약 작업이 없는 자동 업데이트에 필요하다. 개발자 계정과 등록 비용이 필요하다).
- 기본 브랜치로의 병합 또는 풀 리퀘스트.

## 11. 알려진 제한

- OCR 오류: 한글과 영문이 붙어 있는 부분("PNG와" → "PNG2H"), 작은 글자, 사진 위의 글자.
- 텍스트의 줄 바꿈은 화면의 줄 바꿈과 같다. 문단의 구분은 없다.
- 표와 여러 단의 페이지는 글자의 순서가 바뀔 수 있다.
- 고정 메뉴 숨기기는 `sticky` 요소를 모두 숨긴다. 내용의 일부인 요소(표의 머리글 등)도 숨길 수 있다.
- 수동 스크롤에서 한 번에 한 화면보다 많이 이동하면 누락 영역이 생긴다.
- 캡처 중에는 캡처 대상 탭이 화면에 보여야 한다.

## 12. 작업의 규칙

- 버전을 올릴 때: `manifest.json`의 `version`, `README.md`의 버전, 필요하면 기획서.
- 확장 프로그램의 파일을 바꾸면 `version`을 반드시 올린다. 자동 업데이트는 버전이 바뀐 때에만 다시 로드한다.
- 기능을 바꾸면 시험을 추가하고, 세 가지 시험을 모두 실행한다.
- 기획서는 claude.ai의 문서 "스크롤 캡처 프로그램 기획서"이다. 이 저장소에는 없다. 링크는 사용자에게 요청한다.
- 문서와 사용자에게 보내는 글의 문체: 짧은 문장, 능동태, 한 문장에 한 가지 내용, 같은 것에는 같은 낱말 (ASD-STE100의 원칙).
- 설치용 압축 파일을 만드는 명령 (저장소의 최상위 폴더에서 실행. `tests/`와 `auto-update/`는 제외한다):

  ```bash
  zip -q -r scroll-capture-0.4.0.zip scroll-capture -x 'scroll-capture/tests/*' 'scroll-capture/auto-update/*'
  ```

- OCR 엔진을 다시 받는 방법: `npm install tesseract.js @tesseract.js-data/kor @tesseract.js-data/eng`.
  복사하는 파일: `tesseract.js/dist/tesseract.esm.min.js`, `tesseract.js/dist/worker.min.js`,
  `tesseract.js-core/tesseract-core-simd-lstm.wasm.js`, 각 언어의 `4.0.0_best_int/*.traineddata.gz`.
