// The reviewed authorization model. infra/openfga/model.fga is the source; model.json is its CLI transformation
// (verified by tests/integration/openfga-model.test.mjs) and is packaged into the authorization service.
import {readFileSync} from 'node:fs';
export function authorizationModel() {
 return JSON.parse(readFileSync(new URL('../infra/openfga/model.json',import.meta.url),'utf8'));
}
