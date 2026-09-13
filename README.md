# TunaCAD Simulation Bridge

Public, standalone local host for TunaCAD's provider-neutral simulation
workflow. It pairs with the TunaCAD browser application, obtains explicit
per-study approval, exports no geometry before approval, meshes approved STEP
geometry with Gmsh, solves the neutral FEM model with CalculiX, and returns a
bounded normalized result.

This repository does not include, install, or redistribute Gmsh or CalculiX.

## Requirements

- Node.js 24 or newer
- A separately installed Gmsh executable
- A separately installed CalculiX `ccx` executable

## Install and run

```powershell
git clone https://github.com/JNaruto-mar/TunaCAD-Simulation-Bridge.git
cd TunaCAD-Simulation-Bridge
npm ci
npm start
```

Provider paths can be selected from TunaCAD after pairing or supplied to the
Bridge process:

```powershell
$env:TUNACAD_GMSH_EXECUTABLE = 'C:\path\to\gmsh.exe'
$env:TUNACAD_CALCULIX_EXECUTABLE = 'C:\path\to\ccx.exe'
npm start
```

The default bind is literal IPv4 loopback `127.0.0.1:48731`, and the default
allowed browser origin is `https://tunacad.com`. For local TunaCAD development,
set `TUNACAD_SIMULATION_ORIGIN` to the exact localhost origin before starting
the Bridge.

## Current version 1 analysis envelope

- one Part and one valid connected solid;
- one homogeneous isotropic linear-elastic material;
- small-displacement linear-static analysis;
- complete second-order tetrahedral mesh;
- surface-force entries targeting arbitrary unique FACE groups, with the total
  vector distributed over their combined area;
- multiple pressure FACE groups, with positive values acting inward and
  negative values representing suction;
- multiple uniform part-local gravity vectors using material density and
  second-order tetrahedral volume integration;
- fixed and prescribed-displacement entries targeting arbitrary unique FACE
  groups; distinct constraint groups may share edge/corner nodes when their
  prescribed components are compatible, but may not overlap on facets;
- prescribed displacement independently controls part-local X/Y/Z components
  (`null` leaves a component free);
- one simultaneous linear-static load case with deterministic accumulation of
  multiple load entries by stable load ID; and
- no contacts.

The Bridge advertises this exact admission profile. TunaCAD rejects unsupported
studies before creating an approvable job or transferring geometry. The exact
recorded Windows/Gmsh/CalculiX tuple is `internally_validated` and may be
presented on tunacad.com as `public_beta`; other runtime tuples remain
`proof_of_concept` or unsupported. All beta results deny engineering use and
require independent verification for critical decisions.

TunaCAD can orchestrate three sequential v1 jobs as a mesh-convergence parent.
The shared public contract includes the normalized
`tunacad-neutral-mesh-convergence-report/1.0` types and analysis helper. Only
mesh sizing changes between levels; geometry, material, loads, constraints, and
their invariant digest remain fixed.

## Process and resource boundary

Each Gmsh or CalculiX run has a 120-second execution timeout. Cancellation and
timeouts terminate the active child process, wait for exit, force termination
after a two-second grace period when necessary, remove temporary artifacts, and
quarantine late results. The current local envelope is:

- 32 MiB maximum approved STEP input;
- 512 MiB maximum provider working directory;
- 256 MiB maximum result file;
- 12,000 retained diagnostic characters;
- 120 seconds of per-process CPU time on Windows; and
- 1 GiB of per-process memory on Windows.

The Windows x64 limits use a Job Object with process-time, process-memory, and
kill-on-close flags. Other operating systems and Windows architectures advertise
CPU and memory as `null` and report qualification as `unsupported`; they never
imply that an unavailable quota is enforced.

STEP envelopes and normalized provider files are treated as untrusted input.
Acceptance covers malformed/incomplete STEP, hostile MSH count declarations,
oversized result records, missing result sections, numeric overflow, provider
timeout, forced termination, and cleanup:

