# SIM-8 fully constrained thermal stress development evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is a bounded
provider fixture, not browser/MCP thermo-mechanical admission or qualification.

## Analytical and transfer definition

- One 100 x 10 x 10 mm slab with k=50 W/(m*K), a 20 C prescribed base,
  and 10,000 W/m^2 inward end flux. Gmsh 4.15.2 composes a 468-node,
  209-DC3D10 mesh; CalculiX 2.16 recovers the 20–40 C linear field.
- The entire recovered thermal nodal field is transferred to the identical
  structural mesh by model/request identity, element and material ownership,
  exact node identity, and a digest of all 468 final temperatures.
- To isolate an exactly solvable fully restrained case, the initial
  temperature at each node is its recovered final temperature minus 20 K.
  Thus the **pointwise change is uniformly 20 K** despite the nonuniform
  final field. Both initial and final temperatures are written explicitly
  for every node and checked against the serialized deck. This is a fixture
  choice, not a claim that a uniformly 20 C initial slab would produce the
  same hydrostatic stress under a nonuniform final field.
- E=210,000 MPa, nu=0.3, alpha=12e-6/K, and all displacement DOFs fixed.
  Isotropic linear thermoelasticity predicts each signed normal stress
  sigma=-E*alpha*deltaT/(1-2*nu)=-126 MPa. The 100 mm^2 x=end face has
  reaction magnitude 12,600 N. Exact displacement and von Mises stress are
  zero; checking von Mises alone would miss the large hydrostatic stress.
- Run npm run test:sim8-constrained-thermal-stress for analytical/contract
  checks. With TUNACAD_SIM8_REAL=1 and Gmsh/CalculiX executable paths, it
  runs one small quota-limited thermal solve and one structural solve in its
  own cleaned temporary directory.

## 2026-09-23 focused provider result

| Quantity | Analytical | Provider |
| --- | ---: | ---: |
| Signed stress xx, yy, zz | -126 MPa each | -126 MPa each |
| End-face x reaction | -12,600 N by solver convention | -12,600 N |
| End-face reaction magnitude | 12,600 N | 12,600 N |
| Maximum constrained displacement | 0 mm | 0 mm |
| Whole-body reaction magnitude | 0 N | below 1e-10 N |
| Maximum von Mises stress | 0 MPa | 0 MPa |
| Thermal heat-balance error | 0 W | 1.20e-7 W |

The field transfer preserves all 468 temperatures and their digest
sha256:4d9c356979c3bfdabee318120fa8af6584517ef90cab2445ef9abd133022bdd8.
Final and initial nodal temperature sums are 14,057.5 C and 4,697.5 C,
respectively, a difference of 20 K at every node. The maximum thermal
profile error is 0 C. The structural deck and normalized signed-stress/
reaction result are deterministic; incomplete structural output is rejected.

This fixture does not validate nonmatching-mesh interpolation, thermal-field
mapping conservation across meshes, contact conductance, public workflow
admission, mesh convergence of general thermal stress, or qualified
engineering use. Prior slab, fin, interface, and free-expansion numerical
evidence remains separate.
