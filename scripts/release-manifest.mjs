import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PUBLIC_FILES} from '../lib/public-files.mjs';
const root=new URL('../',import.meta.url),sha=path=>createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex');
const manifest={repository:'https://github.com/ZAKOVISCK/Minhas_Finan-as',version:JSON.parse(readFileSync(new URL('package.json',root))).version,baseCommit:'0c22b907b2f89c79ceb81d9e414a9cea4b4697f2',previousSiteCommit:'715dbbac986b7c74ddc33a0aed5e959028eb6bdb',legacyCompatibilityPatch:'f5271cc2f85cfd87d514a545b22570b9fa3023eb',publicFilesSha256:Object.fromEntries(Object.keys(PUBLIC_FILES).map(file=>[file,sha(file==='index.html'?'lib/shell.html':'public/'+file)]))};
writeFileSync(new URL('UPSTREAM.json',root),JSON.stringify(manifest,null,2)+'\n');
