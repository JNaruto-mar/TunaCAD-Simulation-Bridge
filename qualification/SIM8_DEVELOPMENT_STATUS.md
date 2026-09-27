# SIM-8 development status

Status: `proof_of_concept`; `engineeringUsePermitted: false`.

The bounded steady-thermal foundation now implements:

- an additive version 2 `steady_thermal` analysis contract;
- constant isotropic conductivity on one material and one domain;
- positive inward `surface_heat_flux` on explicit FACE references;
- explicit FACE `prescribed_temperature` constraints;
- temperature, heat-flux, and reaction-heat-flow result requests;
- explicit CalculiX provider admission for one prescribed-temperature group and either one flux or one convection group; the two-domain path requires one conformal shared-topology interface and flux;
- a bounded normalized thermal summary with a temperature profile and heat balance; and
- a closed-form 100 x 10 x 10 mm slab fixture: 50 W/(m*K), 20 C fixed face, 10000 W/m^2 inward flux, 20-40 C linear profile, 200 C/m gradient, 1 W applied and -1 W reacted;
- deterministic DC3D10 deck generation with W/(m*K) to W/(mm*K) and W/m^2 to W/mm^2 conversion;
- quarantined, bounded NT, HFL, and RFL text-result parsing; and
- a real Gmsh 4.15.2 / CalculiX 2.16 solve that matches the analytical temperature range and gradient, reaction heat, heat balance, and nodal temperature profile; and
- a version-bound 10 / 6 / 4 mm mesh-convergence matrix with 209 / 350 / 944
  DC3D10 elements plus an exact repeated 4 mm solve.

The convergence matrix preserves the analytical 40 C maximum and 200 C/m
gradient with zero cross-mesh drift. Reaction-heat drift is
1.30e-7 W, every heat-balance residual is at most 1.20e-7 W, and the largest
sampled temperature-profile error is 4.72e-6 C. Repeating the 4 mm case
reproduces the mesh counts and normalized thermal summary exactly.

The fourth increment opens the existing v2 MCP/browser/Bridge preparation
path for this bounded slab study. It preserves human and local-Bridge host
approval before STEP transfer, revision guards, cancellation, and result
quarantine. A focused mock-provider/local-Bridge lifecycle fixture passes,
including stale authority during host approval and malformed thermal-result
rejection. No new real solve was needed for this lifecycle-only change; the
version-bound Gmsh/CalculiX analytical and convergence evidence above remains
the reference. The browser displays bounded thermal summary values, not
structural contour datasets.

The fifth increment adds one bounded convection FACE group and a
rectangular convective-tip fin fixture. CalculiX 2.16 emits deterministic
*FILM and a base *SECTION PRINT heat-flow integral; normalized results
integrate convection from mapped quadratic boundary facets and recovered NT
temperatures, retain the independent nodal-RFL result, and quarantine
incomplete or unbalanced output. The focused Gmsh 4.15.2 / CalculiX 2.16
fixture (817 nodes, 362 DC3D10 elements) agrees with the analytical tip by
0.0414 C, base heat flow by 0.160%, and peak gradient by 0.905%.
The convection/section balance residual is 0.006715 W (0.129%), within the
explicit 0.5% development gate. The separate nodal RFL differs from the
section integral by 0.073983 W (1.418%); that discrepancy is retained and
warned, not suppressed. See [SIM8_CONVECTION_FIN_EVIDENCE.md](SIM8_CONVECTION_FIN_EVIDENCE.md).

The sixth increment adds an explicit, conformal shared-topology interface
between two constant-conductivity domains with separate CalculiX material
sections. A 50 + 50 mm series slab with k=50/100 W/(m*K), 20 C base, and
10,000 W/m^2 inward end flux recovers the analytical 30 C interface and
35 C free-end temperatures. The one-watt heat-flow balance residual is
1.00e-8 W, and a repeated solve has exactly equal normalized thermal values.
See [SIM8_TWO_MATERIAL_INTERFACE_EVIDENCE.md](SIM8_TWO_MATERIAL_INTERFACE_EVIDENCE.md).

The seventh increment proves one same-mesh sequential free-expansion
fixture. The complete 468-node thermal field is transferred by exact mesh
identity to a C3D10 structural step with alpha=12e-6/K and 20 C initial
temperature. The 20–40 C thermal profile predicts and produces 0.012 mm
axial expansion. Three-two-one point stabilization has a 4.31e-11 N
resultant reaction, and maximum von Mises stress is 9.10e-12 MPa. The
structural deck and normalized result are deterministic. See
[SIM8_FREE_THERMAL_EXPANSION_EVIDENCE.md](SIM8_FREE_THERMAL_EXPANSION_EVIDENCE.md).

