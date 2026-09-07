# Optional external Gmsh MeshProvider

`GmshMultiDomainMeshProvider.mts` adds the experimental SIM-4A composition
boundary. It invokes the hardened single-domain adapter once per approved
domain in owner-local coordinates, then applies the occurrence transform and
combines validated meshes with explicit domain, material, volume-region,
boundary-facet, and node ownership. It never merges coincident nodes or infers
an interface between domains.

This Node-only adapter invokes a user-installed `gmsh` executable with fixed
arguments. It imports approved STEP geometry, creates complete second-order
tetrahedra, parses ASCII MSH 4.1, validates mesh quality and normalizes the
result into TunaCAD's unchanged `NeutralFemMesh` contract.

Durable FACE references are matched against distinct Gmsh STEP surface entities
using revision-bound centroid, area and bounding-box evidence. Missing,
duplicate or ambiguous matches fail closed. Provider-specific files remain in a
per-job operating-system temporary directory and are removed after normalization.

Gmsh is not an npm dependency, browser import, bundled binary or TunaCAD
distribution. Users install it separately and explicitly configure its path.
