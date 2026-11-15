// 사진 안의 글자를 텍스트로 변환한다 (OCR).
// 엔진은 Tesseract.js이다. 엔진과 언어 자료는 이 확장 프로그램 안에 있다.
// 그래서 변환은 브라우저 안에서 수행하고, 사진을 외부로 보내지 않는다.
import Tesseract from './vendor/tesseract/tesseract.esm.min.js';
import { nextCut } from './ocr-tiles.js';

const VENDOR = chrome.runtime.getURL('vendor/tesseract/');
export const OCR_LANGS = ['kor', 'eng'];

// 사진 한 조각의 높이 (사진 픽셀). 긴 사진을 이 높이의 조각으로 나누어서 변환한다.
const TILE_HEIGHT = 1400;
// 조각을 나누는 위치를 찾는 범위. 이 범위 안에서 글자가 없는 줄을 찾는다.
const CUT_WINDOW = 320;

let worker = null;

// 엔진을 시작한다. 첫 시작은 언어 자료를 읽기 때문에 몇 초가 걸린다.
export async function startOcr() {
  if (worker) return;
  worker = await Tesseract.createWorker(OCR_LANGS, 1, {
    workerPath: `${VENDOR}worker.min.js`,
    corePath: `${VENDOR}tesseract-core-simd-lstm.wasm.js`,
    langPath: `${VENDOR}lang`,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
  });
  // 한글 낱말 사이의 빈칸을 유지한다.
  await worker.setParameters({ preserve_interword_spaces: '1' });
}

export async function stopOcr() {
  const w = worker;
  worker = null;
  if (w) await w.terminate();
}

// 작은 글자는 인식률이 낮다. 그래서 화면 배율이 낮은 사진은 확대한 후에 변환한다.
// 측정 결과: 본문 글자의 높이가 사진에서 약 24~28 픽셀일 때 오류가 가장 적다.
// 본문 글자는 보통 14~16 CSS 픽셀이다. 그래서 "화면 배율 x 확대 배율"을 1.7에 맞춘다.
export function upscaleFor(scale) {
  return Math.min(2, Math.max(1, 1.7 / scale));
}

function cleanText(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 긴 사진(canvas) 한 장을 텍스트로 변환한다.
// onProgress(done, total): 변환한 높이와 전체 높이 (사진 픽셀)
// shouldStop(): true이면 변환을 중단한다.
export async function recognizeCanvas(canvas, { upscale = 1, onProgress = () => {}, shouldStop = () => false } = {}) {
  await startOcr();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const parts = [];
  let top = 0;
  while (top < canvas.height) {
    if (shouldStop()) return null;
    let bottom = canvas.height;
    if (canvas.height - top > TILE_HEIGHT * 1.3) {
      const target = top + TILE_HEIGHT;
      const from = target - CUT_WINDOW;
      const band = ctx.getImageData(0, from, canvas.width, CUT_WINDOW * 2);
      bottom = from + nextCut(band.data, canvas.width, CUT_WINDOW * 2, CUT_WINDOW);
    }
    const height = bottom - top;
    const tile = new OffscreenCanvas(Math.round(canvas.width * upscale), Math.round(height * upscale));
    const tileCtx = tile.getContext('2d');
    tileCtx.imageSmoothingEnabled = true;
    tileCtx.imageSmoothingQuality = 'high';
    tileCtx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, tile.width, tile.height);
    const { data } = await worker.recognize(await tile.convertToBlob({ type: 'image/png' }));
    const text = cleanText(data.text);
    if (text) parts.push(text);
    top = bottom;
    onProgress(top, canvas.height);
  }
  return parts.join('\n\n');
}
