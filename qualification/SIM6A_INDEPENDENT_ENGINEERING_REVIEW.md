# SIM-6A independent engineering review packet

SIM-6A is proof-of-concept only. It must not be promoted for engineering use
until the pending lifecycle lane in
`sim6a-windows-gmsh-4.15.2-calculix-2.16.json` pass and an independent
qualified engineer reviews the exact commit.

The review must cover the node-to-surface penalty formulation, secondary and
primary selection, small-sliding limits, linear pressure-overclosure units and
signs, no-adjustment initial geometry policy, rigid-body stability rank,
increment/cutback interpretation, CONTACTR and status-file parsing, integrated
contact-force direction, mesh sensitivity, and every stated limitation.

The reviewer must independently reproduce the passed real patch,
opening/closing, and penetration/refinement lanes plus the pending
non-convergence and cancellation lane. Approval
evidence must name the reviewer and relevant qualification, exact reviewed
commit, environment and solver versions, commands, raw result digests, and any
accepted deviations. Until that evidence is recorded, the matrix stays
`proof_of_concept` with `engineeringUsePermitted: false`.
