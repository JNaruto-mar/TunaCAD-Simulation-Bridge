# SIM-7A independent engineering review packet

SIM-7A is proof-of-concept only. The first contract, deterministic deck,
bounded history, native large-deflection, mesh/increment convergence,
deliberate non-convergence, and cancellation lanes pass. Independent review is
the sole pending SIM-7A gate. Engineering use is not permitted.

The review must cover the total-Lagrangian/updated-Lagrangian behavior actually
used by CalculiX `NLGEOM`, finite-deformation and finite-strain wording with an
isotropic linear-elastic constitutive law, dead-load direction, ordered step
and `OP=NEW` semantics, STEP TIME amplitude interpolation, automatic increment
units, maximum-iteration and cutback mapping, successful `.sta` record meaning,
increment-frequency `.dat` framing, force/displacement signs, final-field
identity, reaction equilibrium, rigid-body stability, mesh and increment
sensitivity, and the immutable-CAD/no-partial-result boundary.

The deliberate one-increment ceiling and active-cancellation fixtures must also
be reproduced: neither may expose partial history or fields, both must remove
native working data, and a late process exit must not resurrect a result.

The reviewer must independently reproduce the contract/deck/parser lane, the
150 x 10 x 5 mm beam comparison, its three-mesh/three-increment
force-displacement convergence matrix, and deliberate increment exhaustion plus
cancellation evidence. Approval evidence must
name the reviewer and relevant qualification, exact reviewed commit,
environment and solver versions, commands, raw-result digests, tolerances, and
accepted deviations.

Snap-through or limit-point continuation is not claimed by this increment.
Plasticity, unloading/reloading, plastic hinges, plastic strain, and energy are
SIM-7B work and must remain separately capability-gated.