```powershell
npm run test:hostile-inputs
npm run test:lifecycle
npm run test:pressure
npm run test:gravity
npm run test:prescribed-displacement
npm run test:superposition
npm run test:face-groups
npm run test:sim3-benchmarks
npm run test:sim3-matrix
npm run test:sim4a-matrix
npm run test:sim5-modal
npm run test:sim5-modal-qualification
npm run test:sim5-multidomain-modal
npm run test:sim5-linear-buckling
npm run test:sim5-matrix
```

## Qualification matrix

The machine-readable SIM-2 matrix is
`qualification/sim2-windows-gmsh-4.15.2-calculix-2.16.json`. Its validator
binds evidence to exact OS, architecture, Node, Gmsh, and CalculiX versions and
fails closed if declared qualification does not match required lanes:

```powershell
npm run test:benchmarks
npm run test:qualification
```

The real Gmsh/CalculiX suite covers an analytical cantilever, a plate-with-hole
stress/refinement trend, and deterministic near-singular behavior. Those
mechanical lanes pass for the recorded Windows/version tuple. The matrix is
`internally_validated`; independent engineering review remains pending and
`engineeringUsePermitted` remains `false`.

The required independent reviewer should use
`qualification/INDEPENDENT_ENGINEERING_REVIEW.md`. Promotion evidence must name
the exact matrix and reviewed commit, identify the reviewer's qualification,
and include a SHA-256 digest of the signed report. The matrix validator rejects
incomplete or differently scoped sign-off evidence.

The separate experimental SIM-3 matrix is
`qualification/sim3-experimental-windows-gmsh-4.15.2-calculix-2.16.json`.
Its real-solve lane covers mixed load types across three meshes, six-node
curved-pressure quadrature and sign reversal, diagonal plus axis-aligned
gravity with an analytical distributed-body-force comparison, and axial plus
multi-component prescribed displacement with `EAδ/L` and superposition. All
automated lanes pass. This matrix is `internally_validated`, but is not
advertised as qualified provider evidence while independent review is pending.

The SIM-5 v2 envelope supports homogeneously restrained modal studies,
single-domain free-free modal studies, explicit bonded multi-domain modal
coupling, and single-domain linear-eigenvalue buckling under a declared
surface-force preload. Free-free results explicitly classify the six
leading rigid-body modes that CalculiX omits from field output, preserve the
solver's mode numbering, and reject ambiguous rigid-mode classifications. The
real qualification fixtures cover a beam analytical comparison, free-free
rigid modes, and a three-level fully clamped square-plate refinement sequence
against the declared Kirchhoff-Love solution. They also cover a bonded
two-domain cantilever and a fixed-free Euler column. All automated SIM-5 lanes
pass; independent engineering review remains pending.

## SIM-4A version 2 contract foundation

Version 1 remains immutable. The additive `2.0` request, mesh-request,
FEM-model, result, and provider-capability contracts establish the fail-closed
multi-domain boundary used by the experimental v2 Gmsh/CalculiX pipeline.
They require:

- a stable domain and occurrence identity for every solid, including repeated
  occurrences of one Part;
- a proper rigid transform from owner-local coordinates into one frozen
  analysis coordinate system;
- separate geometry, domain, model, and request digests;
- exactly one explicit material and volume-region assignment per domain;
- exact per-element, boundary-facet, and per-domain mesh ownership; and
- per-domain extrema and unique field-dataset ownership in normalized results.

SIM-4A never infers interactions. Touching/overlapping solids and assembly
mates do not imply bonding. The experimental multi-domain Gmsh
composition adapter now exports and meshes each domain in owner-local
coordinates, applies its rigid occurrence transform, and combines the validated
meshes without losing domain ownership. By default nodes remain independent. An
explicit `shared_topology` interaction may merge them only after a complete,
unambiguous one-to-one quadratic node and facet match. The experimental
CalculiX deck generator emits one C3D10 element set and solid section per domain
and one card per assigned material. A real repeated-Part, two-material fixture
passes Gmsh 4.15.2 and CalculiX 2.16 with exact global reaction balance.

