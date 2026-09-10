import type {
  NeutralFemMesh,
  NeutralFemModelV2,
  NeutralSimulationConstraint,
  NeutralSimulationConstraintV2,
  NeutralSimulationRequestV2,
  NeutralVector3,
} from '../../src/simulation/externalSimulationContracts.ts';
import { validateNeutralFemModelV2, validateNeutralSimulationRequestV2 } from '../../simulation-bridge/v2Validation.mts';
import {
  buildConstraintSets,
  consistentSurfaceLoads,
  pressureSurfaceLoads,
} from './CalculiXSolverProvider.mts';

/** Generate a deterministic CalculiX C3D10 deck with explicit domain/material
 * ownership, optional nonconformal ties, and prevalidated shared-topology
 * interfaces. No contact behavior is inferred from proximity or assembly. */
export function createCalculiXInputDeckV2(request: NeutralSimulationRequestV2, model: NeutralFemModelV2): string {
  validateNeutralSimulationRequestV2(request);
  validateNeutralFemModelV2(model, request);
  if (model.element.geometryOrder !== 2 || model.element.solutionOrder !== 2 || model.volumeElements.connectivity.some(cell => cell.length !== 10)) {
    throw deckError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'The SIM-4A CalculiX deck requires complete second-order C3D10 tetrahedra.');
  }
  if (request.analysis.type === 'static_contact') {
    validateContactStabilityV2(request, model);
  } else if (!(request.analysis.type === 'modal' && request.constraints.length === 0 && model.domainRegions.length === 1)) {
    validateStructuralStabilityV2(request, model);
  }
  const mesh = asV1Mesh(model);
  const materials = [...request.materials].sort((a, b) => compareText(a.id, b.id));
  const materialNames = new Map(materials.map((material, index) => [material.id, `MATERIAL_${String(index + 1).padStart(3, '0')}`]));
  const domains = [...model.domainRegions].sort((a, b) => compareText(a.domainId, b.domainId));
  const domainSetNames = new Map(domains.map((domain, index) => [domain.domainId, `DOMAIN_${String(index + 1).padStart(3, '0')}`]));
  const nodeSetNames = new Map(domains.map((domain, index) => [domain.domainId, `DOMAIN_NODES_${String(index + 1).padStart(3, '0')}`]));
  const directConstraintEntries = request.constraints
    .map((constraint, requestIndex) => ({ constraint, requestIndex }))
    .filter((entry): entry is { constraint: Exclude<NeutralSimulationConstraintV2, { type: 'remote_displacement' }>; requestIndex: number } => entry.constraint.type !== 'remote_displacement');
  const constraintSets = buildConstraintSets(directConstraintEntries.map(entry => entry.constraint) as NeutralSimulationConstraint[], mesh)
    .map((set, index) => ({
      ...set,
      name: `${set.constraint.type === 'fixed' ? 'FIXED' : 'PRESCRIBED'}_${numberName(directConstraintEntries[index].requestIndex)}`,
      reactionName: reactionName(directConstraintEntries[index].requestIndex),
      requestIndex: directConstraintEntries[index].requestIndex,
    }));
  const constrainedRegions = new Set(constraintSets.flatMap(set => set.regions.map(region => region.regionId)));
  const rigidConnectors = request.interactions.filter(interaction => interaction.type === 'rigid_connector').sort((a, b) => compareText(a.id, b.id));
  const connectorRecords = rigidConnectors.map((connector, index) => {
    const regions = requireRegions(model, connector.semanticReferenceIds);
    const facets = [...new Set(regions.flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    const nodes = [...new Set(facets.flatMap(facet => model.boundaryFacets.connectivity[facet]))].sort((a, b) => a - b);
    if (!facets.length || nodes.length < 3 || regions.some(region => constrainedRegions.has(region.regionId))) {
      throw deckError('SIMULATION_CONNECTOR_INVALID', `Rigid connector "${connector.id}" must own a non-empty FACE group that is not directly constrained.`);
    }
    return {
      connector, facets, nodes, name: `RIGID_CONNECTOR_${numberName(index)}`,
      referenceNode: model.nodes.length + index * 2 + 1,
      rotationNode: model.nodes.length + index * 2 + 2,
    };
  });
  const connectorsById = new Map(connectorRecords.map(record => [record.connector.id, record]));
  const claimedConnectorFacets = new Map<number, string>();
  const claimedConnectorNodes = new Map<number, string>();
  for (const record of connectorRecords) {
    for (const facet of record.facets) {
      const owner = claimedConnectorFacets.get(facet);
      if (owner) throw deckError('SIMULATION_CONNECTOR_FACE_OVERLAP', `Rigid connectors "${owner}" and "${record.connector.id}" overlap.`);
      claimedConnectorFacets.set(facet, record.connector.id);
    }
    for (const node of record.nodes) {
      const owner = claimedConnectorNodes.get(node);
      if (owner) throw deckError('SIMULATION_CONNECTOR_NODE_OVERLAP', `Rigid connectors "${owner}" and "${record.connector.id}" share mesh nodes.`);
      claimedConnectorNodes.set(node, record.connector.id);
    }
  }
  const nodalLoads = new Map<number, NeutralVector3>();
  const loads = [...request.loads].sort((a, b) => compareText(a.id, b.id));
  for (const load of loads) {
    if (load.type === 'gravity' || load.type === 'remote_force') continue;
    const regions = requireRegions(model, load.semanticReferenceIds);
    if (regions.some(region => constrainedRegions.has(region.regionId))) throw deckError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'A SIM-4A region cannot be loaded and constrained simultaneously.');
    const facetIndices = [...new Set(regions.flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    if (facetIndices.some(facet => claimedConnectorFacets.has(facet))) throw deckError('SIMULATION_CONNECTOR_FACE_OVERLAP', 'A rigid-connector FACE group cannot also receive a direct surface load.');
    addLoads(nodalLoads, load.type === 'surface_force'
      ? consistentSurfaceLoads(mesh, facetIndices, load.forceN)
      : pressureSurfaceLoads(mesh, facetIndices, load.pressureMPa));
  }
  const gravity = loads.filter(load => load.type === 'gravity').reduce<NeutralVector3>((sum, load) => [
    sum[0] + load.accelerationMmPerS2[0], sum[1] + load.accelerationMmPerS2[1], sum[2] + load.accelerationMmPerS2[2],
  ], [0, 0, 0]);
  const gravityMagnitude = Math.hypot(...gravity);
  validateSharedTopology(request, model);
  const ties = request.interactions.filter(interaction => interaction.type === 'bonded_tie').sort((a, b) => compareText(a.id, b.id));
  const claimedTieFacets = new Set<number>(claimedConnectorFacets.keys());
  const tieCards = ties.flatMap((tie, index) => {
    const number = String(index + 1).padStart(3, '0');
    const secondary = [...new Set(requireRegions(model, tie.secondaryReferenceIds).flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    const primary = [...new Set(requireRegions(model, tie.primaryReferenceIds).flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    if (!secondary.length || !primary.length || secondary.some(facet => primary.includes(facet))
      || [...secondary, ...primary].some(facet => claimedTieFacets.has(facet))) throw deckError('SIMULATION_INTERACTION_FACE_OVERLAP', 'Bonded-tie FACE groups must be non-empty and cannot overlap or be reused.');
    [...secondary, ...primary].forEach(facet => claimedTieFacets.add(facet));
    const secondaryName = `TIE_SECONDARY_${number}`; const primaryName = `TIE_PRIMARY_${number}`;
    return [
      `*SURFACE, NAME=${secondaryName}, TYPE=ELEMENT`, ...calculixSurfaceFaces(model, secondary),
      `*SURFACE, NAME=${primaryName}, TYPE=ELEMENT`, ...calculixSurfaceFaces(model, primary),
      `*TIE, NAME=TIE_${number}, ADJUST=NO, POSITION TOLERANCE=${solverNumber(tie.positionToleranceMm)}`,
      `${secondaryName},${primaryName}`,
    ];
  });
  const contacts = request.interactions.filter(interaction => interaction.type === 'frictionless_contact').sort((a, b) => compareText(a.id, b.id));
  const claimedContactFacets = new Set<number>(claimedTieFacets);
  const contactCards = contacts.flatMap((contact, index) => {
    const number = String(index + 1).padStart(3, '0');
    const secondary = [...new Set(requireRegions(model, contact.secondaryReferenceIds).flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    const primary = [...new Set(requireRegions(model, contact.primaryReferenceIds).flatMap(region => region.facetIndices))].sort((a, b) => a - b);
    if (!secondary.length || !primary.length || secondary.some(facet => primary.includes(facet))
      || [...secondary, ...primary].some(facet => claimedContactFacets.has(facet))) {
      throw deckError('SIMULATION_CONTACT_FACE_OVERLAP', 'Frictionless-contact FACE groups must be non-empty and cannot overlap or be reused.');
    }
    [...secondary, ...primary].forEach(facet => claimedContactFacets.add(facet));
    const secondaryName = `CONTACT_SECONDARY_${number}`; const primaryName = `CONTACT_PRIMARY_${number}`; const interactionName = `CONTACT_BEHAVIOR_${number}`;
    return [
      `*SURFACE, NAME=${secondaryName}, TYPE=ELEMENT`, ...calculixSurfaceFaces(model, secondary),
      `*SURFACE, NAME=${primaryName}, TYPE=ELEMENT`, ...calculixSurfaceFaces(model, primary),
      `*CONTACT PAIR, INTERACTION=${interactionName}, TYPE=NODE TO SURFACE, SMALL SLIDING`,
      `${secondaryName},${primaryName}`,
      `*SURFACE INTERACTION, NAME=${interactionName}`,
      '*SURFACE BEHAVIOR, PRESSURE-OVERCLOSURE=LINEAR',
      [contact.normalBehavior.stiffnessMPaPerMm, contact.normalBehavior.tensionCutoffMPa, contact.normalBehavior.searchDistanceFactor].map(solverNumber).join(','),
    ];
  });
  if (loads.some(load => load.type === 'gravity') && materials.some(material => !(material.densityKgM3 && material.densityKgM3 > 0))) {
    throw deckError('SIMULATION_MATERIAL_INVALID', 'Every material assigned to a gravity-loaded SIM-4A model requires positive density.');
  }
  if (request.analysis.type === 'modal' && materials.some(material => !(material.densityKgM3 && material.densityKgM3 > 0))) {
    throw deckError('SIMULATION_MATERIAL_INVALID', 'Every material assigned to a modal model requires positive density.');
  }
  const allElements = model.volumeElements.connectivity.map((_, index) => index + 1);
  const boundaryLinesV2 = [
    ...constraintSets.flatMap(item => boundaryLines(item.name, item.constraint)),
    ...request.constraints.flatMap(constraint => constraint.type === 'remote_displacement'
      ? remoteBoundaryLines(connectorsById.get(constraint.connectorId)!, constraint)
      : []),
  ];
  const boundaryCards = boundaryLinesV2.length ? ['*BOUNDARY', ...boundaryLinesV2] : [];
  const frequencyLine = request.analysis.type === 'modal'
    ? request.analysis.settings.maximumFrequencyHz !== null
      ? `${solverNumber(request.analysis.settings.requestedModeCount)},${solverNumber(request.analysis.settings.minimumFrequencyHz ?? 0)},${solverNumber(request.analysis.settings.maximumFrequencyHz)}`
      : request.analysis.settings.minimumFrequencyHz !== null
        ? `${solverNumber(request.analysis.settings.requestedModeCount)},${solverNumber(request.analysis.settings.minimumFrequencyHz)}`
        : solverNumber(request.analysis.settings.requestedModeCount)
    : null;
  const concentratedLoadCards = [...nodalLoads.entries()].length || loads.some(load => load.type === 'remote_force') ? [
    '*CLOAD',
    ...[...nodalLoads.entries()].sort(([a], [b]) => a - b).flatMap(([node, force]) => force.flatMap((value, axis) => Math.abs(value) > 1e-14 ? [`${node + 1},${axis + 1},${solverNumber(value)}`] : [])),
    ...loads.flatMap(load => load.type === 'remote_force' ? remoteLoadLines(connectorsById.get(load.connectorId)!, load) : []),
  ] : [];
  const analysisCards = request.analysis.type === 'modal' ? [
    '*STEP',
    '*FREQUENCY,SOLVER=ARPACK',
    frequencyLine!,
    ...boundaryCards,
    '*NODE FILE, NSET=NALL, GLOBAL=YES', 'U',
    '*END STEP',
  ] : request.analysis.type === 'linear_buckling' ? [
    '*STEP',
    '*BUCKLE',
    solverNumber(request.analysis.settings.requestedModeCount),
    ...boundaryCards,
    ...concentratedLoadCards,
    '*NODE FILE, NSET=NALL, GLOBAL=YES', 'U',
    '*END STEP',
  ] : request.analysis.type === 'static_contact' ? [
    `*STEP, INC=${request.analysis.settings.maximumIncrements}`,
    '*STATIC',
    `${solverNumber(request.analysis.settings.initialIncrement)},1,${solverNumber(request.analysis.settings.minimumIncrement)},${solverNumber(request.analysis.settings.maximumIncrement)}`,
    ...boundaryCards,
    ...concentratedLoadCards,
    ...(gravityMagnitude > 1e-9 ? ['*DLOAD', `EALL,GRAV,${solverNumber(gravityMagnitude)},${gravity.map(value => solverNumber(value / gravityMagnitude)).join(',')}`] : []),
    '*NODE PRINT, NSET=NALL, GLOBAL=YES, FREQUENCY=1000000', 'U',
    ...request.constraints.flatMap((constraint, index) => [
      `*NODE PRINT, NSET=${reactionName(index)}, TOTALS=ONLY, GLOBAL=YES, FREQUENCY=1000000`, 'RF',
      ...(constraint.type === 'remote_displacement' ? [`*NODE PRINT, NSET=${reactionMomentName(index)}, TOTALS=ONLY, GLOBAL=YES, FREQUENCY=1000000`, 'RF'] : []),
    ]),
    '*EL PRINT, ELSET=EALL, FREQUENCY=1000000', 'S',
    ...domains.flatMap(domain => [
      `*NODE PRINT, NSET=${nodeSetNames.get(domain.domainId)!}, GLOBAL=YES, FREQUENCY=1000000`, 'U',
      `*EL PRINT, ELSET=${domainSetNames.get(domain.domainId)!}, FREQUENCY=1000000`, 'S',
    ]),
    '*NODE FILE, NSET=NALL, GLOBAL=YES, FREQUENCY=1000000', 'U',
    '*CONTACT FILE, FREQUENCY=1000000', 'CDIS,CSTR',
    '*END STEP',
  ] : [
    '*STEP', '*STATIC', ...boundaryCards,
    ...concentratedLoadCards,
    ...(gravityMagnitude > 1e-9 ? ['*DLOAD', `EALL,GRAV,${solverNumber(gravityMagnitude)},${gravity.map(value => solverNumber(value / gravityMagnitude)).join(',')}`] : []),
    '*NODE PRINT, NSET=NALL, GLOBAL=YES', 'U',
    ...request.constraints.flatMap((constraint, index) => [
      `*NODE PRINT, NSET=${reactionName(index)}, TOTALS=ONLY, GLOBAL=YES`, 'RF',
      ...(constraint.type === 'remote_displacement' ? [`*NODE PRINT, NSET=${reactionMomentName(index)}, TOTALS=ONLY, GLOBAL=YES`, 'RF'] : []),
    ]),
    '*EL PRINT, ELSET=EALL', 'S',
    ...domains.flatMap(domain => [
      `*NODE PRINT, NSET=${nodeSetNames.get(domain.domainId)!}, GLOBAL=YES`, 'U',
      `*EL PRINT, ELSET=${domainSetNames.get(domain.domainId)!}`, 'S',
    ]),
    ...(loads.some(load => load.type === 'gravity') ? ['*EL PRINT, ELSET=EALL, TOTALS=ONLY', 'EVOL'] : []),
    '*END STEP',
  ];
  const lines = [
    '*HEADING',
    `TunaCAD ${request.analysis.type === 'modal' ? request.constraints.length ? 'SIM-5 constrained modal' : 'SIM-5 free-free modal' : request.analysis.type === 'linear_buckling' ? 'SIM-5 linear eigenvalue buckling' : request.analysis.type === 'static_contact' ? 'SIM-6A frictionless small-sliding contact' : 'SIM-4A multi-domain linear-static'} study ${safeComment(request.studyId)}`,
    '*NODE, NSET=NALL',
    ...model.nodes.map((point, index) => `${index + 1},${point.map(solverNumber).join(',')}`),
    ...(connectorRecords.length ? [
      '*NODE',
      ...connectorRecords.flatMap(record => [
        `${record.referenceNode},${record.connector.referencePointAnalysisMm.map(solverNumber).join(',')}`,
        `${record.rotationNode},${record.connector.referencePointAnalysisMm.map(solverNumber).join(',')}`,
      ]),
    ] : []),
    ...domains.flatMap(domain => {
      const setName = domainSetNames.get(domain.domainId)!;
      return [
        `*ELEMENT, TYPE=C3D10, ELSET=${setName}`,
        ...domain.elementIndices.map(index => `${index + 1},${neutralToCalculiXC3D10(model.volumeElements.connectivity[index]).map(node => node + 1).join(',')}`),
      ];
    }),
    '*ELSET, ELSET=EALL', ...wrapIds(allElements),
    ...domains.flatMap(domain => [`*NSET, NSET=${nodeSetNames.get(domain.domainId)!}`, ...wrapIds(domain.nodeIndices.map(node => node + 1))]),
    ...constraintSets.flatMap(item => [
      `*NSET, NSET=${item.name}`, ...wrapIds(item.nodes.map(node => node + 1)),
      `*NSET, NSET=${item.reactionName}`, ...wrapIds(item.reactionNodes.map(node => node + 1)),
    ]),
    ...connectorRecords.flatMap(record => [
      `*NSET, NSET=${record.name}`, ...wrapIds(record.nodes.map(node => node + 1)),
      `*RIGID BODY, NSET=${record.name}, REF NODE=${record.referenceNode}, ROT NODE=${record.rotationNode}`,
    ]),
    ...request.constraints.flatMap((constraint, index) => constraint.type === 'remote_displacement' ? [
      `*NSET, NSET=${reactionName(index)}`, String(connectorsById.get(constraint.connectorId)!.referenceNode),
      `*NSET, NSET=${reactionMomentName(index)}`, String(connectorsById.get(constraint.connectorId)!.rotationNode),
    ] : []),
    ...materials.flatMap(material => [
      `*MATERIAL, NAME=${materialNames.get(material.id)!}`,
      '*ELASTIC', `${solverNumber(material.youngsModulusMPa)},${solverNumber(material.poissonRatio)}`,
      ...(material.densityKgM3 !== undefined ? ['*DENSITY', solverNumber(material.densityKgM3 * 1e-12)] : []),
    ]),
    ...domains.map(domain => `*SOLID SECTION, ELSET=${domainSetNames.get(domain.domainId)!}, MATERIAL=${materialNames.get(domain.materialId)!}`),
    ...tieCards,
    ...contactCards,
    ...analysisCards,
  ];
  return `${lines.join('\n')}\n`;
}

/** Fail before solver launch when an explicit multi-domain connection graph
 * contains an independently unsupported component, or when one connected
 * assembly leaves a rigid-body mode free. The rank calculation considers only
 * declared constraints; touching geometry and assembly proximity add no rows. */
export function validateStructuralStabilityV2(request: NeutralSimulationRequestV2, model: NeutralFemModelV2): void {
  const domainIds = model.domainRegions.map(domain => domain.domainId).sort(compareText);
  const parent = new Map(domainIds.map(domainId => [domainId, domainId]));
  const find = (domainId: string): string => {
    const current = parent.get(domainId);
    if (!current) throw deckError('SIMULATION_MODEL_DISCONNECTED', `Unknown structural domain "${domainId}".`);
    if (current === domainId) return current;
    const root = find(current); parent.set(domainId, root); return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left); const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [root, child] = [leftRoot, rightRoot].sort(compareText);
    parent.set(child, root);
  };
  const referenceDomains = new Map(request.model.references.map(reference => [reference.semanticReferenceId, reference.domainId]));
  for (const interaction of request.interactions) {
    if (interaction.type === 'rigid_connector') continue;
    const secondary = referenceDomains.get(interaction.secondaryReferenceIds[0]);
    const primary = referenceDomains.get(interaction.primaryReferenceIds[0]);
    if (!secondary || !primary) throw deckError('SIMULATION_MODEL_DISCONNECTED', `Interaction "${interaction.id}" has unresolved domain ownership.`);
    union(secondary, primary);
  }
  const components = new Map<string, string[]>();
  for (const domainId of domainIds) {
    const root = find(domainId); const members = components.get(root) ?? []; members.push(domainId); components.set(root, members);
  }
  const connectors = new Map(request.interactions.filter(interaction => interaction.type === 'rigid_connector').map(interaction => [interaction.id, interaction]));
  const failures: Array<{ domains: string[]; rank: number }> = [];
  for (const domains of [...components.values()].map(items => items.sort(compareText)).sort((a, b) => compareText(a[0], b[0]))) {
    const domainSet = new Set(domains);
    const componentNodes = [...new Set(model.domainRegions.filter(domain => domainSet.has(domain.domainId)).flatMap(domain => domain.nodeIndices))];
    const origin = centroid(componentNodes.map(node => model.nodes[node]));
    const rows: number[][] = [];
    for (const constraint of request.constraints) {
      if (constraint.type === 'remote_displacement') {
        const connector = connectors.get(constraint.connectorId);
        if (!connector || !domainSet.has(referenceDomains.get(connector.semanticReferenceIds[0]) ?? '')) continue;
        const point = subtractPoint(connector.referencePointAnalysisMm, origin);
        constraint.translationMm.forEach((value, axis) => { if (value !== null) rows.push(rigidTranslationRow(point, axis)); });
        constraint.rotationRad.forEach((value, axis) => { if (value !== null) rows.push([0, 0, 0, axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]); });
        continue;
      }
      const regions = requireRegions(model, constraint.semanticReferenceIds).filter(region => domainSet.has(region.domainId));
      const nodes = [...new Set(regions.flatMap(region => region.facetIndices.flatMap(facet => model.boundaryFacets.connectivity[facet])))];
      const restrained = constraint.type === 'fixed' ? [true, true, true] : constraint.displacementMm.map(value => value !== null);
      for (const node of nodes) restrained.forEach((active, axis) => { if (active) rows.push(rigidTranslationRow(subtractPoint(model.nodes[node], origin), axis)); });
    }
    const rank = matrixRank(rows, 6);
    if (rank < 6) failures.push({ domains, rank });
  }
  if (!failures.length) return;
  const detail = failures.map(failure => `[${failure.domains.join(', ')}] rank ${failure.rank}/6`).join('; ');
  if (components.size > 1) {
    throw deckError('SIMULATION_MODEL_DISCONNECTED', `The explicit interaction graph leaves independently unsupported domain component(s): ${detail}. Every disconnected component must be fully restrained or explicitly connected.`);
  }
  throw deckError('SIMULATION_MODEL_UNDERCONSTRAINED', `The connected structural model has free rigid-body modes: ${detail}. Add independent restraints until the rigid-body restraint rank is 6/6.`);
}

/** Contact only restrains relative motion in the declared surface-normal
 * direction. Check the two bodies as independent rigid bodies and add those
 * unilateral normal rows to the explicit support rows. This is deliberately
 * conservative: proximity, friction, and an applied load never count as a
 * restraint. */
export function validateContactStabilityV2(request: NeutralSimulationRequestV2, model: NeutralFemModelV2): void {
  if (request.analysis.type !== 'static_contact') return;
  const domainIds = model.domainRegions.map(domain => domain.domainId).sort(compareText);
  const domainIndex = new Map(domainIds.map((domainId, index) => [domainId, index]));
  const domainOrigins = new Map(domainIds.map(domainId => {
    const region = model.domainRegions.find(candidate => candidate.domainId === domainId);
    if (!region) throw deckError('SIMULATION_MODEL_DISCONNECTED', `Unknown contact domain "${domainId}".`);
    return [domainId, centroid(region.nodeIndices.map(node => model.nodes[node]))] as const;
  }));
  const referenceDomains = new Map(request.model.references.map(reference => [reference.semanticReferenceId, reference.domainId]));
  const referenceFaces = new Map(request.model.references.map(reference => [reference.semanticReferenceId, reference.faceOwnerLocal]));
  const requestDomains = new Map(request.model.domains.map(domain => [domain.domainId, domain]));
  const columns = domainIds.length * 6;
  const rows: number[][] = [];
  const addDomainRow = (domainId: string, row: number[]): void => {
    const index = domainIndex.get(domainId);
    if (index === undefined) throw deckError('SIMULATION_MODEL_DISCONNECTED', `Unknown contact domain "${domainId}".`);
    const global = Array<number>(columns).fill(0);
    row.forEach((value, column) => { global[index * 6 + column] = value; });
    rows.push(global);
  };
  for (const constraint of request.constraints) {
    if (constraint.type === 'remote_displacement') {
      throw deckError('SIMULATION_CONTACT_CONSTRAINT_UNSUPPORTED', 'SIM-6A contact accepts direct FACE constraints only.');
    }
    for (const region of requireRegions(model, constraint.semanticReferenceIds)) {
      const origin = domainOrigins.get(region.domainId)!;
      const nodes = [...new Set(region.facetIndices.flatMap(facet => model.boundaryFacets.connectivity[facet]))];
      const restrained = constraint.type === 'fixed' ? [true, true, true] : constraint.displacementMm.map(value => value !== null);
      for (const node of nodes) restrained.forEach((active, axis) => {
        if (active) addDomainRow(region.domainId, rigidTranslationRow(subtractPoint(model.nodes[node], origin), axis));
      });
    }
  }
  for (const contact of request.interactions) {
    if (contact.type !== 'frictionless_contact') continue;
    const secondaryDomainId = referenceDomains.get(contact.secondaryReferenceIds[0]);
    const primaryDomainId = referenceDomains.get(contact.primaryReferenceIds[0]);
    if (!secondaryDomainId || !primaryDomainId || secondaryDomainId === primaryDomainId) {
      throw deckError('SIMULATION_CONTACT_GEOMETRY_INVALID', `Contact interaction "${contact.id}" has invalid domain ownership.`);
    }
    const secondaryOrigin = domainOrigins.get(secondaryDomainId)!;
    const primaryOrigin = domainOrigins.get(primaryDomainId)!;
    const secondaryTransform = requestDomains.get(secondaryDomainId)?.transformToAnalysis;
    if (!secondaryTransform) throw deckError('SIMULATION_CONTACT_GEOMETRY_INVALID', `Contact interaction "${contact.id}" has no secondary transform.`);
    for (const referenceId of contact.secondaryReferenceIds) {
      const normalOwnerLocal = referenceFaces.get(referenceId)?.outwardDirection;
      if (!normalOwnerLocal) throw deckError('SIMULATION_CONTACT_GEOMETRY_INVALID', `Contact FACE "${referenceId}" has no outward normal.`);
      const normal = transformedUnitDirection(secondaryTransform, normalOwnerLocal);
      const regions = requireRegions(model, [referenceId]);
      const nodes = [...new Set(regions.flatMap(region => region.facetIndices.flatMap(facet => model.boundaryFacets.connectivity[facet])))];
      for (const node of nodes) {
        const point = model.nodes[node];
        const secondaryRow = rigidNormalRow(subtractPoint(point, secondaryOrigin), normal);
        const primaryRow = rigidNormalRow(subtractPoint(point, primaryOrigin), normal).map(value => -value);
        const global = Array<number>(columns).fill(0);
        const secondaryIndex = domainIndex.get(secondaryDomainId)! * 6;
        const primaryIndex = domainIndex.get(primaryDomainId)! * 6;
        secondaryRow.forEach((value, column) => { global[secondaryIndex + column] += value; });
        primaryRow.forEach((value, column) => { global[primaryIndex + column] += value; });
        rows.push(global);
      }
    }
  }
  const rank = matrixRank(rows, columns);
  if (rank < columns) {
    throw deckError('SIMULATION_MODEL_UNDERCONSTRAINED', `The SIM-6A contact model has free rigid-body modes: rank ${rank}/${columns}. Add direct restraints; frictionless contact contributes normal restraint only.`);
  }
}

function rigidTranslationRow(point: NeutralVector3, axis: number): number[] {
  if (axis === 0) return [1, 0, 0, 0, point[2], -point[1]];
  if (axis === 1) return [0, 1, 0, -point[2], 0, point[0]];
  return [0, 0, 1, point[1], -point[0], 0];
}

function rigidNormalRow(point: NeutralVector3, normal: NeutralVector3): number[] {
  const rows = [0, 1, 2].map(axis => rigidTranslationRow(point, axis));
  return Array.from({ length: 6 }, (_, column) => normal.reduce((sum, value, axis) => sum + value * rows[axis][column], 0));
}

function transformedUnitDirection(matrix: readonly number[], direction: NeutralVector3): NeutralVector3 {
  const transformed: NeutralVector3 = [
    matrix[0] * direction[0] + matrix[1] * direction[1] + matrix[2] * direction[2],
    matrix[4] * direction[0] + matrix[5] * direction[1] + matrix[6] * direction[2],
    matrix[8] * direction[0] + matrix[9] * direction[1] + matrix[10] * direction[2],
  ];
  const magnitude = Math.hypot(...transformed);
  if (!(magnitude > 1e-12)) throw deckError('SIMULATION_CONTACT_GEOMETRY_INVALID', 'A contact FACE normal is degenerate after transformation.');
  return transformed.map(value => value / magnitude) as NeutralVector3;
}

function matrixRank(input: number[][], columns: number): number {
  const rows = input.map(row => {
    const scale = Math.hypot(...row);
    return scale > 0 ? row.map(value => value / scale) : [...row];
  });
  let rank = 0;
  for (let column = 0; column < columns && rank < rows.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < rows.length; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) <= 1e-9) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const divisor = rows[rank][column];
    for (let index = column; index < columns; index += 1) rows[rank][index] /= divisor;
    for (let row = 0; row < rows.length; row += 1) {
      if (row === rank) continue;
      const factor = rows[row][column];
      for (let index = column; index < columns; index += 1) rows[row][index] -= factor * rows[rank][index];
    }
    rank += 1;
  }
  return rank;
}

function centroid(points: NeutralVector3[]): NeutralVector3 {
  if (!points.length) throw deckError('SIMULATION_MODEL_DISCONNECTED', 'A structural domain component contains no mesh nodes.');
  const sum = points.reduce<NeutralVector3>((total, point) => [total[0] + point[0], total[1] + point[1], total[2] + point[2]], [0, 0, 0]);
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

function subtractPoint(point: NeutralVector3, origin: NeutralVector3): NeutralVector3 {
  return [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
}

function validateSharedTopology(request: NeutralSimulationRequestV2, model: NeutralFemModelV2): void {
  for (const interaction of request.interactions.filter(interaction => interaction.type === 'shared_topology')) {
    const side = (referenceIds: string[]) => {
      const facetIndices = [...new Set(requireRegions(model, referenceIds).flatMap(region => region.facetIndices))];
      return {
        nodes: [...new Set(facetIndices.flatMap(index => model.boundaryFacets.connectivity[index]))].sort((a, b) => a - b),
        facets: facetIndices.map(index => facetKey(model.boundaryFacets.connectivity[index])).sort(),
      };
    };
    const secondary = side(interaction.secondaryReferenceIds); const primary = side(interaction.primaryReferenceIds);
    if (!secondary.nodes.length || secondary.nodes.join(',') !== primary.nodes.join(',')
      || secondary.facets.length !== primary.facets.length || secondary.facets.some((key, index) => key !== primary.facets[index])) {
      throw deckError('SIMULATION_SHARED_TOPOLOGY_INVALID', `Interaction "${interaction.id}" was not composed as an exact shared-node interface.`);
    }
  }
}

function facetKey(nodes: number[]): string { return [...nodes].sort((a, b) => a - b).join(','); }

export function asV1Mesh(model: NeutralFemModelV2): NeutralFemMesh {
  const { perDomain: _perDomain, ...quality } = model.quality;
  return {
    schema: 'tunacad-neutral-fem-mesh/1.0', meshId: model.modelId, requestDigest: model.requestDigest,
    projectRevision: model.projectRevision, geometryDigest: model.modelDigest, coordinateSpace: 'part_definition_local', units: model.units,
    element: structuredClone(model.element), nodes: structuredClone(model.nodes),
    volumeElements: { connectivity: structuredClone(model.volumeElements.connectivity), regionIds: [...model.volumeElements.volumeRegionIds] },
    boundaryFacets: { connectivity: structuredClone(model.boundaryFacets.connectivity), regionIds: [...model.boundaryFacets.regionIds] },
    boundaryRegions: model.boundaryRegions.map(region => ({
      regionId: region.regionId, semanticReferenceIds: [...region.semanticReferenceIds], sourceFeatureIds: [...region.sourceFeatureIds],
      facetIndices: [...region.facetIndices], matchedCadFace: structuredClone(region.matchedCadFaceOwnerLocal), match: structuredClone(region.match),
    })),
    volumeRegions: model.domainRegions.map(region => ({ regionId: region.volumeRegionId, elementIndices: [...region.elementIndices] })),
    quality: structuredClone(quality),
    provenance: { ...structuredClone(model.provenance), meshProviderInterfaceVersion: '1.0', inputGeometryDigest: model.modelDigest },
  };
}

function requireRegions(model: NeutralFemModelV2, referenceIds: string[]): NeutralFemModelV2['boundaryRegions'] {
  const regions = referenceIds.map(referenceId => {
    const matches = model.boundaryRegions.filter(region => region.semanticReferenceIds.includes(referenceId));
    if (matches.length !== 1) throw deckError(matches.length ? 'SIMULATION_FACE_MAPPING_AMBIGUOUS' : 'SIMULATION_FACE_MAPPING_NOT_FOUND', `FACE reference "${referenceId}" maps to ${matches.length} SIM-4A regions.`);
    return matches[0];
  });
  if (new Set(regions.map(region => region.regionId)).size !== regions.length) throw deckError('SIMULATION_FACE_MAPPING_AMBIGUOUS', 'Several FACE references map to one SIM-4A boundary region.');
  return regions;
}

const surfaceFaceCache = new WeakMap<NeutralFemModelV2, Map<string, { element: number; face: number }>>();
function calculixSurfaceFaces(model: NeutralFemModelV2, facetIndices: number[]): string[] {
  let faces = surfaceFaceCache.get(model);
  if (!faces) {
    faces = new Map();
    model.volumeElements.connectivity.forEach((cell, element) => {
      [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]].forEach((indices, face) => faces!.set(indices.map(index => cell[index]).sort((a, b) => a - b).join(':'), { element, face: face + 1 }));
    });
    surfaceFaceCache.set(model, faces);
  }
  return facetIndices.map(facetIndex => {
    const match = faces!.get(model.boundaryFacets.connectivity[facetIndex].slice(0, 3).sort((a, b) => a - b).join(':'));
    if (!match) throw deckError('SIMULATION_INTERACTION_FACE_MAPPING_INVALID', `Interaction facet ${facetIndex} has no owning volume face.`);
    return `${match.element + 1},S${match.face}`;
  });
}

function boundaryLines(name: string, constraint: NeutralSimulationConstraint): string[] {
  if (constraint.type === 'fixed') return [`${name},1,3,0`];
  return constraint.displacementMm.flatMap((value, axis) => value === null ? [] : [`${name},${axis + 1},${axis + 1},${solverNumber(value)}`]);
}

type RigidConnectorRecord = {
  connector: Extract<NeutralSimulationRequestV2['interactions'][number], { type: 'rigid_connector' }>;
  facets: number[];
  nodes: number[];
  name: string;
  referenceNode: number;
  rotationNode: number;
};

function remoteBoundaryLines(
  record: RigidConnectorRecord,
  constraint: Extract<NeutralSimulationConstraintV2, { type: 'remote_displacement' }>,
): string[] {
  return [
    ...constraint.translationMm.flatMap((value, axis) => value === null ? [] : [`${record.referenceNode},${axis + 1},${axis + 1},${solverNumber(value)}`]),
    ...constraint.rotationRad.flatMap((value, axis) => value === null ? [] : [`${record.rotationNode},${axis + 1},${axis + 1},${solverNumber(value)}`]),
  ];
}

function remoteLoadLines(
  record: RigidConnectorRecord,
  load: Extract<NeutralSimulationRequestV2['loads'][number], { type: 'remote_force' }>,
): string[] {
  return [
    ...load.forceN.flatMap((value, axis) => Math.abs(value) > 1e-14 ? [`${record.referenceNode},${axis + 1},${solverNumber(value)}`] : []),
    ...load.momentNmm.flatMap((value, axis) => Math.abs(value) > 1e-14 ? [`${record.rotationNode},${axis + 1},${solverNumber(value)}`] : []),
  ];
}

function addLoads(target: Map<number, NeutralVector3>, source: Map<number, NeutralVector3>): void {
  for (const [node, force] of source) {
    const prior = target.get(node) ?? [0, 0, 0];
    target.set(node, [prior[0] + force[0], prior[1] + force[1], prior[2] + force[2]]);
  }
}

function neutralToCalculiXC3D10(cell: number[]): number[] {
  if (cell.length !== 10) throw deckError('SIMULATION_MESH_ELEMENT_UNSUPPORTED', 'CalculiX C3D10 translation requires ten neutral nodes.');
  return [...cell.slice(0, 8), cell[9], cell[8]];
}

function wrapIds(ids: number[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < ids.length; index += 16) lines.push(ids.slice(index, index + 16).join(','));
  return lines;
}

function solverNumber(value: number): string {
  if (!Number.isFinite(value)) throw deckError('SIMULATION_INPUT_INVALID', 'CalculiX input contains a non-finite number.');
  if (Math.abs(value) < 1e-12) return '0';
  const [mantissa, exponent] = value.toPrecision(12).replace(/e/g, 'E').split('E');
  const compact = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa;
  return exponent === undefined ? compact : `${compact}E${Number(exponent)}`;
}

function safeComment(value: string): string { return value.replace(/[^A-Za-z0-9 _.:-]/g, '').slice(0, 120); }
function numberName(index: number): string { return String(index + 1).padStart(3, '0'); }
function reactionName(index: number): string { return `REACTION_${numberName(index)}`; }
function reactionMomentName(index: number): string { return `REACTION_MOMENT_${numberName(index)}`; }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function deckError(code: string, message: string): Error & { code: string } { return Object.assign(new Error(message), { code }); }
