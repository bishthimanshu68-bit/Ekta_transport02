/* Ekta Transport Driver Khata — standalone; never writes to Trip Accounts. */
(() => {'use strict';
const $=id=>document.getElementById(id), money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2}),num=x=>Number(x)||0,fmt=x=>x?String(x).slice(0,10):'—',esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const client=()=>{const c=window.supabaseClient||window.ektaSupabaseClient||window.dbClient;return c&&typeof c.from==='function'?c:null};
const S={driver:null,drivers:[],trucks:[],assignments:[],trips:[],advances:[],expenses:[],payments:[],settlements:[],opening:null,vehicles:[],paper:true,currentId:null,loaded:false,sourceStatus:{},sourceRows:[],bankAdvances:[],cashAdvances:[],fuelRows:[],sourceReady:false,verifiedFuel:[],fuelReview:[],fuelIncomplete:false,fixedRates:[],fixedReady:false,fixedError:"",fixedConflicts:[]};
const say=(m,error=false)=>{$('message').textContent=m;$('message').style.color=error?'#b42335':'#1e5f8b'};
async function get(table,filter){const c=client();if(!c?.from)throw Error('Supabase client not connected. Load db.js and initialize window.supabaseClient.');let q=c.from(table).select('*');if(filter)for(const [k,v] of Object.entries(filter))q=q.eq(k,v);const {data,error}=await q;if(error)throw Error(`${table}: ${error.message}`);return data||[]}
async function insert(table,row){const c=client();if(!c?.from)throw Error('Supabase not connected');const {data,error}=await c.from(table).insert(row).select().single();if(error)throw Error(`${table}: ${error.message}`);return data}
async function update(table,id,row){const {error}=await client().from(table).update(row).eq('id',id);if(error)throw Error(`${table}: ${error.message}`)}
const rangeDate=r=>fmt(r.transaction_date||r.txn_datetime_raw||r.entry_date||r.advance_date||r.expense_date||r.payment_date||r.trip_date||r.loading_date||r.created_at);
const openingDate=()=>{const m=String(S.opening?.note||'').match(/\[EKTA_OPENING_DATE:(\d{4}-\d{2}-\d{2})\]/);return m?m[1]:''};
const openingKm=()=>{const m=String(S.opening?.note||'').match(/\[EKTA_OPENING_KM:([^\]]+)\]/);if(!m)return null;try{return JSON.parse(decodeURIComponent(m[1]))}catch{return null}};
const openingTotals=()=>{const m=String(S.opening?.note||'').match(/\[EKTA_OPENING_TOTALS:([^\]]+)\]/);if(!m)return {fixed:0,advance:0,diesel:0};try{const o=JSON.parse(decodeURIComponent(m[1]));return {fixed:num(o.fixed),advance:num(o.advance),diesel:num(o.diesel)}}catch{return {fixed:0,advance:0,diesel:0}}};
const effectiveFrom=()=>{const start=$('fromDate').value,cutoff=openingDate();if(!cutoff)return start;const d=new Date(cutoff+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);const next=d.toISOString().slice(0,10);return next>start?next:start};
const within=r=>{const d=rangeDate(r);return d!=='—'&&d>=effectiveFrom()&&d<=$('toDate').value};
const tripVehicle=t=>t.truck_id||t.vehicle_id||'';
const truckName=id=>S.trucks.find(t=>String(t.id)===String(id))?.truck_number||S.trucks.find(t=>String(t.id)===String(id))?.vehicle_number||'—';
const driverName=d=>d.name||d.driver_name||d.full_name||'Unnamed Driver';
function filteredTrips(){return S.trips.filter(t=>String(t.driver_id)===String(S.driver?.id)&&within(t)&&(!$('vehicleFilter').value||String(tripVehicle(t))===$('vehicleFilter').value))}
function filtered(rows){return rows.filter(within)}
// Fixed Kharcha Master: one undirected route; same-city routes are valid.
const routeNorm=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,' ');
const routeKey=(a,b)=>window.EktaLocation?window.EktaLocation.key(a,b):[routeNorm(a),routeNorm(b)].sort().join(' ⇄ ');
const tripOrigin=t=>t.from_location||t.loading_point||t.from||'';
const tripDestination=t=>t.to_location||t.destination||t.to||'';
function fixedInfo(t){
 const a=routeNorm(tripOrigin(t)),b=routeNorm(tripDestination(t));
 const result=window.EktaLocation?.resolve(S.fixedRates,a,b);
 if(result&&result.source!=='MISSING')return {amount:result.amount||0,...result};
 const old=t.fixed_kharcha??t.fixed_expense??t.driver_trip_expense??t.trip_kharcha;
 if(old!==null&&old!==undefined&&old!=='')return {amount:num(old),source:'TRIP',reason:'No master match; existing trip rate used — review'};
 return {amount:0,source:'MISSING',reason:result?.reason||'Route missing in Fixed Kharcha Master'};
}
function getFixed(t){return fixedInfo(t).amount}
async function loadFixedRates(){
 S.fixedReady=false;S.fixedError='';S.fixedRates=[];S.fixedConflicts=[];
 try{
  // Read every page; Supabase API can limit responses to 1000 rows.
  for(let off=0;off<20000;off+=500){
   const {data,error}=await client().from('fixed_kharcha_rates').select('id,from_location,to_location,amount').range(off,off+499);
   if(error)throw Error(error.message);
   S.fixedRates.push(...(data||[]));
   if((data||[]).length<500)break;
  }
  const grouped=new Map();
  for(const r of S.fixedRates){const k=routeKey(r.from_location,r.to_location);if(!grouped.has(k))grouped.set(k,new Set());grouped.get(k).add(num(r.amount))}
  S.fixedConflicts=[...grouped].filter(([,values])=>values.size>1).map(([k])=>k);
  S.fixedReady=true;
 }catch(e){S.fixedError=String(e.message||e);say('Fixed Kharcha Master load failed: '+S.fixedError,true)}
}
function fixedStatus(){
 const el=$('fixedRateStatus');if(!el)return;
 if(!S.fixedReady){el.textContent='Fixed Kharcha Master unavailable: '+(S.fixedError||'Not loaded');el.style.color='#b42335';return}
 const trips=filteredTrips(),missing=trips.filter(t=>fixedInfo(t).source==='MISSING'),conflicts=trips.filter(t=>fixedInfo(t).source==='CONFLICT'),legacy=trips.filter(t=>fixedInfo(t).source==='TRIP'),ncr=trips.filter(t=>fixedInfo(t).source==='NCR');
 el.textContent=`Master: ${S.fixedRates.length} routes loaded · ${trips.length-missing.length-conflicts.length-legacy.length} matched · ${ncr.length} NCR fallback · ${legacy.length} trip fallback · ${missing.length} missing · ${conflicts.length} conflicting`;
 el.style.color=missing.length||conflicts.length||legacy.length?'#a05b00':'#087c57';
}

