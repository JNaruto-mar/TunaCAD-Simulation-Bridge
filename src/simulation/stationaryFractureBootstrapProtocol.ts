import * as z from 'zod/v4';
export const fracturePilotPreparation=(jobId:string)=>({jobId,
  providerId:'gmsh-4.15.2+calculix-2.16-stationary-fracture/0.1',expectedResultType:'stationary-mode-i-owned-U-RF-COD/0.1'});
const proof=z.object({challenge:z.string().regex(/^[a-f0-9]{64}$/),proof:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const base={sequence:z.number().int().min(1).max(96),proof};
export const fractureBrowserActionSchema=z.discriminatedUnion('operation',[
  z.object({...base,operation:z.literal('prepare'),crackId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/)}).strict(),
  z.object({...base,operation:z.literal('confirmTransfer'),approvalId:z.string().uuid()}).strict(),
  z.object({...base,operation:z.enum(['reviewTransfer','reviewExecution','run','result','snapshotEvidence','cancel','status'])}).strict(),
]);
