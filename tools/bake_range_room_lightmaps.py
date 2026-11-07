"""Rebake only the existing BakeUV collection in a disposable background snapshot.

blender -b snapshot.blend --python tools/bake_range_room_lightmaps.py -- \
    --project PROJECT --scope scope.json --work D:/opencode-temp/opencode/lightmap-bake

Add --reuse-lightmaps PREVIOUS_MANIFEST for model-only export with exact atlas reuse.
That path performs preparation and validation, then returns before Cycles setup.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def geometry_hash(objects):
    result = {}
    for obj in objects:
        digest = hashlib.sha256()
        for vertex in obj.data.vertices:
            digest.update(np.asarray(vertex.co, dtype=np.float32).tobytes())
        for polygon in obj.data.polygons:
            digest.update(np.asarray(polygon.vertices, dtype=np.int32).tobytes())
        for layer in obj.data.uv_layers:
            digest.update(layer.name.encode())
            values = np.empty(len(layer.data) * 2, dtype=np.float32)
            layer.data.foreach_get('uv', values)
            digest.update(values.tobytes())
        result[obj.name] = digest.hexdigest()
    return result


def main():
    if not bpy.app.background:
        raise RuntimeError('Bake only in a background snapshot')
    sys.dont_write_bytecode = True
    bpy.context.preferences.edit.use_global_undo = False
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', required=True)
    parser.add_argument('--scope', required=True)
    parser.add_argument('--work', required=True)
    parser.add_argument('--samples', type=int, default=512)
    parser.add_argument('--device', default='CUDA')
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--reuse-lightmaps', help='Export only: reuse an existing manifest and all atlas bytes; never initialize Cycles or bake')
    parser.add_argument('--reuse-pages', nargs='*', default=[], help='Reuse named completed raw EXRs from this exact snapshot/scope/work directory')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    project = Path(args.project)
    if not args.validate_only and any(path.exists() for path in [
        project / 'public/lighting/range-room-lightmap/manifest.json',
        project / 'public/model/range-room-lightmap.glb',
    ]):
        raise FileExistsError('Lightmap assets already exist; use a new output project or archive this variant first')
    exporter = load_tool('export_range_room')
    repair = load_tool('repair_blender_alpha')
    enum = exporter.choose_enum
    scene = bpy.context.scene
    scope = json.loads(Path(args.scope).read_text(encoding='utf-8'))
    reused = json.loads(Path(args.reuse_lightmaps).read_text(encoding='utf-8')) if args.reuse_lightmaps is not None else None
    if args.reuse_lightmaps is not None and (not isinstance(reused, dict) or reused.get('schemaVersion') != 4 or args.reuse_pages):
        raise ValueError('Export-only reuse requires a lightmap manifest and cannot use --reuse-pages')
    collection = bpy.data.collections.get(scope['collection'])
    if not collection:
        raise ValueError('Missing explicitly requested collection')
    receivers = sorted((o for o in collection.all_objects if o.type == 'MESH' and len(o.data.polygons)), key=lambda o: o.name)
    if not receivers or any(not o.data.uv_layers.get('BakeUV') for o in receivers):
        raise ValueError('Every receiver must already have BakeUV')
    exported = [scene.objects[name] for name in scope['objects']]
    # Authoring-only probe boxes are not room occluders, even if visible in Blender.
    probe_collection = bpy.data.collections.get('LightProbeVolumes')
    excluded_probe_boxes = []
    if probe_collection:
        for obj in probe_collection.all_objects:
            if obj.type != 'MESH':
                continue
            if obj in exported:
                raise ValueError(f'{obj.name}: probe volume cannot be part of the room export scope')
            obj.hide_render = True
            excluded_probe_boxes.append(obj.name)
    before = geometry_hash(exported)
    if reused is not None:
        existing = {binding['sourceObject'] for binding in reused['bindings'] if binding['mode'] == 'lightmap'}
        previous_source = reused['verification'].get('sourceGeometryUVHashes', reused['bake'].get('sourceGeometryUVHashes', reused['bake']['geometryUVHashes']))
        for obj in receivers:
            if obj.name not in existing or before[obj.name] != previous_source.get(obj.name):
                raise ValueError(f'{obj.name}: receiver geometry or UV changed; lightmap reuse cannot proceed')
    # The embedded material history shows these two top slots originally used
    # smooth_stone and were packed into B05. Later albedo edits reused materials
    # from B02/B03 without repacking BakeUV. Route by their existing islands.
    page_overrides = {'Double_Stone_Slab': {0: 'B05'}, 'Stone_Slab.001': {0: 'B05'}}
    override_records = []
    for obj in receivers:
        for slot, page in page_overrides.get(obj.name, {}).items():
            source = obj.data.materials[slot]
            material = source.copy()
            material.name = f'{source.name}__LIGHTMAP_{page}'
            material['lightmapSourceMaterial'] = source.name
            material['lightmapPage'] = page
            obj.data.materials[slot] = material
            override_records.append({'object': obj.name, 'slot': slot, 'sourceMaterial': source.name, 'atlasId': page, 'reason': 'BakeUV remains on original smooth_stone page after albedo reassignment'})
    source_materials = {m for o in receivers for m in o.data.materials if m}
    # The original surface branch is retained in the source file. Never bake the
    # old camera-ray emission atlas back into the new light-only textures.
    pages = {}
    material_pages = {}
    bake_targets = {}
    for material in sorted(source_materials, key=lambda item: item.name):
        old_images = {n.image for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('DENOISED_HDR__B')}
        if len(old_images) != 1:
            raise ValueError(f'{material.name}: expected one existing atlas binding')
        old = next(iter(old_images))
        page = material.get('lightmapPage', old.name.split('__', 1)[1].split('_', 1)[0])
        if page not in pages:
            image = bpy.data.images.new('LIGHTMAP_HDR__' + page, width=old.size[0], height=old.size[1], alpha=True, float_buffer=True)
            image.generated_color = (0, 0, 0, 0)
            image.alpha_mode = enum(image, 'alpha_mode', 'STRAIGHT')
            pages[page] = image
        output, source = exporter.surface_source(material)
        if source.node.type != 'BSDF_PRINCIPLED':
            raise ValueError(f'{material.name}: original Principled material unavailable')
        material.node_tree.links.new(source, output.inputs['Surface'])
        for node in material.node_tree.nodes:
            node.select = False
        target = material.node_tree.nodes.new('ShaderNodeTexImage')
        target.image = pages[page]
        target.label = 'Light-only bake target / BakeUV'
        target.select = True
        material.node_tree.nodes.active = target
        material_pages[material.name] = page
        bake_targets[material] = target
    # Explicit, source-checked island translations support newly duplicated faces
    # without repacking existing charts or editing albedo UVs / the live scene.
    translations = scope.get('bakeUVTranslations', [])
    source_geometry = before
    for entry in translations:
        obj = scene.objects[entry['object']]
        if obj not in receivers:
            raise ValueError('BakeUV translation must target an existing receiver')
        face = obj.data.polygons[entry['face']]
        uv = obj.data.uv_layers['BakeUV']
        current = np.asarray([uv.data[i].uv[:] for i in face.loop_indices])
        expected = np.asarray(entry['expectedUV'])
        delta = np.asarray(entry['delta'])
        page = material_pages[obj.data.materials[face.material_index].name]
        if page != entry['atlasId'] or current.shape != expected.shape or not np.allclose(current, expected, rtol=0, atol=1e-7):
            raise ValueError(f'{obj.name}/face:{face.index}: UV repair no longer matches the source')
        if delta.shape != (2,) or not np.isfinite(delta).all():
            raise ValueError('BakeUV translation must contain two finite values')
        for loop, value in zip(face.loop_indices, current + delta):
            uv.data[loop].uv = value
    if translations:
        before = geometry_hash(exported)
    ownership = load_tool('lightmap_uv').validate_uv_ownership(receivers, material_pages, {page: tuple(image.size) for page, image in pages.items()})
    print('LIGHTMAP_UV_VALIDATED ' + json.dumps({'ownership': ownership, 'pageOverrides': override_records, 'uvTranslations': translations}), flush=True)
    if args.validate_only:
        return
    if reused is not None:
        previous_prepared = reused['verification'].get('geometryUVHashes', reused['bake']['geometryUVHashes'])
        if any(before[obj.name] != previous_prepared.get(obj.name) for obj in receivers):
            raise ValueError('Prepared receiver geometry / BakeUV no longer matches the reused lightmaps')
    # Dead preview nodes can still cause large atlas uploads during Cycles sync.
    # Their page assignments have been recorded; only the PBR branches are baked.
    preview_images = {image for image in bpy.data.images if image.name.startswith(('DENOISED_HDR__', 'TRIAL85_FINAL_HDR__'))}
    for material in bpy.data.materials:
        if material.use_nodes:
            for node in list(material.node_tree.nodes):
                if node.type == 'TEX_IMAGE' and node.image in preview_images:
                    material.node_tree.nodes.remove(node)
    for image in preview_images:
        bpy.data.images.remove(image)
    # Preserve the same exported UV channel order as the completed bake workflow.
    for obj in receivers:
        obj.data.uv_layers.active = obj.data.uv_layers['BakeUV']
        for layer in obj.data.uv_layers:
            layer.active_render = layer.name == 'BakeUV'
    if reused is not None:
        report_path = work / 'reused-bake-report.json'
        report_path.write_text(json.dumps(reused['bake'], ensure_ascii=False, indent=2), encoding='utf-8')
        sys.argv = [sys.argv[0], '--', '--project', args.project, '--scope', args.scope,
                    '--lightmap-report', str(report_path), '--reuse-atlases', args.reuse_lightmaps]
        exporter.main()
        manifest_path = project / 'public/lighting/range-room-lightmap/manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        manifest['verification'].update({
            'sourceGeometryUVHashes': source_geometry,
            'geometryUVHashes': geometry_hash(exported),
            'modelOnlyUpdate': scope.get('modelOnlyUpdate', {}),
            'uvOwnership': ownership,
        })
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        print('ROOM_REUSE_EXPORT_COMPLETE ' + json.dumps({'rebake': False, 'receivers': len(receivers), 'modelSha256': manifest['model']['sha256']}), flush=True)
        return
    if not set(args.reuse_pages).issubset(pages):
        raise ValueError('Unknown page requested for reuse')
    for page in args.reuse_pages:
        previous = pages[page]
        name = previous.name
        image = bpy.data.images.load(str(work / f'{page}-raw.exr'), check_existing=False)
        if tuple(image.size) != tuple(previous.size):
            raise ValueError(f'{page}: reusable EXR dimensions do not match')
        for target in bake_targets.values():
            if target.image == previous:
                target.image = image
        bpy.data.images.remove(previous)
        image.name = name
        pages[page] = image
    for image in pages.values():
        image.buffers_free()
    for material in {m for o in exported for m in o.data.materials if m}:
        shader = repair.surface_shader(material)
        if shader and shader.type == 'BSDF_PRINCIPLED' and shader.inputs['Alpha'].is_linked:
            node = shader.inputs['Alpha'].links[0].from_node
            if node.type == 'TEX_IMAGE' and node.image:
                _ = len(node.image.pixels)
    alpha = repair.repair_scene_alpha(apply=True)
    if alpha['unresolved']:
        raise ValueError(alpha['unresolved'])
    if scene.render.engine != 'CYCLES':
        try:
            scene.render.engine = 'CYCLES'
        except TypeError as error:
            raise RuntimeError(f'Cycles unavailable: {error}') from error
    preferences = bpy.context.preferences.addons['cycles'].preferences
    device_types = [item[0] for item in preferences.get_device_types(bpy.context)]
    if args.device not in device_types:
        raise RuntimeError(f'{args.device} unavailable: {device_types}')
    preferences.compute_device_type = next(kind for kind in device_types if kind == args.device)
    preferences.get_devices()
    for device in preferences.devices:
        device.use = device.type == args.device
    if not any(d.use for d in preferences.devices):
        raise RuntimeError(f'No {args.device} baking device')
    scene.cycles.device = enum(scene.cycles, 'device', 'GPU')
    scene.cycles.samples = args.samples
    scene.cycles.use_adaptive_sampling = False
    scene.render.use_persistent_data = False
    bake = scene.render.bake
    bake.use_pass_direct = True
    bake.use_pass_indirect = True
    bake.use_pass_color = False
    bake.use_selected_to_active = False
    bake.use_clear = False
    bake.margin = 12
    bake.margin_type = enum(bake, 'margin_type', 'EXTEND')
    bake.target = enum(bake, 'target', 'IMAGE_TEXTURES')
    bake_types = [i.identifier for i in bpy.ops.object.bake.get_rna_type().properties['type'].enum_items]
    if 'DIFFUSE' not in bake_types:
        raise RuntimeError(f'Diffuse bake unavailable: {bake_types}')
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in receivers:
        obj.hide_set(False)
    started = time.time()
    print('LIGHTMAP_BAKE_START ' + json.dumps({'objects': [o.name for o in receivers], 'pages': list(pages), 'samples': args.samples}), flush=True)
    stats = {}
    settings = scene.render.image_settings
    settings.file_format = enum(settings, 'file_format', 'OPEN_EXR')
    settings.color_mode = enum(settings, 'color_mode', 'RGBA')
    settings.color_depth = enum(settings, 'color_depth', '16')
    settings.exr_codec = enum(settings, 'exr_codec', 'ZIP')
    # Bake one atlas at a time to bound Cycles' per-image differential buffers.
    # Other material slots on a selected object write only to a disposable 1px target.
    scratch = bpy.data.images.new('LIGHTMAP_OTHER_PAGE_SCRATCH', width=1, height=1, alpha=True, float_buffer=True)
    for page, image in sorted(pages.items()):
        for material, target in bake_targets.items():
            target.image = image if material_pages[material.name] == page else scratch
        selected = []
        for obj in receivers:
            belongs = any(material and material_pages[material.name] == page for material in obj.data.materials)
            obj.select_set(belongs)
            if belongs:
                selected.append(obj)
        bpy.context.view_layer.objects.active = selected[0]
        print('LIGHTMAP_PAGE_START ' + page, flush=True)
        if page not in args.reuse_pages:
            bpy.ops.object.bake(type='DIFFUSE')
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(-1, 4)
        covered = pixels[:, 3] > 0
        if not np.isfinite(pixels).all() or not covered.any() or pixels[:, :3].max() <= 0:
            raise ValueError(f'{page}: empty/nonfinite bake')
        stats[page] = {'width': image.size[0], 'height': image.size[1], 'coveredPixels': int(covered.sum()), 'rgbMax': float(pixels[:, :3].max()), 'rgbMean': float(pixels[covered, :3].mean())}
        image.file_format = enum(image, 'file_format', 'OPEN_EXR')
        image.filepath_raw = str(work / f'{page}-raw.exr')
        image.save_render(image.filepath_raw, scene=scene)
        image.pack()
        image.buffers_free()
        del pixels, covered
        print('LIGHTMAP_PAGE_COMPLETE ' + page, flush=True)
    for material, target in bake_targets.items():
        target.image = pages[material_pages[material.name]]
    bpy.data.images.remove(scratch)
    after = geometry_hash(exported)
    if before != after:
        raise RuntimeError('Geometry or UV changed during baking')
    report = {'collection': collection.name, 'objects': [o.name for o in receivers], 'type': 'DIFFUSE', 'direct': True, 'indirect': True, 'color': False, 'separateAO': False, 'samples': args.samples, 'margin': bake.margin, 'device': [d.name for d in preferences.devices if d.use], 'seconds': time.time() - started, 'encoding': 'unit-albedo-diffuse-radiance', 'lightMapIntensity': float(np.pi), 'materialPages': material_pages, 'pageOverrides': override_records, 'uvOwnership': ownership, 'pages': stats, 'geometryAndUVUnchanged': True, 'geometryUVHashes': after, 'denoised': False}
    report['excludedProbeVolumes'] = sorted(excluded_probe_boxes)
    report['uvTranslations'] = translations
    report['reusedPages'] = args.reuse_pages
    if translations:
        report['sourceGeometryUVHashes'] = source_geometry
    report_path = work / 'bake-report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    bpy.ops.wm.save_as_mainfile(filepath=str(work / 'lightmap-baked.blend'))
    print('LIGHTMAP_BAKE_COMPLETE ' + json.dumps(report, ensure_ascii=False), flush=True)
    sys.argv = [sys.argv[0], '--', '--project', args.project, '--scope', args.scope, '--lightmap-report', str(report_path)]
    exporter.main()


if __name__ == '__main__':
    main()
