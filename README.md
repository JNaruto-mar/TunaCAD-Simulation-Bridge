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

## Current analysis envelope

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

## SIM-4A version 2 contract foundation

Version 1 remains immutable. The additive `2.0` request, mesh-request,
FEM-model, result, and provider-capability contracts establish the fail-closed
multi-domain boundary without advertising a multi-domain solver prematurely.
They require:

- a stable domain and occurrence identity for every solid, including repeated
  occurrences of one Part;
- a proper rigid transform from owner-local coordinates into one frozen
  analysis coordinate system;
- separate geometry, domain, model, and request digests;
- exactly one explicit material and volume-region assignment per domain;
- exact per-element, boundary-facet, and per-domain mesh ownership; and
- per-domain extrema and unique field-dataset ownership in normalized results.

SIM-4A intentionally accepts no interactions yet. Touching/overlapping solids
and assembly mates do not imply bonding. The current Gmsh/CalculiX adapters
advertise provider interface `1.0`, so a structurally valid v2 request is
rejected before approval or geometry transfer until version 2 meshing and
solving adapters exist.

```powershell
npm run test:sim4a-contracts
```

## Repository ownership

This public repository is the canonical source for:

- `simulation-bridge/` — pairing, approval, transport, and host process;
- `providers/gmsh/` — STEP meshing adapter;
- `providers/calculix/` — solver adapter;
- `providers/ComposedSimulationProvider.mts` — mesher/solver orchestration; and
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
