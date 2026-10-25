export const WORKFLOW_CAPACITY_POLICY=Object.freeze({
  version:'native-workflow-capacity/1',maximumWorkflows:128,
  protectedBytes:8n*1024n**3n,minimumFreeBytes:20n*1024n**3n,
  metadataHeadroomBytes:16n*1024n**2n,
  fractureReservationBytes:256n*1024n**2n,
  generalReservationBytes:2560n*1024n**2n,
  scratchReservationBytes:1024n**3n,
});
export type CapacityReservation={workflowId:string;protectedBytes:bigint;scratchBytes:bigint;scratchVolume:string;released:boolean};
export type CapacitySnapshot={workflowCount:number;protectedBytes:bigint;workflowBytes:Map<string,bigint>;
  protectedVolume:string;freeBytes:Map<string,bigint>;reservations:CapacityReservation[]};
function requireCapacity(ok:unknown,code:string):asserts ok{if(!ok)throw Error('NATIVE_WORKFLOW_CAPACITY_'+code);}
/** Pure conservative admission. All native mutations invoke this under the
 * same exclusive owner lock; a snapshot alone never reserves capacity. */
export function checkWorkflowCapacity(snapshot:CapacitySnapshot,extra?:CapacityReservation,publication?:{workflowId?:string;bytes:bigint}){
  const p=WORKFLOW_CAPACITY_POLICY;
  requireCapacity(Number.isInteger(snapshot.workflowCount)&&snapshot.workflowCount>=0&&snapshot.workflowCount<=p.maximumWorkflows,'COUNT');
  requireCapacity(snapshot.protectedBytes>=0n,'INVALID_SNAPSHOT');
  requireCapacity(!extra||snapshot.workflowCount<p.maximumWorkflows,'COUNT');
  const delta=publication?.bytes??0n;requireCapacity(delta>=0n,'INVALID_SNAPSHOT');
  const reservations=[...snapshot.reservations,...extra?[extra]:[]],seen=new Set<string>();
  let charged=snapshot.protectedBytes+delta+p.metadataHeadroomBytes,unwritten=0n;
  const scratch=new Map<string,bigint>();
  for(const r of reservations){
    requireCapacity(!seen.has(r.workflowId)&&r.protectedBytes>0n&&r.scratchBytes>=0n,'INVALID_RESERVATION');seen.add(r.workflowId);
    if(r.released)continue;
    const actual=(snapshot.workflowBytes.get(r.workflowId)??0n)+(publication?.workflowId===r.workflowId?delta:0n);
    requireCapacity(actual<=r.protectedBytes,'WORKFLOW_BYTES');
    const remaining=r.protectedBytes-actual;charged+=remaining;unwritten+=remaining;
    scratch.set(r.scratchVolume,(scratch.get(r.scratchVolume)??0n)+r.scratchBytes);
  }
  if(publication?.workflowId){const r=reservations.find(r=>r.workflowId===publication.workflowId);
    requireCapacity(r&&!r.released,'UNOWNED_WRITE');}
  requireCapacity(charged<=p.protectedBytes,'BYTE_BUDGET');
  const volumes=new Set([snapshot.protectedVolume,...scratch.keys()]);
  for(const volume of volumes){
    const free=snapshot.freeBytes.get(volume);requireCapacity(typeof free==='bigint'&&free>=0n,'FREE_SPACE_UNVERIFIABLE');
    const pending=(scratch.get(volume)??0n)+(volume===snapshot.protectedVolume?unwritten+delta+p.metadataHeadroomBytes:0n);
    requireCapacity(free-pending>=p.minimumFreeBytes,'DISK_HEADROOM');
  }
  return {chargedProtectedBytes:charged,unwrittenProtectedBytes:unwritten};
}
