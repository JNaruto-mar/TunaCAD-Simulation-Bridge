# Bounded electrostatic owning-host provisioning and cold replay

This is host wiring, not a browser/MCP root-path input or an approval bypass.
Windows protected storage is required. Other hosts remain unsupported.
Electrical physics, result/ledger schemas, field paging and source-identity
policy are unchanged. Capability remains `proof_of_concept` with
`engineeringUsePermitted: false`.

## Explicit storage provisioning

An owning-host administrator chooses an absolute dedicated directory under an
existing host-owned parent. Never use uploads, repository paths or API-supplied
paths as the ledger root. Pass that path through trusted host configuration.
From the public Bridge checkout, an explicit example is:

```powershell
$env:TUNACAD_ELECTROSTATIC_HOST_ROOT = 'C:\TunaCADHost\ElectrostaticStudy'
node --experimental-transform-types --input-type=module -e 'import { ElectrostaticHostStorage } from "./simulation-bridge/electrostaticHostStorage.mts"; const storage = await ElectrostaticHostStorage.provisionNew(process.env.TUNACAD_ELECTROSTATIC_HOST_ROOT); console.log(storage.configurationDigest);'
```

The parent must already exist. Provisioning creates only a new root and the
fixed studies/source-catalog/results/completion-catalog roles. It disables
directory ACL inheritance and grants the current owner, SYSTEM and local
Administrators FullControl. Configuration binds root/role paths, directory
identities, canonical source-identity version, ACL policy and independent pin.
Existing roots fail rather than being repaired or re-permissioned.
Random storage IDs distinguish independent installations; deterministic
provisioning means fixed policy/path behavior, NOT identical IDs across roots.
Reopening the same root must preserve its exact configuration digest.

## Owning-host save and fresh-process replay

Use existing FileElectrostaticHostRecords.publishStudy and the protected ledger
save only from the live-validated completed/cleaned lifecycle. Do not import a
summary receipt as a completion or manufacture records from caller hashes.
The owning CAD document remains separate from result records.

On a new process, open ElectrostaticHostReplay with the configured root,
independently probed current provider runtime, and the owning application's
existing live CAD reader factory:

```typescript
const replay = await ElectrostaticHostReplay.open(
  trustedHostRoot, readCurrentRuntimeIdentity, createLiveSourceReader);
const result = await replay.getResult(jobId);
const manifest = await replay.getFieldManifest(jobId);
const page = await replay.getFieldDataset(jobId, datasetId, cursor, limit);
```

No old lifecycle, completion map, caller JSON, old runtime assertion or cached
STEP is accepted. The live-reader factory must reread the current CAD/model
store and export native geometry to recompute the canonical source identity.
Host pins resolve the sealed request to exactly one study for field recovery.
Fresh source checks bracket result/field replay; field generation retains the
existing separate electrical schema and bounded paging. A failed check returns
no numerical result or throws before a field page is published.

ACL/configuration checks never auto-repair protection. Legacy raw-byte identity
records are stale; no migration/rehash. Missing/inaccessible storage, changed
runtime/source/mesh/deck/result or incomplete/quarantined completion fails closed.
Persistent source/result quarantine remains sticky across reopen. Protected
storage does not defend against compromise of the trusted owner/administrator
and both record/pin locations; digests are integrity checks, not signatures.

The bounded restart fixture explicitly waits for the producer executable to
exit before spawning a fresh replay executable. It reloads an independent CAD
document into actual native CAD/model stores, not a copied in-memory lifecycle.
This does not claim service installation, hosted browser restart or machine
reboot. See the P03 execution evidence before inferring gate status.