The Bridge now advertises independent v1 and v2 provider capabilities. Its v2
path validates exact provider admission before approval, obtains one local-host
approval, then accepts 1–16 ordered STEP domains with 16 MiB per-domain and
64 MiB aggregate limits. The asynchronous CalculiX adapter uses the hardened
process quotas, cancellation, cleanup and bounded result parser, and normalizes
global plus per-domain extrema, reaction ownership, hotspots and field-dataset
IDs. Displacement and von Mises surface fields are retained only as normalized,
digest-verified triangle pages; native solver files never cross the Bridge.
TunaCAD uses the same MCP lifecycle tools for v1 and v2 and rechecks the CAD
revision around every domain export. The formal SIM-4A matrix records all
automated lanes as passed. The exact-tuple pipeline is `internally_validated`
and eligible for public beta; independent review is pending and engineering
use is not permitted.

## SIM-5 modal and linear-buckling increment

The first SIM-5 vertical slice adds v2 `modal` requests with 1–24 requested
modes, optional lower/upper frequency bounds, consistent mass, required
material density, no loads, and either homogeneous fixed/zero-displacement
restraints or an empty constraint set for a single-domain free-free study. The
capability profile exposes this limit as `maximumFreeFreeDomains: 1`, so larger
free-free models fail admission before geometry transfer.
CalculiX `*FREQUENCY` output is normalized into natural
frequencies, six-axis participation factors, effective modal masses, and
rigid-body-mode diagnostics. Bounded FRD eigenvectors become per-domain,
digest-verified `mode_shape_magnitude` pages with deterministic maximum-vector
normalization for browser animation; this normalization is explicitly not a
physical displacement amplitude.

The additive `linear_buckling` request declares 1–12 modes and one unit-scale
preload case that exactly names every submitted load. The first provider
envelope is intentionally limited to one domain, fixed FACE supports,
surface-force preload, and no interactions. CalculiX `*BUCKLE` factors and FRD
eigenvectors become digest-verified `buckling_mode_shape_magnitude` pages. A
mandatory warning states that these idealized bifurcation factors are not
nonlinear collapse predictions and do not include imperfections, plasticity,
or contact changes.

The real constrained steel-cantilever, free-free beam, and clamped-plate
refinement fixtures and their proof-of-concept matrix run with:

```powershell
npm run test:sim5-modal
npm run test:sim5-modal-qualification
npm run test:sim5-multidomain-modal
npm run test:sim5-linear-buckling
npm run test:sim5-matrix
```

All automated mechanics lanes pass. Independent engineering review remains
before SIM-5 qualification. The reviewer packet is
`qualification/SIM5_INDEPENDENT_ENGINEERING_REVIEW.md`.

## SIM-6 small/finite-sliding contact

The additive v2 `static_contact` envelope implements the SIM-6 increments:
exactly two domains, explicit secondary and primary FACE groups, frictionless
or Coulomb-penalty node-to-surface contact, small or finite sliding, linear pressure-overclosure,
and bounded automatic quasi-static increments. The backward-compatible
`initialAdjustment: "none"` policy preserves CAD clearance, while explicit
`{ type: "bounded_to_contact", maximumAdjustmentMm }` admits bounded planar or
curved clearance/interference corrections. Mesh-space closest-triangle checks
reject deep penetration, require at least one capturable node, and leave
distant open nodes unchanged. Contact
is never inferred from touching CAD or assembly mates. Admission rejects a
provider without the exact contact profile, and geometry checks require opposed
surface normals, initial clearance/interference inside the declared search and
adjustment envelopes, and bounded tangential offset. The CAD model is never
mutated; only CalculiX's temporary analysis mesh can be adjusted.

