from PIL import Image,ImageDraw
import numpy as np,json
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\vandal_skin_work');D=P/'three_vandals'; N=2048
geo=json.loads((P/'geometry.json').read_text());image=Image.open(D/'vandal_ego_mag_adjusted.png').convert('RGBA');alpha=image.getchannel('A');out=np.array(image.convert('RGB'))
ref=np.asarray(Image.open(P/'ego_reference.jpg').convert('RGB').resize((2048,1024),Image.Resampling.LANCZOS));r=ref.astype(np.int16);fg=~((r[:,:,0]<43)&(r[:,:,1]<58)&(r[:,:,2]<85)&(r[:,:,2]>r[:,:,0]+9)&(r[:,:,2]>r[:,:,1]+5))
def proj(verts): return [(84+(1.79-v[1])*732,352+(.17-v[2])*732) for v in verts]
alpha0=np.asarray(Image.open(D/'vandal_original_texture.png').convert('RGBA'))[:,:,3]
masks=[]
for obj in geo:
 img=Image.new('L',(2048,1024));d=ImageDraw.Draw(img)
 for f in obj['faces']:
  uv=np.asarray(f['uv']);u,v=uv.mean(axis=0);a=alpha0[min(255,max(0,int((1-v)*255))),min(255,max(0,int(u*255)))]
  if a<12:continue
  d.polygon(proj([obj['vertices'][i] for i in f['v']]), fill=255)
 masks.append(np.asarray(img)>0)
def runs(mask,x0,x1):
 s=mask[x0:x1].astype(int);d=np.diff(np.r_[0,s,0]);starts=np.flatnonzero(d==1);ends=np.flatnonzero(d==-1)-1
 if len(starts)==0:return None
 i=np.argmax(ends-starts);return int(starts[i]+x0),int(ends[i]+x0)
def bounds(tmask,x0,x1,rx0,rx1,minlen=5):
 ta=np.full((1024,2),-1,dtype=np.float64);sa=np.full((1024,2),-1,dtype=np.float64)
 for yy in range(1024):
  ix=np.flatnonzero(tmask[yy,x0:x1]);a=runs(fg[yy],rx0,rx1)
  if len(ix)>2:ta[yy]=[ix[0]+x0,ix[-1]+x0]
  if a and a[1]-a[0]>=minlen:sa[yy]=a
 valid=np.flatnonzero(sa[:,0]>=0)
 for yy in range(1024):
  if sa[yy,0]<0 and len(valid):sa[yy]=sa[valid[np.argmin(np.abs(valid-yy))]]
 return ta,sa
mag_t,mag_s=bounds(masks[1],690,1200,690,1160,12)
grip_t,grip_s=bounds(masks[0],1345,1580,1345,1570,12)
stock_t,stock_s=bounds(masks[0],1580,2048,1580,2048,40)
for oi,obj in enumerate(geo):
 verts=np.asarray(obj['vertices'])
 for face in obj['faces']:
  uv=np.asarray(face['uv'],float);xyz=verts[face['v']]
  if len(uv)!=3:continue
  q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)));xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
  if xmax<xmin or ymax<ymin:continue
  a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(den)<1e-8:continue
  xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1));wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb;mask=(wa>=-0.02)&(wb>=-0.02)&(wc>=-0.02)
  if not mask.any():continue
  py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2];sx=84+(1.79-py)*732;sy=np.clip((352+(.17-pz)*732).astype(int),0,1023)
  selections=([(mask&(pz<.02),mag_t,mag_s)] if oi==1 else [(mask&(py<.04)&(py>-.25)&(pz<-.05),grip_t,grip_s),(mask&(py<-.38)&(pz<.06),stock_t,stock_s)])
  for which,ts,ss in selections:
   which &= (ts[sy,0]>=0)&(ts[sy,1]>ts[sy,0])&(ss[sy,0]>=0)&(ss[sy,1]>ss[sy,0])
   if not which.any():continue
   t=np.clip((sx-ts[sy,0])/np.maximum(ts[sy,1]-ts[sy,0],1),0,1);newx=np.clip((ss[sy,0]+t*(ss[sy,1]-ss[sy,0])).astype(int),0,2047)
   sampled=ref[sy,newx].copy()
   dest=out[ymin:ymax+1,xmin:xmax+1];dest[which]=sampled[which]
  if oi==1:
   dest=out[ymin:ymax+1,xmin:xmax+1]
   rr=dest[:,:,0].astype(int);gg=dest[:,:,1].astype(int);bb=dest[:,:,2].astype(int)
   gold=(rr>100)&(gg>65)&(rr>bb*1.20)&(gg>bb*1.07)
   near=mask&(pz<-.27)&(py>.60)
   dest[near&gold]=[36,36,39]
   # Bottom seam follows actual diagonal edge from (.88,-.30) to (.80,-.487).
   d=1.008+.428*pz-py
   band=(wa>=-.10)&(wb>=-.10)&(wc>=-.10)&(pz<=-.295)&(pz>=-.49)&(d>=-.010)&(d<=.030)
   dest[band]=[205,159,69]
result=Image.fromarray(out).convert('RGBA');result.putalpha(alpha);result.save(D/'vandal_ego_edge_fixed.png');print('EGO saved',D/'vandal_ego_edge_fixed.png')
