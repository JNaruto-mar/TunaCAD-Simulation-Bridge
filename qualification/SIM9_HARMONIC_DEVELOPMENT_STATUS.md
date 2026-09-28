# SIM-9 harmonic-response development status

Capability-specific PASS/FAIL/PENDING consolidation is in the
[harmonic evidence matrix](SIM9_HARMONIC_EXIT_GATE_MATRIX.md).

Status: `proof_of_concept`, bounded one-frequency CalculiX provider;
`engineeringUsePermitted: false`. This is a separate lane from
implicit transient dynamics. It does not change the established
transient dynamics or transient-thermal solver paths.

## Exact bounded request scope

One connected 3D solid, one isotropic linear-elastic material with
positive density, one fixed FACE, one separate nonzero surface-force
FACE interpreted as a peak cosine-force vector, no interactions,
small displacement, no damping, and one frequency in
[0.001, 1,000,000] Hz. Force phase is exactly zero radians.
Harmonic steady state has no initial conditions; the request records
`initialConditions: "not_applicable"` and seconds as the time unit.
The only requested result tokens are displacement amplitude,
displacement phase, and reaction-force amplitude.

The strict request schema and cross-field validation reject frequency
arrays/sweeps, zero/negative/nonfinite/out-of-range frequencies,
other excitation phases, damping fields or assumptions, initial
displacement/velocity, plastic/nonlinear materials, multiple
domains/materials/loads/constraints, thermal properties, unsupported
load or restraint types, overlapping FACE roles, and incomplete
result-token sets. Provider admission requires an explicit harmonic
profile. A C3D10 CalculiX 2.16 provider and bounded browser/MCP
authoring are available only within the narrower 1–22 kHz provider
envelope described below; the wider request-contract range alone
does not imply provider admission.

## Axial SDOF analytical reference

The reference reuses the 100 mm by 100 mm2 axial bar and trial mode
`u(x)=q*x/L`. It is an exact one-coordinate Galerkin result, not
an exact continuum or 3D finite-element result. With
`E=200000 MPa`, `rho=7800 kg/m3`, and peak force `F0=100 N`:

- `k=EA/L=200000 N/mm`;
- `m=rho*A*L/3=0.026 kg=0.000026 N s2/mm`;
- `fn=sqrt(k/m)/(2*pi)=13958.811915 Hz`;
- static displacement `F0/k=0.0005 mm`.

For `F(t)=F0*cos(2*pi*f*t)`, the undamped steady response is
`q(t)=U*cos(2*pi*f*t-phi)`, where
`U=F0/abs(k-m*(2*pi*f)^2)`. Below `fn`, `phi=0`;
above `fn`, `phi=pi`. The generalized fixed-support reaction is
`R=-k*q`: its amplitude is `k*U` and its phase is opposite to
the displacement. At exact undamped resonance the dynamic
stiffness of this reduced-order model is zero, so that model has
no finite steady-state amplitude or phase. Its natural frequency
is not the exact continuum/3D eigenfrequency; the provider instead
rejects excitation within 0.5% of a recovered undamped FE mode.

| Frequency / fn | Frequency Hz | Displacement amplitude mm | Displacement phase lag rad | Reaction amplitude N |
|---:|---:|---:|---:|---:|
| 0.5 | 6979.405958 | 0.000666667 | 0 | 133.333333 |
| 0.9 | 12562.930724 | 0.002631579 | 0 | 526.315789 |
| 1.0 | 13958.811915 | singular; no finite value | undefined | singular |
| 1.1 | 15354.693107 | 0.002380952 | pi | 476.190476 |
| 1.5 | 20938.217873 | 0.000400000 | pi | 80.000000 |

Focused contract evidence: `npm run test:sim9-harmonic-contract` passes
sealing/validation, 27 malformed/unsupported request cases,
provider-profile admission checks, displacement/reaction amplitude
and phase checks, and singular-resonance classification.

## Bounded real-provider evidence

The initial provider emitted deterministic C3D10 decks with a
`*FREQUENCY,SOLVER=ARPACK,STORAGE=YES` step (48 modes), followed by
`*STEADY STATE DYNAMICS,HARMONIC=YES` at one distinct frequency.
CalculiX requires two equal frequency-card endpoints; its
`*NODE PRINT` output contains one real and one imaginary U/RF block.
Normalization retains complex loaded-FACE mean displacement and
support reaction, their vector amplitudes, and phase lags relative
to the cosine force. Missing, duplicate, reordered, nonfinite,
extra-frequency, near-modal-resonance, and out-of-modal-coverage
outputs fail closed. No partial result is published by the existing
provider lifecycle.

The 100 x 10 x 10 mm bar uses E=200000 MPa, nu=0.3, rho=7800
kg/m3, 100 N peak load, one fixed end, and a 468-node/209-C3D10
Gmsh 4.15.2 mesh. Quantitative comparison uses the 1D axial-wave
continuum reference `U=(F*L/(E*A))*tan(omega*L/c)/(omega*L/c)` and
`R=-F/cos(omega*L/c)`, `c=sqrt(E/rho)`. The earlier one-coordinate
SDOF reference remains an analytical phase/resonance teaching
fixture, not a high-frequency 3D mesh acceptance oracle.

