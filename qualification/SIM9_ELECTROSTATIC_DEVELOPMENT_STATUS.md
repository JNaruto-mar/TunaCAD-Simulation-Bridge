# SIM-9 bounded electrostatic development status

Current status, 2026-09-28: analytical foundation, provider-only slab
deck/recovery, immutable completion/quarantine lifecycle and bounded
mesh/charge/energy stability evidence, live CAD/source reader wiring and
bounded persistent completion/result-ledger replay, canonical native-source
identity, protected durable host records and real native/provider replay.
The [capability-specific evidence matrix](SIM9_ELECTROSTATIC_EXIT_GATE_MATRIX.md)
is the current consolidated lane view; historical increment findings below
are retained, not rewritten as stronger evidence.
Status `proof_of_concept`;
`engineeringUsePermitted: false`. Registered provider admission,
browser/MCP authoring and visualization remain closed. Only the bounded
development helper below generates a deck and recovers electrical output.
The first-increment sections retain their analytical provenance.

## Contract and scope

[electrostaticFoundation.mts](../simulation-bridge/electrostaticFoundation.mts)
defines `tunacad-electrostatic-foundation/0.1`, separate from neutral
structural/thermal provider requests. It seals all validated input with the
existing stable SHA-256 digest and requires an exact match on validation.

The narrow geometry is one declared ideal rectangular dielectric slab with
complete planar electrodes at x = 0 and x = L. Each of the two separate
prescribed-potential groups contains exactly one FACE. The six declared FACE
identities are distinct; only the opposite xMin/xMax faces can be electrodes.
Material and both groups must belong to the sole domain. Sealing normalizes
electrode order to xMin/xMax, without repairing invalid identities or topology.
Equal potentials on separate electrodes are permitted (zero-field reference).

The material is homogeneous, linear and isotropic with constant **absolute**
permittivity; versioned library/custom provenance is required. No free volume
charge, nonlinearity, exterior/open domain, fringing or coupling is admitted.
All four lateral faces have zero normal electric displacement, D·n = 0.
This is electrical insulation, not a prescribed zero lateral potential.

Declared CAD revision/part/body/geometry digest and material provenance are
identity inputs only. They are not verified against trusted CAD/material
readers in this increment and cannot authorize a provider result.

| Quantity | Explicit unit and meaning |
| --- | --- |
| Slab lengths | m; no implicit CAD mm conversion |
| Electric potential V | V; each electrode is prescribed against the same arbitrary reference |
| Absolute permittivity epsilon | F/m; epsilon = epsilon_r * epsilon_0, not dimensionless epsilon_r |
| Electric field E | V/m; E = -grad(V), signed analysis-coordinate vector |
| Electric displacement D | C/m²; D = epsilon E, not mechanical displacement |
| Electrode charge Q | C; signed conductor free charge, not dielectric outward flux |
| Capacitance C | F; positive epsilon A/L, including the zero-excitation case |
| Electrostatic energy U / density | J / J/m³; 0.5 integral(E·D)dVolume |

Resource/numerical envelope: lengths 1e-6–100 m; absolute permittivity
1e-15–1e-3 F/m; electrode potentials -1e6–1e6 V; 2–65 unique, strictly
ordered axial sample fractions including 0 and 1. These are foundation
input bounds, not proof of material validity, breakdown limits or engineering
accuracy at all extremes. No automatic conversion or extrapolation occurs.

## Analytical parallel-plate reference

The reference uses L = 0.001 m, width = height = 0.01 m:
A = 1e-4 m², volume = 1e-7 m³. Left potential is 0 V, right potential
100 V. Absolute permittivity is 4 * 8.8541878128e-12 =
3.54167512512e-11 F/m. The stated vacuum-permittivity value is a fixed
reference constant, not certified material data.

With deltaV = Vright - Vleft:

- V(x) = Vleft + deltaV * x/L.
- E = [-deltaV/L, 0, 0]; D = epsilon E.
- Qleft = epsilon E_x A; Qright = -Qleft. Conductor charge is the
  negative of the dielectric-domain outward D flux at each electrode.
- C = epsilon A/L.
- U = 0.5 epsilon |E|² A L = 0.5 C deltaV² =
  0.5 (Qleft Vleft + Qright Vright).

| Reference metric | Value |
| --- | --- |
| Potential at x/L = 0, 0.25, 0.5, 0.75, 1 | 0, 25, 50, 75, 100 V |
| Electric field | [-100000, 0, 0] V/m |
| Electric displacement | [-3.54167512512e-6, 0, 0] C/m² |
| Left / right electrode charge | -3.54167512512e-10 / +3.54167512512e-10 C |
| Net electrode charge | 0 C |
| Capacitance | 3.54167512512e-12 F (3.54167512512 pF) |
| Energy density | 0.177083756256 J/m³ |
| Total electrostatic energy | 1.77083756256e-8 J |

`tunacad-electrostatic-analytical-reference/0.1` reports signed electrical
vectors, ordered samples, electrode charges, capacitance, energy and charge/
energy consistency residuals. It binds request/revision/domain/geometry/
material declarations and has its own reference digest. Its authority is
`analytical_reference_only`, not a completed provider result. No thermal
NT/HFL/RFL names, structural stress or mechanical displacement fields are used.

## Focused evidence

[test-sim9-electrostatic-foundation.mts](../scripts/test-sim9-electrostatic-foundation.mts)
is run by `npm run test:sim9-electrostatic-foundation`.

| Lane | Status | Evidence type / limitation |
| --- | --- | --- |
| Strict electrical scope/units, domain/FACE ownership and bounds | PASS | Contract-only; 58 malformed/unsupported/digest-tamper cases |
| Linear potential, uniform E/D, signed charge and capacitance | PASS | Analytical ideal slab, excluding fringing |
| Charge closure and field/capacitance/electrode energy agreement | PASS | Relative tolerance 1e-12, absolute floor 1e-30 for scalar comparisons |
| Gauge offset, polarity reversal, zero excitation, permittivity scaling | PASS | Analytical invariants; no provider solve |
| Deterministic sealing/group normalization/reference digests and 65-sample bound | PASS | Repeatable local contract/reference fixture |
| Provider capability, neutral request/result and deck rejection | PASS | Existing guards; fake executable is not launched |
| Real CAD binding, solver recovery, mesh/conservation evidence | PENDING | Separate future provider increment |
| Browser/MCP/visualization | PENDING | Not exposed |

The first fixture attempt reached the capability guard but used a dummy
executable basename outside its accepted syntax. The fixture was corrected
to a non-executed ccx216.exe path and passed. No environment repair,
solver invocation or broad validation was needed.

The new foundation module also passes a focused no-emit TypeScript check.
No established provider contract, deck, physics, approval, lifecycle,
quarantine, resource limit or existing result normalization changed.
Earlier SIM-2 through SIM-9 evidence remains current.

## Second increment: provider-only slab deck and recovery

[CalculiXElectrostaticSlab.mts](../providers/calculix/CalculiXElectrostaticSlab.mts)
reuses the neutral Gmsh mesh validation, quadratic volume/surface quadrature,
and existing neutral-to-CalculiX connectivity conversion. It does not modify
established thermal/structural schemas or register an electrostatic provider.
The electrical mesh request uses all six declared FACE identities with
verified complete areas, distinct opposing electrodes and full domain volume.
Only straight-sided affine quadratic tetrahedra are supported; curved cells
and incomplete domain ownership fail closed.

### Internal formulation and electrical recovery

The native deck uses `DC3D10`, `*HEAT TRANSFER, STEADY STATE` and
normalized `*CONDUCTIVITY = 1` in mm coordinates. Both electrode potentials
are applied to native scalar DOF 11. No flux, charge source, elasticity,
coupling or lateral boundary load is emitted; insulated sides are natural
zero-flux boundaries.

Native `NT` is electric potential in V, not temperature. Native `HFL` is
normalized -grad(V) per mm: multiplying by 1000 recovers E in V/m.
D = epsilon E in C/m² is derived from that recovered vector and declared
absolute permittivity, not independently printed by CalculiX.
Each electrode's native `RFL` sum times epsilon/1000 recovers signed
conductor charge in C. Normalized scalar conductivity avoids tiny dielectric
coefficients internally; physical permittivity enters electrical recovery.
No thermal material or unit is exposed in the electrical result.

Recovery requires one time=1 output triple with exactly all nodal potentials,
four unique integration points per element, and every electrode-set node
exactly once. Unknown/wrong FACE sets, missing/repeated blocks/rows, invalid
IDs, non-finite/malformed numeric data and inconsistent profile, field,
charge or energy fail closed. Integration-point fields are ordered by
element then point; nodal output is ordered by node. Quarter-point probes
use quadratic tetrahedral interpolation at the slab centerline, with no
extrapolation. Full E·D quadrature supplies energy; electrode Q/deltaV and
volume-averaged field independently supply capacitance comparisons.
At zero excitation capacitance can only be geometry/material-derived, not
measured as Q/deltaV; this real evidence covers the existing 100 V fixture.

