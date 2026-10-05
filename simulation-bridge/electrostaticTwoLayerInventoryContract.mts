/** Browser-safe inventory shape. Native preparation remains its sole owner. */
export interface LiveTwoLayerDomain {
  domainId:string; partId:string; bodyId:string;
  faces:Record<'xMin'|'xMax'|'yMin'|'yMax'|'zMin'|'zMax',string>;
  /** Authoritative part-to-analysis transform in mm, column-major. */
  worldMatrix:number[];
}
export interface LiveTwoLayerInventory {
  projectRevision:string; domains:LiveTwoLayerDomain[];
}
