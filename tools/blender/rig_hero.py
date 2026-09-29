# Custom rig + procedural animation set for the hero war bot (Tripo H3.1 mesh, legs repaired by fix_hero.py).
#   Blender -b --factory-startup -P tools/blender/rig_hero.py -- concept/raw/hero_warbot_fixed.glb assets/models/hero_warbot.glb [decimate]
# Front faces -Y and the robot's own left is +X; units are Tripo's (0.92 tall, feet at z=0). Joints were read off
# per-limb profiles of the fixed mesh. Skinning is rigid per mesh island (hard-surface panels never bend). Legs are
# posed with an analytic IK (coxa yaw at the body + 2-bone femur/tibia solve in the leg plane) so feet stay planted;
# every clip is keyed as plain FK, so nothing needs baking.
# Clips: idle, walk, run, turn_left, turn_right, fire, hit, death, activate.
import bpy, sys, os, math
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_rigged import decimate  # noqa: E402
from process_asset import shrink_textures, build_emission  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
DECIM = int(args[2]) if len(args) > 2 else 45000
FPS = 24
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh.data.transform(mesh.matrix_world); mesh.matrix_world = Matrix.Identity(4)
decimate(DECIM)
me = mesh.data
V = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', V); V = V.reshape(-1, 3)

# ---- skeleton ------------------------------------------------------------------------------------------------
# Legs: (t along the leg's ground direction, z) of body hip, hip disc, knee, ankle, sole.
PROFILE = {
    'front': [(0.09, 0.37), (0.225, 0.213), (0.302, 0.335), (0.402, 0.09), (0.45, 0.0)],
    'back': [(0.11, 0.34), (0.285, 0.225), (0.402, 0.38), (0.54, 0.112), (0.56, 0.03)],
}
LEGS = {  # name: (profile, ground direction in degrees, island-centroid sector)
    'FL': ('front', -18.1, (-60, 10)), 'FR': ('front', 198.1, (170, 240)),
    'BL': ('back', 44.0, (10, 80)), 'BR': ('back', 136.0, (100, 170)),
}
BODY_PIVOT = Vector((0, 0.03, 0.35))
HEAD_PIVOT = Vector((0, -0.02, 0.40))
SPINE_PIVOT = Vector((0, 0.12, 0.45))
ARM = {  # robot's left arm; the right one mirrors x
    'UpperArm': ((0.17, 0.17, 0.563), (0.17, 0.27, 0.682)),
    'ForeArm': ((0.17, 0.27, 0.682), (0.19, 0.14, 0.835)),
    'Gun': ((0.19, 0.14, 0.835), (0.225, -0.2, 0.84)),
    'Barrel': ((0.225, -0.2, 0.84), (0.225, -0.34, 0.84)),
}

# Mesh islands and their centroids (weights and leg joint offsets are decided per island).
E = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get('vertices', E)
par = np.arange(len(V))


def find(a):
    while par[a] != a:
        par[a] = par[par[a]]; a = par[a]
    return a


for a, b in E.reshape(-1, 2):
    ra, rb = find(a), find(b)
    if ra != rb:
        par[ra] = rb
_, inv = np.unique([find(i) for i in range(len(V))], return_inverse=True)
n_isl = inv.max() + 1
cen = np.zeros((n_isl, 3)); np.add.at(cen, inv, V); cen /= np.bincount(inv)[:, None]
c_r = np.hypot(cen[:, 0], cen[:, 1]); c_ang = np.degrees(np.arctan2(cen[:, 1], cen[:, 0]))


def in_sector(a, lo, hi):
    return ((a - lo) % 360) < (hi - lo)


