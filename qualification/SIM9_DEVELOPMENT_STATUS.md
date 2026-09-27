# SIM-9 transient-thermal development status

Status: `proof_of_concept`; `engineeringUsePermitted: false`. Six bounded
increments now cover the contract/analytical reference, a real
provider-only Gmsh/CalculiX slab, and its bounded time-step/mesh
convergence evidence, partial-frame lifecycle quarantine, and
browser/MCP preparation and frame-field visualization. This is not
internal validation or public-beta exposure. SIM-8 remains unchanged.

The additive v2 `transient_thermal` request describes exactly one constant-
property isotropic domain, one inward step heat-flux FACE, one prescribed-
temperature FACE, a uniform initial temperature equal to the fixed-face
temperature, explicit density and specific heat, duration in seconds, and
1–16 strictly increasing requested frame times ending at the duration.
It requests temperature and heat-flow histories. A missing/nonpositive heat
capacity, invalid time grid, incompatible initial/boundary temperature,
tabular conductivity, unsupported load/material/domain, or mixed unit
request fails validation. Specific heat and time fields are rejected on
existing steady/structural requests. The first increment kept all
providers unadvertised; the second admits only the explicit bounded
CalculiX transient profile and a separate normalized frame contract.

The focused analytical reference is a 100 × 10 × 10 mm slab with k=50
W/(m·K), density 7800 kg/m³, specific heat 500 J/(kg·K), initial and
fixed-face 20 °C, and 10,000 W/m² inward at the opposite end for t>0.
Other faces are insulated. The Fourier-series solution uses diffusivity
1.282051282e-5 m²/s and diffusion time 780 s; its steady endpoint is 40 °C.

| Time | Analytical tip | Analytical fixed-face reaction | Stored thermal energy above 20 °C |
| ---: | ---: | ---: | ---: |
| 100 s | 28.08012970 °C | -0.09657221 W | 97.51574463 J |
| 400 s | 35.42601595 °C | -0.64076654 W | 276.43701698 J |
| 1200 s | 39.63588577 °C | -0.97140254 W | 380.95970966 J |

At 400 s the independent central-difference energy-rate check gives
0.35923345534 W storage rate versus 1 - 0.64076654474 =
0.35923345526 W applied-plus-reacted power, an absolute discrepancy
7.89e-11 W. The fixed face stays at 20 °C, the tip rises monotonically
toward the 40 °C steady limit, and the reaction remains bounded by
0 and -1 W. These are **analytical**, not Gmsh/CalculiX observations.

## Second increment: provider-only time-frame recovery

CalculiX 2.16 now receives a byte-deterministic DC3D10 deck with
`*DENSITY`, `*SPECIFIC HEAT`, uniform `*INITIAL CONDITIONS`, a
`*HEAT TRANSFER` step with `AMPLITUDE=STEP`, explicit output
`*TIME POINTS`, and NT/HFL/RFL requests at each requested time.
The unit conversions are 7800 kg/m³ → 7.8e-6 kg/mm³,
50 W/(m·K) → 0.05 W/(mm·K), and 10,000 W/m² →
0.01 W/mm². Provider execution retains the existing resource limits,
cleanup, cancellation, and result quarantine. The transient parser
requires complete, ordered, unique, bounded NT/HFL/RFL blocks at 100,
400, and 1200 s; incomplete, extra, reordered, duplicate, non-finite,
or wrong-set frames fail before normalization. Stored thermal energy
uses complete nodal NT and existing C3D10 volume quadrature, not RFL.

One 10 mm Gmsh 4.15.2 mesh (468 nodes, 209 elements) was solved with
CalculiX 2.16 and repeated on the same mesh/request. The deck bytes
and normalized transient history are identical across the repeat.

| Time | Analytical tip | Provider tip | Tip error | Analytical / provider reaction | Analytical / provider stored energy |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 s | 28.08013 °C | 27.97782 °C | -0.10231 °C | -0.096572 / -0.101343 W | 97.51574 / 96.41879 J |
| 400 s | 35.42602 °C | 35.33542 °C | -0.09060 °C | -0.640767 / -0.633636 W | 276.43702 / 274.18959 J |
| 1200 s | 39.63589 °C | 39.61383 °C | -0.02206 °C | -0.971403 / -0.969668 W | 380.95971 / 380.41218 J |

Every requested frame passes the declared development gates:
≤0.5 °C tip error, ≤0.08 W reaction error, and ≤8 J stored-energy
error. At 400 s, 1 W applied plus the recovered -0.6336356856 W
reaction gives 0.3663643144 W, differing from the analytical
0.35923345534 W storage rate by 0.00713085906 W. This is a
reference comparison, not a provider-derived instantaneous storage
derivative. No time-step or mesh-convergence claim follows from one
mesh and one bounded increment schedule.

