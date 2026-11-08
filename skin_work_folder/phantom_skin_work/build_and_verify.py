import bpy,hashlib,math,json
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\phantom_skin_work');source=r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\phantom\phantom-first-person.blend';geo=json.load(open(P/'geometry.json'))
for skin in ['Smite','Prism','Tactiplay','Rush']:
 bpy.ops.wm.open_mainfile(filepath=source)
 mat=bpy.data.materials['Weapon_Skin'];tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');img=bpy.data.images.load(str(P/('phantom_'+skin.lower()+'_weapon.png')),check_existing=False);img.name='Phantom '+skin+' Texture';img.pack();tex.image=img;tex.interpolation='Closest'
 for src in geo:
  n='Weapon_SpareMagazine | 00_Showcase' if 'SpareMagazine' in src['name'] else ('Weapon_Magazine | 00_Showcase' if 'Magazine' in src['name'] else 'Weapon_Body | 00_Showcase');ob=bpy.data.objects[n];assert len(ob.data.vertices)==len(src['vertices']);assert max(abs(v.co[i]-xyz[i]) for v,xyz in zip(ob.data.vertices,src['vertices']) for i in range(3))<1e-6
  assert ob.data.uv_layers.get('SourceUV') and any(m.type=='ARMATURE' for m in ob.modifiers);ob.data.calc_loop_triangles();uv=ob.data.uv_layers['SourceUV'].data;assert len(ob.data.loop_triangles)==len(src['faces'])
  assert max(abs(uv[l].uv[k]-f['uv'][j][k]) for t,f in zip(ob.data.loop_triangles,src['faces']) for j,l in enumerate(t.loops) for k in range(2))<1e-6
 mag=bpy.data.objects['Weapon_Magazine | 00_Showcase'];spare=bpy.data.objects['Weapon_SpareMagazine | 00_Showcase'];assert all(mag.vertex_groups.get(g) for g in ['mag_standard','group25','556']);assert all(spare.vertex_groups.get(g) for g in ['preview_extra_mag_standard','preview_extra_group25'])
 rig=bpy.data.objects['root'];assert rig.animation_data and len(rig.animation_data.nla_tracks)==30
 for scene_name in ['06_reload_tactical','07_reload_empty']:
  s=bpy.data.scenes[scene_name];bpy.context.window.scene=s;objects=[next(o for o in s.objects if o.type=='MESH' and o.name.startswith(n)) for n in ['Weapon_Body','Weapon_Magazine','Weapon_SpareMagazine']]
  for f in [75,110,150]:
   s.frame_set(f);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
   for ob in objects:
    ev=ob.evaluated_get(deps);mesh=ev.to_mesh();assert mesh and len(mesh.vertices) and all(math.isfinite(x) for x in mesh.vertices[0].co);ev.to_mesh_clear()
  print(skin,scene_name,'frames 75/110/150 evaluated',flush=True)
 assert hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((P/('phantom_'+skin.lower()+'_weapon.png')).read_bytes()).digest()
 bpy.context.window.scene=bpy.data.scenes['00_Showcase'];bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(P/('Phantom_'+skin+'_Animated.blend')))
 print('VERIFIED',skin,'three mesh UVs, bullet+spare, 30 NLA tracks, reloads and packed PNG',flush=True)
