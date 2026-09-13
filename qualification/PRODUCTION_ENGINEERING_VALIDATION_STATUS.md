# Production-engineering validation status

Updated 2026-09-13 for the public Simulation Bridge. Qualification is
capability-specific; a decision for one row cannot promote another analysis,
provider version, operating system, or architecture.

## Priority decision

Begin independent production-engineering validation now, in parallel with
experimental SIM-7/8/9 development. Start with SIM-2 because its units,
second-order tetrahedral discretization, load/reaction recovery, lifecycle, and
provider-runtime assumptions are reused by the later structural capabilities.
An issue found here should be corrected before relying on those assumptions in
later reviews. Do not pause bounded experimental development while review is in
progress, and do not promote any capability automatically.

Required review order:

1. SIM-2 linear static;
2. SIM-4A multi-domain/material and SIM-4B connected behavior;
3. SIM-5 modal and linear buckling; and
4. SIM-6 contact.

## Capability reports

### SIM-2 — PASS / PENDING

- PASS: every automated matrix lane. The 2026-09-12 increment adds three runs
  of one identical sealed request with identical 1,618-element meshes,
  displacement, stress, and reactions; maximum relative spread is zero against
  a `1e-10` limit.
- PASS: the qualification harness now binds any future approval to the full
  automated evidence set with digest
  `sha256:fa68057b7c45c1068a69b21dd5a34f9c2a6d54a3da697b8512cc38375d9c6077`.
  The digest covers the matrix identity, scope, runtime tuple, promotion policy,
  and every non-review lane's acceptance, command, and evidence.
- FAIL: none recorded.
- PENDING: independent review of definitions, beam/plate assumptions,
  tolerances, equilibrium, repeatability, failure/security/resource behavior,
  exact runtime tuple, and reviewed public commit.
- Decision: automated gates satisfy `internally_validated` for the exact
  runtime tuple and allow experimental public-beta deployment. Production
  review remains priority 1; `engineeringUsePermitted: false`.

### SIM-4A and SIM-4B — PASS / PENDING

- PASS: existing automated SIM-4A domain/transform/material ownership,
  repeated-occurrence solve, pagination, and quarantine lanes; existing SIM-4B
  connector admission, force/moment recovery, bolted-bracket, disconnected,
  and underconstrained failure lanes.
- FAIL: none recorded.
- PENDING: separate independent review packets for SIM-4A and SIM-4B, each
  bound to its exact matrix and public commit.
- Decision: queue immediately after SIM-2 review. No inherited SIM-2 promotion
  and no combined SIM-4A/SIM-4B sign-off.

### SIM-5 — PASS / PENDING

- PASS: existing automated constrained/free-free/plate modal, eigenvalue
  convergence, bonded multi-domain coupling, field transport, and Euler-column
  buckling lanes.
- FAIL: none recorded.
- PENDING: independent dynamics/buckling review, including rigid-mode
  classification, mass formulation, analytical assumptions, convergence,
  normalization, and the linear-bifurcation limitation.
- Decision: begin only after both SIM-4 reviews are resolved or formally
  rejected with corrective work identified.

### SIM-6 — PASS / PENDING

- PASS: existing automated contract, deck, bounded normalization, patch
  equilibrium, opening/closing, adjustment, refinement, lifecycle,
  frictional, finite-sliding, and curved-adjustment lanes.
- FAIL: none recorded.
- PENDING: independent nonlinear-contact review of formulation, penalty and
  sign conventions, tolerances, mesh trends, failure behavior, and exact
  version-bound evidence.
- Decision: begin after SIM-5. Contact review must not inherit SIM-7 evidence.

## Experimental development boundary

SIM-7A and SIM-7B now have capability-specific automated matrices and are
internally validated for the exact runtime tuple; they may be exposed as
experimental public beta. SIM-8 and SIM-9 remain proof-of-concept development.
No earlier capability status authorizes thermal coupling, fatigue, dynamics,
optimization, or professional engineering use. Every result continues to
require warnings and `engineeringUsePermitted: false` until a separately
defined engineering scope is independently reviewed and approved.

## 2026-09-12 SIM-7B development checkpoint

This incremental material-result work does not change any production
qualification gate. SIM-2 automated gates remain PASS, with no recorded FAIL,
and independent engineering review remains PENDING. SIM-4A, SIM-4B, SIM-5,
and SIM-6 retain the PASS / no-FAIL / independent-review-PENDING states above.
The next production action is still review of the exact SIM-2 evidence and
public commit; no additional simulation architecture is required for that
review.

The subsequent SIM-7B load/unload/reload development lane also leaves these
production gates unchanged. It is intentionally excluded from SIM-2/SIM-4/
SIM-5/SIM-6 qualification evidence.

The SIM-7B mesh/increment convergence lane likewise leaves production gates
unchanged. SIM-2 remains automated PASS / no recorded FAIL / independent
engineering review PENDING. Its next action is external review of the exact
public commit, the digest-bound matrix, assumptions, tolerances, and evidence;
no additional architecture is needed before that review begins.

The 2026-09-13 SIM-7B partial-material-history failure/cancellation lane also
does not alter any mature-capability gate. SIM-2 remains production-review
priority 1 with automated PASS / no recorded FAIL / independent engineering
review PENDING.

The SIM-7B single-load plastic-hinge path fixture is likewise experimental and
does not alter SIM-2/SIM-4/SIM-5/SIM-6 qualification. SIM-2 remains automated
PASS / no recorded FAIL / independent engineering review PENDING.

## 2026-09-13 qualification scheduling decision

The SIM-7B formal matrix is ready with 10 automated PASS, no recorded FAIL, and
independent review PENDING. It remains an experimental capability and does not
move ahead of the mature-capability production-review order.

SIM-2 remains priority 1. Its automated matrix and digest-bound reviewer packet
already pass, so additional architecture or substitute automated gates would
not be useful. The next SIM-2 action is independent review of the exact
published public commit. SIM-7B review can be prepared in parallel, but must
remain capability-specific and cannot promote SIM-2, SIM-4, SIM-5, or SIM-6.
