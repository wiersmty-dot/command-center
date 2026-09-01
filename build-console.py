#!/usr/bin/env python3
"""Build console.html from the Hyperframe Agent Console v2 design document.

The design is a dc-runtime reactive template: {{ bindings }} plus <sc-for> loops,
fed by a class that fabricates plausible numbers. We keep the markup exactly as
designed and swap the data source for the real runner, so the console shows this
machine rather than an imagined fleet.

Rebuild with:  python3 build-console.py
"""

import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "design", "Hyperframe Agent Console v2.dc.html")
OUT = os.path.join(BASE, "console.html")

LOOP_RE = re.compile(
    r'<sc-for\s+list="\{\{\s*([\w.]+)\s*\}\}"\s+as="(\w+)"[^>]*>(.*?)</sc-for>', re.S)
ATTR_RE = re.compile(r'(\s)([a-zA-Z-]+)="\{\{\s*([\w.]+)\s*\}\}"')
TEXT_RE = re.compile(r'\{\{\s*([\w.]+)\s*\}\}')


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


# measured on the live page: #94a2b2 fails 105 times at 2.6:1, #1fa971 13 times
CONSOLE_COLORS = {
    "#94a2b2": "#5c6b7d",
    "#8593a4": "#5c6b7d",
    "#1fa971": "#147a52",
    "#1a8c5e": "#147a52",
    # brand orange measured 4.44:1 on white — just under AA; same hue, darker
    "#dd3c14": "#bf3410",
}


# --- NOVA palette ----------------------------------------------------------
# The console comp is a light, slate-and-rust design; every other page follows
# the orbit comp. Rather than hard-recolour it to one theme, each literal is
# mapped to the shared token for the ROLE it plays, so the page follows
# /theme.css into either theme. Roles were read off the live page — see the
# property each colour is actually used with.

NOVA_TEXT = {
    # body copy and headings
    "#1b2531": "ink", "#33414f": "ink", "#111c28": "ink",
    "#43535f": "ink-2",
    # secondary / meta text
    "#5c6b7d": "dim", "#4a5a6b": "dim", "#8496aa": "dim",
    "#6b7a8b": "dim", "#9aa9ba": "dim", "#a4b1c0": "dim", "#3f597a": "dim",
    # the rust accent, in every role it plays (fill, text, border)
    "#bf3410": "accent", "#f4652a": "accent", "#f4956e": "accent",
    "#e0521f": "accent", "#c2401a": "accent", "#b53d13": "accent",
    # states
    "#147a52": "ok", "#5fd39f": "ok",
    "#f4952a": "warn", "#96650b": "warn",
    # the page ground: a pale slate wash
    "#eef1f6": "bg", "#e4e9f0": "bg", "#dde3eb": "bg",
    "#eef2f7": "bg", "#e3e9f1": "bg", "#e9edf2": "bg",
    # hairlines and small filled marks on the agent map
    "#8fa4bd": "line", "#c9d4e0": "line", "#b6c2ce": "line",
    # Deliberately inverted blocks (dark card on a light page). Painting them
    # with the ink colour keeps them inverted in BOTH themes instead of turning
    # into an invisible dark-on-dark card.
    "#232e3c": "block", "#151d27": "block", "#141c26": "block",
    "#242f3d": "block", "#131a24": "block",
}

NOVA_RGBA = {
    "rgba(221,60,20,.09)": "accent-wash", "rgba(221,60,20,.10)": "accent-wash",
    "rgba(221,60,20,.3)": "accent", "rgba(221,60,20,.32)": "accent",
    "rgba(221,60,20,.28)": "accent",
    "rgba(31,169,113,.7)": "ok",
    "rgba(30,45,65,.16)": "line", "rgba(30,45,65,.12)": "line",
    "rgba(30,45,65,.18)": "line", "rgba(255,255,255,.10)": "line",
    "rgba(20,35,60,.07)": "shadow", "rgba(20,35,60,.08)": "shadow",
    "rgba(20,35,60,.09)": "shadow", "rgba(20,35,60,.1)": "shadow",
    "rgba(20,35,60,.10)": "shadow", "rgba(20,35,60,.22)": "shadow",
    "rgba(15,25,40,.22)": "shadow", "rgba(15,25,40,.24)": "shadow",
    "rgba(15,25,40,.34)": "shadow",
    "rgba(30,50,80,.06)": "line-soft", "rgba(30,50,80,.08)": "line-soft",
    "rgba(30,50,80,.09)": "line-soft", "rgba(30,50,80,.10)": "line-soft",
    "rgba(63,89,122,.10)": "line-soft", "rgba(63,89,122,.20)": "line",
    "rgba(63,89,122,.22)": "line", "rgba(63,89,122,.55)": "dim",
    "rgba(221,60,20,.20)": "accent-wash", "rgba(221,60,20,.30)": "accent",
    "rgba(255,255,255,.55)": "panel",
    # an "off" / inactive mark, and a filled progress bar in the JS
    "#c7ced7": "line", "#aab4c0": "line",
    # card faces the comp floated above the ground
    "rgba(255,255,255,.92)": "panel", "rgba(255,255,255,.9)": "panel",
    "rgba(255,255,255,.86)": "panel",
}