The eighth increment adds one fully constrained same-mesh thermoelastic
fixture. The complete recovered 20–40 C final field is transferred without
interpolation; each node's initial temperature is set 20 K below its final
temperature to isolate a uniform pointwise thermal change. With
E=210,000 MPa, nu=0.3, and alpha=12e-6/K, CalculiX recovers -126 MPa in
each signed normal stress component and a -12,600 N x-reaction on the
100 mm^2 end FACE. Constrained displacement and hydrostatic von Mises
stress are zero; whole-body reaction closes below 1e-10 N. See
[SIM8_CONSTRAINED_THERMAL_STRESS_EVIDENCE.md](SIM8_CONSTRAINED_THERMAL_STRESS_EVIDENCE.md).

The ninth increment adds one bounded nonmatching-mesh projection fixture:
the same slab uses 468-node / 209-element thermal and 635-node / 266-element
structural meshes. Complete source NT values are projected with
straight-sided C3D10 barycentric location and ten-node quadratic
interpolation. The target profile error is 2.84e-14 C; the
volume-integrated temperature rise above 20 C differs by 2.33e-10 K*mm^3.
The target structural response recovers 0.012 mm free expansion and
9.48e-11 N resultant point-restraint reaction. Malformed or nonconserved
transfers fail closed; no extrapolation or silent rescaling is used. See
[SIM8_NONMATCHING_THERMAL_TRANSFER_EVIDENCE.md](SIM8_NONMATCHING_THERMAL_TRANSFER_EVIDENCE.md).

The tenth increment adds one bounded total inward surface-power load. A
positive watt value is distributed uniformly over the quadratic mapped area
of one explicit FACE group; this is not volumetric generation. The focused
100 x 10 x 10 mm slab applies 1 W across 100 mm^2, recovering 40 C at the
heated end and -1 W reaction with a 1.67e-15 W heat-balance residual. An
identical second CalculiX solve produces exactly equal normalized thermal
values. See [SIM8_HEAT_POWER_EVIDENCE.md](SIM8_HEAT_POWER_EVIDENCE.md).

The eleventh increment admits one-domain, strictly increasing, piecewise-linear
isotropic conductivity versus temperature, with 2-16 bounded table points.
Flux or total inward FACE power is supported; convection, extrapolation,
decreasing conductivity, and multi-domain tabular properties are deferred.
The 25-to-75 W/(m*K), 20-to-40 C slab recovers 39.99453 C against the exact
40 C Kirchhoff-transform reference, -0.999999991884 W reaction, and
8.12e-9 W heat-balance residual. The solver status reports six nonlinear
iterations, and a repeat has identical normalized thermal values. See
[SIM8_TEMPERATURE_DEPENDENT_CONDUCTIVITY_EVIDENCE.md](SIM8_TEMPERATURE_DEPENDENT_CONDUCTIVITY_EVIDENCE.md).

Browser/MCP preparation still admits only the earlier one-FACE inward-flux
single-domain slab; convection, the two-material interface, and free
expansion are provider/contract fixtures, not a public browser workflow.
Heat power and temperature-dependent conductivity are provider/contract
fixtures only; they are not yet exposed through browser/MCP study preparation.
Transient heat transfer and general nonaffine/multi-domain
thermo-mechanical transfer remain unsupported.

The twelfth increment adds one bounded nonconformal, coincident-planar,
finite-conductance interaction between two independently meshed thermal
materials. A 14-facet / 44-facet interface with 0.001 mm coverage tolerance
and h=1,000 W/(m^2*K) recovers the 30/40 C interface-side analytical
temperatures, 45 C loaded end, and 1 W through each side. The measured
interface heat-flow imbalance is 2.0e-6 W and global heat-balance residual
is 1.0e-8 W. Request/mesh/result validation rejects gaps, offset or
unmatched coverage, malformed conductance, missing evidence, and topology
repair. See [SIM8_NONCONFORMAL_INTERFACE_CONDUCTANCE_EVIDENCE.md](SIM8_NONCONFORMAL_INTERFACE_CONDUCTANCE_EVIDENCE.md).
This remains provider/contract-only; browser/MCP authoring has not expanded.

The thirteenth increment adds two per-domain, bounded field datasets for
completed steady-thermal provider results: nodal temperature in degC and
element-mean HFL magnitude in W/m^2. The 468-node / 209-element slab returns
672 boundary triangles in six pages per field (at most 128 per page).
Chunk/full-dataset digests, page order, identity, completeness, and domain
ownership are checked across provider, Bridge, and TunaCAD. The existing
Three.js viewer now shows thermal-only contours, numerical legends,
physical-unit probes, and multi-domain visibility. See
[SIM8_THERMAL_FIELD_EVIDENCE.md](SIM8_THERMAL_FIELD_EVIDENCE.md).

The six roadmap exit-gate fixtures and additional implemented lanes are
consolidated in [SIM8_EXIT_GATE_MATRIX.md](SIM8_EXIT_GATE_MATRIX.md).
Each bounded development fixture passes its recorded comparison, while
cross-lane promotion breadth, version-bound release evidence, and full
public-browser coverage remain pending. SIM-8 stays
`proof_of_concept`, `engineeringUsePermitted: false`, and outside the
public-beta catalog until its own validation gates are intentionally completed.
