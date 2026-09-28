# Blender batch pipeline for Meshy GLBs -> game-ready GLBs.
#   Blender -b --factory-startup -P tools/blender/process_asset.py -- tools/blender/assets.json [name ...]
#
# Per asset: re-pivot to base center, rotate so the model faces -Y (glTF +Z), normalize size,
# optionally split a rotating "head" off at the neck, derive an emission map from the neon parts of
# the base-color texture, downscale textures to WebP, Draco-compress, export.
import bpy, bmesh, sys, json, math, os
import numpy as np
from mathutils import Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def world_verts(o):
    m = o.matrix_world
    return np.array([tuple(m @ v.co) for v in o.data.vertices])


def apply_matrix(o, mat):
    o.data.transform(mat)
    o.data.update()


def neck_height(V, lo_frac, hi_frac):
    """Height (fraction) with the smallest horizontal extent inside [lo, hi]: the turret's neck."""
    z0, z1 = V[:, 2].min(), V[:, 2].max()
    best, best_w = None, 1e9
    for f in np.linspace(lo_frac, hi_frac, 40):
        z = z0 + (z1 - z0) * f
        band = V[np.abs(V[:, 2] - z) < (z1 - z0) * 0.02]
        if len(band) < 12:
            continue
        w = max(np.ptp(band[:, 0]), np.ptp(band[:, 1]))
        if w < best_w:
            best_w, best = w, f
    return best


def split_mesh(o, z_cut):
    """Duplicate o into base (below z_cut) and head (above)."""
    head = o.copy(); head.data = o.data.copy(); bpy.context.scene.collection.objects.link(head)
    for obj, keep_above in ((o, False), (head, True)):
        bm = bmesh.new(); bm.from_mesh(obj.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z_cut), plane_no=(0, 0, 1),
                               clear_inner=keep_above, clear_outer=not keep_above)
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
    o.name = 'base'; head.name = 'head'
    # Head pivots around the vertical axis through the base center, at the cut height.
    apply_matrix(head, Matrix.Translation((0, 0, -z_cut)))
    head.location = (0, 0, z_cut)
    return o, head


def split_barrels(head, cut_y):
    """Split a rotary barrel cluster (everything in front of y = cut_y) off the head into a child 'barrels' whose
    origin sits on the cluster's own axis, so the game can spin it (a gatling's barrels, not the whole turret)."""
    V = np.array([tuple(v.co) for v in head.data.vertices])  # head-local (its world matrix isn't refreshed yet)
    front = V[V[:, 1] < cut_y]
    ax = (front[:, 0].min() + front[:, 0].max()) / 2
    az = (front[:, 2].min() + front[:, 2].max()) / 2
    bar = head.copy(); bar.data = head.data.copy(); bpy.context.scene.collection.objects.link(bar)
    for obj, keep_front in ((head, False), (bar, True)):
        bm = bmesh.new(); bm.from_mesh(obj.data)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        # Plane normal +Y: "outer" is behind the cut (toward the housing), "inner" is the barrels' side.
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, cut_y, 0), plane_no=(0, 1, 0),
                               clear_inner=not keep_front, clear_outer=keep_front)
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
    apply_matrix(bar, Matrix.Translation((-ax, 0, -az)))
    bar.name = 'barrels'
    bar.parent = head
    bar.matrix_parent_inverse = Matrix.Identity(4)
    bar.location = (ax, 0, az)
    print(f'   barrels split at y={cut_y:.3f}, axis x={ax:.3f} z={az:.3f} (head-local), {len(bar.data.polygons)} faces')
    return bar


