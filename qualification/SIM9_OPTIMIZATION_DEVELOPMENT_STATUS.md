# SIM-9 optimization development status

Status: `proof_of_concept`, one real candidate comparison, complete ten-record
provider-backed refinement archive and capability-specific evidence consolidation,
`engineeringUsePermitted: false`. No optimization provider,
candidate generation, solver iteration, geometry transfer, browser/MCP
authoring, or claimed optimum is admitted.

Current outcome: provenance/manifest replay PASS (10/10); raw-maximum
numerical stability and robust feasibility FAIL. See the
[capability-specific evidence matrix](SIM9_OPTIMIZATION_EXIT_GATE_MATRIX.md)
for synthetic versus real-provider-backed lanes and remaining integration
gaps. Earlier increment descriptions below are chronological, not current
claims that the now-complete archive is still missing nine records.

The roadmap names topology/parameter optimization only as an
orchestrator of immutable studies. This first increment deliberately
defines one parameter-study envelope, not topology optimization.

## Exact contract

`tunacad-optimization-foundation/0.1` accepts one completed,
converged, single-domain linear-static structural source study.
It identifies the exact study, job, request, model, project revision,
result, material assignment and versioned material source, domain,
part/body, named FACE reference, and domain-owned von Mises field
dataset and descriptor. Its optimization input digest is computed over the
entire sealed optimization input, not only caller-supplied IDs.

One `cad_length` variable has a durable feature/parameter ID,
versioned CAD-project provenance, a trusted parameter-snapshot
digest, and a strictly interior baseline. The admitted positive
range is within 80–120% of baseline and at most 1,000,000 mm;
the only variable unit is mm. The objective is to minimize the
named domain's CAD volume (mm³). The single feasibility constraint
is that the named domain's maximum von Mises stress (MPa) is at or
below an explicit limit; the baseline must already be feasible.
The field dataset and FACE reference provide traceable ownership
and an identity anchor. The baseline stress is a **domain maximum**,
not a stress value claimed at that FACE.

The first foundation does not evaluate a changed design. Material uncertainty is not quantified,
and a versioned source does not imply material certification.

## Immutable-source binding

`bindOptimizationFoundation` reads the current project revision
before and after the trusted snapshots, along with the
sealed structural request, completed result, stress-field descriptor,
and CAD parameter snapshot through a trusted internal reader—not
from caller JSON. It independently verifies:

- source request, model, and domain digests and their exact identities;
- a successful converged engineering result, unchanged revision,
  result digest, unique domain field ownership, and domain stress;
- a von Mises/MPa field descriptor tied to the same job/domain,
  dataset digest, and named semantic reference;
- the selected CAD feature/parameter's revision, baseline value,
  provenance, and full snapshot digest.

Missing, stale, changed, unsupported, or malformed source records
fail closed. The proof says `providerAdmission: closed` and
`engineeringUsePermitted: false`. The current implementation defines
the trusted-reader boundary; connecting it to live CAD parameter
storage and running candidate studies is future work.

The focused synthetic fixture uses a 10 mm baseline variable over
9–11 mm, 1,000 mm³ baseline volume, 80 MPa baseline domain stress,
and a 100 MPa stress limit. Deterministic sealing and binding pass;
34 stale/tampered/unsupported cases are rejected, including a
revision change during binding. No real solver or
optimization campaign ran. Existing SIM-2–SIM-9 numerical evidence
is not stale because their physics, providers, result normalization,
and lifecycle paths were not changed.

## Second bounded increment: one immutable candidate comparison

`tunacad-optimization-candidate/0.1` identifies exactly one
separately completed structural study/result at a different CAD
revision, with a changed value of the same feature/parameter inside
the baseline 80–120% interval. It seals the candidate request and
the independently claimed result, field descriptor, CAD parameter,
volume, and domain-maximum stress identities/digests.