| Hz | Expected signed U mm | CalculiX U mm | U error | Expected signed R N | CalculiX R N | R error | U/R phase lag |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 7000 | 0.000680373 | 0.000659833 | 3.02% | -154.820 | -158.417 | 2.32% | 0 / pi |
| 20000 | -0.000156347 | -0.000174926 | 11.88% | 126.577 | 123.263 | 2.62% | pi / 0 |

Focused `test-sim9-harmonic-real.mts` passes two frequencies, a
repeat solve at each, byte-deterministic deck generation, normalized
result repeatability, and malformed complex-data rejection. The
public-bridge TypeScript no-emit check passes. Historical SIM-2
through SIM-9 qualification suites were not rerun. Earlier
numerical evidence is unchanged: the harmonic branch is additive
and static/transient branches are not modified.

## Modal, mesh, and frequency convergence (bounded SIM-9 increment)

The focused `test:sim9-harmonic-convergence-real` matrix keeps the
100 x 10 x 10 mm bar, material, fixed/loaded FACEs, 100 N cosine
amplitude, and undamped formulation unchanged. It varies only
the C3D10 mesh size, number of retained ARPACK modes, or one
requested frequency per solve. At the time of that diagnostic,
the provider requested 48 modes; mode-count substitutions were
test-only deck variants, not a frequency sweep.
All runs use Gmsh 4.15.2 / CalculiX 2.16.

Mesh levels: 10 mm (468 nodes/209 elements), 7.5 mm (726/309),
and 5 mm (999/434). At fixed 10 mm, the modal levels were
24/48/72 at 7 and 20 kHz; diagnostics extended to 96 at both
frequencies and 144/192 at 20 kHz. At fixed 48 modes, 7 and
20 kHz were each solved on all three meshes. Fixed 10 mm/48
mode frequency checks were 6.5/7/7.5 and 19/20/21 kHz. Every
frequency was a separate single-frequency solve, not a sweep.

| Mesh mm / modes | Hz | Axial U amplitude mm | U phase | Support R amplitude N | R phase |
|---|---:|---:|---:|---:|---:|
| 10 / 24 | 7000 | 0.000641544 | 0 | 164.530 | pi |
| 10 / 48 (provider) | 7000 | 0.000659833 | 0 | 158.417 | pi |
| 10 / 72 | 7000 | 0.000663163 | 0 | 153.317 | pi |
| 10 / 96 | 7000 | 0.000664362 | 0 | 156.245 | pi |
| 5 / 192 (diagnostic) | 7000 | 0.000669356 | 0 | 154.594 | pi |
| 10 / 24 | 20000 | 0.000193829 | pi | 116.600 | 0 |
| 10 / 48 (provider) | 20000 | 0.000174926 | pi | 123.263 | 0 |
| 10 / 72 | 20000 | 0.000171565 | pi | 128.418 | 0 |
| 10 / 96 | 20000 | 0.000170359 | pi | 125.474 | 0 |
| 10 / 144 | 20000 | 0.000165484 | pi | 127.911 | 0 |
| 10 / 192 | 20000 | 0.000164735 | pi | 127.621 | 0 |
| 5 / 192 (diagnostic) | 20000 | 0.000165708 | pi | 127.044 | 0 |

The analytical 1D axial-wave reference is 0.000680373 mm /
154.820 N at 7 kHz (phase 0/pi), and 0.000156347 mm /
126.577 N at 20 kHz (phase pi/0). The selected **diagnostic**
baseline is 5 mm/192 modes: displacement/reaction differences
are 1.62%/0.15% at 7 kHz and 5.99%/0.37% at 20 kHz. The
20 kHz 144-to-192 correction on that mesh is 0.11% in
displacement and 0.18% in reaction; the 10-to-5 mm mesh
difference at 192 modes is 0.59%/0.45%. The selected baseline
repeated bit-for-bit at 20 kHz, and the 10 mm/48-mode provider
result also repeated bit-for-bit. All phases matched the reference.

At 48 modes, mesh refinement from 10 to 5 mm changes 20 kHz
displacement by only 0.55%, whereas raising the 10 mm deck
from 48 to 192 modes changes it by 5.83%. Therefore retained
mode count is the main *tested numerical* source of the 48-mode
provider's 11.88% 20 kHz reference difference; mesh resolution
is secondary. The residual 5.99% difference of the diagnostic
baseline from the idealized 1D formula is not explained by these
refinements; 3D/Poisson behavior and frequency placement toward
the 1D antiresonance are plausible but not separately proven.
At 10 mm/48 modes the response stays smooth with correct phases:
the displacement reference error is 3.08/3.02/2.96% at
6.5/7/7.5 kHz and 9.14/11.88/15.88% at 19/20/21 kHz.

