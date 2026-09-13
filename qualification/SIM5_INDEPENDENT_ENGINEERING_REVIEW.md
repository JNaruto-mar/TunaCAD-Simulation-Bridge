# SIM-5 independent engineering review packet

This is the remaining manual gate for
`sim5-windows-x64-gmsh-4.15.2-calculix-2.16`. Automated analytical and
convergence evidence does not authorize engineering use.

The independent reviewer must be competent in structural dynamics, solid
finite elements, linear eigenvalue buckling, multi-domain coupling, and mesh
convergence. The signed review must independently assess:

- the consistent-mass `*FREQUENCY` formulation, homogeneous restraint rules,
  density units, frequency bounds, solver numbering, six-axis participation
  factors, effective modal mass, and mass-coverage calculation;
- the free-free classification of CalculiX's six solver-omitted rigid-body
  modes, including the fail-closed threshold and the decision not to fabricate
  field vectors for singular modes;
- the Euler-Bernoulli beam and Kirchhoff-Love clamped-plate analytical models,
  boundary assumptions, applicability limits, tolerances, and three-level
  eigenvalue mesh-convergence evidence;
- the explicit bonded-tie two-domain cantilever, including interface
  formulation, ownership of per-domain fields, and comparison to the
  monolithic beam reference;
- the `*BUCKLE` reference-load formulation, sign convention, positive-factor
  recovery, DAT/FRD factor cross-check, mode ordering, deterministic
  visualization normalization, fixed-free Euler-column comparison, mesh
  adequacy, and declared tolerance; and
- the mandatory boundary between idealized linear bifurcation and nonlinear
  collapse, including excluded imperfections, large deformation, plasticity,
  residual stress, load-path evolution, and contact changes.

Run the evidence on Windows x64 with Node 24, Gmsh 4.15.2, and CalculiX 2.16:

```powershell
npm run test:providers
npm run test:sim5-modal
npm run test:sim5-modal-qualification
npm run test:sim5-multidomain-modal
npm run test:sim5-linear-buckling
npm run test:sim5-matrix
```

Any approval evidence must identify the reviewer and qualification, reviewed
public commit, review date, exact matrix ID, and SHA-256 digest of the signed
report. Any material concern keeps the decision rejected until corrected and
re-reviewed. Until validated approval evidence is incorporated, the matrix is
`internally_validated` for experimental public beta, with
`engineeringUsePermitted: false`.
