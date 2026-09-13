# SIM-8 development status

Status: `proof_of_concept`; `engineeringUsePermitted: false`.

The bounded steady-thermal foundation now implements:

- an additive version 2 `steady_thermal` analysis contract;
- constant isotropic conductivity on one material and one domain;
- positive inward `surface_heat_flux` on explicit FACE references;
- explicit FACE `prescribed_temperature` constraints;
- temperature, heat-flux, and reaction-heat-flow result requests;
- explicit CalculiX provider admission limited to one flux group and one prescribed-temperature group;
- a bounded normalized thermal summary with a temperature profile and heat balance; and
- a closed-form 100 x 10 x 10 mm slab fixture: 50 W/(m*K), 20 C fixed face, 10000 W/m^2 inward flux, 20-40 C linear profile, 200 C/m gradient, 1 W applied and -1 W reacted;
- deterministic DC3D10 deck generation with W/(m*K) to W/(mm*K) and W/m^2 to W/mm^2 conversion;
- quarantined, bounded NT, HFL, and RFL text-result parsing; and
- a real Gmsh 4.15.2 / CalculiX 2.16 solve that matches the analytical temperature range and gradient, reaction heat, heat balance, and nodal temperature profile.

Browser/MCP preparation is not opened by this increment. Heat power,
convection, temperature-dependent conductivity, multiple materials/domains,
interface conductance, field pagination/visualization, transient heat transfer,
and sequential thermo-mechanical mapping remain unsupported.

The next increment is mesh-convergence and repeatability evidence for the
one-dimensional conduction fixture, followed by browser/Bridge lifecycle
coverage before any internal-validation or public-beta status is considered.
