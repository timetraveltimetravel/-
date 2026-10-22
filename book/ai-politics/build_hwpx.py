"""종합 정리본을 한글 파일(HWPX)로 만든다.

1부 한눈에 보기(overview.md), 2부 원고(ch00~ch07 본문), 3부 부록(작가가 정한 것,
사실 확인, 나중에 고칠 것, 표기, 장별 근거와 확인)을 하나의 마크다운으로 엮어
종합정리.md에 쓰고, 그것을 AI정치_종합정리.hwpx로 바꾼다.

필요한 것: python-hwpx (pip install python-hwpx==6.8.0)
쓰는 법: 이 폴더에서 python3 build_hwpx.py .
"""
import pathlib
import re
import sys

from hwpx import HwpxDocument

d = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
TITLE = 'AI정치 — 지금 체제 그대로, 주체만 바꾼다'


def read(name):
    return (d / name).read_text(encoding='utf-8')


def demote(text, n):
    return re.sub(r'^(#{1,6}) ', lambda m: '#' * min(6, len(m.group(1)) + n) + ' ', text, flags=re.M)


def split_chapter(s):
    """장 파일을 (제목, 본문, 근거) 로 나눈다. 머리말 안내와 구분선은 뺀다."""
    title = s.splitlines()[0][2:]
    i = s.index('\n## 근거와 확인')
    body, note = s[:i], s[i:]
    rest = '\n'.join(body.splitlines()[1:]).lstrip('\n')
    rest = re.sub(r'\A(> [^\n]*\n)+\s*---\s*\n', '', rest)
    rest = re.sub(r'\n---\s*\Z', '', rest.rstrip()).rstrip()
    note = note.replace('\n## 근거와 확인', '', 1).strip()
    std = ('원고의 문장은 아래 저자 진술(analysis/author.md)과 대화 속 주장(analysis/claims.md)에 기댄다. '
           '**〔제안〕** 은 저자가 말한 적 없이 분석에서 더한 것이다.')
    if note.startswith(std):
        note = note[len(std):].lstrip(' ').lstrip('\n')
    return title, rest, note


def section_table(s, heading):
    """heading 아래 첫 표를 돌려준다."""
    i = s.index(heading)
    lines = s[i:].splitlines()[1:]
    out, started = [], False
    for ln in lines:
        if ln.startswith('|'):
            out.append(ln)
            started = True
        elif started:
            break
    return '\n'.join(out)


def readme_section(name):
    s = read('README.md')
    m = re.search(r'^## ' + re.escape(name) + r'\n(.*?)(?=^## |\Z)', s, flags=re.S | re.M)
    return m.group(1).strip()


# ---------- 마크다운 엮기 ----------
chapters = [split_chapter(read(f.name)) for f in sorted(d.glob('ch0*.md'))]

ov = read('overview.md')
ov = ov.replace('<!-- TABLE:ch05 -->', section_table(read('ch05-objections.md'), '## 정리\n'))
ov = ov.replace('<!-- TABLE:ch06 -->', section_table(read('ch06-limits.md'), '## 정리: 약속하는 것과 약속하지 않는 것'))

fc = read('factcheck.md')
fc = fc.split('\n', 1)[1].strip()  # 첫 줄 제목을 뺀다

parts = []
parts.append('# ' + TITLE)
parts.append('@@SUB 종합 정리본')
parts.append('@@SUB 원고 1판 · 2026년 10월 22일')
parts.append('## 차례')
toc = ['- 1부 한눈에 보기', '- 2부 원고'] + ['  - ' + t for t, _, _ in chapters] + [
    '- 3부 부록', '  - 가. 작가가 정한 것', '  - 나. 사실 확인', '  - 다. 나중에 고칠 것',
    '  - 라. 표기', '  - 마. 근거와 확인']
parts.append('\n'.join(toc))
parts.append(ov.strip())
parts.append('## 2부 원고')
for t, body, _ in chapters:
    parts.append('### ' + t + '\n\n' + demote(body, 2))
parts.append('## 3부 부록')
parts.append(read('decisions-summary.md').strip())
parts.append('### 나. 사실 확인\n\n' + demote(fc, 2))
parts.append('### 다. 나중에 고칠 것\n\n' + readme_section('나중에 고칠 것'))
parts.append('### 라. 표기\n\n' + readme_section('표기'))
notes = ['### 마. 근거와 확인',
         '각 장의 문장이 어느 작가 진술(analysis/author.md)과 대화 속 주장(analysis/claims.md)에 기대는지 적은 작업 노트다. '
         '**〔제안〕** 은 작가가 말한 적 없이 분석에서 더한 것이다.']
for t, _, note in chapters:
    notes.append('#### ' + t + '\n\n' + demote(note, 2))
