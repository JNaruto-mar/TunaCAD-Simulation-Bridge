import { randomBytes } from 'node:crypto';
import { digest } from './stableDigest.mts';
import { validatePrivateExplicitSolve, privateExplicitProviderSchema,
  type PrivateExplicitProvider,type PrivateExplicitSolveBinding,type PrivateSimulationApprovals,
  type PrivateSolveAuthorization } from './privateExplicitPreparationContract.mts';

/** Internal extension of the Bridge's human approve callback/session boundary.
 * Not a provider, not a browser/MCP endpoint, and no auto-approval facility.
 * A controlled test may supply the callback; production still uses its human
 * terminal controller. Request JSON can never provide an approval callback. */
export function createPrivateSimulationApprovals(options:{
  readSession():string|null;readProvider():Promise<PrivateExplicitProvider>;
  approve(binding:PrivateExplicitSolveBinding,signal:AbortSignal):Promise<boolean>;
  now?:()=>number;
  /** Constructor-only test opt-in. Never inferred from environment or request JSON. */
  testConfiguration?:{mode:'controlled_test_fixture';purpose:'private_operator_approval_fixture'};
}):PrivateSimulationApprovals & {revoke():void} {
  const configuration=options.testConfiguration;
  if(configuration&&(configuration.mode!=='controlled_test_fixture'||configuration.purpose!=='private_operator_approval_fixture'
    ||Object.keys(configuration).sort().join(',')!=='mode,purpose'))throw new Error('PRIVATE_APPROVAL_TEST_CONFIGURATION_INVALID');
  const approvalSource=configuration?'controlled_test_fixture' as const:'human' as const;
  const now=options.now??Date.now;
  const records=new Map<string,{binding:PrivateExplicitSolveBinding;session:string;expiresAt:number;
    state:'pending'|'approved'|'denied'|'used';controller:AbortController}>();
  const receipt=(id:string,r:ReturnType<typeof requireRecord>):PrivateSolveAuthorization=>
    ({authorizationId:id,bindingDigest:digest(r.binding),expiresAt:r.expiresAt,approvalSource});
  function requireRecord(id:string) {
    const r=records.get(id);
    if(!r||r.session!==options.readSession()||now()>=r.expiresAt||r.state==='denied') {
      if(r){r.state='denied';r.controller.abort();}
      throw new Error('PRIVATE_SIMULATION_APPROVAL_STALE');
    }
    return r;
  }
  async function current(binding:PrivateExplicitSolveBinding) {
    const validated=await validatePrivateExplicitSolve(structuredClone(binding));
    if(validated.solveRevalidation&&now()>=validated.solveRevalidation.expiresAt)
      throw new Error('PRIVATE_SIMULATION_SOLVE_BINDING_EXPIRED');
    if((validated.geometryApproval.approvalSource??'human')!==approvalSource)
      throw new Error('PRIVATE_SIMULATION_APPROVAL_SOURCE_MISMATCH');
    const provider=privateExplicitProviderSchema.parse(await options.readProvider());
    if(digest(validated.provider)!==digest(provider)) throw new Error('PRIVATE_SIMULATION_RUNTIME_CHANGED');
    if(validated.solveRevalidation&&now()>=validated.solveRevalidation.expiresAt)
      throw new Error('PRIVATE_SIMULATION_SOLVE_BINDING_EXPIRED');
    return validated;
  }
  return Object.freeze({
    approvalSource,
    async authorize(input:PrivateExplicitSolveBinding) {
      const binding=await current(input),session=options.readSession();
      if(!session||records.size>=16||[...records.values()].some(r=>r.state==='pending'&&r.expiresAt>now()))
        throw new Error('PRIVATE_SIMULATION_APPROVAL_UNAVAILABLE');
      const id=randomBytes(32).toString('hex'),r={binding,session,
        expiresAt:Math.min(now()+120000,binding.solveRevalidation?.expiresAt??Infinity),
        state:'pending' as 'pending'|'approved'|'denied'|'used',controller:new AbortController()};
      records.set(id,r);
      try {
        const approved=await options.approve(structuredClone(binding),r.controller.signal);
        await current(binding);requireRecord(id);
        if(!approved||r.controller.signal.aborted) throw new Error('PRIVATE_SIMULATION_APPROVAL_DENIED');
        r.state='approved';return receipt(id,r);
      } catch(error) {r.state='denied';r.controller.abort();throw error;}
    },
    async consume(id:string,input:PrivateExplicitSolveBinding) {
      const binding=await current(input),r=requireRecord(id);
      if(r.state!=='approved'||digest(binding)!==digest(r.binding))
        throw new Error('PRIVATE_SIMULATION_APPROVAL_REPLAY_OR_MISMATCH');
      r.state='used';return receipt(id,r);
    },
    async verifyConsumed(id:string,input:PrivateExplicitSolveBinding) {
      const binding=await current(input),r=requireRecord(id);
      if(r.state!=='used'||digest(binding)!==digest(r.binding)) throw new Error('PRIVATE_SIMULATION_APPROVAL_NOT_CONSUMED');
    },
    revoke() {for(const r of records.values()){r.controller.abort();r.state='denied';}},
  });
}
