# SIM-8 steady-thermal field transport and visualization evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is focused
development evidence, not an internal-validation matrix or a public-beta
promotion.

The existing v2 triangle-soup field transport is used without changing
solver inputs or thermal normalization. Each completed engineering-provider
thermal result owns exactly two immutable datasets per domain:

- nodal NT temperature, linearly interpolated on quadratic-face
  subdivisions, with physical-unit °C probing;
- element-averaged HFL vector magnitude, converted from W/mm² to W/m²,
  held constant per boundary volume element. This is a magnitude contour,
  not a directional vector glyph.

The ordered facet/subtriangle sequence is deterministic for a fixed mesh.
Each page contains 1–128 triangles and carries a chunk SHA-256 digest, a
canonical offset/cursor, and the immutable dataset descriptor. The viewer
requires contiguous pages, matching descriptors, the declared triangle
count, and a full-dataset digest before rendering. The provider, Bridge,
and TunaCAD reject malformed units/analysis identity, invalid temperature
values, oversized pages, altered chunks, missing pages, and wrong job or
domain ownership. Thermal vectors are zero and the viewer does not expose
stress/displacement choices or a deformation-scale control.

The existing 100 x 10 x 10 mm one-dimensional slab, k=50 W/(m*K), fixed
20 °C base and 10,000 W/m² inward end flux, was run once at 10 mm mesh
size on Gmsh 4.15.2 / CalculiX 2.16. It produced 468 nodes, 209 elements,
and, for each dataset, 672 triangles across six pages. The temperature
legend is 20–40 °C and the heat-flux-magnitude legend is 10,000–10,000
W/m². Maximum profile error remains 0 °C for this run; applied heat is
1 W, reaction is -1.00000012 W, and the balance residual is 1.20e-7 W.
The same real-slab result and all of its pages were handed in memory to the
Three.js viewer; its 20–40 °C and 10,000 W/m² legends rendered correctly.
The focused two-domain Three.js fixture separately verifies domain visibility,
thermal-only controls, both legends, and °C/W/m² probes. The focused
MCP/service fixture verifies ownership and rejects a tampered page digest.

Reproduce with the focused Bridge steady-thermal real fixture using
TUNACAD_SIM8_GLOBAL_SIZE_MM=10 and the configured Gmsh/CalculiX executable
environment variables; run npm run test:mcp:simulation:sim8-lifecycle and
npm run test:simulation:sim8-thermal-viewer for the isolated UI fixture,
and npm run test:simulation:sim8-thermal-viewer-real with executable
environment variables for the real provider-to-browser handoff. No historical
SIM-8 matrices or unrelated SIM-2–7 suites
are required for this additive result-field increment.
