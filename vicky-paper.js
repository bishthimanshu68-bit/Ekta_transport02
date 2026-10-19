(function(){
'use strict';
const $=id=>document.getElementById(id), db=()=>window.supabaseClient;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
let entries=[],busy=false;
const types=['Fitness','PUC','Permit','Road Tax','Insurance','National Permit','Other'];
function shell(){let x=$('vickyPaperView');if(x)return;x=document.createElement('div');x.id='vickyPaperView';x.className='ac-view hidden ac-card';x.style.padding='16px';x.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px"><div><h2 style="font-size:17px;font-weight:700">Vicky Paper Ledger</h2><div style="font-size:12px;color:#64748b">Paper charge = Debit · Payment = Credit · Outstanding = Debit − Credit</div></div><div style="display:flex;gap:8px"><button class="btn" id="vpAddPaper">+ Add Paper</button><button class="btn" id="vpAddPayment">+ Add Payment</button></div></div><div id="vpStatus" style="font-size:12px;margin:12px 0"></div><div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"><input id="vpSearch" placeholder="Search truck / paper / remark" class="border rounded-lg px-3 py-2 text-xs" style="min-width:250px"><b id="vpTotal"></b></div><div id="vpForm" hidden></div><div style="overflow:auto"><table><thead><tr><th>Sr.</th><th>Date</th><th>Truck No.</th><th>Paper Type</th><th>Details / Ref.</th><th class="money">Debit (Charge)</th><th class="money">Credit (Paid)</th><th class="money">Balance</th></tr></thead><tbody id="vpRows"></tbody></table></div>`;document.querySelector('#accountsFinance').appendChild(x);$('vpAddPaper').onclick=()=>form('CHARGE');$('vpAddPayment').onclick=()=>form('PAYMENT');$('vpSearch').oninput=render;}
function form(kind){
 const host=$('vpForm');host.hidden=false;
 const today=new Date().toLocaleDateString('en-CA');
 if(kind==='PAYMENT'){
  host.innerHTML=`<form id="vpEntryForm" style="border:1px solid #dbe5ef;border-radius:10px;padding:12px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:end">
  <label>Payment Amount<br><input name="amount" type="number" min="0.01" step="0.01" required class="border rounded-lg px-2 py-2" style="width:160px"></label>
  <label>Payment Mode<br><select name="payment_mode" class="border rounded-lg px-2 py-2"><option>Cash</option><option>Bank</option></select></label>
  <button type="submit" class="btn primary">Save Payment</button><button type="button" id="vpCancel" class="btn">Cancel</button></form>`;
 }else{
  host.innerHTML=`<form id="vpEntryForm" style="border:1px solid #dbe5ef;border-radius:10px;padding:12px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:9px;align-items:end">
  <label>Date<br><input name="entry_date" type="date" value="${today}" required class="border rounded-lg px-2 py-2"></label>
  <label style="position:relative">Truck Number<br><input id="vpTruckInput" name="truck_number" autocomplete="off" required placeholder="Type truck number" class="border rounded-lg px-2 py-2" style="width:190px">
  <div id="vpTruckSuggestions" class="ekta-suggestion-list" style="display:none;position:absolute;top:100%;left:0;width:260px;max-height:205px;overflow:auto;z-index:99999"></div></label>
  <label>Paper Type<br><select name="paper_type" required class="border rounded-lg px-2 py-2">${types.map(t=>`<option>${t}</option>`).join('')}</select></label>
  <label>Paper Amount<br><input name="amount" type="number" min="0.01" step="0.01" required class="border rounded-lg px-2 py-2" style="width:125px"></label>
  <label>Expiry Date (optional)<br><input name="paper_expiry" type="date" class="border rounded-lg px-2 py-2"></label>
  <label>Remark / Reference<br><input name="remark" maxlength="250" class="border rounded-lg px-2 py-2"></label>
  <button type="submit" class="btn primary">Save Paper</button><button type="button" id="vpCancel" class="btn">Cancel</button></form>`;
  const input=$('vpTruckInput'), list=$('vpTruckSuggestions');
  let trucks=[];
  async function fetchTrucks(){
   trucks=[...new Set((window.EktaAccounts?.getVickyTrucks?.()||[]).map(x=>String(x).trim()).filter(Boolean))];
   if(!trucks.length&&db()?.from){
    const {data,error}=await db().from('trucks').select('truck_number').limit(2000);
    if(error){console.warn('Vicky truck search:',error.message);return;}
    trucks=[...new Set((data||[]).map(x=>String(x.truck_number||'').trim()).filter(Boolean))];
   }
   if(document.activeElement===input)draw();
  }
  fetchTrucks();
  let active=0, matches=[];
  function draw(){
   const q=input.value.trim().toLowerCase();
   matches=trucks.filter(t=>t.toLowerCase().includes(q)).slice(0,6);
   active=0;
   list.style.display=matches.length?'block':'none';
   list.innerHTML=matches.map((t,i)=>`<div class="ekta-suggestion-item${i===active?' is-active':''}" data-index="${i}">${esc(t)}</div>`).join('');
  }
  function choose(i){if(matches[i]){input.value=matches[i];list.style.display='none';}}
  input.addEventListener('input',draw);
  input.addEventListener('focus',()=>{draw();if(!trucks.length)fetchTrucks();});
  input.addEventListener('keydown',e=>{
   if(list.style.display==='none')return;
   if(e.key==='ArrowDown'){e.preventDefault();active=(active+1)%matches.length;}
   else if(e.key==='ArrowUp'){e.preventDefault();active=(active+matches.length-1)%matches.length;}
   else if(e.key==='Enter'){e.preventDefault();choose(active);return;}
   else if(e.key==='Escape'){list.style.display='none';return;}
   else return;
   [...list.children].forEach((el,i)=>el.classList.toggle('is-active',i===active));
   list.children[active]?.scrollIntoView({block:'nearest'});
  });
  list.addEventListener('mousedown',e=>{const item=e.target.closest('[data-index]');if(item){e.preventDefault();choose(Number(item.dataset.index));}});
  input.addEventListener('blur',()=>setTimeout(()=>{list.style.display='none';},150));
 }
 $('vpCancel').onclick=()=>host.hidden=true;
 $('vpEntryForm').onsubmit=e=>save(e,kind);
}
async function save(e,kind){
 e.preventDefault();if(busy)return;
 const d=Object.fromEntries(new FormData(e.currentTarget));
 const amount=Number(d.amount);
 if(!Number.isFinite(amount)||amount<=0)return alert('Enter a valid amount');
 const truck=kind==='CHARGE'?d.truck_number.trim().toUpperCase():'GENERAL';
 if(!confirm(`Save ${kind==='CHARGE'?'paper charge':'payment'} ${money(amount)}${kind==='CHARGE'?' for '+truck:''}?`))return;
 busy=true;
 try{
  const row={entry_date:kind==='CHARGE'?d.entry_date:new Date().toLocaleDateString('en-CA'),
   truck_number:truck,paper_type:kind==='CHARGE'?d.paper_type:'Payment',
   entry_kind:kind,amount,remark:kind==='CHARGE'?(d.remark?.trim()||null):null,
   payment_mode:kind==='PAYMENT'?d.payment_mode:null,
   paper_expiry:kind==='CHARGE'&&d.paper_expiry?d.paper_expiry:null};
  const {error}=await db().from('vicky_paper_entries').insert(row);
  if(error)throw error;
  $('vpForm').hidden=true;await load();
 }catch(err){alert('Not saved: '+err.message)}finally{busy=false}
}
async function load(){shell();const status=$('vpStatus');if(!db()?.from){status.textContent='Supabase connection unavailable';return;}const {data,error}=await db().from('vicky_paper_entries').select('*').order('entry_date',{ascending:true}).order('created_at',{ascending:true});if(error){status.textContent='Ledger cannot load: '+error.message+' — Run the included SQL migration and check access permissions.';entries=[];}else{entries=data||[];status.textContent=entries.length+' saved entries';}render();}
function render(){const q=($('vpSearch')?.value||'').toLowerCase();let bal=0;const records=entries.map((r,i)=>{bal+=r.entry_kind==='CHARGE'?Number(r.amount):-Number(r.amount);return {...r,serial:i+1,running:bal}});$('vpTotal').textContent='Outstanding: '+money(bal);const filtered=records.filter(r=>[r.truck_number,r.paper_type,r.remark,r.payment_mode].some(v=>String(v||'').toLowerCase().includes(q)));$('vpRows').innerHTML=filtered.map(r=>`<tr><td>${r.serial}</td><td>${esc(r.entry_date)}</td><td>${esc(r.truck_number)}</td><td>${esc(r.paper_type)}</td><td>${esc(r.remark||r.payment_mode||'—')}</td><td class="money">${r.entry_kind==='CHARGE'?money(r.amount):'—'}</td><td class="money">${r.entry_kind==='PAYMENT'?money(r.amount):'—'}</td><td class="money">${money(r.running)}</td></tr>`).join('')||'<tr><td colspan="8">No entries yet</td></tr>';}
function open(){const back=document.getElementById('acBackRow');if(back)back.classList.remove('hidden');shell();document.querySelectorAll('#accountsFinance .ac-view').forEach(e=>e.classList.add('hidden'));$('vickyPaperView').classList.remove('hidden');document.querySelectorAll('#accountsFinance .tab').forEach(x=>x.classList.toggle('active',x.dataset.tab==='vickypaper'));load();}
window.EktaVickyPaper={open,load};
})();