The result is `tunacad-electrostatic-provider-fixture-result/0.1` with
`provider_development_fixture_only` authority, separate electrical units,
exact request/revision/domain/geometry/mesh/raw-output identity, material
provenance and result digest. It is not a registered or retrievable Bridge
job result. Runtime completion is checked by the real fixture before raw
data reaches this pure recovery helper.

### Recorded real result

[The dedicated real fixture](../scripts/test-sim9-electrostatic-provider-real.mts)
ran one Gmsh 4.15.2 / CalculiX 2.16 slab, Node 24.18.0, on Windows x64.
Global mesh size 2 mm; 1267 nodes, 590 DC3D10 elements. The actual generated
STEP bytes bind the electrical request's geometry digest. Gmsh is run through
the existing bounded mesh lifecycle, not a disguised thermal study.

| Quantity | Analytical | Provider |
| --- | --- | --- |
| Centerline potentials at x/L=0,0.25,0.5,0.75,1 | 0,25,50,75,100 V | 0,25,50,74.99999999999999,99.99999999999997 V |
| Axial electric field | -100000 V/m | -100000 V/m |
| First-point transverse field | 0,0 V/m | -3.907985e-11,2.486900e-11 V/m |
| Field magnitude | 100000 V/m | 100000 V/m |
| Axial electric displacement | -3.54167512512e-6 C/m² | -3.54167512512e-6 C/m² |
| Left electrode charge | -3.54167512512e-10 C | -3.5416751038699474e-10 C |
| Right electrode charge | +3.54167512512e-10 C | +3.5416751038699474e-10 C |
| Capacitance | 3.54167512512e-12 F | 3.5416751038699474e-12 F |
| Electrostatic field energy | 1.77083756256e-8 J | 1.7708375625600002e-8 J |

Maximum nodal profile error: 1.7736450175220853e-6 V. Maximum axial
field relative error: 0. Charge relative errors: 6.0000005791e-9;
capacitance relative error: 6.0000006475e-9. Net electrode charge: 0 C.
Field-derived capacitance: 3.5416751251199835e-12 F.
Electrode-charge energy: 1.7708375519349738e-8 J.
Field-minus-charge energy: 1.0625026442147274e-16 J (about 6e-9 relative).

Recovery bounds: 8000 nodes, 4000 elements, 8 MiB output, 4096 characters
per record. Potential-profile tolerance 0.002 V; relative field, charge
and energy tolerances 1e-4, with explicit near-zero floors in the helper.
The fixture uses existing Windows Job Object isolation: its native runner
has 30 s wall/CPU and 512 MiB memory bounds, 64 MiB working-directory
monitoring and bounded diagnostics. Meshing retains the existing Gmsh
provider quotas. Only newly created fixture/provider temporary directories
are cleaned by their existing lifecycle helpers.

- Deck digest: `sha256:3fa97ed9d1336786397cac7b028371cd175ade4276694545150417c5e2563132`.
- Result digest: `sha256:a73cd23a8c454e55eb65464a9f24134dc041df49aa3a141f7d58d2cf7a2f678c`.

### Focused checks and limitations

- `test:sim9-electrostatic-provider`: PASS, synthetic complete-mesh parser/
  deck fixture, 27 rejection cases including a separate energy inconsistency.
- `test:sim9-electrostatic-provider-real`: PASS, **one native solve**,
  four native-output tamper replays, deterministic deck bytes and normalized
  results when rereading the same completed output. No repeated solve or
  cross-mesh/cross-host repeatability claim is made.
- New script syntax checks: PASS.
- Focused TypeScript compilation: **FAIL in unchanged transitive modules**
  `CalculiXMultiDomainDeck.mts` and `v2Validation.mts`; no diagnostics in
  the new electrical helper/fixture files. These existing errors were
  reported, not investigated or fixed.

The first real-fixture attempt stopped at the version metadata probe,
before geometry/meshing/solving: ccx216 printed Version 2.16 with nonzero
exit status. The single corrected retry accepts that exact metadata output
only for `-v`; geometry and solve exit/completion checks remain strict.
It completed the one approved native solve. No historical suites ran.
Final rejection-only lexer/ownership checks do not change valid-output
normalization or the recorded analytical/provider comparison.

Previous SIM-2 through SIM-9 numerical evidence is not stale: no shared
physics, contracts, approval or lifecycle implementation changed. This is
not mesh-convergence qualification, general dielectric validation, live CAD
database binding, or a public beta release.

## Third increment: immutable completion and quarantine

[electrostaticAdmission.mts](../simulation-bridge/electrostaticAdmission.mts)
adds a provider-only host-owned completion ledger.
[CalculiXElectrostaticExecution.mts](../providers/calculix/CalculiXElectrostaticExecution.mts)
uses existing process isolation, cancellation, bounded reads and directory
cleanup. Neither helper is registered with Bridge/browser/MCP admission.
No shared physics, approval, result transport or lifecycle implementation changed.

Submission accepts only a study ID. Trusted readers independently retrieve
the sealed electrical request, validated mesh, current revision and runtime.
The host clones these snapshots and rebinds before execution, before
publication and twice on retrieval. A caller-supplied digest/proof cannot
publish a result. The in-memory private ledger binds:

- Exact generated job ID and sealed request digest.
- CAD revision, full model/domain/geometry, mesh and deterministic deck digests.
- Material ID/provenance/digest and absolute permittivity.
- Both electrode FACE identities and prescribed-potential group digest.
- Successful completed provider state, raw output and normalized electrical
  result digests, native status/diagnostic digests and completion-record digest.
- Provider ID/version, independently probed CalculiX 2.16, executable
  fingerprint and Node-major/Windows-x64 runtime identity.

The completed wrapper is `tunacad-electrostatic-completed-result/0.1`;
it retains electrical units and `engineeringUsePermitted: false`.
Returned clones cannot mutate the ledger. Source mutation quarantines
retrieval irreversibly; restoring the old source does not revive the result.

States: queued → running → succeeded, failed or cancelled. Successful
publication requires exit zero, `Job finished`, one complete step/time=1
native status row, valid complete electrical output, unchanged source and
confirmed process termination/directory cleanup. CalculiX's intermediate
`no convergence` messages are not terminal failures; native errors, failed
exit, incomplete final status or invalid output reject completion. Version
comes from a bounded `-v` probe (cached only for the same verified executable
digest), not from a solve banner: this installed solve path has no version
banner. Nonzero exit is accepted only for the exact version metadata probe.

Cancellation clears proof/result immediately, awaits termination and cleanup,
and wins over late completed output and completion-validation races.
Failed/non-converged/malformed/incomplete/foreign output never publishes.
Terminal phases are `succeeded_cleaned`, `failed_cleaned`,
`cancelled_cleaned` or `cleanup_pending`. Cleanup failure never claims clean
completion and continues consuming the active-job budget.

Bounds: 16 retained jobs, at most two active or cleanup-pending jobs, 20-minute
terminal retention; 16 MiB completed result. Existing electrical node/element/
output limits remain unchanged. Native solves retain enforced 30 s CPU/wall,
512 MiB memory and 64 MiB directory bounds; diagnostic text is capped at
256 KiB, failing closed on overflow. Version probing is bounded to 5 s and
4 KiB diagnostics. Only this adapter's own created temporary directories
are removed, after confirmed termination.

### Focused lifecycle evidence

| Lane | Status | Evidence / limitation |
| --- | --- | --- |
| Immutable binding, cloned retrieval, stale/mutated identities | PASS | Dedicated controlled lifecycle tests; real completed source then revision mutation |
| No pre-completion result, queued cancellation | PASS | Controlled and real lifecycle fixtures |
| Active native cancellation and temporary cleanup | PASS | Actual native output observed, input and output artifacts present; no result after cancellation |
| Late completion/publication and validation races | PASS | Controlled delayed driver/reader; cancellation wins |
| Failure/non-convergence quarantine | PASS | Controlled outcome flags/native completion guards; actual unavailable executable fails cleanly |
| Partial/malformed/foreign electrical output | PASS | Five authentic-data failure/tamper replays, no additional native solves |
| Live CAD database reader wiring / persistent ledger | PENDING | Host-reader fixture and private in-memory ledger only; no registered admission |
| Deliberately physically non-converged dielectric solve | PENDING | Not claimed; bounded linear slab succeeds, failure flags are controlled |

Commands:

- `test:sim9-electrostatic-lifecycle`: PASS, 41 controlled binding/lifecycle/
  completion-guard cases, zero native solves.
- `test:sim9-electrostatic-lifecycle-real`: PASS with Gmsh 4.15.2,
  CalculiX 2.16, Node 24.18.0, Windows x64. One completed solve and one
  cancelled native invocation, one slab mesh: 1267 nodes / 590 DC3D10 elements,
  2 mm global size. Native output existed when cancellation was requested;
  the tiny solve may finish numerically before cancellation, so this also
  covers the native-finish/publication race, not a claim about a particular
  solver iteration being interrupted.
- New-file syntax checks: PASS.
- Focused TypeScript compilation: FAIL on the same 31 transitive diagnostics
  in `CalculiXMultiDomainDeck.mts` / `v2Validation.mts`; zero diagnostics
  in the new lifecycle/execution/fixture files after the focused test cast fix.