`compareOptimizationCandidate` obtains a fresh proof for the
baseline and independently binds the candidate using the same
trusted snapshot verifier. A separate trusted CAD change record,
read and digest-checked before and after comparison, must identify
exactly this feature/parameter's baseline and candidate values,
both model digests, the parent/candidate revisions, and
`otherChanges: false`. It requires distinct study/job/revision,
request/model/result/field identities, identical domain/part/body,
parameter identity, material provenance, named FACE reference, and
non-geometric simulation settings (analysis, units, materials,
loads, constraints, interactions, mesh policy, requested results).
It verifies both sources a second time before returning a
comparison; any missing, stale, mutated, incomplete, cancelled,
unconverged, out-of-range, or mismatched source rejects the entire
comparison. There is no partial or retrievable result on rejection.

The result reports both parameter values, CAD volumes, and named
domain von Mises maxima; stress-limit satisfaction, feasibility,
volume delta (baseline minus candidate), percentage change, and
`improved/tied/regressed` outcome. Feasibility and objective
improvement are separate; an improved but overstressed candidate
is explicitly infeasible. No optimum, design recommendation,
uncertainty reduction, or professional qualification is inferred.

The focused synthetic fixture compares 10 mm / 1,000 mm³ / 80 MPa
against 9 mm / 900 mm³ / 95 MPa under a 100 MPa cap: feasible,
100 mm³ (10%) volume improvement. It also exercises improved-but-
infeasible and feasible-but-regressed branches, deterministic
repeatability, and 28 stale/tampered/mismatched candidate
rejections. The directly affected foundation fixture still passes
34 source-rejection cases. At this second-increment stage no real
CAD candidate or solver was run; the next increment below adds one.

## Third bounded increment: one real independently revised candidate

The focused `test:sim9-optimization-candidate-real` fixture builds two
OpenCASCADE STEP boxes from separate digest-addressed CAD configurations.
Their only changed configuration key is the versioned
`thickness-extrude/thickness` parameter, 10→9 mm; the length and width
remain 40×10 mm. Each revision has its own sealed linear-static request,
Gmsh 4.15.2 C3D10 mesh, CalculiX 2.16 completed converged result,
provider-owned paginated stress dataset, and CAD-parameter snapshot.
The trusted test reader obtains the structural result from the completed
provider run; it rereads all stress pages, validates every chunk and
descriptor, proves complete sequential coverage and the whole-dataset
digest, and checks surface extrema against the reported domain maximum.
The CAD change record is derived from the independently generated
configurations and is digest-checked against both sealed model revisions.
Both source bindings and the change record are read again immediately
before the comparison is released.

| Revision | Thickness | CAD / mesh volume (mm³) | Nodes / elements | Domain maximum von Mises (MPa) |
| --- | ---: | ---: | ---: | ---: |
| `opt-cad-b1a1241c2d42` | 10 mm | 4,000 / 4,000 | 927 / 423 | 1.0881527204 |
| `opt-cad-dc6470f70dce` | 9 mm | 3,600 / 3,600 | 922 / 421 | 1.1978594885 |

Under the fixture's 2 MPa cap, the candidate is feasible and reduces
CAD volume by 400 mm³ (10%). Repeating the read/bind/compare sequence
over the same completed records returns an identical comparison.
No cross-mesh stress-convergence or design uncertainty is inferred.

The focused fixture rejects cancelled/failed/unconverged snapshots,
stale revision, post-solve request change, mismatched result digest,
altered CAD parameter or change record, missing intermediate field
pages, changed field values, and a missing pre-submit result. An active
candidate-geometry submission cancelled during the provider run reports
`cancelled_cleaned` and exposes neither result nor stress dataset. A
separate unavailable-executable provider attempt reports `failed` and
exposes neither. The non-convergence case is a deliberately altered
trusted result snapshot, **not** a real non-converged CalculiX run.

The CAD revision/change-set and parameter snapshots here are a
deterministic, fixture-owned trusted store backed by two actual STEP
generations; they are not yet wired to TunaCAD's live CAD revision
database or browser/MCP authoring. No optimization candidate is
automatically generated, no iterative solve loop or topology optimizer
exists, and provider admission remains closed. Optimization stays
`proof_of_concept` with `engineeringUsePermitted: false`. Existing
SIM-2–SIM-9 physics and normalization paths were not changed, so their
earlier numerical evidence is not stale.

## Fourth bounded increment: mesh sensitivity and uncertainty

