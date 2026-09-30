# SIM-9 two-layer electrostatics: bounded evidence and provider-admission gate

Recorded 2026-09-29. Capability status: `proof_of_concept`;
`engineeringUsePermitted: false`. Private exact-scope host-only provider
admission is exercised; browser/MCP and public admission remain closed. This
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

| Gate | State | Evidence | Bounded result / limitation |
| --- | --- | --- | --- |
| T01 Strict two-layer electrical contract and units | PASS | F | Exactly two ordered rectangular layers, ε in F/m, V/E/D/Q/C/U electrical units; unsupported keys and physics rejected. |
| T02 Analytical series-capacitor reference | PASS | F | Piecewise-linear V, 66.667/33.333 V drops, −166667/−55556 V/m E, continuous D, ±2.9513959376e-10 C Q, 2.9513959376 pF C, 1.4756979688e-8 J U. |
| S01 Trusted live CAD, two domain/body identities and material provenance | PASS | N, D, H | Both current bodies/revision/material assignments independently reread; H derives the preparation from the live TunaCAD document rather than a fixture request. Browser/MCP authoring remains closed. |
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
| A01 Direct deck-digest tamper injection | PENDING / not demonstrated | C | The later automated two-gate fixture retained an authentic completion, but its protected storage is bound to an absolute root, directory identities, ACL configuration digest, content-addressed study, preparation receipt, and completion pin. A separate copy cannot be replayed without resealing those trusted records; mutating the original is forbidden. The lifecycle currently checks aggregate source/binding digests before any distinct deck-specific comparison, so a copied-and-resealed synthetic completion would not demonstrate rejection specifically at deck comparison. No test-only production completion was fabricated and no solver was rerun. Existing deck rebinding remains covered by D02/A03, but the stricter direct A01 injection is unproved. |
| A02 Live host-owned two-domain preparation/capture | PASS | H | Private TunaCAD adapter reads the current two-Part tree, semantic FACEs, material assignments, revision and assembly transforms; native canonical STEP verification and one OCC BooleanFragments 1.0 mm mesh precede the protected study pin. Fresh-source replay passed. 2,956 nodes, 1,641 elements, 533 matched interface nodes, 246 shared facets, 100 mm². No CalculiX solve was run for this capture gate. |
| A03 Exact-scope two-layer provider admission | PASS | A, A-real, C | One authenticated `host-live-two-layer` study passed protected receipt/replay, fresh live source and mesh/deck/runtime rebinds, private admission, existing CalculiX lifecycle, validated cleaned completion and fresh-source durable replay. No browser/MCP/Bridge public route exists. |
| X01 Unsupported electrical physics | NOT APPLICABLE | F, C | Free charge, floating conductors, nonlinearity, nonconformal transfer, open domain, fringing and coupling are excluded, not failed qualification lanes. |
| X02 Browser/MCP/public authoring | NOT APPLICABLE | C | Explicitly outside this provider-only review; remains closed. |
| H01 Independent-domain meshing as a conformal provider path (historical) | FAIL | N | The first separate-mesh attempt did not share exact interface topology and was rejected. It is not an admitted current path. |
| H02 First durable-record receipt (historical) | FAIL | D | One solve completed but post-solve adapter lacked required reader methods. Corrected adapter plus one later approved solve passed durable replay. Historical failure retained. |

**Totals:** 26 PASS, 2 historical FAIL, 1 PENDING / not demonstrated,
2 NOT APPLICABLE. Active capability gates excluding historical findings:
26 PASS, 0 FAIL, 1 PENDING, 2 NOT APPLICABLE.

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
existing public Bridge electrical transport and approval code is still
single-domain. No request validation, server routing, CLI approval, public
provider capability, result status or `providerAdmission: 'closed'` value
has changed.

Next bounded item: the remaining direct authenticated completed-record
deck-digest tamper check A01, if a meaningful no-solver retained-record
injection can be arranged; otherwise keep it PENDING. Browser/MCP/public
authoring and exposure remain separately closed. Controlled record-mismatch
tests do not substitute for completed-record deck-digest injection.

The focused A-real fixture ran exactly one real provider solve. Existing
analytical, mesh-refinement, lifecycle and durable evidence remains current.
No status promotion or engineering-use permission is inferred.

## Subsequent bounded authoring/presentation work

A strict choices-only contract now accepts ordered domain IDs, owned external
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
exit-gate PASS**: no browser/MCP-to-protected-host preparation transport or
approved two-domain user dispatch route exists yet, and no authenticated
two-domain field-page retrieval has been exercised. A01 stays PENDING;
matrix totals above remain unchanged. Browser/MCP/public admission remains
closed.
