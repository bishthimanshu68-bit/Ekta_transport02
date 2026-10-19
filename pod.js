/* =============================================================
 EKTA TRANSPORT — POD MODULE 01
 Existing trips remain source-of-truth. Same Trip IDs continue into POD.
 POD worksheet grouping/filter = loading_date.
============================================================= */
(function(){
"use strict";

const S=window.supabaseClient || (window.parent!==window ? window.parent.supabaseClient : null);
const T={trips:"trips",trucks:"trucks",parties:"parties"};
const $=id=>document.getElementById(id);
let trips=[],trucks=[],parties=[];

function clean(v){return String(v??"").trim()}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
function dateOnly(v){return v?String(v).slice(0,10):""}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function fmt(v){if(!v)return "—";const d=new Date(dateOnly(v)+"T00:00:00");return isNaN(d)?"—":d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}
function fmtDT(v){if(!v)return "—";const d=new Date(v);return isNaN(d)?"—":d.toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
function getNote(notes,key){const m=clean(notes).match(new RegExp(`\\[TRACKING:${key}=([^\\]]+)\\]`,`i`));return m?m[1]:""}
function putNote(notes,key,val){
 const tag=`[TRACKING:${key}=${val}]`;
 const re=new RegExp(`\\[TRACKING:${key}=[^\\]]*\\]`,`i`);
 return re.test(clean(notes))?clean(notes).replace(re,tag):(clean(notes)?clean(notes)+"\n":"")+tag;
}
function podDocPath(t){return getNote(t.notes,"POD_DOC_PATH")||""}
function podPaths(t){return Array.from({length:100},(_,i)=>getNote(t.notes,i?`POD_DOC_PATH_${i+1}`:"POD_DOC_PATH")).filter(Boolean)}
function podSlot(t){return Array.from({length:100},(_,i)=>i?`POD_DOC_PATH_${i+1}`:"POD_DOC_PATH").find(k=>!getNote(t.notes,k))||null}


function available(){return S&&typeof S.from==="function"}
function truck(id){return trucks.find(x=>String(x.id)===String(id))||null}
function party(id){return parties.find(x=>String(x.id)===String(id))||null}
function podStatus(t){return clean(getNote(t.notes,"POD_STATUS")||"PENDING").toUpperCase()}
function podSent(t){return clean(getNote(t.notes,"POD_SENT")).toUpperCase()==="YES"}
function podSentAt(t){return getNote(t.notes,"POD_SENT_AT")||""}
function num(v){const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n:0}
function daysBetween(a,b){
 if(!a||!b)return 0;
 const x=new Date(dateOnly(a)+"T00:00:00"),y=new Date(dateOnly(b)+"T00:00:00");
 if(isNaN(x)||isNaN(y))return 0;
 return Math.max(0,Math.ceil((y-x)/86400000));
}
function loadingDetentionDays(t){return Math.max(0,daysBetween(t.program_date,t.loading_date)-1)}
function unloadingDetentionDays(t){return daysBetween(t.reporting_date,t.unloading_date||t.end_date)}
function loadingDetentionCharge(t){return num(t.detention_charge||getNote(t.notes,"LOADING_DETENTION_CHARGE"))}
function unloadingDetentionCharge(t){return num(getNote(t.notes,"UNLOADING_DETENTION_CHARGE"))}
function courierName(t){return clean(t.courier_name||"")}
function courierAwb(t){return clean(t.courier_awb_number||"")}
function courierDate(t){return t.courier_date||getNote(t.notes,"POD_COURIER_DATE")||""}
function courierDeliveredDate(t){return t.courier_delivered_date||getNote(t.notes,"POD_COURIER_RECEIVED_DATE")||""}
function podReceivedDate(t){
 return getNote(t.notes,"POD_RECEIVED_DATE") || dateOnly(getNote(t.notes,"POD_RECEIVED_AT")) || "";
}
function markEditDirty(){window.__podEditDirty=true}
function directFieldHtml(t,kind,value,type="text"){
 const cls=kind==="lr_number"?"pod-direct-field lrno":"pod-direct-field";
 return `<input class="${cls}" type="${type}" value="${esc(value||"")}"
   onfocus="this.dataset.old=this.value"
   onchange="window.EktaPOD.saveDirectField('${esc(t.id)}','${kind}',this.value,this)">`;
}

let ngtRate=null;
const NGT_TABLE="pod_ngt_settings";
function delhiEndpoint(v){return /(^|[^a-z])(?:new\s+delhi|delhi)(?=$|[^a-z])/i.test(clean(v))}
function ngtEligible(t){return delhiEndpoint(t.loading_point||t.from_location)||delhiEndpoint(t.destination||t.to_location)}
function ngtAmount(t){
 const noted=getNote(t.notes,"NGT");
 // A legacy trips.ngt=0 must not mask a positive value already saved in notes.
 if(noted!=="")return num(noted);
 return num(t.ngt);
}
function hasNGTDecision(t){
 // Ignore the obsolete NGT_MANUAL=YES marker; it was written by older
 // versions even when users edited unrelated fields. Explicit new overrides
 // (including a deliberate zero) are stored separately.
 return getNote(t.notes,"NGT_OVERRIDE")==="YES" || ngtAmount(t)!==0;
}
async function loadNGTRate(){
 const r=await S.from(NGT_TABLE).select("rate").eq("id",1).maybeSingle();
 if(r.error){ngtRate=null;console.warn("[POD] NGT settings unavailable",r.error.message);return}
 ngtRate=r.data?num(r.data.rate):null;
}
let ngtErrors=[];
async function applyNGTAutomatically(){
 ngtErrors=[];
 if(ngtRate===null)return;
 for(const t of podRecords()){
  if(!ngtEligible(t)||hasNGTDecision(t))continue;
  let notes=putNote(putNote(t.notes,"NGT",ngtRate),"NGT_AUTO","YES");
  // Retire legacy false-positive marker on successfully auto-applied trips.
  notes=clean(notes).replace(/\[TRACKING:NGT_MANUAL=[^\]]*\]/gi,"").trim();
  const payload={notes};
  if(Object.prototype.hasOwnProperty.call(t,"ngt"))payload.ngt=ngtRate;
  let q=S.from(T.trips).update(payload).eq("id",t.id);
  q=t.notes==null?q.is("notes",null):q.eq("notes",t.notes);
  const r=await q.select("id");
  if(r.error){console.warn("[POD] NGT auto-apply failed for",t.trip_number,r.error.message);ngtErrors.push(`${t.trip_number||t.id}: ${r.error.message}`);continue}
  if(r.data?.length){t.notes=notes;if("ngt" in payload)t.ngt=ngtRate}
  else ngtErrors.push(`${t.trip_number||t.id}: Supabase did not update this trip (check trips UPDATE RLS).`)
 }
}
function openNGTRate(){if(ngtRate!==null)$("podNGTRate").value=ngtRate;$("podNGTMessage").textContent=ngtRate===null?"Enter a rate. Supabase settings table must be configured.":"Current saved rate: ₹"+ngtRate.toFixed(2);$("podNGTModal").classList.add("show")}
async function saveNGTRate(){
 const raw=$("podNGTRate").value,rate=Number(raw),button=$("podNGTSave");
 if(raw.trim()===""||!Number.isFinite(rate)||rate<0){alert("Enter a valid NGT rate (₹0 or higher).");return}
 button.disabled=true;
 try{
  const r=await S.from(NGT_TABLE).upsert({id:1,rate},{onConflict:"id"});if(r.error)throw r.error;
  ngtRate=rate;closeModal("podNGTModal");await applyNGTAutomatically();render();if(ngtErrors.length)alert("NGT Rate saved, but some trips could not be updated. Check browser console / trips RLS. First error: "+ngtErrors[0]);
 }catch(e){$("podNGTMessage").textContent="Rate was NOT saved: "+e.message;alert("NGT settings save failed: "+e.message)}
 finally{button.disabled=false}
}
let podEditingTripId=null;
let podOCRValues={}, podOCRIndex=0;
let podQueue=[];
let podReview=[];let podReviewSignature="";let podReviewBusy=false;

function editInput(id,type,value,extra=""){
 return `<input id="${id}" class="pod-edit-input" type="${type}" value="${esc(value??"")}" ${extra}>`;
}
function truckSelect(t){
 return `<select id="podEditTruck" class="pod-edit-select">${trucks.slice().sort((a,b)=>String(a.truck_number||"").localeCompare(String(b.truck_number||""))).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(t.truck_id)?"selected":""}>${esc(x.truck_number||"Truck")}</option>`).join("")}</select>`;
}
function partySelect(t){
 return `<select id="podEditParty" class="pod-edit-select" onchange="window.EktaPOD.refreshEditDerived()">${parties.slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(t.party_id)?"selected":""}>${esc(x.name||"Party")}</option>`).join("")}</select>`;
}
function podActionsCell(t){
 const has=podPaths(t).length>0;
 return `<div class="pod-actions">
  <button class="pod-icon upload" title="${has?"Add another POD":"Upload POD"}" onclick="window.EktaPOD.openPODUpload('${esc(t.id)}')">⬆</button>
  <button class="pod-icon view" title="View Combined POD PDF" ${has?`onclick="window.EktaPOD.viewAllPODs('${esc(t.id)}')"`:"disabled"}>👁</button>
  <button class="pod-icon download" title="Download POD" ${has?`onclick="window.EktaPOD.downloadAllPODs('${esc(t.id)}')"`:"disabled"}>⬇</button>
 </div>`;
}


