import assert from 'node:assert/strict';
import { isExplicitWorkspaceOrigin } from '../simulation-bridge/explicitWorkspaceOrigin.mts';
for(const origin of ['https://tunacad.com','http://127.0.0.1:8080','http://localhost:8080'])assert.equal(isExplicitWorkspaceOrigin(origin),true);
for(const origin of ['null','https://evil.invalid','https://www.tunacad.com','http://tunacad.com','https://tunacad.com/','https://tunacad.com.evil.invalid','http://127.0.0.1:0','http://localhost:99999'])assert.equal(isExplicitWorkspaceOrigin(origin),false);
console.log('PASS: only the exact production origin and canonical development loopback origins are admitted; authentication remains separate.');
