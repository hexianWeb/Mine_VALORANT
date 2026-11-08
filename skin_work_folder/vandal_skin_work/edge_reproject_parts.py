import json, numpy as np
from PIL import Image,ImageDraw,ImageFilter
from pathlib import Path
p=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\vandal_skin_work'); outdir=p/'three_vandals'; geo=json.load(open(p/'geometry.json',encoding='utf8'))
N=2048; S=600; W=1740; H=620
def target_pt(v):return ((1.85-v[1])*S,(.47-v[2])*S)
base=[]
for oi,ob in enumerate(geo):
 im=Image.new('L',(W,H));d=ImageDraw.Draw(im);vs=np.asarray(ob['vertices'])
 for face in ob['faces']:
  d.polygon([target_pt(vs[i]) for i in face['v']],fill=255)
 base.append(np.array(im)>0)
yy,xx=np.indices((H,W));Y=1.85-xx/S;Z=.47-yy/S
masks={'mag':base[1], 'stock':base[0]&(Y<-.34), 'grip':base[0]&(Y>-.22)&(Y<.025)&(Z<-.05)}
def ranges(mask):
 rows=np.where(mask.any(axis=1))[0]
 if len(rows)==0:raise RuntimeError('empty mask')
 left=np.argmax(mask,axis=1);right=mask.shape[1]-1-np.argmax(mask[:,::-1],axis=1)
 return rows[0],rows[-1],left,right,mask.any(axis=1)
T={k:ranges(v) for k,v in masks.items()}
configs={'sakura':{'ref':p/'sakura_reference_playerassist.jpg','in':outdir/'vandal_sakura_texture.png','out':outdir/'vandal_sakura_edge_fixed.png','polys':{'mag':[(900,330),(1025,345),(1012,390),(969,485),(909,561),(831,646),(759,543),(821,486),(870,432)],'grip':[(1180,327),(1265,325),(1260,382),(1320,482),(1329,505),(1237,542),(1232,490),(1215,440),(1183,404)],'stock':[(1273,236),(1725,236),(1725,471),(1590,471),(1534,418),(1490,380),(1454,344),(1395,322),(1285,302)]}}}
configs['smite']={'ref':p/'smite_reference.jpg','in':outdir/'vandal_smite_texture.png','out':outdir/'vandal_smite_edge_fixed.png','polys':{'mag':[(913,465),(1020,478),(1001,549),(968,620),(916,697),(821,807),(739,690),(810,621),(864,555)],'grip':[(1200,444),(1295,440),(1292,482),(1335,549),(1367,645),(1264,691),(1259,635),(1235,575),(1210,541),(1191,517)],'stock':[(1290,354),(1807,354),(1807,611),(1618,611),(1560,557),(1510,510),(1455,457),(1295,433)]}}
configs['wood']={'ref':Path(r'D:\dev-cache\Temp\codex-clipboard-d3f82484-1bcc-4205-9616-a5fe1c3c276c.png'),'in':outdir/'vandal_wood_metal_texture.png','out':outdir/'vandal_wood_metal_edge_fixed.png','polys':{'mag':[(383,151),(458,151),(449,180),(432,213),(402,253),(349,315),(315,266),(345,239),(370,201)],'grip':[(548,146),(572,150),(570,172),(596,203),(611,229),(610,241),(574,254),(565,228),(551,191),(538,170)],'stock':[(569,103),(820,102),(819,221),(796,222),(770,217),(735,207),(684,188),(645,165),(620,149),(590,143),(571,145)]}}

