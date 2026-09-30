import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist', 'assets');
const budgetBytes = {
  jsTotal: 2600 * 1024,
  cssTotal: 260 * 1024,
  jsLargest: 650 * 1024,
};

if (!fs.existsSync(distDir)) {
  console.error('Missing dist/assets. Run a build before budget checks.');
  process.exit(1);
}

const files = fs.readdirSync(distDir);
const jsFiles = files.filter((name) => name.endsWith('.js'));
const cssFiles = files.filter((name) => name.endsWith('.css'));

const sizeOf = (fileName) => fs.statSync(path.join(distDir, fileName)).size;
const sum = (values) => values.reduce((acc, value) => acc + value, 0);

const jsSizes = jsFiles.map(sizeOf);
const cssSizes = cssFiles.map(sizeOf);

const jsTotal = sum(jsSizes);
const cssTotal = sum(cssSizes);
const jsLargest = jsSizes.length ? Math.max(...jsSizes) : 0;

const failures = [];
if (jsTotal > budgetBytes.jsTotal) failures.push(`JS total ${jsTotal} > ${budgetBytes.jsTotal}`);
if (cssTotal > budgetBytes.cssTotal) failures.push(`CSS total ${cssTotal} > ${budgetBytes.cssTotal}`);
if (jsLargest > budgetBytes.jsLargest) failures.push(`Largest JS chunk ${jsLargest} > ${budgetBytes.jsLargest}`);

console.log('Bundle budget report');
console.log(`- JS total: ${jsTotal} bytes`);
console.log(`- CSS total: ${cssTotal} bytes`);
console.log(`- Largest JS chunk: ${jsLargest} bytes`);

if (failures.length) {
  console.error('\nBudget check failed:');
  failures.forEach((line) => console.error(`- ${line}`));
  process.exit(1);
}

console.log('\nBudget check passed.');

