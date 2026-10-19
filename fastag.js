(function () {
  'use strict';

  const state = { rows: [], vehicles: [], fleetRows: [], selectedVehicle: '', refreshTimer: null };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money = (v) => (v === null || v === undefined || v === '') ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const pad = n => String(n).padStart(2, '0');
  const localDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  function client() {
    if (window.supabaseClient && typeof window.supabaseClient.from === 'function') return window.supabaseClient;
    if (typeof window._supabase !== 'undefined' && window._supabase && typeof window._supabase.from === 'function') return window._supabase;
    throw new Error('Supabase client not initialized. Existing db.js / Supabase setup check karein.');
  }

  function parseTime(v) {
    if (!v) return 0;
    const s = String(v).replace(' ', 'T');
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function normalize(x) {
    return {
      vehicleNo: String(x.vehicle_no || x.vehicleNo || x.vehicle_number || '').toUpperCase().replace(/\s+/g,''),
      tollPlaza: x.toll_plaza_name || x.tollplazaname || x.tollPlazaName || x.udf4 || '',
      time: x.toll_txn_date_time || x.tollTxnDateTime || x.txn_posted_time || x.txnPostedtime || x.request_time || x.reqTime || '',
      amount: Number(x.txn_amount ?? x.txnAmt ?? x.txnAmount ?? 0) || 0,
      direction: x.lane_direction || x.laneDirection || '',
      opening: x.opening_balance ?? x.openingBalance,
      closing: x.closing_balance ?? x.closingBalance,
      lane: x.lane_id || x.laneId || '',
      vehicleDesc: x.vehicle_description || x.vehicleDesc || x.vehicle_category || x.vehicleCatageory || '',
      ref: x.original_txn_id || x.originalTxnId || x.partner_ref_id || x.partnerRefId || '',
      tagId: x.tag_id || x.tagId || '',
      coords: x.udf2 || ((x.latitude != null && x.longitude != null) ? `${x.latitude},${x.longitude}` : '')
    };
  }

  function notice(kind, html) {
    const n = $('ftNotice'); if (!n) return;
    const styles = { blue:'border-blue-100 bg-blue-50 text-blue-800', green:'border-emerald-200 bg-emerald-50 text-emerald-800', amber:'border-amber-200 bg-amber-50 text-amber-800', red:'border-rose-200 bg-rose-50 text-rose-700' };
    n.className = `mb-4 px-4 py-3 rounded-xl border text-xs ${styles[kind] || styles.blue}`;
    n.innerHTML = html;
  }

  function boundaries() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = new Date(today);
    const day = (today.getDay() + 6) % 7; // Monday start
    week.setDate(today.getDate() - day);
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    return { now, today, week, month };
  }

  async function loadRange(fromDate, toDate, vehicle='') {
    let q = client().from('fastag_transactions').select('*').order('toll_txn_date_time', { ascending:false });
    if (vehicle) q = q.eq('vehicle_no', vehicle);
    if (fromDate) q = q.gte('toll_txn_date_time', `${fromDate} 00:00:00`);
    if (toDate) q = q.lte('toll_txn_date_time', `${toDate} 23:59:59`);
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'FASTag data load failed.');
    return (data || []).map(normalize).sort((a,b)=>parseTime(b.time)-parseTime(a.time));
  }

  async function loadVehicles() {
    const { data, error } = await client().from('fastag_transactions').select('vehicle_no').not('vehicle_no','is',null);
    if (error) throw new Error(error.message);
    state.vehicles = [...new Set((data || []).map(x => String(x.vehicle_no || '').toUpperCase().replace(/\s+/g,'')).filter(Boolean))].sort();
    showVehicleSuggestions('');
  }

  function showVehicleSuggestions(term) {
    const box = $('ftVehicleDrop'); if (!box) return;
    const q = String(term || '').toUpperCase().replace(/\s+/g,'');
    const matches = state.vehicles.filter(v => !q || v.includes(q) || v.endsWith(q)).slice(0, 50);
    if (!matches.length) { box.classList.add('hidden'); box.innerHTML=''; return; }
    box.innerHTML = matches.map(v => `<button type="button" data-vehicle="${esc(v)}" class="block w-full text-left px-3 py-2 text-xs hover:bg-blue-50 font-semibold text-slate-700">${esc(v)}</button>`).join('');
    box.classList.remove('hidden');
  }

  function renderLedger(rows) {
    state.rows = rows || [];
    $('ftRowsLabel').textContent = `${state.rows.length} transaction${state.rows.length===1?'':'s'}`;
    $('ftTxnCount').textContent = state.rows.length;
    if (!state.rows.length) {
      $('ftBody').innerHTML = '<tr><td colspan="10" class="px-4 py-14 text-center text-slate-400">No FASTag transactions found for this selection.</td></tr>';
      renderSelected([]);
      return;
    }
    $('ftBody').innerHTML = state.rows.map(r => `<tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-4 py-3 font-bold">${esc(r.vehicleNo)}</td><td class="px-4 py-3">${esc(r.tollPlaza)}</td>
      <td class="px-4 py-3 whitespace-nowrap">${esc(r.time)}</td><td class="px-4 py-3 font-bold text-rose-600">${money(r.amount)}</td>
      <td class="px-4 py-3">${esc(r.direction)}</td><td class="px-4 py-3">${money(r.opening)}</td><td class="px-4 py-3">${money(r.closing)}</td>
      <td class="px-4 py-3">${esc(r.lane)}</td><td class="px-4 py-3">${esc(r.vehicleDesc)}</td><td class="px-4 py-3">${esc(r.ref)}</td></tr>`).join('');
    renderSelected(state.rows);
  }

  function sumSince(rows, start) { const t=start.getTime(); return rows.filter(r=>parseTime(r.time)>=t).reduce((s,r)=>s+r.amount,0); }

  function renderSelected(rows) {
    const selected = state.selectedVehicle;
    const vr = selected ? state.fleetRows.filter(r=>r.vehicleNo===selected) : [];
    const latest = vr[0] || (selected ? rows[0] : null);
    $('ftSVehicle').textContent = selected || 'All Vehicles';
    $('ftTag').textContent = latest?.tagId || '—'; $('ftCategory').textContent = latest?.vehicleDesc || '—';
    $('ftSLast').textContent = latest?.tollPlaza || '—'; $('ftSAmount').textContent = latest ? money(latest.amount) : '—';
    $('ftCoords').textContent = latest?.coords || '—';
    const b=boundaries();
    $('ftVehicleToday').textContent = selected ? money(sumSince(vr,b.today)) : '—';
    $('ftVehicleWeek').textContent = selected ? money(sumSince(vr,b.week)) : '—';
    $('ftVehicleMonth').textContent = selected ? money(sumSince(vr,b.month)) : '—';
  }

  function renderFleet() {
    const rows=state.fleetRows, b=boundaries();
    const todayRows=rows.filter(r=>parseTime(r.time)>=b.today.getTime());
    $('ftTodaySpend').textContent=money(todayRows.reduce((s,r)=>s+r.amount,0));
    $('ftTodayCrossings').textContent=`${todayRows.length} fleet crossing${todayRows.length===1?'':'s'} today`;
    $('ftWeekSpend').textContent=money(sumSince(rows,b.week));
    $('ftMonthSpend').textContent=money(sumSince(rows,b.month));
    const latest=rows[0];
    $('ftBalance').textContent=latest ? money(latest.closing) : '—';
    $('ftLastToll').textContent=latest ? `${latest.vehicleNo} • ${latest.tollPlaza || 'Toll'}` : '—';
    $('ftLastTollTime').textContent=latest?.time || '—';

    $('ftRecent').innerHTML = rows.slice(0,8).map(r=>`<div class="px-4 py-3 flex items-center justify-between gap-3 text-xs">
      <div><b class="text-slate-800">${esc(r.vehicleNo)}</b><div class="text-slate-500 mt-1">${esc(r.tollPlaza)} • ${esc(r.time)}</div></div>
      <b class="text-rose-600">${money(r.amount)}</b></div>`).join('') || '<div class="p-5 text-xs text-slate-400">No recent activity.</div>';

    const monthRows=rows.filter(r=>parseTime(r.time)>=b.month.getTime());
    const map={};
    monthRows.forEach(r=>{ const k=r.tollPlaza||'Unknown Toll Plaza'; if(!map[k]) map[k]={count:0,spend:0}; map[k].count++; map[k].spend+=r.amount; });
    const plazas=Object.entries(map).sort((a,b)=>b[1].spend-a[1].spend).slice(0,10);
    $('ftPlazas').innerHTML=plazas.map(([name,v])=>`<div class="px-4 py-3 flex items-center justify-between gap-3 text-xs">
      <div><b class="text-slate-800">${esc(name)}</b><div class="text-slate-500 mt-1">${v.count} crossing${v.count===1?'':'s'}</div></div>
      <b>${money(v.spend)}</b></div>`).join('') || '<div class="p-5 text-xs text-slate-400">No toll plaza activity this month.</div>';
  }

  async function refreshFleet(silent=false) {
    try {
      const b=boundaries();
      state.fleetRows=await loadRange(localDate(b.month), localDate(b.now));
      renderFleet(); renderSelected(state.rows);
      if(!silent) notice('green', `<b>FASTag fleet data loaded.</b> ${state.fleetRows.length} transaction(s) available for this month.`);
    } catch(e) {
      console.error('FASTag fleet load:',e);
      if(!silent) notice('red', `<b>FASTag data load failed.</b> ${esc(e?.message || String(e))}`);
    }
  }

  window.ftSearch = async function() {
    const raw=$('ftVehicle').value.trim().toUpperCase().replace(/\s+/g,'');
    const from=$('ftFrom').value, to=$('ftTo').value;
    if(from && to && from>to){ alert('From date, To date se aage nahi ho sakti.'); return; }
    let vehicle=raw;
    if(raw && !state.vehicles.includes(raw)) {
      const matches=state.vehicles.filter(v=>v.includes(raw)||v.endsWith(raw));
      if(matches.length===1){ vehicle=matches[0]; $('ftVehicle').value=vehicle; }
      else if(matches.length>1){ showVehicleSuggestions(raw); notice('amber', `<b>${matches.length} vehicles matched.</b> Dropdown se vehicle select karein.`); return; }
      else { notice('amber', `<b>No vehicle matched:</b> ${esc(raw)}`); renderLedger([]); return; }
    }
    state.selectedVehicle=vehicle;
    notice('blue','<b>Loading FASTag transactions...</b>');
    try {
      const rows=await loadRange(from,to,vehicle);
      renderLedger(rows);
      notice('green', `<b>FASTag data loaded.</b> ${rows.length} transaction(s) found${vehicle?' for '+esc(vehicle):' for all vehicles'}.`);
    } catch(e){ console.error(e); renderLedger([]); notice('red',`<b>FASTag data load failed.</b> ${esc(e?.message||String(e))}`); }
  };

  window.ftShowAll = async function(){
    $('ftVehicle').value=''; state.selectedVehicle='';
    await window.ftSearch();
  };

  window.ftExport = function(){
    if(!state.rows.length){ alert('Export ke liye transactions nahi hain.'); return; }
    const data=state.rows.map(r=>({'Vehicle No':r.vehicleNo,'Toll Plaza':r.tollPlaza,'Crossing Date & Time':r.time,'Amount':r.amount,'Direction':r.direction,'Opening Balance':r.opening,'Closing Balance':r.closing,'Lane':r.lane,'Vehicle Type':r.vehicleDesc,'Reference':r.ref,'Tag ID':r.tagId,'Coordinates':r.coords}));
    if(window.XLSX){
      const ws=XLSX.utils.json_to_sheet(data), wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'FASTag');
      XLSX.writeFile(wb,`FASTag_${state.selectedVehicle||'ALL'}_${$('ftFrom').value}_to_${$('ftTo').value}.xlsx`);
    } else alert('Excel library load nahi hui.');
  };

  async function init(){
    const now=new Date(), from=new Date(now); from.setDate(now.getDate()-7);
    if(!$('ftFrom').value) $('ftFrom').value=localDate(from); if(!$('ftTo').value) $('ftTo').value=localDate(now);
    const input=$('ftVehicle'), drop=$('ftVehicleDrop');
    input.addEventListener('input',()=>showVehicleSuggestions(input.value));
    input.addEventListener('focus',()=>showVehicleSuggestions(input.value));
    input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ drop.classList.add('hidden'); window.ftSearch(); }});
    drop.addEventListener('click',e=>{ const b=e.target.closest('[data-vehicle]'); if(!b)return; input.value=b.dataset.vehicle; drop.classList.add('hidden'); window.ftSearch(); });
    document.addEventListener('click',e=>{ if(!input.contains(e.target)&&!drop.contains(e.target)) drop.classList.add('hidden'); });
    try { await loadVehicles(); await refreshFleet(true); await window.ftSearch(); }
    catch(e){ console.error(e); notice('red',`<b>FASTag initialization failed.</b> ${esc(e?.message||String(e))}`); }
    state.refreshTimer=setInterval(async()=>{ await refreshFleet(true); if(state.selectedVehicle) await window.ftSearch(); },60000);
  }

  init();
})();