import json
import numpy as np
from PIL import Image
P=r'D:\Projects\Mine_VALORANT\skin_work_folder\vandal_skin_work'
N=2048
ref=np.asarray(Image.open(P+'\\ego_reference.jpg').convert('RGB').resize((2048,1024),Image.Resampling.LANCZOS))
geo=json.load(open(P+'\\geometry.json',encoding='utf-8'))
old=Image.open(P+'\\vandal_ego_texture.png').convert('RGBA'); out=np.array(old.convert('RGB'));filled=np.zeros((N,N),dtype=bool)
for oi,obj in enumerate(geo):
 if oi != 1: continue
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
  shift=0.12*np.clip((-pz-0.12)/0.24,0,1)
  sx=np.clip((84+(1.79-(py-shift))*732).astype(int),0,2047);sy=np.clip((352+(.17-pz)*732).astype(int),0,1023)
  sampled=ref[sy,sx].copy()
  # Reference background is navy; substitute a neutral local paint when the target silhouette extends beyond it.
  r=sampled[:,:,0].astype(int);g=sampled[:,:,1].astype(int);bcol=sampled[:,:,2].astype(int)
  bg=(r<43)&(g<58)&(bcol<85)&(bcol>r+9)&(bcol>g+5)
  if oi==0:
   fallback=np.empty_like(sampled);fallback[:]=[195,196,199]
   fallback[py<-.38]=[37,37,39]
   fallback[(py>1.40)&(pz<.24)]=[191,145,44]
   fallback[(py<.02)&(pz<-.12)]=[32,32,35]
  else:
   fallback=np.empty_like(sampled);fallback[:]=[206,207,209]
   fallback[pz<-.20]=[38,38,41]
  sampled[bg]=fallback[bg]
  dest=out[ymin:ymax+1,xmin:xmax+1];dest[mask]=sampled[mask];filled[ymin:ymax+1,xmin:xmax+1]|=mask
result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(old.getchannel('A'));result.save(P+'\\three_vandals\\vandal_ego_mag_adjusted.png')
print('EGO texture saved; painted pixels:',int(filled.sum()))
