/* EKTA TRANSPORT — PARTY LEDGER STEP 1: manual billing freight and invoice preview.
   Existing trips are read-only. Adjustments persist in party_trip_billing_rates. */
(function(){'use strict';
const $=id=>document.getElementById(id),S=()=>window.supabaseClient;
let parties=[],trips=[],trucks=[],overrides={},type='Billing Client',selected=null,loading=false,rateTableReady=true,selectedTrips=new Set(),statusFilter='all',dropdownOpen=false,dropdownIndex=0,invoiceTripIds=new Set(),statementSearch='',summarySelection=null,haierVerified={},haierVerificationAvailable=false,haierSaving=new Set();
 const searchText=v=>String(v??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/haier/g,'hair').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
 const matches=(q,fields)=>searchText(q).split(' ').filter(Boolean).every(term=>searchText(fields.join(' ')).includes(term));
const norm=v=>String(v??'').trim().toLowerCase(),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const note=(s,k)=>String(s||'').match(new RegExp('\\[TRACKING:'+k+'=([^\\]]+)\\]','i'))?.[1]||'';
const validTrip=t=>!!(t.loading_date||t.lr_date||note(t.notes,'LOADING_DATE'))&&norm(t.trip_status)!=='cancelled';
const ready=t=>['received','verified'].includes(norm(note(t.notes,'POD_STATUS')))&&norm(note(t.notes,'POD_SENT'))==='yes';
const rate=t=>Object.prototype.hasOwnProperty.call(overrides,t.id)?Number(overrides[t.id].freight_amount):Number(t.freight_amount??t.revenue??0);
const partyLabel=p=>[p.party_code,p.name,p.city].filter(Boolean).join(' · ');
 // Read existing tracking dates only; no writes or changes to detention policy.
 const ledgerDate=v=>{const s=String(v??'').trim();return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):'';};
 const reportingDate=t=>ledgerDate(t.reporting_date||note(t.notes,'REPORTING_DATE'));
 const unloadingDate=t=>ledgerDate(t.unloading_date||t.end_date);
 const unloadingDays=t=>{const a=reportingDate(t),b=unloadingDate(t);if(!a||!b)return '—';const diff=Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);return Math.max(0,diff-1);};

