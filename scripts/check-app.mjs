import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
function check(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.name==='__pycache__')continue;const path=dir+'/'+entry.name;if(entry.isDirectory())check(path);else if(/\.(mjs|js)$/.test(entry.name))execFileSync(process.execPath,['--check',path],{stdio:'inherit'});}}
for(const dir of ['public','lib','tests','scripts','build'])check(dir);
execFileSync(process.execPath,['--check','server.mjs'],{stdio:'inherit'});
console.log('Sintaxe dos módulos atuais e testes verificada.');
