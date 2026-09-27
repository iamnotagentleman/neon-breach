# Custom rig + hand-keyed walk cycle for the Heavy Mech (Meshy's auto-rig produced a broken skeleton for it).
#   Blender -b --factory-startup -P tools/blender/rig_mech.py -- <src.glb> <out.glb>
# Joint positions come from slicing the mesh (tools/blender/probe_slices.py): legs at x=+-0.38, crotch ~1.05,
# shoulders ~(+-0.6, 1.9), A-pose hands ~(+-1.03, 1.1), total height 2.4. Front faces -Y.
import bpy, sys, os, math
import numpy as np
from mathutils import Matrix, Vector, Quaternion

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_rigged import autoskin, decimate  # noqa: E402
from process_asset import shrink_textures  # noqa: E402

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh.data.transform(mesh.matrix_world); mesh.matrix_world = Matrix.Identity(4)
V = np.array([tuple(v.co) for v in mesh.data.vertices])
mesh.data.transform(Matrix.Translation((-(V[:, 0].min() + V[:, 0].max()) / 2, -(V[:, 1].min() + V[:, 1].max()) / 2, -V[:, 2].min())))
H = float(np.ptp(V[:, 2]))
decimate(10000)
k = H / 2.4  # joints below were measured on the 2.4-unit-tall mesh

J = {  # name: (head, tail, parent)
    'Hips': ((0, 0, 1.05), (0, 0, 1.35), None),
    'Spine': ((0, 0, 1.35), (0, 0, 1.9), 'Hips'),
    'Head': ((0, 0, 1.9), (0, 0, 2.4), 'Spine'),
    'UpLegL': ((0.38, 0, 1.05), (0.38, 0, 0.58), 'Hips'),
    'LegL': ((0.38, 0, 0.58), (0.38, 0, 0.18), 'UpLegL'),
    'FootL': ((0.38, 0, 0.18), (0.38, -0.3, 0.04), 'LegL'),
    'UpLegR': ((-0.38, 0, 1.05), (-0.38, 0, 0.58), 'Hips'),
    'LegR': ((-0.38, 0, 0.58), (-0.38, 0, 0.18), 'UpLegR'),
    'FootR': ((-0.38, 0, 0.18), (-0.38, -0.3, 0.04), 'LegR'),
    'ArmL': ((0.6, 0, 1.9), (0.86, 0, 1.5), 'Spine'),
    'ForeArmL': ((0.86, 0, 1.5), (1.03, 0, 1.1), 'ArmL'),
    'ArmR': ((-0.6, 0, 1.9), (-0.86, 0, 1.5), 'Spine'),
    'ForeArmR': ((-0.86, 0, 1.5), (-1.03, 0, 1.1), 'ArmR'),
}

arm_data = bpy.data.armatures.new('MechRig')
arm = bpy.data.objects.new('Armature', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, (h, t, parent) in J.items():
    b = arm_data.edit_bones.new(name)
    b.head = Vector(h) * k
    b.tail = Vector(t) * k
    b.roll = 0
for name, (_, _, parent) in J.items():
    if parent:
        arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
        arm_data.edit_bones[name].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

autoskin(power=12.0, top=2)

# ---- walk cycle ------------------------------------------------------------------------------------
FRAMES = 32
sc = bpy.context.scene
sc.render.fps = 24
sc.frame_start, sc.frame_end = 0, FRAMES
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')


def set_rot(name, axis, deg, frame):
    """Rotate a bone about an armature-space axis through its head, keyframed as a local quaternion."""
    pb = arm.pose.bones[name]
    rest = pb.bone.matrix_local.to_3x3()
    R = Quaternion(Vector(axis), math.radians(deg)).to_matrix()
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (rest.inverted() @ R @ rest).to_quaternion()
    pb.keyframe_insert('rotation_quaternion', frame=frame)


def set_rot2(name, axes_degs, frame):
    pb = arm.pose.bones[name]
    rest = pb.bone.matrix_local.to_3x3()
    R = Matrix.Identity(3)
    for axis, deg in axes_degs:
        R = Quaternion(Vector(axis), math.radians(deg)).to_matrix() @ R
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (rest.inverted() @ R @ rest).to_quaternion()
    pb.keyframe_insert('rotation_quaternion', frame=frame)


X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
for f in range(FRAMES + 1):
    p = 2 * math.pi * f / FRAMES
    s, c = math.sin(p), math.cos(p)
    # Legs: negative X-rotation swings a hanging leg forward (-Y is front).
    hipL, hipR = -s * 26, s * 26
    kneeL, kneeR = max(0.0, c) * 48, max(0.0, -c) * 48
    set_rot('UpLegL', X, hipL, f)
    set_rot('UpLegR', X, hipR, f)
    set_rot('LegL', X, kneeL, f)
    set_rot('LegR', X, kneeR, f)
    set_rot('FootL', X, -(hipL + kneeL) * 0.6, f)
    set_rot('FootR', X, -(hipR + kneeR) * 0.6, f)
    # Heavy hip dip on each footfall + side sway.
    hips = arm.pose.bones['Hips']
    hips.location = (0, -abs(math.sin(p)) * 0.07 * k + 0.035 * k, 0)
    hips.keyframe_insert('location', frame=f)
    set_rot2('Hips', [(Y, s * 4), (Z, -s * 5)], f)
    set_rot2('Spine', [(X, 7), (Z, s * 9), (Y, -s * 3)], f)
    set_rot2('Head', [(X, -4 + abs(s) * 3), (Z, -s * 6)], f)
    # Arms swing opposite to the legs.
    set_rot('ArmL', X, s * 20, f)
    set_rot('ArmR', X, -s * 20, f)
    set_rot('ForeArmL', X, -12 + s * 10, f)
    set_rot('ForeArmR', X, -12 - s * 10, f)
bpy.ops.object.mode_set(mode='OBJECT')
arm.animation_data.action.name = 'walk'
for fc in getattr(arm.animation_data.action, 'fcurves', []):
    for kp in fc.keyframe_points:
        kp.interpolation = 'BEZIER'

shrink_textures(1024)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=88,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_animations=True, export_skins=True, export_yup=True,
)
print('rigged', out, os.path.getsize(out) // 1024, 'KB', 'height', round(H, 2))
