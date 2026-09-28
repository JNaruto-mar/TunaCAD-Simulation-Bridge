# SIM-9 fatigue development status: bounded reference and source binding

Status: `proof_of_concept`, analytical/reference only,
`engineeringUsePermitted: false`. This increment adds no fatigue
analysis type to the v2 simulation request, no CalculiX or other
provider admission, no browser/MCP authoring, and no change to
SIM-2–SIM-9 structural or thermal physics paths.

## Contract and exact scope

`tunacad-fatigue-reference/0.1` accepts only one signed uniaxial
normal-stress history at one named domain/element/integration point,
with a unit analysis-space axis and source structural-result/field
dataset IDs and SHA-256 digests. The three explicit samples are one
closed, fully reversed min–max–min cycle at 0, T/2, and T seconds;
the caller may repeat that **same** cycle 1–1,000,000,000 times.
Stress is MPa, time is seconds, and life is cycles. No raw load or
strain history is admitted. A caller-supplied source digest binds the
reference input but does **not** establish that the field values came
from a verified structural result; provider/source verification is
a separate increment, recorded below.

The material is a `fully_reversed_stress_life` S-N curve with
R = -1, 2–16 strictly increasing integer life points and strictly
decreasing positive stress amplitudes. Life points are bounded to
1–1,000,000,000,000 cycles and stress amplitudes to 10,000,000 MPa.
Material source kind, reference, and revision are mandatory. The
query amplitude must lie within the tabulated curve; no endurance
limit or extrapolation is inferred. There is exactly one source
location and one material; global maxima are not accepted as a
substitute for a location-resolved history.

The result reports source location/digest, input digest, material
provenance and S-N curve digest, stress
amplitude, zero mean stress, R = -1, interpolated life Nf,
repeated/consumed cycles n, damage n/Nf, remaining cycles
max(Nf-n,0), and whether n ≥ Nf. This is only the
constant-amplitude form of linear damage accounting, **not**
variable-amplitude Miner summation. Result flags explicitly say
`sourceVerification: caller_supplied_digest_not_provider_verified`,
`convergence: not_evaluated_reference_only`,
`uncertainty: not_quantified`, and
`engineeringUsePermitted: false`.

Strict schema and cross-field checks reject altered digests,
nonfinite/out-of-range data, nonunit axes, absent location/provenance,
nonmonotone or oversized S-N curves, stress outside the curve,
nonclosed/unequal-amplitude cycles, nonzero mean stress, unsupported
units, cycle counts or sample counts beyond bounds, extra locations,
rainflow/mean-stress options, load or strain histories, strain-life,
and other unknown fields. There is no notch, multiaxial, frequency,
temperature, residual-stress, or stochastic/scatter correction.

## Analytical/reference fixture

The synthetic curve uses (400 MPa, 10,000 cycles),
(300 MPa, 100,000 cycles), and (200 MPa, 1,000,000 cycles).
For amplitude sqrt(300×200) = 244.948974278 MPa, log-log
interpolation gives Nf = sqrt(100,000×1,000,000) =
316,227.766017 cycles. Repeating the closed cycle 100,000 times
gives damage 0.316227766017 and remaining life
216,227.766017 cycles. At 400,000 repetitions the result
predicts failure within the supplied history and zero remaining
cycles. The focused `npm run test:sim9-fatigue-reference` fixture
passes these values, deterministic sealing/results, an exact-curve
endpoint, 22 malformed/unsupported cases, and closed CalculiX
fatigue admission. No real solver was needed or run.

## Second bounded increment: trusted result/history binding

`bindFatigueToStructuralHistory` accepts the narrow reference input
only after independently reading a completed structural result and
signed stress-history artifact through a trusted internal reader,
not through MCP/caller JSON. The reference source now identifies the
exact structural job, request digest, project revision, model digest,
full normalized-result digest, domain-owned field dataset, and its
digest. The verifier snapshots the retrieved result and history
before hashing them. It requires a successful converged engineering
`nonlinear_static` result with no model mutation and exactly one
matching domain/dataset ownership record.

The history artifact has strict schema/units (MPa and seconds),
one domain/element/integration point/component/unit axis, and exactly
three ordered samples. Its job/result/request/revision/model and
dataset identities must match the stored result and reference.
Its full artifact digest, exact location, and all sample times and
stresses must match the reference; the existing reference validator
enforces the closed min–max–min ordering and R=-1 amplitude.
A caller-supplied digest alone fails if the trusted result or history
does not exist. The proof explicitly retains `providerAdmission:
closed` and does not change the analytical result's
`caller_supplied_digest_not_provider_verified` label. No fatigue
provider result or life claim from TunaCAD structural results is
admitted yet.

