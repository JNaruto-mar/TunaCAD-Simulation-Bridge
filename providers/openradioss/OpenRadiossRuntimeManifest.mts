import { digest } from '../../simulation-bridge/stableDigest.mts';
/** Required audited closure alone: 432173410 bytes >400 MiB. Keep all 86
 * execution files including five unresolved DLLs: 456153698 bytes. 512 MiB
 * is finite hashing-work headroom, not relaxed integrity or traversal.
 * Source/PE evidence: qualification/SIM9_EXPLICIT_DYNAMICS_DEVELOPMENT_STATUS.md.
 */
export const OPENRADIOSS_RUNTIME_POLICY=Object.freeze({
  version:'openradioss-win64-2026-runtime-manifest/0.1',maximumTotalBytes:512*1024*1024,
  maximumFileBytes:256*1024*1024,maximumFiles:10000,maximumDirectories:1024,maximumDepth:8,hashChunkBytes:1024*1024,
});
export interface RuntimeSpecification {
  path:string;category:string;purpose:string;starter:string;engine:string;configurationOrRuntimeData:boolean;adjacentTooling:boolean;
}
function specification(path:string):Readonly<RuntimeSpecification> {
  let category='UNRESOLVED',starter='unresolved',engine='unresolved',purpose='Configured runtime-search location; exact bounded-deck use unproven; retain conservatively';
  if(path==='exec/starter_win64.exe') {category='STARTER_RUNTIME_REQUIRED';starter='required';engine='not_required';purpose='Selected Starter';}
  else if(path==='exec/engine_win64.exe') {category='ENGINE_RUNTIME_REQUIRED';starter='not_required';engine='required';purpose='Selected Engine';}
  else if(path.endsWith('/hm_reader_win64.dll')) {category='STARTER_RUNTIME_REQUIRED';starter='required';engine='not_required';purpose='Direct Starter PE import: model/configuration reader';}
  else if(path.endsWith('/libiomp5md.dll')) {category='SHARED_RUNTIME_REQUIRED';starter='required';engine='required';purpose='Direct PE import of both executables: OpenMP';}
  else if(/\/mkl_(?:intel_thread|core|def|avx2|avx512)\.2\.dll$/.test(path)) {category='STARTER_RUNTIME_REQUIRED';starter=path.includes('intel_thread')?'required':'conditional_runtime_closure';engine='not_required';purpose='Starter MKL import and Intel documented CPU-dispatch closure; not solver precision/MPI variants';}
  else if(path.startsWith('hm_cfg_files/')) {category='CONFIG_REQUIRED';starter='conditional_configuration_closure';engine='not_required';purpose='RAD_CFG_PATH parser/unit/message closure; not proof every card is read by this deck';}
  return Object.freeze({path,category,purpose,starter,engine,configurationOrRuntimeData:!path.startsWith('exec/'),adjacentTooling:false});
}
// Exact audited release paths. Never supplied by a study; no wildcard trust.
export const OPENRADIOSS_RUNTIME_SPECIFICATIONS:ReadonlyArray<Readonly<RuntimeSpecification>>=Object.freeze(
["exec/engine_win64.exe","exec/starter_win64.exe","extlib/h3d/lib/win64/h3dreader.dll","extlib/h3d/lib/win64/h3dwriter.dll","extlib/hm_reader/win64/hm_reader_win64.dll","extlib/hm_reader/win64/libapr-1.dll","extlib/intelOneAPI_runtime/win64/libiomp5md.dll","extlib/intelOneAPI_runtime/win64/libmmd.dll","extlib/intelOneAPI_runtime/win64/mkl_avx2.2.dll","extlib/intelOneAPI_runtime/win64/mkl_avx512.2.dll","extlib/intelOneAPI_runtime/win64/mkl_core.2.dll","extlib/intelOneAPI_runtime/win64/mkl_def.2.dll","extlib/intelOneAPI_runtime/win64/mkl_intel_thread.2.dll","extlib/intelOneAPI_runtime/win64/svml_dispmd.dll","hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/BasicUnits","hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/CurrentUnits","hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/FEAUnitsPreferences","hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/MDTVCurrentUnits","hm_cfg_files/config/CFG/UNITS/Lexi_Expr.dat","hm_cfg_files/config/CFG/UNITS/Units.dat","hm_cfg_files/config/CFG/UNITS/units.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/ale_grid_lagrange.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/analy.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/anim_spring_forc.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/checksum_end.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/checksum_start.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/def_shell.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/dynain_shell.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/eng_dynain_dt.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/eng_state_dt.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/state_beam.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/state_brick.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/state_node.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/state_shell.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/state_spring.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/state_truss.cfg","hm_cfg_files/config/CFG/radioss2026/CARDS/th_title.cfg","hm_cfg_files/config/CFG/radioss2026/DAMP/Damp_funct.cfg","hm_cfg_files/config/CFG/radioss2026/FAIL/fail_biquad.cfg","hm_cfg_files/config/CFG/radioss2026/FAIL/fail_chang.cfg","hm_cfg_files/config/CFG/radioss2026/FAIL/fail_composite.cfg","hm_cfg_files/config/CFG/radioss2026/FAIL/fail_hashin.cfg","hm_cfg_files/config/CFG/radioss2026/FAIL/fail_lemaitre.cfg","hm_cfg_files/config/CFG/radioss2026/FAIL/fail_tab2.cfg","hm_cfg_files/config/CFG/radioss2026/INTER/inter_guided_cable.cfg","hm_cfg_files/config/CFG/radioss2026/INTER/inter_type18.cfg","hm_cfg_files/config/CFG/radioss2026/INTER/inter_type25.cfg","hm_cfg_files/config/CFG/radioss2026/INTER/inter_type7.cfg","hm_cfg_files/config/CFG/radioss2026/LOADS/bcs_nrf.cfg","hm_cfg_files/config/CFG/radioss2026/LOADS/detpointnode.cfg","hm_cfg_files/config/CFG/radioss2026/LOADS/detpointset.cfg","hm_cfg_files/config/CFG/radioss2026/LOADS/ebcs_cyclic.cfg","hm_cfg_files/config/CFG/radioss2026/LOADS/ebcs_propellant.cfg","hm_cfg_files/config/CFG/radioss2026/LOADS/pblast.cfg","hm_cfg_files/config/CFG/radioss2026/LOADS/preload.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/LAW90.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/Law128_hill_visc_plast.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/Law129_therm_creep.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/mat_EOS.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/mat_law106.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/mat_law88.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl105.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl123_daimler_pinho.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl125_laminated_composite.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl126_johnson_holmquist_concrete.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl127_enhanced_composite.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl130_modified_honeycomb.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl132_daimler_camanho.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl133.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl134_viscous_foam.cfg","hm_cfg_files/config/CFG/radioss2026/MAT/matl44_cowper.cfg","hm_cfg_files/config/CFG/radioss2026/PROP/prop_p11_sh_sandw.cfg","hm_cfg_files/config/CFG/radioss2026/PROP/prop_p34_sph.cfg","hm_cfg_files/config/CFG/radioss2026/RBODY/rbe3.cfg","hm_cfg_files/config/CFG/radioss2026/RWALL/cyl.cfg","hm_cfg_files/config/CFG/radioss2026/RWALL/paral.cfg","hm_cfg_files/config/CFG/radioss2026/RWALL/plane.cfg","hm_cfg_files/config/CFG/radioss2026/RWALL/sphere.cfg","hm_cfg_files/config/CFG/radioss2026/TRANSFORM/autoposition.cfg","hm_cfg_files/config/CFG/radioss2026/TRANSFORM/sca.cfg","hm_cfg_files/config/CFG/radioss2026/TRANSFORM/sym.cfg","hm_cfg_files/config/CFG/radioss2026/TRANSFORM/tra.cfg","hm_cfg_files/config/CFG/radioss2026/data_hierarchy.cfg","hm_cfg_files/messages/CONFIG/msg_arrays.cfg","hm_cfg_files/messages/CONFIG/msg_hw_radioss_reader.txt","hm_cfg_files/messages/CONFIG/msg_table.cfg"]
.map(specification).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0));
export interface RuntimeFile {path:string;bytes:number;sha256:string}
function reject(why:string):never {throw new Error('OpenRadioss manifest: '+why);}
export function validateOpenRadiossRuntimeManifest(input:unknown) {
  if(!Array.isArray(input)||input.length>OPENRADIOSS_RUNTIME_POLICY.maximumFiles) reject('file-count bound');
  const allowed=new Set(OPENRADIOSS_RUNTIME_SPECIFICATIONS.map(s=>s.path)),seen=new Set<string>();let totalBytes=0;
  const files:RuntimeFile[]=input.map(value=>{
    if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='bytes,path,sha256'||typeof value.path!=='string') reject('malformed file');
    const path=value.path.replace(/\\/g,'/');
    if(path.startsWith('/')||path.includes(':')||path.includes('\0')||path.split('/').some((s:string)=>!s||s==='.'||s==='..')||
      path.split('/').length>OPENRADIOSS_RUNTIME_POLICY.maximumDepth) reject('path traversal/depth');
    if(seen.has(path.toLowerCase())) reject('duplicate path');seen.add(path.toLowerCase());
    if(!allowed.has(path)) reject('unexpected file');
    if(!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>OPENRADIOSS_RUNTIME_POLICY.maximumFileBytes) reject('individual file bound');
    if(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)) reject('invalid digest');
    totalBytes+=value.bytes;if(totalBytes>OPENRADIOSS_RUNTIME_POLICY.maximumTotalBytes) reject('aggregate byte bound');
    return {path,bytes:value.bytes,sha256:value.sha256};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(files.length!==allowed.size||files.some(f=>!allowed.delete(f.path))||allowed.size) reject('missing required file');
  return {files,totalBytes,manifestDigest:digest(files)};
}
