/* Ekta Transport V8: read-only, deterministic mapping suggestions. No DB writes. */
(function(root){'use strict';
const tidy=x=>String(x??'').trim();
const upper=x=>tidy(x).toUpperCase();
const digits=x=>upper(x).replace(/\D/g,'');
const fullTruck=/\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{3,4})\b/g;
const shorthand=/(?:^|[^A-Z0-9])(\d{3,4})\s*(?:ADV(?:ANCE)?|DIESEL|FUEL|EMI|REPAIR|MAINT|UREA|DEF|UNLOAD(?:ING)?|WORK|TOLL|FASTAG|HISSAB|HISAB|HISAAB|SETTLEMENT)\b/g;
function truckMatches(text,trucks){
 const u=upper(text),hits=new Map();let m;
 fullTruck.lastIndex=0;
 while((m=fullTruck.exec(u))){const key=(m[1]+m[2]+m[3]+m[4]).replace(/[^A-Z0-9]/g,'');
  for(const t of trucks){if(upper(t.truck_number).replace(/[^A-Z0-9]/g,'')===key)hits.set(String(t.id),t);}}
 shorthand.lastIndex=0;
 while((m=shorthand.exec(u))){const code=m[1].replace(/^0+/,'');
  for(const t of trucks){const tail=digits(t.truck_number).replace(/^0+/,'');if(tail.endsWith(code))hits.set(String(t.id),t);}}
 return [...hits.values()];
}
function classify(text,debit,credit){const u=upper(text);const dr=Number(debit)>0,cr=Number(credit)>0;
 if(/(?:RVSL|REVERSAL|REVERSED|REFUND)/.test(u))return {category:'REVERSAL_REVIEW',label:'Reversal / Refund — verify original',level:'REVIEW'};
 if(/(?:EMI|LOAN\s*(?:EMI|PAYMENT)|INSTALLMENT)/.test(u))return {category:'EMI_LOAN',label:'EMI / Loan',level:'SUGGESTED'};
 if(dr&&/(?:\d{3,4}\s*)?ADV(?:ANCE)?\b/.test(u))return {category:'DRIVER_ADVANCE',label:'Driver Advance — driver check',level:'REVIEW'};
 if(dr&&/(?:HISSAB|HISAB|HISAB|HISAAB|SETTLEMENT)/.test(u))return {category:'DRIVER_SETTLEMENT',label:'Driver Hissab / Settlement',level:'SUGGESTED'};
 if(dr&&/(?:DIESEL|FUEL)/.test(u))return {category:'DIESEL',label:'Diesel / Fuel',level:'SUGGESTED'};
 if(dr&&/(?:UREA|URIYA|DEF|ADBLUE)/.test(u))return {category:'UREA_DEF',label:'Urea / DEF',level:'SUGGESTED'};
 if(dr&&/(?:REPAIR|MAINT|PUNCTURE|TYRE|SERVICE|WORK)/.test(u))return {category:'REPAIR_MAINTENANCE',label:'Repair / Maintenance',level:'SUGGESTED'};
 if(dr&&/(?:UNLOAD|UNLOADING|LABOUR)/.test(u))return {category:'UNLOADING',label:'Unloading / Labour',level:'SUGGESTED'};
 if(dr&&/(?:FASTAG|TOLL)/.test(u))return {category:'FASTAG_TOLL',label:'FASTag / Toll',level:'SUGGESTED'};
 if(cr&&/\b(?:VEHICLE\s*SALE|TRUCK\s*SALE|OLD\s*(?:TRUCK|VEHICLE)\s*SALE)\b/.test(u))return {category:'VEHICLE_SALE',label:'Vehicle Sale — buyer verify',level:'REVIEW'};
 if(/\b(?:INFT|INTERNAL\s*(?:TRANSFER|FUND)|OWN\s*ACCOUNT\s*TRANSFER)\b/.test(u))return {category:'BANK_TRANSFER',label:'Internal Bank Transfer — verify both sides',level:'REVIEW'};
 if(dr&&/\b(?:ACH|NACH|ECS)\b/.test(u))return {category:'POSSIBLE_EMI',label:'ACH / NACH — possible EMI',level:'REVIEW'};
 return {category:'SUSPENSE',label:'Needs Review',level:'REVIEW'};
}
function suggest(row,trucks){const manual=tidy(row.user_remark),source=manual?'EMPLOYEE REMARK':'BANK NARRATION';
 const text=manual||tidy(row.narration),c=classify(text,row.debit,row.credit),found=truckMatches(text,trucks||[]);
 const truck=found.length===1?found[0]:null;
 const isVehicleCategory=['DRIVER_ADVANCE','DRIVER_SETTLEMENT','DIESEL','UREA_DEF','REPAIR_MAINTENANCE','UNLOADING','EMI_LOAN','VEHICLE_SALE'].includes(c.category);
 const status=found.length>1?'AMBIGUOUS TRUCK':isVehicleCategory&&!truck?'TRUCK NOT VERIFIED':c.level==='REVIEW'?'NEEDS VERIFICATION':'SUGGESTED — CONFIRM';
 const litres=upper(text).match(/\b(\d+(?:\.\d+)?)\s*(?:LTR|LITRES?|LITERS?)\b/);
 return {...c,source,status,truck_id:truck?.id||null,truck_number:truck?.truck_number||'',candidates:found.length,quantity_litres:litres?Number(litres[1]):null,verified:false};
}
root.EktaSmartMapping={suggest,truckMatches,classify};
if(typeof module!=='undefined'&&module.exports)module.exports=root.EktaSmartMapping;
})(typeof window!=='undefined'?window:globalThis);
