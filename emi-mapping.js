(function(){
'use strict';
// This module is deliberately read-only: it never writes Supabase or edits existing transaction rows.
let groups=[], examples=[], loaded=false, matches=[];
const $=id=>document.getElementById(id);
const text=x=>String(x??'').trim();
const norm=x=>text(x).toUpperCase().replace(/[^A-Z0-9]/g,'');
const esc=x=>text(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const amount=x=>{const n=Number(text(x).replace(/[,₹\s]/g,''));return Number.isFinite(n)?n:0};
const day=x=>{const a=text(x).match(/\b(\d{1,2})(?:ST|ND|RD|TH)?\b/i);return a?+a[1]:null};
const dateDay=x=>{const a=text(x).match(/^(\d{1,2})[-/]/);return a?+a[1]:null};
const bankName=x=>norm(x).startsWith('ICICI')?'ICICI':norm(x).startsWith('HDFC')?'HDFC':'';
const report=s=>{if($('emiMappingStatus'))$('emiMappingStatus').textContent=s};
async function ensureXLSX(){if(window.XLSX)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('Excel reader library unavailable'));document.head.appendChild(s)})}
function sheetRows(wb,name){const s=wb.Sheets[name];if(!s)throw new Error('Required sheet missing: '+name);return XLSX.utils.sheet_to_json(s,{defval:'',raw:false})}
async function loadFile(file){if(!file)return;try{
 await ensureXLSX();const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
 const a=sheetRows(wb,'EMI Mapping Queue'),b=sheetRows(wb,'Bank Match 15th');
 if(!a.length||!b.length)throw new Error('Mapping workbook contains no records');
 groups=a.map((r,i)=>({id:i+1,day:day(r['EMI Day']),bank:bankName(r['Bank']),group:text(r['Vehicle / Loan Group']),finance:text(r['Finance Company (source)']),split:text(r['Amount / Split (source)']),breakup:text(r['Breakup (source)']),ledger:text(r['Suggested Ledger']),truck:text(r['Truck Number']),loan:text(r['Loan Account Confirmed']),status:text(r['Mapping Status'])})).filter(x=>x.bank&&x.group);
 examples=b.map(r=>({day:dateDay(r['Date']),bank:bankName(r['Statement']),amt:amount(r['Debit amount']),count:amount(r['Occurrences (photo)']),group:text(r['Group in EMI List']),finance:text(r['Finance / ACH'])})).filter(x=>x.day&&x.bank&&x.amt);
 loaded=true;refresh();
 }catch(e){groups=[];examples=[];loaded=false;matches=[];report('EMI file rejected: '+e.message);if($('emiMappingRows'))$('emiMappingRows').innerHTML='<tr><td colspan="5">File not loaded</td></tr>';alert('EMI Mapping import failed: '+e.message)}
}
function match(row,bank){
 const d=dateDay(row.date),amt=amount(row.debit);if(!amt||!d)return {label:'—',status:'Not an EMI debit / date missing'};
 // Bank Match 15th is a historical illustration, NOT a verified loan or truck master.
 const candidates=examples.filter(x=>x.bank===bank&&x.amt===amt&&Math.abs(x.day-d)<=1);
 if(!candidates.length)return {label:'—',status:'No verified schedule match; manual review'};
 const names=[...new Set(candidates.map(x=>x.group+' ('+x.finance+')'))];
 const dayExact=candidates.some(x=>x.day===d);
 return {label:names.join(' / '),status:(dayExact?'Amount + bank + day':'Amount + bank; date ±1 day')+' — GROUP CANDIDATE ONLY; verify loan/truck',count:candidates.reduce((s,x)=>s+x.count,0)};
}
function refresh(){const host=$('emiMappingRows');if(!host)return;
 const snap=window.EktaAccounts?.getReviewSnapshot?.()||{bank:'',rows:[]};const bank=bankName(snap.bank);
 matches=snap.rows.map((r,i)=>({r,i,m:match(r,bank)})).filter(x=>x.m.label!=='—');
 if(!loaded){report('Upload Ekta_EMI_Mapping_V1_Review.xlsx. Bank transactions remain read-only.');host.innerHTML='<tr><td colspan="5">No EMI mapping workbook loaded.</td></tr>';return}
 report(`${groups.length} EMI group review rows loaded • ${examples.length} historical bank examples • ${snap.rows.length} bank transactions scanned • ${matches.length} possible EMI group matches. NO truck/loan auto-linking; NO saving.`);
 host.innerHTML=matches.length?matches.map(({r,m})=>`<tr><td>${esc(r.date)}</td><td>${esc((r.reference||'')+' • '+(r.narration||'')).slice(0,160)}</td><td>₹${amount(r.debit).toLocaleString('en-IN')}</td><td>${esc(m.label)}</td><td style="color:#92400e">${esc(m.status)}</td></tr>`).join(''):'<tr><td colspan="5">No amount/date/bank candidates in the uploaded statement. This is not proof that no EMI exists.</td></tr>';
}
function clearBankRows(){matches=[];refresh()}
function clear(){groups=[];examples=[];loaded=false;matches=[];if($('emiMappingFile'))$('emiMappingFile').value='';refresh()}
function exportReview(){if(!loaded){alert('Load the EMI Mapping Excel first');return}const csv=(v)=>'"'+text(v).replace(/"/g,'""')+'"';const rows=[['Date','Reference','Narration','Debit','Potential EMI group','Status'],...matches.map(({r,m})=>[r.date,r.reference,r.narration,r.debit,m.label,m.status])];const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(csv).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Ekta_EMI_Candidate_Review.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
window.EktaEMI={loadFile,refresh,clearBankRows,clear,exportReview};
})();
