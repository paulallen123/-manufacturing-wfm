function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function isoMs(value, label) {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} must be ISO date-time`);
  return Date.parse(value);
}
function normalizeFilterSet(values) {
  if (values === undefined) return null;
  assert(Array.isArray(values), 'filter must be an array');
  return new Set(values.filter(Boolean));
}

export function buildOperationalHistory(graph, { lateAfterMs = 60_000 } = {}) {
  assert(graph && Array.isArray(graph.events) && typeof graph.entityById === 'function', 'factory graph is required');
  assert(Number.isFinite(lateAfterMs) && lateAfterMs >= 0, 'lateAfterMs must be a non-negative number');
  const eventById = new Map();
  const normalized = graph.events.map((event, index) => {
    assert(!eventById.has(event.id), `duplicate operational event id: ${event.id}`);
    const occurredMs = isoMs(event.occurredAt, `event:${index}.occurredAt`);
    const observedMs = isoMs(event.evidence?.observedAt, `event:${index}.evidence.observedAt`);
    assert(Array.isArray(event.entityIds) && event.entityIds.length > 0, `event:${index}.entityIds are required`);
    const row = Object.freeze({
      ...event,
      occurredMs,
      observedMs,
      ingestionDelayMs: Math.max(0, observedMs - occurredMs),
      lateArrival: Math.max(0, observedMs - occurredMs) > lateAfterMs
    });
    eventById.set(event.id, row);
    return row;
  });

  const ordered = Object.freeze([...normalized].sort((a,b) =>
    a.occurredMs - b.occurredMs || a.observedMs - b.observedMs || a.id.localeCompare(b.id)
  ));

  function eventsInWindow({ from, to, knownAt = to, entityIds, kinds } = {}) {
    const fromMs = isoMs(from, 'from');
    const toMs = isoMs(to, 'to');
    const knownAtMs = isoMs(knownAt, 'knownAt');
    assert(fromMs <= toMs, 'from must be <= to');
    const entityFilter = normalizeFilterSet(entityIds);
    const kindFilter = normalizeFilterSet(kinds);
    return Object.freeze(ordered.filter((event) => {
      if (event.occurredMs < fromMs || event.occurredMs > toMs) return false;
      // Prevent hindsight leakage: an event cannot appear in a replay until it was actually observed.
      if (event.observedMs > knownAtMs) return false;
      if (entityFilter && !event.entityIds.some((id) => entityFilter.has(id))) return false;
      if (kindFilter && !kindFilter.has(event.kind)) return false;
      return true;
    }));
  }

  function incidentBundle({ anchorEventId, beforeMs = 15 * 60_000, afterMs = 15 * 60_000, knownAt }) {
    const anchor = eventById.get(anchorEventId);
    assert(anchor, `unknown anchor event: ${anchorEventId}`);
    assert(Number.isFinite(beforeMs) && beforeMs >= 0, 'beforeMs must be non-negative');
    assert(Number.isFinite(afterMs) && afterMs >= 0, 'afterMs must be non-negative');
    const start = new Date(anchor.occurredMs - beforeMs).toISOString();
    const end = new Date(anchor.occurredMs + afterMs).toISOString();
    const visible = eventsInWindow({
      from: start,
      to: end,
      knownAt: knownAt ?? end,
      entityIds: anchor.entityIds
    });
    const evidenceRefs = [...new Set(visible.map((e) => e.evidence?.sourceRef).filter(Boolean))];
    return Object.freeze({
      anchorEventId,
      from: start,
      to: end,
      knownAt: knownAt ?? end,
      relatedEntityIds: Object.freeze([...anchor.entityIds]),
      events: visible,
      evidenceRefs: Object.freeze(evidenceRefs),
      claimBoundary: 'Sequence/context only. Temporal adjacency does not prove causality.'
    });
  }

  function dataQuality() {
    const late = ordered.filter((e) => e.lateArrival);
    return Object.freeze({
      eventCount: ordered.length,
      lateArrivalCount: late.length,
      maxIngestionDelayMs: late.reduce((max,e)=>Math.max(max,e.ingestionDelayMs),0),
      lateEventIds: Object.freeze(late.map((e)=>e.id))
    });
  }

  return Object.freeze({ orderedEvents: ordered, eventsInWindow, incidentBundle, dataQuality });
}
