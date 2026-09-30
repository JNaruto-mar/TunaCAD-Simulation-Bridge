# SIM-9 electrostatics: two-layer series dielectric foundation

Status: `proof_of_concept`; `engineeringUsePermitted: false`; private exact-scope host-only provider admission exercised; MCP/browser, public and field admission closed. This is separate from the existing single-domain P01–P04 evidence. P04 remains unchanged and PENDING.

## Bounded analytical contract

- Exactly two distinct, ordered, origin-aligned rectangular dielectric domains in series along +x; one declared common, planar, full-area interface. Domain/body/part, material, FACE, electrode, and interface identities remain explicit and domain-owned.
- Absolute isotropic permittivity is constant and positive in each domain (F/m). Two complete outer electrode faces have prescribed potentials (V); eight lateral faces have zero normal displacement (C/m²). No free volume or interface charge. No fringing, floating conductors, nonlinear dielectric, exterior domain, or coupling.
- Each side declares the same interface plane, footprint, area, and surface digest. Gaps, overlaps, mismatched footprints, wrong or duplicate FACE ownership, missing insulation, and different surface identities fail validation. These are **declaration checks**, not evidence from live CAD or a conformal mesh. Caller-supplied digests are not trusted proof. Provider admission stays closed until trusted CAD/mesh validation is implemented.
- Ordered axial samples span both electrodes and include the interface. Potential is continuous there; electric field has explicit left/right limits and is not represented as one nodal field. Outputs retain V, V/m, C/m², C, F, J, and J/m³ electrical units.
- Strict schema rejects unsupported keys/physics, bad units, nonpositive/nonfinite permittivity, malformed material/electrode declarations, and missing or reordered samples. Sealed request/reference digests are deterministic but are not live-source attestations.

## Analytical parallel-plate fixture

Area = 10 × 10 mm = 1.0e-4 m²; layer A: thickness 0.4 mm and ε = 2ε₀; layer B: thickness 0.6 mm and ε = 6ε₀; ε₀ = 8.8541878128e-12 F/m. Left electrode = 0 V; right electrode = 100 V. Ideal insulated sides exclude fringing.

For thicknesses Lᵢ and permittivities εᵢ, C = A/(L₁/ε₁ + L₂/ε₂), common Dₓ = −ΔV/(L₁/ε₁ + L₂/ε₂), Eᵢₓ = Dₓ/εᵢ, and ΔVᵢ = −EᵢₓLᵢ. Potential is linear within each layer and continuous at the interface. No free interface charge implies D₂ₓ − D₁ₓ = 0. The electrode charges are ±DA; U = Σ ½ εᵢEᵢ²ALᵢ = ½ CΔV² = ½ Q_rightΔV.

| Quantity | Analytical value |
| --- | ---: |
| Potential at x = 0, 0.2, 0.4, 0.7, 1.0 mm | 0, 33.333333, 66.666667, 83.333333, 100 V |
| Voltage drops A / B | 66.666667 / 33.333333 V |
| Eₓ in A / B | −166666.666667 / −55555.555556 V/m |
| Common Dₓ | −2.9513959376e-6 C/m² |
| Left / right charge | −2.9513959376e-10 / +2.9513959376e-10 C |
| Equivalent capacitance | 2.9513959376e-12 F |
| Stored energy A / B / total | 9.83798645867e-9 / 4.91899322933e-9 / 1.4756979688e-8 J |

Focused command: `npm run test:sim9-electrostatic-two-layer-foundation`. It checks deterministic sealing/reference, the numerical table, interface continuity, charge and energy identities, gauge/reversed-voltage behavior, 28 rejection/digest cases, and closed neutral-provider admission. No solver or historical electrostatic suite ran.

## Provider-only trusted interface and solve (2026-09-29)

The source guard reuses TunaCAD's native live single-body reader for **each** layer. That independently checks the current project revision, body/part/material/FACE ownership, unique native FACE and edge topology, local slab dimensions, and canonical STEP digest before and after export. The common interface digest is then recomputed from the two verified origin-aligned planar bodies and their frozen-analysis placement; the contract's asserted digest alone is not accepted. Changed material, substituted STEP, or remapped FACE fails closed.

Independent per-body Gmsh meshing was attempted once and rejected correctly: the quadratic interface facet and node counts differed. No nonconformal tie or projection was admitted. The focused provider-only path instead imports the **two native STEP exports** into one bounded Gmsh OpenCASCADE BooleanFragments operation, producing one shared geometric interface. It splits that mesh into two owner-local neutral meshes, reuses the existing SIM-4A exact shared-topology composer, and additionally checks opposing quadratic facet/node identities, interface plane and complete area, per-domain element ownership and volume. A shifted interface mesh fails closed. The native fixture's two meshes had 459/473 nodes and 198/208 quadratic tetrahedra; the composed model had 779 nodes and 406 DC3D10 elements. The full 100 mm² interface had 153 shared nodes and 66 matched facets.

