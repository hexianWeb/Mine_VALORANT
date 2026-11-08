import bpy
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\operator_skin_work')
for name in ['Prism','Striker']:
 bpy.ops.wm.open_mainfile(filepath=str(p/('Operator_'+name+'_Animated.blend')))
 s=bpy.data.scenes['06_reload_tactical'];bpy.context.window.scene=s;s.render.engine='BLENDER_WORKBENCH';s.display.shading.color_type='TEXTURE';s.display.shading.light='STUDIO';s.render.resolution_x=1200;s.render.resolution_y=675;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
 s.frame_set(75);s.render.filepath=str(p/('Operator_'+name+'_Reload_75.png'));bpy.ops.render.render(write_still=True);print(name,'reload preview rendered',flush=True)
