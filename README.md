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
studies before creating an approvable job or transferring geometry. Results
are explicitly advertised as `proof_of_concept`, never permit engineering use,
and require qualified-engineer review.

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
mechanical lanes pass for the recorded Windows/version tuple. The matrix still
remains `proof_of_concept` because the independent engineering-review gate is
pending, so `engineeringUsePermitted` remains `false`.

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
automated lanes pass, but this matrix remains proof-of-concept and is not
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
automated lanes as passed, but independent engineering review is still pending,
so the pipeline remains `proof_of_concept` and engineering use is not permitted.

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

## SIM-6A frictionless contact foundation

The additive v2 `static_contact` envelope implements the first SIM-6 increment:
exactly two domains, explicit secondary and primary FACE groups, frictionless
node-to-surface penalty contact, small sliding, linear pressure-overclosure,
no initial adjustment, and bounded automatic quasi-static increments. Contact
is never inferred from touching CAD or assembly mates. Admission rejects a
provider without the exact contact profile, and geometry checks require opposed
surface normals, nonpenetrating initial clearance within the declared search
distance, and bounded tangential offset.

Before launching CalculiX, the deck adapter checks a 12-degree-of-freedom
two-body rigid-mode rank. Direct restraints contribute their actual components;
frictionless contact contributes relative normal restraint only. The generated
deck uses named face-based `*SURFACE` groups, `*CONTACT PAIR` with
`TYPE=NODE TO SURFACE, SMALL SLIDING`, linear `*SURFACE BEHAVIOR`, a bounded
`*STATIC` step, and final `CDIS,CSTR` contact output. Bounded normalization
returns structural fields plus interface status, maximum pressure, minimum
normal gap/penetration, integrated force on the secondary side, ordered
converged increments, and digest-verified contact-pressure/normal-gap pages.

Run the contract/deck/parser lane with:

```powershell
npm run test:sim6-contact
```

This is a contract and adapter foundation, not a qualified mechanics release.
Real patch equilibrium, opening/closing, penetration and mesh-refinement
trends, non-convergence/cancellation, and independent engineering review remain
pending in `qualification/sim6a-windows-gmsh-4.15.2-calculix-2.16.json`.
Friction, finite sliding, initial adjustment/interference, large deformation,
and plasticity remain unsupported. The reviewer packet is
`qualification/SIM6A_INDEPENDENT_ENGINEERING_REVIEW.md`.

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
equilibrium. Separable or frictional contact is not treated as a linear
connection and remains unsupported until SIM-6.

The experimental bolted-bracket qualification fixture is defined independently
in `qualification/sim4b-bolted-bracket-rigid-connectors.json`. It meshes a
two-domain bonded L-bracket, applies an eccentric load through one rigid
connector, and supports the base through a second connector representing a
bolt group. The expected support resultants are `[-1000, 0, 0]` N and
`[0, -45000, 0]` N·mm. The matching SIM-4B matrix remains proof-of-concept
until independent engineering review. The reviewer packet is
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