async function loadAll(){
 if(!available()){renderError("Supabase client not available. Make sure db.js loads before POD.");return}
 try{
  const [tr,tk,pt]=await Promise.all([
   S.from(T.trips).select("*").order("created_at",{ascending:false}),
   S.from(T.trucks).select("id,truck_number,status"),
   S.from(T.parties).select("id,party_code,name,party_type,city,zone,status")
  ]);
  if(tr.error)throw tr.error;if(tk.error)throw tk.error;if(pt.error)throw pt.error;
  trips=tr.data||[];trucks=tk.data||[];parties=pt.data||[];
  await loadNGTRate();await applyNGTAutomatically();render();
   if(ngtErrors.length){console.warn("[POD] NGT auto-apply issues:",ngtErrors);const bar=$("podNGTWarning");if(bar){bar.hidden=false;bar.textContent="NGT auto-save blocked for "+ngtErrors.length+" trip(s). First: "+ngtErrors[0]}}else{const bar=$("podNGTWarning");if(bar)bar.hidden=true;}
   if(ngtErrors.length)console.warn("[POD] NGT auto-apply problems",ngtErrors);
 }catch(err){
  console.error("[EKTA POD] Load error:",err);
  renderError("POD data could not be loaded: "+(err.message||"Database error"));
 }
}

function podRecords(){return trips.filter(t=>podSent(t))}
function filtered(){
 const q=clean($("podSearch")?.value).toLowerCase(),from=$("podFromDate")?.value||"",to=$("podToDate")?.value||"",sf=$("podStatus")?.value||"";
 return podRecords().filter(t=>{
  const tr=truck(t.truck_id),p=party(t.party_id),ld=dateOnly(t.loading_date);
  const hay=[t.trip_number,tr?.truck_number,p?.name,p?.party_code,t.loading_point,t.from_location,t.destination,t.to_location].join(" ").toLowerCase();
  if(q&&!hay.includes(q))return false;
  if(from&&ld<from)return false;
  if(to&&ld>to)return false;
  if(sf&&podStatus(t)!==sf)return false;
  return true;
 }).sort((a,b)=>{
  const ad=dateOnly(a.loading_date),bd=dateOnly(b.loading_date);
  if(ad!==bd)return String(bd).localeCompare(String(ad));
  return String(a.trip_number||"").localeCompare(String(b.trip_number||""));
 });
}

function badge(status){
 const s=clean(status).toUpperCase(),cls=s==="VERIFIED"?"b-verified":s==="RECEIVED"?"b-received":"b-pending";
 return `<span class="badge ${cls}">${esc(s||"PENDING")}</span>`;
}