// Verified OCR fields are stored per POD; never infer an LR or quantity.
 function savedPODRows(t){
  const rows=[];
  for(let slot=1;slot<=100;slot++){
   const raw=note(t.notes,`POD_OCR_${slot}`);
   if(!raw)continue;
   try{
    const data=JSON.parse(decodeURIComponent(raw));
    if(data&&typeof data==='object'&&!Array.isArray(data))rows.push(data);
   }catch(e){console.warn('[EKTA LEDGER] Invalid saved POD OCR',slot,t.id,e);}
  }
  return rows;
 }
 // Consignee is a display-only field: keep the original saved OCR text untouched.
 // Prefer the explicit Company(Location) heading, never append its postal address.
 function consigneeDisplay(value){
  const raw=String(value??'').trim();
  if(!raw)return '';
  const normalized=raw.replace(/\r/g,'\n').replace(/\s*\n\s*/g,'\n').trim();
  const heading=normalized.match(/^([^\n]*?\([^()\n]+\))/);
  if(heading)return heading[1].trim();
  // Some OCR results put the address after the name on a separate line.
  const firstLine=normalized.split('\n').map(x=>x.trim()).find(Boolean)||'';
  // Only remove an address if a clear address marker begins after a comma.
  const addressStart=firstLine.search(/,\s*(?:plot\s*(?:no\.?|number)?|survey\s*(?:no\.?|number)?|sector\s*[-:]?\s*\d|road\b|street\b|pin\s*(?:code)?|pincode\b|near\b|village\b|district\b)/i);
  return addressStart>=0?firstLine.slice(0,addressStart).trim():firstLine;
 }
 // HAIER-to-HAIER only: display full company name and verified delivery city,
 // never the postal address. This is display-only; no OCR data is rewritten.
 function haierConsignee(value, destination){
  const raw=String(value??'').replace(/\s+/g,' ').trim();
  // Display only: match Haier company heading in the POD, never change saved OCR.
  const match=/\b(HAIER\s+APPLIANCES\s+INDIA\s+PVT\s+(?:LIMITED|LTD))(?=\b|[A-Z])/i.exec(raw);
  if(!match)return consigneeDisplay(value);
  const company=match[1].trim().toUpperCase();
  const after=raw.slice(match.index+match[0].length);
  // OCR may join the city to LTD: "LTDGOA Plot no...". Read the city from
  // the POD heading itself; tracking To can differ and must not be used here.
  const heading=after.match(/^\s*[,—–-]?\s*\(?\s*([A-Za-z][A-Za-z .-]{1,55}?)\s*\)?(?=\s+(?:Plot\b|Survey\b|Road\b|Street\b|Sector\b|Industrial\b|Address\b|D\s*No\b)|[,;]|$)/i);
  if(heading){
   const city=heading[1].trim().replace(/[.\s-]+$/,'');
   if(city && !/^(?:plot|survey|road|street|sector|industrial|address)$/i.test(city))return company+' — '+city.toUpperCase();
  }
  // A clearly bracketed plant/city in the POD is also accepted.
  const bracket=/^\s*\(\s*([A-Za-z][A-Za-z\s-]{1,55}?)\s*\)/.exec(after);
  if(bracket)return company+' — '+bracket[1].trim().toUpperCase();
  // Do not expose address or invent a city if the OCR heading is ambiguous.
  return company;
 }

 // Inline display overrides are per trip, kept separate from the original POD OCR.
 // This is local browser storage only; no Supabase schema or POD record is changed.
 const consigneeKey=id=>'ekta_ledger_consignee_inline_v1_'+String(id);
 function readConsigneeOverride(id){try{return localStorage.getItem(consigneeKey(id));}catch(e){return null;}}
 function saveConsigneeInline(id,value){
  try{localStorage.setItem(consigneeKey(id),String(value??'').trim());}
  catch(e){alert('Consignee name could not be saved in this browser: '+e.message);}
 }
 function extractDeliveryHeading(value){
  const raw=String(value??'').replace(/\s+/g,' ').trim();
  // Some OCR records contain both parties in one field; use text after Consignee:.
  const part=raw.match(/\bConsignee\s*[:：-]\s*(.*)$/i)?.[1]||raw;
  const m=/\b(HAIER\s+APPLIANCES\s+INDIA\s+PVT\.?\s*(?:LIMITED|LTD)\.?)(?=\b|[A-Z])/i.exec(part);
  if(!m)return {company:'',city:'',raw:part};
  const rest=part.slice(m.index+m[0].length);
  // City immediately following LTD, including joined "LTDGOA"; stop at Plot No.
  const city=rest.match(/^\s*[,—–-]?\s*\(?\s*([A-Za-z][A-Za-z .-]{0,50}?)\s*\)?(?=\s+(?:Plot\b|Survey\b|Road\b|Street\b|Sector\b|Industrial\b|Address\b|D\s*No\b)|[,;]|$)/i)?.[1]
   ||rest.match(/^\s*\(\s*([A-Za-z][A-Za-z .-]{0,50}?)\s*\)/)?.[1]||'';
  return {company:m[1].replace(/\s+/g,' ').trim(),city:city.trim(),raw:part};
 }
 function suggestedConsignee(t){
  const docs=savedPODRows(t);
  const names=docs.map(d=>String(d['Consignee / Address']||'')).filter(Boolean);
  if(!names.length)return '';
  const suggestions=names.map(value=>{
   const parsed=extractDeliveryHeading(value);
   if(parsed.company && parsed.city){
    // Match company AND delivery city, never billing party code or tracking To.
    const match=parties.find(p=>/HAIER\s+APPLIANCES/i.test(String(p.name||'')) &&
      searchText([p.name,p.city].join(' ')).includes(searchText(parsed.city)));
    if(match)return String(match.name||'').trim();
    return parsed.company.toUpperCase()+' ('+parsed.city.toUpperCase()+')';
   }
   return parsed.company?parsed.company.toUpperCase():consigneeDisplay(value);
  });
  return [...new Set(suggestions.filter(Boolean))].join(' / ');
 }
 function consignorCheck(t,tripParty){
  const docs=savedPODRows(t);
  const raw=docs.map(d=>d['Consignor / Address']||d['Consignor']||d['Consignor Name']||'').find(Boolean);
  if(!raw)return '';
  const company=/HAIER\s+APPLIANCES\s+INDIA/i.test(String(raw));
  const billing=/HAIER\s+APPLIANCES\s+INDIA/i.test(String(tripParty?.name||''));
  const location=String(tripParty?.city||String(tripParty?.name||'').match(/\(([^)]+)\)/)?.[1]||'').trim();
  const locMatch=location && searchText(raw).includes(searchText(location));
  return company&&billing&&locMatch?'POD Consignor matches billing party company and location':'POD Consignor needs manual verification against billing party';
 }
 function podSummary(t){
  const docs=savedPODRows(t);
  const unique=values=>[...new Set(values.map(v=>String(v??'').trim()).filter(Boolean))];
  const lrs=unique(docs.map(d=>d['LR Number']));
  const dates=unique(docs.map(d=>d['LR Date']));
  const quantities=docs.map(d=>String(d['Quantity']??'').trim());
  const validQty=quantities.filter(v=>/^\d+(?:\.\d+)?$/.test(v));
  const qty=validQty.length?String(validQty.reduce((n,v)=>n+Number(v),0)):'—';
  const consignees=unique(docs.map(d=>consigneeDisplay(d['Consignee / Address'])));
  const sizes=unique(docs.map(d=>d['Vehicle Size']));
  // Display the complete verified LR numbers. Never remove year/month or shorten digits.
  const displayLR=()=>lrs.length?lrs.join(' - '):(t.lr_number||'—');
  return {lrs,dates,qty,consignees,sizes,lrDisplay:displayLR()};
 }
 function visible(){return parties.filter(p=>norm(p.party_type)===norm(type)).sort((a,b)=>partyLabel(a).localeCompare(partyLabel(b)));}
