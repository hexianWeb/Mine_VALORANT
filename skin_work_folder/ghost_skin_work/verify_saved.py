import bpy,hashlib
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\ghost_skin_work')
for name in ['Freehand','Recon','Ego','Spitfire']:
 bpy.ops.wm.open_mainfile(filepath=str(p/('Ghost_'+name+'_Animated.blend')))
 img=next(n.image for n in bpy.data.materials['Weapon_Skin'].node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
 assert img.packed_file and hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((p/('ghost_'+name.lower()+'_weapon.png')).read_bytes()).digest()
 assert len(bpy.data.objects['root'].animation_data.nla_tracks)==30
 print('REOPENED',name,'packed texture and animation OK')
