# SIM-7B independent engineering review packet

SIM-7B is internally validated for the recorded runtime tuple. The automated contract, adapter, material
result, coupon, unloading/reloading, mesh/increment convergence, lifecycle, and
plastic-hinge path gates pass on the recorded Windows/Gmsh/CalculiX tuple.
Independent engineering review remains mandatory and
`engineeringUsePermitted` remains false.

## Scope to review

The review is capability-specific: one solid domain, one tabulated isotropic
elastic-plastic material, fixed FACE support, proportional surface loading,
finite-deformation quasi-static steps, and solver-derived PEEQ/energy results.
It does not approve reordered multi-axis loading, multiple nonlinear material
domains, kinematic/combined hardening, anisotropy, hyperelasticity, creep,
viscoelasticity, damage/fracture, limit-point continuation, or another runtime
tuple.

The reviewer must independently assess:

- true-stress/true-plastic-strain definitions, MPa and N-mm units, yield-table
  monotonicity, isotropic hardening assumptions, and CalculiX `*PLASTIC`
  semantics;
- finite-strain `NLGEOM`, STEP TIME amplitudes, `OP=NEW`, increment/cutback
  controls, force control, stability, and the absence of arc-length behavior;
- PEEQ, ENER, and ELSE meanings and whether the normalized material-state and
  boundary-field reductions support each stated acceptance claim;
- the 30 kN axial coupon, elastic reference, reaction equilibrium, unloading
  slope, residual-strain intercept, PEEQ monotonicity, and external-work versus
  internal-energy comparison;
- the three-mesh and three-increment whole-history norms, their sampling,
  tolerances, actual element counts, adaptive increment behavior, and the
  explicit decision not to require monotonic contraction across independently
  generated unstructured meshes;
- deliberate increment exhaustion and active cancellation after positive
  material frames exist, including result/dataset quarantine, process-tree
  termination, native cleanup, and late-exit behavior; and
- the solid-cantilever nominal bending calculation, root-zone chord-rotation
  fit, PEEQ zone reduction, path endpoints, energy interpretation, and
  reaction-history equilibrium.

## Required reproduction

On the exact public commit under review, record complete command logs and their
SHA-256 digests for:

```powershell
npm ci
npm run test:sim7-geometric-nonlinear
$env:TUNACAD_GMSH_EXECUTABLE='C:\path\to\gmsh.exe'
$env:TUNACAD_CALCULIX_EXECUTABLE='C:\path\to\ccx.exe'
npm run test:sim7-geometric-nonlinear-real
npm run test:sim7-material-path-real
npm run test:sim7-material-lifecycle-real
npm run test:sim7-material-hinge-real
npm run test:sim7b-qualification
```

Record the operating system, architecture, Node version, exact Gmsh and
CalculiX versions, executable SHA-256 digests, public Bridge commit, matrix ID,
automated-evidence digest printed by the qualification command, deviations,
reviewer calculations, and report digest. Review must be performed by a
qualified engineer independent of the implementation authorship.

## Approval evidence

If and only if the review accepts every required gate and limitation, change
the matrix review lane to `passed`, set its command to
`npm run test:sim7b-qualification`, and use this exact evidence shape:

```json
{
  "decision": "approved",
  "reviewerName": "Full legal name",
  "reviewerOrganization": "Organization",
  "reviewerQualification": "Relevant professional qualification",
  "independenceStatement": "Independent of implementation authorship",
  "reviewedAt": "YYYY-MM-DD",
  "matrixId": "sim7b-windows-x64-gmsh-4.15.2-calculix-2.16",
  "reviewedCommit": "40-character public Bridge commit SHA",
  "reviewedAutomatedEvidenceDigest": "sha256:digest printed by npm run test:sim7b-qualification",
  "reportDigest": "sha256:64-lowercase-hex-characters"
}
```

Approval of this lane does not itself edit provider authority. Any later
promotion must be a separate reviewed change that verifies the reviewed commit
is the released commit, all prerequisites are valid, and no evidence has
changed. Until then the matrix and exact-tuple provider remain
`internally_validated` with engineering use denied. Public-beta deployment is
permitted but is not engineering qualification.

## Current gate report (2026-09-13)

- PASS — 10 automated lanes.
- FAIL — none recorded.
- PENDING — independent engineering review.
- Automated-evidence digest —
  `sha256:7562db70af38d9f5fc470b510a24df8194b6350e07f2669a1b3a8da887eaeb60`.

Rerun `npm run test:sim7b-qualification` on the exact public commit under
review and use its printed digest if any matrix evidence changes. The current
matrix remains `internally_validated` and denies engineering use.
