(function(){
"use strict";
const $=id=>document.getElementById(id);
let S=window.supabaseClient;
const state={reviewSelections:{},file:null,rows:[],trucks:[],drivers:[],assignments:[],parties:[],vendors:[],trips:[],accountTransactions:[],accountLoadError:null,busy:false,tab:"dashboard"};
const clean=v=>String(v??"").trim();
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const num=v=>{const n=Number(String(v??"").replace(/[₹,\s]/g,""));return Number.isFinite(n)?n:0};
const money=v=>"₹"+num(v).toLocaleString("en-IN",{maximumFractionDigits:2});
const norm=v=>clean(v).toUpperCase().replace(/[^A-Z0-9]/g,"");
// Bank statements commonly use DD-MM-YYYY; Postgres DATE requires ISO YYYY-MM-DD.
function statementDateISO(value){
 const v=clean(value);
 let y,m,d;
 let a=v.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/);
 if(a){d=Number(a[1]);m=Number(a[2]);y=Number(a[3]);}
 else {a=v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);if(!a)return null;y=Number(a[1]);m=Number(a[2]);d=Number(a[3]);}
 const check=new Date(Date.UTC(y,m-1,d));
 if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)return null;
 return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}


async function loadMasters(){
 if(!S?.from){state.accountLoadError="Supabase client not available";renderDashboard();return;}
 const qs=await Promise.allSettled([
  S.from("trucks").select("id,truck_number,status"),
  S.from("drivers").select("*"),
  S.from("truck_driver_assignments").select("*"),
  S.from("parties").select("*"),
  S.from("maintenance_vendors").select("id,name,vendor_code"),
  S.from("trips").select("*").order("created_at",{ascending:false}),
  S.from("account_transactions").select("id,transaction_date,bank_narration,reference_number,debit,credit,user_remark,category,posting_status,party_id,truck_id,driver_id,trip_id,quantity_litres").order("transaction_date",{ascending:false}).limit(1000)
 ]);
 state.trucks=qs[0].status==="fulfilled"?(qs[0].value.data||[]):[];
 state.drivers=qs[1].status==="fulfilled"?(qs[1].value.data||[]):[];
 state.assignments=qs[2].status==="fulfilled"?(qs[2].value.data||[]):[];
 state.parties=qs[3].status==="fulfilled"?(qs[3].value.data||[]):[];
 state.vendors=qs[4].status==="fulfilled"&&!qs[4].value.error?(qs[4].value.data||[]):[];
 state.trips=qs[5].status==="fulfilled"?(qs[5].value.data||[]):[];
 const a=qs[6];state.accountLoadError=a.status==="rejected"?String(a.reason?.message||a.reason):a.value?.error?.message||null;
 state.accountTransactions=state.accountLoadError?[]:(a.value?.data||[]);
 renderDashboard();
 if(state.tab!=="dashboard"&&state.tab!=="bank")renderGeneric();
}
const ledgerDefinitions=[
 ["driver","Driver Advance / Hissab",["DRIVER_ADVANCE","DRIVER_SETTLEMENT"]],
 ["diesel","Diesel",["DIESEL"]],
 ["urea","Urea / DEF",["UREA_DEF"]],
 ["unloading","Unloading",["UNLOADING"]],
 ["work","Truck Work",["WORK"]],
 ["vehicleemi","Vehicle Loan EMI",["VEHICLE_LOAN_EMI"]],
 ["homeemi","Home Loan EMI",["HOME_LOAN_EMI"]],
 ["emi","EMI / Loan (Old / Unclassified)",["EMI_LOAN"]],
 ["sale","Vehicle Sale",["VEHICLE_SALE"]],
 ["transfer","Bank Transfers",["BANK_TRANSFER"]],
 ["fastag","FASTag / Toll",["FASTAG_TOLL"]],
 ["repair","Repair & Maintenance",["REPAIR_MAINTENANCE","VENDOR_PAYMENT"]],
 ["vendor","Vendor Payments",["VENDOR_PAYMENT"]],
 ["office","Office Expense",["OFFICE_EXPENSE"]],
 ["party","Billing Party Receipts",["PARTY_BALANCE","PARTY_ADVANCE"]],
 ["partyadvance","Transporter Advance Received",["PARTY_ADVANCE"]],
 ["partybalance","Transporter Balance Received",["PARTY_BALANCE"]],
 ["suspense","Suspense",["SUSPENSE"]],
 ["bank","All Bank Entries",[]]
];
function partyKind(p){
 const raw=clean(p?.party_type||p?.type||p?.category||p?.party_category||p?.customer_type).toLowerCase().replace(/[^a-z]/g,'');
 if(['transporter','transporters'].includes(raw))return 'TRANSPORTER';
 if(['billingparty','billing','billingparties','billingclient','billingclients'].includes(raw))return 'BILLING';
 return null;
}
function receiptTypeForRow(r){return partyKind(state.parties.find(p=>String(p.id)===String(r.party_id)));}
function ledgerRows(tab){
 const definition=ledgerDefinitions.find(x=>x[0]===tab);
 if(!definition)return [];
 return state.accountTransactions.filter(r=>{if(tab==="bank")return true;if(tab==="suspense")return r.posting_status==="SUSPENSE";if(r.posting_status==="SUSPENSE"||(definition[2].length&&!definition[2].includes(r.category)))return false;if(tab==="party")return receiptTypeForRow(r)==="BILLING";if(tab==="partyadvance"||tab==="partybalance")return receiptTypeForRow(r)==="TRANSPORTER";return true;});
}
function renderLedgerCards(){
 const host=$("acLedgerCards");if(!host)return;
 host.innerHTML=ledgerDefinitions.map(([tab,label])=>{
  const rows=ledgerRows(tab),total=rows.reduce((sum,r)=>sum+num(r.debit)+num(r.credit),0);
  return `<button type="button" class="btn" style="text-align:left;min-height:68px" onclick="EktaAccounts.showTab('${tab}')"><b>${esc(label)}</b><div style="margin-top:5px;color:#64748b;font-size:10px">${state.accountLoadError?"Data unavailable":`${rows.length} entries • ${money(total)}`}</div></button>`;
 }).join("");
 // Two existing standalone ledgers: same card styling, no fabricated bank totals.
 host.insertAdjacentHTML("beforeend", [
  `<button type="button" class="btn" style="text-align:left;min-height:68px" onclick="EktaCash.open()"><b>Cash Book</b><div style="margin-top:5px;color:#64748b;font-size:10px">Open Cash Ledger →</div></button>`,
  `<button type="button" class="btn" style="text-align:left;min-height:68px" onclick="EktaVickyPaper.open()"><b>Vicky Paper</b><div style="margin-top:5px;color:#64748b;font-size:10px">Open Paper Ledger →</div></button>`
 ].join(""));
 const status=$("acDataStatus");if(status)status.textContent=state.accountLoadError?"Accounts load failed: "+state.accountLoadError:`${state.accountTransactions.length} saved transactions loaded`;
}
function activeDriver(truckId){
 const a=state.assignments.filter(x=>String(x.truck_id)===String(truckId)&&clean(x.status||"Active").toLowerCase()==="active")
 .sort((a,b)=>new Date(b.assigned_from||b.created_at||0)-new Date(a.assigned_from||a.created_at||0))[0];
 return a?state.drivers.find(d=>String(d.id)===String(a.driver_id))||null:null;
}
function matchTruck(raw,narr){
 const c=norm(raw); if(c){const t=state.trucks.find(x=>norm(x.truck_number)===c);if(t)return t}
 return null; // Never match truck by substring of bank narration.
}
function matchParty(name,narr){
 const h=(clean(name)+" "+clean(narr)).toLowerCase();
 return state.parties.find(p=>[p.name,p.party_name,p.party_code,p.code].filter(Boolean).some(v=>h.includes(String(v).toLowerCase())))||null;
}