The final completed case recovered C=3.5416751038699474e-12 F,
U=1.7708375625600002e-8 J and net electrode charge=0 C, unchanged from
the earlier electrical numerical reference. Same deck digest:
`sha256:3fa97ed9d1336786397cac7b028371cd175ade4276694545150417c5e2563132`.
Recorded successful job:
`electrical_f61bfd3f-d795-422f-9699-ca858b509329`.
Normalized electrical root:
`sha256:63f34fb31b740b1dda721f5156b30c9d95f199350c8f7510d74606eda13a815b`.
Completion root:
`sha256:2c4fc85770086709118d66a801e1d70a16f9cf915bcd57dd83f2e42398e2c79e`.
Wrapper root:
`sha256:14a414becba46ec03e37dd05a0f40d715dc5030d31332ff5707a278bb115f0b6`.
Roots identify this run, not cross-run reproducibility of job UUID/native
diagnostics. Retrieval and normalization of the same output are deterministic.

Initial runs were quarantined by new-adapter guard mistakes (intermediate
convergence text treated as terminal failure, then expecting a solve version
banner). Focused corrections above passed; all those failed attempts cleaned
their own artifacts. No infrastructure repair or historical suites ran.
Earlier electrical numerical evidence remains current: no deck/recovery
formulation or tolerance changed. This new ledger evidence is not public
admission, live CAD database binding, persistent archive qualification or promotion.

## Fourth increment: same-slab bounded mesh stability

[The focused refinement fixture](../scripts/test-sim9-electrostatic-convergence-real.mts)
reuses the unchanged 1 × 10 × 10 mm slab, epsilon_r=4, 0/100 V electrode
potentials, insulated sides, mesh helper, DC3D10 deck, native execution adapter,
host-owned completion lifecycle and electrical recovery. Only mesh size varies.
No provider/contract/lifecycle/normalization source file was changed.
Full numerical summaries, runtime/request/material/geometry identity, all job,
mesh/deck/raw/result/completion roots and the repeated baseline are recorded in
[SIM9_ELECTROSTATIC_REFINEMENT_EVIDENCE.json](SIM9_ELECTROSTATIC_REFINEMENT_EVIDENCE.json).
This is a version-bound real-provider evidence summary, not a durable archive
of complete raw fields or a replacement for the private completion ledger.

Runtime: Gmsh 4.15.2 / CalculiX 2.16 / Node 24.18.0, Windows x64. Existing
CPU/memory/disk/time/output limits and source/cleanup guards are unchanged.
Every solve finishes `succeeded_cleaned` and retrieves through the existing
trusted-reader lifecycle. No solver temporary artifacts are retained.

Analytical targets: phi(x)=100*x/L V; field magnitude=100000 V/m;
Qleft=-3.54167512512e-10 C; Qright=+3.54167512512e-10 C;
C=3.54167512512e-12 F; U=1.77083756256e-8 J.
All three meshes recover quarter-point potentials 0/25/50/75/100 V to
floating-point precision, and field magnitude min=max=100000 V/m at
every recovered integration point.

| Mesh size mm | Nodes / elements | Max nodal potential error V | Left charge C | Right charge C | Net charge C |
| --- | --- | --- | --- | --- | --- |
| 1 | 1889 / 905 | 7.10543e-15 | -3.541675132203351e-10 | 3.5416751463700494e-10 | 1.4166698421131772e-18 |
| 0.85 | 2602 / 1245 | 1.77530e-6 | -3.541674912619489e-10 | 3.5416749126194877e-10 | -1.0339757656912846e-25 |
| 0.7 | 3838 / 1829 | 4.40665e-6 | -3.541675291224557e-10 | 3.541675291224557e-10 | 0 |

| Mesh mm | Capacitance F | Field energy J | Left / right charge relative error | C relative error | Field-minus-charge energy J |
| --- | --- | --- | --- | --- | --- |
| 1 | 3.5416751463700495e-12 | 1.770837562559992e-8 | 2.00000e-9 / 6.00000e-9 | 6.00000e-9 | -1.0625032728719929e-16 |
| 0.85 | 3.541674912619488e-12 | 1.7708375625599873e-8 | 6.00000e-8 / 6.00000e-8 | 6.00000e-8 | 1.062502435765213e-15 |
| 0.7 | 3.5416752912245572e-12 | 1.770837562559968e-8 | 4.69000e-8 / 4.69000e-8 | 4.69000e-8 | -8.3052310382456665e-16 |

### Stability interpretation and gates

The affine potential is exactly representable on straight-sided quadratic
tetrahedra. Native printed nodal/reaction precision and floating-point summation
produce small, **non-monotonic** differences with refinement; these data do
not support a formal convergence order or monotonic truncation-error claim.
Field magnitude is unchanged, potential error remains below 4.407e-6 V,
and charge/capacitance errors remain below 6.001e-8 relative.

- PASS distinct refinement: counts increase 1889→2602→3838 nodes and
  905→1245→1829 elements, below unchanged 8000/4000 bounds.
- PASS profile: all levels within existing 0.002 V tolerance.
- PASS field/charge/capacitance/energy: existing relative 1e-4 bounds hold;
  maximum energy/reference relative error is 1.813e-14.
- PASS cross-mesh stability: capacitance/charge relative spread <1.070e-7;
  field-energy relative spread=1.346e-14, both within 1e-4.
- PASS charge balance: normalized net charge 4.000e-9→2.920e-16→0.
- PASS energy consistency: absolute relative field/charge residual
  6.000e-9→6.000e-8→4.690e-8, below 1e-4; the sign changes and does
  not imply an ordered convergence rate.
- PASS native repeat: selected middle 0.85 mm bounded baseline repeated
  exactly once on the **same immutable mesh**. Complete normalized electrical
  arrays, raw DAT digest, electrical result digest and source binding are
  identical. Job UUID/completion/wrapper digests differ by design.

The selected baseline is 0.85 mm / 2602 nodes / 1245 elements, a bounded
middle-resolution comparison supported by the finer 0.7 mm check, not an
optimal mesh or engineering-use qualification. The earlier 2 mm fixture
remains valid; no tolerance or physics assumption was changed.

### Focused checks and preliminary sizing plateau

`npm run test:sim9-electrostatic-convergence-real`: PASS, three distinct meshes
and four completed native solves (one baseline repeat). New script syntax:
PASS. Focused TypeScript check: the same 31 unchanged transitive errors in
`CalculiXMultiDomainDeck.mts` / `v2Validation.mts`; zero new-file diagnostics.
No historical numerical, browser, qualification or regression suites ran.

A preliminary 3/2/1.5 mm matrix produced the **same** 1267-node /
590-element mesh and identical deck/raw DAT at each level under unchanged
Gmsh defaults. It was correctly rejected by the distinct-resolution gate;
those three successful solves are retained separately in the evidence JSON
as `FAIL_not_distinct_mesh_refinement`, not relabelled as convergence evidence.
The test was adjusted only to smaller resolution inputs below that plateau.
Total this task: six meshing cases and seven native solves, with **only one**
selected-baseline repeat. No defaults, topology, physics or provider code was
altered to force a passing matrix. All owned temporary directories were cleaned.

Previous electrostatic analytical/provider/lifecycle evidence remains current.
These records strengthen only the ideal-slab mesh/balance lane; they do not
validate general dielectric geometries, multi-domain interfaces, fringing,
free charge, coupling, live CAD store readers, public authoring or visualization.
Status remains `proof_of_concept`, `engineeringUsePermitted: false`.

## Fifth increment: live trusted CAD/model source reader wiring

[electrostaticLiveSource.mts](../simulation-bridge/electrostaticLiveSource.mts)
is the canonical browser-safe guard implementing the existing trusted-reader
interface. A **private TunaCAD adapter**, `src/simulation/electrostaticLiveSourceRuntime.ts`,
wires it directly to existing live CAD readers. No private TunaCAD source was
copied into the public Bridge. No provider capability, browser control, MCP
tool, approval endpoint or solver dispatch was registered.

The adapter independently reads:

- `getCadProjectRevision`, using the existing content hash of the current
  Zustand `useDocumentStore` nodes, active part and mates.
- `inspectCadBody`, for exact body/owner/revision and current kernel inspection,
  valid single closed/manifold solid, six faces, twelve edges, origin-aligned
  slab dimensions, volume and surface area.
- `getCadAppearanceMaterial(scope='part')`, for the exact definition-owned
  engineering material snapshot, not visual appearance or a caller's material.
- `getCadSemanticReferences`, for all six declared faces (including the two
  electrodes), owner and source body, exact semantic IDs, current resolution
  revision, one valid candidate, planar type, centroid/direction and complete area.
- `CADWorkerClient.exportFeature(bodyId, 'STEP')`, whose actual bytes are
  independently hashed and must match the sealed geometry digest. No caller
  digest, volume-only proxy, header stripping or topology repair substitutes.

Host-owned sealed requests, domain bindings, validated meshes and runtime
records are looked up by study/domain ID. The domain binding is an independent
lookup and must agree with the exact live body/part and request revision; no
domain is silently invented from request JSON. The factory accepts this host
store interface, not client-supplied CAD reader functions or approval proof.
Provisioning/persistence of these host records is still separate from public
authoring.

