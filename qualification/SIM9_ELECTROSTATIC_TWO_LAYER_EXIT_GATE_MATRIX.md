# SIM-9 two-layer electrostatics: bounded evidence and provider-admission gate

Recorded 2026-09-29; A01/native CAD-path evidence updated 2026-10-13. Capability status: `proof_of_concept`;
`engineeringUsePermitted: false`. Private exact-scope host-only provider
admission is exercised; browser/MCP public execution admission remains closed. This
matrix is separate from the single-domain P01–P04 matrix.
It assesses only two constant-permittivity homogeneous linear isotropic
dielectric slabs in series, one trusted planar conformal interface, two
opposing prescribed-potential electrodes, insulated sides and zero free
charge. No floating conductor, nonlinear dielectric, nonconformal tie,
fringing/open-domain treatment or thermal/mechanical coupling is admitted.

Evidence abbreviations:

- **F**: `scripts/test-sim9-electrostatic-two-layer-foundation.mts` contract
  and analytical test.
- **N**: focused TunaCAD native-CAD / Gmsh 4.15.2 / CalculiX 2.16 fixture
  receipts recorded in
  [development status](SIM9_ELECTROSTATIC_TWO_LAYER_DEVELOPMENT_STATUS.md).
  The private fixture source is not copied into this public repository.
- **L**: focused provider-only immutable lifecycle fixture and
  `scripts/test-electrostatic-two-layer-lifecycle.mts`.
- **R**: distinct 2.0/1.5/1.0 mm refinement receipt and one 1.0 mm repeat,
  numerically tabulated in development status.
- **D**: authenticated 1.0 mm protected host-record/completion replay
  receipt and focused no-solver rejection cases in development status.
- **H**: new private TunaCAD live-document preparation receipt: one native
  CAD/Gmsh mesh, protected study pin, fresh-source replay and focused
  no-solver source/placement/material/FACE/domain rejections.
- **A**: focused no-solver private host admission tests: controlled freshly
  resealed identity comparisons, protected receipt persistence/tamper,
  missing-study/unprotected-storage no-dispatch and provenance rejection.
  The separately recorded authenticated admitted solve is **A-real**.
- **A-real**: one native live-CAD → protected host preparation → fresh private
  admission → Gmsh 4.15.2 / CalculiX 2.16 completion → durable fresh-source
  replay fixture, with no-solver stale/tamper/failure/cancellation checks.
- **C**: inspected current provider/Bridge contracts:
  `simulation-bridge/electrostaticTwoLayerAdmission.mts`,
  `electrostaticTwoLayerHostRecords.mts`, `requestValidation.mts` and
  `server.mts`. Inspection is not a new runtime test.
- **J**: 2026-10-13 actual CAD-authored 3/2 mm two-dielectric case: one
  authorized fragment mesh and solve, authenticated original-root completion,
  fresh host recovery, six field datasets and real Chrome viewer checks.
  `scripts/verify-electrostatic-two-layer-a01.mts` injected a deck-only fault
  after authentic reads, without rewriting/resealing protected evidence.
  The separate technical approval gates used a controlled integration fixture,
  not real human-interactive approval. See the dated development-status receipt.

