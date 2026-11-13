"""Read an explicit authoring recipe in a fresh background Blender. Never save a blend."""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from arm_contract import load_contract, validate_arms
from optimized_geometry import install_optimized_geometry


def normalize(path):
    raw = path.read_bytes()
    json_length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + json_length])
    start = 20 + json_length
    binary_length = struct.unpack_from('<I', raw, start)[0]
    binary = bytearray(raw[start + 8:start + 8 + binary_length])

    def times(index):
        accessor = doc['accessors'][index]
        view = doc['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126 and accessor['type'] == 'SCALAR'
        assert not view.get('byteStride')
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return list(struct.unpack_from('<' + 'f' * accessor['count'], binary, offset)), offset

    offsets = {}
    for animation in doc['animations']:
        inputs = {sampler['input'] for sampler in animation['samplers']}
        origin = min(times(index)[0][0] for index in inputs)
        for index in inputs:
            assert index not in offsets or abs(offsets[index] - origin) < 1e-7
            offsets[index] = origin
    for index, origin in offsets.items():
        values, offset = times(index)
        values = [max(0.0, value - origin) for value in values]
        struct.pack_into('<' + 'f' * len(values), binary, offset, *values)
        doc['accessors'][index].update(min=[min(values)], max=[max(values)])

    # Skin joints/inverse binds carry the deformation; organizational mesh parents do not.
    for index, node in enumerate(doc['nodes']):
        if 'skin' not in node or 'mesh' not in node:
            continue
        assert not any(key in node for key in ['matrix', 'translation', 'rotation', 'scale']), node
        for parent in doc['nodes']:
            if index in parent.get('children', []):
                parent['children'].remove(index)
        for scene in doc['scenes']:
            if index not in scene['nodes']:
                scene['nodes'].append(index)

    # The source has archival UV layers; runtime has exactly the material's authored UV.
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            material = doc['materials'][primitive['material']]
            texture = material.get('pbrMetallicRoughness', {}).get('baseColorTexture', {})
            attributes = primitive['attributes']
            source = attributes['TEXCOORD_' + str(texture.get('texCoord', 0))]
            for key in list(attributes):
                if key.startswith('TEXCOORD_'):
                    del attributes[key]
            attributes['TEXCOORD_0'] = source

    def clean(value):
        if isinstance(value, dict):
            value.pop('extras', None)  # Remove source-machine paths and preview-only instructions.
            if 'index' in value and 'texCoord' in value:
                value['texCoord'] = 0
            for child in value.values():
                clean(child)
        elif isinstance(value, list):
            for child in value:
                clean(child)
    clean(doc)

    names = set()
    for index, node in enumerate(doc['nodes']):
        name = node.get('name', 'node')
        if name in names:
            name += '__node_' + str(index)
        assert name not in names
        names.add(name)
        node['name'] = name

    used_skins = sorted({node['skin'] for node in doc['nodes'] if 'skin' in node})
    remap = {old: new for new, old in enumerate(used_skins)}
    doc['skins'] = [doc['skins'][index] for index in used_skins]
    for node in doc['nodes']:
        if 'skin' in node:
            node['skin'] = remap[node['skin']]
    refs = []
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            refs.extend((primitive['attributes'], key) for key in primitive['attributes'])
            if 'indices' in primitive:
                refs.append((primitive, 'indices'))
    for animation in doc['animations']:
        for sampler in animation['samplers']:
            refs.extend([(sampler, 'input'), (sampler, 'output')])
    for skin in doc['skins']:
        if 'inverseBindMatrices' in skin:
            refs.append((skin, 'inverseBindMatrices'))
    used = sorted({owner[key] for owner, key in refs})
    remap = {old: new for new, old in enumerate(used)}
    doc['accessors'] = [doc['accessors'][index] for index in used]
    for owner, key in refs:
        owner[key] = remap[owner[key]]
    refs = [(accessor, 'bufferView') for accessor in doc['accessors'] if 'bufferView' in accessor]
    refs += [(image, 'bufferView') for image in doc.get('images', []) if 'bufferView' in image]
    used = sorted({owner[key] for owner, key in refs})
    remap = {old: new for new, old in enumerate(used)}
    packed, views = bytearray(), []
    for index in used:
        view = dict(doc['bufferViews'][index])
        offset = view.get('byteOffset', 0)
        packed.extend(b'\0' * (-len(packed) % 4))
        view['byteOffset'] = len(packed)
        packed.extend(binary[offset:offset + view['byteLength']])
        views.append(view)
    for owner, key in refs:
        owner[key] = remap[owner[key]]
    doc['bufferViews'] = views
    doc['buffers'] = [{'byteLength': len(packed)}]
    encoded = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    packed.extend(b'\0' * (-len(packed) % 4))
    result = struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(packed))
    result += struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
    result += struct.pack('<II', len(packed), 0x004E4942) + packed
    path.write_bytes(result)


