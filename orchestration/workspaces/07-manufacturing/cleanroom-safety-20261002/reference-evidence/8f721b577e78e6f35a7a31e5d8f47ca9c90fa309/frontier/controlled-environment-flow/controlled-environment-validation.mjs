// Ambiguous identities and policy rows must be resolved by their authority before
// either plan scoring or observed-movement analysis can claim a valid result.
export function identityKey(value){
  if(typeof value==='string')return value.trim()||null;
  if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
  return null;
}

export const transitionKey=(from,to)=>JSON.stringify([from,to]);

export function validateTransitionPolicy(policy){
  if(!Array.isArray(policy.transitions))return {ok:false,reason:'transition_policy_invalid'};
  const index=new Map();
  for(const row of policy.transitions){
    const from=typeof row?.from==='string'?row.from.trim():'';
    const to=typeof row?.to==='string'?row.to.trim():'';
    if(!from||!to||typeof row?.allowed!=='boolean')return {ok:false,reason:'transition_rule_invalid'};
    const key=transitionKey(from,to);
    if(index.has(key))return {ok:false,reason:'duplicate_transition_rule',from,to};
    index.set(key,row);
  }
  return {ok:true,index};
}
