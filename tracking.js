/* =============================================================
 EKTA TRANSPORT — LIVE TRACKING JS
 LOCKED STARTING BASELINE

 LOCKED DATABASE RULE
 --------------------
 Supabase schema verified against the live project on 11-Sep-2026.
 Dedicated lifecycle columns now exist in public.trips:
 - program_date
 - loading_date
 - lr_date
 - reporting_date
 - unloading_date

 Core source-of-truth mapping:
 - Truck master: trucks
 - Active driver: truck_driver_assignments -> drivers
 - Party/Party Zone: parties
 - Trip lifecycle: trips
 - Live/current location: truck_locations
 - E-Way validity: eway_bills.valid_until

 PROGRAM remains trip_status='Planned' with loading_date NULL.
 LOADING = Planned + loading_date present.
 RUNNING = In Transit. REPORTING = Delivered. EMPTY = Completed.
============================================================== */
(function(){
"use strict";

const S=window.supabaseClient;
const T={trips:"trips",trucks:"trucks",drivers:"drivers",assignments:"truck_driver_assignments",parties:"parties",locations:"truck_locations",gps:"gps_locations",eway:"eway_bills",driverRequests:"driver_status_requests",programRequests:"driver_program_requests"};
const $=id=>document.getElementById(id);
const ZONES=["NORTH","SOUTH","EAST","WEST"];
let trucks=[],drivers=[],assignments=[],parties=[],trips=[],locations=[],gpsLocations=[],ewayBills=[],driverRequests=[],programRequests=[];
let filterStatus="",trackingInitialized=false,selectedTruck=null,selectedParty=null,selectedTrip=null,selectedMap=null;
let etLoadInProgress=false,etLoadAgain=false;
let currentProgramRequestId=null;
const gpsPlaceCache=new Map();

/* ========================= 1. HELPERS ====================== */
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function clean(v){return String(v??"").trim()}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
function dateOnly(v){return v?String(v).slice(0,10):""}
function fmt(v){if(!v)return "—";const d=new Date(dateOnly(v)+"T00:00:00");return isNaN(d)?"—":d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}
function fmtDT(v){if(!v)return "—";const d=new Date(v);return isNaN(d)?"—":d.toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function dbOK(){return S&&typeof S.from==="function"}
function alertUser(m){window.alert(m)}
function closeModal(id){$(id)?.classList.remove("show");if(id==="etProgramModal")setProgramRequestContext(null)}
function closeAllModals(){document.querySelectorAll("#trackingModule .modal").forEach(x=>x.classList.remove("show"))}
function daysBetween(a,b){if(!a||!b)return 0;const x=new Date(dateOnly(a)+"T00:00:00"),y=new Date(dateOnly(b)+"T00:00:00");return Math.max(0,Math.floor((y-x)/86400000))}
function parseAmount(v){const s=clean(v).toUpperCase();if(!s||s==="NA")return 0;const n=Number(s.replace(/[₹,\s]/g,""));return Number.isFinite(n)?n:0}

function putNote(notes,key,value){
 const re=new RegExp(`\\[TRACKING:${key}=[^\\]]*\\]`,`i`);
 const marker=`[TRACKING:${key}=${value}]`;
 return re.test(clean(notes))?clean(notes).replace(re,marker):(clean(notes)?clean(notes)+" ":"")+marker;
}
function getNote(notes,key){
 const m=clean(notes).match(new RegExp(`\\[TRACKING:${key}=([^\\]]+)\\]`,`i`));
 return m?m[1]:"";
}
function selectedTrackingDate(){return $("etDate")?.value||today()}
function cancelledDate(t){return getNote(t?.notes,"CANCELLED_DATE")||dateOnly(t?.updated_at)||dateOnly(t?.created_at)}
function cancellationReason(t){return getNote(t?.notes,"CANCEL_REASON")||""}
function loadingDetentionDays(t){
 const program=t?.program_date;
 const loaded=t?.loading_date||getNote(t?.notes,"LOADING_DATE");
 return program&&loaded?Math.max(0,daysBetween(program,loaded)-1):0;
}
function unloadingDetentionDays(t){return unloadingGraceDays(t?.reporting_date,t?.unloading_date||t?.end_date)}
// One free calendar day after reporting; detention begins on day two.
function unloadingGraceDays(reporting,unloading){return Math.max(0,daysBetween(reporting,unloading)-1)}
function loadingDetentionCharge(t){
 const days=loadingDetentionDays(t);
 const stored=num(t?.detention_charge||getNote(t?.notes,"LOADING_DETENTION_CHARGE"));
 return stored>0?stored:(days>0?1000:0);
}
function unloadingDetentionCharge(t){
 const days=unloadingDetentionDays(t);
 const stored=num(getNote(t?.notes,"UNLOADING_DETENTION_CHARGE"));
 return stored>0?stored:(days>0?1000:0);
}
function historyCounts(){
 const d=selectedTrackingDate();
 return {
  completed:trips.filter(t=>clean(t.trip_status).toLowerCase()==="completed"&&dateOnly(t.unloading_date||t.end_date)===d).length,
  cancelled:trips.filter(t=>clean(t.trip_status).toLowerCase()==="cancelled"&&cancelledDate(t)===d).length
 };
}
function ewayForTrip(tripId){
 return ewayBills.filter(x=>String(x.trip_id)===String(tripId))
  .sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0))[0]||null;
}

const INDIA_LOCATION_SUGGESTIONS=[
 "Agra","Ahmedabad","Ahmednagar","Ajmer","Akola","Aligarh","Alwar","Ambala","Amravati","Amritsar","Anand","Anantapur","Asansol","Aurangabad","Ayodhya","Bareilly","Bathinda","Belgaum","Bengaluru","Bangalore","Bharatpur","Bharuch","Bhilai","Bhiwadi","Bhiwani","Bhopal","Bhubaneswar","Bikaner","Bilaspur","Bokaro","Bulandshahr","Chandigarh","Chennai","Coimbatore","Cuttack","Dadri","Daman","Darbhanga","Dehradun","Delhi","Dhanbad","Dharuhera","Durgapur","Erode","Faridabad","Firozabad","Gandhinagar","Ghaziabad","Goa","Gorakhpur","Greater Noida","Guntur","Gurgaon","Gurugram","Guwahati","Gwalior","Haridwar","Hisar","Hosur","Hubballi","Hubli","Hyderabad","Indore","Jabalpur","Jaipur","Jalandhar","Jalgaon","Jammu","Jamnagar","Jamshedpur","Jhansi","Jodhpur","Kanpur","Karnal","Kolhapur","Kochi","Kolkata","Kota","Kurukshetra","Lucknow","Ludhiana","Madurai","Manesar","Mangalore","Mathura","Meerut","Mohali","Moradabad","Mumbai","Muzaffarnagar","Mysuru","Mysore","Nagpur","Nashik","Navi Mumbai","Neemrana","New Delhi","Noida","Panipat","Patiala","Patna","Pimpri Chinchwad","Pondicherry","Puducherry","Pune","Puri","Raipur","Rajkot","Ranchi","Rewari","Rohtak","Roorkee","Rudrapur","Saharanpur","Salem","Satara","Shimla","Siliguri","Sonipat","Surat","Thane","Tiruchirappalli","Trichy","Udaipur","Ujjain","Vadodara","Varanasi","Vapi","Vijayawada","Visakhapatnam","Yamunanagar"
];

function locationSuggestions(q){
 const s=clean(q).toLowerCase();
 if(!s)return INDIA_LOCATION_SUGGESTIONS.slice(0,10);
 return INDIA_LOCATION_SUGGESTIONS
  .filter(x=>x.toLowerCase().includes(s))
  .sort((a,b)=>{
    const al=a.toLowerCase(),bl=b.toLowerCase();
    const ap=al.startsWith(s)?0:1,bp=bl.startsWith(s)?0:1;
    return ap-bp||a.localeCompare(b);
  })
  .slice(0,10);
}

function showLocationSuggestions(q){
 const box=$("etLocSuggestions");if(!box)return;
 const list=locationSuggestions(q);
 box.innerHTML=list.map(x=>`<button type="button" onclick="window.EktaTracking.chooseLocationSuggestion('${esc(x)}')">${esc(x)}</button>`).join("");
 box.classList.toggle("show",list.length>0);
}

function chooseLocationSuggestion(v){
 $("etLocInput").value=v;
 $("etLocSuggestions")?.classList.remove("show");
}

function openManualLocation(truckId){
 const tr=truck(truckId);
 const t=activeTrip(truckId);
 if(!tr)return alertUser("Truck not found.");
 if(!t)return alertUser("No active trip found for this truck.");
 $("etLocTripId").value=t.id;
 $("etLocTruckId").value=tr.id;
 $("etLocInput").value=t.current_location||latestLocation(tr.id)?.location||"";
 $("etLocSuggestions").classList.remove("show");
 $("etLocationModal").classList.add("show");
 setTimeout(()=>$("etLocInput")?.focus(),50);
}

async function saveManualLocation(e){
 e.preventDefault();
 const tripId=clean($("etLocTripId").value),truckId=clean($("etLocTruckId").value);
 const value=clean($("etLocInput").value);
 if(!tripId||!truckId)return false;
 if(!value)return alertUser("Enter current location.");

 const t=trips.find(x=>String(x.id)===String(tripId));
 if(!t)return alertUser("Active trip not found.");

 let notes=clean(t.notes)||"";
 notes=putNote(notes,"LOCATION_SOURCE","MANUAL");
 notes=putNote(notes,"MANUAL_LOCATION_UPDATED_AT",new Date().toISOString());

 try{
  const r=await S.from(T.trips).update({current_location:value,notes}).eq("id",tripId);
  if(r.error)throw r.error;

  // Best-effort write to location history table if available.
  try{
   const lr=await S.from(T.locations).insert({
    truck_id:truckId,
    trip_id:tripId,
    latitude:0,
    longitude:0,
    location:value,
    source:"MANUAL",
    remark:"Manual location update from Tracking",
    recorded_at:new Date().toISOString(),
    timestamp:new Date().toISOString()
   });
   if(lr.error)console.warn("[EKTA TRACKING] Manual location history skipped:",lr.error.message);
  }catch(le){
   console.warn("[EKTA TRACKING] Manual location history unavailable:",le.message);
  }

  closeModal("etLocationModal");
  await loadAll();
  alertUser(`Current location updated to ${value}.`);
 }catch(err){
  console.error("[EKTA TRACKING] Manual location update failed:",err);
  alertUser("Location update failed: "+(err.message||"Database error"));
 }
 return false;
}




/* ========================= 2. MASTER LOOKUPS ============== */
function truck(id){return trucks.find(x=>String(x.id)===String(id))||null}
function driver(id){return drivers.find(x=>String(x.id)===String(id))||null}
function party(id){return parties.find(x=>String(x.id)===String(id))||null}
function activeAssignment(truckId){return assignments.filter(a=>String(a.truck_id)===String(truckId)).filter(a=>clean(a.status).toLowerCase()==="active").filter(a=>{const d=driver(a.driver_id);return d&&clean(d.status||"Active").toLowerCase()!=="inactive"}).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]||null}
function activeDriver(truckId){const a=activeAssignment(truckId);return a?driver(a.driver_id):null}
function activeTrip(truckId){return trips.filter(t=>String(t.truck_id)===String(truckId)).filter(t=>!['completed','cancelled'].includes(clean(t.trip_status).toLowerCase())).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]||null}
// Last completed unloading destination per truck; read-only from loaded trip history.
function lastUnloadingPoint(truckId){
 const completed=trips.filter(t=>String(t.truck_id)===String(truckId)&&clean(t.trip_status).toLowerCase()==="completed"&&clean(t.unloading_date||t.end_date));
 completed.sort((a,b)=>String(dateOnly(b.unloading_date||b.end_date)).localeCompare(String(dateOnly(a.unloading_date||a.end_date)))||new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));
 const last=completed[0];
 return last?clean(last.destination||last.to_location)||"—":"—";
}
function latestLocation(truckId){
 const tr=truck(truckId),vehicle=clean(tr?.truck_number).toUpperCase();
 const gps=(gpsLocations||[]).filter(x=>clean(x.vehicle_number).toUpperCase()===vehicle)
  .sort((a,b)=>new Date(b.recorded_at||b.created_at||0)-new Date(a.recorded_at||a.created_at||0))[0]||null;
 if(gps)return {...gps,truck_id:truckId,location:clean(gps.location)||clean(gps.address)||"",timestamp:gps.recorded_at||gps.created_at,source:"GPS"};
 return locations.filter(x=>String(x.truck_id)===String(truckId))
  .sort((a,b)=>new Date(b.timestamp||b.recorded_at||0)-new Date(a.timestamp||a.recorded_at||0))[0]||null;
}
// Zone reflects the last known physical location, never the trip destination.
// Explicit state names take priority over district/city keywords.
const etGpsZoneCache=new Map();
function zoneText(v){
 const s=clean(v).toLowerCase();if(!s)return "";
 const stateZones=[
  ["NORTH",/\b(uttar pradesh|delhi|haryana|punjab|himachal pradesh|uttarakhand|jammu(?: and | & )kashmir|ladakh|chandigarh)\b/],
  ["SOUTH",/\b(maharashtra|goa|karnataka|telangana|andhra pradesh|tamil nadu|kerala|puducherry)\b/],
  ["EAST",/\b(west bengal|bihar|jharkhand|odisha|orissa|sikkim|assam|meghalaya|tripura|manipur|mizoram|nagaland|arunachal pradesh)\b/],
  ["WEST",/\b(rajasthan|gujarat|madhya pradesh|chhattisgarh|dadra and nagar haveli|daman and diu)\b/]
 ];
 for(const [zone,re] of stateZones)if(re.test(s))return zone;
 // Fallback for old records containing only a known city or district.
 if(/\b(noida|greater noida|ghaziabad|meerut|agra|kanpur|lucknow|varanasi|bagpat|bghpat|gurugram|gurgaon|faridabad|panipat|ambala|dehradun)\b/.test(s))return "NORTH";
 if(/\b(pune|mumbai|nagpur|nashik|bengaluru|bangalore|hyderabad|chennai|kochi|vijayawada)\b/.test(s))return "SOUTH";
 if(/\b(kolkata|patna|ranchi|bhubaneswar|jamshedpur|dhanbad)\b/.test(s))return "EAST";
 if(/\b(jaipur|ahmedabad|surat|rajkot|indore|bhopal|vadodara|udaipur)\b/.test(s))return "WEST";
 return "";
}
function truckZone(trip,loc,truckRecord){
 // EMPTY vehicles may have no active trip and no GPS row. Use the fleet truck directly.
 const tr=truckRecord||truck(trip?.truck_id||loc?.truck_id);
 const vehicle=clean(tr?.truck_number).toUpperCase();
 const f=(etFastagRows||[]).find(x=>clean(x.t?.truck_number).toUpperCase()===vehicle);
 const ft=f?.time?new Date(f.time).getTime():NaN;
 const lt=loc?.timestamp||loc?.recorded_at||loc?.created_at;
 const gt=lt?new Date(lt).getTime():NaN;
 const fastagZone=zoneText(f?.geo?.state)||zoneText([f?.geo?.district,f?.geo?.place,f?.geo?.label].join(", "));
 const gpsKey=(loc?.latitude!=null&&loc?.longitude!=null)?coordKey(loc.latitude,loc.longitude):"";
 const gpsZone=(gpsKey&&etGpsZoneCache.get(gpsKey))||zoneText([loc?.state,loc?.district,loc?.location,loc?.address].join(", "));
 // Prefer the most recent known point, but never use a destination as a location.
 if(Number.isFinite(ft)&&(!Number.isFinite(gt)||ft>gt))return fastagZone||gpsZone||"";
 return gpsZone||fastagZone||zoneText(trip?.current_location)||"";
}

function coordKey(lat,lon){return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`}

function preferMainPlace(a,displayName){
 const d=clean(displayName);
 const candidates=[
  a?.city,a?.town,a?.municipality,a?.city_district,a?.suburb,
  a?.state_district,a?.county
 ].map(clean).filter(Boolean);

 // Strong NCR names first when present anywhere in the response.
 const ncr=[
  ["greater noida","Greater Noida"],
  ["noida","Noida"],
  ["ghaziabad","Ghaziabad"],
  ["faridabad","Faridabad"],
  ["gurugram","Gurugram"],
  ["gurgaon","Gurugram"],
  ["new delhi","New Delhi"],
  ["delhi","Delhi"]
 ];
 const hay=(candidates.join(" ")+" "+d).toLowerCase();
 for(const [k,v] of ncr)if(hay.includes(k))return v;

 return candidates[0]||"";
}

async function googleGeocodePoint(lat,lng){
 const key=googleRoadsApiKey();
 if(!key)throw new Error("Roads/Geocoding API key is not configured");
 const la=Number(lat),lo=Number(lng);
 if(!Number.isFinite(la)||!Number.isFinite(lo))throw new Error("Invalid coordinates");
 const url=`https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${la},${lo}`)}&key=${encodeURIComponent(key)}`;
 const res=await fetch(url);
 if(!res.ok)throw new Error(`GEOCODING_HTTP_${res.status}`);
 const data=await res.json();
 if(data?.status==="OK" && Array.isArray(data.results) && data.results.length)return data.results;
 throw new Error(data?.error_message||data?.status||"GEOCODER_FAILED");
}
function googleAddressParts(results){
 const comps=(results||[]).flatMap(x=>x.address_components||[]);
 const pick=(types)=>{
  for(const type of types){
   const c=comps.find(a=>(a.types||[]).includes(type));
   if(c?.long_name)return c.long_name;
  }
  return "";
 };
 return {
  place:pick(["point_of_interest","establishment","locality","postal_town","sublocality_level_1","sublocality","administrative_area_level_3"]) || "",
  district:pick(["administrative_area_level_2"]) || "",
  state:pick(["administrative_area_level_1"]) || "",
  formatted:clean(results?.[0]?.formatted_address||"")
 };
}
async function reverseGeocodeGPS(lat,lon){
 const key=coordKey(lat,lon);
 if(gpsPlaceCache.has(key))return gpsPlaceCache.get(key);
 try{
  const results=await googleGeocodePoint(lat,lon);
  const a=googleAddressParts(results);
  const name=a.place||a.district||a.formatted||"";
  if(name)gpsPlaceCache.set(key,name);
  return name;
 }catch(e){
  console.warn("[EKTA TRACKING] Google reverse geocoding unavailable:",e.message);
  return "";
 }
}

async function hydrateGPSPlaces(){
 const points=(gpsLocations||[]).filter(x=>
  x?.latitude!=null && x?.longitude!=null &&
  Number.isFinite(Number(x.latitude)) && Number.isFinite(Number(x.longitude)) &&
  !(Number(x.latitude)===0 && Number(x.longitude)===0)
 );

 // Resolve newest points first. This preserves Current Location priority,
 // while also hydrating history so Old Location has a readable place.
 points.sort((a,b)=>new Date(b.recorded_at||b.created_at||0)-new Date(a.recorded_at||a.created_at||0));

 let changed=false,next=0;
 const workers=Array.from({length:3},async()=>{
  while(next<points.length){
   const i=next++,x=points[i];
   const key=coordKey(x.latitude,x.longitude);
   let place=gpsPlaceCache.get(key)||"";
   if(!place){
    for(let attempt=0;attempt<3&&!place;attempt++){
     place=await reverseGeocodeGPS(x.latitude,x.longitude);
     if(!place && attempt<2)await new Promise(r=>setTimeout(r,300*(attempt+1)));
    }
   }
   if(place && x.location!==place){x.location=place;changed=true;}
   if(i%5===0)await new Promise(r=>setTimeout(r,80));
  }
 });
 await Promise.all(workers);
 if(changed||etGpsZoneCache.size)render();
}

/* ========================= 3. STATUS ENGINE ================ */
function statusOf(trip){
 if(!trip)return "EMPTY";
 const ts=clean(trip.tracking_status).toUpperCase();
 const rel=clean(trip.trip_status).toLowerCase();
 const noteStage=clean(getNote(trip.notes,"STAGE")).toUpperCase();
 if(rel==="cancelled"||ts==="CANCELLED")return "CANCELLED";
 if(ts==="RUNNING"||rel==="in transit")return "RUNNING";
 if(ts==="REPORTING"||rel==="delivered")return "REPORTING";
 if(rel==="completed"||ts==="EMPTY")return "EMPTY";
 if(rel==="planned"){
   const loadingDate=trip.loading_date||getNote(trip.notes,"LOADING_DATE");
   if(noteStage==="LOADING"||loadingDate)return "LOADING";
   return "PROGRAM";
 }
 if(ts==="PROGRAM")return "PROGRAM";
 if(ts==="LOADING")return noteStage==="PROGRAM"?"PROGRAM":"LOADING";
 return ts||"PROGRAM";
}
function delayed(trip){return !!trip&&statusOf(trip)==="RUNNING"&&trip.expected_arrival_date&&dateOnly(trip.expected_arrival_date)<today()}
function hasAlert(trip){const notes=clean(trip?.notes).replace(/\[TRACKING:BREAKDOWN_EVENTS=[^\]]*\]/gi,"");const s=[notes,trip?.remark,trip?.current_location].join(" ").toLowerCase();return !!activeBreakdown(trip)||/breakdown|accident|emergency/.test(s)}

/* Breakdown is an independent trip alert, not a tracking stage. Stored in existing trips.notes. */
function breakdownEvents(t){
 try{const raw=getNote(t?.notes,"BREAKDOWN_EVENTS");return raw?JSON.parse(decodeURIComponent(raw)):[]}catch(e){return []}
}
function activeBreakdown(t){return breakdownEvents(t).findLast?.(x=>!x.ended_at)||breakdownEvents(t).slice().reverse().find(x=>!x.ended_at)||null}
function breakdownDuration(start){const ms=Math.max(0,Date.now()-new Date(start).getTime());if(!Number.isFinite(ms))return "—";const m=Math.floor(ms/60000);return `${Math.floor(m/1440)}d ${Math.floor(m%1440/60)}h ${m%60}m`}
async function startBreakdown(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return alertUser("Trip not found");
 if(!["RUNNING","REPORTING"].includes(statusOf(t)))return alertUser("Breakdown is only available in Running and Reporting.");
 if(activeBreakdown(t))return alertUser("Breakdown is already active for this trip.");
 if(!window.confirm("Mark this vehicle as broken down? Its trip and status will remain unchanged."))return;
 const reason=(window.prompt("Breakdown reason (optional):","")||"").trim().slice(0,250);
 const events=breakdownEvents(t);events.push({started_at:new Date().toISOString(),reason});
 const notes=putNote(t.notes,"BREAKDOWN_EVENTS",encodeURIComponent(JSON.stringify(events)));
 try{const r=await S.from(T.trips).update({notes}).eq("id",id);if(r.error)throw r.error;await loadAll();alertUser("Breakdown alert started.")}
 catch(e){console.error(e);alertUser("Could not save breakdown: "+e.message)}
}
async function resolveBreakdown(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return alertUser("Trip not found");
 const events=breakdownEvents(t);const event=events.slice().reverse().find(x=>!x.ended_at);if(!event)return alertUser("No active breakdown.");
 if(!window.confirm("Confirm vehicle repaired and stop the breakdown timer?"))return;
 event.ended_at=new Date().toISOString();
 const notes=putNote(t.notes,"BREAKDOWN_EVENTS",encodeURIComponent(JSON.stringify(events)));
 try{const r=await S.from(T.trips).update({notes}).eq("id",id);if(r.error)throw r.error;await loadAll();alertUser("Breakdown resolved. Duration saved in trip notes.")}
 catch(e){console.error(e);alertUser("Could not resolve breakdown: "+e.message)}
}
function updateBreakdownTimers(){document.querySelectorAll("[data-breakdown-start]").forEach(el=>{el.textContent=breakdownDuration(el.getAttribute("data-breakdown-start"))})}
if(typeof window!=="undefined")window.setInterval(updateBreakdownTimers,60000);

/* ========================= 4. DATA LOAD ===================== */
async function loadAll(){
 if(etLoadInProgress){etLoadAgain=true;return;}
 etLoadInProgress=true;
 if(!dbOK()){renderError("Supabase client not available. Make sure db.js loads before Tracking.");return}
 try{
  const core=await Promise.all([
   S.from(T.trucks).select("id,truck_number,vehicle_type,capacity_ton,owner_name,status"),
   S.from(T.drivers).select("*"),
   S.from(T.assignments).select("id,truck_id,driver_id,assigned_from,assigned_until,status,notes,created_at"),
   S.from(T.parties).select("id,party_code,name,party_type,city,zone,status"),
   S.from(T.trips).select("*").order("created_at",{ascending:false})
  ]);
  for(const r of core)if(r.error)throw r.error;
  trucks=core[0].data||[];drivers=core[1].data||[];assignments=core[2].data||[];parties=core[3].data||[];trips=core[4].data||[];
  const opt=await Promise.all([
   optionalTable(T.locations),
   optionalTable(T.gps),
   optionalTable(T.eway),
   loadPendingDriverRequests(),
   loadActiveProgramRequests()
  ]);
  locations=opt[0];gpsLocations=opt[1];ewayBills=opt[2];driverRequests=opt[3];programRequests=opt[4];
  // IMPORTANT: optionalTable(gps_locations) can be capped by the backend and may not
  // contain the newest row for every vehicle. Fetch one true latest GPS row per truck
  // so Current Location/Time always uses the same live point as the map marker.
  await mergeTrueLatestGpsRows();
  populateDrivers();render();hydrateGPSPlaces();
   // FASTag toll-crossing locations for the main Tracking table (non-blocking).
   loadLatestFastagLocations().then(()=>render()).catch(e=>console.warn("[EKTA] FASTag table locations unavailable",e));
 }catch(e){console.error("[EKTA TRACKING] Load error:",e);renderError("Tracking data could not be loaded: "+(e.message||"Database error"))}
 finally{
  etLoadInProgress=false;
  if(etLoadAgain){etLoadAgain=false;loadAll();}
 }
}

async function mergeTrueLatestGpsRows(){
 const jobs=(trucks||[]).map(async tr=>{
  const vehicle=clean(tr?.truck_number).toUpperCase();
  if(!vehicle)return null;
  try{
   const r=await S.from(T.gps)
    .select("vehicle_number,latitude,longitude,recorded_at")
    .eq("vehicle_number",vehicle)
    .order("recorded_at",{ascending:false})
    .limit(1);
   if(r.error)throw r.error;
   return (r.data||[])[0]||null;
  }catch(e){
   console.warn("[EKTA TRACKING] Latest GPS row fetch failed for",vehicle,e.message);
   return null;
  }
 });
 const latest=(await Promise.all(jobs)).filter(Boolean);
 for(const x of latest){
  const v=clean(x.vehicle_number).toUpperCase();
  gpsLocations=(gpsLocations||[]).filter(g=>!(clean(g.vehicle_number).toUpperCase()===v && String(g.recorded_at||g.created_at||"")===String(x.recorded_at||"")));
  gpsLocations.push(x);
 }
}

async function optionalTable(table){try{const r=await S.from(table).select("*");if(r.error)throw r.error;return r.data||[]}catch(e){console.warn("[EKTA TRACKING] Optional table unavailable:",table,e.message);return []}}

async function loadPendingDriverRequests(){
 try{
  const r=await S.from(T.driverRequests)
   .select("*")
   .eq("request_status","PENDING")
   .order("requested_at",{ascending:false});
  if(r.error)throw r.error;
  return r.data||[];
 }catch(e){
  console.warn("[EKTA TRACKING] Driver requests unavailable:",e.message);
  return [];
 }
}


async function loadActiveProgramRequests(){
 try{
  const r=await S.from(T.programRequests)
   .select("*")
   .in("request_status",["PENDING","OPENED"])
   .order("requested_at",{ascending:false});
  if(r.error)throw r.error;
  return r.data||[];
 }catch(e){
  console.warn("[EKTA TRACKING] Program requests unavailable:",e.message);
  return [];
 }
}

function programRequestDriver(req){return driver(req?.driver_id)}
function programRequestTruck(req){return truck(req?.truck_id)}

function programRequestCard(req){
 const tr=programRequestTruck(req),d=programRequestDriver(req);
 const state=clean(req?.request_status).toUpperCase()||"PENDING";
 const when=fmtDT(req?.requested_at||req?.created_at);
 return `<div class="et-alert et-program-request-alert">
  <div class="et-program-request-top">
   <div style="min-width:0">
    <div class="et-program-request-title">🆕 PROGRAM REQUEST <span>${esc(state)}</span></div>
    <div class="et-program-request-main"><b>${esc(tr?.truck_number||"Truck")}</b> • ${esc(d?.name||d?.driver_code||"Driver")}</div>
    <div class="et-program-request-meta">${esc(when)}</div>
   </div>
   <div class="et-program-request-actions">
    <button type="button" class="et-program-open-btn" onclick="window.EktaTracking.openDriverProgramRequest('${esc(req.id)}',this)">OPEN PROGRAM</button>
    <button type="button" class="et-program-reject-btn" onclick="window.EktaTracking.rejectDriverProgramRequest('${esc(req.id)}',this)">REJECT</button>
   </div>
  </div>
 </div>`;
}

function setProgramRequestContext(req){
 currentProgramRequestId=req?.id||null;
 const box=$("etProgramRequestContext");
 if(!box)return;
 if(!req){box.style.display="none";box.innerHTML="";return}
 const tr=programRequestTruck(req),d=programRequestDriver(req);
 box.innerHTML=`Driver Program Request • <b>${esc(d?.name||d?.driver_code||"Driver")}</b> • <b>${esc(tr?.truck_number||"Truck")}</b>`;
 box.style.display="block";
}

async function openDriverProgramRequest(requestId,btn){
 const req=programRequests.find(x=>String(x.id)===String(requestId));
 if(!req)return alertUser("Program Request not found. Refresh Tracking and try again.");
 const tr=programRequestTruck(req);
 if(!tr)return alertUser("Truck not found for this Program Request.");
 if(activeTrip(tr.id))return alertUser("This truck already has an active trip. Program Request cannot be opened.");
 if(!activeDriver(tr.id))return alertUser("NO DRIVER: assign an active driver first.");
 const oldText=btn?.textContent||"OPEN PROGRAM";
 try{
  if(btn){btn.disabled=true;btn.textContent="Opening..."}
  if(clean(req.request_status).toUpperCase()==="PENDING"){
   const r=await S.rpc("open_driver_program_request",{p_request_id:req.id});
   if(r.error)throw r.error;
   if(r.data?.success===false)throw new Error(r.data?.message||"Program Request could not be opened.");
   req.request_status="OPENED";
  }
  openProgramForTruck(tr.id);
  setProgramRequestContext(req);
 }catch(e){
  console.error("[EKTA TRACKING] Program Request open failed:",e);
  alertUser("Program Request open failed: "+(e.message||"Database error"));
 }finally{
  if(btn){btn.disabled=false;btn.textContent=oldText}
 }
}

async function rejectDriverProgramRequest(requestId,btn){
 const req=programRequests.find(x=>String(x.id)===String(requestId));
 if(!req)return alertUser("Program Request not found.");
 const tr=programRequestTruck(req),d=programRequestDriver(req);
 if(!window.confirm(`Reject Program Request?\n${tr?.truck_number||"Truck"} • ${d?.name||"Driver"}`))return;
 const oldText=btn?.textContent||"REJECT";
 try{
  if(btn){btn.disabled=true;btn.textContent="Rejecting..."}
  const r=await S.rpc("reject_driver_program_request",{p_request_id:req.id});
  if(r.error)throw r.error;
  if(r.data?.success===false)throw new Error(r.data?.message||"Program Request could not be rejected.");
  if(String(currentProgramRequestId)===String(req.id))setProgramRequestContext(null);
  await loadAll();
 }catch(e){
  console.error("[EKTA TRACKING] Program Request reject failed:",e);
  if(btn){btn.disabled=false;btn.textContent=oldText}
  alertUser("Program Request reject failed: "+(e.message||"Database error"));
 }
}

async function completeDriverProgramRequest(requestId){
 if(!requestId)return true;
 const r=await S.rpc("complete_driver_program_request",{p_request_id:requestId});
 if(r.error)throw r.error;
 if(r.data?.success===false)throw new Error(r.data?.message||"Program Request could not be completed.");
 return true;
}

function driverRequestTruckNumber(req){
 const tr=trucks.find(x=>String(x.id)===String(req?.truck_id));
 return tr?.truck_number||"Truck";
}
function driverRequestTripNumber(req){
 const t=trips.find(x=>String(x.id)===String(req?.trip_id));
 return t?.trip_number||"";
}
function driverRequestCard(req){
 const truckNo=driverRequestTruckNumber(req);
 const tripNo=driverRequestTripNumber(req);
 const status=clean(req?.requested_status).toUpperCase()||"STATUS";
 const msg=clean(req?.driver_message)||`Driver App requested ${status}`;
 const when=fmtDT(req?.requested_at||req?.created_at);
 return `<div class="et-alert" style="border-color:#ffd2d7;background:#fff6f7">
   <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
    <div style="min-width:0">
     <div style="font-weight:900;color:#173653">🚚 ${esc(truckNo)} <span style="color:#c52132">→ ${esc(status)}</span></div>
     <div style="margin-top:3px;color:#596b82;font-size:11px;line-height:1.35">${esc(msg)}${tripNo?` • ${esc(tripNo)}`:""} • ${esc(when)}</div>
    </div>
    <button type="button"
      style="border:0;border-radius:8px;background:#09995f;color:#fff;padding:8px 10px;font-weight:900;cursor:pointer;white-space:nowrap"
      onclick="window.EktaTracking.approveDriverRequest('${esc(req.id)}',this)">✓ APPROVE</button>
   </div>
  </div>`;
}
async function approveDriverRequest(requestId,btn){
 if(!requestId)return;
 const oldText=btn?.textContent||"✓ APPROVE";
 try{
  if(btn){btn.disabled=true;btn.textContent="Approving...";}
  const r=await S.rpc("approve_driver_status_request",{p_request_id:requestId});
  if(r.error)throw r.error;
  await loadAll();
 }catch(e){
  console.error("[EKTA TRACKING] Driver approval failed:",e);
  if(btn){btn.disabled=false;btn.textContent=oldText;}
  alertUser("Driver request approval failed: "+(e.message||"Database error"));
 }
}