function render(){
 const list=filtered(),all=podRecords(),from=$("podFromDate")?.value||"",to=$("podToDate")?.value||"";
 $("podNTotal").textContent=all.length;
 $("podNPending").textContent=all.filter(t=>podStatus(t)==="PENDING").length;
 $("podNReceived").textContent=all.filter(t=>podStatus(t)==="RECEIVED").length;
 $("podNVerified").textContent=all.filter(t=>podStatus(t)==="VERIFIED").length;
 $("podDateText").textContent=from||to?`Loading Date: ${from?fmt(from):"Any"} — ${to?fmt(to):"Any"}`:"All PODs";
 $("podCountText").textContent=`${list.length} record(s)`;

 if(podEditingTripId&&!list.some(t=>String(t.id)===String(podEditingTripId)))podEditingTripId=null;

 $("podRows").innerHTML=list.length?list.map(t=>{
  const tr=truck(t.truck_id),p=party(t.party_id);
  const ld=loadingDetentionDays(t),ud=unloadingDetentionDays(t);
  const lc=loadingDetentionCharge(t),uc=unloadingDetentionCharge(t);
  const editing=String(podEditingTripId)===String(t.id);

  if(editing){
   return `<tr class="pod-inline-edit-row" data-pod-edit-row="${esc(t.id)}"
      oninput="window.EktaPOD.markEditDirty()"
      onchange="window.EktaPOD.markEditDirty()">
    <td>${editInput("podEditTripNo","text",t.trip_number||"")}</td>
    <td>${truckSelect(t)}</td>
    <td>${editInput("podEditLoadingDate","date",dateOnly(t.loading_date))}</td>
    <td>${editInput("podEditLRDate","date",dateOnly(t.lr_date||t.start_date))}</td>
    <td>${partySelect(t)}</td>
    <td id="podEditPartyType">${esc(p?.party_type||"—")}</td>
    <td id="podEditPartyZone">${esc(p?.zone||"—")}</td>
    <td>${editInput("podEditFrom","text",t.loading_point||t.from_location||"")}</td>
    <td>${editInput("podEditTo","text",t.destination||t.to_location||"")}</td>
    <td>${editInput("podEditReportingDate","date",dateOnly(t.reporting_date))}</td>
    <td>${editInput("podEditUnloadingDate","date",dateOnly(t.unloading_date||t.end_date))}</td>
    <td>${ld}</td>
    <td>${editInput("podEditLoadDet","number",lc,'min="0" step="1"')}</td>
    <td>${ud}</td>
    <td>${editInput("podEditUnloadDet","number",uc,'min="0" step="1"')}</td>
    <td>${editInput("podEditUnloadingCharge","number",num(t.unloading_charge),'min="0" step="0.01"')}</td>
    <td>${editInput("podEditOther","number",num(t.other_charge??getNote(t.notes,"OTHER_CHARGE")),'min="0" step="0.01"')}</td>
    <td>${editInput("podEditNGT","number",ngtAmount(t),'min="0" step="0.01"')}</td>
    <td>${badge(podStatus(t))}</td>
    <td>${podActionsCell(t)}</td>
    <td>${editInput("podEditPODReceivedDate","date",dateOnly(podReceivedDate(t)))}</td>
    <td>${editInput("podEditLRNumber","text",t.lr_number||"")}</td>
    <td>${editInput("podEditCourierName","text",courierName(t))}</td>
    <td>${editInput("podEditCourierAwb","text",courierAwb(t))}</td>
    <td>${editInput("podEditCourierDate","date",dateOnly(courierDate(t)))}</td>
    <td>${editInput("podEditCourierDeliveredDate","date",dateOnly(courierDeliveredDate(t)))}</td>
    <td><div style="display:flex;gap:5px">
      <button class="btn green" onclick="window.EktaPOD.saveInlineEdit('${esc(t.id)}')">Save</button>
      <button class="btn" onclick="window.EktaPOD.cancelInlineEdit()">Cancel</button>
    </div></td>
   </tr>`;
  }

  return `<tr ondblclick="window.EktaPOD.handleRowDoubleClick(event,'${esc(t.id)}')" title="Double-click row to edit">
   <td>${esc(t.trip_number||"—")}</td>
   <td><span class="truck" onclick="window.EktaPOD.openTrip('${esc(t.id)}')">${esc(tr?.truck_number||"—")}</span></td>
   <td>${esc(fmt(t.loading_date))}</td>
   <td>${esc(fmt(t.lr_date||t.start_date))}</td>
   <td>${esc(p?.name||"—")}</td>
   <td>${esc(p?.party_type||"—")}</td>
   <td>${esc(p?.zone||"—")}</td>
   <td>${esc(t.loading_point||t.from_location||"—")}</td>
   <td>${esc(t.destination||t.to_location||"—")}</td>
   <td>${esc(fmt(t.reporting_date))}</td>
   <td>${esc(fmt(t.unloading_date||t.end_date))}</td>
   <td>${ld}</td>
   <td class="pod-money">₹${lc.toFixed(2)}</td>
   <td>${ud}</td>
   <td class="pod-money">₹${uc.toFixed(2)}</td>
   <td class="pod-money">₹${num(t.unloading_charge).toFixed(2)}</td>
   <td class="pod-money">₹${num(t.other_charge??getNote(t.notes,"OTHER_CHARGE")).toFixed(2)}</td>
   <td class="pod-money">₹${ngtAmount(t).toFixed(2)}</td>
   <td>${badge(podStatus(t))}</td>
   <td>${podActionsCell(t)}</td>
   <td>${esc(fmt(podReceivedDate(t)))}</td>
   <td>${esc(t.lr_number||"—")}</td>
   <td>${esc(courierName(t)||"—")}</td>
   <td>${esc(courierAwb(t)||"—")}</td>
   <td>${esc(fmt(courierDate(t)))}</td>
   <td>${courierDeliveredDate(t)?`<span class="badge b-verified">${esc(fmt(courierDeliveredDate(t)))}</span>`:"—"}</td>
   <td><button class="btn" onclick="event.stopPropagation();window.EktaPOD.openInlineEdit('${esc(t.id)}')">Edit</button></td>
  </tr>`;
 }).join(""):`<tr><td colspan="27" class="empty">${from||to?"No POD records in selected date range.":"No POD records available."}</td></tr>`;
}
async function saveDirectField(tripId,kind,value,el){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return;

 try{
  let payload={};

  if(kind==="lr_date"){
   payload.lr_date=value||null;
   payload.start_date=value||null;
  }else if(kind==="lr_number"){
   payload.lr_number=clean(value)||null;
  }else if(kind==="pod_received_date"){
   let notes=clean(t.notes)||"";
   notes=putNote(notes,"POD_RECEIVED_DATE",value||"");
   payload.notes=notes;
  }else if(kind==="courier_name"){
   payload.courier_name=clean(value)||null;
  }else if(kind==="courier_awb_number"){
   payload.courier_awb_number=clean(value)||null;
  }else if(kind==="courier_date"){
   payload.courier_date=value||null;
  }else if(kind==="courier_delivered_date"){
   payload.courier_delivered_date=value||null;
  }else{
   return;
  }

  const r=await S.from(T.trips).update(payload).eq("id",tripId);
  if(r.error)throw r.error;

  Object.assign(t,payload);
  if(el){
   el.classList.remove("pod-save-flash");
   void el.offsetWidth;
   el.classList.add("pod-save-flash");
  }
 }catch(err){
  console.error("[EKTA POD] Direct field save failed:",err);
  if(el&&el.dataset.old!==undefined)el.value=el.dataset.old;
  alert("Save failed: "+(err.message||"Database error"));
 }
}


function handleRowDoubleClick(e,id){
 const interactive=e.target.closest("button,input,select,textarea,a,.pod-actions");
 if(interactive)return;
 openInlineEdit(id);
}

function openInlineEdit(id){
 podEditingTripId=id;
 window.__podEditDirty=false;
 render();
 setTimeout(()=>document.querySelector(".pod-inline-edit-row")?.scrollIntoView({block:"nearest",behavior:"smooth"}),0);
}
function cancelInlineEdit(){podEditingTripId=null;window.__podEditDirty=false;render()}
function refreshEditDerived(){
 const p=party($("podEditParty")?.value);
 if($("podEditPartyType"))$("podEditPartyType").textContent=p?.party_type||"—";
 if($("podEditPartyZone"))$("podEditPartyZone").textContent=p?.zone||"—";
}
async function saveInlineEdit(tripId){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return;

 const loadingDate=$("podEditLoadingDate").value||null;
 const lrDate=$("podEditLRDate").value||null;
 const reporting=$("podEditReportingDate").value||null;
 const unloading=$("podEditUnloadingDate").value||null;
 const podReceived=$("podEditPODReceivedDate").value||"";

 let notes=clean(t.notes)||"";
 notes=putNote(notes,"OTHER_CHARGE",num($("podEditOther").value));
 const enteredNGT=num($("podEditNGT").value);
 const ngtChanged=Math.abs(enteredNGT-ngtAmount(t))>0.001;
 if(ngtChanged){
  notes=putNote(notes,"NGT",enteredNGT);
  notes=putNote(notes,"NGT_OVERRIDE","YES");
  notes=clean(notes).replace(/\[TRACKING:NGT_MANUAL=[^\]]*\]/gi,"").trim();
 }
 notes=putNote(notes,"LOADING_DETENTION_CHARGE",num($("podEditLoadDet").value));
 notes=putNote(notes,"UNLOADING_DETENTION_CHARGE",num($("podEditUnloadDet").value));
 notes=putNote(notes,"UNLOADING_DETENTION_DAYS",daysBetween(reporting,unloading));
 notes=putNote(notes,"POD_RECEIVED_DATE",podReceived);

 const payload={
  trip_number:clean($("podEditTripNo").value),
  truck_id:$("podEditTruck").value||t.truck_id,
  party_id:$("podEditParty").value||t.party_id,
  loading_date:loadingDate,
  lr_date:lrDate,
  start_date:lrDate,
  lr_number:clean($("podEditLRNumber").value)||null,
  from_location:clean($("podEditFrom").value),
  loading_point:clean($("podEditFrom").value),
  to_location:clean($("podEditTo").value),
  destination:clean($("podEditTo").value),
  reporting_date:reporting,
  unloading_date:unloading,
  end_date:unloading,
  courier_name:clean($("podEditCourierName").value)||null,
  courier_awb_number:clean($("podEditCourierAwb").value)||null,
  courier_date:$("podEditCourierDate").value||null,
  courier_delivered_date:$("podEditCourierDeliveredDate").value||null,
  notes
 };

 if(Object.prototype.hasOwnProperty.call(t,"detention_charge"))payload.detention_charge=num($("podEditLoadDet").value);
 if(Object.prototype.hasOwnProperty.call(t,"unloading_charge"))payload.unloading_charge=num($("podEditUnloadingCharge").value);
 if(Object.prototype.hasOwnProperty.call(t,"other_charge"))payload.other_charge=num($("podEditOther").value);
 if(Object.prototype.hasOwnProperty.call(t,"ngt") && ngtChanged)payload.ngt=enteredNGT;

 if(!payload.trip_number){alert("Trip No. cannot be blank.");return}

 try{
  const r=await S.from(T.trips).update(payload).eq("id",tripId);
  if(r.error)throw r.error;

  podEditingTripId=null;
  window.__podEditDirty=false;
  await loadAll();
 }catch(err){
  console.error("[EKTA POD] Inline edit failed:",err);
  alert("POD update failed: "+(err.message||"Database error"));
 }
}
function renderError(msg){$("podRows").innerHTML=`<tr><td colspan="14" class="empty" style="color:#c52031">⚠ ${esc(msg)}</td></tr>`}


