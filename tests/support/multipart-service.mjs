// Starts the test-only Spring Boot downstream service (tests/fixtures/multipart-service): an ordinary consumer
// application with @RequestPart MultipartFile, @RequestParam form, JSON and raw-body endpoints that report what Spring
// parsed. Built on demand with the repository's Maven wrapper; never part of the platform build.
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {ready} from './stack.mjs';

const DIR=resolve('tests/fixtures/multipart-service');
const JAR=resolve(DIR,'target/multipart-service.jar');

export function buildMultipartService(){
 const wrapper=process.platform==='win32'?'mvnw.cmd':'./mvnw';
 execFileSync(resolve(wrapper),['-q','-B','-f',resolve(DIR,'pom.xml'),'package','-DskipTests'],{stdio:'inherit',shell:process.platform==='win32',timeout:600000});
 return JAR;
}

export async function startMultipartService(t,{port,suite}){
 buildMultipartService();
 const logDir=`.local/${suite}`;mkdirSync(logDir,{recursive:true});
 const fd=openSync(`${logDir}/multipart-service.log`,'w');
 // Generous multipart limits downstream: Hive's maxRequestBytes is what the tests exercise.
 const child=spawn('java',['-jar',JAR,`--server.port=${port}`,'--server.address=127.0.0.1','--spring.servlet.multipart.max-file-size=20MB','--spring.servlet.multipart.max-request-size=40MB'],
  {windowsHide:true,stdio:['ignore',fd,fd]});
 t.after(async()=>{child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(r,5000).unref();});closeSync(fd);});
 const origin=`http://127.0.0.1:${port}`;
 await ready(origin+'/health',{attempts:200,log:`${logDir}/multipart-service.log`});
 return {origin};
}
