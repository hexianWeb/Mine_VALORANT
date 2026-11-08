import bpy,hashlib
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\odin_skin_work')
body=bpy.data.objects['Weapon_Body | 00_Showcase.008'];mag=bpy.data.objects['Weapon_Magazine | 00_Showcase.007'];arm=bpy.data.objects['root | 00_Showcase.006']
for o in [body,mag]:
 assert o.data.uv_layers.get('SourceUV') and o.data.materials[0].name=='Odin_Smite_Skin'
 assert any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)
im=next(n for n in body.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE').image
assert im.packed_file and hashlib.sha256(bytes(im.packed_file.data)).digest()==hashlib.sha256((p/'odin_smite_texture.png').read_bytes()).digest()
assert arm.animation_data and len(arm.animation_data.nla_tracks)>0
assert all(mag.vertex_groups.get('bullet_'+str(i)) and mag.vertex_groups.get('chain_'+str(i)) for i in range(1,9))
print('OK: image packed and identical; SourceUV and rig modifiers preserved; 8 ammo groups, NLA tracks',len(arm.animation_data.nla_tracks))
