import { readBoundedStarterConcentratedLoads } from '../../simulation-bridge/openRadiossStarterLoads.mts';
import { fixedNodeGroupRows,type PreparedOpenRadioss } from './OpenRadiossDeck.mts';
/** Mechanically reuses the standalone interpreted model/load/resource gates.
 * No benchmark accuracy/oracle gate is used by provider execution. */
export function admitOpenRadiossStarter(listing:string, prepared:PreparedOpenRadioss) {
  const fail=(why:string):never=>{throw new Error('OpenRadioss Starter admission: '+why);};
  if(Buffer.byteLength(listing)>8*1024*1024 || !/NORMAL TERMINATION/.test(listing) ||
    !/\b0 ERROR\(S\)/.test(listing)||!/\b0 WARNING\(S\)/.test(listing)) fail('abnormal/errors/warnings');
  for(const units of ['INPUT','WORK']) if(!new RegExp(units+' UNIT SYSTEM[^\\n]*\\( Mg , mm , s\\s*\\)').test(listing)) fail('unit interpretation');
  const one=(pattern:RegExp)=>{
    const matches=[...listing.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))];
    if(matches.length!==1) fail('missing/ambiguous interpreted quantity');
    const v=Number(matches[0][1]); if(!Number.isFinite(v)) fail('non-finite interpreted quantity'); return v;
  };
  const expected=prepared.expected;
  for(const [pattern,target] of [[/NUMNOD[^\r\n]*\s(\d+)\s*$/m,expected.nodeCount],
    [/NUMELS[^\r\n]*\s(\d+)\s*$/m,expected.elementCount],[/NUMBCS[^\r\n]*\s(\d+)\s*$/m,1],
    [/NCONLD[^\r\n]*\s(\d+)\s*$/m,expected.loads.length],[/INITIAL DENSITY[^\r\n]*=\s*([\d.E+-]+)/,expected.densityMgPerMm3],
    [/YOUNG'S MODULUS[^\r\n]*=\s*([\d.E+-]+)/,expected.E],[/POISSON'S RATIO[^\r\n]*=\s*([\d.E+-]+)/,expected.nu],
    [/TETRA4 FORMULATION FLAG[^\r\n]*=\s*(\d+)/,1000]] as const)
    if(one(pattern)!==Number(target.toExponential(12))) fail('mesh/material/property/constraint count mismatch');
  if(!/Part id,name:\s*1 One elastic bar[^\r\n]*Elm type: TETRA4/.test(listing)) fail('wrong part/element type');
  const massSection=listing.split('TOTAL MASS AND MASS CENTER');
  if(massSection.length!==2) fail('missing/ambiguous mass section');
  const massRows=massSection[1].split('TOTAL INERTIA')[0].match(/^\s*(\d+\.\d+E[+-]\d+)\s+([\d.E+-]+)\s+([\d.E+-]+)\s+([\d.E+-]+)\s*$/m);
  const mass=Number(massRows?.[1]);
  if(!Number.isFinite(mass)||Math.abs(mass-expected.massMg)>expected.massMg*1e-10 ||
    one(/TOTAL ADDED MASS\s*=\s*([\d.E+-]+)/)!==0) fail('interpreted mass/added mass mismatch');
  const loads=readBoundedStarterConcentratedLoads(listing,expected.loads,expected.forceN);
  // The frozen Starter listing does not enumerate BCS membership; independently
  // bind exact emitted group/Trarot/deck bytes, plus NUMBCS and later fixed DX/VX/AX.
  const fixedBlock=`/GRNOD/NODE/1\nFixed x min\n${fixedNodeGroupRows(expected.fixedNodeIds).join('\n')}\n`;
  if(!prepared.starter.includes(fixedBlock)||!prepared.starter.includes('   111 000         0         1')) fail('fixed group/BCS mapping');
  const sections=listing.split('NODAL TIME STEP (estimation)');
  if(sections.length!==2) fail('missing/ambiguous native timestep section');
  const section=sections[1].split('NODAL TIME STEP DISTRIBUTION');
  if(section.length!==2) fail('unbounded native timestep section');
  const estimates=[...section[0].matchAll(/^\s*([\d.]+E[+-]\d+)\s+(\d+)\s*$/gm)].map(m=>Number(m[1]));
  if(!estimates.length||estimates.some(v=>!Number.isFinite(v)||v<=0)) fail('invalid native timestep estimate');
  const criticalNodalEstimateS=Math.min(...estimates), selectedEstimatedStepS=prepared.dtNodaScale*criticalNodalEstimateS;
  const expectedCycles=Math.floor(prepared.request.analysis.durationS/selectedEstimatedStepS)+1;
  if(selectedEstimatedStepS>=criticalNodalEstimateS || selectedEstimatedStepS>=prepared.historyIntervalS ||
    selectedEstimatedStepS>prepared.request.analysis.integration.maximumTimeStepS ||
    expectedCycles>Math.min(20000,prepared.request.analysis.integration.maximumIncrements)) fail('native stability/time/history/resource bound');
  return {units:'Mg-mm-s',effectiveFormulation:'linear one-point TETRA4; input 1000 / part-review 0',
    massMg:mass,loads,fixedNodeIds:expected.fixedNodeIds,criticalNodalEstimateS,selectedEstimatedStepS,expectedCycles,
    noMassScalingConfiguration:true};
}
