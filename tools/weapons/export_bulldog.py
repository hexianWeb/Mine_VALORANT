"""Background-only export of the Bulldog Showcase's individual Actions."""
import hashlib
import json
import math
import struct
import sys
from collections import Counter
from pathlib import Path

import bmesh
import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arm_contract import load_contract, validate_arms
from export_blender import normalize


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def role(name):
    if name in {'left_sleeve', 'left_wrist', 'left_fingers'}:
        return 'Arms_Left'
    if name in {'right_sleeve', 'right_wrist', 'right_fingers'}:
        return 'Arms_Right'
    if name in {'magazine', 'magazine_incoming', 'magazine_outgoing'}:
        return 'Weapon_Magazine'
    return 'Weapon_Body'


def partition(obj, rig, materials):
    """Keep rest-space corners, UVs and rigid assignments; separate only draw roles."""
    groups = [group.name for group in obj.vertex_groups]
    mesh = obj.data
    uv = mesh.uv_layers['SourceUV']

    def bone(v):
        groups_used = [g for g in v.groups if g.weight > 0]
        assert len(groups_used) == 1 and groups_used[0].weight == 1, 'Expected authored rigid weights'
        name = groups[groups_used[0].group]
        assert name in rig.data.bones
        return name

    def face_signature(poly, data, uvlayer, bone_lookup):
        return tuple((tuple(data.vertices[data.loops[i].vertex_index].co),
                      tuple(uvlayer.uv[i].vector), bone_lookup(data.vertices[data.loops[i].vertex_index]))
                     for i in poly.loop_indices)

    bones = [bone(v) for v in mesh.vertices]
    expected = {name: Counter() for name in (*materials, 'Arms_Left', 'Arms_Right')}
    for face in mesh.polygons:
        bone_names = {bones[v] for v in face.vertices}
        assert len(bone_names) == 1, 'Found a polygon crossing a role boundary'
        signature = face_signature(face, mesh, uv, lambda v: bones[v.index])
        expected[role(next(iter(bone_names)))][signature] += 1
    collection = obj.users_collection[0]
    assert len(obj.users_collection) == 1
    for name, material in materials.items():
        copy = obj.copy()
        copy.data = mesh.copy()
        copy.name = copy.data.name = name
        assert copy.name == copy.data.name == name
        copy.data.materials[0] = material
        collection.objects.link(copy)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if role(bones[v.index]) != name], context='VERTS')
        bm.to_mesh(copy.data)
        bm.free()
        part = copy.data
        actual = Counter(face_signature(p, part, part.uv_layers['SourceUV'], bone) for p in part.polygons)
        # BMesh can rotate a polygon's first loop but cannot change its winding.
        def canonical(rows):
            result = Counter()
            for row, count in rows.items():
                result[min(row[i:] + row[:i] for i in range(len(row)))] += count
            return result
        assert canonical(expected[name]) == canonical(actual) and actual, name
    return {name: sum(counts.values()) for name, counts in expected.items()}


def reference_arms(path):
    data = path.read_bytes()
    assert data[:4] == b'glTF'
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length])
    binary = 28 + length
    corners = {}
    for side in ('Left', 'Right'):
        name = 'Arms_' + side
        mesh, = [m for m in doc['meshes'] if m['name'] == name]
        primitive, = mesh['primitives']
        a = doc['accessors'][primitive['attributes']['POSITION']]
        view = doc['bufferViews'][a['bufferView']]
        assert a['count'] == 24 and a['type'] == 'VEC3' and a['componentType'] == 5126
        offset = binary + view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', 12)
        corners[side] = [Vector(struct.unpack_from('<3f', data, offset + n * stride)) for n in range(24)]
    return corners