function renderError(m){if($("etRows"))$("etRows").innerHTML=`<tr><td colspan="14" style="padding:25px;color:#c52b3d">⚠ ${esc(m)}</td></tr>`;if($("etCountText"))$("etCountText").textContent="Database / schema issue"}


function driverPhotoUrl(d){
 return clean(d?.photo_url||d?.profile_photo_url||d?.photo||d?.image_url||"");
}
function driverInitials(d){
 const s=clean(d?.name||"Driver").split(/\s+/).filter(Boolean);
 return ((s[0]?.[0]||"D")+(s[1]?.[0]||"")).toUpperCase();
}


const QUICK_PARTY_CITY_ZONE_MAP={
 delhi:"North",newdelhi:"North",noida:"North",greaternoida:"North",ghaziabad:"North",gurgaon:"North",
 gurugram:"North",faridabad:"North",sonipat:"North",panipat:"North",rohtak:"North",chandigarh:"North",
 amritsar:"North",ludhiana:"North",jaipur:"North",ajmer:"North",udaipur:"North",kota:"North",
 lucknow:"North",kanpur:"North",agra:"North",varanasi:"North",prayagraj:"North",dehradun:"North",
 haridwar:"North",shimla:"North",jammu:"North",
 bengaluru:"South",bangalore:"South",chennai:"South",hyderabad:"South",secunderabad:"South",kochi:"South",
 cochin:"South",thiruvananthapuram:"South",trivandrum:"South",coimbatore:"South",madurai:"South",
 mysuru:"South",mysore:"South",vijayawada:"South",visakhapatnam:"South",vizag:"South",mangalore:"South",mangaluru:"South",
 kolkata:"East",calcutta:"East",patna:"East",ranchi:"East",jamshedpur:"East",bhubaneswar:"East",
 cuttack:"East",guwahati:"East",siliguri:"East",durgapur:"East",bokaro:"East",
 mumbai:"West",pune:"West",nashik:"West",nagpur:"West",surat:"West",vadodara:"West",baroda:"West",
 ahmedabad:"West",rajkot:"West",indore:"West",bhopal:"West",aurangabad:"West",goa:"West",panaji:"West"
};
function quickPartyDetectZone(city){
 const key=clean(city).toLowerCase().replace(/[\s,.-]+/g,"");
 return QUICK_PARTY_CITY_ZONE_MAP[key]||"";
}
function quickPartyAutoZone(){
 const z=quickPartyDetectZone($("etQPCity")?.value||"");
 if(z){
  $("etQPZone").value=z;
  if($("etQPZoneHint"))$("etQPZoneHint").textContent=`Auto-detected from city: ${z}. You can change it manually.`;
 }else if($("etQPZoneHint")){
  $("etQPZoneHint").textContent="City not in auto-map. Please select the zone manually.";
 }
}

function openQuickParty(){
 $("etQPCode").value="";
 $("etQPName").value="";
 $("etQPType").value="Billing Client";
 $("etQPContactPerson").value="";
 $("etQPMobile").value="";
 $("etQPEmail").value="";
 $("etQPGst").value="";
 $("etQPPan").value="";
 $("etQPCity").value="";
 $("etQPZone").value="North";
 $("etQPState").value="";
 $("etQPCreditDays").value="0";
 $("etQPCreditLimit").value="0";
 $("etQPPaymentTerms").value="";
 $("etQPStatus").value="Active";
 $("etQPAddress").value="";
 $("etQPNotes").value="";
 if($("etQPZoneHint"))$("etQPZoneHint").textContent="Zone can be auto-detected from city.";
 $("etQuickPartyModal").classList.add("show");
 setTimeout(()=>$("etQPName")?.focus(),50);
}

async function saveQuickParty(e){
 e.preventDefault();

 const partyCode=clean($("etQPCode").value).toUpperCase();
 const name=clean($("etQPName").value);
 const city=clean($("etQPCity").value);
 const zone=clean($("etQPZone").value);
 const partyType=clean($("etQPType").value)||"Billing Client";

 if(!partyCode)return alertUser("Party Code is required.");
 if(parties.some(p=>clean(p.party_code).toUpperCase()===partyCode))return alertUser(`Party Code ${partyCode} already exists.`);
 if(!name)return alertUser("Party Name is required.");
 if(!city)return alertUser("City is required.");
 if(!zone)return alertUser("Zone is required.");
 if(!["Billing Client","Transporter"].includes(partyType))return alertUser("Please select a valid Party Type.");

 const payload={
  party_code:partyCode,
  name,
  party_type:partyType,
  gst_number:clean($("etQPGst").value).toUpperCase()||null,
  mobile:clean($("etQPMobile").value)||null,
  address:clean($("etQPAddress").value)||null,
  city,
  state:clean($("etQPState").value)||null,
  credit_days:Number($("etQPCreditDays").value||0),
  credit_limit:Number($("etQPCreditLimit").value||0),
  status:clean($("etQPStatus").value)||"Active",
  contact_person:clean($("etQPContactPerson").value)||null,
  email:clean($("etQPEmail").value)||null,
  pan_number:clean($("etQPPan").value).toUpperCase()||null,
  zone,
  payment_terms:clean($("etQPPaymentTerms").value)||null,
  notes:clean($("etQPNotes").value)||null,
  updated_at:new Date().toISOString()
 };

 try{
  const r=await S.from(T.parties).insert(payload).select().single();
  if(r.error)throw r.error;

  closeModal("etQuickPartyModal");
  await loadAll();

  const fresh=parties.find(x=>String(x.id)===String(r.data?.id))
      ||parties.find(x=>clean(x.party_code).toUpperCase()===partyCode);

  if(fresh){
   selectedParty=fresh;
   $("etPParty").value=`${fresh.party_code||""}${fresh.party_code?" — ":""}${fresh.name||""}`;
   $("etPPartyType").value=fresh.party_type||"";
   $("etPartySuggestions")?.classList.remove("show");
  }

  alertUser(`Party ${name} saved in Parties Master and selected in New Program.`);
 }catch(err){
  console.error("[EKTA TRACKING] Quick Party save failed:",err);
  alertUser("Party save failed: "+(err.message||"Database error"));
 }
 return false;
}

function scrollActivePage(direction){
 const step=Math.max(320,Math.round(window.innerHeight*0.72))*Number(direction||1);
 const fullpages=[...document.querySelectorAll(".fullpage.show")];
 const activeFull=fullpages[fullpages.length-1];
 if(activeFull){
  activeFull.scrollBy({top:step,behavior:"smooth"});
  return;
 }
 const modals=[...document.querySelectorAll(".modal.show .box")];
 const activeModal=modals[modals.length-1];
 if(activeModal && activeModal.scrollHeight>activeModal.clientHeight+5){
  activeModal.scrollBy({top:step,behavior:"smooth"});
  return;
 }
 const worksheet=$("etRows")?.closest(".tablewrap");
 if(worksheet){worksheet.scrollBy({top:step,behavior:"smooth"});return;}
 window.scrollBy({top:step,behavior:"smooth"});
}


/* ========================= 5. ROW MODEL ===================== */
function rowsModel(){return trucks.map(t=>{const trip=activeTrip(t.id),d=activeDriver(t.id),loc=latestLocation(t.id),p=trip?party(trip.party_id):null,actualStage=statusOf(trip),displayStatus=!d&&actualStage==="EMPTY"?"NO_DRIVER":actualStage;return{t,trip,d,loc,p,actualStage,status:displayStatus,truckZone:truckZone(trip,loc,t),partyZone:p?.zone||"",delay:delayed(trip),alert:hasAlert(trip)}})}

function stageAtDate(t,date){
 const p=dateOnly(t.program_date||t.created_at),ld=dateOnly(t.loading_date||getNote(t.notes,'LOADING_DATE'));
 const lr=dateOnly(t.lr_date||t.start_date),rp=dateOnly(t.reporting_date),un=dateOnly(t.unloading_date||t.end_date);
 if(!p||p>date)return null;
 if(clean(t.trip_status).toLowerCase()==='cancelled'&&cancelledDate(t)<=date)return null;
 if(un&&un<=date)return 'EMPTY';
 if(rp&&rp<=date)return 'REPORTING';
 if(lr&&lr<=date)return 'RUNNING';
 if(ld&&ld<=date)return 'LOADING';
 return 'PROGRAM';
}
function historicalRowsModel(date){
 return trucks.map(t=>{
  const candidate=trips.filter(x=>String(x.truck_id)===String(t.id)).filter(x=>stageAtDate(x,date))
   .sort((a,b)=>String(b.program_date||b.created_at||'').localeCompare(String(a.program_date||a.created_at||'')))[0]||null;
  const d=activeDriver(t.id),loc=latestLocation(t.id),p=candidate?party(candidate.party_id):null;
  const actualStage=candidate?stageAtDate(candidate,date):'EMPTY';
  return {t,trip:candidate,d,loc,p,actualStage,status:actualStage,truckZone:truckZone(candidate,loc,t),partyZone:p?.zone||'',delay:false,alert:false};
 });
}
function displayedRowsModel(){const d=selectedTrackingDate();return d===today()?rowsModel():historicalRowsModel(d)}

function matchesFilter(r){const q=clean($("etSearch")?.value).toLowerCase(),z=$("etZoneFilter")?.value||"",di=$("etDriverFilter")?.value||"",date=$("etDate")?.value||"";if(q){const s=[r.t.truck_number,r.trip?.trip_number,r.d?.name,r.p?.name,r.p?.party_code,r.loc?.location,r.trip?.current_location,r.trip?.from_location,r.trip?.to_location,r.trip?.destination].join(" ").toLowerCase();if(!s.includes(q))return false}if(z&&r.truckZone!==z)return false;if(di&&String(r.d?.id)!==String(di))return false;/* Active operational trips must carry forward into Today/current tracking even when their program/start date is earlier. Historical/non-active rows still obey the selected date. */if(date&&r.trip){const isToday=date===today();const isActiveOperational=["PROGRAM","LOADING","RUNNING","REPORTING"].includes(r.actualStage);const matchesSelectedDate=dateOnly(r.trip.program_date)===date||dateOnly(r.trip.start_date)===date||dateOnly(r.trip.end_date)===date||dateOnly(r.trip.loading_date)===date||dateOnly(r.trip.reporting_date)===date;if(!(isToday&&isActiveOperational)&&date===today()&&!matchesSelectedDate)return false}if(!filterStatus)return true;if(filterStatus==="NO_DRIVER")return !r.d;if(filterStatus==="DELAY")return r.delay;if(filterStatus==="ALERT")return !!activeBreakdown(r.trip);return r.status===filterStatus}

/* Trip billing confirmation is stored in existing trips.notes TRACKING markers.
   No schema change and no changes to the Program/Loading/Map flows. */
let billingTripId=null;
function isHaierBillingParty(p){return !!p && /\bhaier\b/i.test(clean(p.name))}
function isBillingClient(p){return clean(p?.party_type).toLowerCase()==="billing client"}
function billingTypeOptions(p){return isHaierBillingParty(p)?'<option value="">Pending — Select later</option><option value="HAIER_TO_HAIER">Haier to Haier</option><option value="HAIER_TO_OTHER">Haier to Other / Billing</option>':isBillingClient(p)?'<option value="DIRECT_BILLING">Direct Billing — Program Party</option><option value="OTHER_BILLING">Billing to Other Party</option>':'<option value="">Not applicable — Transporter</option>'}
function billingTypeLabel(v){return ({HAIER_TO_HAIER:"Haier to Haier",HAIER_TO_OTHER:"Haier to Other / Billing",DIRECT_BILLING:"Direct Billing",OTHER_BILLING:"Billing to Other Party"})[v]||"Pending"}
// Rate List belongs to Billing Clients. Transporter freight is manually entered.
function rateLocation(v){return clean(v).toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/^(?:NEW)/,"")}
function rateVehicle(v){
 // Rate masters use 34', 34 MXL, 34' HQ, 34FTSXL-N, 32HQ etc.
 // Match a leading 32/34 only, never 30HQ, 36FT or 8.5 TON HQ.
 const s=clean(v).toUpperCase();
 const m=s.match(/^\s*(32|34)(?=$|[^0-9])/);
 return m?m[1]:"";
}
let programRates=[],programRatePartyId="",programRateRequest=0,programEditTripId=null;
const normalizeRateLocation=v=>rateLocation(v).replace(/^VIJAYWADA$/,"VIJAYAWADA").replace(/^BENGALURU$/,"BANGALORE");
async function loadProgramPartyRates(){
 const p=selectedParty,req=++programRateRequest;programRates=[];programRatePartyId="";
 if(!p||!isBillingClient(p)){updateProgramPartyFields();return}
 // Load every page: Supabase defaults to 1,000 rows per request.
 let all=[];
 for(let offset=0;offset<10000;offset+=1000){
  const {data,error}=await S.from("party_rate_list").select("*").eq("party_id",p.id).range(offset,offset+999);
  if(req!==programRateRequest)return;
  if(error){console.warn("[EKTA] Party rate list unavailable",error);break}
  all.push(...(data||[]));if(!data||data.length<1000)break;
 }
 if(req!==programRateRequest)return;
 programRates=all.filter(r=>!r.status||clean(r.status).toLowerCase()==="active");programRatePartyId=String(p.id);
 updateProgramPartyFields();suggestProgramFreight();
}
function programCategories(){return [...new Set(programRates.map(r=>clean(r.vehicle_category)).filter(Boolean))].sort()}
function fleetProgramCategory(){
 const v=clean(selectedTruck?.vehicle_type);
 const m=v.toUpperCase().match(/(?:^|[^0-9])(32|34)\s*(?:FT|FEET|FOOT)?(?:[^0-9]|$)/);
 return m?m[1]:"";
}
function syncFleetProgramCategory(){
 const cs=$("etProgramCategory"),hint=$("etProgramVehicleHint");
 if(!cs)return;
 const feet=fleetProgramCategory(),cats=programCategories();
 const matching=feet?cats.filter(c=>rateVehicle(c)===feet):cats;
 // Preserve an explicitly selected category only while it belongs to the truck's size.
 const old=cs.value;
 cs.innerHTML='<option value="">Select later / Auto match</option>'+matching.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
 cs.value=matching.includes(old)?old:(feet&&matching.length===1?matching[0]:"");
 if(hint)hint.textContent=!selectedTruck?"Select a truck to auto-detect 32FT / 34FT.":!feet?"Vehicle size unavailable — select category manually.":`Fleet Master: ${feet}FT${matching.length>1?" • Choose one of the matching rate categories":matching.length===0?" • Rate category not listed yet":" • Category auto-selected"}`;
}
function updateProgramPartyFields(){
 const p=selectedParty,isTransport=p&&!isBillingClient(p),isHaier=isHaierBillingParty(p),cats=programCategories();
 const cw=$("etProgramCategoryWrap"),hw=$("etProgramHaierWrap"),ww=$("etProgramWeightWrap"),cs=$("etProgramCategory");
 if(cw)cw.style.display=!isTransport?"":"none";
 if(hw)hw.style.display=isHaier?"":"none";
 if(ww)ww.style.display=isTransport?"":"none";
 if(cs){const old=cs.value;cs.innerHTML='<option value="">Select later / Auto match</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");cs.value=cats.includes(old)?old:"";syncFleetProgramCategory()}
}
function rateCandidates(p,tr,from,to,date){
 if(!p||!isBillingClient(p)||String(p.id)!==programRatePartyId||!from||!to)return [];
 const cat=clean($("etProgramCategory")?.value),truckCat=rateVehicle(tr?.vehicle_type)||fleetProgramCategory();
 return programRates.filter(r=>normalizeRateLocation(r.from_location)===normalizeRateLocation(from)&&normalizeRateLocation(r.destination)===normalizeRateLocation(to)&&Number(r.rate)>0&&(!r.effective_from||dateOnly(r.effective_from)<=today())&&(!r.effective_to||dateOnly(r.effective_to)>=today())&&(!cat||clean(r.vehicle_category)===cat)&&(!truckCat||rateVehicle(r.vehicle_category)===truckCat)&&(!cat&&truckCat?(!rateVehicle(r.vehicle_category)||rateVehicle(r.vehicle_category)===truckCat):true));
}
async function findProgramRate(p,tr,from,to,date){
 if(String(p?.id)!==programRatePartyId)await loadProgramPartyRates();
 const matches=rateCandidates(p,tr,from,to,date);
 if(!matches.length)return null;
 matches.sort((a,b)=>dateOnly(b.effective_from).localeCompare(dateOnly(a.effective_from)));
 const latest=matches.filter(x=>dateOnly(x.effective_from)===dateOnly(matches[0].effective_from));
 // Never guess among different prices or different rate types.
 return new Set(latest.map(x=>Number(x.rate))).size===1?latest[0]:null;
}
let rateSuggestionRequest=0;
async function suggestProgramFreight(){
 const input=$("etPRevenue"),info=$("etProgramRateHint");if(!input||!info)return;
 const req=++rateSuggestionRequest,p=selectedParty,tr=selectedTruck;
 const from=clean($("etPLoad")?.value),to=clean($("etPTo")?.value),date=$("etPDate")?.value||today();
 if(!p){info.textContent="Select Party for Rate List lookup.";return}
 if(!isBillingClient(p)){info.textContent="Transporter: enter Weight (Ton) and Total Freight manually.";return}
 if(!from||!to){info.textContent="Select From and Destination from the Party Rate List.";return}
 const rate=await findProgramRate(p,tr,from,to,date);if(req!==rateSuggestionRequest)return;
 if(rate){if(!input.value||input.dataset.autoRate==="yes"){input.value=rate.rate;input.dataset.autoRate="yes"}
  info.textContent=`✓ Rate List matched: ${rate.vehicle_category||"Standard"} • ₹${Number(rate.rate).toLocaleString("en-IN")} (provisional)`;
 }else{if(input.dataset.autoRate==="yes"){input.value="";input.dataset.autoRate="no"}info.textContent="Rate pending — enter freight manually if known."}
}
function setupProgramLocationAutocomplete(){
 ["etPLoad","etPTo"].forEach(id=>{
  const input=$(id);if(!input||input.dataset.ektaAutocomplete)return;
  input.dataset.ektaAutocomplete="1";
  input.style.textTransform="uppercase";
  input.setAttribute("spellcheck","false");
  const host=input.parentElement;
  host.style.position="relative";
  const menu=document.createElement("div");
  menu.className="ekta-rate-location-menu";
  menu.style.cssText="position:absolute;top:calc(100% + 3px);left:0;right:0;background:#fff;z-index:1100;box-shadow:0 8px 22px #17365330;max-height:180px;overflow-y:auto;border:1px solid #d7e2ef;border-radius:8px;display:none";
  host.appendChild(menu);
  let options=[],index=0;
  const hide=()=>{menu.style.display="none";options=[]};
  const choose=()=>{if(!options.length)return;input.value=options[index].toUpperCase();hide();suggestProgramFreight()};
  const draw=()=>{
   const q=clean(input.value).toUpperCase();
   const values=programRates.flatMap(r=>id==="etPLoad"?[r.from_location]:[r.destination]);
   options=[...new Map(values.filter(Boolean).map(v=>[normalizeRateLocation(v),clean(v).toUpperCase()])).values()]
    .filter(v=>q&&normalizeRateLocation(v).startsWith(normalizeRateLocation(q))).slice(0,8);
   index=0;
   menu.innerHTML=options.map((v,i)=>`<div data-index="${i}" style="padding:9px 12px;cursor:pointer;${i===0?'background:#eaf3ff':''}">${esc(v)}</div>`).join("");
   menu.style.display=options.length?"block":"none";
   menu.querySelectorAll("[data-index]").forEach(el=>el.addEventListener("mousedown",e=>{e.preventDefault();index=Number(el.dataset.index);choose()}));
  };
  input.addEventListener("input",()=>{const start=input.selectionStart,end=input.selectionEnd;input.value=input.value.toUpperCase();try{input.setSelectionRange(start,end)}catch(_){}draw();suggestProgramFreight()});
  input.addEventListener("focus",draw);
  input.addEventListener("keydown",e=>{
   if(!options.length)return;
   if(e.key==="Tab"||e.key==="Enter"){
    e.preventDefault();choose();
    if(e.key==="Tab")$(id==="etPLoad"?"etPTo":"etPRevenue")?.focus();
   }else if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    e.preventDefault();index=(index+(e.key==="ArrowDown"?1:-1)+options.length)%options.length;
    menu.querySelectorAll("[data-index]").forEach((el,i)=>el.style.background=i===index?"#eaf3ff":"white");
   }else if(e.key==="Escape")hide();
  });
  input.addEventListener("blur",()=>setTimeout(hide,120));
 });
}

function billingStatusCell(t){
 if(!t)return "—";
 const p=party(t.party_id),amount=num(t.freight_amount??t.revenue);
 const entered=getNote(t.notes,"FREIGHT_ENTERED_AT_PROGRAM");
 const hasFreight=getNote(t.notes,"FREIGHT_FINAL_ENTERED")==="YES"||entered==="YES"||(entered===""&&amount>0);
 const confirmed=getNote(t.notes,"BILLING_CONFIRMATION")==="CONFIRMED";
 const hasLR=!!(t.lr_date||getNote(t.notes,"LR_DATE")||t.start_date);
 const arrangement=getNote(t.notes,"HAIER_BILLING_ARRANGEMENT");
 const haierMissing=isHaierBillingParty(p)&&(!arrangement||arrangement==="PENDING");
 const billingPending=isBillingClient(p)&&(haierMissing||!hasFreight||(isHaierBillingParty(p)&&!confirmed));
 const freightText=hasFreight?`₹${amount.toLocaleString("en-IN")}${confirmed?"":" • Provisional"}`:"Freight Pending";
 const billingText=billingPending?"Billing Pending":(isBillingClient(p)?(confirmed?"✓ Billing Confirmed":"Direct Billing • Provisional"):"Transporter");
 const missing=[!hasLR?"LR Pending":"",billingPending?billingText:"",!hasFreight?"Freight Pending":""].filter(Boolean);
 return `<div class="et-billing-cell"><div>${esc(freightText)}</div><div class="${billingPending?'et-soft-pending':'et-billing-done'}">${esc(billingText)}</div>${!hasLR?'<div class="et-billing-wait">LR Pending</div>':''}<button type="button" class="et-billing-edit" onclick="event.stopPropagation();window.EktaTracking.openPendingProgram('${esc(t.id)}')">${missing.length?'✎ Edit Pending':'✎ Edit Program'}</button></div>`;
}

function openTripBilling(tripId){return openPendingProgram(tripId);}
function openLegacyTripBilling(tripId){
 const t=trips.find(x=>String(x.id)===String(tripId));
 if(!t||["completed","cancelled"].includes(clean(t.trip_status).toLowerCase()))return alertUser("Active trip not found.");
 billingTripId=t.id;
 const tr=truck(t.truck_id),p=party(t.party_id);
 $("etBillingContext").textContent=`${tr?.truck_number||"Truck"} • ${t.trip_number||""} • Program Party: ${p?.name||"—"} • From: ${t.from_location||t.loading_point||"—"}`;
 const typeSelect=$("etBillingType");typeSelect.innerHTML=billingTypeOptions(p);
 const storedType=getNote(t.notes,"BILLING_TYPE")||"";
 typeSelect.value=Array.from(typeSelect.options).some(o=>o.value===storedType)?storedType:(isBillingClient(p)&&!isHaierBillingParty(p)?"DIRECT_BILLING":"");
 const sel=$("etBillingParty");
 sel.innerHTML='<option value="">Pending / Not selected</option>'+parties.filter(isBillingClient).map(p=>`<option value="${esc(p.id)}">${esc(p.party_code||"")} ${esc(p.name||"")} ${esc(p.city||"")}</option>`).join("");
 sel.value=getNote(t.notes,"BILLING_PARTY_ID")||"";
 if(!sel.value&&(typeSelect.value==="DIRECT_BILLING"||typeSelect.value==="HAIER_TO_HAIER")&&isBillingClient(p))sel.value=p.id;
 const entered=getNote(t.notes,"FREIGHT_FINAL_ENTERED")==="YES"||getNote(t.notes,"FREIGHT_ENTERED_AT_PROGRAM")==="YES"||(num(t.freight_amount??t.revenue)>0&&getNote(t.notes,"FREIGHT_ENTERED_AT_PROGRAM")!=="NO");
 $("etBillingFreight").value=entered?String(t.freight_amount??t.revenue??""):"";
 $("etBillingConfirm").value=getNote(t.notes,"BILLING_CONFIRMATION")==="CONFIRMED"?"CONFIRMED":"PENDING";
 $("etBillingModal").classList.add("show");
 const hint=$("etBillingRateHint");if(hint)hint.textContent="";
 if(isBillingClient(p)&&!isHaierBillingParty(p)&&!entered){
  findProgramRate(p,tr,t.from_location||t.loading_point,t.to_location||t.destination,dateOnly(t.program_date)||today()).then(rate=>{
   if(String(billingTripId)!==String(t.id))return;
   if(rate){if(!$("etBillingFreight").value)$("etBillingFreight").value=rate.rate;
    if(hint)hint.textContent=`✓ Rate List: ₹${Number(rate.rate).toLocaleString("en-IN")} (${rate.vehicle_category}) • Provisional until LR`;
   }else if(hint)hint.textContent="No exact rate found in Party Rate List; manually enter the agreed amount.";
  });
 }
}
function suggestBillingParty(){
 const t=trips.find(x=>String(x.id)===String(billingTripId));if(!t)return;
 const typ=$("etBillingType").value,p=party(t.party_id),sel=$("etBillingParty");
 if(typ==="DIRECT_BILLING"){sel.value=isBillingClient(p)?String(p.id):"";return}
 if(typ!=="HAIER_TO_HAIER")return;
 const from=clean(t.loading_point||t.from_location).toLowerCase();
 const candidates=parties.filter(x=>isBillingClient(x)&&isHaierBillingParty(x));
 const match=candidates.filter(x=>clean(x.city).toLowerCase()===from);
 if(match.length===1)sel.value=String(match[0].id);
 else if(isHaierBillingParty(p)&&isBillingClient(p))sel.value=String(p.id);
}
async function saveTripBilling(e){
 e.preventDefault();
 const t=trips.find(x=>String(x.id)===String(billingTripId));if(!t)return false;
 const type=$("etBillingType").value,partyId=$("etBillingParty").value;
 const raw=clean($("etBillingFreight").value),confirm=$("etBillingConfirm").value==="CONFIRMED";
 const hasLR=!!(t.lr_date||getNote(t.notes,"LR_DATE")||t.start_date);
 const programParty=party(t.party_id);
 if(type&&!Array.from($("etBillingType").options).some(o=>o.value===type))return alertUser("Invalid Billing Type for this Program Party.");
 if((type==="HAIER_TO_HAIER"||type==="HAIER_TO_OTHER")&&!isHaierBillingParty(programParty))return alertUser("Haier Billing Type is only for Haier Programs.");
 if(partyId&&!isBillingClient(party(partyId)))return alertUser("Choose a Billing Client, not a Transporter.");
 if(raw!==""&&(!Number.isFinite(Number(raw))||Number(raw)<0))return alertUser("Enter a valid freight amount.");
 if(confirm&&isBillingClient(programParty)&&(!hasLR||!type||!partyId||raw===""))return alertUser("Final confirmation requires LR, Billing Type, Billing Party and Freight. Save as Pending for now.");
 let notes=clean(t.notes);
 notes=putNote(notes,"BILLING_TYPE",isBillingClient(programParty)?(type||"PENDING"):"NOT_APPLICABLE");
 notes=putNote(notes,"BILLING_PARTY_ID",isBillingClient(programParty)?(partyId||"PENDING"):"NOT_APPLICABLE");
 notes=putNote(notes,"BILLING_CONFIRMATION",confirm?"CONFIRMED":"PENDING");
 notes=putNote(notes,"FREIGHT_FINAL_ENTERED",raw===""?"NO":"YES");
 const payload={notes};
 if(raw!==""){payload.freight_amount=Number(raw);payload.revenue=Number(raw)}
 try{
  const r=await S.from(T.trips).update(payload).eq("id",t.id);if(r.error)throw r.error;
  closeModal("etBillingModal");await loadAll();
 }catch(err){console.error(err);alertUser("Billing save failed: "+(err.message||"Database error"))}
 return false;
}

/* ================= STATUS NOTIFICATIONS ================= */
const ET_STATUS_QUESTIONS=Object.freeze({
 EMPTY:"क्या आपकी गाड़ी को कोई नया प्रोग्राम दिया गया है?",
 PROGRAM:"क्या आपकी गाड़ी लोडिंग पॉइंट से निकल चुकी है?",
 RUNNING:"क्या आपकी गाड़ी रिपोर्टिंग पॉइंट पहुँच चुकी है?",
 REPORTING:"क्या आपकी गाड़ी खाली हो चुकी है?"
});
let etNotifySending=false;
function refreshStatusNotifyButton(){
 const b=$("etStatusNotifyBtn");if(!b)return;
 const enabled=Object.prototype.hasOwnProperty.call(ET_STATUS_QUESTIONS,filterStatus);
 b.style.display=enabled?"inline-flex":"none";
 b.disabled=etNotifySending;
 b.textContent=etNotifySending?"Sending…":"🔔 Send Notification";
 b.title=enabled?ET_STATUS_QUESTIONS[filterStatus]:"";
}
async function sendStatusNotification(){
 const status=filterStatus,question=ET_STATUS_QUESTIONS[status];
 if(!question)return alertUser("Please select EMPTY, PROGRAM, RUNNING or REPORTING first.");
 if(etNotifySending)return;
 // Use the actual operational status, not just text/search matches or historical display.
 if(selectedTrackingDate()!==today())return alertUser("Notifications can only be sent for today's live status.");
 const eligible=rowsModel().filter(r=>r.status===status && r.d?.id && r.t?.id);
 const unique=new Map();
 for(const r of eligible)unique.set(String(r.d.id),r);
 const recipients=[...unique.values()];
 if(!recipients.length)return alertUser("No active assigned drivers found for "+status+" trucks.");
 const missing=rowsModel().filter(r=>r.status===status&&!r.d?.id).length;
 if(!window.confirm(`${status}: ${recipients.length} driver(s) को यह सवाल भेजें?\n\n${question}${missing?`\n\n${missing} truck(s) without assigned driver will be skipped.`:""}`))return;
 etNotifySending=true;refreshStatusNotifyButton();
 try{
  const sentAt=new Date().toISOString();
  const n=await S.from("notifications").insert({notification_type:"TRIP_STATUS_CHECK",status_context:status,title:"Ekta Transport — Status Confirmation",message:question,created_at:sentAt}).select("id").single();
  if(n.error)throw n.error;
  const payload=recipients.map(r=>({notification_id:n.data.id,driver_id:r.d.id,truck_id:r.t.id,trip_id:r.trip?.id||null,delivery_status:"PENDING",created_at:sentAt}));
  const ins=await S.from("notification_recipients").insert(payload);
  if(ins.error)throw new Error("Notification created but recipients could not be saved: "+ins.error.message+". Notification ID: "+n.data.id);
  alertUser(`${recipients.length} driver(s) के लिए Notification Supabase में Save हो गया। Driver App में बाद में दिखाई देगा।`);
 }catch(e){console.error("[EKTA TRACKING] Notification save failed",e);alertUser("Notification save failed: "+(e.message||"Database error")+". Please verify before retrying.");}
 finally{etNotifySending=false;refreshStatusNotifyButton();}
}

