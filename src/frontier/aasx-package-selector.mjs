import path from 'node:path';

export const AASX_PACKAGE_SELECTOR_VERSION = 'aasx-package-selector-v0.1.0';

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 512,
  maxTotalBytes: 20 * 1024 * 1024,
  maxEntryBytes: 10 * 1024 * 1024,
  maxCompressionRatio: 100,
});

function utf8Bytes(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function normalizePackagePath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return null;
  const withoutQuery = raw.split(/[?#]/, 1)[0];
  const decoded = decodeURIComponentSafe(withoutQuery);
  if (decoded == null) return null;
  const trimmed = decoded.replace(/^\/+/, '');
  if (!trimmed || /^[A-Za-z]:/.test(trimmed)) return null;
  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function relationshipPartFor(sourcePart) {
  const normalized = normalizePackagePath(sourcePart);
  if (!normalized) return null;
  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  return (dir === '.' ? '' : `${dir}/`) + `_rels/${base}.rels`;
}

function resolveTarget(sourcePart, target) {
  if (typeof target !== 'string' || !target.trim()) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const source = normalizePackagePath(sourcePart);
  if (!source) return null;
  const baseDir = path.posix.dirname(source);
  const candidate = target.startsWith('/') ? target : path.posix.join(baseDir === '.' ? '' : baseDir, target);
  return normalizePackagePath(candidate);
}

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(fragment) {
  const attrs = {};
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(fragment))) attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  return attrs;
}

function parseRelationships(xml) {
  if (typeof xml !== 'string') return { status: 'rejected', reason: 'relationship_part_not_text' };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { status: 'rejected', reason: 'xml_dtd_or_entity_forbidden' };
  const relationships = [];
  const re = /<Relationship\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.Type || !attrs.Target) continue;
    relationships.push({
      id: attrs.Id ?? null,
      type: attrs.Type,
      target: attrs.Target,
      targetMode: attrs.TargetMode ?? 'Internal',
    });
  }
  return { status: 'accepted', relationships };
}

function isRelationshipType(type, leaf) {
  return typeof type === 'string' && type.toLowerCase().replace(/\/+$/, '').endsWith(`/${leaf}`);
}

function entryBytes(entry) {
  if (Number.isFinite(entry?.size) && entry.size >= 0) return Number(entry.size);
  return utf8Bytes(entry?.content ?? '');
}

function inspectEntries(entries, limits) {
  if (!Array.isArray(entries) || entries.length === 0) return { status: 'rejected', reason: 'aasx_entries_required' };
  if (entries.length > limits.maxEntries) return { status: 'rejected', reason: 'aasx_entry_limit_exceeded' };
  const index = new Map();
  let totalBytes = 0;
  for (const entry of entries) {
    const packagePath = normalizePackagePath(entry?.path);
    if (!packagePath) return { status: 'rejected', reason: 'invalid_or_unsafe_package_path', path: entry?.path ?? null };
    if (index.has(packagePath)) return { status: 'rejected', reason: 'duplicate_package_path', path: packagePath };
    if (entry?.encrypted === true) return { status: 'rejected', reason: 'encrypted_package_entry_not_supported', path: packagePath };
    const bytes = entryBytes(entry);
    if (bytes > limits.maxEntryBytes) return { status: 'rejected', reason: 'aasx_entry_size_limit_exceeded', path: packagePath };
    totalBytes += bytes;
    if (totalBytes > limits.maxTotalBytes) return { status: 'rejected', reason: 'aasx_total_size_limit_exceeded' };
    if (Number.isFinite(entry?.compressedSize) && entry.compressedSize > 0) {
      const ratio = bytes / Number(entry.compressedSize);
      if (ratio > limits.maxCompressionRatio) return { status: 'rejected', reason: 'aasx_compression_ratio_limit_exceeded', path: packagePath };
    }
    index.set(packagePath, { ...entry, path: packagePath, size: bytes });
  }
  return { status: 'accepted', index, totalBytes };
}

