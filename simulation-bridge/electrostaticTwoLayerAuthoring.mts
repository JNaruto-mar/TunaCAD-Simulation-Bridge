import * as z from 'zod/v4';
import type { LiveTwoLayerInventory } from './electrostaticTwoLayerInventoryContract.mts';

const id = z.string().min(1).max(160);
const electrode = z.object({
  domainId: id, faceId: id, potentialV: z.number().finite().min(-1e6).max(1e6),
  unit: z.literal('V'),
}).strict();
const interfaceFace = z.object({ domainId: id, faceId: id }).strict();

/** Choices only. Geometry, materials, mesh, deck, source digests and
 * conformity are exclusively produced/rechecked by trusted host readers. */
export const twoLayerAuthoringSchema = z.object({
  schema: z.literal('tunacad-electrostatic-two-layer-authoring/0.1'),
  domainIds: z.tuple([id, id]),
  electrodes: z.tuple([electrode, electrode]),
  interfaceFaces: z.tuple([interfaceFace, interfaceFace]),
}).strict();
export type TwoLayerAuthoring = z.infer<typeof twoLayerAuthoringSchema>;

export function verifyTwoLayerAuthoring(value: unknown,
  inventory: LiveTwoLayerInventory) {
  const choice = twoLayerAuthoringSchema.parse(value);
  if (inventory.domains.length !== 2
    || inventory.domains.some((domain, index) =>
      choice.domainIds[index] !== domain.domainId)
    || choice.electrodes[0].domainId !== inventory.domains[0].domainId
    || choice.electrodes[0].faceId !== inventory.domains[0].faces.xMin
    || choice.electrodes[1].domainId !== inventory.domains[1].domainId
    || choice.electrodes[1].faceId !== inventory.domains[1].faces.xMax
    || choice.interfaceFaces[0].domainId !== inventory.domains[0].domainId
    || choice.interfaceFaces[0].faceId !== inventory.domains[0].faces.xMax
    || choice.interfaceFaces[1].domainId !== inventory.domains[1].domainId
    || choice.interfaceFaces[1].faceId !== inventory.domains[1].faces.xMin
    || choice.electrodes[0].potentialV === choice.electrodes[1].potentialV)
    throw new Error('ELECTROSTATIC_TWO_LAYER_AUTHORING_INVALID: stale or unsupported live FACE/domain/voltage selection');
  return choice;
}
