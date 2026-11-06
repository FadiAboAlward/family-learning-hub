import fs from 'node:fs';
import crypto from 'node:crypto';
export const workspace='55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
export const version='04410000-0000-4000-8000-000000000004';
const root=new URL('./',import.meta.url);
export function diagram(name,position=1,v=version){
  const dimensions=name==='composite'?[720,480]:[600,360],bytes=fs.readFileSync(new URL(name+'.png',root));
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  return {asset_id:'04410000-0000-4000-8000-'+({rectangle:'000000000101',triangle:'000000000102',composite:'000000000103'}[name]),position,purpose:'prompt',label:name==='rectangle'?'Dikdörtgen':name==='triangle'?'Üçgen':'A / B / C / D',alt_text:name==='rectangle'?'Bir dikdörtgenin kenarları 6 cm ve 4 cm olarak verilmiştir.':name==='triangle'?'Dik üçgenin tabanı 6 cm, tabana dik yüksekliği 4 cm olarak verilmiştir.':'Her panelde ortak başlangıç nokta ile gösterilir. A: sağa yatay ve yukarı düşey; B: sağa yatay ve sağ yukarı eğik; C: sağa yatay ve sol yukarı eğik; D: sağa ve sola yatay parçalar.',required:true,mime_type:'image/png',width:dimensions[0],height:dimensions[1],checksum_sha256:sha,storage_bucket:'assessment-assets',storage_path:workspace+'/'+v+'/'+sha+'.png',provenance:{origin:'generated',rights_status:'owned',source_ref:'synthetic:geometry-source.json#'+name}};
}
const teaching=[
 ['Şekilde hangi uzunlukların verildiğini belirle ve her birinin neyi ölçtüğünü kendi sözcüklerinle ifade et.','Çevre ile alanın aynı büyüklük olmadığını hatırla; önce sorunun istediği ölçüyü ayırmaya dikkat et.','Bir şeklin sınırı ile iç bölgesini karşılaştır ve kullanılacak birimin hangi ölçüye uygun olduğunu düşün.'],
 ['Dikdörtgende karşılıklı kenarların eşitliğini kullanarak şeklin üzerinde verilmeyen diğer kenarları kendi çiziminde belirle ve işaretle.','Üçgende tabana ait yüksekliğin dik olması gerektiğini hatırla; görünen eğik kenarı yükseklik yerine kullanma.','İşleme başlamadan önce çevre için uzunlukları, alan için bölgeyi ölçtüğünü kontrol et ve uygun yöntemi seç.'],
 ['Bir dikdörtgenin çevresini bulurken sınırdaki bütün kenarları sırayla izleyen kısa bir toplama planı oluştur ve yaz.','Alan istenen bir üçgende aynı taban ve yükseklikteki dikdörtgeni hayal et; iki eş parçanın ilişkisini incele.','Birden fazla şekil verildiyse her şeklin istenen ölçüsünü önce ayrı hesapla, sonra sorunun istediği ilişkiyi uygula.'],
 ['İşlem planındaki her uzunluğun çizimdeki karşılığını göster; hiçbir kenarı unutmadığını veya iki kere saymadığını kontrol et.','Bir alan hesabında taban ile yüksekliği çarptıktan sonra üçgenin dikdörtgenle ilişkisini kullanarak gerekli düzenlemeyi yap.','Bulduğun büyüklüğün uzunluk mu alan mı olduğunu yeniden denetle; seçeneklerle karşılaştırırken birimleri de dikkatle kontrol et.']
];
/** Synthetic platform fixture, not a learner-specific academically approved pilot. */
export function visualCandidate(v=version){
  const p=JSON.parse(fs.readFileSync(new URL('../assessment-publication/valid-package.json',import.meta.url),'utf8'));
  p.assessment_profile='visual-foundation-bridge-v1';
  const learning=p.questions.filter(q=>q.delivery_surface==='learning');
  for(const q of p.questions){q.assets=[];if(q.delivery_surface==='learning'){q.learning_stage=learning.indexOf(q)<10?'FOUNDATION':'BRIDGE';p.blueprint.find(b=>b.question_code===q.question_code).learning_stage=q.learning_stage;}}
  const replacements=[
    [0,'Şekilde kenarları verilen dikdörtgenin çevresi kaç santimetredir?',['20 cm','10 cm','24 cm','40 cm'],[diagram('rectangle',1,v)],'İki uzun ve iki kısa kenar toplanır: 6 + 4 + 6 + 4 = 20 cm.'],
    [10,'İki şekilde verilen dikdörtgen ile dik üçgenin alanları toplamı kaç santimetrekaredir?',['12 cm²','24 cm²','36 cm²','48 cm²'],[diagram('rectangle',1,v),diagram('triangle',2,v)],'Dikdörtgenin alanı 6 × 4 = 24 cm², üçgenin alanı 6 × 4 / 2 = 12 cm²; toplam 36 cm² olur.'],
    [20,'A, B, C ve D panellerinden hangisinde ortak başlangıçlı iki doğru parçası birbirine diktir?',['A paneli','B paneli','C paneli','D paneli'],[diagram('composite',1,v)],'A panelindeki yatay ve düşey parçalar dik açı oluşturur. Diğer panellerde açı dar, geniş veya doğrusaldır.']
  ];
  for(const [i,prompt,options,assets,explanation]of replacements){
    const q=p.questions[i],correct=q.options.find(o=>o.is_correct).position;
    Object.assign(q,{prompt,assets,explanation,correct_explanation:explanation,final_incorrect_explanation:explanation,source_ref:'synthetic:owned-geometry',decomposable:false});
    q.options=options.map((content,j)=>({position:j+1,label:String.fromCharCode(65+j),content,is_correct:j+1===correct,...(j+1!==correct?{distractor_rationale:['Yalnızca bir ölçüyü kullanan eksik işlem.','Çevre ve alan kavramlarını karıştıran farklı yöntem.','Gerekli bölme adımını uygulamayan işlem.'][j%3]+` Seçenek ${j+1}.`}:{})}));
    if(q.delivery_surface==='learning')q.hints=teaching.map((lines,j)=>({level:j+1,role:['nudge','guide','strong_guide','near_solution'][j],language:'tr',content:lines.map(x=>'• '+x).join('\n')}));
    const b=p.blueprint.find(b=>b.question_code===q.question_code);b.reasoning_signature=['perimeter from rectangle boundary','combine rectangle and right triangle areas','classify perpendicular vector pairs'][replacements.findIndex(r=>r[0]===i)];b.source_ref=q.source_ref;
  }
  return p;
}