function setType(t){type=t;selected=null;selectedTrips.clear();statusFilter='all';summarySelection=null;statementSearch='';if($('ledgerStatementSearch'))$('ledgerStatementSearch').value='';$('ledgerSearch').value='';dropdownOpen=false;render();}
 // Presentation-only summary. Original trip, invoice and POD records remain untouched.
 function ensureLedgerSummaryUI(){
  const heading=$('ledgerPartyHeading');
  if(!heading)return;
  let summary=$('ledgerPartySummary');
  if(!summary){
   summary=document.createElement('div');summary.id='ledgerPartySummary';
   summary.className='rounded-xl border border-slate-200 bg-white overflow-hidden';
   heading.parentElement.parentNode.insertBefore(summary,heading.parentElement);
  }
  if(!$('ledgerDetailArea')){
   const area=document.createElement('div');area.id='ledgerDetailArea';area.className='space-y-3';
   const parent=heading.parentElement.parentNode;
   const start=heading.parentElement;
   // Keep all existing invoice, search and table elements exactly as they are.
   const elements=[];let node=start;
   while(node){const next=node.nextElementSibling;elements.push(node);node=next;}
   parent.appendChild(area);elements.forEach(el=>area.appendChild(el));
   const back=document.createElement('button');back.type='button';back.id='ledgerBackToSummary';back.className='px-3 py-2 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 text-xs font-bold';back.textContent='← Back to Party Summary';back.onclick=backToSummary;area.insertBefore(back,area.firstChild);
  }
 }
 function summaryCompanyKey(p){
  const code=String(p.party_code||'').toUpperCase().split('__UNIT__')[0].replace(/_UNIT_.*/,'').trim();
  return code?'CODE:'+code:'NAME:'+searchText(String(p.name||'').replace(/\([^)]*\)/g,''));
 }
 function summaryCompanyName(p){return String(p.name||'Unnamed Party').replace(/\s*\([^)]*\)\s*$/,'').trim();}
 // Classification is based on saved POD consignee only, never on the destination city.
 // Missing/ambiguous POD consignee stays in a separate review bucket.
 function haierRoute(t){
  const verified=haierVerified[String(t.id)];
  if(verified==='haier'||verified==='other')return verified;
  const names=savedPODRows(t).map(d=>String(d['Consignee / Address']||d['Consignee']||'').trim()).filter(Boolean);
  if(!names.length)return 'review';
  const classified=names.map(n=>/\bHAIER\s+APPLIANCES\b/i.test(n)?'haier':'other');
  return classified.every(x=>x==='haier')?'haier':classified.every(x=>x==='other')?'other':'review';
 }
 // Route confirmation is HAIER-only and does not modify POD OCR or trip data.
 async function confirmHaierRoute(id,route){
  if(!['haier','other'].includes(route))return;
  const t=trips.find(x=>String(x.id)===String(id));
  const p=parties.find(x=>String(x.id)===String(t?.party_id));
  if(!t||!p||!/\bHAIER\s+APPLIANCES\b/i.test(String(p.name||''))){alert('Only HAIER trips can be verified here.');return;}
  if(!haierVerificationAvailable){alert('HAIER verification table is not available. Run the supplied SQL in Supabase first, then Refresh.');return;}
  if(haierSaving.has(String(id)))return;
  const label=route==='haier'?'Haier to Haier':'Haier to Other';
  if(!confirm('Confirm '+label+' for trip '+(t.trip_number||id)+'? This does not change the POD.'))return;
  haierSaving.add(String(id));
  try{
   const {data,error}=await S().from('party_haier_route_verifications').upsert({trip_id:String(id),route_category:route,verified_at:new Date().toISOString()},{onConflict:'trip_id'}).select('trip_id,route_category');
   if(error)throw error;
   if(!data?.some(x=>String(x.trip_id)===String(id)&&x.route_category===route))throw Error('Save was not confirmed by Supabase. Check RLS permissions.');
   haierVerified[String(id)]=route;
   render();
  }catch(e){alert('HAIER verification was NOT saved: '+e.message);console.error('[HAIER verification]',e);}
  finally{haierSaving.delete(String(id));}
 }
 function selectSummary(companyKey,route){
   if(type==='Transporter'&&!window.EKTA_BILLING_STANDALONE){
    const id=String(companyKey).startsWith('TRANSPORTER:')?String(companyKey).slice(12):'';
    if(!id || !parties.some(p=>String(p.id)===id&&norm(p.party_type)==='transporter')){alert('Select a valid Transporter party.');return;}
    const url=new URL('transporter-working-sheet.html',window.location.href);
    url.searchParams.set('party_id',id);
    const tab=window.open(url.href,'_blank');
    if(!tab)alert('Please allow pop-ups to open the Transporter Working Sheet.');
    return;
   }
   if(!window.EKTA_BILLING_STANDALONE){
    const url=new URL('billing-working-sheet.html',window.location.href);
    url.searchParams.set('company',String(companyKey));
    url.searchParams.set('route',String(route));
    url.searchParams.set('status',statusFilter);
    const tab=window.open(url.href,'_blank');
    if(!tab)alert('Please allow pop-ups for this site to open the Billing Working Sheet.');
    return;
   }
   summarySelection={companyKey:String(companyKey),route:String(route)};
  selected=null;selectedTrips.clear();statementSearch='';dropdownOpen=false;
  if($('ledgerSearch'))$('ledgerSearch').value='';
  if($('ledgerStatementSearch'))$('ledgerStatementSearch').value='';
  render();
 }
 function renderPartySummary(matching,filteredTrips){
  const holder=$('ledgerPartySummary');if(!holder)return;
  const allowed=new Set(matching.map(p=>String(p.id)));
  const groups=new Map();
  for(const p of matching){
   const key=type==='Transporter'?'TRANSPORTER:'+String(p.id):summaryCompanyKey(p);
   if(!groups.has(key))groups.set(key,{key,name:summaryCompanyName(p),partyIds:new Set(),trips:[]});
   groups.get(key).partyIds.add(String(p.id));
  }
  for(const t of filteredTrips){
   if(!allowed.has(String(t.party_id)))continue;
   const party=matching.find(p=>String(p.id)===String(t.party_id));
   if(party)groups.get(type==='Transporter'?'TRANSPORTER:'+String(party.id):summaryCompanyKey(party))?.trips.push(t);
  }
  const groupsList=[...groups.values()].filter(g=>g.trips.length).sort((a,b)=>a.name.localeCompare(b.name));
  const labels=type==='Transporter'?{all:'All Trips',ready:'All Trips',pending:'All Trips',billed:'All Trips'}:{all:'All Trips',ready:'Ready for Billing',pending:'Pending for Billing',billed:'Billed'};
  const total=groupsList.reduce((sum,g)=>sum+g.trips.length,0);
  const btn=(g,route,label,count)=>`<button type="button" onclick="window.EktaPartyLedger.selectSummary('${safe(g.key)}','${route}')" class="border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 bg-white hover:bg-slate-50 hover:border-blue-300 text-left">${safe(label)} <span class="font-bold ml-2">${count}</span> →</button>`;
  holder.innerHTML=`<div class="px-4 py-3 border-b border-slate-100 flex flex-wrap justify-between items-center gap-2"><div><div class="font-bold text-sm text-slate-800">Party-wise ${safe(labels[statusFilter]||'All Trips')}</div><div class="text-[11px] text-slate-500">Select a category to view its trip details</div></div><span class="text-xs font-bold text-slate-600">${total} trips · ${groupsList.length} companies</span></div>`+
   (groupsList.length?groupsList.map(g=>{
    const isHaier=type==='Billing Client'&&/\bHAIER\s+APPLIANCES\b/i.test(g.name);
    const counts={haier:0,other:0,review:0};
    if(isHaier)for(const t of g.trips)counts[haierRoute(t)]++;
    const actions=isHaier
      ?[btn(g,'haier','Haier to Haier',counts.haier),btn(g,'other','Haier to Other',counts.other),...(counts.review?[btn(g,'review','Needs POD Verification',counts.review)]:[])].join('')
      :btn(g,'all','All',g.trips.length);
    return `<div class="border-b border-slate-100 last:border-b-0 px-4 py-3"><div class="flex items-center justify-between gap-3"><div class="text-sm font-bold text-slate-800">${safe(g.name)}</div><span class="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg">${g.trips.length} trips</span></div><div class="flex flex-wrap gap-2 mt-2">${actions}</div></div>`;
   }).join(''):'<div class="p-6 text-center text-xs text-slate-500">No trips found for this status.</div>');
 }