function safeName(name){
 return clean(name||"pod-document")
  .replace(/[^A-Za-z0-9._-]+/g,"-")
  .replace(/-+/g,"-")
  .replace(/^-|-$/g,"") || "pod-document";
}

function isBillingParty(t){
 const p=party(t.party_id);
 const typ=clean(p?.party_type).toUpperCase().replace(/[\s_-]+/g,'');
 return typ.includes('BILLING');
}
function ocrReset(){
  podOCRValues={};podOCRIndex=0;
 const b=$("podOcrRead"), panel=$("podOcrPanel"), note=$("podOcrNote");
 if(b){b.disabled=false;b.textContent="Read Printed Details (OCR)"}
 if(panel){panel.hidden=true;panel.innerHTML=""}
 if(note)note.textContent="OCR is optional. Nothing is saved or overwritten by OCR.";
}
function ocrExtract(text){
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const match=(re)=>{const m=text.match(re);return m?clean(m[1]):""};
 const vehicle=match(/(?:vehicle\s*(?:no\.?|number)|truck\s*(?:no\.?|number))\s*[:#-]?\s*([A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4})/i);
 const lr=match(/\bLR\s*(?:No\.?|Number)\s*[:#-]?\s*([0-9]{4}[\/.-][0-9]{1,2}[\/.-][0-9]{4,})/i);
 const date=match(/\bLR\s*Date\s*[:#-]?\s*(\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i);
 const qty=match(/\b(?:Total\s*Quantity|Qty|Quantity)\s*[:#-]?\s*(\d{1,7})\b/i);
 const size=match(/\bVehicle\s*(?:Type|Size)\s*[:#-]?\s*(\d{2}\s*FT[A-Z0-9]*)/i);
 // Route labels often share a line with transport/insurance columns.
 // Prefer the text immediately after From:/To:, stopping at the next column.
 const routeValue=(label)=>{
  const re=new RegExp("(?:^|\\n)\\s*"+label+"\\s*[:：.-]\\s*([^\\n]{2,100})","im");
  const m=text.match(re);if(!m)return "";
  let v=m[1].split(/\s{2,}|\s*\|\s*|\t|\b(?:Transport|Insurance|Goods|Consignor|Consignee|Invoice|Vehicle|Freight|LR\s*No)\b/i)[0].trim();
  v=v.replace(/^[|:;,.\s-]+|[|:;,.\s-]+$/g,"");
  return v.length>=3?v:"";
 };
 const from=routeValue("From"),to=routeValue("To");
 const invoice=match(/\bInvoice\s*No\.?\s*[:#-]?\s*([A-Z0-9\/-]{5,})/i);
 const partyBlock=(label,stop)=>{
  const start=lines.findIndex(x=>new RegExp("\\b"+label+"\\s*:","i").test(x));
  if(start<0)return "";
  const first=lines[start].replace(new RegExp("^.*?"+label+"\\s*:\\s*","i"),"");
  const arr=[first];
  for(let k=start+1;k<Math.min(lines.length,start+4);k++){
   if(new RegExp(stop,"i").test(lines[k]))break;
   arr.push(lines[k]);
  }
  return arr.join(" ").slice(0,300);
 };
 const consignor=partyBlock("Consignor","Consignee|Vehicle Details|Invoice No|Freight Details");
 const consignee=partyBlock("Consignee","Vehicle Details|Freight Details|Consignor Remarks|Invoice No");
 return {"Consignor / Address":consignor,"Consignee / Address":consignee,"LR Number":lr,"LR Date":date,"Vehicle Number":vehicle,"Vehicle Size":size,"From":from,"To":to,"Quantity":qty,"Goods Invoice Number":invoice};
}
function ocrNorm(s){return clean(s).toUpperCase().replace(/[^A-Z0-9]/g,"")}
async function loadOCRLibrary(){
 if(window.Tesseract?.recognize)return;
 if(window.__ektaOCRLoad)return window.__ektaOCRLoad;
 window.__ektaOCRLoad=new Promise((resolve,reject)=>{
  const script=document.createElement("script");
  script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  script.onload=()=>window.Tesseract?.recognize?resolve():reject(new Error("OCR library unavailable"));
  script.onerror=()=>reject(new Error("OCR library could not load. Check internet connection."));
  document.head.appendChild(script);
 }).catch(e=>{window.__ektaOCRLoad=null;throw e});
 return window.__ektaOCRLoad;
}
async function loadPdfJs(){
 if(window.pdfjsLib?.getDocument)return window.pdfjsLib;
 if(!window.__ektaPdfPromise){
  window.__ektaPdfPromise=new Promise((resolve,reject)=>{
   const s=document.createElement("script");
   s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
   s.onload=()=>{if(!window.pdfjsLib)return reject(new Error("PDF reader unavailable"));window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";resolve(window.pdfjsLib)};
   s.onerror=()=>reject(new Error("PDF.js could not load; check internet"));document.head.appendChild(s);
  }).catch(e=>{window.__ektaPdfPromise=null;throw e});
 }
 return window.__ektaPdfPromise;
}
async function recognizePODFile(file,note){
 const logger=m=>{if(m.status==="recognizing text")note.textContent=`Reading printed text... ${Math.round((m.progress||0)*100)}%`};
 if(file.type.startsWith("image/")){
  const img=await createImageBitmap(file);
  const scale=Math.min(3,Math.max(1,2000/Math.max(img.width,img.height)));
  const canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);img.close?.();
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  for(let i=0;i<pixels.data.length;i+=4){const g=.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2];const v=Math.max(0,Math.min(255,(g-128)*1.55+145));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v}
  ctx.putImageData(pixels,0,0);
  note.textContent="Reading enhanced POD image...";
  const enhanced=await window.Tesseract.recognize(canvas,"eng",{logger});
  let result=clean(enhanced.data?.text||"");
  // A second pass can recover route labels lost by contrast enhancement.
  if(!/\bTo\s*[:：.-]\s*[A-Za-z]{3,}/i.test(result)||!/\bFrom\s*[:：.-]\s*[A-Za-z]{3,}/i.test(result)){
   note.textContent="Checking route text with original image...";
   const original=await window.Tesseract.recognize(file,"eng",{logger});
   const plain=clean(original.data?.text||"");
   if(plain)result=result+"\n"+plain;
  }
  canvas.width=canvas.height=0;return result;
 }
 const pdfjs=await loadPdfJs();
 const data=await file.arrayBuffer();
 const pdf=await pdfjs.getDocument({data:new Uint8Array(data)}).promise;
 if(pdf.numPages>10)throw new Error("Maximum 10 pages per PDF for OCR. Please split the file.");
 let raw="";
 for(let n=1;n<=pdf.numPages;n++){
  note.textContent=`Reading PDF page ${n}/${pdf.numPages}...`;
  const page=await pdf.getPage(n);
  const content=await page.getTextContent();
  let text=content.items.map(x=>x.str).join(" ");
  // Scanned PDFs have no embedded text. Render those pages and run OCR.
  if(text.trim().length<80){
   const vp=page.getViewport({scale:2});const canvas=document.createElement("canvas");canvas.width=vp.width;canvas.height=vp.height;
   await page.render({canvasContext:canvas.getContext("2d"),viewport:vp}).promise;
   const r=await window.Tesseract.recognize(canvas,"eng",{logger});text=r.data?.text||"";
   canvas.width=canvas.height=0;
  }
  raw+=`\n${text}`;
 }
 return clean(raw);
}
// Every PDF page is independently extracted: never merge two LR documents.
async function recognizePODPages(file,status){
 await loadOCRLibrary();
 if(file.type.startsWith('image/'))return [{page:1,text:await recognizePODFile(file,status)}];
 const pdfjs=await loadPdfJs();const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
 if(pdf.numPages>100)throw Error('This PDF has more than 100 pages. Split it before OCR.');
 const result=[];
 for(let i=1;i<=pdf.numPages;i++){
  status.textContent=`${file.name}: reading page ${i}/${pdf.numPages}`;
  const page=await pdf.getPage(i);const content=await page.getTextContent();
  let text=content.items.map(x=>x.str).join(' ');
  if(text.trim().length<80){
   const vp=page.getViewport({scale:2});const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
   await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
   const resultOCR=await window.Tesseract.recognize(canvas,'eng');text=resultOCR.data?.text||'';
   canvas.width=canvas.height=0;
  }
  result.push({page:i,text});
 }
 return result;
}
function reviewSignature(){return podQueue.map(f=>`${f.name}:${f.size}:${f.lastModified}`).join('|')}
function clearPODReview(){podReview=[];podReviewSignature='';const p=$('podOcrPanel');if(p){p.hidden=true;p.innerHTML=''}const n=$('podOcrNote');if(n)n.textContent='Select documents and click Read All OCR. Verify each LR before saving.';}
function ocrField(row,key){return `<input data-ocr-row="${row}" data-ocr-field="${esc(key)}" value="${esc(podReview[row].fields[key]||'')}" style="width:100%;min-width:110px;border:1px solid #cbd5e1;border-radius:6px;padding:7px;font-size:11px">`}
function renderPODReview(){
 const panel=$('podOcrPanel');if(!panel)return;
 panel.hidden=false;
 panel.innerHTML=`<div style="overflow:auto"><table style="min-width:1100px;width:100%"><thead><tr><th>Source / Page</th><th>LR Number</th><th>LR Date</th><th>QTY</th><th>Consignee / Location</th><th>Vehicle Size</th><th>Truck (check)</th><th>Review</th></tr></thead><tbody>${podReview.map((r,i)=>`<tr><td>${esc(r.filename)}<br>Page ${r.page}</td>${['LR Number','LR Date','Quantity','Consignee / Address','Vehicle Size','Vehicle Number'].map(k=>`<td>${ocrField(i,k)}</td>`).join('')}<td><label><input type="checkbox" data-ocr-confirm="${i}" ${r.confirmed?'checked':''}> Verified</label></td></tr>`).join('')}</tbody></table></div><p class="mini" style="margin-top:8px">Each page is a separate LR. Correct OCR errors manually. Tick Verified for each page. No original trip fields are overwritten. If a page is not an LR, remove that file or review before saving.</p><button type="button" class="btn" onclick="window.EktaPOD.confirmPODReview()">✓ Confirm Reviewed LR Details</button>`;
}
function collectPODReview(){
 document.querySelectorAll('[data-ocr-row][data-ocr-field]').forEach(e=>{const r=podReview[Number(e.dataset.ocrRow)];if(r)r.fields[e.dataset.ocrField]=e.value.trim()});
 document.querySelectorAll('[data-ocr-confirm]').forEach(e=>{if(podReview[Number(e.dataset.ocrConfirm)])podReview[Number(e.dataset.ocrConfirm)].confirmed=e.checked});
}
function validatePODReview(t){
 if(!podQueue.length)throw Error('Select a POD first.');
 if(!podReview.length||podReviewSignature!==reviewSignature())throw Error('Run Read All OCR for the currently selected documents first.');
 collectPODReview();
 const existing=new Set();for(let i=1;i<=100;i++){const raw=getNote(t.notes,`POD_OCR_${i}`);if(!raw)continue;try{const x=JSON.parse(decodeURIComponent(raw));if(x['LR Number'])existing.add(ocrNorm(x['LR Number']))}catch(_){}}
 const seen=new Set();
 for(const r of podReview){
  const f=r.fields,lr=clean(f['LR Number']),qty=clean(f.Quantity),dt=clean(f['LR Date']);
  if(!r.confirmed)throw Error(`${r.filename}, page ${r.page}: tick Verified after checking the document.`);
  if(!lr||!/^\d{4}[\/.\-]\d{1,2}[\/.\-]\d{4,}$/.test(lr))throw Error(`${r.filename}, page ${r.page}: check LR Number.`);
  if(!ocrISODate(dt))throw Error(`${r.filename}, page ${r.page}: check LR Date.`);
  if(!/^\d+(?:\.\d+)?$/.test(qty))throw Error(`${r.filename}, page ${r.page}: check QTY.`);
  if(!clean(f['Consignee / Address'])||!clean(f['Vehicle Size']))throw Error(`${r.filename}, page ${r.page}: enter Consignee and Vehicle Size.`);
  if(existing.has(ocrNorm(lr))||seen.has(ocrNorm(lr)))throw Error(`Duplicate LR ${lr}. Already saved or repeated in this batch.`);
  seen.add(ocrNorm(lr));
  const expected=clean($('podUploadTruckNo')?.value),actual=clean(f['Vehicle Number']);
  if(actual&&expected&&ocrNorm(actual)!==ocrNorm(expected))throw Error(`LR ${lr}: truck ${actual} does not match trip truck ${expected}. Correct or remove the file.`);
 }
 return podReview.map(r=>({...r.fields,'LR Date':ocrISODate(r.fields['LR Date'])}));
}
function confirmPODReview(){try{const t=trips.find(x=>String(x.id)===String($('podUploadTripId').value));validatePODReview(t);$('podOcrNote').textContent=`${podReview.length} LR page(s) verified. Click Save All PODs to upload files and save LR mapping together.`;alert(`${podReview.length} LR details verified. You can now Save All PODs.`)}catch(e){alert(e.message)}}
async function readAllPODOCR(){
 if(podReviewBusy)return;
 if(!podQueue.length){alert('First add one or more POD photos/PDFs.');return}
 const t=trips.find(x=>String(x.id)===String($('podUploadTripId').value));if(!t||!isBillingParty(t)){alert('OCR is available for Billing Parties only.');return}
 const button=$('podOcrRead'),note=$('podOcrNote');podReviewBusy=true;button.disabled=true;podReview=[];
 try{
  for(const file of podQueue){const pages=await recognizePODPages(file,note);for(const page of pages){podReview.push({filename:file.name,page:page.page,fields:ocrExtract(page.text),confirmed:false})}}
  podReviewSignature=reviewSignature();renderPODReview();note.textContent=`${podReview.length} page(s) read. Check each LR, correct fields, tick Verified, then Confirm.`;
 }catch(e){clearPODReview();note.textContent='OCR error: '+e.message;alert('OCR failed: '+e.message)}
 finally{podReviewBusy=false;button.disabled=false}
}
async function showPODList(t){
 const panel=$("podExistingDocs");if(!panel)return;
 const paths=podPaths(t);
 panel.innerHTML=`<b>Uploaded PODs (${paths.length})</b> <button type="button" class="btn" ${paths.length?"":"disabled"} onclick="window.EktaPOD.viewAllPODs('${esc(t.id)}')">👁 View All as PDF</button> <button type="button" class="btn" ${paths.length?"":"disabled"} onclick="window.EktaPOD.downloadAllPODs('${esc(t.id)}')">⬇ Download All as PDF</button>`+(paths.length?paths.map((path,i)=>`<div class="pod-doc"><b>POD ${i+1}</b><button type="button" class="btn" onclick="window.EktaPOD.viewPOD('${esc(t.id)}',${i})">View</button><button type="button" class="btn" onclick="window.EktaPOD.downloadPOD('${esc(t.id)}',${i})">Download</button></div>`).join(""):"<p class='mini'>No POD uploaded yet.</p>");
 const full=paths.length>=100;
 $("podUploadFile").disabled=full;
 const submit=$("podUploadModal").querySelector('button[type="submit"]');if(submit)submit.disabled=full;
 if(full)$("podUploadNote").textContent="All 3 POD slots are occupied. Existing files remain safe.";
}
async function readSavedPOD(id,index){
 const t=trips.find(x=>String(x.id)===String(id));if(!t||!isBillingParty(t)){alert("OCR only for Billing Parties");return}
 const path=podPaths(t)[index];if(!path)return;
 try{
  const url=await signedPODUrl(t,index);
  const response=await fetch(url);if(!response.ok)throw new Error("Cannot download POD for OCR");
  const blob=await response.blob();const filename=path.split("/").pop()||"pod.pdf";
  const file=new File([blob],filename,{type:blob.type||(/\.pdf$/i.test(filename)?"application/pdf":"image/jpeg")});
  const dt=new DataTransfer();dt.items.add(file);$("podUploadFile").disabled=false;$("podUploadFile").files=dt.files;
  await readPrintedPOD();
  // OCR is review-only. Do not re-upload this already saved document.
  $("podUploadFile").value="";if(podPaths(t).length>=100)$("podUploadFile").disabled=true;
 }catch(e){alert("Read saved POD failed: "+e.message)}
}
async function readPrintedPOD(savedIndex=null){
 const file=$("podUploadFile")?.files?.[0], id=clean($("podUploadTripId")?.value);
 const t=trips.find(x=>String(x.id)===id);
 if(!t||!isBillingParty(t)){alert("OCR is available only for Billing Parties.");return}
 if(!file){alert("Please select a POD photo first.");return}
 if(!file.type.startsWith("image/") && file.type!=="application/pdf" && !/\.pdf$/i.test(file.name)){alert("Please choose JPG, PNG or PDF.");return}
 const btn=$("podOcrRead"),note=$("podOcrNote"),panel=$("podOcrPanel");
 btn.disabled=true;note.textContent="Loading OCR reader...";
 try{
  await loadOCRLibrary();
  const raw=await recognizePODFile(file,note);
  const fields=ocrExtract(raw),tr=truck(t.truck_id);
  podOCRValues=fields;podOCRIndex=savedIndex===null?podPaths(t).length:savedIndex;
  const existing={"LR Number":t.lr_number,"LR Date":dateOnly(t.lr_date||t.start_date),"Vehicle Number":tr?.truck_number,"Vehicle Size":tr?.vehicle_type||"","From":t.loading_point||t.from_location,"To":t.destination||t.to_location,"Quantity":"","Goods Invoice Number":""};
  const rows=Object.entries(fields).map(([key,value])=>{
   const prev=clean(existing[key]);
   const status=!value?"Not detected":prev?(ocrNorm(value)===ocrNorm(prev)?"Matches existing":"Review mismatch"):"OCR suggestion — verify";
   const checked=!!value&&!prev;
   return `<tr><td>${esc(key)}</td><td>${esc(prev||"—")}</td><td>${esc(value||"—")}</td><td>${esc(status)}</td><td><input type="checkbox" class="pod-ocr-check" data-ocr-key="${esc(key)}" ${checked?"checked":""} ${!value?"disabled":""} aria-label="Accept ${esc(key)}"></td></tr>`;
  }).join("");
  panel.innerHTML=`<b>Printed POD details — review only (not saved)</b><div class="pod-ocr-table"><table><thead><tr><th>Field</th><th>Tracking / Existing</th><th>OCR Reading</th><th>Status</th><th>✓ Accept</th></tr></thead><tbody>${rows}</tbody></table></div><button type="button" class="btn green" id="podOcrSave" onclick="window.EktaPOD.saveSelectedOCR()">✓ Save Selected Details</button><details><summary>View extracted text</summary><pre class="pod-ocr-raw">${esc(raw||"No text detected")}</pre></details><p class="mini">OCR can misread photos. Confirm against the original POD. Existing trip data remains unchanged.</p>`;
  panel.hidden=false;
  note.textContent="OCR finished. Tick only verified values, then Save Selected Details. Upload POD separately when ready.";
 }catch(err){console.error("[EKTA POD OCR]",err);note.textContent="OCR failed: "+(err.message||"Unable to read image")}
 finally{btn.disabled=false}
}
function ocrISODate(value){
 const m=clean(value).match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
 const n=clean(value).match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
 const y=m?Number(m[1]):n?Number(n[3]):0, mo=m?Number(m[2]):n?Number(n[2]):0, d=m?Number(m[3]):n?Number(n[1]):0;
 if(!y||mo<1||mo>12||d<1||d>31)return null;
 const dt=new Date(Date.UTC(y,mo-1,d));
 if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return null;
 return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
async function saveSelectedOCR(){
 const id=clean($("podUploadTripId")?.value),t=trips.find(x=>String(x.id)===id);
 if(!t||!isBillingParty(t)){alert("OCR saving is available only for Billing Parties.");return}
 const selected=[...document.querySelectorAll("#podOcrPanel .pod-ocr-check:checked")].map(x=>x.dataset.ocrKey);
 if(!selected.length){alert("Please tick at least one verified OCR field.");return}
 const values={};for(const key of selected){if(clean(podOCRValues[key]))values[key]=clean(podOCRValues[key])}
 const payload={};
 if(values["LR Number"])payload.lr_number=values["LR Number"];
 if(values["LR Date"]){const d=ocrISODate(values["LR Date"]);if(!d){alert("LR Date could not be validated. Untick it and retry.");return}payload.lr_date=d;payload.start_date=d}
 if(values["From"]){payload.from_location=values["From"];payload.loading_point=values["From"]}
 if(values["To"]){payload.to_location=values["To"];payload.destination=values["To"]}
 // Keep document-specific printed details in separate POD slots; do not change truck/party masters.
 const key=`POD_OCR_${podOCRIndex+1}`;
 let previous={};try{previous=JSON.parse(decodeURIComponent(getNote(t.notes,key)||"%7B%7D"))}catch(_){}
 const merged={...previous,...values};
 payload.notes=putNote(t.notes,key,encodeURIComponent(JSON.stringify(merged)));
 const btn=$("podOcrSave");if(btn)btn.disabled=true;
 try{
  const r=await S.from(T.trips).update(payload).eq("id",id).select("id");
  if(r.error)throw r.error;
  if(!r.data?.length)throw new Error("No row updated. Check Supabase permissions.");
  Object.assign(t,payload);
  $("podOcrNote").textContent=`Saved ${selected.length} selected OCR field(s) to Supabase for POD ${podOCRIndex+1}. Unticked values were not changed.`;
  await loadAll();
 }catch(e){console.error("[EKTA POD OCR] Save failed",e);alert("OCR save failed: "+(e.message||"Database error"))}
 finally{if(btn)btn.disabled=false}
}
function openPODUpload(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 const tr=truck(t.truck_id);
 $("podUploadTripId").value=t.id;
 $("podUploadTripNo").value=t.trip_number||"";
 $("podUploadTruckNo").value=tr?.truck_number||"";
 $("podUploadFile").value="";
 podQueue=[];clearPODReview();
 $("podUploadNote").textContent="New PODs are added without replacing existing PODs.";
 $("podUploadTitle").textContent=`UPLOAD POD — ${t.trip_number||""}`;
  // OCR section was present in HTML but remained hidden on every upload.
  // Show it only for Billing Parties; never change any trip values here.
  const ocrArea=$("podOcrArea");
  if(ocrArea)ocrArea.hidden=!isBillingParty(t);
  ocrReset();
  showPODList(t);renderPODQueue();
 $("podUploadModal").classList.add("show");
}

function renderPODQueue(){
 const el=$("podQueuedDocs"),t=trips.find(x=>String(x.id)===String($("podUploadTripId")?.value));
 if(!el||!t)return;
 const existing=podPaths(t).length;
 el.innerHTML=`<b>New PODs ready to save (${podQueue.length})</b>`+(podQueue.length?podQueue.map((f,i)=>`<div class="pod-doc"><b>POD ${existing+i+1} — ${esc(f.name)}</b><button class="btn" type="button" onclick="window.EktaPOD.removeQueuedPOD(${i})">Remove</button></div>`).join(""):'<p class="mini">Use + Add POD to select photos or PDFs.</p>');
 const save=$("podSaveAll");if(save)save.disabled=!podQueue.length;
}
function queuePODFiles(){
 const input=$("podUploadFile"),t=trips.find(x=>String(x.id)===String($("podUploadTripId")?.value));
 if(!t)return;
 const chosen=Array.from(input.files||[]);
 const capacity=100-podPaths(t).length-podQueue.length;
 if(chosen.length>capacity){alert(`Only ${Math.max(0,capacity)} more POD(s) can be added to this trip.`);input.value="";return}
 for(const file of chosen){
  if(!file.type.startsWith("image/")&&file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){alert("Only image and PDF documents are allowed.");continue}
  podQueue.push(file);
 }
 input.value="";clearPODReview();renderPODQueue();
}
function removeQueuedPOD(i){podQueue.splice(i,1);clearPODReview();renderPODQueue()}
function chooseMorePOD(){const t=trips.find(x=>String(x.id)===String($("podUploadTripId")?.value));if(!t)return;
 if(podPaths(t).length+podQueue.length>=100){alert("Maximum 100 POD documents per trip.");return}
 $("podUploadFile").click();
}
async function savePODDocument(e){
 e.preventDefault();
 const tripId=clean($("podUploadTripId").value),t=trips.find(x=>String(x.id)===String(tripId));
 if(!t||!podQueue.length){alert("Please add a POD first.");return false}
 if(podPaths(t).length+podQueue.length>100){alert("Maximum 100 PODs per trip.");return false}
 let verifiedRows=[];
 if(isBillingParty(t)){try{verifiedRows=validatePODReview(t)}catch(err){alert('OCR review required: '+err.message);return false}}
 const btn=$("podSaveAll");btn.disabled=true;
 const uploaded=[];
 try{
  // Fetch latest notes before saving so concurrent uploads cannot silently overwrite a slot.
  const latest=await S.from(T.trips).select("notes").eq("id",tripId).single();
  if(latest.error)throw latest.error;
  let notes=latest.data.notes||"";
  const keys=Array.from({length:100},(_,i)=>i?`POD_DOC_PATH_${i+1}`:"POD_DOC_PATH");
  const slots=keys.filter(k=>!getNote(notes,k));
  if(slots.length<podQueue.length)throw new Error("POD slots changed. Refresh and try again.");
  const ocrSlots=Array.from({length:100},(_,i)=>`POD_OCR_${i+1}`).filter(k=>!getNote(notes,k));
  if(ocrSlots.length<verifiedRows.length)throw Error('Not enough LR OCR slots for this trip.');
  const already=new Set();for(let i=1;i<=100;i++){const raw=getNote(notes,`POD_OCR_${i}`);if(raw)try{already.add(ocrNorm(JSON.parse(decodeURIComponent(raw))['LR Number']))}catch(_){}}
  for(const row of verifiedRows)if(already.has(ocrNorm(row['LR Number'])))throw Error('Duplicate LR already saved: '+row['LR Number']);
  for(let i=0;i<podQueue.length;i++){
   const file=podQueue[i];$("podUploadNote").textContent=`Uploading ${i+1}/${podQueue.length}: ${file.name}`;
   const path=`${tripId}/${Date.now()}-${i}-${Math.random().toString(36).slice(2,10)}-${safeName(file.name)}`;
   const up=await S.storage.from("pod-documents").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type||undefined});
   if(up.error)throw up.error;
   uploaded.push(up.data?.path||path);
   notes=putNote(notes,slots[i],uploaded[i]);
  }
  for(let i=0;i<verifiedRows.length;i++)notes=putNote(notes,ocrSlots[i],encodeURIComponent(JSON.stringify(verifiedRows[i])));
  notes=putNote(notes,"POD_STATUS","RECEIVED");
  notes=putNote(notes,"POD_RECEIVED_AT",new Date().toISOString());
  if(!getNote(notes,"POD_RECEIVED_DATE"))notes=putNote(notes,"POD_RECEIVED_DATE",today());
  let q=S.from(T.trips).update({notes}).eq("id",tripId);
  q=latest.data.notes==null?q.is("notes",null):q.eq("notes",latest.data.notes);
  const r=await q.select("id");
  if(r.error)throw r.error;
  if(!r.data?.length)throw new Error("POD record changed during upload. Please retry.");
  const count=podQueue.length;podQueue=[];clearPODReview();
  await loadAll();
  const fresh=trips.find(x=>String(x.id)===String(tripId));if(fresh)showPODList(fresh);
  $("podUploadNote").textContent=`${count} POD(s) saved successfully. Add more without closing this form.`;
  alert(`${count} POD(s) saved successfully.`);
 }catch(err){
  // Uploaded files are removed if the trip record could not be saved.
  if(uploaded.length){const cleanup=await S.storage.from("pod-documents").remove(uploaded);if(cleanup.error)console.warn("POD cleanup required:",uploaded,cleanup.error)}
  console.error("[EKTA POD] Upload failed:",err);$("podUploadNote").textContent="Upload failed: "+err.message;
  alert("POD upload failed: "+err.message);
 }finally{btn.disabled=false;renderPODQueue()}
 return false;
}
function loadPdfLib(){
 if(window.PDFLib?.PDFDocument)return Promise.resolve(window.PDFLib);
 if(!window.__ektaPodPdfLib)window.__ektaPodPdfLib=new Promise((resolve,reject)=>{
  const sc=document.createElement("script");sc.src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
  sc.onload=()=>window.PDFLib?.PDFDocument?resolve(window.PDFLib):reject(new Error("PDF merge library unavailable"));
  sc.onerror=()=>reject(new Error("PDF merge library could not load"));document.head.appendChild(sc);
 }).catch(e=>{window.__ektaPodPdfLib=null;throw e});
 return window.__ektaPodPdfLib;
}
async function combinedPODs(id,preview=false){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 const paths=podPaths(t);if(!paths.length){alert("No PODs saved for this trip.");return}
 try{
  const lib=await loadPdfLib(),out=await lib.PDFDocument.create();
  for(let i=0;i<paths.length;i++){
   const path=paths[i],url=await signedPODUrl(t,i),res=await fetch(url);
   if(!res.ok)throw new Error(`Cannot read POD ${i+1} (${res.status})`);
   const bytes=await res.arrayBuffer();
   if(/\.pdf(?:$|\?)/i.test(path)||res.headers.get("content-type")?.includes("application/pdf")){
    const pdf=await lib.PDFDocument.load(bytes);const pages=await out.copyPages(pdf,pdf.getPageIndices());pages.forEach(p=>out.addPage(p));
   }else{
    const blob=new Blob([bytes]);const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;
    canvas.getContext("2d").drawImage(bitmap,0,0);bitmap.close?.();
    const jpg=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Image conversion failed")),"image/jpeg",0.9));
    canvas.width=canvas.height=0;
    const img=await out.embedJpg(await jpg.arrayBuffer());const page=out.addPage([img.width,img.height]);page.drawImage(img,{x:0,y:0,width:img.width,height:img.height});
   }
  }
  const pdfBytes=await out.save(),blob=new Blob([pdfBytes],{type:"application/pdf"}),url=URL.createObjectURL(blob);
  if(preview){const win=window.open(url,'_blank');if(!win)throw Error('Allow pop-ups to preview the combined PDF.');setTimeout(()=>URL.revokeObjectURL(url),300000)}
  else{const a=document.createElement("a");a.href=url;a.download=`POD-ALL-${safeName(t.trip_number||"trip")}.pdf`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 }catch(err){console.error("[EKTA POD] Download all failed",err);alert("Download All failed: "+err.message)}
}

function downloadAllPODs(id){return combinedPODs(id,false)}
function viewAllPODs(id){return combinedPODs(id,true)}
async function signedPODUrl(t,index=0){
 const path=podPaths(t)[index];
 if(!path)throw new Error("No POD document uploaded.");
 if(/^https?:\/\//i.test(path))return path;
 const r=await S.storage.from("pod-documents").createSignedUrl(path,60*60);
 if(r.error)throw r.error;
 if(!r.data?.signedUrl)throw new Error("Signed URL not created.");
 return r.data.signedUrl;
}

async function viewPOD(id,index=0){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 try{
  const url=await signedPODUrl(t,index);
  window.open(url,"_blank","noopener,noreferrer");
 }catch(err){
  console.error("[EKTA POD] View failed:",err);
  alert("View POD failed: "+(err.message||"Storage error"));
 }
}

async function downloadPOD(id,index=0){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 try{
  const url=await signedPODUrl(t,index);
  const a=document.createElement("a");
  a.href=url;
  a.download=`POD-${t.trip_number||"document"}-${index+1}`;
  a.target="_blank";
  a.rel="noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
 }catch(err){
  console.error("[EKTA POD] Download failed:",err);
  alert("Download POD failed: "+(err.message||"Storage error"));
 }
}

function openTrip(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 const tr=truck(t.truck_id),p=party(t.party_id);
 const ld=loadingDetentionDays(t),ud=unloadingDetentionDays(t);

 $("podTripTitle").textContent=`POD Trip — ${t.trip_number||""}`;
 $("podTripBody").innerHTML=`
  <div class="grid2">
   <div class="field"><label>Trip No.</label><input readonly value="${esc(t.trip_number||"—")}"></div>
   <div class="field"><label>Truck</label><input readonly value="${esc(tr?.truck_number||"—")}"></div>
   <div class="field"><label>Party / Client</label><input readonly value="${esc(p?.name||"—")}"></div>
   <div class="field"><label>Party Type / Zone</label><input readonly value="${esc((p?.party_type||"—")+" / "+(p?.zone||"—"))}"></div>
   <div class="field"><label>Loading Date</label><input readonly value="${esc(fmt(t.loading_date))}"></div>
   <div class="field"><label>LR Date</label><input readonly value="${esc(fmt(t.lr_date||t.start_date))}"></div>
   <div class="field"><label>LR Number</label><input readonly value="${esc(t.lr_number||"—")}"></div>
   <div class="field"><label>Reporting Date</label><input readonly value="${esc(fmt(t.reporting_date))}"></div>
   <div class="field"><label>Unloading Date</label><input readonly value="${esc(fmt(t.unloading_date||t.end_date))}"></div>
   <div class="field full"><label>Route</label><input readonly value="${esc((t.loading_point||t.from_location||"—")+" → "+(t.destination||t.to_location||"—"))}"></div>
   <div class="field"><label>Loading Detention</label><input readonly value="${ld} day(s) / ₹${loadingDetentionCharge(t).toFixed(2)}"></div>
   <div class="field"><label>Unloading Detention</label><input readonly value="${ud} day(s) / ₹${unloadingDetentionCharge(t).toFixed(2)}"></div>
   <div class="field"><label>Unloading Charge</label><input readonly value="₹${num(t.unloading_charge).toFixed(2)}"></div>
   <div class="field"><label>Other / NGT</label><input readonly value="₹${num(t.other_charge??getNote(t.notes,"OTHER_CHARGE")).toFixed(2)} / ₹${ngtAmount(t).toFixed(2)}"></div>
   <div class="field"><label>POD Status</label><input readonly value="${esc(podStatus(t))}"></div>
   <div class="field"><label>POD Received Date</label><input readonly value="${esc(fmt(podReceivedDate(t)))}"></div>
   <div class="field"><label>Courier Name</label><input readonly value="${esc(courierName(t)||"—")}"></div>
   <div class="field"><label>AWB / Tracking No.</label><input readonly value="${esc(courierAwb(t)||"—")}"></div>
   <div class="field"><label>Courier Date</label><input readonly value="${esc(fmt(courierDate(t)))}"></div>
   <div class="field"><label>Courier Delivered Date</label><input readonly value="${esc(fmt(courierDeliveredDate(t)))}"></div>
  </div>
  <div class="footer">
    ${podActionsCell(t)}
    <button class="btn" onclick="window.EktaPOD.closeModal('podTripModal');window.EktaPOD.openInlineEdit('${esc(t.id)}')">Edit</button>
    <button class="btn" onclick="window.EktaPOD.closeModal('podTripModal')">Close</button>
  </div>`;
 $("podTripModal").classList.add("show");
}
function closeModal(id){$(id)?.classList.remove("show")}
function shiftDate(n){}
function setToday(){}
async function refresh(){await loadAll()}
function scrollPage(direction){$("podModule")?.scrollBy({top:Math.max(320,Math.round(window.innerHeight*.72))*Number(direction||1),behavior:"smooth"})}


function showAllDates(){
 $("podFromDate").value="";$("podToDate").value="";
 render();
}

async function closePOD(){
 closeModal("podTripModal");document.body.style.overflow="";
 try{
  if(typeof window.loadDefaultDashboardHome==="function"){await window.loadDefaultDashboardHome();return}
  if(typeof window.loadModule==="function"){await window.loadModule("dashboard-home.html");return}
  if($("podModule"))$("podModule").style.display="none";
 }catch(err){
  console.error("[EKTA POD] Dashboard return failed:",err);
  if($("podModule"))$("podModule").style.display="none";
 }
}


document.addEventListener("keydown",function(e){
 if(!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)||e.altKey||e.ctrlKey||e.metaKey)return;
 if(!$("podModule")||$("podModule").style.display==="none")return;
 if(document.querySelector(".modal.show"))return;
 if(e.target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
 const table=document.querySelector("#podModule .tablewrap"),page=$("podModule");
 if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
  if(!table||table.scrollWidth<=table.clientWidth)return;
  e.preventDefault();table.scrollBy({left:e.key==="ArrowRight"?190:-190,behavior:"smooth"});
 }else{e.preventDefault();page.scrollBy({top:e.key==="ArrowDown"?140:-140,behavior:"smooth"})}
});
document.addEventListener("mousedown",function(e){
 if(!podEditingTripId)return;

 const row=document.querySelector(`[data-pod-edit-row="${CSS.escape(String(podEditingTripId))}"]`);
 if(!row)return;

 if(row.contains(e.target))return;
 if(e.target.closest(".modal"))return;
 if(e.target.closest(".scrollctl"))return;

 // Navigation / filter / POD action buttons should not unexpectedly end edit mode.
 if(e.target.closest(".toolbar,.actions,.pod-actions"))return;

 if(window.__podEditDirty){
  const id=podEditingTripId;
  setTimeout(()=>saveInlineEdit(id),0);
 }else{
  podEditingTripId=null;
  render();
 }
});

window.EktaPOD={init:()=>{},render,refresh,openNGTRate,saveNGTRate,shiftDate,setToday,showAllDates,openPODUpload,readPrintedPOD,readSavedPOD,readAllPODOCR,confirmPODReview,saveSelectedOCR,ocrReset,savePODDocument,queuePODFiles,removeQueuedPOD,chooseMorePOD,downloadAllPODs,viewAllPODs,viewPOD,downloadPOD,saveDirectField,markEditDirty,handleRowDoubleClick,openTrip,openInlineEdit,cancelInlineEdit,saveInlineEdit,refreshEditDerived,closeModal,closePOD,scrollPage};

async function init(){
 if(!$("podModule"))return;
 const params=new URLSearchParams(window.location.search);
 const embedded=params.get("ledger_embed")==="1";
 if(embedded){
  $("podModule").style.display="none";
  document.body.style.background="transparent";
  const tripId=params.get("trip_id");
  await loadAll();
  if(tripId){
   if(!trips.some(t=>String(t.id)===String(tripId))){
    document.body.insertAdjacentHTML("beforeend",'<p style="padding:25px;color:#b91c1c">POD Trip not found or cannot be loaded.</p>');
   }else openPODUpload(tripId);
  }
  return;
 }
 document.body.style.overflow="hidden";$("podFromDate").value="";$("podToDate").value="";await loadAll();
}
init();
})();