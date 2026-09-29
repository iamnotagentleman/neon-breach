# Contact sheet frames for every animation clip in a rigged GLB (flat-shaded workbench render, fixed camera).
#   Blender -b --factory-startup -P tools/blender/preview_clips.py -- model.glb out_dir [frames_per_clip] [view x,y,z]
import bpy, sys, os
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
src, outdir = a[0], a[1]
N = int(a[2]) if len(a) > 2 else 6
view = Vector([float(v) for v in a[3].split(',')]) if len(a) > 3 else Vector((1.2, -1.6, 0.9))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
rig = next(o for o in sc.objects if o.type == 'ARMATURE')
mesh = next(o for o in sc.objects if o.type == 'MESH')
lo = Vector([min((mesh.matrix_world @ Vector(c))[i] for c in mesh.bound_box) for i in range(3)])
hi = Vector([max((mesh.matrix_world @ Vector(c))[i] for c in mesh.bound_box) for i in range(3)])
c = (lo + hi) / 2; size = (hi - lo).length
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size * 1.05
cam.location = c + view.normalized() * size * 3; cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
sh = sc.display.shading; sc.render.engine = 'BLENDER_WORKBENCH'; sh.light = 'STUDIO'; sh.color_type = 'OBJECT'
sh.show_cavity = True; sh.background_type = 'VIEWPORT'; sh.background_color = (0.62, 0.64, 0.68)
bpy.ops.mesh.primitive_plane_add(size=size * 30, location=(c.x, c.y, 0))
bpy.context.object.color = (0.35, 0.37, 0.42, 1); mesh.color = (0.85, 0.85, 0.88, 1)
sc.render.resolution_x = sc.render.resolution_y = 360
os.makedirs(outdir, exist_ok=True)
for act in bpy.data.actions:
    rig.animation_data.action = act
    f0, f1 = act.frame_range
    for i in range(N):
        sc.frame_set(round(f0 + (f1 - f0) * i / max(N - 1, 1)))
        sc.render.filepath = os.path.join(outdir, f'{act.name}_{i}.png')
        bpy.ops.render.render(write_still=True)
    print('clip', act.name, act.frame_range[:])
