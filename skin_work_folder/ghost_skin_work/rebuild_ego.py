import bpy,hashlib,math,json
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\ghost_skin_work');source=r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\ghost\ghost-first-person.blend';geo=json.load(open(P/'geometry.json'))
bpy.context.preferences.filepaths.save_version=0
for skin in ['Ego']:
 bpy.ops.wm.open_mainfile(filepath=source)
 mat=bpy.data.materials['Weapon_Skin'];tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');img=bpy.data.images.load(str(P/('ghost_'+skin.lower()+'_weapon.png')),check_existing=False);img.name='Ghost '+skin+' Texture';img.pack();tex.image=img;tex.interpolation='Closest'
 for src in geo:
  n='Weapon_Magazine | 00_Showcase' if 'Magazine' in src['name'] else 'Weapon_Body | 00_Showcase';ob=bpy.data.objects[n];assert len(ob.data.vertices)==len(src['vertices']);assert max(abs(v.co[i]-xyz[i]) for v,xyz in zip(ob.data.vertices,src['vertices']) for i in range(3))<1e-6
  assert ob.data.uv_layers.get('SourceUV') and any(m.type=='ARMATURE' for m in ob.modifiers);ob.data.calc_loop_triangles();uv=ob.data.uv_layers['SourceUV'].data;assert len(ob.data.loop_triangles)==len(src['faces'])
  assert max(abs(uv[l].uv[k]-f['uv'][j][k]) for t,f in zip(ob.data.loop_triangles,src['faces']) for j,l in enumerate(t.loops) for k in range(2))<1e-6
 body=bpy.data.objects['Weapon_Body | 00_Showcase'];mag=bpy.data.objects['Weapon_Magazine | 00_Showcase'];assert body.vertex_groups.get('bullet_in_barrel');assert mag.vertex_groups.get('mag_standard') and mag.vertex_groups.get('bullet')
 rig=bpy.data.objects['root'];assert rig.animation_data and len(rig.animation_data.nla_tracks)==30
 for scene_name in ['06_reload_tactical','07_reload_empty']:
  s=bpy.data.scenes[scene_name];bpy.context.window.scene=s;objects=[next(o for o in s.objects if o.type=='MESH' and o.name.startswith(n)) for n in ['Weapon_Body','Weapon_Magazine']]
  for f in [25,60,80]:
   s.frame_set(f);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
   for ob in objects:
    ev=ob.evaluated_get(deps);mesh=ev.to_mesh();assert mesh and len(mesh.vertices) and all(math.isfinite(x) for x in mesh.vertices[0].co);ev.to_mesh_clear()
  print(skin,scene_name,'frames 25/60/80 evaluated',flush=True)
 assert hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((P/('ghost_'+skin.lower()+'_weapon.png')).read_bytes()).digest()
 bpy.context.window.scene=bpy.data.scenes['00_Showcase'];bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(P/('Ghost_'+skin+'_Animated.blend')))
 print('VERIFIED',skin,'mesh+UV, bullet, 30 NLA tracks, reload and packed PNG',flush=True)