legs = {}
for name, (prof, deg, (s0, s1)) in LEGS.items():
    u = Vector((math.cos(math.radians(deg)), math.sin(math.radians(deg)), 0))
    perp = Vector((-u.y, u.x, 0))
    t = cen[:, :2] @ np.array(u[:2]); w = cen[:, :2] @ np.array(perp[:2])
    isl = in_sector(c_ang, s0, s1) & (c_r >= 0.12) & (cen[:, 2] < 0.45) & (np.abs(w) < 0.16)
    vm = isl[inv]
    vt = V[vm][:, :2] @ np.array(u[:2]); vw = V[vm][:, :2] @ np.array(perp[:2]); vz = V[vm][:, 2]
    joints = []
    for jt, jz in PROFILE[prof]:
        near = np.hypot(vt - jt, vz - jz) < 0.04
        jw = float(vw[near].mean()) if near.any() else float(vw.mean())
        joints.append(u * jt + perp * jw + Z * jz)
    legs[name] = dict(u=u, n=u.cross(Z).normalized(), J=joints, islands=isl)
    print(f'   leg {name}: {isl.sum()} islands, lateral offsets {[round(j.dot(perp), 3) for j in joints]}')

BONES = [('Root', (0, 0, 0), (0, 0, 0.12), None),
         ('Body', (0, 0.03, 0.30), (0, 0.03, 0.44), 'Root'),
         ('Head', tuple(HEAD_PIVOT), (0, -0.22, 0.40), 'Body'),
         ('Spine', tuple(SPINE_PIVOT), (0, 0.12, 0.72), 'Body'),
         ('Strut', (0, 0.02, 0.33), (0, 0.02, 0.09), 'Body')]
for side, sx in (('L', 1), ('R', -1)):
    prev = 'Spine'
    for part, (h, t) in ARM.items():
        BONES.append((f'{part}_{side}', (h[0] * sx, h[1], h[2]), (t[0] * sx, t[1], t[2]), prev))
        prev = f'{part}_{side}'
for name, L in legs.items():
    J = L['J']
    for i, part in enumerate(('Coxa', 'Femur', 'Tibia', 'Foot')):
        BONES.append((f'{part}_{name}', tuple(J[i]), tuple(J[i + 1]), 'Body' if i == 0 else f'{("Coxa", "Femur", "Tibia")[i - 1]}_{name}'))

arm_data = bpy.data.armatures.new('HeroRig')
rig = bpy.data.objects.new('HeroRig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, _ in BONES:
    b = arm_data.edit_bones.new(name); b.head, b.tail, b.roll = Vector(h), Vector(t), 0
for name, _, _, parent in BONES:
    if parent:
        arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
PARENT = {name: parent for name, _, _, parent in BONES}
REST = {b.name: b.matrix_local.copy() for b in arm_data.bones}

# ---- rigid skinning ------------------------------------------------------------------------------------------
def seg_dist(P, h, t):
    h, t = np.array(h), np.array(t); d = t - h
    s = np.clip(((P - h) @ d) / max(d @ d, 1e-9), 0, 1)
    return np.linalg.norm(P - (h + s[:, None] * d), axis=1)


HEADS = {name: (h, t) for name, h, t, _ in BONES}
owner = np.empty(n_isl, dtype=object)
for i in range(n_isl):
    c = cen[i]
    leg = next((k for k, L in legs.items() if L['islands'][i]), None)
    if leg:
        group = [f'{p}_{leg}' for p in ('Coxa', 'Femur', 'Tibia', 'Foot')]
    elif c[2] > 0.74 or (abs(c[0]) > 0.155 and c[2] > 0.45):
        group = [f'{p}_{"L" if c[0] > 0 else "R"}' for p in ARM]
    elif abs(c[0]) < 0.07 and c[2] < 0.30:
        group = ['Strut']
    elif abs(c[0]) < 0.165 and c[1] < 0.03 and 0.35 < c[2] < 0.70:
        group = ['Head']
    elif abs(c[0]) < 0.165 and c[1] >= 0.03 and c[2] >= 0.45:
        group = ['Spine']
    else:
        group = ['Body']
    if len(group) == 1:
        owner[i] = group[0]
        continue
    P = V[inv == i]  # majority vote of the island's vertices over the limb's bone segments
    d = np.stack([seg_dist(P, *HEADS[g]) for g in group], 1)
    owner[i] = group[np.bincount(d.argmin(1), minlength=len(group)).argmax()]
mesh.parent = rig
mod = mesh.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
for name, *_ in BONES:
    idx = np.where(owner[inv] == name)[0]
    if len(idx):
        mesh.vertex_groups.new(name=name).add(idx.tolist(), 1.0, 'REPLACE')
counts = {name: int((owner[inv] == name).sum()) for name, *_ in BONES}
print('   weights:', {k: v for k, v in counts.items() if v})

# ---- pose evaluation -----------------------------------------------------------------------------------------
def about(p, axis, deg):
    p = Vector(p)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis)) @ Matrix.Translation(-p)