CalculiX 2.16 uses one steady scalar solve internally with per-domain normalized conductivity εᵢ/ε₀ (2 and 6). Native NT is normalized as potential (V), HFL as per-domain E (V/m) and D (C/m²), and RFL as signed electrode charge (C). The public result remains electrical, never thermal. One Gmsh 4.15.2 / CalculiX 2.16 solve with 2 mm global mesh was run through OS-enforced CPU/memory-limited helpers; native completion and cleanup were required. This is a provider-development fixture only, not admitted through Bridge/browser/MCP and not a retrievable completed job.

| Quantity | Analytical | Real provider |
| --- | ---: | ---: |
| V at 0/0.2/0.4/0.7/1 mm | 0 / 33.333333 / 66.666667 / 83.333333 / 100 V | 0 / 33.33333 / 66.66667 / 83.33333 / 100 V |
| Per-domain voltage drop | 66.666667 / 33.333333 V | 66.66667 / 33.33333 V |
| Per-domain Eₓ | −166666.6667 / −55555.5556 V/m | −166666.65 / −55555.55 V/m |
| Electrode Q | ±2.9513959376e-10 C | ±2.9513959701e-10 C |
| Equivalent C | 2.9513959376e-12 F | 2.9513959701e-12 F |
| Total U | 1.4756979688e-8 J | 1.4756976737e-8 J |

Recovered mean normal D jump = 1.3553e-20 C/m² (about 4.59e-15 of |D|); net electrode charge = 0 C; field-energy minus charge-energy = −3.1137e-15 J (about 2.11e-7 of U). Deck bytes and normalization of the same completed raw output are repeatable. Four malformed/duplicated/wrong-set/truncated native-output cases, native source mutations, and one shifted nonconformal mesh were rejected. Only `npm run test:simulation:electrostatic-two-layer-native` was run for this provider increment; no refinement or older suite was rerun.

This fixture verifies one native CAD revision and one mesh, **not** mesh convergence, a second independent solve, durable completion/replay, browser/MCP approval, or formal qualification. No single-domain P01–P04 evidence changed. Keep `proof_of_concept`, `engineeringUsePermitted: false`, and provider/public admission closed.

## Provider-only immutable completion lifecycle (2026-09-29)

The new private two-layer lifecycle binds one job ID and sealed request digest
to the two live CAD revisions/body/domain identities, both canonical STEP
digests, material/permittivity provenance, electrode and interface FACE IDs,
trusted conformal fragment-mesh/interface evidence, deterministic deck digest,
and current provider/runtime identity. A completed record additionally pins
cleaned converged native evidence, normalized electrical digest, and a separate
protected completion pin. Retrieval reconstructs and compares the complete
source/mesh/deck/runtime binding twice; a persisted record or caller digest
alone cannot authorize a result. Record/pin mismatches become sticky
quarantine tombstones. Failed/cancelled/unclean jobs expose no result.

One focused native slab run generated authentic Gmsh 4.15.2 / CalculiX 2.16
output. Controlled replay of that same output through the lifecycle passed
cleaned completion, protected result/pin persistence, and fresh trusted-source
retrieval from a newly constructed lifecycle/storage instance. No additional
solver run was used for the cancellation/failure cases. Pre-dispatch
cancellation performed zero source reads and zero provider dispatches.
Cancellation during dispatch rejected late successful output. Provider
failure, truncated electrical output, and cleanup failure exposed no result.
Changing the trusted mesh after persistence rejected retrieval, and restoring
it did not undo quarantine. The previous live-source fixture rejected changed
material, substituted geometry and remapped FACE; the lifecycle uses that
same guard at dispatch, completion and retrieval. The 2 mm native fixture
remained 779 composed nodes / 406 DC3D10 elements, 153 shared interface
nodes / 66 facets. Electrical result digest:
`sha256:ea3e09d0f066353af5a59854cf06ff7ca68f8f9cbfeb506db101f38d0d358b56`.

Focused checks: one `TUNACAD_TWO_LAYER_LIFECYCLE=1` run of the existing
native fixture, and
`node --experimental-transform-types --test external/TunaCAD-Simulation-Bridge/scripts/test-electrostatic-two-layer-lifecycle.mts`.
The isolated TypeScript check found no diagnostic in the new module, but
still reports two unrelated existing harmonic `v2Validation.mts` errors.
No broad suites, refinement matrices, browser tests or historical evidence
were rerun. This is still provider-only, not public Bridge/MCP/browser
admission. Keep `proof_of_concept` and `engineeringUsePermitted: false`.

## Same-slab conformal mesh and electrical stability (2026-09-29)

