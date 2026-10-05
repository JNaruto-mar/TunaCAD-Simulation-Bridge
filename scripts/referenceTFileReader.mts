// Historical reference scripts only. Never imported by the production provider.
// The frozen fixture's expected identities/counts are explicit test evidence,
// not fallback choices in the generalized production binary reader.
import { parseBoundedOpenRadiossTFile4 as decode } from '../simulation-bridge/openRadiossBinaryTFileParser.mts';
export function parseBoundedOpenRadiossTFile4(...args:Parameters<typeof decode>) {
  return decode(args[0],args[1],args[2],args[3]??{nodeCount:88,elementCount:208},args[4]??[1,2,3,4,5,6,7,8,45,46]);
}
