import fs from 'node:fs';

const baseUrl = new URL('../systems.json', import.meta.url);
const researchUrl = new URL('../systems-research.json', import.meta.url);

export function loadResearchDelta() {
  if (!fs.existsSync(researchUrl)) {
    return {schemaVersion:1, protocolFamilies:[], overrides:[], systems:[]};
  }
  const delta = JSON.parse(fs.readFileSync(researchUrl, 'utf8'));
  if (delta.schemaVersion !== 1) throw new Error('Unsupported research catalog schemaVersion: ' + delta.schemaVersion);
  if (!Array.isArray(delta.protocolFamilies) || !Array.isArray(delta.overrides) || !Array.isArray(delta.systems)) {
    throw new Error('Research catalog must contain protocolFamilies, overrides and systems arrays.');
  }
  return delta;
}

export function loadCatalog() {
  const base = JSON.parse(fs.readFileSync(baseUrl, 'utf8'));
  const delta = loadResearchDelta();
  const byId = new Map(base.systems.map(system => [system.id, structuredClone(system)]));

  for (const entry of delta.overrides) {
    if (!entry?.id || !entry?.patch || typeof entry.patch !== 'object' || Array.isArray(entry.patch)) {
      throw new Error('Invalid research override entry.');
    }
    if (!byId.has(entry.id)) throw new Error('Research override targets unknown system: ' + entry.id);
    const current = byId.get(entry.id);
    byId.set(entry.id, {...current, ...structuredClone(entry.patch), id:entry.id});
  }

  for (const system of delta.systems) {
    if (!system?.id) throw new Error('Research system missing id.');
    if (byId.has(system.id)) throw new Error('Research system duplicates existing id: ' + system.id);
    byId.set(system.id, structuredClone(system));
  }

  return {
    ...base,
    protocolFamilies:[...new Set([...(base.protocolFamilies || []), ...delta.protocolFamilies])],
    systems:[...byId.values()],
    researchOverlay:{
      source:'systems-research.json',
      newSystems:delta.systems.length,
      overrides:delta.overrides.length,
      generatedAt:delta.generatedAt || null
    }
  };
}
