# Procedural VFX flipbooks rendered with EEVEE (transparent background), one PNG per frame.
#   Blender -b --factory-startup -P tools/blender/render_vfx.py -- <out_dir>
# Then tools/build_atlas.py packs the frames into sprite sheets.
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
RES = 256


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    engines = [i.identifier for i in sc.render.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w'); sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 3.2
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc


def emissive_material(name, color_ramp_stops, blended=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
        try:
            setattr(m, attr, val)
        except (AttributeError, TypeError):
            pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 2.6
    noise.inputs['Detail'].default_value = 8
    noise.inputs['Roughness'].default_value = 0.62
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    age = nt.nodes.new('ShaderNodeValue'); age.name = 'age'
    # heat = noise * 0.9 + (1 - age) * 0.8 - 0.35
    inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    nt.links.new(age.outputs[0], inv.inputs[1])
    heat = nt.nodes.new('ShaderNodeMath'); heat.operation = 'MULTIPLY_ADD'
    nt.links.new(inv.outputs[0], heat.inputs[0]); heat.inputs[1].default_value = 0.85
    nt.links.new(noise.outputs['Fac'], heat.inputs[2])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = color_ramp_stops[0]
    els[1].position, els[1].color = color_ramp_stops[-1]
    for pos, colr in color_ramp_stops[1:-1]:
        e = els.new(pos); e.color = colr
    shift = nt.nodes.new('ShaderNodeMath'); shift.operation = 'SUBTRACT'
    nt.links.new(heat.outputs[0], shift.inputs[0]); shift.inputs[1].default_value = 0.55
    nt.links.new(shift.outputs[0], ramp.inputs['Fac'])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
    strength = nt.nodes.new('ShaderNodeMath'); strength.operation = 'MULTIPLY'
    nt.links.new(heat.outputs[0], strength.inputs[0]); strength.inputs[1].default_value = 4.0
    nt.links.new(strength.outputs[0], em.inputs['Strength'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    alpha = nt.nodes.new('ShaderNodeMath'); alpha.operation = 'MULTIPLY'; alpha.use_clamp = True
    nt.links.new(ramp.outputs['Alpha'], alpha.inputs[0])
    fade = nt.nodes.new('ShaderNodeMath'); fade.operation = 'POWER'
    nt.links.new(inv.outputs[0], fade.inputs[0]); fade.inputs[1].default_value = 0.7
    nt.links.new(fade.outputs[0], alpha.inputs[1])
    nt.links.new(alpha.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m, age, noise


def render_frames(name, n, update):
    os.makedirs(os.path.join(OUT, name), exist_ok=True)
    sc = bpy.context.scene
    for f in range(n):
        update(f / (n - 1))
        sc.render.filepath = os.path.join(OUT, name, f'{f:02d}.png')
        bpy.ops.render.render(write_still=True)
    print('rendered', name, n)


# ------------------------------------------------------------------ fireball explosion
setup()
fire_stops = [
    (0.0, (0.02, 0.01, 0.02, 0.0)),
    (0.18, (0.12, 0.04, 0.06, 0.55)),
    (0.38, (0.9, 0.12, 0.05, 0.95)),
    (0.6, (1.0, 0.45, 0.08, 1.0)),
    (0.8, (1.0, 0.85, 0.35, 1.0)),
    (1.0, (1.0, 1.0, 0.9, 1.0)),
]
mat, age_node, noise = emissive_material('fire', fire_stops)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1)
ball = bpy.context.object
ball.data.materials.append(mat)
tex = bpy.data.textures.new('clouds', 'CLOUDS'); tex.noise_scale = 0.45
disp = ball.modifiers.new('disp', 'DISPLACE'); disp.texture = tex; disp.texture_coords = 'OBJECT'
# Inner white-hot core that burns out fast.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1)
core = bpy.context.object
core_mat, core_age, core_noise = emissive_material('core', [(0.0, (1, 0.6, 0.2, 0)), (0.5, (1, 0.8, 0.4, 1)), (1.0, (1, 1, 1, 1))])
core.data.materials.append(core_mat)


def fire_update(a):
    ease = 1 - (1 - a) ** 3
    s = 0.25 + 1.15 * ease
    ball.scale = (s, s, s * 0.95)
    disp.strength = 0.18 + 0.4 * a
    age_node.outputs[0].default_value = a
    noise.inputs['W'].default_value = a * 1.6
    tex.noise_scale = 0.45 + a * 0.2
    c = max(0.001, 0.55 * (1 - a) ** 2 + 0.05)
    core.scale = (c, c, c)
    core_age.outputs[0].default_value = min(1, a * 1.8)
    core_noise.inputs['W'].default_value = a * 2


render_frames('explosion', 24, fire_update)

# ------------------------------------------------------------------ energy burst (grayscale, tinted in engine)
setup()
white = bpy.data.materials.new('white'); white.use_nodes = True
for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
    try:
        setattr(white, attr, val)
    except (AttributeError, TypeError):
        pass
nt = white.node_tree; nt.nodes.clear()
o = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 3
tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mix = nt.nodes.new('ShaderNodeMixShader'); alpha = nt.nodes.new('ShaderNodeValue')
nt.links.new(alpha.outputs[0], mix.inputs['Fac']); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], o.inputs['Surface'])
bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.04, major_segments=96, minor_segments=8, rotation=(math.radians(90), 0, 0))
ring = bpy.context.object; ring.data.materials.append(white)
spikes = []
for i in range(14):
    ang = i / 14 * math.tau + (0.2 if i % 2 else 0)
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.035, radius2=0.0, depth=1, location=(0, 0, 0))
    sp = bpy.context.object
    sp.rotation_euler = (0, math.pi / 2 - ang, 0)  # cone axis (local Z) -> radial direction in the XZ plane
    sp.data.materials.append(white)
    spikes.append((sp, ang, 0.7 + (i % 3) * 0.25))
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.35, segments=32, ring_count=16)
flash = bpy.context.object; flash.data.materials.append(white)


def burst_update(a):
    ease = 1 - (1 - a) ** 2.5
    r = 0.15 + 1.25 * ease
    ring.scale = (r, r, max(0.05, 1 - a))
    for sp, ang, l in spikes:
        d = 0.2 + ease * l
        sp.location = (math.cos(ang) * d, 0, math.sin(ang) * d)
        sp.scale = (1, 1, max(0.01, (0.3 + ease * 0.8) * l * (1 - a * 0.6)))
    f = max(0.001, 1.2 * (1 - a) ** 3)
    flash.scale = (f, f, f)
    alpha.outputs[0].default_value = (1 - a) ** 1.3


render_frames('burst', 16, burst_update)