### Required dielectric snapshot

TunaCAD's existing definition-owned `EngineeringMaterialAssignment` lacked
permittivity. It now has one optional `dielectric` snapshot:
`model: homogeneous_linear_isotropic_dielectric`,
`absolutePermittivityFPerM` and `permittivityUnit: F/m`.
Existing material validation rejects extra electrical fields, unsupported
models/units, non-finite or out-of-contract permittivity and clones the nested
snapshot to avoid retaining caller aliases. Bounds match the existing
electrical contract (1e-15–1e-3 F/m); no numerical acceptance threshold changed.
There is no default permittivity, built-in dielectric assignment, new material
UI or MCP authoring. Missing dielectric data fails closed.

The live snapshot's library ID, custom/library kind, provenance source and
explicit revision must exactly match the sealed material ID/provenance.
Its model, unit and absolute permittivity must match numerically, without
conversion from optical IOR, relative permittivity or thermal conductivity.

### Sealing, revision and lifecycle behavior

The existing schema was extracted verbatim into the browser-safe
[electrostaticContract.mts](../simulation-bridge/electrostaticContract.mts).
Node sealing/reference exports retain their original APIs, digest algorithm
and acceptance rules. WebCrypto hashes the same canonical encoding in the
live reader; focused tests confirm agreement with existing Bridge hashing.
Node provider/runtime dependencies are type-only in the browser reader.

The guard reads revision before the sealed/domain/body/material/FACE/export
reads and again afterwards. Every revision-bearing read must match. Mesh reads
perform fresh full source checks on both sides of the trusted mesh lookup and
require exact request/revision/geometry identity. Successful reads return clones.
Missing model/body/domain, changed revision, caller/fixture identity mismatches,
changed geometry bytes, malformed/missing material, ambiguous/unresolved/
foreign FACE or invalid sealed digest reject without native dispatch.

This reader plugs into existing preparation/approval revalidation and the
provider-only completion lifecycle through the same interface. A subsequent
read after preparation (e.g. the approval boundary) cannot reuse an old success
as authorization. **No electrostatic approval flow is opened here.**
Existing lifecycle source checks run before execution, before publication and
on retrieval; live source mutation quarantines retrieval irreversibly and
stale submission fails before the driver is called.

### Focused evidence and limitations

| Lane | Status | Evidence and bounded limitations |
| --- | --- | --- |
| Actual CAD revision/model/material store wiring | PASS | Actual isolated Zustand document store and existing executor reads; no fixture revision callback |
| Actual semantic FACE reader/resolution | PASS | Existing selection registry/executor resolver; actual ambiguity and missing-topology rejection |
| Exact source/request/domain/material/geometry binding | PASS | Focused mismatch tests, WebCrypto/Bridge digest equality and cloned reads |
| Before/after read and preparation-to-approval staleness | PASS | Actual document mutation, including mutation during export; no new approval endpoint |
| Completion/retrieval quarantine through live reader | PASS | Existing lifecycle with one explicitly controlled synthetic execution; later live mutation revokes retrieval |
| Dielectric snapshot validation and alias isolation | PASS | Focused valid/invalid units/model/permittivity/extra-key tests |
| Actual OpenCascade export/inspection end-to-end | PENDING | Kernel I/O controlled in this source-binding test; no worker/solver or browser launch |
| Durable study/domain/mesh/completion records | PENDING | Host-record interface and existing in-memory completion ledger; no public authoring/persistence |

`npm run test:simulation:electrostatic-live-source`: PASS, 34 focused cases.
It loads the actual TunaCAD Zustand store, CAD revision function, definition
material reader and semantic resolver in an isolated Node process. Only kernel
measure/inspect/export calls are controlled. One controlled lifecycle driver
call proves reader-to-completion/retrieval wiring; **zero real solves**.
The real browser document is not mutated by this isolated test.

`test:sim9-electrostatic-foundation`: PASS, 58 rejection cases and unchanged
analytical targets, rerun only because the unchanged schema moved files.
New source-reader browser import closure and script syntax checks: PASS;
no Node electrical provider/digest imports leak into that browser closure.
Focused type checking reports the same 31 unchanged transitive errors in
`CalculiXMultiDomainDeck.mts` / `v2Validation.mts`, zero new-file diagnostics.
The standalone whole-private-adapter esbuild closure check stopped on existing
PlaneGCS `module`/WASM-loader requirements; no infrastructure repair/retry or
full application build was performed. It is not reported as a passing hosted/
browser integration check.

The exact STEP digest policy deliberately rejects unstable or changed export
bytes. If a runtime exporter changes volatile headers between otherwise
unchanged reads, this path fails closed; native export stability is not proved
by controlled kernel I/O. No silent header canonicalization was added.

Earlier electrostatic numerical/refinement/lifecycle evidence remains current:
physics, native solver formulation, mesh baseline, field recovery, acceptance
tolerances, provider admission and approval/quarantine behavior are unchanged.
No historical solver/refinement/browser/qualification suites were rerun.
Status remains `proof_of_concept`, `engineeringUsePermitted: false`.

## Sixth increment: persistent completion/result ledger and fresh replay

[electrostaticLedger.mts](../simulation-bridge/electrostaticLedger.mts)
adds an opt-in host-only filesystem store, not a registered provider or
browser/MCP endpoint. Its constructor receives two distinct non-nested trusted
host roots: content-addressed normalized-result blobs and a **separate**
protected completion-pin/quarantine catalog. No caller JSON, paths, record
digests or completion proofs are accepted by save/retrieval; operations take
job IDs. The owning host must protect both roots with appropriate filesystem
permissions/ACLs. Hashes do not defend against compromise of both host roots.
File modes are hints, not a claim of automatic Windows ACL provisioning.

Format: `tunacad-electrostatic-ledger/0.1`. Each record contains:

- Exact job/study ID; part/body identity; material/permittivity/provenance and
  all six FACE identities.
- Existing completed electrical wrapper with sealed request, CAD revision,
  model/geometry/domain/material/electrode/mesh/deck/provider/runtime bindings.
- Existing full normalized electrical result and its digest, raw-output digest,
  completion/root digests, electrical units and unchanged experimental status.
- Private provider completion record: completed/converged state, native final
  step/time evidence and diagnostic/status digests, runtime and cleanup=true.

The catalog pins job ID to the full record digest using
`tunacad-electrostatic-ledger-pin/0.1`. A blob's own recomputed digest cannot
replace this independently minted root. No raw DAT/STA/deck/STEP files,
executable paths, private CAD document, mesh payload or credentials are stored.
Normalized fields are retained because replay must return the original
complete result, not reconstruct a result from numerical summaries.

### Save and restart/replay boundary

The lifecycle's narrow `readCompletedLedger(jobId)` capture reads only its
private freshly rebound successful cleaned completion. There is no import/
setter API. Running, cancelled, failed, stale or unclean jobs cannot supply
the capture. Save validates the completion/result/source relationship,
performs fresh source checks on both sides, writes immutable blobs then
completion pins, and rebinds again after persistence before returning success.

Exclusive creates, fsync and a cross-instance/process exclusive writer lock
avoid overwrites and serialize count enforcement. A partial/crash-left write
never becomes valid completion evidence: malformed blob/pin fails closed.
A crash-left writer lock blocks new saves until explicit host recovery; it
is never automatically deleted. Existing valid pinned records can still be
retrieved through fresh checks. Bounds: 16 jobs/blobs, 16 MiB per full record,
2 KiB pin/quarantine files; bounded UTF-8 reads with a growth sentinel, file/
directory and symlink checks. No automatic eviction or unrelated cleanup.

A new ledger instance can retrieve without the old lifecycle or execution
driver. It reloads the independent completion pin and result, verifies full
record/completion/wrapper/electrical digests and successful clean state,
then runs the **existing live source reader** through two fresh complete
source bindings. CAD revision, actual geometry bytes, part/body/domain,
definition dielectric/provenance, uniquely resolved FACEs, sealed request,
current mesh/deck and runtime must still match. The pin is checked again
before returning a clone. Replay never invokes a solver.

The live CAD document and host study/domain/mesh stores must remain available
independently; their data is not restored from a result blob. Missing current
source or runtime data rejects replay. This increment does not implement
durable CAD/study authoring or store provisioning.

Known pinned jobs that fail integrity/source checks get a durable
`tunacad-electrostatic-ledger-quarantine/0.1` marker. Restoring their old blob,
pin or CAD source does not revive retrieval after a new instance is created.
Unknown jobs/missing pins return no result; no unbounded tombstone files are
created for unknown IDs. Catalog damage/unwritable quarantine state never
authorizes a result; durable quarantine cannot be claimed if the trusted root
itself is unavailable. Restoration of the entire trusted root is a host
authority/recovery action outside blob-digest authenticity.

### Focused persistence evidence

