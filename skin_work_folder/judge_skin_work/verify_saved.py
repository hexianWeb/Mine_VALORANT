import bpy,hashlib
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\judge_skin_work')
for name in ('Smite','Rush'):
 bpy.ops.wm.open_mainfile(filepath=str(p/('Judge_'+name+'_Animated.blend')))
 mat=bpy.data.materials['Weapon_Skin'];img=next(n.image for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
 assert img.packed_file and hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((p/('judge_'+name.lower()+'_texture.png')).read_bytes()).digest()
 assert len(bpy.data.objects['root'].animation_data.nla_tracks)==33
 print('REOPENED',name,'packed texture and animation OK')
