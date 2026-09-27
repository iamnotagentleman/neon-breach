import bpy, sys
for src in sys.argv[sys.argv.index('--') + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            mods = [(m.type, getattr(m, 'object', None) and m.object.name) for m in o.modifiers]
            print(src.split('/')[-1], o.name, 'faces', len(o.data.polygons), 'parent', o.parent and o.parent.name, 'mods', mods, 'vgroups', len(o.vertex_groups))