| Lane | Status | Evidence / limitation |
| --- | --- | --- |
| Deterministic idempotent save and new-instance replay | PASS | Same full record/root on repeated save; no old lifecycle capture in replay instance |
| Independent pin, nested digests and completion-state admission | PASS | Altered/malformed/foreign pin/blob; also simulated trusted-catalog faults with recomputed outer roots |
| Fresh live-source rebinding | PASS | Actual isolated Zustand/executor/semantic readers, controlled kernel I/O; source mutation after save and during replay |
| Durable known-job quarantine | PASS | Restored authentic files/source remain rejected by new instances |
| Cancelled/failed capture and replay rejection | PASS | Existing lifecycle produces no completed capture; contradictory cancelled/failed/unclean stored completions rejected |
| Writer exclusivity / no solver during replay | PASS | Held writer lock rejects save; same root after release; driver-call count unchanged |
| Real provider-backed durable archive production | PENDING | This test uses one explicitly controlled validated lifecycle result, not a new real CalculiX solve or reconstruction from historical summaries |
| Host record/ACL provisioning and native live export stability | PENDING | Not registered, configured or claimed by this opt-in helper |

`npm run test:simulation:electrostatic-live-source`: PASS, now 68 focused
source/material/lifecycle/persistence cases, including 22 persistence
corruption/source-rebinding cases. The actual isolated live readers are used;
kernel I/O and the single completion driver are controlled. New instances
simulate restart by dropping all old ledger/capture state and reloading disk,
not by restarting the user's application. Zero real solves. Each test cleans
only its newly created fixture directory; durable host data is not touched.

`test:sim9-electrostatic-lifecycle`: PASS, 41 controlled cases, rerun only
because the private successful-capture method and exported source-binding
helper changed. Ledger/lifecycle syntax: PASS. Focused type checks: the same
31 unchanged transitive diagnostics, zero changed-file diagnostics after the
new read-buffer typing correction. No solver/refinement/historical/browser/
Chromium/unrelated build or bundle checks ran.

Earlier electrical analytical, real-provider, refinement and live-source
evidence is current. The source-binding algorithm was exposed for reuse,
not changed; physics, mesh baseline, numerical tolerances, field normalization,
material semantics, runtime limits and cancellation/failure quarantine are
unchanged. The persistent test is admission/storage evidence, not new physical
or formal qualification evidence. `proof_of_concept`,
`engineeringUsePermitted: false`; all public electrical admission remains closed.

## Next incomplete bounded electrostatic item

Bounded single-slab browser/MCP electrical authoring and preparation/approval,
reusing trusted live-source/protected host records and showing potentials,
dielectric units/provenance and provider bounds before geometry transfer.
The eleventh-increment matrix consolidates the current evidence; it does not
open admission, register a provider or promote the capability. Electrical
field paging/visualization and production host integration remain separate.

## Seventh increment: native fixed-revision STEP/source stability diagnostic

The owning TunaCAD repository now contains one focused native test,
`npm run test:simulation:electrostatic-native-export`, with exact version-bound
output in its `docs/evidence/SIM9_ELECTROSTATIC_NATIVE_EXPORT_EVIDENCE.json`.
Private native fixture code and the CAD document are not copied into this
public repository. This is a native kernel diagnostic, not a browser,
provider solve, protected production-store configuration or qualification.

OpenCascade.js 2.0.0-beta.b5ff984 (writer identifies OCCT 7.6) initializes the
installed full WASM in Node 24.18.0. One 1 × 10 × 10 mm native box is recomputed
through TunaCAD, tessellated and registered in the actual isolated Zustand
document/semantic resolver. CADWorkerClient calls unmodified CadKernel and
OccExchangeService. Only browser-worker transport/bootstrap is replaced with
an in-process API; no fake STEP writer, measurement or shape-inspection results.
No Chromium or Gmsh/CalculiX invocation.

At fixed revision
`56a74d3d5f9b9bf9b3b7aa9f2cef2e764a3815f8a2d5b7ec89c40409ca949e29`,
all three exports contain 15403 bytes:

| Export | Header time (UTC runtime) | Raw STEP SHA-256 prefix | Existing geometry digest prefix |
| --- | --- | --- | --- |
| 0 | 2026-09-28T13:48:57 | cece761358ea | 8c2156e1cc8c |
| 1 | 2026-09-28T13:48:58 | 9c45d9bd4208 | 956daa358547 |
| 2 | 2026-09-28T13:49:00 | aa4ed68b61b3 | b2b39ad77361 |

Full hashes and before/after revisions are retained in the owning evidence.
The existing geometry hash canonical-encodes the exact exported byte array;
it is not a geometry-aware STEP canonicalizer. FILE_NAME timestamps change,
and DATA also differs in generated PRODUCT names
`Open CASCADE STEP translator 7.6 1/2/3`. Header stripping alone is insufficient.
No bytes were rewritten and no alternate hash was admitted.

Each unaltered export is independently re-imported through the real native
STEP reader. Volume 99.99999999999997 mm³, area 239.99999999999997 mm²,
bounds [0,0,0]–[1,10,10] mm and all six planar face geometries agree within
1e-8 native measurement units. This tolerance is a diagnostic comparison only,
not a change to provider acceptance thresholds. Native semantic FACE
resolutions and live revisions before/after exports agree exactly.
A diagnostic native FACE-signature hash stays constant; it is never used to
seal a request, authenticate a source or replace the raw-geometry constraint.

### Native gate matrix

| Lane | Status | Evidence / limitation |
| --- | --- | --- |
| Native STEP byte stability | FAIL | Timestamp and PRODUCT counter drift at a fixed revision |
| Existing byte-bound geometry/source stability | FAIL | Three different geometry digests; full live source binding unavailable |
| Re-imported slab geometry equivalence | PASS | Native volume/area/bounds and unique matching planar FACE signatures |
| Fixed revision/body/domain/FACE identity stability | PASS | Same live store, one owned body, six uniquely resolved semantic FACEs |
| Authentic native live-source binding | FAIL | inspectShape reports 24 edge occurrences; guard requires 12 unique edges |
| Fail-closed lifecycle on authentic binding failure | PASS | Failed/cleaned, zero solver dispatch, null result |
| Revision/geometry/FACE mutation rejection | PASS | Actual store edits invalidate the sealed revision |
| Missing/ambiguous/corrupted native readers | PASS | Missing-body export, ambiguous actual semantic resolver, native corrupted STEP import reject independently |
| Native downstream export-digest/during-read guard isolation | PENDING | Body topology mismatch rejects before these source-reader branches; no masked PASS claim |

Focused diagnostic: PASS, 11 cases. The first version incorrectly asserted
DATA bytes were stable; the native counter disproved that assumption. The
fixture was corrected to record the differences, not normalize them away.
The final focused run passes its assertions while retaining the acceptance
FAIL/PENDING statuses above. No broader validation was launched.

Earlier analytical, provider/refinement and controlled lifecycle/persistence
evidence remains valid in its recorded scope. This result narrows native
integration readiness; it does not invalidate electrical physics evidence or
claim prior controlled kernel reads were native evidence. No production
kernel, source guard, lifecycle, ledger format, numerical threshold, mesh
baseline, physics or provider admission changed. Status remains
`proof_of_concept`, `engineeringUsePermitted: false`; electrical
provider/browser/MCP/visualization admission stays closed.

## Eighth increment: deterministic native source identity and unique topology

[electrostaticStepIdentity.mts](../simulation-bridge/electrostaticStepIdentity.mts)
defines `tunacad-electrostatic-native-step-identity/0.1`. The existing
live source reader obtains STEP only from the trusted CAD exporter and hashes
the versioned canonical representation via the existing canonical WebCrypto
digest. Requests still bind exact live revision, part/body/domain, geometry,
dielectric/provenance and all semantic FACE identities. No caller digest alone
proves ownership or authentic source.

Only these proven non-geometric OCCT 7.6 serialization fields are normalized:

1. The timestamp string in the single native
   `FILE_NAME('Open CASCADE Shape Model',...)` becomes
   `2000-01-01T00:00:00` after strict calendar/format validation.
2. The matching positive numeric suffix of the one generated PRODUCT ID and
   name, `Open CASCADE STEP translator 7.6 N`, becomes `0`.

The PRODUCT entity number, translator version, description, context/reference
entities, all other header/data values, units, schema, geometry, topology,
ordering and whitespace are preserved. No header block is dropped. No entity
renumbering, topology repair, geometric tolerance rounding or volume-only hash.
Exactly one supported native PRODUCT is required; unknown/multiple formats
fail closed. UTF-8 BOM is explicitly retained and rejected by framing checks,
not silently omitted by the decoder. Raw native STEP exports remain untouched.
The 32-MiB input bound is unchanged. This is not a general STEP-equivalence
algorithm or an admission of another exporter/runtime.

### Equivalent edge semantics

The native explorer's existing `edgeCount` counts per-face uses: each box edge
appears on two faces, giving 24. Its vertex-use count likewise remains 48;
neither legacy count is changed for other callers. Native indexed
edge-to-FACE ancestry maps identify 12 distinct topological edges.
An optional bounded inspection record supplies native FACE signatures,
per-face edge indices, unique edges and their incident FACE indices. This
record is available only within 16-FACE/64-unique-edge bounds; collection
failure does not change existing inspection results and cannot authorize
electrical binding without evidence.

