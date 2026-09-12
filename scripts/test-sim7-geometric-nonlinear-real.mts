import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalculiXMultiDomainSolverProvider, parseCalculiXNonlinearDatV2 } from '../providers/calculix/CalculiXMultiDomainSolverProvider.mts';
import { GmshMultiDomainMeshProvider } from '../providers/gmsh/GmshMultiDomainMeshProvider.mts';
import { digest } from '../simulation-bridge/stableDigest.mts';
import { sealNeutralSimulationRequestV2 } from '../simulation-bridge/v2Validation.mts';
import type { NeutralFemModelV2, NeutralSimulationFieldTriangleV2, NeutralSimulationRequestV2, NeutralSimulationResultV2, NeutralVector3 } from '../src/simulation/externalSimulationContracts.ts';

const gmsh = process.env.TUNACAD_GMSH_EXECUTABLE;
const calculix = process.env.TUNACAD_CALCULIX_EXECUTABLE;
if (!gmsh || !calculix) throw new Error('Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to run SIM-7A real acceptance.');
const materialPathOnly = process.argv.includes('--material-path-only');
const materialLifecycleOnly = process.argv.includes('--material-lifecycle-only');
const materialHingeOnly = process.argv.includes('--material-hinge-only');
const plasticHingeFinalLoadN = 400;

