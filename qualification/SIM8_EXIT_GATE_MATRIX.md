# SIM-8 exit-gate evidence matrix

Recorded 2026-09-26. Evidence: Windows x64, Gmsh 4.15.2, CalculiX 2.16.
This consolidates existing fixtures; no solver was rerun. Status remains
`proof_of_concept` and `engineeringUsePermitted: false`, outside public beta.
PASS means a *bounded fixture* met its recorded development comparison,
not that a general-purpose capability or engineering use is validated.
No recorded fixture fails its stated gate.

## Six roadmap exit-gate lanes

| Lane | Existing evidence and comparison | State | Unsupported breadth |
| --- | --- | --- | --- |
| 1D conduction | [Development status](SIM8_DEVELOPMENT_STATUS.md): 20–40 °C, 200 °C/m, 1 W in / -1 W out; provider profile error 4.8e-6 °C and balance residual 1.67e-15 W. Three meshes (209/350/944 elements) give ≤4.72e-6 °C profile error, ≤1.20e-7 W residual, 1.30e-7 W reaction drift; fine-mesh repeat identical. | **PASS** | One straight constant-k slab, one flux and one prescribed-temperature FACE. |
| Convection fin | [Fin evidence](SIM8_CONVECTION_FIN_EVIDENCE.md): tip error 0.0414 °C, base-flow error 0.160%, gradient error 0.905%, section/convection imbalance 0.129% ≤0.5%. Nodal RFL differs from section flow by 1.418% ≤2%, retained as a warning. | **PASS** | One rectangular fin and one mesh; provider fixture only. Nodal RFL is not exact base flow. |
| Two-material interface | [Conformal-interface evidence](SIM8_TWO_MATERIAL_INTERFACE_EVIDENCE.md): analytical/provider interface 30/30 °C and end 35/35 °C; 1.00e-8 W balance residual; equal repeated normalized results. | **PASS** | Two shared-topology conformal domains; one mesh density; provider fixture only. |
| Free thermal expansion | [Free-expansion evidence](SIM8_FREE_THERMAL_EXPANSION_EVIDENCE.md): exact 468-node transfer; reference/provider expansion 0.012/0.012 mm; stabilization reaction 4.31e-11 N; von Mises 9.10e-12 MPa. | **PASS** | Same mesh, affine field, three-two-one point stabilization; provider fixture only. |
| Fully constrained thermal stress | [Constrained-stress evidence](SIM8_CONSTRAINED_THERMAL_STRESS_EVIDENCE.md): exact 468-node transfer; 20 K pointwise rise; reference/provider signed normal stress -126/-126 MPa and end reaction -12,600/-12,600 N; zero constrained displacement; whole-body reaction below 1e-10 N. | **PASS** | Uniform pointwise rise constructed from a nonuniform final field; not a general nonuniform-stress claim. |
| Nonmatching-mesh transfer conservation | [Transfer evidence](SIM8_NONMATCHING_THERMAL_TRANSFER_EVIDENCE.md): 468-node / 209-element source to 635-node / 266-element target; profile error 2.84e-14 °C; integrated temperature-rise difference 2.33e-10 K·mm³ under a 1e-5 relative gate; resulting expansion 0.012 mm; malformed/out-of-domain transfer rejected. | **PASS** | One affine field and straight-sided tetrahedra. Conserved quantity is integrated temperature rise, **not** thermal energy; no curved/nonaffine/multi-domain transfer claim. |

## Additional implemented lanes

| Lane | Existing evidence and comparison | State | Unsupported breadth |
| --- | --- | --- | --- |
| Surface heat power | [Heat-power evidence](SIM8_HEAT_POWER_EVIDENCE.md): 1 W over 100 mm², 40 °C end, -1 W reaction, 1.67e-15 W residual, identical repeat, malformed requests rejected. | **PASS** | Surface, not volumetric, power; provider/contract fixture. |
| Temperature-dependent conductivity | [Conductivity evidence](SIM8_TEMPERATURE_DEPENDENT_CONDUCTIVITY_EVIDENCE.md): 39.99453 °C versus 40 °C integral reference, six nonlinear iterations, -0.999999991884 W reaction, 8.12e-9 W residual, identical repeat. | **PASS** | One domain/mesh; no extrapolation, decreasing k(T), convection, or multi-domain table. |
| Nonconformal interface conductance | [Conductance evidence](SIM8_NONCONFORMAL_INTERFACE_CONDUCTANCE_EVIDENCE.md): 14/44 nonmatching facets; analytical 30/40 °C sides and 1 W; provider 29.999999741/40.000218752 °C and 1.000008/1.000006 W; 2.0e-6 W interface imbalance, 1.0e-8 W global residual; invalid coverage rejected. | **PASS** | One coincident planar interface/mesh pair; no repair, extrapolation, or general contact claim. |
| Thermal fields/viewer | [Field evidence](SIM8_THERMAL_FIELD_EVIDENCE.md): real-slab NT and HFL magnitude, six digest-checked pages per field, 672 triangles at ≤128/page, 20–40 °C and 10,000 W/m² legends; separate two-domain visibility/probe and tamper tests. | **PASS** | HFL is element-mean magnitude, not vector glyphs or structural contours. |
| Bounded browser/MCP lifecycle | [Development status](SIM8_DEVELOPMENT_STATUS.md): slab preparation, revision/approval before STEP transfer, cancellation, stale-host-approval rejection, failed/malformed-result quarantine in focused mock-provider/Bridge fixture. | **PASS** | Other thermal lanes have no browser/MCP preparation. |

## Status decision

| Gate | State | Remaining need |
| --- | --- | --- |
| Six named bounded analytical/provider fixtures | **PASS** | No historical solver rerun merely to assemble this matrix. |
| Full SIM-8 numerical/lifecycle breadth | **PENDING** | Only the base slab has three-mesh convergence. Fin, interfaces, thermo-mechanics, nonlinear conductivity, and conductance mostly use one mesh/pair. Obtain proportionate convergence, repeatability, and failure/cancellation evidence for lanes proposed for promotion. |
| Immutable version-bound promotion evidence | **PENDING** | Bind selected results, tolerances, warnings, and digests to Bridge/TunaCAD commits and provider/runtime versions. This working-tree matrix is not release evidence. |
| Full SIM-8 public-beta delivery | **PENDING** | Browser/MCP admits only the constant-k, one-flux/one-temperature slab. Narrow any beta scope explicitly or add authoring and hosted verification. |

Thus **full SIM-8 is not ready for internally_validated or public_beta
promotion**. A separately scoped slab release can be considered after
version-bound and hosted workflow checks. Independent engineering review is
not required for continued development or public beta; it applies only to
intentionally pursued formal engineering-use qualification. This
documentation-only matrix makes no earlier numerical evidence stale.
