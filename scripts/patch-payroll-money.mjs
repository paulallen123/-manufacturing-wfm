import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createPayrollMoney = require('../operations/runtime/payroll-money.cjs');
const marker = 'VECTOR_EXACT_PAY_COMPONENTS_V1';
function replaceOnce(source, before, after, name) {
  if (source.split(before).length !== 2) throw Error('PAYROLL_MONEY_ANCHOR_CHANGED:' + name);
  return source.replace(before, after);
}
export function patchPayrollMoneySources(cost, rules) {
  if (cost.includes(marker) || rules.includes(marker)) throw Error('PAYROLL_MONEY_ALREADY_PATCHED');
  cost = replaceOnce(cost, 'const pence=n=>Math.round((n+Number.EPSILON)*100);',
    'const pence=n=>Math.round((n+Number.EPSILON)*100);\n/* ' + marker + ' */\nconst payrollMoney=(' + createPayrollMoney.toString() + ')();', 'cost-helper');
  cost = replaceOnce(cost, "const mult=policy.stacking==='highest'?Math.max(ot,special):ot+special-1;", "const mult=payrollMoney.stack([ot,special],policy.stacking);", 'legacy-stacking');
  cost = replaceOnce(cost,
    'const base=pence(hours*rate.hourlyRate),gross=pence(hours*rate.hourlyRate*mult),otPremium=Math.min(gross-base,pence(hours*rate.hourlyRate*(ot-1)));',
    'const money=payrollMoney.components({durationMs:to-cursor,rate:rate.hourlyRate,multipliers:[ot,special],stacking:policy.stacking,otMultiplier:ot,oncostPercent:rate.oncostPercent,oncostHourly:rate.oncostHourly||0}),base=money.basePence,gross=money.grossPence,otPremium=money.overtimePremiumPence;', 'legacy-components');
  cost = replaceOnce(cost, 'const other=gross-base-otPremium,oncost=pence((gross/100)*rate.oncostPercent/100+hours*(rate.oncostHourly||0));', 'const other=money.otherPremiumPence,oncost=money.oncostPence;', 'legacy-oncost');
  cost = replaceOnce(cost, 'const api={decorate,bankHoliday', 'const api={payrollMoney,decorate,bankHoliday', 'cost-export');
  rules = replaceOnce(rules, "const C=typeof module!=='undefined'?require('./cost-engine.js'):root.WFMCost;", "const C=typeof module!=='undefined'?require('./cost-engine.js'):root.WFMCost;\n/* " + marker + ' */', 'rules-marker');
  rules = replaceOnce(rules, 'let fixed=0;for(const p of premiumsAt(s,date))', 'let fixed=0;const allowances=[];for(const p of premiumsAt(s,date))', 'allowance-operands');
  rules = replaceOnce(rules, "if(p.mode==='per_hour')fixed+=p.amount;", "if(p.mode==='per_hour'){allowances.push(p.amount);fixed=C.payrollMoney.sum(allowances);}", 'allowance-sum');
  rules = replaceOnce(rules, "const mult=c.stacking==='highest'?Math.max(...multipliers):1+multipliers.reduce((n,m)=>n+m-1,0);", 'const mult=C.payrollMoney.stack(multipliers,c.stacking);', 'contract-stacking');
  rules = replaceOnce(rules, "mult,ot,fixed,reasons.join('|')].join(':');", "mult,ot,fixed,reasons.join('|'),C.payrollMoney.factorKey(multipliers,c.stacking,allowances)].join(':');", 'contract-exact-row-key');
  rules = replaceOnce(rules, 'row={_key:key,shift:sh.id,', 'row={_key:key,_moneyMultipliers:multipliers,_moneyAllowances:allowances,_moneyStacking:c.stacking,shift:sh.id,', 'contract-exact-row-operands');
  rules = replaceOnce(rules,
    'for(const r of rows){const h=r._minutes/60,p=n=>Math.round((n+Number.EPSILON)*100);r.hours=round(h,8);r.basePence=p(h*r.rate);r.grossPence=p(h*(r.rate*r.multiplier+r.fixedHourlyAllowance));r.overtimePremiumPence=Math.min(r.grossPence-r.basePence,p(h*r.rate*(r.otMultiplier-1)));r.otherPremiumPence=r.grossPence-r.basePence-r.overtimePremiumPence;r.oncostPence=p(r.grossPence/100*r.oncostPercent/100+h*r.oncostHourly);r.totalPence=r.grossPence+r.oncostPence;',
    'for(const r of rows){const h=r._minutes/60;r.hours=round(h,8);Object.assign(r,C.payrollMoney.components({durationMs:r._minutes*MIN,rate:r.rate,multipliers:r._moneyMultipliers,stacking:r._moneyStacking,otMultiplier:r.otMultiplier,allowances:r._moneyAllowances,oncostPercent:r.oncostPercent,oncostHourly:r.oncostHourly}));delete r._moneyMultipliers;delete r._moneyAllowances;delete r._moneyStacking;', 'contract-components');
  return { cost, rules };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publicRoot = path.resolve(process.argv[2]);
  const costFile = path.join(publicRoot, 'cost-engine.js'), rulesFile = path.join(publicRoot, 'work-rules.js');
  const result = patchPayrollMoneySources(fs.readFileSync(costFile, 'utf8'), fs.readFileSync(rulesFile, 'utf8'));
  fs.writeFileSync(costFile, result.cost); fs.writeFileSync(rulesFile, result.rules);
  console.log('VECTOR_EXACT_PAY_COMPONENTS=PASS');
}
