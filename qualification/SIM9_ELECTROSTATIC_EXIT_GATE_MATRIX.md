# SIM-9 bounded electrostatic capability evidence matrix

Recorded 2026-09-28 by consolidating existing evidence only. No solver,
refinement, native-export, browser, historical suite or build was rerun.
Status remains `proof_of_concept`, `engineeringUsePermitted: false`;
Historical consolidation opened no provider/visualization admission. The
approved-dispatch addendum below now implements host-opt-in single-slab
dispatch only. The electrical field addendum below now enables only the
same bounded slab's surface datasets/viewer, without status promotion.
Option 1 addendum: local-only MCP preparation, verified canonical digest display
and a dual-approval transfer controller now have focused controlled evidence.
Approved dispatch addendum: registered Bridge/provider wiring is implemented.
The 13 controlled HTTP/storage/lifecycle cases and 29 approval cases PASS.
The first native/real-provider command failed in final mesh-report formatting
after successful completion/replay assertions; that finding remains historical.
One separately authorized clean receipt run now passes the corrected reporter,
fresh-source replay and overall exit 0. P01 is PASS for the bounded scope only.
Missing host configuration keeps admission closed; no status promotion.
P03 addendum: explicit protected Windows host provisioning and real separate
Node process restart/replay now pass. This is owning-host native CAD/model
reload, not hosted browser restart, installed service or machine reboot.

## Bounded scope

One origin-aligned rectangular homogeneous linear isotropic dielectric slab,
constant absolute permittivity, complete opposing prescribed-potential FACEs,
insulated lateral boundaries, no free charge, fringing, open domain,
multi-domain dielectric, nonlinear behavior or coupling. Only straight-sided
affine quadratic tetrahedra are admitted. Numerical evidence is the
1 × 10 × 10 mm, epsilon_r=4, 0/100 V fixture on Windows x64,
Node 24.18.0, Gmsh 4.15.2, CalculiX 2.16 and recorded OpenCascade.js
2.0.0-beta.b5ff984 / OCCT 7.6 native writer.

Provider limits: 8000 nodes, 4000 elements, 8 MiB native output;
0.002 V profile error, 1e-4 relative field/charge/energy bounds with existing
near-zero floors. CalculiX retains 30 s CPU/wall, 512 MiB memory, 64 MiB
working-directory limits and bounded diagnostics; existing Gmsh quotas remain.
Host records/ledger remain bounded and fail closed; no limit changed here.

Evidence categories describe what actually ran, not stronger inferred proof.
Fixture source files are definitions; execution PASS comes from the existing
development/run records. Current-fingerprint comparisons of N/R dependencies
are read-only evidence checks, not fixture reruns.

## Evidence source catalog

- **D**: [development execution record](SIM9_ELECTROSTATIC_DEVELOPMENT_STATUS.md),
  first through tenth increments; retains earlier limited findings.
- **A**: [contract/reference fixture](../scripts/test-sim9-electrostatic-foundation.mts),
  recorded PASS in D; 58 rejection cases.
- **O**: [parser/deck fixture](../scripts/test-sim9-electrostatic-provider.mts),
  recorded PASS in D; 27 negatives, plus authentic-output replays in the
  [real-provider fixture](../scripts/test-sim9-electrostatic-provider-real.mts).
- **L**: [controlled lifecycle fixture](../scripts/test-sim9-electrostatic-lifecycle.mts)
  and [real lifecycle fixture](../scripts/test-sim9-electrostatic-lifecycle-real.mts),
  recorded PASS in D; 41 controlled cases, real completion/active cancellation.
- **F**: [real refinement evidence](SIM9_ELECTROSTATIC_REFINEMENT_EVIDENCE.json);
  includes the rejected coarse plateau and distinct refinement/repeat records.
- **N0**, **N**, **H**, **R** are private host evidence identifiers, respectively:
  `docs/evidence/SIM9_ELECTROSTATIC_NATIVE_EXPORT_EVIDENCE.json`,
  `docs/evidence/SIM9_ELECTROSTATIC_NATIVE_SOURCE_REVALIDATION.json`,
  `docs/evidence/SIM9_ELECTROSTATIC_HOST_RECORD_REPLAY_EVIDENCE.json`,
  `docs/evidence/SIM9_ELECTROSTATIC_DURABLE_NATIVE_REPLAY_EVIDENCE.json`.
  Their bounded findings are summarized in D seventh through tenth increments.
  These are not public-repository links; no private CAD source, fixture,
  credentials, executable path or runtime artifacts are copied here.