function candidateCodes(v){
 const s=clean(v).toUpperCase();
 const out=[];
 // Ekta shorthand is commonly embedded immediately before a known business keyword.
 const rx=/(\d{3,4})\s*(?=ADV(?:ANCE)?|WORK|DIESEL|FUEL|UNLOAD(?:ING)?|UREA|URIYA|DEF|BAL(?:ANCE)?|FASTAG|TOLL|REPAIR|MAINT)/g;
 let m; while((m=rx.exec(s)))out.push(m[1]);
 // Also accept a standalone 3/4 digit code written by the user in Remark.
 const standalone=s.match(/(?:^|\s)(\d{3,4})(?=\s|$)/g)||[];
 standalone.forEach(x=>out.push(x.trim()));
 return [...new Set(out)];
}
function truckByShort(code){
 code=clean(code).replace(/^0+/,"");
 if(!code)return null;
 const matches=state.trucks.filter(t=>{const ds=clean(t.truck_number).replace(/\D/g,"").replace(/^0+/,"");return ds && ds.endsWith(code);});
 return matches.length===1?matches[0]:null;
}
function partyMatchesByCode(code){
 code=clean(code).replace(/^0+/,"");
 return state.parties.filter(p=>clean(p.party_code||p.code).replace(/^0+/,"")===code);
}
function partyByCode(code){
 code=clean(code).replace(/^0+/,"");
 if(!code)return null;
 return state.parties.find(p=>clean(p.party_code||p.code).replace(/^0+/,"")===code)||null;
}
function currentDriverForTruck(truckId){
 const a=state.assignments.filter(x=>String(x.truck_id)===String(truckId)&&clean(x.status).toLowerCase()==="active")
  .sort((a,b)=>new Date(b.assigned_from||b.created_at||0)-new Date(a.assigned_from||a.created_at||0))[0];
 return a?state.drivers.find(d=>String(d.id)===String(a.driver_id))||null:null;
}
function tripForTruck(truckId,date){
 const target=date?new Date(date):null;
 const candidates=state.trips.filter(t=>String(t.truck_id)===String(truckId));
 if(!candidates.length)return null;
 return candidates.sort((a,b)=>{
   const da=Math.abs(new Date(a.loading_date||a.program_date||a.created_at||0)-(target||new Date()));
   const db=Math.abs(new Date(b.loading_date||b.program_date||b.created_at||0)-(target||new Date()));
   return da-db;
 })[0]||null;
}
function verifiedPartyFromText(text){
 const codes=candidateCodes(text);
 for(const c of codes){const p=partyByCode(c);if(p)return {party:p,code:c}}
 return null;
}
function verifiedTruckFromText(text){
 const codes=candidateCodes(text);
 for(const c of codes){const t=truckByShort(c);if(t)return {truck:t,code:c}}
 return null;
}
function decodeRemark(remark,row){
 const raw=clean(remark), narration=clean(row?.narration);
 const combined=raw; // Only manually entered remark can drive ledger mapping.
 const u=combined.toUpperCase();
 if(!raw && !narration)return {category:"SUSPENSE",label:"Needs Remark",link:"—",confidence:0,verified:false};
 const isCredit=num(row?.credit)>0, isDebit=num(row?.debit)>0;

 // CREDIT party rules: only after exact Party Master code verification.
 const pm=null; // Party codes may overlap truck codes: require separate verified selection.
 if(isCredit && pm){
   const party=pm.party, name=party.name||party.party_name||"Party";
   if(/\b(BAL|BALANCE)\b/.test(u))
     return {category:"PARTY_BALANCE",label:"Party Balance Receipt",party_id:party.id,link:`${party.party_code||pm.code} • ${name}`,confidence:60,verified:false};
   if(/\bADV(?:ANCE)?\b/.test(u))
     return {category:"PARTY_ADVANCE",label:"Party Advance Received",party_id:party.id,link:`${party.party_code||pm.code} • ${name}`,confidence:60,verified:false};
 }

 // DEBIT truck rules: only after real Truck Master match.
 const tm=verifiedTruckFromText(combined);
 if(tm){
   const truck=tm.truck, dr=null, trip=null; // No guessed nearest trip or current driver.
   const base={truck_id:truck.id,driver_id:null,trip_id:null,verified:false};
   const linked=`${truck.truck_number}${dr?` • ${dr.driver_name||dr.name||"Driver"}`:""}`;
   if(isDebit && /\bADV(?:ANCE)?\b/.test(u)){
     if(!dr)return {...base,driver_id:null,category:"SUSPENSE",label:"Truck Found • Driver Missing",link:truck.truck_number,confidence:55,verified:false};
     return {...base,category:"DRIVER_ADVANCE",label:"Driver Advance",link:linked,confidence:60,verified:false};
   }
   if(isDebit && /DIESEL|FUEL/.test(u)){
     const lm=u.match(/(\d+(?:\.\d+)?)\s*(?:LTR|LITRE|LITER|L)\b/);
     return {...base,category:"DIESEL",label:"Diesel / Fuel",quantity_litres:lm?num(lm[1]):null,link:linked,confidence:60,verified:false};
   }
   if(isDebit && /URIYA|UREA|DEF|ADBLUE/.test(u))
     return {...base,category:"UREA_DEF",label:"Urea / DEF",link:linked,confidence:60,verified:false};
   if(isDebit && /UNLOAD/.test(u))
     return {...base,category:"UNLOADING",label:"Unloading Charge",link:trip?`${linked} • Trip linked`:linked,confidence:55,verified:false};
   if(isDebit && /REPAIR|MAINT|TYRE|PUNCTURE|SERVICE/.test(u))
     return {...base,category:"REPAIR_MAINTENANCE",label:"Repair & Maintenance",link:linked,confidence:60,verified:false};
   if(isDebit && /\bWORK\b/.test(u))
     return {...base,category:"WORK",label:"Truck Work",link:linked,confidence:60,verified:false};
 }

 // Global categories do not require truck/party mapping, but still require explicit keyword.
 if(isDebit && /OFFICE\s*EXP|OFFICE\s*EXPENSE/.test(u))
   return {category:"OFFICE_EXPENSE",label:"Office Expense",link:"Ekta Transport",confidence:60,verified:false};
 if(isDebit && /(?:HOME|HOUSING|HOUSE)\s*(?:LOAN|EMI)|(?:LOAN|EMI)\s*(?:HOME|HOUSING|HOUSE)/.test(u))
   return {category:"HOME_LOAN_EMI",label:"Home Loan EMI",link:"Home Loan",confidence:60,verified:false};
 if(isDebit && /(?:VEHICLE|TRUCK|CAR)\s*(?:LOAN|EMI)|(?:LOAN|EMI)\s*(?:VEHICLE|TRUCK|CAR)/.test(u))
   return {category:"VEHICLE_LOAN_EMI",label:"Vehicle Loan EMI — verify truck",link:"Vehicle Loan",confidence:55,verified:false};
 if(isDebit && /\bEMI\b|LOAN/.test(u))
   return {category:"EMI_LOAN",label:"EMI Type Not Confirmed — choose Vehicle or Home",link:"Unclassified EMI",confidence:30,verified:false};
 if(isDebit && /FAST\s*TAG|FASTAG|TOLL/.test(u))
   return {category:"FASTAG_TOLL",label:"FASTag / Toll",link:tm?.truck?.truck_number||"FASTag",confidence:60,verified:false};
 if(isDebit && /BANK\s*CHARGE|CHARGES|SMS\s*CHG|IMPS\s*CHG/.test(u))
   return {category:"BANK_CHARGE",label:"Bank Charge",link:"Bank",confidence:60,verified:false};

 // AI text alone is NEVER enough for Party/Driver/Truck posting.
 const looksMapped=/ADV(?:ANCE)?|BAL(?:ANCE)?|DIESEL|FUEL|UNLOAD|UREA|URIYA|DEF|WORK|REPAIR|MAINT/.test(u);
 return {
   category:"SUSPENSE",
   label:looksMapped?"Needs Master Match":"Needs Review",
   link:"—",
   confidence:20,
   verified:false
 };
}

