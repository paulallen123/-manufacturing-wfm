export const AAS_XML_ENVIRONMENT_VERSION = 'aas-xml-environment-v0.1.0';

const DEFAULT_LIMITS = Object.freeze({
  maxNodes: 20_000,
  maxDepth: 64,
  maxTextBytes: 20 * 1024 * 1024,
});

const SUPPORTED_AAS_NAMESPACES = new Set([
  'https://admin-shell.io/aas/3/0',
  'https://admin-shell.io/aas/3/1',
  'https://admin-shell.io/aas/3/2',
]);

function localName(raw = '') {
  const name = String(raw).trim();
  const index = name.indexOf(':');
  return index >= 0 ? name.slice(index + 1) : name;
}

function modelTypeFromTag(name) {
  const normalized = localName(name);
  if (!normalized) return null;
  return normalized[0].toUpperCase() + normalized.slice(1);
}

function decodeEntities(text) {
  const source = String(text ?? '');
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(source)) {
    return { status: 'rejected', reason: 'xml_unknown_entity' };
  }
  const value = source
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  return { status: 'accepted', value };
}

function parseAttributes(fragment) {
  const attrs = {};
  const input = String(fragment ?? '').trim();
  if (!input) return { status: 'accepted', attrs };
  const re = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let last = 0;
  let match;
  while ((match = re.exec(input))) {
    if (input.slice(last, match.index).trim()) return { status: 'rejected', reason: 'xml_malformed_attribute' };
    const decoded = decodeEntities(match[2] ?? match[3] ?? '');
    if (decoded.status !== 'accepted') return decoded;
    attrs[match[1]] = decoded.value;
    last = re.lastIndex;
  }
  if (input.slice(last).trim()) return { status: 'rejected', reason: 'xml_malformed_attribute' };
  for (const name of Object.keys(attrs)) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) return { status: 'rejected', reason: 'xml_non_namespace_attribute_forbidden', attribute: name };
  }
  return { status: 'accepted', attrs };
}

function parseXmlTree(xml, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  if (typeof xml !== 'string' || !xml.trim()) return { status: 'rejected', reason: 'xml_text_required' };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { status: 'rejected', reason: 'xml_dtd_or_entity_forbidden' };
  if (/<!\[CDATA\[/i.test(xml)) return { status: 'rejected', reason: 'xml_cdata_not_supported' };

  const root = { name: '__root__', attrs: {}, children: [], text: '' };
  const stack = [root];
  let nodes = 0;
  let textBytes = 0;
  let index = 0;

  while (index < xml.length) {
    const lt = xml.indexOf('<', index);
    const text = lt < 0 ? xml.slice(index) : xml.slice(index, lt);
    if (text) {
      const decoded = decodeEntities(text);
      if (decoded.status !== 'accepted') return decoded;
      textBytes += Buffer.byteLength(decoded.value, 'utf8');
      if (textBytes > limits.maxTextBytes) return { status: 'rejected', reason: 'xml_text_limit_exceeded' };
      stack[stack.length - 1].text += decoded.value;
    }
    if (lt < 0) break;

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) return { status: 'rejected', reason: 'xml_unterminated_comment' };
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) return { status: 'rejected', reason: 'xml_unterminated_processing_instruction' };
      const pi = xml.slice(lt + 2, end).trim();
      if (!/^xml(?:\s|$)/i.test(pi)) return { status: 'rejected', reason: 'xml_processing_instruction_forbidden' };
      index = end + 2;
      continue;
    }

    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) return { status: 'rejected', reason: 'xml_unterminated_tag' };
    const raw = xml.slice(lt + 1, gt).trim();
    if (!raw) return { status: 'rejected', reason: 'xml_empty_tag' };

    if (raw.startsWith('/')) {
      const name = localName(raw.slice(1).trim());
      if (stack.length === 1 || localName(stack[stack.length - 1].name) !== name) {
        return { status: 'rejected', reason: 'xml_mismatched_close_tag', tag: name };
      }
      stack.pop();
      index = gt + 1;
      continue;
    }

    const selfClosing = /\/$/.test(raw);
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const match = /^([^\s]+)([\s\S]*)$/.exec(body);
    if (!match) return { status: 'rejected', reason: 'xml_malformed_start_tag' };
    const name = match[1];
    const parsedAttrs = parseAttributes(match[2]);
    if (parsedAttrs.status !== 'accepted') return parsedAttrs;

    nodes += 1;
    if (nodes > limits.maxNodes) return { status: 'rejected', reason: 'xml_node_limit_exceeded' };
    if (stack.length > limits.maxDepth) return { status: 'rejected', reason: 'xml_depth_limit_exceeded' };
    const node = { name, attrs: parsedAttrs.attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    index = gt + 1;
  }

  if (stack.length !== 1) return { status: 'rejected', reason: 'xml_unclosed_tag' };
  if (root.children.length !== 1) return { status: 'rejected', reason: 'xml_single_root_required' };
  return { status: 'accepted', root: root.children[0], nodes, textBytes };
}

