# Render a few frames of a rigged GLB's animation side by side: -- src.glb out_prefix
import bpy, sys, mathutils
src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
fr = arm.animation_data.action.frame_range
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
mesh = next(o for o in sc.objects if o.type == 'MESH' and len(o.data.polygons) > 500)
pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)]); hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
c = (lo + hi) / 2; size = (hi - lo).length
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size * 1.25
cam.location = c + mathutils.Vector((1.6, -1.1, 0.9)).normalized() * size * 3; cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
sc.render.resolution_x = sc.render.resolution_y = 320
for i, f in enumerate([fr[0], fr[0] + (fr[1] - fr[0]) * 0.25, fr[0] + (fr[1] - fr[0]) * 0.5, fr[0] + (fr[1] - fr[0]) * 0.75]):
    sc.frame_set(int(f))
    sc.render.filepath = f'{out}_{i}.png'
    bpy.ops.render.render(write_still=True)
print('done', fr[:])
