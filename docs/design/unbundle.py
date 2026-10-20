#!/usr/bin/env python3
"""Собирает docs/design/template.html из экспорта Claude Design.

Экспорт — бандл: корневая страница с доской на каждый экран, каждая доска —
вложенный бандл с рантаймом Claude Design, шрифтами в base64 и статической
разметкой внутри <x-dc>. Здесь разметка досок склеивается в один HTML без JS:
общий CSS один раз, шрифт Onest — ссылкой на Google Fonts, межэкранные ссылки
становятся якорями.

    python3 docs/design/unbundle.py docs/design/claude-design-export.html docs/design/template.html
"""
import base64
import gzip
import hashlib
import json
import re
import sys

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap">')


def bundle_parts(html):
    blocks = dict(re.findall(r'<script type="__bundler/(\w+)">(.*?)</script>', html, re.S))
    manifest = json.loads(blocks['manifest'])
    order = json.loads(blocks.get('page_order', '[]'))
    template = json.loads(blocks['template'])
    return manifest, order, template


def asset(entry):
    data = base64.b64decode(entry['data'])
    return gzip.decompress(data) if entry.get('compressed') else data


def anchor(href):
    name = href.removesuffix('.dc.html')
    return 'top' if name == 'Main' else name


def board(page_html, anchor_id):
    """Возвращает (список CSS-блоков, разметка доски)."""
    page_html = re.sub(r'(/\*[^*]*\*/\s*)?@font-face\s*\{[^}]*\}', '', page_html)
    css = [c.strip() for c in re.findall(r'<style>(.*?)</style>', page_html, re.S) if c.strip()]
    body = page_html.split('</helmet>', 1)[1].split('</x-dc>', 1)[0]
    body = re.sub(r'<(/?)sc-raw-(\w+)', r'<\1\2', body)
    body = re.sub(r'<nav class="spec-board__nav".*?</nav>',
                  '<nav class="spec-board__nav" aria-label="Навигация"><a href="#top">↑ К оглавлению</a></nav>',
                  body, count=1, flags=re.S)
    body = re.sub(r'href="([\w-]+)\.dc\.html"', lambda m: f'href="#{anchor(m.group(1) + ".dc.html")}"', body)
    body = body.strip()
    if anchor_id != 'top':
        body = re.sub(r'^<main class="spec-board">', f'<section class="spec-board" id="{anchor_id}">', body)
        body = re.sub(r'</main>$', '</section>', body)
    else:
        body = re.sub(r'^<main class="spec">', '<header class="spec" id="top">', body)
        body = re.sub(r'</main>$', '</header>', body)
    return css, body


def main(src, dst):
    manifest, order, root = bundle_parts(open(src, encoding='utf-8').read())
    _, _, cover = bundle_parts(asset(manifest[order[0]]).decode('utf-8'))
    toc = cover.split('class="spec-toc"', 1)[1].split('</nav>', 1)[0]
    hrefs = ['Main.dc.html'] + re.findall(r'href="(S[\w-]+\.dc\.html)"', toc)
    css_seen, css_all, boards = set(), [], []
    assert len(hrefs) == len(order), (hrefs, order)
    for uuid, href in zip(order, hrefs):
        _, _, page = bundle_parts(asset(manifest[uuid]).decode('utf-8'))
        css, body = board(page, anchor(href))
        for block in css:
            digest = hashlib.sha1(block.encode()).hexdigest()
            if digest not in css_seen:
                css_seen.add(digest)
                css_all.append(block)
        boards.append(body)
    title = re.search(r'<title>(.*?)</title>', root).group(1)
    out = ('<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           f'<title>{title}</title>\n{FONTS}\n<style>\n' + '\n\n'.join(css_all) +
           '\n</style>\n</head>\n<body>\n<main>\n' + '\n\n'.join(boards) + '\n</main>\n</body>\n</html>\n')
    open(dst, 'w', encoding='utf-8').write(out)


if __name__ == '__main__':
    main(*sys.argv[1:3])
