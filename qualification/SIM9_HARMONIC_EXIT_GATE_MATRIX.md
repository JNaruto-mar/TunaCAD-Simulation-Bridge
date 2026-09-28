# SIM-9 harmonic-response capability evidence matrix

Recorded 2026-09-27 from existing focused evidence. No solver, convergence,
browser, or historical suite was rerun for consolidation. This is not a
promotion: `proof_of_concept` and `engineeringUsePermitted: false` remain.

## Scope and evidence sources

The current provider admits one connected positive-density isotropic elastic
solid, one fixed FACE, a separate nonzero peak cosine-force FACE, zero
excitation phase, no initial conditions, undamped small-displacement motion,
and one 1–22 kHz frequency. The request contract's wider
0.001–1,000,000 Hz range does not imply provider support. The mode policy
selects 96 modes through 8 kHz and 192 above 8 kHz, caps the mesh at
2,000 nodes/1,000 elements, and requires recovered modes to bracket the
excitation and extend to 2× frequency while excluding a mode within 0.5%.
Existing Windows caps are 120 s CPU and 1 GiB memory.

Real numerical evidence uses a 100 × 10 × 10 mm bar, E = 200,000 MPa,
nu = 0.3, density = 7,800 kg/m³, 100 N peak load, Gmsh 4.15.2, and
CalculiX 2.16. The 10 mm mesh has 468 nodes/209 C3D10 elements;
diagnostics also used 7.5 mm (726/309) and 5 mm (999/434). Only
7 and 20 kHz were revalidated under the current selected policy.

Sources: [development record](SIM9_HARMONIC_DEVELOPMENT_STATUS.md),
[contract/SDOF test](../scripts/test-sim9-harmonic-contract.mts),
[real-provider test](../scripts/test-sim9-harmonic-real.mts),
[convergence diagnostic](../scripts/test-sim9-harmonic-convergence-real.mts),
and [mode-policy test](../scripts/test-sim9-harmonic-mode-policy.mts).
The private TunaCAD integration fixture is
`scripts/test-sim9-harmonic-authoring.mts` in the parent repository; it is
not copied into the public Bridge.

## Development evidence lanes

