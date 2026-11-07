"""Validate atlas ownership on the existing UV layout, at bake texel centers."""
import numpy as np


def validate_uv_ownership(objects, material_pages, page_sizes):
    owners = {page: np.full((height, width), -1, dtype=np.int32) for page, (width, height) in page_sizes.items()}
    labels = []
    collisions = {}
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers['BakeUV']
        face_ids = {}
        for triangle in mesh.loop_triangles:
            face = mesh.polygons[triangle.polygon_index]
            if face.index not in face_ids:
                face_ids[face.index] = len(labels)
                labels.append(f'{obj.name}/face:{face.index}')
            face_id = face_ids[face.index]
            page = material_pages[mesh.materials[face.material_index].name]
            width, height = page_sizes[page]
            points = np.array([uv.data[i].uv[:] for i in triangle.loops], dtype=np.float64)
            if (points < -1e-5).any() or (points > 1.00001).any():
                raise ValueError(f'{labels[face_id]}: BakeUV outside atlas')
            points *= (width, height)
            lo = np.maximum(np.floor(points.min(axis=0)).astype(int), 0)
            hi = np.minimum(np.ceil(points.max(axis=0)).astype(int), (width, height))
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
            target = owners[page][lo[1]:hi[1], lo[0]:hi[0]]
            conflict = inside & (target >= 0) & (target != face_id)
            for other in np.unique(target[conflict]):
                key = (page, labels[int(other)], labels[face_id])
                collisions[key] = collisions.get(key, 0) + int(np.count_nonzero(conflict & (target == other)))
            target[inside] = face_id
    if collisions:
        raise ValueError('Overlapping lightmap islands: ' + repr(sorted(collisions.items(), key=lambda x: -x[1])[:20]))
    return {'overlappingTexels': 0, 'faces': len(labels), 'occupiedTexels': {page: int(np.count_nonzero(data >= 0)) for page, data in owners.items()}}
