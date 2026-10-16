import type {NeutralFemMesh,NeutralVector3} from '../../src/simulation/externalSimulationContracts.ts';
import {quadraticTetraVolumeSamples} from '../../src/simulation/neutralFemMesh.ts';
import {centrifugalAcceleration,isCentrifugalLoad,type CentrifugalLoad} from '../../src/simulation/centrifugalStatic.ts';
/** Same four-point C3D10 quadrature as the native DLOAD, including curved midsides.
 * Negative consistent corner weights are retained, never clamped or absolutized. */
export function centrifugalNodalLoads(mesh:NeutralFemMesh,densityKgM3:number,load:CentrifugalLoad):Map<number,NeutralVector3>{
 if(!isCentrifugalLoad(load)||!Number.isFinite(densityKgM3)||densityKgM3<=0||densityKgM3>100000||!mesh.volumeElements.connectivity.length
  ||mesh.nodes.length>100000||mesh.volumeElements.connectivity.length>50000)throw Error('SIMULATION_CENTRIFUGAL_INPUT_INVALID');
 for(const point of mesh.nodes)centrifugalAcceleration(load,point);
 const result=new Map<number,NeutralVector3>();
 for(const cell of mesh.volumeElements.connectivity){
  if(cell.length!==10||cell.some(n=>!Number.isInteger(n)||!mesh.nodes[n]))throw Error('SIMULATION_MESH_ELEMENT_UNSUPPORTED');
  const points=cell.map(n=>mesh.nodes[n]);
  for(const sample of quadraticTetraVolumeSamples(points)){
   const p=[0,1,2].map(axis=>points.reduce((s,x,i)=>s+x[axis]*sample.shapeFunctions[i],0)) as NeutralVector3;
   const a=centrifugalAcceleration(load,p);
   cell.forEach((node,i)=>{const f=result.get(node)??[0,0,0],scale=densityKgM3*1e-12*sample.volumeWeightMm3*sample.shapeFunctions[i];
    result.set(node,f.map((x,j)=>x+scale*a[j]) as NeutralVector3);});
  }
 }
 if([...result.values()].some(f=>!f.every(Number.isFinite)))throw Error('SIMULATION_CENTRIFUGAL_RESULT_INVALID');return result;
}
export function centrifugalStepCards(load:CentrifugalLoad):string[]{
 if(!isCentrifugalLoad(load))throw Error('SIMULATION_CENTRIFUGAL_INPUT_INVALID');const num=(n:number)=>Number(n.toPrecision(12)).toString();
 return ['*DLOAD',['EALL','CENTRIF',num((load.speedRpm*Math.PI/30)**2),...load.axisPointMm.map(num),...load.axisDirection.map(num)].join(',')];
}