def leg_ik(L, target):
    """Deltas (in the body's rest frame) for coxa, femur, tibia so the ankle reaches `target`; plus the coxa yaw."""
    Hb, D, K, A, _ = L['J']
    u, n = L['u'], L['n']
    ang = lambda v: math.atan2(v.y, v.x)
    psi = math.degrees(ang(target - Hb) - ang(A - Hb))
    psi = (psi + 180) % 360 - 180
    tgt = about(Hb, Z, -psi) @ target
    p2 = lambda v: (v.dot(u), v.z)
    f0, t0, g = p2(K - D), p2(A - K), p2(tgt - D)
    l1, l2 = math.hypot(*f0), math.hypot(*t0)
    d = min(max(math.hypot(*g), abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    th1 = math.atan2(g[1], g[0]) + math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))  # knee up
    kx, kz = l1 * math.cos(th1), l1 * math.sin(th1)
    gx, gz = g[0] * d / math.hypot(*g), g[1] * d / math.hypot(*g)
    th2 = math.atan2(gz - kz, gx - kx)
    th1r, th2r = math.atan2(f0[1], f0[0]), math.atan2(t0[1], t0[0])
    a1 = math.degrees(th1 - th1r)
    a2 = math.degrees((th2 - th1) - (th2r - th1r))
    coxa = about(Hb, Z, psi)
    femur = coxa @ about(D, n, a1)
    tibia = femur @ about(K, n, a2)
    return coxa, femur, tibia, psi


def neutral():
    return dict(root_off=Vector(), root_rot=(0, 0, 0), body_off=Vector(), body_rot=(0, 0, 0),
                head=(0, 0), spine=(0, 0), strut=0.0,
                arm={s: dict(sh=0.0, el=0.0, gp=0.0, gy=0.0, back=0.0, barrel=0.0) for s in 'LR'},
                feet={k: Vector() for k in legs}, foot_pitch={k: 0.0 for k in legs})


def rot3(pivot, rx, ry, rz):
    return about(pivot, Z, rz) @ about(pivot, X, rx) @ about(pivot, Y, ry)


