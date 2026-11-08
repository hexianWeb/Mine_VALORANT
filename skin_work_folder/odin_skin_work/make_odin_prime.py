import json, numpy as np
from PIL import Image,ImageDraw
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\odin_skin_work')
N=2048
ref=np.array(Image.open(P/'prime_odin_reference.jpg').convert('RGB'))
mask=np.array(Image.open(P/'prime_odin_transparent.png').convert('RGBA'))[:,:,3]>150
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
x0,x1=1165,1368;y0,y1=327,500
for y in range(y0,y1):
 left=ref[y,x0-1].astype(float);right=ref[y,x1].astype(float)
 t=np.linspace(0,1,x1-x0)[:,None]
 body_ref[y,x0:x1]=np.clip(left[None,:]*(1-t)+right[None,:]*t,0,255).astype(np.uint8)
body_im=Image.fromarray(body_ref);draw=ImageDraw.Draw(body_im)
draw.line([(1124,319),(1370,319)],fill=(244,199,70),width=4)
body_ref=np.array(body_im)
geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'vertex_groups.json'))
out=np.empty((N,N,3),dtype=np.uint8);out[:]=[46,42,49];filled=np.zeros((N,N),dtype=bool)
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
   sx=np.clip((55+(2.748-py)*591).astype(int),0,1919);sy=np.clip((387-pz*591).astype(int),0,1079)
   mx=np.clip(np.rint(37+(sx-55)/4.13).astype(int),0,w-1);my=np.clip(np.rint((sy-280)/4.06).astype(int),0,h-1)
   invalid=~mask[my,mx]
   nx=nearest_x[my,mx];ny=nearest_row[my,mx]
   safe_x=np.clip(np.rint(55+(nx-37)*4.13).astype(int),0,1919);safe_y=np.clip(np.rint(280+ny*4.06).astype(int),0,1079)
   sx=np.where(invalid,safe_x,sx);sy=np.where(invalid,safe_y,sy)
   sampled=(body_ref if kind=='body' else ref)[sy,sx].copy()
   # Rear stock is the original gun's dark loop rather than blue screen backdrop.
   if kind=='body':
    stock=(py<-.10)&(pz<.045)
    sampled[stock]=np.array([186,140,35],dtype=np.uint8)
    # Prime Vandal's violet lower panel adapted to Odin.
    purple=(py>1.05)&(py<2.08)&(pz<-.105)&(pz>-.185)
    sampled[purple]=np.array([68,28,98],dtype=np.uint8)
    purple_hi=(py>1.05)&(py<2.08)&(pz>=-.115)&(pz<-.105)
    sampled[purple_hi]=np.array([160,103,181],dtype=np.uint8)
   else:
    # Preserve Prime 2.0's mostly light metal ammunition box, with a violet inlay.
    purple=(pz<-.36)&(pz>-.592)&(py>.49)&(py<(.60+(-pz-.36)*1.10))
    sampled[purple]=np.array([55,29,85],dtype=np.uint8)
    goldrim=(pz<-.592)&(py>.47)&(py<.91)
    sampled[goldrim]=np.array([204,164,52],dtype=np.uint8)
  else:
   normal=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);ln=np.linalg.norm(normal);s=1.0 if ln<1e-10 else .75+.25*abs(normal[0]/ln)
   sampled=np.zeros(xx.shape+(3,),dtype=np.uint8)
   if kind=='bullet':
    sampled[:]=[151,110,34]
    sampled[py>.730]=[234,209,120];sampled[py>.79]=[242,243,236]
    sampled[(py<.575)]=[84,67,44]
   else:
    sampled[:]=[74,55,83];sampled[py>.645]=[187,150,63]
   sampled=np.clip(sampled.astype(float)*s,0,255).astype(np.uint8)
  dest=out[ymin:ymax+1,xmin:xmax+1];dest[inside]=sampled[inside];filled[ymin:ymax+1,xmin:xmax+1]|=inside
# Extend UV island boundaries, keeping already-painted texels intact.
for _ in range(3):
 old=filled.copy()
 for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
  nearby=np.roll(old,(dy,dx),(0,1));take=nearby&~filled
  out[take]=np.roll(out,(dy,dx),(0,1))[take];filled[take]=True
original=Image.open(P/'odin_original.png').convert('RGBA');alpha=original.getchannel('A').resize((N,N),Image.Resampling.NEAREST)
result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(alpha);result.save(P/'odin_prime_texture.png')
print('done',counts,'filled',int(filled.sum()),'size',result.size)
