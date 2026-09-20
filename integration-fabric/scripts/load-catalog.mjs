import fs from 'node:fs';

const baseUrl = new URL('../systems.json', import.meta.url);
const primaryResearchUrl = new URL('../systems-research.json', import.meta.url);
const researchOverlaysDir = new URL('../research-overlays/', import.meta.url);

function parseResearchDelta(url, source) {
  const delta = JSON.parse(fs.readFileSync(url, 'utf8'));
  if (delta.schemaVersion !== 1) throw new Error('Unsupported research catalog schemaVersion in ' + source + ': ' + delta.schemaVersion);
  if (!Array.isArray(delta.protocolFamilies) || !Array.isArray(delta.overrides) || !Array.isArray(delta.systems)) {
    throw new Error('Research catalog ' + source + ' must contain protocolFamilies, overrides and systems arrays.');
  }
  return {...delta, source};
}

export function loadResearchDeltas() {
  const deltas = [];
  if (fs.existsSync(primaryResearchUrl)) {
    deltas.push(parseResearchDelta(primaryResearchUrl, 'systems-research.json'));
  }

  if (fs.existsSync(researchOverlaysDir)) {
    const files = fs.readdirSync(researchOverlaysDir, {withFileTypes:true})
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort((a,b) => a.localeCompare(b));
    for (const file of files) {
      deltas.push(parseResearchDelta(new URL('../research-overlays/' + file, import.meta.url), 'research-overlays/' + file));
    }
  }
  return deltas;
}

export function loadResearchDelta() {
  const deltas = loadResearchDeltas();
  const generatedAt = deltas.map(delta => delta.generatedAt).filter(Boolean).sort().at(-1) || null;
  return {
    schemaVersion:1,
    generatedAt,
    protocolFamilies:[...new Set(deltas.flatMap(delta => delta.protocolFamilies))],
    overrides:deltas.flatMap(delta => delta.overrides),
    systems:deltas.flatMap(delta => delta.systems),
    sources:deltas.map(delta => delta.source)
  };
}

export function loadCatalog() {
  const base = JSON.parse(fs.readFileSync(baseUrl, 'utf8'));
  const deltas = loadResearchDeltas();
  const byId = new Map(base.systems.map(system => [system.id, structuredClone(system)]));
  const protocolFamilies = new Set(base.protocolFamilies || []);
  let newSystems = 0;
  let overrides = 0;

  for (const delta of deltas) {
    for (const family of delta.protocolFamilies) protocolFamilies.add(family);

    for (const entry of delta.overrides) {
      if (!entry?.id || !entry?.patch || typeof entry.patch !== 'object' || Array.isArray(entry.patch)) {
        throw new Error('Invalid research override entry in ' + delta.source + '.');
      }
      if (!byId.has(entry.id)) throw new Error('Research override in ' + delta.source + ' targets unknown system: ' + entry.id);
      const current = byId.get(entry.id);
      byId.set(entry.id, {...current, ...structuredClone(entry.patch), id:entry.id});
      overrides += 1;
    }

    for (const system of delta.systems) {
      if (!system?.id) throw new Error('Research system missing id in ' + delta.source + '.');
      if (byId.has(system.id)) throw new Error('Research system in ' + delta.source + ' duplicates existing id: ' + system.id);
      byId.set(system.id, structuredClone(system));
      newSystems += 1;
    }
  }

  const generatedAt = deltas.map(delta => delta.generatedAt).filter(Boolean).sort().at(-1) || null;
  return {
    ...base,
    protocolFamilies:[...protocolFamilies],
    systems:[...byId.values()],
    researchOverlay:{
      source:deltas.length === 1 ? deltas[0].source : 'multiple',
      sources:deltas.map(delta => delta.source),
      newSystems,
      overrides,
      generatedAt
    }
  };
}