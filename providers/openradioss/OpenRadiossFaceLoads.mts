/** Fixed-decimal piconewton lattice fits the existing 20-column positive
 * force field up to the contract's 1e6 N cap. Integer residual allocation
 * conserves the SERIALIZED resultant, not just unrounded JS weights. */
export function serializeExplicitFaceLoads(ids:readonly number[],weights:ReadonlyMap<number,number>,areaMm2:number,forceN:number){
 const fail=():never=>{throw Error('OpenRadioss admission: invalid serialized FACE load');};
 if(!ids.length||new Set(ids).size!==ids.length||!Number.isFinite(areaMm2)||areaMm2<=0||!Number.isFinite(forceN)||forceN<=0||forceN>1e6)fail();
 const units=(v:number)=>{if(!Number.isFinite(v)||v<=0||v>1e6)fail();return BigInt(v.toFixed(12).replace('.',''));};
 const text=(n:bigint)=>{const s=n.toString().padStart(13,'0');return s.slice(0,-12)+'.'+s.slice(-12);};
 const total=units(forceN);if(Math.abs(Number(text(total))-forceN)>=1e-12)fail();
 let used=0n;
 const loads=ids.map((id,i)=>{const weight=weights.get(id);if(!Number.isSafeInteger(id)||id<=0||!Number.isFinite(weight)||weight!<=0)fail();
  const n=i===ids.length-1?total-used:units(forceN*weight!/areaMm2);if(n<=0n)fail();used+=n;
  const forceText=text(n);if(forceText.length>20)fail();return {id,forceN:Number(forceText),forceText};
 });
 if(used!==total)fail();return loads;
}
