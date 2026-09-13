# Simulation validation status

Updated 2026-09-13 for the public Simulation Bridge. The governing policy is
[VALIDATION_POLICY.md](VALIDATION_POLICY.md).

## Roadmap priority decision

SIM-2 through SIM-7 are internally validated for the exact recorded Windows
x64 / Node 24 / Gmsh 4.15.2 / CalculiX 2.16 tuple and are deployed as public
beta. Independent engineering review is not active work and is not required to
continue development, deployment, tutorials, or public-beta use.

Normal priority is the next bounded SIM capability. Preserve the existing
capability-specific regression matrices and rerun or extend validation only
when new physics, an affected implementation change, a runtime-version change,
hosted/reference drift, or a changed qualification assumption/tolerance
triggers it.

## Capability reports

| Capability | Automated gates | Public status | Engineering use | Formal review |
| --- | ---: | --- | --- | --- |
| SIM-2 | 9 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |
| SIM-3 | 4 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |
| SIM-4A | 4 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |
| SIM-4B | 4 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |
| SIM-5 | 7 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |
| SIM-6 | 11 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |
| SIM-7A | 6 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |
| SIM-7B | 10 PASS / 0 FAIL | `public_beta` | Denied | Dormant promotion gate |

Every row is `internally_validated` and retains its version-bound evidence
digest, limitations, and `engineeringUsePermitted: false`. SIM-8 and SIM-9 are
not covered by these statuses.

## Formal-qualification boundary

If TunaCAD later intentionally pursues formal qualification, independent review
starts with SIM-2, followed by SIM-4, SIM-5, and SIM-6 unless the proposed
engineering-use scope requires a different dependency order. The applicable
matrix review lane and reviewer packet then become active. Until that explicit
decision, their `pending` state describes an unstarted future promotion gate,
not incomplete public-beta validation and not a roadmap blocker.