The guard matches all six semantic FACEs uniquely to native planar signatures,
requires four distinct edge uses per rectangular face and two distinct
incident FACEs per unique edge, checks reciprocal incidence and derives
unique/use counts from this graph. Every adjacent semantic FACE pair shares
one edge; the three opposing pairs share none. Missing/altered graph data,
duplicate incidence and genuine native topology replacement reject. The guard
does not hardcode 24 as a substitute for the formerly hardcoded 12.

### Focused native revalidation

The owning TunaCAD evidence file
`docs/evidence/SIM9_ELECTROSTATIC_NATIVE_SOURCE_REVALIDATION.json` retains full
raw/canonical hashes, FACE graph, runtime and implementation fingerprints,
exact rejection reasons and the historical evidence reference.

| Lane | Status | Bounded evidence |
| --- | --- | --- |
| Raw native bytes | NONDETERMINISTIC, documented | Header timestamp and PRODUCT counter still differ; no writer change |
| Trusted canonical geometry/source identity | PASS | Three exports, all 15403 bytes, one canonical digest |
| Fixed revision/body/domain/FACE identity | PASS | Actual isolated store/native kernel/semantic reader, repeated authentic binding |
| Unique edges and FACE adjacency | PASS | 12 unique edges / 24 uses; native graph and semantic FACE ownership |
| Geometry and non-excluded STEP content integrity | PASS | Real 1.1-mm geometry edit changes digest; coordinate and context edits reject |
| Topology/FACE mutation and missing evidence | PASS | Real cylinder replacement, altered adjacency, missing topology and FACE cache changes reject |
| Missing/ambiguous/corrupt sources | PASS | Native body/export lookup, actual semantic ambiguity, malformed/truncated/BOM output reject |
| Previously blocked downstream guards | PASS | During-export revision and changed geometric STEP digest reject at the intended branches |
| Persistent replay with this new native source policy | PENDING | No ledger/lifecycle rerun or new provider result; not inferred from earlier controlled byte-bound evidence |

`npm run test:simulation:electrostatic-native-export`: PASS, 24 focused cases.
Installed OpenCascade.js 2.0.0-beta.b5ff984 / writer OCCT 7.6 / Node 24.18.0,
using real recompute/tessellation/export/re-import and live CAD readers with
in-process transport, not Chromium. Final revision
`929304aba7bd6652a9e95cd71d4e051059dc845acc658d2778c70bf339094844`
includes the native feature's explicit `suppressed: false` flag; slab geometry
is unchanged from the historical fixture. Three exports at 14:09:57,
14:09:59 and 14:10:00 retain the same canonical digest:
`sha256:997f6a9d5dbd24427a13208eea991a5a03fed65d2292f8ec94aed271a946b5a9`.
Repeated authentic live reads return the same sealed request. Re-import
volume/area/bounds and six FACE geometries remain unchanged.

Scoped changed-file types: zero diagnostics. There are 43 diagnostics outside
the changed files in necessary transitive dependencies; no full-project
type/build success is claimed and these were not investigated. The controlled
reader fixture was adapted to explicit canonical serialization/unique topology,
but its 68-case persistence path was not run under the native-only request.
No solver, refinement matrix, historical suite, browser or unrelated build ran.

Earlier electrical numerical/provider/refinement evidence remains current.
The historical native raw-byte FAIL is preserved; its native readiness finding
is superseded by this bounded canonical-policy PASS. Earlier raw-byte live
source/replay assertions are stale for the changed identity policy, not proof
of new-policy persistent replay. No stored result is silently rehashed or
migrated; an old source whose digest no longer agrees fails closed under the
existing replay/quarantine rules. Fresh host records must seal the new trusted
identity; stale jobs cannot be rebound in place.

No physics, solver formulation, mesh baseline, result recovery, lifecycle,
persistence format, resource limits or electrical public exposure changed.
`proof_of_concept`, `engineeringUsePermitted: false`; registered provider,
browser/MCP and visualization admission remain closed.

## Ninth increment: durable host records and protected ledger storage

[electrostaticHostRecords.mts](../simulation-bridge/electrostaticHostRecords.mts)
implements the existing host-record interface, and
[electrostaticHostStorage.mts](../simulation-bridge/electrostaticHostStorage.mts)
provides opt-in Windows protected storage. No public registration or production
storage installation is added. Host code injects trusted capture/live/runtime
readers; no API accepts a caller record/digest as authority.

### Durable formats and trust boundary

- `tunacad-electrostatic-host-study/0.1`: study ID, sealed request, domain/part/
  body/revision mapping, all electrode/lateral FACE identities, dielectric
  material and absolute-permittivity provenance, canonical geometry digest,
  complete validated mesh and existing immutable request/source/mesh/deck/
  runtime binding. Maximum 16 study records, 16 MiB each.
- `tunacad-electrostatic-host-study-pin/0.1`: independent study-to-record
  digest, source identity version and configuration digest in source catalog.
- `tunacad-electrostatic-host-storage/0.1`: random host storage ID, fixed root
  and four sibling roles, canonical source version, directory file identities,
  protection policy and actual DACL fingerprints.
- `tunacad-electrostatic-host-storage-pin/0.1`: independent configuration
  digest. Existing `tunacad-electrostatic-ledger/0.1`, completion pins and
  quarantine formats are unchanged.

Exclusive/fsynced writes never replace an existing different record. Capture
binds the live source repeatedly before/after publication; source pins and
configuration are rechecked during read. A bounded exclusive writer lock has
no automatic stale-lock removal. An interrupted partial publication cannot
be treated as a completed provider result.

Stored requests/meshes are recomputed against the freshly read runtime to
verify internal integrity; that recomputation is **not** live-CAD proof.
The existing live-source reader independently resolves current revision,
body/domain, native geometry/topology, semantic FACE identities and material,
re-exports and recomputes canonical source identity. The existing ledger
freshly binds this reader and checks completion pins, result and nested
digests, mesh/deck/runtime provenance, successful completion and cleanup.
Restoring an old blob after a source-integrity quarantine does not clear it.

### Protected storage configuration

Roles are `studies`, `source-catalog`, `results` and `completion-catalog`;
paths derive from the configured host root, never from stored caller paths.
New-root provision refuses existing roots, drive roots and reparse/symlink
ancestry before creation. Directories have protected, noninheriting DACLs
allowing FullControl only to the current host SID, SYSTEM and Administrators,
with inheritance into their own files. Existing roots are opened/verified,
not automatically repaired or re-permissioned.

Reopen and protected-ledger save/retrieval are bracketed by configuration/pin,
directory identity, exact directory ACL and effective file ACL checks.
Unexpected principals, changed roles or root, invalid ownership, reparse/
nonregular files, changed directory identities and bound violations fail
closed. ACL inspection/provision uses a hidden, bounded Windows PowerShell
child with .NET security APIs; paths pass as JSON environment data, not script
interpolation. This policy does not defend against the trusted host account,
SYSTEM or an administrator compromising both catalogs. Non-Windows hosts
remain unsupported. An unavailable protection/configuration check yields no
result; it does not claim a durable quarantine marker was written when the
storage cannot safely be used.

### Versioning, focused evidence and limitations

Every configuration/study/pin binds
`tunacad-electrostatic-native-step-identity/0.1`. Old raw-byte or unknown
records are stale/legacy evidence; no silent rehash, upgrade or replacement
is available. A new authenticated study/result must be regenerated explicitly.

| Lane | Gate | Evidence / limitation |
| --- | --- | --- |
| Protected new-root provision and restart | PASS | Actual Windows DACLs and directory identities; injected unapproved principal rejects |
| Durable record capture, pins and exact replay | PASS | 30-case focused host fixture; same completed result/digest after new instances, no repeat driver dispatch |
| Fresh live revision/geometry/material/FACE reads | PASS | Actual isolated Zustand/semantic readers; native kernel I/O controlled |
| Mesh/deck/runtime/domain/request integrity | PASS | Altered records, including recomputed fixture catalog roots, fail semantic/source binding |
| Missing/altered/legacy/configuration records | PASS | Bounded loading/version/pin/config checks; no migration |
| Cancelled/failed completion and sticky quarantine | PASS | Controlled completion/cancellation; fresh-source failure remains quarantined after reopening |
| Native CAD + real provider + protected durable restart/replay | PENDING | Separate earlier native-source/solver evidence is not combined into this test |

Private host test command: `npm run test:simulation:electrostatic-host-records`,
PASS, 30 cases, zero native solver executions. It uses real Windows security
checks and actual isolated CAD store/live semantic readers, with explicitly
controlled exporter, validated mesh and completed electrical output. It is
storage/admission evidence, not new numerical or engineering qualification.
Its temporary root alone is removed; no durable user or production root is
installed/modified. The initial ACL cmdlet module dependency failed; equivalent
.NET DACL APIs succeeded in one safe fallback. No environment repair occurred.
New-file scoped types: zero diagnostics, 43 outside-file transitive diagnostics
not investigated; runner syntax passes. No full-project build/type success,
solver/refinement rerun, Chromium or historical suite is claimed.

