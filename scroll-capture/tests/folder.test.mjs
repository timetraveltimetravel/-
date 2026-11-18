// 저장 폴더의 파일 이름 계산의 단위 시험.  실행: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSequence, sequencePrefix, uniqueName, savedMessage } from '../folder.js';

test('nextSequence: 폴더의 가장 큰 순서 번호 + 1', () => {
  assert.equal(nextSequence([]), 1);
  assert.equal(nextSequence(['메모.txt', 'a_1.png']), 1); // 번호가 없는 파일은 무시한다
  assert.equal(nextSequence(['0001_가.png', '0002_가.txt', '0007_나.png']), 8);
  assert.equal(nextSequence(['0099_a.png', '12_b.png']), 100); // 4자리 미만은 순서 번호가 아니다
  assert.equal(nextSequence(['10000_a.png', '0003_b.png']), 10001); // 9999 다음은 5자리이다
});

test('sequencePrefix: 4자리 번호와 밑줄', () => {
  assert.equal(sequencePrefix(1), '0001_');
  assert.equal(sequencePrefix(42), '0042_');
  assert.equal(sequencePrefix(12345), '12345_');
});

test('uniqueName: 같은 이름의 파일이 있으면 "(2)", "(3)"을 붙인다', async () => {
  const taken = new Set(['a.png', 'a (2).png', '이름']);
  const exists = async (name) => taken.has(name);
  assert.equal(await uniqueName('b.png', exists), 'b.png');
  assert.equal(await uniqueName('a.png', exists), 'a (3).png');
  assert.equal(await uniqueName('이름', exists), '이름 (2)'); // 확장자가 없다
  assert.equal(await uniqueName('제목.v2.txt', async (n) => n === '제목.v2.txt'), '제목.v2 (2).txt');
});

test('savedMessage: 저장한 파일과 위치를 알린다', () => {
  assert.equal(savedMessage({ images: 1 }), '사진 1장을 "다운로드" 폴더에 저장했습니다.');
  assert.equal(savedMessage({ texts: 1, folder: '소설' }), '텍스트 파일 1개를 "소설" 폴더에 저장했습니다.');
  assert.equal(savedMessage({ images: 2, texts: 1, folder: '소설' }), '사진 2장과 텍스트 파일 1개를 "소설" 폴더에 저장했습니다.');
  assert.equal(savedMessage({}), '');
});
