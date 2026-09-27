# SIM-9 implicit transient dynamics development status

Status: `proof_of_concept`; `engineeringUsePermitted: false`. This records
the first two bounded increments under the roadmap's combined
"implicit transient dynamics and harmonic response" analysis item.
The roadmap names that analysis but does not prescribe sub-increments;
this record makes the contract/analytical-first boundary explicit.
The completed SIM-9 transient-thermal evidence matrix is unchanged.

## Contract and admission boundary

The additive v2 `implicit_transient_dynamics` request currently permits
exactly one 3D solid domain, one isotropic linear-elastic material with
positive density, one step `surface_force` on a FACE, one separate
`fixed` FACE, no interactions, zero initial conditions, undamped
small-displacement motion, seconds, and 2–16 strictly increasing
requested output times ending at the duration. Requested result tokens
name displacement, reaction-force, kinetic-energy, and strain-energy
histories. The second increment now returns bounded normalized
provider frames.
Thermal inputs, unsupported restraints/loads, malformed material or
time data, extra domains, and mixed units fail validation.

In the first increment all providers were refused. The second
increment admits only an exact CalculiX one-domain implicit Newmark
`ALPHA=0` capability profile; other providers remain refused before
geometry transfer. Browser/MCP authoring and harmonic response remain
unsupported.

## Analytical reference

A fixed-free axial bar reduced to the single consistent-mass trial
coordinate `u(x)=x/L` supplies a small, reproducible *SDOF* step-force
reference. It is **not** an exact continuum or 3D FE benchmark. For
`L=100 mm`, `A=100 mm²`, `E=200000 MPa`, `rho=7800 kg/m³` and
`F=100 N`:

- generalized stiffness `k=EA/L=200000 N/mm`;
- generalized mass `m=rho*A*L/3=0.026 kg
  =0.000026 N·s²/mm`;
- `omega=sqrt(k/m)=87705.80193 rad/s`,
  `f=13958.81192 Hz`, `period=71.63933479 microseconds`;
- static displacement `F/k=0.0005 mm`;
- undamped step response
  `u(t)=(F/k)(1-cos(omega*t))`.

At quarter period, displacement is 0.0005 mm, fixed-end generalized
reaction is -100 N, and kinetic and strain energy are 0.025 N·mm
each. At half period, displacement is 0.001 mm, reaction is -200 N,
kinetic energy is zero, and strain energy is 0.1 N·mm. At one period,
the reduced coordinate returns to zero. All sampled times satisfy
`F + reaction = m*acceleration` and
`kinetic + strain = F*displacement` to the fixture's stated
numerical tolerances. This reference can anchor a future bounded
provider comparison only after the spatial/modal approximation and
time discretization are accounted for.

The first increment's contract/analytical test remains current. It
did not run Gmsh/CalculiX; the second increment's real solve is
recorded below.

## Bounded CalculiX provider evidence

The additive C3D10 deck uses density in N/mm/s units, a step FACE
force, a fixed FACE, implicit `*DYNAMIC, ALPHA=0`, and explicit
`*TIME POINTS`. A strict parser accepts one complete ordered
U/RF/ELKE/ELSE group per requested time, with every mesh node in
each U frame. Missing, duplicate, reordered, nonfinite, or malformed
records fail closed through existing quarantine and cleanup.

The real bar uses 468 nodes and 209 C3D10 elements. One-dimensional
wave speed `c=sqrt(E/rho)` gives transit time 19.748 microseconds.
At 17.9098, 35.8197, and 71.6393 microseconds, analytical/provider
loaded-face axial displacement (mm) is respectively
0.00045345/0.00045610, 0.00090690/0.00090588, and
0.00018620/0.00017951. The ideal fixed-end reaction (N) is
0, -200, 0; provider RF is -13.955, -182.261, +26.160.
Development comparison gates are 0.00008 mm displacement and 35 N
reaction; the coarse mesh disperses wave fronts. Per-frame
kinetic-plus-strain versus consistent-nodal-load work residuals are
0.0000595, 0.0000550, and 0.0000672 N mm (at most 0.38% of work),
below the 5% gate. Two solves returned identical normalized frames;
deck bytes repeated exactly.

