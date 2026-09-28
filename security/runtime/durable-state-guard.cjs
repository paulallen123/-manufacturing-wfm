'use strict';

const fs = require('node:fs');
const path = require('node:path');

function decodeMountPath(value) {
  return String(value || '')
    .replace(/\\040/g, ' ')
    .replace(/\\011/g, '\t')
    .replace(/\\012/g, '\n')
    .replace(/\\134/g, '\\');
}

function parseMountPoints(mountInfo) {
  return String(mountInfo || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => line.trim().split(/\s+/)[4])
    .filter(Boolean)
    .map(decodeMountPath)
    .sort((a, b) => b.length - a.length);
}

function pathWithin(filePath, mountPoint) {
  const file = path.resolve(filePath);
  const mount = path.resolve(mountPoint);
  return file === mount || file.startsWith(mount.endsWith(path.sep) ? mount : mount + path.sep);
}

function proveDurableDb({ dbPath, mountInfo, required = true } = {}) {
  if (!required) return { required: false, status: 'NOT_REQUIRED' };
  if (!dbPath || !path.isAbsolute(dbPath)) {
    throw new Error('Durable hosted state requires an absolute WFM_DB path.');
  }
  const resolved = path.resolve(dbPath);
  for (const forbidden of ['/tmp', '/app', '/run']) {
    if (pathWithin(resolved, forbidden)) {
      throw new Error('Durable hosted state refuses ephemeral/application path: ' + resolved);
    }
  }
  const mounts = parseMountPoints(mountInfo);
  const mountPoint = mounts.find(point => pathWithin(resolved, point));
  if (!mountPoint || mountPoint === '/') {
    throw new Error('Durable hosted state requires WFM_DB on a distinct mounted volume: ' + resolved);
  }
  return { required: true, status: 'PASS', dbPath: resolved, mountPoint };
}

function enforceDurableState(options = {}) {
  const required = options.required ?? process.env.WFM_REQUIRE_DURABLE_STATE === 'true';
  if (!required) return { required: false, status: 'NOT_REQUIRED' };
  const dbPath = options.dbPath || process.env.WFM_DB;
  const mountInfo = options.mountInfo ?? fs.readFileSync('/proc/self/mountinfo', 'utf8');
  return proveDurableDb({ dbPath, mountInfo, required: true });
}

module.exports = { decodeMountPath, parseMountPoints, pathWithin, proveDurableDb, enforceDurableState };
