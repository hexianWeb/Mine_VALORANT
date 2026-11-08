import json,numpy as np
from PIL import Image,ImageDraw,ImageFilter
from pathlib import Path
P=Path(r'D:\Projects\Mine_VALORANT\skin_work_folder\classic_skin_work');N=2048;geo=json.load(open(P/'geometry.json'));weights=json.load(open(P/'weights.json'));source=Image.open(r'D:\Projects\vandal-roundtrip\valorant-first-person-pack\classic\textures\weapon.png').convert('RGBA').resize((N,N),Image.Resampling.NEAREST);original=np.array(source);magmask=Image.new('L',(N,N));bodymask=Image.new('L',(N,N));bulletmask=Image.new('L',(N,N));md=ImageDraw.Draw(magmask);bd=ImageDraw.Draw(bodymask);ud=ImageDraw.Draw(bulletmask)
for obj in geo:
 for face in obj['faces']:
  gs=[max(weights[obj['name']][str(v)],key=lambda q:q[1])[0] if weights[obj['name']][str(v)] else '' for v in face['v']];q=[(round(u[0]*2047),round((1-u[1])*2047)) for u in face['uv']]
  if any(g.startswith('bullet') for g in gs):ud.polygon(q,fill=255)
  elif 'Body' in obj['name']:bd.polygon(q,fill=255)
  elif all(g=='mag_standard' for g in gs):md.polygon(q,fill=255)
mag=np.array(magmask.filter(ImageFilter.MaxFilter(5)))>0;body=np.array(bodymask.filter(ImageFilter.MaxFilter(3)))>0;bullet=np.array(bulletmask.filter(ImageFilter.MaxFilter(3)))>0;paint=mag&~body&~bullet
print('mask',int(mag.sum()),'protect',int((mag&(body|bullet)).sum()),'paint',int(paint.sum()))
lum=original[:,:,:3].astype(float).mean(axis=2);shade=.65+.6*np.clip(lum/72,0,1)
for skin,color in [('edg',(48,31,38)),('smite',(27,37,58)),('blackmarket',(52,53,45)),('sakura',(57,59,63))]:
 arr=np.array(Image.open(P/('classic_'+skin+'_weapon.png')).convert('RGBA'));RGB=np.clip(shade[:,:,None]*np.array(color),0,255).astype('uint8');arr[paint,:3]=RGB[paint];Image.fromarray(arr,'RGBA').save(P/('classic_'+skin+'_weapon_magfix.png'));print(skin,'magfix done',flush=True)
