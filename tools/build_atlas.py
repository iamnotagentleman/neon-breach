# Packs rendered VFX frames into sprite-sheet atlases: python3 tools/build_atlas.py <frames_dir> <out_dir>
import sys, os, glob, math
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for name in sorted(os.listdir(src)):
    frames = sorted(glob.glob(os.path.join(src, name, '*.png')))
    if not frames:
        continue
    ims = [Image.open(f).convert('RGBA') for f in frames]
    w, h = ims[0].size
    cols = math.ceil(math.sqrt(len(ims)))
    rows = math.ceil(len(ims) / cols)
    sheet = Image.new('RGBA', (w * cols, h * rows), (0, 0, 0, 0))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    path = os.path.join(out, f'{name}_{cols}x{rows}_{len(ims)}.png')
    sheet.save(path, optimize=True)
    print(path, sheet.size, os.path.getsize(path) // 1024, 'KB')
