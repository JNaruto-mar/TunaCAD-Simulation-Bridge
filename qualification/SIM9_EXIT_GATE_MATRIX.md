# SIM-9 transient-thermal capability evidence matrix

Recorded 2026-09-26 from existing focused evidence; no solver, browser,
or historical matrix was rerun for this consolidation. This is a
development/qualification-readiness record, **not** a promotion decision.
Status remains `proof_of_concept` and `engineeringUsePermitted: false`.

## Evaluated capability and evidence boundary

One 100 × 10 × 10 mm, single-domain isotropic slab: constant conductivity
50 W/(m·K), density 7800 kg/m³, specific heat 500 J/(kg·K), initial and
fixed-face temperature 20 °C, 10,000 W/m² inward step flux on the opposite
FACE, insulated remaining faces, and requested frames at 100/400/1200 s.
Recorded real-provider evidence is Windows x64, Gmsh 4.15.2, CalculiX
2.16. The primary mesh has 468 nodes/209 DC3D10 elements; convergence
also uses 635/266 and 821/350. PASS below means only that the stated
bounded fixture met its recorded gate. It does **not** imply arbitrary
transient geometries, loads, materials, runtime versions, or engineering
use are validated.

Source key: [development record](SIM9_DEVELOPMENT_STATUS.md);
[contract/analytical fixture](../scripts/test-sim9-transient-thermal-contract.mts);
[real solver, frame, field, and lifecycle fixture](../scripts/test-sim9-transient-thermal-real.mts);
[convergence fixture](../scripts/test-sim9-transient-convergence-real.mts).
The TunaCAD-private integration evidence is in
`scripts/test-sim9-transient-authoring.mts` and
`scripts/test-sim9-transient-viewer.mjs` in the TunaCAD repository;
those fixtures are not copied into this public Bridge repository.

## Bounded development lanes

| Lane | State | Existing evidence and acceptance | Scope / limitation |
| --- | --- | --- | --- |
| Request and contract validation | **PASS** | Contract fixture and authoring fixture accept the exact bounded request and reject invalid time grids, nonpositive heat capacity, incompatible initial/fixed temperature, unsupported loads/materials/domains, and mixed-unit requests. | One constant-property domain, one inward flux FACE, one fixed-temperature FACE; 1–16 increasing output times ending at duration. |
| Analytical transient reference | **PASS** | Contract fixture's Fourier-series slab gives tip 28.08012970/35.42601595/39.63588577 °C, fixed-face reaction -0.09657221/-0.64076654/-0.97140254 W, and stored energy 97.51574463/276.43701698/380.95970966 J at 100/400/1200 s. Independent 400 s applied-plus-reacted versus storage-rate discrepancy is 7.89e-11 W. | One-dimensional ideal slab with constant properties and insulated sides; analytical values are not provider observations. |
| Real CalculiX transient solve | **PASS** | Real fixture generates a byte-deterministic DC3D10 transient deck and completes the 468-node/209-element slab on Gmsh 4.15.2 / CalculiX 2.16; tip errors are -0.10231/-0.09060/-0.02206 °C, each within 0.5 °C. | Provider-only base solve; not a general transient-solver or hosted-run claim. |
| Complete NT/HFL/RFL frame recovery | **PASS** | Real fixture requires ordered, unique, complete NT, HFL, and RFL at each requested time; rejects missing, extra, reordered, duplicate, wrong-set, non-finite, and truncated frames before normalization. | Three output times and one mesh/request. HFL is recovered as element-mean magnitude for contours, not a vector field. |
| Stored-energy recovery and heat-flow comparison | **PASS** | C3D10 volume quadrature over complete nodal NT yields provider stored energy 96.41879/274.18959/380.41218 J (errors -1.09695/-2.24743/-0.54753 J; each ≤8 J). Reaction errors are -0.004771/+0.007131/+0.001735 W (each ≤0.08 W). At 400 s provider applied-plus-reacted power differs from the analytical storage rate by 0.00713086 W (≤0.08 W). | The 400 s energy-rate comparison uses an analytical derivative, not a provider-derived instantaneous storage derivative. |
| Time-step convergence | **PASS** | Convergence fixture refines maximum increment 20 → 10 → 5 s on the 10 mm mesh. Three-frame tip-error norm contracts 0.275542 → 0.138425 → 0.069349 °C; reaction-error norm 0.0170319 → 0.0087535 → 0.0044248 W; energy-error norm 5.06279 → 2.56008 → 1.28766 J. | Only this slab, three output times, and the stated increment sequence. |
| Mesh stability | **PASS** | At 5 s maximum increment, 10 → 8 → 6 mm gives 468/209 → 635/266 → 821/350 nodes/elements. Printed tip values are stable; fine-pair reaction and energy changes are 0.00003121 W and 0.00008407 J as three-frame norms, each <1% of the corresponding fine time-step change. | Stable spatial plateau for a one-dimensional fixture, **not** a measured monotonic spatial-error order or curved/multi-domain evidence. |
| Deterministic repeatability | **PASS** | Real fixture repeats the 10 mm request/mesh with identical normalized history and deck bytes. Convergence fixture repeats the 6 mm/5 s baseline with identical complete normalized frames; field fixture re-reads pages with stable chunk digests. | Same host, executable versions, request, and meshes; cross-platform/compiler repeatability untested. |
| Cancellation, non-convergence, quarantine, cleanup | **PASS** | Lifecycle fixture observes a completed 100 s partial NT/HFL/RFL frame, then actively cancels or deliberately exhausts `INC=6` before the remaining requested frames. Status remains cancelled or failed, never succeeded; result and field retrieval stay quarantined, including after a late-exit interval; each solver directory is removed. | Two deliberate failure paths on the slab; not an exhaustive OS-failure or arbitrary non-convergence matrix. |
| MCP/browser authoring and approvals | **PASS** | Authoring fixture exercises preparation, request admission, revision binding, browser approval, independent Bridge host approval before STEP transfer, stale-host-approval rejection, cancellation, and malformed-result quarantine. | Focused mock-provider/Bridge authoring fixture; it is **not** a single live hosted real-provider approval-to-viewer run. |
| Per-frame thermal field pagination | **PASS** | Real field fixture returns six ordered datasets (temperature and HFL magnitude per frame), 672 triangles each, requested-time descriptors, 17-triangle test pages within the 128-triangle provider maximum, deterministic page re-reads, and chunk/full-dataset SHA-256 checks. | Surface triangle soup; nodal NT and element-mean HFL magnitude, no vector glyphs or volume slices. |
| Frame identity and tamper rejection | **PASS** | Field/result checks reject missing or reordered dataset IDs and altered chunks. Browser fixture rejects missing, duplicate, reordered, cross-frame, malformed, chunk-digest, and dataset-digest pages; tampered data leaves no contour/legend. | Tested against the six-dataset slab payload; no claim about arbitrary external provider implementations. |
| Browser temperature and heat-flux visualization | **PASS** | Focused Chromium fixture renders the *real provider payload* at 100/400/1200 s; displayed temperature maxima 27.9778/35.3354/39.6138 °C differ from analytical tips by at most 0.1023 °C. It checks frame switching, both contours, numerical legends, °C and W/m² probes, clipping, domain visibility, and absence of structural stress/displacement options. | Local fixture mounts the production viewer; it does not prove a deployed tunacad.com flow. |