Before launching CalculiX, the deck adapter checks a 12-degree-of-freedom
two-body rigid-mode rank. Direct restraints contribute their actual components;
contact contributes conservative relative normal restraint only. The generated
deck uses named face-based `*SURFACE` groups, `*CONTACT PAIR` with
`TYPE=NODE TO SURFACE, SMALL SLIDING` for small sliding or default finite
sliding with an `NLGEOM` step, plus request-bounded `ADJUST=` when explicitly
selected, linear `*SURFACE BEHAVIOR`, an explicit `*FRICTION`
coefficient and penalty stick slope for frictional requests, a bounded
`*STATIC` step, and final `CDIS,CSTR` contact output. Bounded normalization
returns structural fields plus interface status, maximum pressure, minimum
normal gap/penetration, tangential slip/shear fields, integrated force on the secondary side, ordered
converged increments, and digest-verified contact-pressure/normal-gap pages.

Run the contract/deck/parser lane with:

```powershell
npm run test:sim6-contact
```

Run the real planar opening/closing, deliberate non-convergence/cancellation,
frictional sliding, bounded initial-adjustment, and curved
refinement/penalty lanes with:

```powershell
npm run test:sim6-contact-real
npm run test:sim6-contact-trends
```

This is a contract and adapter foundation, not a qualified mechanics release.
Real planar patch equilibrium, opening/closing, 0.05 mm planar clearance and
interference adjustment inside a 0.06 mm bound, curved-surface adjustment, a
4 mm finite-sliding fixture, and curved Hertz-type
penetration/refinement trends now pass. Deliberate non-convergence and
cancellation fail closed with native cleanup and no partial result. A paired
frictionless/frictional sliding fixture verifies nonzero Coulomb-limited shear,
slip fields, and tangential equilibrium. Finite sliding explicitly enables
finite-deformation kinematics while retaining the current isotropic
linear-elastic material law. Independent engineering review remains pending in
`qualification/sim6a-windows-gmsh-4.15.2-calculix-2.16.json`.
Material nonlinearity and plasticity remain unsupported. The reviewer packet is
`qualification/SIM6A_INDEPENDENT_ENGINEERING_REVIEW.md`.

## SIM-7A geometric-nonlinear static increment

The additive v2 `nonlinear_static` member is separate from linear statics and
contact. Its first provider envelope accepts one elastic solid, fixed FACE
supports, surface force/pressure/gravity loads, no interactions, and up to
eight ordered pseudo-time steps. Every active load has an explicit
piecewise-linear amplitude from normalized step time 0 through 1. The request
also fixes the automatic initial/minimum/maximum increment, per-step increment
limit, iteration limit, divergence cutback factor, and maximum cutbacks.

CalculiX maps this exactly to ordered `*STEP,NLGEOM`, `*STATIC`, `*AMPLITUDE`,
`OP=NEW` load, and `*CONTROLS,PARAMETERS=TIME INCREMENTATION` cards. Successful
`.sta` records and increment-frequency `.dat` frames are bounded and
cross-checked before normalization. Results contain every converged increment,
the interpolated scale for each active load, maximum displacement and support
resultant at every point, plus final digest-verified displacement/stress field
pages. No partial history is returned after non-convergence.

Run the deterministic contract/deck/parser and native large-deflection beam
lanes with:

```powershell
npm run test:sim7-geometric-nonlinear
$env:TUNACAD_GMSH_EXECUTABLE='C:\Tools\gmsh\gmsh.exe'
$env:TUNACAD_CALCULIX_EXECUTABLE='C:\Tools\CalculiX\ccx.exe'
npm run test:sim7-geometric-nonlinear-real
```

The native 150 x 10 x 5 mm cantilever records two ordered ramps and 14
converged history points. At 500 N its 24.9486 mm NLGEOM displacement differs
by 2.28% from the 25.5312 mm small-displacement solve while the 500 N reaction
balances. This is automated proof-of-concept evidence, not qualification.
Deliberate increment exhaustion and active cancellation also quarantine
partial results, clean native files, and resist late-result resurrection.
Plasticity, snap-through/limit-point continuation, unloading/reloading, and
plastic hinges remain for later SIM-7 increments. The three-mesh and
three-increment force-displacement convergence lanes pass; independent
engineering review is the sole pending SIM-7A promotion gate.

