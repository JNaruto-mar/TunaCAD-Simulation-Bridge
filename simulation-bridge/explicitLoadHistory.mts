import * as z from 'zod/v4';

const time=z.number().finite().positive().max(.01);
const onsetS=z.number().finite().nonnegative().max(.01).optional();
/** Browser-safe choices, not a caller-supplied function/deck or authority. */
export const explicitLoadHistoryChoicesSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('step'),onsetS}).strict(),
  z.object({kind:z.literal('linear_ramp'),onsetS,riseTimeS:time}).strict(),
  z.object({kind:z.literal('trapezoidal_pulse'),riseTimeS:time,
    onsetS,holdTimeS:z.number().finite().nonnegative().max(.01),fallTimeS:time}).strict(),
]);
export const explicitLoadHistorySchema=z.union([z.literal('constant_after_onset'),explicitLoadHistoryChoicesSchema]);
export type ExplicitLoadHistory=z.infer<typeof explicitLoadHistorySchema>;
export const explicitLoadHistoryOnset=(history:ExplicitLoadHistory)=>history==='constant_after_onset'?0:history.onsetS??0;

/** Peak multipliers in time relative to activation. A native TIME sensor
 * gates/offsets ALL delayed histories; never approximate a step discontinuity. */
export function explicitLoadHistoryPoints(value:unknown,durationS:number):Array<[number,number]> {
  const history=explicitLoadHistorySchema.parse(value);
  if(!Number.isFinite(durationS)||durationS<=0||durationS>.01)throw Error('Invalid load-history duration');
  const onset=explicitLoadHistoryOnset(history);
  if(onset>=durationS)throw Error('Load onset must be before study end');
  const activeDurationS=durationS-onset;
  if(history==='constant_after_onset'||history.kind==='step')return [[0,1],[activeDurationS,1]];
  const points:Array<[number,number]>=[[0,0],[history.riseTimeS,1]];
  let end=history.riseTimeS;
  if(history.kind==='trapezoidal_pulse'){
    if(history.holdTimeS>0){end+=history.holdTimeS;points.push([end,1]);}
    end+=history.fallTimeS;points.push([end,0]);
  }
  // Three positive additions may round a mathematically exact end slightly
  // above duration. Admit only their IEEE-754 addition error, not extra time.
  const additionRoundoff=4*Number.EPSILON*Math.max(end,durationS);
  if((end>activeDurationS&&end-activeDurationS>additionRoundoff)||points.some(([t],i)=>!Number.isFinite(t)||i>0&&t<=points[i-1][0]))
    throw Error('Load onset plus phases must be representable and fit within study duration');
  if(Math.abs(end-activeDurationS)<=additionRoundoff){end=activeDurationS;points[points.length-1][0]=end;}
  if(end<activeDurationS)points.push([activeDurationS,history.kind==='linear_ramp'?1:0]);
  // Adding the onset may not collapse a valid local phase in absolute time.
  if(points.some(([t],i)=>i>0&&onset+t<=onset+points[i-1][0]))throw Error('Collapsed absolute load-history phase timing');
  if(points.some(([t],i)=>i>0&&t<=points[i-1][0]))throw Error('Collapsed load-history phase timing');
  return points;
}

/** No ramp/fall may be skipped by an execution step or recorded cadence. */
export function assertExplicitLoadResolution(history:ExplicitLoadHistory,durationS:number,stepS:number){
  explicitLoadHistoryPoints(history,durationS);
  const onset=explicitLoadHistoryOnset(history);
  if(onset>0&&(!Number.isFinite(stepS)||stepS<=0||onset<=stepS||durationS-onset<=stepS))
    throw Error('Nonzero onset and remaining load window must exceed the admitted timestep and history interval');
  if(history==='constant_after_onset'||history.kind==='step')return;
  const shortest=history.kind==='linear_ramp'?history.riseTimeS:Math.min(history.riseTimeS,history.fallTimeS);
  if(!Number.isFinite(stepS)||stepS<=0||stepS>=shortest)
    throw Error('Load rise/fall must exceed the admitted timestep and history interval');
}

export function explicitLoadHistoryText(history:ExplicitLoadHistory='constant_after_onset'){
  const us=(s:number)=>Number((s*1e6).toPrecision(15));
  const onset=explicitLoadHistoryOnset(history),delay=onset>0?` · onset ${us(onset)} µs (zero before onset)`:'';
  return (history==='constant_after_onset'||history.kind==='step'?(onset>0?'Step (constant after onset)':'Step (constant from start)'):history.kind==='linear_ramp'
    ?`Linear ramp: rise ${us(history.riseTimeS)} µs, then hold`
    :`Pulse: rise ${us(history.riseTimeS)} µs · hold ${us(history.holdTimeS)} µs · fall ${us(history.fallTimeS)} µs, then zero`)+delay;
}
