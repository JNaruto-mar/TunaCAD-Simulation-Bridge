import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { loadExternalPipeline } from '../simulation-bridge/providers.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';

const lifecycleStatus = z.enum(['proof_of_concept', 'internally_validated', 'public_beta', 'independently_reviewed', 'qualified']);
const capabilitySchema = z.object({
  id: z.string().min(1), name: z.string().min(1), status: lifecycleStatus,
  validationStatus: lifecycleStatus, matrixFile: z.string().regex(/^sim.+\.json$/), matrixId: z.string().min(1),
  automatedPassCount: z.number().int().positive(), automatedFailCount: z.literal(0),
  qualificationPromotionGates: z.array(z.string()).min(1), engineeringUsePermitted: z.literal(false),
  automatedEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), summary: z.string().min(1),
}).strict();
const tutorialList = z.array(z.string().min(1)).min(1);
const tutorialSchema = z.object({
  slug: z.string().regex(/^tutorials\/simulation-[a-z-]+$/), title: z.string().min(1), capabilityIds: z.array(z.string()).min(1),
  difficulty: z.enum(['Intermediate', 'Advanced']), duration: z.string().min(1), summary: z.string().min(1),
  whatYouWillBuild: tutorialList, modelSetup: tutorialList, analysisSetup: tutorialList, materialProperties: tutorialList,
  restraintSteps: tutorialList, loadSteps: tutorialList, meshSettings: tutorialList, runSteps: tutorialList,
  resultSteps: tutorialList, expectedResults: tutorialList, acceptedComparison: tutorialList, physicalMeaning: tutorialList,
  warnings: tutorialList, feedback: z.string().min(1), aiPrompt: z.string().min(80), reproductionSteps: tutorialList, referenceMatrixIds: z.array(z.string()).min(1),
}).strict();
const catalogSchema = z.object({
  schema: z.literal('tunacad-simulation-public-beta-catalog/1.2'), targetOrigin: z.literal('https://tunacad.com'),
  releaseStatus: z.literal('public_beta'), recordedAt: z.iso.date(),
  disclaimer: z.literal('Experimental / Beta simulation capability. Internally validated against TunaCAD automated benchmarks. Critical engineering results should be independently verified.'),
  developmentPolicy: z.object({
    independentReviewRequiredForPublicBeta: z.literal(false),
    independentReviewPurpose: z.literal('formal_qualification_promotion_only'),
    revalidationTriggers: z.tuple([
      z.literal('new_physics'), z.literal('affected_implementation_change'), z.literal('runtime_version_change'),
      z.literal('hosted_reference_drift'), z.literal('qualification_assumption_or_tolerance_change'),
    ]),
  }).strict(),
  runtime: z.object({ os: z.literal('Windows x64'), node: z.literal('24'), gmsh: z.literal('4.15.2'), calculix: z.literal('2.16'), topology: z.literal('user-operated local Simulation Bridge') }).strict(),
  safetyBoundary: z.array(z.string()).min(8), capabilities: z.array(capabilitySchema).min(1), tutorials: z.array(tutorialSchema).min(7),
}).strict();

const catalog = catalogSchema.parse(JSON.parse(await readFile(new URL('../qualification/public-beta-capabilities.json', import.meta.url), 'utf8')));
const requiredCapabilities = ['SIM-2', 'SIM-3', 'SIM-4A', 'SIM-4B', 'SIM-5', 'SIM-6', 'SIM-7A', 'SIM-7B'];
assert.deepEqual(catalog.capabilities.map(item => item.id), requiredCapabilities);
assert.equal(new Set(catalog.capabilities.map(item => item.matrixId)).size, catalog.capabilities.length);
assert.ok(catalog.capabilities.every(item => item.status === 'public_beta' && item.validationStatus === 'internally_validated' && !item.engineeringUsePermitted));

for (const capability of catalog.capabilities) {
  const matrix: any = JSON.parse(await readFile(new URL(`../qualification/${capability.matrixFile}`, import.meta.url), 'utf8'));
  assert.equal(matrix.matrixId, capability.matrixId, `${capability.id} catalog matrix identity drifted.`);
  assert.equal(matrix.qualification.status, 'internally_validated', `${capability.id} is not internally validated.`);
  assert.equal(matrix.qualification.engineeringUsePermitted, false, `${capability.id} unexpectedly permits engineering use.`);
  const byId = new Map(matrix.lanes.map((lane: any) => [lane.id, lane]));
  const automatedRequired = matrix.promotionPolicy.requiredLaneIds.filter((id: string) => id !== 'independent-engineering-review');
  assert.ok(automatedRequired.every((id: string) => byId.get(id)?.state === 'passed'), `${capability.id} has an incomplete automated gate.`);
  assert.equal(matrix.lanes.filter((lane: any) => lane.state === 'failed').length, 0, `${capability.id} records a failed gate.`);
  assert.equal(byId.get('independent-engineering-review')?.state, 'pending', `${capability.id} independent-review state drifted.`);
  assert.equal(automatedRequired.length, capability.automatedPassCount);
  assert.deepEqual(capability.qualificationPromotionGates, ['independent-engineering-review']);
  const payload = {
    matrixId: matrix.matrixId, scope: matrix.scope,
    ...(matrix.prerequisiteMatrices ? { prerequisiteMatrices: matrix.prerequisiteMatrices } : {}),
    environment: matrix.environment, promotionPolicy: matrix.promotionPolicy,
    lanes: matrix.lanes.filter((lane: any) => lane.id !== 'independent-engineering-review'),
  };
  assert.equal(digest(payload), capability.automatedEvidenceDigest, `${capability.id} automated evidence digest drifted.`);
}