One focused native-CAD fixture used the unchanged sealed 0.4/0.6 mm slab,
ε = 2ε₀/6ε₀, 0/100 V electrodes, Gmsh 4.15.2 BooleanFragments, and
CalculiX 2.16 DC3D10 scalar formulation. Three distinct 2.0/1.5/1.0 mm
global meshes were each independently composed and checked for exact
quadratic interface facet/node matching, two-domain ownership, complete
100 mm² interface area, and distinct increasing node/element counts and mesh
digests. A shifted nonconformal mesh remains rejected. The 1.0 mm deck was
solved once more, without remeshing, solely for repeatability. Each solve
completed with confirmed native cleanup. This is provider-only numerical
evidence, not a new public result-admission route.

Analytical reference: layer voltage drops 66.666667/33.333333 V; Eₓ
−166666.667/−55555.556 V/m; common Dₓ
−2.9513959376e-6 C/m²; electrode charges
∓2.9513959376e-10 C; capacitance 2.9513959376e-12 F;
energy 1.4756979688e-8 J.

| Global size | Local nodes A/B | Local tets A/B | Composed nodes/tets | Shared interface nodes/facets | Interface area |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2.0 mm | 459 / 473 | 198 / 208 | 779 / 406 | 153 / 66 | 100.00000000000021 mm² |
| 1.5 mm | 796 / 967 | 355 / 442 | 1498 / 797 | 265 / 118 | 100.00000000000024 mm² |
| 1.0 mm | 1620 / 1869 | 753 / 888 | 2956 / 1641 | 533 / 246 | 100.00000000000027 mm² |

| Global size | ΔV A/B (V) | Mean Eₓ A/B (V/m) | Mean Dₙ A/B (C/m²) | D jump (C/m²) |
| --- | ---: | ---: | ---: | ---: |
| 2.0 mm | 66.66667 / 33.33333 | −166666.65 / −55555.55 | −2.951395642460406e-6 / −2.9513956424603924e-6 | 1.3553e-20 |
| 1.5 mm | 66.66667 / 33.33333 | −166666.65 / −55555.55 | −2.9513956424604093e-6 / −2.951395642460399e-6 | 1.0164e-20 |
| 1.0 mm | 66.66667 / 33.33333 | −166666.65 / −55555.55 | −2.9513956424604436e-6 / −2.9513956424604237e-6 | 1.9905e-20 |

Mean transverse E components stay below 4e-12 V/m at every level.
The D-jump magnitude divided by analytical |D| is respectively
4.59e-15, 3.44e-15 and 6.74e-15. The slight nonmonotonicity is
roundoff/output precision, not evidence for a formal convergence order.

| Global size | Left/right Q (C) | Net Q (C) | C (F) | Total U (J) | Relative Q/C error | Relative U error | Field minus charge U (J) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2.0 mm | −2.951395970065357e-10 / +2.951395970065357e-10 | 0 | 2.951395970065357e-12 | 1.4756976736604266e-8 | 1.10e-8 | 2.00e-7 | −3.1137e-15 |
| 1.5 mm | −2.9513959266798345e-10 / +2.951395926679835e-10 | 5.1699e-26 | 2.9513959266798348e-12 | 1.4756976736604187e-8 | 3.70e-9 | 2.00e-7 | −2.8968e-15 |
| 1.0 mm | −2.9513959240235776e-10 / +2.95139592756525e-10 | 3.5417e-19 | 2.95139592756525e-12 | 1.4756976736604231e-8 | 3.40e-9 | 2.00e-7 | −2.9012e-15 |

The largest normalized net-charge imbalance is 1.20e-9 of analytical
|Q|; field/charge-energy residuals remain at 1.96–2.11e-7 of analytical U.
Cross-level Q, C and U variation passes the predeclared 5e-4 relative
stability bound, and voltage-drop spread is below 1e-4 V. Charge and
D-jump differences are not monotonic, so only bounded stability is claimed.
Distinct mesh digests are respectively
`sha256:b1436ebe6559d836a77cfa01371a27f226888bc6dae312f82b1d0839a2ff38f3`,
`sha256:cd20a811752a31bbac3360ff96e85bded3f533df8db68b150f28c293ab6ddb87`,
and `sha256:87b24d3374eca9198beb2b46d442a5938b18b29ec5bd08beda2dcbf8b840d29b`.
The selected 1.0 mm repeat returned the same complete normalized result
digest `sha256:1ecf08f97836aa937cfd83ef541e3f7e7e2b4ccd55fac59633c4c7a950f4fe36`.

Focused command: `TUNACAD_TWO_LAYER_REFINEMENT=1` with the existing
`scripts/test-electrostatic-two-layer-native.mjs` fixture. No single-domain
P01–P04, historical SIM, browser/MCP or broad suites ran. Neither provider
physics nor lifecycle implementation changed; earlier electrical/lifecycle
evidence remains current. Keep `proof_of_concept`,
`engineeringUsePermitted: false` and public admission closed.

Next bounded increment: durable host-owned two-domain sealed-study and
validated-mesh records with fresh live-source/revision rebinding on replay.
The current focused lifecycle reader still obtains its sealed request and
local meshes from fixture-owned memory, so this host-store boundary is not
yet demonstrated for two-layer restart/replay.

## Durable two-domain host records — implementation pending replay evidence (2026-09-29)

