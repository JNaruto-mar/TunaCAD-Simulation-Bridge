# SIM-9 bounded optimization evidence matrix

Consolidated 2026-09-28. Status: `proof_of_concept`;
`engineeringUsePermitted: false`. Optimization provider admission remains
closed. This document consolidates existing evidence; it does not record
new test executions, authorize deployment, or promote the capability.

PASS means the named, bounded lane is demonstrated, not that optimization
or engineering feasibility is qualified. FAIL means a tested gate is
unsatisfied. PENDING means that broader integration or evidence is absent;
it is not an instruction to run additional fixtures merely for consolidation.

## Evidence sources

- **S1:** [development record](SIM9_OPTIMIZATION_DEVELOPMENT_STATUS.md):
  chronological results, numerical tables, test executions and limitations.
- **S2:** [foundation fixture](../scripts/test-sim9-optimization-foundation.mts)
  and [foundation guard](../simulation-bridge/optimizationFoundation.mts).
- **S3:** [candidate fixture](../scripts/test-sim9-optimization-candidate.mts)
  and [candidate comparison](../simulation-bridge/optimizationCandidate.mts).
- **S4:** [real CAD/provider fixture](../scripts/test-sim9-optimization-candidate-real.mts):
  independent CAD revisions, structural solves, lifecycle negatives,
  global refinements and local stress diagnostics.
- **S5:** [evidence-admission fixture](../scripts/test-sim9-optimization-evidence-admission.mts)
  and [admission guard](../simulation-bridge/optimizationEvidenceAdmission.mts).
- **S6:** [immutable archive](../simulation-bridge/optimizationRefinementArchive.mts),
  [archive replay fixture](../scripts/test-sim9-optimization-archive-replay.mts)
  and S4's capture path.
- **S7:** [complete-matrix capture/replay](../scripts/sim9-optimization-archive-matrix.mts)
  and [ten-record metadata index](SIM9_OPTIMIZATION_ARCHIVE_RECORD_INDEX.json).

The index is metadata, not proof by itself. Real-provider-backed claims
refer to the recorded successful reads of retained normalized archives,
independent completion/source-state roots and trusted current source records.
Those local payloads are not shipped in this repository. Fixture configuration
readers are trusted within that host boundary, not the live TunaCAD CAD database.

## Capability-specific lanes