/* ========================= 6. MAIN TABLE ==================== */
function render(){
 requestAnimationFrame(resizeTrackingWorksheet);
 const alertView=filterStatus==="ALERT";
 const emptyView=filterStatus==="EMPTY";
 $("etTrackingHead")?.closest("table")?.classList.toggle("et-empty-view",emptyView);
 const head=$("etTrackingHead");
 if(head){
  const standard=`<tr><th>Zone</th><th>Truck</th><th>Trip</th><th>Party</th><th>Party Status</th><th>From</th><th>To</th><th>Status</th><th>Current Location</th><th>GPS</th><th>Last Update</th></tr>`;
  const emptyHeader=standard.replace("<th>Zone</th>","<th>Zone</th><th>Last Unloading Point</th>");
  const breakdown=`<tr><th>Zone</th><th>Truck Number</th><th>Trip</th><th>Party</th><th>Route</th><th>Status</th><th>Breakdown Started</th><th>Live Duration</th><th>Reason</th><th>Action</th></tr>`;
  const wanted=alertView?breakdown:(emptyView?emptyHeader:standard);
  if(head.innerHTML!==wanted)head.innerHTML=wanted;
 }
 const data=displayedRowsModel().filter(matchesFilter).sort((a,b)=>(ZONES.indexOf(a.truckZone)<0?99:ZONES.indexOf(a.truckZone))-(ZONES.indexOf(b.truckZone)<0?99:ZONES.indexOf(b.truckZone))||String(a.t.truck_number||"").localeCompare(String(b.t.truck_number||"")));
 if($("etListTitle"))$("etListTitle").textContent=filterStatus?`Tracking — ${filterStatus}`:"Tracking — All Trucks";
 refreshStatusNotifyButton();
 if($("etCountText"))$("etCountText").textContent=`${data.length} truck(s) shown`;
 if($("etStatusFilter"))$("etStatusFilter").value=filterStatus;
 const body=$("etRows");if(!body)return;
 const worksheet=body.closest(".tablewrap");
 const previousTop=worksheet?.scrollTop||0,previousLeft=worksheet?.scrollLeft||0;
 const restoreWorksheet=()=>{if(worksheet){worksheet.scrollTop=previousTop;worksheet.scrollLeft=previousLeft;}};
 if(alertView){
  body.innerHTML=data.length?data.map(r=>{
   const event=activeBreakdown(r.trip);
   return `<tr><td><span class="zone">${esc(r.truckZone||"—")}</span></td><td><span class="et-truck">${esc(r.t.truck_number||"—")}</span></td><td>${esc(r.trip?.trip_number||"—")}</td><td>${esc(r.p?.name||"—")}</td><td>${esc(r.trip?.from_location||"—")} → ${esc(r.trip?.to_location||r.trip?.destination||"—")}</td><td>${badge(r.status,false,true)}</td><td>${esc(fmtDT(event.started_at))}</td><td><strong data-breakdown-start="${esc(event.started_at)}">${esc(breakdownDuration(event.started_at))}</strong></td><td>${esc(event.reason||"—")}</td><td><button type="button" class="et-billing-edit" onclick="event.stopPropagation();window.EktaTracking.resolveBreakdown('${esc(r.trip.id)}')">✓ Mark Repaired</button></td></tr>`;
  }).join(""):'<tr><td colspan="10" class="empty">No active vehicle breakdowns.</td></tr>';
  cards();alerts();updateBreakdownTimers();restoreWorksheet();return;
 }
 body.innerHTML=data.length?data.map((r,i)=>{
   const fastag=(etFastagRows||[]).find(x=>String(x.t?.id)===String(r.t.id));
  const gpsTime=r.loc?.timestamp||r.loc?.recorded_at||r.loc?.created_at||"";
  const gpsHasCoords=r.loc?.latitude!=null&&r.loc?.longitude!=null&&Number(r.loc.latitude)!==0;
  // Prefer the newest real observation; FASTag represents a toll crossing, not continuous GPS.
  const useFastag=!!fastag?.time&&(!gpsHasCoords||new Date(fastag.time).getTime()>new Date(gpsTime||0).getTime());
  const fastagPlace=clean(fastag?.geo?.label)&&fastag.geo.label!=="Location unavailable"?fastag.geo.label:"";
  const current=useFastag?(fastagPlace||`${fastag.lat.toFixed(5)}, ${fastag.lng.toFixed(5)}`)
    : (gpsHasCoords?(clean(r.loc?.location)||`${Number(r.loc.latitude).toFixed(5)}, ${Number(r.loc.longitude).toFixed(5)}`)
      :(r.loc?.location||r.trip?.current_location||"—"));
  const eta=r.trip?.expected_arrival_date?`${fmt(r.trip.expected_arrival_date)}${r.trip.expected_arrival_time?" "+clean(r.trip.expected_arrival_time).slice(0,5):""}`:"—";
  const gps=useFastag?"FASTag":(gpsHasCoords?"GPS":(current!=="—"?"MANUAL":"—"));
  const last=useFastag?fmtDT(fastag.time):(gpsTime?fmtDT(gpsTime):"—");
   return `<tr tabindex="0" data-id="${esc(r.t.id)}" onclick="window.EktaTracking.selectTruck('${esc(r.t.id)}')" ondblclick="window.EktaTracking.openTruck('${esc(r.t.id)}')" onkeydown="window.EktaTracking.rowKey(event,'${esc(r.t.id)}')">
   <td><span class="zone">${esc(r.truckZone||"—")}</span></td>
   ${emptyView?`<td class="et-last-unload" title="${esc(lastUnloadingPoint(r.t.id))}"><span>${esc(lastUnloadingPoint(r.t.id))}</span></td>`:""}
   <td><span class="et-truck" onclick="event.stopPropagation();window.EktaTracking.openTruck('${esc(r.t.id)}')">${esc(r.t.truck_number||"—")}</span></td>
   <td class="et-trip-internal">${esc(r.trip?.trip_number||"—")}</td>
   <td class="et-party-cell">${esc(r.p?.name||"—")}${r.trip?`<div class="et-party-pending"><button type="button" class="et-billing-edit" onclick="event.stopPropagation();window.EktaTracking.openPendingProgram('${esc(r.trip.id)}')">✎ Edit Pending</button></div>`:""}</td>
   <td><span class="et-party-kind ${r.p?(isBillingClient(r.p)?"billing":"transporter"):""}">${r.p?(isBillingClient(r.p)?"BILLING":"TRANSPORTER"):"—"}</span></td>
   <td class="et-route-cell">${esc(r.trip?.from_location||r.trip?.loading_point||"—")}${r.trip?.to_location||r.trip?.destination?'<span class="et-route-arrow" aria-hidden="true">→</span>':''}</td>
   <td class="et-route-cell">${esc(r.trip?.to_location||r.trip?.destination||"—")}</td>
   <td><div class="et-stage-actions">${r.trip&&r.status==="PROGRAM"?`<button type="button" class="et-stage-cancel" title="Cancel Program" onclick="event.stopPropagation();window.EktaTracking.cancelProgram('${esc(r.trip.id)}')">✕</button>`:""}${r.trip&&["RUNNING","REPORTING"].includes(r.actualStage)?`<button type="button" class="et-breakdown-btn ${activeBreakdown(r.trip)?"et-breakdown-active":""}" title="${activeBreakdown(r.trip)?"Breakdown active — see Live Alerts":"Report Breakdown"}" onclick="event.stopPropagation();window.EktaTracking.startBreakdown('${esc(r.trip.id)}')">🔧</button>`:""}${badge(r.status,activeBreakdown(r.trip)?false:r.alert,!!activeBreakdown(r.trip))}${!r.d?`<button type="button" class="et-assign-driver-btn" onclick="event.stopPropagation();window.EktaTracking.openAssignDriver('${esc(r.t.id)}')">＋ Assign Driver</button>`:""}${r.trip&&r.status==="PROGRAM"&&(!r.trip.party_id||!r.trip.driver_id||getNote(r.trip.notes,"PROGRAM_DETAILS_PENDING")==="YES")?'<span class="et-program-pending-pill">PENDING</span>':""}${r.status==="EMPTY"?`<button type="button" class="et-add-program" onclick="event.stopPropagation();window.EktaTracking.openQuickProgram('${esc(r.t.id)}')">＋ Add Program</button>`:""}${r.trip&&["PROGRAM","RUNNING","REPORTING"].includes(r.status)?`<button type="button" class="et-stage-next et-stage-${r.status.toLowerCase()}" title="Move to next stage" onclick="event.stopPropagation();window.EktaTracking.quickNextStage('${esc(r.trip.id)}')">➜</button>`:""}</div></td>
   <td>
      <div class="et-location-wrap">
        <span class="et-location-text">${esc(current)}</span>
        ${r.trip?`<button class="et-location-edit" onclick="event.stopPropagation();window.EktaTracking.openManualLocation('${esc(r.t.id)}')">✏ Edit</button>`:""}
      </div>
    </td>
   <td><span class="et-gps-source">${esc(gps)}</span></td>
   <td>${esc(last)}<div style="margin-top:5px">${action(r)}</div></td>
   </tr>`;
 }).join(""):`<tr><td colspan="${emptyView?12:11}" style="padding:30px;text-align:center" class="muted">No Tracking records found.</td></tr>`;
 cards();alerts();restoreWorksheet();if(!selectedMap&&data[0])selectMap(data[0]);
}

const expandedEwayTrips=new Set();
function toggleEwayBills(tripId){
 const key=String(tripId);
 if(expandedEwayTrips.has(key))expandedEwayTrips.delete(key);
 else expandedEwayTrips.add(key);
 render();
}
function ewayCountdown(b){
 const expiry=b?.valid_until?new Date(b.valid_until):null;
 if(!expiry||isNaN(expiry.getTime()))return "Expiry missing";
 const diff=expiry.getTime()-Date.now();
 if(diff<=0)return "Expired";
 const hours=Math.floor(diff/3600000),mins=Math.floor((diff%3600000)/60000);
 return `${hours}h ${mins}m left`;
}
function ewayCell(r){
 if(!r.trip)return '<span class="et-eway-state et-eway-pending">No active trip</span>';
 const id=esc(r.trip.id),list=billsForTrip(r.trip.id);
 const expanded=expandedEwayTrips.has(String(r.trip.id));
 const overall=ewayTripOverallStatus(r.trip);
 const cls=overall==='EXPIRED'?'expired':overall==='WARNING'?'warning':overall==='OK'?'ok':'pending';
 const summary=list.length?`${list.length} E-Way Bill${list.length===1?'':'s'}`:'No E-Way Bill';
 const details=expanded?`<div class="et-eway-list">${list.map((b,i)=>{
   const status=ewayBillStatus(b),tone=status==='EXPIRED'?'expired':status==='WARNING'?'warning':status==='OK'?'ok':'pending';
   return `<div class="et-eway-item"><div class="et-eway-item-top"><strong>Bill ${i+1}: ${esc(b.eway_bill_number||'—')}</strong><span class="et-eway-state et-eway-${tone}">${esc(ewayCountdown(b))}</span></div><div>Bill Date: ${esc(fmtDT(b.eway_bill_date||b.valid_from))}</div><div>Expiry: ${esc(fmtDT(b.valid_until))}</div><button type="button" class="et-eway-btn" onclick="event.stopPropagation();window.EktaTracking.openEwayEdit('${id}','${esc(b.id)}')">✎ Edit</button></div>`;
 }).join('')||'<div class="et-eway-empty">No bills entered for this trip.</div>'}
 <button type="button" class="et-eway-btn et-eway-add" onclick="event.stopPropagation();window.EktaTracking.openEwayEdit('${id}','')">＋ Add Another E-Way Bill</button></div>`:'';
 return `<div class="et-eway-cell"><button type="button" class="et-eway-toggle" aria-expanded="${expanded}" onclick="event.stopPropagation();window.EktaTracking.toggleEwayBills('${id}')"><span>${esc(summary)}</span><span class="et-eway-state et-eway-${cls}">${overall==='PENDING'?'Pending':overall==='EXPIRED'?'Expired':overall==='WARNING'?'Expiry ≤ 8h':'Valid'}</span><span aria-hidden="true">${expanded?'▴':'▾'}</span></button>${details}</div>`;
}

function badge(s,a,isBreakdown=false){const c={PROGRAM:"b-program",LOADING:"b-loading",RUNNING:"b-running",REPORTING:"b-reporting",EMPTY:"b-empty",NO_DRIVER:"b-exception",CANCELLED:"b-cancel"}[s]||"b-cancel";return `<span class="et-badge ${c}${isBreakdown?" et-badge-breakdown":""}">${esc(s==="EMPTY"?"EMPTY (Available)":(s==="NO_DRIVER"?"NO DRIVER":s))}${a?" ⚠":""}</span>`}
function action(r){if(r.status==="NO_DRIVER")return `<button class="action" onclick="event.stopPropagation();window.EktaTracking.openTruck('${esc(r.t.id)}')">View</button>`;if(r.status==="PROGRAM")return `<button class="action" onclick="event.stopPropagation();window.EktaTracking.openTripAction('${esc(r.trip.id)}')">Open Program</button>`;if(r.status==="LOADING")return `<button class="action" onclick="event.stopPropagation();window.EktaTracking.openTripAction('${esc(r.trip.id)}')">Enter LR</button>`;if(r.status==="RUNNING")return `<button class="action" onclick="event.stopPropagation();window.EktaTracking.openTripAction('${esc(r.trip.id)}')">Mark Reporting</button>`;if(r.status==="REPORTING")return `<button class="action" onclick="event.stopPropagation();window.EktaTracking.openTripAction('${esc(r.trip.id)}')">Complete</button>`;if(r.status==="EMPTY")return `<button class="action" onclick="event.stopPropagation();window.EktaTracking.openProgramForTruck('${esc(r.t.id)}')">New Program</button>`;return `<button class="action" onclick="event.stopPropagation();window.EktaTracking.openTruck('${esc(r.t.id)}')">View</button>`}
function updateSelectedStatusCard(){
 document.querySelectorAll('#trackingModule .cards .card[data-tracking-filter]').forEach(card=>{
  const active=!!filterStatus && card.dataset.trackingFilter===filterStatus;
  card.classList.toggle('et-status-selected',active);
  card.setAttribute('aria-pressed',String(active));
  card.setAttribute('tabindex','0');
 });
}
function cards(){
 updateSelectedStatusCard();
 const d=displayedRowsModel(),c=s=>d.filter(x=>x.status===s).length,h=historyCounts();
 $("etNProgram").textContent=c("PROGRAM");
 $("etNRunning").textContent=c("RUNNING");
 $("etNReporting").textContent=c("REPORTING");
 $("etNEmpty").textContent=c("EMPTY");
 $("etNNoDriver").textContent=d.filter(x=>!x.d).length;
 $("etNDelay").textContent=d.filter(x=>x.delay).length;
 $("etNAlerts").textContent=d.reduce((n,x)=>n+(!x.d?1:0)+(x.delay?1:0)+(x.alert?1:0),0)+driverRequests.length+rowsModel().filter(r=>r.trip).reduce((n,r)=>n+billsForTrip(r.trip.id).filter(b=>["WARNING","EXPIRED"].includes(ewayBillStatus(b))).length,0);
 if($("etNCompleted"))$("etNCompleted").textContent=h.completed;
 if($("etNCancelled"))$("etNCancelled").textContent=h.cancelled;
}
function alerts(){
 const a=[];
 programRequests.forEach(req=>a.push(programRequestCard(req)));
 driverRequests.forEach(req=>a.push(driverRequestCard(req)));
 rowsModel().forEach(r=>{
  if(r.trip&&statusOf(r.trip)==="PROGRAM"){
   const t=r.trip, pending=[];
   if(!t.party_id||getNote(t.notes,"AI_PENDING_BRANCH")==="YES")pending.push("🟠 Branch");
   if(!activeDriver(t.truck_id)||!t.driver_id)pending.push("🔴 Driver");
   if(getNote(t.notes,"FREIGHT_ENTERED_AT_PROGRAM")==="NO"&&getNote(t.notes,"FREIGHT_FINAL_ENTERED")!=="YES")pending.push("🔴 Freight");
   if(!t.lr_date&&!t.start_date)pending.push("🟡 LR");
   if(getNote(t.notes,"BILLING_CONFIRMATION")!=="CONFIRMED")pending.push("🟣 Billing");
   if(pending.length)a.push(`<div class="et-alert"><b>${esc(r.t.truck_number)}</b> — Details Pending<br>${pending.map(x=>x.replace(/[🔴🟠🟡🟣]/gu,"•")).join(" • ")}<br><button type="button" class="et-billing-edit" onclick="window.EktaTracking.openPendingProgram('${esc(t.id)}')">✎ Edit Full Program</button> <button type="button" class="et-billing-edit" onclick="window.EktaTracking.cancelProgram('${esc(t.id)}')">✕ Cancel Program</button></div>`);
  }
  if(r.trip){billsForTrip(r.trip.id).filter(b=>['WARNING','EXPIRED'].includes(ewayBillStatus(b))).forEach(b=>{a.push(`<div class="et-alert">⏰ <b>${esc(r.t.truck_number)}</b> • E-Way ${esc(b.eway_bill_number||'')}<br>${ewayBillStatus(b)==='EXPIRED'?'EXPIRED':'Expires within 8 hours'} — ${esc(fmtDT(b.valid_until))} • ${esc(ewayRemaining(b.valid_until))}</div>`);});}
  if(!r.d)a.push(`<div class="et-alert">⚠ <b>${esc(r.t.truck_number)}</b><br>No active driver assigned. Open Program Pending to assign.</div>`);
  if(r.delay)a.push(`<div class="et-alert">🔴 <b>${esc(r.trip?.trip_number||"Trip")}</b><br>System ETA appears delayed.</div>`);
  if(r.alert&&!activeBreakdown(r.trip))a.push(`<div class="et-alert">⚠ <b>${esc(r.t.truck_number)}</b><br>Accident / emergency alert.</div>`);
 });
 trips.forEach(t=>{
  const b=activeBreakdown(t);if(!b)return;
  const tr=truck(t.truck_id);
  a.push(`<div class="et-alert et-breakdown-alert"><strong>🔧 Vehicle Breakdown — ${esc(tr?.truck_number||"Unknown truck")}</strong><br>Started: ${esc(fmtDT(b.started_at))}<br>Elapsed: <strong data-breakdown-start="${esc(b.started_at)}">${esc(breakdownDuration(b.started_at))}</strong>${b.reason?`<br>Reason: ${esc(b.reason)}`:""}<br><button type="button" class="et-billing-edit" onclick="window.EktaTracking.resolveBreakdown('${esc(t.id)}')">✓ Mark Repaired</button></div>`);
 });
 const bellItems=$("etBellItems"),bellCount=$("etBellCount");
 if(bellItems){bellItems.dataset.allAlerts=a.join("");bellItems.dataset.breakdownAlerts=a.filter(x=>x.includes("et-breakdown-alert")).join("");bellItems.innerHTML=bellItems.dataset.allAlerts||'<div class="muted">No active notifications.</div>';}
 if(bellCount)bellCount.textContent=String(a.length);
 if($("etNAlerts"))$("etNAlerts").textContent=String(trips.filter(t=>!!activeBreakdown(t)).length);
 updateBreakdownTimers();

}

/* ========================= 7. FILTERS ======================= */
function setStatusFilter(s){$("etBellPanel")?.classList.remove("show");$("etBellBtn")?.setAttribute("aria-expanded","false");filterStatus=clean(s).toUpperCase();if(filterStatus==="ALL")filterStatus="";render()}
function resetFilters(){filterStatus="";$("etSearch").value="";$("etStatusFilter").value="";$("etZoneFilter").value="";$("etDriverFilter").value="";render()}
function shiftDate(n){const input=$("etDate");if(!input)return;const d=new Date((input.value||today())+"T00:00:00");d.setDate(d.getDate()+n);input.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;render()}
function setToday(){if($("etDate"))$("etDate").value=today();filterStatus="";if($("etStatusFilter"))$("etStatusFilter").value="";render()}
function populateDrivers(){const x=$("etDriverFilter"),cur=x.value;x.innerHTML=`<option value="">All Drivers</option>`+drivers.filter(d=>clean(d.status||"Active").toLowerCase()!=="inactive").sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))).map(d=>`<option value="${esc(d.id)}">${esc(d.name||d.driver_code||"Driver")}</option>`).join("");x.value=cur}
function viewAllTracking(){
 filterStatus="";
 if($("etSearch"))$("etSearch").value="";
 if($("etStatusFilter"))$("etStatusFilter").value="";
 if($("etZoneFilter"))$("etZoneFilter").value="";
 if($("etDriverFilter"))$("etDriverFilter").value="";
 if($("etDate"))$("etDate").value=today();
 selectedMap=null;render();
 $("etRows")?.closest(".tablewrap")?.scrollTo({top:0,left:0,behavior:"smooth"});
}

/* ========================= 8. PROGRAM ======================= */
let quickProgramTruckId=null;
function openQuickProgram(id){
 const t=truck(id);if(!t)return;
 if(activeTrip(id))return alertUser("This truck already has an active trip.");
 quickProgramTruckId=id;
 $("etQuickProgramTruck").textContent=t.truck_number||"Truck";
 $("etQuickFrom").value=defaultProgramLoadingPoint(id);$("etQuickTo").value="";
 $("etQuickProgramModal").classList.add("show");
 setTimeout(()=>$('etQuickFrom')?.focus(),50);
}
function closeQuickProgram(){quickProgramTruckId=null;$("etQuickProgramModal")?.classList.remove("show")}
function continueQuickProgram(e){
 e?.preventDefault();
 const id=quickProgramTruckId,from=clean($("etQuickFrom")?.value),to=clean($("etQuickTo")?.value);
 if(!id||!from||!to)return false;
 closeQuickProgram();
 // Existing program creation requires party and other details; never insert an incomplete trip.
 openProgramForTruck(id);
 if(!$("etProgramModal")?.classList.contains("show"))return false;
 $("etPLoad").value=from;$("etPTo").value=to;
 return false;
}
// Pre-fill From with this vehicle's last completed unloading destination.
// This is a form default only; office staff may edit it before saving.
function defaultProgramLoadingPoint(truckId){
 const point=lastUnloadingPoint(truckId);
 return point && point!=="—" ? point : "";
}
function fillProgramLoadingPoint(truckId){
 const field=$("etPLoad");
 if(field)field.value=defaultProgramLoadingPoint(truckId);
}
function openProgram(){setProgramRequestContext(null);resetProgram();$("etProgramModal").classList.add("show");setTimeout(()=>$('etPTruck')?.focus(),50)}
function openProgramForTruck(id){const t=truck(id);if(!t)return;if(activeTrip(id))return alertUser("This truck already has an active trip.");resetProgram();selectedTruck=t;$("etPTruck").value=t.truck_number||"";fillProgramLoadingPoint(t.id);syncFleetProgramCategory();$("etProgramModal").classList.add("show");setTimeout(()=>$('etPParty')?.focus(),50)}
function resetProgram(){programEditTripId=null;selectedTruck=null;selectedParty=null;$("etPTruck").value="";$("etPDate").value=today();$("etPParty").value="";$("etPPartyType").value="";$("etPLoad").value="";$("etPTo").value="";$("etPRevenue").value="";$("etPRemark").value="";["etProgramCategory","etProgramHaier","etProgramWeight"].forEach(id=>{if($(id))$(id).value=""});programRates=[];updateProgramPartyFields();syncFleetProgramCategory();$("etTruckSuggestions").classList.remove("show");$("etPartySuggestions").classList.remove("show")}
let etProgramSaving=false;
async function saveProgram(e){
 e.preventDefault();
 if(etProgramSaving)return false;
 if(!selectedTruck)return alertUser("Select an EMPTY truck.");
 if(!programEditTripId&&activeTrip(selectedTruck.id))return alertUser("This truck already has an active trip.");
 const d=activeDriver(selectedTruck.id);
 if(!d&&!programEditTripId)console.warn("[EKTA] Saving Program with driver pending");
 // Party may be assigned later; the Program remains pending until completed.
 const lp=clean($("etPLoad").value),to=clean($("etPTo").value),pd=$("etPDate").value||today(),a=activeAssignment(selectedTruck.id);
 let revInput=clean($("etPRevenue").value);
 if(!revInput&&selectedParty&&isBillingClient(selectedParty)&&!isHaierBillingParty(selectedParty)){
  const rate=await findProgramRate(selectedParty,selectedTruck,lp,to,pd);
  if(rate){revInput=String(rate.rate);$("etPRevenue").value=revInput}
 }
 const rev=revInput===""?0:num(revInput);
 if(!lp||!to)return alertUser("Enter From and To locations.");
 let notes=programEditTripId?(clean(trips.find(x=>String(x.id)===String(programEditTripId))?.notes)):"";
 notes=clean(notes.replace(/\[TRACKING:[^\]]*\]/gi, "").trim()+" "+(clean(trips.find(x=>String(x.id)===String(programEditTripId))?.notes).match(/\[TRACKING:[^\]]*\]/gi)||[]).join(" ")).trim();
 const remarks=clean($("etPRemark").value);
 notes=clean(remarks+" "+(notes.match(/\[TRACKING:[^\]]*\]/gi)||[]).join(" "));
 if(!programEditTripId)notes=putNote(notes,"STAGE","PROGRAM");
 notes=putNote(notes,"PROGRAM_DETAILS_PENDING",(!selectedParty||!d||!revInput)?"YES":"NO");
 notes=putNote(notes,"HAIER_BILLING_ARRANGEMENT",$("etProgramHaier")?.value||"PENDING");
 notes=putNote(notes,"PROGRAM_RATE_CATEGORY",$("etProgramCategory")?.value||"PENDING");
 notes=putNote(notes,"TRANSPORTER_WEIGHT_TON",$("etProgramWeight")?.value||"PENDING");
 // Freight entered at PROGRAM is provisional until LR verification.
 // Keep numeric zero for compatibility with existing Supabase numeric constraints.
 notes=putNote(notes,"FREIGHT_CONFIRMATION","PENDING_LR");
 notes=putNote(notes,"FREIGHT_ENTERED_AT_PROGRAM",revInput===""?"NO":"YES");
 const base={trip_number:`ET-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`,truck_id:selectedTruck.id,driver_id:d?.id||null,assignment_id:a?.id||null,party_id:selectedParty?.id||null,from_location:lp,to_location:to,loading_point:lp,destination:to,program_date:pd,freight_amount:rev,revenue:rev,trip_status:"Planned",start_date:null,current_location:lp,notes};
 const requestId=currentProgramRequestId;
 etProgramSaving=true;
 const saveButton=document.querySelector('#etProgramModal .et-program-save');
 if(saveButton){saveButton.disabled=true;saveButton.textContent='Saving…';}
 try{
  let payload={...base,tracking_status:"PROGRAM"};
  let r=programEditTripId?await S.from(T.trips).update({party_id:payload.party_id,driver_id:payload.driver_id,from_location:lp,to_location:to,loading_point:lp,destination:to,program_date:pd,freight_amount:rev,revenue:rev,notes}).eq("id",programEditTripId).select().single():await S.from(T.trips).insert(payload).select().single();
  if(!programEditTripId&&r.error&&(r.error.code==="23514"||clean(r.error.message).toLowerCase().includes("tracking_status"))){
   console.warn("[EKTA TRACKING] PROGRAM status constraint fallback used.");
   payload={...base,tracking_status:"LOADING"};
   r=await S.from(T.trips).insert(payload).select().single();
  }
  if(r.error)throw r.error;
  if(!programEditTripId){const tu=await S.from(T.trucks).update({status:"On Trip"}).eq("id",selectedTruck.id);
  if(tu.error)console.warn("[EKTA TRACKING] Truck PROGRAM status warning:",tu.error);}

  let requestWarning="";
  if(requestId){
   try{await completeDriverProgramRequest(requestId)}
   catch(re){
    console.error("[EKTA TRACKING] Program saved but request completion failed:",re);
    requestWarning="\n\nProgram was saved, but the Driver Program Request could not be marked COMPLETED. Refresh and review the request.";
   }
  }

  setProgramRequestContext(null);
  closeModal("etProgramModal");
  clearTrackingSearchAfterSave();
  await loadAll();
  alertUser(programEditTripId?"Program updated successfully.":`Program saved to Programming List${getNote(notes,"PROGRAM_DETAILS_PENDING")==="YES"?" — PENDING":""}.\nTrip: ${base.trip_number}${requestWarning}`);
 }catch(err){
  console.error("[EKTA TRACKING] Program save failed:",err);
  alertUser("Program save failed: "+(err.message||"Database error"));
 }finally{
  etProgramSaving=false;
  if(saveButton){saveButton.disabled=false;saveButton.textContent='✓ Save Program';}
 }
 return false;
}

/* ========================= 9. PROGRAM -> LOADING ========= */
function openProgramToLoading(t){selectedTrip=t;const tr=truck(t.truck_id);$("etLTruck").value=tr?.truck_number||"";$("etLTrip").value=t.trip_number||"";$("etLProgramDate").value=dateOnly(t.program_date);$("etLDate").value=t.loading_date||getNote(t.notes,"LOADING_DATE")||today();$("etLPoint").value=t.loading_point||t.from_location||"";updateLoadingAttention();$("etLoadingModal").classList.add("show")}
function updateLoadingAttention(){if(!selectedTrip)return;const d=$("etLDate").value;$("etLoadingAttention").innerHTML=`<div class="et-notice">Program Date: <b>${esc(fmt(selectedTrip.program_date))}</b> • Loading Date: <b>${esc(fmt(d))}</b> • Gap: <b>${daysBetween(selectedTrip.program_date,d)} day(s)</b></div>`}
async function confirmLoading(e){e.preventDefault();if(!selectedTrip)return false;const d=$("etLDate").value;if(!d)return alertUser("Loading Date is required.");let notes=clean(selectedTrip.notes)||"";notes=putNote(notes,"LOADING_DATE",d);notes=putNote(notes,"STAGE","LOADING");const payload={tracking_status:"LOADING",trip_status:"Planned",loading_date:d,current_location:selectedTrip.loading_point||selectedTrip.from_location||null,notes};try{const r=await S.from(T.trips).update(payload).eq("id",selectedTrip.id);if(r.error)throw r.error;await S.from(T.trucks).update({status:"LOADING"}).eq("id",selectedTrip.truck_id);closeModal("etLoadingModal");await loadAll();alertUser(`Trip ${selectedTrip.trip_number} moved to LOADING.`)}catch(err){console.error(err);alertUser("Loading stage update failed: "+err.message)}return false}

/* ========================= 10. LOADING -> RUNNING ========= */
function openLR(t){selectedTrip=t;const tr=truck(t.truck_id);const ld=t.loading_date||getNote(t.notes,"LOADING_DATE")||"";$("etLRTruck").value=tr?.truck_number||"";$("etLRTrip").value=t.trip_number||"";$("etLRProgram").value=dateOnly(t.program_date);$("etLRLoadingDate").value=ld;$("etLRDate").value=t.lr_date||getNote(t.notes,"LR_DATE")||dateOnly(t.start_date)||today();$("etLREway").value="";$("etLRDetention").value=t.detention_charge??0;$("etLRRemark").value=t.notes||"";$("etLRModal").classList.add("show")}
async function confirmLR(e){e.preventDefault();if(!selectedTrip)return false;const d=$("etLRDate").value;if(!d)return alertUser("LR Date is required.");let notes=clean($("etLRRemark").value)||selectedTrip.notes||"";notes=putNote(notes,"LR_DATE",d);notes=putNote(notes,"STAGE","RUNNING");const payload={tracking_status:"RUNNING",trip_status:"In Transit",lr_date:d,start_date:d,current_location:selectedTrip.loading_point||selectedTrip.from_location||null,notes};if(Object.prototype.hasOwnProperty.call(selectedTrip,"detention_charge"))payload.detention_charge=parseAmount($("etLRDetention").value);try{const r=await S.from(T.trips).update(payload).eq("id",selectedTrip.id);if(r.error)throw r.error;const ew=clean($("etLREway").value);if(ew)await saveEwayFromLoading(selectedTrip,ew,d);await S.from(T.trucks).update({status:"RUNNING"}).eq("id",selectedTrip.truck_id);closeModal("etLRModal");await loadAll();alertUser(`Trip ${selectedTrip.trip_number} moved to RUNNING.`)}catch(err){console.error(err);alertUser("LR update failed: "+err.message)}return false}

/* ========================= 10. REPORTING ==================== */
function openReporting(t){selectedTrip=t;const tr=truck(t.truck_id);$("etRTruck").value=tr?.truck_number||"";$("etRTrip").value=t.trip_number||"";$("etRDate").value=t.reporting_date||getNote(t.notes,"REPORTING_DATE")||today();$("etRDestination").value=t.destination||t.to_location||"";$("etReportingModal").classList.add("show")}
async function confirmReporting(e){e.preventDefault();if(!selectedTrip)return false;const d=$("etRDate").value;if(!d)return alertUser("Reporting Date is required.");let notes=selectedTrip.notes||"";notes=putNote(notes,"REPORTING_DATE",d);notes=putNote(notes,"STAGE","REPORTING");const payload={tracking_status:"REPORTING",trip_status:"Delivered",reporting_date:d,current_location:selectedTrip.destination||selectedTrip.to_location||null,notes};try{const r=await S.from(T.trips).update(payload).eq("id",selectedTrip.id);if(r.error)throw r.error;await S.from(T.trucks).update({status:"REPORTING"}).eq("id",selectedTrip.truck_id);closeModal("etReportingModal");await loadAll();alertUser(`Trip ${selectedTrip.trip_number} moved to REPORTING.`)}catch(err){console.error(err);alertUser("Reporting update failed: "+err.message)}return false}

/* ========================= 11. UNLOADING ==================== */
function openUnloading(t){
 selectedTrip=t;
 const tr=truck(t.truck_id);
 $("etUTruck").value=tr?.truck_number||"";
 $("etUTrip").value=t.trip_number||"";
 $("etUReporting").value=t.reporting_date||getNote(t.notes,"REPORTING_DATE")||"—";
 $("etUDate").value=dateOnly(t.unloading_date)||dateOnly(t.end_date)||dateOnly(t.reporting_date)||dateOnly(getNote(t.notes,"REPORTING_DATE"))||today();
 $("etUDetention").value=unloadingDetentionCharge(t);
 $("etUUnload").value=t.unloading_charge??0;
 $("etUOther").value=t.other_charge??0;
 $("etUNgt").value=t.ngt??0;
 $("etURemark").value=t.notes||"";
 updateUnloadingAttention();
 $("etUnloadingModal").classList.add("show");
}
function updateUnloadingAttention(){
 if(!selectedTrip)return;
 const r=selectedTrip.reporting_date||getNote(selectedTrip.notes,"REPORTING_DATE"),d=$("etUDate").value,gap=unloadingGraceDays(r,d);
 if(gap>0&&parseAmount($("etUDetention").value)<=0)$("etUDetention").value=1000;
 $("etUnloadingAttention").innerHTML=`<div class="et-notice">Reporting Date: <b>${esc(fmt(r))}</b> • Unloading Date: <b>${esc(fmt(d))}</b> • Unloading Detention: <b>${gap} day(s)</b> • Default charge if blank: <b>₹1,000</b></div>`;
}
async function confirmUnloading(e){
 e.preventDefault();
 if(!selectedTrip)return false;
 const d=$("etUDate").value;
 if(!d)return alertUser("Unloading Date is required.");
 const reporting=selectedTrip.reporting_date||getNote(selectedTrip.notes,"REPORTING_DATE");
 const unloadDays=unloadingGraceDays(reporting,d);
 let unloadDetCharge=parseAmount($("etUDetention").value);
 if(unloadDays>0&&unloadDetCharge<=0)unloadDetCharge=1000;
 let notes=clean($("etURemark").value)||selectedTrip.notes||"";
 notes=putNote(notes,"OTHER_CHARGE",num($("etUOther").value));
 notes=putNote(notes,"NGT",num($("etUNgt").value));
 notes=putNote(notes,"UNLOADING_DETENTION_DAYS",unloadDays);
 notes=putNote(notes,"UNLOADING_DETENTION_CHARGE",unloadDetCharge);
 notes=putNote(notes,"STAGE","EMPTY");
 const payload={
  tracking_status:"EMPTY",trip_status:"Completed",unloading_date:d,end_date:d,
  current_location:selectedTrip.destination||selectedTrip.to_location||null,notes
 };
 if(Object.prototype.hasOwnProperty.call(selectedTrip,"unloading_charge"))payload.unloading_charge=num($("etUUnload").value);
 if(Object.prototype.hasOwnProperty.call(selectedTrip,"other_charge"))payload.other_charge=num($("etUOther").value);
 if(Object.prototype.hasOwnProperty.call(selectedTrip,"ngt"))payload.ngt=num($("etUNgt").value);
 try{
  const r=await S.from(T.trips).update(payload).eq("id",selectedTrip.id);
  if(r.error)throw r.error;
  await S.from(T.trucks).update({status:"AVAILABLE"}).eq("id",selectedTrip.truck_id);
  closeModal("etUnloadingModal");
  await loadAll();
  alertUser(`Trip ${selectedTrip.trip_number} completed.\nTruck is now EMPTY / AVAILABLE.`);
 }catch(err){
  console.error(err);
  alertUser("Unloading update failed: "+err.message);
 }
 return false;
}