Controlled canonical-source persistence evidence is refreshed by this test.
Earlier raw-byte evidence remains legacy, not upgraded. Earlier native
numerical/refinement evidence remains current because no physics, solver,
recovery, mesh baseline or tolerance changed.
`proof_of_concept`, `engineeringUsePermitted: false`; browser/MCP, provider
registration and visualization remain closed.

## Tenth increment: native-CAD / real-provider protected durable replay

The private host command `npm run test:simulation:electrostatic-durable-native`
combines the real installed OpenCascade.js kernel/CADWorkerClient writer,
isolated actual live CAD/material/semantic readers, unchanged canonical STEP
identity, existing Gmsh/CalculiX adapters and protected host record/ledger
implementations. No public provider implementation/schema/physics changes.
STEP transport is unmodified; canonical identity is checked before and after
native export at the fixed CAD revision. Mesh size remains 2 mm.

| Lane | Gate | Evidence / limitation |
| --- | --- | --- |
| Native live source and canonical identity | PASS | Real fixed 1 × 10 × 10 mm slab and six semantic/native FACEs; source matches eighth-increment digest |
| Validated native mesh and real completion | PASS | Gmsh 4.15.2, 1267 nodes / 590 DC3D10 elements; CalculiX 2.16 completed/converged and cleaned |
| Electrical analytical comparisons | PASS | Five potential samples, recovered E/D, electrode reactions, capacitance and energy; unchanged tolerances |
| Protected durable study/completion/result pins | PASS | Actual Windows ACL checks, exclusive records and configuration bindings |
| Exact new-instance replay and fresh CAD rebinding | PASS | Capture/lifecycle discarded; recreated lifecycle has no job; ledger has no completion capture; JSON bytes and digests unchanged |
| Live revision/geometry/material/FACE mutation | PASS | Actual CAD/native mutations; no result and persistent quarantine after restore/reopen |
| Persisted mesh/result integrity | PASS | Own-fixture disk tampering; independent pins reject |
| Cancelled/failed/quarantined completion replay | PASS | Archive fault injections based on the authentic record, not extra failure/cancellation solves |
| Separate OS-process restart or Chromium integration | PENDING / outside fixture scope | Requested in-memory lifecycle reconstruction only; no public admission |

Electrical results: 0/25/50/74.99999999999999/99.99999999999997 V;
E_x = -100000 V/m; D_x = -3.54167512512e-6 C/m²;
electrode charges ±3.5416751038699474e-10 C;
C = 3.5416751038699474e-12 F; field energy =
1.7708375625600002e-8 J. Net electrode charge = 0 C;
field-minus-charge energy = 1.0625026442147274e-16 J.
Charge/capacitance relative error and relative energy residual are ~6e-9.
The complete immutable identities and actual electrical/reference values are
in the private host evidence record; no private CAD source/fixtures are copied
into this public repository.

The first startup attempt failed before a solve because Node strip-only mode
cannot load parameter properties; one `--experimental-transform-types`
fallback kept actual provider module locations/resource-helper URLs intact.
The initial real run completed/persisted but the fixture's strict object
assertion distinguished -0 from 0. Existing JSON digests/persistence already
represent both as 0. Only the test comparison changed to exact wire JSON and
existing digest; recovery and schema did not change. The identical fixture
reran and passed: **two native solves total this increment**, one successful
final run; no refinement matrix or unrelated suite.

Separate mesh generations need not have the same connectivity/count: the first
assertion diff referenced 583 elements versus 590 in the successful run.
The mesh definition was not adjusted. Each completed job binds its own full
validated mesh digest; exact replay does not regenerate a mesh.
New-file scoped types: zero diagnostics, 45 outside-file transitive diagnostics
not investigated; runner syntax passes. No full-project build success claimed.

The combined native/provider canonical-source persistence gate is now PASS,
superseding the earlier PENDING as current evidence, not rewriting history.
Legacy raw-byte records remain stale; no automatic upgrade. Earlier numerical,
source/refinement evidence remains current. The fixture cleans ONLY its own
new temporary root after real persistence/reopen/negative checks; no production
storage installation, browser/MCP authoring or visualization is added.
`proof_of_concept`, `engineeringUsePermitted: false`; admission remains closed.

## Eleventh increment: capability-specific evidence consolidation

[The complete electrostatic matrix](SIM9_ELECTROSTATIC_EXIT_GATE_MATRIX.md)
records 37 lanes: **29 PASS / 3 historical FAIL / 5 PENDING**.
All currently implemented bounded lanes are PASS; historical raw STEP byte
nondeterminism, the failed old byte-bound identity and the rejected coarse
refinement plateau remain FAIL findings. They are not relabelled or omitted.
New canonical identity and protected fresh-source replay PASS evidence
supersede only the applicable earlier-policy readiness findings. Legacy
records are never rehashed or silently upgraded.

The catalog distinguishes analytical, controlled-fixture, native-CAD and
real-provider-backed evidence, including derived D=epsilon E and authentic
output/archive tamper injections. Original source/run identities and limits
remain intact. Current native-source and durable-native-replay fingerprints
match their records; early raw-byte replay is not accepted as canonical proof.
This is a documentation-only increment. No test, solve, refinement/export,
browser, historical suite or build ran; no numerical/source evidence became
stale. Only lane/reference/document consistency was checked.

No additional validation is required merely for consolidation. The bounded
provider/source/replay scope is ready for consideration of a separately
defined internal-validation scope, not automatically promoted or public-beta
ready. Remaining PENDING lanes are authoring/approval/admission, electrical
field UI, production/separate-process restart, physically non-converged solve
evidence (not forced for the well-posed slab), and intentional future qualified
engineering-use review. Independent review is not a mandatory next normal
development or public-beta step.
`proof_of_concept`, `engineeringUsePermitted: false`; public admission closed.

## Authoring sub-increment: approved Option 1 local source boundary

Implemented the browser-safe `electrostaticGeometryApproval.mts` controller.
Before both approvals, only ephemeral local native STEP inspection/canonical
digest computation is permitted. Preparations retain request/source identities,
not STEP bytes; no meshing, solver input or provider operation occurs.
The host transfer seam receives no geometry during its separate approval
phase. Only browser confirmation plus a matching trusted Bridge approval
receipt permits a fresh export/source recheck before transfer.

Source revision/ownership, dielectric material/provenance, FACE/native topology
and canonical digest checks reuse the existing guard unchanged. Host source
notifications invalidate even changed-and-restored CAD; failure/cancellation/
expiry/denial/mismatched receipts/concurrent confirmations fail closed and revoke
acquired authorization. Active preparations: maximum eight; lifetime 120 s.
Trusted transport injection is host-only, never an MCP approval argument.

Private host integration records 29 focused PASS cases, using actual isolated
TunaCAD live document/material/FACE readers, controlled kernel I/O and transport
doubles, plus static React electrical approval markup. Local-only MCP
preparation and verified canonical digest display are connected; registered
Bridge/provider admission remains closed. The existing controlled source
fixture passes 68 cases. Changed-file types: zero diagnostics; 43 unrelated
transitive diagnostics not investigated. No solver/native/browser/historical
matrix rerun. Original trusted-guard fingerprint remains unchanged; no earlier
numerical, canonical identity or persistence evidence became stale.

This is a partial authoring increment, NOT a complete public provider path.
The next bounded item remains connecting the actual dual-approved Bridge
transport/admission to protected durable completion and numerical summary
retrieval, preserving fresh live-source rebinding and quarantine. P01 remains
PENDING; electrical fields are subsequent separate work. No promotion:
`proof_of_concept`, `engineeringUsePermitted: false`.

## Approved single-slab Bridge/provider dispatch

The preceding closed-admission descriptions are historical. The new bounded
host-opt-in path connects the existing MCP/browser preparation and browser
confirmation to separate terminal approval, fresh canonical STEP/source checks,
actual authenticated Bridge transfer, composed meshing/electrical lifecycle,
protected host records/result ledger and an additive approved-dispatch pin.
The pin binds preparation, authorization, outer provider run, inner completed
electrical job, request/canonical source and result digest. Browser live source
reads bracket retrieval; stored approved-transfer records never replace CAD truth.
Summary-only output uses electrical units. Cancellation is idempotent and stale/
failed/malformed/late cancelled work cannot expose a valid result.

Explicit host environment `TUNACAD_ELECTROSTATIC_STORAGE_PARENT` must name an
existing absolute non-symlink directory. Each admitted job creates its own
new protected vault; unavailable configuration/protection/runtime fails closed.
Existing 2 mm integration mesh, Gmsh 4.15.2/CalculiX 2.16, Node 24/Windows x64,
CPU/memory/output bounds, canonical policy and numerical tolerances are unchanged.
No old records are upgraded or persistence schemas replaced.

Private focused evidence: 13 controlled actual-HTTP/storage/lifecycle cases
PASS; 29 approval-boundary cases PASS. One native-CAD/real-provider job reached
cleaned persisted completion, passed analytical potential/C/energy and exact
replay/pin assertions. Its command nevertheless exited FAIL in final report
formatting (wrong mesh element property), after the logged success assertions.
Reporter fixed and validated with controlled data only; no second real solve.
Exact real mesh/numerical/digest receipt was not captured. P01 remains PENDING
for a clean focused receipt, not for missing dispatch implementation.

