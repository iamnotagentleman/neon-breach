# Preview a processed GLB: head lifted 0.25 to show the split, emission rendered with EEVEE.
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
lift = float(argv[2]) if len(argv) > 2 else 0.25
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.context.scene.objects:
    if o.name.startswith('head'):
        o.location.z += lift
# marker for forward (-Y in Blender == +Z in glTF/three)
bpy.ops.mesh.primitive_cone_add(radius1=0.05, depth=0.15, location=(0, -0.9, 0.05), rotation=(math.radians(90), 0, 0))
m = bpy.data.materials.new('fwd'); m.use_nodes = True
bsdf = m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Emission Color'].default_value = (1, 0.2, 0.2, 1); bsdf.inputs['Emission Strength'].default_value = 5
bpy.context.object.data.materials.append(m)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
c = Vector((0, 0, 0.5)); d = Vector((1.3, -1.6, 1.1)).normalized()
cam.location = c + d * 2.6
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc = bpy.context.scene; sc.camera = cam
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [i.identifier for i in sc.render.bl_rna.properties['engine'].enum_items] else sc.render.engine
try:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    pass
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.04, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1
light = bpy.data.objects.new('key', bpy.data.lights.new('key', 'AREA')); light.data.energy = 250; light.data.size = 3
light.location = (2, -2, 3); light.rotation_euler = (Vector((0, 0, 0.4)) - light.location).to_track_quat('-Z', 'Y').to_euler()
sc.collection.objects.link(light)
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'AREA')); fill.data.energy = 80; fill.data.size = 3
fill.location = (-2.5, 1, 1.5); fill.rotation_euler = (Vector((0, 0, 0.4)) - fill.location).to_track_quat('-Z', 'Y').to_euler()
sc.collection.objects.link(fill)
sc.render.resolution_x = sc.render.resolution_y = 560
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out, sc.render.engine)