const directory = await mkdtemp(join(tmpdir(), 'tunacad-sim7a-beam-'));
try {
  const stepPath = join(directory, 'large-deflection-beam.step'); const geoPath = join(directory, 'large-deflection-beam.geo');
  await writeFile(geoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 150, 10, 5};\nSave "${stepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [geoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const step = new Uint8Array(await readFile(stepPath));
  const mesher = new GmshMultiDomainMeshProvider({ executable: gmsh, runtimeVersion: '4.15.2' });
  const solver = new CalculiXMultiDomainSolverProvider({ executable: calculix, runtimeVersion: '2.16' });
  const couponStepPath = join(directory, 'plastic-coupon.step'); const couponGeoPath = join(directory, 'plastic-coupon.geo');
  await writeFile(couponGeoPath, `SetFactory("OpenCASCADE");\nBox(1) = {0, 0, 0, 100, 10, 10};\nSave "${couponStepPath.replace(/\\/g, '/')}";\n`, 'utf8');
  execFileSync(gmsh, [couponGeoPath, '-0', '-v', '2'], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const couponStep = new Uint8Array(await readFile(couponStepPath));
  if (materialHingeOnly) {
    const monotonicHinge = await solve(createPlasticHingeRequest('monotonic'), couponStep, mesher, solver);
    const overloadHinge = await solve(createPlasticHingeRequest('overload_return'), couponStep, mesher, solver);
    assert.equal(monotonicHinge.analysisType, 'nonlinear_static'); assert.equal(overloadHinge.analysisType, 'nonlinear_static');
    if (monotonicHinge.analysisType !== 'nonlinear_static' || overloadHinge.analysisType !== 'nonlinear_static') throw new Error('Expected two SIM-7B plastic-hinge results.');
    const monotonicDisplacement = await loadFieldTriangles(solver, monotonicHinge, 'displacement');
    const overloadDisplacement = await loadFieldTriangles(solver, overloadHinge, 'displacement');
    const monotonicPlasticStrain = await loadFieldTriangles(solver, monotonicHinge, 'plastic-strain');
    const overloadPlasticStrain = await loadFieldTriangles(solver, overloadHinge, 'plastic-strain');
    const monotonicMetrics = plasticHingeMetrics(monotonicHinge, monotonicDisplacement, monotonicPlasticStrain);
    const overloadMetrics = plasticHingeMetrics(overloadHinge, overloadDisplacement, overloadPlasticStrain);
    const failures: string[] = [];
    if (Math.abs(monotonicMetrics.finalReactionZ - plasticHingeFinalLoadN) > 1 || Math.abs(overloadMetrics.finalReactionZ - plasticHingeFinalLoadN) > 1) failures.push(`Final support reactions do not balance the common ${plasticHingeFinalLoadN} N final load.`);
    if (Math.abs(monotonicMetrics.finalReactionZ - overloadMetrics.finalReactionZ) > .25) failures.push('The two final reaction resultants are not comparable.');
    if (monotonicMetrics.maximumReactionEquilibriumErrorN > 1 || overloadMetrics.maximumReactionEquilibriumErrorN > 1) failures.push('Reaction history does not balance the prescribed load history within 1 N.');
    if (!(overloadMetrics.maximumReactionZ > monotonicMetrics.maximumReactionZ * 1.4)) failures.push('The overload history did not record the expected larger reaction excursion.');
    if (!(overloadMetrics.maximumEquivalentPlasticStrain > 1e-4
      && overloadMetrics.maximumEquivalentPlasticStrain > monotonicMetrics.maximumEquivalentPlasticStrain + 1e-4)) failures.push('The overload path did not accumulate distinctly greater plastic strain.');
    if (!(overloadMetrics.rootMaximumEquivalentPlasticStrain > overloadMetrics.farMaximumEquivalentPlasticStrain * 2)) failures.push('Plastic strain did not localize toward the fixed-end hinge zone.');
    if (!(Math.abs(overloadMetrics.hingeRotationRad) > Math.abs(monotonicMetrics.hingeRotationRad) * 1.05)) failures.push('The overload-return path did not retain a distinctly larger hinge rotation.');
    if (!(overloadMetrics.totalInternalEnergyNmm > monotonicMetrics.totalInternalEnergyNmm * 1.05)) failures.push('The overload-return path did not retain distinctly greater internal energy.');
    if (monotonicHinge.review.engineeringUsePermitted || overloadHinge.review.engineeringUsePermitted) failures.push('Experimental hinge evidence unexpectedly permits engineering use.');
    console.log(JSON.stringify({
      fixture: '100x10x10 mm elastic-plastic cantilever; monotonic 400 N versus 600 N overload returned to 400 N',
      analyticalNominalRootBendingStressMPa: { commonFinalLoad: 240, overload: 360, yieldStrength: 250 },
      commonFinalAppliedLoadN: [0, 0, -plasticHingeFinalLoadN], monotonic: monotonicMetrics, overloadReturn: overloadMetrics,
      comparisons: {
        hingeRotationMagnitudeRatio: Math.abs(overloadMetrics.hingeRotationRad / monotonicMetrics.hingeRotationRad),
        maximumPEEQDifference: overloadMetrics.maximumEquivalentPlasticStrain - monotonicMetrics.maximumEquivalentPlasticStrain,
        maximumPEEQRatio: monotonicMetrics.maximumEquivalentPlasticStrain > 1e-12 ? overloadMetrics.maximumEquivalentPlasticStrain / monotonicMetrics.maximumEquivalentPlasticStrain : null,
        totalInternalEnergyRatio: overloadMetrics.totalInternalEnergyNmm / monotonicMetrics.totalInternalEnergyNmm,
        finalReactionDifferenceN: Math.abs(monotonicMetrics.finalReactionZ - overloadMetrics.finalReactionZ),
      },
      failures, experimental: true, engineeringUsePermitted: false,
    }, null, 2));
    assert.deepEqual(failures, [], `SIM-7B plastic-hinge path gates failed:\n${failures.join('\n')}`);
  } else if (materialLifecycleOnly) {
    const beforeFailureDirectories = await providerDirectories();
    const nonconvergentRequest: any = structuredClone(createPlasticCouponRequest(true, false, { label: 'deliberate-nonconvergence', meshSizeMm: 7.5, maximumIncrement: .025 }));
    nonconvergentRequest.studyId = 'sim7b-deliberate-nonconvergence'; nonconvergentRequest.name = 'SIM-7B partial-material-history increment exhaustion';
    nonconvergentRequest.analysis.settings.initialIncrement = .025; nonconvergentRequest.analysis.settings.minimumIncrement = .0001;
    nonconvergentRequest.analysis.settings.maximumIncrement = .025; nonconvergentRequest.analysis.settings.maximumIncrements = 36;
    reseal(nonconvergentRequest);
    const nonconvergentModel = await mesher.mesh(nonconvergentRequest, { descriptor: nonconvergentRequest.model, async exportDomain() { return couponStep; } });
    const nonconvergentSubmission = await solver.submit(nonconvergentRequest, nonconvergentModel);
    const failureDirectories = (await providerDirectories()).filter(name => !beforeFailureDirectories.includes(name));
    assert.equal(failureDirectories.length, 1);
    const failurePartialEvidence = await waitForPartialMaterialHistory(failureDirectories[0], nonconvergentModel, solver, nonconvergentSubmission.providerRunId, false);
    const nonconvergentStatus = await waitForTerminal(solver, nonconvergentSubmission.providerRunId);
    assert.equal(nonconvergentStatus.status, 'failed'); assert.equal(nonconvergentStatus.failure?.code, 'SIMULATION_SOLVER_FAILED');
    assert.match(nonconvergentStatus.failure?.message ?? '', /max\. # of increments reached|too many increments|increment size smaller than minimum/i);
    assert.equal(await solver.getResult(nonconvergentSubmission.providerRunId), null);
    await assertMaterialDatasetsQuarantined(solver, nonconvergentSubmission.providerRunId);
    await waitForDirectoriesRemoved(failureDirectories);

    const beforeCancellationDirectories = await providerDirectories();
    const cancelledRequest = createPlasticCouponRequest(true, true, { label: 'active-cancellation', meshSizeMm: 7.5, maximumIncrement: .025 });
    const cancelledModel = await mesher.mesh(cancelledRequest, { descriptor: cancelledRequest.model, async exportDomain() { return couponStep; } });
    const cancelledSubmission = await solver.submit(cancelledRequest, cancelledModel);
    const cancellationDirectories = (await providerDirectories()).filter(name => !beforeCancellationDirectories.includes(name));
    assert.equal(cancellationDirectories.length, 1);
    const cancellationPartialEvidence = await waitForPartialMaterialHistory(cancellationDirectories[0], cancelledModel, solver, cancelledSubmission.providerRunId, true);
    const cancelledStatus = await solver.cancel(cancelledSubmission.providerRunId);
    assert.equal(cancelledStatus.status, 'cancelled'); assert.equal(cancelledStatus.phase, 'cancelled_cleaned');
    assert.equal(await solver.getResult(cancelledSubmission.providerRunId), null);
    await assertMaterialDatasetsQuarantined(solver, cancelledSubmission.providerRunId);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await solver.getStatus(cancelledSubmission.providerRunId)).status, 'cancelled');
    await waitForDirectoriesRemoved(cancellationDirectories);
    console.log(JSON.stringify({
      fixture: '100x10x10 mm elastic-plastic axial coupon with partial PEEQ/ENER/ELSE history',
      nonconvergence: { status: nonconvergentStatus.status, code: nonconvergentStatus.failure?.code, partialMaterialHistoryObserved: failurePartialEvidence, resultQuarantined: true, materialFieldDatasetsQuarantined: true, nativeFilesRemoved: true },
      cancellation: { status: cancelledStatus.status, phase: cancelledStatus.phase, partialMaterialHistoryObserved: cancellationPartialEvidence, resultQuarantined: true, materialFieldDatasetsQuarantined: true, lateExitQuarantined: true, nativeFilesRemoved: true },
      experimental: true, engineeringUsePermitted: false,
    }, null, 2));
  } else if (materialPathOnly) {
    const cyclicCoupon = await solve(createPlasticCouponRequest(true, true), couponStep, mesher, solver);
    assert.equal(cyclicCoupon.analysisType, 'nonlinear_static');
    if (cyclicCoupon.analysisType !== 'nonlinear_static') throw new Error('Expected a SIM-7B material-path result.');
    assert.equal(cyclicCoupon.nonlinear.formulation, 'finite_deformation_elastic_plastic');
    assert.deepEqual(cyclicCoupon.nonlinear.steps.map(stepResult => stepResult.stepId), ['plastic-loading', 'unload-reload']);
    const history = cyclicCoupon.nonlinear.history;
    const loaded = history.filter(point => point.stepId === 'plastic-loading').at(-1)!;
    const secondStep = history.filter(point => point.stepId === 'unload-reload');
    const unloadedIndex = secondStep.reduce((best, point, index) => Math.abs(point.loadScaleFactors[0].scaleFactor) < Math.abs(secondStep[best].loadScaleFactors[0].scaleFactor) ? index : best, 0);
    const nearestUnloaded = secondStep[unloadedIndex]; const reloaded = secondStep.at(-1)!;
    const unloadingPoints = [loaded, ...secondStep.filter(point => point.stepTime <= .5)];
    const reloadingPoints = secondStep.filter(point => point.stepTime > .5);
    const unloadingFit = elasticPathFit(unloadingPoints, 30000); const reloadingFit = elasticPathFit(reloadingPoints, 30000);
    assert.ok(Math.abs(loaded.loadScaleFactors[0].scaleFactor - 1) < 1e-8);
    assert.ok(Math.abs(nearestUnloaded.loadScaleFactors[0].scaleFactor) <= .025 + 1e-8, `Recorded history did not tightly bracket the zero-load reversal: ${nearestUnloaded.loadScaleFactors[0].scaleFactor}.`);
    assert.ok(Math.abs(reloaded.loadScaleFactors[0].scaleFactor - 1) < 1e-8);
    assert.ok(unloadingFit.interceptDisplacementMm > 1, `Expected permanent elongation after unloading, received ${unloadingFit.interceptDisplacementMm} mm.`);
    assert.ok(unloadingFit.interceptDisplacementMm < loaded.maximumDisplacementMm);
    const nominalStiffnessNPerMm = 210000 * 100 / 100;
    const unloadingStiffnessNPerMm = 1 / unloadingFit.complianceMmPerN;
    const reloadingStiffnessNPerMm = 1 / reloadingFit.complianceMmPerN;
    assert.ok(unloadingFit.rSquared > .9999 && reloadingFit.rSquared > .9999, `Elastic branches are not linear enough: unload R²=${unloadingFit.rSquared}, reload R²=${reloadingFit.rSquared}.`);
    assert.ok(relativeChange(nominalStiffnessNPerMm, unloadingStiffnessNPerMm) < .12, `Unloading stiffness ${unloadingStiffnessNPerMm} N/mm differs from EA/L ${nominalStiffnessNPerMm} N/mm.`);
    assert.ok(relativeChange(unloadingStiffnessNPerMm, reloadingStiffnessNPerMm) < .02, `Reloading stiffness ${reloadingStiffnessNPerMm} N/mm does not reproduce unloading stiffness ${unloadingStiffnessNPerMm} N/mm.`);
    assert.ok(Math.abs(unloadingFit.interceptDisplacementMm - reloadingFit.interceptDisplacementMm) < .002, `Unload/reload residual-displacement intercepts disagree: ${unloadingFit.interceptDisplacementMm} versus ${reloadingFit.interceptDisplacementMm} mm.`);
    const states = history.map(point => point.materialState!);
    assert.ok(states.every(Boolean));
    assert.ok(history.every(point => Math.abs(point.resultantReactionForceN[0] + point.loadScaleFactors[0].scaleFactor * 30000) < 3), 'Axial reaction equilibrium failed along the load path.');
    assert.ok(states.every((state, index) => index === 0 || state.maximumEquivalentPlasticStrain + 1e-10 >= states[index - 1].maximumEquivalentPlasticStrain), 'Accumulated equivalent plastic strain decreased along the load path.');
    assert.ok(nearestUnloaded.materialState!.maximumEquivalentPlasticStrain > .01, 'Equivalent plastic strain did not remain after unloading.');
    assert.ok(nearestUnloaded.materialState!.maximumEquivalentPlasticStrain >= loaded.materialState!.maximumEquivalentPlasticStrain - 1e-9);
    assert.ok(reloaded.materialState!.maximumEquivalentPlasticStrain >= nearestUnloaded.materialState!.maximumEquivalentPlasticStrain - 1e-9);
    assert.ok(relativeChange(loaded.maximumDisplacementMm, reloaded.maximumDisplacementMm) < 1e-8, 'Reloading to the previous maximum force did not recover the previous displacement state.');
    assert.ok(Math.abs(reloaded.materialState!.maximumEquivalentPlasticStrain - loaded.materialState!.maximumEquivalentPlasticStrain) < 1e-9, 'Reloading below the previous yield surface accumulated unexpected plastic strain.');
    assert.ok(states.every(state => state.maximumEnergyDensityMPa >= 0 && state.totalInternalEnergyNmm >= 0));
    assert.ok(nearestUnloaded.materialState!.totalInternalEnergyNmm < loaded.materialState!.totalInternalEnergyNmm, 'Unload did not release recoverable internal energy.');
    assert.ok(reloaded.materialState!.totalInternalEnergyNmm > nearestUnloaded.materialState!.totalInternalEnergyNmm, 'Reload did not restore recoverable internal energy.');
    const integratedExternalWorkNmm = integrateAxialWork(history, 30000);
    const finalInternalEnergyNmm = reloaded.materialState!.totalInternalEnergyNmm;
    assert.ok(relativeChange(finalInternalEnergyNmm, integratedExternalWorkNmm) < .03, `Integrated external work ${integratedExternalWorkNmm} N·mm does not match final internal energy ${finalInternalEnergyNmm} N·mm.`);
    const monotonicBaseline = await solve(createPlasticCouponRequest(true, false, { label: 'convergence-baseline' }), couponStep, mesher, solver);
    const monotonicMesh = [
      await solve(createPlasticCouponRequest(true, false, { label: 'mesh-coarse', meshSizeMm: 10 }), couponStep, mesher, solver),
      await solve(createPlasticCouponRequest(true, false, { label: 'mesh-medium', meshSizeMm: 7.5 }), couponStep, mesher, solver),
      monotonicBaseline,
    ];
    const monotonicIncrements = [
      monotonicBaseline,
      await solve(createPlasticCouponRequest(true, false, { label: 'increment-medium', maximumIncrement: .075 }), couponStep, mesher, solver),
      await solve(createPlasticCouponRequest(true, false, { label: 'increment-fine', maximumIncrement: .05 }), couponStep, mesher, solver),
    ];
    const cyclicMesh = [
      await solve(createPlasticCouponRequest(true, true, { label: 'mesh-coarse', meshSizeMm: 10 }), couponStep, mesher, solver),
      await solve(createPlasticCouponRequest(true, true, { label: 'mesh-medium', meshSizeMm: 7.5 }), couponStep, mesher, solver),
      cyclicCoupon,
    ];
    const cyclicIncrements = [
      await solve(createPlasticCouponRequest(true, true, { label: 'increment-coarse', maximumIncrement: .1 }), couponStep, mesher, solver),
      await solve(createPlasticCouponRequest(true, true, { label: 'increment-medium', maximumIncrement: .075 }), couponStep, mesher, solver),
      cyclicCoupon,
    ];
    const monotonicTimes = [.25, .5, .75, 1]; const cyclicTimes = [.25, .5, .75, 1, 1.25, 1.475, 1.75, 2];
    const monotonicMeshConvergence = materialHistoryConvergence('monotonic mesh', monotonicMesh, monotonicTimes, { displacement: .03, peeq: .08, internalEnergy: .05 }, { requireIncreasingElements: true, requireContraction: false });
    const monotonicIncrementConvergence = materialHistoryConvergence('monotonic increment', monotonicIncrements, monotonicTimes, { displacement: .02, peeq: .02, internalEnergy: .02 }, { requireIncreasingElements: false, requireContraction: true });
    const cyclicMeshConvergence = materialHistoryConvergence('cyclic mesh', cyclicMesh, cyclicTimes, { displacement: .03, peeq: .08, internalEnergy: .05 }, { requireIncreasingElements: true, requireContraction: false });
    const cyclicIncrementConvergence = materialHistoryConvergence('cyclic increment', cyclicIncrements, cyclicTimes, { displacement: .02, peeq: .02, internalEnergy: .02 }, { requireIncreasingElements: false, requireContraction: true });
    const cyclicMeshPathConvergence = cyclicPathConvergence('cyclic mesh', cyclicMesh, false);
    const cyclicIncrementPathConvergence = cyclicPathConvergence('cyclic increment', cyclicIncrements, true);
    const convergenceFailures = [monotonicMeshConvergence, monotonicIncrementConvergence, cyclicMeshConvergence, cyclicIncrementConvergence, cyclicMeshPathConvergence, cyclicIncrementPathConvergence]
      .flatMap(evidence => evidence.failures);
    console.log(JSON.stringify({
      fixture: '100x10x10 mm axial coupon, 30 kN load-unload-reload, tabulated isotropic hardening',
      steps: cyclicCoupon.nonlinear.steps.map(stepResult => ({ stepId: stepResult.stepId, convergedIncrements: stepResult.increments.length })),
      loaded: pathPointEvidence(loaded), nearestRecordedReversal: pathPointEvidence(nearestUnloaded), reloaded: pathPointEvidence(reloaded),
      stiffnessNPerMm: { analyticalEAOverL: nominalStiffnessNPerMm, unloading: unloadingStiffnessNPerMm, reloading: reloadingStiffnessNPerMm },
      elasticBranchFits: { unloading: unloadingFit, reloading: reloadingFit },
      energyBalance: { integratedExternalWorkNmm, finalInternalEnergyNmm, relativeDifference: relativeChange(finalInternalEnergyNmm, integratedExternalWorkNmm) },
      peeqMonotonic: true, residualDisplacementMm: (unloadingFit.interceptDisplacementMm + reloadingFit.interceptDisplacementMm) / 2,
      residualAxialEngineeringStrain: (unloadingFit.interceptDisplacementMm + reloadingFit.interceptDisplacementMm) / 200,
      convergence: { monotonicMesh: monotonicMeshConvergence, monotonicIncrement: monotonicIncrementConvergence, cyclicMesh: cyclicMeshConvergence, cyclicIncrement: cyclicIncrementConvergence, cyclicMeshPath: cyclicMeshPathConvergence, cyclicIncrementPath: cyclicIncrementPathConvergence, failures: convergenceFailures },
      experimental: true, engineeringUsePermitted: cyclicCoupon.review.engineeringUsePermitted,
    }, null, 2));
    assert.deepEqual(convergenceFailures, [], `SIM-7B convergence gates failed:\n${convergenceFailures.join('\n')}`);
  } else {
  const plasticCoupon = await solve(createPlasticCouponRequest(true), couponStep, mesher, solver);
  const elasticCoupon = await solve(createPlasticCouponRequest(false), couponStep, mesher, solver);
  assert.equal(plasticCoupon.analysisType, 'nonlinear_static'); assert.equal(elasticCoupon.analysisType, 'nonlinear_static');
  if (plasticCoupon.analysisType !== 'nonlinear_static' || elasticCoupon.analysisType !== 'nonlinear_static') throw new Error('Expected SIM-7 coupon results.');
  assert.equal(plasticCoupon.nonlinear.formulation, 'finite_deformation_elastic_plastic');
  assert.ok(plasticCoupon.nonlinear.materialState);
  assert.ok(plasticCoupon.nonlinear.materialState.maximumEquivalentPlasticStrain > 0);
  assert.ok(plasticCoupon.nonlinear.materialState.maximumEnergyDensityMPa > 0);
  assert.ok(plasticCoupon.nonlinear.materialState.totalInternalEnergyNmm > 0);
  assert.ok(plasticCoupon.nonlinear.materialState.yieldedElementCount > 0);
  assert.ok(plasticCoupon.nonlinear.history.every(point => point.materialState !== null));
  assert.equal(elasticCoupon.nonlinear.formulation, 'finite_deformation_elastic');
  assert.ok(plasticCoupon.warnings.some(warning => warning.code === 'SIMULATION_MATERIAL_NONLINEARITY_POC'));
  const plasticCouponDisplacement = plasticCoupon.metrics.maximumDisplacementMm!;
  const elasticCouponDisplacement = elasticCoupon.metrics.maximumDisplacementMm!;
  assert.ok(plasticCouponDisplacement > elasticCouponDisplacement * 3, `Plastic coupon displacement ${plasticCouponDisplacement} mm did not separate from elastic response ${elasticCouponDisplacement} mm.`);
  const plasticCouponReaction = plasticCoupon.reactions.find(entry => entry.constraintId === 'fixed-end')?.forceN;
  assert.ok(plasticCouponReaction && Math.abs(plasticCouponReaction[0] + 30_000) < 3, `Expected a -30000 N coupon reaction, received ${JSON.stringify(plasticCouponReaction)}.`);
  const plasticStrainDatasetId = plasticCoupon.perDomain[0].fieldDatasetIds.find(id => id.endsWith(':plastic-strain'))!;
  const energyDatasetId = plasticCoupon.perDomain[0].fieldDatasetIds.find(id => id.endsWith(':energy-density'))!;
  const plasticStrainPage = await solver.getFieldDataset((plasticCoupon as any).jobId, plasticStrainDatasetId, '0', 16);
  const energyPage = await solver.getFieldDataset((plasticCoupon as any).jobId, energyDatasetId, '0', 16);
  assert.equal(plasticStrainPage.dataset.component, 'equivalent_plastic_strain'); assert.equal(plasticStrainPage.dataset.unit, 'dimensionless');
  assert.equal(energyPage.dataset.component, 'strain_energy_density'); assert.equal(energyPage.dataset.unit, 'MPa');
  const nonlinear = await solve(createRequest('nonlinear_static'), step, mesher, solver);
  const linear = await solve(createRequest('linear_static'), step, mesher, solver);
  assert.equal(nonlinear.analysisType, 'nonlinear_static');
  if (nonlinear.analysisType !== 'nonlinear_static') throw new Error('Expected a SIM-7A result.');
  assert.equal(nonlinear.nonlinear.steps.length, 2);
  assert.ok(nonlinear.nonlinear.steps.every(stepResult => stepResult.increments.length >= 1));
  assert.equal(nonlinear.nonlinear.history.at(-1)?.loadScaleFactors[0].scaleFactor, 1);
  assert.ok(nonlinear.nonlinear.history.every((point, index, history) => index === 0 || point.totalTime > history[index - 1].totalTime));
  const reaction = nonlinear.reactions.find(entry => entry.constraintId === 'fixed-end')?.forceN;
  assert.ok(reaction && Math.abs(reaction[2] - 500) < 0.3, `Expected a +500 N support reaction, received ${JSON.stringify(reaction)}.`);
  const nonlinearDisplacement = nonlinear.metrics.maximumDisplacementMm!;
  const linearDisplacement = linear.metrics.maximumDisplacementMm!;
  assert.ok(nonlinearDisplacement > 5, 'The fixture did not enter a meaningful large-deflection regime.');
  const pathDifference = Math.abs(nonlinearDisplacement - linearDisplacement) / linearDisplacement;
  assert.ok(pathDifference > 0.01, `NLGEOM displacement differs from the linear solution by only ${(pathDifference * 100).toFixed(3)}%.`);
  const history = nonlinear.nonlinear.history;
  assert.ok(history.at(-1)!.maximumDisplacementMm > history[0].maximumDisplacementMm);
  const finalHalfLoad = history.filter(point => point.stepId === 'half-load').at(-1)!;
  assert.ok(finalHalfLoad.loadScaleFactors[0].scaleFactor > 0.49 && finalHalfLoad.loadScaleFactors[0].scaleFactor < 0.51);

  const meshCoarse = await solve(createRequest('nonlinear_static', { label: 'mesh-coarse', meshSizeMm: 10 }), step, mesher, solver);
  const meshFine = await solve(createRequest('nonlinear_static', { label: 'mesh-fine', meshSizeMm: 6 }), step, mesher, solver);
  if (meshCoarse.analysisType !== 'nonlinear_static' || meshFine.analysisType !== 'nonlinear_static') throw new Error('Expected nonlinear mesh-refinement results.');
  const meshDisplacements = [meshCoarse.metrics.maximumDisplacementMm!, nonlinearDisplacement, meshFine.metrics.maximumDisplacementMm!];
  const meshChanges = [relativeChange(meshDisplacements[0], meshDisplacements[1]), relativeChange(meshDisplacements[1], meshDisplacements[2])];
  assert.ok(meshChanges[1] < meshChanges[0], 'Large-deflection displacement changes did not contract under mesh refinement.');
  assert.ok(meshChanges[1] < 0.04, `Medium-to-fine nonlinear displacement change ${(meshChanges[1] * 100).toFixed(2)}% exceeds 4%.`);

  const incrementMedium = await solve(createRequest('nonlinear_static', { label: 'increment-medium', maximumIncrement: 0.1 }), step, mesher, solver);
  const incrementFine = await solve(createRequest('nonlinear_static', { label: 'increment-fine', maximumIncrement: 0.05 }), step, mesher, solver);
  if (incrementMedium.analysisType !== 'nonlinear_static' || incrementFine.analysisType !== 'nonlinear_static') throw new Error('Expected nonlinear increment-refinement results.');
  const curveLoads = [0.25, 0.5, 0.75, 1];
  const curves = [nonlinear, incrementMedium, incrementFine].map(result => curveLoads.map(load => historyDisplacementAt(result.nonlinear.history, load)));
  const curveChanges = [maximumCurveChange(curves[0], curves[1]), maximumCurveChange(curves[1], curves[2])];
  assert.ok(curveChanges[1] <= curveChanges[0] + 1e-8, 'Force-displacement changes did not contract with increment refinement.');
  assert.ok(curveChanges[1] < 0.01, `Medium-to-fine force-displacement curve change ${(curveChanges[1] * 100).toFixed(3)}% exceeds 1%.`);
  const datasetId = nonlinear.perDomain[0].fieldDatasetIds.find(id => id.endsWith(':displacement'))!;
  const page = await solver.getFieldDataset((nonlinear as any).jobId, datasetId, '0', 16);
  assert.equal(page.dataset.analysisType, 'nonlinear_static'); assert.equal(page.dataset.step.label, 'final_nonlinear_increment');

  const beforeFailureDirectories = await providerDirectories();
  const nonconvergentRequest: any = structuredClone(createRequest('nonlinear_static'));
  nonconvergentRequest.studyId = 'sim7a-deliberate-nonconvergence'; nonconvergentRequest.name = 'SIM-7A deliberate increment exhaustion';
  nonconvergentRequest.analysis.settings.initialIncrement = 0.01; nonconvergentRequest.analysis.settings.minimumIncrement = 0.01;
  nonconvergentRequest.analysis.settings.maximumIncrement = 0.01; nonconvergentRequest.analysis.settings.maximumIncrements = 1;
  reseal(nonconvergentRequest);
  const nonconvergentModel = await mesher.mesh(nonconvergentRequest, { descriptor: nonconvergentRequest.model, async exportDomain() { return step; } });
  const nonconvergentSubmission = await solver.submit(nonconvergentRequest, nonconvergentModel);
  const failureDirectories = (await providerDirectories()).filter(name => !beforeFailureDirectories.includes(name));
  assert.equal(failureDirectories.length, 1);
  const nonconvergentStatus = await waitForTerminal(solver, nonconvergentSubmission.providerRunId);
  assert.equal(nonconvergentStatus.status, 'failed'); assert.equal(nonconvergentStatus.failure?.code, 'SIMULATION_SOLVER_FAILED');
  assert.match(nonconvergentStatus.failure?.message ?? '', /max\. # of increments reached|too many increments|increment size smaller than minimum/i);
  assert.equal(await solver.getResult(nonconvergentSubmission.providerRunId), null);
  await assert.rejects(() => solver.getFieldDataset(nonconvergentSubmission.providerRunId, `${nonconvergentSubmission.providerRunId}:beam:displacement`), /Unknown or expired/);
  await waitForDirectoriesRemoved(failureDirectories);

  const beforeCancellationDirectories = await providerDirectories();
  const cancelledRequest = createRequest('nonlinear_static');
  const cancelledModel = await mesher.mesh(cancelledRequest, { descriptor: cancelledRequest.model, async exportDomain() { return step; } });
  const cancelledSubmission = await solver.submit(cancelledRequest, cancelledModel);
  const cancellationDirectories = (await providerDirectories()).filter(name => !beforeCancellationDirectories.includes(name));
  assert.equal(cancellationDirectories.length, 1);
  const cancelledStatus = await solver.cancel(cancelledSubmission.providerRunId);
  assert.equal(cancelledStatus.status, 'cancelled'); assert.equal(cancelledStatus.phase, 'cancelled_cleaned');
  assert.equal(await solver.getResult(cancelledSubmission.providerRunId), null);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await solver.getStatus(cancelledSubmission.providerRunId)).status, 'cancelled');
  await waitForDirectoriesRemoved(cancellationDirectories);
  console.log(JSON.stringify({
    fixture: '150x10x5 mm elastic steel cantilever, 500 N transverse dead load',
    orderedSteps: nonlinear.nonlinear.steps.map(stepResult => ({ stepId: stepResult.stepId, convergedIncrements: stepResult.increments.length })),
    recordedHistoryPoints: history.length, finalReactionN: reaction, linearDisplacementMm: linearDisplacement,
    nonlinearDisplacementMm: nonlinearDisplacement, relativeLinearNonlinearDifference: pathDifference,
    meshConvergence: { globalSizeMm: [10, 7.5, 6], maximumDisplacementMm: meshDisplacements, relativeChanges: meshChanges },
    incrementConvergence: { maximumIncrement: [0.2, 0.1, 0.05], sampleLoadFactors: curveLoads, displacementCurvesMm: curves, maximumRelativeCurveChanges: curveChanges },
    fieldDatasetStep: page.dataset.step,
    lifecycle: {
      nonconvergence: { status: nonconvergentStatus.status, code: nonconvergentStatus.failure?.code, partialHistoryQuarantined: true, nativeFilesRemoved: true },
      cancellation: { status: cancelledStatus.status, phase: cancelledStatus.phase, partialHistoryQuarantined: true, lateExitQuarantined: true, nativeFilesRemoved: true },
    },
    materialNonlinearity: {
      fixture: '100x10x10 mm axial coupon, 30000 N, tabulated isotropic hardening',
      elasticDisplacementMm: elasticCouponDisplacement, elasticPlasticDisplacementMm: plasticCouponDisplacement,
      displacementRatio: plasticCouponDisplacement / elasticCouponDisplacement, finalReactionN: plasticCouponReaction,
      formulation: plasticCoupon.nonlinear.formulation, warningPresent: true,
      materialState: plasticCoupon.nonlinear.materialState,
      fields: { equivalentPlasticStrain: plasticStrainPage.dataset.valueRange, energyDensityMPa: energyPage.dataset.valueRange },
    },
  }, null, 2));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

function reseal(request: any): void {
  delete request.requestDigest; delete request.model.modelDigest;
  request.model.domains.forEach((domain: any) => delete domain.domainDigest);
  Object.assign(request, sealNeutralSimulationRequestV2(request));
}

async function providerDirectories(): Promise<string[]> {
  return (await readdir(tmpdir())).filter(name => name.startsWith('tunacad-calculix-v2-')).sort();
}

async function waitForPartialMaterialHistory(
  directoryName: string,
  model: NeutralFemModelV2,
  solver: CalculiXMultiDomainSolverProvider,
  providerRunId: string,
  requireRunning: boolean,
) {
  const resultPath = join(tmpdir(), directoryName, 'tunacadv2.dat');
  for (let attempt = 0; attempt < 5000; attempt++) {
    try {
      const contents = await readFile(resultPath, 'utf8');
      const byteLength = Buffer.byteLength(contents, 'utf8');
      assert.ok(byteLength <= 64 * 1024 * 1024, `Partial material-history observation exceeded 64 MiB (${byteLength} bytes).`);
      const frames = parseCalculiXNonlinearDatV2(contents, model, ['REACTION_001']);
      const complete = frames.filter(frame => frame.equivalentPlasticStrainByElement.size === model.volumeElements.connectivity.length
        && frame.energyDensityByElement.size === model.volumeElements.connectivity.length
        && frame.totalInternalEnergyNmm !== null);
      const plastic = complete.find(frame => Math.max(...frame.equivalentPlasticStrainByElement.values()) > 1e-8
        && Math.max(...frame.energyDensityByElement.values()) > 0
        && frame.totalInternalEnergyNmm! > 0);
      if (plastic) {
        const status = await solver.getStatus(providerRunId);
        if (requireRunning) assert.equal(status.status, 'running', 'The cancellation fixture completed before active cancellation could be issued.');
        return {
          byteLength, completeMaterialFrames: complete.length, observedProviderStatus: status.status,
          maximumEquivalentPlasticStrain: Math.max(...plastic.equivalentPlasticStrainByElement.values()),
          maximumEnergyDensityMPa: Math.max(...plastic.energyDensityByElement.values()),
          totalInternalEnergyNmm: plastic.totalInternalEnergyNmm,
        };
      }
    } catch (caught) {
      const code = (caught as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && !(caught instanceof Error && /did not produce nonlinear increment displacement frames|did not produce complete finite per-domain SIM-4A output/.test(caught.message))) throw caught;
    }
    const status = await solver.getStatus(providerRunId);
    if (status.status !== 'running' && status.status !== 'queued') throw new Error(`SIM-7B run reached ${status.status} before a complete positive PEEQ/energy frame was observed.`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for partial SIM-7B PEEQ/energy history.');
}

async function assertMaterialDatasetsQuarantined(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  for (const suffix of ['displacement', 'stress', 'plastic-strain', 'energy-density']) {
    await assert.rejects(() => solver.getFieldDataset(providerRunId, `${providerRunId}:coupon:${suffix}`), /Unknown or expired/);
  }
}

async function waitForDirectoriesRemoved(names: string[]): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const remaining = (await providerDirectories()).filter(name => names.includes(name));
    if (!remaining.length) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`CalculiX working directories were not removed: ${names.join(', ')}`);
}

async function waitForTerminal(solver: CalculiXMultiDomainSolverProvider, providerRunId: string) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const status = await solver.getStatus(providerRunId);
    if (['succeeded', 'failed', 'cancelled'].includes(status.status)) return status;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for a SIM-7A lifecycle terminal state.');
}

