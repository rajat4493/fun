import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
if (!process.argv.includes("--live")) throw new Error("Explicit --live required: uses paid model and metadata APIs; never writes learning storage.");
const root=process.cwd();
const baseline=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const env={NODE_ENV:"production"};
for(const key of ["OPENAI_API_KEY","OPENAI_MODEL","TMDB_API_KEY","TMDB_READ_ACCESS_TOKEN","OMDB_API_KEY"]) if(process.env[key])env[key]=process.env[key];
const sources=new Map();
function harness(version, network) {
  const after=[];
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
      const target=name.startsWith("@/")?resolve(root,"src",name.slice(2)):resolve(dirname(full),name);
      return load(/\.(json|ts)$/.test(target)?target:target+".ts");
    };
    vm.runInContext("(function(require,module,exports){"+code+"\n})",context,{filename:full})(req,module,module.exports);
    return module.exports;
  }
  return {load,after};
}
const cases=[
["gb-comfort","United Kingdom","A gentle uplifting comedy after a stressful day. No horror or violence.",{avoids:["Horror","Violence"]}],
["ie-family","Ireland","A family-friendly animated movie for an evening with children. Nothing scary.",{avoids:["Horror"]}],
["in-hindi","India","A Hindi comedy. I want to laugh, nothing dark.",{languagePreferences:["Hindi"]}],
["gb-subs","United Kingdom","A warm funny movie available on my Netflix subscription.",{platforms:["Netflix"],platformFilter:"mine"}],
["ie-subs","Ireland","A clever mystery on Netflix, without horror or gore.",{platforms:["Netflix"],platformFilter:"mine",avoids:["Horror","Gore"]}],
["in-language-avoid","India","A funny movie, but not in Hindi.",{}],
["gb-exclusions","United Kingdom","A light warm comedy. Do not suggest Paddington or The Grand Budapest Hotel.",{excludedTitles:["Paddington","The Grand Budapest Hotel"],seenTitles:["Paddington","The Grand Budapest Hotel"]}],
["ie-breakup","Ireland","Going through a breakup. Cheer me up without romance or heartbreak.",{avoids:["Romance"]}],
];
const ignored=new Set(["timings","providerTrace","runId","verifiedAt","availabilitySource","note"]);
function normalize(value){if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([k])=>!ignored.has(k)).map(([k,v])=>[k,normalize(v)]));return value;}
const reports=[];
for(const [id,country,selfText,extra] of cases){
 const records=new Map();let baselineCalls=0,patchedCalls=0,paidCalls=0;const statuses={};const replayMisses=[];
 const live=async(url,options={})=>{
   const host=new URL(url).hostname;
   if(!["api.openai.com","api.themoviedb.org","www.omdbapi.com"].includes(host))throw new Error("Unexpected external host");
   baselineCalls++;if(host==="api.openai.com"){paidCalls++;if(paidCalls>8)throw new Error("Per-case provider-call budget exceeded");}
   const key=String(url)+"|"+(options.body||"");
   try{const response=await fetch(url,options);const body=await response.text();statuses[response.status]=(statuses[response.status]||0)+1;const record={status:response.status,body};const queue=records.get(key)||[];queue.push(record);records.set(key,queue);return new Response(body,{status:response.status});}
   catch{const queue=records.get(key)||[];queue.push({error:true});records.set(key,queue);throw new Error("Recorded provider failure");}
 };
 const indices=new Map();
 const replay=async(url,options={})=>{
   patchedCalls++;const key=String(url)+"|"+(options.body||"");const queue=records.get(key);
   if(!queue){replayMisses.push(new URL(url).hostname);throw new Error("Patched code made an unrecorded request");}
   const index=indices.get(key)||0;indices.set(key,index+1);const record=queue[Math.min(index,queue.length-1)];
   if(record.error)throw new Error("Recorded provider failure");return new Response(record.body,{status:record.status});
 };
 const input={mode:"self",country,selfText,platforms:[],platformFilter:"any",recommendationCount:1,responseDetail:"core",runId:"qa-"+id,...extra};
 const request=()=>new Request("http://qa.invalid/api/recommend",{method:"POST",body:JSON.stringify(input)});
 const started=Date.now();
 try{
 const before=await (await harness("baseline",live).load("src/app/api/recommend/route.ts").POST(request())).json();
 const after=await (await harness("patched",replay).load("src/app/api/recommend/route.ts").POST(request())).json();
 let same=replayMisses.length===0;try{assert.deepStrictEqual(normalize(after),normalize(before));}catch{same=false;}
 const qualityIssues=[];
 if(id==="in-language-avoid" && after.contentMetadata?.originalLanguage==="hi") qualityIssues.push("Confirmed Hindi title despite explicit Hindi exclusion");
 if(id==="ie-family" && !after.contentMetadata?.genreIds?.includes(16)) qualityIssues.push("Animated family-film requirement not verified");
 if(id==="gb-exclusions" && input.excludedTitles.some(t=>t.toLowerCase()===after.title?.toLowerCase())) qualityIssues.push("Excluded title returned");
 const report={id,country,sameQualityOutput:same,qualityIssues,baselineCalls,patchedCalls,paidCalls,providerStatuses:statuses,baselineElapsedMs:Date.now()-started,title:before.title,patchedTitle:after.title,displayState:before._trust?.displayState,fallbackUsed:before._trust?.fallbackUsed,source:before._trust?.diagnostics?.source,genre:before.contentCategory,effect:before.emotionalEffect,language:before.contentMetadata?.originalLanguage,why:before.whyItFits,trustRejections:before._trust?.rejections?.length};
 reports.push(report);console.log(JSON.stringify(report));
 }catch(error){reports.push({id,error:"Comparison execution failed"});console.log(JSON.stringify({id,error:error.message}));}
}
console.log(JSON.stringify({baseline,cases:reports.length,matched:reports.filter(r=>r.sameQualityOutput).length,providerBacked:reports.filter(r=>r.source==="llm").length,note:"Live baseline providers; patched replay of identical responses. No Redis credentials or after callbacks used; no learning writes. Replay time is NOT a speed measurement."}));
if (reports.some(r => !r.sameQualityOutput || r.qualityIssues?.length) || !reports.some(r => r.paidCalls > 0)) process.exitCode=1;
