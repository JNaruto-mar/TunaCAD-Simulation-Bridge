# SIM-4B independent engineering review

This packet is the remaining governance gate for
`sim4b-windows-x64-gmsh-4.15.2-calculix-2.16`. Automated evidence does not
authorize engineering use.

The reviewer must independently assess:

- the `*RIGID BODY` reference-node and rotation-node formulation and its six
  degree-of-freedom sign conventions;
- the conversion of CalculiX rotation-node `RF` values to normalized N·mm
  connector moments;
- the force and moment equilibrium reductions about the frozen analysis origin;
- the bolted-bracket surrogate geometry, bonded-interface assumption, mesh
  resolution, analytical resultants, and declared tolerances;
- the choice to return `momentNmm: null` for direct FACE constraints without a
  unique reduction point; and
- the fail-closed connector admission and malformed loaded-support fixture.

Run the evidence on Windows x64 with Node 24, Gmsh 4.15.2, and CalculiX 2.16:

```powershell
npm run test:sim4a-contracts
npm run test:sim4b-connections
npm run test:sim4b-bracket
npm run test:sim4b-matrix
```

Any approval evidence must identify the reviewer and qualification, reviewed
commit, review date, exact matrix ID, and SHA-256 digest of the signed report.
Until that evidence is incorporated and validated, the matrix must remain
`proof_of_concept` with `engineeringUsePermitted: false`.
