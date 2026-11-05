"""Turn an SVG into a one-tap Cameo Cutter link.

usage: python3 cutter_link.py design.svg "Design name"
Prints https://moshcodeai.github.io/cameo-cutter/#d=...&n=...
The design travels inside the link (raw-deflate + base64url), so nothing is uploaded.
"""
import base64
import re
import sys
import urllib.parse
import zlib

BASE = "https://moshcodeai.github.io/cameo-cutter/"


def minify(svg: str) -> str:
    svg = re.sub(r"<\?xml[^>]*\?>|<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r">\s+<", "><", svg)
    return re.sub(r"\s+", " ", svg).strip()


def link(svg: str, name: str) -> str:
    z = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = z.compress(minify(svg).encode()) + z.flush()
    d = base64.urlsafe_b64encode(packed).decode().rstrip("=")
    return f"{BASE}#d={d}&n={urllib.parse.quote(name)}"


if __name__ == "__main__":
    path, name = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "Design")
    url = link(open(path, encoding="utf-8").read(), name)
    print(url)
    print(f"({len(url)} characters)", file=sys.stderr)