- **S**: private `docs/evidence/SIM9_ELECTROSTATIC_APPROVED_DISPATCH_EVIDENCE.json`
  receiptClosure; actual native CAD/authenticated HTTP/real-provider/protected
  storage. One clean authorized solve; corrected final reporter and exit 0.
  Initial reporting failure preserved; no Chromium/hosted/process-restart claim.

## Complete matrix

Totals: **32 PASS / 3 FAIL / 2 PENDING**, 37 lanes.
Current implemented scope: **32 PASS / 0 FAIL**; two explicitly limited/future
lanes remain PENDING. All three FAIL rows are retained historical findings,
not renamed PASS or silently omitted.

| ID | Lane | State | Evidence / provenance | Bounded scope | Limitation |
| --- | --- | --- | --- | --- | --- |
| E01 | Electrical contract and units | **PASS** | D, A — controlled-fixture | Separate electrical types: V, F/m, V/m, C/m², C, F and J; one homogeneous isotropic slab. | Foundation bounds are admission bounds, not certified dielectric properties. |
| E02 | Parallel-plate analytical reference | **PASS** | D, A — analytical | 1 × 10 × 10 mm; epsilon_r=4; 0/100 V; linear V, uniform E/D, Q, C and energy. | Ideal complete electrodes; no fringing; gauge/polarity/zero-excitation/scaling checks are analytical. |
| E03 | Malformed/unsupported request rejection | **PASS** | D, A — controlled-fixture | 58 recorded invalid units, permittivity, ownership, duplicate/conflicting FACE, unsupported physics and digest cases. | No volume charge, nonlinear/multi-domain materials, exterior domain or coupling. |
| E04 | Real Gmsh/CalculiX solving | **PASS** | D, R — real-provider-backed + native-CAD | Native STEP, Gmsh 4.15.2, CalculiX 2.16, Node 24.18.0 Windows x64; 2 mm fixture 1267 nodes/590 DC3D10 elements. | One ideal slab; no cross-platform or arbitrary-geometry claim. |
| E05 | Nodal potential recovery | **PASS** | D, F, R — real-provider-backed | Complete ordered node fields and 0/25/50/~75/~100 V probes; refined max profile error 4.40665169066e-6 V <0.002 V. | Centerline probes use quadratic interpolation; no extrapolation. |
| E06 | Electric-field vector/magnitude recovery | **PASS** | D, F, R — real-provider-backed | Native scalar flux ×1000 yields E; E_x=-100000 V/m; refined magnitude min=max=100000 V/m. | Straight-sided affine quadratic tetrahedra only. |
| E07 | Electric displacement recovery | **PASS** | D, R — real-provider-backed + analytical | D=epsilon times recovered E; D_x=-3.54167512512e-6 C/m². | Derived constitutive quantity, not independent native electrical output. |
| E08 | Signed electrode-charge recovery | **PASS** | D, F, R — real-provider-backed | Native electrode reactions scaled by epsilon/1000; current Q=±3.5416751038699474e-10 C. | Conductor charge sign, not outward dielectric flux; complete opposing FACE sets required. |
| E09 | Capacitance recovery | **PASS** | D, F, R — real-provider-backed | Q/deltaV and recovered field give consistent C; current C=3.5416751038699474e-12 F. | Zero excitation is analytical/geometry-derived, not validated here as Q/0. |
| E10 | Electrostatic energy recovery | **PASS** | D, F, R — real-provider-backed | Quadrature of 0.5 E·D: current U=1.7708375625600002e-8 J. | Bounded affine slab fields; no coupling energy. |
| E11 | Charge conservation | **PASS** | F, R — real-provider-backed | Current net Q=0 C; refined maximum relative imbalance 3.99999941289e-9 <1e-4. | Summation/native printing precision; not exact conservation for every future geometry. |
| E12 | Field/charge/energy consistency | **PASS** | F, R — real-provider-backed + analytical | Current relative residual ~6e-9; refined maximum 5.99999942530e-8 <1e-4. | Small non-monotonic printed-data errors; no convergence-order claim. |
| E13 | Deterministic deck bytes | **PASS** | D, R — controlled-fixture + real-provider-backed | Repeated fixed request/mesh deck generation; current deck digest 3fa97ed9d1336786397cac7b028371cd175ade4276694545150417c5e2563132. | Different independently generated meshes need not give identical decks. |
| E14 | Deterministic result normalization/repeat | **PASS** | D, F, R — real-provider-backed | Same DAT normalized deterministically; 0.85 mm same-mesh native repeat has identical fields/raw/electrical digest; durable JSON/digest replay exact. | Not identical UUID/completion wrappers across runs; JSON maps -0 to 0; remeshing repeatability not claimed. |
| E15 | Malformed/tampered native-output rejection | **PASS** | D, O — controlled-fixture + real-provider-backed output tamper | 27 parser negatives, four authentic-output tamper replays and five lifecycle failure/data replays; missing/nonfinite/duplicate/wrong-FACE/inconsistent data reject. | Tampered real DAT is not a new physical failure solve. |
| E16 | Immutable lifecycle/completion binding | **PASS** | D, L, R — controlled-fixture + real-provider-backed | Exact job/request/revision/model/material/electrode/mesh/deck/runtime/native-status/output/result digests; no pre-completion result; clones isolate mutations. | Provider-only private host lifecycle, not registered approval/public authoring. |
| E17 | Cancellation and late-publication races | **PASS** | D, L — controlled-fixture + real-provider-backed | 41-case lifecycle evidence plus actual active native-output cancellation; queued cancellation avoids dispatch; late completion cannot publish. | Tiny solve may finish numerically before cancellation; no claim about a specific interrupted iteration. |
| E18 | Failure, cleanup and quarantine | **PASS** | D, L, H, R — controlled-fixture + real-provider-backed | Controlled failure/non-convergence/incomplete guards; unavailable executable failure; real success/cancel cleanup; sticky known-job quarantine. | No physically non-converged linear dielectric solve; cleanup_pending never qualifies as cleaned completion. |
| E19 | Distinct mesh-refinement/stability | **PASS** | D, F — real-provider-backed | 1/0.85/0.7 mm: 1889/905, 2602/1245, 3838/1829 nodes/elements; charge/C spread <1.070e-7; selected 0.85 mm numerical baseline repeated once. | Stable affine solution; native rounding is non-monotonic; no formal order. 2 mm integration baseline remains valid. |
| E20 | Live CAD/model/material/FACE source binding | **PASS** | D, N, H, R — controlled-fixture + native-CAD + real-provider-backed | Actual isolated Zustand/executor/material/semantic readers; before/after revision, unique body/domain/FACE, dielectric provenance and canonical geometry verified. | Private adapter; live application/user-facing workflow not exercised; durable record never overrides CAD truth. |
| E21 | Canonical native STEP/source identity | **PASS** | N, R — native-CAD + real-provider-backed | native-step-identity/0.1 stable digest 997f6a9d5dbd24427a13208eea991a5a03fed65d2292f8ec94aed271a946b5a9; geometry/context/provenance corruption rejects. | Normalize only valid FILE_NAME timestamp and one matching OCCT 7.6 PRODUCT ID/name counter; all other bytes remain bound. |
| E22 | Unique-edge/FACE topology semantics | **PASS** | N, R — native-CAD | Native TopExp indexed/ancestry maps: 12 unique edges versus 24 FACE uses; six quadrilateral incidences and adjacency bind semantic FACEs. | Legacy occurrence count is not renamed or divided by an assumed factor; genuine topology/FACE changes reject. |
| E23 | Persistent result ledger/completion pins | **PASS** | D, H, R — controlled-fixture + real-provider-backed | Exclusive/fsynced result blobs, independent completion pins, nested digests, successful/clean native completion and bounded reads. | Protected host trust, not cryptographic protection against compromise of both roots; no crash-recovery campaign claim. |
| E24 | Protected host storage configuration | **PASS** | H, R — controlled-fixture + real Windows ACL checks | Fixed separate role directories; configuration pins, directory identities, exact DACL/effective file ACL checks; no automatic repair. | Windows-only; host owner/SYSTEM/Administrators trusted; opt-in, no production root installed. |
| E25 | Durable study/domain/material/FACE/mesh records | **PASS** | H, R — controlled-fixture + native-CAD + real-provider-backed | Study/source pins bind full sealed request, body/domain/FACEs/material, canonical geometry, validated mesh, deck/runtime and config. | Bounded 16-study/16 MiB records; no caller proof import; source publication uses live trusted readers. |
| E26 | Authenticated native/provider durable completion | **PASS** | R — native-CAD + real-provider-backed | One actual native slab source and completed/cleaned provider result captured and persisted through existing guards. | Final successful run had one solve; two real solves in that increment because the first assertion distinguished -0/0. |
| E27 | Restart/replay with fresh source rebinding | **PASS** | R — native-CAD + real-provider-backed | Lifecycle/capture discarded; new readers/runtime/ledger load pins and re-export live CAD; exact JSON bytes/electrical/result digests unchanged; new lifecycle has no old job. | Same-process reconstructed instances; replay does not remesh or solve; not a separate OS restart. |
| E28 | Stale/tampered/cancelled/failed replay rejection | **PASS** | H, R — controlled-fixture + native-CAD + real-provider-backed archive | 30 host cases and nine combined cases; source/record/config/mesh/deck/runtime mismatch, altered result, failed/cancelled completion and quarantine reject. | Failure-state archives are explicit faults, not new cancellation/failure physics; only own-fixture markers reset between independent negatives. |
| E29 | Legacy raw-byte record fail-closed handling | **PASS** | H, N, R — controlled-fixture + native-CAD | Old/unknown identity versions reject; no silent rehash, replacement, migration or rebinding of old completions. | Earlier 68-case raw-byte replay does not become canonical evidence; explicit new-version records required. |
| H01 | Raw STEP byte determinism | **FAIL** | N0, N, R — native-CAD | Historical/current repeated native exports have different raw hashes despite equivalent geometry. | Retained historical failed byte-determinism target; canonical identity PASS does not make raw bytes deterministic. |
| H02 | Old raw-byte source digest/authentic binding | **FAIL** | N0 — native-CAD | Old identity drift and 24-versus-12 edge semantics blocked authentic native source admission. | Historical policy failure; superseded by E21/E22/R under new identity, not upgraded or relabelled. |
| H03 | Preliminary coarse 'refinement' plateau | **FAIL** | F — real-provider-backed | 3/2/1.5 mm produced identical 1267-node/590-element meshes; rejected as distinct refinement evidence. | Historical matrix remains FAIL; later distinct 1/0.85/0.7 mm stability is E19 PASS. |
| P01 | Browser/MCP authoring, approval and provider admission | **PASS** | D, S — 29 approval cases; 13 controlled HTTP/storage cases; one clean native/real-provider approved-dispatch receipt | Preparation, browser controller + separate Bridge callback, fresh canonical transfer, real solve, cleaned/persisted completion, exact fresh-source replay, dispatch pin, mesh/result reporter and exit 0. | Single slab, host opt-in, summary only. Initial reporter failure retained as history. No Chromium/interactive two-human/hosted/process-restart proof; no promotion. |
| P02 | Electrical field paging/visualization | **PASS** | T — controlled provider output, authenticated HTTP/protected storage and actual isolated Chromium/Three.js viewer | Three separate electrical datasets; 1–128 triangles/page, ordered static frame, chunk/full digests and truthful extrema. Potential/E/D contours, electrical legends/probes, clipping and domain visibility pass; 18 transport negatives and 11 viewer tamper cases. | Surface-only. Potential nodal; E/D average four integration-point vectors per element, not nodal. No new real solve, hosted UI or glyph proof. Charge/C/total energy stay summaries. |
| P03 | Production bootstrap and separate OS-process restart | **PASS** | V — one native-CAD/real-provider completion, actual producer exit and fresh executable, real Windows protected ACLs | Explicit new-root provisioning, deterministic same-root reopen, cold numerical/three-field replay, fresh native source and runtime/mesh/deck/result binding; 13 stale/tamper/completion/storage cases pass. | Windows owning-host production-style scope only; no hosted browser restart/service install/reboot. One fixture DACL restore failure retained; one replay-only retry PASS, no extra solve. |
| P04 | Physically non-converged dielectric solve | **PENDING** | Analytical applicability assessment below; D, L retain separate controlled failure evidence | Not demonstrated for the current well-posed linear scope. Positive constant permittivity, connected slab, complete nonconflicting prescribed-potential electrodes and insulated lateral boundaries give a unique linear solution; no relevant physical non-convergence mechanism identified. | Not PASS or silently N/A. Finite-precision/conditioning failure is possible, but no admissible representative case is established. Do not manufacture failure, corrupt solver settings or broaden physics. |
| P05 | Formal independent review / qualified engineering-use scope | **PENDING** | D — future promotion gate | No engineer review/certification or formally approved engineering-use scope is recorded. | Future intentional qualified promotion only; not a blocker for continued development or later public-beta consideration. |

