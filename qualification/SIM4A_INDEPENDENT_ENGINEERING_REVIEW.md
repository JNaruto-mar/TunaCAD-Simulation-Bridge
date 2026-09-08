# SIM-4A independent engineering review packet

This is the remaining manual gate for
`sim4a-windows-gmsh-4.15.2-calculix-2.16.json`. It does not qualify other
versions, hosts, interactions, contact, or nonlinear analysis.

The independent reviewer must be competent in linear-static solid FEA,
second-order tetrahedra, multi-material assemblies, result recovery, and mesh
visualization. The signed review must:

- verify domain, occurrence-transform, material, volume, FACE, and digest
  ownership through preparation, meshing, solve, pagination, and visualization;
- review the disconnected repeated-occurrence and explicitly bonded
  two-material coupon definitions, analytical series-stiffness expectation,
  reaction equilibrium, material sensitivity, tolerances, and mesh evidence;
- verify nodal displacement and element/integration-point stress recovery,
  boundary-facet projection, extrema, units, deformation scale, mapping-quality
  disclosure, cursor bounds, chunk digests, and complete-dataset digests;
- verify cancellation, expiration, malformed-page rejection, and prevention of
  native solver-file exposure; and
- record every limitation, concern, and restriction. Any material concern keeps
  the decision rejected until corrected and re-reviewed.

If approved, retain the signed report outside this repository and record its
SHA-256 digest in the matrix lane using the same reviewer identity and reviewed
commit fields required by `INDEPENDENT_ENGINEERING_REVIEW.md`, but with
`matrixId: "sim4a-windows-x64-gmsh-4.15.2-calculix-2.16"`. Do not set
`engineeringUsePermitted: true` until a validator checks that evidence against
the released public commit and the promotion receives normal code review.
