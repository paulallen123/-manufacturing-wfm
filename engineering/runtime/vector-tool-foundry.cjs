'use strict';

const { createHash, randomUUID } = require('node:crypto');

const TOOL_LIFECYCLE = Object.freeze({
  PROPOSED: 'PROPOSED',
  SHADOW: 'SHADOW',
  CERTIFIED: 'CERTIFIED',
  DEPRECATED: 'DEPRECATED',
});

const EXECUTION_MODES = new Set(['SHADOW', 'EXECUTE']);
const ENVIRONMENTS = new Set(['LOCAL', 'CI', 'PROOF', 'STAGING', 'PRODUCTION']);
const MUTATION_CLASSES = new Set(['NONE', 'EPHEMERAL', 'PERSISTENT']);
const VALID_TRANSITIONS = Object.freeze({
  PROPOSED: new Set(['SHADOW', 'DEPRECATED']),
  SHADOW: new Set(['CERTIFIED', 'DEPRECATED']),
  CERTIFIED: new Set(['DEPRECATED']),
  DEPRECATED: new Set(),
});

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 240) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function deny(code, message, detail = null) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function normalizeVersion(value) {
  const version = clean(value, 40);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    deny('VECTOR_FOUNDRY_VERSION', 'Tool and pipeline versions must be explicit semantic versions.');
  }
  return version;
}

function normalizeEnvironment(value) {
  const environment = clean(value || 'PROOF', 40).toUpperCase();
  if (!ENVIRONMENTS.has(environment)) deny('VECTOR_FOUNDRY_ENVIRONMENT', 'Unsupported engineering environment.');
  return environment;
}

function normalizeMode(value) {
  const mode = clean(value || 'SHADOW', 40).toUpperCase();
  if (!EXECUTION_MODES.has(mode)) deny('VECTOR_FOUNDRY_MODE', 'Unsupported tool execution mode.');
  return mode;
}

function exactCommit(value) {
  const commit = clean(value, 80);
  return /^[a-f0-9]{40}$/.test(commit) ? commit : null;
}

function keyFor(id, version) {
  return clean(id, 180) + '@' + normalizeVersion(version);
}

class VectorToolFoundry {
  constructor({ now = Date.now, principal = 'vector-engineering-plane' } = {}) {
    this.now = now;
    this.principal = clean(principal, 160) || 'vector-engineering-plane';
    this.tools = new Map();
    this.pipelines = new Map();
    this.runLog = [];
    this.lifecycleLog = [];
    this.runHeadDigest = digest({ contract: 'VECTOR_FOUNDRY_RUN_LEDGER_V1', genesis: true });
    this.lifecycleHeadDigest = digest({ contract: 'VECTOR_FOUNDRY_LIFECYCLE_LEDGER_V1', genesis: true });
  }

  registerTool(spec = {}) {
    const id = clean(spec.id, 180);
    const version = normalizeVersion(spec.version);
    const key = keyFor(id, version);
    if (!id) deny('VECTOR_FOUNDRY_TOOL_ID', 'Tool id is required.');
    if (this.tools.has(key)) deny('VECTOR_FOUNDRY_TOOL_IMMUTABLE', 'Registered tool versions are immutable; create a new version instead.');
    if (typeof spec.handler !== 'function') deny('VECTOR_FOUNDRY_HANDLER', 'Tool handler is required.');

    const lifecycle = clean(spec.lifecycle || TOOL_LIFECYCLE.PROPOSED, 40).toUpperCase();
    if (!(lifecycle in TOOL_LIFECYCLE)) deny('VECTOR_FOUNDRY_LIFECYCLE', 'Unsupported tool lifecycle.');

    const mutationClass = clean(spec.mutationClass || 'NONE', 40).toUpperCase();
    if (!MUTATION_CLASSES.has(mutationClass)) deny('VECTOR_FOUNDRY_MUTATION', 'Unsupported mutation class.');

    const allowedEnvironments = [...new Set((spec.allowedEnvironments || ['LOCAL', 'CI', 'PROOF']).map(normalizeEnvironment))];
    if (allowedEnvironments.includes('PRODUCTION')) {
      deny('VECTOR_FOUNDRY_PRODUCTION_BOUNDARY', 'Engineering-plane tools cannot register production as an execution environment.');
    }
    if (spec.mayTouchCustomerData === true) {
      deny('VECTOR_FOUNDRY_CUSTOMER_DATA_BOUNDARY', 'Engineering-plane tools cannot be registered to consume raw customer data.');
    }
    if (spec.mayWriteExternalSystems === true) {
      deny('VECTOR_FOUNDRY_EXTERNAL_WRITE_BOUNDARY', 'Engineering-plane tools cannot directly write external/customer systems.');
    }

    const record = Object.freeze({
      contractVersion: 'VECTOR_FOUNDRY_TOOL_V1',
      id,
      version,
      purpose: clean(spec.purpose, 400),
      owner: clean(spec.owner || this.principal, 160),
      lifecycle,
      mutationClass,
      allowedEnvironments,
      requiresExactSource: spec.requiresExactSource === true,
      inputContract: clone(spec.inputContract || null),
      outputContract: clone(spec.outputContract || null),
      mayTouchCustomerData: false,
      mayWriteExternalSystems: false,
      handler: spec.handler,
      registeredAt: new Date(this.now()).toISOString(),
      registrationDigest: digest({
        id,
        version,
        purpose: clean(spec.purpose, 400),
        owner: clean(spec.owner || this.principal, 160),
        lifecycle,
        mutationClass,
        allowedEnvironments,
        requiresExactSource: spec.requiresExactSource === true,
        inputContract: clone(spec.inputContract || null),
        outputContract: clone(spec.outputContract || null),
      }),
    });

    this.tools.set(key, record);
    return this.describeTool(id, version);
  }

