// Structural equivalent of the reviewed relationship model; no tuples or product roots.
const direct = () => ({this:{}});
const computed = relation => ({computedUserset:{relation}});
const union = (...child) => ({union:{child}});
const subjects = [{type:'user'},{type:'group',relation:'member'},{type:'role',relation:'assignee'}];
export function authorizationModel() {
 const model = {schema_version:'1.1', type_definitions:[
  {type:'user'},
  {type:'group',relations:{member:direct()},metadata:{relations:{member:{directly_related_user_types:[{type:'user'}]}}}},
  {type:'role',relations:{assignee:direct()},metadata:{relations:{assignee:{directly_related_user_types:[{type:'user'},{type:'group',relation:'member'}]}}}}
 ]};
 for (const type of ['application','resource','external_resource']) {
  const relations={parent:direct()}, metadata={parent:{directly_related_user_types:(type==='application'?['application']:['application','resource','external_resource']).map(type=>({type}))}};
  for (const name of ['viewer','creator','editor','deleter','sharer','exporter','manager']) {
   relations[name]=name==='manager'?union(direct(),{tupleToUserset:{tupleset:{relation:'parent'},computedUserset:{relation:'manager'}}}):direct();
   metadata[name]={directly_related_user_types:subjects};
  }
  relations.can_view=union(computed('viewer'),computed('editor'),computed('manager'));
  for (const [action,relation] of Object.entries({create:'creator',edit:'editor',delete:'deleter',share:'sharer',export:'exporter'})) relations[`can_${action}`]=union(computed(relation),computed('manager'));
  relations.can_manage=computed('manager');
  model.type_definitions.push({type,relations,metadata:{relations:metadata}});
 }
 return model;
}