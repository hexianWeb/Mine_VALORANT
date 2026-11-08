import bpy
from mathutils import Vector
src=bpy.data.scenes['09_ODIN'];bpy.context.window.scene=src;src.frame_set(76);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
mat=bpy.data.materials['Odin_Smite_Skin'];tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');tex.image=bpy.data.images.load(r'D:\Projects\Mine_VALORANT\skin_work_folder\odin_skin_work\odin_prime_texture.png',check_existing=False)
sc=bpy.data.scenes.new('Prime Preview')
for name in ['Weapon_Body | 00_Showcase.008','Weapon_Magazine | 00_Showcase.007']:
 ev=bpy.data.objects[name].evaluated_get(deps);mesh=bpy.data.meshes.new_from_object(ev,depsgraph=deps,preserve_all_data_layers=True);obj=bpy.data.objects.new('preview '+name,mesh);sc.collection.objects.link(obj);obj.matrix_world=ev.matrix_world.copy()
center=Vector((-.11,-.06,.43));camdata=bpy.data.cameras.new('Preview camera');cam=bpy.data.objects.new('Preview camera',camdata);sc.collection.objects.link(cam);sc.camera=cam;cam.location=(-6,-.06,.43);cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();camdata.type='ORTHO';camdata.ortho_scale=3.65
for pos,power,size in [((-3,-1,3),340,5),((-3,2,1),250,4)]:
 d=bpy.data.lights.new('Preview light','AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new('Preview light',d);sc.collection.objects.link(o);o.location=pos;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
world=bpy.data.worlds.new('preview world');world.use_nodes=True;bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.025,.03,.045,1);bg.inputs['Strength'].default_value=.3;sc.world=world
sc.render.engine='CYCLES';sc.cycles.samples=16;sc.render.resolution_x=1600;sc.render.resolution_y=650;sc.render.resolution_percentage=100;sc.render.image_settings.file_format='PNG';sc.render.filepath=r'D:\Projects\Mine_VALORANT\skin_work_folder\odin_skin_work\odin_prime_review.png'
bpy.context.window.scene=sc;bpy.ops.render.render(write_still=True)
print('preview saved')