def make(key):
 cfg=configs[key];ref=np.array(Image.open(cfg['ref']).convert('RGB')); h,w=ref.shape[:2]
 source={}
 for k,poly in cfg['polys'].items():
  mask=Image.new('L',(w,h));ImageDraw.Draw(mask).polygon(poly,fill=255)
  mask=np.array(mask.filter(ImageFilter.MinFilter(3)))>0
  r,g,b=[ref[:,:,i].astype(int) for i in range(3)]
  # Eliminate the dark blue backdrop from polygons without masking gray or black paint.
  bg=(r<75)&(g>r+6)&(b>g+5)
  
  if key != "smite": mask &= ~bg
  source[k]=ranges(mask)
 # The black-market reference has a blue/purple backdrop under the stock.
 # Extend actual nearby warm wood within each source scanline over backdrop pixels.
 wood_ref = ref.copy()
 if key == 'wood':
  sr0,sr1,left,right,validrows=source['stock']
  warm_by_row=[]
  rr,gg,bb=[ref[:,:,i].astype(int) for i in range(3)]
  for y in range(h):
   lo,hi=int(left[y]),int(right[y])
   indices=np.arange(max(0,lo),min(w-1,hi)+1) if sr0<=y<=sr1 and validrows[y] else np.array([],dtype=int)
   wood=indices[(rr[y,indices]>gg[y,indices]+2)&(rr[y,indices]>bb[y,indices]+3)&(rr[y,indices]>32)]
   warm_by_row.append(wood)
  good_rows=np.array([y for y in range(sr0,sr1+1) if len(warm_by_row[y])])
  for y in range(sr0,sr1+1):
   if not validrows[y]:continue
   lo,hi=int(left[y]),int(right[y]);xx=np.arange(lo,hi+1)
   bad=((bb[y,xx]>rr[y,xx]+1)&(bb[y,xx]>gg[y,xx]+2))|((rr[y,xx]<65)&(gg[y,xx]>rr[y,xx]+4)&(bb[y,xx]>gg[y,xx]+4))
   xs=xx[bad]
   if not len(xs):continue
   near_y=int(good_rows[np.argmin(abs(good_rows-y))]);candidates=warm_by_row[near_y]
   i=np.searchsorted(candidates,xs);l=candidates[np.clip(i-1,0,len(candidates)-1)];r=candidates[np.clip(i,0,len(candidates)-1)]
   nearest=np.where(abs(xs-l)<=abs(xs-r),l,r);wood_ref[y,xs]=ref[near_y,nearest]
 old=Image.open(cfg['in']).convert('RGBA');out=np.array(old.convert('RGB'));modified=np.zeros((N,N),dtype=bool)
 for oi,ob in enumerate(geo):
  verts=np.asarray(ob['vertices']);
  for face in ob['faces']:
   uv=np.asarray(face['uv'],dtype=float); xyz=verts[face['v']]
   if len(uv)!=3:continue
   q=np.column_stack((uv[:,0]*(N-1),(1-uv[:,1])*(N-1)));xmin=max(0,int(np.floor(q[:,0].min()))-1);xmax=min(N-1,int(np.ceil(q[:,0].max()))+1);ymin=max(0,int(np.floor(q[:,1].min()))-1);ymax=min(N-1,int(np.ceil(q[:,1].max()))+1)
   if xmax<xmin or ymax<ymin:continue
   a,b,c=q;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
   if abs(den)<1e-8:continue
   xx,yy=np.meshgrid(np.arange(xmin,xmax+1),np.arange(ymin,ymax+1));wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;wc=1-wa-wb
   tri=(wa>=-0.02)&(wb>=-0.02)&(wc>=-0.02)
   if not tri.any():continue
   py=wa*xyz[0,1]+wb*xyz[1,1]+wc*xyz[2,1];pz=wa*xyz[0,2]+wb*xyz[1,2]+wc*xyz[2,2]
   for k in (['mag'] if oi==1 else ['stock','grip']):
    if k=='mag':sel=tri
    elif k=='stock':sel=tri&(py<-.34)
    else:sel=tri&(py>-.22)&(py<.025)&(pz<-.05)
    if not sel.any():continue
    tr0,tr1,tleft,tright,tvalid=T[k]; sr0,sr1,sleft,sright,svalid=source[k]
    ty=np.clip(np.rint((.47-pz)*S).astype(int),tr0,tr1);tx=(1.85-py)*S
    frac=np.clip((tx-tleft[ty])/np.maximum(tright[ty]-tleft[ty],1),0,1)
    sy=np.clip(np.rint(sr0+(ty-tr0)/max(tr1-tr0,1)*(sr1-sr0)).astype(int),sr0,sr1)
    sx=np.clip(np.rint(sleft[sy]+frac*(sright[sy]-sleft[sy])).astype(int),0,w-1)
    sel &= tvalid[ty]&svalid[sy]
    dest=out[ymin:ymax+1,xmin:xmax+1];dest[sel]=(wood_ref if key=='wood' and k=='stock' else ref)[sy,sx][sel];modified[ymin:ymax+1,xmin:xmax+1]|=sel
 result=Image.fromarray(out,'RGB').convert('RGBA');result.putalpha(old.getchannel('A'));result.save(cfg['out']);print(key,cfg['out'],int(modified.sum()))
 print('target ranges',{k:(v[0],v[1]) for k,v in T.items()});print('source ranges',{k:(v[0],v[1]) for k,v in source.items()})
import sys
for key in sys.argv[1:]:make(key)