function createRequest(analysisType: 'linear_static' | 'nonlinear_static', options: { label?: string; meshSizeMm?: number; maximumIncrement?: number } = {}): NeutralSimulationRequestV2 {
  const label = options.label ?? 'baseline'; const meshSizeMm = options.meshSizeMm ?? 7.5; const maximumIncrement = options.maximumIncrement ?? 0.2;
  const revision = `sim7a-real-${analysisType}-${label}-r1`; const domainId = 'beam'; const occurrenceId = 'beam:1';
  const geometryDigest = digest({ fixture: '150x10x5-large-deflection-beam' });
  const reference = (semanticReferenceId: string, role: 'load' | 'constraint', x: number, outwardDirection: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId: 'beam-part', ownerBodyId: 'beam-body', occurrenceId, geometryKind: 'FACE' as const, role,
    sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: revision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 2.5] as NeutralVector3, areaMm2: 50, outwardDirection, geometryType: 'plane', edgeCount: 4, boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 5] as NeutralVector3 } },
  });
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: `sim7a-real-${analysisType}-${label}`, name: `${analysisType} large-deflection cantilever ${label}`,
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: analysisType === 'nonlinear_static' ? {
      type: 'nonlinear_static', assumptions: ['finite_deformation', 'finite_strain', 'quasi_static', 'isotropic_linear_elastic'],
      settings: {
        steps: [
          { id: 'half-load', name: 'Ramp to 50 percent', duration: 1, loadAmplitudes: [{ loadId: 'tip-force', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: 0.5 }] }] },
          { id: 'full-load', name: 'Ramp to 100 percent', duration: 1, loadAmplitudes: [{ loadId: 'tip-force', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0.5 }, { time: 1, scaleFactor: 1 }] }] },
        ],
        initialIncrement: Math.min(0.1, maximumIncrement), minimumIncrement: 0.0001, maximumIncrement, maximumIncrements: 200, maximumIterations: 32, cutbackFactor: 0.25, maximumCutbacks: 8,
      },
    } : { type: 'linear_static', assumptions: ['small_displacement', 'small_strain', 'static_loading'] },
    model: {
      projectRevision: revision, coordinateSpace: 'frozen_analysis',
      domains: [{ domainId, partId: 'beam-part', bodyId: 'beam-body', occurrenceId, geometryDigest, transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 7500, surfaceAreaMm2: 4600, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [150, 10, 5], size: [150, 10, 5] } } }],
      references: [reference('fixed-face', 'constraint', 0, [-1, 0, 0]), reference('load-face', 'load', 150, [1, 0, 0])],
    },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Steel', model: 'isotropic_linear_elastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: 0.3, source: { kind: 'custom', reference: 'SIM-7A large-deflection fixture' } }],
    materialAssignments: [{ assignmentId: 'beam-steel', domainId, materialId: 'steel', volumeRegionId: 'beam-volume' }],
    loads: [{ id: 'tip-force', name: 'Transverse tip force', type: 'surface_force', semanticReferenceIds: ['load-face'], forceN: [0, 0, -500], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-face'] }], interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: meshSizeMm, minimumSizeMm: meshSizeMm / 4, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: 0.04 },
    requestedResults: analysisType === 'nonlinear_static'
      ? ['von_mises_stress', 'displacement', 'reaction_force', 'load_displacement_history', 'increment_convergence']
      : ['von_mises_stress', 'displacement', 'reaction_force', 'factor_of_safety', 'critical_regions'],
  });
}