A protected content-addressed 1.0 mm study record and separate immutable
source-catalog pin now capture the sealed request, both revision/body/domain/
canonical STEP identities, both material/permittivity provenances, electrode
and interface FACE IDs, the two owner-local fragment meshes, exact shared
interface node/facet/area evidence, fragment-mesh and deck digests, and current
provider/runtime identity. The existing two-layer completion ledger separately
persists cleaned native evidence and the normalized electrical result digest;
both records meet at the immutable source digest. The host reader reloads the
pin/record, revalidates the two conformal meshes, freshly rereads both live
CAD sources and current runtime, and compares the rebuilt binding before
supplying data to the lifecycle. It never treats the stored record as live
CAD truth. Old or mismatched record schemas/versions are not upgraded.

The one permitted 1.0 mm Gmsh/CalculiX fixture solve completed, but the
post-solve protected-record verification failed with a JavaScript
`undefined.bind` error: the internal trusted-reader adapter omitted methods
that the live-source verifier binds before use. That adapter shape was
corrected without changing solver or numerical code. The fixture had already
cleaned its temporary provider output, and no reusable raw result was saved.
Under the one-solve limit, the corrected implementation has **not** been
re-solved or authentically replayed. Accordingly, durable completion/replay,
post-restart source mutation, mesh/record tamper, and cancelled/failed ledger
checks remain PENDING rather than PASS. No numerical result from this failed
receipt is counted as new evidence. The previous 1.0 mm refinement evidence
and single-domain P01–P04 record remain current.

Focused checks so far: no-solver syntax preflight PASS; isolated TypeScript
check finds no diagnostic in the new host-record module but still reports the
existing unrelated harmonic `v2Validation.mts` errors; one native fixture
command exited 1 after the solve. No second solver run, refinement matrix,
browser suite or historical test was executed.

Next incomplete bounded item remains authenticated durable two-domain
completion and fresh-source replay of the corrected host reader using one
new raw provider result, plus its focused mutation/quarantine cases. Do not
open public admission or promote: `proof_of_concept`,
`engineeringUsePermitted: false`.

## Authenticated 1.0 mm durable completion and replay — PASS (2026-09-29)

The one additional explicitly approved Gmsh 4.15.2 / CalculiX 2.16 run
completed and cleaned its solver artifacts. The corrected host reader
published the protected content-addressed two-domain study/mesh record,
the existing lifecycle published a cleaned converged completion/result
ledger and pin, and a newly constructed storage/host/lifecycle instance
reloaded and returned the identical electrical result after fresh native
CAD/material/FACE/canonical-STEP, conformal mesh, deck and runtime reads.
The fixture command exited 0. This closes the preceding PENDING durable
replay gate; the earlier failed receipt remains a historical failed attempt.

| Identity | Authenticated value |
| --- | --- |
| CAD project revision | `207e9fb5a9e6c6b7374e75d8cc43f8e61d99e9a69ec159d678425b196864db79` |
| Canonical geometry A / B | `sha256:b6625556d95c12095267d8a477e287f414547bbc6e507c94373e00c9f48dfa71` / `sha256:d3fd2371c7b8a4451e2d44a19555d9580da8e45739b6b5bdbfe7ce4da8b1c402` |
| Fragment mesh | `sha256:87b24d3374eca9198beb2b46d442a5938b18b29ec5bd08beda2dcbf8b840d29b` |
| Deck | `sha256:e00573537714001d2a9dc81a77d144f02e1e3d9df66f4f19de01a894b54a64fe` |
| Durable study record | `sha256:f67f780b6e832a134774de5d4d63ef04cac146bbf1ed921c04ddb03924d83da4` |
| Immutable source binding | `sha256:fd7e65338e57cc8b64c9aabeb864f1765caf2ddb52bccf803916a20af3f64fbe` |
| Completion result | `sha256:fc93ff1bd7b575cbf5756a94419d3eb600a3644ee3aa1347e15ef561104da45b` |
| Normalized electrical result | `sha256:1ecf08f97836aa937cfd83ef541e3f7e7e2b4ccd55fac59633c4c7a950f4fe36` |

The fixture generated a random exact job ID and checked it in every
completion/result pin, but its JSON receipt did not emit that ID. Its
temporary protected fixture archive was cleaned after success; the job ID
cannot be recovered from this receipt and must not be invented. The
electrical result digest exactly matches the prior 1.0 mm refinement result.

On fresh replay, the mesh had 2956 nodes and 1641 DC3D10 elements, with
533 genuinely shared interface nodes, 246 matched facets, and
100.00000000000027 mm² covered area. The recovered result carried identical
interface evidence. No nonconformal topology was admitted.

