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
// Market trips remain in their own table; never create a duplicate fleet trip.
function tableFor(t){return t?._market?"market_trips":T.trips}
function tripTruck(t){return t?._market?{truck_number:t._marketTruck}:truck(t.truck_id)}
function tripParty(t){return t?._market?{name:t.party_name||"—",party_type:"BILLING",zone:"—"}:party(t.party_id)}
function marketTruckCell(t){return `<div class="pod-market-box"><span class="truck" onclick="window.EktaPOD.openTrip('${esc(t.id)}')">${esc(t._marketTruck||"—")}</span><span class="pod-market-tag">MARKET</span><span class="pod-market-owner" title="${esc(t._marketOwner||"")}">${esc(t._marketOwner||"Owner not recorded")}</span></div>`}


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
// Mobile scanner saves OCR per document in notes; preserve any manually set trip LR.
function mobilePODValue(t,key){
 const notes=clean(t.notes);
 for(let i=1;i<=100;i++){
  const value=getNote(notes,`${key}_DOC_${i}`);
  if(value)return value;
 }
 return getNote(notes,key);
}
function displayLRNumber(t){return clean(t.lr_number)||mobilePODValue(t,"POD_LR_NUMBER")}
function podDocumentDetail(t,index){
 const slot=index+1;
 const fields=[["LR","POD_LR_NUMBER"],["Qty","POD_QTY"],["Consignee","POD_CONSIGNEE"],["Invoice","POD_INVOICE_NO"]];
 return fields.map(([label,key])=>{
  const value=getNote(t.notes,`${key}_DOC_${slot}`);
  return value?`<span class="mini"><b>${label}:</b> ${esc(value)}</span>`:"";
 }).filter(Boolean).join(" · ");
}


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
function unloadingDetentionDays(t){return Math.max(0,daysBetween(t.reporting_date,t.unloading_date||t.end_date)-1)}
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
  if(t._market)continue; // Market NGT auto-posting requires separate approval.
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
let podQueue=[];
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
   // Market read failures must not hide or interrupt original POD records.
   try{
    const [mr,mv,mo]=await Promise.all([
     S.from("market_trips").select("*").limit(5000),
     S.from("market_vehicles").select("id,truck_number,transporter_id").limit(5000),
     S.from("market_transporters").select("id,transporter_name").limit(5000)
    ]);
    for(const r of [mr,mv,mo])if(r.error)throw r.error;
    const vehicles=new Map((mv.data||[]).map(x=>[String(x.id),x]));
    const owners=new Map((mo.data||[]).map(x=>[String(x.id),x.transporter_name]));
    const market=(mr.data||[]).filter(x=>podSent(x)).map(x=>{
     const v=vehicles.get(String(x.vehicle_id));
     return {...x,_market:true,_marketTruck:v?.truck_number||"",_marketOwner:owners.get(String(x.transporter_id||v?.transporter_id))||""};
    });
    trips.push(...market);
   }catch(e){console.warn("[POD] Market records unavailable; own-fleet POD remains usable",e)}
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
 const vehicleType=$("podVehicleType")?.value||"";
 return podRecords().filter(t=>{
  const tr=tripTruck(t),p=tripParty(t),ld=dateOnly(t.loading_date);
  const hay=[t.trip_number,tr?.truck_number,p?.name,p?.party_code,t.loading_point,t.from_location,t.destination,t.to_location,t._marketOwner].join(" ").toLowerCase();
  if(q&&!hay.includes(q))return false;
  if(from&&ld<from)return false;
  if(to&&ld>to)return false;
  if(vehicleType==="MARKET"&&!t._market)return false;
  if(vehicleType==="OWN"&&t._market)return false;
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
  const tr=tripTruck(t),p=tripParty(t);
   const ld=loadingDetentionDays(t),ud=unloadingDetentionDays(t);
  const lc=loadingDetentionCharge(t),uc=unloadingDetentionCharge(t);
  const editing=!t._market&&String(podEditingTripId)===String(t.id);

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
    <td>${editInput("podEditLRNumber","text",displayLRNumber(t))}</td>
    <td>${editInput("podEditCourierName","text",courierName(t))}</td>
    <td>${editInput("podEditCourierAwb","text",courierAwb(t))}</td>
    <td>${editInput("podEditCourierDate","date",dateOnly(courierDate(t)))}</td>
    <td>${editInput("podEditCourierDeliveredDate","date",dateOnly(courierDeliveredDate(t)))}</td>
    <td><div style="display:flex;gap:5px">
      <button class="btn green" onclick="window.EktaPOD.saveInlineEdit('${esc(t.id)}')">Save</button>
      <button class="btn" onclick="window.EktaPOD.cancelInlineEdit()">Cancel</button>
    </div></td>
   </tr>
   `;
  }

  return `<tr ondblclick="window.EktaPOD.handleRowDoubleClick(event,'${esc(t.id)}')" title="Double-click row to edit">
   <td>${esc(t.trip_number||"—")}</td>
   <td>${t._market?marketTruckCell(t):`<span class="truck" onclick="window.EktaPOD.openTrip('${esc(t.id)}')">${esc(tr?.truck_number||"—")}</span>`}</td>
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
   <td>${esc(displayLRNumber(t)||"—")}</td>
   <td>${esc(courierName(t)||"—")}</td>
   <td>${esc(courierAwb(t)||"—")}</td>
   <td>${esc(fmt(courierDate(t)))}</td>
   <td>${courierDeliveredDate(t)?`<span class="badge b-verified">${esc(fmt(courierDeliveredDate(t)))}</span>`:"—"}</td>
   <td>${t._market?`<button class="btn" onclick="event.stopPropagation();window.EktaPOD.openTrip('${esc(t.id)}')">View</button>`:`<button class="btn" onclick="event.stopPropagation();window.EktaPOD.openInlineEdit('${esc(t.id)}')">Edit</button>`}</td>
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

  const r=await S.from(tableFor(t)).update(payload).eq("id",tripId);
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
   if(trips.find(x=>String(x.id)===String(id))?._market)return;
  openInlineEdit(id);
}

function openInlineEdit(id){openTrip(id)}
function cancelInlineEdit(){podEditingTripId=null;window.__podEditDirty=false;render()}
function refreshEditDerived(){
 const p=party($("podEditParty")?.value);
 if($("podEditPartyType"))$("podEditPartyType").textContent=p?.party_type||"—";
 if($("podEditPartyZone"))$("podEditPartyZone").textContent=p?.zone||"—";
 if($("podEditPartyTypeZone"))$("podEditPartyTypeZone").value=(p?.party_type||"—")+" / "+(p?.zone||"—");
}
function podInlineMaterialInput(t,key,id,label,numeric=false){
 const value=getNote(t.notes,key);
 return `<label class="pod-material-inline-field"><span>${label}</span><input id="${id}" class="pod-edit-input" ${numeric?'type="number" min="0" step="1"':'type="text"'} value="${esc(value)}" placeholder="Not entered"></label>`;
}
function podInlineMaterialValues(){
 const fields=[
  ["POD_VEHICLE_TYPE","podEditMaterialVehicleType"],
  ["POD_QTY","podEditMaterialQty"],
  ["POD_INVOICE_NO","podEditMaterialInvoice"],
  ["POD_PACKING_DAMAGE_QTY","podEditMaterialDamage"],
  ["POD_SHORT_QTY","podEditMaterialShort"]
 ];
 return fields.map(([key,id])=>{
  const value=clean($(id)?.value ?? $({podEditMaterialVehicleType:"podMaterialVehicleType",podEditMaterialQty:"podMaterialQty",podEditMaterialInvoice:"podMaterialInvoice",podEditMaterialDamage:"podMaterialDamage",podEditMaterialShort:"podMaterialShort"}[id])?.value);
  if(["POD_QTY","POD_PACKING_DAMAGE_QTY","POD_SHORT_QTY"].includes(key)&&value!==""&&(!Number.isInteger(Number(value))||Number(value)<0))throw Error("Qty, Packing Damage Qty and Short Qty must be non-negative whole numbers.");
  if(/[\[\]\r\n]/.test(value))throw Error("Material details cannot contain brackets or line breaks.");
  return [key,value];
 });
}
function mergePODMaterialNotes(notes,values){
 for(const [key,value] of values){
  notes=notes.replace(new RegExp(`\\[TRACKING:${key}=[^\\]]*\\]`,"gi"),"").trim();
  if(value!=="")notes=putNote(notes,key,value);
 }
 return notes;
}
async function saveInlineEdit(tripId){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return;

 const loadingDate=$("podEditLoadingDate").value||null;
 const lrDate=$("podEditLRDate").value||null;
 const reporting=$("podEditReportingDate").value||null;
 const unloading=$("podEditUnloadingDate").value||null;
 const podReceived=$("podEditPODReceivedDate").value||"";

 let materialValues;
 try{materialValues=podInlineMaterialValues()}catch(e){alert(e.message);return}
 let notes=mergePODMaterialNotes(clean(t.notes)||"",materialValues);
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
 notes=putNote(notes,"UNLOADING_DETENTION_DAYS",Math.max(0,daysBetween(reporting,unloading)-1));
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
  let q=S.from(T.trips).update(payload).eq("id",tripId);
  q=t.notes==null?q.is("notes",null):q.eq("notes",t.notes);
  const r=await q.select("id");
  if(r.error)throw r.error;
  if(!r.data?.length)throw Error("Trip details changed elsewhere. Refresh and retry to avoid overwriting new POD data.");

  podEditingTripId=null;
  window.__podEditDirty=false;
  closeModal("podTripModal");
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

async function showPODList(t){
 const panel=$("podExistingDocs");if(!panel)return;
 const paths=podPaths(t);
 panel.innerHTML=`<b>Uploaded PODs (${paths.length})</b> <button type="button" class="btn" ${paths.length?"":"disabled"} onclick="window.EktaPOD.viewAllPODs('${esc(t.id)}')">👁 View All as PDF</button> <button type="button" class="btn" ${paths.length?"":"disabled"} onclick="window.EktaPOD.downloadAllPODs('${esc(t.id)}')">⬇ Download All as PDF</button>`+(paths.length?paths.map((path,i)=>`<div class="pod-doc"><b>POD ${i+1}<span style="display:block;font-weight:400;white-space:normal;margin-top:3px">${podDocumentDetail(t,i)}</span></b><button type="button" class="btn" onclick="window.EktaPOD.viewPOD('${esc(t.id)}',${i})">View</button><button type="button" class="btn" onclick="window.EktaPOD.downloadPOD('${esc(t.id)}',${i})">Download</button></div>`).join(""):"<p class='mini'>No POD uploaded yet.</p>");
 const full=paths.length>=100;
 $("podUploadFile").disabled=full;
 const submit=$("podUploadModal").querySelector('button[type="submit"]');if(submit)submit.disabled=full;
 if(full)$("podUploadNote").textContent="All 100 POD slots are occupied. Existing files remain safe.";
}
function openPODUpload(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 const tr=tripTruck(t);
 $("podUploadTripId").value=t.id;
 $("podUploadTripNo").value=t.trip_number||"";
 $("podUploadTruckNo").value=tr?.truck_number||"";
 $("podUploadFile").value="";
 podQueue=[];
 $("podUploadNote").textContent="New PODs are added without replacing existing PODs.";
 $("podUploadTitle").textContent=`UPLOAD POD — ${t.trip_number||""}`;
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
 input.value="";renderPODQueue();
}
function removeQueuedPOD(i){podQueue.splice(i,1);renderPODQueue()}
function chooseMorePOD(){const t=trips.find(x=>String(x.id)===String($("podUploadTripId")?.value));if(!t)return;
 if(podPaths(t).length+podQueue.length>=100){alert("Maximum 100 POD documents per trip.");return}
 $("podUploadFile").click();
}
async function savePODDocument(e){
 e.preventDefault();
 const tripId=clean($("podUploadTripId").value),t=trips.find(x=>String(x.id)===String(tripId));
 if(!t||!podQueue.length){alert("Please add a POD first.");return false}
 if(podPaths(t).length+podQueue.length>100){alert("Maximum 100 PODs per trip.");return false}
 const btn=$("podSaveAll");btn.disabled=true;
 const uploaded=[];
 try{
  // Fetch latest notes before saving so concurrent uploads cannot silently overwrite a slot.
  const latest=await S.from(tableFor(t)).select("notes").eq("id",tripId).single();
  if(latest.error)throw latest.error;
  let notes=latest.data.notes||"";
  const keys=Array.from({length:100},(_,i)=>i?`POD_DOC_PATH_${i+1}`:"POD_DOC_PATH");
  const slots=keys.filter(k=>!getNote(notes,k));
  if(slots.length<podQueue.length)throw new Error("POD slots changed. Refresh and try again.");
  for(let i=0;i<podQueue.length;i++){
   const file=podQueue[i];$("podUploadNote").textContent=`Uploading ${i+1}/${podQueue.length}: ${file.name}`;
   const path=`${t._market?"market/":""}${tripId}/${Date.now()}-${i}-${Math.random().toString(36).slice(2,10)}-${safeName(file.name)}`;
   const up=await S.storage.from("pod-documents").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type||undefined});
   if(up.error)throw up.error;
   uploaded.push(up.data?.path||path);
   notes=putNote(notes,slots[i],uploaded[i]);
  }
  notes=putNote(notes,"POD_STATUS","RECEIVED");
  notes=putNote(notes,"POD_RECEIVED_AT",new Date().toISOString());
  if(!getNote(notes,"POD_RECEIVED_DATE"))notes=putNote(notes,"POD_RECEIVED_DATE",today());
  let q=S.from(tableFor(t)).update({notes}).eq("id",tripId);
  q=latest.data.notes==null?q.is("notes",null):q.eq("notes",latest.data.notes);
  const r=await q.select("id");
  if(r.error)throw r.error;
  if(!r.data?.length)throw new Error("POD record changed during upload. Please retry.");
  const count=podQueue.length;podQueue=[];
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

// POD material fields are persisted in the existing trip notes, without schema/RLS changes.
const POD_MATERIAL_FIELDS=[
 ["POD_VEHICLE_TYPE","podMaterialVehicleType"],
 ["POD_QTY","podMaterialQty"],
 ["POD_INVOICE_NO","podMaterialInvoice"],
 ["POD_PACKING_DAMAGE_QTY","podMaterialDamage"],
 ["POD_SHORT_QTY","podMaterialShort"]
];
function podMaterialInput(t,key,id,label,numeric=false){
 const value=getNote(t.notes,key);
 return `<div class="field"><label>${label}</label><input id="${id}" ${numeric?'type="number" min="0" step="1"':'type="text"'} value="${esc(value)}" placeholder="Not entered"></div>`;
}
async function savePODMaterial(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 const button=$("podMaterialSave");if(button)button.disabled=true;
 try{
  const values=POD_MATERIAL_FIELDS.map(([key,fieldId])=>{
   const raw=clean($(fieldId)?.value);
   if(["POD_QTY","POD_PACKING_DAMAGE_QTY","POD_SHORT_QTY"].includes(key)&&raw!==""&&(!Number.isFinite(Number(raw))||Number(raw)<0||!Number.isInteger(Number(raw))))throw Error("Quantity must be a non-negative whole number.");
   if(/[\[\]\r\n]/.test(raw))throw Error("Please remove brackets or line breaks from material fields.");
   return [key,raw];
  });
  const latest=await S.from(tableFor(t)).select("notes").eq("id",id).single();
  if(latest.error)throw latest.error;
  let notes=latest.data.notes||"";
  for(const [key,value] of values){
   // Empty means unknown; remove the tag rather than converting to zero.
   const re=new RegExp(`\\[TRACKING:${key}=[^\\]]*\\]`,"gi");
   notes=notes.replace(re,"").trim();
   if(value!=="")notes=putNote(notes,key,value);
  }
  let q=S.from(tableFor(t)).update({notes}).eq("id",id);
  q=latest.data.notes==null?q.is("notes",null):q.eq("notes",latest.data.notes);
  const result=await q.select("id");
  if(result.error)throw result.error;
  if(!result.data?.length)throw Error("Trip was updated elsewhere. Please reopen and try again.");
  t.notes=notes;
  $("podMaterialMessage").textContent="Saved to Supabase successfully.";
  alert("POD Material Details saved successfully.");
 }catch(err){console.error("[POD] Material save failed",err);$("podMaterialMessage").textContent="Not saved: "+err.message;alert("POD material save failed: "+err.message)}
 finally{if(button)button.disabled=false}
}

function popupField(label,id,value,type="text",extra=""){
 return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${esc(value??"")}" ${extra}></div>`;
}
function popupSelect(label,id,items,selected){
 return `<div class="field"><label>${label}</label><select id="${id}" class="pod-edit-select ${id==="podEditTruck"?"pod-popup-truck":""}" style="width:100%;padding:10px;border-radius:8px" ${id==="podEditParty"?'onchange="window.EktaPOD.refreshEditDerived()"':""}>${items.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div>`;
}
function openTrip(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return;
 const tr=tripTruck(t),p=tripParty(t),market=!!t._market;
 const ld=loadingDetentionDays(t),ud=unloadingDetentionDays(t);
 const field=(label,id,value,type="text",extra="")=>popupField(label,id,value,type,extra);
 const read=(label,value)=>`<div class="field"><label>${label}</label><input readonly value="${esc(value??"—")}"></div>`;
 $("podTripTitle").textContent=`POD Trip — ${t.trip_number||""}`;
 $("podTripBody").innerHTML=`<div class="grid2 pod-popup-grid">
 <div class="pod-popup-section full">Trip & Party Details</div>
 ${market?read("Trip No.",t.trip_number):field("Trip No.","podEditTripNo",t.trip_number)}
 ${market?read("Truck",tr?.truck_number):popupSelect("Truck","podEditTruck",trucks.map(x=>({id:x.id,name:x.truck_number||"Truck"})).sort((a,b)=>a.name.localeCompare(b.name)),t.truck_id)}
 ${market?read("Party / Client",p?.name):popupSelect("Party / Client","podEditParty",parties.map(x=>({id:x.id,name:x.name||"Party"})).sort((a,b)=>a.name.localeCompare(b.name)),t.party_id)}
 <div class="field"><label>Party Type / Zone</label><input id="podEditPartyTypeZone" readonly value="${esc((p?.party_type||"—")+" / "+(p?.zone||"—"))}"></div>
 ${market?read("Loading Date",fmt(t.loading_date)):field("Loading Date","podEditLoadingDate",dateOnly(t.loading_date),"date")}
 ${market?read("LR Date",fmt(t.lr_date||t.start_date)):field("LR Date","podEditLRDate",dateOnly(t.lr_date||t.start_date),"date")}
 ${market?read("LR Number",displayLRNumber(t)):field("LR Number","podEditLRNumber",displayLRNumber(t))}
 <div class="pod-popup-section full">POD Material Details</div>
 ${podMaterialInput(t,"POD_VEHICLE_TYPE","podMaterialVehicleType","Vehicle Type")}
 ${podMaterialInput(t,"POD_QTY","podMaterialQty","Qty",true)}
 ${podMaterialInput(t,"POD_INVOICE_NO","podMaterialInvoice","Invoice No.")}
 ${podMaterialInput(t,"POD_PACKING_DAMAGE_QTY","podMaterialDamage","Packing Damage Qty",true)}
 ${podMaterialInput(t,"POD_SHORT_QTY","podMaterialShort","Short Qty",true)}
 <div class="pod-popup-empty" aria-hidden="true"></div>
 <div class="pod-popup-section full">Trip Movement & Route</div>
 ${market?read("Reporting Date",fmt(t.reporting_date)):field("Reporting Date","podEditReportingDate",dateOnly(t.reporting_date),"date")}
 ${market?read("Unloading Date",fmt(t.unloading_date||t.end_date)):field("Unloading Date","podEditUnloadingDate",dateOnly(t.unloading_date||t.end_date),"date")}
 ${market?read("From",t.loading_point||t.from_location):field("From","podEditFrom",t.loading_point||t.from_location)}
 ${market?read("To",t.destination||t.to_location):field("To","podEditTo",t.destination||t.to_location)}
 <div class="pod-popup-section full">Charges & Detention</div>
 ${read("Loading Detention Days",ld)}
 ${market?read("Loading Detention ₹",loadingDetentionCharge(t)):field("Loading Detention ₹","podEditLoadDet",loadingDetentionCharge(t),"number",'min="0" step="0.01"')}
 ${read("Unloading Detention Days",ud)}
 ${market?read("Unloading Detention ₹",unloadingDetentionCharge(t)):field("Unloading Detention ₹","podEditUnloadDet",unloadingDetentionCharge(t),"number",'min="0" step="0.01"')}
 ${market?read("Unloading Charge ₹",num(t.unloading_charge)):field("Unloading Charge ₹","podEditUnloadingCharge",num(t.unloading_charge),"number",'min="0" step="0.01"')}
 ${market?read("Other ₹",num(t.other_charge??getNote(t.notes,"OTHER_CHARGE"))):field("Other ₹","podEditOther",num(t.other_charge??getNote(t.notes,"OTHER_CHARGE")),"number",'min="0" step="0.01"')}
 ${market?read("NGT ₹",ngtAmount(t)):field("NGT ₹","podEditNGT",ngtAmount(t),"number",'min="0" step="0.01"')}
 <div class="pod-popup-section full">POD & Courier Details</div>
 ${read("POD Status",podStatus(t))}
 ${market?read("POD Received Date",fmt(podReceivedDate(t))):field("POD Received Date","podEditPODReceivedDate",dateOnly(podReceivedDate(t)),"date")}
 ${market?read("Courier Name",courierName(t)):field("Courier Name","podEditCourierName",courierName(t))}
 ${market?read("AWB / Tracking No.",courierAwb(t)):field("AWB / Tracking No.","podEditCourierAwb",courierAwb(t))}
 ${market?read("Courier Date",fmt(courierDate(t))):field("Courier Date","podEditCourierDate",dateOnly(courierDate(t)),"date")}
 ${market?read("Courier Delivered Date",fmt(courierDeliveredDate(t))):field("Courier Delivered Date","podEditCourierDeliveredDate",dateOnly(courierDeliveredDate(t)),"date")}
 </div><div class="footer" style="align-items:center;flex-wrap:wrap">
 ${podActionsCell(t)}<span id="podMaterialMessage" class="mini">Blank material quantities mean not reported.</span>
 <button class="btn" onclick="window.EktaPOD.closeModal('podTripModal')">Cancel / Close</button>
 ${market?`<button id="podMaterialSave" class="btn green" onclick="window.EktaPOD.savePODMaterial('${esc(t.id)}')">Save Material Details</button>`:`<button id="podPopupSave" class="btn green" onclick="window.EktaPOD.savePopupTrip('${esc(t.id)}')">Save All Details</button>`}
 </div>`;
 $("podTripModal").classList.add("show");
}
async function savePopupTrip(id){
 const btn=$("podPopupSave");if(btn)btn.disabled=true;
 try{await saveInlineEdit(id)}finally{if(btn&&document.contains(btn))btn.disabled=false}
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

window.EktaPOD={init:()=>{},render,refresh,openNGTRate,saveNGTRate,shiftDate,setToday,showAllDates,openPODUpload,savePODDocument,queuePODFiles,removeQueuedPOD,chooseMorePOD,downloadAllPODs,viewAllPODs,viewPOD,downloadPOD,saveDirectField,markEditDirty,handleRowDoubleClick,openTrip,savePODMaterial,savePopupTrip,openInlineEdit,cancelInlineEdit,saveInlineEdit,refreshEditDerived,closeModal,closePOD,scrollPage};

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