import { chromium } from 'playwright';

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const errors = [];

async function run(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(`pageerror ${viewport.width}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console ${viewport.width}: ${m.text()}`); });
  await page.goto(`${BASE_URL}arabic-self-contained-preview.html?qa=${Date.now()}`, { waitUntil:'networkidle', timeout:30000 });

  const introText = await page.locator('#intro .question-material-text').innerText();
  if (!introText.includes('سمكةٍ ذهبيّةٍ') || !introText.includes('زورقًا للصيد')) throw new Error('Required reading material is not visible before quiz start');

  await page.getByRole('button', { name:/ابدأ السؤال/ }).click();
  await page.locator('#quiz').waitFor({ state:'visible' });
  const toggle = page.getByRole('button', { name:'📖 عرض النص مرة ثانية' });
  await toggle.click();
  await page.locator('#questionMaterialBackdrop.open').waitFor({ state:'visible' });
  const dialogText = await page.locator('#questionMaterialDialogBody').innerText();
  if (!dialogText.includes('ليشتريَ بثمنِها زورقًا للصيدِ')) throw new Error('Reading material cannot be reopened during the question');
  await page.getByRole('button', { name:'إغلاق' }).click();

  const options = page.locator('.demo-option');
  if (await options.count() !== 4) throw new Error('Expected four answer options');
  await options.nth(1).click();
  const feedback = await page.locator('#feedback').innerText();
  if (!feedback.includes('ممتاز')) throw new Error('Correct-answer feedback did not render');

  if (viewport.width <= 620) {
    const a = await options.nth(0).boundingBox();
    const b = await options.nth(1).boundingBox();
    if (!a || !b || b.y <= a.y + a.height - 3) throw new Error('Mobile answers should stack vertically');
  }

  await page.close();
}

await run({ width: 390, height: 844 });
await run({ width: 800, height: 1100 });
await run({ width: 1280, height: 900 });

if (errors.length) throw new Error(errors.join('\n'));
console.log('QA PASS: self-contained reading material is shown before quiz and reopenable during questions on mobile/tablet/desktop');
await browser.close();