Focused no-solver rejection checks passed for stale revision, missing
second body, material/permittivity mutation, changed outer electrode FACE,
changed interface FACE, substituted canonical geometry, changed current
runtime identity, shifted nonconformal mesh, altered completion result,
and tampered host interface evidence. Controlled failed and queued-cancelled
jobs exposed no result; restoring an altered result did not lift its
quarantine tombstone. Protected study record and pin integrity plus
recomputed deck identity guard deck mismatch; a separately modified
deck-digest injection was not run. The job ID omission affects receipt
reporting, not job-binding verification.

No second additional solve, refinement matrix, single-domain P01–P04,
browser/Chromium or historical SIM suite ran. Earlier numerical and
lifecycle evidence remains current. Provider/browser/MCP admission remains
closed, `proof_of_concept`, `engineeringUsePermitted: false`.

Next bounded two-layer item: capability-specific evidence consolidation
and explicit provider-admission readiness review before any browser/MCP
authoring. This is not automatic qualification or promotion.

## Capability-specific evidence consolidation and admission review (2026-09-29)

The dedicated [two-layer exit-gate matrix](SIM9_ELECTROSTATIC_TWO_LAYER_EXIT_GATE_MATRIX.md)
records 24 PASS, 2 historical FAIL, 2 PENDING / not demonstrated and
2 NOT APPLICABLE lanes. The historical separate-mesh conformity failure and
first durable-receipt adapter failure remain visible; neither is an active
accepted path. The numerical, lifecycle and durable replay evidence remains
current. No new solver or historical test was run merely to consolidate it.

Bounded provider admission remains **closed**. The missing production-facing
boundary is a non-fixture host-owned capture adapter that sources both live
native CAD bodies, seals their request, independently creates/verifies the
shared-topology fragment mesh and publishes that protected study record
before the existing lifecycle can dispatch. The current proven completion
used fixture-owned request/mesh capture; Bridge electrical transport and
approval remain single-domain. Declared interface conformity or a
caller-supplied digest must never substitute for the native checks.
The optional direct deck-digest tamper injection was not separately run:
the successful fixture archive was cleaned, and a synthetic digest-only
mutation would not demonstrate authenticated replay. Deck recomputation,
protected record binding and result pin checks already passed.

No admission code, public contract, browser/MCP route, status or
engineering-use permission changed. Next bounded item: host-owned
two-domain preparation/capture and protected study publication, followed
by a focused provider-admission gate for that verified record only.

## Live host-owned two-domain preparation/capture (2026-09-29)

The private TunaCAD preparer now reads exactly two current Part definitions
from the document tree, their one solid body each, six semantic FACE roles,
engineering dielectric material and assembly-world transforms. It requires
physical x-axis adjacency (no gap, overlap, rotation or scale), matching
interface footprints and an unchanged project revision. It derives and seals
the electrical request itself: no caller-provided request, geometry digest
or mesh can enter this host-only entrypoint. Both native local STEP exports
are canonical-digested; the existing live-source guard independently checks
body/material/FACE/topology/STEP identities. One Gmsh OpenCASCADE
BooleanFragments mesh is verified for shared quadratic interface topology,
ownership, area, matched facets and nodes. The source is reread after mesh
generation and immediately before the protected study pin is published.

Focused receipt: `TUNACAD_TWO_LAYER_HOST_PREP=1
npm run test:simulation:electrostatic-two-layer-native` (one native-CAD /
Gmsh 4.15.2 mesh, no CalculiX solve) **PASS**. The host-owned 1.0 mm
record has 2,956 nodes, 1,641 elements, 533 shared nodes, 246 shared
facets and 100.00000000000027 mm² interface area. Request digest:
`sha256:59b93242d8259c606841c254551729013d1796cb7f7a34169bec19270444ec60`;
fragment mesh digest:
`sha256:0742242e69e799353cd0dc14c6779c8cee129658cebe4411b851067dd14c2ee4`;
protected record digest:
`sha256:40af28e36a2956e64ac6b6d1df2510b24391d3eb1f18a40e49cd46fde29fc6b1`.
Fresh live-source durable replay passed. Stale material, a physical gap,
missing FACE, invalid permittivity and an extra domain failed before
another mesher call. The runtime identity was rebound to the configured
CalculiX binary digest without starting a CalculiX solve; previous
real-provider version evidence remains the solver baseline.
An additional `TUNACAD_TWO_LAYER_HOST_PREP=reject-only` focused run
used the native live CAD reader and a fake no-solver mesher that changed
the CAD transform during preparation. It failed before mesh verification
or protected study publication; the study store remained empty. This
second run did not invoke Gmsh or CalculiX.

The exit matrix now records 25 PASS, 2 historical FAIL, 2 PENDING and
2 NOT APPLICABLE. Host-owned preparation is PASS; direct deck-digest
tamper injection and exact-scope provider admission remain PENDING.
`proof_of_concept`, `engineeringUsePermitted: false` and provider/browser/
MCP/public admission remain unchanged. No earlier electrical numerical
or durable-completion evidence became stale. Next bounded item: a private
provider-admission gate that accepts only freshly rebound host-owned
study/mesh records of this exact scope.

## Private host-record-only provider admission (2026-09-29)