function normalizeRow(r){
 const narration=clean(r.narration||r.remarks||r.description||r.particulars);
 const truck=null, driver=null; // Never infer historical driver from current assignment or narration.
 const party=null; // No substring party mapping for imported statements.
 let suggestion=clean(r.suggestion||r.ai_suggestion||r.ai_type||r.type||"");
 if(!suggestion&&party)suggestion=party.name||party.party_name||"PARTY";
 if(!suggestion&&truck&&/\badv(?:ance)?\b/i.test(narration))suggestion="DRIVER ADVANCE";
 if(!suggestion)suggestion="SUSPENSE";
 const confidence=Math.max(0,Math.min(100,Math.round(num(r.confidence)||20)));
 return {date:clean(r.date),narration,debit:num(r.debit),credit:num(r.credit),reference:clean(r.reference||r.utr||r.ref),
 suggestion:"",ai_remark:clean(r.ai_remark||r.aiRemark||""),truck:"",driver:"",
 confidence,status:"PENDING",party:party?.name||party?.party_name||"",party_id:party?.id||null,truck_id:truck?.id||null,driver_id:driver?.id||null,trip_id:null,quantity_litres:null,db_id:null};
}
function parseAI(text){
 let s=clean(text).replace(/^```(?:json)?/i,"").replace(/```$/i,"").trim(),a=s.indexOf("{"),b=s.lastIndexOf("}");
 if(a>=0&&b>a)s=s.slice(a,b+1); const o=JSON.parse(s), rows=Array.isArray(o)?o:(o.transactions||o.rows||[]);
 return rows.map(normalizeRow);
}
const fileData=file=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)});
const fileText=file=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result||""));r.onerror=rej;r.readAsText(file)});
function csv(text){
 const lines=text.split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)return[];
 const split=l=>{let a=[],c="",q=false;for(let i=0;i<l.length;i++){let x=l[i];if(x==='"'){if(q&&l[i+1]==='"'){c+='"';i++}else q=!q}else if(x===','&&!q){a.push(c);c=""}else c+=x}a.push(c);return a.map(x=>x.trim())};
 const h=split(lines[0]).map(x=>x.toLowerCase()), idx=(...n)=>h.findIndex(x=>n.some(y=>x.includes(y)));
 let di=idx("date"),ni=idx("narration","remarks","particular","description"),dei=idx("debit","withdraw"),ci=idx("credit","deposit"),ri=idx("utr","reference","ref");
 return lines.slice(1).map(l=>{let c=split(l);return normalizeRow({date:c[di],narration:c[ni],debit:c[dei],credit:c[ci],reference:c[ri]})});
}
async function excel(file){
 if(!window.XLSX)await new Promise((ok,no)=>{let s=document.createElement("script");s.src="xlsx.full.min.js";s.onload=ok;s.onerror=no;document.head.appendChild(s)});
 let wb=XLSX.read(await file.arrayBuffer(),{type:"array"}),data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});
 return data.map(o=>{let get=(...k)=>{let x=Object.keys(o).find(a=>k.some(b=>a.toLowerCase().includes(b)));return x?o[x]:""};return normalizeRow({date:get("date"),narration:get("narration","remarks","particular"),debit:get("debit","withdraw"),credit:get("credit","deposit"),reference:get("utr","reference","ref")})});
}
async function ai(file){
 if(!S?.functions?.invoke)throw new Error("Supabase AI connection is not available.");
 if(!(file.type?.startsWith("image/")||file.type==="application/pdf"))
   throw new Error("AI statement reading supports image or PDF. CSV/Excel are read locally.");

 const dataUrl=await fileData(file);
 const fileBase64=String(dataUrl||"").split(",").pop()||"";
 if(!fileBase64)throw new Error("Could not read the selected statement file.");

 const knownParties=state.parties.slice(0,250).map(p=>({
   code:clean(p.party_code||p.code),
   name:clean(p.name||p.party_name)
 })).filter(p=>p.code||p.name);

 const knownTrucks=state.trucks.slice(0,500).map(t=>clean(t.truck_number)).filter(Boolean);

 const {data,error}=await S.functions.invoke("gemini-chat",{
   body:{
     mode:"bank_statement",
     fileBase64,
     mimeType:file.type||"image/jpeg",
     knownParties,
     knownTrucks
   }
 });

 if(error){
   console.error("[ACCOUNTS BANK AI invoke]",error);
   throw new Error(error.message||"Bank statement AI request failed.");
 }
 if(!data?.success)throw new Error(data?.error||"AI could not read this bank statement.");

 const rows=Array.isArray(data.transactions)?data.transactions:[];
 return rows.map(r=>{
   const aiText=clean(r.aiRemark||r.ai_remark||r.suggestion||"");
   const truckText=clean(r.detectedTruck||r.detected_truck||"");
   const partyText=clean(r.detectedParty||r.detected_party||"");
   const suggestion=(truckText||partyText) && aiText && !/\d{3,4}/.test(aiText)
     ? `${truckText||partyText} ${aiText}`.trim()
     : aiText;
   return normalizeRow({
   ...r,
   suggestion,
   ai_remark:r.aiRemark||r.ai_remark||"",
   detected_party:r.detectedParty||r.detected_party||"",
   detected_truck:r.detectedTruck||r.detected_truck||"",
   detected_driver:r.detectedDriver||r.detected_driver||"",
   confidence:r.confidence??(r.needsReview?35:85)
   });
 });
}