function createPlasticCouponRequest(plastic: boolean, cyclic = false, options: { label?: string; meshSizeMm?: number; maximumIncrement?: number } = {}): NeutralSimulationRequestV2 {
  const label = options.label ?? 'reference'; const meshSizeMm = options.meshSizeMm ?? 5; const maximumIncrement = options.maximumIncrement ?? (cyclic ? .05 : .1);
  const revision = `sim7b-real-${plastic ? 'plastic' : 'elastic'}-coupon-${cyclic ? 'cyclic-' : ''}${label}-r1`; const domainId = 'coupon'; const occurrenceId = 'coupon:1';
  const reference = (semanticReferenceId: string, role: 'load' | 'constraint', x: number, outwardDirection: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId: 'coupon-part', ownerBodyId: 'coupon-body', occurrenceId, geometryKind: 'FACE' as const, role,
    sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: revision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100, outwardDirection, geometryType: 'plane', edgeCount: 4, boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  const model = plastic ? 'isotropic_elastic_plastic' as const : 'isotropic_linear_elastic' as const;
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: `sim7b-real-${plastic ? 'plastic' : 'elastic'}-${cyclic ? 'load-unload-reload-' : ''}coupon-${label}`, name: `SIM-7B ${plastic ? 'elastic-plastic' : 'elastic reference'} ${cyclic ? 'load-unload-reload ' : ''}coupon ${label}`,
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'nonlinear_static', assumptions: ['finite_deformation', 'finite_strain', 'quasi_static', model], settings: {
      steps: cyclic ? [
        { id: 'plastic-loading', name: 'Load beyond first yield', duration: 1, loadAmplitudes: [{ loadId: 'axial-force', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: 1 }] }] },
        { id: 'unload-reload', name: 'Unload to zero and reload', duration: 1, loadAmplitudes: [{ loadId: 'axial-force', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 1 }, { time: .5, scaleFactor: 0 }, { time: 1, scaleFactor: 1 }] }] },
      ] : [{ id: 'tension', name: 'Axial tension ramp', duration: 1, loadAmplitudes: [{ loadId: 'axial-force', interpolation: 'piecewise_linear', points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: 1 }] }] }],
      initialIncrement: Math.min(cyclic ? .025 : .05, maximumIncrement), minimumIncrement: .0001, maximumIncrement, maximumIncrements: 250, maximumIterations: 32, cutbackFactor: .25, maximumCutbacks: 8,
    } },
    model: { projectRevision: revision, coordinateSpace: 'frozen_analysis', domains: [{
      domainId, partId: 'coupon-part', bodyId: 'coupon-body', occurrenceId, geometryDigest: digest({ fixture: '100x10x10-axial-coupon' }),
      transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10000, surfaceAreaMm2: 4200, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } },
    }], references: [reference('fixed-face', 'constraint', 0, [-1, 0, 0]), reference('load-face', 'load', 100, [1, 0, 0])] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: plastic ? 'Hardening steel' : 'Elastic steel', model, densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: .3,
      ...(plastic ? { yieldStrengthMPa: 250, plasticity: { hardening: 'isotropic' as const, curve: [{ trueStressMPa: 250, plasticStrain: 0 }, { trueStressMPa: 300, plasticStrain: .02 }, { trueStressMPa: 340, plasticStrain: .08 }] } } : {}),
      source: { kind: 'custom', reference: 'SIM-7B axial coupon development fixture' } }],
    materialAssignments: [{ assignmentId: 'coupon-steel', domainId, materialId: 'steel', volumeRegionId: 'coupon-volume' }],
    loads: [{ id: 'axial-force', name: 'Axial tension', type: 'surface_force', semanticReferenceIds: ['load-face'], forceN: [30000, 0, 0], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-face'] }], interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: meshSizeMm, minimumSizeMm: meshSizeMm / 4, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'load_displacement_history', 'increment_convergence',
      ...(plastic ? ['equivalent_plastic_strain' as const, 'strain_energy_density' as const, 'internal_energy' as const] : [])],
  });
}