Historical evidence gate: **PASS** for bounded mesh/frequency trend,
high-mode diagnostic stabilization, phase, and repeatability;
**FAIL** for treating the former fixed 48-mode production
provider as modal-truncation-converged at 20 kHz. The 5 mm/192
mode setting is evidence only, not an automatically promoted
provider default or an engineering qualification. That historical
FAIL led to the resource-bounded policy and focused revalidation
recorded below. This lane remains
`proof_of_concept` with `engineeringUsePermitted: false`.
Previous SIM-2 through SIM-9 numerical evidence is not stale:
no provider runtime or shared physics implementation changed.

Reproduce with explicit `TUNACAD_GMSH_EXECUTABLE` and
`TUNACAD_CALCULIX_EXECUTABLE`: run
`npm run test:sim9-harmonic-convergence-real` for the bounded
15-solve matrix; run the same script with
`SIM9_HARMONIC_EXTRA=1`, `2`, `3`, and `4` for the incremental
96/144/192-mode diagnostics and selected-baseline repeat.
These are focused real solves, not part of a broad historical
suite.

## Resource-bounded provider mode policy

The provider no longer uses 48 modes for every frequency. For the
currently bounded provider envelope, 1–8 kHz selects 96 modes and
above 8–22 kHz selects 192 modes. Other frequencies fail admission;
the broader request-contract range above does not imply provider
support. The meshed model must have at most 2,000 nodes and 1,000
volume elements, with enough nodal degrees of freedom for the
selected eigenmodes. The existing Windows process limits remain
120 s CPU and 1 GiB memory, with the Bridge's other artifact and
result-size bounds unchanged. These bounds prevent selecting a
larger mode count simply to force convergence.

The provider checks the actual recovered eigenfrequency table before
publishing a harmonic result: it must contain exactly the requested
mode count in deterministic nondecreasing order, bracket the
excitation, extend to at least twice the excitation frequency, and
have no recovered mode within 0.5% of that undamped excitation.
Missing, truncated, unordered, insufficient-coverage, or near-modal
resonance histories fail closed under the existing result quarantine.
The ratio criterion is a coverage guard, not proof of convergence at
every frequency inside the envelope. Frequency-specific validation
is presently limited to the recorded 7 and 20 kHz axial-bar points.

Focused Gmsh 4.15.2 / CalculiX 2.16 revalidation used the same
468-node/209-C3D10 100 × 10 × 10 mm bar and repeated each selected
provider solve. Signed real components are shown; imaginary parts
were near zero and displacement/reaction phases remained 0/pi at
7 kHz and pi/0 at 20 kHz.

| Hz | Selected modes | 1D-wave U mm | Provider U mm | U error | 1D-wave R N | Provider R N | R error | Previous 48-mode U/R error |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 7000 | 96 | 0.000680373 | 0.000664362 | 2.35% | -154.820 | -156.245 | 0.92% | 3.02% / 2.32% |
| 20000 | 192 | -0.000156347 | -0.000164735 | 5.37% | 126.577 | 127.621 | 0.82% | 11.88% / 2.62% |

`npm run test:sim9-harmonic-mode-policy` PASS covers deterministic
selection, admission, resource caps, modal coverage and fail-closed
rejection. `npm run test:sim9-harmonic-real` PASS covers deterministic
deck bytes, two actual frequencies, repeated normalized results,
amplitude/phase comparisons, and malformed complex-data rejection.
The Bridge no-emit TypeScript check passes. The previous fixed
48-mode **FAIL is resolved for these two bounded provider fixtures**;
the mode-policy and selected-frequency gate is **PASS**, not a
general-frequency or formal engineering qualification. The old
48-mode numbers remain historical reference evidence, not current
provider output. The lane stays `proof_of_concept` with
`engineeringUsePermitted: false`; no SIM-2–SIM-9 shared physics
or numerical evidence was changed.

## Bounded browser/MCP authoring and approval

The v2 MCP preparation shape now accepts only one positive-density
isotropic linear-elastic solid, one fixed FACE, one separate FACE
with a nonzero peak cosine-force vector, zero force phase, no
initial conditions, and one provider-admitted 1–22 kHz frequency.
The user-requested mesh caps cannot exceed 2,000 nodes or 1,000
volume elements. Preparation and job creation retain revision and
provider-admission guards. The browser confirms frequency, force
vector/amplitude, FACE roles, material/density, selected 96/192
mode count, and coverage/resource limits before STEP transfer;
the local Bridge terminal still requires separate approval.

The focused no-solver harmonic authoring fixture passes strict MCP
rejection, request-contract validation, no geometry export before
approval, Bridge-host approval, stale-revision rejection, cancellation,
provider modal-coverage failure quarantine, and missing-coverage
result rejection. Browser approval labels are checked against current
UI source and the UI passes TypeScript checking; this increment does
not claim an interactive Chromium run. Provider deck, eigenfrequency
recovery, and numerical results are unchanged from the preceding
policy increment. No earlier real-solver evidence became stale.
Harmonic response remains `proof_of_concept`,
`engineeringUsePermitted: false`, without damping, sweeps,
multi-domain physics, or harmonic contour pages.
