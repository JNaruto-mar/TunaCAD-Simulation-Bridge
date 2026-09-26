# SIM-8 total surface heat power: bounded development evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is a
provider/contract fixture, not a public browser/MCP authoring workflow.

Formulation: one strictly positive total inward heat power P (W) is
distributed uniformly over the *mapped quadratic* area A (mm^2) of one
explicit FACE group. CalculiX receives *DFLUX = P/A in W/mm^2. Duplicate
facet indices are integrated once. There is no volumetric heat source,
outward/negative power, or simultaneous thermal load in this increment.
The prescribed-temperature FACE is disjoint. The resulting flux must
remain within the bounded 1e12 W/m^2 range.

Fixture: 100 x 10 x 10 mm slab; k=50 W/(m*K); x=0 at 20 C;
x=100 mm receives 1 W; 8 mm global second-order Gmsh mesh. The closed-form
reference is T(x)=20+0.2*x (C, x in mm), T(max)=40 C, gradient=200 C/m,
and base reaction=-1 W. Acceptance: maximum temperature and sampled
profile within 0.05 C; reaction within 1e-6 W; balance <=1e-6 W.

Focused Windows x64 / Gmsh 4.15.2 / CalculiX 2.16 execution:

| Measure | Value |
| --- | ---: |
| Nodes / DC3D10 elements | 635 / 266 |
| Heated mapped facets / mapped area | 14 / 100.00000000000021 mm^2 |
| Deterministic deck DFLUX | 0.01 W/mm^2 |
| Integrated deck power | 1.0000000000000022 W |
| Provider maximum temperature | 40 C |
| Provider applied / reacted heat | 1 / -0.9999999999999983 W |
| Absolute heat-balance residual | 1.6653345369377348e-15 W |
| Maximum sampled profile error | 4.777603351158177e-6 C |

The deck is byte-identical on regeneration, the DFLUX surface has exactly
the 14 intended mapped facets, and repeated solves produce exactly equal
normalized thermal values. Malformed/nonpositive/nonfinite watts, mixed
flux/power fields, thermal power in structural analysis, and providers
without heat-power admission are rejected. No earlier SIM-8 analytical
fixture assumptions changed: flux and convection deck branches remain
unchanged, and earlier evidence is not stale.

Reproduce only the focused fixture:

Set TUNACAD_GMSH_EXECUTABLE and TUNACAD_CALCULIX_EXECUTABLE to the
installed executables, then run npm run test:sim8-heat-power from the
public Bridge repository. Without those variables, the script runs only
the bounded analytical/contract rejection checks.
