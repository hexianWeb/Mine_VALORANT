import bpy,hashlib,math,json
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\operator_skin_work');source=r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\operator\operator-first-person.blend';geo=json.load(open(P/'geometry.json'))
for skin in ['Prism','Striker']:
 bpy.ops.wm.open_mainfile(filepath=source)
 for part,material in [('weapon','Weapon_Skin'),('scope','Weapon_Scope')]:
  mat=bpy.data.materials[material];tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');img=bpy.data.images.load(str(P/('operator_'+skin.lower()+'_'+part+'.png')),check_existing=False);img.name='Operator '+skin+' '+part+' Texture';img.pack();tex.image=img;tex.interpolation='Closest';assert hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((P/('operator_'+skin.lower()+'_'+part+'.png')).read_bytes()).digest()
 for src in geo:
  n='Weapon_Scope | 00_Showcase' if 'Scope' in src['name'] else ('Weapon_Magazine | 00_Showcase' if 'Magazine' in src['name'] else 'Weapon_Body | 00_Showcase')
  ob=bpy.data.objects[n];assert len(ob.data.vertices)==len(src['vertices']);assert max(abs(v.co[i]-xyz[i]) for v,xyz in zip(ob.data.vertices,src['vertices']) for i in range(3))<1e-6
  assert ob.data.uv_layers.get('SourceUV') and any(m.type=='ARMATURE' for m in ob.modifiers);ob.data.calc_loop_triangles();uv=ob.data.uv_layers['SourceUV'].data;assert len(ob.data.loop_triangles)==len(src['faces'])
  assert max(abs(uv[l].uv[k]-f['uv'][j][k]) for t,f in zip(ob.data.loop_triangles,src['faces']) for j,l in enumerate(t.loops) for k in range(2))<1e-6
 body=bpy.data.objects['Weapon_Body | 00_Showcase'];mag=bpy.data.objects['Weapon_Magazine | 00_Showcase'];scope=bpy.data.objects['Weapon_Scope | 00_Showcase']
 for g in ['bullet','bullet_shell','bullet_in_barrel']:assert body.vertex_groups.get(g)
 for g in ['bullet_in_mag','mag_standard']:assert mag.vertex_groups.get(g)
 for g in ['attachment_ocular','attachment_lens_illuminated']:assert scope.vertex_groups.get(g)
 rig=bpy.data.objects['aim_move'];assert rig.animation_data and len(rig.animation_data.nla_tracks)==35
 for scene_name in ['06_reload_tactical','07_reload_empty']:
  s=bpy.data.scenes[scene_name];bpy.context.window.scene=s;objects=[next(o for o in s.objects if o.type=='MESH' and o.name.startswith(n)) for n in ['Weapon_Body','Weapon_Magazine','Weapon_Scope']]
  for f in [75,150]:
   s.frame_set(f);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
   for ob in objects:
    ev=ob.evaluated_get(deps);mesh=ev.to_mesh();assert mesh and len(mesh.vertices) and all(math.isfinite(x) for x in mesh.vertices[0].co);ev.to_mesh_clear()
  print(skin,scene_name,'frames 75/150 evaluated',flush=True)
 bpy.context.window.scene=bpy.data.scenes['00_Showcase'];bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(P/('Operator_'+skin+'_Animated.blend')))
 print('VERIFIED',skin,'mesh+UV, scope, bullets, 35 NLA tracks, reloads, two packed textures',flush=True)
