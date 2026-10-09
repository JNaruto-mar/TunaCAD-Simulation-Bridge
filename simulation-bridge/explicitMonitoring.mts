import * as z from 'zod/v4';
export const EXPLICIT_MAXIMUM_MONITORING_FACES=8;
const id=z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/);
export const explicitMonitoringReferencesSchema=z.array(id).min(1).max(EXPLICIT_MAXIMUM_MONITORING_FACES)
  .refine(ids=>new Set(ids).size===ids.length,'Monitoring FACEs must be distinct.');
export const explicitMonitoringMappingsSchema=z.array(z.object({referenceId:id,
  nodeIds:z.array(z.number().int().min(1).max(999999999)).min(3).max(128)
    .refine(ids=>ids.every((n,i)=>!i||n>ids[i-1]),'Ordered unique monitoring nodes required.')}).strict())
  .min(1).max(EXPLICIT_MAXIMUM_MONITORING_FACES).refine(f=>new Set(f.map(v=>v.referenceId)).size===f.length);
