# Records the README animations with a headless browser.
#   pip install playwright && playwright install chromium
#   python3 -m http.server 8765 &   (from the repo root)
#   python3 tools/capture.py --url http://localhost:8765 --out docs
import argparse, asyncio, glob, os, subprocess, tempfile
from playwright.async_api import async_playwright

W, H = 1280, 800


async def record(url, steps, seconds, h=H):
    tmp = tempfile.mkdtemp()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': h}, record_video_dir=tmp, record_video_size={'width': W, 'height': h})
        pg = await ctx.new_page()
        await pg.goto(url)
        await pg.wait_for_timeout(1200)
        for s in steps:
            await s(pg)
        box = await pg.eval_on_selector('#board', 'e => { const r = e.getBoundingClientRect(); return [r.width, r.height, r.x, r.y].map(Math.round); }')
        await pg.wait_for_timeout(int(seconds * 1000))
        await ctx.close()
        await b.close()
    return glob.glob(os.path.join(tmp, '*.webm'))[0], tuple(v - v % 2 for v in box)


def to_gif(src, out, start, dur, speed=1.0, width=900, fps=12, crop=None, colors=128):
    vf = []
    if crop: vf.append('crop=%d:%d:%d:%d' % crop)
    if speed != 1: vf.append('setpts=PTS/%g' % speed)
    vf += ['fps=%d' % fps, 'scale=%d:-1:flags=lanczos' % width]
    chain = ','.join(vf)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(start), '-t', str(dur), '-i', src,
                    '-vf', f'{chain},split[a][b];[a]palettegen=max_colors={colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
                    out], check=True)
    print(out, os.path.getsize(out) // 1024, 'KB')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:8765')
    ap.add_argument('--out', default='docs')
    ap.add_argument('--what', default='all')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    if a.what in ('all', 'watch'):
        async def pick(pg):
            await pg.select_option('#watch-w', 'adult')
            await pg.select_option('#watch-b', 'adultRandom')
            await pg.click('#watch-start')
        v, _ = await record(a.url + '/index.html?mode=watch&view=2d&autostart=1', [], 26)
        to_gif(v, os.path.join(a.out, 'demo.gif'), 6.0, 16, width=900, fps=14)

    if a.what in ('all', 'watch3d'):
        async def pick3(pg):
            await pg.select_option('#watch-w', 'adult')
            await pg.select_option('#watch-b', 'adultRandom')
            await pg.click('#watch-start')
        v, _ = await record(a.url + '/index.html?mode=watch&view=3d&autostart=1', [], 32, h=880)
        to_gif(v, os.path.join(a.out, 'demo3d.gif'), 11.0, 18, width=900, fps=12, colors=160)

    if a.what == 'board':
        async def pick(pg):
            await pg.select_option('#watch-w', 'adult')
            await pg.select_option('#watch-b', 'adult')
            await pg.click('#watch-speed button[data-v="0.6"]')
            await pg.click('#watch-start')
        v, box = await record(a.url + '/index.html?mode=watch', [pick], 14)
        to_gif(v, os.path.join(a.out, 'fly.gif'), 1.6, 11, width=520, fps=16, crop=box)

    if a.what in ('all', 'train'):
        async def go(pg):
            await pg.evaluate("localStorage.removeItem('chessfly.mine')")
            await pg.reload()
            await pg.wait_for_timeout(1500)
            await pg.click('#train-toggle')
        v, _ = await record(a.url + '/index.html?mode=train&view=2d', [go], 75, h=1040)
        to_gif(v, os.path.join(a.out, 'learning.gif'), 2.0, 72, speed=6, width=860, fps=8, colors=96)


asyncio.run(main())
