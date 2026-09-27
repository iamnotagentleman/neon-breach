# Auto-rig + tripod-gait crawl cycle for multi-legged crawler models (Replicator, Nano-Mite).
#   Blender -b --factory-startup -P tools/blender/rig_spider.py -- <src.glb> <out.glb> <legs> <maxdim> <decimate> [emission hue]
# Legs are found by clustering the low, outer vertices by angle; each leg gets hip->knee->foot bones placed on
# the mesh (the knee is the top of the leg's arch). Alternating tripods lift and swing while the body bobs.
import bpy, sys, os, math
import numpy as np
from mathutils import Matrix, Vector, Quaternion

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_rigged import autoskin, decimate  # noqa: E402
from process_asset import shrink_textures, build_emission  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
src, out, LEGS, MAXDIM, DECIM = args[0], args[1], int(args[2]), float(args[3]), int(args[4])
HUE = float(args[5]) if len(args) > 5 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh.data.transform(mesh.matrix_world); mesh.matrix_world = Matrix.Identity(4)
V = np.array([tuple(v.co) for v in mesh.data.vertices])
mesh.data.transform(Matrix.Translation((-(V[:, 0].min() + V[:, 0].max()) / 2, -(V[:, 1].min() + V[:, 1].max()) / 2, -V[:, 2].min())))
V = np.array([tuple(v.co) for v in mesh.data.vertices])
k = MAXDIM / max(np.ptp(V[:, 0]), np.ptp(V[:, 1]), np.ptp(V[:, 2]))
mesh.data.transform(Matrix.Scale(k, 4))
decimate(DECIM)
V = np.array([tuple(v.co) for v in mesh.data.vertices])

H = V[:, 2].max()
r = np.hypot(V[:, 0], V[:, 1])
ang = np.arctan2(V[:, 1], V[:, 0])
rmax = r.max()
upper = r[V[:, 2] > 0.55 * H]
R_body = float(np.percentile(upper, 90)) if len(upper) else 0.4 * rmax

# Foot candidates: low and far from the axis. Cluster their directions into LEGS groups (k-means on the circle).
sel = (V[:, 2] < 0.22 * H) & (r > max(R_body * 1.05, 0.5 * rmax))
dirs = np.stack([np.cos(ang[sel]), np.sin(ang[sel])], 1)
best = None
for off in np.linspace(0, 2 * np.pi / LEGS, 12, endpoint=False):
    cent = np.stack([np.cos(off + np.arange(LEGS) * 2 * np.pi / LEGS), np.sin(off + np.arange(LEGS) * 2 * np.pi / LEGS)], 1)
    for _ in range(25):
        lab = np.argmax(dirs @ cent.T, 1)
        for j in range(LEGS):
            m = dirs[lab == j]
            if len(m):
                c = m.mean(0); cent[j] = c / (np.linalg.norm(c) + 1e-9)
    score = (dirs * cent[lab]).sum()
    if best is None or score > best[0]:
        best = (score, cent.copy())
cent = best[1]
thetas = sorted(float(math.atan2(c[1], c[0])) for c in cent)

legs = []
for th in thetas:
    d = np.abs((ang - th + np.pi) % (2 * np.pi) - np.pi)
    leg = (d < math.radians(14)) & (r > R_body * 0.9)
    if leg.sum() < 10:
        continue
    lv, lr = V[leg], r[leg]
    tip_r = float(np.percentile(lr, 98))
    tip_z = float(np.percentile(lv[:, 2][lr > tip_r * 0.9], 10))
    arch = lv[(lr > R_body) & (lr < tip_r * 0.85)]
    knee_i = np.argmax(arch[:, 2]) if len(arch) else None
    knee_r = float(np.hypot(*arch[knee_i, :2])) if knee_i is not None else (R_body + tip_r) / 2
    knee_z = float(arch[knee_i, 2]) if knee_i is not None else H * 0.5
    near_hip = lv[(lr > R_body * 0.9) & (lr < R_body * 1.25)]
    hip_z = float(near_hip[:, 2].mean()) if len(near_hip) else H * 0.4
    c, s = math.cos(th), math.sin(th)
    legs.append({
        'theta': th,
        'hip': Vector((c * R_body * 0.8, s * R_body * 0.8, hip_z)),
        'knee': Vector((c * knee_r, s * knee_r, knee_z)),
        'foot': Vector((c * tip_r, s * tip_r, tip_z)),
    })
