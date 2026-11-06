"""Fix glTF alpha semantics in Blender nodes without changing meshes or baked maps.

Import in Blender and call repair_scene_alpha(apply=True) after saving a backup.
Running the script normally only inspects the current scene; --apply opts into edits.
The caller decides where to save the repaired .blend file.
"""
import json
import sys

import bpy
import numpy as np


def surface_shader(material):
    if not material.use_nodes:
        return None
    output = next((n for n in material.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    if not output or not output.inputs['Surface'].is_linked:
        return None
    shader = output.inputs['Surface'].links[0].from_node
    # Match the existing room export's original-surface branch. Do not change the
    # Light Path / baked-emission branch used for the Blender camera preview.
    if shader.type == 'MIX_SHADER' and shader.inputs[0].is_linked:
        if shader.inputs[0].links[0].from_node.type == 'LIGHT_PATH' and shader.inputs[1].is_linked:
            shader = shader.inputs[1].links[0].from_node
    return shader


def inspect_alpha(material, image_cache):
    shader = surface_shader(material)
    if not shader:
        return 'UNKNOWN', None, None
    if shader.type == 'EMISSION':
        return 'OPAQUE', None, None
    if shader.type != 'BSDF_PRINCIPLED':
        return 'UNKNOWN', None, None
    alpha = shader.inputs['Alpha']
    if not alpha.is_linked:
        return ('OPAQUE' if alpha.default_value == 1 else 'BLEND'), alpha, None
    link = alpha.links[0]
    source = link.from_node
    if source.type == 'MATH' and source.operation == 'ROUND':
        return 'MASK', alpha, None  # Already repaired: repeat runs are idempotent.
    if source.type != 'TEX_IMAGE' or not source.image or link.from_socket.name != 'Alpha':
        return 'UNKNOWN', alpha, None
    image = source.image
    if image.name not in image_cache:
        if not image.has_data:
            raise ValueError(f'{material.name}: missing alpha texture data: {image.name}')
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        values = pixels.reshape(-1, 4)[:, 3]
        if not values.size or not np.isfinite(values).all():
            raise ValueError(f'{material.name}: invalid alpha texture: {image.name}')
        if np.all(values >= 1 - 1e-5):
            mode = 'OPAQUE'
        elif np.all((values <= 1e-5) | (values >= 1 - 1e-5)):
            mode = 'MASK'
        else:
            mode = 'BLEND'
        image_cache[image.name] = mode
    return image_cache[image.name], alpha, image.name


def repair_scene_alpha(apply=False):
    # Only materials actually assigned to faces in this scene; leave unused data,
    # empty source objects and other scenes alone.
    materials = set()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        for index in {p.material_index for p in obj.data.polygons}:
            if index < len(obj.material_slots) and obj.material_slots[index].material:
                materials.add(obj.material_slots[index].material)
    image_cache = {}
    plans = [(m, *inspect_alpha(m, image_cache)) for m in sorted(materials, key=lambda m: m.name)]
    report = {'applied': apply, 'modes': {}, 'changed': [], 'unresolved': []}
    # Resolve enum support before editing anything in the user's live scene.
    operations = [item.identifier for item in bpy.types.ShaderNodeMath.bl_rna.properties['operation'].enum_items]
    round_operation = next((operation for operation in operations if operation == 'ROUND'), None)
    if apply and round_operation is None:
        raise RuntimeError(f'Math Round is unavailable; supported operations: {operations}')
    if apply and bpy.ops.ed.undo_push.poll():
        bpy.ops.ed.undo_push(message='Before glTF alpha repair')
    for material, mode, alpha, image_name in plans:
        report['modes'][mode] = report['modes'].get(mode, 0) + 1
        if mode == 'UNKNOWN':
            report['unresolved'].append(material.name)
        # Only replace direct image-alpha links that were positively classified.
        if not image_name or mode == 'BLEND':
            continue
        report['changed'].append({'material': material.name, 'mode': mode, 'image': image_name})
        if not apply:
            continue
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        original = alpha.links[0].from_socket
        if mode == 'OPAQUE':
            links.remove(alpha.links[0])
            alpha.default_value = 1.0
        elif mode == 'MASK':
            clip = nodes.new('ShaderNodeMath')
            clip.operation = round_operation
            clip.label = 'glTF Alpha Clip (0.5)'
            clip.location = (alpha.node.location.x - 180, alpha.node.location.y - 480)
            links.new(original, clip.inputs[0])
            links.new(clip.outputs[0], alpha)
        material.update_tag()
    if apply:
        bpy.context.view_layer.update()
        if bpy.ops.ed.undo_push.poll():
            bpy.ops.ed.undo_push(message='glTF alpha repair complete')
    return report


if __name__ == '__main__':
    print(json.dumps(repair_scene_alpha(apply='--apply' in sys.argv), ensure_ascii=False, indent=2))