## Interpretation and evidence freshness

Raw STEP remains nondeterministic. N0 is the failed old byte-bound source
policy, not successful canonical admission. N proves stable trusted canonical
identity by normalizing ONLY a valid FILE_NAME timestamp and the one matching
OCCT 7.6 PRODUCT ID/name counter; actual geometry, all other serialization
content, revision/body/domain/FACEs and unique topology remain bound.
H/R require the explicit new version and reject old records. No silent
rehash, migration or old-record promotion occurs.

Earlier controlled raw-byte source/persistence checks (34/68 cases) are
historical evidence for unchanged semantics only, not new-version replay
proof. Current canonical live-source/durable replay claims use N (24 cases),
H (30 cases) and R (nine rejection cases and real completion/replay).
Their earlier PENDING combined gate is resolved by R, not by rewriting
historical files. N's canonical-source implementation remains unchanged.
The old exact host-record fingerprint in R is superseded by the additive
protected request/study lookup's V fingerprints and cold-replay checks.
H's lack of an independent file-fingerprint list remains explicit.
No physics/provider/recovery assumption, stored schema or tolerance changed.

Numerical refinement is stable, not formally ordered: 1/0.85/0.7 mm gave
1889/905, 2602/1245, 3838/1829 nodes/elements. Maximum potential error
4.40665169066e-6 V; charge/C relative spread ~1.069e-7;
maximum relative charge imbalance ~4e-9 and energy residual ~6e-8.
Native printing/summation explains non-monotonic small errors.
The 0.85 mm repeat reused the same immutable mesh. The 2 mm integration
fixture remains valid; regenerated meshes can have different counts, so
cross-remeshing byte identity is not claimed.