| Gate | State | Evidence | Bounded result / limitation |
| --- | --- | --- | --- |
| T01 Strict two-layer electrical contract and units | PASS | F | Exactly two ordered rectangular layers, ε in F/m, V/E/D/Q/C/U electrical units; unsupported keys and physics rejected. |
| T02 Analytical series-capacitor reference | PASS | F | Piecewise-linear V, 66.667/33.333 V drops, −166667/−55556 V/m E, continuous D, ±2.9513959376e-10 C Q, 2.9513959376 pF C, 1.4756979688e-8 J U. |
| S01 Trusted live CAD, two domain/body identities and material provenance | PASS | N, D, H, J | Both current bodies/revision/material assignments independently reread; H/J derive preparation from the live TunaCAD document rather than a fixture request. Public execution remains closed. |
| S02 Canonical geometry/source identity | PASS | N, D | Both native STEP digests recomputed; substituted geometry and stale revisions rejected. Raw STEP-byte identity is not substituted for canonical identity. |
| S03 Electrode and interface FACE ownership | PASS | F, N, D | Correct outer electrodes and opposing xMax/xMin interface; live FACE remapping rejected. Declaration alone is insufficient. |
| M01 Independently meshed/nonconformal domains rejected | PASS | N | Separate meshes failed shared quadratic topology; shifted interface mesh fails closed. This is rejection evidence, not support for nonconformal transfer. |
| M02 Trusted conformal BooleanFragments mesh | PASS | N, R, D | Exact shared node/facet ownership and full 100 mm² interface verified at every accepted mesh. |
| P01 Real two-domain CalculiX solve | PASS | N, R, D | Per-domain ε/ε₀ material cards; quota-limited native completion and cleanup at bounded mesh sizes. |
| P02 Per-domain voltage drop and E vector/magnitude | PASS | F, N, R | Two-domain provider values agree with series-capacitor reference; transverse mean E negligible. |
| P03 Normal D continuity | PASS | N, R | Maximum recorded mean normal-D jump 1.991e-20 C/m² over accepted mesh levels. |
| P04 Signed electrode charge conservation | PASS | N, R | Opposite charges; largest normalized net imbalance 1.20e-9 of analytical charge. |
| P05 Equivalent capacitance | PASS | F, N, R | Charge/voltage C; maximum recorded relative error 1.10e-8. |
| P06 Electrostatic energy | PASS | F, N, R | Field and charge-energy identities; maximum field/charge residual 2.11e-7 relative. |
| P07 Deterministic deck and normalized result | PASS | N, R | Repeated deck generation and same-output normalization; 1.0 mm independent repeat has identical normalized result digest. |
| L01 Immutable cleaned completion/result lifecycle | PASS | L, D | Job, sealed request, both source/material/FACE identities, mesh/interface, deck/runtime and normalized result pinned before retrieval. |
| L02 Cancellation, failure, malformed-output and cleanup quarantine | PASS | L, D | Queued/active cancellation, late completion, controlled failure, truncated/wrong native output and unconfirmed cleanup expose no completed result. Physical non-convergence is not claimed. |
| N01 Distinct bounded mesh stability | PASS | R | 2.0/1.5/1.0 mm: 779/1498/2956 nodes, 406/797/1641 elements; stable electrical quantities, no formal convergence order claimed. |
| N02 Selected 1.0 mm repeatability | PASS | R | Same normalized electrical result digest on one repeat; no broader repeatability distribution claimed. |
| D01 Protected host-owned study/mesh records | PASS | D | Content-addressed sealed study and validated 1.0 mm meshes, separate completion ledger/pins. Initial capture came from a fixture-owned reader. |
| D02 Fresh live-source and interface replay | PASS | D | New host reader/lifecycle reload and recompute CAD, canonical sources, 533 shared nodes/246 facets/100 mm² interface, mesh, deck, runtime and result. |
| D03 Stale source/material/FACE/geometry/runtime/mesh rejection | PASS | D | Focused no-solver mutated-source and shifted-mesh checks reject. |
| D04 Tampered host record/result rejection | PASS | D | Altered host interface record and result digest rejected; result quarantine remains sticky after restoring bytes. |
| D05 Failed/cancelled completion rejection | PASS | L, D | Controlled failure and queued/active cancellation remain distinct from cleaned success and expose no result. |
| D06 Sticky quarantine | PASS | L, D | Once quarantined, restored mesh/result bytes do not make the same job retrievable. |
| A01 Direct deck-digest tamper injection | PASS | J | Original-root completion/pin authenticated and source freshly rebound. Only the in-memory completed binding's deck digest was changed, without resealing any digest. The same inner validator used by lifecycle completion/retrieval rejected specifically with `completion deck digest mismatch`, before aggregate checks. Original ledger/pin bytes stayed identical and the original remained retrievable and unquarantined. This is post-authentication in-memory fault evidence, not destructive on-disk tampering or human-interactive approval. |
| A02 Live host-owned two-domain preparation/capture | PASS | H | Private TunaCAD adapter reads the current two-Part tree, semantic FACEs, material assignments, revision and assembly transforms; native canonical STEP verification and one OCC BooleanFragments 1.0 mm mesh precede the protected study pin. Fresh-source replay passed. 2,956 nodes, 1,641 elements, 533 matched interface nodes, 246 shared facets, 100 mm². No CalculiX solve was run for this capture gate. |
| A03 Exact-scope two-layer provider admission | PASS | A, A-real, C | One authenticated `host-live-two-layer` study passed protected receipt/replay, fresh live source and mesh/deck/runtime rebinds, private admission, existing CalculiX lifecycle, validated cleaned completion and fresh-source durable replay. No browser/MCP/Bridge public route exists. |
| X01 Unsupported electrical physics | NOT APPLICABLE | F, C | Free charge, floating conductors, nonlinearity, nonconformal transfer, open domain, fringing and coupling are excluded, not failed qualification lanes. |
| X02 Browser/MCP/public authoring | NOT APPLICABLE | C, J | Outside this provider-only matrix. Private CAD authoring/preparation and technical gates are covered separately; public two-layer submission/result attachment remains closed. |
| H01 Independent-domain meshing as a conformal provider path (historical) | FAIL | N | The first separate-mesh attempt did not share exact interface topology and was rejected. It is not an admitted current path. |
| H02 First durable-record receipt (historical) | FAIL | D | One solve completed but post-solve adapter lacked required reader methods. Corrected adapter plus one later approved solve passed durable replay. Historical failure retained. |