function createPlasticHingeRequest(path: 'monotonic' | 'overload_return'): NeutralSimulationRequestV2 {
  const revision = `sim7b-plastic-hinge-${path}-r1`; const domainId = 'hinge-beam'; const occurrenceId = 'hinge-beam:1';
  const reference = (semanticReferenceId: string, role: 'load' | 'constraint', x: number, outwardDirection: NeutralVector3) => ({
    semanticReferenceId, domainId, ownerPartId: 'hinge-beam-part', ownerBodyId: 'hinge-beam-body', occurrenceId, geometryKind: 'FACE' as const, role,
    sourceFeatureId: 'box', resolutionState: 'valid' as const, resolvedAtProjectRevision: revision,
    faceOwnerLocal: { centroidPartLocalMm: [x, 5, 5] as NeutralVector3, areaMm2: 100, outwardDirection, geometryType: 'plane', edgeCount: 4, boundingBoxMm: { min: [x, 0, 0] as NeutralVector3, max: [x, 10, 10] as NeutralVector3 } },
  });
  const steps = path === 'monotonic' ? [
    { id: 'monotonic-final', name: 'Monotonic loading to common final load', duration: 1, loadAmplitudes: [{ loadId: 'transverse-force', interpolation: 'piecewise_linear' as const, points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: 1 }] }] },
  ] : [
    { id: 'overload', name: 'Overload beyond common final load', duration: 1, loadAmplitudes: [{ loadId: 'transverse-force', interpolation: 'piecewise_linear' as const, points: [{ time: 0, scaleFactor: 0 }, { time: 1, scaleFactor: 1.5 }] }] },
    { id: 'return-final', name: 'Return to common final load', duration: 1, loadAmplitudes: [{ loadId: 'transverse-force', interpolation: 'piecewise_linear' as const, points: [{ time: 0, scaleFactor: 1.5 }, { time: 1, scaleFactor: 1 }] }] },
  ];
  return sealNeutralSimulationRequestV2({
    schema: 'tunacad-neutral-simulation-request/2.0', studyId: `sim7b-plastic-hinge-${path}`, name: `SIM-7B plastic hinge ${path}`,
    preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    analysis: { type: 'nonlinear_static', assumptions: ['finite_deformation', 'finite_strain', 'quasi_static', 'isotropic_elastic_plastic'], settings: {
      steps, initialIncrement: .025, minimumIncrement: .0001, maximumIncrement: .05, maximumIncrements: 250, maximumIterations: 32, cutbackFactor: .25, maximumCutbacks: 8,
    } },
    model: { projectRevision: revision, coordinateSpace: 'frozen_analysis', domains: [{
      domainId, partId: 'hinge-beam-part', bodyId: 'hinge-beam-body', occurrenceId, geometryDigest: digest({ fixture: '100x10x10-plastic-hinge-beam' }),
      transformToAnalysis: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      shape: { valid: true, connectedSolidCount: 1, faceCount: 6, edgeCount: 12, volumeMm3: 10000, surfaceAreaMm2: 4200, boundingBoxOwnerLocalMm: { min: [0, 0, 0], max: [100, 10, 10], size: [100, 10, 10] } },
    }], references: [reference('fixed-face', 'constraint', 0, [-1, 0, 0]), reference('load-face', 'load', 100, [1, 0, 0])] },
    units: { geometry: 'mm', force: 'N', stress: 'MPa', displacement: 'mm', density: 'kg/m^3', acceleration: 'mm/s^2' },
    materials: [{ id: 'steel', name: 'Hardening steel', model: 'isotropic_elastic_plastic', densityKgM3: 7850, youngsModulusMPa: 210000, poissonRatio: .3,
      yieldStrengthMPa: 250, plasticity: { hardening: 'isotropic', curve: [{ trueStressMPa: 250, plasticStrain: 0 }, { trueStressMPa: 300, plasticStrain: .02 }, { trueStressMPa: 340, plasticStrain: .08 }] },
      source: { kind: 'custom', reference: 'SIM-7B solid plastic-hinge development fixture' } }],
    materialAssignments: [{ assignmentId: 'hinge-steel', domainId, materialId: 'steel', volumeRegionId: 'hinge-volume' }],
    loads: [{ id: 'transverse-force', name: 'Transverse tip force', type: 'surface_force', semanticReferenceIds: ['load-face'], forceN: [0, 0, -plasticHingeFinalLoadN], coordinateSystem: 'analysis' }],
    constraints: [{ id: 'fixed-end', name: 'Fixed end', type: 'fixed', semanticReferenceIds: ['fixed-face'] }], interactions: [],
    mesh: { dimensionality: '3d', elementFamily: 'tetrahedral', order: 2, globalSizeMm: 5, minimumSizeMm: 1.25, maximumNodes: 150000, maximumElements: 75000, qualityMetric: 'provider_normalized', minimumQuality: .04 },
    requestedResults: ['von_mises_stress', 'displacement', 'reaction_force', 'load_displacement_history', 'increment_convergence', 'equivalent_plastic_strain', 'strain_energy_density', 'internal_energy'],
  });
}