function render(){
 if(!$('ektaLedgerPage'))return;
 ensureLedgerSummaryUI();
 $('ledgerBillingTab').className='px-4 py-2 rounded-lg text-xs font-bold '+(type==='Billing Client'?'bg-blue-600 text-white':'bg-slate-100');
 $('ledgerTransporterTab').className='px-4 py-2 rounded-lg text-xs font-bold '+(type==='Transporter'?'bg-orange-600 text-white':'bg-slate-100');
 const all=visible(),q=$('ledgerSearch').value,matching=all.filter(p=>matches(q,[p.party_code,p.name,p.city,p.zone,p.mobile,p.gst_number,...trips.filter(t=>String(t.party_id)===String(p.id)).flatMap(t=>[t.trip_number,t.lr_number,trucks.find(x=>String(x.id)===String(t.truck_id))?.truck_number])]));
 if(selected&&!all.some(p=>String(p.id)===String(selected))) {selected=null;selectedTrips.clear();}
 const list=trips.filter(t=>(type==='Transporter'?norm(t.trip_status)!=='cancelled':validTrip(t))&&all.some(p=>String(p.id)===String(t.party_id)));
   const drop=$('ledgerDropdown');
  if(drop){const options=matching.slice(0,80);drop.innerHTML=options.length?options.map((p,i)=>`<button type="button" data-drop-index="${i}" onclick="window.EktaPartyLedger.select('${safe(p.id)}')" class="w-full text-left px-3 py-2 border-b hover:bg-blue-50 ${i===dropdownIndex?'bg-blue-50':''}"><b class="text-xs">${safe(partyLabel(p))}</b></button>`).join(''):'<p class="p-3 text-xs text-slate-500">No matching party</p>';drop.classList.toggle('hidden',!dropdownOpen);}
  $('ledgerBillingCards')?.classList.toggle('hidden',type!=='Billing Client');
  const billed=t=>invoiceTripIds.has(String(t.id));
  const isReady=t=>!billed(t)&&ready(t)&&rate(t)>0;
  const counts={all:list.length,ready:list.filter(isReady).length,pending:list.filter(t=>!billed(t)&&!isReady(t)).length,billed:list.filter(billed).length};
  for(const [key,id] of Object.entries({all:'ledgerAllCount',ready:'ledgerReadyCount',pending:'ledgerPendingCount',billed:'ledgerBilledCount'}))if($(id))$(id).textContent=counts[key];
  document.querySelectorAll('[data-ledger-filter]').forEach(el=>el.classList.toggle('ring-2',el.dataset.ledgerFilter===statusFilter));
const p=all.find(x=>String(x.id)===String(selected));
 const activeGroup=summarySelection?[...all].filter(x=>summaryCompanyKey(x)===summarySelection.companyKey):[];
 $('ledgerPartyHeading').textContent=summarySelection?`${summaryCompanyName(activeGroup[0]||{})} · ${summarySelection.route==='haier'?'Haier to Haier':summarySelection.route==='other'?'Haier to Other':summarySelection.route==='review'?'Needs POD Verification':'All Trips'}`:p?`${partyLabel(p)} · Credit ${p.credit_days??0} days`:'All Billing Parties · Select a party to create an invoice';
 // The company/category is locked by the opening tab. Billing party is resolved
 // from each selected trip; no additional GST/location dropdown is needed.
 if(window.EKTA_BILLING_STANDALONE && summarySelection){
  const groupIds=new Set(activeGroup.map(x=>String(x.id)));
  if(selected && !groupIds.has(String(selected))){selected=null;selectedTrips.clear();}
 }
  const baseTs=summarySelection?list.filter(t=>activeGroup.some(x=>String(x.id)===String(t.party_id))&&(summarySelection.route==='all'||haierRoute(t)===summarySelection.route)):p?list.filter(t=>String(t.party_id)===String(p.id)):list;
 const statusTs=type!=='Billing Client'||statusFilter==='all'?baseTs:baseTs.filter(t=>statusFilter==='billed'?billed(t):statusFilter==='ready'?isReady(t):!billed(t)&&!isReady(t));
  const summaryTs=type!=='Billing Client'||statusFilter==='all'?list:list.filter(t=>statusFilter==='billed'?billed(t):statusFilter==='ready'?isReady(t):!billed(t)&&!isReady(t));
  const summaryMode=!selected&&!summarySelection;
  $('ledgerPartySummary')?.classList.toggle('hidden',!summaryMode);
  $('ledgerDetailArea')?.classList.toggle('hidden',summaryMode);
  if(summaryMode)renderPartySummary(matching,summaryTs);
 const ts=type!=='Billing Client'||!statementSearch.trim()?statusTs:statusTs.filter(t=>{
   const truck=trucks.find(x=>String(x.id)===String(t.truck_id));
   const dates=[t.lr_date,t.loading_date,t.start_date].filter(Boolean).flatMap(d=>{
     const iso=String(d).slice(0,10),m=iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
     return m?[iso,`${m[3]}-${m[2]}-${m[1]}`,`${m[3]}/${m[2]}/${m[1]}`]:[iso];
   });
   const pod=podSummary(t);const searchParty=parties.find(p=>String(p.id)===String(t.party_id));const fields=[searchParty?.party_code,String(searchParty?.party_code||'').split('__UNIT__')[0],searchParty?.name,searchParty?.city,truck?.truck_number,t.lr_number,pod.lrDisplay,...pod.lrs,...pod.dates,...pod.consignees,t.trip_number,t.loading_point,t.from_location,t.destination,t.to_location,...dates];
   const q=searchText(statementSearch),compact=v=>searchText(v).replace(/ /g,'');
   return matches(statementSearch,fields)||fields.some(v=>compact(v).includes(compact(q)));
 });
 $('ledgerStatementSearchWrap')?.classList.toggle('hidden',type!=='Billing Client');
 if($('ledgerStatementCount'))$('ledgerStatementCount').textContent=`${ts.length} of ${statusTs.length} trips`;
 const active=new Set(ts.map(t=>String(t.id)));for(const id of selectedTrips)if(!active.has(id))selectedTrips.delete(id);
   const billing=type==='Billing Client';
  const head=$('ledgerTripHead');
  if(head)head.innerHTML=billing?`<tr>${['Select','SN','Party Code','Vehicle No.','LR No.','LR Date','Qty','From','Party Name','To','Destination (Consignee)','Size','POD Status','Remarks','Reporting Date','Unloading Date','Freight ₹','Days','Billing','POD Documents'].map(x=>`<th class="p-2 text-left border-r border-slate-200">${x}</th>`).join('')}</tr>`:`<tr>${['Select','Trip','Truck','LR','Loading','Route','Freight ₹','POD','Billing'].map(x=>`<th class="p-2 text-left">${x}</th>`).join('')}</tr>`;
  $('ledgerBillingStatementHint')?.classList.toggle('hidden',!billing);
  $('ledgerTripRows').innerHTML=ts.length?ts.map((t,i)=>{
    const tr=trucks.find(x=>String(x.id)===String(t.truck_id));
    const pod=note(t.notes,'POD_STATUS')||'NOT SENT',r=rate(t),ok=isReady(t);
    const lockedPartyId=selectedTrips.size?String(trips.find(x=>String(x.id)===String(selectedTrips.values().next().value))?.party_id||''):String(selected||'');
    const canChoose=ok&&!billed(t)&&(!lockedPartyId||String(t.party_id)===lockedPartyId);
    const select=`<input type="checkbox" ${selectedTrips.has(String(t.id))?'checked':''} ${canChoose?'':'disabled'} onchange="window.EktaPartyLedger.toggle('${safe(t.id)}',this.checked)">`;
    const billingState=billed(t)?'Billed':ok?'Ready for billing':r<=0?'Rate pending':'POD pending';
    const verificationControls=summarySelection?.route==='review'&&/\bHAIER\s+APPLIANCES\b/i.test(String(parties.find(x=>String(x.id)===String(t.party_id))?.name||''))
     ?`<div class="mt-2 flex flex-wrap gap-1"><button type="button" class="rounded bg-blue-600 px-2 py-1 text-white text-[11px]" onclick="window.EktaPartyLedger.confirmHaierRoute('${safe(t.id)}','haier')">✓ Haier to Haier</button><button type="button" class="rounded bg-slate-700 px-2 py-1 text-white text-[11px]" onclick="window.EktaPartyLedger.confirmHaierRoute('${safe(t.id)}','other')">✓ Haier to Other</button></div>`:'';
    if(!billing)return `<tr class="border-t"><td class="p-2">${select}</td><td class="p-2">${safe(t.trip_number)}</td><td class="p-2">${safe(tr?.truck_number||'—')}</td><td class="p-2">${safe(t.lr_number||'—')}</td><td class="p-2">${safe(String(t.loading_date||'').slice(0,10)||'—')}</td><td class="p-2">${safe(t.loading_point||t.from_location||'—')} → ${safe(t.destination||t.to_location||'—')}</td><td class="p-2 text-right">${money(r)} ${billed(t)?'<span class="ml-2 text-slate-500">🔒 Locked</span>':`<button class="ml-2 text-blue-600 underline" onclick="window.EktaPartyLedger.editRate('${safe(t.id)}')">${r>0?'Edit':'Enter Rate'}</button>`}</td><td class="p-2">${safe(pod)}</td><td class="p-2">${billingState}</td></tr>`;
    // Only values actually present in current trip schema are shown. Consignee and Qty
    // require the verified per-POD record integration, not guessed from destination.
    const val=v=>safe(v==null||v===''?'—':v);
    const details=podSummary(t);
    const tripParty=parties.find(x=>String(x.id)===String(t.party_id));
    const isHaier=/\bHAIER\s+APPLIANCES\b/i.test(String(tripParty?.name||''));
    const consignees=isHaier?[suggestedConsignee(t)]:details.consignees;
    const savedConsignee=readConsigneeOverride(t.id);
    const consigneeText=savedConsignee!==null?savedConsignee:(consignees.join(' / ')||'');
    const inlineConsignee=`<input type="text" class="w-full min-w-[260px] bg-transparent border-b border-dashed border-slate-300 focus:border-blue-500 outline-none py-1" value="${safe(consigneeText)}" placeholder="Click and type consignee name" title="Click here; select/delete unwanted address. Saved when you leave this field (this browser only)." onblur="window.EktaPartyLedger.saveConsigneeInline('${safe(t.id)}',this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">`;
    const billingPartyCheck=consignorCheck(t,tripParty);
     const cells=[select,i+1,tripParty?.party_code||'—',tr?.truck_number,details.lrDisplay,details.dates.join(', ')||String(t.lr_date||'').slice(0,10),details.qty,t.loading_point||t.from_location,`<span title="${safe(billingPartyCheck)}">${safe(tripParty?.name||'—')}</span>${billingPartyCheck?` <span title="${safe(billingPartyCheck)}" class="${billingPartyCheck.startsWith('POD Consignor matches')?'text-emerald-700':'text-amber-600'}">${billingPartyCheck.startsWith('POD Consignor matches')?'✓':'⚠'}</span>`:''}`,t.destination||t.to_location,inlineConsignee,details.sizes.join(' / ')||t.vehicle_category||'—',pod,'—',reportingDate(t)||'—',unloadingDate(t)||'—',`${money(r)} ${billed(t)?'<span class="ml-2 text-slate-500" title="Issued invoice — freight locked">🔒 Locked</span>':`<button class="ml-2 text-blue-600 underline" onclick="window.EktaPartyLedger.editRate('${safe(t.id)}')">Edit</button>`}`,unloadingDays(t),billingState+verificationControls,`<button class="text-blue-600 underline mr-2" onclick="window.EktaPartyLedger.podAction('${safe(t.id)}','view')">View POD</button><button class="text-emerald-700 underline" onclick="window.EktaPartyLedger.podAction('${safe(t.id)}','download')">Download</button>`];
    return `<tr class="border-t hover:bg-blue-50/40" title="Trip ${safe(t.trip_number)}">${cells.map((v,j)=>`<td class="p-2 border-r border-slate-100">${j===0||j===8||j===10||j===16||j===18||j===19?v:val(v)}</td>`).join('')}</tr>`;
  }).join(''):`<tr><td colspan="${billing?20:9}" class="p-5 text-center text-slate-500">No loaded trips for this party.</td></tr>`;
$('ledgerMessage').textContent=`${type==='Billing Client'?'Billing Parties':'Transporters'}: ${all.length} records · ${matching.length} visible${rateTableReady?'':' · ⚠ Run supplied SQL to enable rate saving'}`;
 $('ledgerSelection').textContent=`${selectedTrips.size} selected · ${money(ts.filter(t=>selectedTrips.has(String(t.id))).reduce((s,t)=>s+rate(t),0))}`;
}
async function refresh(){if(loading)return;loading=true;$('ledgerMessage').textContent='Loading live Supabase records...';try{if(!S()?.from)throw Error('Supabase client unavailable');const [a,b,c,d,e]=await Promise.all([S().from('parties').select('*').order('name'),S().from('trips').select('*').order('created_at',{ascending:false}),S().from('trucks').select('id,truck_number'),S().from('party_trip_billing_rates').select('trip_id,freight_amount,reason,updated_at'),S().from('party_haier_route_verifications').select('trip_id,route_category')]);for(const r of [a,b,c])if(r.error)throw r.error;parties=a.data||[];trips=b.data||[];trucks=c.data||[];rateTableReady=!d.error;haierVerificationAvailable=!e.error;haierVerified={};if(!e.error)for(const x of e.data||[])if(['haier','other'].includes(x.route_category))haierVerified[String(x.trip_id)]=x.route_category;else console.warn('[HAIER verification] Unknown category',x);if(e.error)console.warn('[HAIER verification] SQL setup or read permission required:',e.error);overrides={};if(!d.error)for(const x of d.data||[])overrides[x.trip_id]=x;
 // Read-only: derive billed trips from issued invoices and their saved trip lines.
 // Never mark a trip billed from a draft or a missing invoice linkage.
 invoiceTripIds=new Set();
 const inv=await S().from('ekta_freight_invoices').select('id').eq('status','ISSUED');
 if(inv.error){console.warn('[EKTA LEDGER] Invoice status unavailable:',inv.error);$('ledgerMessage').textContent='Invoice status could not be verified: '+inv.error.message;}
 else if(inv.data?.length){
  const ids=inv.data.map(x=>x.id).filter(Boolean);
  for(let i=0;i<ids.length;i+=100){
   const lines=await S().from('ekta_freight_invoice_lines').select('trip_id').in('invoice_id',ids.slice(i,i+100));
   if(lines.error){invoiceTripIds.clear();console.warn('[EKTA LEDGER] Invoice lines unavailable:',lines.error);$('ledgerMessage').textContent='Invoice trip mapping could not be verified: '+lines.error.message;break;}
   for(const line of lines.data||[])if(line.trip_id)invoiceTripIds.add(String(line.trip_id));
  }
 }
 render();}catch(e){$('ledgerMessage').textContent='Unable to load: '+e.message;console.error('[EKTA LEDGER]',e);}finally{loading=false;}}
