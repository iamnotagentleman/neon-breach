# Render a quick textured preview of a GLB with axis markers: red = +X, green = +Y, blue = +Z.
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
view = argv[2] if len(argv) > 2 else 'iso'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
c = (lo + hi) / 2; r = (hi - lo).length / 2
def marker(loc, col):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r * 0.06, location=loc)
    m = bpy.data.materials.new('m'); m.diffuse_color = col; bpy.context.object.data.materials.append(m)
marker(c + mathutils.Vector((r * 1.1, 0, 0)), (1, 0, 0, 1))
marker(c + mathutils.Vector((0, r * 1.1, 0)), (0, 1, 0, 1))
marker(c + mathutils.Vector((0, 0, r * 1.1)), (0, 0, 1, 1))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
dirs = {'iso': (1, -1.4, 0.9), 'front': (0, -1, 0.15), 'side': (1, 0, 0.15), 'top': (0.001, -0.001, 1)}
d = mathutils.Vector(dirs[view]).normalized()
cam.location = c + d * r * 3.2
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = sc.render.resolution_y = 640
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out, 'bounds', tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi))