function diesel(){const old=num($('oldKm').value),cur=num($('currentKm').value),avg=num($('average').value),taken=num($('dieselTaken').value),rate=num($('dieselRate').value),extra=num($('extraKm').value);const km=Math.max(0,cur-old),expected=avg>0?Math.max(0,km-extra)/avg:0,difference=expected-taken;return {km,expected,difference,amount:difference*rate,ready:!S.fuelIncomplete&&avg>0&&rate>0&&cur>=old&&$('oldKm').value!==''&&$('currentKm').value!==''&&$('dieselTaken').value!==''}}
function calc(){const trips=filteredTrips(),advs=filtered([...S.advances,...S.bankAdvances,...S.cashAdvances]),exps=filtered(S.expenses),pays=filtered(S.payments),fixed=trips.reduce((a,t)=>a+getFixed(t),0)+openingTotals().fixed,advance=advs.reduce((a,t)=>a+num(t.amount),0)+openingTotals().advance,expense=exps.reduce((a,t)=>a+num(t.amount),0),d=diesel(),opening=openingDate()?0:num(S.opening?.amount)*(S.opening?.side==='DRIVER_OWES'?-1:1),pay=pays.reduce((a,t)=>a+num(t.amount)*(t.direction==='PAID_TO_DRIVER'?-1:1),0);const credits=fixed+expense+Math.max(0,d.amount)+Math.max(0,opening)+Math.max(0,pay),debits=advance+(S.paper?100:0)+Math.max(0,-d.amount)+Math.max(0,-opening)+Math.max(0,-pay),net=credits-debits;return {trips,advs,exps,pays,fixed,advance,expense,d,opening,pay,credits,debits,net}}
function rowEmpty(n,msg){return `<tr><td colspan="${n}" class="small">${esc(msg)}</td></tr>`}
function render(){const x=calc();$('tripCount').textContent=x.trips.length;$('fixedStat').textContent=money(x.fixed);$('advanceStat').textContent=money(x.advance);$('expenseStat').textContent=money(x.expense);$('openingStat').textContent='Fixed '+money(openingTotals().fixed)+' · Advance '+money(openingTotals().advance)+' · Diesel '+openingTotals().diesel.toFixed(2)+' L';if($('openingDateView'))$('openingDateView').textContent=openingDate()?'Opening Date: '+openingDate():'Opening Date: Not set';$('openingSide').textContent=openingDate()?'Old book totals (included in account)':'Not set';$('driverOwes').textContent=money(Math.max(0,-x.net));$('companyOwes').textContent=money(Math.max(0,x.net));$('totalKm').textContent=x.d.km.toLocaleString('en-IN');$('expectedDiesel').textContent=x.d.expected.toFixed(2)+' L';$('dieselDiff').textContent=x.d.difference.toFixed(2)+' L';$('dieselExplanation').textContent=x.d.ready?`${x.d.difference>=0?'Diesel saved (Ekta Transport Company Ke Naam)':'Extra diesel taken (driver ke naam)'}: ${money(Math.abs(x.d.amount))}`:'KM, average, diesel taken and rate भरकर Diesel calculation verify करें।';
fixedStatus();$('tripRows').innerHTML=(openingDate()?`<tr><td>${esc(openingDate())}</td><td>Old Book</td><td>Opening Fixed Kharcha</td><td class="num">${money(openingTotals().fixed)}</td></tr>`:'')+x.trips.map(t=>`<tr><td>${esc(rangeDate(t))}</td><td>${esc(truckName(tripVehicle(t)))}</td><td>${esc(t.from_location||t.loading_point||t.from||'—')} → ${esc(t.to_location||t.destination||t.to||'—')}</td><td class="num">${money(getFixed(t))}${['MASTER','NCR'].includes(fixedInfo(t).source)&&fixedInfo(t).reason==='Exact route'?'':` <span title="${esc(fixedInfo(t).reason||'')}" style="color:#a05b00">⚠ ${esc(fixedInfo(t).source)}</span>`}</td></tr>`).join('')||rowEmpty(4,'No trips in selected period');
$('advanceRows').innerHTML=(openingDate()?`<tr><td>${esc(openingDate())}</td><td>Opening Advance · Old Book</td><td>Opening Hissab</td><td class="num">${money(openingTotals().advance)}</td></tr>`:'')+x.advs.map(t=>`<tr><td>${esc(rangeDate(t))}</td><td>${esc(t.source||t.payment_mode||t.mode||'Advance')}</td><td>${esc(t.reference||t.utr||t.transaction_ref||'—')}</td><td class="num">${money(t.amount)}</td></tr>`).join('')||rowEmpty(4,'No linked advances');
$('expenseRows').innerHTML=x.exps.map(t=>`<tr><td>${esc(rangeDate(t))}</td><td>${esc(truckName(t.truck_id))}</td><td>${esc(t.expense_type)}</td><td class="num">${money(t.amount)}</td></tr>`).join('')||rowEmpty(4,'No expenses');
$('paymentRows').innerHTML=x.pays.map(t=>`<tr><td>${esc(rangeDate(t))}</td><td>${t.direction==='PAID_TO_DRIVER'?'Paid to Driver':'Recovered from Driver'}</td><td>${esc(t.mode)}</td><td>${esc(t.reference)}</td><td class="num">${money(t.amount)}</td></tr>`).join('')||rowEmpty(5,'No payments / recoveries');
const items=(arr)=>arr.filter(t=>t[1]>0).map(t=>`<tr><td>${esc(t[0])}</td><td class="num">${money(t[1])}</td></tr>`).join('');$('debitRows').innerHTML=items([['Driver Advance',x.advance],['Extra Diesel',Math.max(0,-x.d.amount)],['Paper Charge',S.paper?100:0],['Opening: Driver ke naam',Math.max(0,-x.opening)],['Paid to Driver',Math.max(0,-x.pay)]])+`<tr><td><b>Total driver ke naam</b></td><td class="num"><b>${money(x.debits)}</b></td></tr>`;$('creditRows').innerHTML=items([['Fixed Trip Kharcha',x.fixed],['Driver Running Expenses',x.expense],['Diesel Saved',Math.max(0,x.d.amount)],['Opening: Ekta Transport Company Ke Naam',Math.max(0,x.opening)],['Recovery Received',Math.max(0,x.pay)]])+`<tr><td><b>Total Ekta Transport Company Ke Naam</b></td><td class="num"><b>${money(x.credits)}</b></td></tr>`;}
function setDates(){const d=new Date(),end=d.toISOString().slice(0,10),start=new Date(d);start.setMonth(start.getMonth()-3);$('fromDate').value=start.toISOString().slice(0,10);$('toDate').value=end}
// Show vehicles from historical assignments AND trip records, not just current trips.
function driverVehicleIds(driverId){
 const ids=new Set();
 S.trips.forEach(t=>{if(String(t.driver_id)===String(driverId)&&tripVehicle(t))ids.add(String(tripVehicle(t)))});
 S.assignments.forEach(a=>{if(String(a.driver_id)===String(driverId)&&a.truck_id)ids.add(String(a.truck_id))});
 return [...ids];
}
function driverVehicleLabels(driverId){return driverVehicleIds(driverId).map(id=>truckName(id)).filter(v=>v&&v!=='—')}
const searchNorm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function chooseSearchDriver(id){
 const d=S.drivers.find(x=>String(x.id)===String(id));if(!d)return;
 $('driverSelect').value=String(d.id);
 $('driverNameSearch').value=driverName(d);
 $('search').value='';
 $('vehicleMatches').hidden=true;$('nameMatches').hidden=true;
 say(`${driverName(d)} selected. Click Load Khata to view records.`);
}
function showLiveMatches(container,matching,kind){
 const box=$(container);box.hidden=false;
 if(!matching.length){box.innerHTML='<div class="live-empty">No matching driver / vehicle</div>';return}
 box.innerHTML=matching.slice(0,35).map(d=>{
  const vehicles=driverVehicleLabels(d.id);
  return `<button type="button" class="live-result" data-driver-id="${esc(d.id)}">${esc(kind==='vehicle'?(vehicles.join(', ')||'Vehicle not linked'):driverName(d))}<small>${esc(kind==='vehicle'?driverName(d):(vehicles.join(', ')||'Vehicle not linked'))}</small></button>`;
 }).join('')+(matching.length>35?`<div class="live-empty">Showing first 35 of ${matching.length}; type more to narrow results</div>`:'');
}
function filterDrivers(){
 const vehicleTerm=searchNorm($('search').value),nameTerm=searchNorm($('driverNameSearch').value),select=$('driverSelect');
 const previous=select.value;
 const vehicleMatches=vehicleTerm?S.drivers.filter(d=>driverVehicleLabels(d.id).some(v=>searchNorm(v).includes(vehicleTerm))):[];
 const nameMatches=nameTerm?S.drivers.filter(d=>searchNorm(driverName(d)).includes(nameTerm)):[];
 const matching=vehicleTerm?vehicleMatches:nameTerm?nameMatches:S.drivers;
 select.innerHTML='<option value="">'+(matching.length?'Select driver':'No matching driver')+'</option>'+matching.map(d=>{
 const vehicles=driverVehicleLabels(d.id);
 return `<option value="${esc(d.id)}">${esc(driverName(d))}${vehicles.length?' — '+esc(vehicles.join(', ')):' — Vehicle not linked'}</option>`;
 }).join('');
 if(matching.some(d=>String(d.id)===String(previous)))select.value=previous;
 else if(matching.length===1&&(vehicleTerm||nameTerm))select.value=String(matching[0].id);
 $('vehicleMatches').hidden=!vehicleTerm;
 $('nameMatches').hidden=!nameTerm;
 if(vehicleTerm)showLiveMatches('vehicleMatches',vehicleMatches,'vehicle');
 if(nameTerm)showLiveMatches('nameMatches',nameMatches,'name');
}

