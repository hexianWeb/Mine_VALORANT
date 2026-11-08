import bpy, os, hashlib, math, json
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\judge_skin_work')
source=r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\judge\judge-first-person.blend'
geo=json.load(open(P/'geometry.json'))
for skin in ['Smite','Rush']:
 bpy.ops.wm.open_mainfile(filepath=source)
 mat=bpy.data.materials['Weapon_Skin'];tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE')
 img=bpy.data.images.load(str(P/('judge_'+skin.lower()+'_texture.png')),check_existing=False);img.name='Judge '+skin+' Texture';img.pack();tex.image=img;tex.interpolation='Closest'
 for src,n in zip(geo,['Weapon_Body | 00_Showcase','Weapon_Magazine | 00_Showcase']):
  ob=bpy.data.objects[n]
  assert len(ob.data.vertices)==len(src['vertices'])
  assert max(abs(v.co[i]-xyz[i]) for v,xyz in zip(ob.data.vertices,src['vertices']) for i in range(3))<1e-6
  assert ob.data.uv_layers.get('SourceUV') and any(m.type=='ARMATURE' for m in ob.modifiers)
  ob.data.calc_loop_triangles();uv=ob.data.uv_layers['SourceUV'].data
  assert len(ob.data.loop_triangles)==len(src['faces'])
  assert max(abs(uv[l].uv[k]-f['uv'][j][k]) for t,f in zip(ob.data.loop_triangles,src['faces']) for j,l in enumerate(t.loops) for k in range(2))<1e-6
 mag=bpy.data.objects['Weapon_Magazine | 00_Showcase']
 for i in range(5):assert mag.vertex_groups.get('bullet'+str(i))
 arm=bpy.data.objects['root'];assert arm.animation_data and len(arm.animation_data.nla_tracks)>=30
 scene=bpy.data.scenes['00_Showcase'];bpy.context.window.scene=scene
 for frame in [1,76,500]:
  scene.frame_set(frame);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
  for n in ['Weapon_Body | 00_Showcase','Weapon_Magazine | 00_Showcase']:
   e=bpy.data.objects[n].evaluated_get(deps);m=e.to_mesh();assert m and len(m.vertices) and all(math.isfinite(x) for x in m.vertices[0].co);e.to_mesh_clear()
 assert hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((P/('judge_'+skin.lower()+'_texture.png')).read_bytes()).digest()
 bpy.ops.file.pack_all()
 bpy.ops.wm.save_as_mainfile(filepath=str(P/('Judge_'+skin+'_Animated.blend')))
 print('VERIFIED',skin,'source mesh+UV, five bullet groups, 33 NLA tracks, evaluated frames, packed PNG',flush=True)
