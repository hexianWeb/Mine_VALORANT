import bpy,hashlib
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\outlaw_skin_work')
for name in ('Smite','RGX'):
 bpy.ops.wm.open_mainfile(filepath=str(p/('Outlaw_'+name+'_Animated.blend')))
 for part,material in [('weapon','Weapon_Skin'),('scope','Weapon_Scope')]:
  img=next(n.image for n in bpy.data.materials[material].node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
  assert img.packed_file and hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((p/('outlaw_'+name.lower()+'_'+part+'.png')).read_bytes()).digest()
 assert len(bpy.data.objects['root'].animation_data.nla_tracks)==31
 print('REOPENED',name,'two packed textures and animation OK')
