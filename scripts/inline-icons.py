"""icons/*.png を一番小さい形式（PNG / WebP）に変換し、トップページの CSS（css/top.css）に data URI として埋め込む。
そのあと npm run build（scripts/build.mjs）を実行すると index.html に入る。

ファビコンは十数個で合計10KBほどと小さいので、別ファイルで1つずつ取りに行くより
HTML に埋め込んで通信を0回にした方が速い（画像の遅れて出るちらつきも無くなる）。

css/top.css の /* ICONS:START */ と /* ICONS:END */ の間を毎回書き直す（css/ がない古い構成では index.html）。
"""
import base64, glob, io, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "css", "top.css")
if not os.path.exists(HTML):
    HTML = os.path.join(ROOT, "index.html")

rules = []
for path in sorted(glob.glob(os.path.join(ROOT, "icons", "*.png"))):
    name = os.path.splitext(os.path.basename(path))[0]
    im = Image.open(path).convert("RGBA")
    if max(im.size) > 32:  # 16px 表示・高解像度画面用に最大32pxまで
        im = im.resize((32, 32), Image.LANCZOS)
    candidates = []
    for fmt, mime, opts in (("PNG", "image/png", {"optimize": True}),
                            ("WEBP", "image/webp", {"lossless": True, "method": 6}),
                            ("WEBP", "image/webp", {"quality": 90, "method": 6})):
        buf = io.BytesIO(); im.save(buf, fmt, **opts); candidates.append((len(buf.getvalue()), mime, buf.getvalue()))
    size, mime, data = min(candidates)
    rules.append(f".fav-{name}{{background-image:url(data:{mime};base64,{base64.b64encode(data).decode()})}}")

block = "/* ICONS:START（scripts/inline-icons.py が自動生成。手で編集しない） */\n" + "\n".join(rules) + "\n/* ICONS:END */"
html = open(HTML, encoding="utf-8").read()
new, n = re.subn(r"/\* ICONS:START.*?/\* ICONS:END \*/", lambda m: block, html, flags=re.S)
if n != 1:
    sys.exit(f"{HTML} に ICONS:START / ICONS:END の目印が見つかりません")
if new != html:
    open(HTML, "w", encoding="utf-8").write(new)
print(f"{len(rules)} 個のアイコンを埋め込み（{sum(len(r) for r in rules) / 1024:.1f} KB）")
