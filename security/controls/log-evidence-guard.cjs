'use strict';

const MAX_LINE_LENGTH = 8192;
const SCREENSHOT_PAYLOAD = /(?:^|[^A-Z0-9_])(?:[A-Z0-9_]*SCREENSHOT_B64|SCREENSHOT_BASE64)(?:\||\s*[:=]\s*)[A-Za-z0-9+/]{256,}={0,2}/i;
const DATA_URI_IMAGE = /data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]{256,}={0,2}/i;
const LONG_BASE64 = /[A-Za-z0-9+/]{4096,}={0,2}/;

function inspectLogText(text) {
  const findings = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.length > MAX_LINE_LENGTH) findings.push({ line: lineNo, rule: 'oversized-log-line' });
    if (SCREENSHOT_PAYLOAD.test(line)) findings.push({ line: lineNo, rule: 'screenshot-base64-payload' });
    if (DATA_URI_IMAGE.test(line)) findings.push({ line: lineNo, rule: 'image-data-uri-payload' });
    if (LONG_BASE64.test(line)) findings.push({ line: lineNo, rule: 'large-base64-payload' });
  });
  return { ok: findings.length === 0, findings };
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    const result = inspectLogText(input);
    if (!result.ok) {
      console.error(JSON.stringify({ status: 'BLOCK', findings: result.findings }));
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify({ status: 'PASS' }));
  });
}

module.exports = { inspectLogText, MAX_LINE_LENGTH };