The focused `test:sim9-optimization-convergence-real` fixture keeps
both CAD revisions, thicknesses, materials, 100 N axial load, fixed
FACE, and 2 MPa cap unchanged. It runs just three effective
global-size levels per revision. A preliminary 12/10/8 mm attempt
produced identical meshes, so it was not treated as convergence
evidence. The 4/3/2 mm matrix actually increases node and element
counts. Every level has the same exact CAD volume; each mesh volume
agrees within 0.01 mm³. Every provider result completed and converged.
The finest 2 mm pair is independently rebound through the unchanged
immutable-study comparison immediately before reporting.

| Design | Size (mm) | Nodes | Elements | CAD volume (mm³) | Max von Mises (MPa) | Absolute change to next finer (MPa) | Under 2 MPa? |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline, 10 mm | 4 | 931 | 428 | 4,000 | 1.087298 | 0.102363 | yes |
| Baseline, 10 mm | 3 | 2,006 | 1,035 | 4,000 | 1.189661 | 0.112969 | yes |
| Baseline, 10 mm | 2 | 4,636 | 2,607 | 4,000 | 1.302630 | — | yes |
| Candidate, 9 mm | 4 | 931 | 428 | 3,600 | 1.197847 | 0.100292 | yes |
| Candidate, 9 mm | 3 | 1,874 | 967 | 3,600 | 1.298139 | 0.140062 | yes |
| Candidate, 9 mm | 2 | 4,468 | 2,505 | 3,600 | 1.438201 | — | yes |

The deterministic uncertainty indicator is the **maximum observed
pairwise stress spread** over these three meshes, not an extrapolated
error bound or formal convergence order: 0.215332 MPa for baseline
and 0.240354 MPa for candidate. At 2 mm, the candidate's stress
margin is 0.561799 MPa, greater than twice the observed spread
(0.480708 MPa), but the fine-step change is 9.74% of its final
stress and grew rather than shrank. The baseline similarly changes
8.67% at the fine step. The declared stability rule requires the
fine-step change to be at most 5% and no larger than the preceding
step. Therefore the **numerical-stability and robust-feasibility
gates are FAIL**, even though all observed meshes are nominally
feasible and the CAD-volume objective improves by 400 mm³ (10%).
No professional engineering feasibility conclusion follows from
this matrix.

The real convergence fixture completed; its reported FAIL is a
deliberate evidence outcome, not a test-process failure. Existing
SIM-2–SIM-9 physics and provider behavior were not changed, so their
earlier numerical evidence is not stale. The previous 8 mm
optimization comparison is superseded as a selected numerical
baseline by this 2 mm pair but remains valid historical evidence.
Optimization stays `proof_of_concept` with
`engineeringUsePermitted: false`.

## Fifth bounded increment: fixed-perimeter peak diagnosis

`test:sim9-optimization-stability-real` keeps both geometries and all
physics unchanged. The global 4/3/2 mm results now record maximum
element-centroid locations and a non-averaged nearest boundary-facet
probe to [20, 0, thickness/2] mm. The maxima move among symmetry-
equivalent corners of the fixed-end perimeter as the mesh changes,
and approach x=0 and a free side edge. This is not a hotspot on the
loaded face at x=40.

| Design | Mesh control | Nodes / elements | Peak position (mm) | Peak (MPa) | Change from preceding row (MPa) |
| --- | --- | ---: | --- | ---: | ---: |
| Baseline | global 4 mm | 931 / 428 | [2.262, 9.426, 9.426] | 1.087298 | — |
| Baseline | global 3 mm | 2,006 / 1,035 | [1.617, 0.445, 9.556] | 1.189661 | +0.102363 |
| Baseline | global 2 mm | 4,636 / 2,607 | [1.232, 9.634, 0.366] | 1.302630 | +0.112969 |
| Baseline | local 1.5 mm | 2,838 / 1,530 | [0.847, 9.752, 0.248] | 1.465847 | +0.163217 |
| Baseline | local 1.0 mm | 5,926 / 3,500 | [0.590, 0.176, 9.821] | 1.668684 | +0.202837 |
| Candidate | global 4 mm | 931 / 428 | [2.265, 0.585, 8.515] | 1.197847 | — |
| Candidate | global 3 mm | 1,874 / 967 | [1.655, 9.556, 8.508] | 1.298139 | +0.100292 |
| Candidate | global 2 mm | 4,468 / 2,505 | [1.187, 9.634, 0.319] | 1.438201 | +0.140062 |
| Candidate | local 1.5 mm | 2,621 / 1,386 | [0.846, 9.752, 0.247] | 1.601026 | +0.162825 |
| Candidate | local 1.0 mm | 5,445 / 3,184 | [0.584, 0.176, 8.828] | 1.820658 | +0.219632 |