def deltas(p):
    D = {}
    D['Root'] = Matrix.Translation(p['root_off']) @ rot3((0, 0, 0), *p['root_rot'])
    D['Body'] = D['Root'] @ Matrix.Translation(p['body_off']) @ rot3(BODY_PIVOT, *p['body_rot'])
    D['Head'] = D['Body'] @ about(HEAD_PIVOT, Z, p['head'][0]) @ about(HEAD_PIVOT, X, p['head'][1])
    D['Spine'] = D['Body'] @ about(SPINE_PIVOT, Z, p['spine'][0]) @ about(SPINE_PIVOT, X, p['spine'][1])
    D['Strut'] = D['Body'] @ about(HEADS['Strut'][0], X, p['strut'])
    for s in 'LR':
        a = p['arm'][s]
        D[f'UpperArm_{s}'] = D['Spine'] @ about(HEADS[f'UpperArm_{s}'][0], X, a['sh'])
        D[f'ForeArm_{s}'] = D[f'UpperArm_{s}'] @ about(HEADS[f'ForeArm_{s}'][0], X, a['el'])
        w = HEADS[f'Gun_{s}'][0]
        D[f'Gun_{s}'] = D[f'ForeArm_{s}'] @ about(w, X, a['gp']) @ about(w, Z, a['gy']) @ Matrix.Translation((0, a['back'], 0))
        D[f'Barrel_{s}'] = D[f'Gun_{s}'] @ Matrix.Translation((0, a['barrel'], 0))
    body_inv = D['Body'].inverted()
    for k, L in legs.items():
        A = L['J'][3]
        coxa, femur, tibia, psi = leg_ik(L, body_inv @ (A + p['feet'][k]))
        D[f'Coxa_{k}'], D[f'Femur_{k}'], D[f'Tibia_{k}'] = D['Body'] @ coxa, D['Body'] @ femur, D['Body'] @ tibia
        # The foot stays level in the world (it only turns with the leg's yaw), whatever the body's pitch and roll.
        ankle = D[f'Tibia_{k}'] @ A
        yaw = Matrix.Rotation(math.radians(p['root_rot'][2] + p['body_rot'][2] + psi), 4, Z)
        D[f'Foot_{k}'] = about(ankle, yaw.to_3x3() @ L['n'], p['foot_pitch'][k]) @ Matrix.Translation(ankle) @ yaw @ Matrix.Translation(-A)
    return D


def key_clip(name, frames, pose_fn, loop):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    last = {}
    for f in range(frames + 1):
        D = deltas(pose_fn(f / frames, f))
        for b, _ in REST.items():
            rest = REST[b]
            parent = PARENT[b]
            local = (D[parent].inverted() @ D[b]) if parent else D[b]
            loc, q, _ = (rest.inverted() @ local @ rest).decompose()
            if b in last and last[b].dot(q) < 0:
                q.negate()
            last[b] = q
            pb = rig.pose.bones[b]; pb.rotation_mode = 'QUATERNION'
            pb.location, pb.rotation_quaternion = loc, q
            pb.keyframe_insert('location', frame=f); pb.keyframe_insert('rotation_quaternion', frame=f)
    act.use_frame_range = True; act.frame_start, act.frame_end = 0, frames
    act.use_cyclic = loop
    print(f'   clip {name}: {frames} frames ({frames / FPS:.2f}s){" loop" if loop else ""}')


# ---- motion helpers -------------------------------------------------------------------------------------------
TAU = 2 * math.pi
smooth = lambda s: s * s * (3 - 2 * s)


def kick(dt, decay=2.5):
    """Impulse: rises within a frame, then decays."""
    return 0.0 if dt < 0 else (dt if dt < 1 else math.exp(-(dt - 1) / decay))


def gait(p, t, phases, duty, step, lift, rotate=None):
    """Plants and swings each foot. `step`: stride vector (walking toward it) or, with rotate=deg, a turn in place."""
    lifted = {}
    for k, ph in phases.items():
        c = (t + ph) % 1.0
        if c < duty:
            s, h = 0.5 - c / duty, 0.0
        else:
            q = (c - duty) / (1 - duty)
            s, h = -0.5 + smooth(q), math.sin(math.pi * q) * (1 - 0.25 * q)
        rest = legs[k]['J'][3]
        if rotate is None:
            off = step * s
        else:
            off = about(BODY_PIVOT, Z, rotate * s) @ rest - rest
        p['feet'][k] = off + Vector((0, 0, lift * h))
        p['foot_pitch'][k] = -14 * h
        lifted[k] = h
    # Shift weight away from the lifted legs.
    lx = sum(h * legs[k]['J'][3].x for k, h in lifted.items())
    ly = sum(h * legs[k]['J'][3].y for k, h in lifted.items())
    return lx, ly