No bounded development lane is recorded FAIL or PENDING. These PASS
results remain deliberately narrow.

## Promotion and deployment gates

| Gate | State | Exact remaining evidence / decision |
| --- | --- | --- |
| Version-bound immutable evidence | **PENDING** | SIM-9 implementation and fixture files are still uncommitted in both repositories. Bind selected outputs, tolerances, warnings, executable/runtime versions and digests to published Bridge/TunaCAD revisions before declaring an internally validated release scope. This documentation consolidation does not require a solver rerun. |
| Integrated real-provider application path | **PENDING** | Focused evidence separately covers real provider output, browser/MCP approvals, and real-result viewer rendering. A single current TunaCAD application run from authored study through both approvals, solver, result retrieval, frame paging, and viewer has not been recorded. Use only when preparing a release candidate; do not infer it from component fixtures. |
| Hosted public-beta comparison | **PENDING** | No deployed SIM-9 tutorial or tunacad.com run has been compared with the reference values. This gate applies only if public-beta deployment is proposed. |
| Independent engineering review / formal engineering use | **PENDING (dormant)** | Not required for continued development, tutorials, internal-validation consideration, or public beta. Activate only for an intentional, separately scoped `independently_reviewed` or `qualified` promotion. |

The bounded slab has enough current automated development evidence to be
**considered** for a later `internally_validated` / `public_beta` scope,
but this matrix does not grant either status. First define and freeze
that scope and assemble immutable version-bound evidence; perform the
integrated/hosted checks only when pursuing the corresponding release.
No additional historical solver fixture is needed merely to complete
this matrix. Unsupported transient breadth includes multiple domains,
nonmatching interfaces, contact, temperature-dependent properties,
volumetric heat sources, alternate thermal boundaries or load histories,
nonuniform initial temperature, vector heat-flux visualization, and
other SIM-9 analyses (dynamics, harmonic, fatigue, optimization).