Local meshes use the same STEP solid with a Gmsh Box size field only
over x=0–5 mm, the full fixed-end cross-section, and a 1 mm transition;
outside it the size is 4 mm. Thus the jump from global 2 mm to local
1.5 mm is a diagnostic comparison, not a uniform-refinement
convergence step. The two local levels share the same outside mesh
control. Existing MSH parsing, FACE matching, neutral composition,
model validation, and the CalculiX submit/status/result lifecycle
are reused. The fixture checks a 30 s Gmsh timeout, a 24 MiB MSH
bound, 15,000 nodes, and 7,500 elements. No user-facing local mesh
setting or contract is added.

The global midspan-side probes are baseline
1.0000295 / 1.0000831 / 1.0000213 MPa and candidate
1.1112371 / 1.1111642 / 1.1111695 MPa, close to the analytical
100 N / area values of 1 and 1.1111111 MPa. These are diagnostic
nearest-facet samples, not averaged replacement metrics; their
sample positions are recorded in the test output. The domain peak
is extracted from the provider's full element-stress output, while
its reported position is the owning element centroid, not the exact
integration point. Sampling and mesh asymmetry explain the corner
switching but do not remove the fixed/free boundary concentration.

**Diagnosis:** the idealized fully fixed end suppresses transverse
Poisson contraction up to a sharp fixed/free perimeter. The
localized rising peak and stable remote stress are consistent with
a restraint-edge singular/near-singular concentration, not ordinary
whole-bar under-resolution or a distributed-load-face error. Finite
mesh evidence does not prove a mathematical asymptote; it does show
that this raw maximum is not converged. At the 1 mm local candidate
mesh, the 2 MPa margin is only 0.179342 MPa, smaller than its last
0.219632 MPa rise. The peak also moves closer to the fixed perimeter.
The robust-feasibility gate remains **FAIL**.

No stable alternative comparison metric was established. The
recorded contract requires the selected-domain raw maximum; it does
not permit discarding a perimeter strip, averaging a hotspot, or
replacing the maximum by a far-field probe to manufacture PASS.
The local size field is fixture-only diagnostic evidence with an
explicit mesh-options digest; it is not encoded in the current
sealed mesh-request contract and is not admitted as an optimization
comparison source. The unchanged global 2 mm pair is freshly rebound
before diagnostic reporting.

Earlier numerical evidence is not stale: only a normalizer export
was added for fixture reuse, without changing its implementation,
and peak/probe diagnostics were added to the test. The former
nominal-feasibility observations remain historical evidence, not
robust-feasibility approval. Optimization stays `proof_of_concept`,
`engineeringUsePermitted: false`.

## Sixth bounded increment: fail-closed numerical-evidence admission

`admitOptimizationNumericalEvidence` is a separate provider-closed
guard around the existing immutable comparison. It does not change
`compareOptimizationCandidate`, the raw-domain-maximum constraint,
CAD definitions, or solver paths. Its caller provides only an
evidence ID/digest reference. Trusted readers must supply:

- a strict numerical-evidence record tied to both optimization inputs,
  the exact fresh comparison digest, both selected-source digests,
  `raw-maximum-stability/1` policy, and the current trusted
  Gmsh 4.15.2 / CalculiX 2.16 / Node 24 tuple;
- exactly three ordered, genuinely distinct global refinement records
  per design, whose finest source is exactly the selected study/result;
- two ordered local diagnostics when the global peak is in a critical
  restraint/load-edge zone; these remain diagnostic, not replacement
  comparison sources;