/* Compact date-only lifecycle: date picker is the only action input. */
function quickDateForTrip(t,label,existing,useExisting=false){
 // Office entry is normally completed the following day: default to yesterday,
 // including correct month/year rollover. The user can edit the full date.
 const now=new Date();
 now.setHours(12,0,0,0);
 now.setDate(now.getDate()-1);
 const base=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
 return new Promise(resolve=>{
  const overlay=document.createElement("div");
  overlay.className="et-quick-date-overlay";
  overlay.innerHTML=`<div class="et-quick-date-box" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="et-quick-date-title">${esc(label)}</div><label class="et-quick-date-sub" for="etQuickDateInput">Date (default: previous day)</label><input id="etQuickDateInput" class="et-quick-date-input" type="date" aria-label="${esc(label)}" value="${useExisting&&existing?dateOnly(existing):base}"><div class="et-quick-date-error" aria-live="polite"></div><div class="et-quick-date-actions"><button type="button" class="et-quick-date-cancel">Cancel</button><button type="button" class="et-quick-date-confirm">Confirm</button></div></div>`;
  document.body.appendChild(overlay);
  const input=overlay.querySelector(".et-quick-date-input"),error=overlay.querySelector(".et-quick-date-error");
  const finish=value=>{document.removeEventListener("keydown",onKey,true);overlay.remove();resolve(value);};
  const confirm=()=>{
   const date=input.value;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){error.textContent="Select a valid date.";return;}
   const d=new Date(date+"T12:00:00");
   if(Number.isNaN(d.getTime())||d.getFullYear()!==Number(date.slice(0,4))||d.getMonth()+1!==Number(date.slice(5,7))||d.getDate()!==Number(date.slice(8,10))){error.textContent="Invalid date.";return;}
   finish(date);
  };
  const onKey=e=>{if(e.key==="Escape"){e.preventDefault();finish(null);}else if(e.key==="Enter"){e.preventDefault();confirm();}};
  document.addEventListener("keydown",onKey,true);
  overlay.querySelector(".et-quick-date-cancel").addEventListener("click",()=>finish(null));
  overlay.querySelector(".et-quick-date-confirm").addEventListener("click",confirm);
  overlay.addEventListener("click",e=>{if(e.target===overlay)finish(null);});
  input.focus();
 });
}

async function quickNextStage(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return alertUser("Trip not found.");
 const stage=statusOf(t);let label,payload,truckStatus,notes=clean(t.notes);
 if(stage==="PROGRAM"||stage==="LOADING"){
  label="LR / Loading Date";
  const d=await quickDateForTrip(t,label,t.lr_date||t.loading_date||t.program_date||today());if(!d)return;
  notes=putNote(putNote(putNote(notes,"LR_DATE",d),"LOADING_DATE",d),"STAGE","RUNNING");
  payload={trip_status:"In Transit",tracking_status:"RUNNING",loading_date:d,lr_date:d,start_date:d,notes};truckStatus="On Trip";
 }else if(stage==="RUNNING"){
  label="Reporting Date";
  const d=await quickDateForTrip(t,label,t.reporting_date||today());if(!d)return;
  const lr=dateOnly(t.lr_date||t.loading_date||t.start_date);if(lr&&d<lr)return alertUser("Reporting Date cannot be before LR Date.");
  notes=putNote(putNote(notes,"REPORTING_DATE",d),"STAGE","REPORTING");
  payload={trip_status:"Delivered",tracking_status:"REPORTING",reporting_date:d,notes};truckStatus="On Trip";
 }else if(stage==="REPORTING"){
  label="Unloading Date";
  const d=await quickDateForTrip(t,label,t.unloading_date||t.reporting_date||today());if(!d)return;
  const rep=dateOnly(t.reporting_date);if(rep&&d<rep)return alertUser("Unloading Date cannot be before Reporting Date.");
  notes=putNote(putNote(notes,"UNLOADING_DETENTION_DAYS",unloadingGraceDays(rep,d)),"STAGE","EMPTY");
  payload={trip_status:"Completed",tracking_status:"EMPTY",unloading_date:d,end_date:d,notes};truckStatus="Available";
 }else return;
 if(!window.confirm(`${truck(t.truck_id)?.truck_number||"Truck"}\n${label}: ${fmt(payload.lr_date||payload.reporting_date||payload.unloading_date)}\nConfirm status change?`))return;
 try{
  const result=await S.from(T.trips).update(payload).eq("id",t.id);if(result.error)throw result.error;
  const tr=await S.from(T.trucks).update({status:truckStatus}).eq("id",t.truck_id);
  if(tr.error)console.warn("[EKTA] Truck status update warning:",tr.error);
  await loadAll();
 }catch(err){console.error("[EKTA] Quick stage change failed:",err);alertUser("Status update failed: "+(err.message||"Database error"));}
}

/* ========================= 12. TRIP ACTION ================== */
function openTripAction(id){const t=trips.find(x=>String(x.id)===String(id));if(!t)return alertUser("Trip not found.");const s=statusOf(t);if(["PROGRAM","LOADING","RUNNING","REPORTING"].includes(s))return quickNextStage(id);openTruck(t.truck_id)}

/* ========================= 13. TRUCK DETAILS ================ */
function openTruck(id){
 const t=truck(id);if(!t)return;
 const tr=activeTrip(id),d=activeDriver(id),a=activeAssignment(id),p=tr?party(tr.party_id):null,l=latestLocation(id),s=statusOf(tr);
 selectMap({t,trip:tr,d,p,loc:l,status:s,truckZone:truckZone(tr,l)});
 $("etTruckTitle").textContent=`Truck Details — ${t.truck_number||""}`;

 const photo=driverPhotoUrl(d);
 const driverVisual=photo
   ? `<img class="et-driver-photo" src="${esc(photo)}" alt="Driver photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="et-driver-initials" style="display:none">${esc(driverInitials(d))}</div>`
   : `<div class="et-driver-initials">${esc(driverInitials(d))}</div>`;

 $("etTruckBody").innerHTML=`
 <div class="et-notice"><b>Status:</b> ${esc(s)} • <b>Driver:</b> ${esc(d?.name||"NO DRIVER")}</div>

 <div class="et-driver-summary">
   <div>${driverVisual}</div>
   <div class="et-driver-meta">
      <div><b>Name:</b> ${esc(d?.name||"NO DRIVER")}</div>
      <div><b>Phone:</b> ${esc(d?.phone||"—")}</div>
      <div><b>License:</b> ${esc(d?.license_number||"—")}</div>
      <div><b>License Expiry:</b> ${esc(fmt(d?.license_expiry))}</div>
   </div>
 </div>

 <div class="et-grid">
  <div class="et-field"><label>Truck</label><input class="et-input readonly" readonly value="${esc(t.truck_number||"—")}"></div>
  <div class="et-field"><label>Truck Current Zone</label><input class="et-input readonly" readonly value="${esc(truckZone(tr,l)||"—")}"></div>
  <div class="et-field"><label>Party</label><input class="et-input readonly" readonly value="${esc(p?.name||"—")}"></div>
  <div class="et-field"><label>Party Zone</label><input class="et-input readonly" readonly value="${esc(p?.zone||"—")}"></div>
  <div class="et-field"><label>Trip No.</label><input class="et-input readonly" readonly value="${esc(tr?.trip_number||"—")}"></div>
  <div class="et-field"><label>Program Date</label><input class="et-input readonly" readonly value="${esc(fmt(tr?.program_date))}"></div>
  <div class="et-field et-full"><label>Route</label><input class="et-input readonly" readonly value="${esc((tr?.loading_point||tr?.from_location||"—")+" → "+(tr?.destination||tr?.to_location||"—"))}"></div>
  <div class="et-field et-full"><label>Current Location</label><input class="et-input readonly" readonly value="${esc(l?.location||tr?.current_location||"—")}"></div>
 </div>

 <div class="et-footer">
  ${tr?`<button class="et-btn et-primary" onclick="window.EktaTracking.closeModal('etTruckModal');window.EktaTracking.openTripAction('${esc(tr.id)}')">Open Current Action</button>`:""}
  ${tr&&s==="PROGRAM"?`<button class="et-btn" style="border-color:#ffd0d5;color:#d9293e;background:#fff1f2" onclick="window.EktaTracking.cancelProgram('${esc(tr.id)}')">Cancel Program</button>`:""}
  ${s==="EMPTY"?`<button class="et-btn" onclick="window.EktaTracking.closeModal('etTruckModal');window.EktaTracking.openProgramForTruck('${esc(t.id)}')">New Program</button>`:""}
  <button class="et-btn" onclick="window.EktaTracking.closeModal('etTruckModal')">Close</button>
 </div>`;
 $("etTruckModal").classList.add("show");
}
async function cancelProgram(tripId){
 const t=trips.find(x=>String(x.id)===String(tripId));
 if(!t||statusOf(t)!=="PROGRAM")return alertUser("Only a PROGRAM-stage trip can be cancelled here.");
 if(!window.confirm(`Cancel Program ${t.trip_number}?`))return;
 const reason="Cancelled from Tracking table";
 const cDate=today();
 let notes=clean(t.notes)||"";
 notes=putNote(notes,"CANCELLED_DATE",cDate);
 notes=putNote(notes,"CANCEL_REASON",reason);
 notes=putNote(notes,"STAGE","CANCELLED");
 try{
  const r=await S.from(T.trips).update({trip_status:"Cancelled",notes}).eq("id",t.id);
  if(r.error)throw r.error;
  const tr=await S.from(T.trucks).update({status:"AVAILABLE"}).eq("id",t.truck_id);
  if(tr.error)console.warn("[EKTA TRACKING] Truck AVAILABLE warning:",tr.error);
  closeModal("etTruckModal");
  await loadAll();
  alertUser(`Program ${t.trip_number} cancelled.\nTruck is now EMPTY / AVAILABLE.`);
 }catch(err){
  console.error("[EKTA TRACKING] Cancel Program failed:",err);
  alertUser("Cancel Program failed: "+(err.message||"Database error"));
 }
}