function driverForTransaction(truckId,date){
 if(!truckId)return {driver:null,certainty:'NO TRUCK'};
 const iso=statementDateISO(date);if(!iso)return {driver:null,certainty:'INVALID DATE'};
 const candidates=state.assignments.filter(a=>String(a.truck_id)===String(truckId));
 const dateField=a=>a.assigned_from||a.start_date||a.assignment_date||null;
 const endField=a=>a.unassigned_at||a.assigned_to||a.end_date||null;
 const dated=candidates.filter(a=>{const start=dateField(a),end=endField(a);return start&&String(start).slice(0,10)<=iso&&(!end||String(end).slice(0,10)>=iso)});
 const unique=[...new Set(dated.map(a=>String(a.driver_id)))];
 if(unique.length===1){const driver=state.drivers.find(d=>String(d.id)===unique[0]);if(driver)return {driver,certainty:'DATE ASSIGNMENT — CHECK'};}
 const current=activeDriver(truckId);
 return {driver:current,certainty:current?'CURRENT DRIVER — VERIFY FOR DATE':'DRIVER NOT FOUND'};
}
function partyInstruction(r){
 // Only explicit employee remarks; never infer a party from bank narration digits.
 const remark=clean(r.user_remark).toUpperCase();
 const m=remark.match(/(?:^|\s)(\d{2,6})\s*(ADV(?:ANCE)?|BAL(?:ANCE)?)(?=\s|$)/);
 if(!m)return null;
 return {code:m[1],category:m[2].startsWith('ADV')?'PARTY_ADVANCE':'PARTY_BALANCE',matches:partyMatchesByCode(m[1])};
}
function getSuggestion(i){
 const r=state.rows[i],d=window.EktaSmartMapping.suggest(r,state.trucks);
 const selection=state.reviewSelections[i]||{};
 const truck=selection.truck_id?state.trucks.find(t=>String(t.id)===String(selection.truck_id)):state.trucks.find(t=>String(t.id)===String(d.truck_id));
 const assignment=driverForTransaction(truck?.id,r.date);
 const driver=selection.driverText!==undefined?(selection.driver_id?state.drivers.find(x=>String(x.id)===String(selection.driver_id)):null):(selection.driver_id?state.drivers.find(x=>String(x.id)===String(selection.driver_id)):assignment.driver);
 const instruction=partyInstruction(r);
 let category=selection.category||instruction?.category||d.category;
 const selectedParty=selection.party_id?state.parties.find(p=>String(p.id)===String(selection.party_id)):instruction?.matches.length===1?instruction.matches[0]:null;
 if(selectedParty&&partyKind(selectedParty)==='BILLING'&&['PARTY_ADVANCE','PARTY_BALANCE'].includes(category))category='PARTY_BALANCE';
 const party=selection.party_id?state.parties.find(p=>String(p.id)===String(selection.party_id)):instruction?.matches.length===1?instruction.matches[0]:null;
 return {r,d,truck,driver,assignment,category,party,instruction};
}
const driverCats=new Set(['DRIVER_ADVANCE','DRIVER_SETTLEMENT']);
const truckCats=new Set(['DRIVER_ADVANCE','DRIVER_SETTLEMENT','DIESEL','UREA_DEF','REPAIR_MAINTENANCE','UNLOADING','EMI_LOAN','VEHICLE_LOAN_EMI','VEHICLE_SALE','FASTAG_TOLL']);
const categories=[['SUSPENSE','Needs Review / Suspense'],['DRIVER_ADVANCE','Driver Advance'],['DRIVER_SETTLEMENT','Driver Hissab / Settlement'],['DIESEL','Diesel'],['UREA_DEF','Urea / DEF'],['REPAIR_MAINTENANCE','Truck Work / Repair'],['UNLOADING','Unloading'],['VEHICLE_LOAN_EMI','Vehicle Loan EMI'],['HOME_LOAN_EMI','Home Loan EMI'],['EMI_LOAN','EMI / Loan (Old / Unclassified)'],['FASTAG_TOLL','FASTag / Toll'],['VEHICLE_SALE','Vehicle Sale'],['BANK_TRANSFER','Internal Bank Transfer'],['REVERSAL_REVIEW','Reversal — Review'],['DRIVER_ADVANCE_REVERSAL','Driver Advance Reversal'],['OFFICE_EXPENSE','Office Expense'],['PARTY_BALANCE','Party Balance Received'],['PARTY_ADVANCE','Party Advance Received'],['SALARY','Staff Salary'],['STAFF_ADVANCE','Staff Advance'],['VEHICLE_PAPER','Vehicle Paper'],['SALES','Sales Ledger'],['OTHER_EXPENSE','Other Expense'],['VENDOR_PAYMENT','Vendor Payment / Repair']];
function renderRows(){
 const b=$('acRows');if(!b)return;
 if(!state.rows.length){b.innerHTML='<tr><td colspan="7">No statement read yet.</td></tr>';return;}
 b.innerHTML=state.rows.map((r,i)=>{
  const {d,category}=getSuggestion(i),saved=r.status==='CONFIRMED'||r.status==='SUSPENSE';
  const title=categories.find(x=>x[0]===category)?.[1]||category;
  const summary=`${esc(title)}<div style="font-size:10px;color:#64748b">${esc(d.label)}</div>`;
  const action=saved?'<b>Saved</b>':`<button class="btn primary" style="white-space:nowrap;padding:9px 11px" onclick="EktaAccounts.confirmRow(${i})">Confirm & Save</button>`;
  return `<tr class="ekta-compact-row"><td>${esc(r.date||'—')}</td><td class="ekta-narration" title="${esc(r.narration||'')}">${esc(r.narration||'—')}</td><td class="money">${r.debit?money(r.debit):'—'}</td><td class="money">${r.credit?money(r.credit):'—'}</td><td>${esc(r.reference||'—')}</td><td class="ekta-mapping-cell">${saved?summary:renderInlineForm(i)}</td><td class="ekta-save-cell">${action}</td></tr>`;
 }).join('');
}
function renderInlineForm(i){
 const {r,category,truck,driver,party,instruction,assignment}=getSuggestion(i),sel=state.reviewSelections[i]||{};
 const inputStyle='box-sizing:border-box;padding:7px 8px;border:1px solid #cbd5e1;border-radius:7px;min-width:0;width:100%;background:white;font-size:12px;font-weight:400;color:#334155';
 const disabled=r.status!=='PENDING'?'disabled':'';
 const options=categories.filter(([v])=>r.credit?(!['DRIVER_ADVANCE','DRIVER_SETTLEMENT','DIESEL','UREA_DEF','REPAIR_MAINTENANCE','UNLOADING','VEHICLE_LOAN_EMI','HOME_LOAN_EMI','VENDOR_PAYMENT'].includes(v)):true).map(([v,n])=>`<option value="${v}" ${category===v?'selected':''}>${esc(n)}</option>`).join('');
 const field=(label,html)=>`<label class="ekta-inline-field"><span>${label}</span>${html}</label>`;
 const chooseTruck=()=>field('Truck number (type to filter)',`<input ${disabled} data-ekta-suggest="truck" data-ekta-row="${i}" value="${esc(sel.truckText??truck?.truck_number??'')}" placeholder="e.g. 4567" style="${inputStyle}" onchange="EktaAccounts.setTruckText(${i},this.value)">`);
 const chooseDriver=()=>field('Assigned driver (type / select)',`<input ${disabled} data-ekta-suggest="driver" data-ekta-row="${i}" style="${inputStyle};font-weight:400;font-size:13px" placeholder="Type driver name" value="${esc(sel.driverText??(driver?(driver.driver_name||driver.name||driver.full_name||''):''))}" onchange="EktaAccounts.setDriverText(${i},this.value)">`);
 const vendor=state.vendors.find(v=>String(v.id)===String(sel.vendor_id));
 const vendorField=()=>field('Vendor code / name',`<input ${disabled} data-ekta-suggest="vendor" data-ekta-row="${i}" value="${esc(sel.vendorText??vendor?.vendor_code??'')}" placeholder="V0001" style="${inputStyle}" onchange="EktaAccounts.setVendorCode(${i},this.value)"><small>${esc(vendor?.name||'Choose Vendor Code from list')}</small>`);
 const partyField=()=>field('Party code (type to search)',`<input ${disabled} value="${esc(sel.partyCode??instruction?.code??'')}" placeholder="e.g. 420" style="${inputStyle}" oninput="EktaAccounts.setPartyCode(${i},this.value)" onblur="EktaAccounts.refreshReview()">`)+field('Party / branch',`<select ${disabled} style="${inputStyle}" onchange="EktaAccounts.setChoice(${i},'party_id',this.value)"><option value="">Choose exact party / branch</option>${state.parties.filter(p=>!clean(sel.partyCode??instruction?.code)||clean(p.party_code||p.code)===clean(sel.partyCode??instruction?.code)).map(p=>`<option value="${esc(p.id)}" ${String(party?.id)===String(p.id)?'selected':''}>${esc((p.party_code||p.code||'')+' '+(p.name||p.party_name||'')+' '+(p.location||p.city||''))}</option>`).join('')}</select>`);
 let extra='';
 if(category==='DRIVER_ADVANCE_REVERSAL')extra=field('Original Advance Reference',`<input ${disabled} style="${inputStyle}" value="${esc(sel.originalRef||'')}" placeholder="e.g. S2663163" onchange="EktaAccounts.setOriginalRef(${i},this.value)"><small>Original saved Driver Advance reference required</small>`);
 else if(category==='VENDOR_PAYMENT')extra=vendorField()+chooseTruck();
 else if(['PARTY_ADVANCE','PARTY_BALANCE'].includes(category))extra=partyField();
 else if(driverCats.has(category))extra=chooseTruck()+chooseDriver();
 else if(truckCats.has(category))extra=chooseTruck();
 if(category==='DIESEL')extra+=field('Diesel Litres (L)',`<input ${disabled} type="number" min="0.01" step="0.01" value="${esc(sel.litres??'')}" placeholder="e.g. 42" style="${inputStyle}" onchange="EktaAccounts.setLitres(${i},this.value)">`);
 const remarks=field('Remark (optional)',`<input ${disabled} style="${inputStyle}" value="${esc(r.user_remark||'')}" placeholder="Notes / reference" onchange="EktaAccounts.setRemark(${i},this.value)">`);
 return `<div class="ekta-inline-fields">${field('Category (type / select)',`<input ${disabled} data-ekta-suggest="category" data-ekta-row="${i}" value="${esc(categories.find(([v])=>v===category)?.[1]||'')}" placeholder="Urea, EMI, ADV..." style="${inputStyle};font-weight:400;font-size:13px;color:#334155" onfocus="this.select()" onchange="EktaAccounts.searchCategory(${i},this.value)">`)}${extra}${remarks}</div>`;
}
function toggleReview(i){state.expandedReview=state.expandedReview===i?null:i;renderRows()}
function refreshReview(){renderRows()}
function searchCategory(i,text){
 const q=clean(text).toLowerCase();if(!q)return;
 const aliases={urea:'UREA_DEF',def:'UREA_DEF',diesel:'DIESEL',emi:'VEHICLE_LOAN_EMI',home:'HOME_LOAN_EMI',adv:'DRIVER_ADVANCE',hissab:'DRIVER_SETTLEMENT',vendor:'VENDOR_PAYMENT',repair:'REPAIR_MAINTENANCE',toll:'FASTAG_TOLL',paper:'VEHICLE_PAPER',salary:'SALARY',bank:'BANK_TRANSFER'};
 let match=categories.find(([v,n])=>n.toLowerCase()===q||v.toLowerCase()===q);
 if(!match&&aliases[q])match=categories.find(([v])=>v===aliases[q]);
 if(!match){const matches=categories.filter(([v,n])=>n.toLowerCase().includes(q)||v.toLowerCase().includes(q));if(matches.length===1)match=matches[0];}
 if(!match){alert('Select an exact category from suggestions or dropdown.');return;}
 if(state.rows[i]?.credit&&['DRIVER_ADVANCE','DRIVER_SETTLEMENT','DIESEL','UREA_DEF','REPAIR_MAINTENANCE','UNLOADING','VEHICLE_LOAN_EMI','HOME_LOAN_EMI','VENDOR_PAYMENT'].includes(match[0])){alert('This category is for bank DEBIT. Please review the CREDIT entry.');return;}
 setChoice(i,'category',match[0]);
}
function filterTruck(i,input){ /* Custom suggestions filter locally while typing. */ }
// Lightweight anchored suggestions: no native datalist popup and no change to save/mapping logic.
let suggestMenu=null,suggestInput=null,suggestIndex=0,suggestValues=[];
function closeSuggest(){if(suggestMenu)suggestMenu.remove();suggestMenu=null;suggestInput=null;suggestValues=[];suggestIndex=0;}
function suggestionValues(input){
 const kind=input.dataset.ektaSuggest,row=Number(input.dataset.ektaRow),r=state.rows[row];
 if(kind==='truck')return [...new Set(state.trucks.map(t=>clean(t.truck_number)).filter(Boolean))];
 if(kind==='driver')return [...new Set(state.drivers.map(d=>clean(d.driver_name||d.name||d.full_name)).filter(Boolean))];
 if(kind==='vendor')return [...new Set(state.vendors.map(v=>clean(v.vendor_code)).filter(Boolean))];
 if(kind==='category')return categories.filter(([v])=>!(r?.credit&&['DRIVER_ADVANCE','DRIVER_SETTLEMENT','DIESEL','UREA_DEF','REPAIR_MAINTENANCE','UNLOADING','VEHICLE_LOAN_EMI','HOME_LOAN_EMI','VENDOR_PAYMENT'].includes(v))).map(([,n])=>n);
 return [];
}
function drawSuggest(input,all=false){
 if(!input?.isConnected)return closeSuggest();
 const q=all?'':norm(input.value),values=suggestionValues(input).filter(v=>!q||norm(v).includes(q)).slice(0,60);
 if(!values.length)return closeSuggest();
 if(!suggestMenu){suggestMenu=document.createElement('div');suggestMenu.className='ekta-suggestion-list';document.body.appendChild(suggestMenu);}
 suggestInput=input;suggestValues=values;suggestIndex=0;
 // Anchor suggestions below the active field, never above or over another transaction.
 // Limit height to the visible room below; the table can be scrolled to reveal more.
 const rect=input.getBoundingClientRect();
 const roomBelow=Math.max(0,window.innerHeight-rect.bottom-8);
 suggestMenu.style.position='fixed';
 suggestMenu.style.left=Math.max(4,rect.left)+'px';
 suggestMenu.style.width=Math.max(175,rect.width)+'px';
 suggestMenu.style.top=(rect.bottom+3)+'px';
 suggestMenu.style.maxHeight=Math.max(0,Math.min(190,roomBelow-3))+'px';
 suggestMenu.innerHTML=values.map((v,j)=>`<div class="ekta-suggestion-item${j===0?' is-active':''}" data-suggest-index="${j}">${esc(v)}</div>`).join('');
}
function selectSuggest(index){
 const input=suggestInput,value=suggestValues[index];if(!input||value===undefined)return;
 input.value=value;closeSuggest();input.dispatchEvent(new Event('change',{bubbles:true}));
}
function initSuggestions(){
 document.addEventListener('focusin',e=>{const input=e.target.closest?.('input[data-ekta-suggest]');if(input)drawSuggest(input,true);else if(!e.target.closest?.('.ekta-suggestion-list'))closeSuggest();});
 document.addEventListener('input',e=>{const input=e.target.closest?.('input[data-ekta-suggest]');if(input)drawSuggest(input);});
 document.addEventListener('keydown',e=>{
  if(e.target!==suggestInput||!suggestMenu)return;
  if(e.key==='Escape'){closeSuggest();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();suggestIndex=(suggestIndex+(e.key==='ArrowDown'?1:-1)+suggestValues.length)%suggestValues.length;suggestMenu.querySelectorAll('.ekta-suggestion-item').forEach((el,j)=>el.classList.toggle('is-active',j===suggestIndex));suggestMenu.children[suggestIndex]?.scrollIntoView({block:'nearest'});}
  if(e.key==='Enter'){e.preventDefault();selectSuggest(suggestIndex);}
 });
 document.addEventListener('pointerdown',e=>{const item=e.target.closest?.('.ekta-suggestion-item');if(item){e.preventDefault();selectSuggest(Number(item.dataset.suggestIndex));return;}if(!e.target.closest?.('input[data-ekta-suggest]'))closeSuggest();});
 document.addEventListener('scroll',e=>{if(suggestMenu&&!suggestMenu.contains(e.target))closeSuggest();},true);
 window.addEventListener('resize',closeSuggest);
}
function setPartyCode(i,value){state.reviewSelections[i]??={};state.reviewSelections[i].partyCode=value;delete state.reviewSelections[i].party_id;const r=state.rows[i];if(!r)return;const cat=getSuggestion(i).category;const suffix=cat==='PARTY_ADVANCE'?'ADV':'BAL';r.user_remark=clean(value)?clean(value)+' '+suffix:'';}
function setTruckText(i,value){const matches=state.trucks.filter(t=>norm(t.truck_number)===norm(value));if(matches.length!==1){alert('Select exact truck number from the list.');return;}state.reviewSelections[i]??={};state.reviewSelections[i].truckText=value;setChoice(i,'truck_id',matches[0].id)}
function setLitres(i,v){if(state.rows[i]?.status!=='PENDING')return;state.reviewSelections[i]??={};state.reviewSelections[i].litres=clean(v);}
function setOriginalRef(i,v){if(state.rows[i]?.status!=='PENDING')return;state.reviewSelections[i]??={};state.reviewSelections[i].originalRef=clean(v).toUpperCase();}
function setRemark(i,v){if(!state.rows[i]||state.rows[i].status!=='PENDING')return;state.rows[i].user_remark=v;renderRows()}
function setVendorCode(i,value){
 const code=clean(value).toUpperCase();
 const matches=state.vendors.filter(v=>clean(v.vendor_code).toUpperCase()===code);
 if(matches.length!==1){alert('Vendor Code not found or not unique. Check Vendor Master.');return;}
 state.reviewSelections[i]??={};state.reviewSelections[i].vendorText=code;setChoice(i,'vendor_id',matches[0].id);
}
function setDriverText(i,text){
 if(!state.rows[i]||state.rows[i].status!=='PENDING')return;
 const value=clean(text), matches=state.drivers.filter(d=>norm(d.driver_name||d.name||d.full_name)===norm(value));
 state.reviewSelections[i]??={};
 state.reviewSelections[i].driverText=value;
 state.reviewSelections[i].driver_id=matches.length===1?String(matches[0].id):null;
 if(matches.length!==1&&value)alert(matches.length?'Multiple drivers have this name. Verify the correct driver before saving.':'Driver not found in Driver Master. Choose a name from suggestions.');
 renderRows();
}
function setChoice(i,k,v){if(!state.rows[i]||state.rows[i].status!=='PENDING')return;state.reviewSelections[i]??={};state.reviewSelections[i][k]=v;if(k==='truck_id')delete state.reviewSelections[i].driver_id;if(k==='category'){delete state.reviewSelections[i].party_id;delete state.reviewSelections[i].vendor_id;}renderRows()}
function renderDashboard(){
 renderLedgerCards();
 renderMonthlyFlow();
 const set=(id,v)=>{if($(id))$(id).textContent=money(v)};
 set("kBank",0);set("kCash",0);set("kRecv",0);set("kPay",0);
 set("kDriver",ledgerRows("driver").reduce((v,r)=>v+num(r.debit)-num(r.credit),0));
 set("kFastag",0);set("kRepair",ledgerRows("repair").reduce((v,r)=>v+num(r.debit),0));
 set("kSuspense",ledgerRows("suspense").reduce((v,r)=>v+num(r.debit)+num(r.credit),0));
 for(const id of ["kBank","kCash","kRecv","kPay","kFastag"]){if($(id))$(id).textContent="—";}
 for(const [id,tab] of [["sumFastag","fastag"],["sumDiesel","diesel"],["sumRepair","repair"],["sumOffice","office"],["miniFastag","fastag"],["miniDiesel","diesel"],["miniRepair","repair"],["miniOffice","office"]])set(id,ledgerRows(tab).reduce((v,r)=>v+num(r.debit),0));
 if($("dashParties"))$("dashParties").innerHTML=state.parties.filter(p=>String(p.type||p.party_type||"").toLowerCase().includes("billing")).slice(0,5).map(p=>`<tr><td>${esc(p.name||p.party_name||"—")}</td><td class="money">—</td><td><span class="pill review">Not calculated</span></td></tr>`).join("")||`<tr><td colspan="3" class="text-center text-slate-400">No debtor balances posted yet.</td></tr>`;
 if($("dashTransporters"))$("dashTransporters").innerHTML=`<tr><td colspan="3" class="text-center text-slate-400">No transporter ledger entries posted yet.</td></tr>`;
 if($("dashDrivers")){
 const truckMap=new Map(state.trucks.map(t=>[String(t.id),t.truck_number]));
 const activeByDriver=new Map();
 state.assignments.filter(a=>clean(a.status||"").toLowerCase()==="active")
  .sort((a,b)=>new Date(b.assigned_from||b.created_at||0)-new Date(a.assigned_from||a.created_at||0))
  .forEach(a=>{if(!activeByDriver.has(String(a.driver_id)))activeByDriver.set(String(a.driver_id),a)});
 $("dashDrivers").innerHTML=state.drivers.slice(0,5).map(d=>{
   const a=activeByDriver.get(String(d.id));
   const truckNo=a?truckMap.get(String(a.truck_id)):"";
   const driverName=d.driver_name||d.name||d.full_name||"—";
   return `<tr><td>${esc(driverName)}</td><td><b>${esc(truckNo||"—")}</b></td><td class="money">—</td></tr>`;
 }).join("")||`<tr><td colspan="3" class="text-center text-slate-400">No driver advance balances posted yet.</td></tr>`;
}
}
function renderMonthlyFlow(){
 const host=$("acMonthlyGraph"),note=$("acMonthlyNote");if(!host)return;
 const today=new Date(),months=[];
 for(let i=5;i>=0;i--){const d=new Date(today.getFullYear(),today.getMonth()-i,1);months.push({key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,label:d.toLocaleDateString("en-IN",{month:"short",year:"2-digit"}),income:0,out:0});}
 const byMonth=new Map(months.map(m=>[m.key,m]));
 for(const r of state.accountTransactions){
  if(r.posting_status==="SUSPENSE"||["BANK_TRANSFER","REVERSAL","INTERNAL_TRANSFER"].includes(String(r.category||"").toUpperCase()))continue;
  const key=String(r.transaction_date||"").slice(0,7),m=byMonth.get(key);if(!m)continue;
  m.income+=num(r.credit);m.out+=num(r.debit);
 }
 const max=Math.max(1,...months.flatMap(m=>[m.income,m.out]));
 host.innerHTML=`<div style="display:grid;grid-template-columns:repeat(6,minmax(90px,1fr));gap:16px;min-width:630px;align-items:end">${months.map(m=>`<div style="text-align:center"><div style="height:155px;display:flex;align-items:flex-end;justify-content:center;gap:7px;border-bottom:1px solid #dce5ef;padding:0 8px"><div title="Money In: ${money(m.income)}" style="width:29px;min-height:${m.income?3:0}px;height:${m.income/max*145}px;background:#24527a;border-radius:4px 4px 0 0"></div><div title="Money Out: ${money(m.out)}" style="width:29px;min-height:${m.out?3:0}px;height:${m.out/max*145}px;background:#8a9aac;border-radius:4px 4px 0 0"></div></div><div style="font-size:11px;font-weight:700;color:#334155;margin-top:8px">${m.label}</div><div style="font-size:10px;color:#64748b">${money(m.income)} in</div><div style="font-size:10px;color:#64748b">${money(m.out)} out</div></div>`).join("")}</div>`;
 note.textContent=state.accountLoadError?`Bank data unavailable: ${state.accountLoadError}`:"Shows last 6 months from loaded confirmed bank records (up to 1,000 recent entries). Not a full profit/loss statement.";
}
function showTab(tab){
 state.tab=tab;if($("acBackRow"))$("acBackRow").classList.toggle("hidden",tab==="dashboard");document.querySelectorAll("#accountsFinance .tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===tab));
 document.querySelectorAll("#accountsFinance .ac-view").forEach(x=>x.classList.add("hidden"));
 if(tab==="dashboard")$("acDashboard").classList.remove("hidden");
 else if(tab==="bank")$("acBank").classList.remove("hidden");
 else{$("acGeneric").classList.remove("hidden");renderGeneric()}
}
const meta={
 party:["Party Ledger","Billing parties / debtors — receivable and receipt history"],
 transporter:["Transporter Ledger","Single ledger supports both receivable and payable"],
 driver:["Driver Advance","Driver / truck wise advance and settlement"],
 fastag:["FASTag / Toll Expenses","Wallet recharge and truck-wise toll tracking"],
 diesel:["Diesel Expenses","Truck-wise diesel expense ledger"],
 repair:["Repair & Maintenance","Vehicle-wise repair, tyre, service and maintenance"],
 office:["Office Expenses","Salary, stationery, utilities and administration expenses"],
 suspense:["Suspense Account","Unmatched / unconfirmed transactions waiting for ledger assignment"]
};

function tripLabel(id){const t=state.trips.find(x=>String(x.id)===String(id));return t?clean(t.trip_number||t.trip_id||t.id):"";}
function tripEditor(r){
 const label=tripLabel(r.trip_id),current=label||"";
 return `<div style="min-width:142px;display:flex;align-items:center;gap:4px"><input aria-label="Trip ID" value="${esc(current)}" placeholder="Search Trip ID" autocomplete="off" style="width:115px;padding:5px;border:1px solid #cbd5e1;border-radius:5px;font-size:11px" data-party-id="${esc(r.party_id||'')}" oninput="EktaAccounts.tripSuggest(this)" onfocus="EktaAccounts.tripSuggest(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();EktaAccounts.linkTrip('${esc(r.id)}',this)}"><button type="button" class="btn" style="padding:5px 7px;font-size:10px" onclick="EktaAccounts.linkTrip('${esc(r.id)}',this.previousElementSibling)">Save</button></div>`;
}
function tripSuggest(input){
 let list=input.nextElementSibling;
 if(!list||list.dataset.tripList!=="1"){
  list=document.createElement('div');list.dataset.tripList='1';list.style.cssText='position:absolute;z-index:100;background:white;border:1px solid #cbd5e1;box-shadow:0 3px 8px #0002;max-height:180px;overflow:auto;min-width:130px';
  input.parentElement.style.position='relative';input.after(list);
 }
 const q=clean(input.value).toLowerCase();
 const seen=new Set();const matches=state.trips.filter(t=>{if(!input.dataset.partyId||String(t.party_id)!==String(input.dataset.partyId))return false;const label=clean(t.trip_number||t.trip_id||t.id);if(!label||seen.has(label)||!label.toLowerCase().includes(q))return false;seen.add(label);return true}).slice(0,20);
 list.replaceChildren();
 for(const t of matches){const b=document.createElement('button');b.type='button';b.textContent=clean(t.trip_number||t.trip_id||t.id);b.style.cssText='display:block;width:100%;text-align:left;padding:6px 9px;font-size:11px;background:white;border:0;cursor:pointer';b.onmousedown=e=>e.preventDefault();b.onclick=()=>{input.value=b.textContent;list.remove();input.focus()};list.appendChild(b)}
 if(!matches.length)list.remove();
 input.onblur=()=>setTimeout(()=>list.remove(),150);
}
async function linkTrip(rowId,input){
 if(state.busy)return;
 const row=state.accountTransactions.find(r=>String(r.id)===String(rowId));if(!row)return alert('Payment entry not found. Refresh and retry.');
 if(!['PARTY_ADVANCE','PARTY_BALANCE'].includes(row.category)||row.posting_status!=='CONFIRMED')return alert('Only confirmed Party receipts can be linked.');
 const typed=clean(input.value),matches=state.trips.filter(t=>clean(t.trip_number||t.trip_id||t.id).toLowerCase()===typed.toLowerCase());
 if(!typed)return alert('Enter a valid Trip ID.');
 if(matches.length!==1)return alert('Trip ID not found or not unique. Choose the exact Trip ID from the list.');
 const t=matches[0];
 // A payment may only link to a trip belonging to its own master party.
 if(!row.party_id||!t.party_id||String(row.party_id)!==String(t.party_id))return alert('Trip belongs to another Party, or Party matching is missing. No changes saved.');
 if(String(row.trip_id||'')===String(t.id))return;
 if(row.trip_id&&!confirm('This receipt is already linked to '+tripLabel(row.trip_id)+'. Change its Trip ID?'))return;
 state.busy=true;input.disabled=true;
 try{const {data,error}=await S.from('account_transactions').update({trip_id:t.id}).eq('id',row.id).eq('party_id',row.party_id).select('id,trip_id').single();if(error)throw error;if(!data||String(data.trip_id)!==String(t.id))throw Error('Trip link was not confirmed by Supabase');row.trip_id=t.id;renderGeneric();alert('Payment linked to Trip ID '+typed+'.');}
 catch(e){alert('Trip ID save failed: '+(e.message||e));input.disabled=false;}
 finally{state.busy=false}
}

 function renderGeneric(){
  let [title,sub]=meta[state.tab]||[ledgerDefinitions.find(x=>x[0]===state.tab)?.[1]||"Accounts","Saved accounting transactions"];
  $("genericTitle").textContent=title;$("genericSub").textContent=sub;
  $("genericHead").innerHTML="<tr><th>Date</th><th>Particulars / Remark</th><th>Reference</th><th>Trip ID</th><th>Truck / Driver / Party</th><th class='money'>Debit</th><th class='money'>Credit</th><th>Status</th></tr>";
  const q=clean($("genericSearch")?.value).toLowerCase();
  const trucks=new Map(state.trucks.map(x=>[String(x.id),x.truck_number]));
  const drivers=new Map(state.drivers.map(x=>[String(x.id),x.driver_name||x.name||x.full_name]));
  const parties=new Map(state.parties.map(x=>[String(x.id),x.name||x.party_name]));
  const all=ledgerRows(state.tab);
  const rows=all.filter(r=>!q||[r.transaction_date,r.bank_narration,r.user_remark,r.reference_number,trucks.get(String(r.truck_id)),drivers.get(String(r.driver_id)),parties.get(String(r.party_id)),tripLabel(r.trip_id)].some(v=>clean(v).toLowerCase().includes(q)));
  const deb=all.reduce((s,r)=>s+num(r.debit),0),cred=all.reduce((s,r)=>s+num(r.credit),0);
  if($("acLedgerSummary"))$("acLedgerSummary").textContent=state.accountLoadError?`Unable to load saved ledger: ${state.accountLoadError}`:`${all.length} saved entries • Debit ${money(deb)} • Credit ${money(cred)} • Transaction totals, not ledger closing balance`;
  $("genericBody").innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.transaction_date||"—")}</td><td style="white-space:normal;min-width:240px">${esc(r.bank_narration||"—")}${r.user_remark?`<div class="text-slate-500">${esc(r.user_remark)}</div>`:""}</td><td>${esc(r.reference_number||"—")}</td><td>${["party","partyadvance","partybalance"].includes(state.tab)?tripEditor(r):esc(tripLabel(r.trip_id)||"—")}</td><td>${esc([trucks.get(String(r.truck_id)),drivers.get(String(r.driver_id)),parties.get(String(r.party_id))].filter(Boolean).join(" • ")||"—")}</td><td class="money">${r.debit?money(r.debit):"—"}</td><td class="money">${r.credit?money(r.credit):"—"}</td><td>${esc(r.posting_status||"—")}</td></tr>`).join(""):`<tr><td colspan="8" class="text-center text-slate-400 py-10">${state.accountLoadError?"Ledger data unavailable.":"No saved entries for this ledger."}</td></tr>`;
 }
function setBusy(v){state.busy=v;$("acBusy")?.classList.toggle("hidden",!v);if($("acAnalyzeBtn"))$("acAnalyzeBtn").disabled=v||!state.file}
async function analyze(){
 if(!state.file||state.busy)return;
 const bank=$('acBankAccount')?.value||'';
 if(!bank)return alert('Select the correct bank account before reading.');
 const ext=state.file.name.split('.').pop().toLowerCase();
 if(ext==='pdf'&&!bank.startsWith('ICICI'))return alert('Only ICICI PDF has been validated as a supported layout. Use a matching HDFC Excel statement.');
 if(['xls','xlsx'].includes(ext)&&!bank.startsWith('HDFC'))return alert('This Excel reader is configured for HDFC statements.');
 setBusy(true);
 try{
  let result;
  if(ext==='pdf')result=await window.EktaBankParser.pdf(state.file);
  else if(['xls','xlsx'].includes(ext))result=await window.EktaBankParser.excel(state.file);
  else if(ext==='csv')result={rows:csv(await fileText(state.file)),account:'',format:'CSV'};
  else throw new Error('Local reading supports ICICI PDF, HDFC Excel and CSV. Gemini is a separate manual fallback.');
  if(!result.account)throw new Error('Account number not detected inside the statement. Import blocked; do not guess from dropdown or filename.');
  const suffix=bank.split('-').pop();
  if(bank==='HDFC-RUDRA'){
    const actualLast4=result.account.slice(-4);
    if(['2332','1672'].includes(actualLast4))throw new Error('ACCOUNT MISMATCH: this statement belongs to an existing HDFC account ending '+actualLast4+', not Rudra.');
    const entered=window.prompt('HDFC Rudra account verification: enter the LAST 4 digits from your bank records (not from this screen). Statement detected ending '+actualLast4+'.');
    if(entered===null)throw new Error('Rudra account verification cancelled. No rows imported.');
    if(!/^\d{4}$/.test(entered.trim())||entered.trim()!==actualLast4)throw new Error('Rudra account verification failed. No rows imported.');
  }else if(!/^\d{4}$/.test(suffix)||!result.account.endsWith(suffix))throw new Error('ACCOUNT MISMATCH: selected '+bank+' but statement account ends in '+result.account.slice(-4)+'. Select the correct account and read again.');
  if(['xls','xlsx'].includes(ext)){const filenameSuffix=(state.file.name.match(/(?:^|[_-])(\d{4})(?:[_-]|\.)/)||[])[1];if(filenameSuffix&&filenameSuffix!==result.account.slice(-4))throw new Error('Filename/account mismatch: Excel metadata ends in '+result.account.slice(-4)+' but filename indicates '+filenameSuffix+'.');}
  if(!result.audit || !result.audit.valid || result.audit.checkedBalancePairs!==result.rows.length-1){
    const issues=result.audit?.errors?.slice(0,5).join(' | ')||'Incomplete balance reconciliation';
    throw new Error('Reading validation failed. No rows imported: '+issues);
  }
  // HDFC XLS metadata may omit account number; manual selection is required and is not independent verification.
  state.selectedBank=bank;
  state.reviewSelections={};state.rows=result.rows.map(r=>{const out=normalizeRow(r);out.bank_transaction_id=r.bank_transaction_id||'';out.closing_balance=r.closing_balance;out.bank_account=bank;return out;});
  if(!state.rows.length)throw new Error('No transactions found.');
  renderRows();
  const summary=$('acSummary');if(summary)summary.textContent=state.rows.length+' extracted rows • '+bank+' (verified: ••••'+result.account.slice(-4)+') • BALANCE PASS ('+result.audit.checkedBalancePairs+' pairs) • Debit '+money(result.audit.totalDebit)+' • Credit '+money(result.audit.totalCredit)+' • EMPLOYEE CONFIRM REQUIRED.';
 }catch(e){state.rows=[];state.selectedBank='';renderRows();console.error('[BANK LOCAL IMPORT]',e);alert('Statement reading failed: '+e.message)}finally{setBusy(false)}
}
async function analyzeAI(){
 alert('Gemini is preserved in the source but disabled during read-only testing. Use your previous working module for Gemini.');return;
 if(!state.file||state.busy)return;
 if(!confirm('Use paid Gemini only for this selected file?'))return;
 const bank=$('acBankAccount')?.value||'';if(!bank)return alert('Select bank account first.');
 setBusy(true);try{state.rows=await ai(state.file);state.selectedBank=bank;renderRows()}catch(e){alert('Gemini reading failed: '+e.message)}finally{setBusy(false)}
}
function chooseFile(file){if(!file)return;state.file=file;state.rows=[];state.reviewSelections={};state.selectedBank="";renderRows();$("acFileStatus").textContent=file.name;$("acFileMeta").classList.remove("hidden");$("acFileMeta").innerHTML=`<b>${esc(file.name)}</b> • ${(file.size/1024/1024).toFixed(2)} MB`;$("acAnalyzeBtn").disabled=false}
function bankSelectionChanged(){state.rows=[];state.reviewSelections={};state.selectedBank="";renderRows();if($("acSummary"))$("acSummary").textContent="Bank selection changed. Read & Validate again; previous review cleared. No saving enabled."}
function resetStatement(){state.file=null;state.rows=[];state.reviewSelections={};if($("acFile"))$("acFile").value="";$("acFileStatus").textContent="No file selected";$("acFileMeta").classList.add("hidden");renderRows();setBusy(false)}
async function persistMaster(i,forceSuspense=false){
 const r=state.rows[i];if(!r||r.status!=='PENDING'||state.postingRows?.has(i))return;
 if(!S?.from)return alert('Supabase is unavailable. Nothing saved.');
 if(!state.selectedBank)return alert('Choose a bank account.');
 const {d,truck,driver,category,party,instruction}=getSuggestion(i);
 const selectedVendor=state.vendors.find(v=>String(v.id)===String(state.reviewSelections[i]?.vendor_id));
 if(!forceSuspense){
  if(category==='SUSPENSE'||category==='POSSIBLE_EMI'||category==='REVERSAL_REVIEW')return alert('Select a verified ledger category or use Suspense.');
  if((category==='PARTY_ADVANCE'||category==='PARTY_BALANCE')){
   if(!r.credit||r.debit)return alert('Party advance/balance received must be a bank CREDIT. Review this entry.');
   if(!instruction)return alert('Enter a valid Party Code and select ADV or BAL.');
   if(!instruction.matches.some(p=>String(p.id)===String(party?.id)))return alert('Select a matching Party Master record for this code. Check branch if necessary.');
   if(!partyKind(party))return alert('Party Master type missing. Set Billing Party or Transporter before saving.');
   if(partyKind(party)==='BILLING'&&category==='PARTY_ADVANCE')return alert('Billing Party receipt must be saved as Party Balance Received.');
  }
  if((category==='HOME_LOAN_EMI'||category==='VEHICLE_LOAN_EMI')&&(!r.debit||r.credit))return alert('EMI payment must be a bank DEBIT. Review the transaction.');
  if(category==='VENDOR_PAYMENT'&&(!r.debit||r.credit||!selectedVendor))return alert('Vendor payment requires a bank DEBIT and verified Vendor Code.');
  if(category==='DIESEL'){
   const litres=Number(state.reviewSelections[i]?.litres);
   if(!Number.isFinite(litres)||litres<=0)return alert('Enter valid Diesel Litres before confirming.');
  }
  if(category==='DRIVER_ADVANCE_REVERSAL'&&(!r.credit||r.debit))return alert('Advance reversal must be a bank CREDIT.');
  if(category==='EMI_LOAN')return alert('Please choose Vehicle Loan EMI or Home Loan EMI before confirming this EMI.');
  if(truckCats.has(category)&&!truck)return alert('Select the correct truck before confirming.');
  if(driverCats.has(category)&&!driver)return alert('Select the driver before confirming.');
  if(category==='DRIVER_SETTLEMENT'&&!confirm('This is a DRIVER SETTLEMENT PAYMENT, not a new advance. Confirm the driver and amount. This does not automatically zero an outstanding khata. Continue?'))return;
  if(!confirm('Confirm bank '+state.selectedBank+' • '+r.date+' • '+money(r.debit||r.credit)+' • '+category+' • '+(party?(party.party_code||party.code||'')+' '+(party.name||party.party_name||''):'')+' • '+(truck?.truck_number||'No truck')+' • '+(driver?.driver_name||driver?.name||'No driver')+' • '+(selectedVendor?.name||'')+'?'))return;
 }
 const date=statementDateISO(r.date);if(!date)return alert('Invalid transaction date.');
 let reversalOriginal=null;
 if(!forceSuspense&&category==='DRIVER_ADVANCE_REVERSAL'){
  const originalRef=clean(state.reviewSelections[i]?.originalRef).toUpperCase();
  if(!originalRef)return alert('Enter Original Advance Reference before reversal.');
  if(originalRef===clean(r.reference).toUpperCase())return alert('Reversal reference and original reference cannot be the same.');
  const {data:originals,error:origError}=await S.from('account_transactions').select('id,reference_number,category,debit,credit,driver_id,truck_id,posting_status,transaction_date,bank_account_name').eq('reference_number',originalRef).limit(1000);
  if(origError)return alert('Cannot verify original advance: '+origError.message);
  const eligible=(originals||[]).filter(x=>x.category==='DRIVER_ADVANCE'&&x.posting_status==='CONFIRMED'&&num(x.debit)>0&&!num(x.credit)&&x.driver_id&&x.truck_id&&x.bank_account_name===state.selectedBank);
  if(eligible.length!==1)return alert('Exactly one confirmed original Driver Advance with truck, driver and same bank account is required. Check original entry first.');
  reversalOriginal=eligible[0];
  if(num(r.credit)>num(reversalOriginal.debit))return alert('Reversal exceeds original advance amount.');
  const {data:priorReversals,error:priorError}=await S.from('account_transactions').select('id,category,credit,user_remark,posting_status').eq('category','DRIVER_ADVANCE').eq('posting_status','CONFIRMED').limit(1000);
  if(priorError)return alert('Cannot check previous reversals: '+priorError.message);
  const already=(priorReversals||[]).filter(x=>clean(x.user_remark).startsWith('ADVANCE_REVERSAL_OF:'+originalRef+';')).reduce((a,x)=>a+num(x.credit),0);
  if(already+num(r.credit)>num(reversalOriginal.debit))return alert('Reversal already adjusted or exceeds remaining original advance.');
  if(!confirm('Adjust '+money(r.credit)+' against ORIGINAL ADVANCE '+originalRef+'? Driver and truck will be copied from the confirmed original.'))return;
 }

 const ref=clean(r.bank_transaction_id||r.reference);
 if(!ref)return alert('Bank reference missing: manual review required to prevent duplicate posting.');
 state.postingRows??=new Set();state.postingRows.add(i);
 try{
  // Fail closed on missing read permissions or ambiguous reference. Never overwrite a previous row.
  const {data:existing,error:checkError}=await S.from('account_transactions').select('id,transaction_date,debit,credit,bank_account_name,reference_number,bank_narration').eq('reference_number',ref).limit(1000);
  if(checkError)throw checkError;
  if((existing||[]).some(x=>x.bank_account_name===state.selectedBank&&x.transaction_date===date&&num(x.debit)===num(r.debit)&&num(x.credit)===num(r.credit)&&clean(x.bank_narration)===clean(r.narration)))return alert('This exact bank entry already exists. Duplicate save blocked.');
  const payload={transaction_date:date,bank_narration:r.narration||null,reference_number:ref,debit:num(r.debit),credit:num(r.credit),user_remark:reversalOriginal?'ADVANCE_REVERSAL_OF:'+clean(state.reviewSelections[i].originalRef).toUpperCase()+'; '+clean(r.user_remark):clean(r.user_remark)||null,ai_remark:r.ai_remark||null,category:forceSuspense?'SUSPENSE':reversalOriginal?'DRIVER_ADVANCE':category,posting_status:forceSuspense?'SUSPENSE':'CONFIRMED',party_id:forceSuspense?null:party?.id||null,vendor_id:forceSuspense?null:category==='VENDOR_PAYMENT'?selectedVendor?.id||null:null,truck_id:forceSuspense?null:reversalOriginal?.truck_id||truck?.id||null,driver_id:forceSuspense?null:reversalOriginal?.driver_id||(driverCats.has(category)?driver?.id||null:null),trip_id:null,bank_name:state.selectedBank.split('-')[0],bank_account_name:state.selectedBank,quantity_litres:forceSuspense?null:category==='DIESEL'?Number(state.reviewSelections[i]?.litres):null,confirmed_at:new Date().toISOString()};
  const {data,error}=await S.from('account_transactions').insert(payload).select('id').single();
  if(error)throw error;
  r.db_id=data.id;r.status=forceSuspense?'SUSPENSE':'CONFIRMED';renderRows();await loadMasters();
 }catch(e){console.error('[EKTA BANK SAVE]',e);alert('Save failed; no successful posting confirmed: '+(e.message||e))}finally{state.postingRows.delete(i)}
}
async function confirmRow(i){if(getSuggestion(i).category==='SUSPENSE'){if(!confirm('Save this transaction to Suspense for later review?'))return;await persistMaster(i,true);return;}await persistMaster(i,false)}
async function suspenseRow(i){if(confirm('Save this unidentified bank transaction to Suspense for later review?'))await persistMaster(i,true)}
function bind(){let f=$("acFile"),d=$("acDrop");if(!f||!d)return;f.addEventListener("change",()=>chooseFile(f.files?.[0]));["dragenter","dragover"].forEach(x=>d.addEventListener(x,e=>{e.preventDefault();d.classList.add("drag")}));["dragleave","drop"].forEach(x=>d.addEventListener(x,e=>{e.preventDefault();d.classList.remove("drag")}));d.addEventListener("drop",e=>chooseFile(e.dataTransfer?.files?.[0]))}
async function refresh(){await loadMasters();renderRows()}
function scrollWorking(dir){const e=$("workingScroll");if(e)e.scrollBy({left:dir*430,behavior:"smooth"})}
function scrollBottom(dir){const e=$("bottomScroll");if(e)e.scrollBy({left:dir*430,behavior:"smooth"})}
window.EktaAccounts={getVickyTrucks:()=>state.trucks.map(t=>t.truck_number).filter(Boolean),getReviewSnapshot:()=>({bank:state.selectedBank,rows:state.rows.map(r=>({date:r.date,narration:r.narration,reference:r.reference,debit:r.debit,credit:r.credit,bank_transaction_id:r.bank_transaction_id}))}),showTab,analyze,analyzeAI,resetStatement,bankSelectionChanged,confirmRow,suspenseRow,setRemark,setLitres,setOriginalRef,setChoice,setDriverText,setVendorCode,toggleReview,refreshReview,setPartyCode,setTruckText,searchCategory,filterTruck,renderGeneric,tripSuggest,linkTrip,refresh,scrollWorking,scrollBottom};
initSuggestions();bind();loadMasters();renderRows();renderDashboard();
})();