import bpy, sys
from mathutils import Vector
for src in sys.argv[sys.argv.index('--') + 1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.polygons) > 500)
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    print('==', src.split('/')[-1], 'mesh lo', tuple(round(x, 2) for x in lo), 'hi', tuple(round(x, 2) for x in hi), 'arm scale', tuple(round(x, 3) for x in arm.scale), 'mesh parent', mesh.parent and mesh.parent.name)
    for bn in ['Hips', 'Spine02', 'Head', 'LeftArm', 'RightArm', 'LeftUpLeg', 'LeftFoot', 'RightFoot', 'LeftHand']:
        b = arm.data.bones.get(bn)
        if b:
            h = arm.matrix_world @ b.head_local
            print('   ', bn.ljust(10), tuple(round(x, 2) for x in h))
    print('    bones:', [b.name for b in arm.data.bones][:30])
