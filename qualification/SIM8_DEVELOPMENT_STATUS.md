# SIM-8 development status

Status: `proof_of_concept`; `engineeringUsePermitted: false`.

The first bounded steady-thermal foundation implements:

- an additive version 2 `steady_thermal` analysis contract;
- constant isotropic conductivity on one material and one domain;
- positive inward `surface_heat_flux` on explicit FACE references;
- explicit FACE `prescribed_temperature` constraints;
- temperature, heat-flux, and reaction-heat-flow result requests;
- provider admission that rejects unsupported thermal work before approval and geometry transfer;
- a bounded normalized thermal summary with a temperature profile and heat balance; and
- a closed-form 100 x 10 x 10 mm slab fixture: 50 W/(m*K), 20 C fixed face, 10000 W/m^2 inward flux, 20-40 C linear profile, 200 C/m gradient, 1 W applied and -1 W reacted.

This increment does not advertise thermal capability on the real CalculiX
provider and does not claim an external FEM solve. Heat power, convection,
temperature-dependent conductivity, multiple materials/domains, interface
conductance, field pagination, transient heat transfer, and sequential
thermo-mechanical mapping remain unsupported.

The next increment is deterministic CalculiX `*HEAT TRANSFER, STEADY STATE`
deck generation and bounded NT/HFL/RFL recovery for the same slab, followed by
mesh-convergence and browser/Bridge lifecycle coverage before any internal
validation or public-beta status is considered.
