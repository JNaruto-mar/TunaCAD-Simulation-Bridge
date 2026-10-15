# Linear buckling — Experimental Preview release review

Status: Experimental / Preview. `engineeringUsePermitted=false`.
This increment is not engineering qualification. One coarse fixed-free force case passed native
normalization after the parser correction; convergence and other load/restraint combinations remain unvalidated.

## Existing implementation reused

SIM-5 already supplies neutral `linear_buckling` preparation/request/result contracts, provider admission,
the bounded Gmsh C3D10 model path, CalculiX `*BUCKLE`, DAT factors, FRD eigenvectors,
deterministic unit-maximum eigenvector normalization and digest-verified mode pages.
The existing column acceptance script is retained evidence of an acceptance procedure, not evidence that
every CAD authoring/pressure/restraint combination has passed native validation.

## Procedure and load semantics

The official [CalculiX 2.16 manual](https://www.dhondt.de/ccx_2.16.pdf), sections 6.9.4 and 8.6,
defines an unloaded-base buckling step whose reference loading is scaled by the eigenvalue.
The reused deck emits one `*STEP` / `*BUCKLE` with reference nodal forces and homogeneous restraints.
No preceding `*STATIC` or `PERTURBATION` is needed for this unprestressed case.
An independent prestress would require a preceding static/dynamic state and perturbation semantics;
that formulation is deliberately not exposed. The legacy `preloadCase` field names the scaled reference
pattern only. Pressure reuses existing consistent surface-to-nodal load integration.

The CAD editor allows 1–6 modes; the compatible prepared-job provider retains its existing 1–12 limit.
Admission allows one homogeneous isotropic elastic solid, compressive reference force or positive inward
pressure, and fixed or exactly zero prescribed-displacement components. Nonzero displacement loading,
independent prestress, contacts, multiple materials/domains and remote conditions are not admitted.
Insufficient restraints remain subject to the existing mesh-based stability checks.

New mode results optionally add `criticalLoads`: signed force vector and magnitude in N, or pressure in MPa.
Estimates are checked against the immutable request and factor by both Bridge and TunaCAD validators.
Older protected/retained modes without this additive metadata remain readable, with no fabricated estimate.
Negative/zero/nonfinite/malformed factors, incomplete mode counts, duplicate FRD nodes and solver failure
diagnostics are rejected. Mode scaling/animation is not a physical displacement or collapse prediction.

## Future convergence plan — separate authorization required

Reuse `scripts/test-sim5-linear-buckling.mts`, not a new simulation pipeline.
Column: 200 × 10 × 10 mm, E=210000 MPa, ν=0.3, fixed x=0 FACE, -1000 N reference force
on x=200 FACE, three modes, C3D10. Euler fixed-free K=2 gives Pcr≈10794.88 N and λ≈10.79488.
Proposed mesh levels: 8, 5 and 3.5 mm (`--mesh-size=8`, `--mesh-size=5`, `--mesh-size=3.5`).
This is one benchmark with THREE Gmsh mesh operations and THREE CalculiX solves, not one native process.
Each request is capped at 100000 nodes / 50000 elements plus existing provider limits and cancellation.
Authorize aggregate execution/time limits before starting; stop at any resource, admission or convergence failure.
Acceptance target: positive complete three-mode DAT output, indexed FRD modes with header cross-checks, normalized complete modes,
unchanged preview authority, fine-mesh first factor within 10% of Euler and medium-to-fine factor change ≤5%.
The square cross-section has nearly degenerate first bending modes; eigenvector orientation is not an acceptance invariant.
Force/fixed validation would not qualify the newly added pressure or component-restraint paths by itself.

## Solver-free FRD correction — 2026-10-15

The first authorized 8 mm run meshed and solved but failed normalization. Its stdout factor 10.813147
remains preliminary, not three-mode native acceptance. Raw DAT/FRD files were not retained.

Official [CalculiX 2.16 source](https://www.dhondt.de/ccx_2.16.src.tar.bz2): arpackbu.c initializes time=0
(line 85), writes reference-load DISP (382–389), writes DAT factors with writebv (647), then emits
indexed eigenvectors using d[j] (663–731). frdheader.c writes the output increment kode and buckling
analysis code 4; its 1PMODE records are frequency-only (44–85,99–100,118–154). writebv.f writes the
numbered DAT factor table (30–38).

The old parser demanded a positive eigenvalue at every DISP header, including the legitimate zero-time
reference field. The old synthetic mock omitted that field. The correction validates reference DISP
separately, associates eigenvectors by output increment minus one, and keeps DAT factors authoritative.
FRD values only cross-check DAT; shape association never depends on sorting or factor magnitude.
Equal/degenerate factors retain separate modes. This parser supports the existing single-step U-only
ASCII procedure, not arbitrary multi-step, prestressed or binary results.

Complete node sets, positive finite DAT factors, exact requested counts, finite/nonzero eigenvectors,
strict fixed-width records and deterministic sign/unit-maximum normalization remain mandatory.
Malformed, missing, duplicate, reordered, interrupted and truncated fields are rejected.

PASS: 47 source-derived DAT/FRD/normalization regressions, canonical buckling foundation regression and
host buckling contract/security regression. Source-derived records are not captured native acceptance
or copies of private fixtures. No Gmsh/CalculiX run or build occurred during the parser correction.
The five pre-existing strict provider TypeScript errors remain unchanged and separately documented.
The later, separately authorized repeat passed normalization; see the accepted coarse case below.

## Proposed failure-evidence retention — NOT implemented

Keep normal rawArtifactRetentionMs=0 and provider working-directory cleanup mandatory. A future
host-owned capture may be enabled only by explicit local operator consent for one source-bound run;
never by browser/MCP flags or user-supplied destination paths.

Before normalization-failure cleanup, capture only regular, non-symlink DAT/FRD files opened within
the provider-owned directory. Recheck containment/identity/size, reject reparse traversal, and never
include STEP, input decks, configuration, environment variables, credentials or unrelated files.
Use a non-served service-owned local spool, random incident IDs, Windows owner/service-only ACLs and
authenticated encryption with an OS-protected key. Cap each file at min(provider result cap,16 MiB),
each incident at 32 MiB, and aggregate at 64 MiB/two incidents. Expire after one hour and purge on
startup/logout. A restricted manifest records request/model/file digests, sizes, failure stage and expiry.
Only the same authenticated owner may inspect/export; retained raw files are not trusted results.

Capture must be bounded (two seconds), best-effort and fail closed; cleanup must run in finally even
when capture fails. Oversized/unverifiable files are not copied; emit a sanitized diagnostic instead.
No public HTTP route, telemetry upload, Git artifact, build asset or permanent protected archive.
Consent, ACL/encryption, expiry, cancellation and cleanup tests are required before implementing this
option for protected user data. This parser patch does not enable retention or weaken cleanup.

## Accepted coarse native case and release boundaries — 2026-10-15

A separately authorized second 8 mm validation completed one Gmsh mesh and one CalculiX 2.16 solve.
The 200 × 10 × 10 mm steel column (E=210000 MPa, nu=0.3), fixed-free with -1000 N axial reference
force, produced 1156 nodes / 495 C3D10 elements and three complete normalized modes. Factors were
10.81315, 10.81399 and 95.83403; idealized force magnitudes were 10813.15, 10813.99 and 95834.03 N.
The first factor differs from Euler's 10.794879814 by approximately 0.1692%. Full requested mode
counts, unit-maximum normalization, stationary fixed-end vectors and field digests passed validation.
This single coarse force/fixed case is NOT a mesh-convergence study or engineering qualification.
No native runs are authorized as part of this release. Retained native datasets, raw files and local
viewer acceptance harnesses are not published with this public repository.

Pressure and component-restraint native acceptance, mesh convergence, nonlinear collapse, imperfection
sensitivity and post-buckling are not validated. No engineering use is permitted. Existing source-bound
geometry-transfer/Bridge approvals, authentication, resource limits and protected result cleanup stay
mandatory. Public two-dielectric execution remains disabled; no execution or qualification gate changes.

The five confirmed pre-existing strict provider TypeScript errors are separate: harmonic argument type,
CalculiX monitor callback return type, Gmsh monitor callback return type, Modal settings narrowing and
general pressure/thermal union narrowing. They were reproduced against baseline 73ed77c and are not
fixed by this release. Application/Worker production compilation is checked separately.
