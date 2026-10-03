import { digest } from '../../simulation-bridge/stableDigest.mts';
import { sha256 } from './OpenRadiossInstallation.mts';
import { EXPLICIT_ARTIFACT_POLICY_DIGEST,validateArtifactPins } from './OpenRadiossExecutionReadiness.mts';

/** Trusted host port only. Not request data. The host must fsync, reopen and
 * verify protected bytes before acknowledging. Ordinary providers need not
 * opt in; the current-lineage execution adapter always does. */
export interface OpenRadiossDurableSink {
  readonly artifactPolicyDigest:string;
  artifacts(record:Readonly<Record<string,any>>,bytes:Readonly<Record<string,Uint8Array>>):Promise<void>;
  candidate(record:Readonly<Record<string,any>>):Promise<void>;
}
export class OpenRadiossDurableCapture {
  private failed=false;
  private t01:string|null=null;
  constructor(private readonly sink:OpenRadiossDurableSink){
    if(sink.artifactPolicyDigest!==EXPLICIT_ARTIFACT_POLICY_DIGEST)throw new Error('DURABLE_ARTIFACT_POLICY_MISMATCH');
  }
  get cleanupAllowed(){return !this.failed;}
  markFailed(){this.failed=true;}
  async artifacts(identity:Record<string,any>,input:Record<string,Uint8Array>){
    try {
      const bytes:Record<string,Uint8Array>={},pins:Record<string,{sha256:string;bytes:number}>={};
      if(!Object.keys(input).length||Object.keys(input).length>8)throw new Error('Durable artifact count');
      let total=0;
      for(const [name,value] of Object.entries(input)){
        if(!/^[A-Za-z0-9_.-]+$/.test(name)||!value.byteLength)
          throw new Error('Durable artifact shape/bound');
        bytes[name]=new Uint8Array(value);total+=value.byteLength;
        pins[name]={sha256:sha256(Buffer.from(value)),bytes:value.byteLength};
      }
      validateArtifactPins(pins);
      const unsigned={schema:'tunacad-openradioss-durable-artifacts/1',...structuredClone(identity),
        artifactPolicyDigest:EXPLICIT_ARTIFACT_POLICY_DIGEST,artifacts:pins};
      const record={...unsigned,recordDigest:digest(unsigned)};
      await this.sink.artifacts(record,bytes);
      const name=Object.keys(pins).find(n=>n.endsWith('T01'));
      if(name)this.t01=pins[name].sha256;
    } catch(error){this.failed=true;throw error;}
  }
  async candidate(identity:Record<string,any>,candidate:Record<string,any>){
    try {
      if(!this.t01||!Object.entries(candidate.artifacts??{}).some(([name,hash])=>name.endsWith('T01')&&hash===this.t01))
        throw new Error('Candidate lacks durably captured authentic T01');
      const unsigned={schema:'tunacad-openradioss-durable-candidate/1',...structuredClone(identity),
        t01Sha256:this.t01,normalizationIdentity:'tunacad-explicit-dynamics-result/0.1',
        candidate:structuredClone(candidate),candidateDigest:digest(candidate),publication:'pending_cleanup_and_final_receipt'};
      await this.sink.candidate({...unsigned,recordDigest:digest(unsigned)});
    }catch(error){this.failed=true;throw error;}
  }
}