async function init(){setDates();if(!client()?.from){$('setupNotice').className='note error';$('setupNotice').textContent='Database client unavailable. Confirm that the existing db.js is in this folder and exposes window.supabaseClient.';say('DB not connected: keep your existing db.js beside driver-khata.html. It must initialize window.supabaseClient. No database changes were made.',true);return}try{[S.drivers,S.trucks,S.trips]=await Promise.all([get('drivers'),get('trucks'),get('trips')]);await loadFixedRates();try{S.assignments=await get('truck_driver_assignments')}catch(e){S.assignments=[];say('Assignment history unavailable: '+e.message,true)}filterDrivers();$('setupNotice').hidden=true;say('Drivers and trips loaded. Select a driver.')}catch(e){$('setupNotice').className='note error';$('setupNotice').textContent='Database read failed: '+e.message;say(e.message,true)}}
async function carryForwardVehicleKm(){
 const vehicleId=$('vehicleFilter').value;
 $('oldKm').value='';
 if(!vehicleId)return;
 const c=client();
 const before=$('fromDate').value;
 // Look up the vehicle, not the current driver. Only a previously FINAL settlement
 // with an earlier period can become the next opening reading.
 const {data,error}=await c.from('driver_khata_settlements')
  .select('id,to_date,snapshot').eq('vehicle_id',vehicleId).eq('status','FINAL')
  .lt('to_date',before).order('to_date',{ascending:false}).limit(50);
 if(error){say('Previous vehicle KM lookup failed: '+error.message,true);return}
 const prior=(data||[]).find(r=>Number.isFinite(Number(r.snapshot?.diesel?.current_km))&&r.snapshot?.diesel?.current_km!==null&&r.snapshot?.diesel?.current_km!==undefined);
 if(prior){$('oldKm').value=String(prior.snapshot.diesel.current_km);render();return}
 const km=openingKm();
 if(km&&String(km.vehicle_id)===String(vehicleId))$('oldKm').value=String(km.reading);
 render();
}
function vehicleOptions(){
 const ids=driverVehicleIds(S.driver?.id);
 $('vehicleFilter').innerHTML='<option value="">All vehicles</option>'+ids.map(id=>`<option value="${esc(id)}">${esc(truckName(id))}</option>`).join('');
}