The host preparation path now issues a separate protected,
content-addressed live-preparation receipt after the study pin has passed
fresh live-source replay. Legacy fixture-owned records have no such receipt.
The new private facade accepts a study ID only; it constructs its own
protected reader and requires the receipt, study pin, full host-record
digest, two fresh CAD/material/FACE/canonical-STEP/mesh/deck/runtime
rebinds, exact 1.0 mm shared-fragment Gmsh provenance, complete interface
nodes/facets/area, and unchanged source identity. It hands only the
accepted study ID to the existing two-layer lifecycle, which rebinds
again before driver execution and retains cancellation, failure,
cleanup and result quarantine. The TunaCAD factory supplies the existing
CalculiX driver and live CAD reader; it is not registered as a
browser/MCP/public route.

Focused command: `node --experimental-transform-types
scripts/test-electrostatic-two-layer-host-admission.mts` — **4 PASS,
0 FAIL**. No Gmsh or CalculiX was executed. Controlled no-solver
identity tests covered stale revision, material, electrode/interface
FACEs, source geometry, changed/nonconformal mesh, wrong runtime,
unsupported physics, missing fixture receipt, unprotected record and
bypass/no-dispatch. Protected receipt save/reload/tamper and refusal
to dispatch without the immutable study pin also passed. These are
controlled admission checks, not evidence of a real admitted solve.

Exit gate A03 therefore remains **PENDING** pending one authenticated
live-host-record → private-admission → real CalculiX completion/result
fixture, which requires explicit approval. A01 direct completed-record
deck tamper likewise remains PENDING. Matrix totals stay 25 PASS,
2 historical FAIL, 2 PENDING and 2 NOT APPLICABLE. Earlier numerical,
refinement, lifecycle and durable-replay evidence is unchanged;
`proof_of_concept` and `engineeringUsePermitted: false` remain.

## Authenticated private admitted dispatch (2026-09-29)

One approved real fixture ran through the live two-Part TunaCAD document,
host-owned preparation (`host-live-two-layer`), protected study/mesh pin and
preparation receipt, fresh private admission, existing two-layer lifecycle,
Gmsh 4.15.2 fragment meshing, CalculiX 2.16 solving, validated cleaned
completion, and durable replay through a newly opened storage/controller with
fresh live-source rebinding. The command
`TUNACAD_TWO_LAYER_HOST_PREP=admitted npm run test:simulation:electrostatic-two-layer-native`
exited **0** with `status: PASS` and `realProviderSolves: 1`. The run made
no direct provider call from the fixture. The protected receipt, both
canonical CAD/domain/material/FACE bindings, fragment-mesh conformity,
deck/runtime identity and completed result were asserted before publication
or replay. The reporter printed the complete identities, but its long OCCT
stdout was truncated in the captured terminal transcript; exact random job
ID and some source/record digest strings are not retained in this summary.

The selected 1.0 mm mesh had **2,956 nodes**, **1,641 DC3D10 elements**,
**533 shared interface nodes**, **246 matched facets** and **100 mm²**
covered interface area. Deck digest:
`sha256:e00573537714001d2a9dc81a77d144f02e1e3d9df66f4f19de01a894b54a64fe`.
CalculiX runtime: provider `tunacad-calculix-electrostatic-development`
version `0.1.0`, engine `CalculiX 2.16`, executable digest
`sha256:9a05e0b32ffe7d8b61bc4d9db111b0f7655f7a7777c9523c17b9e8b39c903470`.
Completion digest:
`sha256:d885776fd539448aeab48a15ac3d6f3debaefe8fcf61efb04be6a9a8c3388968`.
Result digest:
`sha256:2fb972bdcaf0cc33ad5b0d723de701cd712149e900ed3184503bb6b01466b842`.
Electrical result digest:
`sha256:29ed8125e7adb3ba6dc1f8ccb30f05c33c3513525de825f0628b70bb17c4ea9e`.
Cleanup was confirmed.

| Quantity | Analytical | Admitted provider |
| --- | ---: | ---: |
| Voltage drops (V) | 66.666667 / 33.333333 | 66.666670 / 33.333330 |
| Axial fields (V/m) | -166666.667 / -55555.556 | -166666.650 / -55555.550 |
| Electrode charges (C) | -2.9513959376e-10 / +2.9513959376e-10 | -2.9513959240e-10 / +2.9513959276e-10 |
| Capacitance (F) | 2.9513959376e-12 | 2.9513959276e-12 |
| Energy (J) | 1.4756979688e-8 | 1.4756976737e-8 |

The interface normal-D jump was `1.9905274260e-20 C/m²`; net electrode
charge was `3.5416725373e-19 C`. Fresh-source durable replay returned
the same result digest. Post-completion **no-solver** checks rejected a stale
live material/source, tampered preparation receipt, tampered protected
mesh binding, failed completion and cancelled completion; restoration of
the stale source did not lift quarantine. No second real solve was run.

