import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAcademicPackage } from '../supabase/functions/_shared/academic-content-quality.mjs';
export { validateAcademicPackage };

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/academic-content-quality.mjs <academic-package.json>');
    process.exit(2);
  }
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  let result;
  if (pkg && pkg.package_type === 'support_workbook') {
    const { validateSupportWorkbookPackage } = await import('./support-workbook-quality.mjs');
    result = validateSupportWorkbookPackage(pkg);
  } else {
    result = validateAcademicPackage(pkg);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

const modulePath = fs.realpathSync(path.resolve(fileURLToPath(import.meta.url)));
let entryPath = '';
if (process.argv[1]) {
  const resolvedEntry = path.resolve(process.argv[1]);
  try {
    entryPath = fs.realpathSync(resolvedEntry);
  } catch {
    entryPath = resolvedEntry;
  }
}
const sameEntrypoint = process.platform === 'win32'
  ? entryPath.toLocaleLowerCase('en-US') === modulePath.toLocaleLowerCase('en-US')
  : entryPath === modulePath;
if (entryPath && sameEntrypoint) await main();
