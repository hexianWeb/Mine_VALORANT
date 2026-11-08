import bpy,hashlib,math,json
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\sheriff_skin_work');source=r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\sheriff\sheriff-first-person.blend';geo=json.load(open(P/'geometry.json'))
for skin in ['Sakura','Convex']:
 bpy.ops.wm.open_mainfile(filepath=source)
 mat=bpy.data.materials['Weapon_Skin'];tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');img=bpy.data.images.load(str(P/('sheriff_'+skin.lower()+'_weapon.png')),check_existing=False);img.name='Sheriff '+skin+' Texture';img.pack();tex.image=img;tex.interpolation='Closest'
 for src,n in zip(geo,['Weapon_Body | 00_Showcase','Weapon_Magazine | 00_Showcase']):
  ob=bpy.data.objects[n];assert len(ob.data.vertices)==len(src['vertices']);assert max(abs(v.co[i]-xyz[i]) for v,xyz in zip(ob.data.vertices,src['vertices']) for i in range(3))<1e-6
  assert ob.data.uv_layers.get('SourceUV') and any(m.type=='ARMATURE' for m in ob.modifiers);ob.data.calc_loop_triangles();uv=ob.data.uv_layers['SourceUV'].data;assert len(ob.data.loop_triangles)==len(src['faces'])
  assert max(abs(uv[l].uv[k]-f['uv'][j][k]) for t,f in zip(ob.data.loop_triangles,src['faces']) for j,l in enumerate(t.loops) for k in range(2))<1e-6
 for i in range(1,13):
  ob=bpy.data.objects['Weapon_Body | 00_Showcase' if i<=6 else 'Weapon_Magazine | 00_Showcase']
  for group in ['Shell_','Slug_','Primer_']:assert ob.vertex_groups.get(group+str(i))
 arm=bpy.data.objects['root'];assert arm.animation_data and len(arm.animation_data.nla_tracks)==30
 s=bpy.data.scenes['06_reload_tactical'];bpy.context.window.scene=s;mag=next(o for o in s.objects if o.type=='MESH' and o.name.startswith('Weapon_Magazine'))
 for f in [75,100]:
  s.frame_set(f);bpy.context.view_layer.update();ev=mag.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();dims=[max(v.co[i] for v in mesh.vertices)-min(v.co[i] for v in mesh.vertices) for i in range(3)];assert all(math.isfinite(x) for x in dims) and max(dims)>.05;ev.to_mesh_clear();print(skin,'RELOAD',f,'loader bounds',dims,flush=True)
 assert hashlib.sha256(bytes(img.packed_file.data)).digest()==hashlib.sha256((P/('sheriff_'+skin.lower()+'_weapon.png')).read_bytes()).digest()
 bpy.context.window.scene=bpy.data.scenes['00_Showcase'];bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(P/('Sheriff_'+skin+'_Animated.blend')))
 print('VERIFIED',skin,'mesh+UV, 12 rounds, 30 NLA tracks, reload and packed PNG',flush=True)
