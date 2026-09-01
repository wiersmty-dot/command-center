#!/usr/bin/env python3
"""Build orbit.html from the Jarvis Dashboards design document.

The design ships as a dc-runtime canvas holding several turns of exploration.
Turn 3a (dark) and 4a (light) are the converged screen — same layout, different
palette — so we lift both, strip the dc-runtime-only bits, add hooks for the
data that has to be live, and emit one page that can switch between them.

Rebuild with:  python3 build-orbit.py
"""

import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "design", "Jarvis Dashboards.dc.html")
OUT = os.path.join(BASE, "orbit.html")


# --- accessibility remediation ---------------------------------------------
# Applied at build time to the design's own inline styles, so a rebuild keeps
# the fixes. Measured against WCAG AA on the live page, not estimated.

def map_size(v):
    """Floor the type at 11px and collapse a 16-step scale to six."""
    v = float(v)
    if v < 11:   return 11
    if v <= 12.5: return 12
    if v <= 14.5: return 14
    if v <= 19:   return 18
    return v      # hero and display sizes keep their own value


def fix_type(html):
    def shorthand(m):
        # the first Npx in a font shorthand is the size
        return "font:" + re.sub(r"(\d+(?:\.\d+)?)px",
                                lambda s: f"{map_size(s.group(1)):g}px", m.group(1), count=1)
    html = re.sub(r'font:([^;"]*)', shorthand, html)
    return re.sub(r"font-size:\s*(\d+(?:\.\d+)?)px",
                  lambda m: f"font-size:{map_size(m.group(1)):g}px", html)


def fix_colors(html, mapping):
    for old, new in mapping.items():
        html = html.replace(old, new)
    return html


def extract(doc, label):
    m = re.search(
        r'data-screen-label="%s"[^>]*>(.*?)(?=<div class="dv-opt"|<section class="dv-turn"|</x-dc>)'
        % re.escape(label),
        doc, re.S)
    if not m:
        raise SystemExit(f"could not find screen {label!r}")
    html = m.group(1)
    # the extract starts mid-tag (after data-screen-label=...>) — drop the
    # trailing card/opt wrappers the slice picked up
    html = html.rsplit("</div>\n</div>\n</div>", 1)[0]
    return html


# the light variant's teal fails AA on its paper background at 4.35:1
ORBIT_COLORS = {"#0a7d74": "#05605a"}


def clean(html):
    # dc-runtime authoring attributes with no meaning in a plain browser
    html = re.sub(r'\s+style-hover="[^"]*"', "", html)

    # <x-import component-from-global-scope="particle-cloud" from="./particle-cloud.js" ...>
    # is dc-runtime's way of mounting the custom element. In a plain browser the
    # element is registered by the script tag, so emit the real tag instead.
    def to_element(m):
        attrs = m.group(1)
        attrs = re.sub(r'\s*component-from-global-scope="[^"]*"', "", attrs)
        attrs = re.sub(r'\s*from="[^"]*"', "", attrs)
        attrs = re.sub(r'\s*hint-size="[^"]*"', "", attrs)
        return f"<particle-cloud{attrs}></particle-cloud>"

    html = re.sub(r'<x-import\s+component-from-global-scope="particle-cloud"(.*?)></x-import>',
                  to_element, html, flags=re.S)
    return html


def add_hooks(html):
    # live clock
    html = html.replace('">11:11<span', '"><span data-hook="time">11:11</span><span', 1)
    html = re.sub(r'(<div style="[^"]*")(>)(FRI AUG 28 · WK 35 · WORKSHOP)(</div>)',
                  r'\1 data-hook="date"\2\3\4', html, count=1)
    # this text sits after a sibling span inside its div, so wrap the text itself
    html = html.replace("RUNTIME ONLINE · 8 DEVICES UP",
                        '<span data-hook="runtime">RUNTIME ONLINE · 8 DEVICES UP</span>', 1)

    # the command bar: a static span in the mock becomes a real input
    html = re.sub(
        r'<span style="(font:500 15px \'Space Grotesk\',sans-serif;color:[^"]*)">'
        r'Sweep deliverables and tell me what slipped this week</span>',
        r'<input data-hook="cmd" placeholder="Sweep deliverables and tell me what slipped this week" '
        r'style="\1;flex:1;min-width:0;background:transparent;border:0;outline:none">',
        html, count=1)
    # the blinking caret sat next to that span; the real caret replaces it
    html = re.sub(r'<span style="width:8px;height:17px;background:[^"]*;'
                  r'animation:blink 1\.1s step-end infinite"></span>', "", html, count=1)

    # email signal panel
    html = re.sub(r'(<span style="font:700 58px[^"]*")(>)(\d+)(</span>)',
                  r'\1 data-hook="mail-total"\2\3\4', html, count=1)
    html = html.replace('<div style="display:flex;gap:3px;margin-top:20px">',
                        '<div data-hook="mail-bars" style="display:flex;gap:3px;margin-top:20px">', 1)
    html = re.sub(r'(<div style="display:flex;justify-content:space-between;margin-top:8px;font:500 8px[^"]*")(>)',
                  r'\1 data-hook="mail-labels"\2', html, count=1)
    html = re.sub(r'(<span style="[^"]*")(>)(SYNCED 11:10)(</span>)',
                  r'\1 data-hook="mail-synced"\2\3\4', html, count=1)

    # skills row — names and status lines get updated from /api/skills + /api/history
    html = re.sub(r'(<div style="font:500 12px \'JetBrains Mono\',monospace;color:[^"]*")(>)(/[a-z-]+)(</div>)',
                  r'\1 data-hook="skill-name"\2\3\4', html)
    html = re.sub(r'(<span style="font:500 8\.5px \'JetBrains Mono\',monospace;color:[^"]*")(>)([^<]*)(</span>)',
                  r'\1 data-hook="skill-status"\2\3\4', html)
    return html


def main():
    doc = open(SRC, encoding="utf-8").read()
    dark = fix_type(add_hooks(clean(extract(doc, "3a Nova refined"))))
    light = fix_colors(fix_type(add_hooks(clean(extract(doc, "4a Nova light")))), ORBIT_COLORS)
    # the inbox count was the largest number on the page; decisions matter more
    light = light.replace("font:700 58px", "font:700 34px")
    dark = dark.replace("font:700 58px", "font:700 34px")
    keyframes = re.search(r"<style>(.*?)</style>", doc, re.S).group(1)
    # the dc viewer's own chrome styles are not wanted, only the @keyframes
    keyframes = "\n".join(l for l in keyframes.splitlines()
                          if l.startswith("@keyframes") or l.startswith("body{") or l.startswith("a{"))

    shell = open(os.path.join(BASE, "orbit-shell.html"), encoding="utf-8").read()
    page = (shell
            .replace("<!--KEYFRAMES-->", keyframes)
            .replace("<!--DARK-->", dark)
            .replace("<!--LIGHT-->", light))
    open(OUT, "w", encoding="utf-8").write(page)
    print(f"wrote {OUT} ({len(page):,} bytes) — dark {len(dark):,} / light {len(light):,}")


if __name__ == "__main__":
    main()