- each row's exact immutable source request/model/revision/job/result,
  versioned material provenance, domain-owned field descriptor/dataset,
  parameter snapshot, CAD volume, raw stress and peak centroid;
- a separately retained validated-FEM summary cross-checking node/
  element counts, mesh-options digest, and request/result identities;
- complete provider-owned stress-field pages, reread through the
  existing bounded page/chunk/full-dataset verifier.

Each row is rebound with `bindOptimizationSnapshot`. Non-geometric
physics and fixed mesh policy must match the selected source; only
resolution can vary. Peak value/location must match the actual
completed raw structural result. Critical-edge proximity is derived
from sealed planar rectangular FACE bounds/area and result peak
location, not accepted as a caller's safe-region label. This bounded
assessment admits identity-transform, axis-aligned rectangular
load/restraint faces only; missing or unsupported assessment fails
closed. A zone within twice the applicable mesh resolution requires
critical-region evidence; this is a conservative fixture assessment,
not a mathematical singularity certification. All records, field
pages, geometry assessment, runtime evidence, and the nominal
comparison are verified again before a report can be returned.

The fixed deterministic rule is:

1. The last global stress change is at most 5% of the selected raw
   stress and no greater than the preceding change.
2. Remaining stress margin strictly exceeds twice both the observed
   global mesh spread and the latest refinement change. Every required
   global/local raw maximum must also remain strictly below 2 MPa.
3. A peak approaching a critical boundary with increasing stress
   fails if its last relative change exceeds 5% or exceeds the last
   global change. Required local diagnostics also fail independently
   for either of these instability conditions, even if the peak moves
   away from the critical edge, and obey the same margin test.
4. Both baseline and candidate must pass these evidence gates before
   `robustFeasible: true` is possible. No probe/average/percentile/
   smoothing metric is accepted by the strict record schema.

Valid but unstable evidence returns nominal feasibility separately
from `robustFeasible: false` and a numerical `FAIL` classification.
Missing, malformed, stale, unsupported, altered, wrong-result,
wrong-revision, wrong-runtime, incomplete-field, or changing evidence
throws `SIM9_OPTIMIZATION_EVIDENCE_INVALID` (or the existing source
binding error) and returns no admitted robust report.

The current numerical replay remains
`nominal_only_insufficient_numerical_evidence`: 400 mm³ objective
improvement, nominally feasible 9 mm candidate, robust feasibility
**FAIL**. Reasons are `GLOBAL_STRESS_UNSTABLE`,
`LOCAL_STRESS_UNSTABLE`,
`REFINEMENT_CHANGE_EXCEEDS_MARGIN`, and
`PEAK_APPROACHES_CRITICAL_REGION`. The global 2 mm candidate is
1.438201 MPa; its local 1 mm diagnostic is 1.820658 MPa and the
0.219632 MPa last rise exceeds its 0.179342 MPa remaining margin.

`test:sim9-optimization-evidence-admission` passes without a solver,
using the recorded real stresses/counts/peak locations with
**synthetic trusted-store identity/result/field fixtures**. It does
not fabricate genuine archived real-job digests. It exercises the
current FAIL, a purely synthetic stable PASS branch (not qualification
of the real fixture), a margin-failure branch, deterministic reports,
and 32 missing/stale/tampered/incomplete/resealed/change-during-read
rejections. No expensive mesh/stability solve was rerun. Existing
real numerical evidence remains current because no provider physics
or normalization implementation changed.

Optimization stays `proof_of_concept` with
`engineeringUsePermitted: false`. No provider/MCP/browser admission
or formal engineering promotion is added.

## Seventh bounded increment: provider-backed capture/readers

Capture/readers implemented; complete authentic refinement matrix
**PENDING (1 / 10 records captured)**. Historical fixture code removed
its temporary directory and did not persist normalized requests,
results, FEM models and field pages. Numerical tables cannot reconstruct
those immutable identities. No historical digest has been fabricated
and the full matrix was not rerun merely to populate storage.