async function loadFieldTriangles(solver: CalculiXMultiDomainSolverProvider, result: NeutralSimulationResultV2, suffix: string) {
  const datasetId = result.perDomain[0].fieldDatasetIds.find(id => id.endsWith(`:${suffix}`));
  if (!datasetId) throw new Error(`Missing ${suffix} field dataset.`);
  const triangles: NeutralSimulationFieldTriangleV2[] = []; let cursor: string | null = '0'; let expected = -1;
  while (cursor !== null) {
    const page = await solver.getFieldDataset(result.jobId, datasetId, cursor, 128);
    expected = page.dataset.totalTriangles; triangles.push(...page.triangles); cursor = page.nextCursor;
  }
  assert.equal(triangles.length, expected, `${suffix} pagination did not recover the complete field.`);
  return triangles;
}

function plasticHingeMetrics(
  result: Extract<NeutralSimulationResultV2, { analysisType: 'nonlinear_static' }>,
  displacement: NeutralSimulationFieldTriangleV2[],
  plasticStrain: NeutralSimulationFieldTriangleV2[],
) {
  const vertices = new Map<string, { x: number; transverseDisplacementMm: number }>();
  for (const triangle of displacement) for (let index = 0; index < 3; index++) {
    const position = triangle.positionsAnalysisMm[index]; const movement = triangle.displacementsMm[index];
    vertices.set(position.map(value => value.toPrecision(14)).join(','), { x: position[0], transverseDisplacementMm: movement[2] });
  }
  const hingeVertices = [...vertices.values()].filter(vertex => vertex.x <= 30 + 1e-9);
  const meanX = hingeVertices.reduce((sum, vertex) => sum + vertex.x, 0) / hingeVertices.length;
  const meanDisplacement = hingeVertices.reduce((sum, vertex) => sum + vertex.transverseDisplacementMm, 0) / hingeVertices.length;
  const numerator = hingeVertices.reduce((sum, vertex) => sum + (vertex.x - meanX) * (vertex.transverseDisplacementMm - meanDisplacement), 0);
  const denominator = hingeVertices.reduce((sum, vertex) => sum + (vertex.x - meanX) ** 2, 0);
  const hingeRotationRad = Math.atan(numerator / denominator);
  const zoneMaximum = (minimumX: number, maximumX: number) => Math.max(0, ...plasticStrain.filter(triangle => {
    const centroidX = triangle.positionsAnalysisMm.reduce((sum, point) => sum + point[0], 0) / 3;
    return centroidX >= minimumX && centroidX <= maximumX;
  }).flatMap(triangle => triangle.values));
  const history = result.nonlinear.history; const final = history.at(-1)!;
  return {
    convergedIncrementsByStep: result.nonlinear.steps.map(step => ({ stepId: step.stepId, count: step.increments.length })),
    hingeRotationRad, maximumDisplacementMm: result.metrics.maximumDisplacementMm,
    maximumEquivalentPlasticStrain: result.nonlinear.materialState!.maximumEquivalentPlasticStrain,
    peeqZoneMaximum: { root0To25Mm: zoneMaximum(0, 25), transition25To50Mm: zoneMaximum(25, 50), far50To100Mm: zoneMaximum(50, 100) },
    rootMaximumEquivalentPlasticStrain: zoneMaximum(0, 25), farMaximumEquivalentPlasticStrain: zoneMaximum(50, 100),
    totalInternalEnergyNmm: result.nonlinear.materialState!.totalInternalEnergyNmm,
    stepEndpointHistory: result.nonlinear.steps.map(step => {
      const point = history.filter(entry => entry.stepId === step.stepId).at(-1)!;
      return { stepId: step.stepId, loadScaleFactor: point.loadScaleFactors[0].scaleFactor, reactionZ: Math.abs(point.resultantReactionForceN[2]), maximumEquivalentPlasticStrain: point.materialState!.maximumEquivalentPlasticStrain, totalInternalEnergyNmm: point.materialState!.totalInternalEnergyNmm };
    }),
    finalLoadScaleFactor: final.loadScaleFactors[0].scaleFactor,
    finalReactionZ: Math.abs(final.resultantReactionForceN[2]),
    maximumReactionZ: Math.max(...history.map(point => Math.abs(point.resultantReactionForceN[2]))),
    maximumReactionEquilibriumErrorN: Math.max(...history.map(point => Math.abs(Math.abs(point.resultantReactionForceN[2]) - Math.abs(point.loadScaleFactors[0].scaleFactor * plasticHingeFinalLoadN)))),
  };
}

