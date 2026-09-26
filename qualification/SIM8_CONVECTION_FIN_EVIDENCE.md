# SIM-8 convection-fin development evidence

Capability: experimental steady thermal convection; proof_of_concept,
engineeringUsePermitted: false. This is a focused provider fixture, not a
qualification matrix or permission for critical engineering use.

## Reproducible fixture

- CAD: one 50 x 10 x 2 mm rectangular solid. The x=0 base FACE is fixed at
  100 °C. The four lateral FACEs and x=50 tip FACE share one uniform
  surface_convection load: h=100 W/(m²·K), sink=20 °C.
- Material: one constant isotropic conductivity k=100 W/(m·K).
- Mesh/provider: Gmsh 4.15.2, 4 mm second-order tetrahedral intent,
  817 nodes and 362 DC3D10 elements; CalculiX 2.16 steady heat transfer.
- Analytical comparator: constant-section one-dimensional fin with a
  convective tip and small transverse Biot number. It is an approximation to
  the three-dimensional FEM model, not an exact 3D solution.
- Reproduce unit/admission/parser checks: npm run test:sim8-convection-fin.
  For one real solve, set TUNACAD_SIM8_REAL=1, TUNACAD_GMSH_EXECUTABLE,
  and TUNACAD_CALCULIX_EXECUTABLE, then run the same command. The fixture
  creates and removes only its own temporary working directory.

## 2026-09-22 focused result

| Quantity | Analytical fin | Provider | Acceptance |
| --- | ---: | ---: | --- |
| Tip/minimum temperature | 46.723617 °C | 46.682180 °C | 0.041437 °C error ≤ 3 °C |
| Base heat flow | 5.224455 W | 5.216100 W section FLUX | 0.160% error ≤ 5% |
| Peak temperature gradient | 2612.227 °C/m | 2635.875 °C/m | 0.905% error ≤ 10% |
| Integrated convection input | -5.224455 W | -5.222815 W from NT/mapped facets | reported |
| Heat-flow balance residual | 0 W | 0.006715 W | 0.129% of convection magnitude ≤ 0.5% |
| Nodal RFL base recovery | — | 5.142117 W | 0.073983 W (1.418%) disagreement with section FLUX ≤ 2% |

The section-FLUX integral is the normalized base reaction for convection;
the independently parsed nodal RFL value and disagreement are retained in
reactionHeatFlowEvidence. The result emits a
SIMULATION_THERMAL_REACTION_METHOD_DISAGREEMENT warning. This numerical
difference is not silently treated as exact equilibrium. The earlier slab
retains its original RFL reaction method and 1e-6 relative balance gate.

The real fixture passed bounded analytical, deck determinism, mapped FACE,
result-quarantine, heat-balance, method-disagreement, and experimental
authority checks. It does not establish mesh convergence, broad fin geometry
coverage, public-beta readiness, or formal engineering qualification.
