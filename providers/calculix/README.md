# Optional external CalculiX SolverProvider

`CalculiXMultiDomainDeck.mts` adds experimental SIM-4A deck generation. It
creates deterministic per-domain C3D10 element/node sets, per-material elastic
and density cards, per-domain solid sections, analysis-coordinate loads and
constraints, and per-domain result print requests. It emits no tie, contact, or
rigid-body behavior.

This Node-only adapter consumes TunaCAD's unchanged neutral FEM mesh and writes
a bounded linear-static C3D10 input deck for a user-installed CalculiX `ccx`
executable. It parses requested ASCII displacement, integration-point stress and
reaction-force output into TunaCAD's normalized simulation-result contract.

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