`OptimizationRefinementArchive` reads only host/provider-owned completion
callbacks by job ID. The strict admission record is retained inside a
`tunacad-optimization-refinement-archive/0.1` envelope containing its
record digest, exact request/result, CAD thickness snapshot/material
provenance, runtime tuple, validated FEM model, actual mesh-option
definition, complete verified 128-triangle field pages and resolved peak
element/centroid. Peak element identity is uniquely resolved against the
domain-owned FEM element centroid, not guessed from a surface maximum.
Mesh-option definition must hash to the real mesher options digest.
State must be succeeded/converged. Capture reads and binds the entire
source twice before publishing.

Normalized blobs are bounded to 32 MiB and written exclusively under
their SHA-256 content address. Independent immutable completion roots
are persisted in a separate host-owned completion ledger. Its directory
is a trusted OS/host-state boundary, not caller/upload storage; this is
digest-integrity protection, not a signature against an attacker able
to rewrite the trusted ledger itself. No credentials, absolute provider
paths or raw solver artifacts are stored in the envelope or public repo.
The host API accepts job/evidence IDs for capture/admission, not caller
records/digests. A trusted manifest-pinning seam verifies every referenced
archive exists; it is not a Bridge/MCP tool and admits no result by itself.

Reload readers verify the independent root and blob on every call,
including the admission guard's second pass. They recover completed
results, field pages/descriptor and independently retained mesh summaries
from normalized storage. The current trusted CAD revision, parameter,
sealed study request, completed-result identity/state and runtime are
checked again. The host must retain these current source records;
expiration/missing current sources fails closed, not silently trusted
from the archive. A combined admission wrapper uses both design archives
with the existing guard; thresholds and raw-maximum policy are unchanged.
No live TunaCAD CAD/project-store integration is claimed by this
provider-development fixture.

### Authentic provider capture (2026-09-27)

The minimum new solve was the unchanged 40 × 10 × 10 mm baseline at
4 mm global size: 100 N axial force, the same fixed FACE, elastic steel
E = 210000 MPa, nu = 0.3. Actual executable version probes confirmed
Gmsh 4.15.2 / CalculiX 2.16; Node 24.18.0. It exactly reproduces the
recorded 931 nodes / 428 elements / 1.0872984734609643 MPa.

- CAD revision: `opt-cad-b1a1241c2d42`; thickness 10 mm; volume 4000 mm³.
- Structural job: `calculixv2_766bf723-cfe6-4a1f-866a-f22f03ae927f`.
- Peak composed-FEM element index: 393 (zero-based); centroid
  [2.2619153769261833, 9.426184107177622, 9.426184107177622] mm.
- Immutable blob root:
  `sha256:2b94d8924fcb3c63b7ccd93c2a3bf1f2ded99c7f62854a609f0deeac166f81e6`.
- Refinement record digest:
  `sha256:152a082f2820436cc3b587538d05d995138d8313f3a9e2d6eb065ba1fa13cc58`.
- Complete stress-field dataset digest:
  `sha256:7e6c54b2ac9979305949d4c5d7da64dfe4ac21a1eb17272e7b9fce12c1271c5a`.

The retained normalized blob and separate ledger are local assets,
outside the repositories, not committed fixtures. Exact reopening,
idempotent capture and full stress-field replay passed. The real capture
fixture rejected 15 alteration/staleness/missing-root cases. A second
solver-free replay pinned to this actual completion root rejected 20
source-state, revision, request, parameter, runtime, mixed-job and
resealed-blob substitutions. The existing admission replay passes its
32 negatives and keeps the recorded candidate nominally feasible /
robust **FAIL**; it remains an explicitly synthetic identity replay for
the other numerical rows, not an authentic ten-record admission.

Focused commands: `test:sim9-optimization-archive-real` (one solve via
`--capture-one`), `test:sim9-optimization-archive-replay` (no solve),
`test:sim9-optimization-evidence-admission`. The first startup attempt
identified unsupported strip-only parameter-property syntax; it was
corrected before solving. The executable probe also required handling
CalculiX's informational `-v` exit status 201. Neither was a physics or
numerical regression. Existing provider physics and normalization are
unchanged; prior numerical evidence is not stale.

## Eighth bounded increment: authentic ten-record archive closure

