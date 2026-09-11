# Optional external CalculiX SolverProvider

`CalculiXMultiDomainDeck.mts` adds experimental SIM-4A/SIM-5/SIM-6 deck generation.
It creates deterministic per-domain C3D10 element/node sets, per-material
elastic and density cards, per-domain solid sections, analysis-coordinate
loads and constraints, and per-domain result print requests. It emits explicit
ties, rigid connectors, and narrowly capability-gated SIM-6A/SIM-6C
frictionless/Coulomb-penalty contact only when requested.

The SIM-5 path emits consistent-mass `*FREQUENCY` studies for homogeneously
restrained models and single-domain free-free models. Free-free normalization
classifies CalculiX's six solver-omitted singular modes, preserves the first
elastic mode number (7), and never fabricates a rigid-mode field vector.
It also emits `*BUCKLE` for a single-domain, fixed-support, surface-force
preload envelope. Positive eigenvalue factors and bounded FRD eigenvectors are
cross-checked and normalized for visualization. They predict idealized linear
bifurcation only—not nonlinear collapse, imperfections, plasticity, or changing
contact.

The SIM-6 path accepts exactly two domains and direct FACE supports, with
explicit frictionless or Coulomb-penalty node-to-surface contact, small sliding, linear
pressure-overclosure, and either no initial adjustment or an explicit bounded
planar `bounded_to_contact` adjustment. Admission checks semantic clearance
and interference, then the deck rechecks every secondary mesh node before
emitting CalculiX `ADJUST=`. Frictional interactions require both a bounded
positive coefficient and an explicit penalty stick slope, emitted through
`*FRICTION`; no solver default is accepted. A two-body rigid-mode rank
check treats contact as normal-only restraint. The deck requests final
`CDIS,CSTR` output and bounded status increments; normalization returns
interface pressure/gap/tangential-slip/shear/status/force, ordered increment history, and paginated
contact-pressure, normal-gap, tangential-slip, and contact-shear fields. This path is proof-of-concept only.
Finite sliding, curved-surface initial adjustment, large deformation,
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