def mount_shared_arms(source, rig, atlas, reference_path, stretch):
    contract, atlas_path = load_contract()
    image = bpy.data.images.load(str(atlas_path), check_existing=False)
    image.pack()
    assert hashlib.sha256(bytes(image.packed_file.data)).hexdigest() == contract['textureSha256']
    shapes = reference_arms(reference_path)
    faces = [contract['indices'][i:i + 3] for i in range(0, len(contract['indices']), 3)]
    group_points = {
        g.name: [v.co.copy() for v in source.data.vertices if any(w.group == g.index and w.weight == 1 for w in v.groups)]
        for g in source.vertex_groups if g.name.startswith(('left_', 'right_'))
    }

    def center(points):
        return Vector([(min(v[i] for v in points) + max(v[i] for v in points)) * 0.5 for i in range(3)])

    counts, fits = {}, {}
    for side, corners in shapes.items():
        prefix = side.lower()
        palm = center(group_points[prefix + '_wrist'])
        sleeve = center(group_points[prefix + '_sleeve'])
        forward = (palm - sleeve).normalized()
        assert forward.y > 0.7
        tangent = forward.cross(Vector((0, 0, 1))).normalized()
        up = tangent.cross(forward)
        middle = center(corners)
        top = max(p.y for p in corners)
        bottom = min(p.y for p in corners)
        # Anchor the front cap slightly beyond the authored wrist center, not at the elbow.
        grip = palm + forward * 0.065
        rest_length = top - bottom
        if stretch:
            sleeve_end = min(p.dot(forward) for p in group_points[prefix + '_sleeve'])
            rest_length = grip.dot(forward) - sleeve_end
            assert rest_length > 0.5, (side, rest_length)
        verts = [grip + tangent * (p.x - middle.x) +
                 forward * ((p.y - top) * (rest_length / (top - bottom))) +
                 up * (p.z - middle.z) for p in corners]
        name = 'Arms_' + side
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        uv = data.uv_layers.new(name='SourceUV', do_init=False)
        for loop in data.loops:
            uv.uv[loop.index].vector = contract['sides'][side][loop.vertex_index]
        mat = atlas.copy()
        mat.name = 'Character_' + side
        tex, = [node for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE']
        tex.image = image
        data.materials.append(mat)
        obj = bpy.data.objects.new(name, data)
        source.users_collection[0].objects.link(obj)
        obj.parent = rig
        obj.matrix_parent_inverse = source.matrix_parent_inverse.copy()
        obj.matrix_basis = source.matrix_basis.copy()
        palm_indices = [i for i, point in enumerate(corners) if point.y == top]
        cuff_indices = [i for i, point in enumerate(corners) if point.y == bottom]
        assert len(palm_indices) == len(cuff_indices) == 12
        wrist = prefix + '_wrist'
        sleeve_bone = prefix + '_sleeve'
        obj.vertex_groups.new(name=wrist).add(palm_indices if stretch else list(range(len(verts))), 1.0, 'REPLACE')
        if stretch:
            obj.vertex_groups.new(name=sleeve_bone).add(cuff_indices, 1.0, 'REPLACE')
            fits[name] = {'palm': palm_indices, 'cuff': cuff_indices, 'palmBone': wrist, 'cuffBone': sleeve_bone,
                          'restLength': rest_length, 'lengthSamples': []}
        modifier = obj.modifiers.new(name='Armature', type='ARMATURE')
        modifier.object = rig
        data.update()
        counts[name] = len(data.polygons)
    validate_arms(contract)
    return counts, fits


def channelbag(action):
    slot, = action.slots
    layer, = action.layers
    strip, = layer.strips
    return strip.channelbag(slot)


def retime(action, map_frame):
    for curve in channelbag(action).fcurves:
        for key in curve.keyframe_points:
            frame = key.co.x
            left, right = key.handle_left.x, key.handle_right.x
            key.co.x = map_frame(frame)
            key.handle_left.x = map_frame(left)
            key.handle_right.x = map_frame(right)
        curve.update()


def draw_with_charge(rig, original_end, end, plan):
    draw = bpy.data.actions['draw']
    donor = bpy.data.actions['reload_empty']
    raise_source, reach, release, donor_end = (plan[k] for k in
        ('raiseSourceFrame', 'reachFrame', 'releaseFrame', 'donorEndFrame'))
    assert 0 < raise_source < original_end and 0 < reach < release < end and 0 < donor_end < 30
    receiver = plan['receiverMotion']
    assert 0 <= receiver <= 1

    def map_frame(f):
        if f <= raise_source:
            return f * reach / raise_source
        return reach + (f - raise_source) * (end - reach) / (original_end - raise_source)

    retime(draw, map_frame)
    target_curves = channelbag(draw).fcurves
    donor_curves = channelbag(donor).fcurves

    def smooth(x):
        x = min(max(x, 0), 1)
        return x * x * (3 - 2 * x)

    # Use the authored local pose of the left hand and its sleeve, not a sliding prop alone.
    # Only a fraction of the donor's weapon tilt is needed for a close first-person view.
    influences = {'left_wrist': 1, 'left_sleeve': 1, 'left_fingers': 1,
                  'charging_handle': 1, 'bulldog': receiver}
    for bone, influence in influences.items():
        pbone = rig.pose.bones[bone]
        assert pbone.rotation_mode == 'QUATERNION'
        for prop, default in (('location', (0, 0, 0)), ('rotation_quaternion', (1, 0, 0, 0)),
                              ('scale', (1, 1, 1))):
            path = pbone.path_from_id(prop)
            src = [donor_curves.find(path, index=i) for i in range(len(default))]
            if not any(src):
                continue
            dst = [target_curves.find(path, index=i) for i in range(len(default))]
            values = []
            previous = None
            for f in range(end + 1):
                sample = donor_end * min(max((f - reach) / (release - reach), 0), 1)
                weight = influence * smooth((f - reach) / 4) * smooth((end - f) / (end - release))
                a = [curve.evaluate(f) if curve else default[i] for i, curve in enumerate(dst)]
                b = [curve.evaluate(sample) if curve else default[i] for i, curve in enumerate(src)]
                if prop == 'rotation_quaternion':
                    result = Quaternion(a).normalized().slerp(Quaternion(b).normalized(), weight)
                    if previous is not None and previous.dot(result) < 0:
                        result.negate()
                    previous = result
                else:
                    result = [x + (y - x) * weight for x, y in zip(a, b)]
                values.append(tuple(result))
            for i, curve in enumerate(dst):
                if curve is None:
                    curve = target_curves.new(path, index=i)
                keys = curve.keyframe_points
                keys.clear()
                keys.add(len(values))
                keys.foreach_set('co', [v for f, value in enumerate(values) for v in (f, value[i])])
                for key in keys:
                    key.interpolation = 'LINEAR'
                curve.update()


def apply_runtime_edit(rig, request, clips):
    frames = request.get('clipFrames', {})
    assert all(name in clips and type(count) is int and count > 0 for name, count in frames.items())
    draw_charge = request.get('drawCharge')
    if draw_charge:
        draw_with_charge(rig, round(clips['draw']['duration'] * 60), frames['draw'], draw_charge)
    for name, count in frames.items():
        original = round(clips[name]['duration'] * 60)
        assert count < original, (name, count, original)
        if name != 'draw' or not draw_charge:
            retime(bpy.data.actions[name], lambda f: f * count / original)
        clips[name]['duration'] = count / 60


def main():
    request = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_bytes())
    source, texture, reference, out = (Path(request[key]) for key in ('source', 'texture', 'armReference', 'output'))
    assert sha(source) == request['sourceSha256']
    assert sha(texture) == request['textureSha256']
    assert sha(reference) == request['armReferenceSha256']
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    scene = bpy.data.scenes[request['scene']]
    bpy.context.window.scene = scene
    assert scene.render.fps == 60 and scene.render.fps_base == 1
    rig = scene.objects['root']
    mesh = scene.objects['Bulldog_Viewmodel']
    atlas, = mesh.data.materials
    tex, = [n for n in atlas.node_tree.nodes if n.type == 'TEX_IMAGE']
    assert bytes(tex.image.packed_file.data) == texture.read_bytes()
    weapon = atlas.copy()
    weapon.name = 'Weapon_Skin'
    source_counts = partition(mesh, rig, {'Weapon_Body': weapon, 'Weapon_Magazine': weapon})
    assert sum(source_counts.values()) == 1080
    counts = {name: count for name, count in source_counts.items() if name.startswith('Weapon_')}
    fitting = request.get('armFitting')
    assert fitting in (None, 'authored-sleeve-stretch')
    arm_counts, arm_fits = mount_shared_arms(mesh, rig, atlas, reference, stretch=fitting is not None)
    counts.update(arm_counts)
    bpy.data.objects.remove(mesh, do_unlink=True)

    animation = rig.animation_data
    preview, = animation.nla_tracks
    assert preview.name == 'Preview sequence only'
    animation.nla_tracks.remove(preview)
    clips = []
    for action in list(bpy.data.actions):
        assert action.name == 'bulldog / ' + action['blockbench_action_name'].split('.')[-1]
        action.name = action.name.removeprefix('bulldog / ')
        frames = round(action['blockbench_length_seconds'] * 60)
        if action.name == 'draw' and 'authoredDrawFrames' in request:
            # The edited Blender Action is authoritative for this take, not the archived BB duration.
            frames = request['authoredDrawFrames']
            assert type(frames) is int and frames > 0 and tuple(action.curve_frame_range) == (0, frames)
            assert 'drawCharge' not in request and 'draw' not in request.get('clipFrames', {})
        clips.append({'name': action.name, 'duration': frames / 60,
                      'loop': action['blockbench_loop_mode'] == 'loop', 'markers': [], 'controlBones': []})
    assert len(clips) == 30
    by_name = {clip['name']: clip for clip in clips}
    apply_runtime_edit(rig, request, by_name)

    def frame(name, time):
        a = bpy.data.actions[name]
        animation.action = a
        animation.action_slot = a.slots[0]
        f = time * 60
        scene.frame_set(math.floor(f), subframe=f % 1)

    samples = []
    draw_sample = .75 if request.get('drawCharge') else .6
    for name, fraction in [('idle', 0), ('draw', draw_sample), ('shoot', .25), ('reload_tactical', .35),
                           ('reload_tactical', .65), ('reload_empty', .575), ('inspect', .5),
                           ('aim', .5), ('walk_forward', .25)]:
        seconds = by_name[name]['duration'] * fraction
        frame(name, seconds)
        deps = bpy.context.evaluated_depsgraph_get()
        bounds = {}
        for part in counts:
            obj = scene.objects[part].evaluated_get(deps)
            evaluated = obj.to_mesh()
            points = [obj.matrix_world @ v.co for v in evaluated.vertices]
            xyz = [(p.x, p.z, -p.y) for p in points]
            bounds[part] = [[fn(p[i] for p in xyz) for i in range(3)] for fn in (min, max)]
            if part in arm_fits:
                fit = arm_fits[part]
                palm, cuff = (sum((points[i] for i in fit[key]), Vector()) / len(fit[key]) for key in ('palm', 'cuff'))
                fit['lengthSamples'].append({'clip': name, 'time': seconds, 'length': (palm - cuff).length})
            obj.to_mesh_clear()
        samples.append({'clip': name, 'time': seconds, 'bounds': bounds})
    for fit in arm_fits.values():
        lengths = [sample['length'] for sample in fit['lengthSamples']]
        assert max(lengths) - min(lengths) > .05, 'Sleeve does not deform across authored poses'

    frame('static_idle', 0)
    static = bpy.data.actions['static_idle']
    static_curves = static.layers[0].strips[0].channelbag(static.slots[0]).fcurves
    for curve in static_curves:
        assert len(curve.keyframe_points) == 1
        first = curve.keyframe_points[0]
        interpolation = first.interpolation
        curve.keyframe_points.insert(static.frame_end, first.co.y).interpolation = interpolation
    # ACTIONS export enumerates actions attached to a rig or retained on its NLA tracks.
    for action in bpy.data.actions:
        stash = animation.nla_tracks.new()
        stash.name = action.name
        strip = stash.strips.new(action.name, 0, action)
        strip.action_slot = action.slots[0]
        stash.mute = True
    camera = scene.camera
    assert camera.name == 'Camera_FP' and camera.parent is None and camera.data.sensor_fit == 'VERTICAL'
    q = camera.matrix_world.to_3x3()
    assert (q @ Vector((0, 0, -1)) - Vector((0, 1, 0))).length < 1e-5
    x, y, z = camera.matrix_world.translation
    fov = math.degrees(2 * math.atan(camera.data.sensor_height / (2 * camera.data.lens)))

    bpy.ops.object.select_all(action='DESELECT')
    for name in (*counts, 'root', 'muzzle_tip', 'sight_line'):
        scene.objects[name].select_set(True)
    bpy.context.view_layer.objects.active = scene.objects['Weapon_Body']
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format='GLB', use_active_scene=True, use_selection=True,
        export_cameras=False, export_lights=False, export_animations=True,
        export_animation_mode='ACTIONS', export_merge_animation='ACTION',
        export_frame_range=False, export_anim_slide_to_zero=True, export_anim_single_armature=False,
        export_force_sampling=False, export_bake_animation=False, export_optimize_animation_size=False,
        export_reset_pose_bones=True, export_current_frame=False, export_rest_position_armature=True,
        export_def_bones=False, export_skins=True, export_leaf_bone=False, export_apply=False,
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_extras=False,
        export_yup=True, will_save_settings=False)
    normalize(out)
    assert sha(source) == request['sourceSha256'] and sha(texture) == request['textureSha256']
    assert sha(reference) == request['armReferenceSha256']
    Path(request['report']).write_text(json.dumps({
        'blenderVersion': bpy.app.version_string, 'sourceSha256': sha(source), 'textureSha256': sha(texture),
        'sourceScene': scene.name, 'sourceTriangles': source_counts, 'partitionTriangles': counts, 'clips': clips,
        'armReferenceSha256': sha(reference),
        **({'runtimeEdit': {'clipFrames': request['clipFrames'], 'drawCharge': request.get('drawCharge')}}
           if request.get('clipFrames') else {}),
        **({'armFitting': {name: {key: value for key, value in fit.items() if key not in {'palm', 'cuff'}}
                           for name, fit in arm_fits.items()}} if arm_fits else {}),
        'view': {'mountOffset': [-x, -z, y], 'cameraFov': fov, 'near': camera.data.clip_start, 'far': camera.data.clip_end},
        'poseSamples': samples,
    }, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
