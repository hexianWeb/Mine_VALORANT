import bpy
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\ghost_skin_work')
for name in ['Freehand','Recon','Ego','Spitfire']:
 bpy.ops.wm.open_mainfile(filepath=str(p/('Ghost_'+name+'_Animated.blend')))
 s=bpy.data.scenes['06_reload_tactical'];bpy.context.window.scene=s;s.render.engine='BLENDER_WORKBENCH';s.display.shading.color_type='TEXTURE';s.display.shading.light='STUDIO';s.render.resolution_x=800;s.render.resolution_y=450;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
 for frame in [30,75]:
  s.frame_set(frame);s.render.filepath=str(p/('Ghost_'+name+'_Reload_'+str(frame)+'.png'));bpy.ops.render.render(write_still=True)
 print(name,'reload previews rendered',flush=True)
