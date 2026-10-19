/* Ekta Transport — bank statement reading only. No Gemini, no Supabase, no posting. */
(function(){'use strict';
const str=v=>String(v??'').trim();
const amount=v=>{let t=str(v).replace(/[₹,\s]/g,'');let negative=t.includes('-')||/^\(.*\)$/.test(t);t=t.replace(/[^0-9.]/g,'');return t&&/^\d+(?:\.\d+)?$/.test(t)?Number(t)*(negative?-1:1):0};
function date(v){let m=str(v).match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);if(m)return `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}-${m[3].length===2?'20'+m[3]:m[3]}`;m=str(v).match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);if(m){let i=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2].toUpperCase());if(i>=0)return `${m[1].padStart(2,'0')}-${String(i+1).padStart(2,'0')}-${m[3].length===2?'20'+m[3]:m[3]}`}return ''}
function validate(rows){
let errors=[];const cents=n=>Math.round(Number(n)*100);const pairs=[];
for(let i=0;i<rows.length;i++){
 const r=rows[i];
 if(!r.date||!r.narration||(!r.debit&&!r.credit)||(r.debit&&r.credit))errors.push(`Row ${i+1}: incomplete or ambiguous transaction`);
 if(i&&Number.isFinite(r.closing_balance)&&Number.isFinite(rows[i-1].closing_balance)){
  const prev=rows[i-1],actual=cents(r.closing_balance),forward=cents(prev.closing_balance-r.debit+r.credit),reverse=cents(prev.closing_balance+prev.debit-prev.credit);
  pairs.push({i,actual,forward,reverse});
 }
}
// Bank PDFs may display transactions newest-first. In that order, the *previous displayed row's*
// debit/credit moves its balance back to the next (older) row. Never simply suppress warnings.
const forwardHits=pairs.filter(p=>p.actual===p.forward).length;
const reverseHits=pairs.filter(p=>p.actual===p.reverse).length;
const direction=reverseHits>forwardHits?'newest-first':'oldest-first';
for(const p of pairs){const expected=direction==='newest-first'?p.reverse:p.forward;
 if(p.actual!==expected)errors.push(`Row ${p.i+1}: balance mismatch (expected ${expected/100}, got ${p.actual/100})`);
}
return {valid:errors.length===0,errors,direction,checkedBalancePairs:pairs.length,totalDebit:rows.reduce((v,r)=>v+r.debit,0),totalCredit:rows.reduce((v,r)=>v+r.credit,0)}
}
async function library(url,check){if(check())return;await new Promise((ok,fail)=>{let el=document.createElement('script');el.src=url;el.onload=ok;el.onerror=()=>fail(new Error('Reader library could not load'));document.head.appendChild(el)})}
async function pdf(file){await library('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',()=>!!window.pdfjsLib);const lib=window.pdfjsLib;lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;let all=[],account='';
for(let pn=1;pn<=doc.numPages;pn++){const p=await doc.getPage(pn),items=(await p.getTextContent()).items.filter(i=>str(i.str)).map(i=>({text:str(i.str),x:i.transform[4],y:p.view[3]-i.transform[5]}));if(!items.length)continue;const raw=items.map(i=>i.text).join(' ');if(!account){let m=raw.match(/Account\s*number\s*:\s*(\d{8,20})/i);if(m)account=m[1]}
const scale=p.view[2]/595;const bounds=[78,146,218,280,354,423,489].map(x=>x*scale);const lines=[];for(const item of items){let l=lines.find(x=>Math.abs(x.y-item.y)<3);if(!l){l={y:item.y,items:[]};lines.push(l)}l.items.push(item)}lines.sort((a,b)=>a.y-b.y);for(const l of lines)l.items.sort((a,b)=>a.x-b.x);
const cells=l=>{const out=Array.from({length:8},()=>[]);for(const item of l.items){let k=bounds.findIndex(b=>item.x<b);out[k<0?7:k].push(item.text)}return out.map(x=>x.join('').trim())};
let active=null,legend=false;const flush=()=>{if(!active)return;active.narration=active.parts.join('').trim();if(active.closing_balance!==null)active.closing_balance=Math.abs(active.closing_balance)*active.balanceSign;delete active.balanceSign;delete active.parts;if(active.date&&active.narration&&(active.debit||active.credit))all.push(active);active=null};
for(const l of lines){if(l.items.some(x=>/Legends\s*Used|^Legends$/i.test(x.text))){flush();legend=true;break}if(l.items.some(x=>/^Generated\s*on/i.test(x.text))){flush();break}const c=cells(l),id=(c[1].match(/S\d{5,}/i)||[])[0];if(/^\d{1,5}$/.test(c[0])&&id){flush();active={date:date(c[2]),bank_transaction_id:id,reference:id,parts:c[4]?[c[4]]:[],debit:amount(c[5]),credit:amount(c[6]),closing_balance:c[7]&&/\d/.test(c[7])?amount(c[7]):null,balanceSign:c[7].trim()==='-'?-1:1,bank_account:account,dateParts:c[2],page:pn}}else if(active){if(c[4])active.parts.push(c[4]);if(c[2]){active.dateParts+=c[2];active.date=date(active.dateParts)||active.date}if(c[7]){if(c[7].trim()==='-'){active.balanceSign=-1;if(active.closing_balance!==null)active.closing_balance=-Math.abs(active.closing_balance)}else if(/\d/.test(c[7]))active.closing_balance=amount(c[7])*active.balanceSign;}if(c[5]&&!active.debit)active.debit=amount(c[5]);if(c[6]&&!active.credit)active.credit=amount(c[6])}}
flush()}
if(!all.length)throw new Error('ICICI transaction text was not found; scanned/unsupported PDF requires separate OCR review.');const audit=validate(all);return {rows:all,account,format:'ICICI PDF',audit}}
function header(grid){for(let i=0;i<Math.min(40,grid.length);i++){const h=grid[i].map(x=>str(x).toUpperCase());if(h.some(x=>x==='DATE')&&h.some(x=>/NARRAT|PARTICULAR|DESCRIPTION/.test(x))&&h.some(x=>/WITHDRAW|DEBIT/.test(x)))return i}return -1}
function hdfcAccountFromGrid(grid){
 const pre=grid.slice(0,45).flat().map(str).join(' ');
 const m=pre.match(/Account\s*No\s*[:.]?\s*(\d{10,20})/i);
 return m?m[1]:'';
}
async function excel(file){await library('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',()=>!!window.XLSX);const wb=window.XLSX.read(await file.arrayBuffer(),{type:'array'});let all=[],account='',accountConflict=false;for(const name of wb.SheetNames){const grid=window.XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:false}),hi=header(grid);const sheetAccount=hdfcAccountFromGrid(grid);if(sheetAccount){if(account&&account!==sheetAccount)accountConflict=true;account=sheetAccount;}if(hi<0)continue;const h=grid[hi].map(x=>str(x).toUpperCase()),ix=(...words)=>h.findIndex(x=>words.some(w=>x.includes(w)));const di=ix('DATE'),ni=ix('NARRAT','PARTICULAR','DESCRIPTION'),dr=ix('WITHDRAW','DEBIT'),cr=ix('DEPOSIT','CREDIT'),bi=ix('BALANCE'),ri=ix('REF.NO','REFERENCE','TRANSACTION ID','CHEQUE','CHQ.');for(const row of grid.slice(hi+1)){const d=date(row[di]),narr=str(row[ni]),debit=amount(row[dr]),credit=amount(row[cr]);if(d&&(narr||debit||credit)){all.push({date:d,narration:narr,reference:ri>=0?str(row[ri]):'',debit,credit,closing_balance:bi>=0&&str(row[bi])?amount(row[bi]):null,bank_transaction_id:ri>=0?str(row[ri]):'',bank_account:''})}else if(all.length&&narr&&!row[di]&&!debit&&!credit){all[all.length-1].narration+=' '+narr}}}if(accountConflict)throw new Error('Conflicting HDFC account numbers in workbook sheets.');if(!all.length)throw new Error('No HDFC transaction rows detected.');return {rows:all,account,format:'HDFC Excel',audit:validate(all)}}
window.EktaBankParser={pdf,excel,validate};
})();
