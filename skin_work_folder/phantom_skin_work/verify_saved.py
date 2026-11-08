import bpy,hashlib
from pathlib import Path
from zipfile import ZipFile
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\phantom_skin_work')
for name in ['Smite','Prism','Tactiplay','Rush']:
 bpy.ops.wm.open_mainfile(filepath=str(p/('Phantom_'+name+'_Animated.blend')))
 img=next(n.image for n in bpy.data.materials['Weapon_Skin'].node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
 assert img.packed_file and hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((p/('phantom_'+name.lower()+'_weapon.png')).read_bytes()).digest()
 assert len(bpy.data.objects['root'].animation_data.nla_tracks)==30
 print('REOPENED',name,'packed texture and animation OK')
for filename in ['Phantom_Four_Textures.zip','Phantom_Four_Animated.zip']:
 with ZipFile(p/filename) as z:
  assert z.testzip() is None
  for n in z.namelist():assert hashlib.sha256(z.read(n)).digest()==hashlib.sha256((p/n).read_bytes()).digest()
  print(filename,'verified',len(z.namelist()),'files')
