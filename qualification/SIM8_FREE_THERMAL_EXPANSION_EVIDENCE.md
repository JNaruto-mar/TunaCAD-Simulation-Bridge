# SIM-8 free thermal expansion development evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is a bounded
provider fixture, not browser/MCP admission or engineering qualification.

## Reproducible fixture and transfer

- One 100 x 10 x 10 mm slab, constant conductivity 50 W/(m*K), 20 C
  prescribed x=0 FACE, and 10,000 W/m^2 inward flux at x=100 mm.
- The thermal step produces a 20–40 C linear nodal temperature field on
  one 468-node, 209-DC3D10 Gmsh 4.15.2 mesh.
- The structural step uses the **same mesh** with E=210,000 MPa, nu=0.3,
  constant alpha=12e-6/K, and an initial/reference temperature of 20 C.
  Exactly three point sets constrain 3+2+1 DOFs to remove rigid-body motion,
  without fixing a FACE or preventing axial expansion.
- The transfer requires identical mesh/model/request identity, node
  coordinates, element connectivity, domain/material ownership, and a
  complete finite temperature value for every node. The 468 transferred
  values retain their exact digest and sum (14,057.5 C). Sparse result
  summaries or a changed target mesh fail closed; no interpolation occurs.
- Run npm run test:sim8-free-thermal-expansion for analytical and contract
  checks. Set TUNACAD_SIM8_REAL=1 plus the Gmsh and CalculiX executable
  environment variables for this one focused two-stage solve. Both solver
  processes use the existing local resource-quota runner and bounded result
  reads; the fixture removes only its own temporary directory.

## 2026-09-22 focused result

The linear-temperature analytical integral is
alpha * L * (average final temperature - initial temperature)
= 12e-6/K * 100 mm * 10 K = 0.012 mm.

| Quantity | Reference | CalculiX 2.16 |
| --- | ---: | ---: |
| Axial end expansion | 0.012 mm | 0.012 mm |
| Resultant point-restraint reaction | 0 N | 4.3144e-11 N magnitude |
| Maximum von Mises stress | 0 MPa | 9.0976e-12 MPa |
| Thermal slab heat-balance error | 0 W | 1.20e-7 W |
| Maximum transferred thermal-profile error | 0 C | 0 C |

The structural deck is byte deterministic for the same field, and parsing
the structural result twice yields exactly equal normalized values. This
proves a single same-mesh nodal transfer; it does not establish remeshed
temperature interpolation, transfer energy conservation across different
meshes, constrained thermal stress, lifecycle/MCP preparation, mesh
convergence, or public-beta readiness. Earlier slab, fin, and two-material
thermal result evidence remains separate.