function relativeChange(first: number, second: number): number { return Math.abs(second - first) / Math.max(Math.abs(second), 1e-12); }
function integrateAxialWork(history: Extract<NeutralSimulationResultV2, { analysisType: 'nonlinear_static' }>['nonlinear']['history'], fullLoadN: number): number {
  let work = 0; let previousForce = 0; let previousDisplacement = 0;
  for (const point of history) {
    const force = point.loadScaleFactors[0].scaleFactor * fullLoadN;
    work += .5 * (previousForce + force) * (point.maximumDisplacementMm - previousDisplacement);
    previousForce = force; previousDisplacement = point.maximumDisplacementMm;
  }
  return work;
}
function elasticPathFit(points: Extract<NeutralSimulationResultV2, { analysisType: 'nonlinear_static' }>['nonlinear']['history'], fullLoadN: number) {
  if (points.length < 3) throw new Error('An elastic path fit requires at least three converged history points.');
  const samples = points.map(point => ({ forceN: point.loadScaleFactors[0].scaleFactor * fullLoadN, displacementMm: point.maximumDisplacementMm }));
  const meanForce = samples.reduce((sum, point) => sum + point.forceN, 0) / samples.length;
  const meanDisplacement = samples.reduce((sum, point) => sum + point.displacementMm, 0) / samples.length;
  const covariance = samples.reduce((sum, point) => sum + (point.forceN - meanForce) * (point.displacementMm - meanDisplacement), 0);
  const forceVariance = samples.reduce((sum, point) => sum + (point.forceN - meanForce) ** 2, 0);
  const complianceMmPerN = covariance / forceVariance;
  const interceptDisplacementMm = meanDisplacement - complianceMmPerN * meanForce;
  const residual = samples.reduce((sum, point) => sum + (point.displacementMm - interceptDisplacementMm - complianceMmPerN * point.forceN) ** 2, 0);
  const total = samples.reduce((sum, point) => sum + (point.displacementMm - meanDisplacement) ** 2, 0);
  return { complianceMmPerN, interceptDisplacementMm, rSquared: 1 - residual / total, sampleCount: samples.length };
}
function pathPointEvidence(point: Extract<NeutralSimulationResultV2, { analysisType: 'nonlinear_static' }>['nonlinear']['history'][number]) {
  return { totalTime: point.totalTime, loadScaleFactor: point.loadScaleFactors[0].scaleFactor, displacementMm: point.maximumDisplacementMm, reactionN: point.resultantReactionForceN, materialState: point.materialState };
}
function requireNonlinear(result: NeutralSimulationResultV2) {
  if (result.analysisType !== 'nonlinear_static') throw new Error('Expected a nonlinear coupon result.');
  return result;
}
function historySample(result: NeutralSimulationResultV2, totalTime: number) {
  const history = requireNonlinear(result).nonlinear.history;
  const rightIndex = history.findIndex(point => point.totalTime >= totalTime - 1e-12);
  if (rightIndex < 0) throw new Error(`History does not reach pseudo-time ${totalTime}.`);
  const right = history[rightIndex];
  const left = rightIndex === 0 ? { totalTime: 0, maximumDisplacementMm: 0, materialState: { maximumEquivalentPlasticStrain: 0, totalInternalEnergyNmm: 0 } } : history[rightIndex - 1];
  const ratio = right.totalTime === left.totalTime ? 1 : (totalTime - left.totalTime) / (right.totalTime - left.totalTime);
  const interpolateValue = (a: number, b: number) => a + ratio * (b - a);
  return {
    displacement: interpolateValue(left.maximumDisplacementMm, right.maximumDisplacementMm),
    peeq: interpolateValue(left.materialState!.maximumEquivalentPlasticStrain, right.materialState!.maximumEquivalentPlasticStrain),
    internalEnergy: interpolateValue(left.materialState!.totalInternalEnergyNmm, right.materialState!.totalInternalEnergyNmm),
  };
}
function materialHistoryConvergence(
  label: string,
  results: NeutralSimulationResultV2[],
  sampleTimes: number[],
  limits: { displacement: number; peeq: number; internalEnergy: number },
  requirements: { requireIncreasingElements: boolean; requireContraction: boolean },
) {
  const elementCounts = results.map(result => result.provenance.mesh?.elementCount ?? 0);
  const failures: string[] = [];
  if (requirements.requireIncreasingElements && !(elementCounts[0] < elementCounts[1] && elementCounts[1] < elementCounts[2])) failures.push(`${label} element counts are not strictly increasing: ${elementCounts}.`);
  const histories = results.map(result => sampleTimes.map(time => historySample(result, time)));
  const changes = (key: 'displacement' | 'peeq' | 'internalEnergy') => [
    normalizedCurveChange(histories[0].map(point => point[key]), histories[1].map(point => point[key])),
    normalizedCurveChange(histories[1].map(point => point[key]), histories[2].map(point => point[key])),
  ];
  const relativeChanges = { displacement: changes('displacement'), peeq: changes('peeq'), internalEnergy: changes('internalEnergy') };
  for (const key of ['displacement', 'peeq', 'internalEnergy'] as const) {
    if (requirements.requireContraction && !(relativeChanges[key][1] <= relativeChanges[key][0] + 2e-4)) failures.push(`${label} ${key} history changes did not contract: ${relativeChanges[key]}.`);
    if (!(relativeChanges[key][1] < limits[key])) failures.push(`${label} ${key} fine change ${relativeChanges[key][1]} exceeds ${limits[key]}.`);
  }
  return { elementCounts, sampleTimes, relativeChanges, limits, requirements, failures };
}
function cyclicMetrics(result: NeutralSimulationResultV2) {
  const history = requireNonlinear(result).nonlinear.history;
  const loaded = history.filter(point => point.stepId === 'plastic-loading').at(-1)!;
  const secondStep = history.filter(point => point.stepId === 'unload-reload');
  const unloading = elasticPathFit([loaded, ...secondStep.filter(point => point.stepTime <= .5)], 30000);
  const reloading = elasticPathFit(secondStep.filter(point => point.stepTime > .5), 30000);
  return { residualDisplacementMm: (unloading.interceptDisplacementMm + reloading.interceptDisplacementMm) / 2, unloadingStiffnessNPerMm: 1 / unloading.complianceMmPerN, reloadingStiffnessNPerMm: 1 / reloading.complianceMmPerN };
}
function cyclicPathConvergence(label: string, results: NeutralSimulationResultV2[], requireContraction: boolean) {
  const metrics = results.map(cyclicMetrics);
  const changes = (key: keyof ReturnType<typeof cyclicMetrics>) => [relativeChange(metrics[0][key], metrics[1][key]), relativeChange(metrics[1][key], metrics[2][key])];
  const relativeChanges = { residualDisplacement: changes('residualDisplacementMm'), unloadingStiffness: changes('unloadingStiffnessNPerMm'), reloadingStiffness: changes('reloadingStiffnessNPerMm') };
  const failures: string[] = [];
  for (const [key, values] of Object.entries(relativeChanges)) {
    if (requireContraction && !(values[1] <= values[0] + 2e-4)) failures.push(`${label} ${key} changes did not contract: ${values}.`);
    if (!(values[1] < .03)) failures.push(`${label} ${key} fine change ${values[1]} exceeds 3%.`);
  }
  return { metrics, relativeChanges, limit: .03, requireContraction, failures };
}
function normalizedCurveChange(first: number[], second: number[]) {
  const scale = Math.max(...second.map(Math.abs), 1e-12);
  return Math.max(...first.map((value, index) => Math.abs(value - second[index]) / scale));
}
function maximumCurveChange(first: number[], second: number[]): number { return Math.max(...first.map((value, index) => relativeChange(value, second[index]))); }
function historyDisplacementAt(history: Extract<NeutralSimulationResultV2, { analysisType: 'nonlinear_static' }>['nonlinear']['history'], loadFactor: number): number {
  const points = history.map(point => ({ load: point.loadScaleFactors[0].scaleFactor, displacement: point.maximumDisplacementMm }))
    .filter((point, index, entries) => index === entries.length - 1 || Math.abs(entries[index + 1].load - point.load) > 1e-10)
    .sort((a, b) => a.load - b.load);
  const exact = points.find(point => Math.abs(point.load - loadFactor) < 1e-10);
  if (exact) return exact.displacement;
  const rightIndex = points.findIndex(point => point.load > loadFactor);
  if (rightIndex <= 0) throw new Error(`Load factor ${loadFactor} is outside nonlinear history.`);
  const left = points[rightIndex - 1]; const right = points[rightIndex];
  return left.displacement + (right.displacement - left.displacement) * (loadFactor - left.load) / (right.load - left.load);
}

