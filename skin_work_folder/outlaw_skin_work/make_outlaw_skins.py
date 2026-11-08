import json, numpy as np
from PIL import Image
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\outlaw_skin_work'); N=2048
geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'weights.json'))
source=Path(r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\outlaw\textures')
for skin in ['smite','rgx']:
 ref=np.array(Image.open(P/(skin+'_ref.png')).convert('RGBA'));h,w=ref.shape[:2];mask=ref[:,:,3]>128
 ys=np.arange(h)[:,None];prev=np.maximum.accumulate(np.where(mask,ys,-10000),axis=0);nxt=np.minimum.accumulate(np.where(mask,ys,10000)[::-1],axis=0)[::-1]
 near_y=np.where(ys-prev<=nxt-ys,prev,nxt);dy=(near_y-ys)**2;xg=np.arange(w);dx=(xg[:,None]-xg[None,:])**2
 nx=np.empty((h,w),np.int32);ny=np.empty((h,w),np.int32)
 for y in range(h):
  best=np.argmin(dx+dy[y][None,:],axis=1);nx[y]=best;ny[y]=near_y[y,best]
 for obj in geo:
  part='scope' if 'Scope' in obj['name'] else 'weapon';verts=np.array(obj['vertices'])
  original=Image.open(source/(part+'.png')).convert('RGBA');alpha=original.getchannel('A').resize((N,N),Image.Resampling.NEAREST)
  out=np.empty((N,N,3),dtype=np.uint8);out[:]=[7,31,55] if skin=='smite' else [32,39,30];filled=np.zeros((N,N),bool)
  def group(face):
   gs=[max(weights[obj['name']][str(v)],key=lambda x:x[1])[0] if weights[obj['name']][str(v)] else '' for v in face['v']]
   return gs[0] if len(set(gs))==1 else ''
  def special(face):return group(face) in ('up_bullet','down_bullet','attachment_ocular','attachment_lens_illuminated')
  for face in sorted(obj['faces'],key=special):
   grp=group(face);uv=np.array(face['uv']);xyz=verts[face['v']]
   q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)))
   xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
   if xmax<xmin or ymax<ymin:continue
   a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
   if abs(den)<1e-9:continue
   xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1))
   wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
   inside=(wa>=-.01)&(wb>=-.01)&(wc>=-.01)
   if not inside.any():continue
   py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
   sx=np.clip(np.rint(8+(2.613985-py)*(496 if skin=='smite' else 500)/3.602115).astype(int),0,w-1)
   sy=np.clip(np.rint((1 if skin=='smite' else 0)+(.387891-pz)*(104 if skin=='smite' else 103)/.735372).astype(int),0,h-1)
   invalid=~mask[sy,sx];fx=np.where(invalid,nx[sy,sx],sx);fy=np.where(invalid,ny[sy,sx],sy);sample=ref[fy,fx,:3].copy()
   if grp in ('up_bullet','down_bullet'):
    normal=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);length=np.linalg.norm(normal);light=.72+.28*abs(normal[0]/length) if length else 1
    sample[:]=np.array([165,129,62])*light;sample[py>.32]=np.array([207,185,129])*light
   elif grp in ('attachment_ocular','attachment_lens_illuminated'):
    sample[:]=[24,73,102] if skin=='smite' else [39,110,38]
   dest=out[ymin:ymax+1,xmin:xmax+1];dest[inside]=sample[inside];filled[ymin:ymax+1,xmin:xmax+1]|=inside
  for _ in range(4):
   old=filled.copy()
   for y,x in ((0,1),(0,-1),(1,0),(-1,0)):
    nearby=np.roll(old,(y,x),(0,1));take=nearby&~filled;out[take]=np.roll(out,(y,x),(0,1))[take];filled[take]=True
  result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(alpha);result.save(P/('outlaw_'+skin+'_'+part+'.png'))
  print(skin,part,'covered',int(filled.sum()),flush=True)
