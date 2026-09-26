# SIM-8 nonconformal interface conductance development evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is one bounded
provider/contract fixture, not a qualification matrix or browser workflow.

## Formulation and limits

Two independently meshed, coincident, planar, opposed 10-node-tetrahedron
FACE groups remain topologically distinct. Before deck creation, the bridge
checks one-to-one semantic FACE ownership, planar quadratic facets, opposed
orientation, equal integrated area, and reciprocal full coverage of facet
nodes and quadrature witnesses within a declared 0.001 mm position tolerance.
No nodes are merged, no positions are adjusted, and unmatched coverage is
rejected rather than extrapolated or repaired. One positive, finite, bounded
conductance h is expressed in W/(m^2*K). CalculiX receives the corresponding
W/(mm^2*K) GAP CONDUCTANCE on an explicitly tied contact pair. This is a
zero-thickness thermal resistance between touching faces; finite gaps,
curvature, partial overlap, multiple interfaces, and transient behavior are
not admitted.

## Reproducible reference

- Geometry: adjacent 50 x 10 x 10 mm rectangular solids, area 100 mm^2.
  Gmsh 4.15.2 independently meshes them at 10 and 3 mm global sizes,
  respectively, before neutral-model composition.
- Materials: k=50 W/(m*K) on the first slab and 100 W/(m*K) on the second.
- Boundary conditions: first x=0 FACE at 20 C; second x=100 mm FACE receives
  10,000 W/m^2 inward flux; interface h=1,000 W/(m^2*K).
- Series reference: 1 W through each slab and the interface. The first
  conduction rise is 10 C, the interface jump q/h is 10 C, and the second
  conduction rise is 5 C: secondary interface 30 C, primary interface 40 C,
  loaded end 45 C.
- Run npm run test:sim8-nonconformal-interface-conductance for analytical
  admission checks. Set TUNACAD_SIM8_REAL=1 and the Gmsh/CalculiX executable
  environment variables for the focused real provider fixture.

## 2026-09-23 focused provider result

Gmsh produced 579 nodes / 254 elements / 14 interface facets on the
secondary side and 2,358 nodes / 1,225 elements / 44 facets on the primary.
The interface nodes remain distinct. CalculiX 2.16 returned:

| Quantity | Reference | Provider | Absolute error |
| --- | ---: | ---: | ---: |
| Secondary interface mean | 30 C | 29.999999741 C | 0.000000259 C |
| Primary interface mean | 40 C | 40.000218752 C | 0.000218752 C |
| Loaded-end maximum | 45 C | 45.00022 C | 0.00022 C |
| Secondary interface heat flow | 1 W | 1.000008 W | 0.000008 W |
| Primary interface heat flow | 1 W | 1.000006 W | 0.000006 W |
| Interface-side imbalance | 0 W | 0.000002 W | 0.000002 W |
| Global heat-balance residual | 0 W | 0.000000010 W | 0.000000010 W |

The conductance law evaluated from the two area-weighted mean temperatures
predicts 1.000021901 W. Deck generation and normalized thermal summaries are
identical on repetition of the same composed mesh. A missing interface result
is quarantined. Zero, negative, nonfinite, oversized, unsupported-adjustment,
wrong-FACE, offset, moved-node, and incomplete-coverage definitions fail
closed. This single mesh pair is not mesh-convergence or broad contact
qualification. Earlier SIM-8 evidence remains valid because the conformal
shared-topology, one-domain thermal, and sequential thermal-transfer paths
were not changed by this interaction.
