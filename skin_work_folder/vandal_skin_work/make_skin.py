import json, math
import numpy as np
from PIL import Image, ImageDraw
P=r'D:\Projects\Mine_VALORANT\skin_work_folder\vandal_skin_work'
N=2048; W=2048; H=800
# Orthographic design, in the model's unposed Y/Z coordinates.
def pt(y,z): return ((1.85-y)/2.8*(W-1),(.47-z)/1.02*(H-1))
def poly(draw,points,fill): draw.polygon([pt(*p) for p in points],fill=fill)
def line(draw,points,fill,width=4): draw.line([pt(*p) for p in points],fill=fill,width=width,joint='curve')
body=Image.new('RGB',(W,H),'#20212b');d=ImageDraw.Draw(body)
# Main charcoal body, broad inset panels and highlights.
poly(d,[(1.9,.4),(-1,.4),(-1,-.5),(1.9,-.5)],'#1b1c25')
poly(d,[(1.30,.30),(.38,.30),(.29,.21),(.49,.17),(1.26,.19)],'#ecedf3')
poly(d,[(1.27,.285),(.47,.285),(.39,.235),(.49,.222),(1.24,.224)],'#f8f8ff')
poly(d,[(1.20,.267),(.86,.267),(.75,.237),(1.15,.237)],'#4b4a59')
poly(d,[(1.14,.258),(.88,.258),(.82,.248),(1.12,.248)],'#dedee9')
poly(d,[(1.27,.19),(.47,.19),(.31,.12),(.47,.055),(1.26,.075)],'#3c1859')
poly(d,[(1.23,.177),(.64,.177),(.46,.12),(1.24,.106)],'#572274')
poly(d,[(1.24,.117),(.52,.115),(.43,.082),(1.25,.079)],'#38124e')
line(d,[(1.28,.199),(.43,.199),(.34,.208)],'#f6cc45',7)
line(d,[(1.25,.187),(.46,.187)],'#9e7924',3)
# Muzzle and front sights.
poly(d,[(1.88,.25),(1.28,.25),(1.28,.08),(1.88,.08)],'#ba8b23')
line(d,[(1.85,.21),(1.35,.21),(1.25,.29)],'#ffe16a',11)
line(d,[(1.8,.16),(1.35,.16)],'#7e5617',6)
line(d,[(1.39,.19),(1.34,.30),(1.31,.36)],'#f5d44f',8)
# Receiver, sharp stepped upper gold piping.
poly(d,[(.42,.30),(-.10,.30),(-.19,.24),(-.84,.24),(-.84,.09),(-.13,.06),(.10,.11),(.30,.12)],'#26272e')
poly(d,[(.39,.30),(.28,.33),(.05,.33),(-.05,.30)],'#7f641e')
line(d,[(.42,.30),(.32,.335),(.12,.335),(.07,.315),(-.03,.30),(-.20,.25),(-.84,.25)],'#f7d64d',8)
line(d,[(.40,.285),(.30,.309),(.09,.308),(.02,.282),(-.22,.235),(-.84,.235)],'#6f521a',3)
poly(d,[(.28,.276),(.09,.276),(.06,.25),(.29,.25)],'#0e1019')
line(d,[(.29,.278),(.06,.278),(.03,.248),(.27,.248),(.29,.278)],'#e5bb3a',5)
poly(d,[(.03,.278),(-.12,.278),(-.18,.24),(.02,.24)],'#131722')
line(d,[(.03,.278),(-.12,.278),(-.18,.24),(.02,.24),(.03,.278)],'#f4d452',5)
line(d,[(.02,.25),(-.84,.22)],'#5b5b66',3)
# Lower receiver, trigger housing and dark grip.
poly(d,[(.36,.14),(.13,.12),(.02,.06),(-.1,.07),(-.22,.12),(-.30,.08),(-.25,-.03),(.14,-.07),(.34,.01)],'#202129')
line(d,[(.37,.02),(.31,-.03),(.22,-.08),(.09,-.08),(.02,-.035)],'#d0a52e',7)
line(d,[(.34,.015),(.28,-.043),(.22,-.061),(.11,-.061)],'#6d4d12',3)
poly(d,[(.1,.06),(-.02,.08),(-.18,-.03),(-.22,-.25),(-.11,-.33),(.02,-.24),(.03,-.07)],'#15161b')
line(d,[(-.11,-.30),(-.22,-.26),(-.20,-.22)],'#e6bb42',8)
line(d,[(.08,.045),(.015,.045),(-.06,-.02)],'#78602a',4)
# Stock: black field with the reference's skeletal gold triangle, drawn as surface detail.
poly(d,[(-.26,.18),(-.85,.19),(-.88,-.19),(-.58,-.20),(-.36,.03)],'#202027')
poly(d,[(-.36,.115),(-.74,.12),(-.82,-.13),(-.62,-.12)],'#0b0d13')
line(d,[(-.35,.125),(-.75,.13),(-.82,-.13),(-.62,-.12),(-.35,.125)],'#dbad2c',9)
line(d,[(-.42,.115),(-.67,-.10),(-.57,.12),(-.78,-.10)],'#e5b632',7)
line(d,[(-.77,.16),(-.86,.16),(-.86,-.17)],'#e9e8ed',9)
line(d,[(-.25,.18),(-.84,.18)],'#44434c',4)
# White magazine with low-poly grey facets and gold end cap.
mag=Image.new('RGB',(W,H),'#e9ebf4');m=ImageDraw.Draw(mag)
poly(m,[(1.9,.5),(-1,.5),(-1,-.6),(1.9,-.6)],'#e8eaf4')
poly(m,[(.91,.12),(.79,-.22),(.58,-.42),(.45,-.44),(.55,-.24),(.68,.11)],'#f7f8ff')
poly(m,[(.79,-.23),(.59,-.41),(.45,-.45),(.52,-.32),(.70,-.17)],'#d6d9e8')
poly(m,[(.90,-.22),(.78,-.34),(.64,-.43),(.52,-.45),(.65,-.36)],'#c3c8dc')
line(m,[(.88,-.30),(.92,-.36),(.86,-.42),(.76,-.44)],'#d8ad34',8)
line(m,[(.82,.16),(.65,.16)],'#f7d754',8)
body_np=np.asarray(body);mag_np=np.asarray(mag)
geo=json.load(open(P+'\\geometry.json',encoding='utf-8'))
out=np.zeros((N,N,3),dtype=np.uint8);out[:]=[24,25,32];filled=np.zeros((N,N),dtype=bool)
for oi,obj in enumerate(geo):
 verts=np.asarray(obj['vertices']); design=body_np if oi==0 else mag_np
 for face in obj['faces']:
  uv=np.asarray(face['uv'],dtype=float); xyz=verts[face['v']]
  if len(uv)!=3: continue
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
  sx=np.clip(((1.85-py)/2.8*(W-1)).astype(int),0,W-1);sy=np.clip(((.47-pz)/1.02*(H-1)).astype(int),0,H-1)
  # Gentle directional shading adds depth without changing the painted palette.
  normal=np.cross(xyz[1]-xyz[0],xyz[2]-xyz[0]);norm=np.linalg.norm(normal)
  shade=1.0 if norm<1e-12 else (0.84+0.16*abs(normal[0]/norm))
  sampled=np.clip(design[sy,sx].astype(float)*shade,0,255).astype(np.uint8)
  dest=out[ymin:ymax+1,xmin:xmax+1];dest[mask]=sampled[mask];filled[ymin:ymax+1,xmin:xmax+1]|=mask
# Bleed islands to reduce filtering seams, without altering painted texels.
for _ in range(3):
 old=filled.copy()
 for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
  source=np.roll(old,(dy,dx),(0,1));take=source & ~filled
  out[take]=np.roll(out,(dy,dx),(0,1))[take];filled[take]=True
Image.fromarray(out,'RGB').save(P+'\\vandal_royal_texture.png')
body.save(P+'\\design_body.png');mag.save(P+'\\design_magazine.png')
print('Wrote texture, occupied pixels:',filled.sum())
