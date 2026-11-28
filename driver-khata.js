/* Ekta Transport Driver Khata V2 — Card 1 only. Read-only Supabase queries.
   Opening KM is a browser-only draft, NOT a database entry. No writes or RLS changes. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const L={en:{header:'Driver Khata',back:'← Back to Dashboard',title:'Driver Khata',subtitle:'Card 1 — Truck & Driver Record',card:'01 — Truck & Driver Record',desc:'Truck, driver, joining/leaving dates from existing ERP records. Opening KM can be entered for review.',truckFilter:'Truck Number',driverFilter:'Driver Name',refresh:'Refresh',truck:'Truck Number',driver:'Driver Name',driverId:'Driver ID',phone:'Phone Number',joined:'Joined Date',left:'Left Date',opening:'Opening KM',status:'Status',hint:'Opening values are saved to Supabase using Save. Assignment dates are displayed only when available in the existing history.',allTrucks:'All Trucks',allDrivers:'All Drivers',active:'Current',previous:'Previous',unknown:'Not recorded',none:'No assignment records found for these filters.',ready:'Assignment history loaded (read-only).',missing:'Assignment history is unavailable. No dates have been inferred.',db:'Supabase connection unavailable. Check db.js.'},hi:{header:'ड्राइवर खाता',back:'← डैशबोर्ड पर वापस',title:'ड्राइवर खाता',subtitle:'कार्ड 1 — गाड़ी और ड्राइवर रिकॉर्ड',card:'01 — गाड़ी और ड्राइवर रिकॉर्ड',desc:'ERP के रिकॉर्ड से गाड़ी, ड्राइवर और चढ़ने/उतरने की तारीख। Opening KM जाँच के लिए भर सकते हैं।',truckFilter:'गाड़ी नंबर',driverFilter:'ड्राइवर का नाम',refresh:'रिफ्रेश',truck:'गाड़ी नंबर',driver:'ड्राइवर',driverId:'ड्राइवर आईडी',phone:'मोबाइल नंबर',joined:'चढ़ने की तारीख',left:'उतरने की तारीख',opening:'ओपनिंग KM',status:'स्थिति',hint:'Opening values Save बटन से Supabase में सेव होंगी। तारीख केवल मौजूदा हिस्ट्री में उपलब्ध होने पर दिखाई जाएगी।',allTrucks:'सभी गाड़ियाँ',allDrivers:'सभी ड्राइवर',active:'वर्तमान',previous:'पुराना',unknown:'रिकॉर्ड नहीं',none:'इस फ़िल्टर के लिए कोई असाइनमेंट रिकॉर्ड नहीं मिला।',ready:'असाइनमेंट हिस्ट्री लोड हो गई (सिर्फ पढ़ने के लिए)।',missing:'असाइनमेंट हिस्ट्री उपलब्ध नहीं है। तारीख अनुमान से नहीं भरी गई।',db:'Supabase कनेक्शन उपलब्ध नहीं है। db.js जाँचें।'}};
let lang='en',trucks=[],drivers=[],assignments=[],failed=false;
const photoUrls=new Map(); // Signed URLs from the existing Driver Master document storage.

const dict=()=>L[lang], esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pick=(obj,keys)=>{for(const k of keys)if(obj?.[k]!==undefined&&obj[k]!==null&&obj[k]!=='')return obj[k];return null};
const truckName=t=>pick(t,['truck_number','vehicle_number','registration_number','number'])||String(t?.id||'—');
const driverName=d=>pick(d,['name','driver_name','full_name'])||String(d?.id||'—');
const driverIdentifier=d=>pick(d,['driver_code','driver_id','employee_code','code','id'])||'—';
const driverPhone=d=>pick(d,['phone','phone_number','mobile','mobile_number','contact_number','contact_no','driver_phone','driver_mobile'])||'—';
const date=v=>v?String(v).slice(0,10):'—';
const client=()=>[window.supabaseClient,window.ektaSupabaseClient,window.dbClient].find(c=>c&&typeof c.from==='function');
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error)}
function setLang(next){lang=next;document.documentElement.lang=next;document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=dict()[el.dataset.i18n]);$('langEn').classList.toggle('active',next==='en');$('langHi').classList.toggle('active',next==='hi');fillOptions();render();if(!failed)notice(dict().ready)}
function fillOptions(){
 $('truckSuggestions').innerHTML=trucks.map(t=>'<option value="'+esc(truckName(t))+'"></option>').join('');
 $('driverSuggestions').innerHTML=drivers.map(d=>'<option value="'+esc(driverName(d))+'"></option>').join('');
 $('truckSelect').placeholder=lang==='hi'?'गाड़ी नंबर टाइप करें…':'Type truck number…';
 $('driverSelect').placeholder=lang==='hi'?'ड्राइवर नाम / ID टाइप करें…':'Type driver name / ID…';
}
const photoOf=d=>{const saved=photoUrls.get(String(d?.id));if(saved)return saved;const v=pick(d,['photo_url','profile_photo_url','driver_photo_url','profile_image_url','avatar_url','image_url','photo','profile_photo','driver_photo']);return typeof v==='string'&&/^https:\/\//i.test(v)?v:null};
const initials=d=>driverName(d).trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'?';
function driverCell(d){const p=photoOf(d);const avatar=p?'<img class="driver-avatar" src="'+esc(p)+'" alt="" loading="lazy">':'<span class="driver-avatar" aria-hidden="true">'+esc(initials(d))+'</span>';return '<span class="driver-cell">'+avatar+'<span>'+esc(driverName(d))+'</span></span>'}
const openings=new Map(); let openingReady=false;
const openingTable='driver_khata_vehicle_openings';
function openingKey(a){return 'truck:'+a.truck_id}
async function loadOpenings(){openingReady=false;const rows=await readAll(openingTable);openings.clear();for(const r of rows)openings.set(r.assignment_id,r);openingReady=true;}
async function saveOpenings(rows){if(!openingReady)throw Error('Opening table not loaded. Refresh after SQL setup.');const {data,error}=await client().from(openingTable).upsert(rows,{onConflict:'assignment_id'}).select('*');if(error)throw Error(error.message);if(!data||data.length!==rows.length)throw Error('Save not confirmed. Refresh and verify database.');await loadOpenings();for(const r of rows){const s=openings.get(r.assignment_id);if(!s||Object.keys(r).some(k=>String(s[k])!==String(r[k])))throw Error('Read-back mismatch: '+r.assignment_id);} }
function openingPayload(a,values){return {assignment_id:openingKey(a),truck_id:a.truck_id,driver_id:a.driver_id||null,...values};}
function openingValue(a,k){const r=openings.get(openingKey(a));if(!r)return '';if(['opening_advance','opening_fix_kharcha'].includes(k)&&String(r.driver_id)!==String(a.driver_id))return '';return r[k]??'';}
function vehicleRows(){return [...assignments,...trucks.filter(t=>!assignments.some(a=>String(a.truck_id)===String(t.id)&&!pick(a,['unassigned_at','end_date','to_date','left_at','released_at']))).map(t=>({id:'unassigned:'+t.id,truck_id:t.id,driver_id:null}))];}
const optionalNumber=v=>String(v).trim()===''?null:Number(String(v).replace(/,/g,''));
function render(){
 const truckQ=$('truckSelect').value.trim().toLowerCase(),driverQ=$('driverSelect').value.trim().toLowerCase();
 const truckMap=new Map(trucks.map(t=>[String(t.id),t])),driverMap=new Map(drivers.map(d=>[String(d.id),d]));
 const filtered=vehicleRows().filter(a=>{
   const t=truckMap.get(String(a.truck_id)),d=driverMap.get(String(a.driver_id));
   return (!truckQ||truckName(t).toLowerCase().includes(truckQ))&&(!driverQ||driverName(d).toLowerCase().includes(driverQ)||String(driverIdentifier(d)).toLowerCase().includes(driverQ));
 });
 $('rows').innerHTML=filtered.map(a=>{
   const d=driverMap.get(String(a.driver_id));
   const joined=pick(a,['assigned_at','start_date','from_date','joined_at','assignment_date','created_at']);
   const left=pick(a,['unassigned_at','end_date','to_date','left_at','released_at']);
   const status=left?'previous':'active';
   const key='ekta-dk-v2-km:'+String(a.id??(a.truck_id+'-'+a.driver_id+'-'+joined));
   let km=openingValue(a,'opening_km');
   return '<tr><td>'+esc(truckName(truckMap.get(String(a.truck_id))))+'</td><td>'+(d?driverCell(d):'No driver')+'</td><td>'+esc(driverIdentifier(d))+'</td><td>'+esc(driverPhone(d))+'</td><td>'+esc(date(joined))+'</td><td>'+esc(date(left))+'</td><td><input type="number" min="0" step="1" class="km" data-key="'+esc(key)+'" value="'+esc(km)+'" placeholder="KM" aria-label="Opening KM" data-field="opening_km"></td><td><input type="number" step="0.01" data-field="opening_diesel" value="'+esc(openingValue(a,"opening_diesel"))+'"></td><td><input type="number" step="0.01" data-field="opening_advance" value="'+esc(openingValue(a,"opening_advance"))+'"></td><td><input type="number" min="0" step="0.01" data-field="opening_fix_kharcha" value="'+esc(openingValue(a,"opening_fix_kharcha"))+'"></td><td><input type="date" data-field="opening_date" value="'+esc(openingValue(a,"opening_date"))+'"></td><td><button type="button" class="primary" data-opening-save="'+esc(key)+'">Save</button></td><td><span class="tag '+(status==='previous'?'old':'')+'">'+esc(dict()[status])+'</span></td></tr>';
 }).join('')||'<tr><td class="empty" colspan="13">'+esc(dict().none)+'</td></tr>';
}
// Driver Master stores photos in driver_documents, not in drivers.photo_url.
// Read-only lookup, using the same storage bucket and signed URL flow as drivers.js.
async function loadDriverPhotos(){
 const db=client();if(!db)return;
 try{
  const docs=[];
  for(let offset=0;offset<10000;offset+=500){
   const {data,error}=await db.from('driver_documents')
     .select('driver_id,document_type,storage_path,created_at')
     .eq('document_type','photo')
     .order('created_at',{ascending:false})
     .range(offset,offset+499);
   if(error)throw error;
   docs.push(...(data||[]));
   if((data||[]).length<500)break;
  }
  const latest=new Map();
  for(const d of docs){const id=String(d.driver_id??'');if(id&&!latest.has(id)&&d.storage_path)latest.set(id,d.storage_path)}
  const entries=[...latest.entries()].filter(([id])=>drivers.some(d=>String(d.id)===id));
  // Small concurrent batches prevent flooding Storage with signed-URL requests.
  for(let i=0;i<entries.length;i+=8){
   await Promise.all(entries.slice(i,i+8).map(async([id,path])=>{
    try{
     const {data,error}=await db.storage.from('driver-documents').createSignedUrl(path,3600);
     if(!error&&data?.signedUrl)photoUrls.set(id,data.signedUrl);
    }catch(e){console.warn('[Driver Khata] Photo URL unavailable:',id,e)}
   }));
  }
  render();
 }catch(e){console.warn('[Driver Khata] Driver photos could not be loaded:',e)}
}
async function readAll(table){const out=[];for(let i=0;i<20000;i+=500){const {data,error}=await client().from(table).select('*').range(i,i+499);if(error)throw Error(table+': '+error.message);out.push(...(data||[]));if((data||[]).length<500)break}return out}
async function load(){if(!client()){failed=true;notice(dict().db,true);return}notice('Loading…');try{const results=await Promise.allSettled(['trucks','drivers','truck_driver_assignments'].map(readAll));if(results[0].status==='rejected'||results[1].status==='rejected')throw Error([results[0],results[1]].filter(r=>r.status==='rejected').map(r=>r.reason.message).join('; '));trucks=results[0].value.sort((a,b)=>truckName(a).localeCompare(truckName(b)));drivers=results[1].value.sort((a,b)=>driverName(a).localeCompare(driverName(b)));failed=results[2].status==='rejected';assignments=failed?[]:results[2].value;fillOptions();try{await loadOpenings()}catch(e){render();notice("Opening database unavailable: "+e.message,true);return}render();void loadDriverPhotos();notice(failed?dict().missing+' '+results[2].reason.message:dict().ready,failed)}catch(e){failed=true;notice(e.message,true)}}
$('langEn').onclick=()=>setLang('en');$('langHi').onclick=()=>setLang('hi');$('refreshBtn').onclick=load;$('truckSelect').oninput=render;$('driverSelect').oninput=render;$('rows').addEventListener('click',async e=>{const b=e.target.closest('[data-opening-save]');if(!b)return;const a=vehicleRows().find(a=>kmDraftKey(a)===b.dataset.openingSave);if(!a)return;const row=b.closest('tr'),v=k=>row.querySelector('[data-field="'+k+'"]').value;const raw=[v('opening_km'),v('opening_diesel'),v('opening_advance'),v('opening_fix_kharcha')];if((!raw[0]||raw.some(x=>x!==''&&!Number.isFinite(Number(x))))||(raw[3]!==''&&Number(raw[3])<0)||Number(raw[0])<0||!Number.isInteger(Number(raw[0]))||!v('opening_date')){notice('Enter valid KM and opening date; diesel and advance may be blank.',true);return}if(!confirm('Save or replace opening values for this vehicle?'))return;b.disabled=true;try{await saveOpenings([openingPayload(a,{opening_km:Number(raw[0]),opening_diesel:optionalNumber(raw[1]),opening_advance:optionalNumber(raw[2]),opening_fix_kharcha:optionalNumber(raw[3]),opening_date:v('opening_date')})]);render();notice('Opening saved and verified in Supabase.')}catch(e){notice(e.message,true)}finally{b.disabled=false}});load();

// Opening KM bulk import: spreadsheet is parsed locally; only confirmed matches enter localStorage drafts.
let kmImportMatches=[];
const kmNorm=v=>String(v??'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const kmHeader=v=>String(v??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const kmField=(row,keys)=>{for(const k of keys){if(row[k]!==undefined&&row[k]!==null&&String(row[k]).trim()!=='')return row[k]}return ''};
const kmHeaders={truck:['trucknumber','truckno','vehiclenumber','vehicleno','registrationnumber','gadinumber','truck'],driver:['driverid','drivercode','drivername','driver'],diesel:['dieselopeningl','dieselopening','openingdiesel','openingdiesell'],advance:['advanceopening','openingadvance','advanceopeningrs'],fix:['openingfixkharcha','openingfixkharchars','fixkharchaopening'],km:['openingkm','openingreading','openingkilometer','openingkilometre','startkm','initialkm','kmreading']};
function kmImportText(key){const hi=lang==='hi';return ({importTitle:hi?'Excel से Opening KM भरें':'Import Excel — Opening KM',importHelp:hi?'Excel/CSV में Truck Number और Opening KM रखें। वर्तमान ड्राइवर अपने आप चुना जाएगा। तीनों Opening values की जाँच करके सेव करें।':'Excel/CSV: Vehicle Number / Truck Number and KM Reading / Opening KM. Header row is detected automatically. Preview all three values before saving to Supabase.',importRead:hi?'Excel पढ़ें':'Read Excel',importApply:hi?'Opening सेव करें':'Save All Openings',importCancel:hi?'रद्द करें':'Cancel'})[key]}
function kmTranslate(){document.querySelectorAll('.km-import [data-i18n]').forEach(el=>{const t=kmImportText(el.dataset.i18n);if(t)el.textContent=t})}
$('langEn').addEventListener('click',kmTranslate);$('langHi').addEventListener('click',kmTranslate);
function kmDraftKey(a){const joined=pick(a,['assigned_at','start_date','from_date','joined_at','assignment_date','created_at']);return 'ekta-dk-v2-km:'+String(a.id??(a.truck_id+'-'+a.driver_id+'-'+joined))}
// Match by truck first, then its current assignment. Historical drivers never receive a new import.
function kmCurrentAssignment(matches){
 const current=matches.filter(a=>!pick(a,['unassigned_at','end_date','to_date','left_at','released_at']));
 if(!current.length)return {error:'No current driver assignment'};
 const joined=a=>String(pick(a,['assigned_at','start_date','from_date','joined_at','assignment_date','created_at'])||'');
 current.sort((a,b)=>joined(b).localeCompare(joined(a)));
 if(current.length>1&&joined(current[0])===joined(current[1])&&String(current[0].driver_id)!==String(current[1].driver_id))
  return {error:'Multiple current drivers with same joining date — review'};
 return {assignment:current[0]};
}
function kmParseRows(rows){
 // Real Ekta opening registers contain a title, notes and blank rows before the headings.
 // Locate the actual header; do not mistake Diesel/Advance Opening for Opening KM.
 let headerIndex=-1,idx={};
 for(let i=0;i<Math.min(rows.length,35);i++){
  const header=(rows[i]||[]).map(kmHeader),candidate={};
  for(const [key,aliases] of Object.entries(kmHeaders))candidate[key]=header.findIndex(h=>aliases.includes(h));
  if(candidate.truck>=0&&candidate.km>=0){headerIndex=i;idx=candidate;break}
 }
 if(headerIndex<0)throw Error('Vehicle Number / Truck Number and KM Reading / Opening KM headings not found in first 35 rows.');
 const data=rows.slice(headerIndex+1).map((r,i)=>({line:headerIndex+i+2,truck:r[idx.truck]??'',driver:idx.driver>=0?r[idx.driver]??'':'',raw:r[idx.km]??'',diesel:idx.diesel>=0?r[idx.diesel]??'':'',advance:idx.advance>=0?r[idx.advance]??'':'',fix:idx.fix>=0?r[idx.fix]??'':undefined})).filter(r=>String(r.truck).trim()||String(r.driver).trim()||String(r.raw).trim());
 return kmValidate(data);
}
function kmValidate(data){
 const dmap=new Map(drivers.map(d=>[String(d.id),d]));
 const prepared=data.map(source=>{
  const r={line:source.line,truck:source.truck,raw:source.raw,diesel:source.diesel,advance:source.advance,fix:source.fix,driver:""};
  const raw=String(r.raw).trim();
  if(!raw)return {...r,status:'Skipped — blank KM',key:'',skipped:true};
  const n=Number(raw.replace(/,/g,''));
  if(!Number.isFinite(n)||n<0||!Number.isInteger(n))return {...r,status:'Invalid KM',key:''};
  const tn=kmNorm(r.truck);
  const matched=trucks.filter(t=>tn&&kmNorm(truckName(t))===tn);
  if(matched.length!==1)return {...r,km:n,status:'Truck missing or ambiguous in master',key:''};
  const t=matched[0],matches=assignments.filter(a=>String(a.truck_id)===String(t.id));
  const choice=kmCurrentAssignment(matches);
  if(!choice.assignment&&choice.error!=='No current driver assignment')return {...r,km:n,status:choice.error,key:''};
  const a=choice.assignment||{id:'unassigned:'+t.id,truck_id:t.id,driver_id:null},d=dmap.get(String(a.driver_id));
  if((r.fix!==undefined&&r.fix!==''&&(!Number.isFinite(optionalNumber(r.fix))||optionalNumber(r.fix)<0))||[r.diesel,r.advance].some(x=>optionalNumber(x)!==null&&!Number.isFinite(optionalNumber(x))))return {...r,status:'Invalid diesel / advance',key:''};
  return {...r,assignment:a,km:n,driver:d?driverIdentifier(d):'—',status:d?'Matched — current driver':'Matched — vehicle only',key:openingKey(a)};
 });
 // A truck appearing twice in Excel must be reviewed even if it maps to different assignments.
 const counts=new Map();for(const r of prepared){const n=kmNorm(r.truck);if(n)counts.set(n,(counts.get(n)||0)+1)}
 for(const r of prepared)if(kmNorm(r.truck)&&counts.get(kmNorm(r.truck))>1){r.status='Duplicate vehicle rows in Excel — review';r.key='';r.skipped=false}
 return prepared;
}
function kmPreview(rows){
 kmImportMatches=rows;
 const good=rows.filter(r=>r.key).length,skipped=rows.filter(r=>r.skipped).length,review=rows.length-good-skipped;
 $('kmImportSummary').textContent=`${rows.length} rows · ${good} matched · ${skipped} blank skipped · ${review} review needed`;
 const field=(r,k)=>`<input aria-label="${k} row ${r.line}" data-line="${r.line}" data-edit="${k}" value="${esc(r[k])}" style="min-width:100px;width:100%">`;
 $('kmPreviewRows').innerHTML=rows.map(r=>`<tr><td>${r.line}</td><td>${field(r,'truck')}</td><td>${esc(r.driver)}</td><td>${field(r,'raw')}</td><td>${field(r,'diesel')}</td><td>${field(r,'advance')}</td><td>${field(r,'fix')}</td><td class="${r.key?'ok':r.skipped?'warn':'bad'}">${esc(r.status)}</td></tr>`).join('');
 $('kmImportPreview').hidden=false;
 $('kmApplyBtn').disabled=good===0||!$('openingImportDate').value;
 $('kmImportStatus').textContent=review?`${review} rows need review. Edit them here, or save matched vehicles only; unmatched rows will remain unchanged.`:`${good} vehicle openings ready. Blank KM rows are skipped. Select the common opening date.`;
}
$('kmPreviewRows').addEventListener('change',e=>{const x=e.target;if(!x.dataset.edit)return;const r=kmImportMatches.find(r=>String(r.line)===x.dataset.line);if(r){r[x.dataset.edit]=x.value;kmPreview(kmValidate(kmImportMatches));}});
$('openingImportDate').addEventListener('change',()=>kmPreview(kmValidate(kmImportMatches)));
$('kmImportBtn').addEventListener('click',async()=>{
 const f=$('kmExcelFile').files?.[0];if(!f){$('kmImportStatus').textContent='Select an Excel or CSV file first.';return}
 $('kmImportPreview').hidden=true;$('kmImportStatus').textContent='Reading file locally…';
 try{
  let rows=[];
  if(/\.csv$/i.test(f.name)){
   if(!window.XLSX)throw Error('Excel reader library unavailable. Check internet/CDN and reload.');
   const text=await f.text();const wb=XLSX.read(text,{type:'string'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
  }else{
   if(!window.XLSX)throw Error('Excel reader library unavailable. Check internet/CDN and reload.');
   const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
  }
  if(rows.length<2)throw Error('No data rows found in first worksheet.');
  kmPreview(kmParseRows(rows));
 }catch(e){$('kmImportStatus').textContent='Import error: '+e.message}
});
$('kmCancelBtn').addEventListener('click',()=>{$('kmImportPreview').hidden=true;kmImportMatches=[];$('kmImportStatus').textContent='Import cancelled. No changes applied.'});
$('kmApplyBtn').addEventListener('click',async()=>{kmImportMatches=kmValidate(kmImportMatches);const valid=kmImportMatches.filter(r=>r.key),date=$('openingImportDate').value;if(!valid.length||!date){$('kmImportStatus').textContent='Select opening date first.';return}const skipped=kmImportMatches.length-valid.length;const existing=valid.filter(r=>openings.has(r.key)).length;if(!confirm('Save '+valid.length+' vehicle openings for '+date+'? '+existing+' existing openings will be replaced, '+(valid.length-existing)+' inserted. '+skipped+' skipped/review rows will remain unchanged. Continue?'))return;const b=$('kmApplyBtn');b.disabled=true;try{await saveOpenings(valid.map(r=>openingPayload(r.assignment,{opening_date:date,opening_km:r.km,opening_diesel:optionalNumber(r.diesel),opening_advance:optionalNumber(r.advance),opening_fix_kharcha:r.fix===undefined?(String(openings.get(r.key)?.driver_id)===String(r.assignment.driver_id)?openings.get(r.key)?.opening_fix_kharcha??null:null):optionalNumber(r.fix)})));render();$('finalFrom').value=date;void window.ektaLoadFinalHisab?.(true);const remaining=kmImportMatches.filter(r=>!r.key&&!r.skipped);if(remaining.length){kmPreview(kmValidate(remaining));$('kmImportStatus').textContent='Saved and verified '+valid.length+' openings in Supabase. '+remaining.length+' review rows remain; their old openings were not changed.';}else{$('kmImportStatus').textContent='Saved and verified '+valid.length+' openings in Supabase.';$('kmImportPreview').hidden=true;kmImportMatches=[];}}catch(e){$('kmImportStatus').textContent='Save not confirmed: '+e.message}finally{b.disabled=!kmImportMatches.some(r=>r.key)||!$('openingImportDate').value}});

// Export current filtered Driver/Truck records and Opening KM drafts as Excel-compatible CSV.
// This reads the existing in-memory records; it does NOT write to Supabase.
function exportDriverKhataCsv(){
 const tq=$('truckSelect').value.trim().toLowerCase(),dq=$('driverSelect').value.trim().toLowerCase();
 const tm=new Map(trucks.map(t=>[String(t.id),t]));
 const dm=new Map(drivers.map(d=>[String(d.id),d]));
 const headers=['Truck Number','Driver Name','Driver ID','Phone Number','Joined Date','Left Date','Opening KM','Opening Diesel (L)','Opening Advance','Opening Fix Kharcha','Opening Date','Status'];
 const records=vehicleRows().filter(a=>{
  const t=tm.get(String(a.truck_id)),d=dm.get(String(a.driver_id));
  return (!tq||truckName(t).toLowerCase().includes(tq))&&(!dq||driverName(d).toLowerCase().includes(dq)||String(driverIdentifier(d)).toLowerCase().includes(dq));
 });
 if(!records.length){notice(lang==='hi'?'Export के लिए कोई रिकॉर्ड नहीं मिला।':'No records to export for current filters.',true);return}
 const csvCell=value=>{
  let v=String(value??'');
  if(/^[\s]*[=+@\-]/.test(v)&&!/^\-?\d+(\.\d+)?$/.test(v.trim()))v="'"+v;
  return '"'+v.replace(/"/g,'""')+'"';
 };
 const lines=[headers.map(csvCell).join(',')];
 for(const a of records){
  const d=dm.get(String(a.driver_id)),t=tm.get(String(a.truck_id));
  const joined=pick(a,['assigned_at','start_date','from_date','joined_at','assignment_date','created_at']);
  const left=pick(a,['unassigned_at','end_date','to_date','left_at','released_at']);
  const key='ekta-dk-v2-km:'+String(a.id??(a.truck_id+'-'+a.driver_id+'-'+joined));
  let km=openingValue(a,'opening_km');
  lines.push([truckName(t),driverName(d),driverIdentifier(d),driverPhone(d),date(joined),date(left),km,openingValue(a,'opening_diesel'),openingValue(a,'opening_advance'),openingValue(a,'opening_fix_kharcha'),openingValue(a,'opening_date'),left?'Previous':'Current'].map(csvCell).join(','));
 }
 const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='driver-khata-opening-km-'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 notice((lang==='hi'?'Excel Export तैयार: ':'Excel export ready: ')+records.length+' records (CSV).');
}
$('kmExportBtn').addEventListener('click',exportDriverKhataCsv);
$('kmFileName').addEventListener('click',()=>$('kmExcelFile').click());
$('kmFileName').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('kmExcelFile').click()}});
$('kmExcelFile').addEventListener('change',()=>{$('kmFileName').textContent=$('kmExcelFile').files?.[0]?.name||'No file chosen'});

})();


/* Card 2 — all-truck Trip Fixed Kharcha (read-only). */
(()=>{'use strict';
 const el=id=>document.getElementById(id), clean=v=>String(v??'').trim(), norm=v=>clean(v).toUpperCase().replace(/[^A-Z0-9]/g,''), esc=v=>clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const field=(obj,keys)=>{for(const k of keys)if(obj?.[k]!==undefined&&obj[k]!==null&&obj[k]!=='')return obj[k];return ''};
 const db=()=>[window.supabaseClient,window.ektaSupabaseClient,window.dbClient].find(x=>x&&typeof x.from==='function');
 const truckNo=t=>field(t,['truck_number','vehicle_number','registration_number','number']);
 const driverName=d=>field(d,['name','driver_name','full_name']);
 const rupee=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 let loaded=false, loading=null, all=[] , masterCount=0;
 const routeSnapshotKey='ekta-dk-fixed-route-snapshot-v1';
 let changedRoutes=new Map();
 let dayRates=[];
 const fixedPhotoUrls=new Map();
 const fixedInitials=name=>clean(name).split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join('').toUpperCase()||'?';
 function fixedDriverCell(r){
  const url=r.driverId?fixedPhotoUrls.get(String(r.driverId)):null;
  const avatar=url?`<img class="driver-avatar" src="${esc(url)}" alt="" loading="lazy">`:`<span class="driver-avatar" aria-hidden="true">${esc(fixedInitials(r.driver))}</span>`;
  return `<span class="driver-cell">${avatar}<span>${esc(r.driver)}</span></span>`;
 }
 // Same driver_documents photo storage as Card 1. Read-only, no database changes.
 async function loadFixedDriverPhotos(drivers){
  try{
   const ids=new Set(drivers.map(d=>String(d.id)));
   const docs=await readAll('driver_documents');
   const latest=new Map();
   docs.filter(d=>d.document_type==='photo'&&d.storage_path&&ids.has(String(d.driver_id)))
    .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
    .forEach(d=>{const id=String(d.driver_id);if(!latest.has(id))latest.set(id,d.storage_path)});
   const entries=[...latest.entries()];
   for(let i=0;i<entries.length;i+=8){
    await Promise.all(entries.slice(i,i+8).map(async([id,path])=>{
     try{const {data,error}=await db().storage.from('driver-documents').createSignedUrl(path,3600);if(!error&&data?.signedUrl)fixedPhotoUrls.set(id,data.signedUrl)}catch(e){console.warn('[Driver Khata] Trip driver photo:',e)}
    }));
   }
   render();
  }catch(e){console.warn('[Driver Khata] Trip driver photos unavailable:',e)}
 }

 async function readAll(table){const rows=[];for(let start=0;start<50000;start+=500){const {data,error}=await db().from(table).select('*').range(start,start+499);if(error)throw Error(table+': '+error.message);rows.push(...(data||[]));if((data||[]).length<500)break;}return rows}
 function status(msg,error=false){el('fixedStatus').textContent=msg;el('fixedStatus').classList.toggle('error',error)}
 function render(){
  const tq=norm(el('fixedTruckSearch').value),fromDate=el('fixedFromDate').value,toDate=el('fixedToDate').value;
  const rows=all.filter(r=>{const d=String(r.date).slice(0,10);return (!tq||norm(r.truck).includes(tq))&&(!fromDate||d>=fromDate)&&(!toDate||d<=toDate);});
  el('fixedTripCount').textContent=rows.length;el('fixedAmount').textContent=rupee(rows.filter(r=>r.matched).reduce((s,r)=>s+r.amount,0));el('fixedMissing').textContent=rows.filter(r=>!r.matched).length;el('fixedMasterCount').textContent=masterCount;
  el('fixedRows').innerHTML=rows.map(r=>{const missing=r.status==='Missing rate'&&r.from&&r.to;
   const cell=r.matched?rupee(r.amount):(missing?`<span class="fixed-rate-editor"><input type="number" min="0" step="0.01" inputmode="decimal" placeholder="₹ Amount" aria-label="Fixed Kharcha for ${esc(r.route)}" data-rate-input="${esc(r.id)}"><button type="button" class="fixed-rate-save" data-rate-save="${esc(r.id)}">Save Rate</button></span>`:'—');
   const daysCell=r.dayIds.length?`<span class="fixed-rate-editor"><input type="number" min="0.01" max="999999.99" step="0.01" placeholder="Days" aria-label="Fixed Days for ${esc(r.route)}" data-days-input="${esc(r.id)}" value="${esc(r.days??'')}"><button type="button" class="fixed-rate-save" data-days-save="${esc(r.id)}">Save Days</button></span>${r.daysConflict?' <small>Review conflicting days</small>':''}`:'Save rate first';
   return `<tr><td>${esc(r.date)}</td><td>${esc(r.truck)}</td><td>${fixedDriverCell(r)}</td><td>${esc(r.route)}</td><td>${cell}</td><td>${daysCell}</td><td class="${r.matched?'fixed-ok':'fixed-bad'}">${esc(r.status)}${r.changed?' · Tracking route changed':''}</td></tr>`;
  }).join('')||'<tr><td colspan="7" class="empty">No matching trips.</td></tr>';
 }
 // Save into the SAME fixed_kharcha_rates master used by Trip Accounts.
 // Both directions share a single canonical route pair. Never silently overwrite an existing rate.
 let saving=false;
 async function saveRate(tripId){
  if(saving)return;
  const r=all.find(x=>x.id===tripId);if(!r||r.status!=='Missing rate'||!r.from||!r.to)return;
  const input=[...el('fixedRows').querySelectorAll('[data-rate-input]')].find(x=>x.dataset.rateInput===tripId);
  if(!input)return;
  const raw=input.value.trim(),amount=Number(raw);
  if(!raw||!Number.isFinite(amount)||amount<0){status('Enter a valid Fixed Kharcha amount (₹0 or more).',true);input.focus();return;}
  if(!db()){status('Supabase connection unavailable.',true);return;}
  const pair=(a,b)=>[norm(a),norm(b)].sort().join('||');
  const target=pair(r.from,r.to);
  saving=true;input.disabled=true;
  try{
   // Fresh read avoids accidental duplicates or overwrites when another staff member saved a rate.
   const rates=await readAll('fixed_kharcha_rates');
   const matches=rates.filter(x=>pair(x.from_location,x.to_location)===target);
   if(matches.length){
    const current=[...new Set(matches.map(x=>Number(x.amount)))];
    if(current.length===1&&current[0]===amount){status(`${r.route}: ${rupee(amount)} already exists in Route Master. Refreshing…`);await load(true);return;}
    const old=current.map(rupee).join(', ');
    if(!window.confirm(`Route ${r.from} ↔ ${r.to} already exists in Trip Accounts Master at ${old}.\n\nChange the rate to ${rupee(amount)} for BOTH directions?`)){status('Existing master rate was not changed.');return;}
    for(const x of matches){const {error}=await db().from('fixed_kharcha_rates').update({amount}).eq('id',x.id);if(error)throw Error(error.message);}
   }else{
    const [from_location,to_location]=[clean(r.from).toUpperCase(),clean(r.to).toUpperCase()].sort();
    const {error}=await db().from('fixed_kharcha_rates').insert({from_location,to_location,amount});if(error)throw Error(error.message);
   }
   // Keep the status visible after the refresh. The route master is the only source of truth.
   await load(true);
   status(`Saved ${r.from} ↔ ${r.to}: ${rupee(amount)} in Trip Accounts Route-wise Fixed Kharcha Master. Both directions updated.`);
  }catch(e){status('Fixed Kharcha was not saved: '+e.message,true);console.error('[Driver Khata rate save]',e)}
  finally{saving=false;if(input.isConnected)input.disabled=false;}
 }
 async function saveDays(tripId,input){
  if(saving||!input)return;
  const r=all.find(x=>x.id===tripId),raw=input.value.trim(),days=Number(raw);
  if(!r||!r.dayIds.length||!raw||!Number.isFinite(days)||days<0.01||days>999999.99||Math.abs(days*100-Math.round(days*100))>0.000001){status('Enter positive Fixed Days with up to two decimal places.',true);return;}
  if(!window.confirm(`Save ${days} days for ${r.from} ↔ ${r.to} (both directions)? Fixed Kharcha will not change.`))return;
  saving=true;input.disabled=true;
  try{
   const pair=(a,b)=>[norm(a),norm(b)].sort().join('|');
   const fresh=(await readAll('fixed_kharcha_rates')).filter(x=>pair(x.from_location,x.to_location)===pair(r.from,r.to));
   if(!fresh.length)throw Error('Route master missing. Refresh first.');
   const ids=fresh.map(x=>x.id);
   const {data,error}=await db().from('fixed_kharcha_rates').update({fixed_days:days}).in('id',ids).select('id,fixed_days');
   if(error)throw Error(error.message);
   if(!data||data.length!==ids.length||data.some(x=>Number(x.fixed_days)!==days))throw Error('Save not confirmed. Refresh and verify.');
   const verified=(await readAll('fixed_kharcha_rates')).filter(x=>pair(x.from_location,x.to_location)===pair(r.from,r.to));
   if(!verified.length||verified.some(x=>Number(x.fixed_days)!==days))throw Error('Read-back mismatch. Refresh and verify.');
   dayRates=dayRates.map(x=>ids.includes(x.id)?{...x,fixed_days:days}:x);
   for(const row of all)if(pair(row.from,row.to)===pair(r.from,r.to)){row.days=days;row.daysConflict=false;row.dayIds=ids;}
   render();status(`Saved and verified ${days} days for ${r.from} ↔ ${r.to}.`);
  }catch(e){status('Fixed Days save not confirmed: '+e.message,true);}finally{saving=false;if(input.isConnected)input.disabled=false;}
 }
 el('fixedRows').addEventListener('click',e=>{const b=e.target.closest('[data-days-save]');if(b)void saveDays(b.dataset.daysSave,b.closest('tr').querySelector('[data-days-input]'));});
 el('fixedRows').addEventListener('click',e=>{const btn=e.target.closest('[data-rate-save]');if(btn)void saveRate(btn.dataset.rateSave)});
 el('fixedRows').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-rate-input]')){e.preventDefault();void saveRate(e.target.dataset.rateInput)}});

 async function load(force=false){if(loading)return loading;if(loaded&&!force){render();return}if(!db()){status('Supabase connection unavailable. Check db.js.',true);return}status('Loading all trucks, trips and fixed route rates…');loading=(async()=>{try{
 const names=['trips','fixed_kharcha_rates','trucks','drivers','truck_driver_assignments'];const result=await Promise.allSettled(names.map(readAll));if(result[0].status!=='fulfilled')throw result[0].reason;if(result[1].status!=='fulfilled')throw result[1].reason;
 const trips=result[0].value,rates=result[1].value,trucks=result[2].status==='fulfilled'?result[2].value:[],drivers=result[3].status==='fulfilled'?result[3].value:[],assignments=result[4].status==='fulfilled'?result[4].value:[];
 const tm=new Map(trucks.map(t=>[clean(t.id),t])),dm=new Map(drivers.map(d=>[clean(d.id),d]));const truckByNo=new Map(trucks.map(t=>[norm(truckNo(t)),t]));
 const routeKey=(a,b)=>norm(a)+'|'+norm(b);
 const rateMap=new Map();for(const r of rates){const from=field(r,['from_location','from_city','from','origin','source','loading_point','from_place']),to=field(r,['to_location','to_city','to','destination','dest','unloading_point','to_place']);const amount=Number(field(r,['fixed_kharcha','fixed_expense','fixed_amount','amount','rate','kharcha']));if(!from||!to||!Number.isFinite(amount)||amount<0)continue;for(const key of [routeKey(from,to),routeKey(to,from)]){const arr=rateMap.get(key)||[];arr.push({amount,rate:r});rateMap.set(key,arr)}}
 dayRates=rates;
 masterCount=rates.length;
 all=trips.filter(t=>{const loading=clean(t.loading_date);const state=clean(t.trip_status).toLowerCase();return !!loading && state!=='cancelled';}).map(t=>{const truck=tm.get(clean(field(t,['truck_id','vehicle_id'])))||truckByNo.get(norm(field(t,['truck_number','vehicle_number','vehicle_no','truck_no'])))||{};const truckText=clean(truckNo(truck)||field(t,['truck_number','vehicle_number','vehicle_no','truck_no']))||'—';const from=clean(field(t,['from_location','from_city','from','origin','source','loading_point','from_place'])),to=clean(field(t,['to_location','to_city','to','destination','dest','unloading_point','to_place']));const tripDate=clean(t.loading_date).slice(0,10); let d=dm.get(clean(field(t,['driver_id','assigned_driver_id'])))||null;
 if(!d){const relevant=assignments.filter(a=>clean(a.truck_id)===clean(truck.id)&&clean(field(a,['assigned_at','start_date','from_date','joined_at','assignment_date','created_at'])).slice(0,10)<=tripDate&&(!field(a,['unassigned_at','end_date','to_date','left_at','released_at'])||clean(field(a,['unassigned_at','end_date','to_date','left_at','released_at'])).slice(0,10)>=tripDate));relevant.sort((a,b)=>clean(field(b,['assigned_at','start_date','from_date','joined_at','assignment_date','created_at'])).localeCompare(clean(field(a,['assigned_at','start_date','from_date','joined_at','assignment_date','created_at']))));if(relevant.length)d=dm.get(clean(relevant[0].driver_id))||null}
 const options=rateMap.get(routeKey(from,to))||[];const dayMatches=dayRates.filter(x=>from&&to&&[norm(x.from_location),norm(x.to_location)].sort().join('|')===[norm(from),norm(to)].sort().join('|'));const dayValues=[...new Set(dayMatches.map(x=>x.fixed_days==null?null:Number(x.fixed_days)))];const amounts=[...new Set(options.map(o=>o.amount))];const matched=!!from&&!!to&&amounts.length===1;const status=!from||!to?'Route missing':!options.length?'Missing rate':amounts.length>1?'Conflicting rates':'Matched';return {id:clean(t.id),truck:truckText,driver:clean(driverName(d)||field(t,['driver_name']))||'—',driverId:d?.id??null,route:(from||'—')+' → '+(to||'—'),from,to,date:tripDate,dayIds:dayMatches.map(x=>x.id),days:dayValues.length===1?dayValues[0]:null,daysConflict:dayValues.length>1,matched,amount:matched?amounts[0]:0,status};});
 // Browser-only comparison: warns on changes seen between refreshes, without database writes.
 let previous={};try{previous=JSON.parse(localStorage.getItem(routeSnapshotKey)||'{}')||{}}catch{}
 const current={};changedRoutes=new Map();
 for(const r of all){if(!r.id)continue;current[r.id]=r.route;if(previous[r.id]&&previous[r.id]!==r.route){r.changed=true;changedRoutes.set(r.id,{old:previous[r.id],next:r.route,truck:r.truck});}}
 try{localStorage.setItem(routeSnapshotKey,JSON.stringify(current))}catch{}
 all.sort((a,b)=>b.date.localeCompare(a.date)||a.truck.localeCompare(b.truck));loaded=true;render();void loadFixedDriverPhotos(drivers);status(`${all.length} loaded trips · ${masterCount} route master rows · ${all.filter(r=>r.matched).length} matched · ${all.filter(r=>!r.matched).length} missing/review. ${changedRoutes.size?changedRoutes.size+' tracking route change(s) detected on this browser. ':''}Cancelled trips excluded.`);
 }catch(e){status('Could not load Trip Fixed Kharcha: '+e.message,true);console.error('[Driver Khata Fixed Kharcha]',e)}})();try{await loading}finally{loading=null}}
 ['fixedTruckSearch','fixedFromDate','fixedToDate'].forEach(id=>el(id).addEventListener('input',render));el('fixedRefresh').addEventListener('click',()=>load(true));window.ektaLoadFixedTrips=()=>load();window.ektaFixedHisabRows=()=>loaded?all.map(r=>({...r})):null;window.ektaRefreshFixedTrips=()=>load(true);
})();


