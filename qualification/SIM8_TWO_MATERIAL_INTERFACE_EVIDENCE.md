# SIM-8 two-material interface development evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is a focused
provider fixture, not a qualification matrix or public-beta workflow.

## Reproducible reference

- Geometry: two adjacent 50 x 10 x 10 mm solids, joined only through one
  explicit conformal shared-topology FACE interaction. The composed quadratic
  interface must have identical node and facet identities on both sides.
- Materials: first domain k=50 W/(m*K); second domain k=100 W/(m*K).
  Each domain has its own constant-conductivity CalculiX material section.
- Thermal boundary conditions: x=0 FACE at 20 C; x=100 mm FACE receives
  10,000 W/m^2 inward flux. The lateral faces are insulated by omission.
- Closed-form series comparator: area 100 mm^2 and one watt conducted through
  both materials. The first 50 mm contributes 10 C, the second contributes
  5 C: interface 30 C, free end 35 C, maximum gradient 200 C/m. This assumes
  perfect thermal contact with no interface resistance.
- Run npm run test:sim8-two-material-interface for analytical/admission checks.
  Set TUNACAD_SIM8_REAL=1 and the Gmsh/CalculiX executable environment
  variables for the focused provider run. The script removes only its own
  temporary working directory.

## 2026-09-22 focused provider result

Gmsh 4.15.2 produced 1,121 nodes and 508 DC3D10 elements. CalculiX 2.16
produced:

| Quantity | Closed form | Provider | Error |
| --- | ---: | ---: | ---: |
| Interface temperature | 30 C | 30 C | 0 C |
| End temperature | 35 C | 35 C | 0 C |
| Maximum gradient | 200 C/m | 200 C/m | 0 C/m |
| Applied heat | +1 W | +1 W | 0 W |
| Base reaction heat | -1 W | -0.999999990 W | 1.00e-8 W |
| Global heat-balance residual | 0 W | 1.00e-8 W | 1.00e-8 W |

The two provider material sections and shared-node interface are checked in
the deterministic deck. A repeated CalculiX solve on the same composed mesh
produced an exactly equal normalized thermal result; run identifiers and
timestamps are intentionally excluded from that comparison. A request with
unbound interface references is rejected before geometry transfer.

This demonstrates perfect-contact shared-topology conduction for one
rectangular pair. It does not validate nonconformal interfaces, contact
conductance/resistance, broader geometry, mesh convergence, browser authoring,
or formal engineering use. The earlier slab and convection-fin evidence
remain separate and have not been promoted.