  describeTool(id, version) {
    const tool = this.tools.get(keyFor(id, version));
    if (!tool) return null;
    const { handler, ...publicRecord } = tool;
    return clone(publicRecord);
  }

  inventory() {
    return [...this.tools.values()]
      .map(({ handler, ...tool }) => clone(tool))
      .sort((a, b) => (a.id + '@' + a.version).localeCompare(b.id + '@' + b.version));
  }

  transitionLifecycle(input = {}) {
    const id = clean(input.toolId, 180);
    const version = normalizeVersion(input.version);
    const key = keyFor(id, version);
    const tool = this.tools.get(key);
    if (!tool) deny('VECTOR_FOUNDRY_TOOL_NOT_FOUND', 'Tool not found for lifecycle transition.');

    const to = clean(input.to, 40).toUpperCase();
    if (!(to in TOOL_LIFECYCLE)) deny('VECTOR_FOUNDRY_LIFECYCLE', 'Unsupported tool lifecycle target.');
    if (!VALID_TRANSITIONS[tool.lifecycle].has(to)) deny('VECTOR_FOUNDRY_LIFECYCLE_TRANSITION', 'Lifecycle transition is not permitted.');

    const actor = clean(input.actor, 160);
    if (!actor || actor === tool.owner || actor === this.principal) {
      deny('VECTOR_FOUNDRY_INDEPENDENT_GOVERNANCE', 'Lifecycle promotion requires an independent governance principal.');
    }
    const evidenceRefs = [...new Set((input.evidenceRefs || []).map((value) => clean(value, 180)).filter(Boolean))];
    if (input.verified !== true || evidenceRefs.length === 0) {
      deny('VECTOR_FOUNDRY_PROMOTION_EVIDENCE', 'Verified independent evidence is required for lifecycle promotion.');
    }
    if (to === TOOL_LIFECYCLE.CERTIFIED && !exactCommit(input.sourceCommit)) {
      deny('VECTOR_FOUNDRY_CERTIFICATION_SOURCE', 'Certification requires an exact 40-character source commit.');
    }

    const next = Object.freeze({ ...tool, lifecycle: to });
    this.tools.set(key, next);

    const core = {
      contractVersion: 'VECTOR_FOUNDRY_LIFECYCLE_EVENT_V1',
      eventId: clean(input.eventId || randomUUID(), 120),
      toolId: id,
      version,
      from: tool.lifecycle,
      to,
      actor,
      evidenceRefs,
      sourceCommit: exactCommit(input.sourceCommit),
      occurredAt: new Date(this.now()).toISOString(),
      previousDigest: this.lifecycleHeadDigest,
    };
    const event = Object.freeze({ ...core, eventDigest: digest(core) });
    this.lifecycleLog.push(event);
    this.lifecycleHeadDigest = event.eventDigest;
    return clone(event);
  }

