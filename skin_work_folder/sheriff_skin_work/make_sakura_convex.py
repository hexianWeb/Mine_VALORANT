import json,numpy as np
from PIL import Image,ImageDraw
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\sheriff_skin_work');N=2048;geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'weights.json'))
original=Image.open(r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\sheriff\textures\weapon.png').convert('RGBA');orig=np.array(original.resize((N,N),Image.Resampling.NEAREST))
for skin in ['sakura','convex']:
 ref=np.array(Image.open(P/(skin+'_reference.png')).convert('RGBA'));h,w=ref.shape[:2];mask=ref[:,:,3]>128
 ys=np.arange(h)[:,None];prev=np.maximum.accumulate(np.where(mask,ys,-10000),axis=0);nxt=np.minimum.accumulate(np.where(mask,ys,10000)[::-1],axis=0)[::-1]
 near_y=np.where(ys-prev<=nxt-ys,prev,nxt);dy=(near_y-ys)**2;xg=np.arange(w);dx=(xg[:,None]-xg[None,:])**2
 nx=np.empty((h,w),np.int32);ny=np.empty((h,w),np.int32)
 for y in range(h):
  best=np.argmin(dx+dy[y][None,:],axis=1);nx[y]=best;ny[y]=near_y[y,best]
 out=orig[:,:,:3].copy();filled=np.zeros((N,N),bool);protect=Image.new('1',(N,N));pd=ImageDraw.Draw(protect)
 for obj in geo:
  for face in obj['faces']:
   gs=[max(weights[obj['name']][str(v)],key=lambda q:q[1])[0] if weights[obj['name']][str(v)] else '' for v in face['v']]
   if any(g.startswith(('Shell_','Slug_','Primer_')) or g=='Loader' for g in gs):
    pd.polygon([(round(uv[0]*(N-1)),round((1-uv[1])*(N-1))) for uv in face['uv']],fill=1)
  if 'Magazine' in obj['name']:continue
  verts=np.array(obj['vertices'])
  for face in obj['faces']:
   gs=[max(weights[obj['name']][str(v)],key=lambda q:q[1])[0] if weights[obj['name']][str(v)] else '' for v in face['v']]
   if any(g.startswith(('Shell_','Slug_','Primer_')) or g=='Loader' for g in gs):continue
   uv=np.array(face['uv']);xyz=verts[face['v']];q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)))
   xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
   if xmax<xmin or ymax<ymin:continue
   a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
   if abs(den)<1e-9:continue
   xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1));wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
   inside=(wa>=-.01)&(wb>=-.01)&(wc>=-.01)
   if not inside.any():continue
   py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
   sx=np.clip(np.rint(10+(1.492257-py)*485/1.665073).astype(int),0,w-1);sy=np.clip(np.rint((.277539-pz)*(h-1)/.828203).astype(int),0,h-1)
   invalid=~mask[sy,sx];fx=np.where(invalid,nx[sy,sx],sx);fy=np.where(invalid,ny[sy,sx],sy);sample=ref[fy,fx,:3]
   dest=out[ymin:ymax+1,xmin:xmax+1];dest[inside]=sample[inside];filled[ymin:ymax+1,xmin:xmax+1]|=inside
 for _ in range(3):
  old=filled.copy()
  for dy_,dx_ in ((0,1),(0,-1),(1,0),(-1,0)):
   nearby=np.roll(old,(dy_,dx_),(0,1));take=nearby&~filled;out[take]=np.roll(out,(dy_,dx_),(0,1))[take];filled[take]=True
 keep=np.asarray(protect,dtype=bool);out[keep]=orig[:,:,:3][keep]
 result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(Image.fromarray(orig[:,:,3]));result.save(P/('sheriff_'+skin+'_weapon.png'))
 print(skin,'painted',int(filled.sum()),'protected',int(keep.sum()),flush=True)