function jsonEnvironment(content) {
  try {
    const parsed = JSON.parse(String(content));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const structural = ['assetAdministrationShells', 'submodels', 'conceptDescriptions'];
    if (!structural.some((key) => Array.isArray(parsed[key]))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function selectAasxEnvironment(entries = [], options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const inspected = inspectEntries(entries, limits);
  if (inspected.status !== 'accepted') return inspected;

  const rootRels = inspected.index.get('_rels/.rels');
  if (!rootRels) return { status: 'review_required', reason: 'aasx_root_relationships_missing' };
  const rootParsed = parseRelationships(String(rootRels.content ?? ''));
  if (rootParsed.status !== 'accepted') return rootParsed;

  const origins = rootParsed.relationships.filter((rel) => isRelationshipType(rel.type, 'aasx-origin'));
  if (origins.length !== 1) return { status: 'review_required', reason: origins.length ? 'multiple_aasx_origins' : 'aasx_origin_missing' };
  if (String(origins[0].targetMode).toLowerCase() === 'external') return { status: 'rejected', reason: 'external_aasx_origin_forbidden' };
  const normalizedOrigin = normalizePackagePath(origins[0].target);
  if (!normalizedOrigin || !inspected.index.has(normalizedOrigin)) return { status: 'review_required', reason: 'aasx_origin_target_missing' };

  const originRelsPath = relationshipPartFor(normalizedOrigin);
  const originRels = originRelsPath ? inspected.index.get(originRelsPath) : null;
  if (!originRels) return { status: 'review_required', reason: 'aasx_origin_relationships_missing' };
  const originParsed = parseRelationships(String(originRels.content ?? ''));
  if (originParsed.status !== 'accepted') return originParsed;

  const aasSpecs = [];
  for (const rel of originParsed.relationships.filter((item) => isRelationshipType(item.type, 'aas-spec'))) {
    if (String(rel.targetMode).toLowerCase() === 'external') return { status: 'rejected', reason: 'external_aas_spec_forbidden' };
    const resolved = resolveTarget(normalizedOrigin, rel.target);
    if (!resolved) return { status: 'rejected', reason: 'unsafe_aas_spec_target' };
    const entry = inspected.index.get(resolved);
    if (!entry) return { status: 'review_required', reason: 'aas_spec_target_missing', path: resolved };
    aasSpecs.push(entry);
  }
  if (aasSpecs.length === 0) return { status: 'review_required', reason: 'aas_spec_relationship_missing' };

  const jsonCandidates = [];
  const xmlCandidates = [];
  for (const entry of aasSpecs) {
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('.json') || lower.endsWith('.aas.json')) {
      const environment = jsonEnvironment(entry.content);
      if (!environment) return { status: 'review_required', reason: 'invalid_aas_json_environment', path: entry.path };
      jsonCandidates.push({ entry, environment, fingerprint: JSON.stringify(stable(environment)) });
    } else if (lower.endsWith('.xml') || lower.endsWith('.aas.xml')) {
      xmlCandidates.push(entry);
    }
  }

  if (jsonCandidates.length > 0) {
    const fingerprints = [...new Set(jsonCandidates.map((item) => item.fingerprint))];
    if (fingerprints.length > 1) {
      return { status: 'review_required', reason: 'conflicting_aas_serializations', paths: jsonCandidates.map((item) => item.entry.path) };
    }
    const selected = jsonCandidates.slice().sort((a, b) => a.entry.path.localeCompare(b.entry.path))[0];
    return {
      status: 'accepted',
      format: 'json',
      environment: selected.environment,
      selectedPath: selected.entry.path,
      equivalentJsonSerializations: jsonCandidates.length,
      xmlAlternatives: xmlCandidates.map((entry) => entry.path),
      totalPackageBytes: inspected.totalBytes,
      version: AASX_PACKAGE_SELECTOR_VERSION,
    };
  }

  if (xmlCandidates.length > 0) {
    return { status: 'review_required', reason: 'xml_aas_spec_not_supported_yet', paths: xmlCandidates.map((entry) => entry.path) };
  }
  return { status: 'review_required', reason: 'unsupported_aas_spec_serialization', paths: aasSpecs.map((entry) => entry.path) };
}
