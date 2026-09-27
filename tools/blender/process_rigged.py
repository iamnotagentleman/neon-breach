# Rigged Meshy characters -> game GLBs.
#   Blender -b --factory-startup -P tools/blender/process_rigged.py -- tools/blender/rigged.json [name ...]
#
# Meshy's rigging output keeps only the base-color texture, so the metallic-roughness and normal maps are
# copied back from the original (unrigged) generation, which shares the same mesh and UVs. The primary
# animation ships inside the character GLB; extra animations are exported as armature-only GLBs that
# three.js can bind to the same skeleton by bone name.
import bpy, sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from process_asset import build_emission, shrink_textures  # noqa: E402  (reused helpers)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def pbr_images_from(path):
    bpy.ops.import_scene.gltf(filepath=path)
    metal_rough = normal = None
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type != 'TEX_IMAGE':
                continue
            for l in n.outputs['Color'].links:
                if l.to_node.type == 'NORMAL_MAP':
                    normal = n.image
                elif l.to_node.type == 'SEPARATE_COLOR':
                    metal_rough = n.image
    for img in (metal_rough, normal):
        if img:
            img.use_fake_user = True
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    return metal_rough, normal


def wire_pbr(mat, metal_rough, normal):
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    if metal_rough:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = metal_rough
        t.image.colorspace_settings.name = 'Non-Color'
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = normal
        t.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])


def clean_helpers():
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and (o.name.startswith('Icosphere') or len(o.data.polygons) < 200):
            bpy.data.objects.remove(o, do_unlink=True)


def autoskin(power=10.0, top=2):
    """Bind an unskinned mesh to the imported armature using nearest-bone-segment weights.

    Meshy occasionally returns a rig whose mesh was never bound (bulky mechs). Hard-ish falloff keeps armor
    plates rigid and bends only near joints, which suits robots better than smooth heat weights.
    """
    import numpy as np
    arm = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
    if not arm:
        return
    for mesh in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        if any(m.type == 'ARMATURE' for m in mesh.modifiers):
            continue
        V = np.array([tuple(mesh.matrix_world @ v.co) for v in mesh.data.vertices])
        bones = [b for b in arm.data.bones if b.use_deform]
        heads = np.array([tuple(arm.matrix_world @ b.head_local) for b in bones])
        tails = np.array([tuple(arm.matrix_world @ b.tail_local) for b in bones])
        # Distance from every vertex to every bone segment.
        seg = tails - heads
        L2 = np.maximum((seg ** 2).sum(1), 1e-9)
        rel = V[:, None, :] - heads[None, :, :]
        t = np.clip((rel * seg[None]).sum(2) / L2[None], 0, 1)
        closest = heads[None] + t[..., None] * seg[None]
        d = np.linalg.norm(V[:, None, :] - closest, axis=2) + 1e-4
        idx = np.argsort(d, axis=1)[:, :top]
        w = 1.0 / np.take_along_axis(d, idx, axis=1) ** power
        w /= w.sum(1, keepdims=True)
        world = mesh.matrix_world.copy()
        mesh.parent = arm
        mesh.matrix_world = world
        mod = mesh.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        groups = [mesh.vertex_groups.new(name=b.name) for b in bones]
        for vi in range(len(V)):
            for k in range(top):
                if w[vi, k] > 0.01:
                    groups[idx[vi, k]].add([vi], float(w[vi, k]), 'REPLACE')
        print(f'   auto-skinned {mesh.name}: {len(V)} verts to {len(bones)} bones')


def decimate(target):
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        n = len(o.data.polygons)
        if n <= target:
            continue
        mod = o.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / n
        # Decimate must run before the armature deform in the stack.
        with bpy.context.temp_override(object=o, active_object=o):
            while o.modifiers[0].name != 'dec':
                bpy.ops.object.modifier_move_up(modifier='dec')
            bpy.ops.object.modifier_apply(modifier='dec')
        print(f'   decimated {o.name}: {n} -> {len(o.data.polygons)}')


def export(path, animations):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_image_format='WEBP', export_image_quality=88,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_animations=animations, export_yup=True, export_skins=True,
    )
    print(f'   -> {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    cfg = json.load(open(argv[0]))
    only = set(argv[1:])
    for name, a in cfg.items():
        if only and name not in only:
            continue
        print(f'== {name}')
        bpy.ops.wm.read_factory_settings(use_empty=True)
        metal_rough, normal = pbr_images_from(os.path.join(ROOT, a['orig']))
        clips = a['clips']  # {clip_name: glb_path}; first entry carries the mesh
        first = next(iter(clips))
        bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, clips[first]))
        clean_helpers()
        if a.get('decimate'):
            decimate(a['decimate'])
        if a.get('autoskin'):
            autoskin()
        for act in bpy.data.actions:
            act.name = first
        for mat in bpy.data.materials:
            if mat.use_nodes:
                wire_pbr(mat, metal_rough, normal)
                if a.get('emission'):
                    build_emission(mat, a['emission'])
        shrink_textures(a.get('tex', 1024))
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        print(f'   meshes {[(o.name, len(o.data.polygons)) for o in meshes]} actions {[x.name for x in bpy.data.actions]}')
        export(os.path.join(ROOT, 'assets/models', name + '.glb'), True)
        for clip, path in list(clips.items())[1:]:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, path))
            for o in list(bpy.context.scene.objects):
                if o.type == 'MESH':
                    bpy.data.objects.remove(o, do_unlink=True)
            for act in bpy.data.actions:
                act.name = clip
            export(os.path.join(ROOT, 'assets/models', f'{name}_{clip}.glb'), True)
