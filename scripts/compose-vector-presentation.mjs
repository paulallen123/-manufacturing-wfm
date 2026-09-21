import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('PUBLIC_ROOT_REQUIRED');

const indexPath = path.join(publicRoot, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const retired = [
  'factory-control-ui.js',
  'factory-control-ui.css',
  'value-cockpit-ui.js',
  'value-cockpit-ui.css',
  'review-ui.js',
  'review-ui.css',
  'ui-evolution.css',
  'vector-shell.js'
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const name of retired) {
  const safe = escapeRegExp(name);
  html = html.replace(
    new RegExp(`<link\\b[^>]*href=["'][^"']*${safe}[^"']*["'][^>]*>`, 'gi'),
    ''
  );
  html = html.replace(
    new RegExp(`<script\\b[^>]*src=["'][^"']*${safe}[^"']*["'][^>]*>\\s*</script>`, 'gi'),
    ''
  );
}

if (!html.includes('vector-ui.css')) {
  if (!html.includes('</head>')) throw new Error('INDEX_HEAD_CLOSE_MISSING');
  html = html.replace('</head>', '<link rel="stylesheet" href="/vector-ui.css"></head>');
}

if (!html.includes('vector-ui.js')) {
  if (!html.includes('</body>')) throw new Error('INDEX_BODY_CLOSE_MISSING');
  html = html.replace('</body>', '<script src="/vector-ui.js"></script></body>');
}

fs.writeFileSync(indexPath, html);
for (const name of retired) {
  const file = path.join(publicRoot, name);
  fs.rmSync(file, { force: true });
  if (html.includes(name) || fs.existsSync(file)) throw new Error(`RETIRED_PRESENTATION_REMAINS:${name}`);
}
for (const name of ['vector-ui.js','vector-ui.css']) {
  const file=path.join(publicRoot,name);
  if(!fs.existsSync(file)) throw new Error('VECTOR_CANONICAL_ASSET_MISSING');
  if(!fs.readFileSync(file,'utf8').includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')) throw new Error(`VECTOR_CANONICAL_MARKER_MISSING:${name}`);
}
console.log('VECTOR_INDEX_COMPOSITION=PASS');
console.log('VECTOR_RETIRED_ENTRYPOINT_PURGE=PASS');
