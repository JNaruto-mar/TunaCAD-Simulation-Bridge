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
- Review the three-run identical-request repeatability evidence, its exact
  mesh/response identity, and the declared `1e-10` relative-spread threshold.
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
  "reviewedAutomatedEvidenceDigest": "sha256:copy the digest printed by npm run test:qualification",
  "reportDigest": "sha256:64-lowercase-hex-characters"
}
```

Set the lane to `passed` and its command to `npm run test:qualification`. Do not
change provider capability status or `engineeringUsePermitted` until the signed
evidence is validated, the reviewed commit is the released commit, and the
promotion change receives normal code review.

Before review, run `npm run test:qualification` on the exact public commit and
record the printed automated-evidence digest. That digest covers the matrix ID,
scope, environment, promotion policy, and every non-review lane including its
acceptance rule, command, and evidence. The approval must reproduce it exactly;
changing any automated evidence invalidates the sign-off without relying on a
self-referential matrix-file digest.

## Current gate report (2026-09-12)

- PASS — all automated SIM-2 lanes, including analytical response, three-level
  mesh evidence, reaction equilibrium, hostile input, cancellation, Windows
  quotas, near-singular warning behavior, and identical-request repeatability.
- FAIL — none recorded.
- PENDING — independent engineering review of the exact public commit and
  version-bound evidence described above. The current automated-evidence digest
  is `sha256:fa68057b7c45c1068a69b21dd5a34f9c2a6d54a3da697b8512cc38375d9c6077`;
  rerun the qualification command on the reviewed commit and use its printed
  value if the evidence changes.

The capability is `internally_validated` for the exact runtime tuple and may be
deployed as experimental public beta. It is not independently reviewed or
qualified, and `engineeringUsePermitted` remains `false`.
