"""Read-only proof that a texture-only variant shares the published authoring rig/UV/actions."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def inspect(filename, manifest):
    before = hashlib.sha256(filename.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(filename), load_ui=False)
    scene = bpy.data.scenes[manifest['provenance']['exportScene']]
    bpy.context.window.scene = scene
    idle = bpy.data.actions['static_idle']
    for obj in scene.objects:
        if obj.animation_data and obj.animation_data.action_slot:
            slot_name = obj.animation_data.action_slot.name_display
            obj.animation_data.action = idle
            obj.animation_data.action_slot = next(s for s in idle.slots if s.name_display == slot_name)
    scene.frame_set(1)
    meshes = {}
    for name in manifest['meshes']:
        obj = scene.objects[name]
        mesh = obj.data
        uv = mesh.uv_layers['SourceUV']
        meshes[name] = {
            'vertices': [list(v.co) for v in mesh.vertices],
            'faces': [list(p.vertices) for p in mesh.polygons],
            'uv': [list(loop.uv) for loop in uv.data],
            'weights': [[(obj.vertex_groups[g.group].name, g.weight) for g in v.groups] for v in mesh.vertices],
        }
    rig = {}
    for obj in scene.objects:
        if obj.type == 'ARMATURE':
            rig[obj.name] = {
                'matrix': [list(row) for row in obj.matrix_local],
                'bones': [(b.name, b.parent.name if b.parent else None, [list(row) for row in b.matrix_local])
                          for b in obj.data.bones],
            }
    actions = {}
    for clip in manifest['clips']:
        action = bpy.data.actions[clip['name']]
        curves = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    slot = next(s for s in action.slots if s.handle == bag.slot_handle)
                    for curve in bag.fcurves:
                        curves.append((slot.name_display, curve.data_path, curve.array_index,
                                       [(list(k.co), list(k.handle_left), list(k.handle_right), k.interpolation)
                                        for k in curve.keyframe_points]))
        actions[clip['name']] = sorted(curves)
    material = bpy.data.materials[manifest['materials']['weapon'][0]]
    images = [n.image for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    assert len(images) == 1 and images[0].packed_file, 'Expected one packed weapon texture'
    assert hashlib.sha256(filename.read_bytes()).hexdigest() == before, 'Source changed during inspection'
    return {
        'sourceSha256': before,
        'geometryUV': digest(meshes),
        'rig': digest(rig),
        'clipSet': digest(actions),
        'textureSha256': hashlib.sha256(bytes(images[0].packed_file.data)).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser()
    for name in ['manifest', 'base-blend', 'skin-blend', 'texture', 'out']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    manifest = json.loads(Path(args.manifest).read_text(encoding='utf8'))
    base = inspect(Path(args.base_blend), manifest)
    assert base['sourceSha256'] == manifest['provenance']['sourceBlendSha256'], 'Wrong base source'
    skin = inspect(Path(args.skin_blend), manifest)
    for key in ['geometryUV', 'rig', 'clipSet']:
        assert base[key] == skin[key], 'Variant is not texture-only: ' + key
    assert skin['textureSha256'] == hashlib.sha256(Path(args.texture).read_bytes()).hexdigest(), 'PNG differs from packed skin'
    report = {'schemaVersion': 1, 'weaponId': manifest['weaponId'], 'base': base, 'skin': skin,
              'compatibility': manifest['compatibility'], 'blenderVersion': bpy.app.version_string}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print('SKIN_AUDIT ' + json.dumps(report))


if __name__ == '__main__':
    main()
