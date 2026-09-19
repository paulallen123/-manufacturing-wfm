import { assessCapabilityCoverage } from './factory-capability-graph.mjs';
import { evaluateCapabilityRequirement } from './factory-capability-envelope.mjs';

export const PROCESS_CAPABILITY_READINESS_VERSION = 'factory-capability-process-readiness-v0.1.1';

function minimumQualifiedPeople(step) {
  const value = Number(step?.minimumQualifiedPeople ?? 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function validStep(step) {
  return Boolean(
    step?.stepId &&
    step?.requirement?.capabilityId &&
    Array.isArray(step.requirement.constraints) &&
    minimumQualifiedPeople(step) != null,
  );
}

function bestTechnicalAssessment(asset, requirement, capabilityHierarchy, maxHierarchyDepth) {
  const assessments = [];
  for (const capability of asset?.capabilities ?? []) {
    if (!capability?.capabilityId || capability?.role === 'required') continue;
    assessments.push({
      capabilityId: capability.capabilityId,
      ...evaluateCapabilityRequirement(
        {
          assetId: asset.assetId,
          capabilityId: capability.capabilityId,
          properties: capability.properties ?? [],
          source: capability.source ?? asset?.source?.provider ?? null,
          standardProfile: capability?.evidence?.profileVersion ?? asset?.semanticModel ?? null,
        },
        requirement,
        { capabilityHierarchy, maxHierarchyDepth },
      ),
    });
  }

  const feasible = assessments.find((item) => item.status === 'feasible');
  if (feasible) return feasible;
  const unknown = assessments.find((item) => item.status === 'unknown');
  if (unknown) return unknown;
  if (assessments.length) return assessments[0];
  return { status: 'infeasible', reason: 'asset_has_no_mapped_capabilities', checks: [] };
}

function planStatus(stepResults) {
  if (stepResults.every((step) => step.status === 'ready')) return 'ready';
  if (stepResults.some((step) => step.status === 'review_required')) return 'review_required';
  if (stepResults.some((step) => step.status === 'not_ready')) return 'not_ready';
  return 'not_feasible';
}

function buildDemand(graph, steps) {
  const byCapability = new Map();
  for (const step of steps.filter(validStep)) {
    const capabilityId = step.requirement.capabilityId;
    const minimum = minimumQualifiedPeople(step);
    const previous = byCapability.get(capabilityId) ?? 0;
    byCapability.set(capabilityId, Math.max(previous, minimum));
  }
  return [...byCapability.entries()].map(([capabilityId, minimumQualifiedPeople]) => ({
    tenantId: graph.scope.tenantId,
    siteId: graph.scope.siteId,
    capabilityId,
    minimumQualifiedPeople,
  }));
}

export function buildProcessCapabilityReadinessMask({
  graph,
  steps = [],
  capabilityHierarchy = [],
  maxHierarchyDepth = 16,
} = {}) {
  if (!graph?.scope?.tenantId || !graph?.scope?.siteId || !Array.isArray(graph?.assets)) {
    return { status: 'rejected', reason: 'invalid_capability_graph' };
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return { status: 'rejected', reason: 'process_steps_required' };
  }

  const coverage = assessCapabilityCoverage(graph, { demand: buildDemand(graph, steps) });
  const coverageByCapability = new Map(coverage.map((item) => [item.capabilityId, item]));

  const stepResults = [];
  let technicallyFeasibleAssignments = 0;
  let eligibleAssignments = 0;
  let reviewAssignments = 0;

  for (const step of steps) {
    if (!validStep(step)) {
      stepResults.push({
        stepId: step?.stepId ?? null,
        status: 'review_required',
        reason: 'invalid_process_step_requirement',
        candidates: [],
        eligibleAssetIds: [],
      });
      continue;
    }

    const requirement = step.requirement;
    const workforceCoverage = coverageByCapability.get(requirement.capabilityId) ?? null;
    const candidates = [];

    for (const asset of graph.assets) {
      const technical = bestTechnicalAssessment(asset, requirement, capabilityHierarchy, maxHierarchyDepth);
      let status = 'infeasible';
      let reason = technical.reason;

      if (technical.status === 'feasible') {
        technicallyFeasibleAssignments += 1;
        if (!workforceCoverage) {
          status = 'review_required';
          reason = 'workforce_requirement_missing';
          reviewAssignments += 1;
        } else if (workforceCoverage.status === 'ready') {
          status = 'eligible';
          reason = 'technical_and_workforce_requirements_met';
          eligibleAssignments += 1;
        } else {
          status = 'not_ready';
          reason = 'workforce_capability_gap';
        }
      } else if (technical.status === 'unknown') {
        status = 'review_required';
        reason = technical.reason;
        reviewAssignments += 1;
      }

      candidates.push({
        assetId: asset.assetId,
        status,
        reason,
        technicalStatus: technical.status,
        capabilityId: technical.capabilityId ?? null,
        checks: technical.checks ?? [],
      });
    }

    const eligibleAssetIds = candidates.filter((item) => item.status === 'eligible').map((item) => item.assetId);
    const hasReview = candidates.some((item) => item.status === 'review_required');
    const hasWorkforceGap = candidates.some((item) => item.status === 'not_ready');
    const status = eligibleAssetIds.length > 0
      ? 'ready'
      : hasReview
        ? 'review_required'
        : hasWorkforceGap
          ? 'not_ready'
          : 'not_feasible';
    const reason = status === 'ready'
      ? 'at_least_one_confirmed_assignment'
      : status === 'review_required'
        ? 'candidate_evidence_requires_review'
        : status === 'not_ready'
          ? 'technical_capacity_exists_but_workforce_gap_remains'
          : 'no_asset_meets_requirement';

    stepResults.push({
      stepId: step.stepId,
      label: step.label ?? step.stepId,
      requirement,
      minimumQualifiedPeople: minimumQualifiedPeople(step),
      workforceCoverage,
      status,
      reason,
      eligibleAssetIds,
      candidates,
    });
  }

  const totalCandidateAssignments = steps.length * graph.assets.length;
  const technicalPruningPct = totalCandidateAssignments === 0
    ? 0
    : 1 - (technicallyFeasibleAssignments / totalCandidateAssignments);

  return {
    status: 'accepted',
    planStatus: planStatus(stepResults),
    steps: stepResults,
    metrics: {
      stepCount: steps.length,
      assetCount: graph.assets.length,
      totalCandidateAssignments,
      technicallyFeasibleAssignments,
      eligibleAssignments,
      reviewAssignments,
      technicalPruningPct,
    },
    authorityBoundary: 'Advisory pre-solver readiness only. This module cannot publish schedules, assign workers, mutate payroll, grant qualifications, or actuate equipment.',
    version: PROCESS_CAPABILITY_READINESS_VERSION,
  };
}