def main():
    request = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8'))
    source = Path(request['blend'])
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = json.loads(Path(request['sourceManifest']).read_text(encoding='utf8'))
    assert len(manifest['clips']) == request['clipCount']
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    arm_contract, _ = load_contract()
    validate_arms(arm_contract)
    optimized = None
    if request.get('optimizedGeometry'):
        optimized = install_optimized_geometry(request['optimizedGeometry'], request['texture'], manifest)
    scene = bpy.data.scenes[request['scene']]
    bpy.context.window.scene = scene
    assert scene.render.fps / scene.render.fps_base == 60
    image_nodes = [node for node in bpy.data.materials['Weapon_Skin'].node_tree.nodes
                   if node.type == 'TEX_IMAGE' and node.image]
    assert len(image_nodes) == 1 and image_nodes[0].image.packed_file
    packed = bytes(image_nodes[0].image.packed_file.data)
    assert hashlib.sha256(packed).digest() == hashlib.sha256(Path(request['texture']).read_bytes()).digest()
    objects = [scene.objects[name] for name in request['meshes'] + request['armatures']]
    assert all(obj.type == 'MESH' for obj in objects[:len(request['meshes'])])
    animated = {obj: obj.animation_data.action_slot.name_display for obj in objects
                if obj.animation_data and obj.animation_data.action_slot}
    for clip in manifest['clips']:
        assert clip['name'] in bpy.data.actions

    # Compare exported Three.js deformation to these evaluated authoring-source poses.
    samples = []
    for name, fraction in [('static_idle', 0), ('draw', .5), ('shoot', .25),
                           ('reload_tactical', .35), ('reload_tactical', .7),
                           ('reload_empty', .6), ('inspect', .5), ('aim', .5), ('walk_forward', .25)]:
        action = bpy.data.actions[name]
        for obj, slot in animated.items():
            obj.animation_data.action = action
            obj.animation_data.action_slot = next(s for s in action.slots if s.name_display == slot)
        seconds = next(c['duration'] for c in manifest['clips'] if c['name'] == name) * fraction
        frame = 1 + seconds * 60
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        deps = bpy.context.evaluated_depsgraph_get()
        bounds = {}
        for name_mesh in request['meshes']:
            evaluated = scene.objects[name_mesh].evaluated_get(deps)
            mesh = evaluated.to_mesh()
            points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
            points = [(point.x, point.z, -point.y) for point in points]
            bounds[name_mesh] = [[min(p[i] for p in points) for i in range(3)],
                                 [max(p[i] for p in points) for i in range(3)]]
            evaluated.to_mesh_clear()
        samples.append({'clip': name, 'time': seconds, 'bounds': bounds})
    for obj, slot in animated.items():
        obj.animation_data.action = bpy.data.actions['static_idle']
        obj.animation_data.action_slot = next(s for s in bpy.data.actions['static_idle'].slots if s.name_display == slot)
    scene.frame_set(1)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = scene.objects['Weapon_Body']
    bpy.ops.export_scene.gltf(
        filepath=request['output'], export_format='GLB', use_active_scene=True, use_selection=True,
        export_cameras=False, export_lights=False, export_animations=True,
        export_animation_mode='ACTIONS', export_merge_animation='ACTION',
        export_frame_range=False, export_anim_slide_to_zero=True, export_anim_single_armature=False,
        export_force_sampling=False, export_bake_animation=False, export_optimize_animation_size=True,
        export_reset_pose_bones=True, export_current_frame=False, export_rest_position_armature=True,
        export_def_bones=False, export_skins=True, export_leaf_bone=False, export_apply=False,
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_extras=False,
        export_yup=True, will_save_settings=False)
    normalize(Path(request['output']))
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    report = {
        'blenderVersion': bpy.app.version_string, 'sourceSha256': before,
        'textureSha256': hashlib.sha256(packed).hexdigest(), 'poseSamples': samples,
        'selectedObjects': [obj.name for obj in objects],
    }
    if optimized is not None:
        report['optimizedGeometry'] = optimized
    Path(request['report']).write_text(json.dumps(report, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