| Lane | State | Existing evidence | Scope and limitation |
| --- | --- | --- | --- |
| Request/contract validation | **PASS** | Contract test seals and validates the one-frequency request, rejects 27 malformed/unsupported variants, and checks provider admission. Authoring test rejects out-of-envelope frequency, phase/initial-condition changes, missing density, wrong load/support, overlapping FACEs, extra domain, and oversized mesh intent. | Contract range is broader than provider admission; no damping, sweep, multi-domain or nonlinear harmonic physics. |
| Analytical SDOF reference | **PASS** | One-coordinate Galerkin bar: k = 200,000 N/mm, m = 0.026 kg, fn = 13,958.811915 Hz, static U = 0.0005 mm. Contract test checks amplitude/phase below and above fn and singular ideal resonance. | Reduced-order foundation, not the 3D acceptance oracle. Real comparisons use the 1D axial-wave continuum formula. |
| Real single-frequency provider | **PASS** | Real test checks deterministic C3D10 deck, selected ARPACK count, one frequency card, and successful Gmsh/CalculiX 7/20 kHz solves. Current signed U/R: +0.000664362 mm / -156.245 N at 7 kHz; -0.000164735 mm / +127.621 N at 20 kHz. | One bar and 10 mm mesh on recorded Windows/provider versions; no hosted-run claim. |
| Complex U/R amplitude and phase | **PASS** | Parser recovers ordered real/imaginary U and RF blocks; normalization checks amplitude and phase. Imaginary components are near zero; U/R phases are 0/pi at 7 kHz and pi/0 at 20 kHz. 1D-wave U/R errors are 2.35%/0.92% and 5.37%/0.82%. | Summary vectors only, not harmonic contour/stress pages. |
| Deterministic repeatability | **PASS** | Real test repeats both selected provider solves with identical normalized harmonic data and deck bytes; earlier fine-mesh/192-mode 20 kHz diagnostic also repeated exactly. | Same host, versions, request, and mesh; cross-platform repeatability untested. |
| Malformed/incomplete complex-result rejection | **PASS** | Focused parser/result tests reject missing/duplicate real or imaginary blocks, wrong node/set/frequency, NaN, truncation, extra output, missing modal count, and missing/NaN normalized fields. | Targeted cases, not a fuzz campaign. |
| Modal-truncation diagnostic | **PASS** | Historical diagnostic varied 24/48/72/96 modes and extended to 144/192 at 20 kHz. Fine-mesh 20 kHz 144→192 corrections were 0.11% U and 0.18% R; phases remained stable. | Numerical stabilization for this bar, not all admitted frequencies. |
| Mesh/frequency stability | **PASS** | Recorded 10/7.5/5 mm meshes and 6.5/7/7.5 plus 19/20/21 kHz separate-frequency runs showed smooth trends. At 192 modes, 10→5 mm 20 kHz U/R changes were 0.59%/0.45%. | Frequency-neighborhood runs used the former diagnostic setting, not a general envelope proof. |
| Former fixed-48-mode policy | **FAIL — historical** | 10 mm/48-mode 20 kHz U differed 11.88% from the axial-wave reference. Raising to 192 modes changed U by 5.83%, whereas 48-mode mesh refinement changed it only 0.55%. | Preserved failure of the former production setting, not the current 96/192 provider. |
| Current bounded 96/192 policy | **PASS — 7/20 kHz** | Policy test checks deterministic tiers, frequency/mesh/DOF caps, 120 s CPU/1 GiB memory capability, and overstated/insufficient profile rejection. Real reruns improve former 48-mode U/R errors 3.02%/2.32% → 2.35%/0.92% at 7 kHz and 11.88%/2.62% → 5.37%/0.82% at 20 kHz. | Resolves the historical FAIL for two bar fixtures; 192 is not a global default. |
| Coverage/resonance fail-closed | **PASS** | Policy/parser tests require the exact selected modal count, positive ordered eigenfrequencies bracketing excitation, maximum ≥2× excitation, and no mode within 0.5%. Missing, unordered, under-covered, near-resonant, or out-of-envelope cases reject. | Safety/coverage guard, not a general truncation-error bound. |
| MCP/browser authoring and approval | **PASS — focused fixture** | Private fixture parses strict MCP input, prepares exact request, checks UI approval fields and no STEP transfer before separate local Bridge host approval. UI shows frequency, force, material/density, selected modes, mesh/CPU/memory limits, and coverage rule. | Mock-provider/Bridge lifecycle, UI source assertions and TypeScript check; no interactive Chromium run. |
| Revision, cancellation, quarantine | **PASS — focused fixture** | Pre-dispatch cancellation and stale revision (including during Bridge host approval) prevent STEP transfer. Provider coverage failure yields no completed result; succeeded mock result missing coverage evidence is rejected. Provider/parser quarantine incomplete complex output. | Focused paths, not exhaustive OS-failure testing. |
| Interactive browser approval rendering | **PENDING** | JSX/approval data compile and required labels are checked, but no interactive Chromium confirmation was recorded. | Relevant for a later internal-validation/public-beta release candidate, not required to consolidate existing evidence. |
| General-frequency/shape convergence | **PENDING** | Selected policy was revalidated only at 7/20 kHz on one bar; 2× modal coverage alone does not prove accuracy for every 1–22 kHz frequency or other geometry. | Narrow the release scope or obtain representative evidence if seeking broader internal validation. |

The current selected-policy gate is bounded **PASS** and the 48-mode
**FAIL** remains historical. The PENDING development lanes prevent
claiming that the entire admitted envelope or interactive UI is already
internally validated. No new check was required solely for this matrix.

## Later release and promotion gates

| Gate | State | Exact remaining evidence or decision |
| --- | --- | --- |
| Immutable version-bound evidence | **PENDING** | Harmonic implementation, fixtures, and parent submodule pointer remain uncommitted. Bind outputs, tolerances, warnings, and executable/runtime versions to published Bridge/TunaCAD revisions before an internally validated release claim; no solver rerun is intrinsically needed for documentation. |
| Integrated real-provider application path | **PENDING** | Real solver and mock two-stage approvals are evidenced separately. A single authored-study → browser/Bridge approvals → real solver → result-summary flow has not been recorded. Perform only for a release candidate. |
| Hosted public-beta comparison | **PENDING** | No tunacad.com harmonic run has been compared with reference values. Applies only if public beta is proposed. |
| Independent review/formal engineering use | **PENDING (dormant)** | Not mandatory for development or public-beta consideration; activate only for intentional independently reviewed/qualified engineering-use promotion. |

The bounded harmonic scope is ready for **later internal-validation/public-beta
consideration**, but this matrix grants neither status. Freeze a defensible
release scope (the recorded 7/20 kHz bar is narrower than the full 1–22 kHz
admission range), then close release-specific gates. Historical solver or
browser suites need not run merely because this matrix was created.