/* ========================= 14. GOOGLE MAPS ================== */
function selectTruck(id){const t=truck(id);if(!t)return;const tr=activeTrip(id),d=activeDriver(id),l=latestLocation(id),p=tr?party(tr.party_id):null;selectMap({t,trip:tr,d,p,loc:l,status:statusOf(tr),truckZone:truckZone(tr,l)});document.querySelectorAll("#etRows tr").forEach(x=>x.classList.remove("selected"));document.querySelector(`#etRows tr[data-id="${CSS.escape(String(id))}"]`)?.classList.add("selected")}
function selectMap(r){selectedMap=r;if(!r?.t)return;
 if($("etMapTruck"))$("etMapTruck").textContent=`${r.t.truck_number||"Truck"} • ${r.status}`;
 const hasGPS=r.loc?.latitude!=null&&r.loc?.longitude!=null;
 if($("etMapLocation"))$("etMapLocation").textContent=r.loc?.location||(hasGPS?"Live GPS":r.trip?.current_location||r.trip?.destination||"Location not available");
 if($("etMapCoordinates"))$("etMapCoordinates").textContent=hasGPS?`${r.loc.latitude}, ${r.loc.longitude}`:"GPS coordinates not available";
 refreshMap();
}
function mapQuery(){const l=selectedMap?.loc,t=selectedMap?.trip;if(l?.latitude!=null&&l?.longitude!=null)return `${l.latitude},${l.longitude}`;return l?.location||t?.current_location||t?.destination||t?.to_location||"Noida, India"}
function refreshMap(){const f=$("etGoogleMap");if(!f)return;f.src=`https://www.google.com/maps?q=${encodeURIComponent(mapQuery())}&z=10&output=embed`}
function openSelectedInGoogleMaps(){window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery())}`,"_blank","noopener,noreferrer")}

/* ========================= 14A. FULL SCREEN LIVE MAP ========
   API KEY SETUP:
   Define window.EKTA_GOOGLE_MAPS_API_KEY before tracking.js loads.
   Example in owner-dashboard.html (replace with your restricted key):
   <script>window.EKTA_GOOGLE_MAPS_API_KEY="YOUR_RESTRICTED_KEY";</script>
============================================================= */
let etGoogleMapsPromise=null,etFleetMap=null,etFleetMarkers=[],etFleetTrail=null,etFleetInfo=null,etFleetFilter="ALL";
let etFleetHistoryRange="LAST24",etFleetHistoryCustomStart=null,etFleetHistoryCustomEnd=null,etFleetRouteMarkers=[];
let etFastagMap=null,etFastagMarkers=[],etFastagInfo=null,etFastagRows=[],etFastagHistoryMarkers=[],etFastagHistoryLine=null,etFastagDirectionsRenderer=null,etFastagClusterer=null,etMarkerClustererPromise=null;
const etFastagGeoCache=new Map();

function googleMapsApiKey(){return clean(window.EKTA_GOOGLE_MAPS_API_KEY||"")}
function googleRoadsApiKey(){return clean(window.EKTA_GOOGLE_ROADS_API_KEY||"")}

/* Roads API is optional at runtime: if the dedicated key is not configured,
   Tracking keeps using the original raw GPS coordinates without breaking. */
async function snapPathToRoads(points){
 const key=googleRoadsApiKey();
 const src=(points||[]).filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lng)));
 if(!key||src.length<2)return src;
 const segments=[]; let seg=[];
 for(const p of src){
  const prev=seg[seg.length-1];
  if(prev){
   const gapMin=Math.abs(new Date(p.time||0)-new Date(prev.time||0))/60000;
   const gapKm=gpsPointDistanceM(prev,p)/1000;
   if(gapMin>45 || gapKm>35){if(seg.length)segments.push(seg);seg=[]}
  }
  seg.push(p);
 }
 if(seg.length)segments.push(seg);
 const out=[];
 try{
  for(const segment of segments){
   if(segment.length<2){out.push(...segment);continue}
   for(let start=0;start<segment.length;start+=99){
    const chunk=segment.slice(start,Math.min(start+100,segment.length));
    if(chunk.length<2){out.push(...chunk);continue}
    const path=chunk.map(x=>`${Number(x.lat)},${Number(x.lng)}`).join("|");
    const url=`https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}&interpolate=true&key=${encodeURIComponent(key)}`;
    const res=await fetch(url);
    if(!res.ok)throw new Error(`Roads API HTTP ${res.status}`);
    const data=await res.json();
    if(data.error)throw new Error(data.error.message||"Roads API error");
    const snapped=(data.snappedPoints||[]).map(x=>({lat:Number(x.location?.latitude),lng:Number(x.location?.longitude)}))
      .filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));
    if(snapped.length){
     if(out.length&&out[out.length-1].lat===snapped[0].lat&&out[out.length-1].lng===snapped[0].lng)snapped.shift();
     out.push(...snapped);
    }else out.push(...chunk);
   }
  }
  return out.length?out:src;
 }catch(e){
  console.warn("[EKTA TRACKING] Roads API snap unavailable; using cleaned GPS:",e.message);
  return src;
 }
}

async function snapFleetRowsToRoads(rows){
 const key=googleRoadsApiKey();
 if(!key||!rows?.length)return rows;
 return Promise.all(rows.map(async r=>{
  const snapped=await snapPathToRoads([{lat:r.lat,lng:r.lng}]);
  const p=snapped[0];
  return p?{...r,lat:p.lat,lng:p.lng}:r;
 }));
}

function legacyTruckMarkerIcon(status){
 const colors={RUNNING:"#16a34a",LOADING:"#f59e0b",REPORTING:"#8b5cf6",EMPTY:"#2563eb",PROGRAM:"#64748b"};
 const c=colors[status]||"#2563eb";
 // Compact Indian cargo-truck silhouette: cab + windshield + decorated cargo body + wheels.
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="62" height="44" viewBox="0 0 62 44">
 <defs><filter id="s" x="-25%" y="-35%" width="160%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#10263d" flood-opacity=".32"/></filter></defs>
 <g filter="url(#s)">
  <path d="M31 44l-4.6-6.3h9.2z" fill="${c}"/>
  <rect x="2" y="10" width="36" height="23" rx="3.5" fill="#f7b928" stroke="#163a63" stroke-width="2.2"/>
  <path d="M5 13h30v4H5zM5 20h30v2.4H5zM5 26h30v2.4H5z" fill="#e84b3c"/>
  <path d="M9 7h22l4 5H6z" fill="${c}" stroke="#163a63" stroke-width="1.8"/>
  <circle cx="11" cy="9.7" r="1.3" fill="#fff"/><circle cx="16" cy="9.7" r="1.3" fill="#fff"/><circle cx="21" cy="9.7" r="1.3" fill="#fff"/><circle cx="26" cy="9.7" r="1.3" fill="#fff"/>
  <path d="M38 14h9l11 9.5V33H38z" fill="${c}" stroke="#163a63" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M42 17h4.5l6.6 5.6H42z" fill="#dff4ff" stroke="#fff" stroke-width="1"/>
  <rect x="51.5" y="25" width="6" height="3" rx="1.2" fill="#fff4a8"/>
  <path d="M39.5 29h17" stroke="#f7b928" stroke-width="2"/>
  <circle cx="13" cy="34" r="5.3" fill="#172b3a"/><circle cx="13" cy="34" r="2.1" fill="#dbe5ee"/>
  <circle cx="48" cy="34" r="5.3" fill="#172b3a"/><circle cx="48" cy="34" r="2.1" fill="#dbe5ee"/>
  <text x="20" y="19.2" text-anchor="middle" font-size="4.8" font-family="Arial" font-weight="800" fill="#173653">EKTA</text>
 </g></svg>`;
 return {url:`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,scaledSize:new google.maps.Size(62,44),anchor:new google.maps.Point(31,43)};
}

/* FASTag marker sub-label: only current active trip/program, never an old completed trip. */
function fastagProgramRoute(trip){
 if(!trip)return "";
 const from=clean(trip.loading_point||trip.from_location);
 const to=clean(trip.destination||trip.to_location);
 if(!from||!to)return "";
 const short=s=>s.length>13?s.slice(0,12)+"…":s;
 return `${short(from)} → ${short(to)}`;
}
/* FASTag map presentation only: compact status-coloured trucks + clustering. */
function fastagTruckMarkerIcon(status,vehicleNo="",programRoute=""){
 const colors={RUNNING:"#16a34a",LOADING:"#f59e0b",REPORTING:"#2563eb",EMPTY:"#64748b",PROGRAM:"#7c3aed"};
 const c=colors[clean(status).toUpperCase()]||"#2563eb";
 const no=clean(vehicleNo).toUpperCase();
 const route=clean(programRoute);
 const width=route?Math.max(108,Math.min(190,route.length*6.1+18)):88;
 const center=width/2;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${route?76:58}" viewBox="0 0 ${width} ${route?76:58}">
 <defs><filter id="s" x="-30%" y="-35%" width="170%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#10263d" flood-opacity=".30"/></filter></defs>
 <g filter="url(#s)">
  <rect x="14" y="5" width="43" height="27" rx="4.5" fill="${c}" stroke="#fff" stroke-width="2.4"/>
  <path d="M57 14h10l10 9v9H57z" fill="${c}" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M61 17h5l6 5.3H61z" fill="#eaf6ff"/>
  <rect x="70" y="25" width="6" height="3.2" rx="1.2" fill="#fff3a6"/>
  <circle cx="26" cy="33" r="5.2" fill="#173653" stroke="#fff" stroke-width="1.4"/><circle cx="26" cy="33" r="2" fill="#dce8f3"/>
  <circle cx="65" cy="33" r="5.2" fill="#173653" stroke="#fff" stroke-width="1.4"/><circle cx="65" cy="33" r="2" fill="#dce8f3"/>
  <path d="M40 36l4 5 4-5z" fill="${c}"/>
  <rect x="3" y="41" width="82" height="14" rx="7" fill="#173653" stroke="#fff" stroke-width="1.2"/>
  <text x="44" y="51.2" text-anchor="middle" font-size="10" font-family="Arial" font-weight="900" fill="#fff">${esc(no)}</text>
  ${route?`<rect x="2" y="57" width="${width-4}" height="17" rx="6" fill="#fff" stroke="#173653" stroke-width="1.2"/><text x="${width/2}" y="68.8" text-anchor="middle" font-size="10" font-family="Arial" font-weight="800" fill="#173653">${esc(route)}</text>`:""}
 </g></svg>`;
 return {url:`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,scaledSize:new google.maps.Size(width,route?76:58),anchor:new google.maps.Point(44,41)};
}
// Shared visual design for both Live GPS and FASTag. The GPS point itself stays unchanged.
function truckMarkerIcon(status,vehicleNo="",programRoute=""){
 return fastagTruckMarkerIcon(status,vehicleNo,programRoute);
}
// Only the selected FASTag truck is drawn just ahead of the last toll visit pin.
// This is a screen-pixel visual offset, NOT a fabricated vehicle GPS coordinate.
function fastagSelectedTruckIcon(r){
 const icon=fastagTruckMarkerIcon(r.status,r.t.truck_number,fastagProgramRoute(r.trip));
 return {...icon,anchor:new google.maps.Point(-14,41)};
}
function loadMarkerClusterer(){
 if(window.markerClusterer?.MarkerClusterer)return Promise.resolve(window.markerClusterer.MarkerClusterer);
 if(etMarkerClustererPromise)return etMarkerClustererPromise;
 etMarkerClustererPromise=new Promise((resolve,reject)=>{
  const old=document.getElementById("etGoogleMarkerClusterer");
  if(old){old.addEventListener("load",()=>resolve(window.markerClusterer?.MarkerClusterer),{once:true});old.addEventListener("error",()=>reject(new Error("Marker clustering failed to load.")),{once:true});return}
  const s=document.createElement("script");s.id="etGoogleMarkerClusterer";s.async=true;
  s.src="https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js";
  s.onload=()=>window.markerClusterer?.MarkerClusterer?resolve(window.markerClusterer.MarkerClusterer):reject(new Error("Marker clustering library loaded without MarkerClusterer."));
  s.onerror=()=>reject(new Error("Marker clustering failed to load."));document.head.appendChild(s);
 });
 return etMarkerClustererPromise;
}
function buildFastagClusters(){
 if(etFastagClusterer){etFastagClusterer.clearMarkers();etFastagClusterer=null}
 if(!etFastagMap||!etFastagMarkers.length||!window.markerClusterer?.MarkerClusterer)return;
 const renderer={render:({count,position})=>new google.maps.Marker({position,icon:{path:google.maps.SymbolPath.CIRCLE,scale:20,fillColor:"#173653",fillOpacity:.94,strokeColor:"#fff",strokeWeight:3},label:{text:String(count),color:"#fff",fontSize:"12px",fontWeight:"800"},zIndex:Number(google.maps.Marker.MAX_ZINDEX)+count})};
 etFastagClusterer=new window.markerClusterer.MarkerClusterer({
  map:etFastagMap,markers:etFastagMarkers,renderer,
  algorithmOptions:{maxZoom:7,radius:70}
 });
}

function loadGoogleMapsAPI(){
 if(window.google?.maps)return Promise.resolve(window.google.maps);
 if(etGoogleMapsPromise)return etGoogleMapsPromise;
 const key=googleMapsApiKey();
 if(!key)return Promise.reject(new Error("Google Maps API key is not configured."));
 etGoogleMapsPromise=new Promise((resolve,reject)=>{
  const old=document.getElementById("etGoogleMapsJsApi");
  if(old){old.addEventListener("load",()=>resolve(window.google.maps),{once:true});old.addEventListener("error",()=>reject(new Error("Google Maps JavaScript API failed to load.")),{once:true});return}
  const s=document.createElement("script");
  s.id="etGoogleMapsJsApi";s.async=true;s.defer=true;
  s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
  s.onload=()=>window.google?.maps?resolve(window.google.maps):reject(new Error("Google Maps API loaded without maps object."));
  s.onerror=()=>reject(new Error("Google Maps JavaScript API failed to load."));
  document.head.appendChild(s);
 });
 return etGoogleMapsPromise;
}
function showMapApiNote(message){
 const c=$("etFleetMapCanvas");if(!c)return;
 c.innerHTML=`<div class="et-map-api-note"><b>Google Maps setup required</b><br>${esc(message)}<br><br>Set <code>window.EKTA_GOOGLE_MAPS_API_KEY</code> before <code>tracking.js</code> loads. Use a key restricted to your website and Maps JavaScript API.</div>`;
}
function fleetRowsWithGPS(){
 return trucks.map(t=>{
  const trip=activeTrip(t.id),loc=latestLocation(t.id),d=activeDriver(t.id),p=trip?party(trip.party_id):null;
  const lat=Number(loc?.latitude),lng=Number(loc?.longitude);
  return {t,trip,loc,d,p,status:statusOf(trip),lat,lng,hasGPS:Number.isFinite(lat)&&Number.isFinite(lng)&&!(lat===0&&lng===0)};
 }).filter(x=>x.hasGPS);
}
function fleetHistoryWindow(range=etFleetHistoryRange){
 const now=new Date(), end=new Date(now), start=new Date(now);
 const r=clean(range).toUpperCase();
 if(r==="TODAY"){start.setHours(0,0,0,0);}
 else if(r==="YESTERDAY"){start.setDate(start.getDate()-1);start.setHours(0,0,0,0);end.setDate(end.getDate()-1);end.setHours(23,59,59,999);}
 else if(r==="LAST7"||r==="LAST7H"||r==="7H"){start.setHours(start.getHours()-7);}
 else if(r==="LAST7D"||r==="7DAYS"||r==="7D"){start.setDate(start.getDate()-7);}
 else if(r==="CUSTOM"&&etFleetHistoryCustomStart&&etFleetHistoryCustomEnd){return {start:new Date(etFleetHistoryCustomStart),end:new Date(etFleetHistoryCustomEnd)};}
 else {start.setHours(start.getHours()-24);}
 return {start,end};
}
function gpsTrailForTruck(t,range=etFleetHistoryRange){
 const vehicle=clean(t?.truck_number).toUpperCase(),w=fleetHistoryWindow(range);
 return (gpsLocations||[]).filter(x=>clean(x.vehicle_number).toUpperCase()===vehicle)
  .map(x=>({lat:Number(x.latitude),lng:Number(x.longitude),time:x.recorded_at||x.created_at,location:clean(x.location||x.address)}))
  .filter(x=>{const tm=new Date(x.time||0);return Number.isFinite(x.lat)&&Number.isFinite(x.lng)&&!(x.lat===0&&x.lng===0)&&!isNaN(tm)&&tm>=w.start&&tm<=w.end})
  .sort((a,b)=>new Date(a.time||0)-new Date(b.time||0));
}
function gpsPointDistanceM(a,b){
 const R=6371000,toRad=x=>x*Math.PI/180;
 const dLat=toRad(Number(b.lat)-Number(a.lat)),dLng=toRad(Number(b.lng)-Number(a.lng));
 const la1=toRad(Number(a.lat)),la2=toRad(Number(b.lat));
 const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function cleanGpsTrail(points){
 const src=(points||[]).filter(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))&&!(Number(p.lat)===0&&Number(p.lng)===0))
  .sort((a,b)=>new Date(a.time||0)-new Date(b.time||0));
 const out=[];
 for(const p of src){
  const q={...p,lat:Number(p.lat),lng:Number(p.lng)};
  const prev=out[out.length-1];
  if(!prev){out.push(q);continue}
  const dt=Math.max(0,(new Date(q.time||0)-new Date(prev.time||0))/1000);
  const dist=gpsPointDistanceM(prev,q);
  if(dist<4 && dt<120)continue; // stationary GPS noise / duplicate sample
  if(dt>0 && dist/dt>55.6)continue; // >200 km/h: reject obvious GPS jump
  out.push(q);
 }
 return out;
}
async function fetchGpsTrailForTruck(t,range=etFleetHistoryRange){
 const vehicle=clean(t?.truck_number).toUpperCase(),w=fleetHistoryWindow(range);
 if(!vehicle||!dbOK())return cleanGpsTrail(gpsTrailForTruck(t,range));
 try{
  // Page through gps_locations so 7-day / 15-second history is not silently cut at one query limit.
  const pageSize=1000,maxPoints=50000,all=[];
  for(let from=0;from<maxPoints;from+=pageSize){
   const r=await S.from(T.gps)
    .select("vehicle_number,latitude,longitude,recorded_at")
    .eq("vehicle_number",vehicle)
    .gte("recorded_at",w.start.toISOString())
    .lte("recorded_at",w.end.toISOString())
    .order("recorded_at",{ascending:true})
    .range(from,from+pageSize-1);
   if(r.error)throw r.error;
   const batch=r.data||[]; all.push(...batch);
   if(batch.length<pageSize)break;
  }
  return cleanGpsTrail(all.map(x=>({lat:Number(x.latitude),lng:Number(x.longitude),time:x.recorded_at,location:""})));
 }catch(e){
  console.warn("[EKTA TRACKING] Direct GPS history fetch failed; using loaded GPS:",e.message);
  return cleanGpsTrail(gpsTrailForTruck(t,range));
 }
}
async function fetchLatestGpsPointForTruck(t){
 const vehicle=clean(t?.truck_number).toUpperCase();
 if(!vehicle)return null;
 if(dbOK()){
  try{
   const r=await S.from(T.gps)
    .select("vehicle_number,latitude,longitude,recorded_at")
    .eq("vehicle_number",vehicle)
    .order("recorded_at",{ascending:false})
    .limit(1);
   if(r.error)throw r.error;
   const x=(r.data||[])[0];
   if(x){
    const lat=Number(x.latitude),lng=Number(x.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&!(lat===0&&lng===0))return {lat,lng,time:x.recorded_at};
   }
  }catch(e){console.warn("[EKTA TRACKING] Latest GPS fetch failed; using loaded latest location:",e.message)}
 }
 const l=latestLocation(t.id),lat=Number(l?.latitude),lng=Number(l?.longitude);
 return Number.isFinite(lat)&&Number.isFinite(lng)&&!(lat===0&&lng===0)?{lat,lng,time:l?.recorded_at||l?.timestamp||l?.created_at}:null;
}
function setFleetHistoryRange(range,start=null,end=null){
 etFleetHistoryRange=clean(range).toUpperCase()||"LAST24";
 const custom=$("etFleetCustomRange");
 if(custom)custom.style.display=etFleetHistoryRange==="CUSTOM"?"flex":"none";
 if(etFleetHistoryRange==="CUSTOM"){
  etFleetHistoryCustomStart=start||etFleetHistoryCustomStart;
  etFleetHistoryCustomEnd=end||etFleetHistoryCustomEnd;
  if(!etFleetHistoryCustomStart||!etFleetHistoryCustomEnd)return;
 }
 updateFleetHistoryWindowText();
 if(selectedMap?.t)focusFleetRoute(selectedMap.t.id);
}
function updateFleetHistoryWindowText(){
 const el=$("etFleetHistoryWindowText");if(!el)return;
 const w=fleetHistoryWindow(etFleetHistoryRange);
 const labels={TODAY:"Today",YESTERDAY:"Yesterday","7H":"Last 7 Hours","24H":"Last 24 Hours","7D":"Last 7 Days",CUSTOM:"Custom"};
 el.textContent=`${labels[etFleetHistoryRange]||"Last 24 Hours"} • ${fmtDT(w.start)} → ${fmtDT(w.end)}`;
}
function applyFleetCustomHistory(){
 const a=$("etFleetCustomFrom")?.value,b=$("etFleetCustomTo")?.value;
 if(!a||!b)return alertUser("Select both From and To date/time.");
 const start=new Date(a),end=new Date(b);
 if(isNaN(start)||isNaN(end)||start>=end)return alertUser("Custom date/time range is not valid.");
 etFleetHistoryCustomStart=start;etFleetHistoryCustomEnd=end;etFleetHistoryRange="CUSTOM";
 updateFleetHistoryWindowText();
 if(selectedMap?.t)focusFleetRoute(selectedMap.t.id);
}
function showAllFleetVehicles(){
 selectedMap=null;
 if(etFleetTrail){Array.isArray(etFleetTrail)?etFleetTrail.forEach(x=>x?.setMap?.(null)):etFleetTrail.setMap(null);etFleetTrail=null}
 clearFleetRouteMarkers();etFleetMarkers.forEach(m=>m.setVisible(true));
 $("etFleetMapCard")?.classList.remove("show");
 if($("etFleetHistoryMeta"))$("etFleetHistoryMeta").textContent="Select a vehicle to view its road history";
 renderFleetVehicleList();
 const rows=fleetRowsWithGPS();
 if(etFleetMap&&rows.length){const b=new google.maps.LatLngBounds();rows.forEach(r=>b.extend({lat:r.lat,lng:r.lng}));rows.length===1?(etFleetMap.panTo({lat:rows[0].lat,lng:rows[0].lng}),etFleetMap.setZoom(11)):etFleetMap.fitBounds(b,55);}
}
function clearFleetRouteMarkers(){etFleetRouteMarkers.forEach(m=>m.setMap(null));etFleetRouteMarkers=[]}
function routeEndpointIcon(label,fill){
 return {path:google.maps.SymbolPath.CIRCLE,scale:10,fillColor:fill,fillOpacity:1,strokeColor:"#fff",strokeWeight:3,labelOrigin:new google.maps.Point(0,0)};
}
function fleetOldLocation(r){
 const pts=gpsTrailForTruck(r.t);if(pts.length<2)return null;
 const cur=pts[pts.length-1];for(let i=pts.length-2;i>=0;i--){if(pts[i].lat!==cur.lat||pts[i].lng!==cur.lng)return pts[i]}
 return pts.length>1?pts[pts.length-2]:null;
}
function fleetPlace(x,fallback){return clean(x?.location||x?.address||fallback)||"—"}
function fleetInfoHtml(r){
 const old=fleetOldLocation(r),last=r.loc?.recorded_at||r.loc?.timestamp||r.loc?.created_at;
 return `<div class="et-map-info"><b>${esc(r.t.truck_number||"Truck")}</b> • ${esc(r.status)}<br><span>Old: ${esc(fleetPlace(old,"—"))}</span><br><span>Current: ${esc(fleetPlace(r.loc,r.trip?.current_location||"Live GPS"))}</span><br><span class="muted">Driver: ${esc(r.d?.name||"—")} • Party: ${esc(r.p?.name||"—")}<br>Last GPS: ${esc(fmtDT(last))}</span></div>`;
}
function fleetStatusCounts(rows){const o={ALL:rows.length,RUNNING:0,LOADING:0,REPORTING:0,EMPTY:0};rows.forEach(r=>{if(o[r.status]!=null)o[r.status]++});return o}
function setFleetFilter(v){etFleetFilter=v||"ALL";renderFleetVehicleList();renderFleetTabs()}
function renderFleetTabs(){
 const box=$("etFleetTabs");if(!box)return;const rows=fleetRowsWithGPS(),c=fleetStatusCounts(rows);
 box.innerHTML=["ALL","RUNNING","LOADING","REPORTING","EMPTY"].map(k=>`<button class="et-fleet-tab ${etFleetFilter===k?"active":""}" onclick="window.EktaTracking.setFleetFilter('${k}')">${k==="ALL"?"All":k[0]+k.slice(1).toLowerCase()} (${c[k]||0})</button>`).join("");
}
function fleetFilteredRows(){
 const q=clean($("etFleetSearch")?.value).toLowerCase();
 return fleetRowsWithGPS().filter(r=>etFleetFilter==="ALL"||r.status===etFleetFilter).filter(r=>!q||[r.t?.truck_number,r.status,r.loc?.location,r.loc?.address,r.trip?.current_location,r.trip?.destination].join(" ").toLowerCase().includes(q));
}
function renderFleetVehicleList(){
 const box=$("etFleetVehicleList");if(!box)return;const rows=fleetFilteredRows();
 if($("etFleetCount"))$("etFleetCount").textContent=`${rows.length} vehicle${rows.length===1?"":"s"}`;
 box.innerHTML=rows.length?rows.map(r=>{const old=fleetOldLocation(r),curTime=r.loc?.recorded_at||r.loc?.timestamp||r.loc?.created_at;return `<div class="et-fleet-row ${String(selectedMap?.t?.id)===String(r.t.id)?"selected":""}" onclick="window.EktaTracking.selectFleetVehicle('${esc(r.t.id)}')"><div class="et-fleet-veh">🚚 ${esc(r.t.truck_number||"—")}</div><div><span class="et-fleet-pill ${esc(r.status)}">${esc(r.status)}</span></div><div class="et-fleet-cell">${esc(fleetPlace(old,"—"))}<span class="et-fleet-time">${esc(fmtDT(old?.time))}</span></div><div class="et-fleet-cell">${esc(fleetPlace(r.loc,r.trip?.current_location||"—"))}<span class="et-fleet-time">${esc(fmtDT(curTime))}</span></div></div>`}).join(""):`<div class="et-fleet-empty">No live GPS vehicles in this view.</div>`;
}
function showFleetCard(r){
 const box=$("etFleetMapCard");if(!box)return;const old=fleetOldLocation(r),curTime=r.loc?.recorded_at||r.loc?.timestamp||r.loc?.created_at;
 box.innerHTML=`<div class="et-fleet-card-top"><b>🚚 ${esc(r.t.truck_number||"Truck")} • ${esc(r.status)}</b><button class="et-fleet-card-x" onclick="event.stopPropagation();document.getElementById('etFleetMapCard').classList.remove('show')">×</button></div><div class="et-fleet-card-grid"><div>Driver<b>${esc(r.d?.name||"—")}</b></div><div>Party<b>${esc(r.p?.name||"—")}</b></div><div>Old Location<b>${esc(fleetPlace(old,"—"))}</b></div><div>Current Location<b>${esc(fleetPlace(r.loc,r.trip?.current_location||"—"))}</b></div><div>Old Time<b>${esc(fmtDT(old?.time))}</b></div><div>Current Time<b>${esc(fmtDT(curTime))}</b></div></div><div class="et-fleet-card-actions"><button class="primary" onclick="window.EktaTracking.focusFleetRoute('${esc(r.t.id)}')">View Route</button><button onclick="window.EktaTracking.fleetViewStreet()">Street View</button><button onclick="window.EktaTracking.openSelectedInGoogleMaps()">Open in Maps ↗</button></div>`;
 box.classList.add("show");
}
function clearFleetMapObjects(){etFleetMarkers.forEach(m=>m.setMap(null));etFleetMarkers=[];clearFleetRouteMarkers();if(etFleetTrail){Array.isArray(etFleetTrail)?etFleetTrail.forEach(x=>x?.setMap?.(null)):etFleetTrail.setMap(null);etFleetTrail=null}if(etFleetInfo){etFleetInfo.close();etFleetInfo=null}}
async function drawTruckTrail(r){
 if(!etFleetMap||!window.google?.maps)return;
 if(etFleetTrail){
  if(Array.isArray(etFleetTrail))etFleetTrail.forEach(x=>x?.setMap?.(null));
  else etFleetTrail.setMap(null);
  etFleetTrail=null;
 }
 clearFleetRouteMarkers();
 etFleetMarkers.forEach(m=>m.setVisible(false));
 fleetViewRoad();
 const raw=await fetchGpsTrailForTruck(r.t,etFleetHistoryRange),w=fleetHistoryWindow(etFleetHistoryRange);
 updateFleetHistoryWindowText();
 if($("etFleetHistoryMeta"))$("etFleetHistoryMeta").textContent=`${r.t.truck_number||"Truck"} • ${fmtDT(w.start)} → ${fmtDT(w.end)} • ${raw.length} clean GPS points`;
 if(raw.length<2){
  alertUser(`Selected time range has ${raw.length} usable GPS point${raw.length===1?"":"s"} for ${r.t.truck_number||"this vehicle"}.`);
  return;
 }
 const snapped=await snapPathToRoads(raw),pts=snapped.length>=2?snapped:raw;
 const path=pts.map(x=>({lat:x.lat,lng:x.lng}));
 // Google-navigation style: dark casing under a bright solid route.
 const casing=new google.maps.Polyline({path,geodesic:false,strokeColor:"#ffffff",strokeOpacity:.98,strokeWeight:9,map:etFleetMap,zIndex:18});
 const route=new google.maps.Polyline({path,geodesic:false,strokeColor:"#5b4ee8",strokeOpacity:.96,strokeWeight:6,map:etFleetMap,zIndex:20});
 etFleetTrail=[casing,route];
 const startPt=raw[0],endPt=raw[raw.length-1];
 etFleetRouteMarkers.push(new google.maps.Marker({
  position:{lat:startPt.lat,lng:startPt.lng},map:etFleetMap,
  label:{text:"S",color:"#fff",fontWeight:"800"},icon:routeEndpointIcon("S","#0b8f55"),
  title:`Start • ${fmtDT(startPt.time)}`,zIndex:70
 }));
 // IMPORTANT: the truck marker is ALWAYS the vehicle's newest GPS row from the database.
 // Never label the last point of a selected history window as the current location.
 const latestGps=await fetchLatestGpsPointForTruck(r.t);
 const currentPt=latestGps||endPt;
 const liveTruck=new google.maps.Marker({
  position:{lat:currentPt.lat,lng:currentPt.lng},map:etFleetMap,icon:truckMarkerIcon(r.status,r.t.truck_number,fastagProgramRoute(r.trip)),
  title:`${r.t.truck_number||"Truck"} • Current • ${fmtDT(currentPt.time)}`,zIndex:90
 });
 liveTruck.__truckId=r.t.id; etFleetRouteMarkers.push(liveTruck);
 const b=new google.maps.LatLngBounds();path.forEach(x=>b.extend(x));b.extend({lat:startPt.lat,lng:startPt.lng});
 // For live ranges, keep the real current truck visible. Historical ranges keep their own route framing.
 const rr=clean(etFleetHistoryRange).toUpperCase();
 if(rr!=="YESTERDAY"&&rr!=="CUSTOM")b.extend({lat:currentPt.lat,lng:currentPt.lng});
 etFleetMap.fitBounds(b,70);
 google.maps.event.addListenerOnce(etFleetMap,"idle",()=>{if(etFleetMap&&etFleetMap.getZoom()>12)etFleetMap.setZoom(12)});
}

function selectFleetVehicle(truckId){
 const r=fleetRowsWithGPS().find(x=>String(x.t.id)===String(truckId));if(!r)return;
 selectMap({t:r.t,trip:r.trip,d:r.d,p:r.p,loc:r.loc,status:r.status,truckZone:truckZone(r.trip,r.loc)});showFleetCard(r);renderFleetVehicleList();
 // Selected-vehicle mode: hide all other truck markers.
 etFleetMarkers.forEach(m=>m.setVisible(!m.__truckId||String(m.__truckId)===String(truckId)));
 if(etFleetMap){etFleetMap.panTo({lat:r.lat,lng:r.lng});if(etFleetMap.getZoom()>11||etFleetMap.getZoom()<8)etFleetMap.setZoom(10)}
}
function focusFleetRoute(truckId){const r=fleetRowsWithGPS().find(x=>String(x.t.id)===String(truckId));if(r){selectFleetVehicle(truckId);drawTruckTrail(r)}}

function fleetViewRoad(){
 if(!etFleetMap)return;
 etFleetMap.getStreetView()?.setVisible(false);
 etFleetMap.setMapTypeId("roadmap");
}
function fleetViewSatellite(){
 if(!etFleetMap)return;
 etFleetMap.getStreetView()?.setVisible(false);
 etFleetMap.setMapTypeId("hybrid");
}
function fleetViewStreet(){
 if(!etFleetMap||!window.google?.maps)return;
 let pos=null;
 if(selectedMap?.t){
  const r=fleetRowsWithGPS().find(x=>String(x.t.id)===String(selectedMap.t.id));
  if(r)pos={lat:r.lat,lng:r.lng};
 }
 if(!pos)pos=etFleetMap.getCenter();
 const openPanorama=(data)=>{
  const sv=etFleetMap.getStreetView();
  sv.setPosition(data.location.latLng);
  sv.setPov({heading:0,pitch:0});
  sv.setVisible(true);
 };
 const svc=new google.maps.StreetViewService();
 svc.getPanorama({location:pos,radius:250,preference:google.maps.StreetViewPreference.NEAREST},(data,status)=>{
  if(status===google.maps.StreetViewStatus.OK)return openPanorama(data);
  svc.getPanorama({location:pos,radius:1500,preference:google.maps.StreetViewPreference.NEAREST},(data2,status2)=>{
   if(status2===google.maps.StreetViewStatus.OK)return openPanorama(data2);
   alertUser("Street View imagery is not available near this location.");
  });
 });
}

async function renderFleetMap(){
 const c=$("etFleetMapCanvas");if(!c)return;
 try{
  await loadGoogleMapsAPI();c.innerHTML="";const rows=await snapFleetRowsToRoads(fleetRowsWithGPS());const center=rows[0]?{lat:rows[0].lat,lng:rows[0].lng}:{lat:28.6139,lng:77.2090};
  const INDIA_BOUNDS={north:37.6,south:6.4,west:68.0,east:97.5};
  const ROAD_FOCUS_STYLE=[
   {featureType:"poi",stylers:[{visibility:"off"}]},
   {featureType:"transit",stylers:[{visibility:"off"}]},
   {featureType:"landscape",elementType:"labels",stylers:[{visibility:"off"}]},
   {featureType:"road.highway",elementType:"geometry",stylers:[{visibility:"on"}]},
   {featureType:"road.highway",elementType:"labels",stylers:[{visibility:"on"}]},
   {featureType:"road.arterial",elementType:"labels",stylers:[{visibility:"on"}]},
   {featureType:"road.local",elementType:"labels",stylers:[{visibility:"simplified"}]},
   {featureType:"administrative.province",elementType:"labels",stylers:[{visibility:"on"}]}
  ];
  etFleetMap=new google.maps.Map(c,{center:{lat:22.8,lng:79.0},zoom:5,minZoom:5,maxZoom:16,restriction:{latLngBounds:INDIA_BOUNDS,strictBounds:false},mapTypeId:"roadmap",styles:ROAD_FOCUS_STYLE,mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:"greedy"});clearFleetMapObjects();const bounds=new google.maps.LatLngBounds();
  rows.forEach(r=>{const pos={lat:r.lat,lng:r.lng};bounds.extend(pos);const marker=new google.maps.Marker({position:pos,map:etFleetMap,title:r.t.truck_number||"Truck",icon:truckMarkerIcon(r.status,r.t.truck_number,fastagProgramRoute(r.trip))});marker.__truckId=r.t.id;marker.addListener("click",()=>{selectFleetVehicle(r.t.id)});etFleetMarkers.push(marker)});
  if(rows.length===1)etFleetMap.setZoom(11);else if(rows.length>1)etFleetMap.fitBounds(bounds,55);renderFleetTabs();renderFleetVehicleList();updateFleetHistoryWindowText();
  if(selectedMap?.t){const sr=rows.find(x=>String(x.t.id)===String(selectedMap.t.id));if(sr)showFleetCard(sr)}
  if(!rows.length)new google.maps.InfoWindow({content:"No valid live GPS coordinates are available yet.",position:center}).open({map:etFleetMap});
 }catch(e){console.error("[EKTA TRACKING] Fleet map failed:",e);showMapApiNote(e.message||"Google Maps could not be loaded.")}
}
function openFleetMap(){const p=$("etFleetMapPage");if(!p)return;p.classList.add("show");p.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";renderFleetMap()}
function closeFleetMap(){const p=$("etFleetMapPage");if(!p)return;p.classList.remove("show");p.setAttribute("aria-hidden","true")}
async function refreshFleetMap(){await loadAll();if($("etFleetMapPage")?.classList.contains("show"))renderFleetMap()}

/* ========================= 14B. FASTag LOCATION MAP =========================
   FASTag is used only as a location source. The query reads vehicle number,
   latitude/longitude and crossing time only to identify the newest coordinate.
   No amount, balance, fare, wallet or other financial FASTag field is loaded.
============================================================================ */
function waitFastag(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function reverseFastagLocation(lat,lng){
 const key=`${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
 if(etFastagGeoCache.has(key))return etFastagGeoCache.get(key);
 const fallback={place:"Nearby location",district:"—",state:"—",label:"Location unavailable"};
 let lastError="";
 for(let attempt=0;attempt<4;attempt++){
  try{
   const results=await googleGeocodePoint(lat,lng);
   const a=googleAddressParts(results);
   const place=a.place||a.district||a.formatted||"Nearby location";
   const out={place,district:a.district||"—",state:a.state||"—",label:[place,a.district,a.state].filter(Boolean).join(", ")};
   etFastagGeoCache.set(key,out);
   return out;
  }catch(e){
   lastError=String(e?.message||e||"GEOCODER_FAILED");
   if(!/OVER_QUERY_LIMIT|UNKNOWN_ERROR/i.test(lastError))break;
   await waitFastag(400*(attempt+1));
  }
 }
 console.warn("[EKTA TRACKING] Google FASTag reverse geocode unavailable:",lastError);
 return fallback;
}
function fastagTime(v){if(!v)return "—";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
async function loadLatestFastagLocations(){
 const jobs=(trucks||[]).map(async t=>{
  const vehicle=clean(t?.truck_number).toUpperCase();if(!vehicle)return null;
  try{
   const r=await S.from("fastag_transactions")
    .select("vehicle_no,latitude,longitude,toll_txn_date_time")
    .eq("vehicle_no",vehicle).not("latitude","is",null).not("longitude","is",null)
    .order("toll_txn_date_time",{ascending:false}).limit(1);
   if(r.error)throw r.error;const x=(r.data||[])[0];if(!x)return null;
   const lat=Number(x.latitude),lng=Number(x.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||(lat===0&&lng===0))return null;
   const d=activeDriver(t.id),trip=activeTrip(t.id);
   return {t,d,trip,status:statusOf(trip),lat,lng,time:x.toll_txn_date_time,geo:null};
  }catch(e){console.warn("[EKTA TRACKING] FASTag latest location failed for",vehicle,e.message);return null}
 });
 etFastagRows=(await Promise.all(jobs)).filter(Boolean);
 let next=0;
 const workers=Array.from({length:4},async()=>{
  while(next<etFastagRows.length){
   const i=next++,row=etFastagRows[i];
   row.geo=await reverseFastagLocation(row.lat,row.lng);
   if(i%4===0)await waitFastag(80);
  }
 });
 await Promise.all(workers);
 return etFastagRows;
}
let etFastagRange="7D",etFastagCustomStart=null,etFastagCustomEnd=null,etFastagSelectedId=null,etFastagHistoryToken=0,etFastagRoadLines=[];
function fastagWindow(){
 const now=new Date(),end=new Date(now),start=new Date(now);
 if(etFastagRange==="CUSTOM"&&etFastagCustomStart&&etFastagCustomEnd)return {start:new Date(etFastagCustomStart),end:new Date(etFastagCustomEnd)};
 if(etFastagRange==="TODAY"){start.setHours(0,0,0,0)}
 else if(etFastagRange==="YESTERDAY"){start.setDate(start.getDate()-1);start.setHours(0,0,0,0);end.setHours(0,0,0,0)}
 else if(etFastagRange==="7H")start.setHours(start.getHours()-7);
 else if(etFastagRange==="24H")start.setHours(start.getHours()-24);
 else start.setDate(start.getDate()-7);
 return {start,end};
}
function fastagRangeUI(){
 document.querySelectorAll('#etFastagHistoryBar [data-fastag-range]').forEach(b=>b.classList.toggle('active',b.dataset.fastagRange===etFastagRange));
 $("etFastagCustomRange")?.classList.toggle('show',etFastagRange==="CUSTOM");
}
function setFastagHistoryRange(range){
 etFastagRange=range;fastagRangeUI();
 if(range==="CUSTOM")return;
 if(etFastagSelectedId)selectFastagVehicle(etFastagSelectedId);
}
function applyFastagCustomHistory(){
 const a=$("etFastagFrom")?.value,b=$("etFastagTo")?.value;
 const start=new Date(a),end=new Date(b);
 if(!a||!b||isNaN(start)||isNaN(end)||start>=end)return alertUser("Select a valid From and To date/time.");
 etFastagCustomStart=start;etFastagCustomEnd=end;etFastagRange="CUSTOM";fastagRangeUI();
 if(etFastagSelectedId)selectFastagVehicle(etFastagSelectedId);
}
async function loadFastagHistory(vehicle){
 try{
  const {start,end}=fastagWindow();
  const all=[];let from=0;const pageSize=750;
  while(from<15000){
   const res=await S.from("fastag_transactions").select("vehicle_no,latitude,longitude,toll_txn_date_time")
    .eq("vehicle_no",clean(vehicle).toUpperCase()).not("latitude","is",null).not("longitude","is",null)
    .gte("toll_txn_date_time",start.toISOString()).lte("toll_txn_date_time",end.toISOString())
    .order("toll_txn_date_time",{ascending:true}).range(from,from+pageSize-1);
   if(res.error)throw res.error;
   const batch=res.data||[];all.push(...batch);if(batch.length<pageSize)break;from+=pageSize;
  }
  const rows=all.map(x=>({...x,lat:Number(x.latitude),lng:Number(x.longitude)}))
   .filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng)&&!(x.lat===0&&x.lng===0));
  // Reverse geocode only distinct places, with bounded concurrency to avoid quota bursts.
  const unique=new Map();for(const x of rows){const k=`${x.lat.toFixed(4)},${x.lng.toFixed(4)}`;if(!unique.has(k))unique.set(k,x)}
  const items=[...unique.entries()];let next=0;
  await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{while(next<items.length){const [key,x]=items[next++];x.geo=await reverseFastagLocation(x.lat,x.lng);}}));
  for(const x of rows)x.geo=unique.get(`${x.lat.toFixed(4)},${x.lng.toFixed(4)}`)?.geo||null;
  return rows;
 }catch(e){console.warn("[EKTA TRACKING] FASTag history failed",e);throw e}
}
function clearFastagHistory(){etFastagRoadLines.forEach(x=>x.setMap(null));etFastagRoadLines=[];etFastagHistoryMarkers.forEach(m=>m.setMap(null));etFastagHistoryMarkers=[];if(etFastagHistoryLine){etFastagHistoryLine.setMap(null);etFastagHistoryLine=null}if(etFastagDirectionsRenderer){etFastagDirectionsRenderer.setMap(null);etFastagDirectionsRenderer=null}}
function clearFastagMapObjects(){clearFastagHistory();if(etFastagClusterer){etFastagClusterer.clearMarkers();etFastagClusterer=null}etFastagMarkers.forEach(m=>m.setMap(null));etFastagMarkers=[];if(etFastagInfo){etFastagInfo.close();etFastagInfo=null}}
function fastagLocationHtml(r){const g=r.geo||{};return `<b>${esc(g.place||"—")}</b><br><span>${esc(g.district||"—")}, ${esc(g.state||"—")}</span><br><span class="muted">${esc(fastagTime(r.time))}</span>`}
function fastagInfoHtml(r){return `<div class="et-map-info"><b>${esc(r.t?.truck_number||"Truck")}</b> • ${esc(r.status||"—")}<br><span>Driver: ${esc(r.d?.name||"—")}</span><br><span>Phone: ${esc(r.d?.phone||"—")}</span><br><span>FASTag Last Location:</span><br>${fastagLocationHtml(r)}</div>`}
function showFastagCard(r,history=[]){
 const c=$("etFastagMapCard");if(!c)return;
 const list=history.map((x,i)=>`<button class="et-fastag-visit" onclick="window.EktaTracking.focusFastagVisit(${i})"><span class="et-fastag-visit-num">${i+1}</span><span><b>${esc(x.geo?.place||x.geo?.district||"Toll location")}</b><small>${esc(fastagTime(x.toll_txn_date_time))}</small></span></button>`).join("");
 c.innerHTML=`<div class="et-fleet-card-top"><b>🚚 ${esc(r.t?.truck_number||"—")}</b><button class="et-fleet-card-x" onclick="document.getElementById('etFastagMapCard').classList.remove('show')">×</button></div><div class="et-fleet-card-grid"><div>Status<b>${esc(r.status||"—")}</b></div><div>Driver<b>${esc(r.d?.name||"—")}</b></div><div>Phone<b>${esc(r.d?.phone||"—")}</b></div><div>FASTag Last Location<b>${esc(r.geo?.place||"—")}</b><span>${esc(r.geo?.district||"—")}, ${esc(r.geo?.state||"—")}</span></div></div><div class="et-fastag-timeline"><b>${history.length} toll crossing${history.length===1?"":"s"} • chronological order</b>${list||'<div class="muted" style="padding:10px">No toll crossing in this date range.</div>'}</div>`;
 c.classList.add("show");
}
let etFastagVisibleHistory=[];
function focusFastagVisit(index){
 const x=etFastagVisibleHistory[index];if(!x||!etFastagMap)return;
 const m=etFastagHistoryMarkers.find(m=>m.__visits?.includes(index));
 etFastagMap.panTo(m?.getPosition()||{lat:x.lat,lng:x.lng});etFastagMap.setZoom(Math.max(etFastagMap.getZoom()||10,13));
 if(m){if(etFastagInfo)etFastagInfo.close();etFastagInfo=new google.maps.InfoWindow({content:`<b>Visit ${index+1}</b><br>${esc(x.geo?.place||"Toll crossing")}<br>${esc(fastagTime(x.toll_txn_date_time))}`});etFastagInfo.open({map:etFastagMap,anchor:m})}
}

/* FASTag road geometry is requested through an authenticated Supabase Edge Function.
   The Google Routes key stays server-side; existing Maps/Roads keys remain unchanged. */
async function fastagComputeRoadRoute(origin,destination,intermediates=[]){
 if(!S?.functions?.invoke)throw new Error('Supabase Edge Functions client unavailable');
 const points=[origin,...intermediates,destination].map(p=>({lat:Number(p.lat),lng:Number(p.lng)}));
 const {data,error}=await S.functions.invoke('fastag-route',{body:{points}});
 if(error){
  let detail=error.message||'Edge Function request failed';
  try{const payload=await error.context?.json?.();detail=payload?.error||detail}catch(_){}
  throw new Error(detail);
 }
 if(!data?.encoded||!Number.isFinite(Number(data.km)))throw new Error(data?.error||'No road geometry returned');
 return {km:Number(data.km),encoded:data.encoded};
}
function fastagDecodePolyline(encoded){
 const points=[];let index=0,lat=0,lng=0;
 while(index<encoded.length){
  const values=[];
  for(let j=0;j<2;j++){
   let result=0,shift=0,b;
   do{if(index>=encoded.length)throw new Error('Invalid route polyline');b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5}while(b>=32);
   values.push((result&1)?~(result>>1):(result>>1));
  }
  lat+=values[0];lng+=values[1];points.push({lat:lat/1e5,lng:lng/1e5});
 }
 return points;
}
let etFastagListFilter="ALL";
function setFastagListFilter(filter){
 const valid=["ALL","RUNNING","LOADING","REPORTING","EMPTY","ACTIVE_TRIP"];
 etFastagListFilter=valid.includes(filter)?filter:"ALL";
 renderFastagVehicleList();
}
function renderFastagVehicleList(){
 const box=$("etFastagVehicleList");if(!box)return;const q=clean($("etFastagSearch")?.value).toLowerCase();
 const all=etFastagRows||[];
 const tabs=$("etFastagTabs");
 if(tabs){
  const options=[["ALL","All"],["RUNNING","Running"],["LOADING","Loading"],["REPORTING","Reporting"],["EMPTY","Empty"],["ACTIVE_TRIP","Active Trip"]];
  tabs.innerHTML=options.map(([key,label])=>{
   const count=all.filter(r=>key==="ALL"||(key==="ACTIVE_TRIP"?Boolean(r.trip):String(r.status||"").toUpperCase()===key)).length;
   return `<button type="button" class="${etFastagListFilter===key?"active":""}" aria-pressed="${etFastagListFilter===key}" onclick="window.EktaTracking.setFastagListFilter('${key}')">${label} (${count})</button>`;
  }).join("");
 }
 const rows=all.filter(r=>(etFastagListFilter==="ALL"||(etFastagListFilter==="ACTIVE_TRIP"?Boolean(r.trip):String(r.status||"").toUpperCase()===etFastagListFilter))&&(!q||[r.t?.truck_number,r.d?.name,r.d?.phone,r.status,r.geo?.place,r.geo?.district,r.geo?.state,r.trip?.loading_point,r.trip?.from_location,r.trip?.destination,r.trip?.to_location].join(" ").toLowerCase().includes(q)));
 if($("etFastagCount"))$("etFastagCount").textContent=`${rows.length} vehicle${rows.length===1?"":"s"}`;
 box.innerHTML=rows.length?rows.map(r=>`<div class="et-fleet-row" style="grid-template-columns:.90fr .62fr .76fr .80fr 1.35fr 1.25fr" onclick="window.EktaTracking.selectFastagVehicle('${esc(r.t.id)}')"><div class="et-fleet-veh">🚚 ${esc(r.t.truck_number||"—")}</div><div><span class="et-fleet-pill ${esc(r.status)}">${esc(r.status)}</span></div><div class="et-fleet-cell">${esc(r.d?.name||"—")}</div><div class="et-fleet-cell">${esc(r.d?.phone||"—")}</div><div class="et-fleet-cell"><b>${esc(r.geo?.place||"—")}</b><br><span>${esc(r.geo?.district||"—")}, ${esc(r.geo?.state||"—")}</span><br><span class="muted">${esc(fastagTime(r.time))}</span></div><div class="et-fleet-cell">${r.trip?`<b>${esc(r.trip.loading_point||r.trip.from_location||"—")}</b><br><span style="color:#718096">↓</span><br><b>${esc(r.trip.destination||r.trip.to_location||"—")}</b>`:`<span class="muted">No Active Trip</span>`}</div></div>`).join(""):`<div class="et-fleet-empty">No vehicle with FASTag coordinates found.</div>`;
}
/* FASTag visit pins: show EACH crossing number, even repeated tolls. The little
   connector points back to the actual toll; road routes use ORIGINAL coordinates. */
