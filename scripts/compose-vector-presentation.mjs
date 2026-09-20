import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('PUBLIC_ROOT_REQUIRED');

const indexPath = path.join(publicRoot, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Controllers must be available before payroll intelligence captures their callbacks.
// Keep the retired presentation absent; its workflow ownership now belongs to Vector.
if (!fs.existsSync(path.join(publicRoot, 'vector-workflows.js'))) {
  throw new Error('VECTOR_WORKFLOW_CONTROLLER_MISSING');
}
if (!html.includes('src="/vector-workflows.js"')) {
  const consumer = /<script\b[^>]*src=["'][^"']*payroll-intelligence-ui\.js[^"']*["'][^>]*>/i;
  if (!consumer.test(html)) throw new Error('VECTOR_WORKFLOW_CONSUMER_MISSING');
  html = html.replace(consumer, match => '<script src="/vector-workflows.js"></script>\n' + match);
}

const retired = [
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
console.log('VECTOR_INDEX_COMPOSITION=PASS');
