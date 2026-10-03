# SIM-9 bounded explicit structural dynamics — development milestone

## Current milestone (2026-10-03): authentic 209-element private execution PASS

```ini
AUTHENTIC_209_NUMERICAL_EXECUTION = PASS
PROVIDER_EXECUTION_RESULT = succeeded
AXIAL_BAR_ORACLE_V2_RESULT = PASS
```

The bounded explicit-dynamics POC is development-complete for this one axial
bar and private Windows/OpenRadioss path. Status remains `proof_of_concept`,
`engineeringUsePermitted: false`, public/browser/MCP admission closed. This
summary supersedes the prospective current-209 PENDING statements below; it
does not rewrite historical failures or broaden the supported physics.

The authentic STEP-derived mesh has **88 nodes / 209 C3D4-compatible TETRA4**
elements, not the historical 208-element fixture. The model remains a
100 × 10 × 10 mm bar, E=200,000 MPa, ν=0.3, density=7.8e-9 Mg/mm³,
mass=0.078 kg, fixed opposite end and 100 N axial step load, zero initial
displacement/velocity, no damping/contact/plasticity/mass scaling/large
deformation/multi-domain physics. Run controls were 50 µs, 1 µs `/TFILE/4`,
plain `/DT/NODA 0.6 0`; the 20,000-increment cap and frozen oracle were unchanged.

### Consolidated bounded evidence

| Lane | Status | Evidence and limit |
| --- | --- | --- |
| Explicit contract, units and analytical foundation | PASS | Focused contract/reference evidence retained; one rectangular homogeneous elastic solid only. |
| Private native source, export and actual-mesh binding | PASS | Authenticated controlled native CAD owner; protected STEP/export and independently admitted 209-element mesh, freshly rebound before execution. Not arbitrary geometry evidence. |
| Separate approvals and single-use execution authority | PASS | Production consumers exercised with `controlled_test_fixture` approvals; no human-interactive claim or public route. |
| Runtime, provenance and Windows containment | PASS | Fresh full executable/runtime hashes; native suspended/atomic job assignment and seven-event telemetry; both owned trees complete. Historical controlled containment/cancellation evidence retained, not rerun. |
| Protected-storage/readiness budget enforcement | PASS | Fresh ACL/source/artifact checks and one-use native runtime evidence; TTL=300 s, total stage reserve=280 s, pre-Starter reserve=215 s unchanged. |
| Authentic Starter / Engine execution | PASS | Exactly one submission, accepted run, Starter and Engine; both OS exit codes 0 with normal termination. Linear one-point tetra: input 1000 / normalized part-review 0. |
| Direct TFILE/4 recovery and coverage | PASS | Authentic THICODE 3040, 15,024 bytes, 50 complete frames, 157 cycles; source-backed variable-cycle scheduling, no converter acceptance. |
| Frozen axial_bar_oracle_v2 | PASS | All 16 mandatory gates pass; the frozen oracle identity and tolerances were not retuned. Precursor amplitude is diagnostic only. |
| Durable capture, completion and fresh-source replay | PASS | Bounded protected records retained before normal scratch cleanup; finalized succeeded result, exact normalized-result replay, cleanup confirmed, not quarantined. |
| Cancellation/failure/sticky quarantine | PASS | Existing focused lifecycle and controlled failure evidence; failed historical attempts remain retired. The successful run is not a new cancellation study. |
| Real-human interactive approval | PENDING / not demonstrated | Controlled automated approvals only; optional separate UI smoke evidence, not a prerequisite for this bounded development milestone. |
| Arbitrary-geometry validation, mesh convergence and independent engineering qualification | PENDING / not demonstrated | Neither inferred from this run nor performed for consolidation. No promotion. |
| CalculiX 2.16 explicit structural provider | FAIL / unsupported | Retained source-grounded CFL/NaN diagnostics; unrelated validated CalculiX capabilities unchanged. |

### Portable evidence identities (raw records remain local, uncommitted)

- Study: `private-explicit-7afdbac1-20dc-4a50-a221-1b5369f8b4e4`.
- Export: `export-e0ad046a-4d54-4aa6-a293-5b95c61d0bb4`.
- Mesh: `gmsh-explicit-09e7ee71d908b1aa01b8f688`, artifact SHA-256
  `09e7ee71d908b1aa01b8f68860e86569de6a736f03830e90736077fcc506c17b`.
- Provider run: `9f1498a9-99ce-4d65-b251-b95b40437a78`.
- Authentic T01 SHA-256:
  `3e10d1343456f68679fe5897e7c9131c1d95fe609124160abbd93435bae11f0f`.
- Normalized result digest:
  `sha256:3684a7d2e720bfbe36bb18df6d3168fb80aa105817ffbf6c3be6f15e1db06d8c`.
- Frozen oracle digest:
  `sha256:15b463c1b5e3db282a191b6aa62e5c508470b46348e283e188cf161a84ec7b97`.
- Final receipt digest:
  `sha256:314bb80de92779ec37aced37fdd07d0189c57e4f518518cc667fa406de2f5f35`.

### Numerical summary (retained evaluation, not a new solve)

First/last history times: 0 / 49.1927385156 µs; first positive frame
1.2777336451 µs. Binary history timestep range
3.1943332601e-7–3.1943341128e-7 s. Coverage is complete under the frozen
eligible-cycle scheduler; an exact 50 µs frame is not required.

All 16 mandatory gates pass: finite state, zero initial conditions, wave
arrival, transit displacement, return displacement, plateau reaction, fixed
motion, energy balance, applied work, mass conservation, no added mass,
history coverage, provider provenance, reaction channel integrity, quiet
pre-P support and precursor mandatory integrity. Selected measurements:

| Quantity | Retained measured value |
| --- | --- |
| Arrival sample / error | 19.1660037672 µs / 0.5824138910 µs |
| Transit displacement / absolute error | 0.0005032197126 mm / 0.0000032197126 mm |
| Return displacement / absolute error | 0.0009582596734 mm / 0.0000417403266 mm |
| Support plateau median / in-band fraction | −201.3561363 N / 100% |
| Quiet pre-P interval maximum | 3.1743208 N (limit 10 N) |
| Fixed-node DX / VX / AX maxima | 0 / 0 / 0 |
| Maximum normalized energy / work residual | 0.0096418047 / 5.4001686e-8 |
| Mass / relative reference error | 0.0779999973 kg / 3.4590276e-8 |
| Added mass | No positive addition or temporal change; raw constant −5.4210109e-17 kg subtraction roundoff retained |

Result recovery is limited to axial-X histories at the ten monitored fixed/
loaded FACE nodes, not full-mesh vectors or contours. Raw support impulse in
N·s is retained; force is the deterministic forward/centered/backward dI/dt.
At the final frame, kinetic/internal/work energies are
0.0129032852 / 0.0603430159 / 0.0732962489 N·mm.

### Readiness corrections and historical evidence

Protected verification overhead was reduced without caching trust: reuse a
private native read-only interpreter, but reread the same ACL policy on every
request; full runtime hashing uses four bounded concurrent reads; host/provider
share only branded, one-use native evidence from the current boundary. Source,
artifact and executable freshness, approval separation, containment, durable
publication and stage ceilings remain required. No budget or TTL increased.
The successful run's cumulative source/runtime/storage times were
1.376 / 22.515 / 4.762 s, below their 25 / 25 / 15 s ceilings.

Historical deck serialization failures, truncated ASCII TFILE/3 recovery,
initially unsupported THICODE 3040, 208-element oracle/timestep findings,
CommonJS module-location failure, containment/provenance failures and source/
storage/headroom stopped attempts remain evidence at their original scopes.
They are not rewritten as numerical successes or reused authorities. Earlier
208 numerical evidence is not stale, but it never establishes this 209 mesh.
Shared storage implementation checks were refreshed during the overhead fix;
this does not claim rerun electrostatic or broader qualification matrices.

Consolidation rereads existing receipts and performs repository safety/targeted
syntax checks only. No mesher, solver, numerical revalidation, cancellation
study, Chromium or broad regression is required merely to consolidate. Any
future authoring/visualization extension or formal qualification remains a
separately scoped roadmap gate; this milestone opens neither admission nor
engineering use.

## Historical first increment (provider closed)

Status: proof_of_concept; engineeringUsePermitted: false. This is an
additive provider-closed specialist contract and analytical foundation.
It does not modify the implicit-dynamics path or its evidence.

## Contract and admission boundary

The contract admits one declared straight rectangular axial solid with
one fixed x-min FACE and a separate x-max FACE carrying a positive axial
step force from t=0. Its sole material is isotropic linear elastic with
positive density and provenance. Initial displacement and velocity are
zero. Motion is small-displacement and undamped, without contact or mass
scaling. Strict schemas reject extra physics and multi-domain data.
Units: mm, s, N, MPa, kg/m³, mm/s, mm/s² and N·mm. Two to sixteen strictly
ordered positive output times must end at duration (at most 0.01 s).
Future result quantities are axial displacement and support reaction,
kinetic energy, strain energy and applied work histories.

The declared mesh envelope names C3D4, at most 100,000 nodes and 50,000
elements. This is a request restriction, **not evidence that CalculiX 2.16
supports this formulation in explicit dynamics**. The integration
envelope has a declared minimum characteristic length, safety factor
at most 0.8 and at most 20,000 increments. Requested maximum time step
must not exceed safety × length / conservative dilatational wave speed,
and duration must fit the increment budget. Actual mesh length, provider
stability and resource use need later trusted provider verification.
The digest-sealed request is not yet live CAD/mesh/source verified.

Provider admission, deck generation, result recovery, browser/MCP
authoring and visualization remain closed. Existing v2 CalculiX
capabilities do not advertise explicit structural dynamics.

## Analytical reference

The fixed-free bar is 100 × 10 × 10 mm with E=200,000 MPa, ν=0.3,
ρ=7,800 kg/m³ and a 100 N axial step. Axial wave speed is
5,063,696.835 mm/s and transit time is 19.748418 µs. A conservative
dilatational-speed CFL estimate at declared 5 mm minimum length and
safety 0.8 gives Δt ≤ 0.680840 µs; the fixture requests half that bound.

The consistent-mass one-coordinate trial u(x)=x/L has k=200,000 N/mm,
m=0.026 kg, period=71.639335 µs, static displacement=0.0005 mm and
u(t)=(F/k)[1−cos(ωt)]. At quarter period, u=0.0005 mm, reaction=−100 N,
kinetic/strain energies=0.025/0.025 N·mm and work=0.05 N·mm. At half
period, u=0.001 mm, reaction=−200 N, kinetic energy≈0, strain energy
and work=0.1 N·mm. At one period, these return approximately to zero.
The reference verifies F+R=m a and kinetic+strain=applied work at every
sample. This reduced-order response is **not** an exact continuum wave
solution or a 3D explicit FE benchmark; no solver result is claimed.

## Focused validation

The focused no-solver contract/reference test passed. It checks
deterministic sealing/reference, values and balances, closed provider
admission and rejection of contact/impact histories, plasticity, mass
scaling, nonzero initial velocity, damping, large deformation, C3D10,
multi-domain input, invalid density, wrong FACE/material identity,
malformed times, unstable or over-budget time step and wrong units/results.
No Gmsh, CalculiX, browser or historical suite ran.

Next bounded increment: verify installed-provider explicit-step and
C3D4 feasibility and trusted actual-mesh CFL/resource admission before
opening a solver path. Do not infer provider support from this contract.

## Installed CalculiX 2.16 feasibility increment (2026-09-30)

The installed 2.16 manual (node288.html and node167.html) specifies
EXPLICIT=2 for structural explicit integration and DIRECT for a fixed
increment. Its third *DYNAMIC value is the minimum increment that can
trigger element mass redistribution; without that value, no mass scaling
is applied. The bounded probe deck used
*DYNAMIC, DIRECT, EXPLICIT=2, ALPHA=0 followed by exactly two values:
selected increment and duration. No minimum increment, mass-scaling card
or fallback to a quadratic element was emitted.

A provider-private actual-mesh gate now checks parsed Gmsh 4.15.2 C3D4
elements, positive Jacobians/volumes, uniqueness, boundary-facet
ownership, full fixed/load FACE areas, mesh/source identity, material
wave speed, a conservative minimum-tetra-altitude CFL limit and the
20,000-increment cap. The original solver header reported 88 nodes and
an **estimated element upper bound of 432**; the actual volume-element
count was not retained in that run. Its no-solver invalid-element, duplicate,
negative/degenerate, substituted source, missing FACE and insufficient
increment-budget checks passed before provider dispatch.

The **single approved CalculiX 2.16 explicit probe FAILed**. CalculiX
accepted and started the explicit step, reported material wave speed
5,875,097.0448 mm/s and its own Courant estimate 3.315458e-8 s,
but kinetic energy was NaN at time zero and the process exited 201
after reaching its increment limit. This is not a valid C3D4 transient
result or energy-recovery proof. The fixture checked that no
WarnElementMassScaled.nam file or mass-scaling warning appeared before
asserting the solver exit, so no mass scaling was observed. The
temporary mesh/deck/result directory was removed by fixture cleanup
even on failure; its actual minimum-altitude, selected increment and
increment count were not emitted before the solve and cannot now be
reported exactly. Do not infer those from the solver's Courant print.
No second Gmsh mesh or CalculiX solve was run.

Provider/browser/MCP admission remains closed and status remains
proof_of_concept with engineeringUsePermitted false. The next bounded
item is a no-solver diagnosis of the explicit time-zero NaN and a
failure-safe pre-dispatch/diagnostic receipt. Any corrected real solve
requires fresh explicit approval; do not treat the present probe as PASS.

## No-solver failure diagnosis and pre-dispatch receipt (2026-09-30)

No Gmsh or CalculiX process was run for this increment. The failed probe's
temporary deck, mesh, first-frame fields and full solver output were cleaned
before a receipt was written. Its exact minimum altitude, selected fixed
increment and actual expected increment count therefore cannot be recovered
from authenticated retained evidence. The source logic admitted only a
selected increment below its host CFL and an expected count at most 20,000;
that is a code-path bound, not a historical numerical receipt. The reported
CalculiX Courant value must not be substituted for the missing host value.
The probe duration was 1e-5 s and the deck step limit was the admitted count
plus two. Thus the later max-increment error is not explained by an obviously
over-budget host request, but its mechanism remains undetermined.

The first **observed** non-finite value is CalculiX's own time-zero kinetic
energy diagnostic; its internal-energy print was finite and tiny, and its
external-work print was zero. This is not a TunaCAD parsing or normalized
relative-error NaN. With no retained nodal U/V or first-increment state,
one cannot determine whether a physical nodal state, an energy accumulator,
or only solver reporting first became non-finite. Do not call this physical
instability or a solved transient. The installed 2.16 examples
`dyncubeexp.inp` and `beamexpdy1.inp` confirm explicit two-value data lines;
the manual permits structural `EXPLICIT=2` and fixed `DIRECT`. The bounded
deck uses `AMPLITUDE=STEP`, full fixed-face DOFs 1–3, separate 100 N
axial-load FACE and zero default initial state; it does not use the example
damping, amplitude smoothing or mass scaling. The installed `*EL PRINT`
manual defines `ELKE`/`ELSE` as whole-element kinetic/internal energies;
`ENER` is integration-point internal-energy density, not the same quantity.

The provider-private mesh gate now verifies every C3D4 has positive finite
volume and mass, every node receives positive finite lumped mass, all
elements are assigned to the single material section, and summed mesh mass
matches CAD volume × density within 1e-5 relative. For the 100 × 10 × 10 mm
bar at 7,800 kg/m³ the analytical mass is 0.078 kg. CalculiX's consistent
mm/N/s deck density is 7.8e-9 tonne/mm³; the test checks that conversion.
These are **new no-solver safeguards**, not retroactive measurements of the
cleaned 88-node/432-element mesh.

Before any future feasibility dispatch, the probe now writes a bounded
digest-sealed pre-dispatch receipt outside its solver scratch directory.
It records mesh counts/type, minimum altitude, volumes and nodal/total mass,
material, wave speeds, host CFL, selected and serialized fixed increment,
duration, admitted and serialized-deck expected increment counts, 20,000
cap, fixed/load FACE sets and force distribution, deck digest, exact
two-value `*DYNAMIC` line, no third minimum-increment value, and the
no-mass-scaling invariant. The receipt is emitted before launching CalculiX;
the normal solver-scratch cleanup remains unchanged. A bounded diagnostic
tail is also retained separately after solver exit. Focused synthetic-mesh
no-solver tests pass for valid mass/receipt and tampered step, density,
restraint, load and orphan-node rejection. Provider feasibility remains
**FAIL / not established**; no provider/browser/MCP admission is opened.

Next bounded item: only with fresh explicit approval, one short diagnostic
provider probe using the retained pre-dispatch receipt and first-frame U/V,
mass and energy diagnostics to isolate the NaN and increment-limit cause.

## One approved diagnostic solve (2026-09-30) — FAIL

Exactly one fresh Gmsh 4.15.2 mesh and one CalculiX 2.16 diagnostic solve
ran; no retry or other solver fixture ran. The isolated test evidence is in
the `tunacad-explicit-diagnostic-0ruoWp` system-temp directory. The digest-
sealed receipt was written **before** CalculiX dispatch and survived normal
scratch cleanup. The FRD element block contains 208 actual C3D4 records
(IDs 225–432), explaining the `432` **estimated upper bound / maximum ID**
in the CalculiX startup header. The mesh has 88 nodes, minimum trusted
altitude 2.2360679775 mm, positive nodal lumped masses (minimum
0.000325 kg), and 0.07800000000000001 kg total versus 0.078 kg analytical.
Fixed and loaded FACE sets each contain five distinct nodes and cover
100 mm²; five loads of 20 N give the 100 N axial resultant. No third
minimum-increment value, mass-scaling warning, or
`WarnElementMassScaled.nam` marker appeared.

The sealed deck digest is
`sha256:31be402b94ed1c30a2dfc81b204d4c606588c52d1c5ff4d6874ddba3b205f27f`.
Its `*DYNAMIC, DIRECT, EXPLICIT=2, ALPHA=0` data line is
`9.900990099010e-8,1.000000000000e-5`: 101 exact expected increments,
20,000 configured cap, and `*STEP, INC=103`. The host altitude/wave-speed
bound was 3.0448082276e-7 s, using 5,875,097.0448 mm/s material wave
speed. CalculiX itself reported a **3.315458e-8 s** Courant limit. The
selected fixed step was **2.9863× the provider limit**, so the host
actual-mesh CFL admission is demonstrably insufficient. This finding alone
blocks provider feasibility. It does not by itself prove the cause of the
non-finite values at time zero, before any positive-time step.

The first captured FRD frame at t=0 has finite nodal displacement, but
velocity is `NaN` in all three components at the five fixed-face nodes
(1,2,3,4,45); loaded-face velocity is tiny but finite. The bounded FRD
extract contains 53 zero-time frame headers and no positive-time frame;
fixed-node velocity `NaN` persists throughout the captured frames. Direct
acceleration output is not available through the installed 2.16 U/V
`*NODE FILE` path, and finite-difference acceleration cannot be computed
without positive time advancement. The first and all captured kinetic-
energy values are `NaN`, while internal energy remains about
1.048563e-59 N·mm, external work and support resultant are zero, and
total energy is `NaN`. No subsequent finite kinetic-energy frame exists.
CalculiX terminated with exit code 201 and `*ERROR: max. # of increments
reached`; it reached the deck's 103 increment limit while reporting time
zero throughout the bounded diagnostics. Zero positive-time increments
completed. The precise internal source of fixed-DOF velocity `NaN` is not
proven: pre-dispatch geometric lumped mass is positive, but solver-internal
constrained-DOF handling was not observed. This is **not** a harmless
time-zero energy-display artifact.

Provider feasibility remains **FAIL**. The next bounded item is a
no-solver provider-specific CFL and constrained-velocity diagnosis using
this retained receipt and installed 2.16 implementation/docs; any corrected
real solve needs separate approval. No provider/browser/MCP admission opens.

## Installed-source CFL and fixed-DOF NaN reconciliation (2026-09-30)

No Gmsh or CalculiX process was launched. The source bundled with the
installed CalculiX 2.16 executable resolves the C3D4 Courant discrepancy.
`calcstabletimeincvol.f` uses `weight3d4=1/6`, `xsj=6V`, then divides the
integrated volume by three and by each face area. Its limiting C3D4 length
is therefore `V/(3 Amax) = minimum_altitude/9`. With zero damping and
`ALPHA=0`, `critom/2=0.98`; the final volumetric safety factor is `0.80`.
The matching formula is
`dtvol=0.80*0.98*(minimum_altitude/9)/dilatational_wave_speed`.
On the retained 88-node/208-element mesh, the no-solver reproduction is
`3.3154578478304834e-8 s`, agreeing with CalculiX's printed
`3.315458e-8 s`. The old host altitude-based limit is 9.183673 times
larger, owing to the different element length and omitted 0.98—not
material units or wave-speed calculation.

The private C3D4 admission and sealed pre-dispatch receipt now calculate
this provider-faithful critical step from the actual mesh. The existing
contract safety factor (at most 0.8) is an additional margin below the
provider critical value, and the 20,000-increment limit remains in force.
For the retained 1e-5 s case the bounded choice is 378 increments of
`2.64550264550265e-8 s`; the prior serialized
`9.900990099010e-8 s` fails the new pre-dispatch guard. No minimum
increment or mass-scaling mechanism was added. Source inspection of
`nonlingeo.c` shows the solver may itself limit the actual step to `dtvol`;
the oversized serialized step is a host admission failure, but not by itself
proof of the time-zero NaN's cause. If the provider used its printed Courant
step for the 1e-5 s duration, at least 302 increments would be required,
versus the old deck's `INC=103`; the host's 101-increment prediction did
not account for the provider limit. This is an additional independent
resource-budget discrepancy, not proof that any positive-time frame was
completed in the failed run.

The bounded raw FRD slice contains literal `NAN` velocities at fixed nodes
1, 2, 3, 4 and 45, while all first-frame displacements are finite. Thus
the parser did not invent or substitute the NaN. The explicit constrained
DOF branch of `resultsini.c` has an unguarded
`bnac=(xboun-v)/(bet*dtime*dtime)` expression and writes the actual velocity
array. A subsequent source-path audit established that `nonlingeo.c` calls
the initial results calculation with `dtime=1`, then its special initial-
acceleration calculation with nonzero `dtime=1.235711130e-20`. Therefore
the earlier assertion that the initial call necessarily performed `0/0`
was **incorrect and is withdrawn**. The first non-finite writer was not
captured, and the specific denominator/numerator values at that call cannot
be asserted from the retained evidence. Constrained DOFs are inactive in
the equation system, but their `veold` state is still calculated;
`resultsmech.f` uses element nodal velocities in kinetic-energy density,
and `calcenergy.f` integrates that density. The NaN is therefore not merely
an FRD or TunaCAD parser substitution. No direct acceleration frame was
output. The installed `elprints.f` activates
energy calculation for `ELKE` or `ELSE` as well as `ENER` in the first step;
the diagnostic deck's `ELKE,ELSE` request was present from the start.

Focused no-solver checks replay the retained mesh/FRD, reproduce provider
CFL, reject the old step, enforce the increment budget, detect fixed-node
NaNs without coercion, and validate the receipt. No earlier numerical or
qualification evidence became stale. Provider feasibility remains **FAIL**:
no positive-time output was produced, and a smaller admitted step alone
does not establish that the zero-time constrained-velocity defect is gone.
Next bounded item: source-grounded no-solver evaluation of a solver-supported
way to avoid this initialization failure without changing physics, before
seeking approval for another single diagnostic solve. Provider/browser/MCP
admission remains closed.

## No-solver 2.16 constrained-velocity/source assessment (2026-09-30)

Installed-source trace: `boundarys.f` maps an omitted displacement value
and explicit `0` to the same zero `bounval`; `bounadd.f` stores the value,
node and translational DOF in `xboun`/`nodeboun`/`ndirboun`. Its `FIXED`
parameter reads the current `vold`, which is zero in this required initial
state, and reaches the same arrays. `mastruct.c` marks each SPC DOF
negative/inactive. For direct dynamic results, `resultsini.c` still
calculates constrained acceleration and updates the actual `veold`/`accold`
arrays whenever its `nmethod==4 && iperturb[0]>1` branch is entered with a
non-special time. `prediction.c`/`preparll.c` read `veold` for all
translational node entries, including inactive SPC DOFs, before SPC
displacement is reapplied. `frd.c` writes `veold` directly. `resultsmech.f`
interpolates those velocities over each C3D4 for kinetic-energy density;
`calcenergy.f` integrates it into the reported kinetic energy. This is
state/energy contamination, not output-only corruption. The retained FRD
shows the five fixed nodes non-finite at t=0; it does not capture the
first instruction that changed their state from finite to NaN. Free-DOF
state isolation likewise is not established and is not assumed.

An omitted zero, explicit zero, `*BOUNDARY,FIXED` at zero initial
displacement, `OP=NEW`, and a constant-zero amplitude all reach the same
SPC branch. The installed parser has no native zero-velocity boundary
keyword that avoids it. A one-term MPC or rigid/reference-node construction
would use different constraint machinery; `resultsini.c` also has an
unguarded dynamic MPC acceleration calculation. Neither is demonstrated
to be a safe equivalent for the fixed FACE. Springs, artificial masses,
damping, load smoothing, solver patches and parser NaN-to-zero replacement
would change the task or conceal the defect.

No later source tree is installed locally. The official upstream
post-2.16 development source (which includes changes after posted 2.23)
still has the same constrained-SPC denominator and velocity update; it
adds a massless-contact branch but does not establish a fix for this case.
No later executable was installed or run. Focused no-solver source-path
assertions and retained raw-FRD NaN checks pass; no mesh or solver ran.

Outcome **C: no demonstrated safe CalculiX 2.16 deck-level workaround**.
The exact first non-finite instruction remains unresolved without an
instrumented provider diagnostic, but the NaN is already in solver state
and energy, and no equivalent boundary encoding avoids the risky path.
Keep 2.16 explicit provider admission and browser/MCP authoring closed;
provider feasibility stays **FAIL**. Another real solve is not justified
by a syntax-only change. Any evaluation of a later CalculiX version or
another explicit-capable provider is a separate bounded roadmap item with
new validation and approval. No earlier validated SIM evidence is stale.

## Provider-suitability assessment and 2.16 closure (2026-09-30)

**TunaCAD explicit-dynamics foundation: implemented.** Retain the bounded
contract, axial-bar analytical reference, provider-faithful actual-mesh C3D4
CFL and 20,000-increment admission, no-mass-scaling guard, sealed diagnostic
receipt, retained-mesh diagnostics, raw non-finite-state rejection, and the
failed-provider record above. **CalculiX 2.16 explicit structural dynamics:
unsupported for this bounded TunaCAD scope; feasibility FAIL.** The retained
run produced non-finite fixed-node velocity and kinetic energy at time zero
and no positive-time frame. The exact first non-finite instruction remains
unknown, but no safe equivalent deck-level fixed-FACE workaround is
demonstrated. This finding is specific to explicit dynamics and changes no
static, modal, thermal, contact, nonlinear, harmonic, or other CalculiX
support. Provider, browser and MCP explicit admission remain closed.

Assessment is documentary only: no executable installed or run, no solver
deck dispatched, and no candidate integrated. Requirements remain one
homogeneous linear-elastic solid with positive density, one fixed FACE, one
separate axial 100 N step-force FACE, zero initial state, and small
displacements, without damping, mass scaling, contact, plasticity, large
deformation or multiple domains.

| Candidate | Windows, license, manual installation | Inputs/procedure and bounded physics | Time-step, output, cancellation/extraction | Integration effort and blocker | Probe decision |
| --- | --- | --- | --- | --- | --- |
| Later CalculiX (posted 2.23 Windows build or later) | Windows binaries are published; CalculiX is GPL-2.0 and can be installed separately. | `.inp` with `*DYNAMIC,EXPLICIT=2`, C3D4, elastic density, fixed and loaded node sets remains the candidate form. The installed 2.16 case failed even with otherwise accepted deck syntax. | Existing Bridge text/FRD lifecycle and explicit CFL guard could be reused; displacement/velocity, reaction and energy completeness would need a fresh version-pinned proof. The official development `resultsini.c` still contains the constrained-SPC acceleration and velocity update relevant to the failure; no release/source evidence establishes a fix. | Low adapter effort if actually fixed, but high scientific uncertainty. Existing cancellation/quarantine remains reusable, not proof of corrected solver state. | **No probe selected** solely on a newer version number; require a relevant source change, release note or other concrete fix evidence first. |
| OpenRadioss | Published Windows `starter_win64.exe` and `engine_win64.exe` support manual external installation. Project license is AGPL-3.0; licensing and bundled-runtime obligations require review before distribution/integration. | Native `.rad` Starter/Engine workflow documents `/TETRA4`, linear-elastic `/MAT/LAW1`, `/BCS` fixed node group and `/CLOAD` time-function nodal force. `/CLOAD` is force **per node**, so the 100 N FACE resultant must be apportioned and checked. Zero-state and small-displacement semantics must be verified with the chosen release, not inferred. | Documented nodal displacement, velocity, acceleration and reaction animation vectors and global kinetic/internal/external-work output; Windows converters are supplied. Actual stable-step behavior and absence of `/DT/*/CST` or `/DT/AMS` mass scaling must be verified. Binary/text extraction determinism, process termination, cancellation, partial-file quarantine and complete energy balance remain unproven. | Moderate-to-high: new external adapter and Starter/Engine/converter orchestration, but it can remain behind the existing Bridge lifecycle, approval, limits and normalization boundary. | **One tiny standalone axial-bar feasibility probe is justified only after exact release selection, license review and separate real-solve approval.** Not provider admission. |

