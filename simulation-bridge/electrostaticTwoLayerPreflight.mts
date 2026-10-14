import {randomUUID} from 'node:crypto';
import {prepareHostTwoLayerElectrostaticStudy,type TwoLayerPreparationHost} from './electrostaticTwoLayerHostPreparation.mts';
import {validateElectrostaticTwoLayer} from './electrostaticTwoLayerFoundation.mts';
import {electrostaticRuntimeSchema} from './electrostaticAdmission.mts';
import {digest} from './stableDigest.mts';

/** Trusted host-only dry preparation, not admission or a browser approval.
 * Reuses the full canonical source path and stops at the mesher boundary.
 * Cannot call a supplied mesher, publish a study, approve or execute a solve. */
export async function preflightHostTwoLayerElectrostaticSource(host:TwoLayerPreparationHost) {
  const stop=Error('TWO_LAYER_PREFLIGHT_NATIVE_BOUNDARY');
  let source:ReturnType<typeof validateElectrostaticTwoLayer>|null=null;
  let stepBytes:number[]=[];
  try{
    await prepareHostTwoLayerElectrostaticStudy('two-layer-preflight-'+randomUUID(),{...host,
      mesh:async(request,steps,_executable,size)=>{
        if(size!==1||steps.some(s=>s.byteLength<1||s.byteLength>8*1024*1024))throw Error('ELECTROSTATIC_PREFLIGHT_SOURCE_LIMIT');
        source=validateElectrostaticTwoLayer(request);stepBytes=steps.map(s=>s.byteLength);throw stop;
      }});
    throw Error('ELECTROSTATIC_PREFLIGHT_DID_NOT_STOP');
  }catch(error){if(error!==stop)throw error;}
  if(!source)throw Error('ELECTROSTATIC_PREFLIGHT_SOURCE_MISSING');
  const request=source as ReturnType<typeof validateElectrostaticTwoLayer>;
  const runtime=electrostaticRuntimeSchema.parse(await host.readCurrentRuntimeIdentity());
  return {schema:'tunacad-two-layer-source-preflight/0.1',state:'source_checked_no_mesh_no_approval',
    projectRevision:request.model.projectRevision,requestDigest:request.requestDigest,
    canonicalGeometryDigests:request.model.domains.map(domain=>{
      if(!domain||typeof domain!=='object'||!('geometryDigest' in domain)
        ||typeof domain.geometryDigest!=='string')throw Error('ELECTROSTATIC_PREFLIGHT_GEOMETRY_DIGEST_MISSING');
      return domain.geometryDigest;
    }),stepBytes,
    runtime,runtimeDigest:digest(runtime),meshSizeMm:1,meshRuns:0,solveRuns:0,
    protectedApprovals:0,publicAdmission:'closed',engineeringUsePermitted:false};
}
