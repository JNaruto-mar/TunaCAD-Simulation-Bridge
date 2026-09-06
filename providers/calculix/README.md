# Optional external CalculiX SolverProvider

This Node-only adapter consumes TunaCAD's unchanged neutral FEM mesh and writes
a bounded linear-static C3D10 input deck for a user-installed CalculiX `ccx`
executable. It parses requested ASCII displacement, integration-point stress and
reaction-force output into TunaCAD's normalized simulation-result contract.

The adapter supports the current POC subset only: one isotropic material,
multiple fixed durable FACE groups, multiple total surface-force durable FACE
groups and complete second-order tetrahedra. Each load is consistently
distributed across its referenced facets; reactions are recovered per
non-overlapping constraint and checked against the applied-force resultant.
Missing, overlapping or ambiguous neutral boundary mappings fail closed.
Provider files are deleted after normalization.

CalculiX is not an npm dependency, browser import, bundled binary or TunaCAD
distribution. Users install it separately and explicitly configure its path.
