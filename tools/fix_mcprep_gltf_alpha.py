# SPDX-License-Identifier: MIT
"""Fix MCprep materials so glTF export does not write alphaMode BLEND.

Prep Materials connects texture alpha straight into Principled BSDF. Blender's
glTF exporter turns that into BLEND, and viewers then skip depth writes, so
faces disappear from some camera angles.

Run this after Prep Materials and before exporting glTF:

- Fully opaque textures (alpha is 1) get the Alpha link removed, so they
  export as OPAQUE.
- Hard-edged cutouts (alpha is only 0 or 1) get a Greater Than 0.5 node, so
  they export as MASK and still write depth.
- Soft translucency (partial alpha, such as some water) is left as BLEND.

Safe to run more than once. Install as an add-on, then use
3D Viewport > Sidebar (N) > MCprep > glTF 导出 > 修复 glTF 透明.
"""

import bpy

ALPHA_CLIP_LABEL = "Alpha Clip"
OPAQUE_MIN = 0.99
CLEAR_MAX = 0.02
MID_LOW = 0.05
MID_HIGH = 0.95

bl_info = {
    "name": "MCprep glTF Alpha Fix",
    "author": "local",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > MCprep > glTF 导出",
    "description": "After Prep Materials, make glTF export use OPAQUE or MASK instead of BLEND",
    "category": "Material",
}


def _alpha_fractions(image):
    width, height = image.size
    channels = image.channels
    if width == 0 or height == 0 or channels < 4:
        return None
    import numpy as np

    pixels = np.empty(width * height * channels, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    alpha = pixels[3::channels]
    opaque = float((alpha >= OPAQUE_MIN).mean())
    clear = float((alpha <= CLEAR_MAX).mean())
    mid = float(((alpha > MID_LOW) & (alpha < MID_HIGH)).mean())
    return opaque, clear, mid


def _image_kind(image, cache):
    if image is None:
        return "unknown"
    key = image.name_full
    cached = cache.get(key)
    if cached is not None:
        return cached
    if image.size[0] == 0:
        try:
            image.reload()
        except RuntimeError:
            pass
    fractions = _alpha_fractions(image)
    if fractions is None:
        kind = "unknown"
    else:
        opaque, clear, mid = fractions
        if opaque > 0.98:
            kind = "opaque"
        elif opaque + clear > 0.95 and mid < 0.05:
            kind = "cutout"
        else:
            kind = "partial"
    cache[key] = kind
    return kind


def _principled_alpha(material):
    if not material.use_nodes or material.node_tree is None:
        return None
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            socket = node.inputs.get("Alpha")
            if socket is not None:
                return node, socket
    return None


def _is_mcprep_material(material):
    if material.node_tree is None:
        return False
    for node in material.node_tree.nodes:
        props = getattr(node, "mnp", None)
        if props is not None and getattr(props, "MCPREP_diffuse", False):
            return True
    return False


def _export_alpha_mode(socket):
    from io_scene_gltf2.blender.exp.material.search_node_tree import (
        NodeSocket,
        gather_alpha_info,
    )

    info = gather_alpha_info(NodeSocket(socket, []).to_node_nav())
    return info.get("alphaMode")


def _trace_image(socket, depth=0):
    if depth > 12 or not socket.is_linked:
        return None
    node = socket.links[0].from_node
    if node.type == "TEX_IMAGE":
        return node.image
    if node.type == "REROUTE" and node.inputs:
        return _trace_image(node.inputs[0], depth + 1)
    if node.type == "MATH" and node.inputs:
        return _trace_image(node.inputs[0], depth + 1)
    return None


def _disconnect_alpha(socket):
    links = socket.id_data.links
    for link in list(socket.links):
        links.remove(link)
    socket.default_value = 1.0


def _insert_alpha_clip(material, principled, socket):
    link = socket.links[0]
    source = link.from_socket
    source_node = link.from_node
    links = material.node_tree.links
    links.remove(link)

    clip = material.node_tree.nodes.new("ShaderNodeMath")
    clip.name = ALPHA_CLIP_LABEL
    clip.label = ALPHA_CLIP_LABEL
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = 0.5
    clip.location = (
        (source_node.location.x + principled.location.x) * 0.5,
        principled.location.y - 180,
    )
    links.new(source, clip.inputs[0])
    links.new(clip.outputs[0], socket)
    material.use_backface_culling = False
    if hasattr(material, "show_transparent_back"):
        material.show_transparent_back = True


def fix_material(material, image_cache):
    """Return opaque, mask, partial, skip, or error."""
    if not _is_mcprep_material(material):
        return "skip"
    found = _principled_alpha(material)
    if found is None:
        return "skip"
    principled, socket = found
    if _export_alpha_mode(socket) != "BLEND":
        return "skip"
    if not socket.is_linked:
        return "skip"
    kind = _image_kind(_trace_image(socket), image_cache)
    if kind == "partial":
        return "partial"
    if kind == "opaque":
        _disconnect_alpha(socket)
        material.use_backface_culling = False
        return "opaque"
    _insert_alpha_clip(material, principled, socket)
    return "mask"


def fix_file_materials():
    counts = {"opaque": 0, "mask": 0, "partial": 0, "skip": 0, "error": 0}
    partial_names = []
    image_cache = {}
    for material in bpy.data.materials:
        try:
            result = fix_material(material, image_cache)
        except Exception:
            result = "error"
        counts[result] = counts.get(result, 0) + 1
        if result == "partial" and len(partial_names) < 8:
            partial_names.append(material.name)
    return counts, partial_names


class MATERIAL_OT_fix_mcprep_gltf_alpha(bpy.types.Operator):
    bl_idname = "material.fix_mcprep_gltf_alpha"
    bl_label = "修复 glTF 透明"
    bl_description = (
        "Prep Materials 之后点一次。实心块导出为不透明，硬边透明导出为镂空，"
        "避免 glTF 用 BLEND 导致某些角度丢面"
    )
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        counts, partial_names = fix_file_materials()
        message = (
            f"不透明 {counts['opaque']}，镂空 {counts['mask']}，"
            f"已正确跳过 {counts['skip']}，半透明保留 {counts['partial']}"
        )
        if counts["error"]:
            message += f"，失败 {counts['error']}"
        print("Fix MCprep glTF alpha:", message)
        if partial_names:
            print("Left as BLEND:", ", ".join(partial_names))
        level = {"WARNING"} if counts["error"] else {"INFO"}
        self.report(level, message)
        return {"FINISHED"}


class VIEW3D_PT_fix_mcprep_gltf_alpha(bpy.types.Panel):
    bl_label = "glTF 导出"
    bl_idname = "VIEW3D_PT_fix_mcprep_gltf_alpha"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "MCprep"
    bl_order = 20

    def draw(self, context):
        layout = self.layout
        layout.label(text="Prep Materials 之后、导出之前")
        layout.operator("material.fix_mcprep_gltf_alpha", icon="CHECKMARK")


classes = (
    MATERIAL_OT_fix_mcprep_gltf_alpha,
    VIEW3D_PT_fix_mcprep_gltf_alpha,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    try:
        unregister()
    except RuntimeError:
        pass
    register()
    bpy.ops.material.fix_mcprep_gltf_alpha()