| ID | Lane | Status | Evidence | Provenance and bounded scope / limitations |
| --- | --- | --- | --- | --- |
| O01 | Contract, units and deterministic request seal | PASS | S1, S2 | Synthetic: one versioned CAD length, 80–120% range, mm / mm³ / MPa; 34 unsupported/stale/tampered rejection cases. No optimizer. |
| O02 | Immutable completed/converged baseline binding | PASS | S1, S2, S7 | Synthetic negatives plus real-provider replay: exact CAD parameter/revision, request/model/job/result, domain field and material digests; fresh trusted reads, not caller assertions. |
| O03 | Deterministic baseline/candidate comparison | PASS | S1, S3, S7 | Synthetic branches and 28 rejection cases; authentic real-identity comparison. Nominal feasibility and objective value only unless O14 admits robust evidence. |
| O04 | Independently revised CAD and selected-parameter-only change | PASS | S1, S4, S7 | Real OpenCASCADE STEP/configuration fixture, 10→9 mm; separately bound revisions and change record. Not live CAD/project-store wiring. |
| O05 | Completed real structural baseline/candidate studies | PASS | S1, S4, S7 | Real Gmsh 4.15.2 / CalculiX 2.16, same material/load/restraint; selected global 2 mm pair. Not general-shape validation. |
| O06 | Complete domain-owned raw stress fields | PASS | S1, S4, S6, S7 | Real-provider-backed pages, descriptor/chunk/dataset digests, independently recovered maxima and element centroids; malformed/tampered fields rejected. Centroid is not exact integration-point position. |
| O07 | Cancellation and failed-source quarantine | PASS | S1, S4 | Real active cancellation and provider-start failure expose no result/field/comparison; synthetic pre-submit, stale, changed-source and incomplete-field negatives. |
| O08 | Non-converged source rejection | PASS | S1, S4 | Synthetic altered trusted-result snapshot is rejected. This is not an actual non-converged CalculiX run. |
| O09 | Deliberately non-converged real optimization-source solve | PENDING | S1 | No real-provider fixture for this case; separate future lifecycle evidence if required by a chosen release scope. No rerun required for this consolidation. |
| O10 | Bounded global/local mesh evidence collection | PASS | S1, S4, S7 | Real-provider-backed: three global levels and two local diagnostics per design, ten authenticated records; counts, definitions, stresses and peaks match historical evidence. Collection is not convergence. |
| O11 | Restraint-edge peak diagnosis | PASS | S1, S4, S7 | Real local refinement: rising peaks approach fixed/free perimeter and switch symmetry corners; stable distant probes support a singular/near-singular concentration diagnosis. No formal singularity proof or alternative constraint metric. |
| O12 | Raw maximum von Mises numerical stability | FAIL | S1, S5, S7 | Real global/local peaks keep rising; latest changes do not shrink sufficiently and approach the critical edge. Complete archives do not repair this failure. |
| O13 | Nominal objective improvement and feasibility | PASS | S1, S3, S7 | Real bound global 2 mm pair: volume 4000→3600 mm³, candidate raw stress 1.4382011838 MPa < 2 MPa. All recorded meshes nominally satisfy the cap; no robust conclusion follows. |
| O14 | Robust feasibility of the 9 mm candidate | FAIL | S1, S5, S7 | Authentic ten-record admission returns `nominal_only_insufficient_numerical_evidence`; fixed raw-maximum constraint and thresholds unchanged. |
| O15 | Fail-closed numerical-evidence admission | PASS | S1, S5, S7 | Synthetic trusted-store tests use recorded real numbers, 32 rejection cases and a synthetic stable branch; authentic matrix correctly returns FAIL, not an accepted robust candidate. |
| O16 | Immutable provider-backed refinement archive | PASS | S1, S6, S7 | Ten real normalized records, exact FEM definitions/counts, runtime, stress field, raw peak, completed/converged state and record digests; 15 capture and 20 replay tamper/staleness checks recorded. |
| O17 | Trusted reader, source and independent completion-ledger verification | PASS | S1, S6, S7 | Real archive reload/source rebinding plus altered identity/field/runtime/mesh/peak/digest negatives. Protected host/OS ledger is a trust boundary, not a cryptographic signature against ledger replacement. |
| O18 | Complete ten-record real-identity manifest | PASS | S1, S7 | All 10/10 authentic records and selected global 2 mm source identities reloaded; original 4 mm baseline reused, only nine missing rows regenerated. Historical 1/10 PENDING is superseded. |
| O19 | Deterministic authentic replay and recorded reproduction | PASS | S1, S7 | Original-reader and bounded-stream replays yield identical report root; nine regenerated numerical summaries/counts reproduce exactly. No blanket multi-host or repeated full-solve campaign claim. |
| O20 | Live TunaCAD CAD-revision/parameter/change-record readers | PENDING | S1, S4, S7 | Fixture-backed trusted sources only; production database integration remains separate. No live mutation-proof workflow is claimed. |
| O21 | User-facing optimization preparation/approval and hosted workflow | PENDING | S1 | No optimization MCP/browser authoring, automatic candidate generation, optimizer loop or public-beta workflow admitted. Existing structural lifecycle is reused, not bypassed. |
| O22 | Published implementation/version-bound release evidence | PENDING | S1, S7 | Numerical records bind exact recorded provider runtimes; consolidation does not establish a published Bridge/TunaCAD release or hosted comparison. |
| O23 | Independent engineering review / formal qualification | PENDING | S1 | Future intentional formal-qualification gate only; not a mandatory next step for development, tutorials or experimental deployment. Engineering use remains forbidden. |

Totals: **16 PASS / 2 FAIL / 5 PENDING**. O09 and O20–O23 are
separate scope/evidence gaps; they must not be interpreted as numerical PASS.

## Exact real scope and immutable roots

