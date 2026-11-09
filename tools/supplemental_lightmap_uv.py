"""Pack and replay a supplemental lightmap without altering albedo UVs."""
import math

import bpy
import numpy as np


def matches_source(material, name):
    return bool(material) and (material.name == name or (
        material.name.startswith(name + '.') and material.name[len(name) + 1:].isdecimal()))


def apply_scale(obj, expected):
    if not np.allclose(tuple(obj.scale), expected, rtol=0, atol=1e-6):
        raise ValueError(f'{obj.name}: source scale changed')
    if np.allclose(expected, (1, 1, 1), rtol=0, atol=1e-8):
        return
    before = np.asarray([obj.matrix_world @ vertex.co for vertex in obj.data.vertices])
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    after = np.asarray([obj.matrix_world @ vertex.co for vertex in obj.data.vertices])
    if not np.allclose(before, after, rtol=0, atol=1e-5):
        raise ValueError(f'{obj.name}: applying scale changed world-space geometry')


def make_plan(objects, source_materials, page, size, margin=12):
    if size <= 2 * margin:
        raise ValueError('Atlas must have room for the requested margin')
    records = []
    for obj in objects:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        names = source_materials[obj.name]
        if len(names) != len(obj.data.materials):
            raise ValueError(f'{obj.name}: source material slots changed')
        for source, material in zip(names, obj.data.materials):
            if not matches_source(material, source):
                raise ValueError(f'{obj.name}: expected source material {source}')
        record = {'name': obj.name, 'sourceMaterials': names, 'sourceScale': list(obj.scale),
                  'sourceMatrixWorld': [list(row) for row in obj.matrix_world]}
        records.append(record)
        apply_scale(obj, record['sourceScale'])
        uv = obj.data.uv_layers.get('BakeUV') or obj.data.uv_layers.new(name='BakeUV')
        obj.data.uv_layers.active = uv
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    try:
        bpy.ops.mesh.select_all(action='SELECT')
        # A single multi-object pack gives the two receivers the same texel density.
        bpy.ops.uv.smart_project(island_margin=0.04, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    finally:
        bpy.ops.object.mode_set(mode='OBJECT')
    border = margin / size
    for obj, record in zip(objects, records):
        layer = obj.data.uv_layers['BakeUV']
        for loop in layer.data:
            loop.uv = tuple(value * (1 - 2 * border) + border for value in loop.uv)
        record['uv'] = [list(loop.uv) for loop in layer.data]
    return {'version': 1, 'atlasId': page, 'width': size, 'height': size, 'margin': margin, 'objects': records}


def apply_plan(scene, plan, prepared=False):
    if plan.get('version') != 1 or not plan.get('objects'):
        raise ValueError('Unsupported supplemental UV plan')
    for record in plan['objects']:
        obj = scene.objects.get(record['name'])
        if not obj or obj.type != 'MESH':
            raise ValueError(f'Missing supplemental receiver: {record["name"]}')
        if not prepared:
            if not np.allclose(np.asarray(obj.matrix_world), record['sourceMatrixWorld'], rtol=0, atol=1e-6):
                raise ValueError(f'{obj.name}: source transform changed')
            if obj.data.users > 1:
                obj.data = obj.data.copy()
            apply_scale(obj, record['sourceScale'])
        uv = obj.data.uv_layers.get('BakeUV') or obj.data.uv_layers.new(name='BakeUV')
        values = np.asarray(record['uv'], dtype=np.float32)
        if values.shape != (len(uv.data), 2) or not np.isfinite(values).all() or (values < 0).any() or (values > 1).any():
            raise ValueError(f'{obj.name}: invalid stored BakeUV')
        uv.data.foreach_set('uv', values.ravel())
        obj.data.uv_layers.active = uv
        for layer in obj.data.uv_layers:
            layer.active_render = layer.name == 'BakeUV'
        if len(obj.data.materials) != len(record['sourceMaterials']):
            raise ValueError(f'{obj.name}: source material slots changed')
        for index, source in enumerate(record['sourceMaterials']):
            original = obj.data.materials[index]
            if not matches_source(original, source):
                raise ValueError(f'{obj.name}: source material in slot {index} changed')
            material = original.copy()
            material.name = f'SUPPLEMENT__{plan["atlasId"]}__{obj.name}__{index}'
            material['lightmapSourceMaterial'] = source
            material['lightmapPage'] = plan['atlasId']
            shaders = [node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED']
            outputs = [node for node in material.node_tree.nodes if node.type == 'OUTPUT_MATERIAL' and node.is_active_output]
            if len(shaders) != 1 or len(outputs) != 1:
                raise ValueError(f'{obj.name}: cannot restore the original Principled material in slot {index}')
            material.node_tree.links.new(shaders[0].outputs[0], outputs[0].inputs['Surface'])
            # Texture Coordinate / UV otherwise follows the active render UV,
            # which must be BakeUV during baking and would corrupt the albedo.
            for node in list(material.node_tree.nodes):
                if node.type != 'TEX_COORD':
                    continue
                uv_socket = next((socket for socket in node.outputs if socket.identifier == 'UV'), None)
                links = [link for link in material.node_tree.links if link.from_socket == uv_socket]
                if links:
                    albedo_uv = material.node_tree.nodes.new('ShaderNodeUVMap')
                    albedo_uv.uv_map = obj.data.uv_layers[0].name
                    for link in links:
                        material.node_tree.links.new(albedo_uv.outputs[0], link.to_socket)
            obj.data.materials[index] = material


def validate_padding(objects, size, margin):
    """Detect overlapping padded UV islands, including across distinct objects."""
    parents, faces = [], []
    for obj in objects:
        uv, edges = obj.data.uv_layers['BakeUV'], {}
        for face in obj.data.polygons:
            face_id = len(parents)
            parents.append(face_id)
            faces.append((obj, face))
            loops = list(face.loop_indices)
            for i, a in enumerate(loops):
                b = loops[(i + 1) % len(loops)]
                va, vb = obj.data.loops[a].vertex_index, obj.data.loops[b].vertex_index
                if va > vb:
                    a, b, va, vb = b, a, vb, va
                key = (va, vb, *[round(float(x), 6) for x in uv.data[a].uv], *[round(float(x), 6) for x in uv.data[b].uv])
                if key in edges:
                    x, y = face_id, edges[key]
                    while parents[x] != x:
                        x = parents[x]
                    while parents[y] != y:
                        y = parents[y]
                    parents[x] = y
                else:
                    edges[key] = face_id

    def root(index):
        while parents[index] != index:
            index = parents[index]
        return index

    ids = {key: i + 1 for i, key in enumerate(sorted({root(i) for i in range(len(faces))}))}
    labels = {(obj.name, face.index): ids[root(i)] for i, (obj, face) in enumerate(faces)}
    owners = np.zeros((size, size), dtype=np.int32)
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers['BakeUV']
        coordinates = np.asarray([loop.uv[:] for loop in uv.data])
        if (coordinates < margin / size - 1e-6).any() or (coordinates > 1 - margin / size + 1e-6).any():
            raise ValueError(f'{obj.name}: UV island is too close to the atlas edge')
        for tri in mesh.loop_triangles:
            points = np.array([uv.data[i].uv[:] for i in tri.loops], dtype=np.float64) * size
            lo = np.maximum(np.floor(points.min(axis=0)).astype(int), 0)
            hi = np.minimum(np.ceil(points.max(axis=0)).astype(int), (size, size))
            if np.any(hi <= lo):
                continue
            xs, ys = np.meshgrid(np.arange(lo[0], hi[0]) + .5, np.arange(lo[1], hi[1]) + .5)
            a, b, c = points
            denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(denominator) < 1e-8:
                continue
            u = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / denominator
            v = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / denominator
            inside = (u >= 1e-7) & (v >= 1e-7) & (u + v <= 1 - 1e-7)
            owners[lo[1]:hi[1], lo[0]:hi[0]][inside] = labels[obj.name, tri.polygon_index]

    def spread(data, maximum, fill):
        op = np.maximum if maximum else np.minimum
        for axis in range(2):
            output = np.full_like(data, fill)
            for offset in range(-margin, margin + 1):
                target, source = [slice(None), slice(None)], [slice(None), slice(None)]
                target[axis] = slice(max(0, offset), min(size, size + offset))
                source[axis] = slice(max(0, -offset), min(size, size - offset))
                op(output[tuple(target)], data[tuple(source)], out=output[tuple(target)])
            data = output
        return data

    sentinel = np.iinfo(np.int32).max
    largest = spread(owners, True, 0)
    smallest = spread(np.where(owners > 0, owners, sentinel), False, sentinel)
    conflicts = int(np.count_nonzero((largest > 0) & (smallest < largest)))
    if conflicts:
        raise ValueError(f'Supplemental UV islands have {conflicts} overlapping padded texels')
    return {'islands': len(ids), 'margin': margin, 'overlappingPaddedTexels': conflicts}


def density(objects, size):
    report = {}
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers['BakeUV']
        area = uv_area = 0.0
        for tri in mesh.loop_triangles:
            points = [obj.matrix_world @ mesh.vertices[index].co for index in tri.vertices]
            area += (points[1] - points[0]).cross(points[2] - points[0]).length / 2
            a, b, c = [uv.data[index].uv for index in tri.loops]
            uv_area += abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
        report[obj.name] = {'surfaceArea': area, 'uvArea': uv_area, 'texelsPerMetre': math.sqrt(uv_area / area) * size if area else 0}
    return report
