# Optional external CalculiX SolverProvider

`CalculiXMultiDomainDeck.mts` adds experimental SIM-4A/SIM-5/SIM-6A deck generation.
It creates deterministic per-domain C3D10 element/node sets, per-material
elastic and density cards, per-domain solid sections, analysis-coordinate
loads and constraints, and per-domain result print requests. It emits explicit
ties, rigid connectors, and the narrowly capability-gated SIM-6A frictionless
contact formulation only when requested.

The SIM-5 path emits consistent-mass `*FREQUENCY` studies for homogeneously
restrained models and single-domain free-free models. Free-free normalization
classifies CalculiX's six solver-omitted singular modes, preserves the first
elastic mode number (7), and never fabricates a rigid-mode field vector.
It also emits `*BUCKLE` for a single-domain, fixed-support, surface-force
preload envelope. Positive eigenvalue factors and bounded FRD eigenvectors are
cross-checked and normalized for visualization. They predict idealized linear
bifurcation only—not nonlinear collapse, imperfections, plasticity, or changing
contact.

The SIM-6A path accepts exactly two domains and direct FACE supports, with
explicit frictionless node-to-surface penalty contact, small sliding, linear
pressure-overclosure, and no initial adjustment. A two-body rigid-mode rank
check treats contact as normal-only restraint. The deck requests final
`CDIS,CSTR` output and bounded status increments; normalization returns
interface pressure/gap/tangential-slip/status/force, ordered increment history, and paginated
contact-pressure and normal-gap fields. This path is proof-of-concept only.
Friction, finite sliding, initial interference adjustment, large deformation,
and material nonlinearity are not supported.

This Node-only adapter consumes TunaCAD's neutral FEM model and writes a
bounded C3D10 input deck for a user-installed CalculiX `ccx` executable. It
parses requested ASCII displacement, integration-point stress, reaction-force,
eigen, and contact output into TunaCAD's normalized simulation-result contract.

The adapter supports the current POC subset only: one isotropic material,
multiple fixed durable FACE groups, multiple total surface-force durable FACE
groups, positive-inward/negative-suction pressure FACE groups, uniform
part-local gravity vectors using material density, and complete second-order
tetrahedra. Surface loads are consistently distributed across their referenced
facets; gravity uses CalculiX `GRAV` body loading plus independently integrated
C3D10 nodal-force and element-volume evidence. Reactions are recovered per
non-overlapping constraint and checked against the applied-force resultant.
Missing, overlapping or ambiguous neutral boundary mappings fail closed.
Provider files are deleted after normalization.

CalculiX is not an npm dependency, browser import, bundled binary or TunaCAD
distribution. Users install it separately and explicitly configure its path.