Focused tests: `npm run test:sim9-transient-thermal-contract` and
`npm run test:sim9-transient-thermal-real`. The latter includes
malformed-frame/result rejection and one exact repeated solve.
No historical SIM-8 real fixture was rerun. SIM-8 numerical evidence
is not stale: its steady cards/parser and volume quadrature behavior
were not changed, only shared exports/additive analysis branches.

## Third increment: bounded time-step and mesh-convergence evidence

The same analytical slab and requested frames were solved with Gmsh 4.15.2
and CalculiX 2.16. Only the provider-only initial/maximum time increment
and Gmsh target mesh size changed. The additive `maximumIncrementS`
request setting is bounded to the first requested frame and to at least
duration/1000; omitted settings preserve the second-increment deck.
Five unique cases cover three time increments at 10 mm and three mesh
sizes at 5 s, sharing the 10 mm/5 s case. The selected 6 mm/5 s
request/model was solved a second time; its complete normalized frame
history matched exactly. Deck generation was byte-deterministic per case.

| Mesh target | Maximum increment | Nodes / elements | Tip °C at 100 / 400 / 1200 s | Reaction W at 100 / 400 / 1200 s | Stored energy J at 100 / 400 / 1200 s |
| ---: | ---: | ---: | --- | --- | --- |
| 10 mm | 20 s | 468 / 209 | 27.87571 / 35.24669 / 39.59141 | -0.105532 / -0.626710 / -0.967906 | 95.35983 / 271.99128 / 379.85548 |
| 10 mm | 10 s | 468 / 209 | 27.97782 / 35.33542 / 39.61383 | -0.101343 / -0.633636 / -0.969668 | 96.41879 / 274.18959 / 380.41218 |
| 10 mm | 5 s | 468 / 209 | 28.02899 / 35.38048 / 39.62491 | -0.098990 / -0.637163 / -0.970537 | 96.96165 / 275.30709 / 380.68710 |
| 8 mm | 5 s | 635 / 266 | 28.02899 / 35.38048 / 39.62491 | -0.099022 / -0.637180 / -0.970539 | 96.96164 / 275.30708 / 380.68714 |
| 6 mm | 5 s | 821 / 350 | 28.02899 / 35.38048 / 39.62491 | -0.099050 / -0.637195 / -0.970540 | 96.96172 / 275.30707 / 380.68712 |

Against the analytical reference above, the three-frame Euclidean error
norms for 20 → 10 → 5 s are 0.275542 → 0.138425 → 0.069349 °C
for tip temperature, 0.0170319 → 0.0087535 → 0.0044248 W for
reaction, and 5.06279 → 2.56008 → 1.28766 J for stored energy.
Successive time-refinement changes contract for all three quantities.
At 5 s, 10 → 8 → 6 mm produces identical printed tip temperatures;
the fine-pair reaction and energy changes are only 0.00003121 W and
0.00008407 J as three-frame norms, respectively, each below 1% of
the corresponding fine time-step change. The mesh sequence is thus a
stable spatial plateau for this one-dimensional fixture, **not** evidence
of a monotonic spatial-error slope. Time discretization dominates the
remaining reference error. No claim of convergence for arbitrary
transient geometries follows.

The bounded baseline is 6 mm/5 s (821 nodes, 350 elements). At
100/400/1200 s its absolute tip errors are 0.05114/0.04554/0.01098 °C,
reaction errors are 0.002478/0.003572/0.000862 W, and stored-energy
errors are 0.55403/1.12995/0.27259 J. The reference stored energy
and reaction are independent Fourier-series comparisons; this increment
does not assert a provider-derived instantaneous energy-rate residual.
All prior SIM-9 frame-integrity and quarantine checks remain in force.

Focused tests: `npm run test:sim9-transient-thermal-contract` and
`npm run test:sim9-transient-convergence-real`. The matrix validates
deterministic per-case deck generation, increasing mesh resolution,
all three requested frames, contraction of temporal error/change,
spatial stability relative to temporal change, the bounded baseline,
and an exact repeat. No historical SIM-8 or SIM-2–SIM-7 fixture was
rerun. Existing SIM-8 evidence is not stale: this is an additive
transient-only increment control and provider-only fixture.

## Fourth increment: partial-frame lifecycle quarantine

The existing 100 × 10 × 10 mm slab was reused at 10 mm mesh target
(468 nodes, 209 elements) on Gmsh 4.15.2 / CalculiX 2.16. No thermal
physics, parser, process-lifecycle, or result-normalization contract
was redesigned. An optional transient-only `maximumIncrements` limit
(1–1000; default 1000) provides a bounded, deterministic increment-
exhaustion fixture. The ordinary default deck still emits
`*STEP, INC=1000`.

- Active cancellation: with a 1.2 s maximum increment, a complete
  100 s NT/HFL/RFL frame was observed on disk while the provider still
  reported `running`. A subsequent in-progress frame made the whole
  requested history invalid. Cancellation returned `cancelled` /
  `cancelled_cleaned`, never `succeeded`; `getResult` remained null
  before and after cancellation and after a late-exit interval.
