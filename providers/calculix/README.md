# Optional external CalculiX SolverProvider

`CalculiXMultiDomainDeck.mts` adds experimental SIM-4A/SIM-5/SIM-6/SIM-7 deck generation.
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
explicit frictionless or Coulomb-penalty node-to-surface contact, small or
finite sliding, linear pressure-overclosure, and either no initial adjustment
or an explicit bounded planar/curved `bounded_to_contact` adjustment. Finite
sliding omits CalculiX `SMALL SLIDING` and requires an `NLGEOM`
finite-deformation step. Admission checks semantic clearance and transformed
curved FACE bounds, then the deck checks the closest actual primary-surface
triangle for every relevant secondary mesh node before emitting CalculiX
`ADJUST=`. Deep penetration fails closed, distant open nodes stay unadjusted,
and at least one node must be capturable. Frictional interactions require both a bounded
positive coefficient and an explicit penalty stick slope, emitted through
`*FRICTION`; no solver default is accepted. A two-body rigid-mode rank
check treats contact as normal-only restraint. The deck requests final
`CDIS,CSTR` output and bounded status increments; normalization returns
interface pressure/gap/tangential-slip/shear/status/force, ordered increment history, and paginated
contact-pressure, normal-gap, tangential-slip, and contact-shear fields. Missing
open-node output is recovered against the closest deformed primary triangle.
The exact recorded runtime tuple is internally validated for experimental
public beta; other tuples remain proof-of-concept or unsupported. Finite
sliding includes geometric nonlinearity. Engineering use is not permitted.

The separate SIM-7 `nonlinear_static` path admits one domain with an elastic or
tabulated isotropic elastic-plastic material, fixed FACE supports,
surface/pressure/gravity loading, and no
interactions. It emits ordered finite-deformation `NLGEOM` steps, explicit
piecewise-linear amplitudes, automatic-increment bounds, and request-controlled
iteration/cutback cards. Bounded `.sta` and increment-frequency `.dat` parsing
produces convergence and force-displacement history plus final paginated
stress/displacement fields. All active loads in one step currently share one
amplitude shape; unsupported shapes fail before solver launch. SIM-7B emits a
deterministic `*PLASTIC, HARDENING=ISOTROPIC` table after strict curve
validation. It requests `PEEQ`, `ENER`, and `ELSE` in every nonlinear step,
normalizes plastic-strain/energy state at every converged increment, and serves
final equivalent-plastic-strain and energy-density triangle pages. A native
100 x 10 x 10 mm, 30 kN coupon development solve separates the 0.1421 mm
elastic response from the 3.7655 mm elastic-plastic response while recovering
0.03863676 maximum equivalent plastic strain, 11.28585 MPa maximum energy
density, 104210.9 N·mm internal energy, and the axial reaction. Missing native
material output is quarantined. SIM-7B mesh/increment convergence,
plastic-hinge/path-order fixtures, and SIM-7B-specific failure qualification
are included in the formal automated matrix. The focused two-step
load/unload/reload coupon lane
verifies matched elastic branch slopes, residual elongation, nondecreasing
PEEQ, reaction equilibrium, and external-work/internal-energy agreement while
keeping the capability experimental. The same lane now checks monotonic and
load/unload/reload histories on actual 209/309/434-element meshes and maximum
increment levels 0.10/0.075/0.05. Fine history differences remain below 0.81%
for mesh refinement and 0.98% for increment refinement; residual displacement
and elastic branch stiffness remain below the separate 3% path-metric gate.
The separate material-lifecycle lane observes complete positive PEEQ, energy
density, and total internal energy before deliberate increment exhaustion and
active cancellation. Both paths clear normalized results and every field
dataset, delete the exact native directory, and reject late-result
resurrection.
The plastic-hinge lane adds an analytically bracketed solid cantilever: a
sub-yield monotonic final load is compared with an overload-return history at
the same final resultant. Paginated displacement vectors provide a fitted
root-zone chord rotation; paginated PEEQ is reduced into root/transition/far
zones; per-step energy and reaction endpoints retain the path history. The
overload path leaves root-localized plastic strain and larger rotation/energy
while preserving final and incremental equilibrium.
The formal SIM-7B matrix consolidates these contract, material-result,
mechanics, convergence, lifecycle, hinge, and authority gates. Its validator
requires independent-review evidence to bind the exact public commit and
automated-evidence digest. The matrix is not advertised as an umbrella provider
qualification. It supports `internally_validated` public-beta status on the
exact tuple and does not change engineering-use authority automatically.

This Node-only adapter consumes TunaCAD's neutral FEM model and writes a
bounded C3D10 input deck for a user-installed CalculiX `ccx` executable. It
parses requested ASCII displacement, integration-point stress, reaction-force,
eigen, and contact output into TunaCAD's normalized simulation-result contract.

The v1 adapter supports the bounded linear-static subset only: one isotropic material,
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
