import bpy
from pathlib import Path
from mathutils import Vector
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\phantom_skin_work')
for name in ['Smite','Prism','Tactiplay','Rush']:
 bpy.ops.wm.open_mainfile(filepath=str(p/('Phantom_'+name+'_Animated.blend')))
 s=bpy.data.scenes['06_reload_tactical'];bpy.context.window.scene=s;s.frame_set(75);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();objects=[o for o in s.objects if o.type=='MESH' and o.name.startswith('Weapon_')];points=[]
 for ob in objects:
  ev=ob.evaluated_get(deps);m=ev.to_mesh();points.extend([ev.matrix_world@v.co for v in m.vertices]);ev.to_mesh_clear()
 for o in s.objects:
  if o.type=='MESH' and o.name.startswith('Arms_'):o.hide_render=True
 mins=[min(v[i] for v in points) for i in range(3)];maxs=[max(v[i] for v in points) for i in range(3)];c=Vector([(mins[i]+maxs[i])/2 for i in range(3)]);data=bpy.data.cameras.new('QA_camera');cam=bpy.data.objects.new('QA_camera',data);s.collection.objects.link(cam);cam.location=c+Vector((-7,0,0));cam.rotation_euler=(c-cam.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=max((maxs[1]-mins[1])*1.25,(maxs[2]-mins[2])*1.9,0.5);s.camera=cam
 s.render.engine='BLENDER_WORKBENCH';s.display.shading.color_type='TEXTURE';s.display.shading.light='STUDIO';s.render.resolution_x=900;s.render.resolution_y=600;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.filepath=str(p/('Phantom_'+name+'_Magazine_QA.png'));bpy.ops.render.render(write_still=True);print(name,'mag QA',flush=True)