def to_nova(html):
    """Rewrite the comp's literal colours as NOVA tokens."""
    # a gradient's transparent stop: keep it transparent, not tokenised
    html = html.replace("rgba(221,60,20,0)", "transparent")
    # White is the one genuinely ambiguous literal. As a background it is a card
    # face; as text it sits either on an accent-filled button or inside one of
    # the dark blocks. Those two need opposite tokens, and the discriminator is
    # whether the SAME style attribute also paints an accent background — the
    # buttons carry both, the block labels carry only the colour.
    accent_lits = ("#bf3410", "#f4652a", "#dd3c14", "#e0521f", "#c2401a", "#b53d13")
    white_text = re.compile(r"color:\s*#(?:fff|ffffff)\b")

    def resolve_white(m):
        attr = m.group(0)
        if not white_text.search(attr):
            return attr
        on_accent = "background" in attr and any(c in attr for c in accent_lits)
        return white_text.sub(
            "color:var(--on-accent)" if on_accent else "color:var(--on-block)", attr)

    html = re.sub(r'style="[^"]*"', resolve_white, html)
    # any left outside a style attribute (set from JS) is block text
    html = white_text.sub("color:var(--on-block)", html)

    for lit, token in NOVA_RGBA.items():
        html = html.replace(lit, f"var(--{token})")
    for lit, token in NOVA_TEXT.items():
        html = re.sub(lit + r"\b", f"var(--{token})", html, flags=re.I)

    # whatever white is left is a surface
    html = re.sub(r"#(?:fff|ffffff)\b", "var(--panel)", html)

    # the comp's own display face, swapped for the one the other pages use
    html = html.replace("'Sora'", "'Space Grotesk'")
    return html


def transform(body):
    """sc-for -> data-for + <template>; {{x}} -> data-bind spans / data-battr."""
    loops = []

    def stash(m):
        loops.append((m.group(1), m.group(2), m.group(3)))
        return f"@@LOOP{len(loops) - 1}@@"

    # loop bodies keep their raw {{ }} — the runtime substitutes them per item
    body = LOOP_RE.sub(stash, body)

    # attribute bindings outside loops
    body = ATTR_RE.sub(lambda m: f'{m.group(1)}{m.group(2)}="" data-battr="{m.group(2)}:{m.group(3)}"', body)
    # text bindings outside loops
    body = TEXT_RE.sub(lambda m: f'<span data-bind="{m.group(1)}"></span>', body)

    for i, (lst, alias, inner) in enumerate(loops):
        body = body.replace(
            f"@@LOOP{i}@@",
            f'<div data-for="{lst}" data-as="{alias}" style="display:contents">'
            f"<template>{inner}</template></div>")
    return body


def main():
    doc = open(SRC, encoding="utf-8").read()
    body = re.search(r"<x-dc>(.*)</x-dc>", doc, re.S).group(1)
    fonts = re.search(r'(<link href="https://fonts\.googleapis[^>]*>)', doc).group(1)
    style = re.search(r"<style>(.*?)</style>", doc, re.S).group(1)
    body = re.sub(r"<helmet.*?</helmet>", "", body, flags=re.S)
    body = re.sub(r"<script.*?</script>", "", body, flags=re.S)

    # Sora is the comp's face; the rest of the app uses Space Grotesk.
    fonts = fonts.replace("family=Sora:wght@300;400;500;600;700;800",
                          "family=Space+Grotesk:wght@400;500;600;700")

    page = (open(os.path.join(BASE, "console-shell.html"), encoding="utf-8").read()
            .replace("<!--FONTS-->", fonts)
            .replace("<!--STYLE-->", style)
            .replace("<!--BODY-->", fix_colors(fix_type(transform(body)), CONSOLE_COLORS)))
    # The shell styles the run panel and the agent form in the comp's own
    # palette, so the mapping has to cover the assembled page, not just the
    # slice lifted out of the design document.
    page = to_nova(page)
    open(OUT, "w", encoding="utf-8").write(page)

    print(f"wrote {OUT} ({len(page):,} bytes)")
    print(f"  loops: {len(LOOP_RE.findall(re.sub(r'<helmet.*?</helmet>', '', re.search(r'<x-dc>(.*)</x-dc>', doc, re.S).group(1), flags=re.S)))}"
          f"  binds: {page.count('data-bind=')}  attr-binds: {page.count('data-battr=')}")


if __name__ == "__main__":
    main()