Exit gate **A03 is PASS**. The matrix now has 26 PASS, 2 historical FAIL,
1 PENDING and 2 NOT APPLICABLE. A01 direct completed-record deck-digest
tamper remains PENDING; no injection was attempted. Earlier analytical,
provider-only, refinement, lifecycle, single-domain P01–P04 and durable
replay evidence is not stale. The capability remains `proof_of_concept`,
`engineeringUsePermitted: false`; browser/MCP/public admission is closed.

## Choices-only two-domain authoring and controlled field presentation (2026-09-29)

The strict `tunacad-electrostatic-two-layer-authoring/0.1` selection carries
only ordered domain IDs, two external electrode FACE IDs and potentials in V,
and the two interface FACE IDs. It accepts no caller mesh, deck, geometry
digest, conformity claim or provider request. The established protected
host preparer independently checks those choices against the current live
inventory, then uses the selected voltages in its sealed request; source
and mesh truth still comes from trusted CAD/Gmsh reads. Focused controlled
no-solver authoring test: **1 PASS** (valid scope, missing/extra domain,
stale electrode/interface FACE, equal potential, wrong unit, unsupported
free charge and caller-supplied trusted-data rejection).

A private two-domain field builder uses the completed result and verified
shared-topology model to emit three datasets per dielectric domain:
nodal potential (V), element-average four-integration-point E magnitude/
vector (V/m), and likewise D magnitude/vector (C/m²). It preserves
domain ownership, bounded 128-triangle pages, deterministic ordering,
chunk/full digests, truthful min/max and page/frame identity. Numerical
electrode charge (C), capacitance (F), energy (J) and interface normal-D
jump (C/m²) remain summaries. The existing viewer can display per-domain
material/permittivity, visibility, clipping, electrical legends and probes.
Focused controlled no-solver field test: **1 PASS**, including cross-dataset
and altered-page rejection. These are synthetic normalized data, not a
new solver fixture or authenticated user-result page receipt.

The browser/MCP route remains **PENDING**: current browser preparation
cannot invoke the Node-only protected host preparer (native CAD reader,
protected filesystem record and Gmsh), and the existing local Bridge
HTTP route supports only the single-domain electrical contract. No new
transport was invented that would let callers substitute CAD/source/mesh
truth or bypass human approvals. Consequently no two-domain browser/MCP
study can yet reach the protected study ID, and no real authorized
end-to-end UI/MCP dispatch was attempted. A dedicated trusted live-CAD
browser↔host transport/approval integration is the next bounded development
item. A01 remains PENDING until a legitimate future two-layer solve
intentionally retains isolated authenticated completion state; no solve
should be run solely to manufacture A01 evidence. Existing numerical,
refinement and A03 evidence remains current. Status is still
`proof_of_concept`, `engineeringUsePermitted: false`, public admission closed.

## Local browser/MCP choices-to-host transport (2026-09-29)

The private TunaCAD Companion now carries the strict choices-only request
from browser or MCP to the existing host-owned preparer. A pinned authenticated
session pulls live inventory, revision, material, FACE and native STEP source;
the host, not the caller, derives canonical digests, mesh/conformity evidence
and a protected study ID. Source-epoch/session changes fail closed. Focused
controlled no-solver transport tests pass. No real browser/MCP-to-Gmsh
preparation receipt has yet been recorded, and the browser approval plus
separate Bridge/provider approval and dispatch are not implemented for this
two-domain route. The Companion origin remains local-loopback only; public
hosted admission stays closed. This does not alter the provider-only exit
matrix totals or turn A01 into PASS. The previous paragraph records the
pre-transport state and is retained as historical context.

The approved live local-Companion check subsequently **PASSed** with a
separate Companion process, authenticated loopback WebSocket, actual TunaCAD
native CAD reads/STEP exports, Gmsh 4.15.2 BooleanFragments preparation,
protected host study ID and independent fresh-source record reload. The
validated 1.0 mm interface had 2,956 nodes, 1,641 elements, 533 shared
nodes, 246 matched facets and effectively 100 mm² coverage. A live material
mutation rejected protected-record reread. No provider job/result or CalculiX
solve was created. One initial fixture assertion failed because it compared
100.00000000000027 mm² to 100 mm² exactly; only that assertion was changed
to a tight tolerance and the focused retry exited cleanly. Controlled
no-solver session/replay/stale-source tests passed. Browser state remains
`prepared_not_approved`; no Chromium rendering or actual two-domain dual-
approved dispatch was exercised. The browser-origin allowlist is unchanged
and remains loopback-only. A01 and formal/public admission remain unchanged.

## Authorization-only two-human-gate wiring (2026-09-30)

