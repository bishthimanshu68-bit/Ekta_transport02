/* Ekta Transport shared location matching. Read-only; no DB writes. */
(function(root){'use strict';
 const aliases={
  'VARANSI':'VARANASI','BANARAS':'VARANASI','BENARES':'VARANASI',
  'SILGURI':'SILIGURI','SILIGURI':'SILIGURI',
  'BANGLORE':'BANGALORE','BENGALURU':'BANGALORE','BANGALURU':'BANGALORE',
  'COIMBTOR':'COIMBATORE','COIMBTORE':'COIMBATORE','COIMBATUR':'COIMBATORE',
  'GURGAON':'GURUGRAM','GURUGAON':'GURUGRAM',
  'GAZIABAD':'GHAZIABAD','GHAZIABD':'GHAZIABAD',
  'GREATER NOIDA':'GREATER NOIDA','GR NOIDA':'GREATER NOIDA',
  'NEW DELHI':'DELHI','N DELHI':'DELHI',
  'MERUT':'MEERUT','MEERUTT':'MEERUT',
  'CUTTACK':'CUTTACK','CUTAK':'CUTTACK',
  'VIJAYWADA':'VIJAYAWADA','VIJAYVADA':'VIJAYAWADA',
  'VISHAKHAPATNAM':'VISAKHAPATNAM','VIZAG':'VISAKHAPATNAM',
  'HYDRABAD':'HYDERABAD','HAIDARABAD':'HYDERABAD',
  'JAIPURR':'JAIPUR','LUKNOW':'LUCKNOW','PATANA':'PATNA',
  'UTTAR PRADESH':'UTTAR PRADESH','UP':'UTTAR PRADESH',
  'BR':'BIHAR','MH':'MAHARASHTRA','GJ':'GUJARAT','JH':'JHARKHAND'
 };
 // Operational NCR grouping, not a legal definition of all NCR districts.
 const ncr=new Set(['DELHI','NOIDA','GREATER NOIDA','GHAZIABAD','GURUGRAM','FARIDABAD','MEERUT','SONIPAT']);
 function clean(v){return String(v??'').normalize('NFKC').toUpperCase().trim().replace(/[.,]/g,' ').replace(/\s+/g,' ')}
 function canonical(v){const x=clean(v);return aliases[x]||x}
 function key(a,b){return [canonical(a),canonical(b)].sort().join('||')}
 function candidates(v){const c=canonical(v);return ncr.has(c)?[c,'NCR']:[c]}
 function resolve(rows,from,to){
  const a=canonical(from),b=canonical(to);
  if(!a||!b)return {source:'MISSING',reason:'From or To missing'};
  const pairs=[[a,b,'EXACT']];
  if(ncr.has(a))pairs.push(['NCR',b,'NCR']);
  if(ncr.has(b))pairs.push([a,'NCR','NCR']);
  if(ncr.has(a)&&ncr.has(b))pairs.push(['NCR','NCR','NCR']);
  for(const [x,y,kind] of pairs){
   const found=(rows||[]).filter(r=>key(r.from_location,r.to_location)===key(x,y));
   if(!found.length)continue;
   const amounts=[...new Set(found.map(r=>Number(r.amount)))];
   if(amounts.length!==1||!Number.isFinite(amounts[0]))return {source:'CONFLICT',reason:`Different master rates for ${x} ↔ ${y}`};
   return {source:kind==='EXACT'?'MASTER':'NCR',amount:amounts[0],reason:kind==='NCR'?`NCR fallback: ${x} ↔ ${y}`:(clean(from)!==a||clean(to)!==b?`Spelling normalized: ${a} ↔ ${b}`:'Exact route'),matched:[x,y]};
  }
  return {source:'MISSING',reason:`No rate for ${a} ↔ ${b}; review spelling / route`};
 }
 root.EktaLocation={clean,canonical,key,candidates,resolve,ncrCities:[...ncr]};
})(window);
