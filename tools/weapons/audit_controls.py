"""Read-only numeric control fixtures. No mesh, image or material export; never save a blend.

Run Blender --background --factory-startup --disable-autoexec --python-exit-code 1
  --python tools/weapons/audit_controls.py -- --output D:/opencode-temp/opencode/weapon-controls/fixtures
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy


RECIPES = [
    dict(weapon_id='judge', source='skin_work_folder/judge_skin_work/Judge_Smite_Animated.blend',
         scene='80_ThreeJS_Export', armature='root', prefix='',
         controls={'ammoDisplay': ('ammo_display', [f'bullet{i}' for i in range(4, -1, -1)]),
                   'boltCaught': ('static_bolt_caught', ['bullets'])},
         levels=[(0, 71), (1, 56), (2, 41), (3, 26), (4, 11), (5, 1)]),
    dict(weapon_id='odin', source='skin_work_folder/odin_skin_work/Odin_Smite.blend',
         scene='E09_ODIN_Actions', armature='root.006', prefix='odin / ',
         controls={'ammoDisplay': ('ammo_display', [f'group_{i}' for i in range(8, 0, -1)]),
                   'barrelIndicators': ('barrel', ['red_1', 'red_2'])},
         levels=[(0, 49), (1, 43), (2, 37), (3, 31), (4, 25), (5, 19), (6, 13), (7, 7), (8, 1)]),
]


def curves_for(action):
    return [curve for layer in action.layers for strip in layer.strips
            for bag in strip.channelbags
            if next(slot for slot in action.slots if slot.handle == bag.slot_handle).name_display == 'root'
            for curve in bag.fcurves]


def scale_track(curves, bone):
    axes = [next(curve for curve in curves
                 if curve.data_path == f'pose.bones["{bone}"].scale' and curve.array_index == axis)
            for axis in range(3)]
    frames = [float(key.co.x) for key in axes[0].keyframe_points]
    interpolation = {key.interpolation for curve in axes for key in curve.keyframe_points}
    assert len(interpolation) == 1 and interpolation <= {'LINEAR', 'CONSTANT'}
    assert all([float(key.co.x) for key in curve.keyframe_points] == frames for curve in axes)
    values = [[float(curve.keyframe_points[index].co.y) for curve in axes] for index in range(len(frames))]
    # Remove only equal-value interior hold keys. All fade values and plateau endpoints remain.
    keep = [index for index, value in enumerate(values)
            if index in (0, len(values) - 1) or values[index - 1] != value or values[index + 1] != value]
    return dict(name=bone + '.scale', interpolation=next(iter(interpolation)), sourceKeyCount=len(frames),
                keys=[[frames[index], *values[index]] for index in keep])


def audit(recipe, root):
    path = root / recipe['source']
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
    scene = bpy.data.scenes[recipe['scene']]
    bpy.context.window.scene = scene
    armature = scene.objects[recipe['armature']]
    fps = scene.render.fps / scene.render.fps_base
    clips, controls, targets = [], {}, set()
    for role, (name, bones) in recipe['controls'].items():
        action = bpy.data.actions[recipe['prefix'] + name]
        curves = curves_for(action)
        tracks = [scale_track(curves, bone) for bone in bones]
        # Actual unrelated authoring pose, deliberately NOT part of the control whitelist.
        tracks.append(scale_track(curves, 'righthand'))
        origin, end = map(float, action.frame_range)
        assert origin == 1 and action.get('duration_seconds') == (end - origin) / fps
        total = sum(len(bag.fcurves) for layer in action.layers for strip in layer.strips for bag in strip.channelbags)
        clips.append(dict(name=name, duration=(end - origin) / fps, sourceCurveCount=total,
                          selectedSlotCurveCount=len(curves), tracks=tracks))
        controls[role] = dict(clip=name, tracks=[bone + '.scale' for bone in bones])
        targets.update(bones)
    targets.add('righthand')
    selected = {bone for bone in armature.data.bones
                if bone.name in targets or any(parent.name in targets for parent in bone.parent_recursive)}
    selected.update(parent for bone in list(selected) for parent in bone.parent_recursive)
    bones = [dict(name=bone.name, parent=bone.parent.name if bone.parent else None)
             for bone in armature.data.bones if bone in selected]
    weights = {}
    for name in sorted(targets):
        descendants = {name, *(bone.name for bone in armature.data.bones
                              if any(parent.name == name for parent in bone.parent_recursive))}
        weighted = {}
        for obj in scene.objects:
            if obj.type != 'MESH':
                continue
            groups = {group.index: group.name for group in obj.vertex_groups if group.name in descendants}
            counts = {group_name: sum(any(g.group == index and g.weight > .001 for g in vertex.groups)
                                     for vertex in obj.data.vertices) for index, group_name in groups.items()}
            if any(counts.values()):
                weighted[obj.name] = {key: count for key, count in counts.items() if count}
        weights[name] = weighted
    result = dict(schemaVersion=1, weaponId=recipe['weapon_id'], source=recipe['source'], sourceSha256=before,
                  scene=recipe['scene'], armature=recipe['armature'], blenderVersion=bpy.app.version_string,
                  fps=fps, timeOriginFrame=1, bones=bones, clips=clips, runtimeControls=controls,
                  displayPolicy='visible-feed-window: min(magazine, authored indicator count), not total capacity',
                  ammoDisplay=dict(control='ammoDisplay', levels=[dict(minimum=count, time=struct.unpack('<f', struct.pack('<f', (frame - 1) / fps))[0])
                                                                 for count, frame in recipe['levels']]),
                  weightedDescendants=weights)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before, 'Authoring source changed during audit'
    return result


def encode(result):
    # One numeric key per line, keeping generated diffs small and directly inspectable.
    text = json.dumps(result, indent=2) + '\n'
    import re
    return re.sub(r'\[\n\s+([-\d.eE+]+),\n\s+([-\d.eE+]+),\n\s+([-\d.eE+]+),\n\s+([-\d.eE+]+)\n\s+\]',
                  r'[\1, \2, \3, \4]', text)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[2]
    for recipe in RECIPES:
        result = audit(recipe, root)
        (output / (recipe['weapon_id'] + '-controls.json')).write_text(encode(result), encoding='utf8')
        print(json.dumps(dict(weapon=recipe['weapon_id'], sourceUnchanged=True,
                              sourceSha256=result['sourceSha256'], clips=len(result['clips']),
                              selectedProperties=sum(len(c['tracks']) for c in result['runtimeControls'].values()))))