function editRate(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 if(invoiceTripIds.has(String(id))){alert('Invoice ISSUED: Billing freight is locked. Use the statutory correction workflow.');return;}
 const entered=prompt(`Billing freight for ${t.trip_number}\nTracking freight: ${money(t.freight_amount??t.revenue)}\nEnter new billing freight (₹):`,String(rate(t)));
 if(entered===null)return;
 const amount=Number(entered.trim().replace(/,/g,''));
 if(!Number.isFinite(amount)||amount<=0||amount>1000000000){alert('Enter a valid positive freight amount.');return;}
 const reason=prompt('Reason for billing freight adjustment (required):','Rate confirmed by office');
 if(reason===null)return;
 if(!reason.trim()){alert('Reason is required.');return;}
 saveRate(t,amount,reason.trim());
}
async function checkIssuedTripOnServer(tripId){
 const inv=await S().from('ekta_freight_invoices').select('id').eq('status','ISSUED');
 if(inv.error)throw Error('Cannot verify issued invoices: '+inv.error.message);
 const ids=(inv.data||[]).map(x=>x.id).filter(Boolean);
 for(let i=0;i<ids.length;i+=100){
  const lines=await S().from('ekta_freight_invoice_lines').select('trip_id').in('invoice_id',ids.slice(i,i+100)).eq('trip_id',tripId).limit(1);
  if(lines.error)throw Error('Cannot verify invoice lines: '+lines.error.message);
  if(lines.data?.length)return true;
 }
 return false;
}
async function saveRate(t,amount,reason){
 if(!rateTableReady){alert('Billing rate saving is unavailable.');return;}
 if(invoiceTripIds.has(String(t.id))){alert('Invoice ISSUED: Freight editing is locked.');return;}
 try{
  // Fail closed if Supabase cannot verify. This protects against stale browser state.
  if(await checkIssuedTripOnServer(String(t.id))){invoiceTripIds.add(String(t.id));render();alert('Invoice ISSUED: Freight editing is locked.');return;}
  const {error}=await S().from('party_trip_billing_rates').upsert({trip_id:t.id,party_id:t.party_id,freight_amount:amount,reason,updated_at:new Date().toISOString()},{onConflict:'trip_id'});
  if(error)throw error;
  overrides[t.id]={freight_amount:amount,reason};render();alert('Billing freight saved for '+t.trip_number+'. Tracking freight unchanged.');
 }catch(e){alert('Billing rate was NOT saved: '+e.message);console.error('[EKTA billing lock]',e);}
}
function toggle(id,on){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 if(on){
  if(invoiceTripIds.has(String(id))||!ready(t)||rate(t)<=0){alert('Only unbilled Ready for Billing trips with positive freight can be selected.');render();return;}
  // In a company group, different GST billing units must never share an invoice.
  const firstSelected=trips.find(x=>selectedTrips.has(String(x.id)));
  const lockedParty=firstSelected?.party_id||selected;
  if(lockedParty&&String(lockedParty)!==String(t.party_id)){
   alert('This trip belongs to another billing unit. Deselect the current trips before choosing it.');
   render();return;
  }
  // Keep the company working sheet visible; selecting one row must not hide its siblings.
  if(!summarySelection)selected=String(t.party_id);
  selectedTrips.add(String(id));
 }else{
  selectedTrips.delete(String(id));
  if(!selectedTrips.size&&window.EKTA_BILLING_STANDALONE)selected=null;
 }
 render();
}
function chooseBillingUnit(id){
 selected=id||null;selectedTrips.clear();render();
}
function preview(){const first=trips.find(t=>selectedTrips.has(String(t.id)));const billingPartyId=first?.party_id||selected;const p=parties.find(x=>String(x.id)===String(billingPartyId));if(!p){alert('Select one billing party before creating an invoice.');return;}const chosen=trips.filter(t=>selectedTrips.has(String(t.id))&&String(t.party_id)===String(billingPartyId)&&!invoiceTripIds.has(String(t.id))&&ready(t)&&rate(t)>0);if(!chosen.length){alert('Select at least one Ready for Billing trip with positive freight.');return;}if(!window.EktaInvoice){alert('Invoice module is not loaded.');return;}const lines=chosen.map(t=>({trip_id:t.id,truck:trucks.find(x=>String(x.id)===String(t.truck_id))?.truck_number||'',lr:podSummary(t).lrDisplay,lr_date:podSummary(t).dates.join(', ')||String(t.lr_date||'').slice(0,10),from:t.loading_point||t.from_location||'',to:t.destination||t.to_location||'',size:t.vehicle_category||'',freight:rate(t)}));
 const special=/\bHAIER\b|LX\s*PANTOS/i.test(String(p.name||''));
 if(special||chosen.length===1){window.EktaInvoice.openDraft({party:p,lines});return;}
 const previous=document.getElementById('ektaCommonBillingMode');if(previous)previous.remove();
 const overlay=document.createElement('div');overlay.id='ektaCommonBillingMode';overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#0f172a99;display:flex;align-items:center;justify-content:center;padding:16px';
 overlay.innerHTML=`<div role="dialog" aria-modal="true" aria-label="Invoice mode" style="width:min(490px,100%);background:white;border-radius:16px;padding:22px;box-shadow:0 20px 60px #0004;font:14px Arial,sans-serif"><h3 style="font-size:19px;font-weight:700;margin:0 0 8px">Create Invoices — ${safe(p.name)}</h3><p style="color:#475569;margin:0 0 16px">${chosen.length} selected trips · Same billing party / GSTIN</p><div style="display:grid;gap:10px"><button type="button" id="ektaCommonCombined" style="padding:13px;text-align:left;border:1px solid #cbd5e1;border-radius:10px;background:#eff6ff;font-weight:bold">Combined Invoice — ${chosen.length} trips in 1 draft</button><button type="button" id="ektaCommonSeparate" style="padding:13px;text-align:left;border:1px solid #cbd5e1;border-radius:10px;background:#ecfdf5;font-weight:bold">Separate Invoices — ${chosen.length} individual drafts</button></div><p style="font-size:12px;color:#64748b;margin:14px 0">Separate drafts are saved in Supabase only after your confirmation. No invoice will be issued automatically.</p><button type="button" id="ektaCommonCancel" style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px">Cancel</button></div>`;
 document.body.appendChild(overlay);
 const close=()=>overlay.remove();overlay.querySelector('#ektaCommonCancel').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close();};
 overlay.querySelector('#ektaCommonCombined').onclick=()=>{close();window.EktaInvoice.openDraft({party:p,lines});};
 overlay.querySelector('#ektaCommonSeparate').onclick=async()=>{if(!confirm('Save '+lines.length+' separate DRAFT invoices for '+p.name+'? No invoice numbers will be issued.'))return;const btn=overlay.querySelector('#ektaCommonSeparate');btn.disabled=true;btn.textContent='Saving drafts...';try{const result=await window.EktaInvoice.saveSeparateDrafts({party:p,lines});close();alert(result.saved+' separate draft invoice(s) saved. '+(result.error?'Stopped: '+result.error:'Open Invoice History to review each draft.'));}catch(e){btn.disabled=false;btn.textContent='Separate Invoices — retry';alert('Separate drafts were not completed: '+e.message);}};
}
function filter(s){statusFilter=s;summarySelection=null;selected=null;selectedTrips.clear();statementSearch='';if($('ledgerStatementSearch'))$('ledgerStatementSearch').value='';if($('ledgerSearch'))$('ledgerSearch').value='';dropdownOpen=false;render();}
 function setStatementSearch(value){statementSearch=String(value??'');render();}
 function searchInput(on){dropdownOpen=on;dropdownIndex=0;render();}
 function searchKey(e){const options=visible().filter(p=>matches($('ledgerSearch').value,[p.party_code,p.name,p.city,p.zone,p.mobile,p.gst_number]));if(e.key==='Escape'){dropdownOpen=false;render();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();dropdownOpen=true;dropdownIndex=Math.max(0,Math.min(options.length-1,dropdownIndex+(e.key==='ArrowDown'?1:-1)));render();}else if(e.key==='Enter'&&dropdownOpen&&options.length){e.preventDefault();select(options[dropdownIndex]?.id);}}
 function backToSummary(){if(window.EKTA_BILLING_STANDALONE){if(window.opener&&!window.opener.closed)window.opener.focus();return;}summarySelection=null;selected=null;selectedTrips.clear();statementSearch='';if($('ledgerStatementSearch'))$('ledgerStatementSearch').value='';if($('ledgerSearch'))$('ledgerSearch').value='';dropdownOpen=false;render();}
 function select(id){summarySelection=null;selected=id;selectedTrips.clear();dropdownOpen=false;const p=parties.find(x=>String(x.id)===String(id));if(p)$('ledgerSearch').value=partyLabel(p);render();}
 function podAction(id,action){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 if(!note(t.notes,'POD_DOC_PATH')&&!note(t.notes,'POD_DOC_PATH_2')&&!note(t.notes,'POD_DOC_PATH_3')){
  alert('No POD document uploaded for this trip yet.');return;
 }
 let overlay=document.getElementById('ektaLedgerPODOverlay');
 if(!overlay){
  overlay=document.createElement('div');overlay.id='ektaLedgerPODOverlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.7);display:flex;flex-direction:column;padding:12px;';
  overlay.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;color:white;font-weight:700;padding:0 8px 9px"><span>POD Documents — View / Download / OCR</span><button type="button" id="ektaLedgerPODClose" style="border:0;border-radius:7px;background:white;color:#173653;padding:8px 14px;cursor:pointer">✕ Close</button></div><iframe title="POD Documents" style="border:0;flex:1;width:100%;background:transparent;border-radius:12px" allow="clipboard-read; clipboard-write"></iframe>';
  document.body.appendChild(overlay);
  overlay.querySelector('#ektaLedgerPODClose').onclick=closePODOverlay;
 }
 overlay.style.display='flex';
 overlay.querySelector('iframe').src='pod.html?ledger_embed=1&trip_id='+encodeURIComponent(id);
}
function closePODOverlay(){const el=document.getElementById('ektaLedgerPODOverlay');if(el){el.querySelector('iframe').src='about:blank';el.remove();}refresh();}
 document.addEventListener('click',e=>{if(!e.target.closest('#ledgerSearchWrap')&&dropdownOpen){dropdownOpen=false;const d=$('ledgerDropdown');if(d)d.classList.add('hidden');}});
 function open(){$('ektaLedgerPage')?.classList.remove('hidden');refresh();}
