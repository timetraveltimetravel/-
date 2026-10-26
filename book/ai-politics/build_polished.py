"""다듬은 원고(polished.md)를 한글 파일 AI정치_다듬은원고.hwpx로 만든다.

필요한 것: python-hwpx (pip install python-hwpx==6.8.0)
쓰는 법: 이 폴더에서 python3 build_polished.py .
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from hwpx_writer import write_hwpx  # noqa: E402

d = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')


def heading(level, text):
    if level == 1:
        return 'title', 24
    if level == 2:
        return 'chapter', 18  # 차례와 각 장은 새 쪽에서 시작한다.
    if level == 3:
        return 'h3', 13
    return 'h4', 11.5


# 책처럼 읽히도록 본문 첫 줄을 들여 쓰고 문단 사이를 조금 좁힌다.
formats = {'body': dict(alignment='JUSTIFY', first_line_indent_mm=3.5, spacing_after_pt=4)}
out = d / 'AI정치_다듬은원고.hwpx'
n = write_hwpx((d / 'polished.md').read_text(encoding='utf-8'), out, heading, formats)
print('저장:', out, '문단', n)
