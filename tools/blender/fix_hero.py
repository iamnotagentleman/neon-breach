# Repairs the Tripo hero war bot. The model faces -Y, so its own left is +X. Its front-right and back-left legs
# came out floating 6-11 cm off the body with no bellows hose; they are deleted and replaced by X-mirrors of the
# intact front-left / back-right legs (bellows included). Output is still the full-res mesh; rig_hero.py decimates
# and rigs it.
#   Blender -b --factory-startup -P tools/blender/fix_hero.py -- concept/raw/hero_warbot.glb concept/raw/hero_warbot_fixed.glb
import bpy, bmesh, sys
import numpy as np

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
me = obj.data
nv = len(me.vertices)
V = np.empty(nv * 3); me.vertices.foreach_get('co', V); V = V.reshape(-1, 3)


def union_find(n, pairs):
    par = np.arange(n)

    def f(a):
        while par[a] != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    for a, b in pairs:
        ra, rb = f(a), f(b)
        if ra != rb:
            par[ra] = rb
    return np.array([f(i) for i in range(n)])


# Mesh islands (edge-connected pieces), then clusters of islands that touch within 6 mm.
E = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get('vertices', E)
_, inv = np.unique(union_find(nv, E.reshape(-1, 2)), return_inverse=True)
n_isl = inv.max() + 1
touch = set()
for shift in (0.0, 0.5):
    q = np.floor(V / 0.006 + shift).astype(np.int64)
    key = (q[:, 0] * 73856093) ^ (q[:, 1] * 19349663) ^ (q[:, 2] * 83492791)
    pairs = np.unique(np.stack([key, inv], 1), axis=0)
    _, start, cnt = np.unique(pairs[:, 0], return_index=True, return_counts=True)
    for s, c in zip(start[cnt > 1], cnt[cnt > 1]):
        isl = pairs[s:s + c, 1]
        touch.update((int(isl[0]), int(x)) for x in isl[1:])
cluster = union_find(n_isl, touch)[inv]
labels, counts = np.unique(cluster, return_counts=True)
detached = cluster != labels[np.argmax(counts)]
print(f'   {n_isl} islands, {len(labels)} clusters, detached verts {detached.sum()}')

# Intact legs: whole islands whose centroid lies in the leg's sector, outside the torso (r >= 0.12), below the arms.
cen = np.zeros((n_isl, 3)); np.add.at(cen, inv, V); cen /= np.bincount(inv)[:, None]
r = np.hypot(cen[:, 0], cen[:, 1]); ang = np.degrees(np.arctan2(cen[:, 1], cen[:, 0]))


def leg(a0, a1):
    return ((ang >= a0) & (ang < a1) & (r >= 0.12) & (cen[:, 2] < 0.45))[inv] & ~detached


front_left, back_right = leg(-60, 20), leg(100, 170)

# Keep the shading: copy the evaluated corner normals into a plain attribute bmesh will carry along.
cn = np.empty(len(me.loops) * 3); me.corner_normals.foreach_get('vector', cn)
attr = me.attributes.new('cn', 'FLOAT_VECTOR', 'CORNER'); attr.data.foreach_set('vector', cn)

bm = bmesh.new(); bm.from_mesh(me)
bm.verts.ensure_lookup_table()
cn_layer = bm.loops.layers.float_vector['cn']
legs = [[f for f in bm.faces if all(mask[v.index] for v in f.verts)] for mask in (front_left, back_right)]
for faces in legs:
    dup = bmesh.ops.duplicate(bm, geom=faces)
    new_faces = [g for g in dup['geom'] if isinstance(g, bmesh.types.BMFace)]
    for v in (g for g in dup['geom'] if isinstance(g, bmesh.types.BMVert)):
        v.co.x = -v.co.x
    for f in new_faces:
        for lp in f.loops:
            n = lp[cn_layer]; lp[cn_layer] = (-n[0], n[1], n[2])
    bmesh.ops.reverse_faces(bm, faces=new_faces)  # mirroring flips the winding
    print(f'   mirrored {len(new_faces)} faces')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index < nv and detached[v.index]], context='VERTS')
bm.to_mesh(me); bm.free()

cn = np.empty(len(me.loops) * 3); me.attributes['cn'].data.foreach_get('vector', cn)
me.normals_split_custom_set(cn.reshape(-1, 3).tolist())
me.attributes.remove(me.attributes['cn'])
print(f'   faces {len(me.polygons)}')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True)
print('fixed ->', out)
