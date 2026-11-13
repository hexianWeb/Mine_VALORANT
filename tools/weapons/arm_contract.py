"""Shared arm UV and packed-image checks; imported by the Blender exporter."""
import hashlib
import json
import math
from pathlib import Path

import bpy


def load_contract():
    filename = Path(__file__).with_name('arm-contract.json')
    contract = json.loads(filename.read_text(encoding='utf8'))
    root = filename.parent.parent.parent
    atlas = root / contract['atlas']
    assert hashlib.sha256(atlas.read_bytes()).hexdigest() == contract['textureSha256'], 'Arm atlas changed'
    return contract, atlas


def arm(side, contract):
    obj = bpy.data.objects['Arms_' + side]
    assert obj.type == 'MESH', obj.name
    mesh = obj.data
    assert len(mesh.vertices) == len(contract['sides'][side]), obj.name
    assert [v for poly in mesh.polygons for v in poly.vertices] == contract['indices'], f'{obj.name}: topology mismatch'
    uv = mesh.uv_layers.get('SourceUV')
    assert uv is not None, f'{obj.name}: missing SourceUV'
    assert len(mesh.materials) == 1, f'{obj.name}: unexpected material slots'
    material = mesh.materials[0]
    assert material and material.node_tree, f'{obj.name}: missing material'
    images = [n for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]
    assert len(images) == 1 and images[0].image.packed_file, f'{obj.name}: expected one packed arm texture'
    # A material shared by a different mesh would change that mesh's appearance too.
    material_objects = {o for o in bpy.data.objects if o.type == 'MESH' and material in o.data.materials[:]}
    mesh_objects = {o for o in bpy.data.objects if o.type == 'MESH' and o.data == mesh}
    assert material_objects == mesh_objects and all(o.name == obj.name or o.name.startswith(obj.name + ' | ') for o in mesh_objects), f'{obj.name}: unexpected shared material/mesh'
    return obj, uv, images[0]


def validate_arms(contract):
    images = []
    for side in ('Left', 'Right'):
        obj, uv, node = arm(side, contract)
        for loop in obj.data.loops:
            expected = contract['sides'][side][loop.vertex_index]
            assert all(abs(uv.data[loop.index].uv[i] - expected[i]) < 1e-6 for i in range(2)), f'{obj.name}: UV mismatch at loop {loop.index}'
        image = node.image
        assert list(image.size) == [contract['width'], contract['height']], f'{obj.name}: wrong atlas dimensions'
        assert hashlib.sha256(bytes(image.packed_file.data)).hexdigest() == contract['textureSha256'], f'{obj.name}: wrong packed atlas'
        images.append(image)
    assert images[0] == images[1], 'Left and right arms must use the same packed image'


def _pixel(image, u, v):
    width, height = image.size
    x = min(width - 1, max(0, math.floor(u * width)))
    y = min(height - 1, max(0, math.floor(v * height)))
    index = (y * width + x) * 4
    return image.pixels[index:index + 4]


def verify_appearance(side, contract, atlas_image):
    """Compare every atlas texel center inside each triangle with the original mapping."""
    obj, uv, node = arm(side, contract)
    image = node.image
    assert image.colorspace_settings.name == atlas_image.colorspace_settings.name, f'{obj.name}: color space mismatch'
    samples = 0
    for poly in obj.data.polygons:
        loops = list(poly.loop_indices)
        assert len(loops) == 3
        canonical = [contract['sides'][side][obj.data.loops[i].vertex_index] for i in loops]
        original = [list(uv.data[i].uv) for i in loops]
        a, b, c = canonical
        denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        assert abs(denominator) > 1e-9
        xs = [p[0] * contract['width'] for p in canonical]
        ys = [p[1] * contract['height'] for p in canonical]
        for x in range(math.floor(min(xs)), math.ceil(max(xs))):
            for y in range(math.floor(min(ys)), math.ceil(max(ys))):
                u = (x + 0.5) / contract['width']
                v = (y + 0.5) / contract['height']
                w0 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / denominator
                w1 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / denominator
                weights = (w0, w1, 1 - w0 - w1)
                if min(weights) < -1e-7:
                    continue
                old_uv = [sum(w * vertex[i] for w, vertex in zip(weights, original)) for i in range(2)]
                expected, actual = _pixel(atlas_image, u, v), _pixel(image, *old_uv)
                assert expected[3] > 0.99 and actual[3] > 0.99, f'{obj.name}: transparent sampled texel'
                assert max(abs(a - b) for a, b in zip(expected, actual)) < 1e-5, f'{obj.name}: different sampled texel'
                samples += 1
    assert samples > 0, f'{obj.name}: no samples'
    return samples
