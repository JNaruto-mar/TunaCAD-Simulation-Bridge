import type { Interface } from 'node:readline/promises';
import type { TwoLayerApproval } from './electrostaticTwoLayerApproval.mts';

/** Real interactive terminal gate, shared by the CLI and bounded acceptance.
 * No injected decision, environment grant or programmatic stdin is accepted. */
export async function approveTwoLayerInTerminal(request:TwoLayerApproval,signal:AbortSignal,terminal:Interface) {
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Two-layer approval requires a real interactive terminal.');
  console.log('Two-layer electrostatic approval: '+JSON.stringify({
    protectedStudyId:request.studyId,revision:request.projectRevision,
    sourceEpoch:request.sourceEpoch,sourceDigest:request.sourceDigest,
    requestDigest:request.requestDigest,preparationReceiptDigest:request.preparationReceiptDigest,
    domains:request.domains,electrodes:request.electrodes,
    interfaceFaces:request.interfaceFaces,conformalMesh:request.mesh,
  }));
  console.log('Authorize this one protected two-layer study only. This terminal approval does not dispatch a provider.');
  try{return(await terminal.question('Type approve to authorize this two-layer study only: ',{signal})).trim()==='approve';}
  catch{return false;}
}
