"""Bake selected receivers into one new page while reusing existing atlas bytes.

Run only in a background copy of the previous exported scene. The named objects
are appended from a separate authoring snapshot; no live Blender data is edited.
"""
import argparse
import copy
import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
import bake_range_room_lightmaps as bake_tool
import export_range_room as exporter
import lightmap_uv
import repair_blender_alpha as repair
import supplemental_lightmap_uv as supplemental_uv


def main():
    if not bpy.app.background:
        raise RuntimeError('Supplemental baking must use a background snapshot')
    bpy.context.preferences.edit.use_global_undo = False
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, help='Snapshot containing the supplemental objects')
    parser.add_argument('--source-materials', required=True, help='Original material names by object')
    parser.add_argument('--previous', required=True, help='Previous lightmap manifest')
    parser.add_argument('--scope', required=True)
    parser.add_argument('--project', required=True, help='New staging project, not the live project')
    parser.add_argument('--work', required=True)
    parser.add_argument('--objects', nargs='+', required=True)
    parser.add_argument('--page', default='B06')
    parser.add_argument('--size', type=int, default=1024)
    parser.add_argument('--samples', type=int, default=512)
    parser.add_argument('--device', default='CUDA')
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    work, project = Path(args.work), Path(args.project)
    work.mkdir(parents=True, exist_ok=True)
    if not args.validate_only and ((project / 'public/lighting/range-room-lightmap/manifest.json').exists()
                                   or (project / 'public/model/range-room-lightmap.glb').exists()):
        raise FileExistsError('Stage already contains room assets')
    previous_path = Path(args.previous).resolve()
    previous = json.loads(previous_path.read_text(encoding='utf-8'))
    scope = json.loads(Path(args.scope).read_text(encoding='utf-8'))
    source_materials = json.loads(Path(args.source_materials).read_text(encoding='utf-8'))
    if previous.get('schemaVersion') != 4 or args.page in {page['id'] for page in previous['atlases']}:
        raise ValueError('Expected a previous lightmap and an unused supplemental page')
    if len(set(args.objects)) != len(args.objects) or set(args.objects) != set(source_materials):
        raise ValueError('Supplemental objects and source materials must match')
    scene = bpy.context.scene
    collection = bpy.data.collections.get(scope['collection'])
    if not collection or any(name in scene.objects for name in args.objects):
        raise ValueError('Missing receiver collection or supplemental object already exists in the baseline')
    baseline = previous['verification'].get('sourceGeometryUVHashes', previous['bake'].get('sourceGeometryUVHashes', previous['bake']['geometryUVHashes']))
    existing = [scene.objects[name] for name in previous['verification']['exportedObjects']]
    actual = bake_tool.geometry_hash(existing)
    changed = [obj.name for obj in existing if actual[obj.name] != baseline.get(obj.name)]
    if changed:
        raise ValueError(f'Baseline scene differs from the published model: {changed}')
    with bpy.data.libraries.load(str(Path(args.source).resolve()), link=False) as (available, requested):
        if not set(args.objects).issubset(available.objects):
            raise ValueError('Source snapshot is missing a supplemental object')
        requested.objects = list(args.objects)
    targets = requested.objects
    for obj, name in zip(targets, args.objects):
        if not obj or obj.name != name or obj.type != 'MESH' or not obj.data.polygons:
            raise ValueError(f'Cannot append supplemental mesh: {name}')
        collection.objects.link(obj)
    bpy.context.view_layer.update()
    if not args.validate_only:
        merged = work / 'merged-source.blend'
        if merged.exists():
            raise FileExistsError(merged)
        bpy.ops.wm.save_as_mainfile(filepath=str(merged), copy=True)
    exported = [scene.objects[name] for name in scope['objects']]
    source_geometry = bake_tool.geometry_hash(exported)
    previous_plans = previous['bake'].get('supplemental', [])
    previous_targets = set()
    for old_plan in previous_plans:
        names = {entry['name'] for entry in old_plan['objects']}
        if names & (previous_targets | set(args.objects)):
            raise ValueError('Supplemental receivers cannot belong to multiple pages')
        supplemental_uv.apply_plan(scene, old_plan)
        previous_targets.update(names)
    receivers = sorted((obj for obj in collection.all_objects if obj.type == 'MESH' and obj.data.polygons), key=lambda obj: obj.name)
    if not set(args.objects).issubset({obj.name for obj in receivers}):
        raise ValueError('Supplemental targets must belong to the receiver collection')
    original_albedo_uvs = {obj.name: np.asarray([loop.uv[:] for loop in obj.data.uv_layers[0].data]) for obj in targets}
    plan = supplemental_uv.make_plan(targets, source_materials, args.page, args.size)
    supplemental_uv.apply_plan(scene, plan, prepared=True)
    for obj in targets:
        if not np.array_equal(original_albedo_uvs[obj.name], np.asarray([loop.uv[:] for loop in obj.data.uv_layers[0].data])):
            raise ValueError(f'{obj.name}: albedo UV changed during supplemental packing')
    padding = supplemental_uv.validate_padding(targets, args.size, plan['margin'])
    density = supplemental_uv.density(targets, args.size)
    # Preserve the historical B05 correction for the existing receiver only.
    overrides = []
    for obj in receivers:
        if obj.name != 'Double_Stone_Slab' or obj.name in previous_targets:
            continue
        source = obj.data.materials[0]
        material = source.copy()
        material.name = f'{source.name}__LIGHTMAP_B05'
        material['lightmapSourceMaterial'] = source.name
        material['lightmapPage'] = 'B05'
        obj.data.materials[0] = material
        overrides.append({'object': obj.name, 'slot': 0, 'sourceMaterial': source.name, 'atlasId': 'B05',
                          'reason': 'BakeUV remains on the original smooth_stone page'})
    material_pages = {}
    materials = {material for obj in receivers for material in obj.data.materials if material}
    supplemental_pages = {plan['atlasId'] for plan in previous_plans} | {args.page}
    for material in materials:
        old_images = {node.image for node in material.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image and node.image.name.startswith('DENOISED_HDR__B')}
        page = material.get('lightmapPage')
        if page not in supplemental_pages:
            if len(old_images) != 1:
                raise ValueError(f'{material.name}: expected one historical atlas')
            old = next(iter(old_images))
            page = page or old.name.split('__', 1)[1].split('_', 1)[0]
        material_pages[material.name] = page
    for entry in scope.get('bakeUVTranslations', []):
        obj = scene.objects[entry['object']]
        face = obj.data.polygons[entry['face']]
        uv = obj.data.uv_layers['BakeUV']
        current = np.asarray([uv.data[index].uv[:] for index in face.loop_indices])
        if (material_pages[obj.data.materials[face.material_index].name] != entry['atlasId']
                or not np.allclose(current, entry['expectedUV'], rtol=0, atol=1e-7)):
            raise ValueError(f'{obj.name}/face:{face.index}: existing BakeUV repair does not match')
        for index, value in zip(face.loop_indices, current + np.asarray(entry['delta'])):
            uv.data[index].uv = value
    sizes = {page['id']: (page['width'], page['height']) for page in previous['atlases']}
    sizes[args.page] = (args.size, args.size)
    ownership = lightmap_uv.validate_uv_ownership(receivers, material_pages, sizes)
    prepared_geometry = bake_tool.geometry_hash(exported)
    summary = {'targets': args.objects, 'page': args.page, 'size': args.size, 'density': density,
               'padding': padding, 'ownership': ownership, 'previousPages': sorted(set(sizes) - {args.page})}
    print('SUPPLEMENT_PREPARED ' + json.dumps(summary, ensure_ascii=False), flush=True)
    (work / 'prepare-report.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    if args.validate_only:
        return
    # Restore the non-camera Principled branch, excluding historical preview atlases.
    for material in materials:
        output, source = exporter.surface_source(material)
        if source.node.type != 'BSDF_PRINCIPLED':
            raise ValueError(f'{material.name}: original Principled material unavailable')
        material.node_tree.links.new(source, output.inputs['Surface'])
    previews = {image for image in bpy.data.images if image.name.startswith(('DENOISED_HDR__', 'TRIAL85_FINAL_HDR__'))}
    for material in bpy.data.materials:
        if material.use_nodes:
            for node in list(material.node_tree.nodes):
                if node.type == 'TEX_IMAGE' and node.image in previews:
                    material.node_tree.nodes.remove(node)
    for image in previews:
        bpy.data.images.remove(image)
    for material in {material for obj in exported for material in obj.data.materials if material}:
        shader = repair.surface_shader(material)
        if shader and shader.type == 'BSDF_PRINCIPLED' and shader.inputs['Alpha'].is_linked:
            node = shader.inputs['Alpha'].links[0].from_node
            if node.type == 'TEX_IMAGE' and node.image:
                _ = len(node.image.pixels)
    alpha = repair.repair_scene_alpha(apply=True)
    if alpha['unresolved']:
        raise ValueError(alpha['unresolved'])
    excluded = []
    probe_collection = bpy.data.collections.get('LightProbeVolumes')
    expected = set(previous['bake'].get('excludedProbeVolumes', []))
    if expected and not probe_collection:
        raise ValueError('Previously excluded probe volume collection is missing')
    if probe_collection:
        probe_objects = [obj for obj in list(probe_collection.all_objects) if obj and obj.type == 'MESH']
        if expected and {obj.name for obj in probe_objects} != expected:
            raise ValueError('Probe volume exclusion differs from the previous bake')
        for obj in probe_objects:
            if obj in exported:
                raise ValueError('Probe volume cannot be a room receiver')
            obj.hide_render = True
            excluded.append(obj.name)
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
    if not any(device.use for device in preferences.devices):
        raise RuntimeError(f'No {args.device} baking device')
    scene.cycles.device = exporter.choose_enum(scene.cycles, 'device', 'GPU')
    scene.cycles.samples = args.samples
    scene.cycles.use_adaptive_sampling = False
    scene.render.use_persistent_data = False
    bake = scene.render.bake
    bake.use_pass_direct, bake.use_pass_indirect, bake.use_pass_color = True, True, False
    bake.use_selected_to_active, bake.use_clear = False, False
    bake.margin = plan['margin']
    bake.margin_type = exporter.choose_enum(bake, 'margin_type', 'EXTEND')
    bake.target = exporter.choose_enum(bake, 'target', 'IMAGE_TEXTURES')
    settings = scene.render.image_settings
    settings.file_format = exporter.choose_enum(settings, 'file_format', 'OPEN_EXR')
    settings.color_mode = exporter.choose_enum(settings, 'color_mode', 'RGBA')
    settings.color_depth = exporter.choose_enum(settings, 'color_depth', '16')
    settings.exr_codec = exporter.choose_enum(settings, 'exr_codec', 'ZIP')
    image = bpy.data.images.new('LIGHTMAP_HDR__' + args.page, width=args.size, height=args.size, alpha=True, float_buffer=True)
    image.generated_color = (0, 0, 0, 0)
    image.alpha_mode = exporter.choose_enum(image, 'alpha_mode', 'STRAIGHT')
    for material in materials:
        if material_pages[material.name] == args.page:
            for node in material.node_tree.nodes:
                node.select = False
            target = material.node_tree.nodes.new('ShaderNodeTexImage')
            target.image = image
            target.label = 'Supplemental light-only bake / BakeUV'
            target.select = True
            material.node_tree.nodes.active = target
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in targets:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    print('SUPPLEMENT_BAKE_START ' + json.dumps({'targets': args.objects, 'samples': args.samples, 'page': args.page}), flush=True)
    started = time.time()
    bpy.ops.object.bake(type='DIFFUSE')
    seconds = time.time() - started
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(args.size, args.size, 4)
    covered = pixels[:, :, 3] > 0
    if not np.isfinite(pixels).all() or not covered.any() or pixels[:, :, :3].max() <= 0:
        raise ValueError('Supplemental page is empty or nonfinite')
    sampled = {}
    for obj in targets:
        mesh = obj.data
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers['BakeUV']
        samples = []
        for tri in mesh.loop_triangles:
            center = np.mean([uv.data[index].uv[:] for index in tri.loops], axis=0)
            x, y = np.clip((center * args.size).astype(int), 0, args.size - 1)
            samples.append(pixels[y, x])
        values = np.asarray(samples)
        if not (values[:, 3] > 0).any() or values[:, :3].max() <= 0:
            raise ValueError(f'{obj.name}: supplemental bake contains no lit samples')
        sampled[obj.name] = {'triangles': len(samples), 'covered': int(np.count_nonzero(values[:, 3] > 0)),
                             'rgbMax': float(values[:, :3].max()), 'rgbMean': float(values[:, :3].mean())}
    stats = {'width': args.size, 'height': args.size, 'coveredPixels': int(covered.sum()),
             'rgbMax': float(pixels[:, :, :3].max()), 'rgbMean': float(pixels[:, :, :3][covered].mean())}
    image.file_format = exporter.choose_enum(image, 'file_format', 'OPEN_EXR')
    image.filepath_raw = str(work / f'{args.page}-raw.exr')
    image.save_render(image.filepath_raw, scene=scene)
    image.pack()
    del pixels, covered
    # Reattach existing pages only after baking, so Cycles does not allocate them.
    pages = {args.page: image}
    for page in previous['atlases']:
        source = (previous_path.parent / page['url']).resolve()
        if exporter.digest(source) != page['sha256']:
            raise ValueError(f'{page["id"]}: previous atlas hash changed')
        loaded = bpy.data.images.load(str(source), check_existing=False)
        loaded.name = 'LIGHTMAP_HDR__' + page['id']
        loaded.pack()
        loaded.buffers_free()
        pages[page['id']] = loaded
    for material in materials:
        page = material_pages[material.name]
        if page == args.page:
            continue
        node = material.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = pages[page]
        material.node_tree.nodes.active = node
    if prepared_geometry != bake_tool.geometry_hash(exported):
        raise ValueError('Geometry or UV changed during supplemental baking')
    report = copy.deepcopy(previous['bake'])
    report.update(objects=[obj.name for obj in receivers], materialPages=material_pages,
                  pageOverrides=overrides, uvOwnership=ownership, geometryAndUVUnchanged=True,
                  sourceGeometryUVHashes=source_geometry, geometryUVHashes=prepared_geometry,
                  uvTranslations=scope.get('bakeUVTranslations', []), excludedProbeVolumes=sorted(excluded),
                  supplemental=[*previous_plans, plan], reusedPages=sorted(set(pages) - {args.page}), rebakedPages=[args.page])
    report['pages'][args.page] = stats
    report['supplementalBake'] = {'page': args.page, 'objects': args.objects, 'samples': args.samples,
                                  'seconds': seconds, 'device': [d.name for d in preferences.devices if d.use],
                                  'padding': padding, 'density': density, 'objectSamples': sampled}
    report_path = work / 'bake-report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    bpy.ops.wm.save_as_mainfile(filepath=str(work / 'lightmap-baked.blend'))
    sys.argv = [sys.argv[0], '--', '--project', args.project, '--scope', args.scope,
                '--lightmap-report', str(report_path), '--reuse-atlases', str(previous_path), '--allow-new-atlases']
    exporter.main()
    manifest_path = project / 'public/lighting/range-room-lightmap/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    gltf = exporter.read_glb(project / 'public/model/range-room-lightmap.glb')
    for binding in manifest['bindings']:
        if binding['sourceObject'] not in args.objects:
            continue
        material = gltf['materials'][binding['materialIndex']]
        albedo = material.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if not albedo or albedo.get('texCoord', 0) != 0:
            raise ValueError(f'{binding["sourceObject"]}: exported albedo must use the original UV0')
    manifest['verification'].update(sourceGeometryUVHashes=source_geometry, geometryUVHashes=prepared_geometry,
                                    uvOwnership=ownership, reunwrap=True,
                                    supplementalUpdate={'addedObjects': args.objects, 'page': args.page,
                                                        'previousModelSha256': previous['model']['sha256']})
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('SUPPLEMENT_BAKE_COMPLETE ' + json.dumps({'seconds': seconds, 'stats': stats, 'objectSamples': sampled}), flush=True)


if __name__ == '__main__':
    main()
