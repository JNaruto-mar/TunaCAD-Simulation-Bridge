# OpenRadioss Windows 2026 runtime-fingerprint audit

Date: 2026-10-01. Read-only, no solver processes. This is installation policy
and dependency evidence, not new physical validation or public admission.

## Origin and invariant

The 400 MiB literal originates in the new, still-uncommitted private adapter's
`OpenRadiossInstallation.mts`; no historical commit or documented numerical
justification was found. It bounded enumerated fingerprint bytes alongside
10,000 files and 256 MiB per file. The implementation read each complete file
into memory. Its supported invariant is **finite enumeration/hashing work and
allocation**, not a special cryptographic property of 400 MiB. Accidental scope
expansion and redirects require separate path/traversal checks, not just bytes.

## Source basis and limits

- [Frozen OpenRadioss INSTALL](https://raw.githubusercontent.com/OpenRadioss/OpenRadioss/a62b27e6baa555d222a580d6218867d0be4d70b5/INSTALL.md): selected non-MPI executables, RAD_CFG_PATH and configured runtime DLL roots.
- [Intel MKL runtime dependency documentation](https://www.intel.com/content/www/us/en/docs/onemkl/developer-guide-windows/2023-0/contents-of-the-redist-intel64-directory.html): core, threading and conditional CPU-dispatch libraries. These are not duplicate solver precision/MPI executables.
- [Microsoft PE import specification](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format): installed PE import tables independently confirm Starter -> hm_reader_win64, mkl_intel_thread.2, libiomp5md; Engine -> libiomp5md, plus Windows system prerequisites.

Static imports alone do not enumerate dynamic loading. The MKL closure is
conditional across supported CPUs; not every kernel is claimed loaded in this
fixture. Config files are the shipped parser/unit/message closure, not proof
that every card is used. Frozen Windows compiler-source paths were unavailable;
no build-recipe verification is claimed. Five DLLs have unresolved exact use
and remain pinned conservatively. OS-provided DLLs are host prerequisites,
not redistributed installation artifacts or a claimed full loaded-module trace.

## Decision B: finite 512 MiB, exact audited paths

Original 87 files: 456,155,074 bytes (435.0234 MiB).
Documented dependency/configuration closure excluding unresolved DLLs and notice:
432,173,410 bytes (412.15 MiB), already larger than 400 MiB.
The 86 execution files including all five unresolved DLLs total 456,153,698 bytes.
COPYRIGHT.md (1,376 bytes) is compliance metadata, not solver input; it remains
presence-checked and fully hashed separately. Total hashing remains 456,155,074
bytes. No file was deleted and no required library was removed.

The exact 86-path allowlist has a versioned policy and deterministic
path/size/SHA-256 digest. Maximum total hashing (including notice): 536,870,912
bytes (512 MiB), leaving 80,715,838 bytes / 76.98 MiB headroom. Independent limits:
256 MiB per file, 10,000 entries/files, 1,024 directories, eight relative path
components; rooted approved paths only. Reject missing/duplicate/unexpected
runtime paths, traversal, absolute paths, case ambiguity, symlink/junction/
realpath redirection including ancestors. No recursive installation scan.
Unexpected DLLs in exec/runtime search roots fail closed; selected configuration
roots are exact. Adjacent .lib/.exp files are link-time artifacts, other exe
variants/converters are not invoked, and download Zone.Identifier metadata is
not execution input. None of these adjacent items was in the original 87 set.

Full SHA-256 runs on every inspection, streamed through a 1 MiB buffer, with
file-handle/path/size/change checks and before/after selected-file enumeration.
No size/timestamp cache. New runtime pins include policy version 0.1; old pins
are not silently upgraded. A newly prepared study must explicitly bind the new
identity. Numerical model, decks, process lifecycle and T01 oracle are unchanged.

## Category totals

| Category | Files | Bytes |
| --- | ---: | ---: |
| STARTER_RUNTIME_REQUIRED | 7 | 291003304 |
| ENGINE_RUNTIME_REQUIRED | 1 | 138132480 |
| SHARED_RUNTIME_REQUIRED | 1 | 1614184 |
| CONFIG_REQUIRED | 72 | 1423442 |
| NOT_EXECUTION_REQUIRED | 1 | 1376 |
| UNRESOLVED | 5 | 23980288 |

Largest contributors: Engine 138132480, mkl_core 66158984, mkl_avx512 57260424,
Starter 51955200, mkl_avx2 38077320, mkl_intel_thread 36122504, mkl_def 32881544,
svml_dispmd 18232712, hm_reader 8547328, libmmd 4087176 bytes. No MPI, _sp_, GUI
or converter executable contributes to the original footprint.

## Exact 87-file audit

Category codes: S=STARTER_RUNTIME_REQUIRED, E=ENGINE_RUNTIME_REQUIRED,
B=SHARED_RUNTIME_REQUIRED, C=CONFIG_REQUIRED, N=NOT_EXECUTION_REQUIRED,
U=UNRESOLVED. Requirement codes: R=required; K=conditional shipped runtime/
configuration closure; -=not required; ?=unresolved, retained. Purpose codes:
START=selected Starter, ENGINE=selected Engine, READER=direct Starter input
reader import, OMP=direct shared OpenMP import, MKL=threading/core/CPU-dispatch
closure, CFG=RAD_CFG_PATH parser/unit/message data, KEEP=configured runtime
location with exact consumer unresolved, NOTICE=license/compliance only.
The relative path identifies each specific config/card or library. Runtime-data
column excludes executable programs; NOTICE is compliance, not runtime data.
No entry is merely adjacent tooling; the one notice is labeled separately.

| Relative path | Bytes | Category | Purpose | Starter | Engine | Runtime data | Adjacent tooling | SHA-256 |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| COPYRIGHT.md | 1376 | N | NOTICE | - | - | no | no | 78fbdc6876aff1996c77faa45b6a5fa8135509eb9e3ac5ca5a38a139147004c2 |
| exec/engine_win64.exe | 138132480 | E | ENGINE | - | R | no | no | 53625d1fdc32991b0f51c368c648a5c184fd3bc43875553b4653132445e4b8e8 |
| exec/starter_win64.exe | 51955200 | S | START | R | - | no | no | 961eca1640c321b0cb4893c8481942e5162e89ea292d64e964deea1b5ead96d6 |
| extlib/h3d/lib/win64/h3dreader.dll | 804208 | U | KEEP | ? | ? | yes | no | b3de1e636d2c290a8c2e95f50a6dff7036af03cb8dfae62522f986d994e01836 |
| extlib/h3d/lib/win64/h3dwriter.dll | 672384 | U | KEEP | ? | ? | yes | no | cbe2ef4362095e1d952d17b69c0f6a023c830500595ce00d137365f7f741e483 |
| extlib/hm_reader/win64/hm_reader_win64.dll | 8547328 | S | READER | R | - | yes | no | ee7279ed3f5271217a8420358bbea69043470a08a6a9e641ba574f3b5d304eac |
| extlib/hm_reader/win64/libapr-1.dll | 183808 | U | KEEP | ? | ? | yes | no | a165557741cd95d899a9af74dd2794850772e8ecb882b353e5a0f8e5317f2720 |
| extlib/intelOneAPI_runtime/win64/libiomp5md.dll | 1614184 | B | OMP | R | R | yes | no | eb14cf741b10a6ca176acded284bff7b069e421f49927e28fef9685c6f62abf3 |
| extlib/intelOneAPI_runtime/win64/libmmd.dll | 4087176 | U | KEEP | ? | ? | yes | no | e2b0066f3f4479439d5f008c74482b78ed13203d62c2ecb480cc12b4d78a01fa |
| extlib/intelOneAPI_runtime/win64/mkl_avx2.2.dll | 38077320 | S | MKL | K | - | yes | no | 95a24cf1c3df05ac7a126c09c74a3d077be0743f2036af4a934e1f2a3850d66f |
| extlib/intelOneAPI_runtime/win64/mkl_avx512.2.dll | 57260424 | S | MKL | K | - | yes | no | ec81d74d6d1102147ade9b4f4f1a27fd122d96771b4bd80dccb5fcdde05ff304 |
| extlib/intelOneAPI_runtime/win64/mkl_core.2.dll | 66158984 | S | MKL | K | - | yes | no | 2c1c53445e9ec21a04d479107a03356fb3184422c851376d1d7438164a6f46ef |
| extlib/intelOneAPI_runtime/win64/mkl_def.2.dll | 32881544 | S | MKL | K | - | yes | no | da9cb9af9aaea16fa03539524fd599bef7eea9d4504c99d4995323b05a09004a |
| extlib/intelOneAPI_runtime/win64/mkl_intel_thread.2.dll | 36122504 | S | MKL | R | - | yes | no | 0c8856befc20b72d18e4a712f842c2e528ab77255af27abafa18595d945eabe3 |
| extlib/intelOneAPI_runtime/win64/svml_dispmd.dll | 18232712 | U | KEEP | ? | ? | yes | no | 415dbc87ff6328fa45b69ca25a5861e5e25f50b348df67590abb99839efb9a90 |
| hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/BasicUnits | 164 | C | CFG | K | - | yes | no | 7bed1f4515c03b3827008f0c57d3be04596dbd3ae7a56af957bca1875aca8bc9 |
| hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/CurrentUnits | 2353 | C | CFG | K | - | yes | no | f7cea8a9e6648bb5d90f9a22ccc191e132489088ebd67b9b7459f639e0128403 |
| hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/FEAUnitsPreferences | 3061 | C | CFG | K | - | yes | no | ba91aa14461e5f08ac02520a7194cb0c6901d283115e6bfc9db43ba8293a37af |
| hm_cfg_files/config/CFG/UNITS/FEAUnitsPreferences/MDTVCurrentUnits | 2387 | C | CFG | K | - | yes | no | c7ddd38b1869200301c5fcfafb3bf69b29d47e4b22e6ead0aba0a9ccd4125e30 |
| hm_cfg_files/config/CFG/UNITS/Lexi_Expr.dat | 1660 | C | CFG | K | - | yes | no | 633db5eecbf7a24ec61743cd1ff3c6a792d8118f754036b8cb111bf3aa7bfdcc |
| hm_cfg_files/config/CFG/UNITS/Units.dat | 71168 | C | CFG | K | - | yes | no | c568c4bb9605874e05f764031d13718112ab91258154ee84aaca06ae2c210b1f |
| hm_cfg_files/config/CFG/UNITS/units.cfg | 19877 | C | CFG | K | - | yes | no | a1865d802ed30e0784bd3379735b1ee78c3a0046b8f449c4d2793a58e458535b |
| hm_cfg_files/config/CFG/radioss2026/CARDS/ale_grid_lagrange.cfg | 1466 | C | CFG | K | - | yes | no | 7bdb1e00f703c347eb0359bbc4ced94d63d05b8a62f6f834978855516d9704a8 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/analy.cfg | 3209 | C | CFG | K | - | yes | no | 548f2a81b978a4c73df2d8a1e1d4251e3ab38135e9e80368e26f604c7c5c9d02 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/anim_spring_forc.cfg | 1462 | C | CFG | K | - | yes | no | 8bd2385ca0f971bf07d07e002159e121e7185ab3f8bbf40c5f0eec48855f2b46 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/checksum_end.cfg | 1548 | C | CFG | K | - | yes | no | 86befda4a3bfb65976f707ac25067ca00edd9eac71321107eaa4657bf4108619 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/checksum_start.cfg | 1893 | C | CFG | K | - | yes | no | 86a08922b9230f075588e03e838d0a711784cd5aa161b4affb129c9fb47512c2 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/def_shell.cfg | 5830 | C | CFG | K | - | yes | no | 8f38657e44194fc5ffde276a1874ff4930a8f45690c21e22c5ceee8d021ac7d3 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/dynain_shell.cfg | 2937 | C | CFG | K | - | yes | no | 4c361c10d698a8b6468a8c411c2946d7963aa8676f1193d230970c2f81ae2840 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/eng_dynain_dt.cfg | 3510 | C | CFG | K | - | yes | no | 963307f977ff3109e4c1f9848ac1f19563d73bae7b35dbc9add821ed4ef5c123 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/eng_state_dt.cfg | 3504 | C | CFG | K | - | yes | no | 1fe4618d77f09f2e83af879963e669fa2275c428f8de694bd7db163000acaf48 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/state_beam.cfg | 2518 | C | CFG | K | - | yes | no | f6e1dad0faa221a3d8a4b965a1a686b21cb1a0fc9c8b2d545e2689e0e79cdc4b |
| hm_cfg_files/config/CFG/radioss2026/CARDS/state_brick.cfg | 3242 | C | CFG | K | - | yes | no | acc58071d22e337b5ee4b24c466a00d84297a40438be539c58454e996376c9e0 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/state_node.cfg | 2208 | C | CFG | K | - | yes | no | 4cd587cb3c91c2110e21e8275eebc9484de7d2c48713eeadd716fa64cd91b411 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/state_shell.cfg | 2921 | C | CFG | K | - | yes | no | b1d1eabd1c5f825de3a726a11e7e4c0e4745c7a3fcd216d3a32c734b6acd5be5 |
| hm_cfg_files/config/CFG/radioss2026/CARDS/state_spring.cfg | 2215 | C | CFG | K | - | yes | no | 4fc64acc1093c6a06471955979e7e21326adb0bd24a60c058ed9a533bf0ee38b |
| hm_cfg_files/config/CFG/radioss2026/CARDS/state_truss.cfg | 2211 | C | CFG | K | - | yes | no | 7dbefe8c6df5f745e79878796670929d575cefabc73ca6133c402abe4b99823c |
| hm_cfg_files/config/CFG/radioss2026/CARDS/th_title.cfg | 1422 | C | CFG | K | - | yes | no | 6c14b04f81c389fd52c0dffc851f8d4e41a5b4bbe582228f9dbd683f18ffede4 |
| hm_cfg_files/config/CFG/radioss2026/DAMP/Damp_funct.cfg | 3934 | C | CFG | K | - | yes | no | 9d9837b4901bc96ba9791addb76e65682487dacd9086df9b9cd97446a8c89b50 |
| hm_cfg_files/config/CFG/radioss2026/FAIL/fail_biquad.cfg | 9816 | C | CFG | K | - | yes | no | 9992919292f828f199179b3fbec6579179f5701b99da47d2cfe113a94cbdad32 |
| hm_cfg_files/config/CFG/radioss2026/FAIL/fail_chang.cfg | 5218 | C | CFG | K | - | yes | no | a6a11ce4ed8fa3ef072f0942eeef5804825ff2dfd826fc36656d0f7bdef63aac |
| hm_cfg_files/config/CFG/radioss2026/FAIL/fail_composite.cfg | 4464 | C | CFG | K | - | yes | no | c7e47a442780f34bf5f1c1fc787b30ce7e8da6552c1478cffc75b91a810a9e01 |
| hm_cfg_files/config/CFG/radioss2026/FAIL/fail_hashin.cfg | 13397 | C | CFG | K | - | yes | no | ad318905f5bf66b16f23bfea6c6f9e76d9f38f9bc111a3ba0637d8b77e277821 |
| hm_cfg_files/config/CFG/radioss2026/FAIL/fail_lemaitre.cfg | 2366 | C | CFG | K | - | yes | no | 38f523ec53341f1cac23bdd23c1a66d125783c76d52bddaa842838776302993a |
| hm_cfg_files/config/CFG/radioss2026/FAIL/fail_tab2.cfg | 11116 | C | CFG | K | - | yes | no | 377994ba71730bcc3981e852d705021dc361a446d9d0105535b3f4134b151624 |
| hm_cfg_files/config/CFG/radioss2026/INTER/inter_guided_cable.cfg | 2966 | C | CFG | K | - | yes | no | 624c1d82ccd045904fc42dca7b36d4dd68c8b04e97f424244726015c4e84231f |
| hm_cfg_files/config/CFG/radioss2026/INTER/inter_type18.cfg | 15197 | C | CFG | K | - | yes | no | f91be3b9b59b0054f332902c483dfc13bee02c1befc0ddf705b41f410e01355d |
| hm_cfg_files/config/CFG/radioss2026/INTER/inter_type25.cfg | 36726 | C | CFG | K | - | yes | no | dae800fdd8803af80eb9a4e7114b0b6a737887593534994d4477ea62fb2e6e58 |
| hm_cfg_files/config/CFG/radioss2026/INTER/inter_type7.cfg | 46288 | C | CFG | K | - | yes | no | 7fd768b455e47741d2748d25a8318c20516d222dde6bfe7a936c87e986ab1748 |
| hm_cfg_files/config/CFG/radioss2026/LOADS/bcs_nrf.cfg | 2782 | C | CFG | K | - | yes | no | 71668289d6cfe14eed147eef7bc569dfa96e6addfa2e7b886fbc8b8981391af6 |
| hm_cfg_files/config/CFG/radioss2026/LOADS/detpointnode.cfg | 3035 | C | CFG | K | - | yes | no | e34329f166f3fc3d88c7e0b8ef5acb377abf2b92b97fe7914e141c7ec806a1a7 |
| hm_cfg_files/config/CFG/radioss2026/LOADS/detpointset.cfg | 3060 | C | CFG | K | - | yes | no | 97c5cc9a5a0ea923ece46d9dd75b675b7f1e7f17f6154b7643e5b5a557866a56 |
| hm_cfg_files/config/CFG/radioss2026/LOADS/ebcs_cyclic.cfg | 4030 | C | CFG | K | - | yes | no | 12d6cfde0139e3dbcec3bf874946df2d5378428cb755dfaff3adb1ef997f28c2 |
| hm_cfg_files/config/CFG/radioss2026/LOADS/ebcs_propellant.cfg | 6280 | C | CFG | K | - | yes | no | 8be497f069831408b472db08d814675c90de34aadb63c2468add0df919e9dc13 |
| hm_cfg_files/config/CFG/radioss2026/LOADS/pblast.cfg | 9642 | C | CFG | K | - | yes | no | a52fbfc3833d60d077599fc8511d48f30bdb6ebeb3ec3954a905e374fff37e5a |
| hm_cfg_files/config/CFG/radioss2026/LOADS/preload.cfg | 4402 | C | CFG | K | - | yes | no | 99bb5aa3739071c608faab8fa1d5666570cade7801d8ea94c9a4d3563e175f5c |
| hm_cfg_files/config/CFG/radioss2026/MAT/LAW90.cfg | 11836 | C | CFG | K | - | yes | no | 3683851d1e202778ffd6842cef5646709c6cfefa1ad08e57ed9abfa593154a4d |
| hm_cfg_files/config/CFG/radioss2026/MAT/Law128_hill_visc_plast.cfg | 11025 | C | CFG | K | - | yes | no | c9df88fd5f6683227c93587e2ee43b55d5a513ab81a62999a002432a469da9a9 |
| hm_cfg_files/config/CFG/radioss2026/MAT/Law129_therm_creep.cfg | 18238 | C | CFG | K | - | yes | no | 970733e90bba0faf2574ff6273fd4b1defabba395e9f5151020cfcfe46bf952f |
| hm_cfg_files/config/CFG/radioss2026/MAT/mat_EOS.cfg | 90874 | C | CFG | K | - | yes | no | 5b073df45411e8760ef597f7ec700cc6a4c08990fc0fd738d435717b8ac03696 |
| hm_cfg_files/config/CFG/radioss2026/MAT/mat_law106.cfg | 13744 | C | CFG | K | - | yes | no | d19ca5b86cda7b7b8d68a89177cfaad9f25adacbc9d2d70656b1e916510811b7 |
| hm_cfg_files/config/CFG/radioss2026/MAT/mat_law88.cfg | 13472 | C | CFG | K | - | yes | no | 6d1afece85124eec2b36e15ae54f6b9c66ac47ff7b255483bb2ed4fce843e3ea |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl105.cfg | 7297 | C | CFG | K | - | yes | no | 5b72089d421aab56a4ca95135ca2361365f3e2264bf5cad2abef402bef63ae7e |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl123_daimler_pinho.cfg | 11955 | C | CFG | K | - | yes | no | d202b8879953d73b69d038219b304752ab055e0e1e8c2ba7d184ad8f4e4389ca |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl125_laminated_composite.cfg | 26882 | C | CFG | K | - | yes | no | 8841b01208557969a15b56bae089f171ac7e44576c1cdd13ef971383e59e1d81 |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl126_johnson_holmquist_concrete.cfg | 14021 | C | CFG | K | - | yes | no | 4a4cc357b6396938f44b54aefc1584ce3982f8916fa988fd686a0553ba0478a6 |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl127_enhanced_composite.cfg | 14542 | C | CFG | K | - | yes | no | e91267511fbbf73e4068b7e436f10b4702475c139a479f1a9acbddc5ffeca779 |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl130_modified_honeycomb.cfg | 16417 | C | CFG | K | - | yes | no | 5a9fc7f7a9e3539afb1928341112feeaee4bd7cabda68e3d3235ad295a61bba8 |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl132_daimler_camanho.cfg | 17622 | C | CFG | K | - | yes | no | 55aff38cd0158382fc220a9895a92d0c9824b60cd8f19fe558d2cdbfa4936758 |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl133.cfg | 4464 | C | CFG | K | - | yes | no | 89c91fdef2b3746b26ed39fcdde44cf34f010e963bcd41c581dc1788a08499a4 |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl134_viscous_foam.cfg | 5814 | C | CFG | K | - | yes | no | 7f62f2cf8689537a171b535aafa28622c2fb705c3e92eb9ed9b4027c546c9e99 |
| hm_cfg_files/config/CFG/radioss2026/MAT/matl44_cowper.cfg | 18037 | C | CFG | K | - | yes | no | 6c8cfb8f14a3ddb7f2095b0acdde7f71f87b29ba4593ff5fcad2ce7c58995be7 |
| hm_cfg_files/config/CFG/radioss2026/PROP/prop_p11_sh_sandw.cfg | 27486 | C | CFG | K | - | yes | no | 95f5b9a5c24d6eef8492d45a384ab3a3b80f0a08ef2878d3a61ae97cf657a362 |
| hm_cfg_files/config/CFG/radioss2026/PROP/prop_p34_sph.cfg | 8089 | C | CFG | K | - | yes | no | d02f817e80f29898bb1be9a4123227fb10573e45ef59607c12aae933c8839803 |
| hm_cfg_files/config/CFG/radioss2026/RBODY/rbe3.cfg | 9392 | C | CFG | K | - | yes | no | 9c12d46f3b07f1adddb8ed79189cdaacf4d7950fce7e3db68dc8a1866767ded5 |
| hm_cfg_files/config/CFG/radioss2026/RWALL/cyl.cfg | 12069 | C | CFG | K | - | yes | no | b8f82d3a996d4d4d987bc7f572273c6b1f4a0934b0c9c47e899e2c15ae5177d9 |
| hm_cfg_files/config/CFG/radioss2026/RWALL/paral.cfg | 13195 | C | CFG | K | - | yes | no | 35b670797cb52ed326c1ddf59250c0e0d27204a7dbeba9bc83ada1548bf28bbf |
| hm_cfg_files/config/CFG/radioss2026/RWALL/plane.cfg | 12647 | C | CFG | K | - | yes | no | 2db0b6a2909d1e034cbf823c629e3a8bcfb90b0b6875c8bcd81760a1747e1e60 |
| hm_cfg_files/config/CFG/radioss2026/RWALL/sphere.cfg | 11581 | C | CFG | K | - | yes | no | ec6bf61d797a042e4eded21221ad2e20bab54586e57340dc3cde19fac3fb5e6e |
| hm_cfg_files/config/CFG/radioss2026/TRANSFORM/autoposition.cfg | 3709 | C | CFG | K | - | yes | no | 7d37a8f21d10d9397648887bffd8672533145fe37ac7d1d7d3df72abc5fe3281 |
| hm_cfg_files/config/CFG/radioss2026/TRANSFORM/sca.cfg | 3620 | C | CFG | K | - | yes | no | 5bf033cea8f9c8dac72ea7ad2b4318689c8017130b09b24a3c65c27c841fd390 |
| hm_cfg_files/config/CFG/radioss2026/TRANSFORM/sym.cfg | 5172 | C | CFG | K | - | yes | no | 24f0952d9d257332b1ddc101d9f448700c3fa7b8150ffddbab7c060d8a1e211d |
| hm_cfg_files/config/CFG/radioss2026/TRANSFORM/tra.cfg | 4380 | C | CFG | K | - | yes | no | d06fcedebc8d86d64b3ce896d8c0a6958d210d5598eed291f441b3fc8b3ca176 |
| hm_cfg_files/config/CFG/radioss2026/data_hierarchy.cfg | 208942 | C | CFG | K | - | yes | no | 452f52e8b382ef496d808e5154eb7bfa2ace6c02f3b44b07e751ed9c4c4e0337 |
| hm_cfg_files/messages/CONFIG/msg_arrays.cfg | 99767 | C | CFG | K | - | yes | no | 8a33e71aa3766e82e032e23db27bd805dc12a46c03d214848ff4df0e169662ec |
| hm_cfg_files/messages/CONFIG/msg_hw_radioss_reader.txt | 9746 | C | CFG | K | - | yes | no | 90efd1a366c7a0ce0b1d8bb7b09d4f0b5643dbb3aa7744d80fc1f16b902fb7a2 |
| hm_cfg_files/messages/CONFIG/msg_table.cfg | 369922 | C | CFG | K | - | yes | no | bf69362d9b2643cfc11fbdc9a97a242eb0b6132062f0659a9d0fbe70ea207b89 |

## Authenticated no-solver result

Runtime manifest: sha256:64019bec8c2f46a8431c8976db6c3664f162376f59ef1c2edca7f229a8e1208b

Policy-bound runtime identity: sha256:65d76caa5f3c9d83f2092d51505d92f14abe5ca4a10a540876d11e595afd7b36

Retained runtime-audit.json SHA-256:
91302abe1c356bb401adf4d63ca704d9bdd12319251cfb242eb5675914d480ce.
Retained runtime-preflight.json SHA-256:
612d2d4194e300c9e04a50da82f6a10f6e44077056d870c58fba947f770279d7.
These are isolated generated audit receipts, not committed runtime binaries.

Focused runtime-policy tests: PASS, 21 checks. Includes exact/below/above
aggregate metadata limits without large allocations, file count, single size,
unexpected/missing/duplicate/traversal/malformed SHA, stable order/digest,
changed content, fake installation, executable pin, real filesystem missing/
unexpected DLL/config and junction rejection. A same-size/time altered DLL
changes the full runtime digest. Actual installation fingerprint preflight:
PASS, 86 runtime files + separate notice, 456155074 bytes fully hashed,
zero studies created and zero processes executed. Syntax checks and root/Bridge
diff checks cover only changed files. Isolated strict runtime-policy typing PASS
after replacing the new stream buffer's incompatible Buffer type with a 1 MiB
Uint8Array. Final preflight after that correction and before/after file-stamp
guards PASS with identical manifest/runtime digests. No old physical/lifecycle
suite rerun.

Real Bridge execution and native cancellation remain PENDING; public/provider/
browser/MCP admission remains closed. proof_of_concept,
engineeringUsePermitted:false. Historical 400 MiB rejection remains evidence.
Next: one separately approved real Bridge-level execution; none authorized here.
