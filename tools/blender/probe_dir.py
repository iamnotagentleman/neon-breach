import bpy, sys, numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
for src in argv:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    for o in bpy.context.scene.objects:
        if o.type != 'MESH': continue
        m = o.matrix_world
        V = np.array([tuple(m @ v.co) for v in o.data.vertices])
        r = np.hypot(V[:, 0], V[:, 1])
        far = V[r > np.percentile(r, 99)]
        c = far.mean(axis=0)
        print(src.split('/')[-1], o.name, 'n', len(V), 'extreme-dir xy', np.round(c[:2] / np.linalg.norm(c[:2]), 2), 'z', round(c[2], 2),
              'x', np.round([V[:,0].min(), V[:,0].max()], 2), 'y', np.round([V[:,1].min(), V[:,1].max()], 2), 'z', np.round([V[:,2].min(), V[:,2].max()], 2))