def build_emission(mat, em):
    """Derive an emissive texture from saturated, bright pixels near the accent hue(s)."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    link = bsdf.inputs['Base Color'].links
    if not link:
        return
    base_img = link[0].from_node.image
    w, h = base_img.size
    px = np.array(base_img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    rgb = px[:, :, :3]
    mx = rgb.max(axis=2); mn = rgb.min(axis=2)
    v = mx; s = np.where(mx > 1e-5, (mx - mn) / np.maximum(mx, 1e-5), 0)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    hue = np.zeros_like(mx)
    d = np.maximum(mx - mn, 1e-5)
    hue = np.where(mx == r, ((g - b) / d) % 6, hue)
    hue = np.where(mx == g, (b - r) / d + 2, hue)
    hue = np.where(mx == b, (r - g) / d + 4, hue)
    hue = hue * 60.0
    mask = np.zeros_like(mx)
    for hc in em['hues']:
        dh = np.minimum(np.abs(hue - hc), 360 - np.abs(hue - hc))
        m = (dh < em.get('tol', 22)) & (s > em.get('smin', 0.45)) & (v > em.get('vmin', 0.55))
        mask = np.maximum(mask, m.astype(np.float32))
    if em.get('white'):
        mask = np.maximum(mask, ((v > em['white']) & (s < 0.15)).astype(np.float32))
    # Soft falloff so strips bloom without hard aliasing.
    soft = mask * np.clip((v - em.get('vmin', 0.55)) / 0.25 + 0.4, 0, 1)
    out = np.zeros_like(px)
    out[:, :, :3] = rgb * soft[:, :, None]
    out[:, :, 3] = 1
    img = bpy.data.images.new(mat.name + '_emissive', w, h)
    img.pixels = out.ravel()
    img.pack()
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    uv_src = link[0].from_node.inputs['Vector'].links
    if uv_src:
        nt.links.new(uv_src[0].from_socket, tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = em.get('strength', 3.0)
    coverage = float(mask.mean())
    print(f'   emission coverage {coverage * 100:.2f}%')


def shrink_textures(size):
    for img in bpy.data.images:
        if img.size[0] > size:
            img.scale(size, size)


def process(name, a):
    reset()
    src = os.path.join(ROOT, a['src'])
    bpy.ops.import_scene.gltf(filepath=src)
    objs = mesh_objects()
    rigged = any(o.type == 'ARMATURE' for o in bpy.context.scene.objects)
    print(f'== {name}: {len(objs)} meshes, rigged={rigged}')

    if not rigged:
        # Bake the imported transforms, join into one mesh.
        for o in objs:
            apply_matrix(o, o.matrix_world); o.matrix_world = Matrix.Identity(4)
        if len(objs) > 1:
            ctx = {'active_object': objs[0], 'selected_editable_objects': objs}
            with bpy.context.temp_override(**ctx):
                bpy.ops.object.join()
            objs = mesh_objects()
        o = objs[0]
        # Face the model toward -Y.
        apply_matrix(o, Matrix.Rotation(math.radians(a.get('yaw', 0)), 4, 'Z'))
        V = world_verts(o)
        z0, z1 = V[:, 2].min(), V[:, 2].max()
        # Pivot: centroid of the bottom slice (the pedestal / feet), not the bbox center.
        bottom = V[V[:, 2] < z0 + (z1 - z0) * a.get('pivot_slice', 0.15)]
        cx = (bottom[:, 0].min() + bottom[:, 0].max()) / 2 if a.get('pivot', 'base') == 'base' else (V[:, 0].min() + V[:, 0].max()) / 2
        cy = (bottom[:, 1].min() + bottom[:, 1].max()) / 2 if a.get('pivot', 'base') == 'base' else (V[:, 1].min() + V[:, 1].max()) / 2
        apply_matrix(o, Matrix.Translation((-cx, -cy, -z0)))
        V = world_verts(o)
        # Normalize size.
        size = a['size']
        if 'footprint' in size:
            bottom = V[V[:, 2] < V[:, 2].max() * 0.15]
            cur = max(np.ptp(bottom[:, 0]), np.ptp(bottom[:, 1]))
            k = size['footprint'] / cur
        elif 'height' in size:
            k = size['height'] / np.ptp(V[:, 2])
        else:
            k = size['maxdim'] / max(np.ptp(V[:, 0]), np.ptp(V[:, 1]), np.ptp(V[:, 2]))
        apply_matrix(o, Matrix.Scale(k, 4))
        V = world_verts(o)
        print(f'   size {np.ptp(V[:, 0]):.2f} x {np.ptp(V[:, 1]):.2f} x {np.ptp(V[:, 2]):.2f}  faces {len(o.data.polygons)}')
        if a.get('decimate') and len(o.data.polygons) > a['decimate']:
            mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = a['decimate'] / len(o.data.polygons)
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier=mod.name)
            print(f'   decimated to {len(o.data.polygons)}')
        if a.get('split'):
            sp = a['split']
            frac = neck_height(V, sp[0], sp[1]) if isinstance(sp, list) else sp
            z_cut = V[:, 2].min() + np.ptp(V[:, 2]) * frac
            if a.get('auto_yaw'):
                # Point the barrel (the head's farthest horizontal reach from the pivot axis) at -Y.
                head = V[V[:, 2] > z_cut]
                r = np.hypot(head[:, 0], head[:, 1])
                far = head[r > np.percentile(r, 98)]
                ang = math.atan2(far[:, 1].mean(), far[:, 0].mean())
                # yaw_after corrects heads whose farthest reach is not the muzzle (e.g. a mortar's rear housing).
                apply_matrix(o, Matrix.Rotation(-math.pi / 2 - ang + math.radians(a.get('yaw_after', 0)), 4, 'Z'))
                V = world_verts(o)
                print(f'   auto-yaw {math.degrees(-math.pi / 2 - ang):.0f} deg')
            print(f'   split at {frac:.2f} of height (z={z_cut:.3f})')
            base, head = split_mesh(o, z_cut)
            if a.get('barrels'):
                split_barrels(head, a['barrels']['cut_y'])
        else:
            o.name = 'body'
    for mat in bpy.data.materials:
        if mat.use_nodes and a.get('emission'):
            build_emission(mat, a['emission'])
    shrink_textures(a.get('tex', 1024))
    out = os.path.join(ROOT, 'assets/models', name + '.glb')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=88,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_animations=rigged, export_apply=False, export_yup=True,
    )
    print(f'   -> {out} ({os.path.getsize(out) / 1e6:.2f} MB)')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    cfg = json.load(open(argv[0]))
    only = set(argv[1:])
    for name, a in cfg.items():
        if only and name not in only:
            continue
        try:
            process(name, a)
        except Exception as e:
            import traceback; traceback.print_exc()
            print(f'!! {name} failed: {e}')
