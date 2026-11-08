import bpy
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=r'D:\Projects\Mine_VALORANT\skin_work_folder\phantom_skin_work\Phantom_Tactiplay_Animated.blend');s=bpy.data.scenes['06_reload_tactical'];bpy.context.window.scene=s
for f in [1,20,35,50,65,75,90,110,130,150]:
 s.frame_set(f);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();vals=[]
 for prefix in ['Weapon_Magazine','Weapon_SpareMagazine']:
  ob=next(o for o in s.objects if o.type=='MESH' and o.name.startswith(prefix));ev=ob.evaluated_get(deps);m=ev.to_mesh();pts=[ev.matrix_world@v.co for v in m.vertices];center=tuple(round(sum(v[i] for v in pts)/len(pts),3) for i in range(3));dims=tuple(round(max(v[i] for v in pts)-min(v[i] for v in pts),3) for i in range(3));ev.to_mesh_clear();vals.append((prefix,center,dims))
 print(f,vals)
