"""Export the simplified collision box layer to runtime JSON. Read-only: never edits the scene.

Background:  blender --background room.blend --python tools/export_collision.py -- --out public/collision/range-room.json
Live (MCP):  set COLLISION_ARGS = ['--out', '<abs path>'] then exec() this file inside Blender.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT_COLLECTION = 'COLLISION_PracticeRoom'
GROUP_PREFIX = 'COLLISION_'
SPAWN_NAME = 'Spawn'
PLAYER_WIDTH = 0.6
PLAYER_HEIGHT = 1.8
EPSILON = 1e-4


def coordinate(vector):
    """Blender Z-up -> runtime Y-up, same rule as the room manifest (x, z, -y)."""
    return [float(vector[0]), float(vector[2]), float(-vector[1])]


def runtime_box(obj):
    if obj.type != 'MESH' or len(obj.data.vertices) != 8 or obj.modifiers:
        raise ValueError(f'{obj.name}: collision objects must be unmodified 8-vertex boxes')
    points = [coordinate(obj.matrix_world @ v.co) for v in obj.data.vertices]
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    for p in points:
        if any(min(abs(p[i] - low[i]), abs(p[i] - high[i])) > EPSILON for i in range(3)):
            raise ValueError(f'{obj.name}: box is rotated; only 90-degree rotations are allowed')
    if any(high[i] - low[i] <= EPSILON for i in range(3)):
        raise ValueError(f'{obj.name}: degenerate box')
    return low, high


def overlaps(a_min, a_max, b_min, b_max):
    return all(a_min[i] < b_max[i] - EPSILON and a_max[i] > b_min[i] + EPSILON for i in range(3))


def find_spawn(boxes):
    """Prefer a `Spawn` empty (local -Y is forward); otherwise drop the scene camera onto the highest box below it."""
    markers = [o for o in bpy.data.objects if o.type == 'EMPTY' and o.name.strip() == SPAWN_NAME]
    if len(markers) > 1:
        raise ValueError(f'More than one Spawn empty: {[o.name for o in markers]}')
    marker = markers[0] if markers else None
    source = marker or bpy.context.scene.camera
    if source is None:
        raise ValueError('No Spawn empty and no scene camera to derive a spawn from')
    position = coordinate(source.matrix_world.translation)
    local_forward = Vector((0, -1, 0)) if marker else Vector((0, 0, -1))
    forward = coordinate(source.matrix_world.to_quaternion() @ local_forward)
    if math.hypot(forward[0], forward[2]) < 1e-3:
        raise ValueError(f'{source.name}: forward axis is vertical, cannot derive a yaw')
    yaw = math.degrees(math.atan2(-forward[0], -forward[2]))
    if marker is None:
        x, top, z = position
        floors = [b['max'][1] for b in boxes
                  if b['min'][0] <= x <= b['max'][0] and b['min'][2] <= z <= b['max'][2] and b['max'][1] <= top]
        if not floors:
            raise ValueError(f'No floor box below {source.name}')
        position[1] = max(floors)
    half = PLAYER_WIDTH / 2
    feet_min = [position[0] - half, position[1], position[2] - half]
    feet_max = [position[0] + half, position[1] + PLAYER_HEIGHT, position[2] + half]
    blocking = [b['name'] for b in boxes if overlaps(feet_min, feet_max, b['min'], b['max'])]
    if blocking:
        raise ValueError(f'Spawn overlaps collision boxes: {blocking}')
    return {
        'position': [round(v, 4) for v in position],
        'yawDeg': round(yaw, 2),
        'source': f'empty "{marker.name}"' if marker else f'scene camera "{source.name}" dropped to floor',
    }


def export(out_path):
    root = bpy.data.collections.get(ROOT_COLLECTION)
    if root is None:
        raise ValueError(f'Collection {ROOT_COLLECTION} not found')
    if any(o.type == 'MESH' for o in root.objects):
        raise ValueError(f'Put collision meshes in a {GROUP_PREFIX}* child collection, not directly in {ROOT_COLLECTION}')
    boxes = []
    seen = set()
    for child in root.children:
        group = child.name.removeprefix(GROUP_PREFIX)
        for obj in child.all_objects:
            if obj.name in seen:
                raise ValueError(f'{obj.name}: linked into more than one collision group')
            seen.add(obj.name)
            low, high = runtime_box(obj)
            boxes.append({
                'name': obj.name,
                'group': group,
                'min': [round(v, 4) for v in low],
                'max': [round(v, 4) for v in high],
            })
    if not boxes:
        raise ValueError('Collision layer is empty')
    boxes.sort(key=lambda b: (b['group'], b['name']))
    bounds_min = [min(b['min'][i] for b in boxes) for i in range(3)]
    bounds_max = [max(b['max'][i] for b in boxes) for i in range(3)]
    groups = {}
    for b in boxes:
        groups[b['group']] = groups.get(b['group'], 0) + 1
    data = {
        'schemaVersion': 1,
        'id': 'range-room-collision-v1',
        'units': 'metres',
        'up': 'Y',
        'source': {
            'blend': Path(bpy.data.filepath).name,
            'collection': ROOT_COLLECTION,
            'conversion': 'x,z,-y',
        },
        'spawn': find_spawn(boxes),
        'bounds': {'min': [round(v, 4) for v in bounds_min], 'max': [round(v, 4) for v in bounds_max]},
        'counts': {'boxes': len(boxes), 'groups': groups},
        'boxes': boxes,
    }
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(json.dumps({k: data[k] for k in ('spawn', 'bounds', 'counts')}, ensure_ascii=False))
    return data


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    export(parser.parse_args(argv).out)


if __name__ == '__main__':
    args = globals().get('COLLISION_ARGS')
    if args is None:
        args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(args)
