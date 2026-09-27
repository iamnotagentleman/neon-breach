# Renders UI portraits of the game models (transparent PNG, EEVEE, neon rim lighting).
#   Blender -b --factory-startup -P tools/blender/render_icons.py -- <models_dir> <out_dir> name [name ...]
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
models, out_dir, names = argv[0], argv[1], argv[2:]
os.makedirs(out_dir, exist_ok=True)


def area_light(name, color, energy, loc, target, size=2.0):
    l = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
    l.data.energy = energy
    l.data.color = color
    l.data.size = size
    l.location = loc
    l.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(l)


for name in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    engines = [i.identifier for i in sc.render.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 256
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.03, 0.09, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    bpy.ops.import_scene.gltf(filepath=os.path.join(models, name + '.glb'))
    # Strike a mid-stride pose for animated characters.
    for o in sc.objects:
        if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action:
            fr = o.animation_data.action.frame_range
            sc.frame_set(int(fr[0] + (fr[1] - fr[0]) * 0.3))
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in sc.objects:
        if o.type == 'MESH':
            ev = o.evaluated_get(dg)
            m = ev.to_mesh()
            pts += [ev.matrix_world @ v.co for v in m.vertices]
            ev.to_mesh_clear()
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo + hi) / 2
    r = max((hi - lo).length / 2, 1e-3)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 70
    d = Vector((0.75, -1.35, 0.75)).normalized()
    cam.location = c + d * r * 4.6
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(cam)
    sc.camera = cam
    area_light('key', (1, 0.93, 0.98), 420 * r * r, c + Vector((2, -3, 3.5)) * r, c, 3 * r)
    area_light('rimC', (0, 0.9, 1), 650 * r * r, c + Vector((-3.2, 2, 1.5)) * r, c, 2 * r)
    area_light('rimM', (1, 0.2, 0.85), 550 * r * r, c + Vector((3.4, 2.2, 0.8)) * r, c, 2 * r)
    sc.render.filepath = os.path.join(out_dir, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('icon', name)
