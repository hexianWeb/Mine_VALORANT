"""Import only audited, optimized weapon geometry into the established export rig.

Run in a fresh background Blender. Both authoring files remain read-only.
"""
import hashlib
import json
from pathlib import Path

import bpy


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def action_curves(action):
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                slot = next(slot.name_display for slot in action.slots if slot.handle == bag.slot_handle)
                for curve in bag.fcurves:
                    curves.append((slot, curve.data_path, curve.array_index,
                                   [(list(key.co), list(key.handle_left), list(key.handle_right), key.interpolation)
                                    for key in curve.keyframe_points]))
    return sorted(curves)


def rest_rig(obj):
    return [(bone.name, bone.parent.name if bone.parent else None, [list(row) for row in bone.matrix_local])
            for bone in obj.data.bones]


def geometry(obj, mesh):
    return {
        'vertices': [list(vertex.co) for vertex in mesh.vertices],
        'faces': [list(face.vertices) for face in mesh.polygons],
        'uv': {layer.name: [list(loop.uv) for loop in layer.data] for layer in mesh.uv_layers},
        'weights': [[(obj.vertex_groups[group.group].name, group.weight) for group in vertex.groups]
                    for vertex in mesh.vertices],
    }


def install_optimized_geometry(spec, texture, manifest):
    source = Path(spec['blend'])
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    assert before == spec['sha256'], 'Optimized authoring source changed; create a new release recipe'
    names = [clip['name'] for clip in manifest['clips']]
    canonical_actions = {name: bpy.data.actions[name] for name in names}
    canonical_curves = {name: action_curves(action) for name, action in canonical_actions.items()}
    target_objects = {name: bpy.data.objects[name] for name in spec['meshes']}
    root = bpy.data.objects['root']
    source_names = list(spec['meshes'].values())
    action_names = [spec['actionPrefix'] + name for name in names]
    with bpy.data.libraries.load(str(source), link=False) as (available, imported):
        assert all(name in available.objects for name in source_names), 'Missing optimized source meshes'
        assert all(name in available.actions for name in action_names), 'Missing source actions for compatibility audit'
        imported.objects = source_names
        imported.actions = action_names
    for name, action in zip(names, imported.actions):
        assert action_curves(action) == canonical_curves[name], f'Authoring action differs: {name}'

    inputs = dict(zip(spec['meshes'], imported.objects))
    for name, obj in inputs.items():
        target = target_objects[name]
        assert obj.type == 'MESH' and obj.parent and obj.parent.type == 'ARMATURE'
        assert rest_rig(obj.parent) == rest_rig(root), 'Optimized geometry uses another rest rig'
        assert obj.parent.matrix_basis == root.matrix_basis, 'Armature object basis differs'
        assert obj.matrix_basis == target.matrix_basis and obj.matrix_parent_inverse == target.matrix_parent_inverse, 'Mesh bind transform differs'
        assert [group.name for group in obj.vertex_groups] == [group.name for group in target.vertex_groups], 'Vertex-group order differs'
        assert len(obj.data.uv_layers) == 1 and obj.data.uv_layers.active.name == 'SourceUV'
        assert len(obj.material_slots) == 1

    materials = {obj.material_slots[0].material for obj in inputs.values()}
    assert len(materials) == 1, 'A single weapon-map role requires one authored gun material'
    material = next(iter(materials))
    images = [node.image for node in material.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image]
    assert len(images) == 1 and images[0].packed_file
    packed = bytes(images[0].packed_file.data)
    assert hashlib.sha256(packed).digest() == hashlib.sha256(Path(texture).read_bytes()).digest(), 'Default PNG differs from the current authoring material'
    assert list(images[0].size) == spec['textureSize']
    bpy.data.materials['Weapon_Skin'].name = 'Weapon_Skin_PreOptimization'
    runtime_material = material.copy()
    runtime_material.name = 'Weapon_Skin'

    meshes = []
    for name, obj in inputs.items():
        target = target_objects[name]
        original = geometry(obj, obj.data)
        previous = target.data
        if previous.name == name:
            previous.name = name + '_PreOptimization'
        target.data = obj.data.copy()
        target.data.name = name
        target.data.materials.clear()
        target.data.materials.append(runtime_material)
        assert geometry(target, target.data) == original, f'Geometry/UV/weights changed while importing: {name}'
        maximum = max(sum(group.weight > 1e-6 for group in vertex.groups) for vertex in target.data.vertices)
        assert 1 <= maximum <= 4, 'Unsupported number of authored skin influences'
        meshes.append({'name': name, 'sourceObject': spec['meshes'][name],
                       'vertices': len(target.data.vertices), 'triangles': sum(len(face.vertices)-2 for face in target.data.polygons),
                       'geometryUVWeightsSha256': digest(original), 'maxInfluences': maximum})

    # Appending showcase objects also imports preview actions. Never export those sequences
    # or actions from other weapons alongside the explicit canonical clip set.
    retained = set(canonical_actions.values())
    for action in list(bpy.data.actions):
        if action not in retained:
            bpy.data.actions.remove(action)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    return {'sourceSha256': before, 'sourceScene': spec['scene'], 'restRigMatched': True,
            'identicalAuthoringActions': len(names), 'textureSha256': hashlib.sha256(packed).hexdigest(),
            'meshes': meshes, 'preservedAuthoredBlendedWeights': True}
