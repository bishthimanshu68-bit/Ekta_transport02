/* EKTA TRANSPORT — Transporter Working Sheet: tracking-linked, READ ONLY.
   Never infer advances, payments, TDS or balances from unverified sources.
   A trip is included only if trips.party_id points to a saved Transporter party.
   Pending/no party IDs are excluded, not displayed as pending assignments. */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const db=()=>window.supabaseClient||(()=>{try{return window.opener&&!window.opener.closed?window.opener.supabaseClient:null;}catch(_){return null;}})();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>Number(v||0).toLocaleString('en-IN',{style:'currency',currency:'INR'});
 const text=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,'');
 const note=(s,k)=>String(s||'').match(new RegExp('\\[TRACKING:'+k+'=([^\\]]+)\\]','i'))?.[1]||'';
 const date=v=>String(v||'').slice(0,10)||'—';
 const amount=v=>v==null||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
 let parties=[],trips=[],trucks=[],receipts=[],q='';
 const selectedPartyId=()=>new URLSearchParams(location.search).get('party_id')||'';
 function render(){
  const partyById=new Map(parties.map(p=>[String(p.id),p]));
  const truckById=new Map(trucks.map(t=>[String(t.id),t]));
  const filtered=trips.filter(t=>{
   const p=partyById.get(String(t.party_id)),truck=truckById.get(String(t.truck_id));
   return p&&(!q||text([p.party_code,p.name,p.city,truck?.truck_number,t.trip_number,t.lr_number,t.program_date,t.loading_point,t.destination].join(' ')).includes(text(q)));
  });
  // Display trips by Program Date: oldest first, newest last.
  // Missing program dates go last; stable tie-breakers keep the order predictable.
  filtered.sort((a,b)=>{
   const da=String(a.program_date||'').slice(0,10),db=String(b.program_date||'').slice(0,10);
   if(!da&&db)return 1;
   if(da&&!db)return -1;
   return da.localeCompare(db)||String(a.trip_number||'').localeCompare(String(b.trip_number||''));
  });
  $('rows').innerHTML=filtered.map((t,i)=>{
   const p=partyById.get(String(t.party_id)),truck=truckById.get(String(t.truck_id));
   const entered=note(t.notes,'FREIGHT_ENTERED_AT_PROGRAM');
   const freight=entered==='NO'?null:amount(t.freight_amount??t.revenue);
   const freightKnown=freight!==null&&(freight>0||entered==='YES');
   const pod=note(t.notes,'POD_STATUS')||'Not confirmed';
   const linked=receipts.filter(r=>String(r.trip_id)===String(t.id));
    const adv=linked.filter(r=>r.category==='PARTY_ADVANCE');
    const bal=linked.filter(r=>r.category==='PARTY_BALANCE');
    const total=list=>list.reduce((sum,r)=>sum+Number(r.credit||0),0);
    const advSum=total(adv),balSum=total(bal),received=advSum+balSum;
    const dates=adv.map(r=>r.transaction_date).filter(Boolean).sort();
    const banks=[...new Set(linked.map(r=>r.bank_account_name||r.bank_name||'Bank receipt').filter(Boolean))];
    const state=!freightKnown?'Rate Pending':!linked.length?'Awaiting Receipt':freight-received<=0?'Received':'Partially Received';
   const cells=[i+1,p.party_code||'—',p.name||'—',p.city||'—',truck?.truck_number||'—',t.trip_number||'—',date(t.program_date),date(t.loading_date),t.loading_point||t.from_location||'—',t.destination||t.to_location||'—',freightKnown?money(freight):'Rate pending',adv.length?money(advSum):'Not linked',dates.length?dates.join(', '):'—',linked.length?`${money(received)} · ${banks.join(' / ')}`:'—',freightKnown?money(freight-received):'Not calculated','Optional · not posted',pod,state,t.trip_status||'—'];
   return '<tr>'+cells.map((c,j)=>'<td'+([10,11,14].includes(j)?' class="num"':'')+'>'+esc(c)+'</td>').join('')+'</tr>';
  }).join('')||'<tr><td colspan="19" style="text-align:center;padding:24px">No confirmed-party transporter trips found.</td></tr>';
  $('freightTotal').textContent=money(filtered.reduce((s,t)=>note(t.notes,'FREIGHT_ENTERED_AT_PROGRAM')==='NO'?s:s+(amount(t.freight_amount??t.revenue)||0),0));
   const advanceTotal=filtered.reduce((sum,t)=>sum+receipts.filter(r=>String(r.trip_id)===String(t.id)&&r.category==='PARTY_ADVANCE').reduce((v,r)=>v+Number(r.credit||0),0),0);
   const balanceTotal=filtered.reduce((sum,t)=>{const entered=note(t.notes,'FREIGHT_ENTERED_AT_PROGRAM');const freight=entered==='NO'?null:amount(t.freight_amount??t.revenue);if(freight===null||freight<=0)return sum;const paid=receipts.filter(r=>String(r.trip_id)===String(t.id)).reduce((v,r)=>v+Number(r.credit||0),0);return sum+Math.max(0,freight-paid)},0);
   if($('pendingAdvanceTotal'))$('pendingAdvanceTotal').textContent=money(advanceTotal);
   if($('pendingBalanceTotal'))$('pendingBalanceTotal').textContent=money(balanceTotal);
  $('notice').textContent=''; $('notice').style.display='none';
 }
 async function refresh(){
  const client=db();if(!client?.from){$('notice').style.display='block';$('notice').textContent='Supabase client unavailable. Open from the Ekta Transport dashboard and keep the dashboard tab open.';return;}
  $('notice').style.display='none';$('notice').textContent='';
  try{
   const [a,b,c]=await Promise.all([client.from('parties').select('id,party_code,name,city,party_type'),client.from('trips').select('*').order('created_at',{ascending:false}),client.from('trucks').select('id,truck_number')]);
   for(const r of [a,b,c])if(r.error)throw r.error;
   const requested=selectedPartyId();
   parties=(a.data||[]).filter(p=>String(p.party_type||'').trim().toLowerCase()==='transporter'&&(!requested||String(p.id)===requested));
   const ids=new Set(parties.map(p=>String(p.id)));
   trips=(b.data||[]).filter(t=>t.party_id!=null&&ids.has(String(t.party_id))&&String(t.trip_status||'').trim().toLowerCase()!=='cancelled');
   trucks=c.data||[];
   render();
  }catch(e){$('notice').style.display='block';$('notice').textContent='Unable to load live data: '+e.message;console.error('[EKTA Transporter Working Sheet]',e);}
 }
 window.EktaTransporterSheet={refresh,search(v){q=v;render();},open(){const tab=window.open(new URL('transporter-working-sheet.html',location.href).href,'_blank');if(!tab)alert('Please allow pop-ups to open the Transporter Working Sheet.');},close(){window.close();}};
})();