R's fixed revision is
`929304aba7bd6652a9e95cd71d4e051059dc845acc658d2778c70bf339094844`;
canonical digest is
`sha256:997f6a9d5dbd24427a13208eea991a5a03fed65d2292f8ec94aed271a946b5a9`.
Its normalized electrical root is
`sha256:13b65286c09e12391604a8f3da7b2efc6856f361a97f6f19cb14d63f53f76270`.
Current capacitance is 3.5416751038699474e-12 F, field energy
1.7708375625600002e-8 J, net charge zero and relative energy residual ~6e-9.

R's initial startup stopped before a solve (Node strip-only parameter-property
loading); a single transform-types fallback succeeded. The first real run's
strict JS assertion distinguished -0/0; only the fixture changed to the
existing exact JSON/digest semantics. The same fixture passed on rerun:
two real solves in that increment, not one total. This historical
test-comparison failure did not change electrical normalization or physics.
New-file checks passed but outside-file transitive type diagnostics remain;
no full-project build/type-check success is inferred.

## Readiness, remaining work and next bounded item

No additional numerical or native validation is required **merely to
consolidate** this matrix. The implemented bounded provider/source/replay
scope is ready for consideration of a separately defined internal-validation
scope, not automatically promoted. Bounded approved dispatch, field/viewer,
explicit host provisioning and separate-process replay now pass. Any release
still needs intentional status/scope selection and applicable hosted checks;
no hosted verification or release/status promotion is inferred.
R's same-process reconstructed replay was not an OS restart test; V proves
actual process exit/cold replay. V retains authenticated protected records
but does not claim installed production service storage.