Focused evidence: `npm run test:sim9-implicit-dynamics-contract`,
`npm run test:sim9-implicit-dynamics-parser`, and
`npm run test:sim9-implicit-dynamics-real` passed; TypeScript no-emit
check passed. The additive deck/parser path does not change earlier
SIM-2 through SIM-9 thermal numerical formulations, so earlier
evidence is not stale.

## Axial-bar time-step and mesh refinement (third increment)

The focused fixture keeps the 100 x 10 x 10 mm bar, E=200000 MPa,
Poisson ratio 0.3, density 7800 kg/m3, fixed and 100 N step-force
FACEs, zero initial state, and output times 17.9098, 35.8197,
71.6393 microseconds unchanged. Only the Gmsh global/minimum mesh
sizes or the CalculiX maximum/initial implicit increment vary.
All cases use C3D10, `*DYNAMIC, ALPHA=0` and the same strict
U/RF/ELKE/ELSE parser. The direct-solver fixture changes deck
increment values only; it does not change provider production
defaults or admission.

Values in each triple below follow the three requested times. Units:
displacement mm, reaction N, energy residual N mm.

| Mesh mm | Nodes / elements | Max increment | Axial loaded-FACE displacement | Fixed-FACE reaction | Abs(K+S-work) |
|---|---:|---:|---|---|---|
| Analytical 1D wave | — | — | .000453450 / .000906900 / .000186201 | 0 / -200 / 0 | 0 / 0 / 0 |
| 10 | 468 / 209 | duration/64 | .000452528 / .000906886 / .000179935 | -20.789 / -194.030 / -33.024 | .00007387 / .00007378 / .00007094 |
| 10 | 468 / 209 | duration/128 | .000456097 / .000905878 / .000179509 | -13.955 / -182.261 / +26.160 | .00005947 / .00005504 / .00006717 |
| 10 | 468 / 209 | duration/256 | .000457554 / .000904264 / .000178657 | -7.621 / -203.055 / -8.158 | .00006388 / .00007043 / .00007219 |
| 7.5 | 726 / 309 | duration/256 | .000455951 / .000904334 / .000176869 | -16.016 / -207.712 / -3.402 | .00005684 / .00005814 / .00005754 |
| 5 | 999 / 434 | duration/256 | .000456152 / .000905908 / .000182179 | -11.086 / -201.936 / +12.172 | .00004520 / .00004988 / .00004858 |

Time-step coarse-to-middle versus middle-to-fine maximum paired
changes shrink: displacement 3.57e-6 to 1.61e-6 mm; reaction
59.18 to 34.32 N; residual 1.87e-5 to 1.54e-5 N mm.
The finer mesh levels remain bounded-stable (7.5-to-5 mm maximum
changes: 5.31e-6 mm displacement, 15.57 N reaction; final
per-frame energy residual under 5e-5 N mm), and the finest
displacement agrees with the 1D reference within 4.1e-6 mm.
Mesh paired differences are not pointwise monotonic, especially
reaction around reflected waves: this is bounded stability evidence,
not an asymptotic convergence-rate claim. A stronger wave-front
reaction study would be required before dynamics qualification.

The selected bounded baseline remains the production provider's
10 mm / duration/128 deck (468 nodes, 209 elements); the finer
cases are comparative evidence, not a changed provider default.
The baseline's repeated solver histories were byte-for-byte
identical after parsing. The five distinct solves plus one repeat
passed the focused convergence fixture. No SIM-2 through SIM-9
historical matrices were rerun and no prior numerical evidence
became stale.

Next bounded implementation item: harmonic-response contract and
analytical foundation, separate from this dynamics provider path.
Dynamics remains `proof_of_concept` with
`engineeringUsePermitted: false`.
