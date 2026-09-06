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
- multiple surface-force FACE groups;
- multiple non-overlapping fixed FACE groups; and
- no contacts.

The Bridge advertises this exact admission profile. TunaCAD rejects unsupported
studies before creating an approvable job or transferring geometry. Results
remain experimental and require qualified-engineer review.

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
