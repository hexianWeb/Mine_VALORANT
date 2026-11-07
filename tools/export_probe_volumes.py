"""Read-only export of Blender LightProbeVolumes boxes; never changes the scene.

From Blender's console (also works via MCP):
  import runpy
  export = runpy.run_path('/project/tools/export_probe_volumes.py')
  export['export_volumes']('/project/public/lighting/range-room-probes/volumes.json')

Optional object properties: probe_resolution (XYZ in Three.js), probe_priority.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


def export_volumes(output):
    collection = bpy.data.collections.get('LightProbeVolumes')
    if collection is None:
        raise ValueError('Missing LightProbeVolumes collection')
    volumes = []
    for obj in sorted(collection.all_objects, key=lambda item: item.name):
        if obj.type != 'MESH':
            continue
        axes = obj.matrix_world.to_3x3()
        if any(abs(axes[row][col]) > 1e-5 for row in range(3) for col in range(3) if row != col):
            raise ValueError(f'{obj.name}: probe boxes must be axis aligned in world space')
        # Use all world-space corners: the authored origins need not be box centers.
        corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        converted = [(v.x, v.z, -v.y) for v in corners]
        minimum = [min(v[i] for v in converted) for i in range(3)]
        maximum = [max(v[i] for v in converted) for i in range(3)]
        size = [maximum[i] - minimum[i] for i in range(3)]
        if not all(math.isfinite(v) and v > 0 for v in size):
            raise ValueError(f'{obj.name}: invalid box dimensions')
        spacing = [5, 4, 5]
        resolution = list(obj.get('probe_resolution', [max(2, math.ceil(size[i] / spacing[i])) for i in range(3)]))
        if len(resolution) != 3 or any(not isinstance(n, int) or not 2 <= n <= 32 for n in resolution):
            raise ValueError(f'{obj.name}: probe_resolution must contain three integers in [2, 32]')
        volumes.append({
            'id': obj.name,
            'min': minimum,
            'max': maximum,
            'resolution': resolution,
            'priority': int(obj.get('probe_priority', 10 if 'Corridor' in obj.name else 0)),
        })
    if not volumes:
        raise ValueError('LightProbeVolumes contains no mesh boxes')
    result = {
        'version': 1,
        'collection': collection.name,
        'coordinateSystem': 'three-y-up',
        'source': Path(bpy.data.filepath).name,
        'volumes': volumes,
    }
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    return result
