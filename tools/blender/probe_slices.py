import bpy, sys, numpy as np
src = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
o = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.polygons) > 500)
V = np.array([tuple(o.matrix_world @ v.co) for v in o.data.vertices])
V -= [(V[:,0].min()+V[:,0].max())/2, (V[:,1].min()+V[:,1].max())/2, V[:,2].min()]
H = V[:,2].max()
print('H', round(H,3), 'x', V[:,0].min().round(2), V[:,0].max().round(2), 'y', V[:,1].min().round(2), V[:,1].max().round(2))
for f in np.linspace(0.02, 0.98, 25):
    z = f * H
    band = V[np.abs(V[:,2] - z) < H * 0.015]
    if not len(band): continue
    xs = np.sort(band[:,0])
    # find gaps in x to detect separate parts (legs / arms vs torso)
    gaps = np.where(np.diff(xs) > 0.06)[0]
    parts = []
    start = 0
    for g in list(gaps) + [len(xs) - 1]:
        parts.append((round(xs[start], 2), round(xs[g], 2)))
        start = g + 1
    print(f'{f:.2f} z={z:.2f} parts={parts} ymid={band[:,1].mean():.2f}')