On 2026-09-28 the user explicitly approved **only the nine missing**
real Gmsh/CalculiX refinement solves. The existing 10 mm / global 4 mm
baseline was reopened against its original completion root, never
remeshed or solved again. All nine missing cases were immediately
captured with the existing archive implementation before proceeding
to another case. No geometry, material, load, restraint, raw-domain-
maximum 2 MPa constraint, mesh definition, or numerical threshold changed.

The original local diagnostic helper was mechanically relocated so
the approved path uses exactly its existing Gmsh Box field, quadratic
tetrahedra, normalization and CalculiX lifecycle. Fresh executable
probes confirmed Gmsh 4.15.2 / CalculiX 2.16 / Node 24. The predefined
case allowlist contains only the missing baseline global 3/2 mm and
local 1.5/1 mm rows, and candidate global 4/3/2 mm and local 1.5/1 mm
rows. It stops on a count, refinement-definition, stress or peak-location
discrepancy. Archived rows are reopened, not regenerated, on replay.

| Record | Action | Nodes / elements | Raw maximum (MPa) | Structural job identity |
| --- | --- | ---: | ---: | --- |
| baseline-g4 | reused | 931 / 428 | 1.087298473 | `calculixv2_766bf723-cfe6-4a1f-866a-f22f03ae927f` |
| baseline-g3 | regenerated | 2006 / 1035 | 1.189661427 | `calculixv2_8d263eef-5832-485e-b0e5-40c8bb83cf47` |
| baseline-g2 | regenerated | 4636 / 2607 | 1.302630464 | `calculixv2_27bca7bd-da6b-4f45-bba0-e7c34c98eab6` |
| candidate-g4 | regenerated | 931 / 428 | 1.197847169 | `calculixv2_d67a32c6-a5f0-459a-b44b-d7bf9a9c2024` |
| candidate-g3 | regenerated | 1874 / 967 | 1.298139198 | `calculixv2_003048e2-4e6e-461d-a16c-4b5758d0029d` |
| candidate-g2 | regenerated | 4468 / 2505 | 1.438201184 | `calculixv2_102d1487-a036-455d-835e-e45a740d8ba9` |
| baseline-l1p5 | regenerated | 2838 / 1530 | 1.465847010 | `calculixv2_7b56be3a-7e4d-472d-9c55-bae96f663766` |
| baseline-l1 | regenerated | 5926 / 3500 | 1.668684309 | `calculixv2_01fc569b-c1ca-4051-856c-378f1b68b321` |
| candidate-l1p5 | regenerated | 2621 / 1386 | 1.601025778 | `calculixv2_cc2d4f1e-adf9-4490-a077-19111a608137` |
| candidate-l1 | regenerated | 5445 / 3184 | 1.820657700 | `calculixv2_c3e40aaa-d274-4924-81ae-6bc5dfffc12a` |

All regenerated stress differences are **exactly zero** relative to
the recorded full-precision summaries. Node/element counts are exact;
peak centroids reproduce within 1e-10 mm, and stress replay comparison
uses 1e-12 MPa. These are reproduction checks, not new engineering
tolerances; the existing 5%/decreasing-change and margin rules are
unchanged. Local meshes remain diagnostic only, not selected comparison
sources. The selected immutable studies are the global 2 mm pair.

[The metadata-only record index](SIM9_OPTIMIZATION_ARCHIVE_RECORD_INDEX.json)
records all ten job, blob, refinement, request, result and field digests,
CAD revisions/thickness, peak elements/centroids, numerical results and
the manifest/report roots. It is not a substitute for the local normalized
blobs, independent completion ledger or trusted source records. No
normalized payloads, private provider paths, raw solver files or credentials
were copied into the public repository.

### Complete trusted replay and admission

Host source-state objects and case references are separately pinned in
the trusted completion ledger. The original baseline source is restored
only from its previously authenticated completion, not numerical tables.
Each replay reloads those objects by exact job ID and independently
verifies their roots. The real selected CAD change record, sealed baseline/
candidate optimization inputs, comparison and ten-record numerical manifest
are persisted. The completed and converged results, parameter/material
provenance, runtime, FEM counts/options, domain-owned field descriptors,
all ordered stress pages and peak localization feed the unchanged admission
guard, including its second record/source verification.

