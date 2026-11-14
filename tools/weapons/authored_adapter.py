"""Explicit in-memory aliases/arm-atlas adaptation for multi-weapon authoring files.

Only the background exporter uses this; source .blend files are never saved.
"""
import hashlib
import json

import bpy

from arm_contract import load_contract, validate_arms, verify_appearance


def claim_name(collection, item, name):
    occupied = collection.get(name)
    if occupied and occupied != item:
        occupied.name = "__unselected__" + name
    item.name = name
    assert item.name == name, name


def fingerprint(objects, actions):
    """Ignore aliases and arm UV only; guard geometry, weights, transforms and every curve."""
    meshes, rigs, curves = [], [], []
    for obj in objects:
        if obj.type == "MESH":
            mesh = obj.data
            meshes.append({
                "matrix": [list(row) for row in obj.matrix_basis],
                "vertices": [(list(v.co), [(obj.vertex_groups[g.group].name, g.weight) for g in v.groups])
                             for v in mesh.vertices],
                "faces": [list(poly.vertices) for poly in mesh.polygons],
                "uv": {} if obj.name.startswith("Arms_") else {
                    uv.name: [list(loop.uv) for loop in uv.data] for uv in mesh.uv_layers
                },
            })
        elif obj.type == "ARMATURE":
            rigs.append({
                "matrix": [list(row) for row in obj.matrix_basis],
                "bones": [(bone.name, bone.parent.name if bone.parent else None, [list(row) for row in bone.matrix_local])
                          for bone in obj.data.bones],
            })
    for action in actions:
        channels = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    slot = next(slot for slot in action.slots if slot.handle == bag.slot_handle)
                    for curve in bag.fcurves:
                        channels.append((slot.name_display, curve.data_path, curve.array_index,
                                         [(list(key.co), list(key.handle_left), list(key.handle_right), key.interpolation)
                                          for key in curve.keyframe_points]))
        curves.append(sorted(channels))
    return hashlib.sha256(json.dumps([meshes, rigs, curves], sort_keys=True).encode()).hexdigest()


def prepare_authored_source(spec, scene):
    aliases = spec["meshAliases"]
    meshes = [scene.objects[name] for name in aliases]
    rigs = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    actions = [bpy.data.actions[name] for name in spec["actionAliases"]]
    before = fingerprint(meshes + rigs, actions)
    for source_name, target in aliases.items():
        obj = scene.objects[source_name]
        assert obj.type == "MESH"
        obj.data = obj.data.copy()
        claim_name(bpy.data.objects, obj, target)
        claim_name(bpy.data.meshes, obj.data, target)
    for action, target in zip(actions, spec["actionAliases"].values()):
        claim_name(bpy.data.actions, action, target)
    material = bpy.data.materials[spec["weaponMaterial"]].copy()
    claim_name(bpy.data.materials, material, "Weapon_Skin")
    for obj in meshes:
        if obj.name.startswith("Arms_"):
            continue
        assert len(obj.data.materials) == 1 and obj.data.materials[0].name == spec["weaponMaterial"]
        obj.data.materials[0] = material
    contract, atlas = load_contract()
    image = bpy.data.images.load(str(atlas), check_existing=False)
    image.pack()
    samples = {}
    for side in ("Left", "Right"):
        obj = scene.objects["Arms_" + side]
        assert len(obj.data.materials) == 1
        old_material = obj.data.materials[0]
        isolated = old_material.copy()
        claim_name(bpy.data.materials, isolated, "Character_" + side)
        obj.data.materials[0] = isolated
    # Appearance is tested with the OLD UV/image before changing either, including alpha.
    for side in ("Left", "Right"):
        samples[side] = verify_appearance(side, contract, image)
    for side in ("Left", "Right"):
        obj = scene.objects["Arms_" + side]
        uv = obj.data.uv_layers["SourceUV"]
        for loop in obj.data.loops:
            uv.data[loop.index].uv = contract["sides"][side][loop.vertex_index]
        nodes = [node for node in obj.data.materials[0].node_tree.nodes if node.type == "TEX_IMAGE" and node.image]
        assert len(nodes) == 1
        nodes[0].image = image
    validate_arms(contract)
    assert fingerprint(meshes + rigs, actions) == before, "Adapter changed geometry, rig, weights or actions"
    return {
        "meshAliases": aliases, "actionAliases": spec["actionAliases"],
        "weaponMaterial": spec["weaponMaterial"], "armAppearanceSamples": samples,
        "preservedMeshRigActions": True,
    }
