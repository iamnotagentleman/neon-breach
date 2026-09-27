import bpy, sys, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
for path in argv:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    print('==', path.split('/')[-1])
    for o in bpy.context.scene.objects:
        line = f'  {o.name} {o.type} dims={tuple(round(v,3) for v in o.dimensions)} loc={tuple(round(v,3) for v in o.location)} rot={tuple(round(v,3) for v in o.rotation_euler)} scale={tuple(round(v,3) for v in o.scale)}'
        if o.type == 'MESH':
            bb = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
            line += f' faces={len(o.data.polygons)} mats={[m.name for m in o.data.materials]}'
            line += f' x=[{min(v.x for v in bb):.3f},{max(v.x for v in bb):.3f}] y=[{min(v.y for v in bb):.3f},{max(v.y for v in bb):.3f}] z=[{min(v.z for v in bb):.3f},{max(v.z for v in bb):.3f}]'
        print(line)
    for m in bpy.data.materials:
        if m.use_nodes:
            print('  mat', m.name, sorted({n.type for n in m.node_tree.nodes}))
    print('  images', [(i.name, tuple(i.size)) for i in bpy.data.images])
    print('  actions', [(a.name, a.frame_range[:]) for a in bpy.data.actions])
