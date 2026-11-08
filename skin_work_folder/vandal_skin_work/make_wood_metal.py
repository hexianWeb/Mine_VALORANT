import json
import numpy as np
from PIL import Image
P=r'D:\Projects\Mine_VALORANT\skin_work_folder\vandal_skin_work'
N=2048
ref=np.asarray(Image.open(r'D:\dev-cache\Temp\codex-clipboard-d3f82484-1bcc-4205-9616-a5fe1c3c276c.png').convert('RGB').resize((1648,682),Image.Resampling.LANCZOS))
geo=json.load(open(P+'\\geometry.json',encoding='utf-8'))
out=np.zeros((N,N,3),dtype=np.uint8);out[:]=[47,42,40];filled=np.zeros((N,N),dtype=bool)
for oi,obj in enumerate(geo):
 verts=np.asarray(obj['vertices'])
 for face in obj['faces']:
  uv=np.asarray(face['uv'],dtype=float);xyz=verts[face['v']]
  if len(uv)!=3:continue
  q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)))
  xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1)
  ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
  if xmax<xmin or ymax<ymin:continue
  a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(den)<1e-8:continue
  xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1))
  wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
  wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
  mask=(wa>=-0.02)&(wb>=-0.02)&(wc>=-0.02)
  if not mask.any():continue
  py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
  shift=0.11*np.clip((-pz-0.12)/0.24,0,1) if oi==1 else 0
  sx=np.clip((2*(5+(1.79-(py-shift))*305)).astype(int),0,1647);sy=np.clip((2*(122+(.17-pz)*292)).astype(int),0,681)
  sampled=ref[sy,sx].copy()
  # Reference background is navy; substitute a neutral local paint when the target silhouette extends beyond it.
  r=sampled[:,:,0].astype(int);g=sampled[:,:,1].astype(int);bcol=sampled[:,:,2].astype(int)
  # Suppress the source image's blue and purple background, including the
  # purple arc visible below the source stock, which is not gun material.
  bg=((r<65)&(g>r+4)&(bcol>g+4))|((r<120)&(bcol>r+3)&(bcol>g+7))
  if oi==0:
   # Fill outside the reference stock's lower silhouette with wood: the
   # target stock is a larger solid shape than the side-view reference.
   refx=sx*.5; refy=sy*.5
   bg |= (py<-.30)&(refy>155+.286*(refx-570))
  if oi==0:
   fallback=np.empty_like(sampled);fallback[:]=[71,67,64]
   wave=np.clip(5*np.sin(py*92+pz*16)+3*np.sin(py*159-pz*14),-9,9)
   wood=np.stack((54+wave,31+wave*.60,26+wave*.50),axis=-1).clip(0,255).astype(np.uint8)
   woodzone=(py<-.30)|((py>.72)&(py<1.27)&(pz<.18))|((py<.08)&(pz<-.07))
   fallback[woodzone]=wood[woodzone]
   fallback[(py>1.30)]=[51,51,49]
  else:
   fallback=np.empty_like(sampled);fallback[:]=[76,70,66]
  sampled[bg]=fallback[bg]
  dest=out[ymin:ymax+1,xmin:xmax+1];dest[mask]=sampled[mask];filled[ymin:ymax+1,xmin:xmax+1]|=mask
for _ in range(3):
 old=filled.copy()
 for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
  source=np.roll(old,(dy,dx),(0,1));take=source&~filled
  out[take]=np.roll(out,(dy,dx),(0,1))[take];filled[take]=True
alpha=Image.open(P+'\\three_vandals\\vandal_original_texture.png').convert('RGBA').getchannel('A').resize((N,N),Image.Resampling.NEAREST);result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(alpha);result.save(P+'\\three_vandals\\vandal_wood_metal_texture.png')
print('Wood metal texture saved; painted pixels:',int(filled.sum()))