The first SIM-7B material-nonlinearity foundation accepts a strictly ordered
isotropic-hardening true-stress/plastic-strain table for `nonlinear_static`,
advertises that support explicitly, and emits deterministic CalculiX
`*PLASTIC` cards. Elastic-plastic requests also require CalculiX `PEEQ`, `ENER`,
and `ELSE` output from the first nonlinear step. Every converged history point
records maximum equivalent plastic strain, maximum energy density, total
internal energy, and yielded-element count; final plastic strain and energy
density are available as digest-verified paginated fields. Missing native
material output fails closed. A native 100 x 10 x 10 mm, 30 kN coupon
development check records 0.1421 mm elastic versus 3.7655 mm elastic-plastic
displacement, 0.03863676 maximum equivalent plastic strain, 11.28585 MPa
maximum energy density, 104210.9 N·mm internal energy, and a -30,000.02 N axial
reaction. This is not qualification: coupon mesh/increment convergence,
plastic-hinge/path-order dependence, and material-nonlinear failure evidence
remain pending; engineering use is not permitted.

The focused `test:sim7-material-path-real` lane loads the same coupon to 30 kN,
then follows a second-step 1 → 0 → 1 unload/reload amplitude. The solver records
22 converged increments per step. Unload/reload stiffness fits are 196018.17
and 195999.69 N/mm with R² above 0.9999997; the residual elongation is 3.628044
mm, PEEQ remains monotonic at 0.03870592, and integrated external work agrees
with final internal energy within 0.0753%. This is path-history development
evidence, not qualification.

That focused lane also executes resource-bounded three-level convergence
matrices. Actual mesh counts 209/309/434 keep all medium-to-fine displacement,
PEEQ, and internal-energy history differences below 0.81%. Maximum nonlinear
increments 0.10/0.075/0.05 produce contracting whole-history differences below
0.98%. Residual displacement and unload/reload stiffness remain within 0.39%
for the fine increment pair and 0.28% for the fine mesh pair. SIM-7B remains
experimental and does not permit engineering use.

The focused `test:sim7-material-lifecycle-real` lane deliberately caps a
plastic coupon at 36 increments and cancels a separate cyclic coupon only after
complete positive PEEQ, energy-density, and total-internal-energy frames are
observed while CalculiX is running. Non-convergence and cancellation expose no
normalized result or field page, remove their native working directories, and
cannot be changed by a late child exit. This is fail-closed development
evidence; it does not qualify SIM-7B.

The focused `test:sim7-material-hinge-real` lane compares two paths on a
100 x 10 x 10 mm solid cantilever. A monotonic 400 N load has a 240 MPa nominal
root stress and remains elastic; a 600 N overload exceeds the 250 MPa yield
point before returning to the same 400 N final resultant. The latter retains
0.0009195724 PEEQ in the root 25 mm, 1.3033x the fitted root chord rotation,
and 1.3862x the internal energy. The overload/return reaction endpoints are
599.9999/400 N and full reaction history balances within 0.0001 N. This proves
a single-load plastic-hinge path effect without claiming reordered multi-axis
loading or engineering qualification.

SIM-7B now has a formal capability-specific matrix and reviewer packet:
`qualification/sim7b-windows-gmsh-4.15.2-calculix-2.16.json` and
`qualification/SIM7B_INDEPENDENT_ENGINEERING_REVIEW.md`. Run
`npm run test:sim7b-qualification` to validate the 10 automated lanes and
print the digest an independent reviewer must reproduce. Automated gates pass,
and status is `internally_validated`; independent review remains pending and
engineering use remains denied.

The canonical public-beta capability catalog, warnings, version-bound evidence,
and reproducible tutorial definitions are in
`qualification/public-beta-capabilities.json`. On tunacad.com, start at
`/docs/simulation-status` and follow the seven linked studies. Run
`npm run test:public-beta-readiness` before publishing a Bridge commit.

Production validation now begins in parallel with SIM-2 and proceeds through
SIM-4, SIM-5, and SIM-6. See
`qualification/PRODUCTION_ENGINEERING_VALIDATION_STATUS.md` for the current
capability-specific PASS/FAIL/PENDING report.