async function load(){const id=$('driverSelect').value;if(!id){say('Select driver first.',true);return}S.driver=S.drivers.find(d=>String(d.id)===id);S.loaded=false;await loadFixedRates();$('autoSourceStatus').textContent='Loading Bank, HPCL, Pump and Cash Diesel…';$('autoSourceRows').innerHTML=rowEmpty(6,'Loading source entries…');say('Loading '+driverName(S.driver)+' account and diesel entries…');try{const [a,e,p,o,h]=await Promise.all([get('driver_advances',{driver_id:id}),get('driver_khata_expenses',{driver_id:id}),get('driver_khata_payments',{driver_id:id}),get('driver_khata_openings',{driver_id:id}),get('driver_khata_settlements',{driver_id:id})]);S.advances=a.filter(t=>!['CANCELLED','REJECTED'].includes(String(t.status||'').toUpperCase()));S.expenses=e;S.payments=p;S.opening=o.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]||null;S.settlements=h;vehicleOptions();S.loaded=true;await carryForwardVehicleKm();await loadAutoSources(id);render();say(`${driverName(S.driver)} loaded. Bank matched by Driver ID; fuel needs verification before settlement.`)}catch(e){$('autoSourceStatus').textContent='Load failed: '+e.message;$('autoSourceRows').innerHTML=rowEmpty(6,'Unable to load account. See error above.');say('Driver Khata could not load: '+e.message,true)}}

const normalVehicle=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function sourceRead(table){const db=client();let all=[];for(let off=0;off<10000;off+=500){const {data,error}=await db.from(table).select('*').range(off,off+499);if(error)throw Error(error.message);all.push(...(data||[]));if((data||[]).length<500)break;}return all;}
function sourceDate(r){
 const raw=String(r.transaction_date||r.entry_date||r.txn_datetime_raw||r.created_at||'').trim();
 if(!raw)return '—';
 const iso=raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
 if(iso)return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
 const dmy=raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
 if(dmy)return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
 return '—';
}
function sourceVehicle(r){return normalVehicle(r.actual_vehicle||r.vehicle||r.vehicle_number||r.original_vehicle||'')}
function hpclVehicle(r){
 const actual=normalVehicle(r.actual_vehicle),original=normalVehicle(r.original_vehicle);
 const isTruck=v=>v&&v!=='PAID'&&v!=='PENDING'&&v!=='UNKNOWN'&&v!=='NA';
 return isTruck(actual)?actual:isTruck(original)?original:'';
}

