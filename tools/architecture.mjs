import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
export function importedModules(source,path='input.ts') {
 const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),modules=[];
 const visit=node=>{
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))modules.push(node.moduleSpecifier.text);
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))modules.push(node.argument.literal.text);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require'))) {
   const arg=node.arguments[0];modules.push(arg&&ts.isStringLiteral(arg)?arg.text:'<dynamic-import>');
  }
  ts.forEachChild(node,visit);
 };
 visit(tree);return modules;
}
export function forbiddenDependency(name) {
 return /^(react(?:-dom)?|antd|tailwindcss|vue|svelte|angular)(\/|$)/.test(name)||/^@(mui|angular|tailwindcss)\//.test(name)||/(^|\/)(apps|examples|solutions|default-shell)(\/|$)/.test(name);
}
export function files(root) {
 return readdirSync(root,{withFileTypes:true}).flatMap(item=>{
  if(['.git','node_modules','dist','target','.local'].includes(item.name))return [];
  const path=join(root,item.name);return item.isDirectory()?files(path):[path];
 });
}
export function architectureViolations(root) {
 const errors=[];
 for(const path of files(root)) {
  const name=relative(root,path).replaceAll('\\','/');
  const headless=/^packages\/(contracts|core|http-client|auth|authorization|mfe-runtime|workspace)\//.test(name);
  const platform=headless||/^services\/[^/]+\/src\/main\//.test(name);
  if(headless&&/\.[cm]?[jt]sx?$/.test(name)) {
   for(const dependency of importedModules(readFileSync(path,'utf8'),path))if(forbiddenDependency(dependency))errors.push(`${name}: forbidden import ${dependency}`);
  }
  if(headless&&name.endsWith('package.json')) {
   const pkg=JSON.parse(readFileSync(path,'utf8'));
   for(const group of ['dependencies','devDependencies','peerDependencies','optionalDependencies'])for(const dependency of Object.keys(pkg[group]??{}))if(forbiddenDependency(dependency))errors.push(`${name}: forbidden dependency ${dependency}`);
  }
  if(platform) {
   const text=readFileSync(path,'utf8');
   if(/\b(Student|Professor|BankAccount|Loan|InsurancePolicy|Patient|MedicalRecord|ProductOrder|Invoice|Warehouse|Payroll|EmployeeBusinessProcess)\b/i.test(text))errors.push(`${name}: business-domain identifier`);
   if(name.endsWith('.java')&&/import\s+[^;]*(?:\.solution\.|\.consumer\.|\.examples\.)/.test(text))errors.push(`${name}: Java platform depends on consumer/solution`);
  }
 }
 return errors;
}