No new changed-file type diagnostics; pre-existing Gmsh callback and unrelated
dependency diagnostics were retained, with no full-project build/type success.
Earlier numerical/native/canonical/persistence evidence remains valid within
its recorded scope; new dispatch/cancellation evidence is separately recorded.
No Chromium, refinement/historical suite, deployment, commit or push.

Next incomplete gate: successful focused real-dispatch reporting in a future
separately authorized single solve. Next named feature thereafter: electrical
field pagination/visualization. No broader electrical physics or promotion:
`proof_of_concept`, `engineeringUsePermitted: false`.

## Approved-dispatch receipt closure: PASS

One separately authorized run of
`npm run test:simulation:electrostatic-dispatch -- --real` passed the existing
analytical checks, corrected mesh/result reporter, awaited cleanup and overall
exit 0. No implementation, physics, acceptance threshold, 2 mm mesh definition,
canonical policy, lifecycle, persistence or approval behavior changed.

Actual native CAD preparation and browser confirmation controller preceded
the separate Bridge approval callback. Fresh source/digest checks permitted
exactly one STEP transfer, one Gmsh 4.15.2 meshing and one CalculiX 2.16 solve.
1267 nodes / 590 DC3D10 elements; Windows x64 / Node 24.18.0.
Provider phase `succeeded_cleaned_persisted`, protected dispatch/completion
pins and two identical result reads with fresh live-CAD rebinding all passed.
This is real authenticated loopback/native/provider/storage evidence, not
Chromium, interactive two-human, hosted or separate OS-process restart evidence.

Potentials: 0/25/50/74.99999999999999/99.99999999999997 V (max error
2.84217e-14 V). Electrode charges ±3.5416751038699474e-10 C, net zero.
Capacitance 3.5416751038699474e-12 F, energy 1.7708375625600002e-8 J;
charge/C reference error ~6e-9 and field-versus-charge energy residual
1.0625026442147274e-16 J (~6e-9 relative). Canonical source digest is unchanged
at 997f6a9d5dbd24427a13208eea991a5a03fed65d2292f8ec94aed271a946b5a9.
The private approved-dispatch evidence now contains the clean full receipt,
mesh/deck/runtime/completion/result digests; consumed authorization ID omitted
from documentation. Its historical failed reporter attempt is not erased.

P01 is now PASS; complete matrix: 30 PASS / 3 historical FAIL / 4 PENDING.
Earlier bounded evidence remains current; only this one focused fixture ran.
Next incomplete named item: electrical field pagination/visualization.
No commit, push, deployment or promotion. Capability remains
`proof_of_concept`, `engineeringUsePermitted: false`.

## Bounded electrical field paging and viewer — 2026-09-28

P02 PASS. Separate electrical dataset/page schemas now expose potential (V),
electric-field magnitude/vector (V/m), and electric displacement
magnitude/vector (C/m^2) through the existing completed-job field endpoint.
Potential is nodal; E/D are labelled element averages of four recovered
integration-point vectors projected onto boundary triangles. Charge,
capacitance and total energy remain numerical summaries, not contour fields.

Static frame 0; exact job/domain/request/result/canonical-source/mesh
identity, ordered facet/subtriangle pages, 1–128 triangles/page, bounded
64000 total, chunk/full digests and exact extrema/positions. Fresh protected
completion/mesh/source checks precede pages; browser source rebinds after
retrieval. Stale or non-successful jobs cannot retain an active viewer.

Focused field command PASS: actual authenticated loopback/protected Windows
storage with controlled native-output driver, followed by actual isolated
Chromium/Three.js/WebGL rendering. 27 nodes / 6 quadratic tetrahedra /
48 surface triangles per dataset; seven pages at limit 7.
18 malformed/order/digest/range negatives, 11 rendered-viewer tamper cases.
Contours, electrical units/legends, scalar/vector probes, X clipping,
domain visibility and no thermal/structural labels PASS.
Ranges 0–100 V; E 100000 V/m; D 3.54167512512e-6 C/m^2.
No real solver/native/refinement/historical suite was rerun.

Evidence T is the private host record
`docs/evidence/SIM9_ELECTROSTATIC_FIELDS_VIEWER_EVIDENCE.json`.
Previous real-provider/numerical/source/persistence evidence is unchanged;
new transport/viewer claims are independently scoped, not inferred from it.
Matrix 31 PASS / 3 historical FAIL / 3 PENDING.
Next recorded incomplete gate is P03 production host bootstrap/protected
storage provisioning and separate OS-process restart. Future formal review
is not a mandatory normal development step. No promotion, commit or deployment.

## P03 protected owning-host provisioning and actual process restart — 2026-09-28

P03 PASS within explicit Windows production-style storage/cold Node replay.
Provisioning creates only a new configured root and fixed protected roles;
existing roots are refused, never auto-repaired. Reopen preserves exact
configuration/ACL/source-version identities. Host-only ElectrostaticHostReplay
reuses the existing ledger/live-source reader and independently resolves the
result's sealed request to exactly one protected study pin for field recovery.
No new browser/MCP route, approval bypass or persistent schema is introduced.
See [provisioning instructions](ELECTROSTATIC_HOST_PROVISIONING.md).

Old fixture archives were deleted, so one native/real-provider 2 mm slab was
necessary: Gmsh 4.15.2, CalculiX 2.16, 1267 nodes / 590 DC3D10 elements.
Producer PID 1420 persisted source document and protected study/domain/mesh/
completion/result records then exited 0. A fresh executable PID 10212 loaded
the independent owning CAD document into actual native CAD/model stores;
no old lifecycle job/result map existed. Fresh native canonical STEP identity,
revision/body/domain/FACEs/material and runtime/mesh/deck/result bindings pass.
Result/electrical digests and three field descriptor/root digests are identical:
1792 triangles/dataset, 14 local integrity pages at 128, freshly authenticated
first page per dataset. No HTTP/browser/viewer or second-solve claim.

Thirteen fail-closed cases pass: revision, geometry, material, FACE, host mesh,
result, recomputed cancelled/failed completions, persisted quarantine, invalid
configuration, missing storage, unapproved ACL and inaccessible configuration.
Source/result quarantine survives restoration/reopen. ACL/file fault resets
are confined to this newly generated test archive, not a production recovery API.
The archive is retained for later authenticated reuse.

Initial solve/cold replay succeeded but the fixture's restore requested
SeSecurityPrivilege unnecessarily. DACL-only fixture correction plus exactly
one fresh replay-only retry passed/exit 0; real solve count remains one.
No storage safety policy changed. Scoped type diagnostics zero; 45
outside-scope diagnostics remain, no full-project build claim.
Evidence V: private `docs/evidence/SIM9_ELECTROSTATIC_PROCESS_RESTART_EVIDENCE.json`.
Prior numerical/source/paging assumptions stay current; the exact old
host-record fingerprint is superseded by the additive lookup's P03 evidence.
Matrix 32 PASS / 3 historical FAIL / 2 PENDING.

No hosted browser restart, service installation, machine reboot, deployment
or status promotion. Still `proof_of_concept`, `engineeringUsePermitted: false`.
Next recorded gate P04 is physical non-convergence, a scope limitation rather
than a mandate to manufacture failure in the well-posed linear slab.
P05 remains future intentional qualified promotion only.

## P04 applicability assessment — 2026-09-28

P04 remains **PENDING / not demonstrated for the current well-posed linear
scope**. No genuine physical non-convergence mechanism was identified within
the admitted connected positive-constant-permittivity slab, valid complete
prescribed-potential electrodes and insulated lateral boundaries.
An affine potential exists; the homogeneous difference energy integral
`integral epsilon |grad(w)|^2 dV=0` proves uniqueness once the Dirichlet
electrodes fix the gauge. The provider retains internal constant conductivity
1; there is no nonlinear material/coupling feedback.

Continuum well-posedness does not rule out finite-precision conditioning or
implementation failure. No relevant admissible numerical-failure fixture is
currently established, so no solve is justified merely to satisfy P04.
Invalid input, runtime/resource failure, cancellation, malformed/incomplete
output and deliberately corrupted solver configuration are separate categories.
Intermediate native iteration messages are not terminal failure proof.
Controlled non-convergence outcome flags and failed archive fault injections
remain lifecycle/integrity evidence, not physical non-converged solves.

See the full rationale/classification and primary formulation references in
[the evidence matrix](SIM9_ELECTROSTATIC_EXIT_GATE_MATRIX.md#p04-applicability-assessment--2026-09-28).
No code, provider/runtime, physics, tolerance, schema or exposure changed.
No tests/solver/native/browser/historical suites ran for this assessment.
Prior evidence remains current; totals stay 32 PASS / 3 historical FAIL /
2 PENDING. P01–P03 pass; no further actionable bounded development gate is
identified before future P05 beyond this explicit undemonstrated limitation.
No release/qualification is inferred. Status remains `proof_of_concept`,
`engineeringUsePermitted: false`, with no commit, push, deploy or promotion.