print(f'   body radius {R_body:.3f}, legs found {len(legs)} at', [round(math.degrees(l["theta"])) for l in legs])

arm_data = bpy.data.armatures.new('CrawlerRig')
arm = bpy.data.objects.new('Armature', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
body = arm_data.edit_bones.new('Body')
body.head = Vector((0, 0, H * 0.15)); body.tail = Vector((0, 0, H * 0.95))
for i, L in enumerate(legs):
    a = arm_data.edit_bones.new(f'Leg{i}A'); a.head, a.tail, a.parent = L['hip'], L['knee'], body
    b = arm_data.edit_bones.new(f'Leg{i}B'); b.head, b.tail, b.parent = L['knee'], L['foot'], a
bpy.ops.object.mode_set(mode='OBJECT')

autoskin(power=10.0, top=2)
# Lock the shell to the body: anything inside the body radius must not follow the legs.
body_vg = mesh.vertex_groups['Body']
leg_vgs = [g for g in mesh.vertex_groups if g.name != 'Body']
core = [i for i in range(len(V)) if r[i] < R_body * 0.98 or (V[i, 2] > H * 0.5 and r[i] < R_body * 1.15)]
for g in leg_vgs:
    g.remove(core)
body_vg.add(core, 1.0, 'REPLACE')
print(f'   locked {len(core)} shell verts to Body')

FRAMES = 20
sc = bpy.context.scene
sc.render.fps = 24
bpy.ops.object.mode_set(mode='POSE')


def key_rot(name, rots, frame):
    pb = arm.pose.bones[name]
    rest = pb.bone.matrix_local.to_3x3()
    R = Matrix.Identity(3)
    for axis, deg in rots:
        R = Quaternion(Vector(axis), math.radians(deg)).to_matrix() @ R
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (rest.inverted() @ R @ rest).to_quaternion()
    pb.keyframe_insert('rotation_quaternion', frame=frame)


for f in range(FRAMES + 1):
    p = 2 * math.pi * f / FRAMES
    for i, L in enumerate(legs):
        ph = p + (0 if i % 2 == 0 else math.pi)  # alternating tripods
        th = L['theta']
        swing = math.sin(ph) * 16
        lift = max(0.0, math.cos(ph)) * 22
        lift_axis = (math.sin(th), -math.cos(th), 0)  # +angle raises an outward-pointing leg
        key_rot(f'Leg{i}A', [((0, 0, 1), swing), (lift_axis, lift)], f)
        key_rot(f'Leg{i}B', [(lift_axis, -lift * 0.55)], f)
    bodyb = arm.pose.bones['Body']
    bodyb.location = (0, abs(math.sin(p)) * 0.025 * H, 0)
    bodyb.keyframe_insert('location', frame=f)
    key_rot('Body', [((1, 0, 0), math.sin(p * 2) * 2.5), ((0, 1, 0), math.cos(p) * 2)], f)
bpy.ops.object.mode_set(mode='OBJECT')
arm.animation_data.action.name = 'crawl'

if HUE is not None:
    for mat in bpy.data.materials:
        if mat.use_nodes:
            build_emission(mat, {'hues': [HUE], 'tol': 30, 'smin': 0.45, 'vmin': 0.45, 'strength': 3})
shrink_textures(1024)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=88,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_animations=True, export_skins=True, export_yup=True,
)
print('rigged', out, os.path.getsize(out) // 1024, 'KB')
