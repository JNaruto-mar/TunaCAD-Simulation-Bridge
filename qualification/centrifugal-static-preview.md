# Constant-speed centrifugal linear static — Experimental Preview foundation

Status: three bounded provider-level native radial-bar benchmarks (5/3/2 mm) passed. Global displacement/reaction refinement met the provisional <1% indicator; local fully fixed-root peak von Mises stress did not demonstrate convergence. engineeringUsePermitted=false. No stress-stiffening, rotor-dynamic or engineering qualification is claimed. Not added to the qualified/public-beta catalogue.

## Supported envelope

One homogeneous isotropic linear-elastic 3D solid/material, positive governed density <=100000 kg/m³, one constant centrifugal body load and one or more fixed FACE restraints. No interactions, assemblies, additional loads, prescribed-motion drives, modal/buckling/nonlinear/dynamic loading or thermal coupling. Existing v2 geometry, source revision, frozen occurrence transform, dual approvals, mesh admission, cancellation, quarantine, integrity and cleanup remain authoritative.

Neutral analysis remains linear_static. A new capability-gated v2 load is:

    {id, name, type: 'centrifugal', speedRpm,
     axisPointMm: [x,y,z], axisDirection: [nx,ny,nz], coordinateSystem: 'analysis'}

0 < speedRpm <=60000. Axis point components within ±1e6 mm; direction is finite and unit length within 1e-10. Axis is in frozen analysis/global coordinates, not Part-local coordinates or a selected CAD edge. Reversing axis direction does not change this static centrifugal load. User-entered RPM is not a force or angular velocity in rad/s.

Acceleration is omega² times the radial position from the axis, with omega=RPM*pi/30. Conservatively transformed CAD bounds reject acceleration >1e9 mm/s² before transfer; actual nodes/quadrature are checked before solving. Budgets: <=100000 nodes / 50000 quadratic C3D10 elements, plus all stricter existing budgets.

## Adapter and outputs

Uses the existing Gmsh mesh and CalculiX linear-static lifecycle. The CalculiX 2.16 manual's DLOAD/CENTRIF card takes angular-speed squared, an axis point and a normalized axis direction. Density is converted from kg/m³ to the existing mm/N/s convention (factor 1e-12). Native input includes DENSITY, STATIC, fixed boundary sets, CENTRIF, U/S/RF and EVOL; no artificial nodal force substitutes for the native centrifugal load.

