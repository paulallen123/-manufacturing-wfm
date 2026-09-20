import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULTS = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  jitterRatio: 0.25,
  circuitFailureThreshold: 4,
  circuitResetMs: 30_000,
  snapshotPath: '.wfm-state/onedrive-master.snapshot.json',
  queueDir: '.wfm-state/onedrive-pending',
});

export class SyncGuardianError extends Error {
  constructor(message, { code = 'SYNC_GUARDIAN_ERROR', cause, details } = {}) {
    super(message, { cause });
    this.name = 'SyncGuardianError';
    this.code = code;
    this.details = details ?? null;
  }
}

export class ConflictError extends SyncGuardianError {
  constructor(message, details) {
    super(message, { code: 'REMOTE_CONFLICT', details });
    this.name = 'ConflictError';
  }
}

export function classifyOneDriveError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0) || null;
  const code = String(error?.code ?? error?.error?.code ?? '').toLowerCase();
  const retryAfterMs = parseRetryAfter(error);

  if (status === 401 || code.includes('invalidauthenticationtoken') || code.includes('unauthenticated')) {
    return { kind: 'auth', retryable: false, status, retryAfterMs };
  }
  if (status === 403 || code.includes('accessdenied')) {
    return { kind: 'permission', retryable: false, status, retryAfterMs };
  }
  if (status === 409 || status === 412 || code.includes('conflict') || code.includes('precondition')) {
    return { kind: 'conflict', retryable: false, status, retryAfterMs };
  }
  if (status === 429) {
    return { kind: 'throttle', retryable: true, status, retryAfterMs };
  }
  if (status && status >= 500) {
    return { kind: 'service', retryable: true, status, retryAfterMs };
  }
  if (['etimedout', 'econnreset', 'enotfound', 'eai_again'].includes(code)) {
    return { kind: 'network', retryable: true, status, retryAfterMs };
  }
  if (status === 404) {
    return { kind: 'not_found', retryable: false, status, retryAfterMs };
  }
  return { kind: 'unknown', retryable: false, status, retryAfterMs };
}

