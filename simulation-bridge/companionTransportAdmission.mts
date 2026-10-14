import { timingSafeEqual } from 'node:crypto';

/** Loopback Companion upgrade boundary. Production origins remain deliberately
 * denied; this is NOT a switch for public two-layer execution. Empty-token
 * legacy local CAD is unchanged; protected workflows separately require a token. */
export function companionUpgradeAllowed(value:{remoteAddress?:string;host?:string;origin?:string;requestUrl?:string;port:number;token:string}) {
  if(!['127.0.0.1','::1'].includes(value.remoteAddress??'')||!Number.isInteger(value.port)||value.port<1||value.port>65535||!['127.0.0.1:'+value.port,'localhost:'+value.port].includes(value.host??''))return false;
  try{
    const origin=new URL(value.origin??'');
    if(!['http:','https:'].includes(origin.protocol)||!['localhost','127.0.0.1'].includes(origin.hostname)||origin.origin!==value.origin)return false;
    if(!value.requestUrl?.startsWith('/browser'))return false;
    const request=new URL(value.requestUrl,'ws://127.0.0.1:'+value.port);
    if(request.pathname!=='/browser'||request.hash||request.searchParams.getAll('token').length>1)return false;
    const supplied=request.searchParams.get('token')??'';
    if(value.token.length>1024||supplied.length>1024)return false;
    if(!value.token)return true;
    const a=Buffer.from(value.token),b=Buffer.from(supplied);
    return a.length===b.length&&timingSafeEqual(a,b);
  }catch{return false;}
}