WALK_PHASES = {'FL': 0.0, 'BR': 0.25, 'FR': 0.5, 'BL': 0.75}  # 4-beat walk
TROT_PHASES = {'FL': 0.0, 'BR': 0.0, 'FR': 0.5, 'BL': 0.5}


def idle(t, f):
    p = neutral()
    br = math.sin(TAU * t)
    p['body_off'] = Vector((0, 0, 0.004 * br))
    p['body_rot'] = (0.6 * math.sin(TAU * t + 0.6), 0.4 * math.sin(TAU * t), 0)
    # Head scans left, holds, scans right, holds, returns.
    keys = [(0, 0), (0.12, 0), (0.28, 10), (0.45, 10), (0.62, -9), (0.8, -9), (1.0, 0)]
    yaw = 0.0
    for (t0, a0), (t1, a1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            yaw = a0 + (a1 - a0) * smooth((t - t0) / (t1 - t0)); break
    p['head'] = (yaw, 2 * math.sin(TAU * t * 2))
    p['spine'] = (-0.3 * yaw, 0.5 * br)
    for s, ph in (('L', 0.0), ('R', 0.35)):
        p['arm'][s].update(sh=1.2 * math.sin(TAU * (t + ph)), el=-0.8 * math.sin(TAU * (t + ph)), gp=1.0 * math.sin(TAU * (t + ph + 0.2)))
    p['strut'] = 2 * math.sin(TAU * t)
    return p


def walk_like(t, phases, duty, stride, lift, lean, bob, rotate=None, bounce=2):
    p = neutral()
    lx, ly = gait(p, t, phases, duty, Vector((0, -stride, 0)), lift, rotate)
    p['body_off'] = Vector((0, 0, -bob * (0.5 + 0.5 * math.cos(TAU * bounce * t))))
    p['body_rot'] = (lean + 6 * ly, -6 * lx, 2.5 * math.sin(TAU * t) if rotate is None else 0)
    p['head'] = (-p['body_rot'][2] * 0.8, -0.6 * lean)  # stabilised gaze
    p['spine'] = (-p['body_rot'][2] * 0.5, 0)
    for s, ph in (('L', 0.0), ('R', 0.5)):
        w = math.sin(TAU * (t * bounce + ph) - 0.8)
        p['arm'][s].update(sh=2.0 * w, el=-1.5 * w, gp=-p['body_rot'][0] * 0.7 + 1.0 * w)
    p['strut'] = 4 * math.sin(TAU * t)
    return p


def walk(t, f):
    return walk_like(t, WALK_PHASES, 0.75, 0.14, 0.05, 1.5, 0.006, bounce=4)


# The in-game travel clip: long trotting strides, played faster the quicker the hero moves (RUN_STRIDE per cycle).
def run(t, f):
    return walk_like(t, TROT_PHASES, 0.5, 0.32, 0.085, 5.0, 0.014, bounce=2)


def turn(sign):
    return lambda t, f: walk_like(t, WALK_PHASES, 0.75, 0.0, 0.045, 0.5, 0.005, rotate=22 * sign, bounce=4)


FIRE_FRAMES = 16


def fire(t, f):
    p = idle(0.0, 0)
    p['head'] = (0, 0)
    total = 0.0
    for s, at in (('L', 0), ('R', FIRE_FRAMES // 2)):
        k = kick((f - at) % FIRE_FRAMES, 2.2)
        total += k
        sgn = 1 if s == 'L' else -1
        p['arm'][s].update(sh=-2.5 * k, el=3.0 * k, gp=-6.5 * k, back=0.016 * k, barrel=0.05 * kick((f - at) % FIRE_FRAMES, 1.6))
        p['spine'] = (p['spine'][0] + 2.0 * sgn * k, 0)
    p['body_off'] = Vector((0, 0.006 * total, 0))
    p['body_rot'] = (-1.4 * total, 0, 0)
    p['head'] = (0, 1.0 * total)
    p['strut'] = -6 * total
    return p


def hit(t, f):
    p = idle(0.0, 0)
    k = kick(f - 1, 3.0) * math.cos(0.9 * max(f - 2, 0))
    lag = kick(f - 3, 3.0) * math.cos(0.8 * max(f - 4, 0))
    p['body_off'] = Vector((0.004 * k, 0.022 * k, 0.006 * k))
    p['body_rot'] = (-6 * k, 3 * k, -2.5 * k)
    p['head'] = (-4 * lag, -9 * lag)
    for s in 'LR':
        p['arm'][s].update(sh=-7 * lag, el=6 * lag, gp=-4 * lag)
    p['strut'] = -8 * k
    return p


def death(t, f):
    p = neutral()
    jolt = kick(f - 1, 2.0)
    fall = smooth(min(max((f - 6) / 22, 0), 1))
    land = kick(f - 28, 2.5) * math.cos(1.2 * max(f - 28, 0))
    droop = smooth(min(max((f - 10) / 26, 0), 1))
    p['body_off'] = Vector((0.03 * fall, 0.012 * jolt, -0.15 * fall + 0.012 * land))
    p['body_rot'] = (-5 * jolt + 6 * fall, -8 * fall, 6 * fall)
    for k, L in legs.items():  # legs splay outward as the body sinks
        out = L['u'] * (0.07 * fall)
        p['feet'][k] = out + Vector((0.03 * fall, 0, 0))
        p['foot_pitch'][k] = 18 * fall
    p['head'] = (-14 * droop, 24 * droop - 6 * jolt)
    p['spine'] = (8 * droop, 6 * droop)
    for s, lagf in (('L', 0.0), ('R', 0.12)):
        d = smooth(min(max((f - 12 - 40 * lagf) / 22, 0), 1))
        p['arm'][s].update(sh=46 * d, el=-18 * d, gp=28 * d)
    p['strut'] = 80 * fall
    return p


def activate(t, f):
    p = neutral()
    rise = smooth(min(max((f - 4) / 20, 0), 1))
    over = 0.02 * math.sin(math.pi * min(max((f - 18) / 10, 0), 1))
    arms = smooth(min(max((f - 14) / 16, 0), 1))
    look = smooth(min(max((f - 24) / 12, 0), 1))
    p['body_off'] = Vector((0, 0, -0.1 * (1 - rise) + over * 0.4))
    p['body_rot'] = (6 * (1 - rise), 0, 0)
    p['head'] = (6 * math.sin(math.pi * look) * (1 - look * 0.5), 20 * (1 - look))
    for s, d in (('L', 0), ('R', 2)):
        a = smooth(min(max((f - 14 - d) / 16, 0), 1))
        p['arm'][s].update(sh=30 * (1 - a), el=-12 * (1 - a), gp=38 * (1 - a) - 3 * math.sin(math.pi * a))
    p['strut'] = 75 * (1 - rise)
    return p


bpy.context.scene.render.fps = FPS
key_clip('idle', 72, idle, True)
key_clip('walk', 32, walk, True)
key_clip('run', 16, run, True)
key_clip('turn_left', 32, turn(1), True)
key_clip('turn_right', 32, turn(-1), True)
key_clip('fire', FIRE_FRAMES, fire, True)
key_clip('hit', 14, hit, False)
key_clip('death', 48, death, False)
key_clip('activate', 40, activate, False)
rig.animation_data.action = bpy.data.actions['idle']
bpy.context.scene.frame_set(0)

for mat in bpy.data.materials:
    if mat.use_nodes:
        build_emission(mat, {'hues': [185], 'tol': 20, 'smin': 0.5, 'vmin': 0.55, 'strength': 3})
shrink_textures(1024)
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=88,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_yup=True,
)
print('rigged', out, os.path.getsize(out) // 1024, 'KB', 'faces', len(me.polygons))
