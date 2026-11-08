import json, numpy as np
from PIL import Image
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\judge_skin_work'); N=2048
geo=json.load(open(P/'geometry.json')); weights=json.load(open(P/'weights.json'))
original=Image.open(r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\judge\textures\weapon.png').convert('RGBA')
alpha=original.getchannel('A').resize((N,N),Image.Resampling.NEAREST)
print('original',original.size,'alpha',original.getchannel('A').getextrema())
for skin in ['smite','rush']:
 ref=np.array(Image.open(P/(skin+'_ref.png')).convert('RGBA'))
 h,w=ref.shape[:2];mask=ref[:,:,3]>128
 ys=np.arange(h)[:,None];prev=np.maximum.accumulate(np.where(mask,ys,-10000),axis=0);nxt=np.minimum.accumulate(np.where(mask,ys,10000)[::-1],axis=0)[::-1]
 near_y=np.where(ys-prev<=nxt-ys,prev,nxt);dy=(near_y-ys)**2;xg=np.arange(w);dx=(xg[:,None]-xg[None,:])**2
 nx=np.empty((h,w),np.int32);ny=np.empty((h,w),np.int32)
 for y in range(h):
  best=np.argmin(dx+dy[y][None,:],axis=1);nx[y]=best;ny[y]=near_y[y,best]
 out=np.empty((N,N,3),dtype=np.uint8);out[:]=[5,30,54] if skin=='smite' else [78,22,28]
 filled=np.zeros((N,N),bool)
 for obj in geo:
  verts=np.array(obj['vertices'])
  def is_bullet(face):
   groups=[max(weights[obj['name']][str(v)],key=lambda x:x[1])[0] if weights[obj['name']][str(v)] else '' for v in face['v']]
   return all(g.startswith('bullet') for g in groups)
  for face in sorted(obj['faces'],key=is_bullet):
   bullet=is_bullet(face)
   uv=np.array(face['uv']);xyz=verts[face['v']]
   q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)))
   xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
   if xmax<xmin or ymax<ymin:continue
   a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
   if abs(den)<1e-9:continue
   xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1))
   wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
   wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
   inside=(wa>=-.01)&(wb>=-.01)&(wc>=-.01)
   if not inside.any():continue
   py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
   # Bounding boxes of the official side icons, calibrated to Judge rest mesh.
   sx=np.clip(np.rint(18+(1.825-py)*478/2.8357).astype(int),0,w-1)
   sy=np.clip(np.rint(1+(.49375-pz)*142/.8578).astype(int),0,h-1)
   invalid=~mask[sy,sx]; fx=np.where(invalid,nx[sy,sx],sx);fy=np.where(invalid,ny[sy,sx],sy)
   sample=ref[fy,fx,:3].copy()
   if bullet:
    normal=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]); length=np.linalg.norm(normal)
    light=.65+.35*abs(normal[0]/length) if length else 1
    if skin=='rush':
     sample[:]=np.array([126,43,41])*light;sample[py<.405]=np.array([220,161,65])*light
     sample[(py>=.405)&(py<.415)]=np.array([76,53,39])*light
    else:
     sample[:]=np.array([63,101,135])*light;sample[py<.405]=np.array([192,211,224])*light
   dest=out[ymin:ymax+1,xmin:xmax+1];dest[inside]=sample[inside];filled[ymin:ymax+1,xmin:xmax+1]|=inside
 for _ in range(4):
  old=filled.copy()
  for dy_,dx_ in ((0,1),(0,-1),(1,0),(-1,0)):
   nearby=np.roll(old,(dy_,dx_),(0,1));take=nearby&~filled;out[take]=np.roll(out,(dy_,dx_),(0,1))[take];filled[take]=True
 result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(alpha);result.save(P/('judge_'+skin+'_texture.png'))
 print(skin,'painted',int(filled.sum()))