  registerPipeline(spec = {}) {
    const id = clean(spec.id, 180);
    const version = normalizeVersion(spec.version);
    if (!id) deny('VECTOR_FOUNDRY_PIPELINE_ID', 'Pipeline id is required.');
    const key = keyFor(id, version);
    if (this.pipelines.has(key)) deny('VECTOR_FOUNDRY_PIPELINE_IMMUTABLE', 'Registered pipeline versions are immutable.');
    if (!Array.isArray(spec.steps) || spec.steps.length === 0) deny('VECTOR_FOUNDRY_PIPELINE_STEPS', 'Pipeline requires at least one step.');

    const aliases = new Set();
    const steps = spec.steps.map((step, index) => {
      const alias = clean(step.alias || `step-${index + 1}`, 120);
      if (!alias || aliases.has(alias)) deny('VECTOR_FOUNDRY_PIPELINE_ALIAS', 'Pipeline step aliases must be unique.');
      aliases.add(alias);
      const toolId = clean(step.toolId, 180);
      const toolVersion = normalizeVersion(step.version);
      if (!this.tools.has(keyFor(toolId, toolVersion))) deny('VECTOR_FOUNDRY_PIPELINE_TOOL', 'Pipeline references an unregistered tool.');
      return Object.freeze({ alias, toolId, version: toolVersion, mode: normalizeMode(step.mode || 'SHADOW') });
    });

    const pipeline = Object.freeze({
      contractVersion: 'VECTOR_FOUNDRY_PIPELINE_V1',
      id,
      version,
      purpose: clean(spec.purpose, 400),
      steps,
      registeredAt: new Date(this.now()).toISOString(),
      pipelineDigest: digest({ id, version, purpose: clean(spec.purpose, 400), steps }),
    });
    this.pipelines.set(key, pipeline);
    return clone(pipeline);
  }

  async executeTool(input = {}) {
    const toolId = clean(input.toolId, 180);
    const version = normalizeVersion(input.version);
    const tool = this.tools.get(keyFor(toolId, version));
    if (!tool) deny('VECTOR_FOUNDRY_TOOL_NOT_FOUND', 'Tool not found.');

    const environment = normalizeEnvironment(input.environment || 'PROOF');
    const mode = normalizeMode(input.mode || 'SHADOW');
    if (environment === 'PRODUCTION') deny('VECTOR_FOUNDRY_PRODUCTION_BOUNDARY', 'Engineering-plane execution is prohibited in production.');
    if (!tool.allowedEnvironments.includes(environment)) deny('VECTOR_FOUNDRY_ENVIRONMENT_DENIED', 'Tool is not permitted in this environment.');
    if (tool.lifecycle === TOOL_LIFECYCLE.DEPRECATED) deny('VECTOR_FOUNDRY_DEPRECATED', 'Deprecated tools cannot execute.');
    if (tool.lifecycle === TOOL_LIFECYCLE.PROPOSED) deny('VECTOR_FOUNDRY_UNPROVEN', 'Proposed tools cannot execute; promote to SHADOW with independent evidence first.');
    if (tool.lifecycle === TOOL_LIFECYCLE.SHADOW && mode !== 'SHADOW') deny('VECTOR_FOUNDRY_SHADOW_ONLY', 'Shadow tools cannot execute in active mode.');
    if (tool.lifecycle !== TOOL_LIFECYCLE.CERTIFIED && tool.mutationClass === 'PERSISTENT') {
      deny('VECTOR_FOUNDRY_MUTATION_UNCERTIFIED', 'Persistent mutation requires a certified tool.');
    }

    const sourceRef = clean(input.sourceRef, 200);
    const sourceCommit = exactCommit(input.sourceCommit);
    if (!sourceRef && !sourceCommit) deny('VECTOR_FOUNDRY_SOURCE', 'Every tool run must be bound to a source reference or exact source commit.');
    if (tool.requiresExactSource && !sourceCommit) deny('VECTOR_FOUNDRY_EXACT_SOURCE', 'This tool requires an exact 40-character source commit.');

    const startedAt = new Date(this.now()).toISOString();
    const runId = clean(input.runId || randomUUID(), 120);
    const toolInput = clone(input.input || {});
    const context = Object.freeze({
      environment,
      mode,
      sourceRef: sourceRef || null,
      sourceCommit,
      approvalRef: input.approvalRef ? clean(input.approvalRef, 180) : null,
      engineeringOnly: true,
      customerDataAllowed: false,
      productionMutationAllowed: false,
    });

    let output = null;
    let status = 'PASS';
    let failure = null;
    try {
      output = await tool.handler(Object.freeze(clone(toolInput)), context);
    } catch (error) {
      status = 'FAIL';
      failure = {
        code: clean(error?.code || 'VECTOR_FOUNDRY_TOOL_FAILURE', 120),
        message: clean(error?.message || 'Tool execution failed.', 400),
      };
    }

    const completedAt = new Date(this.now()).toISOString();
    const core = {
      contractVersion: 'VECTOR_FOUNDRY_RUN_RECEIPT_V1',
      runId,
      toolId,
      version,
      lifecycle: tool.lifecycle,
      environment,
      mode,
      mutationClass: tool.mutationClass,
      sourceRef: sourceRef || null,
      sourceCommit,
      inputDigest: digest(toolInput),
      outputDigest: digest(output),
      status,
      failure,
      startedAt,
      completedAt,
      previousDigest: this.runHeadDigest,
    };
    const receipt = Object.freeze({ ...core, receiptDigest: digest(core) });
    this.runLog.push(receipt);
    this.runHeadDigest = receipt.receiptDigest;

    if (status !== 'PASS') {
      const error = new Error(failure.message);
      error.code = failure.code;
      error.receipt = clone(receipt);
      throw error;
    }

    return Object.freeze({ output: clone(output), receipt: clone(receipt) });
  }