- Trusted-reader replay: **PASS (10 / 10)**.
- Complete real-identity manifest: **PASS**.
- Manifest ID: `sim9-optimization-authentic-ten-record-matrix`.
- Evidence digest:
  `sha256:3cabb227d5d41fe596abdaa495459e799730219d276ca47498b5af3a8ced0a7b`.
- Comparison digest:
  `sha256:d6933f641903cd3a9b04dc54272143625733497a1792e6ee7723705eb91175ac`.
- Complete report digest:
  `sha256:6d6e4c77df5e61d95adbadf85a5c43380b8993b5829e77dc802713dc5b4ce1eb`.
- Nominal feasibility: **true**, 400 mm³ / 10% objective improvement.
- Robust feasibility: **false / FAIL**,
  `nominal_only_insufficient_numerical_evidence`.
- Reasons (both designs): `GLOBAL_STRESS_UNSTABLE`,
  `LOCAL_STRESS_UNSTABLE`, `PEAK_APPROACHES_CRITICAL_REGION`,
  `REFINEMENT_CHANGE_EXCEEDS_MARGIN`.

Thus authentic archival closes the provenance gap, not the raw-maximum
stability failure. Candidate global 2 mm stress remains 1.4382011838 MPa;
local 1 mm stress is 1.8206577004 MPa. The local 0.2196319227 MPa rise
exceeds the remaining 0.1793422996 MPa margin. No alternative metric is
substituted and no robust engineering use is admitted.

### Focused execution and runtime handling

`test:sim9-optimization-archive-complete-real` ran exactly the nine approved
new solves and immediately archived each. Its subsequent whole-archive
per-page replay was stopped after over five minutes without output; all
records and the pinned manifest were preserved. Fixture source lookup was
bounded by an identity-only index while still independently reloading/
digest-verifying the selected source files.

`test:sim9-optimization-archive-complete-replay` then completed **PASS** with
**zero solves** using the original archive readers. A guarded stop request
arrived after that process had finished, so it stopped nothing. The final
fixture-only bounded field-stream path also completed **PASS / zero solves**
and produced the exact same report digest. It verifies every page/chunk and
full dataset with the existing field verifier, and independently reloads
and binds the entire archive/source at both ends of each complete stream.
The numerical admission guard still repeats all records and sources.
Production archive APIs, provider physics and numerical thresholds did not
change. No unrelated tests, historical matrices, browser tests or other
solver fixtures ran. Only touched-script syntax checks accompanied this work.

Earlier numerical evidence is not stale. The new authentic comparison
uses the newly recorded exact job/result identities plus the original
baseline 4 mm record. Normalized archives and independent source/ledger
objects are retained locally outside both repositories. No live TunaCAD
CAD/project-store integration is claimed by this provider-development
fixture. Optimization remains `proof_of_concept`, provider admission
closed, `engineeringUsePermitted: false`.

## Ninth increment: capability-specific evidence consolidation (2026-09-28)

[The complete evidence matrix](SIM9_OPTIMIZATION_EXIT_GATE_MATRIX.md) maps
the contract, binding, candidate comparison, real CAD/solver histories,
lifecycle, refinement, peak diagnosis, evidence guard, immutable archives,
trusted readers and ten-record manifest to their recorded sources.
Authentic provenance/replay PASS remains separate from raw-stability and
robust-feasibility FAIL. Non-convergence snapshot rejection is synthetic,
not a real non-converged solve; live CAD database/hosted optimization
integration and formal qualification are not claimed.

Only documentation and metadata/link consistency checks accompany this
consolidation. No recorded fixture was rerun and no earlier numerical
evidence became stale. Status, admission, thresholds and engineering-use
prohibition are unchanged.

## Remaining incomplete roadmap scope

The canonical roadmap does not yet name a further bounded optimization
increment after consolidation. Live CAD revision/parameter/change-record
reader integration remains a separate recorded gap. The unchanged raw-maximum
feasibility gate remains FAIL; no optimizer loop or metric replacement follows.
The next named analysis-family entry is specialist domains, conditional on
user demand and a separate contract/scope decision. Independent review is a
future formal-qualification gate, not the default next development step.