Current single-slab admission is host opt-in, after both approvals and fresh
source verification. Protected records authenticate the approved transfer,
never override browser CAD truth. No broader scope/status promotion occurs.
Approved-dispatch receipt gate is closed by S: 1267 nodes / 590 DC3D10 elements
at 2 mm; Gmsh 4.15.2 / CalculiX 2.16. Potential max error 2.84217e-14 V,
electrode charge ±3.5416751038699474e-10 C, net zero, capacitance
3.5416751038699474e-12 F, field energy 1.7708375625600002e-8 J;
charge/C error and field-charge energy residual ~6e-9 relative. Protected
source/result/pins and exact live-source replay passed; canonical digest stable.
Only this receipt rerun occurred. No implementation or existing evidence changed.
Electrical field paging/visualization is closed by T for the existing bounded
slab only. The next gate was P03, subsequently closed by V below.

**T — electrical field increment, 2026-09-28:** private evidence identifier
`docs/evidence/SIM9_ELECTROSTATIC_FIELDS_VIEWER_EVIDENCE.json`.
The focused field command passed actual authenticated Bridge/protected-storage
transport and fresh-source invalidation, then rendered captured controlled
provider fields in the actual isolated Three.js/WebGL viewer. 27 nodes /
6 quadratic tetrahedra, 48 surface triangles/dataset, seven pages at limit 7.
Potential 0–100 V, E magnitude 100000 V/m, D magnitude 3.54167512512e-6 C/m^2;
E/D vectors point negative X. Separate electrical schemas, static frame 0,
sealed identities, maximum 128/page and 64000 total, ordering/digest/range/unit
validation. No new physics/recovery/source-policy/persistence-schema change.
Earlier numerical/native/replay evidence remains current in its recorded
scope; new transport/viewer evidence does not claim another real solver run.
Matrix now has **31 PASS / 3 historical FAIL / 3 PENDING** (37 lanes).
The original raw-byte failures remain historical, not relabelled PASS.