function fastagOffsetVisit(center,index,total){
 const slot=index%12,ring=Math.floor(index/12);
 const radius=total===1?0:Math.min(75,28+ring*19);
 const angle=(-Math.PI/2)+(2*Math.PI*slot/Math.min(12,total));
 const north=radius*Math.cos(angle),east=radius*Math.sin(angle);
 return {lat:center.lat+north/111320,lng:center.lng+east/(111320*Math.max(.3,Math.cos(center.lat*Math.PI/180)))};
}
function fastagDirectionsSegment(points){
 return new Promise((resolve,reject)=>{
  if(!google.maps.DirectionsService)return reject(new Error('Maps Directions service unavailable'));
  const service=new google.maps.DirectionsService();
  service.route({origin:{lat:points[0].lat,lng:points[0].lng},destination:{lat:points[points.length-1].lat,lng:points[points.length-1].lng},waypoints:points.slice(1,-1).map(p=>({location:{lat:p.lat,lng:p.lng},stopover:true})),optimizeWaypoints:false,travelMode:google.maps.TravelMode.DRIVING,provideRouteAlternatives:false},(result,status)=>{
   if(status==='OK'&&result?.routes?.[0])resolve(result.routes[0]);
   else reject(new Error('Directions '+status));
  });
 });
}
async function drawFastagHistory(r,history,token){
 clearFastagHistory();etFastagVisibleHistory=history;
 if(!etFastagMap||!history.length)return;
 const bounds=new google.maps.LatLngBounds();
 const groups=[];
 for(let i=0;i<history.length;i++){
  const x=history[i];bounds.extend({lat:x.lat,lng:x.lng});
  let g=groups.find(g=>Math.abs(g.lat-x.lat)<.0008&&Math.abs(g.lng-x.lng)<.0008);
  if(!g){g={lat:x.lat,lng:x.lng,indices:[]};groups.push(g)}g.indices.push(i);
 }
 // Every crossing keeps its chronological number. Repeated toll visits fan out
 // around the real location instead of collapsing into unhelpful 2x bubbles.
 for(const g of groups){
  const center={lat:g.lat,lng:g.lng};
  for(let k=0;k<g.indices.length;k++){
   const i=g.indices[k],x=history[i],pos=fastagOffsetVisit(center,k,g.indices.length);
   const isLast=i===history.length-1;
   if(g.indices.length>1){
    etFastagRoadLines.push(new google.maps.Polyline({map:etFastagMap,path:[center,pos],strokeColor:'#64748b',strokeOpacity:.62,strokeWeight:1.5,zIndex:70}));
   }
   const marker=new google.maps.Marker({position:pos,map:etFastagMap,
    icon:{path:google.maps.SymbolPath.CIRCLE,scale:14,fillColor:isLast?'#0f766e':'#2563eb',fillOpacity:1,strokeColor:'#fff',strokeWeight:2.5},
    label:{text:String(i+1),color:'#fff',fontSize:'11px',fontWeight:'800'},
    zIndex:300+i,title:`Visit ${i+1} • ${fastagTime(x.toll_txn_date_time)}`});
   marker.__visits=[i];marker.addListener('click',()=>focusFastagVisit(i));
   etFastagHistoryMarkers.push(marker);
  }
 }
 etFastagMap.fitBounds(bounds,85);
 // Keep truck visually in FRONT of visit pins. Never hide it behind the numbers.
 etFastagMarkers.forEach(m=>{if(String(m.__truckId)===String(r.t.id)){m.setIcon(fastagSelectedTruckIcon(r));m.setZIndex(100000)}});
 if(history.length<2)return;
 // Consecutive repeats do not need a separate road request, but all visits
 // remain numbered above. Use the actual toll coordinates for road geometry.
 const distinct=history.filter((x,i)=>i===0||Math.abs(x.lat-history[i-1].lat)>.0008||Math.abs(x.lng-history[i-1].lng)>.0008);
 if(distinct.length<2)return;
 const chunks=[];for(let i=0;i<distinct.length-1;i+=8)chunks.push(distinct.slice(i,Math.min(i+9,distinct.length)));
 let success=0,failures=0,firstFailure='';
 // Render only genuine road geometry. Never present straight toll-to-toll
 // dotted connections as a road, because they can mislead dispatchers.
 for(const points of chunks){
  if(token!==etFastagHistoryToken)return;
  try{
   // Routes API v2 is called securely from the FASTag Supabase Edge Function.
   const route=await fastagComputeRoadRoute(points[0],points[points.length-1],points.slice(1,-1));
   if(token!==etFastagHistoryToken)return;
   const path=fastagDecodePolyline(route.encoded);
   if(path.length<2)throw new Error('Routes API returned no road geometry');
   etFastagRoadLines.push(new google.maps.Polyline({path,map:etFastagMap,strokeColor:'#ffffff',strokeOpacity:.95,strokeWeight:8,zIndex:12}));
   etFastagRoadLines.push(new google.maps.Polyline({path,map:etFastagMap,strokeColor:'#2563eb',strokeOpacity:.95,strokeWeight:5,zIndex:14,icons:[{icon:{path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:2,fillColor:'#ffffff',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:1},offset:'35px',repeat:'140px'}]}));
   success++;
  }catch(e){
   failures++;
   if(!firstFailure)firstFailure=String(e?.message||e);
   console.warn('[EKTA] FASTag road routing:',e);
  }
 }
 const meta=$('etFastagHistoryMeta');
 if(meta&&token===etFastagHistoryToken){
  // Keep this bar concise; do not dump internal API troubleshooting into the map.
  if(failures)meta.textContent+=` • Road route: ${success} of ${chunks.length} sections available`;
  else meta.textContent+=' • Road route shown';
 }
 // Diagnostic status is accessible to the operator without an oversized banner.
 if(meta&&token===etFastagHistoryToken){
  meta.title=failures?`FASTag route service: ${firstFailure}. Check Edge Function deployment and server secret.`:'Road route available';
 }

}
async function selectFastagVehicle(id){
 const r=(etFastagRows||[]).find(x=>String(x.t.id)===String(id));if(!r)return;
 etFastagSelectedId=id;const token=++etFastagHistoryToken;
 if(etFastagClusterer){etFastagClusterer.clearMarkers();etFastagClusterer=null}etFastagMarkers.forEach(m=>{const row=etFastagRows.find(x=>String(x.t.id)===String(m.__truckId));if(row)m.setIcon(fastagTruckMarkerIcon(row.status,row.t.truck_number,fastagProgramRoute(row.trip)));m.setZIndex(undefined);m.setMap(String(m.__truckId)===String(id)?etFastagMap:null)});
 const meta=$("etFastagHistoryMeta"),w=fastagWindow();if(meta)meta.textContent=`${r.t.truck_number} • ${fastagTime(w.start)} → ${fastagTime(w.end)} • Loading...`;
 try{
  const history=await loadFastagHistory(r.t.truck_number);if(token!==etFastagHistoryToken)return;
  if(meta)meta.textContent=`${r.t.truck_number} • ${history.length} toll crossings • ${fastagTime(w.start)} → ${fastagTime(w.end)}`;
  showFastagCard(r,history);await drawFastagHistory(r,history,token);
 }catch(e){if(meta&&token===etFastagHistoryToken)meta.textContent=`History could not load: ${e.message||e}`;return}
 const b=$("etFastagShowAll");if(b)b.style.display="inline-flex";
}
function showAllFastagVehicles(){
 ++etFastagHistoryToken;etFastagSelectedId=null;etFastagVisibleHistory=[];clearFastagHistory();if(etFastagInfo){etFastagInfo.close();etFastagInfo=null}
 const c=$("etFastagMapCard");if(c)c.classList.remove("show");
 etFastagMarkers.forEach(m=>{const row=etFastagRows.find(x=>String(x.t.id)===String(m.__truckId));if(row)m.setIcon(fastagTruckMarkerIcon(row.status,row.t.truck_number,fastagProgramRoute(row.trip)));m.setZIndex(undefined);m.setMap(etFastagMap)});buildFastagClusters();
 if(etFastagMap){etFastagMap.setCenter({lat:22.9734,lng:78.6569});etFastagMap.setZoom(5)}
 const b=$("etFastagShowAll");if(b)b.style.display="none";
}
async function renderFastagMap(){
 const canvas=$("etFastagMapCanvas");if(!canvas)return;
 try{
  await loadGoogleMapsAPI();
  try{await loadMarkerClusterer()}catch(e){console.warn("[EKTA TRACKING] FASTag clustering unavailable; using individual markers.",e.message)}
  const rows=await loadLatestFastagLocations(),center={lat:22.9734,lng:78.6569};
  if(!etFastagMap)etFastagMap=new google.maps.Map(canvas,{center,zoom:5,minZoom:3,mapTypeId:"roadmap",fullscreenControl:true,streetViewControl:true,mapTypeControl:true,gestureHandling:"greedy",restriction:{latLngBounds:{north:38.5,south:5.0,west:66.0,east:99.0},strictBounds:false}});
  clearFastagMapObjects();
  rows.forEach(r=>{
   const marker=new google.maps.Marker({position:{lat:r.lat,lng:r.lng},map:etFastagMap,title:`${r.t.truck_number||"Truck"} • ${r.status||""}`,icon:fastagTruckMarkerIcon(r.status,r.t.truck_number,fastagProgramRoute(r.trip))});
   marker.__truckId=r.t.id;marker.addListener("click",()=>selectFastagVehicle(r.t.id));etFastagMarkers.push(marker);
  });
  buildFastagClusters();
  etFastagMap.setCenter(center);etFastagMap.setZoom(5);
  renderFastagVehicleList();fastagRangeUI();
 }catch(e){console.error("[EKTA TRACKING] FASTag map failed:",e);canvas.innerHTML=`<div class="et-map-api-note"><b>FASTag map could not load</b><br>${esc(e.message||"Unknown error")}</div>`}
}
function openFastagMap(){fastagRangeUI();const p=$("etFastagMapPage");if(!p)return;p.classList.add("show");p.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";renderFastagMap()}
function closeFastagMap(){const p=$("etFastagMapPage");if(!p)return;p.classList.remove("show");p.setAttribute("aria-hidden","true")}
async function refreshFastagMap(){await loadAll();if($("etFastagMapPage")?.classList.contains("show"))renderFastagMap()}

function openSelectedMapFullScreen(){
 if(!selectedMap?.t)return alertUser("Select a truck first from the Tracking table.");
 const p=$("etSelectedMapPage"),f=$("etSelectedMapFullFrame");if(!p||!f)return;
 $("etSelectedMapFullTitle").textContent=`${selectedMap.t.truck_number||"Truck"} — Live Location`;
 const l=selectedMap.loc,hasGPS=l?.latitude!=null&&l?.longitude!=null;
 $("etSelectedMapFullMeta").textContent=hasGPS?`${l.latitude}, ${l.longitude}`:(l?.location||selectedMap.trip?.current_location||"Google Maps");
 f.src=`https://www.google.com/maps?q=${encodeURIComponent(mapQuery())}&z=13&output=embed`;
 p.classList.add("show");p.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
}
function closeSelectedMapFullScreen(){const p=$("etSelectedMapPage");if(!p)return;p.classList.remove("show");p.setAttribute("aria-hidden","true")}


/* ========================= 15. E-WAY — SELF-CONTAINED MULTI ===== */
function ewayTripRecords(){
 return trips
  // Completed/cancelled trips disappear from the ACTIVE E-Way page only.
  // Their bills are never deleted from Supabase and remain linked to old trip IDs.
  .filter(t=>!["completed","cancelled"].includes(clean(t.trip_status).toLowerCase()))
  .filter(t=>!["EMPTY","CANCELLED"].includes(clean(t.tracking_status).toUpperCase()))
  .filter(t=>t.program_date||t.loading_date||t.lr_date||t.start_date);
}

function billsForTrip(tripId){
 return (ewayBills||[])
  .filter(x=>String(x.trip_id)===String(tripId))
  .sort((a,b)=>new Date(a.created_at||a.eway_bill_date||0)-new Date(b.created_at||b.eway_bill_date||0));
}

function currentVisibleBills(tripId){
 return billsForTrip(tripId);
}

function ewayBillStatus(x){
 if(!x)return "PENDING";
 const ex=x.valid_until?new Date(x.valid_until):null;
 if(!ex||isNaN(ex))return "OK";
 const diff=ex.getTime()-Date.now();
 if(diff<=0)return "EXPIRED";
 if(diff<=8*60*60*1000)return "WARNING";
 return "OK";
}

function ewayTripOverallStatus(t){
 const list=currentVisibleBills(t.id);
 if(!list.length)return "PENDING";
 if(list.some(x=>ewayBillStatus(x)==="EXPIRED"))return "EXPIRED";
 if(list.some(x=>ewayBillStatus(x)==="WARNING"))return "WARNING";
 return "OK";
}

function ewayLatestValidity(t){
 const list=currentVisibleBills(t.id).filter(x=>x.valid_until);
 if(!list.length)return null;
 return list.sort((a,b)=>new Date(b.valid_until)-new Date(a.valid_until))[0].valid_until;
}

function ewayStatusLabel(s){
 if(s==="PENDING")return `<span class="eway-status-pill pending">E-Way Bill Pending</span>`;
 if(s==="WARNING")return `<span class="eway-status-pill warn">⚠ Within 8 Hours</span>`;
 if(s==="EXPIRED")return `<span class="eway-status-pill expired">⚠ Expired</span>`;
 return `<span class="eway-status-pill ok">Valid</span>`;
}

function toggleEwayMenu(id){
 document.querySelectorAll(".eway-menu.show").forEach(x=>{if(x.id!==id)x.classList.remove("show")});
 $(id)?.classList.toggle("show");
}

function openEwayRecords(){
 refreshUploadTrips();
 $("etEwayDate").value=$("etDate")?.value||today();
 $("etEwaySearch").value="";
 $("etEwayStatusFilter").value="";
 renderEwayPage();
 $("etEwayPage").classList.add("show");
}

function closeEwayPage(){
 document.querySelectorAll(".eway-menu.show").forEach(x=>x.classList.remove("show"));
 closeModal("etEwayDetailModal");
 closeModal("etEwayEditModal");
 $("etEwayPage").classList.remove("show");
}

async function refreshEwayPage(){
 await loadAll();
 renderEwayPage();
}

function ewayToday(){
 $("etEwayDate").value=today();
 renderEwayPage();
}

function ewayRemaining(v){if(!v)return "—";const ms=new Date(v).getTime()-Date.now();if(!Number.isFinite(ms))return "—";const m=Math.ceil(Math.abs(ms)/60000),d=Math.floor(m/1440),hr=Math.floor(m%1440/60),min=m%60;return `${ms<=0?"Expired ":""}${d?d+"d ":""}${hr}h ${min}m`;}
function renderEwayPage(){
 const q=clean($("etEwaySearch")?.value).toLowerCase(),sf=$("etEwayStatusFilter")?.value||"";
 const list=ewayTripRecords().filter(t=>{const tr=truck(t.truck_id),b=billsForTrip(t.id);return (!q||[tr?.truck_number,t.trip_number,t.from_location,t.to_location,...b.map(x=>x.eway_bill_number)].join(" ").toLowerCase().includes(q))&&(!sf||ewayTripOverallStatus(t)===sf)}).sort((a,b)=>String(b.program_date||"").localeCompare(String(a.program_date||"")));
 const all=ewayTripRecords(),counts={PENDING:0,OK:0,WARNING:0,EXPIRED:0};all.forEach(t=>counts[ewayTripOverallStatus(t)]++);
 $("etEwayCount").textContent=`${list.length} trips`;
 const stats=$("etEwayStats");if(stats)stats.innerHTML=`<span class="eway-stat"><b>${all.length}</b>Active Trips</span><span class="eway-stat"><b>${counts.OK}</b>Valid</span><span class="eway-stat"><b>${counts.WARNING}</b>Expiring ≤8h</span><span class="eway-stat"><b>${counts.EXPIRED}</b>Expired</span><span class="eway-stat"><b>${counts.PENDING}</b>Awaiting Details</span>`;
 $("etEwayRows").innerHTML=list.length?list.map(t=>{
 const tr=truck(t.truck_id),bills=billsForTrip(t.id),s=ewayTripOverallStatus(t),latest=bills.slice().sort((a,b)=>new Date(b.created_at||b.eway_bill_date||0)-new Date(a.created_at||a.eway_bill_date||0))[0];
 const nearest=bills.filter(b=>b.valid_until).sort((a,b)=>new Date(a.valid_until)-new Date(b.valid_until))[0];
 return `<tr><td class="eway-truck-cell"><strong>${esc(tr?.truck_number||"—")}</strong><small>${esc(t.trip_number||"")} · ${esc(fmt(t.program_date))}</small></td>
 <td><div class="eway-number-list">${bills.length?bills.map(b=>`<button class="eway-number eway-text-read" type="button" onclick="window.EktaTracking.openEwayEdit('${esc(t.id)}','${esc(b.id)}')">${esc(b.eway_bill_number||"—")}</button>`).join(""):"<span class='eway-empty-cell'>Not entered</span>"}${bills.length>1?`<span class="eway-mini">${bills.length} bills</span>`:""}</div></td>
 <td>${latest?esc(fmtDT(latest.eway_bill_date||latest.valid_from)):"—"}</td><td>${nearest?esc(fmtDT(nearest.valid_until)):"—"}</td>
 <td><span class="eway-countdown ${s==='EXPIRED'?'expired':s==='WARNING'?'warn':''}" ${nearest?`data-eway-expiry="${esc(nearest.valid_until)}"`:""}>${nearest?esc(ewayRemaining(nearest.valid_until)):"—"}</span></td>
 <td>${ewayStatusLabel(s)}</td><td><button type="button" class="btn eway-manage" onclick="window.EktaTracking.openEwayEdit('${esc(t.id)}','')">＋ ${bills.length?'Add another':'Enter Bill'}</button></td></tr>`;
 }).join(""):`<tr><td colspan="7" class="empty">No active E-Way trips match this search.</td></tr>`;
}
function updateEwayCountdowns(){document.querySelectorAll('[data-eway-expiry]').forEach(el=>{const expiry=el.getAttribute('data-eway-expiry');el.textContent=ewayRemaining(expiry);const diff=new Date(expiry).getTime()-Date.now();el.classList.toggle('warn',diff>0&&diff<=28800000);el.classList.toggle('expired',diff<=0)});}
window.setInterval(()=>{updateEwayCountdowns();if($("etEwayPage")?.classList.contains("show"))renderEwayPage();},60000);
function openEwaySmartEntry(){
 const available=ewayTripRecords();if(!available.length)return alertUser("No active trips available.");
 // The OCR entry has no default truck: never silently assign the first trip.
 openEwayEdit(available[0].id,"");
 const modal=$("etEwayEditModal");modal.classList.remove("eway-manual-mode");modal.classList.add("eway-ocr-mode");
 $("etEwayEditTitle").textContent="SCAN / PASTE E-WAY BILL";
 $("etEWTripId").value="";$("etEWTruck").value="";
 $("etEWTruckLabel").textContent="Not selected";$("etEWTripLabel").textContent="Select active trip";
 const wrap=$("etEWOcrTruckChoice"),sel=$("etEWOcrTruckSelect");wrap.style.display="block";
 sel.innerHTML='<option value="">Select vehicle / active trip</option>'+available.map(t=>`<option value="${esc(t.id)}">${esc(truck(t.truck_id)?.truck_number||'Unknown')} — ${esc(t.trip_number||'Active')}</option>`).join('');
 sel.value="";
 sel.onchange=()=>{
  const t=available.find(x=>String(x.id)===String(sel.value));
  $("etEWTripId").value=t?.id||"";$("etEWTruck").value=t?truck(t.truck_id)?.truck_number||"":"";
  $("etEWTruckLabel").textContent=$("etEWTruck").value||"Not selected";
  $("etEWTripLabel").textContent=t?.trip_number||"Select active trip";
 };
}

function openEwayTripDetails(tripId){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return;
 const tr=truck(t.truck_id),d=activeDriver(t.truck_id),p=party(t.party_id),bills=currentVisibleBills(t.id);
 $("etEwayDetailTitle").textContent=`E-Way Details — ${tr?.truck_number||""}`;
 $("etEwayDetailBody").innerHTML=`
   <div class="et-notice"><b>Trip:</b> ${esc(t.trip_number||"—")} • <b>E-Way Bills:</b> ${bills.length}</div>
   <div class="et-grid">
    <div class="et-field"><label>Truck</label><input class="et-input readonly" readonly value="${esc(tr?.truck_number||"—")}"></div>
    <div class="et-field"><label>Driver</label><input class="et-input readonly" readonly value="${esc(d?.name||"—")}"></div>
    <div class="et-field"><label>Driver Phone</label><input class="et-input readonly" readonly value="${esc(d?.phone||"—")}"></div>
    <div class="et-field"><label>Party</label><input class="et-input readonly" readonly value="${esc(p?.name||"—")}"></div>
    <div class="et-field"><label>Program Date</label><input class="et-input readonly" readonly value="${esc(fmt(t.program_date))}"></div>
    <div class="et-field"><label>Loading Date</label><input class="et-input readonly" readonly value="${esc(fmt(t.loading_date))}"></div>
    <div class="et-field et-full"><label>Route</label><input class="et-input readonly" readonly value="${esc((t.loading_point||t.from_location||"—")+" → "+(t.destination||t.to_location||"—"))}"></div>
   </div>
   <div class="et-footer">
    <button class="et-btn et-primary" onclick="window.EktaTracking.openEwayEdit('${esc(t.id)}','')">＋ Add New E-Way Bill</button>
    <button class="et-btn" onclick="window.EktaTracking.closeModal('etEwayDetailModal')">Close</button>
   </div>`;
 $("etEwayDetailModal").classList.add("show");
}

function toLocalInput(v){
 if(!v)return "";
 const d=new Date(v);
 if(isNaN(d))return "";
 const pad=n=>String(n).padStart(2,"0");
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addEwayBillRow(number="",valid="",recordId=""){
 const host=$("etEWBillRows");if(!host)return;
 const row=document.createElement("div");row.className="eway-bill-row";row.dataset.recordId=recordId;
 row.innerHTML=`<span class="bill-index"></span><div class="field"><label>E-Way Bill Number *</label><input class="eway-row-number" inputmode="numeric" maxlength="12" pattern="[0-9]{12}" required placeholder="12-digit E-Way Bill"></div><div class="field eway-valid-field"><label>Valid Upto — Date & Time *</label><input class="eway-row-expiry" type="datetime-local" required></div><button type="button" class="bill-remove" title="Remove this row" onclick="window.EktaTracking.removeEwayBillRow(this)">×</button>`;
 host.appendChild(row);row.querySelector('.eway-row-number').value=number;row.querySelector('.eway-row-expiry').value=valid;
 host.querySelectorAll('.bill-index').forEach((x,i)=>x.textContent=String(i+1).padStart(2,'0'));
}
function removeEwayBillRow(btn){const host=$("etEWBillRows");if(host.children.length<=1)return alertUser("Keep at least one bill row.");btn.closest('.eway-bill-row').remove();host.querySelectorAll('.bill-index').forEach((x,i)=>x.textContent=String(i+1).padStart(2,'0'));}
function openEwayEdit(tripId,recordId){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return alertUser("Trip not found.");
 const tr=truck(t.truck_id);
 const record=recordId?(ewayBills||[]).find(x=>String(x.id)===String(recordId)):null;

 $("etEWTripId").value=t.id;
 $("etEWRecordId").value=record?.id||"";
 $("etEWTruck").value=tr?.truck_number||"";$("etEWTruck").readOnly=true;$("etEWTruck").onchange=null;$("etEWTruckLabel").textContent=tr?.truck_number||"—";$("etEWTripLabel").textContent=t.trip_number||"Active";
 $("etEWProgramDate").value=dateOnly(t.program_date);
 $("etEWLoadingDate").value=dateOnly(t.loading_date);
 $("etEWBillRows").innerHTML="";addEwayBillRow(record?.eway_bill_number||"",toLocalInput(record?.valid_until||""),record?.id||"");
 $("etEWDateTime").value=toLocalInput(record?.eway_bill_date||record?.valid_from||"");

 $("etEWDocument").value=record?.document_file_url||"";
 $("etEWNote").value=record?.ai_note||"";
 $("etEWFile").value="";
 $("etEWFileNote").textContent="Scan or paste details, review and Save. Original file/text is not stored.";$("etEWPaste").value="";
 const modal=$("etEwayEditModal");modal.classList.add("eway-manual-mode");modal.classList.remove("eway-ocr-mode");
 $("etEWOcrTruckChoice").style.display="none";
 $("etEwayEditTitle").textContent=record?"UPDATE E-WAY BILL":"ADD NEW E-WAY BILL";
 $("etEwayEditModal").classList.add("show");
}


function safeFileName(name){
 return clean(name||"document")
  .replace(/[^A-Za-z0-9._-]+/g,"-")
  .replace(/-+/g,"-")
  .replace(/^-|-$/g,"") || "document";
}

async function uploadEwayDocument(tripId,file){
 if(!file)return null;
 if(!S?.storage?.from)throw new Error("Supabase Storage client not available.");
 const extName=safeFileName(file.name);
 const objectPath=`${tripId}/${Date.now()}-${extName}`;
 const {data,error}=await S.storage
  .from("eway-documents")
  .upload(objectPath,file,{
    cacheControl:"3600",
    upsert:false,
    contentType:file.type||undefined
  });
 if(error)throw error;
 return data?.path||objectPath;
}

async function openEwayDocument(recordId){
 const rec=(ewayBills||[]).find(x=>String(x.id)===String(recordId));
 if(!rec)return alertUser("E-Way record not found.");
 const stored=clean(rec.document_file_url);
 if(!stored)return alertUser("No document uploaded for this E-Way Bill.");

 // Backward compatibility: if an old full URL is already stored, open it directly.
 if(/^https?:\/\//i.test(stored)){
  window.open(stored,"_blank","noopener,noreferrer");
  return;
 }

 try{
  const {data,error}=await S.storage
   .from("eway-documents")
   .createSignedUrl(stored,60*60);
  if(error)throw error;
  if(!data?.signedUrl)throw new Error("Signed URL was not created.");
  window.open(data.signedUrl,"_blank","noopener,noreferrer");
 }catch(err){
  console.error("[EKTA TRACKING] E-Way document open failed:",err);
  alertUser("Document open failed: "+(err.message||"Storage error"));
 }
}

async function saveEwayRecord(e){
 e.preventDefault();
 const tripId=clean($("etEWTripId").value);
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return alertUser("Select a valid active trip.");
 if(ewayNormalizeTruck(truck(t.truck_id)?.truck_number)!==ewayNormalizeTruck($("etEWTruck").value))return alertUser("Truck number does not match selected trip.");
 const rows=[...$("etEWBillRows").querySelectorAll('.eway-bill-row')].map(row=>({id:row.dataset.recordId||"",number:clean(row.querySelector('.eway-row-number').value),expiry:clean(row.querySelector('.eway-row-expiry').value)}));
 if(!rows.length)return alertUser("Add at least one E-Way Bill.");
 const seen=new Set();
 for(const r of rows){
  if(!/^\d{12}$/.test(r.number))return alertUser("Each E-Way Bill number must contain exactly 12 digits.");
  if(!r.expiry||!Number.isFinite(new Date(r.expiry).getTime()))return alertUser("Enter a valid Valid Upto date and time for every bill.");
  if(seen.has(r.number))return alertUser("Duplicate E-Way Bill number in this form: "+r.number);seen.add(r.number);
  if(billsForTrip(tripId).some(b=>String(b.id)!==String(r.id)&&clean(b.eway_bill_number)===r.number))return alertUser("Bill already exists for this trip: "+r.number);
 }
 const saveBtn=e?.submitter;if(saveBtn)saveBtn.disabled=true;
 try{
  for(const r of rows){
   const existing=r.id?(ewayBills||[]).find(x=>String(x.id)===String(r.id)):null;
   // Preserve existing issue timestamp on edits. For new records, use the existing trip's
   // program/loading date as legacy database compatibility only; never claim it was OCR-generated.
   const legacyDate=existing?.eway_bill_date||existing?.valid_from||t.loading_date||t.program_date||new Date().toISOString();
   const issue=new Date(legacyDate);const fallback=Number.isFinite(issue.getTime())&&issue.getTime()<new Date(r.expiry).getTime()?issue.toISOString():new Date(Math.min(Date.now(),new Date(r.expiry).getTime()-60000)).toISOString();
   const payload={trip_id:t.id,truck_id:t.truck_id,eway_bill_number:r.number,eway_bill_date:fallback,valid_from:fallback,valid_until:new Date(r.expiry).toISOString(),document_file_url:existing?.document_file_url||null,ai_note:existing?.ai_note||null,verified:false,updated_at:new Date().toISOString()};
   const result=r.id?await S.from(T.eway).update(payload).eq('id',r.id):await S.from(T.eway).insert(payload);
   if(result.error)throw result.error;
  }
  closeModal("etEwayEditModal");await loadAll();renderEwayPage();alertUser(`${rows.length} E-Way Bill(s) saved successfully.`);
 }catch(err){console.error("[EKTA TRACKING] E-Way save failed:",err);alertUser("E-Way save failed: "+(err.message||"Database error")+". Some earlier rows may have saved; refresh before retrying.");}
 finally{if(saveBtn)saveBtn.disabled=false;}
 return false;
}
function ewayNormalizeTruck(s){return clean(s).replace(/[^A-Z0-9]/gi,"").toUpperCase()}
function ewayDateFromText(value){
 const raw=clean(value).replace(/\s+/g," ");if(!raw)return "";
 const m=raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+([01]?\d|2[0-3]):([0-5]\d)(?:\s*(AM|PM))?)?/i);
 if(!m)return "";
 const day=Number(m[1]),month=Number(m[2]),year=Number(m[3]);
 if(month<1||month>12||day<1||day>31)return "";
 // Missing time must be confirmed manually, never invented for an expiry.
 if(!m[4])return "";
 let h=Number(m[4]);if(m[6])h=h%12+(m[6].toUpperCase()==="PM"?12:0);
 const d=new Date(year,month-1,day,h,Number(m[5]));
 if(d.getDate()!==day||d.getMonth()!==month-1)return "";
 return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(h).padStart(2,"0")}:${m[5]}`;
}
function ewayExtractPlainText(txt){
 const text=String(txt||"").replace(/\r/g,"\n").replace(/\u00a0/g," ");
 const numberMatch=text.match(/(?:e[\s-]*way\s*bill\s*(?:no\.?|number|#)|eway\s*bill\s*no\.?)\s*[:#-]?\s*((?:\d[\s-]*){12})/i);
 const number=numberMatch?numberMatch[1].replace(/\D/g,""):"";
 // Vehicle Details may be at the bottom, below 'Vehicle / Trans Doc No & Dt'.
 const vehicleMatches=[...text.matchAll(/\b([A-Z]{2})[\s-]*(\d{1,2})[\s-]*([A-Z]{1,3})[\s-]*(\d{4})\b/gi)];
 const vehicles=[...new Set(vehicleMatches.map(m=>m.slice(1,5).join("").toUpperCase()))];
 const lines=text.split(/\n/);
 function labelledDate(labels){
  for(let i=0;i<lines.length;i++){
   if(!labels.test(lines[i]))continue;
   const matched=lines[i].match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{4}(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?/i);
   if(matched)return {raw:matched[0],parsed:ewayDateFromText(matched[0])};
  }
  // PDF extracted text can flatten all lines into one.
  const re=new RegExp('(?:'+labels.source+')\\s*[:#-]?\\s*(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{4}(?:\\s+\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)?)','i');
  const m=text.match(re);return m?{raw:m[1],parsed:ewayDateFromText(m[1])}:{raw:"",parsed:""};
 }
 const issued=labelledDate(/(?:generated\s*(?:date|on)|e[\s-]*way\s*bill\s*date|issue\s*date)/i);
 const expiry=labelledDate(/(?:valid\s*(?:upto|up\s*to|until|till)|expiry\s*(?:date|time)?|expires\s*(?:on|at)?)/i);
 return {eway_bill_number:/^\d{12}$/.test(number)?number:"",truck_number:vehicles.length===1?vehicles[0]:"",eway_bill_date:issued.parsed,valid_until:expiry.parsed,missing_time:!!(expiry.raw&&!expiry.parsed),ambiguous_vehicle:vehicles.length>1};
}
function applyEwayExtracted(data){
 if(!data||typeof data!=="object")throw new Error("No fields extracted");
 const no=clean(data.eway_bill_number||data.ewayBillNumber||data.eway_number||"").replace(/\D/g,"");
 // Never preserve stale extracted values when scanning another document.
 const firstRow=$("etEWBillRows")?.querySelector(".eway-bill-row");if(firstRow)firstRow.querySelector(".eway-row-number").value=/^\d{12}$/.test(no)?no:"";
 const parseDate=v=>{if(!v)return "";const x=clean(v);if(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x))return x.slice(0,16);return ewayDateFromText(x)};

 if(firstRow)firstRow.querySelector(".eway-row-expiry").value=parseDate(data.valid_until||data.expiry_date||data.expiryDate);
 const vehicle=ewayNormalizeTruck(data.truck_number||data.vehicle_number||data.vehicleNo||"");
 const current=ewayNormalizeTruck($("etEWTruck").value);
 const note=$("etEWFileNote");
 if(vehicle){
  if($("etEwayEditModal").classList.contains("eway-ocr-mode")){
   const matches=ewayTripRecords().filter(t=>ewayNormalizeTruck(truck(t.truck_id)?.truck_number)===vehicle);
   if(matches.length===1){$("etEWOcrTruckSelect").value=matches[0].id;$("etEWOcrTruckSelect").onchange();note.textContent="OCR vehicle matched. Verify the trip and bill details before saving.";}
   else note.textContent="OCR vehicle could not be uniquely matched. Select the correct active trip manually.";
  }
  else if(current&&vehicle!==current){
   $("etEWTripId").value="";
   note.textContent=`OCR vehicle ${vehicle} does not match selected truck ${current}. Select the correct active trip before saving.`;
  }else if(!current){
   const matches=ewayTripRecords().filter(t=>ewayNormalizeTruck(truck(t.truck_id)?.truck_number)===vehicle);
   if(matches.length===1){const t=matches[0];$("etEWTripId").value=t.id;$("etEWTruck").value=truck(t.truck_id)?.truck_number||"";$("etEWTruckLabel").textContent=$("etEWTruck").value;$("etEWTripLabel").textContent=t.trip_number||"Active";}
   else {$("etEWTripId").value="";note.textContent="Vehicle not uniquely matched to an active trip. Choose the correct truck.";}
  }
 }
 if(data.missing_time)note.textContent+=" Expiry time not visible: enter it manually; no default time assumed.";
 if(data.ambiguous_vehicle)note.textContent+=" Multiple vehicle numbers detected: verify truck manually.";
}
function readEwayPastedText(){
 const txt=clean($("etEWPaste")?.value);if(!txt)return alertUser("Paste E-Way Bill text first.");
 const data=ewayExtractPlainText(txt);
 $("etEWFileNote").textContent="OCR text parsed. Check vehicle, 12-digit bill number, expiry time before Save.";
 applyEwayExtracted(data);
}
/* E-Way OCR is browser-only: no Gemini, no API upload, no source persistence. */
let etOcrLibPromise=null;
function etLoadScript(url,ready){
 if(ready())return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const script=document.createElement("script");script.src=url;script.async=true;
  script.onload=()=>ready()?resolve():reject(new Error("OCR library failed to initialize"));
  script.onerror=()=>reject(new Error("Could not load OCR library. Check internet access."));
  document.head.appendChild(script);
 });
}
async function etOcrLibraries(){
 if(!etOcrLibPromise)etOcrLibPromise=Promise.all([
  etLoadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",()=>!!window.Tesseract),
  etLoadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",()=>!!window.pdfjsLib)
 ]).then(()=>{
  window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
 }).catch(e=>{etOcrLibPromise=null;throw e});
 return etOcrLibPromise;
}
async function etOcrImage(image,notify){
 let source=image;
 try{
  const img=typeof image==="string"?await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=reject;el.src=image;}):image;
  const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
  if(w&&h){const scale=Math.min(2.2,Math.max(1,1800/w));const c=document.createElement("canvas");c.width=Math.round(w*scale);c.height=Math.round(h*scale);const ctx=c.getContext("2d",{willReadFrequently:true});ctx.filter="grayscale(1) contrast(1.65) brightness(1.12)";ctx.drawImage(img,0,0,c.width,c.height);source=c;}
 }catch(err){console.warn("OCR enhancement skipped",err)}
 const result=await window.Tesseract.recognize(source,"eng",{
  logger:m=>{if(m.status==="recognizing text"&&notify)notify(`Reading image: ${Math.round((m.progress||0)*100)}%`)}
 });
 return result?.data?.text||"";
}
async function etOcrPdf(file,notify){
 const bytes=await file.arrayBuffer();
 const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
 if(pdf.numPages>12)throw new Error("PDF has more than 12 pages. Please upload the relevant pages.");
 let all="";
 for(let p=1;p<=pdf.numPages;p++){
  notify(`Reading PDF page ${p}/${pdf.numPages}…`);
  const page=await pdf.getPage(p);
  const content=await page.getTextContent();
  const extracted=content.items.map(x=>x.str||"").join(" ");
  if(ewayExtractPlainText(extracted).eway_bill_number){all+="\n"+extracted;continue;}
  const viewport=page.getViewport({scale:2});
  const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  try{
   await page.render({canvasContext:ctx,viewport}).promise;
   all+="\n"+extracted+"\n"+await etOcrImage(canvas,m=>notify(`Page ${p}: ${m}`));
  }finally{canvas.width=0;canvas.height=0}
 }
 return all;
}
async function tryEwayAIRead(){
 const file=$("etEWFile")?.files?.[0];if(!file)return readEwayPastedText();
 const note=$("etEWFileNote");
 if(file.size>8*1024*1024){note.textContent="File exceeds 8 MB. Use a smaller image/PDF.";return;}
 if(!/^image\//.test(file.type)&&file.type!=="application/pdf"){note.textContent="Select a photo or PDF.";return;}
 const button=document.querySelector('#etEwayEditModal button[onclick*="tryEwayAIRead"]');
 if(button)button.disabled=true;
 const notify=m=>{note.textContent=m+" File remains in your browser; nothing is uploaded."};
 try{
  notify("Loading local OCR libraries…");
  await etOcrLibraries();
  let text="";
  if(file.type==="application/pdf")text=await etOcrPdf(file,notify);
  else{
   const url=URL.createObjectURL(file);
   try{text=await etOcrImage(url,notify)}finally{URL.revokeObjectURL(url)}
  }
  if(!clean(text))throw new Error("No readable text found. Try a clearer photo or manual entry.");
  const fields=ewayExtractPlainText(text);
  note.textContent="OCR finished. Verify the E-Way number, vehicle and Valid Upto before saving. Unclear fields remain blank.";
  applyEwayExtracted(fields);
  if(!fields.eway_bill_number)note.textContent+=" E-Way Bill number not confidently found.";
  if(!fields.valid_until)note.textContent+=" Enter expiry date AND time manually if missing.";
 }catch(e){console.warn("Local E-Way OCR error",e);note.textContent="Local OCR failed: "+(e.message||"Unknown error")+". You can paste text or enter fields manually.";}
 finally{if(button)button.disabled=false}
}

/* ========================= 15A. HISTORY ====================== */
function openHistoryRecords(){
 if($("etHistoryFilter"))$("etHistoryFilter").value="ALL";
 renderHistoryRecords();
 $("etHistoryModal").classList.add("show");
}
function historyRecords(){
 const d=selectedTrackingDate();
 return trips.filter(t=>{
  const rel=clean(t.trip_status).toLowerCase();
  if(rel==="completed")return dateOnly(t.unloading_date||t.end_date)===d;
  if(rel==="cancelled")return cancelledDate(t)===d;
  return false;
 });
}
function renderHistoryRecords(){
 const filter=$("etHistoryFilter")?.value||"ALL",d=selectedTrackingDate();
 let list=historyRecords();
 if(filter==="COMPLETED")list=list.filter(t=>clean(t.trip_status).toLowerCase()==="completed");
 if(filter==="CANCELLED")list=list.filter(t=>clean(t.trip_status).toLowerCase()==="cancelled");
 $("etHistoryDateText").textContent=`Selected Date: ${fmt(d)}`;
 $("etHistoryCount").textContent=`${list.length} record(s)`;
 $("etHistoryRows").innerHTML=list.length?list.map(t=>{
  const tr=truck(t.truck_id),p=party(t.party_id),rel=clean(t.trip_status).toLowerCase();
  const finalDate=rel==="completed"?dateOnly(t.unloading_date||t.end_date):cancelledDate(t);
  return `<tr>
   <td>${esc(tr?.truck_number||"—")}</td><td>${esc(t.trip_number||"—")}</td><td>${esc(p?.name||"—")}</td>
   <td>${esc(fmt(t.program_date))}</td><td>${esc(fmt(t.loading_date))}</td>
   <td>${rel==="completed"?'<span class="et-badge b-empty">COMPLETED</span>':'<span class="et-badge b-cancel">CANCELLED</span>'}</td>
   <td>${esc(fmt(finalDate))}</td><td>${esc(rel==="cancelled"?cancellationReason(t):"—")}</td>
  </tr>`;
 }).join(""):`<tr><td colspan="8" class="muted" style="padding:25px;text-align:center">No records for selected date.</td></tr>`;
}

/* ========================= 16. FINAL REPORT ================= */
let etFinalAllDates=true;
function finalTripDate(t){return dateOnly(t.unloading_date||t.end_date||t.updated_at||t.created_at)}
function openFinalReport(){finalAll();$("etFinalPage").classList.add("show");renderFinal()}
function closeFinal(){$("etFinalPage").classList.remove("show")}
function finalAll(){etFinalAllDates=true;["etFinalFrom","etFinalTo","etFinalSearch"].forEach(id=>{if($(id))$(id).value=""});renderFinal()}
function finalDateChanged(){etFinalAllDates=!($("etFinalFrom")?.value||$("etFinalTo")?.value||clean($("etFinalSearch")?.value));renderFinal()}
function finalTrips(){
 const from=$("etFinalFrom")?.value||"",to=$("etFinalTo")?.value||"",q=clean($("etFinalSearch")?.value).toLowerCase();
 return trips.filter(t=>clean(t.trip_status).toLowerCase()==="completed")
  .filter(t=>{const d=finalTripDate(t);return (!from||d>=from)&&(!to||d<=to)})
  .filter(t=>!q||[t.trip_number,truck(t.truck_id)?.truck_number,party(t.party_id)?.name,party(t.party_id)?.party_code,party(t.party_id)?.city].some(v=>clean(v).toLowerCase().includes(q)))
  .sort((a,b)=>finalTripDate(a).localeCompare(finalTripDate(b))||clean(a.trip_number).localeCompare(clean(b.trip_number)));
}
let finalEditingTripId=null;
function finalEditInput(id,type,value,extra=""){
 return `<input id="${id}" class="detention-input" type="${type}" value="${esc(value??"")}" ${extra} style="width:100%;min-width:105px">`;
}
function finalTruckSelect(t){
 return `<select id="etIFTruck" class="detention-input" style="width:135px">${trucks.slice().sort((a,b)=>String(a.truck_number||"").localeCompare(String(b.truck_number||""))).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(t.truck_id)?"selected":""}>${esc(x.truck_number||"Truck")}</option>`).join("")}</select>`;
}
function finalPartySelect(t){
 return `<select id="etIFParty" class="detention-input" onchange="window.EktaTracking.refreshInlineFinalDerived()" style="width:135px">${parties.slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))).map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(t.party_id)?"selected":""}>${esc(x.name||"Party")}</option>`).join("")}</select>`;
}
function renderFinal(){
 const list=finalTrips();
 const pending=trips.filter(t=>clean(t.trip_status).toLowerCase()==="completed"&&clean(getNote(t.notes,"POD_SENT")).toUpperCase()!=="YES");
 const from=$("etFinalFrom")?.value,to=$("etFinalTo")?.value,q=clean($("etFinalSearch")?.value);
 $("etSendDateText").textContent=`ALL completed trips • ${pending.length} not yet sent to POD`;
 const allBtn=$("etFinalAllBtn");if(allBtn){allBtn.classList.toggle("primary",!from&&!to&&!q);allBtn.setAttribute("aria-pressed",String(!from&&!to&&!q));}
 const sendBtn=$("etFinalSendPODBtn");if(sendBtn){sendBtn.disabled=!pending.length;sendBtn.title="Send only completed trips not previously sent to POD, regardless of search filters";sendBtn.textContent=`SEND ${pending.length} NEW COMPLETED TRIP(S) TO POD`;}
 $("etFinalCount").textContent=`${list.length} completed trip(s) shown`;
 if(finalEditingTripId && !list.some(t=>String(t.id)===String(finalEditingTripId))) finalEditingTripId=null;
 $("etFinalRows").innerHTML=list.length?list.map(t=>{
  const tr=truck(t.truck_id),p=party(t.party_id),l=latestLocation(t.truck_id);
  const ld=loadingDetentionDays(t),ud=unloadingDetentionDays(t),lc=loadingDetentionCharge(t),uc=unloadingDetentionCharge(t);
  const editing=String(finalEditingTripId)===String(t.id);
  if(editing){
   return `<tr class="et-inline-edit-row" data-trip-id="${esc(t.id)}">
    <td>${esc(fmt(finalTripDate(t)))}</td>
    <td>${finalEditInput("etIFTripNo","text",t.trip_number||"")}</td>
    <td>${finalTruckSelect(t)}</td>
    <td>${finalEditInput("etIFProgramDate","date",dateOnly(t.program_date))}</td>
    <td>${finalEditInput("etIFLoadingDate","date",dateOnly(t.loading_date))}</td>
    <td>${finalPartySelect(t)}</td>
    <td id="etIFPartyType">${esc(p?.party_type||"—")}</td>
    <td id="etIFPartyZone">${esc(p?.zone||"—")}</td>
    <td>${esc(truckZone(t,l)||"—")}</td>
    <td>${finalEditInput("etIFReportingDate","date",dateOnly(t.reporting_date))}</td>
    <td>${finalEditInput("etIFUnloadingDate","date",dateOnly(t.unloading_date||t.end_date))}</td>
    <td>${ld} day(s)</td>
    <td>${finalEditInput("etIFLoadDet","number",lc,'min="0" step="1"')}</td>
    <td>${ud} day(s)</td>
    <td>${finalEditInput("etIFUnloadDet","number",uc,'min="0" step="1"')}</td>
    <td>${finalEditInput("etIFUnloadingCharge","number",num(t.unloading_charge),'min="0" step="0.01"')}</td>
    <td>${finalEditInput("etIFOther","number",num(t.other_charge??getNote(t.notes,"OTHER_CHARGE")),'min="0" step="0.01"')}</td>
    <td>${finalEditInput("etIFNGT","number",num(t.ngt??getNote(t.notes,"NGT")),'min="0" step="0.01"')}</td>
    <td><span class="et-badge b-cancel">PENDING</span></td>
    <td><div style="display:flex;gap:5px;white-space:nowrap"><button class="action" onclick="window.EktaTracking.saveInlineFinalEdit('${esc(t.id)}')">Save</button><button class="action" onclick="window.EktaTracking.cancelInlineFinalEdit()">Cancel</button></div></td>
   </tr>`;
  }
  return `<tr>
   <td>${esc(fmt(finalTripDate(t)))}</td>
   <td>${esc(t.trip_number||"—")}</td><td>${esc(tr?.truck_number||"—")}</td>
   <td>${esc(fmt(t.program_date))}</td><td>${esc(fmt(t.loading_date))}</td>
   <td>${esc(p?.name||"—")}</td><td>${esc(p?.party_type||"—")}</td><td>${esc(p?.zone||"—")}</td>
   <td>${esc(truckZone(t,l)||"—")}</td><td>${esc(fmt(t.reporting_date))}</td><td>${esc(fmt(t.unloading_date||t.end_date))}</td>
   <td>${ld} day(s)</td>
   <td><input class="detention-input" type="number" min="0" step="1" value="${lc}" onchange="window.EktaTracking.saveDetentionCharge('${esc(t.id)}','loading',this.value)"></td>
   <td>${ud} day(s)</td>
   <td><input class="detention-input" type="number" min="0" step="1" value="${uc}" onchange="window.EktaTracking.saveDetentionCharge('${esc(t.id)}','unloading',this.value)"></td>
   <td>₹${num(t.unloading_charge).toFixed(2)}</td><td>₹${num(t.other_charge??getNote(t.notes,"OTHER_CHARGE")).toFixed(2)}</td>
   <td>₹${num(t.ngt??getNote(t.notes,"NGT")).toFixed(2)}</td>
   <td><span class="et-badge b-cancel">PENDING</span></td>
   <td><div style="display:flex;gap:5px;white-space:nowrap"><button class="action" onclick="window.EktaTracking.openFinalView('${esc(t.id)}')">View</button><button class="action" onclick="window.EktaTracking.openFinalEdit('${esc(t.id)}')">Edit</button></div></td>
  </tr>`;
 }).join(""):`<tr><td colspan="20" style="padding:30px;text-align:center" class="muted">No completed trips for selected date.</td></tr>`;
}
function refreshInlineFinalDerived(){
 const p=party($("etIFParty")?.value);
 if($("etIFPartyType")) $("etIFPartyType").textContent=p?.party_type||"—";
 if($("etIFPartyZone")) $("etIFPartyZone").textContent=p?.zone||"—";
}
function openFinalEdit(tripId){
 finalEditingTripId=tripId;
 renderFinal();
 setTimeout(()=>document.querySelector('.et-inline-edit-row')?.scrollIntoView({block:'nearest',behavior:'smooth'}),0);
}
function cancelInlineFinalEdit(){finalEditingTripId=null;renderFinal()}
async function saveInlineFinalEdit(tripId){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return alertUser("Trip not found.");
 const reportingDate=$("etIFReportingDate").value||null,unloadingDate=$("etIFUnloadingDate").value||null;
 let notes=t.notes||"";
 notes=putNote(notes,"OTHER_CHARGE",num($("etIFOther").value));
 notes=putNote(notes,"NGT",num($("etIFNGT").value));
 notes=putNote(notes,"LOADING_DETENTION_CHARGE",num($("etIFLoadDet").value));
 notes=putNote(notes,"UNLOADING_DETENTION_CHARGE",num($("etIFUnloadDet").value));
 notes=putNote(notes,"UNLOADING_DETENTION_DAYS",unloadingGraceDays(reportingDate,unloadingDate));
 const payload={
  trip_number:clean($("etIFTripNo").value),truck_id:$("etIFTruck").value||t.truck_id,party_id:$("etIFParty").value||t.party_id,
  program_date:$("etIFProgramDate").value||null,loading_date:$("etIFLoadingDate").value||null,
  reporting_date:reportingDate,unloading_date:unloadingDate,end_date:unloadingDate,notes
 };
 if(Object.prototype.hasOwnProperty.call(t,"detention_charge"))payload.detention_charge=num($("etIFLoadDet").value);
 if(Object.prototype.hasOwnProperty.call(t,"unloading_charge"))payload.unloading_charge=num($("etIFUnloadingCharge").value);
 if(Object.prototype.hasOwnProperty.call(t,"other_charge"))payload.other_charge=num($("etIFOther").value);
 if(Object.prototype.hasOwnProperty.call(t,"ngt"))payload.ngt=num($("etIFNGT").value);
 if(!payload.trip_number)return alertUser("Trip No. cannot be blank.");
 try{
  const r=await S.from(T.trips).update(payload).eq("id",tripId);if(r.error)throw r.error;
  finalEditingTripId=null;await loadAll();renderFinal();alertUser("Final Report row updated successfully.");
 }catch(err){console.error("[EKTA TRACKING] Inline Final Report edit failed:",err);alertUser("Final Report update failed: "+(err.message||"Database error"));}
}


function openFinalView(tripId){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return alertUser("Trip not found.");
 const tr=truck(t.truck_id),p=party(t.party_id);
 $("etFinalViewTitle").textContent=`Final Report — ${t.trip_number||""}`;
 $("etFinalViewBody").innerHTML=`
  <div class="et-grid">
   <div class="et-field"><label>Trip No.</label><input class="et-input readonly" readonly value="${esc(t.trip_number||"—")}"></div>
   <div class="et-field"><label>Truck</label><input class="et-input readonly" readonly value="${esc(tr?.truck_number||"—")}"></div>
   <div class="et-field"><label>Party / Client</label><input class="et-input readonly" readonly value="${esc(p?.name||"—")}"></div>
   <div class="et-field"><label>Party Type</label><input class="et-input readonly" readonly value="${esc(p?.party_type||"—")}"></div>
   <div class="et-field"><label>Party Zone</label><input class="et-input readonly" readonly value="${esc(p?.zone||"—")}"></div>
   <div class="et-field"><label>Freight / Revenue</label><input class="et-input readonly" readonly value="₹${num(t.freight_amount??t.revenue).toFixed(2)}"></div>
   <div class="et-field et-full"><label>Route</label><input class="et-input readonly" readonly value="${esc((t.loading_point||t.from_location||"—")+" → "+(t.destination||t.to_location||"—"))}"></div>
   <div class="et-field"><label>Program Date</label><input class="et-input readonly" readonly value="${esc(fmt(t.program_date))}"></div>
   <div class="et-field"><label>Loading Date</label><input class="et-input readonly" readonly value="${esc(fmt(t.loading_date))}"></div>
   <div class="et-field"><label>LR Date</label><input class="et-input readonly" readonly value="${esc(fmt(t.lr_date||t.start_date))}"></div>
   <div class="et-field"><label>Reporting Date</label><input class="et-input readonly" readonly value="${esc(fmt(t.reporting_date))}"></div>
   <div class="et-field"><label>Unloading Date</label><input class="et-input readonly" readonly value="${esc(fmt(t.unloading_date||t.end_date))}"></div>
   <div class="et-field"><label>Loading Detention</label><input class="et-input readonly" readonly value="${loadingDetentionDays(t)} day(s) / ₹${loadingDetentionCharge(t)}"></div>
   <div class="et-field"><label>Unloading Detention</label><input class="et-input readonly" readonly value="${unloadingDetentionDays(t)} day(s) / ₹${unloadingDetentionCharge(t)}"></div>
   <div class="et-field"><label>Unloading Charge</label><input class="et-input readonly" readonly value="₹${num(t.unloading_charge).toFixed(2)}"></div>
   <div class="et-field"><label>Other</label><input class="et-input readonly" readonly value="₹${num(t.other_charge??getNote(t.notes,"OTHER_CHARGE")).toFixed(2)}"></div>
   <div class="et-field"><label>NGT</label><input class="et-input readonly" readonly value="₹${num(t.ngt??getNote(t.notes,"NGT")).toFixed(2)}"></div>
   <div class="et-field et-full"><label>Current Location</label><input class="et-input readonly" readonly value="${esc(t.current_location||"—")}"></div>
  </div>
  <div class="et-footer">
    <button class="et-btn et-primary" onclick="window.EktaTracking.closeModal('etFinalViewModal');window.EktaTracking.openFinalEdit('${esc(t.id)}')">Edit</button>
    <button class="et-btn" onclick="window.EktaTracking.closeModal('etFinalViewModal')">Close</button>
  </div>`;
 $("etFinalViewModal").classList.add("show");
}

async function saveDetentionCharge(tripId,kind,value){
 const t=trips.find(x=>String(x.id)===String(tripId));if(!t)return;
 const amount=Math.max(0,num(value));
 try{
  if(kind==="loading"&&Object.prototype.hasOwnProperty.call(t,"detention_charge")){
   const r=await S.from(T.trips).update({detention_charge:amount}).eq("id",t.id);if(r.error)throw r.error;
  }else{
   let notes=clean(t.notes)||"";
   notes=putNote(notes,kind==="loading"?"LOADING_DETENTION_CHARGE":"UNLOADING_DETENTION_CHARGE",amount);
   const r=await S.from(T.trips).update({notes}).eq("id",t.id);if(r.error)throw r.error;
  }
  await loadAll();renderFinal();
 }catch(err){
  console.error("[EKTA TRACKING] Detention charge save failed:",err);
  alertUser("Detention charge save failed: "+(err.message||"Database error"));
 }
}
function finalShift(n){renderFinal()}
function finalToday(){finalAll()}
let etPodSending=false;
async function sendSelectedDateToPOD(){
 if(etPodSending)return;
 const list=trips.filter(t=>clean(t.trip_status).toLowerCase()==="completed"&&clean(getNote(t.notes,"POD_SENT")).toUpperCase()!=="YES");
 if(!list.length)return alertUser("All completed trips have already been sent to POD. No new trips to send.");
 if(!window.confirm(`Send ${list.length} NEW completed trip(s) to POD Section?\nPreviously sent trips will not be sent again.\nDate/search filters do not affect POD sending.`))return;
 etPodSending=true;
 const btn=$("etFinalSendPODBtn");if(btn)btn.disabled=true;
 let sent=0,already=0,failed=0;
 try{
  for(const t of list){
   try{
    // Re-check database marker immediately before update, not just the cached UI list.
    const check=await S.from(T.trips).select("id,notes").eq("id",t.id).single();
    if(check.error)throw check.error;
    let notes=clean(check.data?.notes)||"";
    if(clean(getNote(notes,"POD_SENT")).toUpperCase()==="YES"){already++;continue;}
    notes=putNote(notes,"POD_SENT","YES");
    notes=putNote(notes,"POD_SENT_AT",new Date().toISOString());
    if(!getNote(notes,"POD_STATUS"))notes=putNote(notes,"POD_STATUS","PENDING");
    const r=await S.from(T.trips).update({notes}).eq("id",t.id);
    if(r.error)throw r.error;
    sent++;
   }catch(err){failed++;console.error("[EKTA TRACKING] POD hand-off failed:",t?.id,err);}
  }
  await loadAll();renderFinal();
  alertUser(`POD hand-off complete.\nNewly sent: ${sent}\nAlready in POD: ${already}\nFailed: ${failed}\nPOD register groups trips by Loading Date.`);
 }finally{etPodSending=false;renderFinal()}
}

/* Header notification drawer and safe read-only record search. */
function toggleHeaderPanel(which){
 const bell=$("etBellPanel"),ai=$("etAIPanel");
 const b=(which==="bell"||which==="breakdown")&&(!bell?.classList.contains("show")||bell?.dataset.mode!==which),a=which==="ai"&&!ai?.classList.contains("show");
 if(bell&&b){bell.dataset.mode=which;const items=$("etBellItems");if(items)items.innerHTML=(which==="breakdown"?items.dataset.breakdownAlerts:items.dataset.allAlerts)||(which==="breakdown"?'<div class="muted">No active breakdowns.</div>':'<div class="muted">No active notifications.</div>');const title=bell.querySelector(".et-head-panel-title b");if(title)title.textContent=which==="breakdown"?"🔧 Active Breakdowns":"🔔 Notifications";}
 bell?.classList.toggle("show",b);ai?.classList.toggle("show",a);
 $("etBellBtn")?.setAttribute("aria-expanded",String(b));$("etAIBtn")?.setAttribute("aria-expanded",String(a));
 if(a)refreshUploadTrips();
}
/* File-only intake. Never auto-insert a trip or bill from an unverified file. */
function refreshUploadTrips(){
 const el=$("etEwayQuickTrip");if(!el)return;
 const current=el.value;
 el.innerHTML='<option value="">Select active trip</option>'+ewayTripRecords().map(t=>`<option value="${esc(t.id)}">${esc(truck(t.truck_id)?.truck_number||"Truck")} — ${esc(t.trip_number||"Trip")}</option>`).join("");
 if([...el.options].some(o=>o.value===current))el.value=current;
}
function previewAIUpload(kind){
 const program=kind==="program";
 const el=$(program?"etProgramUpload":"etEwayQuickUpload"),status=$(program?"etProgramUploadStatus":"etEwayUploadStatus");
 const f=el?.files?.[0];if(!status)return;
 if(!f){status.textContent="No file selected";return}
 const allowed=program?/\.(xlsx|xls|csv|pdf|png|jpe?g|webp)$/i:/\.(pdf|png|jpe?g|webp)$/i;
 if(!allowed.test(f.name)){el.value="";status.textContent="Unsupported file type.";return}
 if(f.size>20*1024*1024){el.value="";status.textContent="Maximum file size is 20 MB.";return}
 status.textContent=`Selected: ${f.name} (${(f.size/1024).toFixed(0)} KB). Not saved yet.`;
}
let aiProgramRows=[];
function normalizeTruck(v){return clean(v).toUpperCase().replace(/[^A-Z0-9]/g,"")}
function programDateISO(v){const s=clean(v);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`:""}
function partyCandidates(r){
 const value=clean(r.party_text).toUpperCase(),from=clean(r.from_location).toUpperCase();
 const code=(value.match(/^\d+/)||[])[0];
 return parties.filter(p=>code?clean(p.party_code)===code:!!value&&clean(p.name).toUpperCase().includes(value)).sort((a,b)=>Number(clean(b.city).toUpperCase()===from)-Number(clean(a.city).toUpperCase()===from));
}
function matchProgramParty(r){
 if(r._partyId)return parties.find(p=>String(p.id)===String(r._partyId))||null;
 const candidates=partyCandidates(r),from=clean(r.from_location).toUpperCase();
 const local=candidates.filter(p=>clean(p.city).toUpperCase()===from);
 return local.length===1?local[0]:candidates.length===1?candidates[0]:null;
}
function aiRowIssues(r){
 const t=trucks.find(x=>normalizeTruck(x.truck_number)===normalizeTruck(r.truck_number));
 const p=matchProgramParty(r),d=t?activeDriver(t.id):null;
 const issues=[];
 if(!t)issues.push("Truck not found");
 if(t&&activeTrip(t.id))issues.push("Active trip / possible duplicate");
 if(!programDateISO(r.program_date))issues.push("Date pending");
 if(!clean(r.from_location)||!clean(r.to_location))issues.push("Route pending");
 if(!p)issues.push("Branch pending");
 if(!d)issues.push("Driver pending");
 if(r.freight_amount===null||r.freight_amount===undefined||clean(r.freight_amount)==="")issues.push("Freight pending");
 if(r.needsReview)issues.push("AI review required");
 r._truck=t;r._party=p;r._driver=d;r._issues=issues;
 return issues;
}
function aiPartyOptions(r){
 const opts=partyCandidates(r);
 const options=opts.length?opts:parties;
 return `<option value="">— Branch Pending —</option>`+options.map(p=>`<option value="${esc(p.id)}" ${String(r._partyId||r._party?.id||"")===String(p.id)?"selected":""}>${esc(p.party_code||"")} ${esc(p.name)} • ${esc(p.city||"No city")}</option>`).join("");
}
function showAIProgramPreview(){
 const el=$("etAIProgramPreview");if(!el)return;
 const active=aiProgramRows.filter(r=>!r._skip);
 el.innerHTML=`<div style="font-weight:800;margin:8px 0">${aiProgramRows.length} rows read • ${active.length} selected • ${aiProgramRows.length-active.length} excluded</div>`+
 aiProgramRows.map((r,i)=>{
 const issues=aiRowIssues(r);
 return `<div style="border:1px solid ${r._skip?"#ccd3dd":issues.length?"#ffd2a1":"#a5e3ca"};background:${r._skip?"#f3f5f7":"#fff"};border-radius:9px;padding:9px;margin:6px 0;font-size:11px;opacity:${r._skip?".65":"1"}">
 <b>${i+1}. ${esc(r.truck_number||"Truck pending")}</b> • ${esc(programDateISO(r.program_date)||"Date pending")} <div>${esc(r.from_location)} → ${esc(r.to_location)}</div>
 <div>${esc(r.party_text)} → ${r._party?esc(r._party.name+" "+(r._party.city||"")):"🟠 Branch Pending"}</div>
 <div>${r.freight_amount===null||r.freight_amount===undefined||clean(r.freight_amount)===""?"🔴 Freight Pending":"₹"+esc(r.freight_amount)+" (Provisional)"}</div>
 <div style="color:${issues.length?"#b04e09":"#087d50"}">${issues.map(x=>"● "+esc(x)).join(" • ")||"✓ Ready"}</div>
 <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px"><button type="button" class="et-billing-edit" onclick="window.EktaTracking.toggleAIProgramEdit(${i})">✎ Edit Full Program</button><button type="button" class="et-billing-edit" onclick="window.EktaTracking.toggleAIProgramRow(${i})">${r._skip?"↩ Include":"✕ Exclude"}</button></div>
 <div id="etAIRowEdit${i}" style="display:none;background:#f2f7ff;padding:8px;margin-top:6px;border-radius:7px">
 <label>Branch / Party Master</label><select style="width:100%" onchange="window.EktaTracking.editAIProgramRow(${i},'party',this.value)">${aiPartyOptions(r)}</select>
 <label>Truck</label><select style="width:100%" onchange="window.EktaTracking.editAIProgramRow(${i},'truck',this.value)"><option value="">Select Truck</option>${trucks.map(t=>`<option value="${esc(t.truck_number)}" ${normalizeTruck(t.truck_number)===normalizeTruck(r.truck_number)?"selected":""}>${esc(t.truck_number)}</option>`).join("")}</select>
 <label>Date</label><input style="width:100%" type="date" value="${esc(programDateISO(r.program_date))}" onchange="window.EktaTracking.editAIProgramRow(${i},'date',this.value)">
 <label>From</label><input style="width:100%" value="${esc(r.from_location)}" onchange="window.EktaTracking.editAIProgramRow(${i},'from',this.value)">
 <label>To</label><input style="width:100%" value="${esc(r.to_location)}" onchange="window.EktaTracking.editAIProgramRow(${i},'to',this.value)">
 <label>Freight (optional)</label><input style="width:100%" type="number" min="0" value="${esc(r.freight_amount??"")}" onchange="window.EktaTracking.editAIProgramRow(${i},'freight',this.value)">
 <div style="font-size:10px;color:#785b22;margin-top:5px">Driver assignment: save Program, then use Notification → Assign Driver (from Driver Master).</div>
 </div></div>`;
 }).join("")+
 `<button type="button" class="et-ai-send" onclick="window.EktaTracking.confirmAIPrograms()">Save All Selected Programs (${active.length})</button>`;
}
function toggleAIProgramEdit(i){const el=$("etAIRowEdit"+i);if(el)el.style.display=el.style.display==="none"?"block":"none"}
function toggleAIProgramRow(i){const r=aiProgramRows[i];if(!r)return;r._skip=!r._skip;showAIProgramPreview()}
function editAIProgramRow(i,k,v){const r=aiProgramRows[i];if(!r)return;
 if(k==="party")r._partyId=v;else if(k==="truck")r.truck_number=v;else if(k==="date")r.program_date=v;else if(k==="from")r.from_location=v;else if(k==="to")r.to_location=v;else if(k==="freight")r.freight_amount=v===""?null:Number(v);
 showAIProgramPreview();const el=$("etAIRowEdit"+i);if(el)el.style.display="block";
}
async function prepareProgramUpload(){
 const f=$("etProgramUpload")?.files?.[0],pasted=clean($("etProgramPaste")?.value),out=$("etAIUploadMessage");
 if(!f&&!pasted){out.textContent="Upload a sheet or paste Excel rows first.";return}
 out.textContent="Reading sheet and requesting Gemini preview… No programs saved.";
 try{
  let sheetText=pasted,fileBase64="",mimeType="";
  if(f){
   if(/\.(xlsx|xls|csv)$/i.test(f.name)){
    if(!window.XLSX)throw new Error("Excel reader could not load. Paste Excel cells instead.");
    const book=window.XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});
    sheetText=book.SheetNames.map(name=>"SHEET: "+name+"\n"+window.XLSX.utils.sheet_to_csv(book.Sheets[name],{FS:"\t"})).join("\n");
   }else{mimeType=f.type||(/\.pdf$/i.test(f.name)?"application/pdf":"image/jpeg");fileBase64=await new Promise((resolve,reject)=>{const rd=new FileReader();rd.onload=()=>resolve(String(rd.result).split(",")[1]||"");rd.onerror=reject;rd.readAsDataURL(f)})}
  }
  const result=await S.functions.invoke("gemini-chat",{body:{mode:"tracking_program_import",sheetText,fileBase64,mimeType}});
  if(result.error)throw result.error;
  if(!result.data?.success)throw new Error(result.data?.error||"Gemini extraction failed");
  aiProgramRows=(result.data.programs||[]).map(r=>({...r}));
  out.textContent=`Gemini read ${aiProgramRows.length} rows. All rows are selected by default; edit or exclude individually.`;
  showAIProgramPreview();
 }catch(err){console.error(err);out.textContent="AI import failed: "+(err.message||err)+". Nothing saved."}
}
async function confirmAIPrograms(){
 const selected=aiProgramRows.filter(r=>!r._skip),out=$("etAIUploadMessage");
 if(!selected.length){out.textContent="No rows selected.";return}
 const seen=new Set(),blocked=[];
 selected.forEach(r=>{aiRowIssues(r);if(r._truck){if(seen.has(r._truck.id))blocked.push(r.truck_number+" repeated in sheet");seen.add(r._truck.id)}
 if(!r._truck||!programDateISO(r.program_date)||!clean(r.from_location)||!clean(r.to_location)||activeTrip(r._truck?.id))blocked.push(r.truck_number+": missing truck/date/route or existing active trip")});
 if(blocked.length){out.textContent="Fix or Exclude these rows before saving: "+blocked.join("; ");return}
 if(!window.confirm(`Save ALL ${selected.length} selected Programs to Supabase, including pending Driver/Branch/Freight? Excluded rows: ${aiProgramRows.length-selected.length}.`))return;
 let saved=0,failed=[],savedRows=[];
 for(const r of selected){
  const t=r._truck,p=r._party,d=activeDriver(t.id),a=activeAssignment(t.id);
  const amt=r.freight_amount===null||r.freight_amount===undefined||clean(r.freight_amount)===""?null:Number(String(r.freight_amount).replace(/[,₹]/g,""));
  if(amt!==null&&(!Number.isFinite(amt)||amt<0)){failed.push(r.truck_number+": invalid freight");continue}
  let notes=putNote("AI Program Import","STAGE","PROGRAM");
  notes=putNote(notes,"FREIGHT_CONFIRMATION","PENDING_LR");
  notes=putNote(notes,"FREIGHT_ENTERED_AT_PROGRAM",amt===null?"NO":"YES");
  notes=putNote(notes,"BILLING_CONFIRMATION","PENDING");
  notes=putNote(notes,"AI_SOURCE_PARTY",clean(r.party_text).replace(/[\[\]]/g,""));
  notes=putNote(notes,"AI_PENDING_BRANCH",p?"NO":"YES");
  notes=putNote(notes,"AI_PENDING_DRIVER",d?"NO":"YES");
  notes=putNote(notes,"AI_REVIEW",r.needsReview?"YES":"NO");
  const base={trip_number:`ET-${new Date().getFullYear()}-${String(Date.now()+saved).slice(-7)}`,truck_id:t.id,driver_id:d?.id||null,assignment_id:a?.id||null,party_id:p?.id||null,from_location:clean(r.from_location),to_location:clean(r.to_location),loading_point:clean(r.from_location),destination:clean(r.to_location),program_date:programDateISO(r.program_date),freight_amount:amt??0,revenue:amt??0,trip_status:"Planned",start_date:null,current_location:clean(r.from_location),notes};
  try{
   let q=await S.from(T.trips).insert({...base,tracking_status:"PROGRAM"}).select().single();
   if(q.error&&(/tracking_status/i.test(q.error.message||"")||q.error.code==="23514"))q=await S.from(T.trips).insert({...base,tracking_status:"LOADING"}).select().single();
   if(q.error)throw q.error;
   await S.from(T.trucks).update({status:"PROGRAM"}).eq("id",t.id);
   saved++;savedRows.push(r);
  }catch(err){failed.push(r.truck_number+": "+(err.message||err))}
 }
 aiProgramRows=aiProgramRows.filter(r=>!savedRows.includes(r));
 showAIProgramPreview();
 out.textContent=`Saved ${saved}/${selected.length} selected Programs. ${failed.length?"Not saved: "+failed.join("; "):"All selected Programs saved."} Pending details remain in Notifications.`;
 await loadAll();
}

