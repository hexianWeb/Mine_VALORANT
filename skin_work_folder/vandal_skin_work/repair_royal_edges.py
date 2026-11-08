from PIL import Image,ImageDraw
import numpy as np,json
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\vandal_skin_work');D=P/'three_vandals';N=2048
geo=json.loads((P/'geometry.json').read_text());old=Image.open(D/'vandal_royal_gold_alpha.png').convert('RGBA');alpha=old.getchannel('A');out=np.array(old.convert('RGB'));body=np.asarray(Image.open(P/'design_body.png').convert('RGB'));H,W=body.shape[:2]
def proj(verts): return [(84+(1.79-v[1])*732,352+(.17-v[2])*732) for v in verts]
alpha0=np.asarray(Image.open(D/'vandal_original_texture.png').convert('RGBA'))[:,:,3]
masks=[]
for obj in geo:
 im=Image.new('L',(2048,1024));d=ImageDraw.Draw(im)
 for f in obj['faces']:
  u,v=np.asarray(f['uv']).mean(axis=0);a=alpha0[min(255,max(0,int((1-v)*255))),min(255,max(0,int(u*255)))]
  if a<12:continue
  d.polygon(proj([obj['vertices'][i] for i in f['v']]),fill=255)
 masks.append(np.asarray(im)>0)
def artwork_mask(points):
 im=Image.new('L',(2048,1024));d=ImageDraw.Draw(im);d.polygon(proj([(0,y,z) for y,z in points]),fill=255);return np.asarray(im)>0
src_stock=artwork_mask([(-.26,.18),(-.85,.19),(-.88,-.19),(-.58,-.20),(-.36,.03)])
src_grip=artwork_mask([(.1,.06),(-.02,.08),(-.18,-.03),(-.22,-.25),(-.11,-.33),(.02,-.24),(.03,-.07)])
def bounds(tmask,smask,x0,x1):
 ta=np.full((1024,2),-1,float);sa=np.full((1024,2),-1,float);srow=np.arange(1024)
 for yy in range(1024):
  ti=np.flatnonzero(tmask[yy,x0:x1]);si=np.flatnonzero(smask[yy,x0:x1]);
  if len(ti)>2:ta[yy]=[ti[0]+x0,ti[-1]+x0]
  if len(si)>2:sa[yy]=[si[0]+x0,si[-1]+x0]
 valid=np.flatnonzero(sa[:,0]>=0)
 for yy in range(1024):
  if sa[yy,0]<0 and len(valid):
   k=valid[np.argmin(np.abs(valid-yy))];sa[yy]=sa[k];srow[yy]=k
 return ta,sa,srow
stock_t,stock_s,stock_y=bounds(masks[0],src_stock,1580,2048);grip_t,grip_s,grip_y=bounds(masks[0],src_grip,1345,1580)
for oi,obj in enumerate(geo):
 verts=np.asarray(obj['vertices'])
 for face in obj['faces']:
  uv=np.asarray(face['uv'],float);xyz=verts[face['v']]
  if len(uv)!=3:continue
  q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)));xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
  if xmax<xmin or ymax<ymin:continue
  a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(den)<1e-8:continue
  xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1));wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb;mask=(wa>=-.02)&(wb>=-.02)&(wc>=-.02)
  if not mask.any():continue
  py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2];sx=84+(1.79-py)*732;sy=np.clip((352+(.17-pz)*732).astype(int),0,1023);dest=out[ymin:ymax+1,xmin:xmax+1]
  if oi==0:
   for which,ts,ss,srow in [(mask&(py<.04)&(py>-.25)&(pz<-.05),grip_t,grip_s,grip_y),(mask&(py<-.38)&(pz<.06),stock_t,stock_s,stock_y)]:
    which &= (ts[sy,0]>=0)&(ts[sy,1]>ts[sy,0])&(ss[sy,0]>=0)&(ss[sy,1]>ss[sy,0])
    if not which.any():continue
    t=np.clip((sx-ts[sy,0])/np.maximum(ts[sy,1]-ts[sy,0],1),0,1);newx=ss[sy,0]+t*(ss[sy,1]-ss[sy,0]);mapped_y=1.79-(newx-84)/732;mapped_z=.17-(srow[sy]-352)/732
    ax=np.clip(((1.85-mapped_y)/2.8*(W-1)).astype(int),0,W-1);ay=np.clip(((.47-mapped_z)/1.02*(H-1)).astype(int),0,H-1);sample=body[ay,ax];dest[which]=sample[which]
  else:
   s=.75*py-.66*pz;near=mask&(pz<-.25);rgb=dest.astype(int);old_gold=(rgb[:,:,0]>95)&(rgb[:,:,1]>65)&(rgb[:,:,0]>rgb[:,:,2]*1.2)&(rgb[:,:,1]>rgb[:,:,2]*1.07)
   dest[near & old_gold & (py>.60)]=[216,219,231]
   d=1.008+.428*pz-py
   band=(wa>=-.10)&(wb>=-.10)&(wc>=-.10)&(pz<=-.295)&(pz>=-.49)&(d>=-.010)&(d<=.030);dest[band]=[213,171,67]
result=Image.fromarray(out).convert('RGBA');result.putalpha(alpha);result.save(D/'vandal_royal_gold_edge_fixed.png');print('Royal saved',D/'vandal_royal_gold_edge_fixed.png')