function close(){if(window.EKTA_BILLING_STANDALONE){window.close();return;}$('ektaLedgerPage')?.classList.add('hidden');}
function invoiceHistoryScope(){if(!window.EKTA_BILLING_STANDALONE||!summarySelection)return null;const ids=parties.filter(p=>summaryCompanyKey(p)===summarySelection.companyKey).map(p=>String(p.id));return {partyIds:ids,companyName:summaryCompanyName(parties.find(p=>summaryCompanyKey(p)===summarySelection.companyKey)||{})};}
 window.EktaPartyLedger={invoiceHistoryScope,open,close,refresh,render,backToSummary,selectSummary,chooseBillingUnit,confirmHaierRoute,saveConsigneeInline,setType,select,searchInput,searchKey,filter,setStatementSearch,podAction,closePODOverlay,editRate,toggle,preview};
if(window.EKTA_BILLING_STANDALONE){
 document.addEventListener('DOMContentLoaded',async()=>{
  const params=new URLSearchParams(location.search);
  statusFilter=['all','ready','pending','billed'].includes(params.get('status'))?params.get('status'):'all';
  $('ektaLedgerPage')?.classList.remove('hidden');
  await refresh();
  const company=params.get('company'),route=params.get('route');
  if(company&&['haier','other','review','all'].includes(route))selectSummary(company,route);
 });
}
})();