// Verify the driver operating this vehicle on the transaction date, not the current driver.
function fuelDriverMatch(driverId,vehicle,date){
 const truck=S.trucks.find(t=>normalVehicle(t.truck_number||t.vehicle_number)===vehicle);
 if(!truck||!S.assignments.length)return false;
 const active=S.assignments.filter(a=>String(a.truck_id)===String(truck.id)&&
   String(a.assigned_from||a.created_at||'').slice(0,10)<=date&&
   (!a.assigned_until||String(a.assigned_until).slice(0,10)>=date));
 const drivers=[...new Set(active.map(a=>String(a.driver_id)))];
 return drivers.length===1&&drivers[0]===String(driverId);
}
function updateDieselTaken(){
 const selected=$('vehicleFilter').value;
 const vehicle=selected?normalVehicle(truckName(selected)):'';
 const start=effectiveFrom(),end=$('toDate').value;
 const entries=S.verifiedFuel.filter(x=>x.date>=start&&x.date<=end&&(!vehicle||x.vehicle===vehicle));
 // Opening diesel belongs to the old book, never charge it again.
  const total=entries.reduce((sum,x)=>sum+x.litres,0);
 $('dieselTaken').value=total.toFixed(2);
 $('dieselTaken').readOnly=true;
 $('dieselTaken').title='Automatically calculated from verified HPCL / fuel issue records; review entries are excluded';
 const totalBox=$('dieselAutoSummary');
 if(totalBox)totalBox.textContent=`New-period Diesel Taken: ${total.toFixed(2)} L (${entries.length} entries) · Old Book: ${openingTotals().diesel.toFixed(2)} L (excluded) · ${S.fuelReview.length} records require review${S.fuelIncomplete?' · Final settlement blocked':''}`;
}

