import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('PUBLIC_ROOT_REQUIRED');

const indexPath = path.join(publicRoot, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const retired = [
  'factory-control-ui.css',
  'value-cockpit-ui.js',
  'value-cockpit-ui.css',
  'review-ui.js',
  'review-ui.css',
  'ui-evolution.css',
  'vector-shell.js'
];

// Inspect URL path basenames, never substring matches: "review-ui.js" is
// retired, while "time-review-ui.js" remains the authoritative time controller.
const assetTags = /<!--[\s\S]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>|<link\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
function referencedAsset(tag) {
  if (tag.startsWith('<!--')) return null;
  const opening = tag.match(/^<(script|link)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i);
  if (!opening) return null;
  const attribute = opening[1].toLowerCase() === 'script' ? 'src' : 'href';
  const match = opening[0].match(new RegExp('\\s' + attribute + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))', 'i'));
  if (!match) return null;
  try {
    const pathname = new URL(match[1] ?? match[2] ?? match[3], 'https://vector.invalid/').pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
  } catch { return null; }
}
const references = () => [...html.matchAll(assetTags)].map(match => referencedAsset(match[0])).filter(Boolean);

if (process.argv[3] === '--verify') {
  const loaded = new Set(references());
  for (const name of retired) if (loaded.has(name) || fs.existsSync(path.join(publicRoot, name))) throw new Error('Retired presentation remains: ' + name);
  for (const name of ['vector-ui.css', 'vector-ui.js', 'vector-workflows.js']) if (!loaded.has(name) || !fs.existsSync(path.join(publicRoot, name))) throw new Error('Vector presentation asset missing: ' + name);
  for (const name of ['vector-ui.css', 'vector-ui.js']) if (!fs.readFileSync(path.join(publicRoot, name), 'utf8').includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')) throw new Error('Vector presentation marker missing: ' + name);
  console.log('VECTOR_SINGLE_PRESENTATION_ENTRYPOINT=PASS');
  process.exit(0);
}

// Controllers must be available before payroll intelligence captures callbacks.
if (!fs.existsSync(path.join(publicRoot, 'vector-workflows.js'))) throw new Error('VECTOR_WORKFLOW_CONTROLLER_MISSING');
if (!references().includes('vector-workflows.js')) {
  let inserted = false;
  html = html.replace(assetTags, tag => {
    if (!inserted && referencedAsset(tag) === 'payroll-intelligence-ui.js') {
      inserted = true;
      return '<script src="/vector-workflows.js"></script>\n' + tag;
    }
    return tag;
  });
  if (!inserted) throw new Error('VECTOR_WORKFLOW_CONSUMER_MISSING');
}
html = html.replace(assetTags, tag => retired.includes(referencedAsset(tag)) ? '' : tag);

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
