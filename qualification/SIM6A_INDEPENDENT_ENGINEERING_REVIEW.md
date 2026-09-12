# SIM-6 independent engineering review packet

SIM-6 is proof-of-concept only. All automated matrix lanes now pass,
but it must not be promoted for engineering use until an independent qualified
engineer reviews the exact commit.

The review must cover the node-to-surface penalty formulation, secondary and
primary selection, small- versus finite-sliding semantics, `NLGEOM`
finite-deformation assumptions, linear-elastic constitutive limitations,
linear pressure-overclosure units and
signs, Coulomb coefficient and penalty stick-slope sensitivity, stick/slip
interpretation, no-adjustment and bounded planar/curved adjustment policies,
the closest-triangle mesh-space adjustment guard, deformed-surface clearance
recovery, immutable-CAD boundary, rigid-body stability rank,
increment/cutback interpretation, CONTACTR and status-file parsing, integrated
contact-force direction, mesh sensitivity, and every stated limitation.

The reviewer must independently reproduce the passed real patch,
opening/closing, bounded planar and curved initial clearance/interference,
frictional sliding, 4 mm finite sliding across changing projections,
penetration/refinement, deliberate non-convergence, and cancellation lanes.
Approval evidence must name the reviewer and relevant qualification, exact reviewed
commit, environment and solver versions, commands, raw result digests, and any
accepted deviations. Until that evidence is recorded, the matrix stays
`proof_of_concept` with `engineeringUsePermitted: false`.
