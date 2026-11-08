import bpy,hashlib,math,numpy as np
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\odin_skin_work\three_odin_skins')
items=[('Smite','Odin_Smite_Skin','odin_smite_texture.png'),('Prime','Odin_Prime_Skin','odin_prime_texture.png'),('BlastX','Odin_BlastX_Skin','odin_blastx_texture.png')]
baseline=None
for title,matname,filename in items:
 bpy.ops.wm.open_mainfile(filepath=str(p/('Odin_'+title+'.blend')))
 scene=bpy.data.scenes['09_ODIN'];bpy.context.window.scene=scene
 arm=bpy.data.objects['root | 00_Showcase.006'];body=bpy.data.objects['Weapon_Body | 00_Showcase.008'];mag=bpy.data.objects['Weapon_Magazine | 00_Showcase.007']
 uvhash=[]
 for obj in [body,mag]:
  assert obj.data.materials[0].name==matname,(title,obj.name,'material')
  uv=obj.data.uv_layers.get('SourceUV');assert uv,(title,obj.name,'UV')
  ar=np.empty(len(uv.data)*2,dtype=np.float32);uv.data.foreach_get('uv',ar);uvhash.append(hashlib.sha256(ar.tobytes()).hexdigest())
  assert any(m.type=='ARMATURE' and m.object==arm for m in obj.modifiers),(title,obj.name,'rig')
 if baseline is None:baseline=uvhash
 assert uvhash==baseline,title+' UV mismatch'
 img=next(n for n in body.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE').image
 assert img.packed_file and hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((p/filename).read_bytes()).digest(),title+' PNG mismatch'
 assert arm.animation_data and len(arm.animation_data.nla_tracks)>0
 assert all(mag.vertex_groups.get('bullet_'+str(i)) and mag.vertex_groups.get('chain_'+str(i)) for i in range(1,9))
 for frame in [76,500,650]:
  scene.frame_set(frame);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
  for obj in [body,mag]:
   ev=obj.evaluated_get(deps);mesh=ev.to_mesh();assert len(mesh.vertices)>0 and all(math.isfinite(x) for x in mesh.vertices[0].co);ev.to_mesh_clear()
 print('OK',title,'packed PNG; shared UV; rig and 8 bullet/chain groups; evaluated frames 76/500/650',flush=True)
bpy.ops.wm.open_mainfile(filepath=str(p/'Odin_Three_Skins_Gallery.blend'))
s=bpy.data.scenes['Odin Three Skins']
for col in ['Odin Smite','Odin Prime','Odin BlastX']:assert bpy.data.collections[col] in s.collection.children[:]
print('OK gallery: three variants',flush=True)
