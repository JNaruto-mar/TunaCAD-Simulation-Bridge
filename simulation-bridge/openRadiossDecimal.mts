// Provider-private bounded decimal arithmetic. Report precision and input-field
// conservation are distinct from floating-point accumulation roundoff.
export function boundedRadiossDecimal(token:string){
  if(typeof token!=='string'||token.length>24)throw Error('OpenRadioss decimal: unbounded token');
  const m=token.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[Ee]([+-]?\d+))?$/);
  if(!m)throw Error('OpenRadioss decimal: invalid token');
  const exponent=Number(m[4]??0)-(m[3]?.length??0);
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>350)throw Error('OpenRadioss decimal: exponent bound');
  return {coefficient:BigInt((m[1]==='-'?'-':'')+m[2]+(m[3]??'')),exponent,
    digits:(m[2]+(m[3]??'')).replace(/^0+/,'').length};
}
/** Exact comparison at the existing tolerance, not an enlarged numeric epsilon. */
export function exactRadiossDecimalSumWithin(tokens:readonly string[],target:string,tolerance:number,inclusive=false){
  if(!tokens.length||tokens.length>128||!Number.isFinite(tolerance)||tolerance<0)
    throw Error('OpenRadioss decimal: sum bound');
  const terms=tokens.map(boundedRadiossDecimal),expected=boundedRadiossDecimal(target),bound=boundedRadiossDecimal(String(tolerance));
  const exponent=Math.min(...terms.map(t=>t.exponent),expected.exponent,bound.exponent);
  const units=(v:ReturnType<typeof boundedRadiossDecimal>)=>v.coefficient*10n**BigInt(v.exponent-exponent);
  const residual=terms.reduce((sum,t)=>sum+units(t),0n)-units(expected),absolute=residual<0n?-residual:residual;
  return inclusive?absolute<=units(bound):absolute<units(bound);
}
export function exactRadiossDecimalSum(tokens:readonly string[]){
  if(!tokens.length||tokens.length>128)throw Error('OpenRadioss decimal: sum bound');
  const terms=tokens.map(boundedRadiossDecimal),exponent=Math.min(...terms.map(t=>t.exponent));
  const total=terms.reduce((sum,t)=>sum+t.coefficient*10n**BigInt(t.exponent-exponent),0n);
  const sign=total<0n?'-':'',digits=(total<0n?-total:total).toString();
  if(exponent>=0)return sign+digits+'0'.repeat(exponent);
  const padded=digits.padStart(1-exponent,'0'),point=padded.length+exponent;
  return sign+padded.slice(0,point)+'.'+padded.slice(point);
}