The synthetic trusted-reader fixture `npm run
test:sim9-fatigue-binding` passes deterministic binding and 38
tamper/mismatch cases, including absent or changed result, revision,
digest, dataset owner, location, units, sample count/order/time/value,
and failed/cancelled/unconverged result. The focused analytical
reference test and Bridge TypeScript check also pass. This fixture
does **not** assert that the existing CalculiX provider emits a
signed integration-point stress-history artifact; it currently does
not. Earlier SIM-2–SIM-9 numerical evidence remains current because
no solver, mesh, thermal, structural result, or existing provider
path changed.

## Third bounded increment: real provider history artifact

One opt-in provider-owned history artifact and real provider-to-binding
fixture are now implemented. `submitWithStressHistory` admits only one
elastic nonlinear-static domain, one fixed FACE, one surface-force
FACE, and three equal-duration force endpoints at -1/+1/-1 scale.
The existing CalculiX EALL integration-point stress output is read
at the final converged increment of each step. The signed normal
stress is projected as n·S·n at the selected 1-based element and
integration point; the first endpoint is rebased to time zero, so
the ordered three-sample cycle uses 0, 1, and 2 s. No values are
interpolated or symmetrized. Missing, duplicate, nonfinite, or
mistimed rows fail the provider run and quarantine its result.

The provider appends one domain-owned, non-pageable history dataset
ID to the completed normalized structural result, computes the
SHA-256 digest of that full result snapshot, and stores the immutable
history artifact with the exact job/request/revision/model/result
identities and mesh location. `getStressHistory` returns clones only
after successful completion; cancellation/failure clears the store.
This path is opt-in and provider-only: normal structural submissions,
MCP/browser authoring, and fatigue analysis/result admission are
unchanged and closed.

The focused real fixture uses Gmsh 4.15.2 and CalculiX 2.16 on a
100×10×10 mm elastic axial coupon (463 nodes, 206 C3D10 elements),
0.1 N peak FACE force, fixed opposite FACE, domain `coupon`,
CalculiX element 1, integration point 1, axis [1,0,0].
Nominal F/A is 0.001 MPa. The actual provider rows at the three
selected endpoints are -0.001, +0.001, -0.001 MPa; the authentic
artifact passes `bindFatigueToStructuralHistory`. Fourteen in-memory
artifact/result substitutions fail binding, and a no-solver parser
fixture rejects seven incomplete/malformed histories. Bridge type
checking passes. The result and artifact digests are job-specific,
not cross-run constants.

Earlier SIM-7 numerical evidence is not stale: the ordinary
`submit` path, deck, equations, and normalized structural metrics
are unchanged. This fixture does not qualify fatigue predictions;
SIM-9 fatigue remains `proof_of_concept` with
`engineeringUsePermitted: false`.

## Fourth bounded increment: proof-required result admission

`FatigueAdmissionLifecycle` is provider-only and does not advertise
fatigue as a v2 analysis type or expose browser/MCP authoring. It
snapshots a validated, digest-sealed one-cycle input, then obtains
a fresh `bindFatigueToStructuralHistory` proof before and after the
bounded analytical S-N calculation. The two proofs, input digest,
S-N curve digest, and material provenance must agree before a
result can reach `succeeded`. A caller cannot submit a proof object
as a substitute for trusted structural reads. The admitted result
contains life, damage, remaining cycles, failure-within-repetitions,
source identities, result/artifact/proof digests, S-N provenance,
`sourceVerification: verified_trusted_structural_history`,
`uncertainty: not_quantified`, and
`engineeringUsePermitted: false`. Material provenance is bound to
the immutable input snapshot, not independently certified.

The lifecycle uses `queued → running → succeeded/failed/cancelled`,
at most 64 in-memory jobs, and 20-minute terminal retention.
Cancelled, failed, or still-running jobs return no result. Queued
and active cancellation—including cancellation after the first
proof—clear pending data; a delayed trusted read cannot publish a
late result. Failures before completion are quarantined. Each
successful retrieval rebinds the trusted structural source and
rechecks the proof and result/material digests; a changed or absent
structural result or history irreversibly marks the fatigue job
failed and removes its result.

The focused no-solver admission fixture passes 13 invalid or
unbound cases, cancellation at queued and active phases, source
change between proofs, and post-completion result/history tamper
quarantine. The existing small real Gmsh/CalculiX coupon also
passes provider artifact → binding → admission: 100,000-cycle
reference life, 0.1 damage for 10,000 repetitions, 90,000 remaining
cycles, no predicted failure within those repetitions. No broader
fatigue physics or production qualification is claimed.

Earlier SIM-7/other SIM-9 numerical evidence remains current:
no structural equations, meshes, provider normalization, or
existing result workflows changed in this increment. SIM-9 fatigue
remains `proof_of_concept`, `engineeringUsePermitted: false`.
Variable amplitude, rainflow, mean-stress correction, strain-life,
multiaxial, and notch behavior remain unsupported.

## Next roadmap item

The canonical SIM-9 list next names topology/parameter optimization
as an orchestrator of immutable studies. Fatigue browser/MCP authoring
and capability-specific qualification remain future work, not
implied by this bounded result-admission contract.
