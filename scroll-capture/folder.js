// 저장 폴더: 사용자가 선택한 폴더에 파일을 저장한다 (File System Access API).
// 선택한 폴더는 IndexedDB에 기억한다. 그래서 측면 패널을 다시 열어도 같은 폴더를 사용한다.
// 폴더에 쓰는 권한은 Chrome이 관리한다. 브라우저를 다시 시작하면 Chrome이 권한을 다시 물을 수 있다.

const DB_NAME = 'scroll-capture';
const STORE = 'settings';
const FOLDER_KEY = 'folder';

// 파일 이름 앞의 순서 번호의 자리 수 (0001_)
export const SEQUENCE_DIGITS = 4;

// ---------- 순수 함수 ----------

// 폴더의 파일 이름에서 다음 순서 번호를 계산한다. 번호가 있는 파일이 없으면 1.
export function nextSequence(names) {
  let max = 0;
  for (const name of names) {
    const m = /^(\d{4,})_/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function sequencePrefix(n) {
  return `${String(n).padStart(SEQUENCE_DIGITS, '0')}_`;
}

// 같은 이름의 파일이 있으면 "이름 (2).확장자"를 사용한다. exists(name): 그 이름의 파일이 있으면 true.
export async function uniqueName(name, exists) {
  if (!(await exists(name))) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i += 1) {
    const candidate = `${stem} (${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
}

// 저장한 결과를 알리는 글. images: 사진의 수, texts: 텍스트 파일의 수, folder: 폴더의 이름 (없으면 "다운로드" 폴더)
export function savedMessage({ images = 0, texts = 0, folder = '' }) {
  const parts = [];
  if (images) parts.push(`사진 ${images}장`);
  if (texts) parts.push(`텍스트 파일 ${texts}개`);
  if (!parts.length) return '';
  // "장"은 받침이 있고, "개"는 받침이 없다.
  const object = texts ? `${parts.join('과 ')}를` : `${parts[0]}을`;
  return `${object} "${folder || '다운로드'}" 폴더에 저장했습니다.`;
}

// ---------- 기억 (IndexedDB) ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// 기억한 폴더. 없으면 null.
export async function loadFolder() {
  try {
    return (await withStore('readonly', (store) => store.get(FOLDER_KEY))) || null;
  } catch {
    return null;
  }
}

// 폴더를 기억한다. null이면 기억을 지운다.
export function storeFolder(handle) {
  return withStore('readwrite', (store) => (handle ? store.put(handle, FOLDER_KEY) : store.delete(FOLDER_KEY)));
}

// ---------- 폴더 ----------

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function';

// 폴더 선택 창을 연다. 사용자가 취소하면 AbortError가 발생한다.
export function pickFolder() {
  return window.showDirectoryPicker({ id: 'scroll-capture', mode: 'readwrite' });
}

// 폴더에 쓰는 권한. 결과: 'granted', 'prompt', 'denied'.
// ask: true이면 사용자에게 묻는다. 묻는 것은 사용자가 버튼을 누른 직후에만 할 수 있다.
export async function folderPermission(handle, ask = false) {
  if (typeof handle.queryPermission !== 'function') return 'granted';
  const options = { mode: 'readwrite' };
  try {
    let permission = await handle.queryPermission(options);
    if (permission === 'prompt' && ask) permission = await handle.requestPermission(options);
    return permission;
  } catch {
    return 'denied';
  }
}

export async function listNames(handle) {
  const names = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file') names.push(name);
  }
  return names;
}

async function fileExists(handle, name) {
  try {
    await handle.getFileHandle(name);
    return true;
  } catch (error) {
    if (error.name === 'NotFoundError') return false;
    if (error.name === 'TypeMismatchError') return true; // 같은 이름의 폴더가 있다
    throw error;
  }
}

// 파일을 폴더에 쓴다. 결과: 실제로 사용한 파일 이름.
export async function writeToFolder(handle, name, blob) {
  const actual = await uniqueName(name, (candidate) => fileExists(handle, candidate));
  const file = await handle.getFileHandle(actual, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return actual;
}