**V — protected host/process restart, 2026-09-28:** private evidence identifier
`docs/evidence/SIM9_ELECTROSTATIC_PROCESS_RESTART_EVIDENCE.json` and
[owning-host provisioning](ELECTROSTATIC_HOST_PROVISIONING.md).
One actual native 2 mm / 1267-node / 590-DC3D10 slab completion was required:
older temporary archives were removed, and summary receipts are not proof.
Producer PID 1420 exited 0; fresh PID 10212, with no lifecycle job, reopened
protected records and an independent CAD document in actual native stores.
Canonical source/result/field digests remained identical. Three fresh
authenticated first-page checks and full 14-page local integrity assemblies
per 1792-triangle dataset passed; no HTTP/browser replay claim.
Thirteen stale/source/mesh/result/cancelled/failed/quarantine/configuration/
missing-storage/unapproved-ACL/inaccessible-storage cases pass.
Actual denied ReadData was restored only in this fixture's own file DACL.
Initial fixture ACL restore requested unnecessary audit privilege and failed;
one DACL-only corrected replay retry passed, without any solver rerun.
Original record schemas/source version/protection policy remain unchanged;
legacy raw-byte records are not migrated. No numerical evidence became stale.
Matrix now **32 PASS / 3 historical FAIL / 2 PENDING**.
At that increment P04 remained pending applicability assessment; the assessment
below retains it PENDING without adding a solve. P05 remains future intentional
formal qualification, not normal development priority.

## P04 applicability assessment — 2026-09-28

**PENDING / not demonstrated for the current well-posed linear scope.**
This is a scientific applicability assessment, not a solver execution receipt.
No tests, native exports, solves, numerical refinements or runtime changes were
needed. The five scope categories below must not be conflated.

For the actual connected rectangular slab, the equation is
`div(epsilon grad(phi)) = 0` with finite constant `epsilon > 0`.
The complete opposing electrodes prescribe `phi`; the four lateral faces
have zero normal displacement. The explicit solution
`phi(x) = V_left + (V_right - V_left) x/L` satisfies all conditions.
For the difference `w` of two solutions, integration by parts gives
`integral_Omega epsilon |grad(w)|^2 dV = 0`: w vanishes on electrodes and
has homogeneous lateral flux. Thus grad(w)=0, and connectedness plus
nonempty Dirichlet boundaries imply w=0. The potential gauge is fixed even
when both prescribed voltages are equal. There is no unrestrained pure-Neumann
nullspace or nonlinear constitutive/coupling instability in this scope.