/* Card 3 — date-wise diesel taken; read-only across existing Fuel Management sources. */
(()=>{'use strict';
 const el=id=>document.getElementById(id), str=v=>String(v??'').trim(), norm=v=>str(v).toUpperCase().replace(/[^A-Z0-9]/g,''), esc=v=>str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const db=()=>[window.supabaseClient,window.ektaSupabaseClient,window.dbClient].find(c=>c&&typeof c.from==='function');
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const fmt=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:3});
 let records=[], loaded=false, loading=null;
 const dieselPhotoUrls=new Map();
 const dieselInitials=name=>str(name).split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join('').toUpperCase()||'?';
 function dieselDriverCell(r){
  const url=r.driverId?dieselPhotoUrls.get(String(r.driverId)):null;
  const avatar=url?`<img class="driver-avatar" src="${esc(url)}" alt="" loading="lazy">`:`<span class="driver-avatar" aria-hidden="true">${esc(dieselInitials(r.driver))}</span>`;
  return `<span class="driver-cell">${avatar}<span>${esc(r.driver)}</span></span>`;
 }
 async function loadDieselPhotos(driverIds){
  if(!driverIds.size)return;
  try{
   const docs=await readAll('driver_documents',q=>q.eq('document_type','photo').order('created_at',{ascending:false}));
   const latest=new Map();
   for(const d of docs){const id=String(d.driver_id??'');if(driverIds.has(id)&&d.storage_path&&!latest.has(id))latest.set(id,d.storage_path)}
   const entries=[...latest.entries()];
   for(let i=0;i<entries.length;i+=8){
    await Promise.all(entries.slice(i,i+8).map(async([id,path])=>{
     try{const {data,error}=await db().storage.from('driver-documents').createSignedUrl(path,3600);if(!error&&data?.signedUrl)dieselPhotoUrls.set(id,data.signedUrl)}catch(e){console.warn('[Driver Khata Diesel photo]',e)}
    }));
   }
   render();
  }catch(e){console.warn('[Driver Khata Diesel] Photos unavailable:',e)}
 }

 function dateKey(raw){const s=str(raw);if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);if(m){const a=+m[1],b=+m[2];if(a>=1&&a<=31&&b>=1&&b<=12)return m[3]+'-'+String(b).padStart(2,'0')+'-'+String(a).padStart(2,'0');return '';}return ''}
 function note(s,bad=false){el('dieselStatus').textContent=s;el('dieselStatus').classList.toggle('error',bad)}
 async function readAll(table,setup){const out=[];for(let off=0;off<100000;off+=500){let q=db().from(table).select('*');if(setup)q=setup(q);const {data,error}=await q.range(off,off+499);if(error)throw Error(table+': '+error.message);out.push(...(data||[]));if((data||[]).length<500)break}return out}
 function render(){const f=el('dieselFrom').value,t=el('dieselTo').value,q=norm(el('dieselSearch').value);const rows=records.filter(r=>(!f||r.date>=f)&&(!t||r.date<=t)&&(!q||norm([r.truck,r.driver,r.pump,r.source,r.ref].join(' ')).includes(q)));
 el('dieselLitres').textContent=fmt(rows.reduce((n,r)=>n+r.litres,0))+' L';el('dieselAmount').textContent=money(rows.reduce((n,r)=>n+r.amount,0));el('dieselTrucks').textContent=new Set(rows.filter(r=>r.truck!=='Unmatched').map(r=>norm(r.truck))).size;el('dieselCount').textContent=rows.length;
 el('dieselRows').innerHTML=rows.map(r=>`<tr><td>${esc(r.date||'Date review')}</td><td>${esc(r.truck)}</td><td>${dieselDriverCell(r)}</td><td>${esc(r.pump)}</td><td>${esc(r.source)}</td><td>${fmt(r.litres)} L</td><td>${money(r.amount)}</td><td>${esc(r.ref)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No matching diesel transactions.</td></tr>';
 }
 async function load(force=false){if(loading)return loading;if(loaded&&!force){render();return}if(!db()){note('Supabase unavailable. Check db.js.',true);return}note('Loading diesel from Fuel Management…');loading=(async()=>{try{
 const names=['hpcl_fuel_transactions','ekta_pump_ledger','ekta_pump_master','diesel_cash_entries','account_transactions','trucks','drivers','truck_driver_assignments'];
 const results=await Promise.allSettled(names.map((n,i)=>readAll(n,i===4?q=>q.eq('posting_status','CONFIRMED').eq('category','DIESEL'):null)));
 const warnings=[];const data={};names.forEach((n,i)=>{data[n]=results[i].status==='fulfilled'?results[i].value:[];if(results[i].status!=='fulfilled')warnings.push(n+': '+results[i].reason.message)});
 if(warnings.length===names.length)throw Error(warnings.join('; '));
 const tm=new Map(data.trucks.map(t=>[String(t.id),t])), truckNames=new Map(data.trucks.map(t=>[norm(t.truck_number||t.vehicle_number||t.registration_number),t]));
 const dm=new Map(data.drivers.map(d=>[String(d.id),d]));const pumpNames=new Map(data.ekta_pump_master.map(p=>[String(p.id),str(p.name)]));
 const getTruck=(vehicle,id)=>{const t=tm.get(String(id));return str(vehicle||t?.truck_number||t?.vehicle_number||'')||'Unmatched'};
 const validVehicle=v=>str(v)&&!['PAID','PUMP NOT IN LIST','UNMATCHED','VEHICLE PENDING'].includes(str(v).toUpperCase());
 const all=[];const add=(r)=>{if(!Number.isFinite(r.litres)||r.litres<=0)return;all.push(r)};
 const hpclIds=new Set();
 for(const x of data.hpcl_fuel_transactions){const litres=Number(x.litres),vehicle=str(x.actual_vehicle),type=str(x.txn_type).toUpperCase();if(str(x.review_status).toUpperCase()!=='APPROVED'||!validVehicle(vehicle)||!type.includes('SALE')||str(x.direction).toUpperCase()==='CREDIT')continue;
 if(litres>0){hpclIds.add(str(x.txn_id));add({date:dateKey(x.txn_datetime_raw),time:str(x.txn_datetime_raw),truck:vehicle,pump:str(x.pump_name)||'—',source:'HPCL OTP',litres,amount:Number(x.amount)||0,ref:str(x.txn_id)})}}
 for(const x of data.ekta_pump_ledger){if(str(x.kind).toUpperCase()!=='DIESEL'||Number(x.litres)<=0)continue;const linked=str(x.source_txn_id);if(linked&&hpclIds.has(linked))continue;add({date:dateKey(x.entry_date),time:str(x.entry_time),truck:getTruck(x.vehicle),pump:pumpNames.get(String(x.pump_id))||'—',source:'Pump Ledger',litres:Number(x.litres),amount:Number(x.amount)||0,ref:str(x.reference||x.id)})}
 for(const x of data.diesel_cash_entries)add({date:dateKey(x.entry_date),time:str(x.entry_time),truck:getTruck(x.vehicle_number),pump:str(x.pump_name)||'—',source:'Cash Diesel',litres:Number(x.litres),amount:Number(x.amount)||0,ref:str(x.reference_number||x.id)});
 for(const x of data.account_transactions)add({date:dateKey(x.transaction_date),time:str(x.transaction_time),truck:getTruck(x.vehicle_number,x.truck_id),pump:str(x.bank_narration||x.bank_name)||'—',source:'Bank Statement',litres:Number(x.quantity_litres),amount:Number(x.debit)||0,ref:str(x.reference_number||x.id)});
 const assignments=data.truck_driver_assignments;
 for(const r of all){const truck=truckNames.get(norm(r.truck));let relevant=assignments.filter(a=>truck&&String(a.truck_id)===String(truck.id)&&str(a.assigned_at||a.start_date||a.from_date||a.joined_at||a.assignment_date||a.created_at).slice(0,10)<=r.date&&(!str(a.unassigned_at||a.end_date||a.to_date||a.left_at||a.released_at)||str(a.unassigned_at||a.end_date||a.to_date||a.left_at||a.released_at).slice(0,10)>=r.date));relevant.sort((a,b)=>str(b.assigned_at||b.start_date||b.from_date||b.joined_at||b.assignment_date||b.created_at).localeCompare(str(a.assigned_at||a.start_date||a.from_date||a.joined_at||a.assignment_date||a.created_at)));const d=dm.get(String(relevant[0]?.driver_id));r.driver=str(d?.name||d?.driver_name||d?.full_name)||'Not mapped';r.driverId=d?.id??null}
 all.sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time)||a.truck.localeCompare(b.truck));records=all;loaded=true;render();void loadDieselPhotos(new Set(all.map(r=>String(r.driverId||'')).filter(Boolean)));note(`${all.length} diesel entries loaded · ${new Set(all.map(r=>norm(r.truck))).size} vehicle labels · Read-only.${warnings.length?' Sources unavailable: '+warnings.join('; '):''}`,!!warnings.length);
 }catch(e){note('Diesel loading failed: '+e.message,true);console.error('[Driver Khata Diesel]',e)}})();try{await loading}finally{loading=null}}
 ['dieselFrom','dieselTo','dieselSearch'].forEach(id=>el(id).addEventListener('input',render));el('dieselRefresh').addEventListener('click',()=>load(true));window.ektaLoadDieselTaken=()=>load();window.ektaDieselHisabRows=()=>loaded?records.map(r=>({...r})):null;
})();


/* Card 4 — confirmed Driver Advances, same account_transactions ledger as Accounts & Finance. */
(()=>{'use strict';
 const el=id=>document.getElementById(id), str=v=>String(v??'').trim(), esc=v=>str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=v=>str(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
 const pick=(r,keys)=>{for(const k of keys)if(r?.[k]!==null&&r?.[k]!==undefined&&r[k]!=='')return r[k];return ''};
 const db=()=>[window.supabaseClient,window.ektaSupabaseClient,window.dbClient].find(c=>c&&typeof c.from==='function');
 const rupee=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=v=>{const s=str(v);if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
 let records=[],loaded=false,loading=null,review=[];const photos=new Map();
 async function readAll(table){const out=[];for(let off=0;off<100000;off+=500){const {data,error}=await db().from(table).select('*').order('id',{ascending:true}).range(off,off+499);if(error)throw Error(table+': '+error.message);out.push(...(data||[]));if((data||[]).length<500)break}return out}
 function status(msg,bad=false){el('advanceStatus').textContent=msg;el('advanceStatus').classList.toggle('error',bad)}
 function driverCell(r){const name=r.driver||'Not mapped',url=r.driverId?photos.get(String(r.driverId)):null;const initials=name.split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();const avatar=url?`<img class="driver-avatar" src="${esc(url)}" alt="" loading="lazy">`:`<span class="driver-avatar" aria-hidden="true">${esc(initials||'?')}</span>`;return `<span class="driver-cell">${avatar}<span>${esc(name)}</span></span>`}
 function render(){const from=el('advanceFrom').value,to=el('advanceTo').value,q=norm(el('advanceSearch').value);const rows=records.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)&&(!q||norm([r.truck,r.driver,r.ref,r.source].join(' ')).includes(q)));
 el('advanceAmount').textContent=rupee(rows.reduce((s,r)=>s+r.amount,0));el('advanceDrivers').textContent=new Set(rows.filter(r=>r.driverId).map(r=>String(r.driverId))).size;el('advanceCount').textContent=rows.length;
 el('advanceRows').innerHTML=rows.map(r=>`<tr><td>${esc(r.date||'Review')}</td><td>${esc(r.truck)}</td><td>${driverCell(r)}</td><td>${esc(r.source)}</td><td>${rupee(r.amount)}</td><td>${esc(r.ref)}</td><td><span class="tag">Confirmed</span></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No matching confirmed driver advances.</td></tr>';
 }
 async function loadPhotos(drivers){try{const ids=new Set(drivers.map(d=>String(d.id)));const docs=(await readAll('driver_documents')).filter(d=>d.document_type==='photo'&&d.storage_path&&ids.has(String(d.driver_id))).sort((a,b)=>str(b.created_at).localeCompare(str(a.created_at)));const latest=new Map();for(const d of docs)if(!latest.has(String(d.driver_id)))latest.set(String(d.driver_id),d.storage_path);const entries=[...latest];for(let i=0;i<entries.length;i+=8)await Promise.all(entries.slice(i,i+8).map(async([id,path])=>{try{const {data,error}=await db().storage.from('driver-documents').createSignedUrl(path,3600);if(!error&&data?.signedUrl)photos.set(id,data.signedUrl)}catch{}}));render()}catch(e){console.warn('[Driver Advance photos]',e)}}
 async function load(force=false){if(loading)return loading;if(loaded&&!force){render();return}if(!db()){status('Supabase connection unavailable. Check db.js.',true);return}status('Loading confirmed driver advances from Accounts…');loading=(async()=>{try{
 loaded=false;review=[];const tables=['account_transactions','drivers','trucks','trips','parties'];const results=await Promise.allSettled(tables.map(readAll));for(const result of results)if(result.status!=='fulfilled')throw result.reason;
 const transactions=results[0].value,drivers=results[1].status==='fulfilled'?results[1].value:[],trucks=results[2].status==='fulfilled'?results[2].value:[];
 const driverMap=new Map(drivers.map(d=>[String(d.id),d])),truckMap=new Map(trucks.map(t=>[String(t.id),t]));
 // Accounts records reversals as CREDIT with category DRIVER_ADVANCE. Never add them as new advances.
 const advances=transactions.filter(t=>str(t.category).toUpperCase()==='DRIVER_ADVANCE'&&str(t.posting_status).toUpperCase()==='CONFIRMED'&&Number(t.debit)>0&&!Number(t.credit)&&!str(t.user_remark).startsWith('ADVANCE_REVERSAL_OF:'));
 // A reversal links by original reference; avoid overstating outstanding advance.
 const reversed=new Set(transactions.filter(t=>str(t.category).toUpperCase()==='DRIVER_ADVANCE'&&str(t.posting_status).toUpperCase()==='CONFIRMED'&&Number(t.credit)>0&&str(t.user_remark).startsWith('ADVANCE_REVERSAL_OF:')).map(t=>str(t.user_remark).split(':')[1]?.split(';')[0]?.trim().toUpperCase()).filter(Boolean));
 records=advances.map(t=>{const d=driverMap.get(String(t.driver_id)),truck=truckMap.get(String(t.truck_id));const reference=str(t.reference_number);return {date:date(t.transaction_date),truck:str(pick(truck,['truck_number','vehicle_number','registration_number']))||str(t.vehicle_number)||'Not mapped',driver:str(pick(d,['name','driver_name','full_name']))||'Not mapped',driverId:d?.id||null,amount:Number(t.debit),source:str(t.bank_account_name||t.bank_name)||'Bank',ref:reference||str(t.bank_narration||t.user_remark)||'—',reversed:reversed.has(reference.toUpperCase())}}).filter(r=>!r.reversed).sort((a,b)=>b.date.localeCompare(a.date));
 const partyMap=new Map(results[4].value.map(p=>[String(p.id),p]));
 const seen=new Set();
 for(const t of results[3].value){
  const raw=t.transporter_working?.driver_advance,amount=Number(raw);if(raw==null||raw===''||!Number.isFinite(amount)||amount<=0)continue;
  const p=partyMap.get(String(t.party_id));const kind=str(p?.party_type).toLowerCase().replace(/[^a-z]/g,'');
  if(!['transporter','transporters'].includes(kind))continue;
  if(str(t.trip_status).toLowerCase()==='cancelled')continue;
  const id=String(t.id),d=driverMap.get(String(pick(t,['driver_id','assigned_driver_id']))),truck=truckMap.get(String(t.truck_id)),when=date(t.transporter_working.driver_advance_date||t.loading_date);
  if(seen.has(id))continue;seen.add(id);
  if(!d||!truck||!when){review.push(str(t.trip_number)||id);continue;}
  // A linked bank advance of the same amount is ambiguous; do not count it twice without review.
  if(advances.some(r=>String(r.trip_id)===id&&Number(r.debit)===amount&&!reversed.has(str(r.reference_number).toUpperCase()))){review.push(str(t.trip_number)||id);continue;}
  records.push({date:when,truck:str(pick(truck,['truck_number','vehicle_number','registration_number','number'])),driver:str(pick(d,['name','driver_name','full_name'])),driverId:d.id,amount,source:'Transporter Advance · '+str(p.name),ref:str(t.trip_number)||id,tripId:id});
 }
 records.sort((a,b)=>b.date.localeCompare(a.date));
 loaded=true;render();status(`${records.length} advance entries loaded from Accounts & Transporters · Read-only. Reversed bank advances excluded. ${review.length?"Review excluded trips: "+review.join(", "):""}`,review.length>0);void loadPhotos(drivers);
 if(results[1].status!=='fulfilled'||results[2].status!=='fulfilled')status('Advances loaded, but Driver/Truck Master lookup was unavailable. Check mapping.',true);
 }catch(e){status('Could not load Driver Advances: '+e.message,true);console.error('[Driver Khata Advance]',e)}})();try{await loading}finally{loading=null}}
 ['advanceFrom','advanceTo','advanceSearch'].forEach(id=>el(id).addEventListener('input',render));window.ektaLoadDriverAdvances=load;window.ektaAdvanceHisabRows=()=>loaded?records.map(r=>({...r})):null;window.ektaAdvanceReview=()=>review.slice();
})();