async function solve(request: NeutralSimulationRequestV2, geometry: Uint8Array, mesher: GmshMultiDomainMeshProvider, solver: CalculiXMultiDomainSolverProvider): Promise<NeutralSimulationResultV2> {
  const model = await mesher.mesh(request, { descriptor: request.model, async exportDomain() { return geometry; } });
  const submission = await solver.submit(request, model);
  for (let attempt = 0; attempt < 1200; attempt++) {
    const status = await solver.getStatus(submission.providerRunId);
    if (status.status === 'succeeded') {
      const result = (await solver.getResult(submission.providerRunId))!;
      return { ...result, provenance: { ...result.provenance, mesh: {
        meshId: model.modelId, adapterId: model.provenance.adapterId, adapterVersion: model.provenance.adapterVersion,
        engine: model.provenance.engine, engineVersion: model.provenance.engineVersion,
        nodeCount: model.quality.nodeCount, elementCount: model.quality.elementCount, boundaryFacetCount: model.quality.boundaryFacetCount,
        minimumQuality: model.quality.minimum, averageQuality: model.quality.average, volumeRelativeError: model.quality.volumeRelativeError,
      } } };
    }
    if (status.status === 'failed' || status.status === 'cancelled') throw new Error(`${status.failure?.code ?? status.status}: ${status.failure?.message ?? status.phase}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the bounded SIM-7 native solve.');
}
