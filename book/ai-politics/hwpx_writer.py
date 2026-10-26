"""마크다운(이 책에서 쓰는 만큼만)을 한글 파일(HWPX)로 쓴다.

다루는 것: 제목(#~######), 문단, 굵게(**), 목록(- , 두 칸 들여 쓴 하위 목록),
표(| 칸 |), 인용(> ), 부제(@@SUB 줄). 구분선(---)과 빈 줄은 건너뛴다.

필요한 것: python-hwpx (pip install python-hwpx==6.8.0)
"""
import re

from hwpx import HwpxDocument

BODY = 10.5

# 문단 묶음마다의 서식. heading 함수가 돌려주는 kind 이름과 맞춘다.
BASE_FORMATS = {
    'title': dict(alignment='CENTER', spacing_before_pt=180, spacing_after_pt=24),
    'subtitle': dict(alignment='CENTER', spacing_after_pt=10),
    'part': dict(alignment='LEFT', page_break_before=True, spacing_after_pt=14, keep_with_next=True,
                 bottom_border=True),
    'chapter': dict(alignment='LEFT', page_break_before=True, spacing_after_pt=12, keep_with_next=True),
    'h3': dict(alignment='LEFT', spacing_before_pt=12, spacing_after_pt=6, keep_with_next=True),
    'h4': dict(alignment='LEFT', spacing_before_pt=12, spacing_after_pt=6, keep_with_next=True),
    'h5': dict(alignment='LEFT', spacing_before_pt=12, spacing_after_pt=6, keep_with_next=True),
    'body': dict(alignment='JUSTIFY', spacing_after_pt=6),
    'li0': dict(alignment='JUSTIFY', indent_left_mm=5, spacing_after_pt=3),
    'li1': dict(alignment='JUSTIFY', indent_left_mm=11, spacing_after_pt=3),
    'li2': dict(alignment='JUSTIFY', indent_left_mm=17, spacing_after_pt=3),
    'quote': dict(alignment='JUSTIFY', indent_left_mm=6, spacing_after_pt=6),
    'gap': dict(spacing_after_pt=6),
}


def write_hwpx(md, out, heading, formats=None):
    """md 를 out 경로의 HWPX로 쓴다.

    heading(level, text) 는 제목 줄마다 (서식 묶음 이름, 글자 크기)를 돌려준다.
    formats 는 BASE_FORMATS 가운데 바꿀 묶음의 서식이다.
    """
    fmts = dict(BASE_FORMATS)
    fmts.update(formats or {})
    doc = HwpxDocument.new()
    groups = {}

    def para(kind):
        p = doc.add_paragraph('', include_run=False, inherit_style=False)
        groups.setdefault(kind, []).append(p)
        return p

    def runs(p, text, size=BODY, bold=False):
        text = text.replace('`', '')
        for i, piece in enumerate(re.split(r'\*\*(.+?)\*\*', text)):
            if piece:
                p.add_run(piece, size=size, bold=bold or i % 2 == 1)

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
            t.set_column_widths([max(5, min(60, max(len(row[c]) if c < len(row) else 0 for row in rows) + 4))
                                 for c in range(ncol)])
            para('gap')
            continue
        m = re.match(r'^(#{1,6}) (.*)$', ln)
        if m:
            kind, size = heading(len(m.group(1)), m.group(2))
            runs(para(kind), m.group(2), size=size, bold=True)
            i += 1
            continue
        if ln.startswith('@@SUB '):
            runs(para('subtitle'), ln[6:], size=14)
            i += 1
            continue
        m = re.match(r'^( *)- (.*)$', ln)
        if m:
            depth = min(2, len(m.group(1)) // 2)
            runs(para('li%d' % depth), ['• ', '◦ ', '- '][depth] + m.group(2))
            i += 1
            continue
        if ln.startswith('> '):
            runs(para('quote'), ln[2:], size=9.5)
            i += 1
            continue
        runs(para('body'), ln)
        i += 1

    for kind, ps in groups.items():
        doc.styles.apply_paragraph_format(paragraphs=ps, line_spacing_percent=160, **fmts[kind])
    doc.page.set_page_number()
    report = doc.validate()
    if report.issues:
        raise SystemExit('검증 실패: %r' % (report.issues,))
    doc.save_to_path(str(out))
    return sum(len(v) for v in groups.values())