- Deliberate non-convergence: a 20 s increment and `INC=6` produced
  a complete 100 s frame, then CalculiX exhausted its increment
  budget before the requested 400/1200 s frames. The terminal status
  was `failed` with `SIMULATION_SOLVER_FAILED`, never `succeeded`;
  `getResult` remained null after the failure and a late-exit interval.
- The focused parser rejected a missing final frame, a truncated
  intermediate frame, and a non-finite intermediate RFL frame.
  Provider field-dataset retrieval failed closed for both cancelled
  and failed runs. Each run's specific temporary solver directory was
  observed removed after terminal cleanup; no stale partial history
  was retrievable.

Focused tests: `npm run test:sim9-transient-thermal-contract` and
`npm run test:sim9-transient-lifecycle-real`. The earlier numerical
SIM-9 evidence is not stale: omission of the new setting retains
the prior deck bytes, and no thermal numerical/normalization path
changed. SIM-8 evidence is likewise unchanged. These tests establish
partial-history lifecycle safety for this bounded fixture, not
general transient qualification.

## Fifth increment: bounded browser/MCP authoring

The existing v2 preparation contract now accepts `transient_thermal` for
the validated one-domain constant-property slab scope. MCP callers can
provide uniform initial temperature; one material's positive density,
specific heat, and constant conductivity; bounded duration with 1–16
ordered output times ending at duration; optional bounded maximum
increment and increment count; one inward FACE heat flux; and one
prescribed-temperature FACE equal to the initial temperature. Existing
mesh controls remain available. Multiple domains, transient contact,
temperature-dependent properties, alternate thermal loads, and
nonmatching transient interfaces remain rejected.

Preparation binds durable FACE references and project revision.
`cad_run_simulation` still creates an awaiting-approval job without
geometry transfer. The browser shows exact transient material,
boundary, time-grid, and mesh values before its human confirmation;
the local Bridge separately requires host approval before STEP transfer.
Stale revisions, pre/post-dispatch cancellation, failed jobs, and
incomplete normalized frame histories fail closed. Successful jobs
return bounded numerical frame summaries in the browser and MCP
results. Transient field pages and contours are not claimed or
exposed as structural visualization.

Focused evidence: `npm run test:mcp:simulation:sim9-authoring` passed
MCP parsing/admission, prepared-request validation, both approvals,
no pre-approval transfer, revision staleness during host approval,
cancellation, failure, complete result retrieval, malformed-result
quarantine, and no field-page exposure. `npx tsc --noEmit` passed.
The shared thermal preparation branch changed, so the directly
affected `npm run test:mcp:simulation:sim8-lifecycle` also passed.
No earlier real-solver numerical matrix was rerun: the CalculiX
transient deck, frame parser, and thermal physics did not change.
Earlier SIM-9/SIM-8 numerical evidence is not stale.

## Sixth increment: bounded frame fields and visualization

Each requested transient time now has two independent, immutable
boundary-triangle datasets: nodal temperature (degC) and element-mean
HFL magnitude (W/m²). Dataset IDs include ordered frame indices
(`frame:001`, `frame:002`, ...), and descriptors carry the exact
requested time. The existing 128-triangle maximum page size,
per-chunk SHA-256 digest, full-dataset SHA-256 digest, zero thermal
displacements, result quarantine, and revision-bound retrieval apply
unchanged. Engineering-authority transient results require the exact
two-dataset-per-frame ordered ID sequence; architecture mocks may
still expose no fields.

The existing Three.js thermal viewer selects one requested frame at
a time, resets prior domains/probes before loading, verifies page
order, frame identity, chunk and complete digests, and renders only
temperature or heat-flux contours. Numerical extrema, physical-unit
probes, clipping, and domain visibility remain available. Thermal
results cannot be displayed as structural stress/displacement.

Focused Gmsh 4.15.2 / CalculiX 2.16 slab evidence: 468 nodes,
209 elements; 100/400/1200 s; six datasets of 672 triangles each.
Seventeen-triangle page retrieval, re-read determinism, exact ordered
IDs and requested times, and missing/reordered result IDs passed.
The browser displayed maxima 27.9778, 35.3354, and 39.6138 °C,
respectively, against analytical tip temperatures 28.0801, 35.4260,
and 39.6359 °C (maximum absolute difference 0.1023 °C).
Missing, duplicate, reordered, cross-frame, malformed, chunk-digest,
and dataset-digest page variants were rejected without a contour.
The directly affected SIM-8 steady slab field fixture and two-domain
thermal viewer also passed. Existing numerical SIM-9 and SIM-8
evidence remains current; no solver physics, deck, or frame
normalization changed.

SIM-9 remains `proof_of_concept` with
`engineeringUsePermitted: false`. The
[capability-specific evidence matrix](SIM9_EXIT_GATE_MATRIX.md) consolidates
the existing bounded lanes without a new solver run or automatic
promotion. Broader SIM-9 analyses remain separate future increments.
