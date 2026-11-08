import bpy, os, hashlib, numpy as np
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\vandal_skin_work\three_vandals\edge_fixed')
items=[('Sakura','Vandal_Sakura','vandal_sakura_edge_fixed.png'),('Wood_Metal','Vandal_Wood_Metal','vandal_wood_metal_edge_fixed.png'),('Smite','Vandal_Smite_2025','vandal_smite_edge_fixed.png'),('Royal_Gold','Vandal_Royal_Gold_Alpha','vandal_royal_gold_edge_fixed.png'),('EGO','Vandal_EGO_Black_White_Gold','vandal_ego_edge_fixed.png'),('Original','Weapon_Skin.003','vandal_original_texture.png')]
for title,matname,filename in items:
 bpy.ops.wm.open_mainfile(filepath=str(p/('Vandal_'+title+'_Edge_Fixed.blend')))
 body=bpy.data.objects['Weapon_Body | 00_Showcase.003'];mag=bpy.data.objects['Weapon_Magazine | 00_Showcase.003'];spare=bpy.data.objects['Weapon_SpareMagazine | 00_Showcase'];rig=bpy.data.objects['FP_root | 00_Showcase']
 assert all(o.data.materials[0].name==matname for o in [body,mag,spare]), title+' material mismatch'
 assert all(o.data.uv_layers.get('SourceUV') is not None for o in [body,mag,spare]), title+' UV missing'
 assert rig.animation_data and len(rig.animation_data.nla_tracks)>0, title+' NLA missing'
 img=next(n for n in body.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE').image
 assert img.packed_file, title+' not packed'
 external=bpy.data.images.load(str(p/filename),check_existing=False)
 assert tuple(img.size)==tuple(external.size) and np.array_equal(np.array(img.pixels[:]),np.array(external.pixels[:])), title+' image pixels differ from PNG'
 bpy.data.images.remove(external)
 print('OK',title,'UV SourceUV; packed PNG matches; NLA tracks:',len(rig.animation_data.nla_tracks),flush=True)
bpy.ops.wm.open_mainfile(filepath=str(p/'Six_Vandals_Edge_Fixed_Gallery.blend'))
s=bpy.data.scenes['Sakura Wood Smite Royal EGO Original']
for col in ['06 Sakura','05 Wood Metal','04 Smite','01 Royal Gold','02 EGO','03 Original']:
 assert bpy.data.collections[col] in s.collection.children[:],col+' missing'
print('OK gallery: six skin collections present',flush=True)
