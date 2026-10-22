"""장별 원고(ch00~ch07)를 한 권짜리 manuscript.md로 합친다.
본문은 차례대로 잇고, 각 장의 '근거와 확인'은 책 끝 부록으로 모은다."""
import re, sys, pathlib

d = pathlib.Path(sys.argv[1])
files = sorted(d.glob('ch0*.md'))

def demote(text):
    return re.sub(r'^(#{1,5}) ', lambda m: '#' + m.group(1) + ' ', text, flags=re.M)

bodies, notes, toc = [], [], []
for f in files:
    s = f.read_text(encoding='utf-8')
    title = s.splitlines()[0]
    assert title.startswith('# '), f
    i = s.index('\n## 근거와 확인')
    body, note = s[:i], s[i:]
    lines = body.splitlines()
    # 제목 뒤의 '> 초고 ...' 안내와 그 뒤의 구분선을 뺀다.
    rest = '\n'.join(lines[1:]).lstrip('\n')
    rest = re.sub(r'\A(> [^\n]*\n)+\s*---\s*\n', '', rest)
    rest = re.sub(r'\n---\s*\Z', '', rest.rstrip()) .rstrip()
    name = title[2:]
    toc.append(name)
    bodies.append(demote(title + '\n\n' + rest))
    note = note.replace('\n## 근거와 확인', '', 1).strip()
    # 장마다 되풀이되는 첫 문장은 부록 머리말 하나로 대신한다.
    std = '원고의 문장은 아래 저자 진술(analysis/author.md)과 대화 속 주장(analysis/claims.md)에 기댄다. **〔제안〕** 은 저자가 말한 적 없이 분석에서 더한 것이다.'
    if note.startswith(std):
        note = note[len(std):].lstrip(' ').lstrip('\n')
    notes.append('### ' + name + '\n\n' + demote(note))

out = ['# AI정치 — 지금 체제 그대로, 주체만 바꾼다', '',
       '> 합친 원고. 장별 파일(ch00~ch07)을 차례대로 이은 것이다. 고칠 때는 장별 파일을 고치고 이 파일을 다시 만든다. 문단마다의 근거와 〔제안〕 표시는 책 끝의 부록에 모았다.', '',
       '## 차례', '']
out += ['- ' + t for t in toc] + ['- 부록: 근거와 확인', '', '---', '']
out.append('\n\n---\n\n'.join(bodies))
out += ['', '---', '', '## 부록: 근거와 확인', '',
        '각 장의 문장이 어느 저자 진술(analysis/author.md)과 대화 속 주장(analysis/claims.md)에 기대는지 적었다. **〔제안〕** 은 저자가 말한 적 없이 분석에서 더한 것이다.', '']
out.append('\n\n'.join(notes))
(d / 'manuscript.md').write_text('\n'.join(out).rstrip() + '\n', encoding='utf-8')
print('chapters:', len(files))
