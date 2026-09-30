import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../content-direction-v1.js',import.meta.url),'utf8');
const context={globalThis:{}};
context.globalThis=context;
vm.runInNewContext(source,context,{filename:'content-direction-v1.js'});
const api=context.FLHContentDirection;

assert.equal(api.normalizeLanguage('tr-TR'),'tr');
assert.equal(api.normalizeLanguage('AR'),'ar');
assert.equal(api.direction('ar'),'rtl');
assert.equal(api.direction('tr'),'ltr');
assert.equal(api.direction('en-US'),'ltr');
assert.equal(api.direction('de'),'auto');
assert.equal(api.attrs('tr'),'lang="tr" dir="ltr"');
assert.equal(api.attrs('ar'),'lang="ar" dir="rtl"');
assert.equal(api.attrs('unknown'),'dir="auto"');

assert.equal(api.normalizeText("B'den"),"B'den");
assert.equal(api.normalizeText('B&#39;den'),"B'den");
assert.equal(api.normalizeText('B&amp;#39;den'),"B'den");
assert.equal(api.normalizeText('UTC-4&apos;tür'),"UTC-4'tür");
assert.equal(api.normalizeText('&lt;script&gt;alert(1)&lt;/script&gt;'),'<script>alert(1)</script>');

const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
assert.equal(safe(api.normalizeText('&lt;script&gt;alert(1)&lt;/script&gt;')),'&lt;script&gt;alert(1)&lt;/script&gt;','legacy entity normalization must still be escaped before HTML rendering');

console.log('Content direction tests passed: ar/tr/en direction, fallback, Turkish apostrophes, legacy entity normalization, and escape-after-normalization safety are intact.');
