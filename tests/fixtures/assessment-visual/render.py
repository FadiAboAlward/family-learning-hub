from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
root=Path(__file__).resolve().parent
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
f=ImageFont.truetype(font,28)
blue='#115b85';orange='#9d4300'
spec={'rectangle':{'width':600,'height':360,'vertices':[[160,100],[400,100],[400,260],[160,260]],'unit_pixels':40,'side_cm':[6,4]},'triangle':{'width':600,'height':360,'vertices':[[160,260],[400,260],[160,100]],'unit_pixels':40,'base_cm':6,'height_cm':4},'composite':{'width':720,'height':480,'panels':{'A':[[90,165],[230,165],[90,45]],'B':[[450,165],[590,165],[550,65]],'C':[[90,405],[230,405],[30,315]],'D':[[450,405],[590,405],[310,405]]},'correct_label':'A'}}
for name,s in spec.items():
 im=Image.new('RGB',(s['width'],s['height']),'white');d=ImageDraw.Draw(im)
 if name=='rectangle':
  d.polygon([tuple(x) for x in s['vertices']],outline=blue,width=4);d.text((235,52),'6 cm',font=f,fill='black');d.text((420,160),'4 cm',font=f,fill='black')
 elif name=='triangle':
  d.polygon([tuple(x) for x in s['vertices']],outline=orange,width=4);d.line([(160,240),(180,240),(180,260)],fill=orange,width=3);d.text((238,280),'6 cm',font=f,fill='black');d.text((60,160),'4 cm',font=f,fill='black')
 else:
  d.line([(360,0),(360,480)],fill='#b0b0b0',width=2);d.line([(0,240),(720,240)],fill='#b0b0b0',width=2)
  # Use independent panels with vectors meeting at the first listed point.
  # C's left endpoint stays inside its own panel; D represents a straight angle.
  for label,pts in s['panels'].items():
   o,a,b=map(tuple,pts);d.line([a,o,b],fill=blue,width=4);x=(ord(label)-65)%2*360+16;y=(ord(label)-65)//2*240+12;d.text((x,y),label,font=f,fill='black')
 im.save(root/(name+'.png'))
 if name=='rectangle':im.save(root/'rectangle.jpg',quality=95);im.save(root/'rectangle.webp',lossless=True)
(root/'geometry-source.json').write_text(json.dumps(spec,indent=2)+'\n')
