import bpy
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\sheriff_skin_work');bpy.ops.wm.open_mainfile(filepath=str(p/'Sheriff_Smite_Animated.blend'))
s=bpy.data.scenes['06_reload_tactical'];bpy.context.window.scene=s;s.render.engine='BLENDER_WORKBENCH';s.display.shading.color_type='TEXTURE';s.display.shading.light='STUDIO';s.render.resolution_x=1200;s.render.resolution_y=675;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
for frame in [75,100]:
 s.frame_set(frame);s.render.filepath=str(p/('reload_frame_'+str(frame)+'.png'));bpy.ops.render.render(write_still=True);print('rendered',frame,flush=True)
