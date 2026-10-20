import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
assert.equal(config.assets.binding,'ASSETS');
assert.equal(config.assets.run_worker_first,true,'Os assets precisam passar pelo Worker que aplica os cabeçalhos.');
assert.equal(config.assets.directory,'../client');
console.log('Build Worker: binding e roteamento de assets protegidos confirmados.');