One manually selected thickness parameter, `thickness-extrude/thickness`:
40 × 10 × 10 mm baseline, revision `opt-cad-b1a1241c2d42`; 40 × 10 × 9 mm
candidate, revision `opt-cad-dc6470f70dce`. Bounds 8–12 mm. Material:
E = 210000 MPa, nu = 0.3, density = 7850 kg/m³ with versioned custom
provenance. One fixed x = 0 FACE and a 100 N axial force on x = 40 FACE.
Objective is selected-domain CAD volume; constraint is its **raw maximum**
von Mises stress ≤ 2 MPa. No probe, average, percentile or smoothed substitute.

Recorded runtime tuple: Gmsh 4.15.2 / CalculiX 2.16 / Node major 24.
Selected sources are the global 2 mm studies, not local diagnostic meshes.

| Design | Global size (mm) | Nodes / elements | Raw maximum (MPa) |
| --- | --- | --- | --- |
| Baseline | 4 | 931 / 428 | 1.0872984735 |
| Baseline | 3 | 2006 / 1035 | 1.1896614267 |
| Baseline | 2 | 4636 / 2607 | 1.3026304642 |
| Candidate | 4 | 931 / 428 | 1.1978471692 |
| Candidate | 3 | 1874 / 967 | 1.2981391977 |
| Candidate | 2 | 4468 / 2505 | 1.4382011838 |
| Baseline | local 1.5 | 2838 / 1530 | 1.4658470100 |
| Baseline | local 1.0 | 5926 / 3500 | 1.6686843087 |
| Candidate | local 1.5 | 2621 / 1386 | 1.6010257778 |
| Candidate | local 1.0 | 5445 / 3184 | 1.8206577004 |

Observed global spreads are 0.2153319907 / 0.2403540146 MPa;
they are empirical spreads, not certified error bounds or formal orders.
The candidate local last rise is 0.2196319227 MPa, exceeding its
remaining 0.1793422996 MPa constraint margin. Both designs fail
`GLOBAL_STRESS_UNSTABLE`, `LOCAL_STRESS_UNSTABLE`,
`PEAK_APPROACHES_CRITICAL_REGION` and
`REFINEMENT_CHANGE_EXCEEDS_MARGIN`.

The unchanged `raw-maximum-stability/1` guard requires ordered matching
refinement records, all raw stresses within the cap, shrinking global
changes no greater than 5%, adequate margin against twice the observed
spread/latest change, bounded local changes, and no nonconverging peak
approach to the critical restraint/load region. Missing, stale or mismatched
evidence throws instead of yielding an admitted comparison; authentic but
unstable evidence yields nominal-only / robust FAIL.

- Manifest: `sim9-optimization-authentic-ten-record-matrix`.
- Evidence: `sha256:3cabb227d5d41fe596abdaa495459e799730219d276ca47498b5af3a8ced0a7b`.
- Comparison: `sha256:d6933f641903cd3a9b04dc54272143625733497a1792e6ee7723705eb91175ac`.
- Report: `sha256:6d6e4c77df5e61d95adbadf85a5c43380b8993b5829e77dc802713dc5b4ce1eb`.

## Decision and remaining roadmap scope

No additional numerical validation is required merely to consolidate these
current records. No solver, historical, qualification or browser suite was
rerun for this matrix. Prior numerical evidence remains current; this
documentation change invalidates no physics or archived identity.

The binding/archive/fail-closed subset is evidenced for later scope-specific
internal-validation consideration, but the unchanged raw-stress **robust
feasibility capability is not ready** for an internally-validated/public-beta
feasibility claim. O12/O14 remain FAIL. A later experimental diagnostic-only
scope would need an explicit scope/release decision and O20–O22 integration,
not an automatic status change. Independent review is relevant only if
formal qualification is intentionally pursued.

No optimizer loop, automatic candidate generation, topology remeshing,
gradient/search algorithm, changed design, alternative stress metric or
material certification is implemented. Broader shapes/materials and
uncertainty are not validated by this one-case fixture.

The canonical roadmap does not specify another bounded optimization
implementation after consolidation. Its recorded live CAD/project-reader
integration gap (O20) remains incomplete, and the raw-stability gate remains
FAIL for this unchanged case. Do not infer an optimizer loop as the next
step. The next named analysis-family entry is specialist domains, requiring
actual user-demand prioritization and a separate contract/scope first.
