/* Ekta Market: Supabase-only persistence. No RLS changes, no silent local fallback. */
(function(){
'use strict';
let owners=[],vehicles=[],journeys=[],ready=false,loading=false,partyIndex=[];
const $=id=>document.getElementById(id);
const getClient=()=>{
 if(window.supabaseClient?.from)return window.supabaseClient;
 try{if(window.opener?.supabaseClient?.from)return window.opener.supabaseClient;}catch(_){}
 try{if(window.parent!==window&&window.parent.supabaseClient?.from)return window.parent.supabaseClient;}catch(_){}
 return null;
};
const db=()=>{const c=getClient();if(!c)throw new Error('Supabase client not found. Open Market Tracking from the connected Ekta Dashboard, or load your existing Supabase client before market-supabase.js.');return c;};
const norm=s=>String(s??'').trim();
const ownerMeta=(row)=>{const raw=norm(row.notes);try{if(raw.startsWith('EKTA_MARKET_OWNER_META:'))return JSON.parse(raw.slice(23));}catch(_){}return {name:'',pan:'',notes:raw};};
const ownerFrom=row=>{const meta=ownerMeta(row);return {id:row.id,transport:row.transporter_name||'',name:meta.name||'',mobile:row.mobile||'',gst:row.gst_number||'',pan:meta.pan||'',city:row.city||'',state:row.state||'',address:row.address||''};};
const truckFrom=row=>({id:row.id,ownerId:row.transporter_id,number:row.truck_number||'',driver:row.driver_name||'',mobile:row.driver_mobile||''});
const marketTripMeta=notes=>{const m=norm(notes).match(/\[MARKET_PARTY_META:([A-Za-z0-9_-]+)\]/);if(!m)return {};try{const b=m[1].replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(decodeURIComponent(escape(atob(b))))}catch(_){return {}}};
const tripFrom=row=>({...marketTripMeta(row.notes),id:row.id,truckId:row.vehicle_id,number:vehicles.find(v=>v.id===row.vehicle_id)?.number||'',party:row.party_name||'',from:row.from_location||'',to:row.to_location||'',status:norm(row.trip_status).toUpperCase()||'PROGRAM',date:row.program_date||'',loadingDate:row.loading_date||'',lrDate:row.lr_date||'',reportingDate:row.reporting_date||'',unloadingDate:row.unloading_date||'',lr:row.lr_number||'',expected:row.expected_arrival_date||'',currentLocation:row.current_location||'',hire:row.hire_freight||'',freight:row.customer_freight||'',notes:row.notes||'',updatedAt:row.updated_at||row.created_at||''});
function message(msg,error=false){let e=$('marketDbStatus');if(!e){e=document.createElement('div');e.id='marketDbStatus';e.setAttribute('role','status');e.style.cssText='margin:8px 0;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:650';const host=document.querySelector('.market-toolbar');host?.after(e);}e.textContent=msg;e.style.background=error?'#fff0f0':'#eaf7ef';e.style.color=error?'#ad2434':'#17653e';}
async function query(table){const {data,error}=await db().from(table).select('*').limit(5000);if(error)throw new Error(table+': '+error.message);return data||[];}
async function reload(){if(loading)return;loading=true;ready=false;message('Connecting to Supabase…');try{const o=await query('market_transporters');const v=await query('market_vehicles');owners=o.map(ownerFrom);vehicles=v.map(truckFrom);const t=await query('market_trips');journeys=t.map(tripFrom);try{partyIndex=await query('parties')}catch(e){console.warn('Party status lookup unavailable',e);partyIndex=[]}for(const trip of journeys){if(trip.partyStatus)continue;const p=partyIndex.find(p=>[p.party_name,p.name].some(n=>norm(n)&&norm(trip.party).includes(norm(n))));if(p)trip.partyStatus=norm(p.party_type||p.type||p.category)}ready=true;message('Supabase connected • '+owners.length+' Market Owners • '+vehicles.length+' Market Trucks • '+journeys.length+' Trips');ownerRender();truckRender();marketRender(typeof marketActiveStatus==='string'?marketActiveStatus:'EMPTY');}catch(e){console.error('[Market Supabase]',e);message('NOT CONNECTED — '+e.message+' No records will be saved to browser storage.',true);}finally{loading=false;}}
function mustReady(){if(!ready){message('Supabase not ready. Please fix the connection before entering real data.',true);return false;}return true;}
function fail(e){console.error('[Market Supabase Save]',e);alert('Supabase save FAILED. Nothing was saved locally. '+(e?.message||e));}
async function write(table,payload,id){const c=db();const r=id?await c.from(table).update(payload).eq('id',id).select():await c.from(table).insert(payload).select();if(r.error)throw new Error(table+': '+r.error.message);if(!r.data?.length)throw new Error(table+': No saved row returned. Check RLS SELECT/INSERT/UPDATE policies.');return r.data[0];}
ownerLoad=()=>owners;
truckLoad=()=>vehicles;
marketTripLoad=()=>journeys;
marketTripSaveAll=()=>{throw new Error('Local Market Trip saving disabled; use Supabase.')};
ownerSave=async function(e){e.preventDefault();if(!mustReady())return;const val=id=>norm($(id).value);const obj={transport:val('ownerTransport'),name:val('ownerName'),mobile:val('ownerMobile'),gst:val('ownerGst').toUpperCase(),pan:val('ownerPan').toUpperCase(),city:val('ownerCity'),state:val('ownerState'),address:val('ownerAddress')};if(!obj.transport)return alert('Transport Name is required.');if(!/^\d{10}$/.test(obj.mobile))return alert('Enter a valid 10-digit mobile.');if(obj.gst&&!/^[0-9A-Z]{15}$/.test(obj.gst))return alert('GST must be 15 characters.');if(obj.pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(obj.pan))return alert('Invalid PAN.');const btn=$('ownerSaveBtn');btn.disabled=true;try{await write('market_transporters',{transporter_name:obj.transport,mobile:obj.mobile,gst_number:obj.gst||null,address:obj.address||null,city:obj.city||null,state:obj.state||null,notes:'EKTA_MARKET_OWNER_META:'+JSON.stringify({name:obj.name,pan:obj.pan})},ownerEditingId);ownerFormClose();await reload();}catch(err){fail(err)}finally{btn.disabled=false;}};
truckSave=async function(e){e.preventDefault();if(!mustReady())return;if(!truckOwnerId||!owners.some(o=>o.id===truckOwnerId))return alert('Choose an owner first.');const number=norm($('truckNumber').value).toUpperCase().replace(/\s+/g,''),driver=norm($('truckDriver').value),mobile=norm($('truckMobile').value);if(!number)return alert('Truck Number is required.');if(mobile&&!/^\d{10}$/.test(mobile))return alert('Driver Mobile must be 10 digits when provided.');if(vehicles.some(v=>v.number===number&&v.id!==truckEditingId))return alert('Truck already exists in Market Master.');try{await write('market_vehicles',{transporter_id:truckOwnerId,truck_number:number,driver_name:driver||null,driver_mobile:mobile||null},truckEditingId);truckFormClose();await reload();marketTab('vehicles');}catch(err){fail(err)}};
// Mirror own-fleet Party Type and active Party Rate List lookup; never silently overwrite manual freight.
const rateKey=s=>norm(s).toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^VIJAYWADA$/,'VIJAYAWADA').replace(/^BENGALURU$/,'BANGALORE');
const rateSize=s=>(norm(s).toUpperCase().match(/^\s*(32|34|36)(?=$|[^0-9])/)||[])[1]||'';
let selectedRates=[],ratePartyId='',rateRequest=0,rateSuggestRequest=0;
window.marketRateReset=()=>{++rateRequest;++rateSuggestRequest;selectedRates=[];ratePartyId='';const hint=$('mpRateHint');if(hint)hint.textContent='';const freight=$('mpFreight');if(freight){if(freight.dataset.autoRate==='yes')freight.value='';freight.dataset.autoRate='no'}const cat=$('mpCategory');if(cat)cat.innerHTML='<option value="">Select later / Auto match</option>';};
window.marketPartySelected=async function(p){
 window.marketRateReset();const type=norm(p.party_type||p.type||p.category),hint=$('mpRateHint');
 $('mpPartyType').value=type;
 if(type.toLowerCase()!=='billing client'){hint.textContent='Transporter: enter freight manually.';return}
 const req=++rateRequest;ratePartyId=String(p.id);let all=[];
 try{for(let offset=0;offset<10000;offset+=1000){const r=await db().from('party_rate_list').select('*').eq('party_id',p.id).range(offset,offset+999);if(r.error)throw r.error;if(req!==rateRequest)return;all.push(...(r.data||[]));if((r.data||[]).length<1000)break}}
 catch(e){hint.textContent='Rate List unavailable: '+e.message;return}
 if(req!==rateRequest)return;
 selectedRates=all.filter(r=>!r.status||norm(r.status).toLowerCase()==='active');
 const cats=[...new Set(selectedRates.map(r=>norm(r.vehicle_category)).filter(Boolean))].sort();
 $('mpCategory').innerHTML='<option value="">Select later / Auto match</option>'+cats.map(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;return o.outerHTML}).join('');
 hint.textContent=selectedRates.length?selectedRates.length+' active Party Rates loaded. Select route and category.':'No active rates for this Party / Branch.';
 window.marketRateSuggest();
};
window.marketRateSuggest=async function(){
 const req=++rateSuggestRequest,hint=$('mpRateHint'),freight=$('mpFreight');if(!hint||!freight)return;
 if(!marketPartyChoice||ratePartyId!==String(marketPartyChoice.id))return;
 const from=rateKey($('mpFrom').value),to=rateKey($('mpTo').value),cat=norm($('mpCategory').value),date=norm($('mpDate').value)||new Date().toLocaleDateString('en-CA');
 if(!from||!to){hint.textContent='Select From and To to match Party Rate List.';return}
 const matches=selectedRates.filter(r=>rateKey(r.from_location)===from&&rateKey(r.destination)===to&&Number(r.rate)>0&&(!r.effective_from||String(r.effective_from).slice(0,10)<=date)&&(!r.effective_to||String(r.effective_to).slice(0,10)>=date)&&(!cat||norm(r.vehicle_category)===cat));
 if(req!==rateSuggestRequest)return;
 matches.sort((a,b)=>String(b.effective_from||'').localeCompare(String(a.effective_from||'')));
 const latest=matches.filter(r=>String(r.effective_from||'')===String(matches[0]?.effective_from||''));
 const amounts=new Set(latest.map(r=>Number(r.rate))),sizes=new Set(latest.map(r=>norm(r.vehicle_category)));
 if(!latest.length||amounts.size!==1||(!cat&&sizes.size!==1)){
  if(freight.dataset.autoRate==='yes'){freight.value='';freight.dataset.autoRate='no'}
  hint.textContent=!latest.length?'No approved/active rate matched this route. Enter freight manually if known.':'Multiple rate categories/prices found — select exact Rate List Category.';return;
 }
 const rate=latest[0];if(!freight.value||freight.dataset.autoRate==='yes'){freight.value=rate.rate;freight.dataset.autoRate='yes'}
 hint.textContent='✓ Rate List: '+norm(rate.vehicle_category)+' • ₹'+Number(rate.rate).toLocaleString('en-IN')+' (provisional)';
};
marketProgramSave=async function(e){e.preventDefault();if(!mustReady())return;const g=id=>norm($(id).value),vehicle=vehicles.find(v=>v.id===g('mpTruck'));if(!vehicle)return alert('Select an available Market Truck.');if(g('mpParty')&&!marketPartyChoice)return alert('Select Party / Branch from suggestions or leave blank.');if(!g('mpFrom')||!g('mpTo'))return alert('Loading Point and Destination are required.');if(journeys.some(t=>t.truckId===vehicle.id&&!['COMPLETED','CANCELLED'].includes(t.status)))return alert('This truck has an active trip.');const stamp=Date.now();const payload={trip_number:'MKT-'+stamp,vehicle_id:vehicle.id,transporter_id:vehicle.ownerId,party_name:g('mpPartySelected')||null,from_location:g('mpFrom'),to_location:g('mpTo'),trip_status:'PROGRAM',program_date:g('mpDate')||null,expected_arrival_date:g('mpExpected')||null,lr_number:g('mpLR')||null,customer_freight:g('mpFreight')?Number(g('mpFreight')):null,hire_freight:g('mpHire')?Number(g('mpHire')):null,notes:(g('mpNotes')+'\n[MARKET_PARTY_META:'+btoa(unescape(encodeURIComponent(JSON.stringify({partyId:marketPartyChoice?.id||null,partyStatus:g('mpPartyType'),category:g('mpCategory'),weight:g('mpWeight'),haier:g('mpHaier')})))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')+']').trim()};try{await write('market_trips',payload);marketProgramClose();await reload();marketRender('PROGRAM');}catch(err){fail(err)}};
// Same quick-date stage interaction as original tracking.js (PROGRAM/LOADING -> RUNNING).
// Cancellation retains the existing reason form. No schema or original-fleet changes.
function marketQuickDate(label){
 const now=new Date();now.setHours(12,0,0,0);now.setDate(now.getDate()-1);
 const base=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 return new Promise(resolve=>{
  const overlay=document.createElement('div');overlay.className='market-quick-date-overlay';
  const panel=document.createElement('div');panel.className='market-quick-date-box';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
  const title=document.createElement('div');title.className='market-quick-date-title';title.textContent=label;
  const sub=document.createElement('label');sub.className='market-quick-date-sub';sub.textContent='Date (default: previous day)';
  const input=document.createElement('input');input.className='market-quick-date-input';input.type='date';input.value=base;
  const error=document.createElement('div');error.className='market-quick-date-error';error.setAttribute('aria-live','polite');
  const actions=document.createElement('div');actions.className='market-quick-date-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='market-quick-date-cancel';cancel.textContent='Cancel';
  const confirm=document.createElement('button');confirm.type='button';confirm.className='market-quick-date-confirm';confirm.textContent='Confirm';
  actions.append(cancel,confirm);panel.append(title,sub,input,error,actions);overlay.append(panel);document.body.append(overlay);
  const finish=v=>{document.removeEventListener('keydown',onKey,true);overlay.remove();resolve(v)};
  const accept=()=>{const date=input.value,d=new Date(date+'T12:00:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(d.getTime())||d.getFullYear()!==Number(date.slice(0,4))||d.getMonth()+1!==Number(date.slice(5,7))||d.getDate()!==Number(date.slice(8,10))){error.textContent='Select a valid date.';return}finish(date)};
  const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(null)}else if(e.key==='Enter'){e.preventDefault();accept()}};
  document.addEventListener('keydown',onKey,true);cancel.onclick=()=>finish(null);confirm.onclick=accept;overlay.onclick=e=>{if(e.target===overlay)finish(null)};input.focus();
 });
}
const marketPreviousSetStatus=marketSetStatus;
marketSetStatus=async function(id,next){
 if(!mustReady())return;
 const t=journeys.find(x=>String(x.id)===String(id));if(!t)return alert('Trip not found. Refresh Market Tracking.');
 if(next==='CANCELLED')return marketPreviousSetStatus(id,next);
 const allowed={PROGRAM:'RUNNING',LOADING:'RUNNING',RUNNING:'REPORTING',REPORTING:'COMPLETED'};
 if(allowed[t.status]!==next)return alert('Invalid status transition.');
 const label=next==='RUNNING'?'LR / Loading Date':next==='REPORTING'?'Reporting Date':'Unloading Date';
 const date=await marketQuickDate(label);if(!date)return;
 if(next==='RUNNING'&&t.date&&date<String(t.date).slice(0,10))return alert('LR / Loading Date cannot be before Program Date.');
 if(next==='REPORTING'&&(t.lrDate||t.loadingDate)&&date<String(t.lrDate||t.loadingDate).slice(0,10))return alert('Reporting Date cannot be before LR Date.');
 if(next==='COMPLETED'&&t.reportingDate&&date<String(t.reportingDate).slice(0,10))return alert('Unloading Date cannot be before Reporting Date.');
 if(!window.confirm(`${t.number||'Truck'}\n${label}: ${date}\nConfirm status change?`))return;
 const payload={trip_status:next};
 if(next==='RUNNING'){payload.lr_date=date;payload.loading_date=date;payload.current_location=t.from||null;}
 if(next==='REPORTING')payload.reporting_date=date;
 if(next==='COMPLETED')payload.unloading_date=date;
 try{await write('market_trips',payload,id);await reload();marketRender(next==='COMPLETED'?'COMPLETED / CANCELLED':next)}catch(err){fail(err)}
};
// Cancellation uses the existing form, with required reason and date.
marketStageSave=async function(e){
 e.preventDefault();if(!mustReady())return;
 const id=$('marketStageTrip').value,t=journeys.find(x=>String(x.id)===String(id)),next=$('marketStageNext').value,date=$('marketStageDate').value;
 if(!t||next!=='CANCELLED'||!date)return alert('Invalid cancellation request.');
 if(!['PROGRAM','LOADING','RUNNING','REPORTING'].includes(t.status))return alert('Trip cannot be cancelled from this stage.');
 const reason=norm($('marketStageReason').value);if(!reason)return alert('Cancellation reason required.');
 try{await write('market_trips',{trip_status:'CANCELLED',notes:[t.notes,'Cancelled: '+reason+' ('+date+')'].filter(Boolean).join('\n')},id);$('marketStageBackdrop').classList.remove('open');$('marketStageBackdrop').style.display='none';await reload();marketRender('COMPLETED / CANCELLED')}catch(err){fail(err)}
};
// Prevent an offline user from mistaking browser-preview records for live Supabase records.
const oldRender=marketRender;
marketRender=function(status){oldRender(status);const n=$('marketStatusNote');if(n)n.textContent=ready?'LIVE SUPABASE • '+vehicles.length+' Market Trucks • '+journeys.length+' Trips • Own Fleet separate':'Supabase NOT CONNECTED — real data entry disabled';};
const oldOpen=marketProgramOpen;
marketProgramOpen=function(){if(!mustReady())return;oldOpen();};
const oldOwnerOpen=ownerFormOpen;
ownerFormOpen=function(id){if(!mustReady())return;oldOwnerOpen(id);$('ownerSaveBtn').textContent=id?'Update Owner (Supabase)':'Save Owner (Supabase)';};
const oldTruckOpen=truckFormOpen;
truckFormOpen=function(id){if(!mustReady())return;oldTruckOpen(id);};
// Make refresh retrieve database data, not stale browser state.
const hint=$('marketHint');if(hint)hint.textContent='Market data is stored in Supabase. Own fleet data is separate.';
const refresh=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Refresh'));
if(refresh)refresh.onclick=()=>reload();
window.EktaMarketSupabase={reload,connected:()=>ready};
reload();
})();
