# Workbench-textured iso previews of many GLBs in one Blender session: -- out_dir a.glb b.glb ...
import bpy, sys, os, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
out_dir = argv[0]
for src in argv[1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    pts = [o.matrix_world @ mathutils.Vector(c) for o in objs for c in o.bound_box]
    lo = mathutils.Vector([min(p[i] for p in pts) for i in range(3)]); hi = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo + hi) / 2; r = (hi - lo).length / 2
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
    d = mathutils.Vector((0.35, -1, 0.55)).normalized()
    cam.location = c + d * r * 2.9
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc = bpy.context.scene; sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = sc.render.resolution_y = 400
    sc.render.filepath = os.path.join(out_dir, os.path.basename(src).replace('.glb', '.png'))
    bpy.ops.render.render(write_still=True)
    print('rendered', sc.render.filepath)