**Totals:** 27 PASS, 2 historical FAIL, 0 PENDING,
2 NOT APPLICABLE. Active capability gates excluding historical findings:
27 PASS, 0 FAIL, 0 PENDING, 2 NOT APPLICABLE.

## Provider-admission decision

**Private exact-scope gate PASS; public admission closed.** Numerical,
interface, lifecycle and replay evidence support the strict host-only entrypoint,
and one authenticated admitted dispatch/result has now passed.
The earlier durable completion began with fixture-owned sealed-request and
local-mesh capture; A02 now proves a separate live host-owned preparation
path with one native CAD/Gmsh mesh, protected record pin and fresh replay.
The new protected live-preparation receipt distinguishes this path from
fixture-owned capture. Admission independently reloads the study pin and
record, recomposes the conformal mesh, rereads current native CAD sources,
checks both material/FACE bindings and runtime, and then uses the existing
lifecycle for another dispatch-time rebind and all quarantine rules. The
existing public Bridge electrical execution transport is still single-domain;
the separately implemented two-layer authorization descriptor cannot submit.
No execution request validation, server routing, CLI approval, public
provider capability, result status or `providerAdmission: 'closed'` value
has changed.

The 2026-10-13 authenticated completed-record injection closes A01 only in its
explicit post-read, in-memory deck-fault scope. It does not open public routing,
waive either approval gate, or establish real human-interactive approval.
Next bounded item: deliberate source-bound two-layer submission/result attachment
integration and admission review. Public exposure remains separately closed.

The focused A-real fixture ran exactly one real provider solve. Existing
analytical, mesh-refinement, lifecycle and durable evidence remains current.
No status promotion or engineering-use permission is inferred.

## Subsequent bounded authoring/presentation work (historical checkpoint)

At this historical checkpoint, a strict choices-only contract accepted ordered domain IDs, owned external
electrode and interface FACE IDs, and two distinct potentials in V. It
rejects caller-supplied mesh, deck, canonical digest, provider request and
unsupported physics. The existing host preparer validates these choices
against its independently read live inventory and uses the selected
voltages before sealing; the legacy 0/100 V private fixture remains
unchanged. A private field builder now produces six domain-owned electrical
datasets from an authenticated two-domain completion and verified conformal
mesh. It reuses the existing bounded pages, chunk/full digests, nodal
potential and explicitly element-averaged E/D semantics. Controlled no-solver
authoring and paging tests pass. This is **development evidence, not a new
exit-gate PASS** at that checkpoint: browser/MCP-to-protected-host preparation
transport and authenticated two-domain field-page retrieval had not yet been
exercised, and A01 was PENDING. The later evidence J and A01 closure below
supersede those pending findings. Public two-domain submission/result attachment
remains closed.

## A01 diagnostic preparation (2026-10-13; not gate closure)

The completion lifecycle now calls the same extracted inner validator with a
distinct deck-digest comparison before aggregate binding/result checks. Protected
storage, original completion-pin authentication, fresh source/mesh/deck/runtime
rebinding, all aggregate checks and sticky quarantine remain mandatory and
unchanged. This inner validator is not authentication or a public admission API.

`scripts/verify-electrostatic-two-layer-a01.mts` provides a read-only audit for an
authentic, unquarantined completion in its original protected root. It first
authenticates the original ledger/pin and freshly binds the source, then changes
only the deck digest of an in-memory snapshot. It requires the specific deck
rejection, revalidates the untouched original and checks that original ledger/pin
bytes remain identical. No record is moved, rewritten, resealed or unquarantined.

At the preparation checkpoint, focused synthetic metadata tests passed for distinct deck rejection, existing
aggregate/cleanup/Preview checks and pre-source rejection of unauthenticated or
quarantined audit inputs. They are **not native completion evidence**. The audit
had not yet been exercised on an authentic completion of the new CAD-authored
case. A01 was **PENDING** at that checkpoint; unit tests alone did not close it.

## A01 evidence closure (2026-10-13)

Evidence J now exercises that audit against the authentic, unquarantined native
completion in its unchanged protected root. The audit authenticated ledger digest
`sha256:49ac2da0faa2fbd9aa960896f802b21466b4f0029edc75f162080e365cc0a2ee`
and original deck digest
`sha256:40f094f89140dbd8788391e9763065ff3124a82720e6b1d79d3a3b091d614cef`.
The deck-only in-memory fault reached the exact comparison, produced the expected
specific rejection, and left protected bytes and original retrieval unchanged.
The audit ran zero native processes and resealed zero records. A01 is **PASS**;
current totals above are updated, historical failures/reference evidence remain,
and public execution stays closed. No engineering-use promotion is inferred.
