# X 서버에 Ctrl+Shift+Y 키 입력을 보낸다. realflow.mjs가 이 파일을 실행한다.
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

d = display.Display()


def walk(window, out):
    try:
        for child in window.query_tree().children:
            out.append(child)
            walk(child, out)
    except Exception:
        pass


# 가장 큰 창(브라우저 창)에 입력 포커스를 준다.
windows = []
walk(d.screen().root, windows)
best = None
for w in windows:
    try:
        if w.get_attributes().map_state != X.IsViewable:
            continue
        g = w.get_geometry()
        if g.width >= 800 and (best is None or g.width * g.height > best[1]):
            best = (w, g.width * g.height)
    except Exception:
        pass
if best:
    best[0].set_input_focus(X.RevertToParent, X.CurrentTime)
    d.sync()
    time.sleep(0.3)

codes = [d.keysym_to_keycode(XK.string_to_keysym(k)) for k in ('Control_L', 'Shift_L', 'y')]
for code in codes:
    xtest.fake_input(d, X.KeyPress, code)
    d.sync()
    time.sleep(0.05)
for code in reversed(codes):
    xtest.fake_input(d, X.KeyRelease, code)
    d.sync()
    time.sleep(0.05)