function children(node, name) {
  const wanted = localName(name);
  return (node?.children ?? []).filter((child) => localName(child.name) === wanted);
}

function child(node, name) {
  return children(node, name)[0] ?? null;
}

function textOf(node, name = null) {
  const target = name == null ? node : child(node, name);
  if (!target) return null;
  const value = String(target.text ?? '').trim();
  return value || null;
}

function parseReference(node) {
  if (!node) return null;
  const type = textOf(node, 'type');
  const keysNode = child(node, 'keys');
  const keys = children(keysNode, 'key').map((keyNode) => ({
    type: textOf(keyNode, 'type'),
    value: textOf(keyNode, 'value'),
  })).filter((key) => key.value);
  if (!type && keys.length === 0) return null;
  return { type: type ?? 'ExternalReference', keys };
}

function parseReferences(node) {
  if (!node) return [];
  return children(node, 'reference').map(parseReference).filter(Boolean);
}

function parseQualifier(node) {
  if (!node) return null;
  return {
    type: textOf(node, 'type'),
    valueType: textOf(node, 'valueType'),
    value: textOf(node, 'value'),
    semanticId: parseReference(child(node, 'semanticId')),
  };
}

function commonFields(node) {
  return {
    idShort: textOf(node, 'idShort'),
    semanticId: parseReference(child(node, 'semanticId')),
    supplementalSemanticIds: parseReferences(child(node, 'supplementalSemanticIds')),
    qualifiers: children(child(node, 'qualifiers'), 'qualifier').map(parseQualifier).filter(Boolean),
  };
}

function parseLangStrings(node, itemName) {
  if (!node) return [];
  return children(node, itemName).map((item) => ({ language: textOf(item, 'language'), text: textOf(item, 'text') })).filter((item) => item.text);
}

function parseDataSpecificationContent(node) {
  if (!node) return null;
  const contentNode = node.children?.[0] ?? null;
  if (!contentNode) return null;
  const content = { modelType: modelTypeFromTag(contentNode.name) };
  for (const field of ['unit', 'symbol', 'dataType', 'definition']) {
    const value = textOf(contentNode, field);
    if (value) content[field] = value;
  }
  const unitId = parseReference(child(contentNode, 'unitId'));
  if (unitId) content.unitId = unitId;
  const preferredName = child(contentNode, 'preferredName');
  if (preferredName) content.preferredName = parseLangStrings(preferredName, 'langStringPreferredNameTypeIec61360');
  return content;
}

function parseEmbeddedDataSpecification(node) {
  if (!node) return null;
  return {
    dataSpecification: parseReference(child(node, 'dataSpecification')),
    dataSpecificationContent: parseDataSpecificationContent(child(node, 'dataSpecificationContent')),
  };
}

function embeddedDataSpecifications(node) {
  return children(child(node, 'embeddedDataSpecifications'), 'embeddedDataSpecification')
    .map(parseEmbeddedDataSpecification)
    .filter(Boolean);
}