Primary evidence: [CalculiX development SPC result path](https://raw.githubusercontent.com/Dhondtguido/CalculiX/master/src/resultsini.c), [Windows CalculiX distribution](https://github.com/calculix/CalculiX-Windows), [OpenRadioss releases](https://github.com/OpenRadioss/OpenRadioss/blob/main/RELEASES.md), [installation](https://github.com/OpenRadioss/OpenRadioss/blob/main/INSTALL.md), [license](https://github.com/OpenRadioss/OpenRadioss/blob/main/LICENSE.md), [TETRA4](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/tetra4_starter_r.htm), [CLOAD](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/cload_starter_r.htm), [nodal vectors](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/anim_vect_engine_r.htm), [energy print](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/print_engine_r.htm), and [time-step controls](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/time_step_general_recommendations_r.htm).

The next bounded item is a separately approved, exact-release OpenRadioss
*standalone* axial-bar feasibility probe, not integration: one short 100 x 10
x 10 mm tetrahedral bar with the same material, fixed and step-force FACE
resultant, no mass scaling or other extra physics. Capture a pre-dispatch
mesh/mass/timestep/force receipt; verify finite U/V/A, reaction, kinetic and
internal energy and applied work over positive-time frames; reject partial
or non-finite output. Do not open provider/browser/MCP admission based on a
successful syntax probe. Status remains `proof_of_concept` with
`engineeringUsePermitted: false`; earlier explicit or other SIM evidence is
not stale from this assessment.

## One approved standalone OpenRadioss Starter attempt (2026-09-30) — FAIL before Engine

The user-managed OpenRadioss installation outside the repositories existed with
`extlib`, `hm_cfg_files`, `licenses` and `COPYRIGHT.md`. The Windows
Starter and Engine had no file-version metadata. Their SHA-256 identities
were `961eca1640c321b0cb4893c8481942e5162e89ea292d64e964deea1b5ead96d6`
and `53625d1fdc32991b0f51c368c648a5c184fd3bc43875553b4653132445e4b8e8`,
respectively. Starter identified itself as Windows Intel double-precision,
2026 Siemens/AGPL. The extracted binaries cannot be proven byte-for-byte
to be the frozen `latest-20260728` asset because no original archive or
vendor per-binary checksum was supplied.

The one-run, standalone diagnostic preparer
`scripts/probe-sim9-openradioss-standalone.mts` reused the retained real
88-node/208-C3D4 bar mesh, checked 10,000 mm³ and 0.078 kg, selected five
fixed and five loaded nodes from the two 100 mm² end faces, and serialized
area-weighted nodal `/CLOAD` forces of 16.66666666667 N four times plus
33.33333333332 N once: **exactly 100 N**. The isolated receipt and decks
are retained at
`tunacad-openradioss-explicit-probe-rZB0Hr` under system temp. Pre-dispatch
checks found no mass-scaling, damping, contact, plasticity or initial-velocity
cards; only the one Starter process was launched with the documented
`OPENRADIOSS_PATH`, `RAD_CFG_PATH`, `RAD_H3D_PATH`, `KMP_STACKSIZE=400m`,
`OMP_NUM_THREADS=1` and bundled DLL paths.

**Starter FAIL:** exit code 2, three errors and one warning, no restart file.
The two `ERROR ID 573` messages say `ms` was parsed as a *length* unit;
`ERROR ID 574` says the work time unit was undefined. The generated
`/BEGIN` unit fields are incorrectly aligned for this executable.
`WARNING ID 100214` says the generated `/BCS/1` line has an unsupported
field. Starter did read 88 nodes and 208 tetrahedra and printed a 78 g
part mass (0.078 kg), but its solid timestep contained `NaN`/invalid
unit-derived values. Its property review also printed `Itetra4=0` rather
than the intended 1000, so fixed-field property serialization requires
independent correction/verification. Those observations are **deck
translation defects**, not proof of an OpenRadioss physics limitation.

Per the one-run approval, **Engine was not started and no retry occurred**.
No positive-time motion, reactions, energy history, provider timestep or
mass-scaling outcome can be accepted. The standalone feasibility probe is
**FAIL / not demonstrated** at Starter; OpenRadioss provider admission
remains closed. The next smallest item is a **no-solver** deck-format audit
against exact-release Starter format and the retained listing, correcting
`/BEGIN`, `/BCS` and `/PROP/SOLID` serialization with focused static
checks. Any fresh Starter/Engine run needs separate explicit approval.
CalculiX 2.16 explicit remains unsupported; its other capabilities and
all earlier evidence are unchanged.

## No-solver OpenRadioss Starter serialization correction (2026-09-30)

The standalone preparer now emits both `/BEGIN` unit rows as 20-character
`Mg | mm | s` fields, matching the 2026 block-format definition. The
100 × 10 × 10 mm bar has 10,000 mm³ volume, density `7.8e-9 Mg/mm³`,
and mass `7.8e-5 Mg = 0.078 kg`. In Mg-mm-s, `1 Mg·mm/s² = 1 N` and
`1 N/mm² = 1 MPa`; the 100 N load and 200,000 MPa modulus remain unchanged.
The previously intended 0.01 ms duration and 0.001 ms output interval
are now emitted as `1e-5 s` and `1e-6 s`.

The `/BCS` `Trarot` field is exactly `   111 000`: positions 4–6 fix
only X/Y/Z translation, positions 8–10 leave rotations free. `Skew_ID=0`
and `grnd_ID=1` occupy the next two 10-character fields, and group 1
contains exactly the five trusted fixed-FACE nodes. `/PROP/SOLID` now
uses `I_solid=0` (no brick-specific selection), `I_smstr=1`, and
`I_tetra4=1000` in field 7 for the linear one-point `/TETRA4` formulation;
other bounded fields use documented default-zero positions. This is a
static serializer correction, not yet evidence of the executable's
interpreted part settings.

The focused golden-deck check covers the 10-field ruler and every required
Starter block, node/tetra row widths, material/part/group references,
fixed-column field positions, force sum, Mg-mm-s dimensions, and forbidden
physics/mass-scaling cards. It passed using the retained real 88-node,
208-element mesh, without executing Gmsh, Starter or Engine. This addresses
the diagnosed *serialization causes* of errors 573/574 and warning 100214
in the old listing, and the unintended old property setting. Actual Starter
acceptance and interpreted `/PROP/SOLID` values remain **PENDING** until a
separately approved new run. OpenRadioss feasibility and all provider,
browser, and MCP admission remain closed; earlier numerical evidence is
not stale.

## One corrected Mg-mm-s Starter gate (2026-09-30) — process PASS, admission FAIL

The user-approved corrected-deck Starter attempt used the retained
88-node/208-TETRA4 mesh and exact 100 N nodal resultant; no Gmsh or
CalculiX was run. The pre-dispatch receipt, deck, Starter stdout and
listing remain in isolated system temp under
`tunacad-openradioss-explicit-probe-E8u6RM`. Starter exit code was 0,
with 0 counted errors and 0 counted warnings, and it produced
`ExplicitBarProbe_0000_0001.rst`. It interpreted both unit systems as
`Mg | mm | s`, density as `7.8e-9 Mg/mm³`, E as 200,000 MPa,
Poisson ratio as 0.3, mass as `7.8e-5 Mg = 0.078 kg`, 88 nodes and
208 solids. It listed all five applied X nodal forces summing to 100 N.
The smallest listed solid timestep was `3.6204643133954e-7 s` and
smallest nodal estimate `5.3236366039543e-7 s`.

**Clean Starter gate FAIL:** the property-set section reports TETRA4
formulation 1000, but the part element/material review reports
`Itetra4=0`. The boundary-condition section contains no fixed-node rows
despite one declared `/BCS` and five expected fixed-FACE nodes. This is
not an independently verified constraint/property interpretation. The
listing also includes an initial added-mass *estimate* for
`/DT/NODA/CST`; this is not proof of actual mass scaling, but must not
be mistaken for a no-mass-scaling Engine result. Under the approved
Starter gate, **Engine was not launched**. There are no positive-time
motion, reaction or energy data. OpenRadioss feasibility remains
**FAIL / not demonstrated**, and provider/browser/MCP admission stays
closed. Next: no-solver investigation of actual property-part and BCS
interpretation plus the timestep-control semantics; any new real run
requires separate approval. Earlier evidence is unchanged.

### Retained successful Starter listing interpretation audit (no solver)

The retained 88-node/208-TETRA4 deck, pre-dispatch receipt, Starter
listing, and planned Engine deck were parsed without rerunning a solver.
The `/PROP/SOLID/1` seventh 10-character field is `I_tetra4=1000`.
Starter's property section echoes `TETRA4 FORMULATION FLAG = 1000`.
The frozen 2026 `/PROP/TYPE14` definition identifies `1000` as the
linear, one-integration-point `/TETRA4` formulation; `0` delegates to
`/DEF_SOLID`, whose zero selector resolves to the same standard linear
formulation. The retained deck has **no `/DEF_SOLID` card**. Frozen
[`defaults_mod.F90`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/starter/source/modules/defaults_mod.F90#L135-L143)
initializes its default selector to zero. Frozen
[`hm_read_prop14.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/starter/source/properties/solid/hm_read_prop14.F#L173-L200)
does **not** substitute a default when the explicit input is `1000`;
it stores `IGEO(20)=1000` and echoes 1000 in the property listing.

The part-element/material review prints `Itetra4=0` because frozen
[`sgrtails.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/starter/source/elements/solid/solide/sgrtails.F#L671-L680)
reads `IGEO(20)` and **explicitly normalizes `1000` to internal code
`0`** before storing it as `IPARG(41)`. Frozen
[`initia.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/starter/source/elements/initia/initia.F#L3571-L3575)
prints that `IPARG(41)` code in the part review. Thus its zero is the
normalized standard linear one-point TETRA4 code, **not a second
unresolved `/DEF_SOLID` selector and not a different formulation**.
The property identity remains 1000 in `IGEO(20)`; the part-group
identity is its equivalent internal zero. Frozen restart writers carry
the property and group arrays into the restart; the retained binary was
not independently decoded to a field offset. **Property interpretation
PASS at the Starter/restart-generation level.** Keep explicit `1000` in
the serializer. Actual positive-time Engine behavior is still untested.

The fixed-face chain is internally consistent: trusted x-min FACE nodes
`[1,2,3,4,45]` are precisely `/GRNOD/NODE/1`; `/BCS/1` encodes
`Trarot = 111 000`, `Skew_ID = 0`, `grnd_ID = 1`. In the frozen Starter
BCS reader, `grnd_ID` resolves through the node group and selected
translation DOFs are set for each member. The listing reports one BCS
and no BCS error. Its blank boundary-condition table does **not** imply
nonapplication: the frozen `printbcs` implementation prints individual
node rows only at `IPRI >= 2`, while this run used `IPRI = 0`.
**Fixed-constraint interpretation PASS at the Starter input level**;
Engine reaction/kinematic enforcement remains unverified until an
approved Engine run.

The planned Engine card is exactly plain `/DT/NODA` followed by scale
`0.9` and minimum `0`. It has no `/CST`, `/CST1`, `/CST2`, or `/DT/AMS`
mass-addition option. Official time-step guidance distinguishes this
ordinary nodal control from constant-step mass scaling. Starter's
`INITIAL ADDED MASS ESTIMATION for /DT/NODA/CST` is hypothetical, not
an Engine mass-change measurement; Starter also reports total added
mass zero. **No-mass-scaling configuration PASS**. Actual Engine added
mass remains unverified; a future run must reject any mass-scaling
warning or nonzero added mass and compare evolving mass with the
`7.8e-5 Mg` baseline.

Independent gates: property **PASS (Starter normalization)**, fixed BCS **PASS (Starter
interpretation only)**, no-mass-scaling timestep **PASS (configuration
only)**. The property discrepancy no longer blocks a separately
approved Starter/Engine feasibility attempt; that attempt would still
need to prove positive-time motion, reactions, energies and zero actual
added mass. OpenRadioss feasibility and all provider/browser/MCP
admission remain closed. The focused retained-
listing test is `scripts/test-sim9-openradioss-listing-interpretation.mts`.

## OpenRadioss exact-release preflight (2026-09-30; no execution)

**Candidate frozen for assessment:** upstream latest stable tag
[`latest-20260728`](https://github.com/OpenRadioss/OpenRadioss/releases/tag/latest-20260728),
release commit
[`a62b27e6baa555d222a580d6218867d0be4d70b5`](https://github.com/OpenRadioss/OpenRadioss/commit/a62b27e6baa555d222a580d6218867d0be4d70b5).
The official releases list showed no newer stable tag at this assessment.
No package was downloaded, so archive bytes and per-file digests have **not**
been independently verified. The [published Windows package layout](https://github.com/OpenRadioss/OpenRadioss/blob/main/RELEASES.md)
contains `exec/starter_win64.exe`, `exec/engine_win64.exe` (SMP/OpenMP),
`exec/anim_to_vtk_win64.exe`, `exec/th_to_csv_win64.exe`, optional MPI and
extended-single-precision variants, `hm_cfg_files`, `extlib/hm_reader/win64`,
`extlib/h3d/lib/win64`, `extlib/intelOneAPI_runtime/win64`, `COPYRIGHT.md`,
and `licenses`. Only the normal SMP Starter and Engine are candidates for
the first probe; MPI and precision variants are out of scope.

The [official Windows instructions](https://github.com/OpenRadioss/OpenRadioss/blob/main/INSTALL.md)
set `OPENRADIOSS_PATH`, `RAD_CFG_PATH` to `hm_cfg_files`, `RAD_H3D_PATH` to
`extlib/h3d/lib/win64`, `KMP_STACKSIZE=400m`, `OMP_NUM_THREADS` (one for
the tiny probe), and `PATH` entries for `extlib/hm_reader/win64` and the
bundled `extlib/intelOneAPI_runtime/win64`. They show sequential
`starter_win64.exe -i <Runname_0000.rad> -np 1` followed **only after
Starter success** by `engine_win64.exe -i <Runname_0001.rad>`. Starter
validates the model and produces a binary restart; Engine reads that state
and the run-control file. Native input is Block Format `.rad`. Outputs
include Starter/Engine `.out`, binary restart, animation, and time-history
T-files; `th_to_csv_win64.exe` is a bundled optional converter. The
release archive's exact invocation details still require local inspection
before a probe.

**Licensing boundary, not legal clearance:** OpenRadioss states
[AGPL-3.0](https://github.com/OpenRadioss/OpenRadioss/blob/main/LICENSE.md)
for its covered code; its [copyright notice](https://github.com/OpenRadioss/OpenRadioss/blob/main/COPYRIGHT.md)
and released `licenses`/`extlib/intelOneAPI_runtime/win64/license` directories
identify additional third-party notices. The proposed TunaCAD architecture
would require each user to download and install the unmodified OpenRadioss
package independently, configure absolute Starter/Engine paths locally,
and invoke separate executables only from the local Simulation Bridge.
Neither binaries nor source would enter TunaCAD's repositories, package,
or hosted assets. That is an architectural separation, **not** a legal
conclusion about license compatibility. Bundling, redistributing, modifying,
linking covered code into the Bridge, or hosting a modified network-accessible
copy requires additional legal review; third-party notices must be inspected
from the exact downloaded package before distribution decisions.

### Exact bounded contract mapping (planned cards; no deck generated)

| TunaCAD requirement | Native OpenRadioss mapping to evaluate |
| --- | --- |
| 100 x 10 x 10 mm single bar, units | Starter `/BEGIN` with one explicit consistent unit system; `/NODE` coordinate records and `/TETRA4` four-node solids. A practical candidate is mm-ms-g-N-MPa with density converted from the TunaCAD material; verify all mass, time and energy conversions before writing a deck. |
| One homogeneous linear isotropic solid, positive density | `/MAT/LAW1 (ELAST)` for density, Young's modulus and Poisson ratio; `/PROP/SOLID` with documented linear one-point `I_tetra4=1000` and a verified small-strain setting; `/PART` binds the sole material/property to all tetrahedra. No plastic, damping, contact or failure cards. The exact small-displacement formulation still requires version-pinned Starter/Engine evidence. |
| Fixed FACE | Resolve the trusted boundary facets to an explicit `/GRNOD/NODE` set; `/BCS` fixes X/Y/Z translations in the global frame. Preserve the original FACE-to-node provenance and reject empty, ambiguous or overlapping sets. |
| Separate axial 100 N step-force FACE | Resolve its trusted facets to deterministic nodal weights; `/FUNCT` represents the t=0 step and `/CLOAD` applies axial force to node groups. `/CLOAD` force is **per node**: the weighted nodal forces must sum to exactly 100 N with the intended resultant/moment. A single 100 N `/CLOAD` on a multi-node group would be wrong. No imposed initial displacement or `/INIVEL` card. |
| Duration, stable timestep and no mass scaling | Engine `/RUN/<name>/1` sets stop time. Evaluate `/DT/NODA` with scale 0.9 and no positive minimum time step (`0`), using the provider's own printed Starter/Engine critical timestep; do **not** use the CalculiX C3D4 formula as a Radioss rule. Reject `/DT/NODA/CST`, `/DT/AMS`, other scaling/switch/delete controls, or added-mass cards. Check mass history and `MAS.ERR` for zero added mass. |
| Bounded history and recovery | Starter `/TH/NODE` for selected load/fixed nodes: `DX,DY,DZ`, `VX,VY,VZ`, `AX,AY,AZ`, `REACX,REACY,REACZ`; Engine `/TFILE/3` (documented ASCII) with bounded output interval and global `KE`, `IE`, `EFW`, `MASS`, `DT`. Sum all fixed-node reactions. `/PRINT` supplies human-readable cycle, timestep and energy diagnostics. `/ANIM/VECT/DISP`, `/VEL`, `/ACC`, `/FREAC` are an optional cross-check, not required GUI post-processing. |

Sources for the mapping: [TETRA4](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/tetra4_starter_r.htm),
[solid formulation](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/prop_type14_solid_starter_r.htm),
[LAW1](https://2022.help.altair.com/2022.3/hwsolvers/rad/topics/solvers/rad/mat_law1_elast_starter_r.htm),
[PART](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/part_starter_r.htm),
[BCS](https://www.help.altair.com/2021/hwsolvers/rad/topics/solvers/rad/bcs_starter_r.htm),
[CLOAD](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/cload_starter_r.htm),
[time histories](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/th_node_starter_r.htm),
[global energies](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/time_histories_overview_starter_r.htm),
and [T-file format](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/tfile_engine_r.htm).

**Mesh preflight:** the existing trusted first-order Gmsh tetra connectivity
can in principle map to `/NODE` and `/TETRA4` without changing geometry.
Use stable one-based integer IDs, sort deterministically, preserve a bijection
back to the validated Gmsh mesh, and reject duplicate IDs, unsupported
elements, missing nodes, nonpositive volume/Jacobian, or orientation rejected
by Starter. `/PART` supplies one material/property. FACE-to-facet and
facet-to-node mappings must be derived from trusted mesh ownership, not a
caller-supplied node list. The exact Radioss orientation and any node-order
permutation are **not proven** without the release-pinned Starter probe.

**Timestep and no-mass-scaling preflight:** the [Radioss timestep guide](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/time_step_scale_factor_r.htm)
shows a provider-calculated element limit in Starter output and a typical
0.9 scale factor in Engine. `/DT/NODA/CST` and `/DT/AMS` can add mass;
plain `/DT/NODA` with zero minimum is documented as using the nodal stable
step without a mass target. The probe must record the provider's actual
element/nodal limit, selected step, cycles, initial/final `MASS`, `MAS.ERR`,
and absence of all mass-scaling controls. A nonzero added-mass indication
or unexpectedly reduced critical step fails closed; the existing 20,000-cycle
cap is retained but cannot be admitted from the CalculiX-specific formula.

**Output choice:** prefer the documented ASCII `/TFILE/3` with bounded
`/TH/NODE` and global histories over binary animation or the CSV converter
for the first probe. It has a plausible text extraction path without GUI,
but exact file layout, time/node ordering, complete fixed-face reactions,
rounding and reproducibility at this tag are **unverified**. If ASCII lacks
required quantities, assess the bundled `th_to_csv_win64.exe` against a
version-pinned binary T-file in a later increment; do not silently substitute
animation results or infer missing data.

**Future Bridge lifecycle, not yet implemented:** use one isolated scratch
directory, an immutable mesh/deck/runtime receipt and explicit paths.
Launch Starter, require success and authenticated restart/output; launch
Engine, require success and bounded complete positive-time frames; extract
and validate results; then clean scratch while retaining only bounded
diagnostics. Apply existing CPU/memory/time limits to both children and any
converter. Cancellation during either child must stop its process tree,
win over late exit, quarantine partial restart/T-file/animation output and
prevent result publication. Do not trust exit code alone: inspect `.out`
for fatal/abnormal termination and expected final time. The exact exit-code
and termination strings for this release remain unverified until execution.
The documented [C-file controls](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/control_file_c_file_r.htm)
may allow cooperative stop, but hard bounded process-tree cancellation and
cleanup remain required by the Bridge.

**Preflight decision:** one short *standalone* 100 x 10 x 10 mm axial-bar
Starter/Engine feasibility probe is justified once the user manually
installs the exact package and explicitly approves the real run. It should
prove only model acceptance, clean Engine termination, no mass scaling,
finite positive-time U/V/A, recoverable summed fixed-FACE reaction and finite
KE/IE/EFW. It does not claim analytical accuracy, mesh convergence,
deterministic normalization or provider admission. Stop after one run on
failure; do not broaden physics to force PASS.

**Manual installation prerequisites for that later probe (not performed):**
download the Windows asset attached to the [frozen release](https://github.com/OpenRadioss/OpenRadioss/releases/tag/latest-20260728)
yourself; verify it declares the tag/commit and retain its archive hash;
extract it outside both TunaCAD repositories without discarding `exec`,
`hm_cfg_files`, `extlib`, `COPYRIGHT.md` or `licenses`; confirm the normal
`exec/starter_win64.exe` and `exec/engine_win64.exe` plus bundled runtime
directories are present; provide those two absolute executable paths and
the extracted root to the future probe. Do not install MPI, copy binaries
into TunaCAD, or launch either executable for this preflight. The future
probe process can set the documented environment locally and check version,
archive identity, config and third-party notices before its one solve.

**Status:** CalculiX 2.16 explicit remains unsupported/FAIL. OpenRadioss is
preflight-qualified for one *experimental feasibility probe only*, not an
admitted provider. TunaCAD explicit foundation remains implemented;
`proof_of_concept`, `engineeringUsePermitted: false`, and closed
provider/browser/MCP admission remain unchanged. No older evidence became
stale because this increment changed documentation only.

## One approved corrected-deck Starter + Engine feasibility run (2026-09-30)

One unchanged Mg–mm–s deck pair and the retained 88-node/208-TETRA4 mesh
were staged in isolated diagnostic storage after matching the retained
deck and installed executable hashes. A bounded pre-dispatch receipt was
written before the run. No Gmsh or CalculiX was run, and neither Starter
nor Engine was retried.

**Starter PASS:** exit 0, normal termination, zero counted errors and
warnings, valid 369146-byte restart. It reported Mg–mm–s input/work
units, E=200000 MPa, nu=0.3, rho=7.8e-9 Mg/mm³, 88 nodes, 208 TETRA4,
mass 7.8e-5 Mg = 0.078 kg, one accepted BCS and no incompatible
kinematic condition. The x-min BCS binds nodes `[1,2,3,4,45]` with
translations fixed. Five X loads sum to exactly 100 N. The property
listing reports `I_tetra4=1000`; the part review's equivalent normalized
internal code is `0`. Starter's CST added-mass table remains an estimate.

**Engine numerical execution PASS, complete-result feasibility FAIL:**
the single Engine process exited 0 with normal termination and reported
21 cycles. Its printed nodal timestep was 4.7915e-7 s at every listed
cycle, with last printed cycle 20 at 9.5830e-6 s against the configured
1e-5 s stop. Plain `/DT/NODA` used scale 0.9 and minimum 0. Every
printed cycle held total mass at 7.8e-5 Mg and added mass at zero; no
mass-scaling card or warning was present. The Engine `.out` contained
finite kinetic/internal energies and external work through the run.

The ASCII `/TFILE/3` has complete frames at t=0, 1.43745033e-6,
2.39575056e-6 and 3.35405078e-6 s. At the first positive frame,
loaded node 5 had DX=3.55100371e-5 mm, VX=32.4774862 mm/s and
AX=-5.97194575e6 mm/s², all finite. Its IE, KE and external work
were respectively 0.00148384799, 0.00183382378 and 0.00339110704
N·mm. Fixed nodes `[1,2,3,4,45]` retained zero DX/VX/AX in every
complete frame. The requested REACX channel was present, but all
fixed-end values in those short complete frames were zero; a nonzero
support-reaction history was **not** demonstrated.

The next T-file frame, t=4.31235100e-6 s, contains all 22 global
values but only **15 of 40 required nodal values**, then reaches EOF.
There are no subsequent T-file frames through the run end. This is an
incomplete time history despite normal Engine termination, not a NaN or
an observed mass-scaling event. No partial T-file is admitted as a
completed result. The original `.out`, T-file, restart, stdout/stderr,
deck copies, hashes and read-only inspection script remain in isolated
diagnostic storage. **OpenRadioss standalone explicit-provider
feasibility remains FAIL** under the required bounded complete-history
criterion. The failure mechanism of the ASCII T-file truncation remains
unresolved; no further solver run is authorized by this evidence.

Next bounded increment: a no-solver investigation of this exact
release's `/TFILE/3` finalization/record-count behavior and retained
output, with a fail-closed complete-frame reader. Do not change the
physics, rerun a solver, or open provider/browser/MCP admission without
separate approval. Previous contract, CFL, CalculiX failure and Starter
normalization evidence remains current; this result adds provider
feasibility evidence rather than invalidating it.

## Retained OpenRadioss ASCII history audit and strict reader (2026-09-30; no solver)

The retained `ExplicitBarProbeT01` is exactly **6959 bytes**. It contains no
NUL bytes and ends in CRLF after a complete numeric line, but that line is
**inside**, not after, the fifth `ZZZZZEOR 40R` record. The final record
declares 40 nodal reals and contains only 15. Thus the physical file ends
cleanly at a **line boundary but mid-record**. No `T02`, additional T-file,
animation file or CSV exists in the isolated run directory. The Engine `.out`
reports the 1e-6 s history interval and normal 21-cycle termination, but no
T-file write/flush/finalization diagnostic. Its cycle table has global
energies and mass, not the missing nodal history. The retained restart is a
binary final-state checkpoint, not an authenticated substitute for the
missing ordered history. A converter cannot reconstruct values absent from
the only retained T-file. The exact cause of this partial record is **not
established**; normal termination is not proof that the history is complete.

The bounded header declares 22 global channels (codes 1–22) and one nodal
history group with 10 unique nodes in order `[1,2,3,4,5,6,7,8,45,46]` and
four channel codes `[1,4,7,620]` corresponding to the deck's
`DX,VX,AX,REACX`. Each frame is a `1R` time, `22R` global record, then
`40R` nodal record in node-major/channel-minor order. Global indices 1,2,
6,7,9 (one-based) are IE, KE, total mass, DT and external work respectively
in the [frozen `hist2.F` writer](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/engine/source/output/th/hist2.F).
The same writer emits the declared number of nodal values via
[`write_th.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/engine/source/output/th/write_th.F)
and ASCII `ZZZZZEOR nR` records via
[`wrtdes.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/engine/source/output/th/wrtdes.F).
The requested [ASCII `/TFILE/3` interval](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/tfile_engine_r.htm)
is a **time frequency**, not a cycle count. The frozen `hist2.F` schedules
on `TT >= THIS` and caps the next scheduled time at `TSTOP`; this does not
establish that the final simulation time must appear as a complete frame.
The ASCII write branch does not explain the observed mid-record EOF; the
source's explicit `FLU_FIL_C` call applies to a different internal format
branch. No silent tail discard is allowed for the bounded result contract.

The provider-private
[`openRadiossTFileParser.mts`](../simulation-bridge/openRadiossTFileParser.mts)
strictly validates the bounded header, ordered unique nodes/channels,
frame type/cardinality/time, finite values, byte/frame bounds and required
time coverage. It rejects the authentic fifth frame at **15/40**, so it
cannot publish the four-frame prefix as a completed provider result. A
separate diagnostic parse of the prefix verifies the four genuinely complete
frames without repairing or carrying forward missing values.

[`/TH/NODE` documentation](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/th_node_starter_r.htm)
defines `REACX` as X reaction force on a node and says reaction outputs
apply to nodes with boundary conditions, including this `/BCS` support.
Zero fixed-node REACX in the early complete frames is physically plausible:
the ~17 microsecond bar wave-transit estimate exceeds the last complete
history time of 3.354 microseconds. This is an inference, not proof that a
nonzero support reaction is recoverable. Neither `.out` nor another retained
provider file supplies the missing support-reaction time history.

Focused no-solver test: authentic retained prefix parse; authentic incomplete
tail and required-interval rejection; channel/node identity/order and
cardinality rejection; non-finite, invalid time and incomplete-line rejection.
No solver, converter, historical suite or broad regression was run. This
parser is not wired into a production provider because provider admission
remains **closed**. Existing numerical/Starter evidence is not stale.
**Standalone OpenRadioss feasibility remains FAIL** until a separately
approved run yields a complete, deterministic required history including a
recoverable support reaction. A repeat of the same deck is not justified by
this evidence alone; a future bounded probe first needs a source-backed
history-output/finalization change or alternative complete provider-native
output plan, with the same fail-closed reader applied before admission.

## Binary T-file recovery preparation and converter caveat (no solver)

The bounded future Engine deck now emits `/TFILE/4` at the unchanged
`1e-6 s` history interval; `/DT/NODA 0.9 0`, `/PRINT/-1`, the trusted
88-node/208-TETRA4 mesh, the same ten `/TH/NODE` identities and
`DX,VX,AX,REACX` requests, 100 N total load, material and physics are
unchanged. [Radioss documents Type 4 as the recommended/default binary
IEEE history format](https://help.altair.com/hwsolvers/rad/topics/solvers/rad/tfile_engine_r.htm).
The expected native file is `ExplicitBarProbeT01`; the installed, user-owned
converter is invoked **only after successful Engine termination** as
`th_to_csv_win64.exe <short-isolated-path>\ExplicitBarProbeT01`, producing
`ExplicitBarProbeT01.csv`. The converter is not modified or redistributed.
Its installed PE file is 183808 bytes with SHA-256
`09b18b17bce62c1ca0d4c5f7d58c088098dad6607ebb2fecf45405152499bb92`;
no embedded file/product version was exposed by Windows metadata, so this
digest, executable name and release provenance must be pinned. The native
input and produced CSV need their own digests, byte bounds, converter exit
status and strict content checks. The [official converter source](https://github.com/OpenRadioss/Tools/blob/main/output_converters/th_to_csv/src/th_to_csv.c)
documents the one-input-file invocation and `<input>.csv` output and uses
100-byte path buffers; conversion must run from a short isolated path.

The bounded expected CSV layout, **if authentic conversion matches the
published source**, is one time column, 22 ordered global columns, then
10 node-major groups of four values (63 total). The provider-private
[`openRadiossBinaryHistoryRecovery.mts`](../simulation-bridge/openRadiossBinaryHistoryRecovery.mts)
validates exact global columns, unique ordered node identities, 63 finite
values per frame, strictly increasing time from zero, positive-time coverage,
positive constant-domain mass and zero actual added mass. It records input
and CSV digests, rejects nonzero converter exit, and never repairs a missing
last cell or frame. Its parsed reaction column is deliberately tagged
`unverified_converter_column`, **not** raw impulse or physical force;
no provider result can be admitted from it yet. The ASCII reader remains
historical/debug-only and the 15/40 truncated frame remains FAIL evidence.

**Reaction semantics correction:** the frozen Engine
[`reaction_forces_th.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/engine/source/output/reaction_forces_th.F)
and [`bcs1th.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/engine/source/output/th/bcs1th.F)
accumulate the history value as force times `DT12`;
[`thnod.F`](https://github.com/OpenRadioss/OpenRadioss/blob/a62b27e6baa555d222a580d6218867d0be4d70b5/engine/source/output/th/thnod.F)
places it in `REACX` (code 620). Despite generic `/TH/NODE` wording that
calls REACX reaction force, the native history quantity for this release is
an **impulse in N·s**. For a verified raw impulse sequence, TunaCAD's pure
post-processor preserves each impulse and derives N using forward difference
at the first frame, centered difference internally and backward difference
at the last frame, over actual unequal frame times. It never differentiates
the unverified CSV column or trusts converter-derived forces.

`/TH/TITLE` is **intentionally omitted for now**. The [OpenRadioss Tools
instructions](https://github.com/OpenRadioss/Tools/tree/main/output_converters/th_to_csv)
say that card writes a `_TITLES` sidecar for full names *and* enables the
converter to differentiate impulse channels. The published converter
implementation replaces recognized `REACX` impulse values with derivatives,
losing the raw values required by this bounded contract. Conversely, its
no-title branch allocates `isImpulse` without initializing that flag before
the later differentiation loop. The published writer also iterates to
`cptData-1`, raising a last-value completeness concern. These are source-
level risks, **not proof that this installed executable behaves identically**.
They prevent a claim that converter-only CSV provides deterministic raw
impulse provenance. A future no-solver binary-reader or converter-behavior
qualification must independently retain/verify the raw impulse before
another provider-feasibility run is justified. Do not fabricate a titles
sidecar or assume the converter's derivative is the raw history.

Focused no-solver checks passed: actual bounded deck generation emitted
`/TFILE/4` with 88 nodes, 208 elements and 100 N load; converter PE/hash
preflight; synthetic 63-column CSV acceptance and malformed, missing,
duplicate, reordered, truncated, non-finite and mass-scaling rejection;
exact impulse differentiation. No converter, Starter, Engine, Gmsh or
CalculiX execution occurred. This is result-path preparation, **not an
OpenRadioss feasibility PASS**; provider/browser/MCP admission remains
closed and earlier numerical evidence is not stale.

## Direct bounded /TFILE/4 reader (no solver; supersedes converter recovery)

The private [direct T01 reader](../simulation-bridge/openRadiossBinaryTFileParser.mts)
uses the [published OpenRadioss Tools `t01Read`, `eor_c_read`,
`read_i_c`, and `read_r_c`](https://github.com/OpenRadioss/Tools/blob/main/output_converters/th_to_csv/src/th_to_csv.c)
as its binary format specification, cross-checked against frozen 2026
Engine `hist1.F` at commit `a62b27e6baa555d222a580d6218867d0be4d70b5`.
The `/VERS/2026` writer sets `THICODE=4021`, 100-byte hierarchy titles,
and IEEE Type 4 records. Only that exact version is accepted. Each record
is big-endian 32-bit byte count, exact payload, and matching closing
count; integers and IEEE floats are big-endian 32-bit values. The bounded
sequence is version/title (84 bytes), release/date (80), additional-record
count (4), title width (4), unit factors (12), hierarchy (24), 22 ordered
global codes (88), part/material/geometry/subset descriptions, one TH
group, ten node identities and four channel codes. The required codes
`1,4,7,620` mean `DX,VX,AX,REACX`; the verified node order is
`[1,2,3,4,5,6,7,8,45,46]`. Each frame has separate time, 22 globals,
descriptor-declared part/subset values, and 40 node-major/channel-minor
values. Raw values enter memory in `t01Read` before the later
`csvFileWrite` stage that can rename or differentiate channels.

Raw `REACX` code 620 is preserved as `reactionImpulseNs`; TunaCAD
derives `reactionForceN` from the complete verified time sequence with
forward first-frame, centered interior and backward final differences.
Units are `N·s / s = N`. IE, KE and external work remain energies and are
never differentiated. The direct reader bounds the artifact to 8 MiB/64
frames and rejects wrong version/hierarchy/identity/order, record-length
mismatch, missing/truncated frames, insufficient requested-time coverage,
NaN/Infinity, nonpositive mass and actual added mass. The official
`th_to_csv` executable is now optional diagnostic comparison only;
its CSV reaction column is never canonical.

Focused no-solver tests generate framed IEEE32 records from this published
layout, accept a four-frame constant-force `I=F·t` history, and reject
truncation, malformed boundaries, wrong channel count/identity, duplicate
or reordered nodes, wrong version, non-finite values, nonmonotonic time,
missing final coverage and added mass. This establishes bounded synthetic
decoding, **not** completed real-provider recovery. One separately approved
Starter→Engine→direct-reader probe is justified next. Historical ASCII
truncation FAIL and standalone result-recovery FAIL remain until that real
binary probe passes. Provider/browser/MCP admission remains closed.

## One approved direct-binary feasibility probe (2026-10-01)

Exactly one Starter and one Engine ran with the unchanged corrected
Mg–mm–s bar, retained 88-node/208-TETRA4 mesh, input Itetra4=1000, 100 N
load, plain /DT/NODA 0.9 0 and /TFILE/4. No solver retry or converter ran.
Starter reports normal termination, zero counted errors/warnings, the
correct material/mass/mesh/load interpretation and a valid restart.
Its launcher did not retain an OS exit-code receipt; that limitation is
explicitly recorded rather than manufacturing exit-code evidence.

Engine execution PASS: persisted exit code 0, normal termination, 21
cycles, printed timestep 4.7915e-7 s and last printed cycle at
9.5830e-6 s for the configured 1e-5 s duration. Every printed cycle has
mass 7.8e-5 Mg and actual added mass zero; all printed IE/KE/external
work are finite. Last printed values are 0.01193 / 0.01197 / 0.02398 N·mm.

Direct binary recovery FAIL: the authentic 3984-byte T01 has **THICODE
3040**, while the current reader accepts only 4021. It fails closed with
"unsupported T01 version/header" and returns no normalized result.
All 52 binary record envelopes are complete and correctly length-framed.
A framing-only diagnostic finds ten apparent time/global/node record
triples, with times 0 to 9.103851880354341e-6 s and first positive
candidate 1.4374503507497138e-6 s. These are diagnostic observations;
motion/reaction/energy histories have not passed direct-reader validation.
Coverage through the requested 1e-5 s remains unproven.

The earlier inference that /VERS/2026 necessarily selects THICODE 4021
is superseded by this installed-executable evidence. The existing 4021
synthetic checks remain valid for their declared layout but do not establish
the actual provider output layout. The native T01, deck/runtime receipts,
restart files and logs remain isolated and retained; its SHA-256 is
542fd6ee406e0c5b1f2ce5218dc9329795f6b2d53632f26e9c3144e751eba82b.
No numerical value or missing frame was fabricated and no production
admission was opened.

Standalone provider feasibility remains FAIL. Next bounded item:
**no-solver source-grounded THICODE 3040 layout and final-history coverage
reconciliation using the retained binary artifact**. No additional solve
is justified merely to resolve its header. Earlier physics/mesh/property
and historical failure evidence remain current; the unconditional
2026-to-4021 output-version assumption is stale.

## Retained THICODE 3040 recovery (no solver, 2026-10-01)

**Standalone OpenRadioss feasibility: PASS for this bounded standalone
probe.** This supersedes the immediately preceding version/coverage FAIL;
the raw ASCII truncation and original 4021-only rejection remain historical
evidence. No Starter, Engine, mesh, converter or additional solve ran.
Provider/browser/MCP admission remains closed, status remains
`proof_of_concept`, and `engineeringUsePermitted: false`.

### Explicit source-backed schemas

Frozen OpenRadioss source commit
`a62b27e6baa555d222a580d6218867d0be4d70b5`:
`engine/source/input/freform.F` defaults `TH_VERS=40` independently of
`/VERS/2026`; `engine/source/output/th/hist1.F` maps that to THICODE 3040.
Published Tools `output_converters/th_to_csv/src/th_to_csv.c`, function
`t01Read`, reads the same two layouts. Low-level `read_i_c`, `read_r_c`
and `eor_c_read` establish big-endian 32-bit integers, IEEE32 values and
paired 32-bit record lengths. No converter transformation is invoked.

| Record payload | 3040 | 4021 |
| --- | --- | --- |
| Initial code + run title | 4 + 80 bytes | 4 + 80 bytes |
| Release/date | 80 bytes | 80 bytes |
| Additional count/title-width/unit-factor records | absent | 4 / 4 / 12 bytes |
| Hierarchy title width | 40 bytes | 100 bytes |
| Part/subset/TH-group descriptor | 60 bytes | 120 bytes |
| Material/geometry/node descriptor | 44 bytes | 104 bytes |
| Hierarchy/global-code records | 24 / 88 bytes | 24 / 88 bytes |
| Time/global/node frame payloads in authentic case | 4 / 88 / 160 bytes | same |

Hierarchy is one part, two material descriptors (IDs 1 and 0), one geometry,
one subset, one TH group, 22 globals. Descriptor-declared part/subset
variable records are consumed only where declared. The authentic case has
none. Ten node IDs are `[1,2,3,4,5,6,7,8,45,46]`; channel codes are
`[1,4,7,620]` for DX/VX/AX/raw REACX. Version dispatch is explicit;
unsupported codes, wrong widths/counts, reordered/duplicate identities,
truncated frames and non-finite values still fail closed. The original
failure was a supported-version/header assumption, not malformed output.

### Coverage from the Engine scheduler

Frozen `hist2.F` outputs when `TT >= THIS`, then updates
`THIS=min(TSTOP,max(TT,THIS+DTHIS))`. `resol.F` calls `SORTIE_MAIN` before
advancing TT; `sortie_main.F` does not force a final T01 sample at stop.
For this normal constant-step run, dt is strictly below the history
interval, so the next due threshold remains THIS + interval. The no-solver
coverage checker uses IEEE32 rounding cells, not an arbitrary endpoint
tolerance, and independently verifies the normal 21-cycle completion.

Actual dt: `4.791501169165713e-7 s`; history interval: `1e-6 s`;
stop: `1e-5 s`. Sampled cycles are `[0,3,5,7,9,11,13,15,17,19]`.
Cycle 20 is the last evaluated cycle before stop. Next due threshold is
10 us; next eligible history cycle is 21, at
`[10.062152296086425,10.062152455247997] us`. It is beyond stop, so the
authentic last frame at `9.103851880354341 us` is complete scheduled
coverage. No endpoint sample is fabricated. Variable-step or ambiguous
rounding cases require separate coverage evidence and fail closed here.

### Authenticated retained result

Authentic T01 is unchanged: 3984 bytes, 52 complete record envelopes,
THICODE 3040, SHA-256
`542fd6ee406e0c5b1f2ce5218dc9329795f6b2d53632f26e9c3144e751eba82b`.
Ten frames span 0 to 9.103851880354341 us. The isolated no-solver receipt
`direct-3040-recovery.json` retains all 22 globals and ten nodes per frame.
Local artifact paths remain test-local and are not published in the Bridge.

| Quantity | First positive frame (1.437450350749714 us) | Last history frame (9.103851880354341 us) |
| --- | --- | --- |
| Loaded node 5 DX (mm) | 3.551003828761168e-5 | 2.2302073193714023e-4 |
| Loaded node 5 VX (mm/s) | 32.47748565673828 | 9.284682273864746 |
| Loaded node 5 AX (mm/s2) | -5971945.5 | 13343443 |
| Internal energy (N mm) | 0.001483847969211638 | 0.011278313584625721 |
| Kinetic energy (N mm) | 0.0018338237423449755 | 0.011497980915009975 |
| External work (N mm) | 0.003391107078641653 | 0.022859038785099983 |

All motion/energy values are finite. Fixed nodes `[1,2,3,4,45]` have exactly
zero DX/VX/AX at every frame. Raw support REACX is retained as impulse;
the last summed impulse is `-5.073601586601251e-13 N s`, and independently
differentiated support force is `-5.366756148898728e-7 N`. Forward,
centered and backward derivatives remain unchanged. Near-zero reaction is
admissible before the approximately 19.75 us axial wave transit; nonzero
support-response validation belongs to the later analytical run.

Mass is constant `7.79999973019585e-5 Mg` (IEEE32 serialization of the
0.078 kg model). Raw global 17 is a constant **negative**
`-5.421010862427522e-20 Mg`, not silently replaced by zero. `hist2.F`
writes XMASS - MASS0_START; `ecrit.F` sums nodal mass in double precision.
Only with verified constant-step completion, a constant negative initial
subtraction residual bounded by the standard double summation gamma_n
bound for this 88-node/208-element fixture is accepted. Positive added
mass, a larger negative residual, any later residual change or mass change
is rejected. Added-mass change from initialization is exactly zero;
Engine execution evidence reports no actual mass addition. Energies remain
energies and are never differentiated. No analytical accuracy is claimed.

### Focused validation and next bounded increment

- `node --experimental-strip-types scripts/test-sim9-openradioss-direct-tfile-no-solver.mts`:
  PASS for 3040 and existing 4021 fixtures, unsupported/malformed rejection,
  missing/non-finite histories, identity/order checks, constant-force
  impulse differentiation, source-backed coverage, and mass residual/change
  rejection.
- `node --experimental-strip-types scripts/test-sim9-openradioss-retained-binary.mts`:
  PASS with isolated artifact directory/digest environment inputs; verifies
  unchanged authentic bytes, normal completion/deck receipt, ten complete
  frames, fixed-node state, finite histories and scheduled coverage.
- Syntax checks of both tests, binary reader and cadence checker: PASS.
- Root/submodule `git diff --check`: PASS.

Earlier physics, mesh, property and failed-provider findings remain current.
The 4021-only recovery FAIL and unproven final coverage are superseded by
this retained-authentic result. CalculiX 2.16 explicit remains unsupported.
Next bounded increment: analytical axial-bar validation using the same
mesh and physics with a duration safely beyond one axial wave transit,
including nonzero support response and displacement/reaction/work-energy
comparison. A real run requires separate approval; no convergence matrix
or production provider integration is authorized by this recovery step.

## Frozen axial-wave development oracle (2026-10-01; no solver)

The standalone feasibility PASS and retained authentic THICODE 3040 evidence
are unchanged. This increment adds a separate continuum wave oracle;
`explicitAxialBarReference` remains its documented single-mode approximation
and is **not** reused as an exact travelling-wave solution. No solver,
converter, mesh change or production admission change occurred.

Implementation: `simulation-bridge/openRadiossAxialBarOracle.mts`.
Frozen bar/plan digest:
`sha256:3925b93dc1a9ae733e4cbb59ba8216b9bd76f92b41f689c8c6855d12bea33121`.
The versioned plan is frozen before any future 50 us provider result.
Changing its thresholds requires a new recorded oracle version; do not
tune this plan after observing that result.

### Problem, dimensions and analytical derivation

Exactly L=100 mm, 10 by 10 mm section, A=100 mm2, E=200000 MPa,
nu=0.3, rho=7.8e-9 Mg/mm3, F=+100 N, mass=7.8e-5 Mg=0.078 kg.
One fixed end at x=0; loaded end at x=L; initially zero displacement and
velocity; no damping, scaling, contact, plasticity or geometric nonlinearity.
The reference is a 1D rod with free lateral contraction, not the full 3D
constrained-end/Poisson-effect solution. Nu does not enter the 1D axial speed.

Because 1 Mg mm/s2 = 1 N, MPa/(Mg/mm3) has units mm2/s2.
Equivalently rho=7800 kg/m3 and E=2e11 Pa:

- c=sqrt(E/rho)=5063696.835418333 mm/s=5063.696835418333 m/s;
- T=L/c=19.748417658131497 us;
- 2T=39.496835316262994 us;
- u_static=FL/(AE)=0.0005 mm;
- incident stress F/A=1 MPa; tip speed v=F/(rho A c)=25.31848417709167 mm/s.

For 0 <= t <= 2T, the loaded end has u(t)=u_static*t/T.
The support reaction is zero before T; the fixed-end reflected stress is
2F/A, producing R=-2F=-200 N from T until 3T in the ideal rod.
At exactly T use the right-hand reaction limit; it is a discontinuity, not
a smooth numerical waveform. At 2T the tip reaches 0.001 mm and the reflected
wave returns to the loaded end. The nearest discrete sample need not equal
either event. No pointwise velocity/acceleration discontinuity is a gate.

Sign convention: positive x points from the fixed to loaded FACE. Existing
global-X CLOAD is positive; positive DX extends the bar. Frozen
`engine/source/output/th/bcs1th.F` takes the negative unconstrained
acceleration contribution for fixed translations and accumulates MS*DT12;
`thnod.F` exports raw channel 620. Sum impulses over fixed IDs
`[1,2,3,4,45]`, then use the existing forward/centered/backward dI/dt
force with **no sign flip, absolute-value correction or converter override**.
The target is force of the support on the solid, -200 N, not force on the
fixture. Reversed numerical sign fails rather than being fitted.

Loaded-face displacement is the trusted load-weighted mean
u_F=sum(F_i*DX_i)/100 over IDs `[5,6,7,8,46]`. Use the existing authenticated
nodal load weights, not node 5 alone or an unweighted average. The exact
constant-load work comparator is W_ref=sum(F_i*DX_i)=100*u_F in N mm.

### Energy oracle

For the 1D rod, put k=F2/(2AE). Before T, the moving/stressed length is ct:
KE=IE=k*ct. Between T and 2T, reflected length b=c(t-T):
IE=k*(L+3b), KE=k*(L-b). Their sum equals F*u(t).
At T: KE=IE=0.025 N mm, work=0.05 N mm. At 2T:
KE=0, IE=0.1 N mm, work=0.1 N mm. These splits are analytical context,
**not mandatory 3D provider split targets**. The provider gates check total
energy and nonnegative finite KE/IE independently from event displacement.

Normalized energy residual:
abs(W-KE-IE)/max(abs(W),abs(KE+IE),5e-8 N mm).
The denominator floor is 1e-6 of F*u_static, fixed before the future run;
zero-energy initialization has residual zero. No early sample is dropped.
Applied-work residual uses the same normalization with KE=0 and IE=W_ref.
Global energies remain N mm (1 N mm=0.001 J); they are not differentiated.

### Frozen sampling policy and POC gates

No interpolation. Select the last sample strictly before T, nearest to T,
first sample strictly after T, and nearest to 2T. Exact nearest-time ties
choose the earlier sample. Record actual times and offsets, not fabricated
event frames. Let h=1 us, dt_max be the authentic maximum Engine step,
S=h+dt_max, and G=max(2S,0.1T). No sampled gap may exceed S apart from the
declared 1e-6 relative IEEE32 comparison allowance. dt_max must be < h.
Pre-arrival window is t <= T-G; plateau window is T+G <= t <= 2T-G.
This excludes reaction differentiation stencils and coarse-mesh transition
zones. At the prior dt=0.4791501169 us, G=2.958300234 us; the pre-window
ends at 16.790117424 us and plateau is 22.706717892--36.538535082 us.
The plateau precedes even the earlier loaded-end return, although ideal
support plateau persists until 3T.

| Independent gate | Frozen development PASS requirement |
| --- | --- |
| State/initialization | All required state finite; initial DX <=1e-9 mm and VX <=1e-5 mm/s; initial step-load acceleration may be nonzero |
| Arrival | First support sample R <=-50 N; abs(t_arrival-T) <=0.20T+S |
| Displacement near T | abs(u_F-0.0005) <=0.25*0.0005 + v*abs(t_sample-T) mm |
| Displacement near 2T | abs(u_F-0.001) <=0.25*0.001 + v*abs(t_sample-2T) mm |
| Pre-arrival support | Every guarded sample abs(R) <=10 N |
| First-reflection plateau | At least 3 guarded samples; median in [-260,-140] N; >=75% of samples in [-280,-120] N |
| Fixed-node motion | Every fixed node/frame abs(DX)<=1e-9 mm, abs(VX)<=1e-5 mm/s, abs(AX)<=1 mm/s2 |
| Work-energy balance | Every frame residual <=0.15; KE and IE nonnegative |
| Work versus loaded-face displacement | Every frame normalized residual <=0.02 |
| Mass | Relative error to 7.8e-5 Mg <=1e-6 and exactly unchanged serialized mass across frames |
| Added mass | No positive added mass, no later change; only existing bounded constant negative initialization roundoff allowed |

Rationale: the retained 208 linear tetrahedra are coarse, and 3D lateral
waves, constrained-end effects and wave dispersion differ from an ideal
1D rod. Timing allows 20% of transit plus measured sampling resolution;
displacement permits 25% spatial/model discrepancy plus the analytical
maximum tip slope times actual sampling offset. Plateau permits 30%
median discrepancy but also requires 75% individual consistency, preventing
a single convenient sample from passing. The pre-arrival cap is 5% of the
200 N reference. Energy's 15% screen allows coarse explicit integration
error; the separate 2% work check tests recovery/aggregation, not physics
accuracy. Constraint and no-scaling gates stay strict. These are deliberately
broad **POC development screens**, not mesh convergence or qualification.
No guarantee is made that the future 3D result will pass. Report each gate
independently; if any fails, preserve it and investigate without tuning.

### Proposed future run (not executed or approved here)

One Starter -> Engine -> authenticated T01 -> direct binary reader is
justified with unchanged mesh, material, force and plain /DT/NODA 0.9 0:

- duration 50 us: 2T plus 10.503164684 us for several post-return samples;
- /TFILE/4 interval 1 us, 50--51 frames including initialization, <=64;
- actual-step/resource admission remains mandatory, <=20000 increments;
- at the previous stable dt, about 105 cycles; no fixed-step assumption
  substitutes for provider stability or authentic future scheduling checks;
- extend constant /FUNCT support through the proposed run; F remains 100 N;
- parse all required nodes, raw impulses, derived reactions and energies;
  retain authentic evidence until reporting finishes;
- use the source-backed history coverage rule; no forced stop frame required.

The 50 us proposal is bounded and resolves both events with multiple
post-return samples; finer histories would add output without resolving
the unchanged coarse mesh's spatial dispersion. This increment grants no
execution permission. The future one-run result remains **PENDING**.

Focused tests: `node --experimental-strip-types
scripts/test-sim9-openradioss-axial-oracle.mts` PASS (dimensional derivation,
first-cycle energies, deterministic event selection, missing coverage,
near-zero residual and independent failing gates). Syntax checks of the
new module and test, plus root/submodule git diff --check: PASS.
Controlled mathematical test histories are not real-provider evidence.
Earlier feasibility and authenticated recovery evidence is not stale.
Provider/browser/MCP admission stays closed, `proof_of_concept` and
`engineeringUsePermitted: false` remain unchanged.

## One approved 50 us analytical run (2026-10-01)

Exactly one Starter and one Engine ran; no retry, remesh, converter or
other solver ran. The authenticated 88-node/208-TETRA4 model is unchanged.
Only RUN duration and constant-force FUNCT endpoint extend to 50 us.
The 100 N resultant, material, fixed group, units and property are identical.
The frozen oracle digest and all numerical tolerances are unchanged:
`sha256:3925b93dc1a9ae733e4cbb59ba8216b9bd76f92b41f689c8c6855d12bea33121`.

Per the explicit instruction before this run, the planned 50--51 frame
range is **informational only**, not a coverage admission gate. Authentic
source-backed scheduling remains mandatory. No exact stop sample is required
merely to reach a count. This policy correction preceded dispatch.

### Execution, admission and retention

- Starter: actual captured OS exit 0, normal termination, zero counted
  errors/warnings. Correct Mg/mm/s, E=200000 MPa, nu=0.3,
  rho=7.8e-9 Mg/mm3, 88 nodes, 208 TETRA4, effective linear formulation,
  fixed group and 0.078 kg mass. A valid restart was produced.
- Before Engine, fresh Starter nodal timestep estimation on the identical
  actual mesh is 5.3236366039543e-7 s. Plain /DT/NODA 0.9 0 selects estimated
  4.79127294355887e-7 s, strictly below that provider estimate, about 105
  cycles versus the 20000 cap. This is provider-native nodal admission,
  not the unrelated CalculiX CFL formula. No CST/AMS/minimum is present.
- Engine: actual captured exit 0, normal termination, 105 cycles. All 105
  retained stdout cycle rows report DM/M=0. Starter's CST added-mass estimate
  table is not treated as actual mass addition.
- T01: 15024 bytes, THICODE 3040, 172 complete envelopes, 50 frames.
  First time 0; first positive time 1.4374503507497138 us;
  last history time 49.35245669912547 us. Last printed cycle 104 is
  approximately 49.832 us; the following cycle would be beyond stop.
- T01 digest:
  `9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46`.
  Starter/Engine launch and exit receipts, fresh admission, original mesh
  digest, deck/executable hashes, authentic T01, logs and diagnostic report
  are retained in isolated test storage. No evidence was deleted.

### Direct-reader rejection: analytical completion NOT accepted

The direct decoder passes schema/identity/framing/finite-state/mass checks,
then fails closed with:
`OpenRadioss coverage: variable timestep requires separate coverage evidence`.
Authentic global timestep values span
`4.791499463863147e-7` to `4.791501169165713e-7 s`, with four distinct
IEEE32 values. Relative range is 3.55901523472061e-7. This small variation
is **not** rounded away or relabeled constant after seeing the run.
The existing coverage proof only supports constant timesteps; therefore
full source-backed coverage admission remains unproven. Complete envelopes
and a normal Engine exit alone do not override that gate. No missing frame
or completed result is fabricated.

The isolated diagnostic rereads the same structurally verified raw records,
retains raw impulses and applies the unchanged differentiation and frozen
physics gates. `diagnoseAxialWaveFrames` shares those calculations but always
returns `pass:false`, `diagnosticOnly:true`, `completedResultAccepted:false`.
It cannot replace completed-history admission. There is no converter,
unsupported-version exception or permissive normal reader. The authentic
digest is verified unchanged before and after diagnostic recovery.

### Frozen numerical gates: diagnostic measurements, not completion PASS

S=1.4791501169165712 us, G=2.9583002338331425 us. Actual nearest-event
samples are 20.124303773627616 us and 39.29030572180636 us. All sample
selection is without interpolation. Sum fixed-node impulse/derived force;
tip displacement remains trusted nodal-force weighted.

| Frozen gate | Measured value/error | Frozen limit | Diagnostic outcome |
| --- | --- | --- | --- |
| Finite state | All DX/VX/AX/impulse/force/energy values finite | No NaN/Infinity | PASS |
| Zero initial conditions | All initial DX/VX zero | 1e-9 mm / 1e-5 mm/s | PASS |
| Arrival | First R<=-50 N at 19.16600376716815 us; error 0.5824138909633474 us from T | 5.42883364854287 us | PASS |
| Transit displacement | 0.0005057677141545945 mm; error 5.767714154594457e-6 mm | 0.00013451686666757695 mm | PASS |
| Return displacement | 0.000958302747070167 mm; error 4.169725292983305e-5 mm | 0.00025522901626935136 mm | PASS |
| Pre-arrival reaction | Maximum absolute 7.425373613290017 N | <=10 N | PASS |
| Reaction plateau | Median -202.5227599946099 N, 1.26138% error; range [-233.8936547014128,-183.79298105084933] N; 100% in band | Median within 30% of -200 N; >=75% within 40%; >=3 samples | PASS |
| Fixed-node motion | Maximum DX/VX/AX all zero | 1e-9 mm / 1e-5 mm/s / 1 mm/s2 | PASS |
| Energy balance | Maximum normalized residual 0.021655278167876373; KE/IE nonnegative | <=0.15 | PASS |
| Applied work | Max normalized error 5.1405851853704655e-8; max absolute W-100*u_F 3.919315941236512e-9 N mm | <=0.02 normalized | PASS |
| Mass | Constant 7.79999973019585e-5 Mg; variation 0; relative error 3.459027560575611e-8 | Unchanged; <=1e-6 relative | PASS |
| Added mass | Raw -5.421010862427522e-20 Mg at every frame; change 0; all printed DM/M=0 | No positive mass addition or later change; existing negative initialization residual bound | PASS |
| Completed history coverage | Four distinct timesteps rejected by current constant-step checker | Authentic source-backed schedule proof required | FAIL / not accepted |

**Overall analytical-validation acceptance: FAIL at history recovery/coverage,
not a demonstrated physics-gate failure.** All frozen physical criteria
pass diagnostically, but those measurements cannot publish a completed
result while coverage is rejected. Standalone 10 us feasibility PASS and
its authentic artifact remain valid; they are not relabeled by this failure.

Focused checks: oracle tests including diagnostic-vs-accepted separation,
runner/oracle syntax, and git diff --check pass. Exactly one fresh Starter
and Engine are recorded. No historical suites or additional solver attempt.
Next bounded item: **no-solver variable-timestep history-coverage
reconciliation using this retained T01 and complete 105-cycle trace**.
Determine exact source scheduler/IEEE32 bounds before changing the proof;
do not invent a timestep tolerance or run another solver for reporting.
Provider/browser/MCP admission remains closed, `proof_of_concept` and
`engineeringUsePermitted: false` remain unchanged. No promotion is made.

## Retained variable-step coverage reconciliation (2026-10-01; no solver)

**OpenRadioss axial-bar analytical validation: PASS for the frozen bounded
POC oracle, using the existing retained 50 us run.** Only the preceding
constant-step coverage-admission FAIL is superseded. Its reason and the
diagnostic-only report above remain historical evidence; nothing is erased.
Standalone feasibility PASS, original T01 and all physics tolerances remain
unchanged. This is not mesh/time convergence, production provider admission,
internal-validation/public-beta promotion or qualification.

### Frozen scheduler and trace authority

Source remains commit `a62b27e6baa555d222a580d6218867d0be4d70b5`.
`freform.F` reads TFILE format/interval. `sortie_main.F` passes the main
OUTPUT%TH%THIS/DTHIS to HIST2 once per eligible evaluation. `hist2.F`
lines 218, 261--280 use THIS0 as the initial threshold and the explicit
branch is exactly:

1. For this unchanged fresh run, initial threshold is 0, corroborated by
   the authentic initialization frame and fresh (not resumed) run record.
2. If TT >= THIS0, write one history frame at actual TT.
3. Advance THIS0 = min(TSTOP,max(TT,THIS0+DTHIS0)). The comparison/update
   is in double precision in this installed double-precision run.
4. A large cycle may cross multiple nominal thresholds, but HIST2 has
   one IF/write, not a catch-up loop. The MAX branch can select TT;
   the next evaluation is on the next integration cycle, not another
   write for each crossed threshold at the same cycle.

`resol.F` evaluates SORTIE_MAIN before advancing actual TT, tests TT>TSTOP
for normal explicit termination after the advance, and adds no TFILE-only
final cycle. Animation/H3D extra-cycle behavior is outside this unchanged
deck. A genuinely evaluated at-stop cycle follows the same comparison;
there is no unconditional final history write. Rounded/ambiguous boundary
evidence fails closed rather than inventing a stop sample.

New `frozen-2026-cycle-trace` coverage uses all 105 authentic ordered cycle
times, never constant dt times cycle, average dt, maximum dt reconstruction,
or rounding the four distinct binary DT values into one. `ecrit.F` prints
stdout time/DT as 1PE11.4; the checker uses half-last-printed-place decimal
rounding cells. T01 frame/time/DT matching uses IEEE32 rounding cells.
These are serialization precision bounds, not empirical tolerances.
Eligibility must be unambiguous for every precision cell. The checker
rejects missing/duplicate/reordered cycles, incomplete termination evidence,
inconsistent time/DT evidence, ambiguous threshold comparisons, missing or
extra frames, wrong frame times/steps, or unproven stop crossing.

The independently authenticated Engine listing is checked against every
stdout cycle identity/time/DT. Old version/header/schema/channel/framing,
finite-state and mass checks still run before coverage. Legacy explicitly
constant-step receipts remain readable for their originally proved scope;
variable-step recovery requires the complete trace, not a permissive fallback.
The existing staged runner now supplies its real trace on future recovery;
that runner was **not executed** in this reconciliation.

### Retained identities, exact replay and final absence

- Authentic T01 unchanged SHA-256:
  `9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46`.
- Authenticated retained stdout trace SHA-256:
  `69ccd1325d08a004434dcd208bab02607d1b46ac4ea83638f82e561d9d1aa5ca`.
- 105 cycles (0--104); printed time range 0--49.832 us, last actual-time
  print cell [49.8315,49.8325] us.
- All four distinct IEEE32 DT values are preserved, in seconds:
  `4.791501169165713e-7`, `4.791500600731524e-7`,
  `4.791500032297336e-7`, `4.791499463863147e-7`.
- Replay predicts exactly 50 outputs and authentic T01 has exactly 50;
  count is a consequence of replay, never a hardcoded acceptance range.
- Thresholds 0--49 us map respectively to cycles
  `[0,3,5,7,9,11,13,15,17,19,21,23,26,28,30,32,34,36,38,40,42,44,46,
  49,51,53,55,57,59,61,63,65,67,69,71,74,76,78,80,82,84,86,88,90,92,94,
  97,99,101,103]`. Every matched frame is PASS.
- 1 us threshold: cycle 2 is 0.95830 us, below threshold; first eligible
  is cycle 3, authentic time 1.4374503507497138 us.
- 49 us threshold: first eligible is cycle 103, authentic time
  49.35245669912547 us. Cycle 104 is still below the pending 50 us threshold.
- Advancing the final actual cycle by its own actual printed DT bounds
  gives next-cycle bounds [50.310645,50.311655] us, wholly beyond stop.
  Cycle 105 was not evaluated before normal termination; no 50 us history
  frame should exist. No final sample is inserted.

The isolated `threshold-to-cycle-replay.md` contains all 50 rows with
threshold, cycle, printed cycle time/bounds, authentic frame identity/time
and match. `source-backed-analytical-validation-report.json` contains
complete accepted direct-reader histories and frozen oracle evaluation.
Both are new retained reports; old receipts/reports and raw T01 are unchanged.
The stop identity is bound to coverage.requestedStopS, not exact equality
between repeated threshold additions and stop (IEEE64 sums retain their
ordinary roundoff). No analytical tolerance was changed by this correction.

### Complete frozen validation outcome

| Gate | Measured statistic | Frozen criterion | Outcome |
| --- | --- | --- | --- |
| History coverage | 50/50 outputs, all cycle/frame matches, justified final absence | Full actual scheduler replay; no missing/extra/truncated data | PASS |
| Finite state | All required motion/impulse/force/energy values finite | No NaN/Infinity | PASS |
| Initial conditions | Initial DX/VX zero | <=1e-9 mm / <=1e-5 mm/s | PASS |
| Arrival | 19.16600376716815 us; error 0.5824138909633474 us | <=5.42883364854287 us error from 19.748417658131497 us | PASS |
| Transit displacement | 0.0005057677141545945 mm at 20.124303773627616 us; error 5.767714154594457e-6 mm | Target 0.0005 mm; error <=0.00013451686666757695 mm | PASS |
| Return displacement | 0.000958302747070167 mm at 39.29030572180636 us; error 4.169725292983305e-5 mm | Target 0.001 mm; error <=0.00025522901626935136 mm | PASS |
| Pre-arrival reaction | Maximum magnitude 7.425373613290017 N | <=10 N | PASS |
| Plateau reaction | Median -202.5227599946099 N, 1.26138% error; 100% of 14 samples in band | -200 N target, median +/-30%; >=75% within +/-40%, >=3 samples | PASS |
| Fixed motion | Max DX/VX/AX all zero | 1e-9 mm / 1e-5 mm/s / 1 mm/s2 | PASS |
| Energy balance | Max normalized residual 0.021655278167876373 | <=0.15; nonnegative KE/IE | PASS |
| Applied work | Max normalized residual 5.1405851853704655e-8 | <=0.02 against 100*u_F | PASS |
| Mass | Variation zero; relative error 3.459027560575611e-8 | Unchanged and <=1e-6 relative | PASS |
| Added mass | Raw constant -5.421010862427522e-20 Mg; change zero | Existing bounded negative initialization residual only; no positive addition/change | PASS |

`test-sim9-openradioss-retained-axial-coverage.mts` additionally asserts
deep equality of every frozen numerical gate with the earlier diagnostic
report, verifies the unchanged oracle digest, and rejects in-memory
truncation/missing-last-frame/missing-cycle/missing-trace tampering. The
new actual-cycle scheduler fixtures cover constant and variable DT,
threshold crossings, an immediate pre-threshold DT change, multi-threshold
once-per-cycle output, final absence, missing/extra/duplicate output,
nonmonotonic/incomplete traces and print-boundary ambiguity. All PASS.
Direct 3040/4021 parser regression and oracle tests PASS; syntax checks and
root/submodule git diff --check PASS. No solver, converter or broad suite.

Earlier feasibility, physics and mesh evidence are not stale. The previous
constant-step-only coverage rejection is preserved but superseded by this
bounded actual-trace PASS. Next smallest development increment is bounded
time-step-sensitivity/convergence planning for this same 50 us bar and
oracle, before any separately approved additional solve. Mesh stability,
broader robustness and production provider lifecycle remain separate work.
Provider/browser/MCP admission stays closed, `proof_of_concept` and
`engineeringUsePermitted: false` remain unchanged. No promotion.

## Frozen timestep-sensitivity plan (2026-10-01; no solver)

This is a **timestep-sensitivity study**, not formal asymptotic convergence.
The retained scale-0.9 standalone feasibility and analytical PASS are frozen
and reused, never rerun. No old receipt, T01, report or analytical threshold
is modified. Medium/fine provider results and the overall sensitivity outcome
are **PENDING**. Controlled comparison fixtures are not real-provider evidence.

Implementation: `simulation-bridge/openRadiossTimeStepSensitivity.mts`.
The independent plan is `tunacad-openradioss-axial-timestep-sensitivity/0.1`;
it binds the unchanged axial oracle digest
`sha256:3925b93dc1a9ae733e4cbb59ba8216b9bd76f92b41f689c8c6855d12bea33121`.
No launch, authorization, production admission or result-publication path is
added. Identical Starter model/mesh/load-weight/runtime identities are required
across summaries; the only intentionally differing control is DT/NODA scale.
The future Engine deck must differ from the baseline only in this scale field.

### Resolution and resource plan

Retained actual-mesh Starter nodal estimate: 5.3236366039543e-7 s.
Planning uses scaled estimate = scale * this provider-native value and
approximate cycles = floor(50e-6/scaled estimate)+1. This estimate is **not**
an actual cycle trace, future stability guarantee, coverage proof, or reuse
of CalculiX CFL. Future dispatch must freshly check the same actual mesh's
Starter estimate and resource limits before Engine, then validate actual
cycles and timestep histories afterward. A changed estimate must be reported,
not silently substituted into the frozen baseline evidence.

| Level | Exact control | Approximate timestep (s) | Approximate cycles | Evidence/action |
| --- | --- | --- | --- | --- |
| Coarse | /DT/NODA 0.9 0 | 4.79127294355887e-7 | 105 | Retained actual 105-cycle PASS; do not rerun |
| Medium | /DT/NODA 0.6 0 | 3.19418196237258e-7 | 157 | New run requires separate explicit approval |
| Fine | /DT/NODA 0.4 0 | 2.1294546415817202e-7 | 235 | Conditional on valid medium; separate approval |

Every level keeps the same 100x10x10 mm bar, 88 nodes/208 linear one-point
TETRA4, E=200000 MPa, nu=0.3, density=7.8e-9 Mg/mm3, 100 N step load and
trusted fixed/loaded node groups; zero initial displacement/velocity,
no damping/contact/plasticity/large deformation and no mass scaling.
Duration remains 50 us; TFILE/4 interval remains 1 us. Direct 3040/4021
version dispatch, raw impulse and deterministic differentiation are unchanged.

Hard resource cap: 20,000 actual increments. Planned increments are well
below it; no nonzero minimum timestep, CST/CST1/CST2/AMS, mass scaling or
automatic retry. Reuse the existing bounded standalone execution limits:
one thread, 60 seconds per Starter/Engine process, 8 MiB captured log cap,
64 history-frame parser bound. These are execution/output caps, **not** an
OS total-memory quota or a measured wall-time prediction. Approximate Engine
cycle work is 1.5x baseline for medium and 2.25x for fine; no runtime is
claimed from that estimate. Retain authenticated T01, full trace, decks,
runtime hashes and process/admission receipts through all reporting.

### Independent oracle gates and recorded cross-run quantities

Every future level must pass all unchanged mandatory gates: source-backed
coverage, arrival timing, transit/return displacement, guarded pre-arrival
reaction, reaction plateau, fixed motion, energy balance, applied work,
mass conservation, zero added mass, finite state and initial conditions.
Fresh process success, complete direct decoding and resource evidence are
prerequisites; failed/cancelled/incomplete output is not a valid study level.
No error must improve monotonically to satisfy these gates.

Each summary records actual timestep range and all distinct values, cycles,
frames, arrival time/error, event sample times and displacement/error/budget,
pre-arrival reaction maximum, plateau median/in-band fraction, maximum
energy/work residual, mass variation, raw added-mass range and change.
No interpolation; nearest event sample with earlier sample winning exact
ties; guarded reaction windows and raw-impulse differentiation unchanged.

Retained coarse summary (reloaded read-only and checked against the accepted
report; medium/fine entries remain PENDING):

| Quantity | Coarse measured value |
| --- | --- |
| Actual timestep range | 4.791499463863147e-7 to 4.791501169165713e-7 s, four distinct values |
| Cycles / frames | 105 / 50, coverage PASS |
| Arrival / error | 19.16600376716815 us / 0.5824138909633474 us |
| Transit displacement / error | 0.0005057677141545945 / 5.767714154594457e-6 mm |
| Return displacement / error | 0.000958302747070167 / 4.169725292983305e-5 mm |
| Guarded pre-arrival maximum | 7.425373613290017 N |
| Plateau median / in-band | -202.5227599946099 N / 100% |
| Maximum energy residual | 0.021655278167876373 |
| Maximum applied-work residual | 5.1405851853704655e-8 |
| Mass variation | 0 Mg |
| Raw added mass / change | Constant -5.421010862427522e-20 Mg / 0 Mg; existing permitted initialization roundoff only |

### Predefined medium-to-fine sensitivity bounds

Freeze `smallChangeFractionOfFrozenTolerance = 0.25` **before either new
solve**. This is a separate conservative development criterion, not a change
to the oracle and not a formal error estimator. Reserve three quarters of
each existing POC budget rather than allow full-tolerance changes between
two individually passing results. Discrete sharp-front sampling can produce
nonmonotonic errors; classify sensitivity separately from absolute agreement.

For two values a,b use absolute difference d=abs(a-b), denominator
max(abs(a),abs(b),physicalScale), normalized difference d/denominator.
The normalized bound is the corresponding absolute bound divided by the
**same** denominator. Fixed positive physical scales keep zeros safe.

Let h=1 us, T=19.748417658131497 us, u1=0.0005 mm, u2=0.001 mm,
v=25.31848417709167 mm/s, Sj=h+maximum authentic timestep in run j.
All effective event budgets are computed by the existing frozen oracle,
not tuned to errors observed in new results.

| Medium-to-fine quantity | Physical normalization scale | Small-change absolute bound |
| --- | --- | --- |
| Arrival time | T | 0.25 * min(0.20*T+Smedium, 0.20*T+Sfine) |
| Transit displacement | u1 | 0.25 * min(0.25*u1+v*abs(tmedium-T), 0.25*u1+v*abs(tfine-T)) |
| Return displacement | u2 | 0.25 * min(0.25*u2+v*abs(tmedium-2T), 0.25*u2+v*abs(tfine-2T)) |
| Plateau median | abs(-200 N) | 15 N = 0.25*0.30*200 N |
| Maximum energy residual | 0.15 | 0.0375 (3.75 percentage points) = 0.25*0.15 |

Using planned timesteps only, the arrival bound is approximately 1.290145 us;
the actual bound uses recovered timesteps. Displacement bound floors are
3.125e-5 and 6.25e-5 mm respectively, plus one quarter of the **smaller**
existing sampling allowance. This prevents a poorer-sampled run from
enlarging the comparison budget. Actual event times and both individual
oracle limits are always reported, not hidden by normalization.

Conclusion rules:

- **stable:** all three authenticated levels independently pass all mandatory
  oracle/process/coverage/resource gates AND all five medium/fine changes
  satisfy the predefined bounds.
- **sensitive:** all levels remain valid and pass the oracle, but one or more
  medium/fine changes exceed their bounds. Report which; no convergence claim.
- **failed:** a refined level fails any mandatory physical, completion,
  recovery, mass-scaling or resource gate. Preserve failure evidence; no retry.
- **PENDING:** a level is missing. Current actual study is PENDING, not stable.

Coverage always replays the complete authentic variable-step cycle trace
using frozen HIST2 TT>=THIS and THIS=min(TSTOP,max(TT,THIS+h)). Nominal/
average timestep, approximate cycle count and expected frame count never
substitute for it; there is no forced final T01 frame and no filled data.

### Exact future proposal (not execution approval)

1. Request approval for **one medium Starter -> Engine -> authentic T01 ->
   direct reader** at /DT/NODA 0.6 0. Same retained mesh, same model, 50 us,
   1 us history; only the scale field changes. Before Engine capture actual
   Starter exit, clean interpretation/restart, fresh nodal estimate and
   <=20,000 admission. Stop if any gate fails; do not retry.
2. Inspect/authenticate/recover medium, replay its full trace, run every
   frozen oracle gate and record all cross-run quantities alongside coarse.
   Collect process exits, no actual mass addition, state/energy/mass,
   impulse-derived reaction, source/deck/runtime hashes and complete history.
3. **Only after valid medium evidence**, consider approval for exactly one
   fine run at /DT/NODA 0.4 0 with the same bounds/evidence. A failed medium
   requires no-solver diagnosis first; do not automatically proceed to fine.
4. After fine passes independently, compute the frozen medium/fine metrics
   and report stable/sensitive/failed. No order-of-convergence claim from
   three runs. No further solve or remesh follows automatically.

### Focused no-solver validation

`node --experimental-strip-types scripts/test-sim9-openradioss-timestep-plan.mts`
(retained directory supplied by TUNACAD_OPENRADIOSS_VALIDATION_DIR) tests
level/units/resource estimates including 20,000/over-cap rejection, safe
normalization at zero, all five change bounds, classification, mismatch/
failed-gate rejection, binary-exact event tie selection, and read-only coarse
loading from pinned authentic T01/trace plus bound deck/source/exit records.
The retained evaluation's gates and distinct timesteps exactly match its
accepted report; its oracle digest remains unchanged. Test medium/fine values
are explicitly synthetic metric fixtures, never recorded as solver results.
No solver/converter or previous passing suite was rerun. Syntax checks for
new files and root/submodule git diff --check pass.

The 0.6 run is justified as the next bounded experiment **only after explicit
approval**. The 0.4 run remains conditional and separately approved. Previous
evidence is not stale. Provider/browser/MCP admission stays closed;
proof_of_concept and engineeringUsePermitted:false remain unchanged.

## Approved medium attempt: stopped at pre-Engine admission (2026-10-01)

One approved medium preparation reused the authenticated coarse T01/trace and
byte-identical Starter model. Only Engine /DT/NODA scale changed from 0.9
to 0.6. The oracle and sensitivity plan digests were unchanged. No coarse,
fine, remesh or historical suite ran.

Exactly **one Starter** ran: actual OS exit 0, normal termination, zero
counted model errors/warnings, valid 369146-byte restart. Listing confirms
Mg-mm-s, 88 nodes/208 TETRA4, material E=200000 MPa/nu=0.3/rho=7.8e-9
Mg/mm3, total mass 7.8e-5 Mg (0.078 kg), property 1000 with the already
resolved part-review internal code 0, one BCS and five X-direction nodal
loads [5,6,7,8,46] with the original weights summing to 100 N.
Fixed-node group and model deck remain byte-identical to the baseline.
The fresh printed nodal minimum is 5.3236366039543e-7 s; informational
scale-0.6 step is 3.19418196237258e-7 s and predicted cycles are 157,
below 20000. Engine control is plain /DT/NODA 0.6 0, no scaling option.

**Admission failed in the newly added experiment harness**, before a
successful admission receipt was written: `AssertionError: 0 !== 5` at
load-row extraction. `listing.split('CONCENTRATED LOADS')[1]` selected
the earlier NCONLD count-summary occurrence instead of the actual section
heading. The authentic listing contains all five correct load rows.
This is a parser defect, not a provider/model or numerical physics failure.

Following the explicit stop-on-admission-failure instruction, **Engine was
not run**, admission was not repaired/retried, and no T01/result was created.
Attempt state is **FAILED (pre-Engine harness admission)**. Medium numerical
gates, history coverage, energy/mass histories and coarse-versus-medium
comparison remain **not demonstrated**. No stable/sensitive conclusion and
no fine-run justification are claimed. Baseline PASS remains unchanged.

The isolated attempt retains decks, sealed pre-dispatch receipt, Starter
launch/exit receipts, stdout/stderr, listing and restart plus a dedicated
`admission-failure.json`. No evidence was cleaned or replaced.
Syntax check and no-solver preparation checks passed; the focused admission
check failed as described. No solver retry or unrelated suite was run.

Next bounded item: **no-solver correction/tests of anchored load-section
extraction using the retained medium Starter listing**, then a fresh explicit
decision on whether to authorize Engine against this retained valid restart.
Another Starter is not necessary merely to fix the parser. No Engine or fine
run follows automatically. Provider/browser/MCP admission stays closed;
proof_of_concept and engineeringUsePermitted:false remain unchanged.

## Retained medium concentrated-load correction (2026-10-01; no solver)

The previous false-zero load failure is **superseded as a harness defect**,
not erased. `admission-failure.json`, original launch/exit receipts, input
decks, listing, restart and coarse evidence remain unchanged. No Starter or
Engine executed in this increment. No medium numerical result is claimed.

`simulation-bridge/openRadiossStarterLoads.mts` now selects a single
standalone `CONCENTRATED LOADS` line, followed immediately by the exact
18-hyphen underline and seven-column NODE/SKEW/DIR/LOAD_CURVE/SENSOR/
SCALE_X/SCALE_Y schema. Rows are bounded by the standalone
`SPMD IS CHECKING FOR ELEMENT DELETION IN :` heading. No absolute line
numbers, substring-based section choice or silent skipping of malformed
rows are used. The earlier NCONLD count row cannot match the standalone
heading. Missing/duplicate headings, wrong schema/terminator, malformed,
missing/extra/duplicate rows, wrong nodes/components/scales or force values
fail closed. Harmless row reordering is accepted and canonicalized by node.

| Node | Component | Interpreted force (N) |
| --- | --- | --- |
| 5 | X | 16.66666666667 |
| 6 | X | 16.66666666667 |
| 7 | X | 16.66666666667 |
| 8 | X | 16.66666666667 |
| 46 | X | 33.33333333332 |

Interpreted resultant = exactly 100 N, within the original <1e-12 N
deterministic tolerance. All rows have skew=0, load curve=1, sensor=0,
SCALE_X=1. Evidence is parsed from Starter output, not inferred from the
deck. Exactly five trusted node IDs and no duplicate node/component pair
are required; each interpreted nodal force matches its trusted value.

**Retained interpreted model/load/stability admission: PASS after harness
correction.** All previous normal-exit/unit/mesh/property/material/mass/BCS/
load/restart-existence checks revalidate against the original artifacts.
Native nodal minimum is unchanged, medium estimated step remains
3.19418196237258e-7 s, expected cycles 157 below 20000, no mass scaling.

### Separate restart-provenance limit: Engine dispatch still PENDING

The original runner wrote an input-deck/runtime launch pin and OS exit
receipt, but **no contemporaneous post-Starter listing/restart digest**.
No such original pin exists among this attempt's retained records. The
current restart size/timestamps agree with the 16:34:44--16:34:45 execution,
and the listing records restart generation, but neither is cryptographic
proof that those bytes have not changed since the original run.

The corrected `engine-admission.json` therefore records a **retrospective
current-artifact checkpoint**, with `checkpointCapturedAfterRun:true`,
`interpretedAdmissionState:"PASS after harness correction"`, but
`dispatchAdmissionState:"PENDING"`, `pass:false` and
`engineOnlyExecutionJustified:false`. The existing launcher checks pass,
so this does not authorize an Engine run. No original execution record or
trusted output pin is synthesized/resealed to manufacture lineage PASS.

Current hashes, captured during this no-solver recomputation:

- Attempt identity (preparation + original launch + original exit bytes):
  `0dd2797b5ea860329eadce8f5b186b5e827ffddd6bf734a60809ac7494261e08`.
- Starter listing:
  `a17e7544b09aa6312693d6f6b174cc02cb7ae83bcc22cbf269374b38bd3ecd8b`.
- Restart (369146 bytes):
  `1e0e044c4bda36a04eb85a7354d07f77e1036065d44846374629323e98bef6e1`.
- Starter deck (matches original launch pin):
  `58424691156acf7cd163a0fd5bc61c71a24fabdd186c799394a8bb79fc43324f`.
- Medium Engine deck (matches protected preparation):
  `8a20fe6add5f25384a9ddc4808d22240cf772d69cf7ee04e4c069e44f1c83536`.

Original launch runtime pin matches the installed Starter hash; installed
Engine also matches its original preparation hash. Listing/restart/deck
and launch/exit bytes are rechecked before publishing the checkpoint.
This detects later checkpoint drift, but does not retroactively prove
original restart integrity. **Engine-only execution is not yet justified
under the requested original-artifact binding standard.** Fine 0.4 remains
unjustified until valid medium execution/recovery/analytical evidence exists.

Focused checks: concentrated-load fixtures (including the exact old bug
reproduced as zero rows), authentic retained-listing regression, corrected
admission recomputation, current checkpoint/unchanged launch/exit assertions,
missing-original-pin PENDING and changed-pin rejection tests, syntax checks
and git diff --check all PASS. Synthetic matching-pin tests do not claim
that an original real pin exists. No solver/converter/historical suite.

Next bounded issue is a decision on the missing original restart integrity
pin: recover independently retained trusted evidence if available; otherwise
report the limitation rather than implicitly trusting a newly captured hash
or rerunning Starter. No new execution is authorized by this increment.
Earlier analytical and feasibility evidence is unchanged and not stale;
provider/browser/MCP admission remains closed, proof_of_concept and
engineeringUsePermitted:false unchanged. No commit/push/deploy/promotion.

## One approved medium Starter-only provenance regeneration (2026-10-01)

**Medium Engine readiness: PASS for this new exact bound restart.**
Exactly one new Starter ran, no Engine or other solver. This is preparation
and contemporaneous artifact provenance, not medium numerical validation.
The old medium attempts, false-zero parser failure and retrospective-only
restart checkpoint remain historical evidence and were not changed.

The standalone `run-sim9-openradioss-starter-provenance.mts` has only
prepare/starter/verify stages and **no Engine launch path**. It created a
fresh isolated attempt from byte-identical medium Starter/Engine decks:
no mesh regeneration or deck metadata/physics edits. Before launch the
sealed preparation and same-attempt receipt bind study/attempt ID, both
deck paths/digests, mesh source digest, material/FACE/load/time settings,
Starter/Engine fingerprints, launch environment and a runtime/config
manifest (84 relevant files: 2026 block configuration, units, message
catalogs and DLLs in the three runtime search directories). No installation
file was changed; paths/fingerprints stay in isolated local evidence.

Attempt ID: `edc380e8-cd29-4cab-99ea-0f208d069811`.
Study identity:
`sha256:0da57815bb1330bd03d06c34b5ba89570ad7498ffbbc7ad53b59fe523bc5d391`.
Runtime/config manifest:
`sha256:29a750b1290fe57cef3747b248890366c1f01ee8e9555158785e62ba5050a8b9`.
Mesh source identity remains the original retained 88-node/208-TETRA4
source digest `700f03b250203d5d72e01aedf156b81c843e8b467a391460387061be9623ea71`.

Relevant environment is captured before launch: OPENRADIOSS_PATH,
RAD_CFG_PATH, RAD_H3D_PATH, OMP_NUM_THREADS=1, KMP_STACKSIZE=400m and
the exact PATH with hm_reader/Intel runtime/H3D directories prepended.
Existing 60-second process timeout and 8 MiB log bound remain unchanged.
An exclusive launch record prevents re-execution/retry for the same attempt.

Immediately after spawnSync returns from the OS, **before any parser,
cleanup or raw-artifact copying**, the wrapper fingerprints every produced
model artifact. It writes these hashes/sizes and the actual exit into the
same attempt receipt, then persists stdout/stderr and exit/completion pins.
The append-only pre-dispatch receipt is retained separately. The output pin
binds original preparation + launch + exit to the exact listing/restart;
this is not a hash filled in during later admission. If required artifacts
or process success are absent, it stops without retry or Engine execution.

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| Starter deck (unchanged) | 19087 | 58424691156acf7cd163a0fd5bc61c71a24fabdd186c799394a8bb79fc43324f |
| Medium Engine deck (unchanged) | 146 | 8a20fe6add5f25384a9ddc4808d22240cf772d69cf7ee04e4c069e44f1c83536 |
| Contemporaneous Starter listing | 26918 | 37c03e95d4d01384f8c7d1256d80860afc199efffcbd32b3f97c0a2899cdeacd |
| Contemporaneous restart | 369146 | a74992b8e9712153d30c69090e7f5b8c32b2398c56018a769b97501f2cab0456 |

OS exit=0, normal termination, 0 counted errors / 0 counted warnings.
Corrected structural load extraction and admission verify Mg-mm-s,
88 nodes / 208 linear one-point TETRA4, E=200000 MPa, nu=0.3,
rho=7.8e-9 Mg/mm3, total mass=0.078 kg, unchanged fixed group
[1,2,3,4,45], and interpreted X loads [5,6,7,8] each 16.66666666667 N
plus node 46 at 33.33333333332 N, exact resultant 100 N within the
existing <1e-12 N tolerance. Property 1000/internal part code 0 remains
the already source-grounded same effective linear formulation.

Native nodal minimum=5.3236366039543e-7 s; medium scale=0.6 produces
estimated timestep=3.19418196237258e-7 s, expected cycles=157 below
20000. Plain /DT/NODA 0.6 0, no minimum or mass-scaling option. Starter
has no added mass; actual Engine mass history is **not yet demonstrated**.
Stop remains 50 us and TFILE/4 remains 1 us.

Admission now verifies the original immediate capture chain and its
output hashes instead of accepting retrospective checkpoints. Existing
old attempts without a contemporaneous receipt remain PENDING. This new
attempt's model/stability admission and artifact binding are PASS. A final
post-admission rehash verifies all produced Engine artifacts, unchanged
input decks, installed runtime/config manifest and absence of an Engine
launch record. `engine-readiness.json` records PASS but explicitly
engineRunAuthorized:false, engineRan:false and fineRunJustified:false.

Focused checks: corrected admission parser, provenance/digest assertions,
post-admission artifact immutability verification, changed-script syntax
checks and git diff --check PASS. No previous passing parser suite was
rerun merely for confidence. No Engine, second Starter, Gmsh, CalculiX,
converter, fine case, remesh, browser or historical suite.

Next bounded item: **separately approved Engine -> authentic T01 -> direct
reader** using this exact new bound medium restart, rechecking identities
immediately before launch. No further Starter is needed if bindings still
match. Fine remains unjustified until valid medium execution/recovery and
all frozen analytical gates pass. Coarse baseline/oracle/sensitivity
thresholds remain unchanged and current. Provider/browser/MCP admission
remains closed; proof_of_concept and engineeringUsePermitted:false unchanged.
No commit, push, deploy or promotion.

## Approved medium Engine-only execution (2026-10-01)

**MEDIUM_PASS; timestep-sensitivity study PENDING_FINE.** Exactly one
Engine ran using the contemporaneously pinned restart from attempt
`edc380e8-cd29-4cab-99ea-0f208d069811`; no Starter, retry, coarse/fine
run, remesh, CalculiX, converter or unrelated suite. The prior Starter-only
readiness receipt remains an unmodified historical authorization boundary;
this separately approved execution extends the same attempt lineage.

### Fresh identities and immediate result provenance

Before launch, the Engine-only wrapper verifies the exact attempt/study,
both decks, listing/restart, source mesh, installed executable and every
one of the 84 sealed runtime/config files. All hashes match the protected
readiness/preparation. Immediately before dispatch it rehashes model
artifacts again; an exclusive launch record prevents another execution.
The same immutable study is
`sha256:0da57815bb1330bd03d06c34b5ba89570ad7498ffbbc7ad53b59fe523bc5d391`.
Model, units, fixed/load groups, /DT/NODA 0.6 0, stop 50 us and TFILE/4
interval 1 us are unchanged. No minimum/scaling option is present.

On process return, before interpretation or cleanup, produced artifact
bytes/sizes/digests, stdout/stderr, OS exit and executable/deck/restart
rehashes are captured. The append-only Engine attempt extension binds
the original Starter receipt to launch and this immediate output pin.
Recovery verifies every produced artifact against those contemporaneous
pins. A final T01 rehash before acceptance and reporting remains identical.
The authenticated T01, ordered cycle trace, logs, receipts and report are
retained in isolated local evidence; no installation file was modified.

| Artifact | SHA-256 |
| --- | --- |
| Engine executable | 53625d1fdc32991b0f51c368c648a5c184fd3bc43875553b4653132445e4b8e8 |
| Engine deck | 8a20fe6add5f25384a9ddc4808d22240cf772d69cf7ee04e4c069e44f1c83536 |
| Admitted restart | a74992b8e9712153d30c69090e7f5b8c32b2398c56018a769b97501f2cab0456 |
| Engine listing | 39c8f106b594c0e07e0977a560ca00a39e7e1854dd59b66b7bfc3eeb5a407be4 |
| Authentic T01 (15024 bytes) | a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559 |
| Ordered stdout/cycle trace | 66d1058c2e83c14178a07c31bde6b43f80981b3e3e1e86ba0e2026e3060885b2 |
| Immediate Engine output pin | 009620ebcb3cad5d4a0eceed8b462a2df38d2772b0934de752ff90a7de59ed31 |

Engine OS exit=0, no signal/error, NORMAL TERMINATION, **157 actual cycles**,
below 20000. Direct THICODE 3040 recovery verifies complete record envelopes,
22 expected globals and ten expected nodes with DX/VX/AX/raw REACX,
ordered identities/times and finite values. Raw impulse is preserved;
support forces use the unchanged forward/centered/backward derivative and
are summed over all five fixed nodes. No converter participates.

Five distinct authentic binary timesteps (seconds), in encountered order:
3.194334112777142e-7, 3.1943338285600476e-7,
3.194333544342953e-7, 3.194333260125859e-7,
3.1943329759087646e-7. Printed cycle steps round to 3.1943e-7;
that lower-precision trace is not evidence of an exactly constant step.

### Source-backed coverage and frozen analytical gates

There are 50 authentic frames: first=0, first positive=1.2777336451108567 us,
last=49.19274215353653 us. Frozen hist2.F scheduling is replayed against
all 157 actual cycle rows, retaining printed precision bounds. All 50
scheduled samples match; next due threshold=50 us, next eligible cycle=157
at 50.150925 to 50.151935 us, beyond stop. No forced exact-stop sample is
expected. Coverage is PASS from actual scheduling, not frame-count or
nominal/average-step assumptions.

Oracle digest remains
`sha256:3925b93dc1a9ae733e4cbb59ba8216b9bd76f92b41f689c8c6855d12bea33121`;
sensitivity-plan digest remains
`sha256:829afae46505555902988b6be892b034ebf9c85c71c2804fc4b1766aa1a40e9a`.
No physics, criteria, event selection, interpolation or thresholds changed.
The existing sampling bound S=1 us+maximum authentic step=1.3194334112777142 us.

| Mandatory gate | Reference / frozen limit | Medium measured statistic | State |
| --- | --- | --- | --- |
| History coverage | Complete source-scheduled history | All 50 scheduled frames; next eligible cycle after stop | PASS |
| Finite state | All required state/impulse/force/global values finite | Strict direct reader and oracle accept all | PASS |
| Initial conditions | DX <=1e-9 mm, VX <=1e-5 mm/s at t=0 | DX=VX=0 at all ten nodes | PASS |
| Arrival | T=19.748417658131497 us; error <=0.2T+S=5.269116942904014 us | Arrival 19.16600376716815 us; error 0.5824138909633474 us | PASS |
| Transit displacement | 0.0005 mm; error <=0.00013451686666757695 mm including frozen sampling allowance | 0.0005049567456201945 mm at 20.124303773627616 us; error 4.956745620194464e-6 mm | PASS |
| Return displacement | 0.001 mm; error <=0.00025522901626935136 mm including frozen sampling allowance | 0.0009590595145709802 mm at 39.29030572180636 us; error 4.094048542901984e-5 mm | PASS |
| Guarded pre-arrival support | Absolute force <=10 N | Maximum 6.410666723848161 N | PASS |
| Support plateau | -200 N; median within 30%; >=75% samples within 40% band, >=3 samples | Median -203.64460108452903 N; relative median error 1.822300542%; 100% in band | PASS |
| Fixed-node motion | DX/VX/AX <=1e-9 mm / 1e-5 mm/s / 1 mm/s2 | Maxima 0 / 0 / 0 | PASS |
| Work versus KE+IE | Guarded normalized residual <=15%; nonnegative finite KE/IE | Maximum residual 0.964212787642462% | PASS |
| Applied work versus force-weighted tip motion | Guarded normalized residual <=2% | Maximum residual 5.1655950999130213e-8 | PASS |
| Mass conservation | Constant mass; relative reference error <=1e-6 | Constant 7.79999973019585e-5 Mg; variation 0; relative error about 3.46e-8 | PASS |
| No added mass | No positive addition; invariant initial negative roundoff within frozen machine bound | Constant -5.421010862427522e-20 Mg; change 0 | PASS |

### Retained coarse versus medium (informational only)

| Quantity | Coarse 0.9 (reused) | Medium 0.6 |
| --- | --- | --- |
| Actual timestep range, s | 4.791499463863147e-7 to 4.791501169165713e-7 | 3.1943329759087646e-7 to 3.194334112777142e-7 |
| Cycles / distinct timestep values | 105 / 4 | 157 / 5 |
| Arrival, us / error, us | 19.16600376716815 / 0.5824138909633474 | 19.16600376716815 / 0.5824138909633474 |
| Transit displacement, mm / absolute error, mm | 0.0005057677141545945 / 5.767714154594457e-6 | 0.0005049567456201945 / 4.956745620194464e-6 |
| Return displacement, mm / absolute error, mm | 0.000958302747070167 / 4.169725292983305e-5 | 0.0009590595145709802 / 4.094048542901984e-5 |
| Guarded pre-arrival maximum, N | 7.425373613290017 | 6.410666723848161 |
| Plateau median, N / in-band fraction | -202.5227599946099 / 100% | -203.64460108452903 / 100% |
| Maximum energy residual | 2.1655278167876373% | 0.964212787642462% |
| Maximum work residual | 5.1405851853704655e-8 | 5.1655950999130213e-8 |
| Mass variation, Mg | 0 | 0 |
| Added-mass change, Mg | 0 | 0 |

Informational normalized changes: arrival=0; transit displacement=0.16034406936305753%;
return displacement=0.07567675008132062%; plateau median=0.5508818225205296%.
Energy residual decreases by 1.2013150291451752 percentage points (difference
normalized by the frozen 0.15 residual scale is 0.08008766860967835).
No formal convergence, monotonicity or stable/sensitive conclusion is claimed.

Focused checks: changed-script node syntax checks; exact pre-launch bound
input/runtime assertions; one approved Engine-only execution; immediate
output/provenance assertions; direct authentic T01 recovery; source-backed
cycle coverage; every unchanged oracle gate; retained coarse authentication
and informational comparison; final retained T01 rehash; git diff --check.
All PASS. Existing unrelated suites were not rerun. Earlier evidence remains
current, including historical harness/provenance failures, which are not erased.

Next bounded item: **one separately approved fine /DT/NODA 0.4 0
Starter -> Engine -> authentic T01 -> direct-reader run**, justified by
valid medium execution/recovery and every frozen gate passing. It remains
unauthorized/unexecuted. Full study state is PENDING_FINE. Same mesh/model,
history interval, oracle, mass policy and actual-cycle coverage must be used.
Provider/browser/MCP admission remains closed; proof_of_concept and
engineeringUsePermitted:false unchanged. No commit, push, deploy or promotion.

### Axial analytical oracle v2 definition freeze (2026-10-01)

Separate identity `axial_bar_oracle_v2`, schema
`tunacad-openradioss-axial-wave-oracle/0.2`; immutable definition digest:
`sha256:15b463c1b5e3db282a191b6aa62e5c508470b46348e283e188cf161a84ec7b97`.
Synthetic-only causality/stencil/rod/plateau/rejection/sensitivity tests PASS.
Freeze receipt SHA-256:
`96b9a7c1f52116daa8e5ded31a735381a6959ed16cd9efe5a5199c48aad3688f`;
the receipt records `retainedHistoriesRead:false` and module/test hashes.
It was created before any retained-data v2 evaluation. This definition
does not assert any retained v2 outcome.

P-wave time is derived from lambda/mu/E/nu/rho/length:
17.020995438407406 us. Rod transit remains 19.748417658131497 us,
return 39.496835316262994 us. A is t<tP; B is tP<=t<tRod;
C contains dominant rod/reflection response. The quiet measurement is
consecutive summed raw-impulse interval force; eligibility is end<=tP,
including equality, without interpolation or an extra sampling guard.
The inherited 10 N small-response bound is unchanged and is not a
precursor-amplitude prediction. This supersedes the prior *proposal* for
a pre-P sampling-width guard, not the historical v1 result.

Precursor magnitude is diagnostic only. Its finite/provenance/channel,
fixed-motion, mass/no-addition and normal-completion requirements remain
mandatory. Derivative metadata preserves type, exact indices, endpoints
and temporal support; a nominal pre-P center is insufficient for a pre-P
label. All existing dominant rod (-50 N trigger; -200 N plateau),
displacement, motion, energy/work, initial-state, mass and variable-cycle
coverage gates and all five sensitivity budgets stay unchanged.
`axial_bar_oracle_v1` and its original digest/evidence remain untouched:
historical study FAILED, fine 15.164045461210522 N >10 N.

Implementation: `simulation-bridge/openRadiossAxialBarOracleV2.mts`.
Definition tests: `scripts/test-sim9-openradioss-axial-oracle-v2.mts`.
Next action: independent no-solver retained three-level reevaluation only
after checking this freeze. Provider/browser/MCP remain closed; no solver
or promotion is authorized by the v2 definition.

## Approved fine attempt and final frozen timestep study (2026-10-01)

**FINE_FAIL; timestep-sensitivity study FAILED.** One Starter and one Engine
were explicitly approved and executed exactly once each. No retry, new mesh,
coarse/medium execution, converter or unrelated suite. Both process executions,
provenance, direct recovery and source-backed coverage PASS. The fine result
fails one mandatory unchanged analytical gate, not a runtime/parser failure.
No threshold, physics or mesh change; no formal convergence claim.

Attempt: `1aefd9c8-274b-4784-b839-050c41bcadec`.
Study: `sha256:744b477a99c9423ce597c3bf12fbb95d4d67c20f20162c3d3bc5c8a53e27e0a2`.
The pre-Starter receipt binds both decks, retained mesh, fixed/loaded nodes,
material, load resultant, 50 us stop, 1 us interval, /DT/NODA 0.4 0,
installed Starter/Engine fingerprints, 84-file runtime/config manifest,
environment and authenticated medium report/output-pin lineage. The Starter
deck is byte-identical; the only Engine-deck change is scale 0.6 -> 0.4.
The existing Starter wrapper captures all generated Engine inputs immediately
on OS return, before interpretation. Corrected detailed-load admission verifies
exactly five X loads: nodes 5/6/7/8 each 16.66666666667 N, node 46
33.33333333332 N, resultant 100 N; fixed nodes [1,2,3,4,45], correct
Mg-mm-s, material, 88 nodes/208 linear one-point TETRA4 and mass 0.078 kg.
OS exit=0, normal termination, 0 errors/0 warnings. Provider nodal estimate
5.3236366039543e-7 s, scaled fine estimate 2.1294546415817202e-7 s,
predicted 235 cycles below 20000, no scaling configuration.

All post-Starter pins, model/runtime identities and final pre-Engine rehashes
PASS. Engine output hashes/sizes/exit are captured before interpretation;
direct recovery rechecks those pins and final T01 bytes. Logs, receipts,
T01, ordered cycle trace and complete failed evaluation remain retained in
isolated local evidence. Production admission and cleanup rules are unchanged.

| Artifact | SHA-256 |
| --- | --- |
| Starter deck | 58424691156acf7cd163a0fd5bc61c71a24fabdd186c799394a8bb79fc43324f |
| Fine Engine deck | ad8ef52436bf54ed037298b553e0d6c62ced9448975d309f895136dbd6e4b8a2 |
| Contemporaneous Starter listing (26918 bytes) | 71ab8924382e7ded966257362da60be94e9b57686bcf80eb09e319cd364e819f |
| Contemporaneous restart (369146 bytes) | 9f58f135777cf40ca54e292da849e80c842797260c71f20b00cc66116e6870e1 |
| Engine listing | 0842a86198ddd2a9af8a5f5fde84d6dde2b4e6dc4a3daa2c1da78eb63fc979ea |
| Authentic T01 (15024 bytes) | e54941f8330344ebd6e5ada798a2f30e1d6b7d52783a5536235b2e113a5dfa4d |
| Ordered stdout/cycle trace | 380563f3aa1c87d09e98b7e6da95d2f42e9b8d3fcfbf38ab183434afbfa1de04 |
| Immediate Engine output pin | b5a51874817b64478f299e18fde23b55386c2d97727cca7d9eff9cccfb7ca8a0 |

Engine exit=0, NORMAL TERMINATION, **235 actual cycles**, no signal/error.
Authentic THICODE 3040 direct recovery verifies complete record envelopes,
22 globals, ten expected nodes, DX/VX/AX/raw REACX, finite values and ordered
identities/times. Raw impulse is retained and support forces use unchanged
forward/centered/backward differentiation summed over fixed nodes.
Six authentic timesteps (s), in encountered order:
2.1295559804457298e-7, 2.1295558383371826e-7,
2.1295556962286355e-7, 2.1295555541200883e-7,
2.1295554120115412e-7, 2.129555269902994e-7.
Printed cycle steps round to 2.1296e-7; actual variation is preserved.

### Scheduled coverage and all frozen analytical gates

Fifty authentic frames: first=0, first positive=1.0647780754879932 us,
last=49.19274215353653 us. All expected samples match frozen hist2.F
replay using the complete actual cycle trace. Next threshold=50 us;
eligible cycle=235 at 50.044455 to 50.045465 us, beyond stop. No forced
exact-stop sample is required. Coverage does not rely on nominal/average
step, expected cycle/frame count or invented time tolerances.
Oracle/plan digests are unchanged from the coarse/medium records.

| Mandatory gate | Fine measured statistic | Frozen target/limit | State |
| --- | --- | --- | --- |
| History coverage | Every scheduled authentic frame present | Complete actual-cycle replay | PASS |
| Finite state | All required values finite | No NaN/Infinity | PASS |
| Initial conditions | DX=VX=0 at all ten nodes | <=1e-9 mm / 1e-5 mm/s | PASS |
| Arrival | 19.16600376716815 us; error 0.5824138909633474 us | T=19.748417658131497 us; error <=5.162639129670872 us | PASS |
| Transit displacement | 0.0005014164586706693 mm at 20.017825590912253 us; error 1.4164586706693315e-6 mm | 0.0005 mm; error <=0.00013182100048329253 mm | PASS |
| Return displacement | 0.0009588137618266043 mm at 39.1838293580804 us; error 4.118623817339574e-5 mm | 0.001 mm; error <=0.00025792483639958135 mm | PASS |
| Guarded pre-arrival reaction | Maximum 15.164045461210522 N | <=10 N | **FAIL** |
| Support plateau | Median -202.6603162455071 N; 100% in band; median error about 1.330158% | -200 N +/-30%; >=75% within +/-40%; >=3 samples | PASS |
| Fixed-node DX/VX/AX | Maxima 0 / 0 / 0 | <=1e-9 mm / 1e-5 mm/s / 1 mm/s2 | PASS |
| KE+IE versus work | Maximum residual 0.6205937038969019%; finite/nonnegative KE/IE | <=15% | PASS |
| Applied work | Maximum normalized residual 6.577908856359032e-8 | <=2% | PASS |
| Mass conservation | Constant 7.79999973019585e-5 Mg; variation 0; reference error about 3.46e-8 | Constant mass; relative error <=1e-6 | PASS |
| No added mass | Constant -5.421010862427522e-20 Mg initialization roundoff; change 0 | No positive addition; frozen roundoff bound | PASS |

The failed sample is signed support reaction -15.164045461210522 N at
17.036447388818488 us. The unchanged formula yields S=1.212955598044573 us,
guard=2.425911196089146 us, pre-arrival cutoff=17.32250646204235 us:
that sample is included. The preceding sample at 16.184625565074384 us
is -5.622445086161407 N. These are observations, not a completed diagnosis
of numerical dispersion, 3D wave propagation or derivative-stencil effects.
The frozen measurement cannot be excluded or its tolerance relaxed afterward.

### Three-level results (no rerun of coarse or medium)

| Quantity | Coarse 0.9 | Medium 0.6 | Fine 0.4 |
| --- | --- | --- | --- |
| Actual step range, us | 0.4791499463863147-0.4791501169165713 | 0.31943329759087646-0.3194334112777142 | 0.2129555269902994-0.21295559804457298 |
| Cycles | 105 | 157 | 235 |
| Arrival / error, us | 19.16600376716815 / 0.5824138909633474 | 19.16600376716815 / 0.5824138909633474 | 19.16600376716815 / 0.5824138909633474 |
| Transit displacement / error, mm | 0.0005057677141545945 / 5.767714154594457e-6 | 0.0005049567456201945 / 4.956745620194464e-6 | 0.0005014164586706693 / 1.4164586706693315e-6 |
| Return displacement / error, mm | 0.000958302747070167 / 4.169725292983305e-5 | 0.0009590595145709802 / 4.094048542901984e-5 | 0.0009588137618266043 / 4.118623817339574e-5 |
| Pre-arrival maximum, N | 7.425373613290017 | 6.410666723848161 | 15.164045461210522 |
| Plateau median, N | -202.5227599946099 | -203.64460108452903 | -202.6603162455071 |
| In-band percentage | 100% | 100% | 100% |
| Maximum energy residual | 2.1655278167876373% | 0.964212787642462% | 0.6205937038969019% |
| Maximum applied-work residual | 5.1405851853704655e-8 | 5.1655950999130213e-8 | 6.577908856359032e-8 |
| Mass variation, Mg | 0 | 0 | 0 |
| Added-mass change, Mg | 0 | 0 | 0 |
| Independent mandatory outcome | PASS | MEDIUM_PASS | **FINE_FAIL** |

The five medium-to-fine comparisons are **not evaluated/admitted** because
FINE_PASS is a prerequisite. Frozen bounds remain: arrival one quarter of
smaller arrival tolerance; transit/return one quarter of smaller respective
displacement tolerance; plateau median 15 N; energy residual 0.0375.
No conclusion of STABLE or SENSITIVE is allowed even if small-change metrics
would be acceptable. Complete frozen study state is **FAILED**.

Focused checks: changed fixture syntax; sealed fine preparation assertions;
one Starter with immediate output pins; corrected listing/model/load and
resource admission; artifact/runtime immutability before Engine; one Engine
with immediate output pins; strict authentic direct reader; actual-cycle
coverage; all unchanged oracle gates; retained baseline authentication;
final T01 rehash; git diff --check. Execution/recovery checks PASS; the
pre-arrival physical gate FAIL is retained without retry. No expensive or
unrelated suites ran. Coarse/medium/feasibility evidence stays current;
the formerly PENDING_FINE study is now FAILED, not promoted or reinterpreted.

Next bounded item: **no-solver diagnosis of the retained fine pre-arrival
support reaction, derivative stencil and frozen sampling/guard behavior**.
Use existing authentic histories only, preserve all frozen outcomes, and do
not adjust the oracle or rerun a solver without a new explicit request.
Provider/browser/MCP admission remains closed; proof_of_concept and
engineeringUsePermitted:false unchanged. No commit, push, deploy or promotion.

## No-solver fine pre-arrival reaction diagnosis (2026-10-01)

**Historical v1 timestep study remains FAILED; no retroactive change.**
The new focused diagnostic independently authenticates all three retained
T01 hashes, cycle traces, medium/fine contemporaneous artifact pins and
original gate outcomes through the unchanged direct reader and v1 oracle.
All required source-backed coverage and finite-state checks remain intact.
No Starter, Engine, Gmsh, CalculiX, converter, new mesh or broad suite ran.

### Material-derived wave speeds and interpretation

Mg-mm-s is consistent: 1 Mg*mm/s2 = 1 N and MPa/(Mg/mm3) = mm2/s2.
For E=200000 MPa, nu=0.3, rho=7.8e-9 Mg/mm3:
mu=E/[2(1+nu)]=76923.07692307692 MPa;
lambda=E*nu/[(1+nu)(1-2nu)]=115384.61538461538 MPa.
The distinct rod and bulk wave relations follow isotropic elasticity;
see [Feynman, Elasticity section 38-4](https://www.feynmanlectures.caltech.edu/II_38.html)
and the [NBS rod cross-section reference](https://pmc.ncbi.nlm.nih.gov/articles/PMC5315337/).
A thin-rod extensional event is not the earliest 3D continuum disturbance.

| Reference | Formula | Speed, mm/s | Transit, us |
| --- | --- | --- | --- |
| Rod/extensional | sqrt(E/rho) | 5063696.835418333 | 19.748417658131497 |
| Bulk P/dilatational | sqrt((lambda+2mu)/rho) | 5875097.04481518 | 17.020995438407406 |
| Bulk shear | sqrt(mu/rho) | 3140371.4651066386 | 31.843366656181314 |

The flagged 17.036447388818488 us sample is 0.015451950411081688 us
(15.451950411 ns) after theoretical P arrival. This is much less than the
1 us history spacing: correlation supports, but does not uniquely prove,
a physical P-wave precursor in this coarse 3D mesh. The observed -50 N
transition at 19.16600376716815 us is distinct from that first flagged sample.

### Raw impulse onset definitions (diagnostic only)

An exact nonzero is not automatically material or a physical arrival. To
avoid selecting a fitted new tolerance, report both earliest exact nonzero
raw impulse and the first completed interval with |delta I/delta t|>10 N,
reusing the already frozen 10 N scale for observation only. This is not
an altered acceptance criterion or an instantaneous-force assertion.

| Level | First exact raw nonzero, us / N.s | First raw interval-average magnitude >10 N, endpoint us / N | First derived magnitude >10 N, us / N | First derived <=-50 N, us / N |
| --- | --- | --- | --- | --- |
| Coarse | 5.270651400 / -1.060912132e-17 | 17.24940375 / -10.87063973 | 17.24940375 / -17.96068414 | 19.16600377 / -67.66110598 |
| Medium | 3.194334113 / +6.068782822e-24 | 17.24940375 / -10.45962534 | 17.24940375 / -17.16490440 | 19.16600377 / -64.49301531 |
| Fine | 2.129556151 / +8.425916664e-28 | 18.10122558 / -20.38658267 | 17.03644739 / -15.16404546 | 19.16600377 / -58.85093346 |

Tiny impulses well before P arrival cannot be called a physical continuum
wavefront; numerical leakage/roundoff/dispersion contributes to the tail.
The fine raw material interval spans 17.036447389 to 18.101225578 us;
it does not establish an exact pointwise onset within that interval.
All five fixed nodes have negative growing impulses around the critical
region. At the 2 N equal-share diagnostic scale (10 N divided by five,
not a new gate), fine node 45 crosses at 17.036447389 us, the four corner
nodes at 18.101225578 us. This reflects unequal nodal distribution, not
an isolated sign-flipped spike. Exact microscopic nonzero tails begin
at fine 2.129556151 us for corners and 3.194334113 us for node 45.

### Exact unchanged differentiation stencil

At the failed frame, the centered derivative is:
R=(I(18.10122557799332 us)-I(16.184625565074384 us))
  /(18.10122557799332 us-16.184625565074384 us).
Summed impulses at those endpoints are -4.563150071135169e-6 N.s and
-3.362655979799456e-5 N.s; intermediate I(17.036447388818488 us)
is -1.1919371218027663e-5 N.s.

The preceding interval averages -8.635868372753015 N, the following
-20.38658267107187 N. Weighting by interval duration gives contributions
-3.838161899878709 N and -11.32588356133181 N, totaling
-15.164045461210522 N. Thus the later interval contributes about 74.7%
of this labeled force; using only the preceding interval gives a magnitude
below 10 N. This explains threshold crossing by the existing noncausal
centered stencil, not an incorrect implementation or permission to replace
it. A synthetic step-impulse test independently demonstrates the same
forward-looking labeling effect. No derivative or physical tolerance changed.

### Summed histories around onset

All impulses are raw verified provider N.s; increments are against the
previous authentic frame. All shown force stencils are centered. The
full JSON retains endpoint identities/impulses for every stencil and node.

| Level | Time, us | Raw support impulse, N.s | Previous-frame impulse increment, N.s | Derived support force, N |
| --- | --- | --- | --- | --- |
| coarse | 15.33280192 | -1.485037387E-06 | -1.150039097E-06 | -2.590100831 |
| coarse | 16.29110375 | -5.299187933E-06 | -3.814150546E-06 | -7.425373613 |
| coarse | 17.24940375 | -1.571652206E-05 | -1.041733412E-05 | -17.96068414 |
| coarse | 18.20770376 | -3.972263539E-05 | -2.400611334E-05 | -37.33620044 |
| coarse | 19.16600377 | -8.72750843E-05 | -4.75524489E-05 | -67.66110598 |
| coarse | 20.12430377 | -0.000169401912 | -8.212682769E-05 | -108.0845252 |
| coarse | 21.08260378 | -0.0002944298867 | -0.0001250279747 | -153.5419043 |
| medium | 15.01336919 | -9.860584385E-07 | -7.641133237E-07 | -2.269699556 |
| medium | 16.29110375 | -5.297071766E-06 | -4.311013328E-06 | -6.410666724 |
| medium | 17.24940375 | -1.532053079E-05 | -1.002345903E-05 | -17.1649044 |
| medium | 18.20770376 | -3.819532776E-05 | -2.287479697E-05 | -35.53145802 |
| medium | 19.16600377 | -8.34201237E-05 | -4.522479594E-05 | -64.49301531 |
| medium | 20.12430377 | -0.0001618026417 | -7.838251804E-05 | -103.6188911 |
| medium | 21.08260378 | -0.0002820160917 | -0.0001202134499 | -148.4946264 |
| fine | 15.11984738 | -1.143392893E-06 | -9.162083678E-07 | -2.036088638 |
| fine | 16.18462557 | -4.563150071E-06 | -3.419757178E-06 | -5.622445086 |
| fine | 17.03644739 | -1.191937122E-05 | -7.356221147E-06 | -15.16404546 |
| fine | 18.10122558 | -3.36265598E-05 | -2.170718858E-05 | -32.29668377 |
| fine | 19.16600377 | -8.069698015E-05 | -4.707042035E-05 | -58.85093346 |
| fine | 20.01782559 | -0.0001464202596 | -6.572327948E-05 | -100.9053814 |
| fine | 21.08260378 | -0.0002740922355 | -0.0001276719759 | -145.3845572 |
### Fine per-fixed-node histories

All shown stencils are centered; endpoint times/impulses are retained in
the diagnostic JSON. Columns include raw impulse, not only differentiated
force, so the onset and per-node ownership remain auditable.

| Time, us | Fixed node | Raw impulse, N.s | Previous-frame increment, N.s | Derived force, N |
| --- | --- | --- | --- | --- |
| 16.18462557 | 1 | -8.44611634E-07 | -6.310372385E-07 | -1.033537543 |
| 16.18462557 | 2 | -8.56065185E-07 | -6.432710222E-07 | -1.060599411 |
| 16.18462557 | 3 | -8.637416045E-07 | -6.450386252E-07 | -1.057239908 |
| 16.18462557 | 4 | -8.630751722E-07 | -6.492462887E-07 | -1.073196341 |
| 16.18462557 | 45 | -1.135656476E-06 | -8.511640033E-07 | -1.397871883 |
| 17.03644739 | 1 | -2.194452463E-06 | -1.349840829E-06 | -2.77609693 |
| 17.03644739 | 2 | -2.245539008E-06 | -1.389473823E-06 | -2.867777748 |
| 17.03644739 | 3 | -2.245009E-06 | -1.381267396E-06 | -2.843067114 |
| 17.03644739 | 4 | -2.270717005E-06 | -1.407641832E-06 | -2.913823557 |
| 17.03644739 | 45 | -2.963653742E-06 | -1.827997266E-06 | -3.763280113 |
| 18.10122558 | 1 | -6.165279046E-06 | -3.970826583E-06 | -5.90638026 |
| 18.10122558 | 2 | -6.352448054E-06 | -4.106909046E-06 | -6.107835904 |
| 18.10122558 | 3 | -6.312764071E-06 | -4.067755071E-06 | -6.051891075 |
| 18.10122558 | 4 | -6.447709438E-06 | -4.176992434E-06 | -6.226483276 |
| 18.10122558 | 45 | -8.348359188E-06 | -5.384705446E-06 | -8.004093258 |
| 19.16600377 | 1 | -1.477242222E-05 | -8.607143172E-06 | -10.77347574 |
| 19.16600377 | 2 | -1.525251992E-05 | -8.900071862E-06 | -11.11489904 |
| 19.16600377 | 3 | -1.513285224E-05 | -8.820088169E-06 | -11.03565114 |
| 19.16600377 | 4 | -1.553036418E-05 | -9.082654742E-06 | -11.35417643 |
| 19.16600377 | 45 | -2.000882159E-05 | -1.166046241E-05 | -14.5727311 |
| 20.01782559 | 1 | -2.68137228E-05 | -1.204130058E-05 | -18.53753576 |
| 20.01782559 | 2 | -2.765526369E-05 | -1.240274378E-05 | -19.00595684 |
| 20.01782559 | 3 | -2.746369319E-05 | -1.233084095E-05 | -18.96162764 |
| 20.01782559 | 4 | -2.820912414E-05 | -1.267875996E-05 | -19.4283385 |
| 20.01782559 | 45 | -3.627845581E-05 | -1.626963422E-05 | -24.97192268 |
At 17.036447389 us, nodes 1/2/3/4/45 contribute respectively
-2.776096930, -2.867777748, -2.843067114, -2.913823557 and -3.763280113 N.
Node 45 contributes about 24.8% of the total; no single node dominates.
Signs, steadily increasing negative impulses and corner similarity support
a coherent face response. The retained sampling cannot uniquely separate
physical 3D wave content from coarse-mesh dispersion.

### Why v1 singled out fine

Coarse/medium did not miss the response: they report -17.960684143 and
-17.164904400 N at 17.249403754 us. Their v1 cutoffs are 16.790117424
and 17.109550836 us, excluding those eligible frames. Fine's cutoff is
17.322506462 us, including its 17.036447389 us frame. All three show the
same gradual early rise. No uncontrolled timestep instability is established.
The guard is rod transit minus a timestep-dependent sampling allowance;
in medium/fine it reaches beyond the earliest P-wave arrival. The **oracle
is mismatched** if this rod-based guard is interpreted as a no-3D-disturbance
window; it is not a provider-failure diagnosis.

### State/energy correlation and limits

At fine 16.184626, 17.036447, 18.101226 and 19.166004 us respectively:

| Time, us | KE, N.mm | IE, N.mm | External work, N.mm |
| --- | --- | --- | --- |
| 16.184626 | 0.02043433487 | 0.02049537376 | 0.04094737023 |
| 17.036447 | 0.02150703222 | 0.02191045322 | 0.04343492910 |
| 18.101226 | 0.02273401245 | 0.02363954857 | 0.04639151320 |
| 19.166004 | 0.02372649312 | 0.02468531951 | 0.04843203723 |

There is no energy jump localized to the flagged frame. Loaded motion is
finite and oscillatory, fixed DX/VX/AX remain exactly zero. Mass is invariant
7.79999973019585e-5 Mg, added-mass change zero; no positive mass addition.
Full-history energy residuals remain coarse 2.165528%, medium 0.964213%,
fine 0.620594%. Required state is finite; both processes terminated normally.
The listing lines containing ERROR are cycle-table column headings, not
abnormal solver messages. These checks argue against solver instability;
they do not prove spatial wave accuracy or convergence.

### Bounded diagnosis and next oracle decision

Established classification: **DIFFERENTIATION/SAMPLING_EFFECT**, with an
**oracle-definition mismatch** between earliest bulk disturbance and dominant
rod response. **PHYSICAL_3D_PRECURSOR** is consistent with timing/coherence,
not uniquely proven. Numerical precursor tails are also present; exact
physical-versus-dispersion allocation remains unresolved at this mesh/output
resolution. No evidence supports calling the run unstable solely from 15 N.
Historical **v1 FINE_FAIL / study FAILED** is preserved unchanged.

A separately versioned v2 oracle is physically justified, with this proposal:

- Compute earliest P-wave time from live verified E, nu, rho and length,
  separately from rod transit; use actual full impulse-stencil support.
- Apply the unchanged 10 N quiet-window criterion only where the entire
  stencil lies before P arrival, with a predeclared sampling-width guard.
- Treat the P-to-rod region as a 3D precursor/transition region, not a
  forced-zero 1D window; distinguish raw interval onset from labeled force.
- Retain dominant rod timing, displacement, approximately -200 N plateau,
  finite-state, fixed-motion, work/energy, mass and no-scaling gates.
- Establish any quantitative precursor-amplitude/shape requirement from
  an independent 3D reference or an explicitly diagnostic-only lane, not
  from the already observed values. Do not simply raise the old 10 N limit.

This increment does **not** freeze an incomplete quantitative v2 oracle or
re-evaluate outcomes under one. Two bulk speeds do not uniquely determine
this finite-cross-section mixed-mode precursor amplitude. Next bounded item
is **no-solver v2 oracle definition/freezing**, including physical windows,
stencil attribution and the explicitly limited precursor semantics. Only
then may retained data be evaluated and, if all three pass that separate
version, the unchanged medium/fine sensitivity comparisons be assessed.
No v2 PASS/STABLE/SENSITIVE is claimed; v1 remains FAILED.

Focused validation: wave-speed/Lame/SI dimensional assertions; constant-force
impulse differentiation; centered onset-stencil test; non-finite rejection;
three authentic T01/coverage replays; exact per-node derivative identities;
unchanged v1 gate equality; stencil decomposition; final raw-file hashes;
syntax and git diff --check. PASS. A synthetic exact-equality assertion
initially exposed IEEE decimal rounding (-50.00000000000001 vs -50);
only that test uses a machine-epsilon bound after correction. No physical
oracle or production algorithm was changed. Protected source evidence is
unchanged; new diagnostic JSON is separate. No solver or broad suite.
Provider/browser/MCP admission remains closed; proof_of_concept and
engineeringUsePermitted:false unchanged. No commit, push, deploy or promotion.

### Separate retained v2 reevaluation and timestep sensitivity (2026-10-01)

**v2 STABLE; v1 FAILED remains permanent historical evidence.** The v2
definition freeze above preceded evaluation (18:16:23.575Z vs
18:20:46.190Z). Its independent synthetic tests read no retained histories.
No v2 definition/budget was modified after retained evaluation. The loader
verified freeze/file hashes, unchanged inherited v1 plan, exact original
model/material/FACE/load/deck/mesh/runtime bindings, authentic T01 and
cycle-trace hashes, normal Engine exit, and medium/fine contemporaneous
artifact pins before evaluation. It independently replayed the strict
3040 direct decoder and source-backed variable-cycle coverage, never
nominal/average dt coverage. Original reports/gates replay exactly.

Each retained run has 50 authentic frames and first time 0. Coarse last
time is 49.35245669912547 us; medium/fine last time 49.19274215353653 us.
All next eligible output cycles are beyond 50 us; complete coverage PASS.
Cycles: 105 / 157 / 235. All original binary artifacts, original reports,
v1 modules, thresholds and frozen sensitivity plan remain unchanged.

| Mandatory v2 gate | Coarse 0.9 | Medium 0.6 | Fine 0.4 | Unchanged requirement / v2 semantics |
| --- | --- | --- | --- | --- |
| Pre-P raw-impulse interval quiet | PASS, 3.9801140354 N | PASS, 3.3739506473 N | PASS, 3.2117085161 N | Magnitude <=10 N; 16 intervals each; complete end<=tP |
| Dominant rod arrival | PASS, 19.1660037672 us | PASS, 19.1660037672 us | PASS, 19.1660037672 us | Trigger <=-50 N; tRod 19.7484176581 us; error 0.5824138910 us |
| Transit displacement | PASS, 0.0005057677142 mm | PASS, 0.0005049567456 mm | PASS, 0.0005014164587 mm | Target 0.0005 mm; errors 5.767714e-6 / 4.956746e-6 / 1.416459e-6 mm |
| Return displacement | PASS, 0.0009583027471 mm | PASS, 0.0009590595146 mm | PASS, 0.0009588137618 mm | Target 0.001 mm; errors 4.169725e-5 / 4.094049e-5 / 4.118624e-5 mm |
| First-reflection plateau | PASS, -202.5227599946 N | PASS, -203.6446010845 N | PASS, -202.6603162455 N | Target -200 N; median within 30%; all three 100% within 40%, required >=75% |
| Energy balance | PASS, 0.0216552782 | PASS, 0.0096421279 | PASS, 0.0062059370 | Maximum normalized residual <=0.15 |
| Applied work | PASS, 5.140585e-8 | PASS, 5.165595e-8 | PASS, 6.577909e-8 | Maximum normalized residual <=0.02 |
| Fixed-node motion | PASS | PASS | PASS | Existing DX<=1e-9 mm, VX<=1e-5 mm/s, AX<=1 mm/s2 |
| Mass conservation | PASS, change 0 | PASS, change 0 | PASS, change 0 | Existing relative <=1e-6 |
| No added mass | PASS, change 0 | PASS, change 0 | PASS, change 0 | Original invariant roundoff policy; no actual addition |
| Finite state | PASS | PASS | PASS | Complete finite direct-reader quantities |
| Zero initial conditions | PASS | PASS | PASS | Original zero-state gate |
| Source-backed history coverage | PASS | PASS | PASS | Replay authentic actual-cycle trace; complete records |
| Provider/source/runtime provenance | PASS | PASS | PASS | Existing authentic evidence rebound; normal exit 0 |
| Reaction-channel integrity | PASS | PASS | PASS | Exact node identities; per-node raw I and original derivative agreement |
| Precursor mandatory checks | PASS | PASS | PASS | Finite/provenance/fixed motion/mass/no addition/normal completion/channel integrity; no amplitude gate |

All **16 mandatory v2 gates PASS for each level**. The unchanged arrival
limits are 5.4288336485 / 5.2691169429 / 5.1626391297 us. Transit displacement
limits are 0.0001345168667 / 0.0001345168667 / 0.0001318210005 mm; return
limits 0.0002552290163 / 0.0002552290163 / 0.0002579248364 mm. No threshold
was adjusted to obtain these outcomes.

**Precursor diagnostics (no amplitude PASS/FAIL target):**

| Quantity | Coarse | Medium | Fine |
| --- | --- | --- | --- |
| Maximum absolute interval-average force fully inside [tP,tRod] (N) | 49.6216723200 | 47.1927325841 | 44.2067848772 |
| Maximum absolute centered force with nominal timestamp in [tP,tRod) (N) | 67.6611059809 | 64.4930153123 | 58.8509334587 |

Nominal precursor centered samples may have temporal support crossing the
rod event: these magnitudes must not be described as fully precursor-only.
The separate report preserves summed raw impulse, every per-fixed-node
contribution, sign coherence, interval endpoints, boundary crossers and
all derivative types/indices/times/support. Region A classification is
based on complete raw consecutive intervals only, without an extra guard.
The 10 N bound remains inherited development noise/small-response tolerance,
not a derived precursor amplitude. Earlier raw tails remain bounded
numerical evidence, not proof of an exact continuum arrival time.

**Five unchanged medium-to-fine sensitivity comparisons (eligible only
after all three independent v2 assessments PASS):**

| Quantity | Absolute change | Frozen absolute limit | Normalized change | Result |
| --- | --- | --- | --- | --- |
| Dominant arrival | 0 s | 1.2906597824e-6 s | 0 | PASS |
| Transit displacement | 3.5402869495e-6 mm | 3.2955250121e-5 mm | 0.0070110697 | PASS |
| Return displacement | 2.4575274438e-7 mm | 6.3807254067e-5 mm | 0.0002457527 | PASS |
| Plateau median | 0.9842848390 N | 15 N | 0.0048333461 | PASS |
| Maximum energy residual | 0.0034361908 | 0.0375 | 0.0229079389 | PASS |

Denominators remain max(abs(medium),abs(fine),frozen physical scale).
**V2 timestep study STABLE**, a bounded fixed-mesh sensitivity conclusion,
not a claim of formal convergence order, mesh convergence, production
provider integration or engineering qualification. **V1 study FAILED**:
the original fine centered quiet maximum 15.164045461210522 N exceeded its
frozen 10 N rod-based gate. That record is neither overwritten nor renamed.

Authentic T01 SHA-256 identities (unchanged):

- Coarse: `9820d44c10179aa4bb838500abc86c856a2e275c0bd134bd8d1d255d0b8a2c46`.
- Medium: `a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559`.
- Fine: `e54941f8330344ebd6e5ada798a2f30e1d6b7d52783a5536235b2e113a5dfa4d`.

New isolated report `v2-retained-reevaluation.json` SHA-256:
`f78751e4f86146354e36342904383e253e93f2788af0016d78aaa0c85838079e`.
It retains the freeze receipt hash, runtime/deck/mesh/source pins,
original report hashes, full stencils, old v1 evaluations, separate v2
evaluations and five comparison results. No authenticated input was edited.

Focused checks: new synthetic v2 oracle tests (causality equality/crossing,
stencil classification, precursor/no amplitude gate, rod/plateau, malformed
and nonfinite histories, STABLE/SENSITIVE/FAILED and unchanged budgets);
`scripts/test-sim9-openradioss-retained-oracle-v2.mts` for three authentic
T01/provenance/coverage replays and frozen sensitivity comparison; node
syntax checks for the three new files; git diff --check. No solver,
converter, historical suite or broad regression. Previous evidence is
not stale: v2 is a separate added definition/evaluation, not a relabeling
of historical evidence. Provider/browser/MCP admission remains closed;
proof_of_concept, engineeringUsePermitted:false unchanged. No commit,
push, deploy or promotion.

### Provider-private OpenRadioss Bridge integration foundation (2026-10-01)

**Implemented; focused no-solver lifecycle evidence PASS. Real Bridge-level
solver execution PENDING.** This is additive integration, not a reclassification
of the retained numerical evidence. Standalone feasibility/analytical PASS,
historical axial_bar_oracle_v1 FAILED and separate v2 STABLE remain unchanged.
No solver, converter, mesher, browser or historical suite ran in this increment.

Canonical files added:

- `src/simulation/explicitDynamicsProviderContracts.ts`.
- `providers/openradioss/OpenRadiossDeck.mts`.
- `providers/openradioss/OpenRadiossInstallation.mts`.
- `providers/openradioss/OpenRadiossStarterAdmission.mts`.
- `providers/openradioss/OpenRadiossProcess.mts`.
- `providers/openradioss/OpenRadiossResult.mts`.
- `providers/openradioss/OpenRadiossExplicitSolverProvider.mts`.
- `scripts/test-sim9-openradioss-private-provider.mts`.

The existing concentrated-load helper accepts an optional expected resultant
(default 100 N); section selection, row comparison and numeric tolerance are
unchanged. Its default preserved behavior is exercised with the retained listing.
Direct binary decoding, derivative/scheduler algorithms and benchmark oracles
were not modified. Private TunaCAD compatibility entry points were not duplicated.

**Scope and owner boundary.** Same sealed explicit contract: one positive-density
isotropic linear elastic rectangular solid, C3D4 mapped to linear one-point
TETRA4, fixed opposite FACE, positive axial step FACE force, zero initial motion,
no contact/plasticity/damping/mass scaling/large deformation/multidomain. The
unchanged bounded reader fixes ten monitored node identities; therefore this
adapter rejects other layouts and accepts only 88 nodes / 208 positive tetrahedra
with fixed nodes [1,2,3,4,45] and loaded nodes [5,6,7,8,46]. It independently checks
actual connectivity/Jacobians, owned boundary facets, rectangular volume, positive
lumped mass and complete fixed/load face areas. It is not arbitrary mesh or full
3D nodal-field support. The frozen 12-place deck formatting is preserved: if its
rounded weighted loads miss the existing 1e-12 N resultant bound, admission
rejects (a 50 N serialization example is covered); no rounding tolerance is
weakened to broaden admission. No analytical qualification gate is in execution.

`OpenRadiossHost` is an internal trusted owner dependency, not caller study data:
it must read existing authorization, freshly rebind request/mesh/revision/source
at submit, Starter, Engine and retrieval, and retain hash-chained receipts in
protected storage separate from scratch. Authorization is consumed once per
provider instance. There is no default unprotected sink or public approval/bypass
option. This increment defines the private lifecycle, not a browser route or new
durable restart/replay service. Future concrete owner wiring remains separate.

**Installation.** Explicit absolute root and exact `exec/starter_win64.exe` /
`exec/engine_win64.exe` paths, supported 2026 version, expected SHA-256 values and
required extlib/hm_cfg_files/licenses/COPYRIGHT are mandatory. Required CFG,
units/messages and runtime DLLs are bounded and fingerprinted. Redirected paths,
variants and wrong identities reject. Environment uses OPENRADIOSS_PATH,
RAD_CFG_PATH, RAD_H3D_PATH, KMP_STACKSIZE=400m, OMP_NUM_THREADS=1 and selected DLL
directories. No install, download, broad machine search or executable version
probe was performed. Configuration is separate from sealed study data.

**Lifecycle/provenance.** queued -> running Starter -> Starter admitted -> Engine
admitted/running -> result validated pending cleanup -> succeeded, or terminal
failed/cancelled quarantine. Prelaunch receipts bind study/run/request/mesh,
source/material/runtime, exact decks and expected model/loads. Immediately after
process return, before parsing, capture OS exit, bounded stdout/stderr digests,
listing/restart/Engine input digests and sizes. Starter exit/model/units/material/
mass/load/property interpretation and native nodal estimate must pass. BCS binds
the exact emitted trusted group plus accepted count; the listing does not
enumerate all membership, so output fixed-node motion is checked separately.
Rehash listing/restart/decks, runtime and freshly rebound source immediately at
Engine launch. No retrospective restart provenance and no automatic retry.

Provider-native `/DT/NODA 0.6 0` must be below the admitted native critical
estimate, declared maximum and history interval. Expected and actual increments
remain <=20,000 (or smaller request cap). The controlled retained medium gives
157 cycles; actual-cycle dt range is recovered from the ordered trace, not only
sampled T-file values. OS quotas: one active job, one thread, 60 s CPU/wall per
stage, 1 GiB memory, 8 MiB logs, 512 MiB scratch, 65 s independent stage watchdog;
installation fingerprints bounded to 10,000 files / 400 MiB. At most 16 retained
jobs per provider instance and 64 scheduled history frames. No CST/AMS or nonzero
minimum timestep. Positive actual added mass, mass drift/nonfinite state reject;
unchanged direct-reader initialization roundoff remains explicitly retained.

**Cancellation/cleanup.** Native driver uses existing Windows Job Object quotas
and kill-on-close containment with bounded taskkill whole-tree termination /
wrapper-close confirmation. Tests use controlled wrapper + two-descendant mocks,
including late exit 0. Queued/Starter/Engine/final-receipt cancellation cannot
publish a result; Starter cancellation cannot launch Engine. Unconfirmed tree
termination or cleanup/retention failure blocks publication and remains failed,
not falsely cleaned cancellation. Source change during retrieval causes sticky
quarantine. Actual Windows process-tree termination is still PENDING real evidence.

**Normalized result.** Solver-neutral schema 0.1 binds study/run/request/revision,
body/domain/geometry/material, provider/runtime, mesh, provenance/artifacts and
result digest. Completed/cleanup flags are added only after actual cleanup.
All authentic frames retain axial nodal DX (mm), VX (mm/s), AX (mm/s2), raw
impulse (N*s), independently derived force (N), summed support response, kinetic /
internal / external-work energies (N*mm), total/added mass (kg), cycle evidence
and scheduler-coverage digest. Requested times identify nearest authentic frames
without interpolation. Five nodal quantities are deterministically pageable by
result/domain/frame/quantity; page bound 128, dataset/chunk digests and
dataset-bound cursors reject cross-frame reuse. These ten monitored X samples
must not be labeled full-mesh displacement vectors. No converter or oracle is
in the acceptance path.

**Focused validation.**

- `TUNACAD_OPENRADIOSS_MEDIUM_SOURCE_DIR=<retained medium directory> node scripts/test-sim9-openradioss-private-provider.mts`: PASS, 26 scenarios; controlled process mocks only. Covers contract/deck/installation rejection, exact frozen deck bytes, authentic 3040 plus controlled 4021 recovery, Starter/Engine failure, load interpretation, restart/deck/runtime/source tampering, budget, malformed/nonfinite/mass/coverage failure, cleanup/retention failure, whole-tree cancellation and cancellation wins over late completion, result/paging integrity and sticky source quarantine.
- `node --check` for eight new files and the directly affected load helper: PASS.
- Isolated strict tsc for the provider: BLOCKED by existing Buffer/BinaryLike errors in unchanged `openRadiossBinaryHistoryRecovery.mts:8` and `openRadiossBinaryTFileParser.mts:166`; no unrelated parser/type repair attempted.
- Earlier directly affected `test-sim9-openradioss-starter-loads.mts` invocation: parser and retained-listing assertions passed; full command FAILED at its historical PENDING-provenance expectation when given the newer correctly PASS-provenance medium fixture. This is a fixture-precondition mismatch, not recorded as full test PASS, and was not rerun or repaired.
- Root/Bridge `git diff --check` and new-file whitespace check: PASS; no broad suite is implied.

Authentic medium T01 SHA-256 remains
`a679deb05ab2476afce7fe12d8c4eed5aaf7784065a497b68d24ff61972be559`;
50 frames / 157 cycles are reused as mapping fixtures, not new solver evidence.
The retained source T01 is reread and hash-checked unchanged at test completion.

**Next bounded item:** one separately approved real Bridge-level axial-bar run
through the default native process driver, concrete trusted approval/source owner
and protected evidence sink, contemporaneous provenance, direct reader, actual
cycle coverage, cleanup and normalized pages. A small run is justified by these
no-solver results but is not authorized or executed here. Concrete host evidence
retention/runtime launch behavior must be established by that run; real native
cancellation remains a separately bounded evidence item. Provider/browser/MCP
selection remains closed; proof_of_concept and engineeringUsePermitted:false.
No commit, push, deploy, publication or promotion.

### Approved real Bridge-level integration — blocked before submit (2026-10-01)

**Real Bridge-level provider execution: BLOCKED / not demonstrated.** This is
an installation-admission resource failure, not a new solver/physics FAIL.
The human authorization covered exactly one Starter then one conditional Engine
through the private adapter, no retry; neither executable was launched.

Added the explicitly opt-in `scripts/test-sim9-openradioss-real-bridge.mts`
fixture. Default preparation mode runs no solver. It pins the original 88/208
mesh and medium T01/trace, builds byte-identical existing Starter and medium
Engine decks, requires explicit configured paths / pinned executable identities,
and is designed to retain isolated owner/SYSTEM/Administrators-protected study,
receipt, raw T01/log/restart evidence and normalized results before scratch
cleanup. Its execution mode delegates to the actual private provider/native
Job Object driver, not the standalone probe; an exclusive execution claim
prevents retry of the same test attempt. None of these planned native execution,
protected-study publication or post-run result checks is claimed as passed here.

Before any launch, `--prepare-only` failed at
`OpenRadioss installation: fingerprint resource bound`. Installation inspection
selected 87 files totaling **456,155,074 bytes = 435.0234 MiB**; the adapter's
existing aggregate bound is **419,430,400 bytes = 400 MiB**. The selected maximum
file is 138,132,480 bytes (<256 MiB), and count is <10,000: the aggregate byte
bound is the blocker. The footprint was confirmed from read-only metadata of
the exact configured executables, required CFG/units/messages and the selected
runtime DLL directories, not a broad machine search. Installation was unchanged.
No repeat preflight or native execution was attempted after this rejection.

Evidence/state table:

| Gate | Outcome | Evidence / limitation |
| --- | --- | --- |
| Authentic retained mesh / medium T01 / trace identities | PASS | Fixture hash assertions before installation inspection; originals unchanged |
| Deterministic validated Starter / medium Engine decks | PASS | Same retained SHA-256 identities; /DT/NODA 0.6 0, 50 us, TFILE/4 1 us unchanged |
| Installed runtime fingerprint admission | FAIL / blocked | Actual 435.0234 MiB > existing 400 MiB cap; no policy weakening |
| Protected study / Bridge submit / run identity | NOT REACHED | No public receipt, submit result or run ID |
| Starter exit / interpreted admission / contemporaneous restart | NOT RUN | No Starter process |
| Engine exit / direct authentic T01 / cycle coverage | NOT RUN | No Engine process |
| Native normalized result / deterministic pages / scratch cleanup | PENDING | Requires an admitted real run; no completed result exists for this attempt |
| Native Windows process-tree cancellation | PENDING | Deliberately not exercised; earlier tests remain controlled mocks |

The provider now explicitly re-hashes T01 after direct parsing and binds
`t01UnchangedAfterParsing` / its digest to the validated-result receipt; a changed
artifact cannot pass that publication boundary. This is a narrow integrity
check, not a change to the direct reader, physics, numerical tolerances or
historical oracle. Its native execution validation remains PENDING.

Focused commands: `node --check` for the new real integration fixture and
directly affected private provider: PASS. New fixture `--prepare-only`: FAIL
at the stated installation-admission gate; no solver processes. Read-only
installed runtime footprint / active Starter/Engine check; root and Bridge
`git diff --check` plus affected-file whitespace/conflict checks. No complete
mock suite was rerun, and no oracle/refinement/historical/browser/converter test.

Next bounded item is **no-solver reconciliation of installed runtime
fingerprint scope/resource policy**. Establish which required files/identities
must be bound and an explicitly justified bounded hashing policy; do not
silently enlarge the cap or omit required libraries merely to pass. Then a
separately approved real Bridge-level run may be proposed. No automatic retry.
Existing standalone feasibility/analytical PASS, v1 FAILED, v2 STABLE and
26-scenario controlled adapter evidence remain unchanged, not stale. Provider /
browser/MCP/Companion/capability discovery remain closed; proof_of_concept and
engineeringUsePermitted:false. No commit, push, deploy, publication or promotion.

### Runtime-fingerprint policy reconciliation — no-solver PASS (2026-10-01)

Canonical roadmap bounded item: runtime-scope/resource reconciliation following
the real Bridge preflight's historical 400 MiB block. Complete per-file audit,
source basis, category totals, installed PE imports and conservative limitations:
[SIM9_OPENRADIOSS_RUNTIME_MANIFEST_AUDIT.md](SIM9_OPENRADIOSS_RUNTIME_MANIFEST_AUDIT.md).

The original aggregate limit was an uncommitted adapter literal bounding work,
not a special source-integrity threshold. Original 87 files / 456155074 bytes:
7 Starter runtime (291003304), 1 Engine (138132480), 1 shared OpenMP (1614184),
72 configuration (1423442), 5 unresolved DLLs (23980288), 1 copyright notice
(1376). Documented/conditional required closure alone totals 432173410 bytes,
already >400 MiB. No precision/MPI/GUI/converter binaries contribute. Static
imports and official INSTALL/Intel documentation support the closure; exact
loaded-module evidence is not claimed. Unresolved DLLs remain pinned, not removed.

Outcome B is a finite 512 MiB ceiling for complete hashing including the separate
notice. Runtime manifest policy `openradioss-win64-2026-runtime-manifest/0.1`
contains exactly 86 approved relative paths, no caller-supplied set or recursive
installation trust. COPYRIGHT is presence/size checked and fully hashed as
separate compliance metadata. 256 MiB per file, 10000 entries/files, 1024
directories, eight components, exact executable paths and SHA pins, strict
duplicate/traversal/search-root checks and ancestor redirect rejection remain
independent controls. Every inspection streams the complete content in 1 MiB
chunks; same-size/same-time edits cannot reuse cached trust. Enumeration and
file-handle/path metadata are checked before/after hashing. Environment and
selected non-MPI executables are unchanged. New policy-bound pins require new
explicit preparation; old identities/records are not silently upgraded.

| Gate | Outcome | Evidence |
| --- | --- | --- |
| Original exact 87-file classification/hashes | PASS | Read-only audit; per-file table and retained JSON digest in dedicated audit document |
| Justified finite byte budget | PASS | Required closure >400 MiB; all 435.0234 MiB still hashed under 512 MiB |
| Manifest/path/content policy | PASS | 21 focused no-solver checks; exact/below/above, count/size, missing/unexpected/duplicate/traversal, junction, changed same-size/time bytes |
| Installed Bridge fingerprint-only preflight | PASS | Exact 86 runtime paths / 456153698 bytes + notice1376; zero studies created, zero processes executed |
| Real native Bridge provider completion/cleanup/paging | PENDING | No Starter/Engine execution; previous blocker now resolved only at preflight |
| Real native process-tree cancellation | PENDING | No native cancellation run |

Manifest digest:
`sha256:64019bec8c2f46a8431c8976db6c3664f162376f59ef1c2edca7f229a8e1208b`.
Versioned runtime digest:
`sha256:65d76caa5f3c9d83f2092d51505d92f14abe5ca4a10a540876d11e595afd7b36`.
Isolated audit JSON SHA:
`91302abe1c356bb401adf4d63ca704d9bdd12319251cfb242eb5675914d480ce`.
Isolated preflight JSON SHA:
`612d2d4194e300c9e04a50da82f6a10f6e44077056d870c58fba947f770279d7`.

Focused commands: `node scripts/test-sim9-openradioss-runtime-policy.mts` PASS,
21 checks, fake executable files never launched. Explicit installation-root /
Starter-hash / Engine-hash environment plus
`node scripts/check-sim9-openradioss-runtime-preflight.mts` PASS; fingerprint only,
no provider/study/child-process import. Syntax checks for manifest, installation,
audit, policy/preflight scripts and directly adjusted private fixture setup;
root/Bridge `git diff --check`. Isolated strict tsc of the four runtime-policy /
preflight modules PASS after resolving the directly introduced Buffer typing
with a bounded Uint8Array. Final installation preflight after the stream/stamp
correction PASS with unchanged manifest/runtime digests. The old 26-scenario integration suite was not
rerun; its fake installation setup only was updated for the stricter allowlist.
No solver, browser, oracle, convergence or historical suite was run.

Next bounded item: one separately approved real Bridge-level run through the
existing process/lifecycle path, freshly sealed runtime identity and protected
host evidence retention. Justified, not executed/authorized by this increment.
Existing standalone/analytical/v1/v2/T01 evidence remains unchanged, not stale;
old runtime pins are superseded only for new installation preparation. The
historical 400 MiB FAIL is preserved. Provider/browser/MCP/Companion admission
closed, proof_of_concept, engineeringUsePermitted:false. No commit/push/deploy/
publication/promotion; no changes to solver model, deck, T01, oracle or lifecycle.

### Real private Bridge axial-bar integration — PASS (2026-10-01)

Exactly one Starter and one conditional Engine through the actual private
provider abstraction and native Windows Job Object driver. This is real
Bridge-level execution, not standalone/mock, browser/MCP, human-interactive UI,
native cancellation, or formal qualification evidence.

Before any new study was published, the fixture's full installation inspection
required the exact approved 86-path manifest, 512 MiB aggregate / 256 MiB
individual policy, runtime bytes456153698, total hashing456155074 and:
manifest `sha256:64019bec8c2f46a8431c8976db6c3664f162376f59ef1c2edca7f229a8e1208b`;
runtime `sha256:65d76caa5f3c9d83f2092d51505d92f14abe5ca4a10a540876d11e595afd7b36`.
Runtime is freshly inspected again at submit and launch boundaries. Protected
host-owned study/request/source approval is freshly rebound; old runtime seals
are rejected, not upgraded. An exclusive execution claim prohibits attempt retry.

Identities:

- Study: `bridge-axial-c03cedd6-fe58-4558-8569-cf8f4a81b6ef`.
- Run: `db0ed2b1-e643-446a-bdd4-9fee7edf4afe`.
- Request: `sha256:4ae7d4bdbf02c34d2377b8a3786b5848078cf9611f992ba83b60eaf3442cf557`.
- Mesh: `sha256:d81aee88834696e291f3e4d0d0c3986d8d605d32851685a5a8dd6e6bc8d86c9f`.
- Provider: `tunacad-openradioss-explicit-private`, `0.1.0-poc`, runtime2026.
- Final normalized result: `sha256:c461b06dad98e5228c2360bdc2694bc5292c8a0715dcce3e49564972eb3876d6`.
- Protected study file SHA: `c91d244db3f6b24f90a55b49eb57d68ed2dfbebb1f73762c53daae3f86c8fbe8`.
- Preparation-pin file SHA: `2286174250141c7e8c6b7e651774c1584d41840b7acd5a96b17b9da3a8aab7ac`.
- Normalized-result file SHA: `e4e2a9ae3a5e3ba45447463f422206afc53b07c2e82384140b7cdac5de5af8e3`.
- Final-receipt file SHA: `6d25eaf830dd748a97c446b7dfb5858076f3ac3e05d754d7042b1f3c895d993f`.

The isolated retained storage has protected owner/SYSTEM/Administrators access;
records/binaries/local installation paths are not copied into the repository.
Its approval provenance is the explicit human authorization for this single
fixture, not a simulated browser approval or new public authorization route.

Actual provider transitions (UTC; not invented admission/recovery/cleanup states):

| Status / phase | updatedAt |
| --- | --- |
| queued / queued | 2026-10-01T21:24:02.064Z |
| running / starter | 2026-10-01T21:24:04.768Z |
| running / engine | 2026-10-01T21:24:25.164Z |
| succeeded / validated_completed | 2026-10-01T21:24:32.957Z |

Actual chained receipt capture times, distinct from status transitions:

| Receipt phase | capturedAt UTC |
| --- | --- |
| prepared | 21:24:02.075Z |
| starter_launch | 21:24:04.768Z |
| starter_output_pin | 21:24:22.401Z |
| starter_admitted | 21:24:22.417Z |
| engine_admitted | 21:24:25.157Z |
| engine_launch | 21:24:25.164Z |
| engine_output_pin | 21:24:30.181Z |
| result_validated | 21:24:32.929Z |
| finalized | 21:24:32.950Z |

Starter PASS: OS exit0, normal termination, correct Mg-mm-s material E200000 /
nu0.3 / density7.8e-9 Mg/mm3, 88 nodes / 208 TETRA4, mass7.8e-5 Mg (0.078kg).
Input I_tetra4=1000 / normalized part0 still means linear one-point tetra.
Fixed nodes [1,2,3,4,45]; X loads at nodes5/6/7/8 =16.66666666667 N each and
node46 =33.33333333332 N, resultant100 N within frozen1e-12 N tolerance.
Native nodal estimate5.3236366039543e-7 s, scale0.6 estimated step
3.19418196237258e-7 s, predicted157 cycles <20000; no mass-scaling config.

Contemporaneous pins captured before interpretation, then independently
rehash-verified before Engine:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Starter deck | 19087 | 58424691156acf7cd163a0fd5bc61c71a24fabdd186c799394a8bb79fc43324f |
| Starter listing | 26918 | ba60093d1e516754e6b65e645ca70e54022f75084b38d49cf2963e1c827fa3f9 |
| Starter restart | 369146 | 0df396682735a79c1f92113c6770c8ed71a0bff7a88c0ae3db3a1a981e2d77e7 |
| Engine deck | 146 | 8a20fe6add5f25384a9ddc4808d22240cf772d69cf7ee04e4c069e44f1c83536 |
| Engine listing | 32138 | af31ca18d3782c830a82997647ebc947e3122f5bc2e6ee8b2ab81daf2dcebc62 |
| Engine stdout / actual cycle trace | 24360 | f6cefacaa54899d3391e01a5e4eb40f31a58977c852187671d80213d635af5b2 |
| Authentic T01 | 15024 | c980b983667dfc3a831c15f7240d576b4e889f124fbf549128124b12a04a05c9 |

Engine PASS: OS exit0, normal termination, 157 cycles. Trace-reported distinct
step/range is [3.1943e-7,3.1943e-7] s; precision is the authentic E11.4 print
cell, not a claimed unrounded internal timestep. Direct T01 dispatch3040,
172 complete binary envelopes,22 globals,10 identified nodes, DX/VX/AX/REACX,
finite energies/motion and raw impulse -> deterministic derivative all PASS.
50 frames, first0, first positive1.27773364511 us, last49.1927421535 us.
The frozen hist2.F actual-cycle replay accepts scheduled coverage: next eligible
output cycle157 at printed-cell midpoint50.15143 us (bounds50.150925..50.151935),
beyond stop50 us. No exact-stop sample fabricated or carried forward. T01
rehash unchanged after parsing; source artifacts remain unchanged.

Integration comparison only (no new threshold, timestep study or qualification):

| Quantity | Bridge result | Retained medium | Outcome |
| --- | ---: | ---: | --- |
| Cycles | 157 | 157 | exact |
| Frames / first / last time | 50 / 0 / 49.1927421535 us | identical | exact |
| Weighted loaded displacement near transit | 0.000504956745620 mm | identical | exact; frozen tolerance PASS |
| Weighted loaded displacement near return | 0.000959059514571 mm | identical | exact; frozen tolerance PASS |
| Support reaction plateau median | -203.644601085 N | identical | exact; frozen tolerance PASS |
| All normalized frame data including energies/mass/impulse | identical | unchanged | exact |

Only binary record1's80-byte creation-time header differs from the retained T01
(Thu Oct1 21:24:29 versus17:22:05); every other binary record matches exactly.
Different whole-file hashes are preserved, not normalized into apparent identity.
Existing standalone feasibility/analytical PASS, v1FAILED and v2STABLE are not
changed or rerun.

Normalized result contains immutable study/run/request/revision/domain/body/
geometry/material/provider/mesh identities, duration, cycles, actual trace,
coverage/provenance/artifact digests, diagnostics, ordered motion/impulse/reaction/
energy/mass histories and cleanup-bound result digest. Raw impulse remains N*s;
derived force N, displacement mm, velocity mm/s, acceleration mm/s2, energy N*mm,
mass kg. Axial X at ten monitored FACE nodes only, not full-mesh3D vectors.

Additional recovered summaries:

- All monitored fixed DX/VX/AX maxima0 exactly.
- Last support impulse -0.00595626188442 N*s; derived reaction -198.626416011 N.
- Kinetic range0..0.0239621810615 N*mm; internal0..0.0954328402877 N*mm;
  external work0..0.0962416008115 N*mm; all finite.
- Constant mass0.07799999730196 kg, change0. Authentic constant negative added
  mass initialization roundoff -5.4210108624e-17 kg, later change0; no positive
  mass addition and actualMassScaling:false. Raw roundoff is not clamped away.
- Five fields displacement/velocity/acceleration/reactionImpulse/reactionForce:
 20 datasets at frame indices[0,20,39,49],80 pages,size3 (3/3/3/1),10 owned
 nodes each, identical repeated pages/dataset IDs/digests and chunk/full digests.
- getResult:null before success; repeat result/digest identical after completion
 and scratch cleanup,163 fresh result/source rebinds during retrieval/paging.
- Protected evidence retained; normal scratch directory absent after cleanup.
 cleanupConfirmed:true, final quarantine:false. No cancellation exercised.

Post-run no-solver receipt-chain check PASS: all9 digests/linkages and every
retained output artifact's size/SHA. Identity/provider/version/units/POC flags
PASS. One small fixture reporter defect found: object spread overwrote the
OS-exit record's at with launch time. Corrected for future receipts with separate
launchAt and return at; no retained record rewritten and no solver rerun. For
this run the authentic output-pin capturedAt above is the post-return timestamp,
not the launch-valued OS-exit at. Lifecycle transition timestamps are unaffected.
Focused no-solver timestamp serialization and syntax checks PASS.

Executed only fixture --prepare-only then --execute once, the directly related
post-run checks and root/Bridge diff checks. No Gmsh, CalculiX, converter,
browser/Chromium, refinement, historical, broad suite or second solver attempt.

**Next bounded item:** separately approved native Windows process-tree
cancellation / cleanup / late-completion quarantine evidence. Real cancellation
remains PENDING; this normal success does not establish it. Before browser/MCP
admission, concrete live TunaCAD host authoring/source/approval wiring and the
bounded result UI remain separate unimplemented validation/admission gates.
Protected-fixture retention is not general separate-process restart/replay.
Public/provider selection remains closed; proof_of_concept and
engineeringUsePermitted:false. No commit, push, deploy, publication or promotion.

## Native Windows process-tree cancellation — PASS (2026-10-01)

This supersedes only the preceding native-cancellation PENDING item. The real
successful Bridge path and earlier numerical/oracle evidence were not rerun.
One approved Starter followed by one Engine ran through the existing private
provider and native driver. No production provider, launcher, lifecycle,
authorization, runtime-manifest or numerical-model implementation changed.
The test fixture gained a cancellation-only mode and read-only witnesses.

Study `bridge-cancel-b72311f8-4a24-477c-93f7-20e50145b841`;
run `edc1707c-54b1-442c-ac35-19e3a432376a`. Protected diagnostic evidence is
retained outside Git under the local cancellation fixture directory. Its final
receipt SHA-256 is
`c6196faa9190ae51fbfcad7c4e8d6bad8a1cb278eb49b2ec659b756ef09efa03`.
Runtime manifest remains
`sha256:64019bec8c2f46a8431c8976db6c3664f162376f59ef1c2edca7f229a8e1208b`;
policy-bound runtime identity remains
`sha256:65d76caa5f3c9d83f2092d51505d92f14abe5ca4a10a540876d11e595afd7b36`.
Mesh identity remains
`sha256:d81aee88834696e291f3e4d0d0c3986d8d605d32851685a5a8dd6e6bc8d86c9f`.

The 88-node/208-TETRA4 mesh, materials, fixed nodes [1,2,3,4,45], five axial
loads totaling100 N, linear one-point formulation and DT/NODA0.6 0 are unchanged.
To allow reliable live ownership observation, the diagnostic-only ceiling is
6 ms and history cadence100 us (at most61 samples, below64). Starter exit0,
admission PASS: native estimate5.3236366039543e-7 s, scaled estimate
3.19418196237258e-7 s, predicted18785 cycles <20000; no mass-scaling configuration.
This deliberately interrupted run is NOT numerical/analytical validation.

### Actual launcher and cancellation mechanism

The native process port reports the PowerShell wrapper PID. The existing
Windows launcher assigns its solver to a Job Object with kill-on-close,
process/job memory and CPU limits, and no breakaway permission. Provider
terminateTree invokes taskkill /T /F on that wrapper and waits for closure;
closing the Job Object independently terminates remaining job descendants.
There is a launch-before-job-assignment interval; no stronger claim of an
atomic startup guarantee is made. At the actual cancellation point an independent
IsProcessInJob check proved the owned Engine was already in a Job Object.
This experiment observed both console descendants, not an invented arbitrary
solver worker topology. PID plus creation time prevents PID-reuse ambiguity.

| Native evidence | Recorded outcome |
| --- | --- |
| State sequence | queued/queued -> running/starter -> running/engine -> cancelled/cleaned_cancellation |
| First complete positive-time witness | 0.00010030208068201318 s; 1776-byte incomplete-history prefix, never normalized |
| Cancel request | 2026-10-01T21:58:12.844Z, running/engine |
| Wrapper | PID3260, parent fixture Node5880 |
| Owned Engine | PID11300, parent3260, exact audited engine path, job membership true |
| Owned descendants | wrapper conhost8060; Engine conhost9796 |
| Tree termination acknowledged | 2026-10-01T21:58:13.103Z; true |
| Interrupted process completion | Engine wrapper exit1; output pin at21:58:13.267Z, after cancellation |
| Terminal cancellation | 2026-10-01T21:58:13.300Z; exactly one cancelled transition |
| Independent post-cancel inventory | 21:58:14.2542142Z: all four owned identities absent; no OpenRadioss process alive |
| Unrelated witnesses | Explorer5396 and fixture Node5880 unchanged/alive |
| Process starts | exactly one Starter and one Engine; none after cancellation |

### Quarantine, result denial and cleanup

Cancellation marks the run cancelled/quarantined and clears candidate results
before terminating the active tree. The late native completion was pinned and
retained, then rejected by the existing alive guard before result recovery.
There is no result_validated receipt, normalized-result file or result digest.

| Quarantined partial artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Engine T01 | 5916 | 8e1935cda809e7be9249d4f0aa969982e09254d5243a89169913064674bd19d9 |
| Engine listing | 768499 | 48441c5c669045b46b2e0cf6f86477a457e0e45cbf71017641344c1a993b4571 |
| Bound restart | 369146 | 4b561f1bdf71caa98d1425d966cbeafbe342e08e637d27e4de7772685bc9d5e2 |
| Engine input | 146 | 026e9bec53b24997d0a573c284162abe02400096f6e70368f87ead90a5d4a1c0 |

The bounded positive-time witness prefix, Engine stdout/stderr, OS-exit
records, process-tree identities and protected quarantine catalog are retained
with receipt/artifact digests. The catalog declares incomplete:true,
publication:denied and resultDigest:null. Eight chained receipt digests and eight
artifact size/SHA pins independently rechecked PASS, including the witness hash.
Final lifecycle receipt is
`sha256:41a3b6cda65a700434cd6226613328408ce94da48f59b7830533ec713d143c9b`.

Native getResult returned null and all five field-page routes rejected, repeated
three times after completion; repeated cancel/status remained identical. No
cancelled->succeeded transition, second terminal transition or quarantine removal.
Normal scratch was absent after production cleanup, cleaned:true and
treeTerminated:true. No active provider run or global lock remains; the protected
per-attempt execution claim is deliberately retained as single-use evidence and
does not block a fresh study. A new solver study was NOT submitted to test readiness.

### Focused controlled checks and limitations

No-solver ownership/positive-record witness tests PASS (7 groups). Controlled
cancel_queued and cancel_starter PASS, including wrapper/worker-tree ack.
The first cancel_engine observer exhausted its old two-second mock wait while
still at Starter: a test observation timeout, not a native cancellation failure.
One bounded retry ran only the three unfinished cases with a ten-second observer
deadline; cancel_engine, cancel_final and cancel_tree_failure all PASS.
Already-passing queued/Starter cases were not rerun. Late exit0 and late
finalization are controlled evidence, distinct from the interrupted native exit1.
Tree-termination failure correctly remains failed/quarantined and blocks cleanup.
All controlled cases launch zero real solver processes. Syntax and scoped
whitespace checks PASS. No real retry, successful-path rerun, Gmsh, CalculiX,
converter, browser/MCP, Chromium, refinement or historical/broad suite.

**Next bounded phase:** live TunaCAD host-owned OpenRadioss authoring/source
binding and separate approvals can now be developed, followed by bounded result
presentation. Those concrete integration/admission gates and general restart/
replay are not established by this retained-fixture cancellation experiment.
Earlier numerical and real-success evidence is not stale. Browser/MCP/public
admission stays closed, proof_of_concept and engineeringUsePermitted:false.
No commit, push, deployment, publication or promotion.

## Private TunaCAD host preparation and separate approvals — implemented (2026-10-01)

This bounded increment stops at `validated Bridge request ready for submission`.
There is no Starter, Engine, Gmsh, CalculiX, converter or real CAD kernel run.
All earlier provider evidence stays frozen: standalone feasibility PASS,
analytical PASS, historical v1 FAILED, v2 sensitivity STABLE, real Bridge success
PASS, native Windows cancellation PASS, direct T01 recovery/paging PASS.

### Host ownership and exact engineering inputs

The private host factory/service (TunaCAD-owned, outside this public Bridge)
uses the existing document store, executor body/material/semantic readers and
native STEP export port. It is not registered in externalSimulationRuntime,
public menus, Companion discovery, MCP, production/public-beta metadata or UI.
Its trusted launch gate is `private_host_preparation_only`. Real dispatch always
throws; no provider instance, mesh generator or result viewer is constructed.

Choices contract `tunacad-private-simulation-authoring/0.1` admits exactly:
explicit_structural_dynamics, one component/body, engineering material ID,
distinct fixed/load semantic FACE IDs, positive bounded axial X step force
(other components zero), zero initial DX/VX, duration <=0.01 s, 2..16 strictly
ordered output times ending at duration, provider_native_nodal_stability policy
with20000 maximum increments, and mm-N-s-MPa-kg units. Unknown fields, raw cards,
mesh/request/digest input, unsupported physics and alternative units fail closed.
The sole currently supported host geometry is an identity-placed, current,
single box feature at local origin with valid one-solid native topology; linked,
suppressed, rolled-back, extra-domain and ambiguous-source models are rejected.
No arbitrary shape or full-mesh3D result support is implied.

Material is reread from the definition-owned engineering assignment, not visual
appearance or choices. Density must be positive; modulus converts GPa->MPa;
Poisson ratio and elastic constants pass the unchanged foundation schema.
Explicit source/provenance revision are required (no missing-data inference).
The foundation's declared CFL/resource bound remains secondary, not a substitute
for the existing provider-native actual-mesh/Starter admission before Engine.
No mass scaling, contact, plasticity, damping, initial motion or large deformation.
Provider history is still axial X at ten identified fixed/loaded FACE nodes.

### Immutable source chain

Preparation seals document-instance/model identity, current revision, monotonic
source epoch, trusted private-session fingerprint, component/body/domain,
native topology digest, separately resolved FACE reference IDs/ownership/
fingerprints, full engineering-material property/provenance digest, canonical
source digest, study-parameter digest and unit-system digest. Native inspection
uses12 unique edges/24 per-face uses and6 owned faces. A semantic result must
be valid, unique, owned by the exact body and match its stored signature exactly;
the host does not silently accept a nearby signature or remapped FACE.
Fixed/load selections must be complete opposing planar axial faces.

Local preparation STEP reads are ephemeral trusted source inspection only, as
in the established host pattern. They are NOT an approved transfer, solver input
or dispatch. Canonical identity reuses the frozen narrow native STEP policy;
exported raw bytes retain their own separate SHA-256. No identity policy changes.
Every boundary rereads the complete source with before/after revision/epoch/
session guards. Change-and-restore CAD events invalidate the preparation too.
Provisional seals remain private and are removed on failure; no study identity
is published before the final source rebind passes.

Chain: live source -> prepared study/request seal -> browser geometry approval
-> fresh approved export (raw/canonical digests) -> trusted host validated mesh
record -> separately approved solve binding -> fresh consumed Bridge-ready request.
Mesh records are independently read via a trusted host-store port, never passed
in authoring. They must match export ID/bytes, canonical source, full source
binding, FACE mapping/validation digest and exact experimental88/208 C3D4 layout.
Missing records fail closed; this increment does not generate or fabricate a
production mesh capture. Actual live capture remains part of the next private test.

### Two separate human authorization boundaries

The private host browser-controller method follows the existing generic
prepare/confirm pattern, and is never an MCP approval method. Geometry approval
binds purpose geometry_transfer, preparation/study, full source binding and
sealed request; it is session/revision/epoch-bound, expiring and one-use,
including concurrent/replayed confirmations. It grants only exact geometry
export/transfer ownership, never solver execution. Export is freshly rebound
before and after obtaining bytes; approval cannot authorize regenerated geometry.
Preparation and approval summaries contain verified canonical identity.

The existing Bridge now optionally returns an INTERNAL private approval port;
default disabled, with no new HTTP route or discovery entry. It uses the same
paired Bridge session, human approve callback and terminal controller, with
single-use120 s authorization. Session revoke/expiry invalidates approvals.
The strict private solve envelope binds source, sealed study/request/contract,
consumed geometry authorization, exact export and trusted mesh identities,
provider ID/version, runtime version and manifest/policy digests. No executable
paths or raw solver keywords leave the provider configuration boundary.
Only one human terminal question may be pending, including public/private paths.
Geometry authorization cannot be consumed as a solve authorization.

The host freshly rereads source and mesh/provider identities before requesting
solve approval, after its callback, immediately before consuming it and afterward.
Bridge independently verifies current provider/runtime and pairing. Expired,
replayed, foreign-study/session, regenerated-export, substituted-mesh/runtime
or changed-source requests never fall back to a weaker binding. Observed stale
session/expiry is sticky even if a controlled test restores its old value.
Host-owned parameter edits invalidate the old preparation; changed force or
duration/output requires a new study and approvals.

Bridge-ready output `tunacad-private-simulation-bridge-ready/0.1` contains a
strict `tunacad-private-simulation-solve-approval/0.1` binding (foundation request,
source, geometry, mesh, provider, consumed geometry evidence) plus consumed
solve authorization/digest/expiry. dispatchEnabled:false, proof_of_concept,
engineeringUsePermitted:false. No result/job is claimed or retrievable here.

### Evidence and next bounded gate

| Lane | State | Evidence / limitation |
| --- | --- | --- |
| Host engineering choices/source/semantic preparation | PASS | Controlled kernel I/O with actual TunaCAD store/executor/semantic resolver |
| Canonical source/export and immutable mesh record binding | PASS | Controlled STEP serialization and trusted-store fixture; no native export or meshing claim |
| Separate geometry and Bridge solve gates | PASS | Private host controller, actual Bridge pairing/session/approval callback; controlled human callbacks |
| Stale/mutation/tamper/expiry/single-use/replay rejection | PASS | Focused no-solver tests, no bypass flag or raw-card route |
| Neutral sealed Bridge-ready request | PASS | Existing foundation validator/sealer agrees, dispatch explicitly disabled |
| Live native TunaCAD preparation/export/real protected mesh capture | PENDING | Not exercised; requires its own bounded live-source test |
| Real human interactive confirmations | PENDING | Controlled callbacks are not human approval evidence; AGENTS operator-guidance ordering remains mandatory |
| Real host-approved provider dispatch / public result UI | CLOSED | Deliberately outside this increment |

Focused `node scripts/test-private-explicit-host.mjs` PASS51 checks. It covers
stale revision/epoch/body/FACEs/material/session, changed-and-restored source,
exact versus similar FACE resolution, export mutation, changed force/controls,
mesh/geometry/runtime/provider substitutions, both approval purposes, expiry,
reuse, foreign study/session, post-approval fresh reads and existing pairing/
revocation. It also proves competing public authorization is blocked during the
private terminal question and no explicit endpoint/capability was added.
The initial controlled Part setup had a foreign random definition ID/rollback0;
correcting only the fixture made it a current self-owned Part, with no guard
weakening. Final focused checks PASS, no unrelated failures.

Isolated strict TypeScript core service/approval check PASS; changed Bridge
syntax and in-memory browser-safe host compile PASS, with no Node/provider
runtime import. The unchanged explicit schema/wave function were mechanically
separated into a browser-safe contract module; existing foundation exports and
Node sealing/reference behavior remain equivalent. Existing runtime/provider,
deck, parser, CFL, cancellation and normalization algorithms were not modified.
Scoped diff/whitespace checks PASS. No historical or broad test reruns.

**Next bounded item:** one private live TunaCAD prepare -> operator-guided
geometry confirmation -> trusted approved export/mesh-store binding -> separate
Bridge approval -> freshly rebound Bridge-ready request check, still without
solver dispatch. It is justified but has not run; native export or mesh generation
requires separate approval if needed. Browser/MCP/public admission and result
presentation stay closed. No commit, push, deploy, publication or promotion.

### Private live-flow readiness review — blocked before preparation (2026-10-01)

Read-only inspection of the current host/Bridge call sites found that the private
host factory is instantiated only in the controlled no-solver fixture. There is
no live private operator controller supplying authenticated session, protected
mesh-store and provider ports, or exposing the real geometry-confirmation action.
The standard Bridge CLI includes a private terminal prompt branch but leaves the
optional private approval port disabled. This is a missing integration entry
point, not evidence of a failed native CAD model or provider.

Outcome: `LIVE_PRIVATE_CONTROLLER_UNAVAILABLE`, a readiness blocker rather than
an executed runtime rejection. No live preparation or export was produced; neither
human approval was requested or consumed. Live document/model/revision/epoch,
FACE/material/source identities, study/export/mesh digests, runtime revalidation
and a final Bridge-ready digest are NOT CAPTURED. Exact live protected-mesh
availability was not testable, so `MESH_BINDING_PENDING` was not a reached outcome.
Old 88/208 retained mesh evidence must not be reassociated with a new export by
similarity or by a controlled reader that manufactures source/export linkage.

The prior51 controlled source/approval/tamper/replay checks remain valid but are
not live or real-human evidence; they were reused without rerunning. No production
implementation, source-binding rule, approval policy or provider changed. Existing
standalone/analytical/Bridge/cancellation evidence remains current. No browser,
CAD mutation/export, human or automated approval, Gmsh, solver or converter ran.

Next bounded prerequisite is PRIVATE live operator-controller wiring with trusted
ports and an actual geometry-confirmation affordance, keeping dispatch and public
registration disabled. After that, resume the live flow; if no exact protected
approved-export/mesh binding exists, stop at `MESH_BINDING_PENDING` and require
separate mesh-generation/capture approval. Live/native and real-human evidence
remain PENDING; proof_of_concept and engineeringUsePermitted:false are unchanged.

## Private operator-controller wiring — implemented, controlled checks (2026-10-01)

The prior LIVE_PRIVATE_CONTROLLER_UNAVAILABLE finding is preserved above as a
historical readiness review. Internal controller code and a minimal opt-in DOM
panel now exist in the private host. The controller instantiates the actual
TunaCAD live-reader factory; it does not construct trusted source identities from
authoring input. Choices cannot supply revision, epoch, session, topology,
geometry or material digests. Existing native body/material/semantic FACE/STEP
readers and the unchanged canonical policy provide those identities.

States: idle -> prepared -> awaiting_geometry_confirmation -> geometry_approved
-> awaiting_mesh_binding -> awaiting_bridge_approval -> bridge_approved ->
bridge_ready. Terminal states stale, expired, cancelled, rejected and
mesh_binding_pending cannot transition back to usable state. Transition guards
freshly reread source; displayed mesh/provider bindings cannot change while the
operator is considering the separate Bridge approval. Final output has its
canonical digest and dispatchEnabled:false. Dispatch always throws and neither
controller nor panel imports or calls a provider-submit/process API.

The private panel displays exact identities, units, material, FACEs, force,
duration, current stage/expiry and scope-specific guidance before exposing each
action. Geometry confirmation and Bridge approval remain separate. Production
UI handlers ignore synthetic DOM events; no automatic approval is provided.
Controlled tests call controller methods with controlled human callbacks and are
not real human-interactive evidence. AGENTS conversation guidance still applies.

### Internal Bridge launch and trusted readers

`privateExplicitOperatorBridge.mts` is opt-in owner configuration only. It
requires a private purpose and loopback browser origin; the existing server still
binds127.0.0.1 and enforces exact Host/Origin, HMAC pairing, expiry, single use,
revocation and prompt serialization. Standard/public CLI private approval remains
disabled. The default internal launcher requires an interactive terminal; trusted
callback injection follows the existing human-callback seam used in tests, not a
request flag or auto-approval endpoint. No provider instances are constructed.

An explicit host-port bootstrap joins that paired-session identity to the real
read-only runtime installation fingerprint and protected mesh-store reader. Its
expected runtime manifest comes from trusted launch configuration, never study
input. Full existing runtime fingerprinting repeats on reads; no installation or
execution occurs. No private ports or session keys are exposed through HTTP.

Protected record schema `tunacad-private-explicit-protected-mesh/0.1` binds study,
meshRevision, storageIdentity, full source and approved geometry/export identity,
plus the existing mesh/FACE-map/validation digests and88/208 C3D4 counts.
`privateExplicitMeshStore.mts` reuses protected host-storage configuration/ACLs.
It looks up an independent pin by a digest of the complete study/export/source,
then verifies record digest/storage identity and reloads the mesh artifact with
its digest, revision, canonical source, units, formulation and counts. Pin stability
is checked again before returning. A missing exact pin returns null; corruption
or invalid protection throws rather than becoming pending. There is no capture,
write, migration, reseal, fuzzy matching or mesh-generation API. Old retained
meshes are not authenticated to a new native export by this implementation.

### Focused evidence and live-readiness boundary

| Lane | State | Scope / limitation |
| --- | --- | --- |
| Private controller construction/live-reader wiring | PASS | Actual host/store/resolver factory, controlled kernel ports |
| Guided geometry and separate Bridge approval transitions | PASS | Controlled human callbacks; no native/manual evidence |
| Exact protected-record/artifact replay | PASS | Real file reader; isolated synthetic records with controlled ACL owner adapter |
| Missing exact mesh -> permanent MESH_BINDING_PENDING | PASS | No generation, no Bridge prompt, no provenance fabrication |
| Stale/expiry/replay/scope/identity/runtime substitution | PASS | Controlled mutations at each meaningful stage; terminal states sticky |
| Private launch opt-in and default-disabled behavior | PASS | Actual local HTTP pairing, wrong Host/Origin rejection, decline, single use and revocation |
| Bridge-ready digest and no-dispatch invariant | PASS | No provider constructed/submitted, dispatch throws |
| Real protected-storage provisioning and native mesh capture | PENDING | Not run; new read format is not a new capture |
| Real mounted/paired private TunaCAD operator embedding | PENDING | Mount API exists; ordinary app does not import or expose it |
| Real human live source/geometry/terminal approval flow | PENDING | No human approval requested or consumed |
| Provider/browser/MCP/public admission and solver dispatch | CLOSED | No scope/status changes |

Focused commands:

- `node scripts/test-private-explicit-host.mjs`: PASS85, including prior51 directly
  affected service/approval checks, actual store/resolver and local Bridge pairing.
- `node --experimental-transform-types external/TunaCAD-Simulation-Bridge/scripts/test-private-explicit-mesh-reader.mts`:
  PASS14, real file-reader logic with controlled isolated protection/store adapter.
- `node scripts/check-private-explicit-controller.mjs`: PASS changed-surface type
  diagnostics, syntax and private-panel in-memory browser compile with external
  third-party packages; not a full-project type/build qualification.
- Isolated strict core service/mesh-record/reader type check: PASS.
- Changed Node module syntax and scoped whitespace/conflict checks: PASS.

Check harness corrections: explicit guidance wording; Node TypeScript parameter
property transformation; unrelated third-party GCS bundling/type-library setup;
raw HTTP request replacing fetch for the Host-injection assertion (fetch rewrote
Host). An assertion-triggered Windows Node shutdown error accompanied that failed
test; the corrected raw-request test exited cleanly. No production guard was
weakened and no unrelated environment repair/broad validation was attempted.

The live controller has NOT been mounted/paired in an actual TunaCAD window.
The Node-owned trusted ports still require an internal local embedding; no public
transport was added to make them browser-accessible. Therefore a manual live
validation is conditional, not yet advertised as ready in ordinary TunaCAD.
Next bounded prerequisite is that trusted local private bootstrap/mount, followed
by the no-solver live/operator validation; missing exact mesh provenance must
stop at MESH_BINDING_PENDING and require separate capture approval.

Earlier standalone, analytical, sensitivity, Bridge and cancellation evidence
remains current; physics, provider/deck/CFL/result recovery are unchanged. No
Starter, Engine, Gmsh, CalculiX, converter, native kernel, Chromium, broad or
historical suite, commit, push, deployment, publication or promotion ran.
proof_of_concept and engineeringUsePermitted:false remain unchanged.

## Trusted local private bootstrap/embedding (2026-10-02)

The missing browser-to-Node bootstrap now exists in the private TunaCAD host.
This supersedes the **code reachability blocker**, not the historical live
readiness finding or any unperformed native/manual evidence. No public Bridge
API, MCP capability, simulation menu, hosted origin or solver dispatch is added.
The public Bridge change is an internal paired-window HMAC verifier returned only
to its trusted owner, plus wiring that verifier through the private launcher.
The normal CLI still leaves private approval disabled and constructs no new
explicit provider through this path.

### Ownership, narrow transport and lifecycle

Node owns the controller/service, paired-session identity, document instance and
source epoch, source/material/FACE fingerprints, canonical STEP digest, protected
mesh reads, runtime fingerprints, approval issuance/consumption and final sealing.
The browser client displays Node state and supplies choices or raw read-only
observations from its actual CAD store/executor/kernel. It does not compute trusted
identities or receive filesystem/runtime-reader/approval-authority callbacks.
Browser compilation explicitly checks that the Node authority modules are absent.

The message schema permits only state, prepare, present_geometry, confirm_geometry,
request_bridge, finish, cancel and close. Preparation uses the existing strict
choices schema. Every action is bound to the owner-paired session, controller ID,
current study and next sequence; source invalidation is sticky and transitions
freshly rebind source/material/FACEs/STEP. Browser-supplied revision, epoch, digest,
mesh, runtime, provider request and generic execution are rejected. Reverse CAD
reads are only context/body/material/face/step, correlated to pending owner reads.
Messages, source exports, pending reads, timeouts and sequence counts are bounded.

Lifecycle: disabled -> starting -> ready -> controller_attached -> stopping ->
stopped. Startup is explicit and validates trusted configuration. The existing
Bridge binds an OS-assigned loopback port distinct from the private browser
channel. Both enforce their exact loopback Host/Origin boundaries. One fresh
challenge is authenticated using the current paired-session HMAC; a second window
cannot take ownership. Pairing is not geometry/solve approval. Disconnect, cancel,
shutdown, invalid identity or session revocation closes the bootstrap and private
Bridge, aborts outstanding approvals/reads and revokes capabilities. No fallback
mode or fixture ports are accepted in launch JSON; test injection is constructor-
only and the production launcher always uses the real trusted owner.

The mounted panel keeps its existing guidance-before-action and trusted user
event checks. Geometry confirmation precedes the distinct terminal authorization.
No automatic approval is added. Exact protected mesh absence still returns
MESH_BINDING_PENDING without meshing, reassociation or a Bridge prompt. The only
successful endpoint remains bridge_ready / BRIDGE_READY_REQUEST_VALIDATED with
dispatchEnabled:false. There is no submit, process-launch or solver-card interface.

### Local opt-in procedure (not executed as live evidence)

Use an interactive local terminal and a trusted host-owned JSON configuration
outside the repositories. Required keys are enabled:true, mode:live,
purpose:private_explicit_operator_controller, allowedOrigin (exact loopback
workspace origin), expectedManifestDigest and installation
(root, starterExecutable, engineExecutable, runtimeVersion:2026, starterSha256,
engineSha256). These are trusted local configuration, never authoring inputs.
The native storage policy below supersedes the original caller-selected root:
protectedMeshStorageRoot is now rejected, not required. No manual path choice.
Set port:47839 for the current private browser entry. No private installation
paths, credentials, protected records or config file are embedded in this status.

From the private TunaCAD repository, explicitly launch:

```powershell
node scripts/run-private-explicit-bootstrap.mjs --enable-private-explicit --config C:\ABSOLUTE\PRIVATE\host-config.json
```

In a separate development terminal:

```powershell
$env:TUNACAD_PRIVATE_EXPLICIT_BOOTSTRAP = '1'
npm run dev
```

Open the matching local `/workspace` URL directly (full page load). Load the
existing bounded axial bar, assigned engineering material and exact semantic
FACEs; keep it idle. The unlisted panel is included only in this explicitly
enabled local dev entry. Pair using the code shown by the separate host terminal;
then prepare choices. Do not approve or run anything before the controller's
study-specific guidance. Any manual validation must also obey AGENTS conversation
guidance before readiness questions or approval requests. Geometry and terminal
approvals remain separate; this flow still cannot run Starter or Engine.
Close the panel/window or stop the private host to revoke its capability. Remove
the opt-in environment variable before returning to normal development startup.

### Focused evidence and remaining live boundary

| Lane | State | Evidence / limitation |
| --- | --- | --- |
| Panel and private browser entry compile | PASS | In-memory targeted compile; no Node authority in browser bundle |
| Normal startup / production exclusion | PASS | Actual config inspection; no full build or dev server |
| Launcher explicit flags / absolute config | PASS | Actual launcher argument guards; no runtime fallback |
| Bootstrap starts and owner contract attaches | PASS | Actual loopback WS/HTTP with controlled source/runtime/mesh/terminal ports |
| Session/Host/Origin/controller/study/replay/source/expiry guards | PASS | Focused controlled transport and directly affected controller checks |
| Cancellation/shutdown close/revoke both listeners | PASS | Actual controlled loopback shutdown/revocation |
| Actual panel mount / synthetic approvals ignored | PASS | Minimal controlled DOM, not a real window/human |
| Exact missing mesh fails pending, dispatch impossible | PASS | Controlled transition + schema rejects process/submit operations |
| Real protected host storage/runtime initialization | PENDING | Not provisioned/attached in this increment |
| Real TunaCAD-window panel mount and pairing | PENDING | Not observed; LIVE_OPERATOR_VALIDATION_PENDING |
| Real native source and two human approvals | PENDING | No human approval or native export performed |

Commands: node scripts/test-private-explicit-bootstrap.mjs (PASS20),
node scripts/test-private-explicit-embedding.mjs (PASS11),
node scripts/test-private-explicit-host.mjs (PASS85; directly affected factory and
internal Bridge proof seam), node scripts/check-private-explicit-controller.mjs
(changed-surface type/syntax and in-memory browser compile), and scoped module
syntax / git diff --check. These are not broad qualification or real-provider tests.
Earlier mesh-reader checks were reused because its implementation was unchanged.

The bootstrap is implemented, but actual-window readiness is not inferred from
compilation or controlled callbacks. A manual no-solver private validation is
now addressable through this opt-in procedure, **conditional on trusted local
configuration, protected storage/runtime initialization and actual panel pairing**.
It is not recorded as an executed live PASS. Missing exact mesh provenance must
stop pending and require separate capture approval; historical 88/208 evidence
cannot be reassociated by dimensions or similarity.

Earlier standalone/analytical/sensitivity/Bridge/cancellation provider evidence
remains current. Source identity policy, physics, provider deck/CFL/history parsing
and numerical acceptance were not changed. No solver, Gmsh, converter, native
kernel, real browser, Chromium, full build, historical/broad suite, commit, push,
deployment, publication or promotion ran. Public/browser/MCP admission remains
closed; proof_of_concept and engineeringUsePermitted:false are unchanged.
Next bounded item: guided manual no-solver private local mount/pairing and trusted
live source/operator validation, contingent on actual protected record availability.

## Native per-user simulation storage audit/configuration (2026-10-02)

The no-execution repository audit found reusable protected lifecycle storage,
completion pins, durable host records and exact mesh readers, but no native
simulation root resolution/provisioning policy. The composed electrical provider
receives a storageParent; it does not choose a canonical application-data root.
Companion's user-profile .tunacad state convention and its state-directory
environment override hold cursors/device trust, not ACL-protected simulation
records. Historical temporary evidence stores are not production configuration.

The Node-only nativeSimulationStorage owner adds the versioned
windows-local-application-data/1 policy. A fixed Windows known-folder API query
resolves LocalApplicationData; the canonical relative namespace is
TunaCAD/Simulation/protected-v1. No username, provider path, browser value,
fixture fallback or environment storage-root override determines the location.
Temporary/repository roots and reparse/non-directory ancestry fail closed.
The existing ElectrostaticHostStorage schema and source-identity version are
reused without modifying lifecycle/persistence formats. Its configuration.json,
source-catalog/configuration.pin.json, directory identities and protected
owner/SYSTEM/Administrators DACL remain authoritative.

Explicit native provisioning creates only a missing canonical store. Existing
stores are opened/verified, never repaired, resealed, imported or migrated. An
incomplete existing root fails rather than silently recreating trusted state.
The private operator native factory receives storage from this owner; its launch
configuration no longer accepts protectedMeshStorageRoot. No browser authoring
choice can supply a root, trusted record, pin or mesh.

Private repository commands (no solver/runtime/browser startup):

```powershell
node scripts/check-native-simulation-storage.mjs --provision
node scripts/check-native-simulation-storage.mjs
```

Native persistent provision PASS; a fresh Node process reopened the store with
the same configuration digest. Existing ACL and exact-pin mesh adapters attached.
Explicit mesh pin files: 0; protected mesh record files: 0; mesh artifacts: 0.
Outcome MESH_BINDING_PENDING. No record was manufactured, copied from retained
temporary evidence, or reassociated by dimensions. Inventory is not authentication:
any future exact read still requires the live study/source/approved-export binding.
This does not prove a live window/source/session/controller attachment. Those
lanes remain PENDING; the current launcher stops at panel_attached, before
preparation/export/approvals. Solver dispatch remains disabled.

Focused pure policy/override checks PASS16 (no filesystem fixture stores), directly
affected native-port guard checks PASS7, strict launch configuration PASS5 (no
host/store startup), changed-surface type/syntax and in-memory
private browser compilation PASS, and scoped git diff --check. These commands
did not fingerprint the runtime again, start a Bridge/provider/browser, export CAD,
mesh, or run historical/provider tests. Existing numerical/physics evidence is
current. The previous manual root configuration instructions are superseded;
legacy captured records are not upgraded or imported. No commit, push, deployment
or promotion; proof_of_concept, engineeringUsePermitted:false and closed public
browser/MCP admission persist.

Next bounded item: guided no-solver real private local window/source attachment.
Missing exact protected mesh provenance must remain MESH_BINDING_PENDING; a mesh
generation/capture increment requires separate approval, never automatic Gmsh.

## Private geometry-confirmation and durable approved-export readiness (2026-10-02)

Outcome: LIVE_GEOMETRY_CONFIRMATION_READY (implementation and no-browser tests),
NOT an actual native/human geometry-confirmation PASS. The prior live attempt
stopped at LIVE_PRIVATE_PANEL_ATTACH_FAILED when browser inventory failed with
helper_sandbox_lock_failed / SetNamedSecurityInfoW error 5. That remains
infrastructure evidence only; application security and Windows permissions were
not changed to work around it.

Before: the live launcher allowed panel_attached only; approved STEP bytes were
held in memory. After: explicit geometry_export mode allows attach -> prepare ->
awaiting_geometry_confirmation -> geometry_approved -> approved_export_persisted
-> exact mesh lookup -> mesh_binding_pending when no capture exists. No Bridge
solve approval is requested in this mode, even if a matching mesh is found.
request_bridge/finish are denied, the solve button is hidden, and the native
approval callback refuses solve authorization. Providers remain null and dispatch
methods throw. No raw card, arbitrary path/upload/command, mesh generation or
provider-submit API was added. Normal/prod entry excludes the private panel.

Native ownership remains unchanged: Node independently reads the live model,
revision/epoch, paired session, component/body/domain, engineering material and
semantic FACE identities, and computes canonical STEP/source digests. Choices
cannot supply these trusted values. Geometry approval still expires, is single-use
and binds preparation/study/request/source identities. Source is reread before
consumption and before export; revision/session/material/FACE/geometry mutation
rejects before persistence. Source is also reread during capture before publishing
the final pin. Failed/interrupted captures have no published export pin; no reader
returns them as completed exports. Historical bytes/records are never overwritten
or silently repaired/migrated/resealed.

Storage remains the OS-known LocalApplicationData/TunaCAD/Simulation/protected-v1
namespace, resolved by the trusted Node owner. The existing protected storage
schema/ACL/configuration pin are unchanged. New receipt schema:
tunacad-private-approved-step-export/0.1. It carries export ID/digest/size,
preparation/study identity, the entire immutable source (document/model/revision/
epoch/session/component/body/domain/canonical digest/FACEs/material/units), sealed
request and digest, geometry approval ID/binding/expiry/consumedAt/used, explicit
geometry_export_only scope, unit system, creation timestamp and storage identity.
Files are derived only from a bounded export ID: results/<exportId>.step,
studies/<exportId>.json and source-catalog/<exportId>.pin.json. No caller filename.

STEP uses exclusive write and fsync, followed by bounded reopen/SHA-256/canonical
digest verification. Only then is the immutable receipt written and reopened.
The content/identity pin is last. An independently reopened storage/reader instance
verifies pin, receipt, bytes, source/request/approval binding and ACLs. Collision,
wrong bytes, tamper and missing durable owner fail closed. The service retains the
verified identities, not STEP bytes, after capture. Exact mesh lookup still binds
study/source and this particular export ID/byte digest, never dimensions or counts.
An empty store returns MESH_BINDING_PENDING and the future live endpoint is
LIVE_GEOMETRY_EXPORT_APPROVED_MESH_PENDING, not a Bridge-ready solver request.

Focused commands/results:

- node scripts/test-private-approved-export.mjs — PASS19, controlled source/STEP;
  real isolated Windows protected-store writes and fresh Node process readback.
  Canonical live storage was not populated with controlled exports.
- node scripts/test-private-explicit-bootstrap.mjs — PASS27, controlled source/
  runtime/store ports with real loopback pairing/WS; geometry-mode gates included.
- node scripts/test-private-explicit-embedding.mjs — PASS14, launch/Origin/opt-in
  guards and controlled DOM; no real browser/window or automated approval.
- node scripts/check-private-explicit-controller.mjs — changed-surface types,
  syntax and in-memory browser entry PASS; no Node authority bundled.
- Scoped runner syntax and git diff --check; read-only canonical native adapter
  attachment PASS (export reader/writer available, unchanged configuration digest,
  protected mesh inventory 0 / 0 / 0). No controlled export saved in that store.

The initial new test STEP string lacked the canonicalizer's frozen native PRODUCT
line break; test-only formatting was corrected, not canonicalization. New test
Buffer typing was replaced with Uint8Array; dependencies were not changed.
No broad/historical/solver suite, actual CAD export or browser automation ran.
Numerical/provider evidence is not stale; controller/export readiness evidence
above supersedes attachment-only limitations without claiming live approval.

### Future manual procedure (not executed in this increment)

From the private repository, in one normal unelevated terminal, explicitly enable
the local development entry with TUNACAD_PRIVATE_EXPLICIT_BOOTSTRAP=1 and run
npm run dev. In another normal terminal, use the private launcher:

```powershell
node scripts/run-private-explicit-bootstrap.mjs --enable-private-explicit --geometry-export --origin http://127.0.0.1:8080 --installation-root ABSOLUTE_MANUALLY_INSTALLED_OPENRADIOSS_ROOT
```

The installation root is trusted local runtime configuration, not protected
storage selection. Node derives executable fingerprints and must still match the
already validated runtime manifest; it does not run or reseal the installation.
The launcher prints http://127.0.0.1:8080/workspace and one-use pairing instructions.
Open that address in the normal browser, load the existing 100 x 10 x 10 mm bar
with engineering material and distinct fixed/load semantic FACEs, keep it idle,
and pair in the private panel. Pairing is not geometry/solver approval. Prepare
choices for 100 N, 50 microseconds, zero initial motion and bounded output times.
Before asking for any click, report the verified study/model/revision/epoch/FACEs/
material/control identities and the panel's guidance. Only then tell the operator
to click Confirm geometry transfer only. This authorizes durable STEP capture,
NOT meshing or OpenRadioss. Expect MESH_BINDING_PENDING and stop; no Bridge approval
follows. A later live check must follow AGENTS guidance-before-action and pause
for the genuine human click. The sandbox need not be bypassed or repaired for
normal manual use. Stop both terminals and remove the opt-in variable afterward.

Next bounded item: one live private native window/session/source preparation and
human geometry confirmation, durable export capture and exact mesh-pending stop.
No new meshing or solver approval is implied. Public browser/MCP admission stays
closed; proof_of_concept and engineeringUsePermitted:false; no commit/push,
deployment, publication or promotion.

## Controlled operator-approval development fixture (2026-10-02)

This supersedes the manual-click dependency for development testing only; it does
not claim that the pending real-window/human smoke test ran. TunaCAD's private
test runner uses explicit controlled_test_fixture configuration (not environment
selection) and labels all new geometry/Bridge approvals
approvalSource:controlled_test_fixture. Both gates pass through the production
source/approval/consumption transitions. The existing Bridge authority continues
enforcing current session/runtime, binding digests, expiry and single-use state.
The normal solve validator also authenticates the consumed geometry binding,
including fixture provenance. A geometry token cannot stand in for a solve token.

Live bootstrap JSON cannot select or instantiate this provider; live constructor
ports and returned receipts reject fixture provenance. Approval authority objects
are immutable. Isolated test export stores retain a protected fixture label;
normal live readers cannot open them, and capture rejects relabelled approvals.
No live fallback, auto-approval flag, public route or origin-policy change exists.
Human event.isTrusted browser handling and real terminal callback remain intact.

The no-solver fixture exercises prepare -> geometry consumption -> immutable STEP
write/hash/fresh reader -> exact protected mesh -> separate Bridge approval ->
BRIDGE_READY_REQUEST_VALIDATED. A second branch persists the export but stops at
MESH_BINDING_PENDING without calling the Bridge approval. Controlled observations
pass the production Node CAD/material/FACE/canonical STEP verifier. Mesh artifacts
are explicitly synthetic schema fixtures, not new Gmsh or physical-quality
evidence. Real isolated Windows protected-store readers verify their exact
study/export/source/artifact bindings. No canonical live storage is modified.

Focused command: node scripts/test-private-controlled-approvals.mjs — PASS24. Rejections
cover both gate substitutions, replay/expiry, foreign study, stale source epoch/
revision/session, changed material/FACE/geometry/runtime, tampered STEP/mesh,
fixture/human relabelling, live constructors/configuration and environment errors.
Directly affected no-solver host regression PASS85; bootstrap transport guards
PASS27; changed-surface type/syntax and in-memory browser isolation PASS. No
provider runtime was executed. Prior analytical/provider evidence remains current.

Manual action is not required to continue private implementation or test the
technical lifecycle. Final optional real human smoke evidence remains separate:
actual local window/kernel and session attachment, real click/terminal actions,
visible guidance/control state, and usability. Automated evidence cannot certify
those UI/operator facts. Solver dispatch and public browser/MCP admission remain
closed; proof_of_concept; engineeringUsePermitted:false. No commit/push/deploy or
promotion. Any real protected-mesh capture or solver execution still requires its
own explicit authorization; live mode never consumes fixture records as fallback.

## Explicit Gmsh configuration prerequisite — no execution (2026-10-02)

No verified absolute Gmsh path was found in the existing environment or saved
application/provider configuration. Test Providers previously retained selections
only in memory. Outcome: GMSH_PATH_CONFIGURATION_REQUIRED. No executable discovery,
Gmsh, CalculiX, Starter or Engine run was performed.

The authenticated local Bridge settings panel now supports Save paths (no
execution), including Gmsh independently of CalculiX, and persists successful
Test Providers selections. A native Node owner resolves Windows LocalApplicationData
to TunaCAD/Simulation/provider-settings.json, separate from protected simulation
records. Explicit absolute paths, file sizes and SHA-256 fingerprints are saved
atomically; reload rejects missing/changed binaries or malformed records. No
browser-provided storage root or automatic executable discovery is accepted by
the launcher. Explicit environment configuration remains supported.

No native settings were populated during validation. Focused settings tests
PASS25 (zero provider executions); browser save-only transport and changed-file
syntax checks are recorded separately. Configure Gmsh once through TunaCAD before
continuing the approved protected mesh-capture increment. Earlier numerical
evidence, origin policy, approval security, proof_of_concept and
engineeringUsePermitted:false remain unchanged; dispatch/public admission closed.

### Prerequisite resolved by native settings command (2026-10-02)

The operator supplied an exact external Gmsh executable; no discovery or
substitution occurred. configure:providers saves through the native owner and
reopens a new native reader, requiring identical paths, executable fingerprints/
sizes and settings-file identity before reporting GMSH_PATH_CONFIGURED_VERIFIED.
The prior GMSH_PATH_CONFIGURATION_REQUIRED finding is historical and now cleared;
this is configuration evidence, not executable-version or mesh-run evidence.
No actual provider executable was launched. CalculiX remains unconfigured.

The native command is available independently of browser pairing/build state;
the current TunaCAD source mounts its Bridge controls but gates Browse/Save on
pairing. No live-browser visibility pass is claimed. Focused no-solver command
tests PASS17 cover argument rejection, no root/discovery option, preservation of
other explicit settings, fresh-reader replay and changed-binary rejection.
Machine-specific values remain in native configuration, not public source.
Existing physics, approvals, numerical evidence and closed-admission status
are unchanged.

## Controlled native STEP / protected Gmsh capture (2026-10-02)

Exactly one authorized external Gmsh execution completed (exit 0), using
freshly verified native provider settings and an approved native CAD STEP.
This is controlled automated operator evidence, not human-interactive evidence.
The fixed 10 mm order-one configuration produced 88 nodes / 209 C3D4 elements;
historical 88/208 counts are not enforced by the neutral mesh capture contract.
Geometric admission passed unique finite IDs/connectivity, positive volumes,
one connected domain and complete exterior boundary ownership. Minimum volume
41.66666667 mm^3, total volume 10000 mm^3, mass 0.078 kg and minimum altitude
2.23606798 mm. Fixed and loaded end selections each have four facets and
100 mm^2 area; their trusted node sets are [1,2,3,4,45] and [5,6,7,8,46].

Protected schema 0.2 persists sealed request/source/revision/epoch, canonical
geometry, approved export, raw mesh, executable/settings/configuration,
pre-dispatch/post-exit receipts, cleanup and recomputed FACE/admission digests.
Fresh protected reopening independently rehashes the STEP and raw mesh,
reparses and revalidates mesh and mappings, and checks capture provenance.
Scratch cleanup passed before pin publication. Isolated test records remain
labelled controlled_test_fixture and cannot be consumed by live mode.
Legacy schema 0.1 is preserved separately; no conflicting record is overwritten.
Live mode receives no automatic mesher or fixture fallback.

Mesh capture and fresh-reader proof: **PASS**. Complete Bridge-ready flow:
**PENDING**, because the preparation expired during fresh separate solve-approval
rebinding. The production guard returned
PRIVATE_EXPLICIT_PREPARATION_INVALID: expired preparation. Controller state
expired; no solve approval or ready digest was returned. Expiry was not extended,
no process was retried, and no Starter, Engine, CalculiX or converter ran.
Retained protected diagnostic/mesh receipts permit subsequent no-solver diagnosis.
This failure must not be relabelled a successful Bridge-ready integration.

Focused new mesh tests PASS23; directly affected approval/lifecycle tests PASS24;
changed-file type check, in-memory fixture compilation and whitespace checks PASS.
Shared geometric checks were separated from CalculiX-specific CFL calculation;
the focused test preserves its prior result. Existing numerical evidence remains
current; the new native-export mesh has no OpenRadioss physical validation yet.
Next bounded item: no-execution lifetime/protected-read cost diagnosis, keeping
all expiry and approval boundaries intact. No further solver/mesher execution
is authorized. proof_of_concept; engineeringUsePermitted:false; dispatch and
public admission closed. No commit, push, deployment or promotion.

## Durable lineage / fresh solve authority — no provider execution (2026-10-02)

Retained authenticated approved STEP and protected mesh fresh-reader audit PASS;
no records were regenerated. Original preparation lifetime was exactly 120 s:
03:47:30.380 to 03:49:30.380 UTC. Geometry consumption 03:47:31.142;
STEP receipt 03:47:39.359 / pin write 03:47:42.460; Gmsh pre-dispatch
receipt 03:48:10.657 / post-exit receipt 03:48:26.468; initial admission
completed by 03:48:32.442; mesh record write 03:48:35.886 / pin write
03:48:37.020; failure receipt 03:49:34.852. Exact launch/exit, persistence-return,
geometry issuance and solve-attempt timestamps were not retained, so these are
markers/bounds only. Pin write consumed 66.640 s of the lifetime; another 53.360 s
remained before expiry. Failure was recorded 4.472 s after expiry. Pre/post Gmsh
receipt elapsed time includes trusted pre-launch work, not just provider runtime.

No TTL tuning. A private host-owned continuation now selects an approved export
by ID and freshly verifies sealed choices/request, historical consumed geometry
approval, protected export and exact mesh through trusted readers. Current
document/model/session/revision/epoch/body/domain/geometry/material/FACEs must
match exactly; controls, units and all digests remain bound. A new independently
expiring solve-binding record is sealed after verification, with its own ID and
export receipt digest. Old expired preparation remains expired. Separate Bridge
approval binds that new authority and expires no later than it. Existing approval
consumer remains the only authorization/consumption path; every use freshly
checks lineage/runtime, expiry, single-use and replay. No provider is called.
Geometry-only launcher mode still cannot enter solve rebinding. Original
preparation remains required for initial geometry approval and durable export
publication, but not for fresh authorization of an unchanged verified lineage.

Focused no-solver lifecycle/rejection tests PASS33; changed-file type/syntax and
whitespace checks PASS. They include one directly affected legacy approval path
and controlled synthetic observations reaching BRIDGE_READY_REQUEST_VALIDATED.
Do not confuse this unit evidence with authenticated native-study continuation.

Retained native study endpoint remains PENDING_SOURCE_ATTACHMENT: the original
process disposed/restored its CAD model and ended. Its stored session/document
cannot serve as current live truth. No fresh authentic authority or ready digest
is fabricated. Storage/provenance PASS is preserved separately from missing live
source evidence. Next: no-execution private source attachment/continuation review;
exact matching is mandatory, and changed/unprovable lineage requires new geometry
authorization. No new Gmsh, Starter, Engine, CalculiX, converter, browser or
historical suite ran. Prior numerical evidence remains current; proof_of_concept,
engineeringUsePermitted:false and public/solver admission closed. No promotion.

## Host source attachment / retained-study continuation review (2026-10-02)

Private TunaCAD host increment only; provider implementation, contracts and prior
execution evidence are unchanged. Internal attachTrustedSourceForContinuation
selects an export ID and reports SOURCE_ATTACHMENT_MATCHED / REQUIRED / MISMATCH /
STALE. Missing/unattested current source/study readers cannot use stored history
as authority. Current host study/request, load, duration/output, units and runtime
are read independently; existing CAD/kernel readers recompute source/FACE/material/
geometry identities. Protected readers reopen exact STEP/receipt/mesh and Gmsh
provenance. No new export pin, record copy/reseal, geometry approval, mesh or job.

An exact match seals a NEW 120-second solve binding only. Old preparation remains
expired. Existing separate solve approval/consumption performs fresh study/source/
artifact/runtime checks, remains expiry-capped and single-use/replay-resistant;
dispatch stays disabled. Controlled no-execution tests PASS37 cover source/study/
load/control/unit/STEP/mesh/provenance/runtime mismatch, mutation during attachment,
changed controls before approval, missing source/readers, expiry and replay. A fake
native owner cannot brand a reader; controlled evidence cannot establish authentic
rebound. Changed-surface type/syntax/whitespace validation is tracked in TunaCAD.

Retained real native-kernel export/mesh lineage is still PENDING_SOURCE_ATTACHMENT.
Study private-explicit-f1a3d25e-f4ac-4f11-9d6e-c734e8cd942c belonged to isolated
model root / bar-part / bar-body, fixed/loaded FACEs, controlled-linear-steel,
100 N X, 50 us, 1/50 us output. Its native artifact evidence is real; approvals are
controlled_test_fixture, not human. The fixture restored its previous CAD state
and ended. Read-only audit found no private launcher and no saved original CAD
document. Generated document/session identity cannot be recreated as live truth.
No authentic source attachment, solve-binding, approval or Bridge-ready digest is
claimed. Existing records were neither modified nor replay-validation rerun.

A new live owner must independently supply exact document/model/revision/session/
epoch/body/domain/FACE/material/geometry AND current host study/request/control
authority. The native binder accepts only a genuinely initialized native owner,
not a payload flag. The current launcher has no persistent live study registry
for the exited retained fixture. Reopening a similar bar is insufficient; isolated
fixture records cannot become production history. If authentic original state is
unavailable, a new live approved lineage is a separate prerequisite, not an implicit
continuation. No manual pairing/approval requested, no execution/regeneration.
Prior feasibility, analytical, timestep, cancellation and mesh evidence remains
current. proof_of_concept; engineeringUsePermitted:false; dispatch and public
browser/MCP admission closed. No commit, push, deployment or promotion.

## New native controlled lineage / future execution preflight (2026-10-02)

TunaCAD-only development harness, no public provider implementation/admission
change. New controlled native kernel/store source prepared study
private-explicit-7afdbac1-20dc-4a50-a221-1b5369f8b4e4 / preparation
simprep_private-73f80729-d40a-43d9-b3c5-4a30134c206c. All document/model/session,
component/body/domain/FACE identities are new. Historical study
private-explicit-f1a3d25e-f4ac-4f11-9d6e-c734e8cd942c remains
PENDING_SOURCE_ATTACHMENT; no retained artifact was reused/relabelled.

Source/material/FACE/revision before/after canonical native STEP inspection PASS.
Canonical digest sha256:3bfeb1bf171a5ec8a7a99b1011eb22b34a0c160af829952d75f005f79611d28a.
Controlled geometry approval consumed once, no solve approval; new protected STEP
export-e0ad046a-4d54-4aa6-a293-5b95c61d0bb4 /15429 bytes /
sha256:5015b6ae6f8a9d756ebdfef3da2ebffbb4aa82f05fdbf719d0ac446977239989.
Independent protected reader verifies identical bytes/hash/canonical identity and
receipt/pin. Exact mesh is absent: MESH_BINDING_PENDING. Test approval remains
controlled_test_fixture, never human. Original preparation lifetime120 s unchanged;
approved durable export may only proceed with newly validated mesh and fresh
short-lived solve authority, not renewal of the expired preparation.

Native persistent Gmsh settings/path/fingerprint reopened and verified read-only;
no executable discovery, substitution, configuration mutation or probe. Fresh
OpenRadioss2026 manifest matches trusted
sha256:64019bec8c2f46a8431c8976db6c3664f162376f59ef1c2edca7f229a8e1208b;
runtime sha256:65d76caa5f3c9d83f2092d51505d92f14abe5ca4a10a540876d11e595afd7b36.
Frozen axial_bar_oracle_v2 digest
sha256:15b463c1b5e3db282a191b6aa62e5c508470b46348e283e188cf161a84ec7b97,
thresholds and actual-variable-cycle coverage semantics unchanged.

Protected preflight digest
sha256:c9fdc13ffb2aef25d72efde63535336360e97808a58e862baf80251bfa5f7834,
END_TO_END_EXPLICIT_PREFLIGHT_READY; GMSH_EXECUTION_AUTHORIZED=false,
SOLVER_EXECUTION_AUTHORIZED=false; dispatch disabled. Intended future maximums
1Gmsh/1Starter/1Engine, no retry, .6 nodal scale/zero minimum,50 us/1 usTFILE4,
20000 cap. Actual counts0/0/0. Fourteen-stage plan records each fresh identity/hash,
approval consumption, persistence, cancellation and quarantine boundary. Existing
Windows process-tree/Job Object limits and cleanup-before-publication code inspected
only, historical cancellation evidence reused. Actual-mesh and Starter-native
stability/resource gates still required. Provider's experimental88/208 C3D4 and
ten-node identity restriction is NOT relaxed: prior native209-element capture is
a known future blocker if reproduced, requiring stop before Starter, never old
mesh substitution. Output remains ten FACE nodes' X histories plus globals, not
general3D/full-mesh visualization or broader physics.

With explicit user approval the new controlled source owner remains idle, exposing
only authenticated read-only status/source for the exact current owned study;
browser Origins/mutation/dispatch/other studies refused. Connection secret and
test records are protected per-user isolated fixture assets, not repository/public
or production storage. Current source is reread from the live native kernel; stored
records cannot replace that owner if it exits. No production bootstrap changed.
Focused preflight/isolation checks PASS26 and changed-file type/compile checks PASS
in TunaCAD; fresh native preparation/protected-reader assertions PASS. No Gmsh,
Starter, Engine, CalculiX, converter, Chromium or historical suite ran. Earlier
numerical/provider evidence remains current. Next: separately authorized one new
Gmsh with strict actual-mesh admission, then fresh solve binding/separate approval
only if compatible. proof_of_concept; engineeringUsePermitted:false; public closed.

## One approved existing-owner Gmsh capture / no solve authority (2026-10-02)

TunaCAD private runner reused unchanged production Bridge mesh capture/admission
and protected storage. User approval limited to ONE Gmsh for new current study
private-explicit-7afdbac1-20dc-4a50-a221-1b5369f8b4e4 / approved export
export-e0ad046a-4d54-4aa6-a293-5b95c61d0bb4. PID4956 remains the same controlled
native kernel owner. Exact authenticated source/session/revision/epoch/FACEs/
material/current owned study/load/control/unit/request comparison PASS, repeatedly
rechecked during capture. Expired120 s preparation not renewed/recreated; no new
geometry approval or substituted source. Saved native Gmsh configuration and
protected export receipt/pin/STEP were freshly reopened/hashed, no discovery or
reconfiguration. Immutable one-run claim prevents rerun by a fresh test closure.

Existing bounded configuration10 mm/linear C3D4/OCC STEP/one thread unchanged;
configuration digest
sha256:b98ed0010e65a9aa0723e0bffcae80064d5ffd9242132536c3bb298d73366093.
Invocation bar.geo -3 -format msh2 -o bar.msh -nt1 -v3. Gmsh run
207b15f8-2193-4a8a-b81a-01b964b25929 exit0, no signal/failure, diagnostics empty
at requested verbosity. Input/execution/raw-output/cleanup receipts retained
contemporaneously. Normal scratch cleaned; no original export/preflight reseal.

Strict actual geometric/topological admission PASS88 nodes/209 C3D4 elements;
no historical count required for mesh admission. One connected volume, valid
finite/unique IDs/connectivity, positive Jacobians, complete boundary ownership,
volume9999.999999999989 mm3, mass0.078 kg, minimum volume41.666666666666664 mm3,
minimum altitude2.23606797749979 mm. Fixed nodes[1,2,3,4,45], loaded
[5,6,7,8,46]; each100 mm2/four facets bound to exact semantic FACEs/domain/body.
Protected mesh gmsh-explicit-09e7ee71d908b1aa01b8f688 / artifact digest
sha256:09e7ee71d908b1aa01b8f68860e86569de6a736f03830e90736077fcc506c17b.
Raw10873-byte MSH digest
sha256:2bdf1807af9f93f8797b999e39b771bca675ae2f77c2f916435be17529841be0.
Schema tunacad-private-explicit-protected-mesh/0.2 / record digest
sha256:a0160b4b8ce7b9a57f5412234eb4ce5ef18520949e99950cac06d0c10e246944.
Fresh protected reader independently rereads raw mesh/export/provenance/execution/
configuration/settings/executable/cleanup, recomputes admission/maps/digests PASS.

Final GMSH_MESH_CAPTURE_VALIDATED receipt digest
sha256:3ff41c667e6c60c5a88117853d419d1b734aa3c9067b0587e87894893afdc20a.
BRIDGE_APPROVAL_AUTHORIZED=false; SOLVER_EXECUTION_AUTHORIZED=false;
TRUSTED_SOURCE_OWNER_ALIVE=true/PID4956. No durable solve binding, Bridge approval,
Bridge-ready request or provider submission. Actual Gmsh1/Starter0/Engine0/
CalculiX0. Owner idle access remains read-only; native source authority unchanged.
This captures a valid actual mesh, NOT solver admission: existing OpenRadioss
experimental208-element restriction remains unchanged and must be reviewed in a
separate bounded increment before any future dispatch. Never substitute old mesh.
Focused source/provenance checks PASS29 and changed runner type/syntax/whitespace
PASS in TunaCAD. No historical numerical/refinement/Chromium/solver suite. Previous
evidence current; proof_of_concept, engineeringUsePermitted:false, public closed.
No commit/push/deployment/promotion.

## Existing-owner authorization-only continuation (2026-10-02)

TunaCAD private test orchestration reused the existing production durable solve
service and Bridge approval consumers, without changing provider implementation.
The same live controlled native owner and retained study/export/actual mesh passed
fresh authenticated source/current-study binding, protected export/raw-mesh/FACE
mapping/execution/settings provenance and full installed runtime hashing. Original
preparation stayed expired; no new geometry approval/export/mesh or source identity.

New solve binding digest
sha256:df875796cc1409e9a01ecd9f651362d397f141f2f18b235e891e0454b4394aff,
created2026-10-02T13:53:27.490Z / expires2026-10-02T13:55:27.490Z,120 s.
Separate controlled_test_fixture Bridge approval bound to that exact binding and
expiry, consumed once via production code. Geometry substitution, binding mismatch,
expiry, binding replay and approval replay rejected. Consumed proof verified.
Dispatch-disabled Bridge-ready request digest
sha256:aa8d2c0e50251b866195ded5da7446141d2fe46fa273143d799166ddd11d1aec.
Final BRIDGE_READY_REQUEST_VALIDATED receipt digest
sha256:8af4989f3346fc2df368a4ffba078e80950cf410d4171e635406dfb896b137a2.
Fresh reads source51/export8/mesh7/runtime15; all11 focused checks PASS, private
runner type/syntax/whitespace PASS. No provider submit/mesher/solver/converter ran.

This is controlled test authorization evidence, not human approval or lasting
execution authority. Runner revokes its consumed in-memory capability on exit;
native source owner remains alive/read-only and canonical retained records remain
unchanged. Original owner controller is preflight-only, not a dispatched controller.
Separate experimental208-element solver gate remains unchanged; captured209-element
mesh is not solver-admitted. Next: no-execution provider-input reconciliation before
any separately approved submission. Earlier numerical/provider evidence current;
proof_of_concept, engineeringUsePermitted:false, public closed. No broad/historical
suite, commit, push, deployment or promotion.

## Historical208 count restriction resolved (2026-10-02; no execution)

**EXACT_208_HISTORICAL_ONLY**. Original OpenRadiossDeck exact88 nodes/208 tetra
and832 facet cap were a historical fixture restriction, not a solver requirement.
Bounded contract already permits4..100000 nodes and1..50000 elements (also subject
to per-request tighter bounds);20000-increment cap unchanged. Deck now reuses the
existing connected rectangular C3D4 geometric/topological admission, positive
volumes/mass, complete CAD boundary/FACE ownership and source/runtime checks.
Ten monitored FACE IDs, one domain, material, step load, property/time cards,
zero initial state and no-mass-scaling policy unchanged.

Count assumption classification: deck equality/cap = accidental historical
hard-coding; T01 gamma_296 = historical summation bound accidentally fixed in
production recovery; frozen oracle/timestep plan and probe/run scripts = historical
fixture identity; serialization/reader/provider regression counts = test-only
historical expectations. Starter NUMELS equality = real interpreted deck identity,
already dynamic. Resource maxima/material/FACE/geometry = bounded contract.
No other208-sized provider/result arrays or deck loops found. T01 record format
does not carry a volume element count:22 globals/ten nodes/channels/version/framing
remain unchanged. Production result recovery supplies admitted actual counts for
gamma_n only; historical defaults/oracle/plan remain frozen88/208. Positive added
mass and any later mass/residual change still fail. No numerical gate retuned.

Fresh protected native read admitted authentic88/209 mesh and verified all raw
mesh/export/source/execution/settings/configuration/cleanup provenance. Current
native source unchanged. All209 tetra emitted once; fixed[1,2,3,4,45],
loaded[5,6,7,8,46], resultant+100 N, mass0.07799999999999992 kg.
Starter SHA-256
sha256:851a36b8db9a8892b23f04bdbfc1c3b1187001b88348d19ba20f48a176642144;
Engine SHA-256
sha256:8a20fe6add5f25384a9ddc4808d22240cf772d69cf7ee04e4c069e44f1c83536;
combined UTF-8 Starter+Engine digest
sha256:e5dabd700fd1304b52b5a44f291d269ccf78c08d9af1cf2afb044f3b22679f74.
Historical208 deck bytes still match original hashes. Tetra433 [35,72,66,88] is a
unique positive volume41.666666666666664 mm3 at centroid[92.5,7.5,2.5], inside the
one connected domain, not a surface row. No tetra deleted or changed.

Historical meshing constructed an OCC Box; current meshing imports native STEP
and explicitly sets random seed/thread count. Both label Gmsh4.15.2. Retained
meshes have different node numbering/positions/connectivity, not an old208 mesh
plus a single append. No valid type4 filtering found in old parser. Exact attribution
among source entity ordering/STEP/seed/thread controls remains undemonstrated
without a new mesher study, not authorized here. Different topology alone is not
an error when all geometric admission invariants pass.

Pure focused layout/rejection/deck checks PASS62; synthetic direct3040/4021
parser/actual-count roundoff checks PASS; TunaCAD prospective preflight checks
PASS26. Historical T01 + controlled209-count metadata produces identical frames,
NOT real209 solver-result evidence. No new changed-file type diagnostics;25
pre-existing binary Buffer/type diagnostics independently reproduced from committed
source, not cleaned up. Syntax/whitespace PASS. All process/submit counts0; no new
authority, old preparation expired and prior consumed binding/approval untouched.
Private/public isolation and POC/engineeringUsePermitted:false preserved. Historical
numerical evidence remains current for its original208 mesh;209 numerical validation
still needs a separately approved actual provider run, fresh solve binding and
separate approval, and clean Starter-native stability/interpretation admission.
No commit/push/deploy/promotion or provider/browser/MCP/public exposure.

### Execution-readiness contract (2026-10-02; no solver; PARTIAL)

The private execution boundary now reserves280s headroom within unchanged300s
authority: source25/runtime25/storage15/Starter65/handoff30/Engine65/recovery20/
durable25/finalization10 seconds. Shared policy pins restart<=16MiB, other raw
artifacts<=8MiB, <=8 files/64MiB per stage and JSON<=2MiB. Producer and protected
sink verify the policy digest before launch; incompatible sinks fail early.

The canonical launcher has opt-in five-event private pipe telemetry, separate
from solver output. Context/digests/sequence/timestamps/accounting bind wrapper
and actual child identities; accepted events are protected. Other provider
launches do not opt in. Child creation, job assignment and termination semantics
are unchanged. Wrapper close alone no longer establishes explicit owned-tree
completion. Native explicit submission/driver execution is blocked with
CONTAINMENT_CHANGE_REQUIRED, not a numerical-provider failure.

Read-only Windows job accounting cannot prove descendants created before job
assignment or survivor absence after abrupt wrapper death. An approved bounded
containment/supervisor design is required; suspended creation/new job ownership/
kill handles/termination redesign were NOT implemented. The private pipe uses
an stdin capability/HMAC, not an OS client-PID query or demonstrated restricted
pipe ACL. Native helper round-trip provenance remains not demonstrated; CIM is
not made optional while replacement provenance/tree proof is incomplete.

Host terminal-chain readers require complete success receipts/manifests/raw
artifact pins/candidate/result/cleanup/finalization. Retained candidates alone
are not completion. Cleanup/retention failure is sticky and cannot be masked
by cancellation. Provider execution, frozen oracle and development aggregate
remain separate; oracle FAIL does not rewrite provider success. Counts derive
from protected intent and verified child-created evidence, with UNKNOWN rather
than inferred zero for missing expected creation evidence. A checked-in private
native ESM operator orchestrates existing components, but stops before issuing
authority or submission while the containment gate is blocked.

74 focused no-solver telemetry/Node-pipe/deadline/artifact/controlled-chain/
classification/counter/isolation checks PASS. Failure dispositions are controlled
policy fixtures, not full native lifecycle evidence. Nine changed-file strict
type checks PASS (14 imported out-of-scope diagnostics excluded); MJS syntax,
PowerShell AST, inline C# compilation and both whitespace checks PASS. No helper,
solver, mesher, converter, approval, provider submit or numerical suite ran.
Historical numerical evidence remains valid for its original scope. Prior
launcher/durable process-mock evidence predates the stricter readiness contract
and cannot establish its native end-to-end PASS. POC, engineering use disabled,
public/browser/MCP closed. No safe solver attempt yet: first resolve approved
containment design and prove native helper/full failure-replay orchestration.

### Superseding private Windows containment readiness (2026-10-02; no numerical execution)

Historical PARTIAL readiness above remains preserved. The private opt-in canonical
helper now creates the exact executable suspended with atomic Windows10+ JOB_LIST
assignment, verifies membership/non-inheritance before ResumeThread and retains
one exclusive unnamed supervisor-owned KILL_ON_JOB_CLOSE handle. Only standard-I/O
handles are inherited; no breakaway flags/fallback. Other providers' non-opt-in
creation behavior is unchanged. Nested-job failure rejects creation before resume.

Seven-event protocolv2 binds suspended creation, assignment, resume, exit and
native empty-job accounting; actual execution counts at child_resumed, not creation.
Normal completion requires bounded ActiveProcesses=0. Abrupt supervisor loss relies
on exclusive kill-on-last-close policy plus separate bounded known-child-PID exit
observation; no unknown-descendant enumeration claim. Incomplete provenance remains
failure even when containment cleanup is proven. No v1 receipt upgrade/resealing.

Five harmless Windows fixture cases PASS: normal, descendant, invalid-job assignment,
wrapper loss and existing-driver cancellation; all known fixture PIDs gone. Native
private telemetry round trip PASS. Authentication is stdin capability/HMAC/correlation,
not Node OS client-PID authentication or a narrowed named-pipe ACL. Wrong identity,
stage, malformed/duplicate/out-of-order/oversized data fail closed. CIM is optional
diagnostic after replacement provenance and containment proof.

Host-controlled native ESM operator no-solver readiness PASS, with fresh real
source/artifact/runtime reads copied to controlled source ports and unchanged
approval/authority consumers/dry handoff.84 focused readiness/controlled terminal-chain
checks PASS. TTL300s/headroom280s and restart16MiB/raw8MiB/stage8 files64MiB/JSON2MiB
unchanged. No live simulation approval or numerical provider submit. This is NOT
authentic new completed native solver/replay evidence; current209 validation remains
PENDING. Historical numerical/parser/oracle evidence is unchanged. Next: a separately
approved fresh-authority current-lineage run, never automatic execution. POC,
engineeringUsePermitted:false; public/browser/MCP admission closed.

### Stage-aware execution headroom (2026-10-02; no solver)

The historical private native attempt was rejected for fixed280s headroom after
completed verification/persistence: provider.submit1, accepted0, Starter0, Engine0.
No numerical failure or completed provider result is inferred. Historical protected
receipts/authority remain immutable/retired, not relabelled or reused.

Frozen budgets source25/runtime25/storage15/Starter65/handoff30/Engine65/recovery20/
durable25/finalization10 seconds still sum280; authority TTL stays300s. The canonical
provider now uses a branded internal authority/lineage/expiry-bound stage ledger,
not caller completion flags or serialized claims. Trusted component verification
of actual output/protected linked receipt is mandatory before discharge. Fresh
source/runtime/storage checks restore pending work; stale inputs invalidate all;
in-flight stale verification cannot discharge. Cumulative time ceilings are not
reset and budgets are not shrunk. Expiry rejects even with zero remaining work.

Required reserve before Starter215s; after Starter150s; before Engine120s; after
Engine55s; after recovery35s; durable10s; finalization0s. Existing source/artifact/
runtime/deck verification, containment/process provenance, cancellation, durable
capture, cleanup, result integrity, oracle and approvals remain required.

Host-owned focused tests: ten ledger cases, six direct provider admission-method
cases PASS; no provider.submit/process. Native ESM operator controlled evidence
ports and intercepted native spawn PASS:268.116s remaining admits215s required,
instead of the old280s rejection. No helper/Starter/Engine, real approval, solver,
mesher or numerical test. The private host fixture remains outside this public
Bridge. Existing numerical evidence unchanged; authentic current209 validation
PENDING. Next: a separately approved fresh single-use native attempt. POC,
engineeringUsePermitted:false and public/browser/MCP admission closed.

### Opt-in durable pre-cleanup evidence boundary (2026-10-02; no solver)

The private host execution adapter is implemented separately in TunaCAD, not
copied into this public Bridge. Canonical OpenRadioss provider now accepts an
optional constructor-owned durable sink: full pinned Starter/Engine artifacts,
logs and authentic T01 bytes are retained/reopened before interpretation, and
the normalized candidate is durably committed before result_validated and
scratch cleanup. Capture metadata binds run/request/execution authority,
provider/runtime/manifest, hashes/sizes, THICODE and timestamp; chained finalized
receipt remains the publication/cleanup gate. Candidate is NOT a completed
retrievable result. No new solver implementation, parser, normalizer, deck,
public provider registration or numerical threshold.

For this opt-in boundary, a pin/durable-artifact/candidate retention failure
quarantines and blocks publication, preserves bounded scratch for diagnosis,
and reports cleaned=false. It never discards the only authentic T01 merely to
claim cleanup. Successful capture still uses unchanged production cleanup.
Providers without the new optional sink retain their previous behavior.

Only `test-sim9-openradioss-private-provider.mts --durable-retention-only` ran:
three controlled process-mock cases PASS (successful capture before cleanup;
T01 sink failure preserving scratch; candidate sink failure preserving scratch).
No executable was launched. Authenticated historical T01 is read-only fixture
input, not a new numerical run or209 validation. Initial two-second fixture
observation failed during mock-runtime hashing; one targeted retry using the
existing ten-second bounded observation policy PASS. Host tests independently
cover protected native fsync/reopen and dry authority/isolation/rebinding.
Existing numerical evidence is not relabelled or invalidated by this opt-in
storage boundary. Actual current-mesh admitted execution remains separate and
requires explicit approval. POC/engineeringUsePermitted:false/public closed.