SIM-4B supports explicitly declared nonconformal `bonded_tie`, conformal
`shared_topology`, and six-degree-of-freedom `rigid_connector` interactions. A
tie emits named CalculiX element surfaces and
`*TIE,ADJUST=NO`. Shared topology compacts duplicate interface nodes and emits
no tie/contact card, but fails closed if independently generated surface meshes
do not match exactly within the declared tolerance. Real two-material series
coupons compare both load paths. A rigid connector couples one explicit FACE
group in one domain to a frozen analysis-space point using generated CalculiX
reference/rotation nodes and `*RIGID BODY`. A `remote_force` can apply force in
N and moment in N·mm; a `remote_displacement` independently prescribes three
translations in mm and three rotations in radians, with `null` leaving a degree
of freedom unconstrained. Unknown, unused, multiply supported, overlapping, or
simultaneously loaded-and-supported connectors fail closed. Real provider
fixtures cover remote loading and remote support with global force balance.
Remote-support results carry force in N and moment in N·mm together with the
exact connector ID and reference point; direct FACE supports deliberately
return a null moment because they have no unique reduction point. When every
support is remote, normalization verifies both global force and moment
equilibrium. Separable or frictional contact is never treated as a linear
connection; it must use the explicit nonlinear SIM-6 contact path.

The experimental bolted-bracket qualification fixture is defined independently
in `qualification/sim4b-bolted-bracket-rigid-connectors.json`. It meshes a
two-domain bonded L-bracket, applies an eccentric load through one rigid
connector, and supports the base through a second connector representing a
bolt group. The expected support resultants are `[-1000, 0, 0]` N and
`[0, -45000, 0]` N·mm. The matching SIM-4B matrix is internally validated but
not qualified while independent engineering review is pending. The reviewer packet is
`qualification/SIM4B_INDEPENDENT_ENGINEERING_REVIEW.md`.

Before CalculiX launch, the v2 deck now forms connected components exclusively
from explicit bonded-tie and shared-topology interactions. It evaluates the
six rigid-body restraint modes of every component from direct and remote
constraints. An independently unsupported component fails with
`SIMULATION_MODEL_DISCONNECTED`; a single connected component with a free
rigid mode fails with `SIMULATION_MODEL_UNDERCONSTRAINED`. Independently fully
restrained disconnected domains remain valid. Both failures retain their code
through the asynchronous composed-provider lifecycle and expose no result.

```powershell
npm run test:sim4a-contracts
$env:TUNACAD_GMSH_EXECUTABLE = 'C:\path\to\gmsh.exe'
$env:TUNACAD_CALCULIX_EXECUTABLE = 'C:\path\to\ccx.exe'
npm run test:sim4a-providers
npm run test:sim4a-matrix
npm run test:sim4b-connections
npm run test:sim4b-bracket
npm run test:sim4b-failures
npm run test:sim4b-matrix
```

## Repository ownership

This public repository is the canonical source for:

- `simulation-bridge/` — pairing, approval, transport, and host process;
- `providers/gmsh/` — STEP meshing adapter;
- `providers/calculix/` — solver adapter;
- `providers/ComposedSimulationProvider.mts` and
  `providers/ComposedSimulationProviderV2.mts` — mesher/solver orchestration; and
- `src/simulation/` — shared neutral contracts and Bridge protocol.

The private TunaCAD repository consumes this repository as a Git submodule.
Bridge/provider changes must be committed and pushed here first, then the
TunaCAD submodule pointer is updated.

## Provider readiness

```powershell
$env:TUNACAD_GMSH_EXECUTABLE = 'C:\path\to\gmsh.exe'
$env:TUNACAD_CALCULIX_EXECUTABLE = 'C:\path\to\ccx.exe'
npm run test:providers
```

The check verifies executable identity and reports detected versions. It does
not install or modify either provider.

## Security boundary

The Bridge uses exact Origin and Host checks, one-use pairing, memory-only
sessions, explicit per-request terminal approval, bounded request and STEP
sizes, fixed provider invocation, cancellation, and temporary artifact cleanup.
It does not accept arbitrary commands or executable arguments over HTTP.
