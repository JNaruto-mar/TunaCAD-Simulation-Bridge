# SIM-2 independent engineering review packet

This review is the final manual gate for the exact environment recorded in
`sim2-windows-gmsh-4.15.2-calculix-2.16.json`. It does not qualify other solver
versions, operating systems, architectures, material laws, load types, or
analysis procedures.

## Reviewer independence and competence

The reviewer must be independent of the implementation and competent to assess
linear-static finite-element modelling, second-order tetrahedral discretization,
solid-mechanics benchmarks, and solver-result interpretation. Record the
reviewer's name, organization, and relevant professional qualification in the
signed report.

## Required review

- Confirm the request, mesh, and result contracts preserve units, geometry
  identity, load/constraint identity, and immutable project revision.
- Review the cantilever analytical model, including bending/shear assumptions,
  boundary conditions, load application, mesh sequence, and 8% tolerance.
- Review the plate-with-hole geometry, nominal-stress definition, expected
  concentration range, boundary effects, refinement sequence, and 20% trend
  tolerance.
- Review the tapered-bracket convergence evidence and the displacement/stress
  acceptance bands.
- Confirm reaction recovery is independent CalculiX output and that the global
  force-equilibrium tolerance is appropriate.
- Confirm the near-singular fixture produces the critical
  `SIMULATION_SMALL_DISPLACEMENT_ASSUMPTION_EXCEEDED` warning and cannot be used
  as small-displacement engineering evidence.
- Review cancellation, hostile-file, timeout, cleanup, diagnostic, disk, CPU,
  memory, and kill-on-close acceptance evidence.
- Confirm the claimed environment exactly matches Windows x64, Node 24, Gmsh
  4.15.2, and CalculiX 2.16.
- Document every limitation, deviation, unresolved concern, and recommended
  restriction. The decision must remain rejected until material concerns are
  resolved and re-reviewed.

## Promotion evidence

After approval, archive the signed report outside the repository as appropriate
for its confidentiality requirements. Compute its SHA-256 digest and replace
the pending lane's `evidence` with this exact shape:

```json
{
  "decision": "approved",
  "reviewerName": "Full name",
  "reviewerOrganization": "Organization",
  "reviewerQualification": "Relevant license, registration, or documented competence",
  "reviewedAt": "YYYY-MM-DD",
  "matrixId": "sim2-windows-x64-gmsh-4.15.2-calculix-2.16",
  "reviewedCommit": "40-character public Bridge commit SHA",
  "reportDigest": "sha256:64-lowercase-hex-characters"
}
```

Set the lane to `passed` and its command to `npm run test:qualification`. Do not
change provider capability status or `engineeringUsePermitted` until the signed
evidence is validated, the reviewed commit is the released commit, and the
promotion change receives normal code review.