function openPendingProgram(id){
 const t=trips.find(x=>String(x.id)===String(id));if(!t)return alertUser("Program not found.");
 resetProgram();programEditTripId=t.id;selectedTruck=truck(t.truck_id);selectedParty=party(t.party_id);syncFleetProgramCategory();
 $("etPTruck").value=selectedTruck?.truck_number||"";$("etPDate").value=dateOnly(t.program_date)||today();
 $("etPParty").value=selectedParty?`${selectedParty.party_code||""} — ${selectedParty.name||""}`:"";
 $("etPPartyType").value=selectedParty?.party_type||"";$("etPLoad").value=t.from_location||t.loading_point||"";$("etPTo").value=t.to_location||t.destination||"";
 $("etPRevenue").value=getNote(t.notes,"FREIGHT_ENTERED_AT_PROGRAM")==="NO"?"":(t.freight_amount??"");$("etPRemark").value=clean(t.notes).replace(/\[[^\]]+\]/g,"").trim();
 $("etProgramModal").classList.add("show");
 loadProgramPartyRates().then(()=>{if(programEditTripId!==t.id)return;$("etProgramHaier").value=getNote(t.notes,"HAIER_BILLING_ARRANGEMENT")==="PENDING"?"":getNote(t.notes,"HAIER_BILLING_ARRANGEMENT");$("etProgramWeight").value=getNote(t.notes,"TRANSPORTER_WEIGHT_TON")==="PENDING"?"":getNote(t.notes,"TRANSPORTER_WEIGHT_TON");const cat=getNote(t.notes,"PROGRAM_RATE_CATEGORY");if([...$("etProgramCategory").options].some(x=>x.value===cat))$("etProgramCategory").value=cat});
}
async function savePendingProgram(e){
 e.preventDefault();
 const t=trips.find(x=>String(x.id)===String($("etPendingTripId").value));if(!t)return false;
 const partyId=$("etPendingParty").value,driverId=$("etPendingDriver").value,raw=clean($("etPendingFreight").value);
 if(raw!==""&&(!Number.isFinite(Number(raw))||Number(raw)<0)){alertUser("Invalid freight");return false}
 let notes=clean(t.notes);
 notes=putNote(notes,"AI_PENDING_BRANCH",partyId?"NO":"YES");
 notes=putNote(notes,"AI_PENDING_DRIVER",driverId?"NO":"YES");
 notes=putNote(notes,"FREIGHT_ENTERED_AT_PROGRAM",raw===""?"NO":"YES");
 const payload={party_id:partyId||null,driver_id:driverId||null,notes};
 if(raw!==""){payload.freight_amount=Number(raw);payload.revenue=Number(raw)}
 try{
  const result=await S.from(T.trips).update(payload).eq("id",t.id);
  if(result.error)throw result.error;
  closeModal("etPendingModal");await loadAll();
 }catch(err){alertUser("Could not update Program: "+(err.message||err))}
 return false;
}
function prepareEwayUpload(){
 const f=$("etEwayQuickUpload")?.files?.[0],tripId=$("etEwayQuickTrip")?.value,out=$("etEwayUploadMessage");
 if(!f){if(out)out.textContent="Please select an E-Way Bill PDF or photo.";return}
 if(!tripId){out.textContent="Select the active Trip for this E-Way Bill.";return}
 const t=ewayTripRecords().find(x=>String(x.id)===String(tripId));
 if(!t){out.textContent="Trip is no longer active. Refresh and select another Trip.";refreshUploadTrips();return}
 openEwayEdit(t.id,null);
 const target=$("etEWFile");
 if(target){try{target.files=$("etEwayQuickUpload").files}catch(e){console.warn("File handoff unavailable",e)}}
 out.textContent="E-Way entry opened. Check the attached file, enter/verify bill number and dates, then Save.";
}
/* ========================= 17. EXPORT ======================= */
function csvDownload(rows,name){const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n"),u=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"})),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(u)}
function trackingExportPlace(row){
 const g=row?.geo||{};
 const label=clean(g.label);
 if(label && label!=="Location unavailable")return label;
 const parts=[g.place,g.district,g.state].map(clean).filter(Boolean);
 return parts.length?Array.from(new Set(parts)).join(", "):"Not Available";
}
function trackingExportGPS(r){
 const l=r.loc||{},lat=Number(l.latitude),lng=Number(l.longitude);
 const coords=l.latitude!=null&&l.longitude!=null&&Number.isFinite(lat)&&Number.isFinite(lng)&&(lat!==0||lng!==0);
 const place=clean(l.location)||clean(l.address);
 return place||(coords?`${lat.toFixed(5)}, ${lng.toFixed(5)}`:"Not Available");
}
function exportTracking(){
 const category=$("etExcelCategory")?.value||"FASTAG";
 const allowed=["FASTAG","GPS","PROGRAM_DETAILS","ALL","PROGRAM","LOADING","RUNNING","REPORTING","EMPTY"];
 if(!allowed.includes(category)){alertUser("Select a valid Excel report.");return}
 const model=rowsModel();
 let headers=[],list=[],sheetName="Tracking";
 if(category==="FASTAG"){
  // The very same FASTag rows/geocoded label that power the Tracking screen.
  // No GPS/manual fallback: never mislabel another source as FASTag.
  const byTruck=new Map((etFastagRows||[]).map(r=>[String(r.t?.id),r]));
  list=model.filter(r=>byTruck.has(String(r.t.id))).map(r=>{
   const f=byTruck.get(String(r.t.id));
   return [r.t.truck_number||"",r.d?.name||"",r.d?.phone||"",r.trip?.from_location||r.trip?.loading_point||"",r.trip?.to_location||r.trip?.destination||"",trackingExportPlace(f),f.time?fmtDT(f.time):"",r.actualStage];
  });
  headers=["Truck Number","Driver Name","Driver Mobile","From","To","FASTag Last Location","FASTag Last Updated","Status"];
  sheetName="FASTag Location";
 }else if(category==="GPS"){
  list=model.map(r=>[r.t.truck_number||"",r.d?.name||"",r.d?.phone||"",r.trip?.from_location||r.trip?.loading_point||"",r.trip?.to_location||r.trip?.destination||"",trackingExportGPS(r),(r.loc?.timestamp||r.loc?.recorded_at||r.loc?.created_at)?fmtDT(r.loc.timestamp||r.loc.recorded_at||r.loc.created_at):"",r.actualStage]);
  headers=["Truck Number","Driver Name","Driver Mobile","From","To","GPS Last Location","GPS Last Updated","Status"];
  sheetName="GPS Location";
 }else if(category==="PROGRAM_DETAILS"){
  list=model.filter(r=>!!r.trip).map(r=>[r.trip.trip_number||"",r.t.truck_number||"",r.d?.name||"",r.d?.phone||"",r.p?.name||"",r.trip.from_location||r.trip.loading_point||"",r.trip.to_location||r.trip.destination||"",dateOnly(r.trip.program_date),dateOnly(r.trip.loading_date),r.actualStage,r.trip?.current_location||trackingExportGPS(r),r.trip?.expected_arrival_date?dateOnly(r.trip.expected_arrival_date):""]);
  headers=["Trip / Program No","Truck Number","Driver Name","Driver Mobile","Party","From","To","Program Date","Loading Date","Status","Current Location","Expected Arrival"];
  sheetName="Program Details";
 }else{
  const filtered=model.filter(r=>category==="ALL"||r.actualStage===category);
  if(category==="EMPTY"){
   // MT report is a truck-number-only list. Never carry forward an old trip.
   headers=["Truck Number"];
   list=filtered.map(r=>[r.t.truck_number||""]);
   sheetName="Empty MT";
  }else{
   // Full route/program/driver details for Loading, Running and Reporting.
   // ALL and PROGRAM retain the same complete set of columns.
   list=filtered.map((r,i)=>[i+1,r.trip?.trip_number||"",r.t.truck_number||"",r.d?.name||"NO DRIVER",r.d?.phone||"",r.p?.name||"",r.partyZone,r.truckZone,r.actualStage,r.trip?.from_location||r.trip?.loading_point||"",r.trip?.to_location||r.trip?.destination||"",dateOnly(r.trip?.program_date),dateOnly(r.trip?.loading_date),dateOnly(r.trip?.reporting_date),r.loc?.location||r.trip?.current_location||"",(r.loc?.timestamp||r.loc?.recorded_at)?fmtDT(r.loc.timestamp||r.loc.recorded_at):""]);
   headers=["#","Trip No","Truck No","Driver","Driver Mobile","Party","Party Zone","Truck Zone","Status","From","To","Program Date","Loading Date","Reporting Date","Current Location","Last Update"];
   sheetName=category==="ALL"?"All Vehicles":category;
  }
 }
 if(!list.length){alertUser(category==="FASTAG"?"No FASTag location data loaded. Wait for FASTag locations to appear on Tracking, then export again.":"No records available for this report.");return}
 const rows=[headers,...list],filename=`ekta-tracking-${category.toLowerCase()}-${today()}`;
 if(window.XLSX?.utils?.aoa_to_sheet&&window.XLSX?.writeFile){
  const sheet=window.XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols']=headers.map((head,i)=>({wch:Math.min(42,Math.max(15,head.length+3,...list.slice(0,150).map(r=>String(r[i]??"").length+2)))}));
  sheet['!autofilter']={ref:sheet['!ref']};
  sheet['!freeze']={xSplit:0,ySplit:1};
  const workbook=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook,sheet,sheetName);
  window.XLSX.writeFile(workbook,filename+".xlsx");
 }else{
  csvDownload(rows,filename+".csv");
  alertUser("Excel library unavailable; downloaded a CSV that opens in Excel.");
 }
}