/* Card 5 — Trip Accounts saved trip_expenses; read-only. */
(()=>{'use strict';
 const $=id=>document.getElementById(id), str=v=>String(v??'').trim(),norm=v=>str(v).toUpperCase().replace(/[^A-Z0-9]/g,''),esc=v=>str(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pick=(o,ks)=>{for(const k of ks)if(o?.[k]!==undefined&&o[k]!==null&&o[k]!=='')return o[k];return ''};
 const db=()=>[window.supabaseClient,window.ektaSupabaseClient,window.dbClient].find(x=>x&&typeof x.from==='function');
 const cash=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=v=>{const s=str(v);if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
 let rows=[],loaded=false,pending=null;const photos=new Map();
 async function readAll(table){const out=[];for(let n=0;n<100000;n+=500){const {data,error}=await db().from(table).select('*').range(n,n+499);if(error)throw Error(table+': '+error.message);out.push(...(data||[]));if((data||[]).length<500)break;}return out}
 function status(s,bad=false){$('expenseStatus').textContent=s;$('expenseStatus').classList.toggle('error',bad)}
 function driverCell(r){const name=r.driver||'Not mapped',photo=r.driverId?photos.get(String(r.driverId)):null;const init=name.split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase();return `<span class="driver-cell">${photo?`<img class="driver-avatar" src="${esc(photo)}" alt="" loading="lazy">`:`<span class="driver-avatar" aria-hidden="true">${esc(init||'?')}</span>`}<span>${esc(name)}</span></span>`}
 function render(){const from=$('expenseFrom').value,to=$('expenseTo').value,q=norm($('expenseSearch').value);const filtered=rows.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to)&&(!q||norm([r.truck,r.driver,r.type,r.route,r.description,r.bill].join(' ')).includes(q)));
 $('expenseAmount').textContent=cash(filtered.reduce((a,r)=>a+r.amount,0));$('expenseTrips').textContent=new Set(filtered.filter(r=>r.tripId).map(r=>r.tripId)).size;$('expenseCount').textContent=filtered.length;
 $('expenseRows').innerHTML=filtered.map(r=>`<tr><td>${esc(r.date||'Review')}</td><td>${esc(r.truck)}</td><td>${driverCell(r)}</td><td>${esc(r.route)}</td><td>${esc(r.type)}</td><td>${cash(r.amount)}</td><td>${esc(r.payment)}</td><td>${esc([r.description,r.vendor,r.bill&&'Bill: '+r.bill].filter(Boolean).join(' · ')||'—')}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No matching Trip Expenses.</td></tr>';
 }
 async function loadPhotos(drivers){try{const ids=new Set(rows.filter(r=>r.driverId).map(r=>String(r.driverId)));if(!ids.size)return;const docs=(await readAll('driver_documents')).filter(d=>d.document_type==='photo'&&d.storage_path&&ids.has(String(d.driver_id))).sort((a,b)=>str(b.created_at).localeCompare(str(a.created_at)));const latest=new Map();for(const d of docs)if(!latest.has(String(d.driver_id)))latest.set(String(d.driver_id),d.storage_path);const entries=[...latest];for(let i=0;i<entries.length;i+=8)await Promise.all(entries.slice(i,i+8).map(async([id,path])=>{try{const {data,error}=await db().storage.from('driver-documents').createSignedUrl(path,3600);if(!error&&data?.signedUrl)photos.set(id,data.signedUrl)}catch{}}));render()}catch(e){console.warn('[Trip Expenses photos]',e)}}
 async function load(force=false){if(pending)return pending;if(loaded&&!force){render();return}if(!db()){status('Supabase connection unavailable. Check db.js.',true);return}status('Loading saved Trip Expenses…');pending=(async()=>{try{
 const names=['trip_expenses','trips','trucks','drivers','truck_driver_assignments'];const res=await Promise.allSettled(names.map(readAll));if(res[0].status!=='fulfilled')throw res[0].reason;
 const data=names.map((_,i)=>res[i].status==='fulfilled'?res[i].value:[]);const [expenses,trips,trucks,drivers,assignments]=data;
 const tripMap=new Map(trips.map(t=>[String(t.id),t])),truckMap=new Map(trucks.map(t=>[String(t.id),t])),driverMap=new Map(drivers.map(d=>[String(d.id),d]));
 rows=expenses.map(e=>{const trip=tripMap.get(String(e.trip_id))||{};const truckId=pick(e,['truck_id'])||pick(trip,['truck_id','vehicle_id']);const truck=truckMap.get(String(truckId))||{};const when=date(pick(e,['expense_date','created_at']));
 let d=driverMap.get(String(pick(e,['driver_id'])||pick(trip,['driver_id','assigned_driver_id'])))||null;
 if(!d&&truckId){const matches=assignments.filter(a=>String(a.truck_id)===String(truckId)&&date(pick(a,['assigned_at','assigned_from','start_date','from_date','joined_at','created_at']))<=when&&(!pick(a,['unassigned_at','end_date','to_date','left_at','released_at'])||date(pick(a,['unassigned_at','end_date','to_date','left_at','released_at']))>=when));matches.sort((a,b)=>str(pick(b,['assigned_at','assigned_from','start_date','created_at'])).localeCompare(str(pick(a,['assigned_at','assigned_from','start_date','created_at']))));d=driverMap.get(String(matches[0]?.driver_id))||null}
 return {date:when,tripId:str(e.trip_id),truck:str(pick(truck,['truck_number','vehicle_number','registration_number'])||pick(trip,['truck_number','vehicle_number']))||'Not mapped',driver:str(pick(d,['name','driver_name','full_name']))||'Not mapped',driverId:d?.id||null,route:[pick(trip,['from_location','from_city','from']),pick(trip,['to_location','to_city','to'])].filter(Boolean).join(' → ')||str(e.trip_id||'—'),type:str(e.expense_type)||'Other',amount:Number(e.amount)||0,payment:str(e.payment_mode)||'—',description:str(e.description),vendor:str(e.vendor_name),bill:str(e.bill_number),created:str(e.created_at)};
 }).sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created));loaded=true;render();status(`${rows.length} saved Trip Expenses loaded from Trip Accounts · Read-only.${res.slice(1).some(r=>r.status==='rejected')?' Some master lookups unavailable.':''}`,res.slice(1).some(r=>r.status==='rejected'));void loadPhotos(drivers);
 }catch(e){status('Trip Expenses could not load: '+e.message,true);console.error('[Driver Khata Trip Expenses]',e)}})();try{await pending}finally{pending=null}}
 ['expenseFrom','expenseTo','expenseSearch'].forEach(id=>$(id).addEventListener('input',render));window.ektaLoadTripExpenses=load;window.ektaExpenseHisabRows=()=>loaded?rows.map(r=>({...r})):null;
})();

/* Card 6 — drill-down driver-wise review; settlement is deliberately not posted. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),db=()=>[window.supabaseClient,window.ektaSupabaseClient,window.dbClient].find(x=>x&&typeof x.from==='function');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const qty=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
 let manualExpenses=[],manualReady=false; let fixed=[],diesel=[],advances=[],expenses=[],loaded=false,pending=null,selected=null,issues=[],saving=false;
 const match=(r,g)=>norm(r.truck)===norm(g.truck)&&String(r.driverId||'UNMAPPED')===String(g.driverId||'UNMAPPED');
 let fleetOpenings=new Map(),fleetDate='',fleetMasters=new Map(),fleetDrivers=new Map();
 const period=r=>fleetOpenings.has(norm(r.truck))&&r.date>fleetOpenings.get(norm(r.truck)).opening_date&&(!$('finalFrom').value||r.date>=$('finalFrom').value)&&(r.date<=($('finalTo').value||new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)));
 const detailRows=(arr,g)=>arr.filter(r=>period(r)&&match(r,g));
 function groups(){const q=norm($('finalSearch').value),map=new Map();for(const [arr,kind] of [[fixed,'fixed'],[diesel,'diesel'],[advances,'advance'],[expenses.concat(manualExpenses),'expense']])for(const r of arr){if(!period(r)||q&&!norm(r.truck+' '+r.driver).includes(q))continue;const key=norm(r.truck)+'|'+String(r.driverId||'UNMAPPED');const g=map.get(key)||{key,truck:r.truck,driver:r.driver,driverId:r.driverId,fix:0,missing:0,litres:0,diesel:0,advance:0,expense:0,trips:0,hasDiesel:false,hasExpenses:false};if(kind==='fixed'){g.trips++;if(r.matched)g.fix+=r.amount;else g.missing++}if(kind==='diesel'){g.litres+=r.litres;g.diesel+=r.amount;g.hasDiesel=true}if(kind==='advance')g.advance+=r.amount;if(kind==='expense'){g.expense+=r.amount;g.hasExpenses=true}if((g.driver==='Not mapped'||g.driver==='—')&&r.driver)g.driver=r.driver;map.set(key,g)}for(const [tn,o] of fleetOpenings){if(($('finalFrom').value&&$('finalFrom').value>o.opening_date)||($('finalTo').value&&$('finalTo').value<o.opening_date))continue;const truck=fleetMasters.get(tn)||tn,driver=fleetDrivers.get(String(o.driver_id))||'Not mapped',key=tn+'|'+String(o.driver_id||'UNMAPPED');if(q&&!norm(truck+' '+driver).includes(q)&&!map.has(key))continue;const g=map.get(key)||{key,truck,driver,driverId:o.driver_id,fix:0,missing:0,litres:0,diesel:0,advance:0,expense:0,trips:0};g.opening=o;g.openingLitres=o.opening_diesel;g.openingAdvance=o.driver_id?o.opening_advance:null;g.openingFix=o.driver_id?o.opening_fix_kharcha:null;map.set(key,g)}for(const g of map.values()){g.newFix=g.fix;g.fix+=Number(g.openingFix||0);g.newLitres=g.litres;g.newAdvance=g.advance;g.litres+=Number(g.openingLitres||0);g.advance+=Number(g.openingAdvance||0)}return [...map.values()].sort((a,b)=>a.truck.localeCompare(b.truck)||a.driver.localeCompare(b.driver))}
 function render(){const gs=groups(),allF=gs.reduce((s,g)=>s+g.fix,0),allL=gs.reduce((s,g)=>s+g.litres,0),allD=gs.reduce((s,g)=>s+g.diesel,0),missing=gs.reduce((s,g)=>s+g.missing,0);$('finalFixed').textContent=money(allF)+(missing?' · '+missing+' rates pending':'');$('finalDieselLitres').textContent=qty(allL)+' L';$('finalDieselAmount').textContent=money(allD);$('finalDieselRate').textContent=gs.some(g=>g.newLitres>0)?money(allD/gs.reduce((s,g)=>s+g.newLitres,0))+'/L':'—';$('finalAdvance').textContent=money(gs.reduce((s,g)=>s+g.advance,0));$('finalExpenses').textContent=money(gs.reduce((s,g)=>s+g.expense,0));$('finalBalance').textContent='Pending verification';
 $('finalRows').innerHTML=gs.map(g=>`<tr><td><button type="button" class="dk-truck-link" data-dk-detail="${esc(g.key)}">${esc(g.truck)}</button></td><td>${esc(g.driver)}</td><td>${money(g.fix)}${g.missing?' ('+g.missing+' pending)':''}</td><td>${qty(g.litres)} L</td><td>${money(g.diesel)}</td><td>${g.newLitres?money(g.diesel/g.newLitres)+'/L':'—'}</td><td>${money(g.advance)}</td><td>${money(g.expense)}</td><td>Pending</td><td><span class="tag old">Review</span></td></tr>`).join('')||'<tr><td colspan="10" class="empty">No matching records.</td></tr>';
 $('finalStatus').textContent=`Opening date: ${fleetDate||'Mixed / not saved'} · Opening balances included; new transactions strictly after opening date. Vehicles without saved opening excluded. ${gs.reduce((s,g)=>s+g.trips,0)} trips (${missing} fixed rates pending) · ${gs.length} driver/vehicle accounts. Click a truck number for full details. Settlement not posted.${issues.length?' Source warning: '+issues.join('; '):''}`;
 if(selected){const g=gs.find(g=>g.key===selected.key);if(g)showDetail(g);else closeDetail()}}

 const expenseCats=['POLICE','RTO','GUARD','PARKING','WORK','FOODING','DALA','UNLOADING CHARGE','OVERLOAD','TOLL TAX','ENAM','TRIPAL','PANNI','OTHER'];
 const manualTable='driver_khata_manual_running_expenses';
 let expenseBusy=false,editExpense=null;
 const expensePeriod=g=>({from:$('finalFrom').value||fleetOpenings.get(norm(g.truck))?.opening_date||'',to:$('finalTo').value||new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)});
 let expenseContext=null;
 async function loadManualExpenses(){manualReady=false;try{let rows=[];for(let i=0;;i+=500){const {data,error}=await db().from(manualTable).select('*').order('id').range(i,i+499);if(error)throw Error(error.message);rows.push(...data);if(data.length<500)break}manualExpenses=rows.map(r=>({id:r.id,manual:true,truck:r.truck_number,driverId:r.driver_id,driver:fleetDrivers.get(String(r.driver_id))||'Not mapped',date:r.expense_date,type:r.expense_type,amount:Number(r.amount),description:r.remark,payment:'Driver'}));manualReady=true;}catch(e){issues.push('Manual running expenses unavailable: '+e.message)}}
 function renderExpenseHistory(){if(!selected)return;table('dkExpenses',detailRows(expenses.concat(manualExpenses),selected).sort((a,b)=>b.date.localeCompare(a.date)),[r=>esc(r.date),r=>esc(r.type),r=>money(r.amount),r=>esc(r.payment||'—'),r=>esc(r.description||r.route),r=>r.manual?`<button data-exp-edit="${esc(r.id)}">Edit</button> <button data-exp-delete="${esc(r.id)}">Delete</button>`:'Trip record']);}
 function expenseForm(){ $('dkExpenseForm').innerHTML='<div class="expense-line"><b>Expense Type</b><b>Rate ₹</b><b>Remark</b></div>'+expenseCats.map((c,i)=>`<div class="expense-line"><strong>${c}</strong><input aria-label="${c} rate" type="number" min="0" step="0.01" data-exp-amount="${i}" placeholder="0"><input aria-label="${c} remark" data-exp-remark="${i}" placeholder="Remark"></div>`).join('');editExpense=null;$('dkExpenseSave').textContent='Save All Expenses';$('dkExpenseDraftTotal').textContent=money(0);}
 const expInput=(kind,i)=>$('dkExpenseForm').querySelector(`[data-exp-${kind}="${i}"]`);
 $('dkExpenseForm').addEventListener('input',()=>{$('dkExpenseDraftTotal').textContent=money(expenseCats.reduce((s,c,i)=>s+(Number(expInput('amount',i).value)||0),0))});
 $('dkExpenseOpen').onclick=()=>{if(!selected)return;expenseForm();$('dkExpenseWho').textContent=selected.truck+' · '+selected.driver+' · Driver-paid expenses only';expenseContext=expensePeriod(selected);$('dkExpensePeriod').textContent='Hisab period: '+expenseContext.from+' to '+expenseContext.to;$('dkExpenseMessage').textContent=manualReady?'Enter only expenses not already recorded in Trip Accounts.':'Database unavailable. Run setup / check permissions and refresh.';$('dkExpenseSave').disabled=!manualReady||!selected.driverId;renderExpenseHistory();$('dkExpenseDialog').showModal()};
 $('dkExpenseSave').onclick=async()=>{if(expenseBusy||!manualReady||!selected?.driverId)return;const g=selected,msg=$('dkExpenseMessage');const range=expensePeriod(g),d=editExpense?manualExpenses.find(r=>String(r.id)===String(editExpense))?.date:range.to;try{if(!expenseContext||range.from!==expenseContext.from||range.to!==expenseContext.to)throw Error('Hisab period changed. Reopen expenses.');if(!d||!period({truck:g.truck,date:d}))throw Error('Hisab end date must be after opening date and within the selected period.');const rows=[];for(let i=0;i<expenseCats.length;i++){const a=expInput('amount',i),v=Number(a.value),remark=expInput('remark',i).value.trim();if(a.validity.badInput||!Number.isFinite(v)||v<0)throw Error('Invalid amount: '+expenseCats[i]);if(v>0)rows.push({truck_number:g.truck,driver_id:String(g.driverId),expense_date:d,expense_type:expenseCats[i],amount:v,remark});}if(!rows.length)throw Error('Enter at least one amount.');if(editExpense&&rows.length!==1)throw Error('Edit one expense at a time.');if(!confirm('Save driver-paid expenses? Do not repeat any existing Trip Accounts expense.'))return;expenseBusy=true;$('dkExpenseSave').disabled=true;const q=editExpense?db().from(manualTable).update(rows[0]).eq('id',editExpense).eq('driver_id',String(g.driverId)).eq('truck_number',g.truck):db().from(manualTable).insert(rows);const {data,error}=await q.select('id');if(error)throw Error(error.message);if(data?.length!==rows.length)throw Error('Save not confirmed. Refresh before retrying.');await loadManualExpenses();if(!manualReady||!data.every(x=>manualExpenses.some(r=>String(r.id)===String(x.id))))throw Error('Saved response received, but read-back failed. Refresh before retrying.');$('dkVerified').checked=false;render();$('dkExpenseDialog').close();$('dkDetailStatus').textContent='Running expenses saved and verified in Supabase.';}catch(e){msg.textContent=e.message}finally{expenseBusy=false;$('dkExpenseSave').disabled=!manualReady}};
 $('dkExpenses').addEventListener('click',async e=>{if(expenseBusy||!manualReady||!selected)return;const b=e.target.closest('[data-exp-edit],[data-exp-delete]');if(!b)return;const r=detailRows(manualExpenses,selected).find(x=>String(x.id)===(b.dataset.expEdit||b.dataset.expDelete));if(!r)return;if(b.dataset.expEdit){expenseForm();editExpense=r.id;const i=expenseCats.indexOf(r.type);if(i<0)return;expInput('amount',i).value=r.amount;expInput('remark',i).value=r.description;for(let k=0;k<expenseCats.length;k++)if(k!==i){expInput('amount',k).disabled=true;expInput('remark',k).disabled=true;}$('dkExpenseSave').textContent='Update Expense';$('dkExpenseDraftTotal').textContent=money(r.amount);return}if(!confirm('Delete this manual expense only?'))return;expenseBusy=true;$('dkExpenseSave').disabled=true;try{const {data,error}=await db().from(manualTable).delete().eq('id',r.id).eq('driver_id',String(selected.driverId)).eq('truck_number',selected.truck).select('id');if(error||data?.length!==1)throw Error(error?.message||'Delete not confirmed');await loadManualExpenses();render();expenseForm()}catch(e){$('dkExpenseMessage').textContent=e.message}finally{expenseBusy=false;$('dkExpenseSave').disabled=!manualReady}});

 function closeDetail(){$('dkDetail').hidden=true;selected=null}
 function table(id,rows,columns){$(id).innerHTML=rows.length?rows.map(r=>'<tr>'+columns.map(f=>'<td>'+f(r)+'</td>').join('')+'</tr>').join(''):`<tr><td colspan="${columns.length}" class="empty">No records for this driver/vehicle and date range.</td></tr>`}
 function showDetail(g){selected=g;$('dkDetail').hidden=false;$('dkDetailTitle').textContent=g.driver+' · '+g.truck;$('dkDetailMeta').textContent=g.trips+' loaded trips · '+g.missing+' missing fixed rates · '+qty(g.litres)+' L diesel · '+money(g.advance)+' advance';
 const fs=detailRows(fixed,g).sort((a,b)=>b.date.localeCompare(a.date)),ds=detailRows(diesel,g).sort((a,b)=>b.date.localeCompare(a.date)),as=detailRows(advances,g).sort((a,b)=>b.date.localeCompare(a.date)),es=detailRows(expenses.concat(manualExpenses),g).sort((a,b)=>b.date.localeCompare(a.date));
 $('dkSumTrips').textContent=String(fs.length);$('dkSumFixed').textContent=money(g.fix)+(g.missing?' · '+g.missing+' pending':'');$('dkSumDiesel').textContent=qty(g.litres)+' L';$('dkSumAdvance').textContent=money(g.advance);$('dkSumRunning').textContent=money(g.expense);
 $('dkTripCount').textContent=fs.length+' trips';$('dkAdvanceCount').textContent=as.length+' entries';$('dkDieselCount').textContent=ds.length+' entries';$('dkExpenseCount').textContent=es.length+' entries';
 $('dkSetFixed').textContent=money(g.fix);$('dkSetOpeningFix').textContent=g.openingFix==null?'Not entered':money(g.openingFix);$('dkSetNewFix').textContent=money(g.newFix);$('dkSetAdvance').textContent=money(g.advance);$('dkSetExpenses').textContent=money(g.expense);
 void loadDetailProfile(g);

 table('dkTrips',g.openingFix==null?fs:[{date:g.opening.opening_date,id:'Opening',route:'Opening Fix Kharcha',matched:true,amount:Number(g.openingFix),status:'Opening'},...fs],[r=>esc(r.date),r=>esc(r.id),r=>esc(r.route),r=>r.matched?money(r.amount):r.status==='Missing rate'&&r.from&&r.to?`<span class="dk-rate"><input type="number" min="0" step="0.01" data-dk-amount="${esc(r.id)}" placeholder="₹ Rate"><button type="button" data-dk-save="${esc(r.id)}">Save Rate</button></span>`:'—',r=>esc(r.status)]);
 if(g.openingLitres!=null)ds.unshift({date:g.opening.opening_date,pump:'Opening balance',source:'Opening',litres:Number(g.openingLitres),amount:null,ref:'Opening'});if(g.openingAdvance!=null)as.unshift({date:g.opening.opening_date,source:'Opening balance',amount:Number(g.openingAdvance),ref:'Opening'});
 table('dkDiesel',ds,[r=>esc(r.date),r=>esc(r.pump),r=>esc(r.source),r=>qty(r.litres)+' L',r=>r.amount==null?'—':money(r.amount),r=>esc(r.ref)]);
 table('dkAdvances',as,[r=>esc(r.date),r=>esc(r.source),r=>money(r.amount),r=>esc(r.ref)]);
 $('dkExpenseTotal').textContent=money(g.expense); renderExpenseHistory();
 $('dkDetailStatus').textContent='Diesel amount is informational, not an automatic deduction. Opening/Closing KM and approved average are required for extra diesel calculation. Driver settlement remains pending.';
 const kmKey='ekta-dk-final-km:'+g.key;try{const saved=JSON.parse(localStorage.getItem(kmKey)||'{}');$('dkOpeningKm').value='';$('dkClosingKm').value=saved.close??'';$('dkAverage').value=saved.average??'5.25';$('dkExtraKm').value=saved.extraKm??'';$('dkManualRate').value=saved.rate??'';$('dkVerified').checked=false}catch{}calcDiesel();void loadOpeningKmFromCard1(g);}
 async function loadOpeningKmFromCard1(g){
 const stamp=g.key; $('dkOpeningInfo').textContent='Loading Supabase opening…';$('dkOpeningKm').value='';calcDiesel();
 try{if(!db())throw Error('Database unavailable');const [tr,op]=await Promise.all([db().from('trucks').select('*'),db().from('driver_khata_vehicle_openings').select('*').like('assignment_id','truck:%')]);if(tr.error||op.error)throw Error((tr.error||op.error).message);if(!selected||selected.key!==stamp)return;const ids=new Set((tr.data||[]).filter(t=>norm(t.truck_number||t.vehicle_number||t.registration_number||t.number)===norm(g.truck)).map(t=>String(t.id)));const from=$('finalFrom').value;const rows=(op.data||[]).filter(r=>ids.has(String(r.truck_id))&&r.opening_date===from);if(rows.length!==1)throw Error('Select the saved opening date as From Date; exactly one matching assignment is required.');const r=rows[0];$('dkOpeningKm').value=r.opening_km;$('dkOpeningInfo').textContent='Supabase opening '+r.opening_date+' · Diesel: '+(r.opening_diesel==null?'Not entered':qty(r.opening_diesel)+' L')+' · Advance: '+(r.opening_advance==null||String(r.driver_id)!==String(g.driverId)?'Pending verification':money(r.opening_advance));calcDiesel();}catch(e){if(selected?.key===stamp)$('dkOpeningInfo').textContent='Opening not loaded: '+e.message;}
 }
 async function loadDetailProfile(g){
  const stamp=g.key;const photo=$('dkPhoto');photo.textContent=String(g.driver||'?').charAt(0).toUpperCase();$('dkPhone').textContent='Phone: —';
  if(!g.driverId||!db())return;
  try{const {data:d,error}=await db().from('drivers').select('*').eq('id',g.driverId).maybeSingle();if(error)throw error;if(!selected||selected.key!==stamp)return;
   const phone=['phone','phone_number','mobile','mobile_number','contact_number','contact_no','driver_phone'].map(k=>d?.[k]).find(Boolean);
   $('dkPhone').textContent='Phone: '+(phone||'Not recorded');
   const direct=['photo_url','profile_photo_url','driver_photo_url','avatar_url'].map(k=>d?.[k]).find(v=>typeof v==='string'&&/^https:\/\//.test(v));
   let url=direct||'';
   if(!url){const {data:docs,error:de}=await db().from('driver_documents').select('storage_path').eq('driver_id',g.driverId).eq('document_type','photo').order('created_at',{ascending:false}).limit(1);if(!de&&docs?.[0]?.storage_path){const signed=await db().storage.from('driver-documents').createSignedUrl(docs[0].storage_path,3600);url=signed.data?.signedUrl||'';}}
   if(url&&selected?.key===stamp){const img=document.createElement('img');img.src=url;img.alt='Driver photo';img.onerror=()=>{photo.textContent=String(g.driver||'?').charAt(0).toUpperCase()};photo.replaceChildren(img)}
  }catch(e){console.warn('[Driver Khata] Profile unavailable:',e.message)}
 }
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 let currentSettlement=null, savedSettlement=null, settlementBusy=false;
 function calcDiesel(){
  currentSettlement=null;savedSettlement=null;if(!selected)return;
  const g=selected,o=$('dkOpeningKm').value,c=$('dkClosingKm').value,a=$('dkAverage').value,rate=Number($('dkManualRate').value),extra=Number($('dkExtraKm').value||0);
  const paid=detailRows(expenses.concat(manualExpenses),g).filter(r=>r.manual||/^(driver|driver paid|paid by driver)$/i.test(String(r.payment).trim()));
  const expense=round(paid.reduce((s,r)=>s+r.amount,0));$('dkSetExpenses').textContent=money(expense);
  $('dkSetProvisional').textContent='Pending verification';$('dkBalanceLabel').textContent='Final Balance';$('dkSetDieselAdjust').textContent='Pending';$('dkSaveHisab').disabled=true;$('dkPrintHisab').disabled=true;
  if(!o||!c||!a||![+o,+c,+a,extra].every(Number.isFinite)||+o<0||+c<+o||+a<=0||extra<0){$('dkDieselCalc').textContent='Enter valid KM and average.';return;}
  const running=+c-+o,required=round(running/+a),diff=round(g.litres-required),adjust=round(-diff*rate),balance=round(g.fix+expense-g.advance+adjust);
  const box=(label,value)=>`<div class="dk-calc-result"><span>${label}</span><strong>${value}</strong></div>`;
  $('dkDieselCalc').innerHTML=[box('Total Running',qty(running)+' KM'),box('Required Diesel',qty(required)+' L'),box('Diesel Taken',qty(g.litres)+' L'),box(diff>0?'Company Diesel':diff<0?'Driver Diesel':'Balanced Diesel',qty(Math.abs(diff))+' L'),box('Manual Diesel Rate',rate>0?money(rate)+'/L':'Pending'),box('Diesel Adjustment',rate>0?money(adjust):'Pending'),box('Extra KM (Separate)',qty(extra)+' KM')].join('');
  if(!(rate>0&&Number.isFinite(rate)))return;
  $('dkSetDieselAdjust').textContent=(adjust>=0?'+':'−')+money(Math.abs(adjust));
  if(g.missing||issues.length||!manualReady||!g.driverId||!g.opening||g.openingLitres==null||g.openingAdvance==null||g.openingFix==null){$('dkSettlementStatus').textContent='Resolve missing rates, opening values or source warnings before saving.';return;}
  $('dkBalanceLabel').textContent=balance>0?'Payable to Driver':balance<0?'Receivable by Company':'Settled';$('dkSetProvisional').textContent=money(Math.abs(balance));
  const from=g.opening.opening_date,to=$('finalTo').value||new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  currentSettlement={truck:g.truck,driver:g.driver,driver_id:String(g.driverId),from,to,opening:g.opening,km:{opening:+o,closing:+c,average:+a,extra,running,required,taken:g.litres,diff,rate,adjust},fix:g.fix,advance:g.advance,expense,balance,trips:detailRows(fixed,g),diesel:detailRows(diesel,g),advances:detailRows(advances,g),expenses:detailRows(expenses.concat(manualExpenses),g),paid};
  $('dkSettlementStatus').textContent='Verify all entries before saving. Saved statements do not reset opening balances.';$('dkSaveHisab').disabled=!$('dkVerified').checked||settlementBusy;$('dkPrintHisab').disabled=false;
 }
 $('dkVerified').onchange=calcDiesel;
 const settlementTable='driver_khata_settlement_snapshots';
 function printStatement(s,id){const w=window.open('','_blank');if(!w){alert('Allow popups to print.');return;}
 const table=(title,heads,rows)=>'<h3>'+esc(title)+'</h3><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const k=s.km;const content='<h1>EKTA TRANSPORT</h1><h2>DRIVER KHATA — FINAL HISAB</h2><p>'+esc(s.driver)+' | '+esc(s.truck)+' | '+esc(s.from)+' to '+esc(s.to)+' | '+esc(id||'DRAFT — NOT SAVED')+'</p>'+table('01. Trip Fixed Kharcha',['Date','Trip ID','Route','Amount'],[[s.from,'Opening','Opening Fix Kharcha',money(s.opening.opening_fix_kharcha)],...s.trips.map(r=>[r.date,r.id,r.route,money(r.amount)])])+table('02. Advance',['Date','Source','Reference','Amount'],[[s.from,'Opening','',money(s.opening.opening_advance)],...s.advances.map(r=>[r.date,r.source,r.ref,money(r.amount)])])+table('03. Diesel Taken',['Date','Pump','Source','Litres','Amount','Ref'],[[s.from,'Opening','Opening',s.opening.opening_diesel,'—',''],...s.diesel.map(r=>[r.date,r.pump,r.source,r.litres,money(r.amount),r.ref])])+table('04. Running Expenses',['Date','Type','Paid via','Remark','Amount','Included'],s.expenses.map(r=>[r.date,r.type,r.payment,r.description,money(r.amount),s.paid.some(x=>JSON.stringify(x)===JSON.stringify(r))?'Yes':'No']))+table('05. Diesel Calculation',['Particular','Value'],Object.entries(k).map(([a,b])=>[a,b]))+table('06. Final Settlement',['Particular','Amount'],[['Opening Fix Kharcha',money(s.opening.opening_fix_kharcha)],['New Trip Fix Kharcha',money(s.fix-Number(s.opening.opening_fix_kharcha||0))],['Total Fix Kharcha',money(s.fix)],['Driver-paid expenses (+)',money(s.expense)],['Advance (−)',money(s.advance)],['Diesel adjustment',money(k.adjust)],[s.balance>=0?'Payable to Driver':'Receivable by Company',money(Math.abs(s.balance))]])+'<footer>Driver Signature __________________ &nbsp; Munshi __________________ &nbsp; Authorised __________________</footer>';
 w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Driver Hisab</title><style>@page{size:A4;margin:12mm}body{font:11px Arial;color:#172b46}h1,h2{text-align:center;margin:5px}h3{margin:14px 0 5px}table{border-collapse:collapse;width:100%;table-layout:auto}td,th{border:1px solid #aab5c2;padding:5px;text-align:left;overflow-wrap:anywhere}th{background:#edf2f7}thead{display:table-header-group}tr{break-inside:avoid}h3{break-after:avoid}footer{margin-top:35px;break-inside:avoid}</style></head><body>'+content+'</body></html>');w.document.close();w.focus();w.print();}
 $('dkPrintHisab').onclick=()=>{if(currentSettlement)printStatement(currentSettlement,savedSettlement)};
 $('dkSaveHisab').onclick=async()=>{if(!currentSettlement||!$('dkVerified').checked||settlementBusy)return;const s=structuredClone(currentSettlement);if(!confirm('Save verified statement? This does not reset opening or post payment.'))return;settlementBusy=true;$('dkSaveHisab').disabled=true;try{const {data,error}=await db().from(settlementTable).insert({truck_number:s.truck,driver_id:s.driver_id,period_from:s.from,period_to:s.to,snapshot:s}).select('id').single();if(error||!data)throw Error(error?.message||'Save not confirmed');savedSettlement=data.id;$('dkSettlementStatus').textContent='Saved in Supabase: '+data.id;}catch(e){$('dkSettlementStatus').textContent='Save failed: '+e.message}finally{settlementBusy=false}};
 $('dkHistory').onclick=async()=>{if(!selected)return;try{const {data,error}=await db().from(settlementTable).select('*').eq('truck_number',selected.truck).eq('driver_id',String(selected.driverId)).order('created_at',{ascending:false});if(error)throw Error(error.message);if(!data.length){alert('No saved statements');return;}const choice=prompt(data.map((r,i)=>(i+1)+'. '+r.period_from+' to '+r.period_to+' | '+money(r.snapshot.balance)).join('\n')+'\nEnter statement number to print:');const r=data[Number(choice)-1];if(r)printStatement(r.snapshot,r.id)}catch(e){alert(e.message)}};
 async function saveRate(id){if(saving||!selected||!db())return;const r=detailRows(fixed,selected).find(x=>String(x.id)===String(id));if(!r||r.matched||r.status!=='Missing rate'||!r.from||!r.to)return;const input=[...$('dkTrips').querySelectorAll('[data-dk-amount]')].find(x=>x.dataset.dkAmount===id);if(!input)return;const raw=input.value.trim(),amount=Number(raw);if(!raw||!Number.isFinite(amount)||amount<0){$('dkDetailStatus').textContent='Please enter a valid Fixed Kharcha amount.';return}saving=true;input.disabled=true;
 try{const pair=(a,b)=>[norm(a),norm(b)].sort().join('|');const target=pair(r.from,r.to);let existing=[];for(let off=0;off<50000;off+=500){const {data,error}=await db().from('fixed_kharcha_rates').select('*').range(off,off+499);if(error)throw error;existing.push(...(data||[]));if((data||[]).length<500)break}const matches=existing.filter(x=>pair(x.from_location,x.to_location)===target);if(matches.length){const amounts=[...new Set(matches.map(x=>Number(x.amount)))];if(amounts.length!==1||amounts[0]!==amount){if(!window.confirm(`Route ${r.from} ↔ ${r.to} already has ${amounts.map(money).join(', ')} in the shared Route Master. Update BOTH directions to ${money(amount)}?`))return;for(const x of matches){const {error}=await db().from('fixed_kharcha_rates').update({amount}).eq('id',x.id);if(error)throw error}}}else{const [from_location,to_location]=[r.from.toUpperCase(),r.to.toUpperCase()].sort();const {error}=await db().from('fixed_kharcha_rates').insert({from_location,to_location,amount});if(error)throw error}await window.ektaRefreshFixedTrips();fixed=window.ektaFixedHisabRows?.()||[];render();$('dkDetailStatus').textContent=`Saved ${money(amount)} in shared Fixed Kharcha Route Master. Card 2 and Final Hisab refreshed.`;
 }catch(e){$('dkDetailStatus').textContent='Save failed: '+e.message}finally{saving=false;if(input.isConnected)input.disabled=false}}
 async function load(force=false){if(pending)return pending;if(loaded&&!force){render();return}if(!db()){$('finalStatus').textContent='Supabase unavailable.';return}pending=(async()=>{try{$('finalStatus').textContent='Loading trips, diesel, advances and expenses…';await Promise.all([window.ektaLoadFixedTrips?.(force),window.ektaLoadDieselTaken?.(force),window.ektaLoadDriverAdvances?.(force),window.ektaLoadTripExpenses?.(force)]);const [ot,tt,dt]=await Promise.all([db().from('driver_khata_vehicle_openings').select('*').like('assignment_id','truck:%'),db().from('trucks').select('*'),db().from('drivers').select('*')]);if(ot.error||tt.error||dt.error)throw Error((ot.error||tt.error||dt.error).message);const tm=new Map((tt.data||[]).map(t=>[String(t.id),norm(t.truck_number||t.vehicle_number||t.registration_number||t.number)]));fleetMasters=new Map((tt.data||[]).map(t=>[tm.get(String(t.id)),t.truck_number||t.vehicle_number||t.registration_number||t.number]));fleetDrivers=new Map((dt.data||[]).map(d=>[String(d.id),d.name||d.driver_name||d.full_name]));fleetOpenings=new Map((ot.data||[]).filter(r=>tm.get(String(r.truck_id))).map(r=>[tm.get(String(r.truck_id)),r]));const dates=[...new Set([...fleetOpenings.values()].map(r=>r.opening_date))];fleetDate=dates.length===1?dates[0]:'';if(fleetDate&&!$('finalFrom').value)$('finalFrom').value=fleetDate;issues=[];if(!fleetDate)issues.push('No single common opening date; only saved vehicles and their own opening dates are included');fixed=window.ektaFixedHisabRows?.()||[];diesel=window.ektaDieselHisabRows?.()||[];advances=window.ektaAdvanceHisabRows?.()||[];expenses=window.ektaExpenseHisabRows?.()||[];if(!window.ektaFixedHisabRows?.())issues.push('Trip Fixed data unavailable');if(!window.ektaDieselHisabRows?.())issues.push('Diesel data unavailable');if(!window.ektaAdvanceHisabRows?.())issues.push('Advance data unavailable');if(window.ektaAdvanceReview?.().length)issues.push('Transporter advances need review: '+window.ektaAdvanceReview().join(', '));if(!window.ektaExpenseHisabRows?.())issues.push('Expense data unavailable');await loadManualExpenses();loaded=true;render()}catch(e){$('finalStatus').textContent='Final Hisab load failed: '+e.message;console.error('[Final Hisab]',e)}})();try{await pending}finally{pending=null}}
 $('finalRows').addEventListener('click',e=>{const b=e.target.closest('[data-dk-detail]');if(!b)return;
  // Open the full driver account in its own browser tab, not below the summary table.
  const url=new URL(window.location.href);url.searchParams.set('dk_account',b.dataset.dkDetail);
  url.searchParams.set('dk_from',$('finalFrom').value);url.searchParams.set('dk_to',$('finalTo').value);
  const tab=window.open(url.toString(),'_blank');if(!tab){$('finalStatus').textContent='Please allow pop-ups for this site to open the driver account in a new tab.';}
 });
 const accountKey=new URLSearchParams(window.location.search).get('dk_account');
 if(accountKey){
  document.body.classList.add('dk-account-tab');
  $('finalFrom').value=new URLSearchParams(window.location.search).get('dk_from')||'';
  $('finalTo').value=new URLSearchParams(window.location.search).get('dk_to')||'';
  const detail=$('dkDetail');
  const page=document.createElement('main');page.id='dkAccountPage';
  const top=document.createElement('div');top.className='dk-account-top';
  top.innerHTML='<strong>EKTA TRANSPORT <span> / DRIVER KHATA / FINAL HISAB</span></strong><button type="button" id="dkTabBack">← Back</button>';
  page.append(top,detail);document.body.appendChild(page);
  $('dkTabBack').addEventListener('click',()=>{if(window.opener){window.close()}else{window.location.href=window.location.pathname}});
  $('dkClose').textContent='← Back';$('dkClose').addEventListener('click',()=>{if(window.opener)window.close();else window.location.href=window.location.pathname});
  void load().then(()=>{const g=groups().find(x=>x.key===accountKey);if(g){showDetail(g);document.title=g.driver+' · '+g.truck+' | Driver Khata'}else{detail.hidden=false;$('dkDetailStatus').textContent='No matching driver account found. Check the date range or return to Final Hisab.'}});
 }
 $('dkClose').addEventListener('click',closeDetail);$('dkTrips').addEventListener('click',e=>{const b=e.target.closest('[data-dk-save]');if(b)void saveRate(b.dataset.dkSave)});
 for(const id of ['dkOpeningKm','dkClosingKm','dkAverage','dkExtraKm','dkManualRate'])$(id).addEventListener('input',()=>{$('dkVerified').checked=false;calcDiesel()});
 $('dkSaveKm').addEventListener('click',()=>{if(!selected)return;const open=$('dkOpeningKm').value,close=$('dkClosingKm').value,average=$('dkAverage').value,extraKm=$('dkExtraKm').value;if((open||close||average)&&(!open||!close||!average||Number(close)<Number(open)||Number(average)<=0||!Number.isFinite(Number(open))||!Number.isFinite(Number(close))||!Number.isFinite(Number(average)))){$('dkDetailStatus').textContent='Check Opening KM, Closing KM and average before saving draft.';return}if(extraKm!==''&&(!Number.isFinite(Number(extraKm))||Number(extraKm)<0)){$('dkDetailStatus').textContent='Extra KM must be zero or positive.';return}try{localStorage.setItem('ekta-dk-final-km:'+selected.key,JSON.stringify({open,close,average,extraKm,rate:$('dkManualRate').value}));$('dkDetailStatus').textContent='Opening/Closing KM, Average and Extra KM saved as browser draft ONLY. Automatic diesel estimate updated; no deduction or settlement posted.'}catch(e){$('dkDetailStatus').textContent='Browser draft save failed: '+e.message}});
 ['finalFrom','finalTo','finalSearch'].forEach(id=>$(id).addEventListener('input',render));$('finalRefresh').addEventListener('click',()=>load(true));window.ektaLoadFinalHisab=load;
})();
