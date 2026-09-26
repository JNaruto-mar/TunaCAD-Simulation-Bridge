# SIM-8 temperature-dependent conductivity: bounded development evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is a
provider/contract fixture, not a browser/MCP authoring mode.

The additive material law is one-domain isotropic steady conduction with
2-16 temperature-tagged conductivity samples. Both temperature and
conductivity must increase strictly; k is positive and finite, with at most
a tenfold range. Linear interpolation is deterministic. Extrapolation,
decreasing conductivity, mixed constant/tabular properties, convection with
tabular k, and multi-domain tabular k are rejected. The neutral analysis
assumption explicitly identifies the tabulated law.

CalculiX deck units are W/(mm*K): *CONDUCTIVITY rows are
0.025,20 and 0.075,40 for this case. The 100 x 10 x 10 mm slab has a
20 C x=0 face and 10,000 W/m^2 inward flux at x=100 mm (1 W total).
The exact one-dimensional reference satisfies
integral(20..T(x)) k(T)dT = q*x in metres. For k(T)=25+2.5*(T-20)
W/(m*K), the end temperature is 40 C, maximum gradient is 400 C/m,
and reaction is -1 W. The non-linear profile distinguishes this from
constant-conductivity conduction.

Focused Windows x64 / Gmsh 4.15.2 / CalculiX 2.16 fixture:

| Measure | Reference / acceptance | Provider |
| --- | ---: | ---: |
| Nodes / DC3D10 elements | bounded 8 mm mesh | 635 / 266 |
| End temperature | 40 C; within 0.1 C | 39.99453 C |
| Maximum profile error | <=0.1 C | 0.0055 C |
| Maximum gradient | 400 C/m; within 5% | 401.19536 C/m |
| Total applied heat | 1 W | 1 W |
| Reaction heat | -1 W; within 1e-6 W | -0.999999991884 W |
| Heat-balance residual | <=1e-6 W | 8.116e-9 W |
| Complete converged .sta iterations | required | 6 |

Deck bytes are identical on regeneration and normalized thermal values
are identical across two solves. Missing iteration evidence and final
temperatures outside the declared material interval fail result
admission. Only the new tabular branch changes; constant-k material
cards, existing flux/convection paths, and earlier SIM-8 reference
assumptions remain unchanged. Earlier SIM-8 evidence is not stale.

To reproduce the single focused fixture, set TUNACAD_GMSH_EXECUTABLE
and TUNACAD_CALCULIX_EXECUTABLE to installed executables, then run
npm run test:sim8-temperature-dependent-conductivity from the public
Bridge repository. Without both executables, only the analytical and
contract rejection checks run.
