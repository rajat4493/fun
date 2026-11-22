import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
if (!process.argv.includes("--live")) throw new Error("Explicit --live required: uses paid model and metadata APIs; never writes learning storage.");
const root=process.cwd();
const baseline="unused";
const env={NODE_ENV:"production"};
for(const key of ["OPENAI_API_KEY","OPENAI_MODEL","TMDB_API_KEY","TMDB_READ_ACCESS_TOKEN","OMDB_API_KEY"]) if(process.env[key])env[key]=process.env[key];
const sources=new Map();
function harness(version, network) {
  const after=[];
  const diagnostics=[];
  const context=vm.createContext({process:{env},console:{log(){},warn(){},error(){}},Response,Request,URL,AbortSignal,AbortController,TextEncoder,TextDecoder,ReadableStream,setTimeout,clearTimeout,fetch:network});
  const modules=new Map();
  function load(path){
    const full=resolve(root,path);
    if(modules.has(full))return modules.get(full).exports;
    const relative=full.slice(root.length+1);
    const key=version+relative;
    if(!sources.has(key))sources.set(key,version==="baseline"?execFileSync("git",["show",baseline+":"+relative],{encoding:"utf8",maxBuffer:10e6}):fs.readFileSync(full,"utf8"));
    const source=sources.get(key);
    if(full.endsWith(".json"))return JSON.parse(source);
    const module={exports:{}};modules.set(full,module);
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const req=name=>{
      if(name==="next/server")return {NextResponse:Response,after:fn=>after.push(fn)};
      if(name==="@/lib/learning-storage")return {writeLearningRecord:async(key,event)=>diagnostics.push({key,event})};
      const target=name.startsWith("@/")?resolve(root,"src",name.slice(2)):resolve(dirname(full),name);
      return load(/\.(json|ts)$/.test(target)?target:target+".ts");
    };
    vm.runInContext("(function(require,module,exports){"+code+"\n})",context,{filename:full})(req,module,module.exports);
    return module.exports;
  }
  return {load,after,diagnostics};
}

const cases = [
["describe-no-fear",{mode:"self",selfText:"A warm uplifting comedy, nothing frightening",country:"United Kingdom"}],
["pills-no-horror",{mode:"choose",mood:["tired"],wants:["comedy"],avoids:["horror"],country:"United Kingdom"}],
["describe-not-hindi",{mode:"self",selfText:"A funny movie, but not in Hindi",country:"India"}],
["pills-not-hindi",{mode:"choose",wants:["comedy"],avoids:["Hindi"],country:"India"}],
["describe-family-animation",{mode:"self",selfText:"An animated family-friendly movie for children. Nothing scary.",country:"Ireland"}],
["pills-family-animation",{mode:"choose",wants:["animated movie","family-friendly"],avoids:["horror"],country:"Ireland"}],
["positive-horror",{mode:"self",selfText:"Scare me with a genuinely terrifying horror movie",country:"United Kingdom"}],
["positive-hindi",{mode:"choose",wants:["comedy"],languagePreferences:["Hindi"],country:"India"}],
["extended-describe-saved-conflict",{mode:"self",selfText:"A funny movie, not in Hindi",languagePreferences:["Hindi","English"],country:"India"}],
["extended-pills-saved-conflict",{mode:"choose",wants:["comedy"],avoids:["Hindi"],languagePreferences:["Hindi","English"],country:"India"}],
["extended-describe-seen",{mode:"self",selfText:"A warm comedy movie, nothing frightening",seenTitles:["The Intouchables","The Grand Budapest Hotel"],country:"Ireland"}],
["extended-pills-seen",{mode:"choose",wants:["comedy"],avoids:["horror"],seenTitles:["The Intouchables","The Grand Budapest Hotel"],country:"United Kingdom"}],
];
const reports=[];
const priorFamilyPicks = new Map();
if(process.argv.includes("--reroll")) {
 cases.length=0;
 for(const mode of ["self","choose"]) for(const returning of [false,true]) cases.push([
  `${mode}-${returning?"returning":"new"}-family`,
  {mode,...(mode==="self"?{selfText:"An animated family-friendly movie for children. Nothing scary."}:{wants:["animated movie","family-friendly"],avoids:["horror"]}),country:"India",platformFilter:"mine",platforms:["Netflix","JioHotstar","SonyLIV","YouTube","MX Player","Prime Video","Zee5"],seenTitles:returning?["The Secret Life of Pets","My Neighbor Totoro","The Lion King","Zootopia","The Mitchells vs. the Machines","The Croods","The Secret Life of Pets 2","Sing"]:[]}
 ]);
}
for(const [id,fields] of cases){
 if(id.startsWith("extended-") !== process.argv.includes("--extended"))continue;
 let paid=0; const statuses={};
 const live=async(url,options={})=>{
  const host=new URL(url).hostname;
  if(!["api.openai.com","api.themoviedb.org","www.omdbapi.com"].includes(host))throw new Error("External host not allowed");
  if(host==="api.openai.com"&&++paid>8)throw new Error("Provider budget exceeded");
  const response=await fetch(url,options);
  statuses[response.status]=(statuses[response.status]||0)+1;
  return response;
 };
 const h=harness("patched",live);
 const input={platforms:[],platformFilter:"any",recommendationCount:1,responseDetail:"core",runId:"qa-local-"+id,...fields};
 if(process.argv.includes("--reroll") && id.includes("-returning-")) {
  const prior=priorFamilyPicks.get(fields.mode);
  if(prior){input.seenTitles=[...input.seenTitles,prior.title];if(prior.intent?.source==="llm")input.precomputedIntentContract=prior.intent;}
 }
 const started=Date.now();
 const response=await h.load("src/app/api/recommend/route.ts").POST(new Request("http://qa.invalid",{method:"POST",body:JSON.stringify(input)}));
 const rec=await response.json();
 // The writer above is an in-memory sink; callbacks cannot write shared storage.
 for(const callback of h.after)await callback();
 assert.ok([200,422].includes(response.status), `${id}: unexpected HTTP ${response.status}`);
 if(response.status===200){
  const violations=h.load("src/lib/explicit-constraints.ts").explicitConstraintRejections(input,rec);
  assert.deepEqual(Array.from(violations),[],`${id}: explicit requirements violated`);
  assert.ok(rec.title,`${id}: missing title`);
  if(process.argv.includes("--reroll"))priorFamilyPicks.set(fields.mode,{title:rec.title,intent:rec._trust?.intentContract});
 }
 const report={id,status:response.status,elapsedMs:Date.now()-started,paidCalls:paid,providerStatuses:statuses,title:rec.title,format:rec.format,genres:rec.contentMetadata?.genreIds,language:rec.contentMetadata?.originalLanguage,familyRating:rec.contentMetadata?.familyRating,familyVerified:rec.contentMetadata?.familyRatingVerified,source:rec._trust?.diagnostics?.source,intent:rec._trust?.intentContract?.primary,hardAvoids:rec._trust?.intentContract?.hardAvoids,error:rec.error};
 reports.push(report);console.log(JSON.stringify({...report,failureDiagnostics:h.diagnostics.filter(x=>x.event.outcome==="no-match").map(x=>x.event)}));
}
console.log(JSON.stringify({cases:reports.length,matches:reports.filter(r=>r.status===200).length,noMatches:reports.filter(r=>r.status===422).length,note:"Local source with live providers; no Redis credentials; learning writer replaced with an in-memory sink. Fresh synthetic requests, not production traffic."}));