function parseRetryAfter(error) {
  const raw = error?.retryAfterMs ?? error?.headers?.['retry-after'] ?? error?.response?.headers?.['retry-after'];
  if (raw == null) return null;
  if (typeof raw === 'number') return raw > 1000 ? raw : raw * 1000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function normalizeRemote(remote) {
  if (!remote || typeof remote !== 'object') {
    throw new SyncGuardianError('OneDrive adapter returned no remote item.', { code: 'INVALID_REMOTE' });
  }
  const content = remote.content ?? null;
  return {
    itemId: remote.itemId ?? remote.id ?? null,
    driveId: remote.driveId ?? remote.parentReference?.driveId ?? null,
    version: remote.version ?? remote.eTag ?? remote.etag ?? remote.lastModifiedDateTime ?? null,
    lastModifiedDateTime: remote.lastModifiedDateTime ?? null,
    content,
    contentHash: remote.contentHash ?? (content == null ? null : sha256(content)),
    raw: remote,
  };
}

export class OneDriveSyncGuardian {
  constructor({ adapter, target, config = {}, clock = () => Date.now(), sleep = defaultSleep, random = Math.random, logger = console } = {}) {
    if (!adapter) throw new TypeError('adapter is required');
    if (!target?.itemId && !target?.itemUrl) throw new TypeError('target.itemId or target.itemUrl is required');
    this.adapter = adapter;
    this.target = { ...target };
    this.config = { ...DEFAULTS, ...config };
    this.clock = clock;
    this.sleep = sleep;
    this.random = random;
    this.logger = logger;
    this.failureCount = 0;
    this.circuitOpenedAt = null;
  }

  async readMaster() {
    this.#assertCircuitAllowsProbe();
    try {
      const remote = await this.#withRetry(() => this.adapter.fetchExact(this.target), 'fetchExact');
      const normalized = normalizeRemote(remote);
      await this.#saveSnapshot(normalized);
      this.#recordSuccess();
      return { source: 'direct', stale: false, remote: normalized };
    } catch (directError) {
      const directClass = classifyOneDriveError(directError);
      if (directClass.kind === 'auth' || directClass.kind === 'permission' || directClass.kind === 'conflict') {
        this.#recordFailure();
        throw directError;
      }

      if (typeof this.adapter.recoverExact === 'function') {
        try {
          const recovered = await this.#withRetry(() => this.adapter.recoverExact(this.target), 'recoverExact');
          const normalized = normalizeRemote(recovered);
          if (this.target.itemId && normalized.itemId && normalized.itemId !== this.target.itemId) {
            throw new SyncGuardianError('Fallback resolved a different OneDrive item.', {
              code: 'FALLBACK_IDENTITY_MISMATCH',
              details: { expected: this.target.itemId, actual: normalized.itemId },
            });
          }
          await this.#saveSnapshot(normalized);
          this.#recordSuccess();
          return { source: 'fallback', stale: false, remote: normalized, directError };
        } catch (fallbackError) {
          this.#recordFailure();
          const snapshot = await this.#loadSnapshot();
          if (snapshot) {
            return { source: 'snapshot', stale: true, remote: snapshot, directError, fallbackError };
          }
          throw new SyncGuardianError('OneDrive direct and fallback reads failed and no last-known-good snapshot exists.', {
            code: 'READ_UNAVAILABLE',
            cause: fallbackError,
            details: { direct: summarizeError(directError), fallback: summarizeError(fallbackError) },
          });
        }
      }

      this.#recordFailure();
      const snapshot = await this.#loadSnapshot();
      if (snapshot) return { source: 'snapshot', stale: true, remote: snapshot, directError };
      throw directError;
    }
  }

  async applyChange({ description, baseVersion = null, delta, merge }) {
    if (typeof merge !== 'function') throw new TypeError('merge function is required');
    const read = await this.readMaster();
    if (read.stale) {
      const queued = await this.queueDelta({ description, baseVersion: baseVersion ?? read.remote.version, delta });
      return { status: 'queued', reason: 'remote-unavailable', queued, read };
    }

    const remote = read.remote;
    if (baseVersion && remote.version && baseVersion !== remote.version) {
      throw new ConflictError('Remote master changed since the change was prepared.', {
        expectedVersion: baseVersion,
        actualVersion: remote.version,
      });
    }

    const nextContent = await merge(remote.content, delta, remote);
    if (nextContent == null) throw new SyncGuardianError('merge returned no content', { code: 'EMPTY_MERGE' });
    const change = {
      id: randomUUID(),
      description: description ?? 'queued WFM OneDrive change',
      createdAt: new Date(this.clock()).toISOString(),
      baseVersion: remote.version,
      baseHash: remote.contentHash,
      delta,
      nextHash: sha256(nextContent),
    };

    try {
      const result = await this.#withRetry(
        () => this.adapter.writeExact(this.target, nextContent, { expectedVersion: remote.version, expectedHash: remote.contentHash }),
        'writeExact',
      );
      const normalized = normalizeRemote({ ...result, content: result?.content ?? nextContent });
      await this.#saveSnapshot(normalized);
      this.#recordSuccess();
      return { status: 'written', change, remote: normalized };
    } catch (error) {
      const classification = classifyOneDriveError(error);
      if (classification.kind === 'conflict') {
        throw new ConflictError('OneDrive rejected the write because the master changed concurrently.', {
          expectedVersion: remote.version,
          error: summarizeError(error),
        });
      }
      if (classification.kind === 'auth' || classification.kind === 'permission') throw error;
      const queued = await this.queueDelta({ ...change, delta });
      this.#recordFailure();
      return { status: 'queued', reason: classification.kind, queued, error };
    }
  }

  async queueDelta(entry) {
    await mkdir(this.config.queueDir, { recursive: true });
    const id = entry.id ?? randomUUID();
    const createdAt = entry.createdAt ?? new Date(this.clock()).toISOString();
    const record = { id, createdAt, ...entry };
    const path = join(this.config.queueDir, `${createdAt.replace(/[:.]/g, '-')}-${id}.json`);
    await atomicWriteJson(path, record);
    return { path, record };
  }

  async flushQueue({ merge }) {
    if (typeof merge !== 'function') throw new TypeError('merge function is required');
    await mkdir(this.config.queueDir, { recursive: true });
    const files = (await readdir(this.config.queueDir)).filter((name) => name.endsWith('.json')).sort();
    const results = [];
    for (const name of files) {
      const path = join(this.config.queueDir, name);
      const queued = JSON.parse(await readFile(path, 'utf8'));
      try {
        const result = await this.applyChange({
          description: queued.description,
          baseVersion: queued.baseVersion,
          delta: queued.delta,
          merge,
        });
        results.push({ path, ...result });
        if (result.status === 'written') await unlink(path);
        if (result.status !== 'written') break;
      } catch (error) {
        results.push({ path, status: 'blocked', error });
        break;
      }
    }
    return results;
  }

  circuitState() {
    if (this.circuitOpenedAt == null) return { state: 'closed', failureCount: this.failureCount };
    const remainingMs = Math.max(0, this.config.circuitResetMs - (this.clock() - this.circuitOpenedAt));
    return { state: remainingMs > 0 ? 'open' : 'half-open', failureCount: this.failureCount, remainingMs };
  }

  async #withRetry(operation, operationName) {
    let lastError;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const classification = classifyOneDriveError(error);
        if (!classification.retryable || attempt === this.config.maxAttempts) throw error;
        const exponential = Math.min(this.config.maxDelayMs, this.config.baseDelayMs * 2 ** (attempt - 1));
        const jitter = exponential * this.config.jitterRatio * (this.random() * 2 - 1);
        const delayMs = Math.max(0, classification.retryAfterMs ?? Math.round(exponential + jitter));
        this.logger?.warn?.(`[OneDriveSyncGuardian] ${operationName} attempt ${attempt} failed (${classification.kind}); retrying in ${delayMs}ms`);
        await this.sleep(delayMs);
      }
    }
    throw lastError;
  }

  #assertCircuitAllowsProbe() {
    const state = this.circuitState();
    if (state.state === 'open') {
      throw new SyncGuardianError('OneDrive circuit breaker is open; using queued/snapshot mode until the reset interval.', {
        code: 'CIRCUIT_OPEN',
        details: state,
      });
    }
    if (state.state === 'half-open') this.circuitOpenedAt = null;
  }

  #recordSuccess() {
    this.failureCount = 0;
    this.circuitOpenedAt = null;
  }

  #recordFailure() {
    this.failureCount += 1;
    if (this.failureCount >= this.config.circuitFailureThreshold && this.circuitOpenedAt == null) {
      this.circuitOpenedAt = this.clock();
    }
  }

  async #saveSnapshot(remote) {
    const snapshot = {
      itemId: remote.itemId,
      driveId: remote.driveId,
      version: remote.version,
      lastModifiedDateTime: remote.lastModifiedDateTime,
      content: remote.content,
      contentHash: remote.contentHash,
      savedAt: new Date(this.clock()).toISOString(),
    };
    await atomicWriteJson(this.config.snapshotPath, snapshot);
  }

  async #loadSnapshot() {
    try {
      return JSON.parse(await readFile(this.config.snapshotPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeError(error) {
  if (!error) return null;
  return {
    name: error.name ?? 'Error',
    message: error.message ?? String(error),
    status: error.status ?? error.statusCode ?? null,
    code: error.code ?? null,
  };
}
