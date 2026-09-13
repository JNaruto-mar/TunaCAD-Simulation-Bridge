# Simulation validation and qualification policy

Effective 2026-09-13.

## Current operating state

SIM-2 through SIM-7 are internally validated for their recorded runtime tuple
and deployed as experimental public beta. Normal roadmap development,
deployment, tutorial use, and public-beta testing do not require independent
engineering review. They retain:

- `status: public_beta` on the public deployment surface;
- `validationStatus: internally_validated` for the recorded automated evidence;
- `engineeringUsePermitted: false`; and
- the existing warnings, provider admission, approval gates, result quarantine,
  resource limits, evidence digests, and capability-specific limitations.

## Development and revalidation

Continue the next bounded SIM capability while preserving existing regression
coverage. Add or repeat capability-specific validation when, and only when, at
least one of these triggers applies:

1. a capability introduces previously uncovered physics;
2. an underlying implementation affecting a validated claim changes;
3. Gmsh, CalculiX, Node, operating-system, or other evidence-bound runtime
   versions change;
4. a hosted tutorial result differs from its recorded reference or tolerance;
5. a qualification assumption, acceptance rule, or numerical tolerance changes.

An unrelated documentation, tutorial, UI, or roadmap increment does not reopen
validated numerical gates. A triggered revalidation remains scoped to the
affected capability and its dependencies.

## Formal qualification

Independent engineering review is dormant unless TunaCAD intentionally opens a
formal promotion effort for a defined capability and engineering-use scope. At
that point it becomes a required promotion gate from
`internally_validated/public_beta` toward `independently_reviewed` or
`qualified`. Existing reviewer packets and pending review lanes are retained
for that future workflow; they are not outstanding public-beta work and do not
set normal roadmap priority.

No review result automatically changes provider authority. A separate reviewed
promotion change must define the engineering-use scope, bind the reviewed
evidence and runtime tuple, and explicitly change `engineeringUsePermitted`.
