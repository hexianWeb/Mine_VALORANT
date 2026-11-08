import json,numpy as np
from PIL import Image,ImageDraw,ImageFilter
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\classic_skin_work');N=2048;geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'weights.json'));front=Image.new('L',(N,N));draw=ImageDraw.Draw(front)
obj=next(o for o in geo if 'Body' in o['name']);verts=np.array(obj['vertices'])
for face in obj['faces']:
 xyz=verts[face['v']];n=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);l=np.linalg.norm(n)
 if l and n[0]/l<-.4:draw.polygon([(round(u[0]*2047),round((1-u[1])*2047)) for u in face['uv']],fill=255)
frontmask=np.array(front.filter(ImageFilter.MaxFilter(3)))>0
bullet=Image.new('L',(N,N));d=ImageDraw.Draw(bullet)
for ob in geo:
 for face in ob['faces']:
  gs=[max(weights[ob['name']][str(v)],key=lambda q:q[1])[0] if weights[ob['name']][str(v)] else '' for v in face['v']]
  if any(g.startswith('bullet') for g in gs):d.polygon([(round(u[0]*2047),round((1-u[1])*2047)) for u in face['uv']],fill=255)
protect=np.array(bullet)>0
for skin,cx,cy,rx,ry in [('ag',364,34,38,34),('blg',362,37,53,28)]:
 arr=np.array(Image.open(P/('classic_'+skin+'_weapon_magfix.png')).convert('RGBA'));image=Image.open(P/(skin+'_reference.png')).convert('RGBA');ref=np.array(image);h,w=ref.shape[:2];x0,y0,x1,y1=image.getchannel('A').getbbox();count=0;skipped=0
 for face in obj['faces']:
  xyz=verts[face['v']];n=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);l=np.linalg.norm(n)
  if not l or n[0]/l<=.4:continue
  uv=np.array(face['uv']);q=np.column_stack((uv[:,0]*2047,(1-uv[:,1])*2047));xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(2047,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(2047,int(np.ceil(q[:,1].max()))+1)
  if xmax<xmin or ymax<ymin:continue
  a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(den)<1e-9:continue
  xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1));wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
  inside=(wa>=-.01)&(wb>=-.01)&(wc>=-.01);py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
  sx=np.clip(np.rint(x0+(.571937501-py)*(x1-x0-1)/.992857128).astype(int),0,w-1);sy=np.clip(np.rint(y0+(.273247659-pz)*(y1-y0-1)/.680584937).astype(int),0,h-1)
  targeted=inside&(((sx-cx)/rx)**2+((sy-cy)/ry)**2<=1);blocked=frontmask[ymin:ymax+1,xmin:xmax+1]|protect[ymin:ymax+1,xmin:xmax+1];skipped+=int((targeted&blocked).sum());take=targeted&~blocked
  if take.any():
   dst=arr[ymin:ymax+1,xmin:xmax+1,:3];sample=ref[sy,np.clip(2*cx-sx,0,w-1),:3];dst[take]=sample[take];count+=int(take.sum())
 Image.fromarray(arr,'RGBA').save(P/('classic_'+skin+'_weapon_magfix_logofix.png'));print(skin,'logo pixels',count,'blocked',skipped,flush=True)
