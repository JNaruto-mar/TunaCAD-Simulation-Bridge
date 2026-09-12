# SIM-7B material-nonlinearity development status

Recorded 2026-09-13. This is development evidence only. SIM-7B is not a
qualified capability and `engineeringUsePermitted` remains false.

## Current increment — PASS / PENDING

- PASS: strict isotropic-hardening table validation and fail-closed provider
  admission.
- PASS: deterministic CalculiX `*PLASTIC`, `PEEQ`, `ENER`, and `ELSE` deck
  output, including energy requests from the first nonlinear step.
- PASS: bounded material-state recovery for every converged increment and
  final equivalent-plastic-strain/energy-density pagination.
- PASS: native Gmsh 4.15.2 / CalculiX 2.16 434-element axial coupon with
  0.03863676 maximum equivalent plastic strain, 11.28585 MPa maximum energy
  density, 104210.9 N·mm total internal energy, 434 yielded elements, and
  -30000.02 N axial reaction.
- PASS: missing, incomplete, non-finite, or negative material output is
  rejected rather than normalized or exposed.
- FAIL: none recorded for this increment.
- PASS: two-step 30 kN load/unload/reload coupon with 22 converged increments
  per step, 196018.17/195999.69 N/mm elastic branch stiffnesses, R² above
  0.9999997, 3.628044 mm residual elongation, and branch-intercept agreement
  within 0.000011 mm.
- PASS: PEEQ is nondecreasing, remains 0.03870592 through unloading, and does
  not grow when reloading only to the previous maximum; reactions remain in
  path equilibrium within 3 N.
- PASS: recoverable energy falls during unloading and returns during reload;
  final internal energy of 104878 N·mm agrees with integrated external work to
  0.0753%.
- PASS: both monotonic and load/unload/reload histories use actual 209, 309,
  and 434-element meshes. The medium-to-fine whole-history changes are at most
  0.2740% displacement, 0.8078% PEEQ, and 0.2849% internal energy, below the
  declared 3%/8%/5% mesh limits. Because separately generated unstructured
  tetrahedral meshes need not approach monotonically, this gate requires
  increasing element count and a bounded fine-pair difference rather than a
  false monotonic-error claim.
- PASS: both histories use maximum nonlinear increments 0.10, 0.075, and 0.05.
  Every whole-history norm contracts. Medium-to-fine differences are at most
  0.3727% displacement, 0.3277% PEEQ, and 0.9746% internal energy, all below
  2%.
- PASS: the load/unload/reload derived path metrics are stable. Fine mesh
  differences are 0.2780% residual displacement, 0.1919% unloading stiffness,
  and 0.1830% reloading stiffness; fine increment differences are 0.3868%,
  0.0245%, and 0.0488%, respectively, below 3%.
- PASS: an analytically bracketed 100 x 10 x 10 mm solid cantilever compares a
  monotonic 400 N path (240 MPa nominal root bending stress, below the 250 MPa
  yield point) with a 600 N overload (360 MPa nominal) returned to the same
  final 400 N resultant.
- PASS: the monotonic path remains elastic, while the overload-return path
  retains 0.0009195724 maximum PEEQ entirely in the 0–25 mm root zone. The
  transition and far zones remain zero at the final state.
- PASS: at the common final resultant, the overload-return path has 1.3033x
  the fitted root-zone chord rotation and 1.3862x the internal energy. PEEQ
  remains at its overload maximum during the return step.
- PASS: endpoint reaction history records 400 N for the monotonic path and
  599.9999 → 400 N for overload/return. Every increment balances its prescribed
  load within 0.0001 N.
- PENDING: reordered multi-axis/non-proportional paths are not claimed by this
  single-load fixture.
- PASS: deliberate 36-increment exhaustion reaches 33 complete material frames
  while the provider is running, including positive PEEQ (0.00004152414),
  energy density (0.1676008 MPa), and total internal energy (1456.942 N·mm),
  before terminating as `SIMULATION_SOLVER_FAILED`.
- PASS: active cancellation is issued only after 34 complete material frames
  with the same positive material state are observed while the provider is
  running. It reaches `cancelled_cleaned` and cannot be resurrected by the late
  child exit.
- PASS: both terminal paths return no normalized result, reject displacement,
  stress, equivalent-plastic-strain, and energy-density dataset access, and
  remove the exact native working directory.
- PENDING: a separate formal qualification matrix and independent engineering
  review after the automated SIM-7B exit gates pass.

The single next increment is a formal SIM-7B qualification matrix and reviewer
packet that consolidates the completed coupon, unloading/reloading,
mesh/increment convergence, lifecycle, and plastic-hinge path gates. It must
remain `proof_of_concept` until the matrix is complete and independently
reviewed; reordered multi-axis loading should remain an explicit unsupported
limitation rather than delaying that capability-specific review.