On a valid connected conforming mesh with these essential constraints, the
corresponding constrained scalar stiffness is positive definite. This is
NOT a guarantee that finite-precision implementations can never fail.
Poor conditioning, floating-point limits, solver defects or inadequate
numerical resolution can cause numerical failure despite continuum
well-posedness. No representative accepted mesh/request with unchanged
provider settings is currently evidenced to exhibit such failure.
The contract's declared ranges are admission limits, not proof of numerical
robustness for every possible extreme aspect ratio.

The installed provider deck fixes internal scalar conductivity to 1 and
uses the steady scalar analogy, recovering electrical quantities separately.
Physical permittivity is constant; its magnitude scales D/Q/energy rather
than introducing nonlinear feedback or material contrast. Generic intermediate
CalculiX iteration messages saying no convergence followed by a valid completed
final step are not terminal physical non-convergence evidence.

| Category | Interpretation / existing evidence | P04 physical proof? |
| --- | --- | --- |
| Genuine numerical/physical non-convergence | No physical mechanism identified for this admitted linear slab; numerical stagnation/breakdown is possible in principle but no relevant accepted case is demonstrated. E19 records stability of actual solved meshes, not a negative solve. | No; retain PENDING. |
| Invalid input before solving | E03 / A: 58 recorded malformed/unsupported contract cases; source/topology/material/FACE and mesh guards reject invalid data. Conflicting electrodes, missing reference potential, nonpositive epsilon, degenerate/disconnected meshes are not valid scope extensions. | No; pre-solve rejection. |
| Provider/runtime failure or cancellation | E17/E18 / L: unavailable executable, controlled failed outcomes, active native cancellation, cleanup and late-publication races. Resource termination is not physical divergence. | No; lifecycle/runtime safety. |
| Malformed/incomplete output or stale persisted result | E15/E18/E28 and P02/P03: parser/native-final-step guards, authentic-output tamper replays, digest/source checks, cancelled/failed archive fault injections and sticky quarantine. | No; output/completion/source integrity. |
| Deliberately corrupted solver configuration | Removing electrodes, changing deck coefficients, forcing insufficient iterations or corrupting a mesh to cause an error would alter valid problem/configuration or manufacture failure. None is proposed or run. | No; artificial configuration fault. |

The controlled lifecycle case labelled non-convergence injects a failed
outcome flag; it verifies rejection and cleanup only. Existing 41 controlled
cases, actual cancellation/unavailable-runtime evidence, parser/tamper cases
and 13 cold-replay rejection cases keep their original provenance.
None is relabelled a physical non-converged solve.

Reference formulation: [MFEM/LLNL boundary-condition documentation](https://mfem.org/fem_bc/)
describes the diffusion weak form, essential Dirichlet and natural zero-flux
boundaries; [MFEM finite-element tutorial](https://mfem.org/tutorial/fem/)
describes the scalar Poisson/potential discretization. The uniqueness argument
and its applicability to this exact admitted slab are derived above, not a
claim that MFEM tested TunaCAD or qualified CalculiX.
Implementation anchors: `simulation-bridge/electrostaticContract.mts`,
`providers/calculix/CalculiXElectrostaticSlab.mts` and
`CalculiXElectrostaticExecution.mts`; no implementation changed.

All existing numerical/source/persistence/paging evidence remains current.
Matrix stays **32 PASS / 3 historical FAIL / 2 PENDING**.
No further actionable bounded electrostatic implementation gate is identified
before future P05 in the currently recorded scope: P01–P03 pass, P04 stays an
explicit undemonstrated scope limitation rather than an artificial development
blocker. This does not declare release, arbitrary-geometry validation or formal
qualification complete. P05 is future intentional qualification only; retain
`proof_of_concept` and `engineeringUsePermitted: false`.

Independent engineering review is a future intentional `qualified`
engineering-use promotion gate, not a mandatory next development or
public-beta step. New validation is warranted only for uncovered physics,
changed implementation/runtime versions, changed assumptions/tolerances,
or an observed hosted/reference discrepancy. Status remains
`proof_of_concept`, `engineeringUsePermitted: false`.