function renderSources(){
 const adv=$('autoAdvanceRows'),fuel=$('autoDieselRows');
 const advances=S.sourceRows.filter(r=>r.date>=effectiveFrom()&&/Advance/i.test(r.source));
 const diesel=S.sourceRows.filter(r=>r.date>=effectiveFrom()&&!/Advance/i.test(r.source));
 const tr=r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.source)}</td><td>${esc(r.vehicle||'—')}</td><td>${esc(r.description)}</td><td class="num">${esc(r.value)}</td><td>${esc(r.status)}</td></tr>`;
 if(adv)adv.innerHTML=advances.map(tr).join('')||rowEmpty(6,'No linked advances');
 if(fuel)fuel.innerHTML=(openingDate()?`<tr><td>${esc(openingDate())}</td><td>Opening Diesel · Old Book</td><td>—</td><td>Opening Hissab</td><td class="num">${openingTotals().diesel.toFixed(2)} L</td><td>Old Book · Excluded from new settlement</td></tr>`:'')+(diesel.map(tr).join('')||(!openingDate()?rowEmpty(6,'No diesel transactions'):''));
 const old=$('autoSourceRows');if(old)old.innerHTML=S.sourceRows.map(tr).join('')||rowEmpty(6,'No source records');
 const st=$('autoSourceStatus');if(st)st.textContent=Object.entries(S.sourceStatus).map(([k,v])=>`${k}: ${v}`).join(' | ');
 const totalAdv=filtered([...S.advances,...S.bankAdvances,...S.cashAdvances]).reduce((s,r)=>s+num(r.amount),0)+openingTotals().advance;
 if($('sourceAdvanceTotal'))$('sourceAdvanceTotal').textContent=money(totalAdv);
 const fuelTotal=S.verifiedFuel.filter(x=>x.date>=effectiveFrom()&&x.date<=$('toDate').value).reduce((s,r)=>s+r.litres,0);
 if($('sourceDieselTotal'))$('sourceDieselTotal').textContent=fuelTotal.toFixed(2)+' L (new period)';
}
async function loadAutoSources(id){
 S.sourceRows=[];S.bankAdvances=[];S.cashAdvances=[];S.fuelRows=[];S.verifiedFuel=[];S.fuelReview=[];S.fuelIncomplete=false;S.sourceStatus={};S.sourceReady=false;
 const jobs=[['Bank', 'account_transactions'],['HPCL','hpcl_fuel_transactions'],['Pump','ekta_pump_ledger'],['Cash Diesel','diesel_cash_entries'],['Cash Advance','cash_ledger_entries']];
 const results=await Promise.allSettled(jobs.map(x=>sourceRead(x[1])));
 const start=effectiveFrom(),end=$('toDate').value,validDate=d=>d!=='—'&&d>=start&&d<=end;
 results.forEach((result,i)=>{
  const [name]=jobs[i];if(result.status==='rejected'){S.sourceStatus[name]='Read failed: '+result.reason.message;return}
  const rows=result.value;S.sourceStatus[name]='Read '+rows.length+' rows';
  if(name==='Bank'){
   // Bank diesel is a fuel issue, not a driver cash advance. Attribute only to
   // the unique driver assigned to the saved truck on the transaction date.
   // Read existing account_transactions; NEVER insert a second fuel transaction.
   const assignedVehicles=new Set(driverVehicleIds(id).map(vehicleId=>normalVehicle(truckName(vehicleId))));
   for(const r of rows){
    const date=sourceDate(r);
    if(!validDate(date)||String(r.posting_status||'').toUpperCase()!=='CONFIRMED'||String(r.category||'').toUpperCase()!=='DIESEL')continue;
    const truck=S.trucks.find(t=>String(t.id)===String(r.truck_id));
    const vehicle=normalVehicle(truck?.truck_number||truck?.vehicle_number);
    if(!vehicle||!assignedVehicles.has(vehicle))continue;
    const litres=num(r.quantity_litres);
    const key='Bank:'+String(r.id);
    if(S.fuelRows.some(x=>x.key===key))continue;
    const attributable=litres>0&&fuelDriverMatch(id,vehicle,date);
    const entry={source:'Bank Diesel',record:r,date,vehicle,litres,key,verified:attributable};
    S.fuelRows.push(entry);
    if(attributable)S.verifiedFuel.push(entry);else S.fuelReview.push(entry);
    S.sourceRows.push({date,source:'Bank Diesel',vehicle,description:r.reference_number||r.bank_narration||'',value:litres>0?litres.toFixed(2)+' L':money(r.debit),status:attributable?'Verified · Included in Diesel Taken':'Review driver assignment / litres · Not counted'});
   }
   for(const r of rows){const date=sourceDate(r);if(!validDate(date)||String(r.posting_status).toUpperCase()!=='CONFIRMED'||String(r.category).toUpperCase()!=='DRIVER_ADVANCE')continue;
    if(String(r.driver_id)!==String(id))continue; // strict identity; never use currently assigned driver
    const amount=num(r.debit);if(amount<=0)continue;
    const duplicate=S.advances.some(a=>String(a.source_transaction_id||a.account_transaction_id||'')===String(r.id));
    if(!duplicate){S.bankAdvances.push({id:r.id,driver_id:id,amount,advance_date:date,source:'Bank Statement',reference:r.reference_number||r.bank_narration||'',source_table:'account_transactions'});}
    S.sourceRows.push({date,source:'Bank Advance',vehicle:truckName(r.truck_id),description:r.reference_number||r.bank_narration||'',value:money(amount),status:duplicate?'Already linked (not added)':'Matched by Driver ID'});
   }
  } else if(name==='Cash Advance'){
   for(const r of rows){
    const date=sourceDate(r);
    if(!validDate(date)||String(r.entry_kind).toUpperCase()!=='CASH_OUT'||String(r.category||'').trim().toLowerCase()!=='driver advance')continue;
    // Never attribute a cash payment using today's truck assignment or a free-text name.
    if(String(r.driver_id||'')!==String(id))continue;
    const amount=num(r.amount);if(amount<=0)continue;
    const duplicate=[...S.advances,...S.bankAdvances].some(a=>String(a.source_transaction_id||a.cash_entry_id||a.source_id||'')===String(r.id));
    if(!duplicate)S.cashAdvances.push({id:r.id,driver_id:id,amount,advance_date:date,source:'Cash Book',reference:r.reference_no||r.remarks||'',source_table:'cash_ledger_entries'});
    S.sourceRows.push({date,source:'Cash Advance',vehicle:r.truck_number||'—',description:r.reference_no||r.paid_to||r.remarks||'',value:money(amount),status:duplicate?'Already linked (not added)':'Matched by Driver ID'});
   }
  } else {
   const assignedVehicles=new Set(driverVehicleIds(id).map(vehicleId=>normalVehicle(truckName(vehicleId))));
   for(const r of rows){const date=sourceDate(r);if(!validDate(date))continue;
    const vehicle=name==='HPCL'?hpclVehicle(r):sourceVehicle(r);if(!vehicle||!assignedVehicles.has(vehicle))continue;
    const status=name==='HPCL'?String(r.review_status||''):'Review driver/date';
    if(name==='HPCL'&&String(r.review_status).toUpperCase()!=='APPROVED')continue;
    const litres=num(r.litres??r.quantity_litres);
    // Only actual fuel issues with a positive litre value can be counted.
    // Pump ledger includes credits, payments and non-fuel records: never count those as diesel.
    const fuelKind=String(r.entry_type||r.transaction_type||r.kind||r.category||'').toUpperCase();
    const pumpIssue=name!=='Pump'||(/DIESEL|FUEL|ISSUE|SALE|PURCHASE/.test(fuelKind)&&!/PAYMENT|CREDIT|BANK|TDS|ADVANCE/.test(fuelKind));
    const uniqueKey=name+':'+String(r.id||r.txn_id||r.reference_number||JSON.stringify(r));
    if(S.fuelRows.some(x=>x.key===uniqueKey))continue;
    const attributable=pumpIssue&&litres>0&&fuelDriverMatch(id,vehicle,date);
    const entry={source:name,record:r,date,vehicle,litres,key:uniqueKey,verified:attributable};
    S.fuelRows.push(entry);
    if(attributable)S.verifiedFuel.push(entry);else S.fuelReview.push(entry);
    S.sourceRows.push({date,source:name,vehicle,description:[r.txn_id||r.reference||r.reference_number||'',r.pump_name||r.kind||''].filter(Boolean).join(' · '),value:litres?litres.toFixed(2)+' L':money(r.amount),status:attributable?'Verified · Included in Diesel Taken':'Review only · Not counted'});
   }
  }
 });
 S.sourceReady=results.every(r=>r.status==='fulfilled');
 // An unread source or ambiguous fuel attribution must not silently produce a final diesel figure.
 S.fuelIncomplete=!S.sourceReady||S.fuelReview.some(x=>x.litres>0);
 updateDieselTaken();
 renderSources();
 if(S.bankAdvances.length)say(`Verified Bank Advances: ${S.bankAdvances.length}. Fuel rows are review-only until historical trip mapping is confirmed.`);
 if(!S.sourceReady)say('Some source tables could not be read. Review Auto Source status; Final save is blocked.',true);
}
function openModal(title,fields,save){
 $('modalTitle').textContent=title;
 $('modalFields').innerHTML=fields+'<div id="modalError" role="alert" style="display:none;color:#a32335;background:#fff1f2;border:1px solid #fecdd3;padding:9px;border-radius:6px;margin:8px 0;white-space:pre-wrap"></div>';
 $('modal').classList.add('show');
 const button=$('modalSave');button.disabled=false;button.textContent='Save';
 let busy=false;
 const submit=async()=>{
  if(busy)return;
  const err=$('modalError');err.style.display='none';err.textContent='';
  busy=true;button.disabled=true;button.textContent='Saving…';
  try{await save();$('modal').classList.remove('show');await load();}
  catch(e){const message=String(e?.message||e);err.textContent=message+( /row.level security|permission denied|42501/i.test(message)?'\nSupabase permission (RLS) is blocking this save. An authorized database policy is required; do not disable RLS.':'');err.style.display='block';say('Save failed: '+message,true)}
  finally{busy=false;button.disabled=false;button.textContent='Save'}
 };
 button.onclick=submit;
 $('modalFields').onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'&&e.target.tagName!=='SELECT'&&!e.isComposing){e.preventDefault();submit()}};
}

const f=(id,label,type='text',extra='')=>`<div class="field"><label>${label}</label><input id="m_${id}" type="${type}" ${extra}></div>`;
function requireDriver(){if(!S.loaded){say('Load driver first.',true);return false}return true}
$('openingBtn').onclick=()=>{if(!requireDriver())return;const o=openingTotals();openModal('Opening Hissab — Old Book',`<p class="small">Old book totals through the opening date. Online entries start the next day. Old diesel is shown as history only and excluded from the new diesel calculation. Start new KM readings from the cutoff.</p><div class="field"><label>Opening Date</label><input type="date" id="m_openDate" required value="${openingDate()||new Date().toISOString().slice(0,10)}"></div>${f('fixed','Total Fixed Kharcha ₹','number',`min="0" step="0.01" value="${o.fixed}" required`)}${f('advance','Total Advance ₹','number',`min="0" step="0.01" value="${o.advance}" required`)}${f('diesel','Total Diesel Taken (Litres)','number',`min="0" step="0.01" value="${o.diesel}" required`)}<div class="field"><label>Vehicle at Opening KM</label><select id="m_openVehicle"><option value="">Select vehicle</option>${$('vehicleFilter').innerHTML.replace('All vehicles','Select vehicle')}</select></div>${f('openKm','Closing Odometer KM at Opening','number',`min="0" step="1" value="${openingKm()?.reading??''}"`)}${f('note','Old book reference / remarks')}`,async()=>{const date=$('m_openDate').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Select valid Opening Date');const vals={fixed:num($('m_fixed').value),advance:num($('m_advance').value),diesel:num($('m_diesel').value)};if(Object.entries(vals).some(([k,v])=>!Number.isFinite(v)||v<0||$('m_'+k).value===''))throw Error('Enter valid non-negative opening totals');const readingRaw=$('m_openKm').value.trim();const vehicleId=$('m_openVehicle').value;if(readingRaw===''||!Number.isFinite(Number(readingRaw))||Number(readingRaw)<0)throw Error('Enter the vehicle KM reading at opening');if(!vehicleId)throw Error('Select vehicle for the opening KM reading');if(!confirm('Old book totals through '+date+' will be included once. Online transactions after this date will be added. Continue?'))return;const km={vehicle_id:vehicleId,reading:Number(readingRaw)};const note='[EKTA_OPENING_DATE:'+date+'][EKTA_OPENING_TOTALS:'+encodeURIComponent(JSON.stringify(vals))+'][EKTA_OPENING_KM:'+encodeURIComponent(JSON.stringify(km))+'] '+$('m_note').value;await insert('driver_khata_openings',{driver_id:S.driver.id,amount:0,side:'COMPANY_OWES',note})})};
$('addExpenseBtn').onclick=()=>{if(!requireDriver())return;openModal('Add Running Expense',`${f('date','Expense date','date',`value="${$('toDate').value}"`)}<div class="field"><label>Vehicle</label><select id="m_truck"><option value="">No vehicle selected</option>${$('vehicleFilter').innerHTML.replace('All vehicles','Select vehicle')}</select></div><div class="field"><label>Expense type</label><select id="m_type">${['Puncture','RTO / Police','Toll','Parking','Work','Food','Others'].map(v=>`<option>${v}</option>`).join('')}</select></div>${f('amount','Amount ₹','number','min="0.01" step="0.01"')}${f('note','Remarks / Bill reference')}`,async()=>{if(!$('m_date').value)throw Error('Select Expense date');if(num($('m_amount').value)<=0)throw Error('Enter valid amount');await insert('driver_khata_expenses',{driver_id:S.driver.id,truck_id:$('m_truck').value||null,expense_date:$('m_date').value,expense_type:$('m_type').value,amount:num($('m_amount').value),note:$('m_note').value})})};
$('addAdvanceBtn').onclick=()=>{if(!requireDriver())return;openModal('Manual Driver Advance',`${f('date','Advance date','date',`value="${$('toDate').value}"`)}<div class="field"><label>Source</label><select id="m_source"><option>Office Cash</option><option>Pump Cash</option><option>Other</option></select></div>${f('amount','Amount ₹','number','min="0.01" step="0.01"')}${f('reference','Reference / Remark')}`,async()=>{if(num($('m_amount').value)<=0)throw Error('Enter valid amount');await insert('driver_advances',{driver_id:S.driver.id,advance_date:$('m_date').value,amount:num($('m_amount').value),source:$('m_source').value,reference:$('m_reference').value})})};
$('paymentBtn').onclick=()=>{if(!requireDriver())return;openModal('Payment / Recovery',`${f('date','Payment date','date',`value="${$('toDate').value}"`)}<div class="field"><label>Direction</label><select id="m_direction"><option value="PAID_TO_DRIVER">Paid to driver</option><option value="RECOVERED_FROM_DRIVER">Recovered from driver</option></select></div><div class="field"><label>Mode</label><select id="m_mode"><option>Cash</option><option>Bank</option><option>Pump</option><option>Other</option></select></div>${f('amount','Amount ₹','number','min="0.01" step="0.01"')}${f('reference','UTR / Voucher / Remark')}`,async()=>{if(num($('m_amount').value)<=0)throw Error('Enter valid amount');await insert('driver_khata_payments',{driver_id:S.driver.id,payment_date:$('m_date').value,direction:$('m_direction').value,mode:$('m_mode').value,amount:num($('m_amount').value),reference:$('m_reference').value})})};
$('historyBtn').onclick=()=>{if(!requireDriver())return;openModal('Saved Settlement History',`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Status</th><th>Final balance</th></tr></thead><tbody>${S.settlements.map(s=>`<tr><td>${esc(fmt(s.created_at))}</td><td>${esc(s.status)}</td><td>${money(Math.abs(num(s.net_balance)))} ${num(s.net_balance)<0?'Driver ke naam':'Ekta Transport Company Ke Naam'}</td></tr>`).join('')||rowEmpty(3,'No saved settlements')}</tbody></table></div>`,async()=>{})};
$('saveBtn').onclick=async()=>{if(!requireDriver())return;const x=calc();if(!S.sourceReady){say('Source reads incomplete. Settlement save blocked.',true);return}if(S.fuelIncomplete){say('Fuel source read or driver attribution is incomplete. Final settlement blocked until review.',true);return}if(!S.fixedReady){say('Fixed Kharcha Master unavailable. Settlement save blocked.',true);return}if(x.trips.some(t=>fixedInfo(t).source==='MISSING'||fixedInfo(t).source==='CONFLICT'||fixedInfo(t).source==='TRIP'||getFixed(t)<=0)){say('Missing/conflicting Fixed Kharcha for one or more trips. Settlement save blocked.',true);return}if(!x.d.ready){say('Verify KM, average, diesel taken and diesel rate before saving.',true);return}if($('settlementStatus').value==='FINAL'&&!$('vehicleFilter').value){say('Select one vehicle before FINAL settlement so its KM can carry forward safely.',true);return}if(!confirm('Save a new settlement snapshot for this driver?'))return;try{await insert('driver_khata_settlements',{driver_id:S.driver.id,from_date:$('fromDate').value,to_date:$('toDate').value,vehicle_id:$('vehicleFilter').value||null,status:$('settlementStatus').value,remarks:$('remarks').value,net_balance:x.net,snapshot:{trips:x.trips.map(t=>({...t,settlement_fixed_kharcha:getFixed(t),settlement_fixed_source:fixedInfo(t).source})),advances:x.advs,expenses:x.exps,payments:x.pays,opening:S.opening,totals:{fixed:x.fixed,advance:x.advance,expense:x.expense,debit:x.debits,credit:x.credits,net:x.net},diesel:{old_km:num($('oldKm').value),current_km:num($('currentKm').value),average:num($('average').value),taken:num($('dieselTaken').value),rate:num($('dieselRate').value),extra_km:num($('extraKm').value),...x.d},paper_charge:S.paper?100:0}});say('Settlement snapshot saved in Supabase.');await load()}catch(e){say(e.message,true)}};
$('paperBtn').onclick=()=>{S.paper=!S.paper;$('paperBtn').textContent='Paper Charge ₹100: '+(S.paper?'On':'Off');render()};$('closeModal').onclick=()=>$('modal').classList.remove('show');$('modal').onclick=e=>{if(e.target===$('modal'))$('modal').classList.remove('show')};$('printBtn').onclick=()=>window.print();$('pdfBtn').onclick=()=>{window.print()};$('search').oninput=()=>{ $('driverNameSearch').value='';filterDrivers()};$('driverNameSearch').oninput=()=>{ $('search').value='';filterDrivers()};['vehicleMatches','nameMatches'].forEach(id=>$(id).addEventListener('click',e=>{const b=e.target.closest('[data-driver-id]');if(b){chooseSearchDriver(b.dataset.driverId);load()}}));$('driverSelect').onchange=()=>{const d=S.drivers.find(x=>String(x.id)===String($('driverSelect').value));if(d){$('driverNameSearch').value=driverName(d);$('nameMatches').hidden=true;$('vehicleMatches').hidden=true;load()}};$('loadBtn').onclick=load;$('vehicleFilter').onchange=async()=>{await carryForwardVehicleKm();updateDieselTaken();render()};$('fromDate').onchange=()=>{if(S.loaded)load();else render()};$('toDate').onchange=()=>{if(S.loaded)load();else render()};['oldKm','currentKm','average','dieselTaken','dieselRate','extraKm'].forEach(id=>$(id).addEventListener('input',render));init();
})();