parts.append('\n\n'.join(notes))
md = '\n\n'.join(parts) + '\n'
(d / '종합정리.md').write_text(md, encoding='utf-8')

# ---------- HWPX 만들기 ----------
doc = HwpxDocument.new()
groups = {}  # 문단 서식 묶음 이름 -> 문단 목록
BODY = 10.5


def para(kind):
    p = doc.add_paragraph('', include_run=False, inherit_style=False)
    groups.setdefault(kind, []).append(p)
    return p


def runs(p, text, size=BODY, bold=False):
    text = text.replace('`', '')
    for i, piece in enumerate(re.split(r'\*\*(.+?)\*\*', text)):
        if piece:
            p.add_run(piece, size=size, bold=bold or i % 2 == 1)


state = {'part': 0}
lines = md.splitlines()
i = 0
while i < len(lines):
    ln = lines[i]
    if not ln.strip() or ln.strip() == '---':
        i += 1
        continue
    if ln.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-{3,}:?', c) for c in cells):
                rows.append(cells)
            i += 1
        ncol = max(len(r) for r in rows)
        t = doc.add_table(len(rows), ncol)
        for r, row in enumerate(rows):
            for c in range(ncol):
                t.set_cell_text(r, c, (row[c] if c < len(row) else '').replace('**', '').replace('`', ''))
                if r == 0:
                    t.set_cell_shading(0, c, '#E7ECF2')
        # 짧은 이름 칸도 글자가 꺾이지 않도록 칸마다 글자 수에 여유를 더한다.
        t.set_column_widths([max(5, min(60, max(len(row[c]) if c < len(row) else 0 for row in rows) + 4)) for c in range(ncol)])
        para('gap')
        continue
    m = re.match(r'^(#{1,6}) (.*)$', ln)
    if m:
        level, text = len(m.group(1)), m.group(2)
        if level == 1:
            p = para('title')
            runs(p, text, size=24, bold=True)
        elif level == 2:
            state['part'] += 1
            p = para('part')
            runs(p, text, size=18, bold=True)
        elif level == 3:
            in_book = text.startswith(tuple(t for t, _, _ in chapters)) and state['part'] == 3
            p = para('chapter' if in_book else 'h3')
            runs(p, text, size=16 if in_book else 13, bold=True)
        elif level == 4:
            p = para('h4')
            runs(p, text, size=12, bold=True)
        else:
            p = para('h5')
            runs(p, text, size=11, bold=True)
        i += 1
        continue
    if ln.startswith('@@SUB '):
        p = para('subtitle')
        runs(p, ln[6:], size=14)
        i += 1
        continue
    m = re.match(r'^( *)- (.*)$', ln)
    if m:
        depth = min(2, len(m.group(1)) // 2)
        p = para('li%d' % depth)
        runs(p, ['• ', '◦ ', '- '][depth] + m.group(2))
        i += 1
        continue
    if ln.startswith('> '):
        p = para('quote')
        runs(p, ln[2:], size=9.5)
        i += 1
        continue
    p = para('body')
    runs(p, ln)
    i += 1

fmt = doc.styles.apply_paragraph_format
common = dict(line_spacing_percent=160)
fmt(paragraphs=groups['title'], alignment='CENTER', spacing_before_pt=180, spacing_after_pt=24, **common)
fmt(paragraphs=groups['subtitle'], alignment='CENTER', spacing_after_pt=10, **common)
fmt(paragraphs=groups['part'], alignment='LEFT', page_break_before=True, spacing_after_pt=14,
    keep_with_next=True, bottom_border=True, **common)
fmt(paragraphs=groups['chapter'], alignment='LEFT', page_break_before=True, spacing_after_pt=12,
    keep_with_next=True, **common)
for k in ('h3', 'h4', 'h5'):
    if k in groups:
        fmt(paragraphs=groups[k], alignment='LEFT', spacing_before_pt=12, spacing_after_pt=6,
            keep_with_next=True, **common)
fmt(paragraphs=groups['body'], alignment='JUSTIFY', spacing_after_pt=6, **common)
for k, ind in (('li0', 5), ('li1', 11), ('li2', 17)):
    if k in groups:
        fmt(paragraphs=groups[k], alignment='JUSTIFY', indent_left_mm=ind, spacing_after_pt=3, **common)
if 'quote' in groups:
    fmt(paragraphs=groups['quote'], alignment='JUSTIFY', indent_left_mm=6, spacing_after_pt=6, **common)
fmt(paragraphs=groups['gap'], spacing_after_pt=6)

doc.page.set_page_number()
report = doc.validate()
if report.issues:
    raise SystemExit('검증 실패: %r' % (report.issues,))
out = d / 'AI정치_종합정리.hwpx'
doc.save_to_path(str(out))
print('저장:', out, '문단', sum(len(v) for v in groups.values()))
