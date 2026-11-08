import json,numpy as np
from PIL import Image,ImageDraw,ImageFilter
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\ghost_skin_work');N=2048;geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'weights.json'));out=Image.open(P/'ghost_ego_weapon.png').convert('RGBA');arr=np.array(out);ref=np.array(Image.open(P/'ego_reference_reverse_text.png').convert('RGBA'));front=Image.new('L',(N,N));draw=ImageDraw.Draw(front)
obj=next(o for o in geo if 'Body' in o['name']);verts=np.array(obj['vertices'])
for face in obj['faces']:
 xyz=verts[face['v']];normal=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);length=np.linalg.norm(normal)
 if length and normal[0]/length<-.4:draw.polygon([(round(u[0]*2047),round((1-u[1])*2047)) for u in face['uv']],fill=255)
frontmask=np.array(front.filter(ImageFilter.MaxFilter(3)))>0
bullet=Image.new('L',(N,N));d=ImageDraw.Draw(bullet)
for ob in geo:
 for face in ob['faces']:
  gs=[max(weights[ob['name']][str(v)],key=lambda q:q[1])[0] if weights[ob['name']][str(v)] else '' for v in face['v']]
  if any(g.startswith('bullet') for g in gs):d.polygon([(round(u[0]*2047),round((1-u[1])*2047)) for u in face['uv']],fill=255)
protect=np.array(bullet)>0;count=0;skipped=0
for face in obj['faces']:
 xyz=verts[face['v']];normal=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);length=np.linalg.norm(normal)
 if not length or normal[0]/length<=.4:continue
 uv=np.array(face['uv']);q=np.column_stack((uv[:,0]*2047,(1-uv[:,1])*2047));xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(2047,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(2047,int(np.ceil(q[:,1].max()))+1)
 if xmax<xmin or ymax<ymin:continue
 a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
 if abs(den)<1e-9:continue
 xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1));wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
 inside=(wa>=-.01)&(wb>=-.01)&(wc>=-.01);py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
 sx=np.clip(np.rint(2+(1.175531-py)*501/1.5224107).astype(int),0,511);sy=np.clip(np.rint((.191613-pz)*162/.511781).astype(int),0,163)
 targeted=inside&(sx>=282)&(sx<378)&(sy>=30)&(sy<45);blocked=frontmask[ymin:ymax+1,xmin:xmax+1]|protect[ymin:ymax+1,xmin:xmax+1];skipped+=int((targeted&blocked).sum());take=targeted&~blocked
 if take.any():
  dst=arr[ymin:ymax+1,xmin:xmax+1,:3];sample=ref[sy,sx,:3];dst[take]=sample[take];count+=int(take.sum())
Image.fromarray(arr,'RGBA').save(P/'ghost_ego_weapon_mirrorfix.png');print('done painted',count,'blocked',skipped,flush=True)
