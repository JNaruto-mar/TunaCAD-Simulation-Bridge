/** Browser-safe output cadence shared by authoring and native admission.
 * Output controls never change the solver integration step or execution budget. */
export const EXPLICIT_HISTORY_MAXIMUM_FRAMES=64;
export const EXPLICIT_HISTORY_DEFAULT_INTERVALS=50;
export const EXPLICIT_HISTORY_MAXIMUM_INTERVALS=EXPLICIT_HISTORY_MAXIMUM_FRAMES-1;
export function explicitHistorySampling(durationS:number,outputTimesS:readonly number[]) {
  if(!Number.isFinite(durationS)||durationS<=0||outputTimesS.length<2||outputTimesS.length>16
    ||outputTimesS.at(-1)!==durationS||outputTimesS.some((t,i)=>!Number.isFinite(t)||t<=0||t>durationS
      ||i>0&&t<=outputTimesS[i-1]))throw Error('Ordered output times ending at duration required.');
  const times=[0,...outputTimesS];
  const intervalS=Math.min(...times.slice(1).map((t,i)=>t-times[i]));
  const ratio=durationS/intervalS,nearest=Math.round(ratio);
  // Machine-precision division/subtraction must not turn N intervals into N+1.
  // Not a relaxation of mesh, physics, or resource admission tolerances.
  const intervals=Math.abs(ratio-nearest)<=8*Number.EPSILON*Math.max(1,ratio)?nearest:Math.ceil(ratio);
  const maximumFrames=intervals+1; // initial sample plus scheduled intervals
  if(!Number.isSafeInteger(maximumFrames)||maximumFrames>EXPLICIT_HISTORY_MAXIMUM_FRAMES)
    throw Error('History sampling exceeds the 64-frame resource limit.');
  return {intervalS,maximumFrames};
}
