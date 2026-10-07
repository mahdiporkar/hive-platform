// Validates every Compose file with placeholder secrets (no containers are started).
import {execFileSync} from 'node:child_process';

const env={...process.env};
for(const key of ['HIVE_DB_PASSWORD','HIVE_GRAPH_PASSWORD','HIVE_REDIS_PASSWORD','HIVE_INTERNAL_PASSWORD','HIVE_PROVISIONING_PASSWORD','HIVE_VAULT_KEY'])env[key]??='validation-placeholder-validation-placeholder';
for(const [file,profiles] of [['infra/docker-compose/compose.yml',[]],['infra/docker-compose/hive.yml',['--profile','ui']]]){
 execFileSync('docker',['compose','-f',file,...profiles,'config','--quiet'],{env,stdio:'inherit'});
 console.log(`PASS ${file}`);
}
