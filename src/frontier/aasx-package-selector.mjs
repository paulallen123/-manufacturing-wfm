import path from 'node:path';
import { decodeAasXmlEnvironment } from './aas-xml-environment.mjs';

export const AASX_PACKAGE_SELECTOR_VERSION = 'aasx-package-selector-v0.3.0';

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

function semanticCanonical(value) {
  if (Array.isArray(value)) {
    const items = value.map(semanticCanonical).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, semanticCanonical(item)])
      .filter(([, item]) => item !== undefined);
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  }
  if (value == null || value === '') return undefined;
  return value;
}

function fingerprintEnvironment(environment) {
  return JSON.stringify(stable(semanticCanonical(environment) ?? {}));
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
  const ids = new Set();
  const re = /<Relationship\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.Type || !attrs.Target) continue;
    if (attrs.Id && ids.has(attrs.Id)) return { status: 'rejected', reason: 'duplicate_relationship_id', relationshipId: attrs.Id };
    if (attrs.Id) ids.add(attrs.Id);
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

function supplementaryKind(packagePath) {
  return path.posix.extname(packagePath).toLowerCase() === '.fmu' ? 'fmu' : 'supplementary';
}

export function inspectAasxSupplementaryArtifacts(specPath, packageIndex) {
  const relsPath = relationshipPartFor(specPath);
  if (!relsPath) return { status: 'rejected', reason: 'invalid_aas_spec_path' };
  const relsEntry = packageIndex.get(relsPath);
  if (!relsEntry) return { status: 'accepted', relationshipPart: null, artifacts: [], fmuCount: 0 };

  const parsed = parseRelationships(String(relsEntry.content ?? ''));
  if (parsed.status !== 'accepted') return parsed;

  const byPath = new Map();
  for (const rel of parsed.relationships.filter((item) => isRelationshipType(item.type, 'aas-suppl'))) {
    if (String(rel.targetMode).toLowerCase() === 'external') {
      return { status: 'rejected', reason: 'external_aas_supplementary_forbidden', relationshipId: rel.id ?? null };
    }
    const resolved = resolveTarget(specPath, rel.target);
    if (!resolved) return { status: 'rejected', reason: 'unsafe_aas_supplementary_target', relationshipId: rel.id ?? null };
    const target = packageIndex.get(resolved);
    if (!target) return { status: 'review_required', reason: 'aas_supplementary_target_missing', path: resolved, relationshipId: rel.id ?? null };

    const previous = byPath.get(resolved);
    const relationshipIds = [...new Set([...(previous?.relationshipIds ?? []), rel.id].filter(Boolean))];
    byPath.set(resolved, {
      path: resolved,
      kind: supplementaryKind(resolved),
      size: target.size,
      compressedSize: Number.isFinite(target.compressedSize) ? Number(target.compressedSize) : null,
      contentType: typeof target.contentType === 'string' ? target.contentType : null,
      relationshipIds,
    });
  }

  const artifacts = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    status: 'accepted',
    relationshipPart: relsPath,
    artifacts,
    fmuCount: artifacts.filter((item) => item.kind === 'fmu').length,
  };
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

  const candidates = [];
  for (const entry of aasSpecs) {
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('.json') || lower.endsWith('.aas.json')) {
      const environment = jsonEnvironment(entry.content);
      if (!environment) return { status: 'review_required', reason: 'invalid_aas_json_environment', path: entry.path };
      candidates.push({ entry, environment, format: 'json', fingerprint: fingerprintEnvironment(environment) });
    } else if (lower.endsWith('.xml') || lower.endsWith('.aas.xml')) {
      const decoded = decodeAasXmlEnvironment(String(entry.content ?? ''), { limits: options.xmlLimits });
      if (decoded.status !== 'accepted') return { ...decoded, path: entry.path };
      candidates.push({ entry, environment: decoded.environment, format: 'xml', fingerprint: fingerprintEnvironment(decoded.environment), xmlNamespace: decoded.namespace });
    }
  }

  if (candidates.length === 0) return { status: 'review_required', reason: 'unsupported_aas_spec_serialization', paths: aasSpecs.map((entry) => entry.path) };
  const fingerprints = [...new Set(candidates.map((item) => item.fingerprint))];
  if (fingerprints.length > 1) {
    return { status: 'review_required', reason: 'conflicting_aas_serializations', paths: candidates.map((item) => item.entry.path) };
  }

  const selected = candidates.slice().sort((a, b) => {
    const formatOrder = { json: 0, xml: 1 };
    return formatOrder[a.format] - formatOrder[b.format] || a.entry.path.localeCompare(b.entry.path);
  })[0];

  const supplementary = inspectAasxSupplementaryArtifacts(selected.entry.path, inspected.index);
  if (supplementary.status !== 'accepted') return supplementary;

  return {
    status: 'accepted',
    format: selected.format,
    environment: selected.environment,
    selectedPath: selected.entry.path,
    equivalentSerializations: candidates.length,
    jsonSerializations: candidates.filter((item) => item.format === 'json').length,
    xmlSerializations: candidates.filter((item) => item.format === 'xml').length,
    xmlNamespace: selected.xmlNamespace ?? null,
    supplementaryArtifacts: supplementary.artifacts,
    supplementaryArtifactCount: supplementary.artifacts.length,
    fmuArtifactCount: supplementary.fmuCount,
    supplementaryRelationshipPart: supplementary.relationshipPart,
    supplementaryExecutionPolicy: 'metadata_only_never_execute',
    totalPackageBytes: inspected.totalBytes,
    version: AASX_PACKAGE_SELECTOR_VERSION,
  };
}