  async executePipeline(input = {}) {
    const pipelineId = clean(input.pipelineId, 180);
    const version = normalizeVersion(input.version);
    const pipeline = this.pipelines.get(keyFor(pipelineId, version));
    if (!pipeline) deny('VECTOR_FOUNDRY_PIPELINE_NOT_FOUND', 'Pipeline not found.');

    const results = [];
    for (const step of pipeline.steps) {
      const stepInput = clone(input.inputs?.[step.alias] || {});
      try {
        const result = await this.executeTool({
          toolId: step.toolId,
          version: step.version,
          environment: input.environment,
          mode: step.mode,
          sourceRef: input.sourceRef,
          sourceCommit: input.sourceCommit,
          approvalRef: input.approvalRef,
          input: stepInput,
        });
        results.push({ alias: step.alias, status: 'PASS', receipt: result.receipt, output: result.output });
      } catch (error) {
        results.push({ alias: step.alias, status: 'FAIL', receipt: clone(error.receipt || null), error: { code: error.code || 'FAIL', message: clean(error.message, 400) } });
        break;
      }
    }

    const status = results.length === pipeline.steps.length && results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL';
    return Object.freeze({
      contractVersion: 'VECTOR_FOUNDRY_PIPELINE_RECEIPT_V1',
      pipelineId,
      version,
      status,
      results: clone(results),
      resultDigest: digest({ pipelineId, version, status, results: results.map((result) => ({ alias: result.alias, status: result.status, receiptDigest: result.receipt?.receiptDigest || null })) }),
    });
  }

  proposeToolRevision(input = {}) {
    const tool = this.tools.get(keyFor(input.toolId, input.fromVersion));
    if (!tool) deny('VECTOR_FOUNDRY_TOOL_NOT_FOUND', 'Existing tool version is required before proposing a revision.');
    const proposedVersion = normalizeVersion(input.proposedVersion);
    if (this.tools.has(keyFor(tool.id, proposedVersion))) deny('VECTOR_FOUNDRY_TOOL_IMMUTABLE', 'Proposed version already exists.');
    const evidenceRefs = [...new Set((input.evidenceRefs || []).map((value) => clean(value, 180)).filter(Boolean))];
    if (!evidenceRefs.length) deny('VECTOR_FOUNDRY_REVISION_EVIDENCE', 'Revision proposals require evidence.');

    const core = {
      contractVersion: 'VECTOR_FOUNDRY_REVISION_PROPOSAL_V1',
      proposalId: clean(input.proposalId || randomUUID(), 120),
      toolId: tool.id,
      fromVersion: tool.version,
      proposedVersion,
      reason: clean(input.reason, 500),
      changes: clone(input.changes || []),
      evidenceRefs,
      createdAt: new Date(this.now()).toISOString(),
      governance: {
        mode: 'PROPOSAL_ONLY',
        maySelfRegister: false,
        maySelfCertify: false,
        requiresIndependentReview: true,
      },
    };
    return Object.freeze({ ...core, proposalDigest: digest(core) });
  }

  verifyRunLedger() {
    let previous = digest({ contract: 'VECTOR_FOUNDRY_RUN_LEDGER_V1', genesis: true });
    for (const row of this.runLog) {
      if (row.previousDigest !== previous) return false;
      const core = { ...row };
      delete core.receiptDigest;
      if (digest(core) !== row.receiptDigest) return false;
      previous = row.receiptDigest;
    }
    return previous === this.runHeadDigest;
  }

  verifyLifecycleLedger() {
    let previous = digest({ contract: 'VECTOR_FOUNDRY_LIFECYCLE_LEDGER_V1', genesis: true });
    for (const row of this.lifecycleLog) {
      if (row.previousDigest !== previous) return false;
      const core = { ...row };
      delete core.eventDigest;
      if (digest(core) !== row.eventDigest) return false;
      previous = row.eventDigest;
    }
    return previous === this.lifecycleHeadDigest;
  }
}

module.exports = Object.freeze({
  TOOL_LIFECYCLE,
  VectorToolFoundry,
  stable,
  digest,
});
