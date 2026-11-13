"""Stage and verify arm-only source edits. --apply writes only after every file passes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from arm_contract import arm, load_contract, validate_arms, verify_appearance


ROOT = Path(__file__).resolve().parent.parent.parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint():
    """Guard meshes, other UVs, transforms, skin weights, bones and animation curves."""
    arms = {bpy.data.objects['Arms_Left'].data, bpy.data.objects['Arms_Right'].data}
    objects = []
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        objects.append({
            'name': obj.name, 'type': obj.type, 'data': obj.data.name if obj.data else None,
            'parent': obj.parent.name if obj.parent else None,
            'matrix': [list(row) for row in obj.matrix_basis],
            'groups': [group.name for group in obj.vertex_groups],
            'modifiers': [(mod.name, mod.type, getattr(getattr(mod, 'object', None), 'name', None)) for mod in obj.modifiers],
        })
    meshes = []
    for mesh in sorted(bpy.data.meshes, key=lambda item: item.name):
        meshes.append({
            'name': mesh.name,
            'vertices': [(list(v.co), [(g.group, g.weight) for g in v.groups]) for v in mesh.vertices],
            'faces': [list(p.vertices) for p in mesh.polygons],
            'materials': [m.name if m else None for m in mesh.materials],
            'uv': {layer.name: [list(item.uv) for item in layer.data] for layer in mesh.uv_layers
                   if not (mesh in arms and layer.name == 'SourceUV')},
        })
    rigs = []
    for rig in sorted(bpy.data.armatures, key=lambda item: item.name):
        rigs.append((rig.name, [(b.name, b.parent.name if b.parent else None, [list(row) for row in b.matrix_local]) for b in rig.bones]))
    actions = []
    for action in sorted(bpy.data.actions, key=lambda item: item.name):
        curves = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    slot = next(s.name_display for s in action.slots if s.handle == bag.slot_handle)
                    for curve in bag.fcurves:
                        curves.append((slot, curve.data_path, curve.array_index,
                                       [(list(k.co), list(k.handle_left), list(k.handle_right), k.interpolation)
                                        for k in curve.keyframe_points]))
        actions.append((action.name, sorted(curves)))
    scenes = [(scene.name, sorted(obj.name for obj in scene.objects), scene.camera.name if scene.camera else None,
               scene.frame_current, scene.render.fps, scene.render.fps_base)
              for scene in sorted(bpy.data.scenes, key=lambda item: item.name)]
    return hashlib.sha256(json.dumps([objects, meshes, rigs, actions, scenes], sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def stage_one(source, candidate, atlas, contract):
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    before = fingerprint()
    image = bpy.data.images.load(str(atlas), check_existing=False)
    samples = {side: verify_appearance(side, contract, image) for side in ('Left', 'Right')}
    old_alpha = arm('Left', contract)[2].image.alpha_mode
    assert arm('Right', contract)[2].image.alpha_mode == old_alpha, 'Different arm alpha modes'
    image.name = 'Character_Arms_32'
    image.alpha_mode = old_alpha
    image.pack()
    # The candidate lives on D:, but will be installed at the original source path.
    image.filepath = '//' + os.path.relpath(atlas, source.parent).replace('\\', '/')
    for side in ('Left', 'Right'):
        obj, uv, node = arm(side, contract)
        for loop in obj.data.loops:
            uv.data[loop.index].uv = contract['sides'][side][loop.vertex_index]
        node.image = image
    validate_arms(contract)
    candidate.parent.mkdir(parents=True, exist_ok=True)
    # copy=True and save_version=0 prevent both source replacement and .blend1 writes.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(candidate), copy=True, relative_remap=False)
    bpy.ops.wm.open_mainfile(filepath=str(candidate), load_ui=False)
    validate_arms(contract)
    assert fingerprint() == before, f'Non-arm source data changed: {source}'
    return samples


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--files', required=True, help='JSON list of explicit project-relative .blend paths')
    parser.add_argument('--backup', required=True, help='New directory for original source copies')
    parser.add_argument('--work', required=True, help='New directory for staged candidates')
    parser.add_argument('--apply', action='store_true', help='Install only after all candidates pass')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    contract, atlas = load_contract()
    names = json.loads(Path(args.files).read_text(encoding='utf8'))
    assert names and len(names) == len(set(names)), 'Empty or duplicate source list'
    sources = []
    for name in names:
        relative = Path(name)
        source = (ROOT / relative).resolve()
        assert not relative.is_absolute() and ROOT in source.parents and source.suffix == '.blend' and source.is_file(), name
        sources.append((relative, source))
    backup, work = Path(args.backup).resolve(), Path(args.work).resolve()
    assert backup != work and backup not in work.parents and work not in backup.parents
    backup.mkdir(parents=True, exist_ok=False)
    work.mkdir(parents=True, exist_ok=False)
    records = []
    for relative, source in sources:
        dest = backup / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        before = digest(source)
        shutil.copy2(source, dest)
        assert digest(dest) == before and digest(source) == before, f'Backup mismatch: {relative}'
        records.append({'file': relative.as_posix(), 'before': before})
    (backup / 'manifest.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf8')
    for record, (relative, source) in zip(records, sources):
        assert digest(source) == record['before'], f'Source changed after backup: {relative}'
        candidate = work / relative
        record['samples'] = stage_one(source, candidate, atlas, contract)
        record['after'] = digest(candidate)
    (work / 'manifest.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf8')
    if args.apply:
        for record, (relative, source) in zip(records, sources):
            assert digest(source) == record['before'], f'Source changed before install: {relative}'
        for record, (relative, source) in zip(records, sources):
            assert digest(source) == record['before'], f'Source changed during install: {relative}'
            shutil.copyfile(work / relative, source)
            assert digest(source) == record['after'], f'Installed file mismatch: {relative}'
    print(json.dumps({'count': len(records), 'installed': args.apply, 'backup': str(backup), 'candidates': str(work)}))


if __name__ == '__main__':
    main()