function parseSubmodelElement(node) {
  if (!node) return null;
  const name = localName(node.name);
  const modelType = modelTypeFromTag(name);
  const result = { modelType, ...commonFields(node) };
  for (const key of Object.keys(result)) {
    if (result[key] == null || (Array.isArray(result[key]) && result[key].length === 0)) delete result[key];
  }

  if (['property', 'multiLanguageProperty', 'blob', 'file'].includes(name)) {
    const valueType = textOf(node, 'valueType');
    const value = textOf(node, 'value');
    if (valueType) result.valueType = valueType;
    if (value != null) result.value = value;
  } else if (name === 'range') {
    for (const field of ['valueType', 'min', 'max']) {
      const value = textOf(node, field);
      if (value != null) result[field] = value;
    }
  } else if (name === 'relationshipElement' || name === 'annotatedRelationshipElement') {
    result.first = parseReference(child(node, 'first'));
    result.second = parseReference(child(node, 'second'));
  } else if (name === 'referenceElement') {
    result.value = parseReference(child(node, 'value'));
  }

  if (name === 'submodelElementCollection' || name === 'submodelElementList') {
    const valueNode = child(node, 'value');
    result.value = (valueNode?.children ?? []).map(parseSubmodelElement).filter(Boolean);
  }
  if (name === 'entity') {
    const statements = child(node, 'statements');
    result.statements = (statements?.children ?? []).map(parseSubmodelElement).filter(Boolean);
  }
  if (name === 'annotatedRelationshipElement') {
    const annotations = child(node, 'annotations');
    result.annotations = (annotations?.children ?? []).map(parseSubmodelElement).filter(Boolean);
  }

  const embedded = embeddedDataSpecifications(node);
  if (embedded.length) result.embeddedDataSpecifications = embedded;
  return result;
}

function parseSubmodel(node) {
  const submodelElementsNode = child(node, 'submodelElements');
  const result = {
    id: textOf(node, 'id'),
    idShort: textOf(node, 'idShort'),
    semanticId: parseReference(child(node, 'semanticId')),
    supplementalSemanticIds: parseReferences(child(node, 'supplementalSemanticIds')),
    submodelElements: (submodelElementsNode?.children ?? []).map(parseSubmodelElement).filter(Boolean),
  };
  for (const key of Object.keys(result)) if (result[key] == null || (Array.isArray(result[key]) && result[key].length === 0)) delete result[key];
  return result;
}

function parseAssetInformation(node) {
  if (!node) return null;
  const result = {};
  for (const field of ['assetKind', 'globalAssetId', 'assetType']) {
    const value = textOf(node, field);
    if (value) result[field] = value;
  }
  return Object.keys(result).length ? result : null;
}

function parseShell(node) {
  const result = {
    id: textOf(node, 'id'),
    idShort: textOf(node, 'idShort'),
    assetInformation: parseAssetInformation(child(node, 'assetInformation')),
  };
  for (const key of Object.keys(result)) if (result[key] == null) delete result[key];
  return result;
}

function parseConceptDescription(node) {
  const result = {
    id: textOf(node, 'id'),
    idShort: textOf(node, 'idShort'),
    embeddedDataSpecifications: embeddedDataSpecifications(node),
  };
  for (const key of Object.keys(result)) if (result[key] == null || (Array.isArray(result[key]) && result[key].length === 0)) delete result[key];
  return result;
}

function namespaceOf(root) {
  for (const [name, value] of Object.entries(root?.attrs ?? {})) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) return value;
  }
  return null;
}

export function decodeAasXmlEnvironment(xml, options = {}) {
  const parsed = parseXmlTree(xml, options);
  if (parsed.status !== 'accepted') return parsed;
  if (localName(parsed.root.name) !== 'environment') return { status: 'review_required', reason: 'xml_root_not_aas_environment' };
  const namespace = namespaceOf(parsed.root);
  if (!SUPPORTED_AAS_NAMESPACES.has(namespace)) {
    return { status: 'review_required', reason: 'unsupported_aas_xml_namespace', namespace };
  }

  const shellsNode = child(parsed.root, 'assetAdministrationShells');
  const submodelsNode = child(parsed.root, 'submodels');
  const conceptsNode = child(parsed.root, 'conceptDescriptions');
  return {
    status: 'accepted',
    environment: {
      assetAdministrationShells: children(shellsNode, 'assetAdministrationShell').map(parseShell),
      submodels: children(submodelsNode, 'submodel').map(parseSubmodel),
      conceptDescriptions: children(conceptsNode, 'conceptDescription').map(parseConceptDescription),
    },
    namespace,
    nodes: parsed.nodes,
    textBytes: parsed.textBytes,
    version: AAS_XML_ENVIRONMENT_VERSION,
  };
}