const requiredTutorials = [
  'tutorials/simulation-linear-static', 'tutorials/simulation-multimaterial', 'tutorials/simulation-modal',
  'tutorials/simulation-contact', 'tutorials/simulation-finite-curved-contact',
  'tutorials/simulation-geometric-nonlinear', 'tutorials/simulation-elastic-plastic',
];
assert.deepEqual(catalog.tutorials.map(item => item.slug), requiredTutorials);
assert.deepEqual(catalog.tutorials.map(item => item.title), [
  'Linear Static Analysis', 'Multi-Part and Multi-Material Analysis', 'Modal and Vibration Analysis',
  'Frictionless and Frictional Contact', 'Finite Sliding and Curved Contact',
  'Geometric Nonlinear Analysis', 'Elastic-Plastic Material Analysis',
]);
for (const tutorial of catalog.tutorials) {
  assert.ok(tutorial.capabilityIds.every(id => requiredCapabilities.includes(id)), `${tutorial.slug} names an unknown capability.`);
  assert.ok(tutorial.referenceMatrixIds.every(id => catalog.capabilities.some(item => item.matrixId === id)), `${tutorial.slug} has an unknown matrix.`);
  for (const field of ['whatYouWillBuild', 'modelSetup', 'analysisSetup', 'materialProperties', 'restraintSteps', 'loadSteps', 'meshSettings', 'runSteps', 'resultSteps', 'expectedResults', 'acceptedComparison', 'physicalMeaning', 'reproductionSteps'] as const) {
    assert.ok(Array.isArray(tutorial[field]) && tutorial[field].length > 0, `${tutorial.slug} omits hands-on field ${field}.`);
  }
  const publicContent = [
    tutorial.title, tutorial.summary, ...tutorial.whatYouWillBuild, ...tutorial.modelSetup, ...tutorial.analysisSetup,
    ...tutorial.materialProperties, ...tutorial.restraintSteps, ...tutorial.loadSteps, ...tutorial.meshSettings,
    ...tutorial.runSteps, ...tutorial.resultSteps, ...tutorial.expectedResults, ...tutorial.acceptedComparison,
    ...tutorial.physicalMeaning, ...tutorial.reproductionSteps, tutorial.aiPrompt, tutorial.feedback,
  ].join(' ');
  assert.doesNotMatch(publicContent, /\bSIM-(?:2|4|5|6|7[A-B]?)\b/i, `${tutorial.slug} exposes an internal roadmap name.`);
  assert.equal(tutorial.warnings.length, 1, `${tutorial.slug} should contain one friendly beta notice.`);
  assert.match(tutorial.warnings[0], /currently experimental\/beta/i);
  assert.match(tutorial.feedback, /report it/i);
}

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (gmsh && calculix) {
  const pipeline = await loadExternalPipeline(gmsh, calculix);
  assert.equal(pipeline.readiness.ready, true);
  assert.ok(pipeline.providerV2);
  assert.equal(pipeline.readiness.meshing.runtimeVersion, catalog.runtime.gmsh);
  assert.equal(pipeline.readiness.solving.runtimeVersion, catalog.runtime.calculix);
  assert.equal(pipeline.provider?.capabilities.qualification.status, 'internally_validated');
  assert.equal(pipeline.providerV2.capabilities.qualification.status, 'internally_validated');
  assert.equal(pipeline.provider?.capabilities.qualification.engineeringUsePermitted, false);
  assert.equal(pipeline.providerV2.capabilities.qualification.engineeringUsePermitted, false);
  assert.equal(pipeline.provider?.capabilities.qualification.evidence?.matrixId, catalog.capabilities[0].matrixId);
  assert.equal(pipeline.providerV2.capabilities.qualification.evidence, null, 'The multi-capability v2 provider must not inherit one umbrella matrix.');
  const limits = pipeline.providerV2.capabilities.execution.resourceLimits;
  assert.ok(limits?.cpuTimeLimitMs && limits.memoryLimitBytes && limits.maximumWorkingDirectoryBytes && limits.maximumResultFileBytes);
}

console.log(`Simulation public beta readiness PASS: ${catalog.capabilities.length} internally validated capabilities, ${catalog.tutorials.length} reproducible tutorials, engineeringUsePermitted=false; independent review is a dormant formal-qualification promotion gate.`);