The existing local paired Simulation Bridge now has a strict, authorization-
only two-layer descriptor and a distinct terminal prompt. Approved grants
are tied to the protected study/session/revision/receipt/source/mesh summary,
expire with the normal two-minute approval/session policy, and are consumed
once. They cannot enter the existing single-domain authorization URL or
provider-job route. TunaCAD adds an explicit browser confirmation bound to
the prepared study, exact choices, CAD source epoch and Companion session.
The Companion freshly reopens protected records and runs the established
exact-scope admission verifier before independently consuming the matching
Bridge authorization. Its output stops at `pre_dispatch_admitted_no_solver`;
there is no provider submission, completion or result route in this change.
Focused controlled no-solver Companion and Bridge HTTP tests pass. These
tests simulate the terminal's decision callback; they are not evidence of an
actual interactive human approval or a new real solve. Earlier numerical,
A03, mesh and durable replay evidence is unchanged. A01 remains PENDING;
`proof_of_concept`, `engineeringUsePermitted: false`, and public admission
remain unchanged.

## Automated two-gate integration attempt (2026-09-30)

A fresh isolated controlled TunaCAD/Companion fixture exercised the real
choices-only preparation, protected study, browser-confirmation handler and
paired Bridge authorization server. A test-only callback supplied the Bridge
terminal decision; this is **automated two-gate integration**, not a real
human-interactive approval. The protected study passed fresh rebinding and
private exact-scope admission. Its 1.0 mm Gmsh fragment mesh was followed by
one real CalculiX 2.16 submission. The lifecycle reached `succeeded`,
confirmed cleanup, and returned a completed electrical result.

The command nevertheless exited 1 afterward: the controlled fixture's
analytical reporter referenced `replayed` before initialization. The
isolated temporary completion was cleaned by the fixture, so this attempt
does **not** provide a retained numerical comparison, six-field paging
receipt, or durable replay receipt. The reporter now uses the protected
sealed request; no solver rerun occurred. Classify the end-to-end automated
integration receipt **FAIL/incomplete**, while retaining the narrower
provider-completion observation. Earlier A03 analytical/provider evidence
is not stale. A01 stays PENDING; `proof_of_concept`,
`engineeringUsePermitted: false`, private/public admission boundaries and
the Companion origin policy are unchanged.

## Automated two-gate integration completion (2026-09-30)

One final fresh isolated fixture corrected the post-solve reporter and exited
0. The controlled TunaCAD source passed authenticated Companion choices-only
preparation, protected study sealing, separate test-driven browser and Bridge
approval gates, fresh source/study rebinding and private exact-scope admission.
This is **automated two-gate integration**, not human-interactive approval;
production approval code was unchanged. One Gmsh 4.15.2 1.0 mm conformal
fragment mesh (2,956 nodes, 1,641 elements, 533 shared interface nodes,
246 matched facets, 100 mm² interface) and one CalculiX 2.16 solve completed
with validated result and confirmed production solver cleanup. Only test-only
protected durable records were retained through the final receipt.

The result gave 66.66667/33.33333 V layer drops, mean axial E
−166666.65/−55555.55 V/m, mean normal D approximately
−2.95139564246e-6 C/m² in both layers (jump 1.991e-20 C/m²), electrode
charges −2.95139592402e-10/+2.95139592757e-10 C (net
3.542e-19 C), capacitance 2.95139592756525 pF and field-integrated
electrostatic energy 1.4756976736604231e-8 J. The field-versus-charge
energy residual was −2.901e-15 J. Six bounded domain-owned datasets passed
paging and full-dataset digest loading: nodal potential in V plus
element-average E magnitude in V/m and D magnitude in C/m² for each layer.
Fresh-source durable replay returned the identical electrical result digest
and six dataset identities. The fixture's final report and command exit were
PASS. The earlier reporter TDZ remains a historical failed attempt; prior
physics evidence is not stale. A01 remains PENDING. Optional real-human
interactive approval has not been demonstrated. `proof_of_concept`,
`engineeringUsePermitted: false`, public admission and loopback Companion
origin policy remain unchanged.

## A01 isolated deck-tamper feasibility review (2026-09-30)

The retained automated two-gate completion has authentic deck digest
`sha256:e00573537714001d2a9dc81a77d144f02e1e3d9df66f4f19de01a894b54a64fe`.
No Gmsh or CalculiX process was run and the canonical protected completion
was not changed. A distinct isolated copy cannot reach trusted replay by
changing only its completed-record deck identity: the protected storage
configuration fixes its absolute root, directory device/inode identities,
ACL snapshot and configuration digest. Reprovisioning a copied root would
require resealing the host study, study pin, preparation receipt and
completion pin as a new trusted record. Merely rehashing a copied ledger
would fail at storage/study identity first. Moreover, lifecycle replay
compares the aggregate source and binding digests before a distinct
deck-digest check; a synthetic resealed copy would not prove the required
deck-specific rejection. No such completion was fabricated, and no generic
checksum rejection was counted as A01 evidence. A01 remains **PENDING**;
the current matrix totals and all earlier validated physics, completion,
field-page and replay evidence remain unchanged. A future A01-specific
testability design would need to preserve the production trust boundary
while proving an isolated, deck-only mutation reaches the precise comparison.
