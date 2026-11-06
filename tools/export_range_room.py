"""Export a saved room snapshot. Run in BACKGROUND Blender, never on the live file.

blender --background snapshot.blend --python tools/export_range_room.py -- \
    --project /path/to/project --scope scope.json [--reference-dir /temporary/path]
"""
import argparse
import hashlib
import importlib.util
import json
import math
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def choose_enum(owner, property_name, requested):
    identifiers = [item.identifier for item in owner.bl_rna.properties[property_name].enum_items]
    if requested not in identifiers:
        raise ValueError(f"Unsupported {property_name}={requested}; available: {identifiers}")
    return requested


def read_glb(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError('Invalid exported GLB')
    size, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4E4F534A:
        raise ValueError('GLB has no JSON chunk')
    return json.loads(data[20:20 + size])


def surface_source(material):
    output = next(n for n in material.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    source = output.inputs['Surface'].links[0].from_node
    if source.type == 'MIX_SHADER' and source.inputs[0].is_linked:
        link = source.inputs[0].links[0]
        if link.from_node.type == 'LIGHT_PATH':
            return output, source.inputs[1].links[0].from_socket
    return output, output.inputs['Surface'].links[0].from_socket


def coordinate(vector):
    return [float(vector[0]), float(vector[2]), float(-vector[1])]


def main():
    if not bpy.app.background:
        raise RuntimeError('Use a background Blender snapshot; this tool must not edit the live scene.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', required=True)
    parser.add_argument('--scope', required=True)
    parser.add_argument('--reference-dir')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    project = Path(args.project).resolve()
    scope = json.loads(Path(args.scope).read_text(encoding='utf-8'))
    out = project / 'public' / 'lighting' / 'range-room'
    atlas_dir = out / 'atlases'
    atlas_dir.mkdir(parents=True, exist_ok=True)
    model = project / 'public' / 'model' / 'range-room.glb'
    if (out / 'manifest.json').exists() or model.exists():
        raise FileExistsError('Room assets already exist. Export to a new destination or explicitly archive them first.')
    scene = bpy.context.scene
    objects = [scene.objects[name] for name in scope['objects']]
    if not objects or any(o.type != 'MESH' for o in objects):
        raise ValueError('Scope must be an explicit nonempty list of mesh objects')

    # Classify actual image alpha in the disposable snapshot, not in the live file.
    # This prevents a later export from reintroducing the legacy all-BLEND bug.
    alpha_tool = Path(__file__).with_name('repair_blender_alpha.py')
    spec = importlib.util.spec_from_file_location('range_room_alpha', alpha_tool)
    repair = importlib.util.module_from_spec(spec)
    previous_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(repair)
    finally:
        sys.dont_write_bytecode = previous_bytecode
    # Packed image buffers are loaded lazily in a background .blend. Reading the
    # alpha buffer first avoids confusing "not loaded yet" with a missing file.
    for material in {slot.material for obj in objects for slot in obj.material_slots if slot.material}:
        shader = repair.surface_shader(material)
        if shader and shader.type == 'BSDF_PRINCIPLED' and shader.inputs['Alpha'].is_linked:
            source = shader.inputs['Alpha'].links[0].from_node
            if source.type == 'TEX_IMAGE' and source.image:
                _ = len(source.image.pixels)
    alpha_report = repair.repair_scene_alpha(apply=True)
    if alpha_report['unresolved']:
        raise ValueError(f'Unresolved material alpha: {alpha_report["unresolved"]}')

    # Scene-linear EXR output: save_render does not bake the display view into EXR.
    settings = scene.render.image_settings
    settings.file_format = choose_enum(settings, 'file_format', 'OPEN_EXR')
    settings.color_depth = choose_enum(settings, 'color_depth', '16')
    settings.color_mode = choose_enum(settings, 'color_mode', 'RGBA')
    settings.exr_codec = choose_enum(settings, 'exr_codec', 'ZIP')
    atlas_images = sorted((i for i in bpy.data.images if i.name.startswith('DENOISED_HDR__B')), key=lambda i: i.name)
    if len(atlas_images) != 5:
        raise ValueError(f'Expected exactly 5 denoised atlases, found {len(atlas_images)}')
    pages = []
    image_page = {}
    for image in atlas_images:
        page_id = image.name.split('__', 1)[1].split('_', 1)[0]
        target = atlas_dir / f'{page_id}.exr'
        if target.exists():
            raise FileExistsError(target)
        image.save_render(str(target), scene=scene)
        check = bpy.data.images.load(str(target), check_existing=False)
        pixels = np.empty(len(check.pixels), dtype=np.float32)
        check.pixels.foreach_get(pixels)
        if not np.isfinite(pixels).all() or float(np.max(pixels[0::4])) <= 0:
            raise ValueError(f'{page_id}: invalid or empty exported image')
        pages.append({
            'id': page_id, 'url': f'./atlases/{page_id}.exr', 'sha256': digest(target),
            'width': check.size[0], 'height': check.size[1],
            'content': 'baked-appearance', 'colorSpace': 'linear-rec709',
            'sourceImage': image.name, 'sourceColorSpace': image.colorspace_settings.name,
            'encoding': 'exr-half', 'flipY': False,
            'sampling': {'filter': 'linear', 'mipmaps': False, 'maxLod': 0},
            'verification': {'finite': True, 'rgbMax': float(np.max(pixels.reshape(-1, 4)[:, :3]))},
        })
        image_page[image.name] = page_id
        bpy.data.images.remove(check)

    material_records = {}
    original_outputs = {}
    for obj in objects:
        obj['rangeRoomId'] = 'room-' + hashlib.sha256(obj.name.encode()).hexdigest()[:16]
        # Preserve the source UV layers. The exported attributes are checked below.
        for slot in obj.material_slots:
            material = slot.material
            if not material or not material.use_nodes:
                raise ValueError(f'{obj.name}: material must use nodes')
            if material.name in material_records:
                continue
            textures = [n for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name in image_page]
            mode = 'baked-appearance' if textures else 'realtime'
            record = {'mode': mode, 'sourceMaterial': material.name}
            if textures:
                ids = {image_page[n.image.name] for n in textures}
                if len(ids) != 1 or not obj.data.uv_layers.get('BakeUV'):
                    raise ValueError(f'{obj.name}/{material.name}: ambiguous atlas or missing BakeUV')
                record.update(atlasId=ids.pop(), uvChannel=list(obj.data.uv_layers).index(obj.data.uv_layers['BakeUV']))
            elif '连续顶灯' in obj.name and '发光面' in obj.name:
                emission = next(n for n in material.node_tree.nodes if n.type == 'EMISSION')
                record.update(mode='fixture-emissive', emissionColor=list(emission.inputs['Color'].default_value)[:3], emissionStrength=float(emission.inputs['Strength'].default_value))
            material['rangeRoomMaterial'] = hashlib.sha256(material.name.encode()).hexdigest()[:16]
            material_records[material.name] = record
            output, original = surface_source(material)
            original_outputs[material.name] = (output, output.inputs['Surface'].links[0].from_socket)
            material.node_tree.links.new(original, output.inputs['Surface'])

    light_records = []
    for obj in scene.objects:
        if obj.type != 'LIGHT' or '连续顶灯' not in obj.name:
            continue
        light = obj.data
        direction = obj.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        light_records.append({
            'id': obj.name, 'type': 'rect-area', 'position': coordinate(obj.matrix_world.translation),
            'direction': coordinate(direction), 'width': light.size, 'height': light.size_y,
            'color': list(light.color), 'sourcePowerWatts': light.energy,
            'sourceSpreadRadians': light.spread, 'sourceNormalize': light.normalize,
            # Watt -> luminance requires calibration; this is explicitly a starting fit.
            'intensity': 5.0, 'calibration': 'initial-fit-not-photometric-equivalence',
        })
    if len(light_records) != 3:
        raise ValueError('Expected the three ceiling strip lights')

    camera = scene.camera
    if not camera:
        raise ValueError('No active reference camera')
    conversion = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    matrix = conversion @ camera.matrix_world
    position, rotation, _ = matrix.decompose()
    aspect = scene.render.resolution_x / scene.render.resolution_y
    vertical_fov = 2 * math.atan(camera.data.sensor_width / (2 * camera.data.lens * aspect))
    reference_camera = {'position': list(position), 'quaternion': list(rotation)[1:] + [rotation.w], 'fov': math.degrees(vertical_fov), 'near': camera.data.clip_start, 'far': camera.data.clip_end, 'aspect': aspect}

    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    # glTF's dynamic format property defaults to binary GLB; inspect the resulting file.
    bpy.ops.export_scene.gltf(filepath=str(model), use_selection=True, export_extras=True,
                              export_texcoords=True, export_cameras=False, export_lights=False,
                              export_animations=False)
    document = read_glb(model)
    bindings = []
    source_names = {}
    for material in bpy.data.materials:
        if 'rangeRoomMaterial' in material:
            source_names[material['rangeRoomMaterial']] = material.name
    used_pages = set()
    for node in document['nodes']:
        if 'mesh' not in node:
            continue
        receiver = node.get('extras', {}).get('rangeRoomId')
        if not receiver:
            raise ValueError(f'Exported mesh node lacks stable ID: {node.get("name")}')
        mesh_index = node['mesh']
        for primitive_index, primitive in enumerate(document['meshes'][mesh_index]['primitives']):
            mat = document['materials'][primitive['material']]
            key = mat.get('extras', {}).get('rangeRoomMaterial')
            record = dict(material_records[source_names[key]])
            if record['mode'] == 'baked-appearance':
                attr = f'TEXCOORD_{record["uvChannel"]}'
                if attr not in primitive['attributes']:
                    raise ValueError(f'{node["name"]}: exported GLB missing {attr}; refusing a bad UV binding')
                used_pages.add(record['atlasId'])
            record.update(receiverId=receiver, meshIndex=mesh_index, primitiveIndex=primitive_index,
                          materialIndex=primitive['material'], sourceObject=node.get('name'))
            bindings.append(record)
    if used_pages != {page['id'] for page in pages}:
        raise ValueError(f'Unused or missing atlas pages: {used_pages}')
    manifest = {
        'schemaVersion': 3, 'id': 'range-room-v3', 'sourceBlend': scope['sourceBlend'],
        'model': {'url': '../../model/range-room.glb', 'sha256': digest(model)},
        'coordinates': {'up': 'Y', 'units': 'metres', 'conversion': 'x,z,-y', 'rootTransform': 'identity'},
        'atlases': pages, 'bindings': bindings, 'lights': light_records,
        'camera': reference_camera,
        'display': {'sourceView': scene.view_settings.view_transform, 'exposureEV': scene.view_settings.exposure, 'displayTransformBaked': False},
        'environment': {'color': [0.9, 0.95, 1.0], 'intensity': 0.35, 'calibration': 'controlled-low-frequency-approximation'},
        'verification': {'exportedObjects': [o.name for o in objects], 'emptySourceMeshes': [o.name for o in objects if len(o.data.polygons) == 0], 'meshNodes': len({b['receiverId'] for b in bindings}), 'primitiveCount': len(bindings), 'sourceUntouched': True, 'reunwrap': False, 'rebake': False, 'alphaRepair': alpha_report},
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('ROOM_EXPORT_COMPLETE ' + json.dumps({'objects': len(objects), 'primitives': len(bindings), 'pages': len(pages), 'modelBytes': model.stat().st_size, 'manifest': str(out / 'manifest.json')}), flush=True)

    if args.reference_dir:
        reference = Path(args.reference_dir)
        reference.mkdir(parents=True, exist_ok=True)
        # Restore the exact original camera/non-camera branch, not emission on all rays.
        for name, (output, socket) in original_outputs.items():
            bpy.data.materials[name].node_tree.links.new(socket, output.inputs['Surface'])
        settings.file_format = choose_enum(settings, 'file_format', 'PNG')
        settings.color_depth = choose_enum(settings, 'color_depth', '8')
        scene.render.filepath = str(reference / 'blender-reference.png')
        scene.cycles.samples = 32
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