Reference: [official CalculiX 2.16 manual, DLOAD](https://www.dhondt.de/ccx_2.16.pdf#page=423). The keyword's detailed point-plus-direction format is used, not its introductory two-point wording.

Consistent nodal body loads are integrated independently using the same existing four-point isoparametric C3D10 quadrature for force balance, including curved midsides. Negative corner weights are retained. Existing reaction correction for body forces at constrained nodes is reused. Normalization requires every node/element, consistent EVOL volume, stationary fixed FACE nodes and force equilibrium. Existing stress/displacement extrema, force reactions, digest-verified paginated fields, legends and deformation scaling are reused. Direct fixed supports do not provide normalized reaction moments.

Centrifugal results carry an explicit warning: constant-speed undeformed-geometry static approximation; no spin-up, Coriolis/gyroscopic effects, rotating vibration, nonlinear stress stiffening or qualification. Existing result authority metadata does not override engineeringUsePermitted=false.

## Solver-free checks

    node --experimental-strip-types scripts/test-centrifugal-static.mts

Synthetic unit mesh/DAT only, not native evidence. Covers bounds/density/unit direction, request digests, old-provider rejection, RPM² deck units, C3D10 force integration, translated-axis invariance, strict result/volume/support/equilibrium checks and actual normalized stress/displacement field-page integrity.

## First bounded native benchmark

Steel radial bar: 100 × 5 × 5 mm, E=210000 MPa, nu=0.30, rho=7850 kg/m³. Owner-local box [0,100] × [0,5] × [0,5] mm; occurrence translation [20,-2.5,-2.5] mm, no rotation. Fixed full root FACE at analysis X=20 mm; all other FACEs traction-free. Rotate at 6000 RPM about global Z through [0,0,0]. No loaded FACE or mechanical surface force. Quadratic mesh target 5 mm.

Independent slender-bar reference, r0=20, r1=120 mm, rho=7.85e-9 in consistent mass units:

    sigma_x(r) = rho * omega² * (r1² - r²) / 2
    u_tip = rho * omega² / (2E) * [r1²*(r1-r0) - (r1³-r0³)/3]

Expected axial tip displacement: 0.0063948770 mm. Expected root force: approximately [-542.33476184,0,0] N; axial section-average stress at root: 21.69339047 MPa. These are derived analytical expectations, not solver outputs. A fully clamped 3D root has Poisson/local stress concentration; do not compare maximum von Mises stress directly to the 1D nominal root stress. Transverse centrifugal loading and finite cross-section effects also distinguish the 3D case.

Initial checks used: root resultant within 1%, axial tip displacement within 5%, stationary fixed FACE (1e-8 mm), complete finite stress/displacement fields and native force/volume integrity. A match is not mesh convergence or qualification.

Executed resource scope for the initial 5 mm case: one Gmsh mesh and one CalculiX solve, sequential, zero native retries, under <=30000 nodes / 15000 elements, 120 s execution/CPU, 1 GiB memory, 512 MiB working-directory and 256 MiB result-file limits. A local OpenCascade STEP export created the isolated fixture without a geometry-only Gmsh run. Production protected studies still require both distinct real human gates; provider-level tests did not exercise those gates. This document does not authorize solver installation, reconfiguration or further native cases.

## Native outcome and boundary

One provider-level native validation completed with exactly one Gmsh mesh and one CalculiX solve, zero retries. A local OpenCascade export produced the owner-local STEP box; the sealed request translated its analysis bounds to X=20..120 mm, Y/Z=±2.5 mm and mapped 13 fixed root nodes across four facets. This isolated test did not enter the protected browser/Bridge submission workflow; its separate human approval gates remain mandatory for production studies. Private numerical evidence remains in the TunaCAD workspace and is not part of this public submodule.

Initial 5 mm case: Gmsh 927 nodes/420 C3D10 elements; CalculiX 2.16 exit 0 with no diagnostic WARNING/ERROR lines. Integrated body force +542.33476183986 N X; normalized fixed-root reaction -542.334754992551 N X; equilibrium residual 6.8473e-6 N. Mean axial tip displacement 0.00637183708 mm (-0.3603% versus analytical); maximum displacement magnitude 0.00637358605 mm. Maximum von Mises stress 22.992519 MPa. Reaction/25 mm² gives nominal section stress 21.69339020 MPa; peak von Mises is not the one-dimensional nominal stress. Both fields contain 1,312 triangles across 11 verified pages each, with stationary fixed-face vertices and engineeringUsePermitted=false. Only expected SIMULATION_PROVIDER_POC and SIMULATION_CENTRIFUGAL_PREVIEW warnings appeared. This initial case alone was not convergence evidence.
## Three-level radial-bar refinement and interpretation

The same 100 × 5 × 5 mm radial bar, 20–120 mm radius, 6000 RPM, steel properties, global-Z axis, fixed root FACE and quadratic CalculiX static formulation were used at all three mesh sizes. Each refinement used one Gmsh mesh and one CalculiX solve with zero retries and remained below 30,000 nodes/15,000 elements and the existing process limits.

| Target size | Nodes | Elements | Mean tip X displacement (mm) | Root reaction X (N) | Peak von Mises (MPa) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 mm | 927 | 420 | 0.00637183708 | -542.33475499 | 22.992519 |
| 3 mm | 1,543 | 658 | 0.00637481897 | -542.33473584 | 22.320819 |
| 2 mm | 3,811 | 1,804 | 0.00637601678 | -542.33474423 | 23.506018 |

Mean tip displacement changed +0.04680% from 5 to 3 mm and +0.01879% from 3 to 2 mm; the latter meets the provisional <1% global-response indicator and is -0.29493% from the analytical tip reference. Root reaction and nominal root section stress remained effectively stable and in force equilibrium. The 2 mm displacement and von Mises fields each contained 5,136 complete digest-verified triangles across 41 pages; the fixed root was stationary.

The local clamped-root peak von Mises stress changed -2.92138% then +5.30984%, so local peak-stress convergence is **inconclusive**. The stress contours represent normalized results for each mesh, not a converged failure stress or a qualified allowable. The benchmark does not validate other geometries, support configurations, rotor failure, spin-up, gyroscopic/Coriolis effects, transient dynamics, nonlinear deformation or stress stiffening. Experimental / Preview, engineer review and engineeringUsePermitted=false remain mandatory. Private raw numerical evidence and browser screenshots are excluded from this public repository.
