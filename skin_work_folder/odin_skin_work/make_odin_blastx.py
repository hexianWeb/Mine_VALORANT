import json, numpy as np
from PIL import Image,ImageDraw
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\odin_skin_work')
N=2048
ref=np.array(Image.open(P/'blastx_reference.jpg').convert('RGB'))
mask=np.array(Image.open(P/'blastx_transparent.png').convert('RGBA'))[:,:,3]>150
h,w=mask.shape
# Nearest opaque reference pixel, computed by separable Euclidean search.
ygrid=np.arange(h)[:,None]; idx=np.where(mask,ygrid,-10000)
prev=np.maximum.accumulate(idx,axis=0)
idx2=np.where(mask,ygrid,10000);nxt=np.minimum.accumulate(idx2[::-1],axis=0)[::-1]
nearest_y=np.where((ygrid-prev)<=(nxt-ygrid),prev,nxt);dy2=(nearest_y-ygrid)**2
xg=np.arange(w);dx2=(xg[:,None]-xg[None,:])**2
nearest_x=np.empty((h,w),dtype=np.int32);nearest_row=np.empty((h,w),dtype=np.int32)
for y in range(h):
 dist=dx2+dy2[y][None,:];best=np.argmin(dist,axis=1);nearest_x[y]=best;nearest_row[y]=nearest_y[y,best]
# Remove photographed 4-round bullets from receiver to keep the actual 8 animated 3D rounds clean.
body_ref=ref.copy()
x0,x1=1170,1375;y0,y1=407,571
for y in range(y0,y1):
 left=ref[y,x0-1].astype(float);right=ref[y,x1].astype(float)
 t=np.linspace(0,1,x1-x0)[:,None]
 body_ref[y,x0:x1]=np.clip(left[None,:]*(1-t)+right[None,:]*t,0,255).astype(np.uint8)
geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'vertex_groups.json'))
out=np.empty((N,N,3),dtype=np.uint8);out[:]=[8,24,50];filled=np.zeros((N,N),dtype=bool)
counts={'body':0,'box':0,'bullet':0,'chain':0}
for oi,obj in enumerate(geo):
 verts=np.array(obj['vertices']);wd=weights[obj['name']];names=wd['groups'];ws=wd['weights']
 for face in obj['faces']:
  uv=np.array(face['uv']);xyz=verts[face['v']]
  groups=[names.get(str(max(ws[k],key=lambda q:q[1])[0]),'') if ws[k] else '' for k in face['v']]
  kind='body' if oi==0 else ('bullet' if any(n.startswith('bullet_') for n in groups) else ('chain' if any(n.startswith('chain_') for n in groups) else 'box'))
  counts[kind]+=1
  q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)))
  xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1)
  ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
  if xmax<xmin or ymax<ymin:continue
  a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(den)<1e-9:continue
  xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1))
  wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
  wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
  inside=(wa>=-.012)&(wb>=-.012)&(wc>=-.012)
  if not inside.any():continue
  py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
  if kind in ('body','box'):
   sx=np.clip((63+(2.748-py)*585).astype(int),0,1919);sy=np.clip((474-pz*585).astype(int),0,1079)
   mx=np.clip(np.rint(34+(sx-63)/4.084).astype(int),0,w-1);my=np.clip(np.rint((sy-354)/4.06).astype(int),0,h-1)
   invalid=~mask[my,mx]
   nx=nearest_x[my,mx];ny=nearest_row[my,mx]
   safe_x=np.clip(np.rint(63+(nx-34)*4.084).astype(int),0,1919);safe_y=np.clip(np.rint(354+ny*4.06).astype(int),0,1079)
   sx=np.where(invalid,safe_x,sx);sy=np.where(invalid,safe_y,sy)
   sampled=(body_ref if kind=='body' else ref)[sy,sx].copy()
  else:
   normal=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);ln=np.linalg.norm(normal);s=1.0 if ln<1e-10 else .75+.25*abs(normal[0]/ln)
   sampled=np.zeros(xx.shape+(3,),dtype=np.uint8)
   if kind=='bullet':
    sampled[:]=[116,54,158]
    sampled[py>.75]=[232,116,39]
    sampled[py>.82]=[255,166,64]
    sampled[py<.57]=[80,48,123]
   else:
    sampled[:]=[69,168,48];sampled[py>.645]=[109,207,57]
   sampled=np.clip(sampled.astype(float)*s,0,255).astype(np.uint8)
  dest=out[ymin:ymax+1,xmin:xmax+1];dest[inside]=sampled[inside];filled[ymin:ymax+1,xmin:xmax+1]|=inside
# Extend UV island boundaries, keeping already-painted texels intact.
for _ in range(3):
 old=filled.copy()
 for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
  nearby=np.roll(old,(dy,dx),(0,1));take=nearby&~filled
  out[take]=np.roll(out,(dy,dx),(0,1))[take];filled[take]=True
original=Image.open(P/'odin_original.png').convert('RGBA');alpha=original.getchannel('A').resize((N,N),Image.Resampling.NEAREST)
result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(alpha);result.save(P/'odin_blastx_texture.png')
print('done',counts,'filled',int(filled.sum()),'size',result.size)