function exportFinal(){
 const list=finalTrips();
 csvDownload([
  ["Completed Date","Trip No","Truck","Program Date","Loading Date","Party","Party Type","Party Zone","Truck Zone","Reporting Date","Unloading Date","Loading Detention","Loading Detention Charge","Unloading Detention","Unloading Detention Charge","Unloading","Other","NGT","POD"],
  ...list.map(t=>{
   const tr=truck(t.truck_id),p=party(t.party_id),l=latestLocation(t.truck_id);
   return[finalTripDate(t),t.trip_number,tr?.truck_number,dateOnly(t.program_date),dateOnly(t.loading_date),p?.name,p?.party_type,p?.zone,truckZone(t,l),
    dateOnly(t.reporting_date),dateOnly(t.unloading_date||t.end_date),loadingDetentionDays(t),loadingDetentionCharge(t),
    unloadingDetentionDays(t),unloadingDetentionCharge(t),t.unloading_charge||0,
    (t.other_charge??getNote(t.notes,"OTHER_CHARGE")??0),(t.ngt??getNote(t.notes,"NGT")??0),"PENDING"];
  })
 ],`ekta-final-report-${today()}.csv`);
}

/* ========================= 18. KEYBOARD ===================== */
let etKeyboardZone="worksheet";
function resizeTrackingWorksheet(){
 const module=$("trackingModule"),wrap=$("etRows")?.closest(".tablewrap");
 if(!module||!wrap||getComputedStyle(module).display==="none")return;
 const available=module.getBoundingClientRect().bottom-wrap.getBoundingClientRect().top-14;
 wrap.style.setProperty("--et-worksheet-height",Math.max(160,Math.floor(available))+"px");
}
function selectedKeyboardCard(){
 const cards=[...document.querySelectorAll("#trackingModule .cards [data-tracking-filter]")];
 return cards.find(c=>c.dataset.trackingFilter===filterStatus)||cards[0]||null;
}
function focusTrackingCard(){
 const card=selectedKeyboardCard();
 if(!card)return false;
 card.setAttribute("tabindex","0");
 card.focus({preventScroll:true});
 etKeyboardZone="cards";
 return true;
}
function focusTrackingWorksheet(){
 const wrap=$("etRows")?.closest(".tablewrap");
 const row=$("etRows")?.querySelector('tr[tabindex="0"]');
 if(!wrap)return false;
 etKeyboardZone="worksheet";
 if(row)row.focus({preventScroll:true});
 else {wrap.setAttribute("tabindex","0");wrap.focus({preventScroll:true});}
 return true;
}
function scrollTrackingByArrow(e){
 if(!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key))return;
 if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
 const module=$("trackingModule");
 if(!module||getComputedStyle(module).display==="none")return;
 if(document.querySelector("#trackingModule .modal.show, #trackingModule .fullpage.show"))return;
 if(e.target.closest("input,textarea,select,button,[contenteditable],[role=combobox]"))return;
 const card=e.target.closest("#trackingModule .cards [data-tracking-filter]");
 if(card||etKeyboardZone==="cards"&&!e.target.closest("#etRows")){
  if(e.key==="ArrowUp"){
   const search=$("etSearch");
   if(search){e.preventDefault();search.focus({preventScroll:true});etKeyboardZone="search";}
   return;
  }
  if(e.key==="ArrowDown"){
   if(focusTrackingWorksheet())e.preventDefault();
   return;
  }
  const cards=[...module.querySelectorAll(".cards [data-tracking-filter]")];
  const current=card||selectedKeyboardCard();
  const index=cards.indexOf(current);
  if(index<0||!cards.length)return;
  const next=cards[(index+(e.key==="ArrowLeft"?-1:1)+cards.length)%cards.length];
  if(next){next.setAttribute("tabindex","0");next.focus({preventScroll:true});etKeyboardZone="cards";next.click();e.preventDefault();}
  return;
 }
 const wrap=$("etRows")?.closest(".tablewrap");if(!wrap)return;
 // First row / top of worksheet goes to selected status card, not straight to Search.
 if(e.key==="ArrowUp"&&wrap.scrollTop<=2){
  if(focusTrackingCard())e.preventDefault();
  return;
 }
 const amount=(e.key==="ArrowDown"||e.key==="ArrowRight")?110:-110;
 if(e.key==="ArrowUp"||e.key==="ArrowDown")wrap.scrollBy({top:amount,behavior:"auto"});
 else wrap.scrollBy({left:amount,behavior:"auto"});
 e.preventDefault();
}
function clearTrackingSearchAfterSave(){
 const search=$("etSearch");
 if(search&&search.value){search.value="";render();}
}
function rowKey(e,id){
 if(e.key==="Enter"){e.preventDefault();openTruck(id);return}
 scrollTrackingByArrow(e);
}

/* ========================= 19. DATE / EVENTS =============== */
function setupEvents(){
 // Search -> selected Status Card -> Working Table.
 $("etSearch")?.addEventListener("keydown",e=>{
  if(e.key!=="ArrowDown"||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
  if(document.querySelector("#trackingModule .modal.show, #trackingModule .fullpage.show"))return;
  if(focusTrackingCard())e.preventDefault();
 });
 window.addEventListener("resize",resizeTrackingWorksheet);
 document.addEventListener("pointerdown",e=>{
  if(e.target.closest("#trackingModule .cards"))etKeyboardZone="cards";
  else if(e.target.closest("#trackingModule .et-tracking-fullwidth"))etKeyboardZone="worksheet";
 });
 document.addEventListener("pointerdown",e=>{
  const panel=$("etBellPanel"),ai=$("etAIPanel");
  if(panel?.classList.contains("show")&&!panel.contains(e.target)&&!$("etBellBtn")?.contains(e.target)){
   panel.classList.remove("show");$("etBellBtn")?.setAttribute("aria-expanded","false");
  }
  if(ai?.classList.contains("show")&&!ai.contains(e.target)&&!$("etAIBtn")?.contains(e.target)){
   ai.classList.remove("show");$("etAIBtn")?.setAttribute("aria-expanded","false");
  }
 });
 $("etLDate")?.addEventListener("change",updateLoadingAttention);$("etUDate")?.addEventListener("change",updateUnloadingAttention);document.addEventListener("click",e=>{if(!e.target.closest("#trackingModule .typeahead")){document.querySelectorAll("#trackingModule .suggestions").forEach(x=>x.classList.remove("show"))}});document.addEventListener("keydown",e=>{
 if(e.key==="Escape")document.querySelector("#trackingModule .modal.show")?.classList.remove("show");
 // Row keydown already handles arrows when a row is focused.
 if(e.target.closest("#etRows tr[tabindex]"))return;
 scrollTrackingByArrow(e);
})}
function setupAutoRateInputs(){
 setupProgramLocationAutocomplete();
 ["etProgramCategory","etProgramHaier"].forEach(id=>$(id)?.addEventListener("change",suggestProgramFreight));
 ["etPLoad","etPTo","etPDate"].forEach(id=>$(id)?.addEventListener("change",suggestProgramFreight));
 $("etPRevenue")?.addEventListener("input",()=>{$("etPRevenue").dataset.autoRate="no"});
}
// Search individual words across code, company name, branch and city.
// Example: "315 noida", "haier pune", "315_unit_pune".
function partySearchTokens(value){return clean(value).toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(Boolean)}
function partySearchMatch(p,query){
 const words=partySearchTokens(query);
 const text=partySearchTokens([p.party_code,p.name,p.party_type,p.city,p.zone].join(" ")).join(" ");
 const compact=text.replace(/ /g,"");
 return words.every(w=>text.includes(w)||compact.includes(w));
}
function partySearchRank(p,query){
 const q=clean(query).toLowerCase(),code=clean(p.party_code).toLowerCase(),name=clean(p.name).toLowerCase(),city=clean(p.city).toLowerCase();
 const tokens=partySearchTokens(q),codeBase=code.split(/[^a-z0-9]+/)[0];
 let rank=0;
 if(q===code||q===name)rank+=100;
 if(tokens.includes(codeBase))rank+=50;
 if(tokens.some(t=>city===t))rank+=35;
 if(tokens.some(t=>name.startsWith(t)))rank+=15;
 if(code.startsWith(q))rank+=10;
 return rank;
}
function setupTypeaheads(){
 const ti=$("etPTruck"),tb=$("etTruckSuggestions"),pi=$("etPParty"),pb=$("etPartySuggestions");
 ti?.addEventListener("input",()=>{
  selectedTruck=null;$("etPLoad").value="";syncFleetProgramCategory();
  const q=clean(ti.value).toLowerCase();
  const m=trucks.filter(t=>!activeTrip(t.id)&&activeDriver(t.id)).filter(t=>String(t.truck_number||"").toLowerCase().includes(q)).slice(0,12);
  tb.innerHTML=m.map(t=>`<div class="suggestion" data-id="${esc(t.id)}"><b>${esc(t.truck_number)}</b><span>Driver: ${esc(activeDriver(t.id)?.name||"NO DRIVER")}</span></div>`).join("");
  tb.classList.toggle("show",m.length>0);
  tb.querySelectorAll(".suggestion").forEach(x=>x.onclick=()=>{
   selectedTruck=truck(x.dataset.id);ti.value=selectedTruck.truck_number;
   fillProgramLoadingPoint(selectedTruck.id);syncFleetProgramCategory();tb.classList.remove("show");suggestProgramFreight();
  });
 });
 pi?.addEventListener("keydown",programPartyKeydown);
 pi?.addEventListener("input",()=>{
  selectedParty=null;
  const q=clean(pi.value);
  const m=parties.filter(p=>clean(p.status||"Active").toLowerCase()!=="inactive")
   .filter(p=>partySearchMatch(p,q))
   .sort((a,b)=>partySearchRank(b,q)-partySearchRank(a,q)||clean(a.party_code).localeCompare(clean(b.party_code))||clean(a.city).localeCompare(clean(b.city)))
   .slice(0,30);
  pb.innerHTML=m.map(p=>`<div class="suggestion" data-id="${esc(p.id)}"><b>${esc(p.party_code||"—")} — ${esc(p.name||"")}</b><span>${esc(p.party_type||"")} • ${esc(p.zone||"—")} • ${esc(p.city||"")}</span></div>`).join("");
  pb.classList.toggle("show",m.length>0);
  pb.dataset.activeIndex="-1";
  pb.querySelectorAll(".suggestion").forEach(x=>x.onclick=()=>selectProgramPartySuggestion(x));
 });
}

/* Program party autocomplete: keyboard selection without changing existing mouse behavior. */
function selectProgramPartySuggestion(item){
 const pi=$("etPParty"),pb=$("etPartySuggestions");
 selectedParty=party(item.dataset.id);
 if(!selectedParty)return;
 pi.value=`${selectedParty.party_code||""} — ${selectedParty.name||""}`;
 $("etPPartyType").value=selectedParty.party_type||"";
 // Keep the truck's last unloading point (or any manual edit); party selection must not overwrite From.
 pb.classList.remove("show");pb.dataset.activeIndex="-1";
 loadProgramPartyRates();
}
function programPartyKeydown(e){
 const pb=$("etPartySuggestions");
 if(!pb?.classList.contains("show"))return;
 const items=[...pb.querySelectorAll(".suggestion")];
 if(e.key==="Escape"){e.preventDefault();pb.classList.remove("show");return;}
 if(!items.length||!["ArrowDown","ArrowUp","Enter"].includes(e.key))return;
 e.preventDefault();e.stopPropagation();
 let index=Number(pb.dataset.activeIndex??-1);
 if(e.key==="Enter"){selectProgramPartySuggestion(items[index<0?0:index]);return;}
 index=e.key==="ArrowDown"?Math.min(index+1,items.length-1):index<0?items.length-1:Math.max(index-1,0);
 pb.dataset.activeIndex=String(index);
 items.forEach((item,i)=>{item.classList.toggle("et-key-active",i===index);item.setAttribute("aria-selected",String(i===index));});
 items[index].scrollIntoView({block:"nearest"});
}

/* Edit a lifecycle date on the existing trip; never move its stage backwards. */
async function editProgramStageDate(stage){
 if(!programEditTripId)return alertUser("पहले existing trip को Edit में खोलें। New Program में stage बदलना उपलब्ध नहीं है।");
 const t=trips.find(x=>String(x.id)===String(programEditTripId));
 if(!t)return alertUser("Trip not found.");
 const fields={LOADING:["loading_date","Loading Date"],RUNNING:["lr_date","LR / Running Date"],REPORTING:["reporting_date","Reporting Date"],EMPTY:["unloading_date","Unloading Date"]};
 if(stage==="PROGRAM")return $("etPDate")?.focus();
 const entry=fields[stage];if(!entry)return;
 const [field,label]=entry;
 const existing=dateOnly(t[field]||(field==="lr_date"?t.loading_date:field==="unloading_date"?t.end_date:null));
 if(!existing)return alertUser(label+" अभी दर्ज नहीं है। पहले normal stage action से दर्ज करें।");
 const d=await quickDateForTrip(t,"Correct "+label,existing,true);if(!d||d===existing)return;
 const lr=dateOnly(field==="lr_date"?d:(t.lr_date||t.loading_date));
 const reporting=dateOnly(field==="reporting_date"?d:t.reporting_date);
 const unloading=dateOnly(field==="unloading_date"?d:(t.unloading_date||t.end_date));
 if(lr&&reporting&&reporting<lr)return alertUser("Reporting Date cannot be before LR Date.");
 if(reporting&&unloading&&unloading<reporting)return alertUser("Unloading Date cannot be before Reporting Date.");
 const payload={notes:putNote(t.notes,field==="lr_date"?"LR_DATE":field.toUpperCase(),d)};
 payload[field]=d;
 if(field==="lr_date"){payload.loading_date=d;payload.start_date=d;payload.notes=putNote(payload.notes,"LOADING_DATE",d);}
 if(field==="loading_date"&&dateOnly(t.lr_date)===existing){payload.lr_date=d;payload.start_date=d;payload.notes=putNote(payload.notes,"LR_DATE",d);}
 if(field==="unloading_date")payload.end_date=d;
 if(!window.confirm(`${t.trip_number||"Trip"}\n${label}: ${fmt(existing)} → ${fmt(d)}\nSave correction?`))return;
 try{
  const r=await S.from(T.trips).update(payload).eq("id",t.id);
  if(r.error)throw r.error;
  await loadAll();
  alertUser(label+" corrected successfully. Trip status unchanged.");
 }catch(err){console.error("[EKTA] Date correction failed",err);alertUser("Date correction failed: "+(err.message||err));}
}

/* ========================= 20. FULL SCREEN ================== */
async function closeTracking(){
 closeAllModals();
 closeFinal();
 document.body.style.overflow="";
 try{
  if(typeof window.loadDefaultDashboardHome==="function"){await window.loadDefaultDashboardHome();return}
  if(typeof window.loadModule==="function"){await window.loadModule("dashboard-home.html");return}
  if($("trackingModule"))$("trackingModule").style.display="none";
  console.warn("[EKTA TRACKING] Dashboard loader was not found.")
 }catch(e){
  console.error("[EKTA TRACKING] Dashboard return failed:",e);
  if($("trackingModule"))$("trackingModule").style.display="none";
 }
}
function refresh(){loadAll()}


/* =============== QUICK DRIVER ASSIGNMENT (Driver Master compatible) =============== */
function quickDriverPhoneChanged(){
 const phone=clean($("etAssignPhone")?.value).replace(/\D/g,"");
 const found=drivers.find(d=>clean(d.phone).replace(/\D/g,"").slice(-10)===phone&&phone.length===10);
 const name=$("etAssignName"),hint=$("etAssignHint");
 if(found){name.value=found.name||"";name.readOnly=true;if(hint)hint.textContent=`Existing Driver Master: ${found.driver_code||""} — will assign without creating a duplicate.`;}
 else{name.readOnly=false;if(hint)hint.textContent="New driver: next DRV number will be generated using Driver Master numbering.";}
}
function openAssignDriver(truckId){
 const t=truck(truckId);if(!t)return alertUser("Truck not found.");
 if(activeAssignment(truckId))return alertUser("This truck already has an active driver.");
 $("etAssignTruckId").value=t.id;$("etAssignTruckNumber").value=t.truck_number||"";
 $("etAssignPhone").value="";$("etAssignName").value="";$("etAssignName").readOnly=false;
 $("etAssignHint").textContent="Existing mobile number will reuse the Driver Master record. New drivers receive the next DRV code.";
 $("etAssignDriverModal").classList.add("show");$("etAssignPhone").focus();
}
function nextQuickDriverCode(list){
 let max=0;for(const d of list){const m=clean(d.driver_code).toUpperCase().match(/^DRV(\d+)$/);if(m)max=Math.max(max,Number(m[1])||0);}
 return "DRV"+String(max+1).padStart(3,"0");
}
async function saveQuickDriverAssignment(e){
 e?.preventDefault();
 const truckId=clean($("etAssignTruckId")?.value),name=clean($("etAssignName")?.value),phone=clean($("etAssignPhone")?.value);
 if(!truck(truckId))return false;
 if(!/^\d{10}$/.test(phone)){alertUser("Enter a valid 10-digit mobile number.");return false;}
 if(!name){alertUser("Enter driver name.");return false;}
 const btn=$("etAssignSaveBtn");if(btn?.disabled)return false;
 if(btn)btn.disabled=true;
 try{
  // Recheck from the database immediately before saving, not only the page cache.
  const [driverResult,assignmentResult]=await Promise.all([
   S.from(T.drivers).select("id,driver_code,name,phone,status"),
   S.from(T.assignments).select("id,truck_id,driver_id,status")
  ]);
  if(driverResult.error)throw driverResult.error;
  if(assignmentResult.error)throw assignmentResult.error;
  const allDrivers=driverResult.data||[],allAssignments=assignmentResult.data||[];
  if(allAssignments.some(a=>String(a.truck_id)===String(truckId)&&clean(a.status).toLowerCase()==="active"))throw new Error("This truck already has an active driver assignment.");
  let d=allDrivers.find(x=>clean(x.phone).replace(/\D/g,"").slice(-10)===phone);
  if(d&&clean(d.status).toLowerCase()!=="active")throw new Error("This driver is inactive. Activate them in Driver Master first.");
  if(d&&clean(d.name).toLowerCase()!==name.toLowerCase())throw new Error("This mobile belongs to "+d.name+". Please use the existing Driver Master name.");
  if(d&&allAssignments.some(a=>String(a.driver_id)===String(d.id)&&clean(a.status).toLowerCase()==="active"))throw new Error("This driver is already assigned to another truck.");
  if(!d){
   const code=nextQuickDriverCode(allDrivers);
   const ins=await S.from(T.drivers).insert({driver_code:code,name,phone,status:"Active"}).select("id,driver_code,name,phone,status").single();
   if(ins.error)throw new Error("Driver Master save failed: "+ins.error.message);
   d=ins.data;
  }
  const assigned=await S.from(T.assignments).insert({truck_id:truckId,driver_id:d.id,assigned_from:today(),assigned_until:null,status:"Active",notes:null}).select("id").single();
  if(assigned.error)throw new Error("Assignment failed: "+assigned.error.message+". If a new driver was created, it remains in Driver Master; retry assignment without creating another driver.");
  closeModal("etAssignDriverModal");
  await loadAll();
  alertUser(`${d.name} (${d.driver_code}) assigned to ${truck(truckId)?.truck_number||"truck"}.`);
 }catch(err){console.error("[EKTA TRACKING] Quick driver assignment:",err);alertUser(err.message||"Driver assignment failed.");}
 finally{if(btn)btn.disabled=false;}
 return false;
}

/* ========================= 21. PUBLIC API =================== */
window.EktaTracking={sendStatusNotification,openAssignDriver,quickDriverPhoneChanged,saveQuickDriverAssignment,startBreakdown,resolveBreakdown,openPendingProgram,savePendingProgram,toggleAIProgramEdit,toggleAIProgramRow,editAIProgramRow,openTripBilling,suggestBillingParty,saveTripBilling,init:()=>{},render,refresh,toggleHeaderPanel,previewAIUpload,prepareProgramUpload,confirmAIPrograms,prepareEwayUpload,approveDriverRequest,openDriverProgramRequest,rejectDriverProgramRequest,setStatusFilter,resetFilters,shiftDate,setToday,viewAllTracking,openProgram,openProgramForTruck,editProgramStageDate,openQuickProgram,closeQuickProgram,continueQuickProgram,saveProgram,openTripAction,quickNextStage,confirmLoading,confirmLR,confirmReporting,confirmUnloading,openTruck,cancelProgram,selectTruck,rowKey,openEwayRecords,openEwaySmartEntry,readEwayPastedText,saveEwayRecord,openHistoryRecords,renderHistoryRecords,openFinalReport,closeFinal,renderFinal,finalAll,finalDateChanged,saveDetentionCharge,finalShift,finalToday,sendSelectedDateToPOD,exportTracking,exportFinal,closeModal,closeTracking,refreshMap,openSelectedInGoogleMaps,openFleetMap,closeFleetMap,refreshFleetMap,openFastagMap,closeFastagMap,refreshFastagMap,renderFastagVehicleList,setFastagListFilter,selectFastagVehicle,showAllFastagVehicles,setFastagHistoryRange,applyFastagCustomHistory,focusFastagVisit,openSelectedMapFullScreen,closeSelectedMapFullScreen,setFleetFilter,renderFleetVehicleList,selectFleetVehicle,focusFleetRoute,setFleetHistoryRange,applyFleetCustomHistory,showAllFleetVehicles,fleetViewRoad,fleetViewStreet,fleetViewSatellite,closeEwayPage,refreshEwayPage,ewayToday,renderEwayPage,toggleEwayMenu,openEwayTripDetails,openEwayEdit,addEwayBillRow,removeEwayBillRow,toggleEwayBills,tryEwayAIRead,openEwayDocument,openManualLocation,showLocationSuggestions,chooseLocationSuggestion,saveManualLocation,openFinalView,openFinalEdit,saveInlineFinalEdit,cancelInlineFinalEdit,refreshInlineFinalDerived,openQuickParty,saveQuickParty,scrollActivePage,quickPartyAutoZone};

/* ========================= 22. INIT ========================= */
function init(){$("trackingModule").style.display="block";document.body.style.overflow="hidden";/* Preserve the operator-selected card if host reinitializes Tracking. */if(trackingInitialized){render();return;}trackingInitialized=true;filterStatus=filterStatus||"";selectedMap=null;if($("etSearch"))$("etSearch").value="";if($("etStatusFilter"))$("etStatusFilter").value="";if($("etZoneFilter"))$("etZoneFilter").value="";if($("etDriverFilter"))$("etDriverFilter").value="";if($("etDate"))$("etDate").value=today();setupTypeaheads();setupAutoRateInputs();setupEvents();loadAll();
 let lastToday=today();setInterval(()=>{const now=today();if(now!==lastToday){if($("etDate")?.value===lastToday)$("etDate").value=now;lastToday=now;}if($("trackingModule")?.style.display!=="none")render();},60000);
}
init();
})();
