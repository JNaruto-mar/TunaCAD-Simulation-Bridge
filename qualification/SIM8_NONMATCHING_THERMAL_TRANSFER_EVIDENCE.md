# SIM-8 nonmatching-mesh thermal transfer development evidence

Status: proof_of_concept; engineeringUsePermitted: false. This is a focused
provider fixture, not public browser/MCP thermo-mechanical admission or
formal qualification.

## Bounded transfer method

- Same 100 x 10 x 10 mm slab geometry and material ownership, independently
  meshed at 10 mm and 8 mm Gmsh 4.15.2 global sizes.
- The 468-node / 209-DC3D10 **source** receives the actual CalculiX 2.16
  steady-thermal solve: 20 C at x=0 and 10,000 W/m^2 inward at x=100 mm.
  The 635-node / 266-C3D10 **target** is the structural mesh.
- For every target node, locate its source tetrahedron using four corner
  barycentric coordinates, then interpolate temperature with all ten
  quadratic shape functions. Only straight-sided source tetrahedra and
  points inside the source mesh are admitted. Search order is deterministic;
  no extrapolation or silent correction is performed.
- Exact mesh/model geometry and material identity, complete finite source
  NT output, source/target mesh difference, physically bounded extrema,
  matching integrated volumes, and a 1e-5 relative conservation gate
  are required. Missing temperatures, changed model identity, and an
  outside-source target node fail closed.
- The conserved scalar is the volume integral of **temperature rise above
  20 C**, in K*mm^3, computed using curved-capable four-point C3D10 volume
  quadrature on each mesh. It is not thermal energy: density and heat
  capacity are absent from this bounded contract.
- Run npm run test:sim8-nonmatching-thermal-transfer for the focused
  analytical/contract checks. With TUNACAD_SIM8_REAL=1 and explicit
  Gmsh/CalculiX executable paths, the same command performs one source
  thermal solve and one target structural solve under existing process
  quotas. It removes only its own temporary working directory.

## 2026-09-23 focused provider result

| Quantity | Reference | Observed |
| --- | ---: | ---: |
| Source temperature range | 20–40 C | 20–40 C |
| Target temperature range | 20–40 C | 20–40 C |
| Target profile maximum error | 0 C | 2.84e-14 C |
| Source integrated temperature rise | 100,000 K*mm^3 | 100,000.00000000003 K*mm^3 |
| Target integrated temperature rise | 100,000 K*mm^3 | 99,999.9999999998 K*mm^3 |
| Conservation absolute error | 0 K*mm^3 | 2.33e-10 K*mm^3 |
| Axial free expansion | 0.012 mm | 0.012 mm |
| Resultant point-restraint reaction | 0 N | 9.48e-11 N |
| Maximum von Mises stress | 0 MPa | 1.56e-10 MPa |

The source thermal heat-balance error remains 1.20e-7 W. The target
temperature-field digest is
sha256:214d0cfee1ef8e73f458a98891045fc1e293cbb69d66619cbb41b5865174eaed.
Projection, structural deck generation, and normalized result parsing are
deterministic for the same inputs.

This only validates one affine field on straight-sided tetrahedra. General
nonaffine/curved thermal transfer, heat-capacity-weighted energy
conservation, multi-domain mapping, wider mesh ratios, lifecycle/MCP
preparation, and engineering qualification remain unproven.
