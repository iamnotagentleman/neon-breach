# Path-colored tier-5 variants of a processed tower GLB: the neon (emissive) layer is hue-shifted to the path
# color and brightened, and the armor gets a light tint, so each capstone reads as its own evolved form.
#   Blender -b --factory-startup -P tools/blender/recolor_variant.py -- <src.glb> <out.glb> <#rrggbb> [tint]
import bpy, sys, os
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
src, out, hexcol = args[0], args[1], args[2]
tint = float(args[3]) if len(args) > 3 else 0.14
target = np.array([int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)
t_max, t_min = target.max(), target.min()


def rgb_to_hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn + 1e-6
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    return h, np.where(mx > 1e-5, (mx - mn) / (mx + 1e-6), 0), mx


def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    conds = [i == k for k in range(6)]
    r = np.select(conds, [v, q, p, p, t, v]); g = np.select(conds, [t, v, v, q, p, p]); b = np.select(conds, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)


th, ts, _ = rgb_to_hsv(target[None, None, :])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
done = set()
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    for socket, mode in (('Emission Color', 'neon'), ('Base Color', 'armor')):
        links = bsdf.inputs[socket].links
        if not links or links[0].from_node.type != 'TEX_IMAGE':
            continue
        img = links[0].from_node.image
        if img.name in done:
            continue
        done.add(img.name)
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        rgb = px[..., :3]
        if mode == 'neon':
            hh, ss, vv = rgb_to_hsv(rgb)
            lit = vv > 0.02
            new = hsv_to_rgb(np.full_like(hh, th[0, 0]), np.clip(np.maximum(ss, 0.6) * min(1.0, ts[0, 0] + 0.2), 0, 1), np.clip(vv * 1.25, 0, 1))
            rgb[:] = np.where(lit[..., None], new, rgb)
        else:
            luma = (rgb * [0.3, 0.59, 0.11]).sum(-1, keepdims=True)
            rgb[:] = np.clip(rgb * (1 - tint) + target * luma * tint * 2.2, 0, 1)
        img.pixels = px.ravel()
        img.pack()
    bsdf.inputs['Emission Strength'].default_value = bsdf.inputs['Emission Strength'].default_value * 1.35 + 0.5

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=88,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_yup=True,
)
print('variant', os.path.basename(out), hexcol, os.path.getsize(out) // 1024, 'KB')
