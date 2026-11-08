import json,numpy as np,random
from PIL import Image,ImageDraw,ImageFilter
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\sheriff_skin_work');N=2048;W,H=1600,800
geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'weights.json'));original=Image.open(r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\sheriff\textures\weapon.png').convert('RGBA')
# A dedicated side-plane design avoids projecting another pistol's trigger or silhouette.
x=np.linspace(0,1,W)[None,:,None];y=np.linspace(0,1,H)[:,None,None]
front=np.array([54,168,204])[None,None,:];back=np.array([12,21,60])[None,None,:]
gradient=front*(1-x)**1.6+back*(1-(1-x)**1.6);gradient=np.broadcast_to(gradient,(H,W,3)).copy();gradient*=0.98-0.18*y
canvas=Image.fromarray(np.uint8(np.clip(gradient,0,255)),'RGB')
light=Image.new('L',(W,H));draw=ImageDraw.Draw(light);rng=random.Random(481516)
def bolt(points,width=5):
 allpts=[]
 for (x1,y1),(x2,y2) in zip(points,points[1:]):
  n=max(2,int(abs(x2-x1)/35)); allpts.append((x1,y1))
  for j in range(1,n):
   t=j/n;allpts.append((round(x1+(x2-x1)*t),round(y1+(y2-y1)*t+rng.randint(-15,15))))
 allpts.append(points[-1]);draw.line(allpts,fill=255,width=width*2,joint='curve');return allpts
p1=bolt([(0,95),(260,110),(490,140),(760,155),(1030,180),(1260,125),(1510,170),(1599,140)],5)
p2=bolt([(0,235),(220,215),(400,260),(680,215),(850,300),(1090,250),(1330,300),(1599,250)],6)
bolt([(760,155),(830,95),(970,70),(1120,85)],3);bolt([(490,140),(550,195),(680,215)],3)
bolt([(850,300),(950,365),(1120,355),(1250,450),(1380,495),(1510,675),(1580,730)],5)
bolt([(1120,355),(1210,390),(1340,365),(1450,405)],3);bolt([(1380,495),(1310,580),(1410,640)],3)
bolt([(80,310),(290,315),(410,300),(540,340),(660,325)],2)
glow=light.filter(ImageFilter.GaussianBlur(12));arr=np.array(canvas,dtype=float);g=np.array(glow,dtype=float)/255;core=np.array(light,dtype=float)/255
arr+=g[:,:,None]*np.array([35,90,125]);arr=arr*(1-core[:,:,None])+core[:,:,None]*np.array([220,244,255]);canvas=Image.fromarray(np.uint8(np.clip(arr,0,255)));canvas.save(P/'smite_design_plane.png');ref=np.array(canvas)
orig=np.array(original.resize((N,N),Image.Resampling.NEAREST));out=orig[:,:,:3].copy();filled=np.zeros((N,N),bool);protect=Image.new('1',(N,N));pd=ImageDraw.Draw(protect)
for obj in geo:
 for face in obj['faces']:
  group=[max(weights[obj['name']][str(v)],key=lambda q:q[1])[0] if weights[obj['name']][str(v)] else '' for v in face['v']]
  special=any(g.startswith(('Shell_','Slug_','Primer_')) or g=='Loader' for g in group)
  if special:
   pd.polygon([(round(uv[0]*(N-1)),round((1-uv[1])*(N-1))) for uv in face['uv']],fill=1)
 if 'Magazine' in obj['name']:continue
 verts=np.array(obj['vertices'])
 for face in obj['faces']:
  group=[max(weights[obj['name']][str(v)],key=lambda q:q[1])[0] if weights[obj['name']][str(v)] else '' for v in face['v']]
  if any(g.startswith(('Shell_','Slug_','Primer_')) or g=='Loader' for g in group):continue
  uv=np.array(face['uv']);xyz=verts[face['v']];q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)))
  xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
  if xmax<xmin or ymax<ymin:continue
  a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(den)<1e-9:continue
  xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1));wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
  inside=(wa>=-.01)&(wb>=-.01)&(wc>=-.01)
  if not inside.any():continue
  py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
  sx=np.clip(np.rint((1.492257-py)*1599/1.665073).astype(int),0,W-1);sy=np.clip(np.rint((.277539-pz)*799/.828203).astype(int),0,H-1)
  sample=ref[sy,sx].astype(float);o=orig[ymin:ymax+1,xmin:xmax+1,:3].astype(float);lum=o.mean(axis=2)/255
  # Retain the metal facets from the original UV, while keeping lightning bright.
  shade=.70+.55*lum;boltmask=np.max(sample,axis=2)>190;shade=np.where(boltmask,1.0,shade)
  if all(g=='Grip' for g in group):shade*=.86
  sample=np.uint8(np.clip(sample*shade[:,:,None],0,255));dest=out[ymin:ymax+1,xmin:xmax+1];dest[inside]=sample[inside];filled[ymin:ymax+1,xmin:xmax+1]|=inside
for _ in range(3):
 old=filled.copy()
 for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
  nearby=np.roll(old,(dy,dx),(0,1));take=nearby&~filled;out[take]=np.roll(out,(dy,dx),(0,1))[take];filled[take]=True
keep=np.asarray(protect,dtype=bool);out[keep]=orig[:,:,:3][keep]
res=Image.fromarray(out,'RGB').convert('RGBA');res.putalpha(Image.fromarray(orig[:,:,3]));res.save(P/'sheriff_smite_weapon.png')
print('painted',int(filled.sum()),'protected',int(keep.sum()),'texture',res.size,flush=True)
