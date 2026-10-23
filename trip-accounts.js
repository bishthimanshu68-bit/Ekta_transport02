(function(){
  "use strict";

  const $ = id => document.getElementById(id);
  const clean = v => String(v ?? "").trim();
  const num = v => {
    const n = Number(String(v ?? "").replace(/,/g,""));
    return Number.isFinite(n) ? n : 0;
  };
  const money = n => "₹" + num(n).toLocaleString("en-IN",{maximumFractionDigits:2});
  const esc = s => String(s ?? "—").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  function dateOnly(v){ return v ? String(v).slice(0,10) : ""; }

  function fmtDate(v){
    if(!v) return "—";
    const d = new Date(dateOnly(v) + "T00:00:00");
    if(isNaN(d)) return "—";
    return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
  }

  function getNote(notes,key){
    const m = clean(notes).match(new RegExp(`\\[TRACKING:${key}=([^\\]]+)\\]`,"i"));
    return m ? m[1] : "";
  }

  function client(){
    try{
      if(typeof supabaseClient !== "undefined" && supabaseClient?.from) return supabaseClient;
    }catch(e){}
    try{
      if(typeof db !== "undefined" && db?.from) return db;
    }catch(e){}
    return window.supabaseClient || window.db || window.sb || null;
  }

  const A = {
    section:"fixed",
    trips:[],
    trucks:[],
    parties:[],
    payments:[],
    drivers:[],
    driverAdvances:[],
    expenses:[],

    truck(id){
      return this.trucks.find(x=>String(x.id)===String(id)) || null;
    },

    party(id){
      return this.parties.find(x=>String(x.id)===String(id)) || null;
    },

    driver(id){
      return this.drivers.find(x=>String(x.id)===String(id)) || null;
    },

    driverForTrip(t){
      if(!t) return null;
      const directId =
        t.driver_id ??
        t.assigned_driver_id ??
        t.current_driver_id ??
        null;

      if(directId) return this.driver(directId);

      const driverName = clean(
        t.driver_name ??
        getNote(t.notes,"DRIVER_NAME")
      );

      if(driverName){
        return this.drivers.find(d=>clean(d.name).toLowerCase()===driverName.toLowerCase()) || null;
      }

      return null;
    },

    driverPhone(d){
      return clean(d?.phone ?? d?.mobile ?? d?.phone_number ?? d?.mobile_number ?? "");
    },

    driverPhoto(d){
      return clean(
        d?.photo_url ??
        d?.profile_photo_url ??
        d?.profile_photo ??
        d?.photo ??
        d?.image_url ??
        d?.driver_photo_url ??
        ""
      );
    },

    driverAdvanceEntries(tripId){
      return this.driverAdvances.filter(x=>String(x.trip_id)===String(tripId));
    },

    driverAdvanceTotal(tripId){
      return this.driverAdvanceEntries(tripId)
        .filter(x=>clean(x.status).toUpperCase()!=="CANCELLED")
        .reduce((a,x)=>a+num(x.amount),0);
    },


    tripPayments(tripId){
      return this.payments.filter(x=>String(x.trip_id)===String(tripId));
    },

    paymentTotal(tripId){
      return this.tripPayments(tripId).reduce((a,x)=>a+num(x.amount),0);
    },

    advanceTotal(tripId){
      return this.tripPayments(tripId)
        .filter(x=>clean(x.payment_type).toUpperCase()==="ADVANCE")
        .reduce((a,x)=>a+num(x.amount),0);
    },

    loadingDetention(t){
      return num(getNote(t.notes,"LOADING_DETENTION_CHARGE"));
    },

    unloadingDetention(t){
      return num(getNote(t.notes,"UNLOADING_DETENTION_CHARGE"));
    },

    unloadingCharge(t){
      return num(getNote(t.notes,"UNLOADING_CHARGE"));
    },

    otherCharge(t){
      return num(t.other_charge ?? getNote(t.notes,"OTHER_CHARGE"));
    },

    freight(t){
      return num(t.freight_amount ?? t.revenue);
    },

    calc(t){
      const freight = this.freight(t);
      const advance = this.advanceTotal(t.id);
      const totalReceived = this.paymentTotal(t.id);

      const loadingDet = this.loadingDetention(t);
      const unloadingDet = this.unloadingDetention(t);
      const unloading = this.unloadingCharge(t);
      const other = this.otherCharge(t);

      const freightBalance = freight - advance;
      const additionalCharges = loadingDet + unloadingDet + unloading + other;
      const totalReceivable = freight + additionalCharges;
      const balanceRemaining = totalReceivable - totalReceived;

      return {
        freight,
        advance,
        totalReceived,
        freightBalance,
        loadingDet,
        unloadingDet,
        unloading,
        other,
        additionalCharges,
        totalReceivable,
        balanceRemaining
      };
    },

    async refresh(){
      const sb = client();
      if(!sb){
        this.error("Database client not found. Check db.js.");
        return;
      }

      this.loading();

      const [tr,tk,pt,py,dr,da,ex] = await Promise.all([
        sb.from("trips")
          .select("*")
          .not("loading_date","is",null)
          .order("loading_date",{ascending:false}),

        sb.from("trucks")
          .select("id,truck_number,status"),

        sb.from("parties")
          .select("id,party_code,name,party_type,zone,status"),

        sb.from("trip_payments")
          .select("*")
          .order("payment_date",{ascending:false}),

        sb.from("drivers")
          .select("*"),

        sb.from("driver_advances")
          .select("*")
          .order("created_at",{ascending:false}),

        sb.from("trip_expenses")
          .select("*")
          .order("created_at",{ascending:false})
      ]);

      const firstError = tr.error || tk.error || pt.error || py.error || dr.error || ex.error;
      if(firstError){
        this.error(firstError.message || "Trip Accounts data could not be loaded.");
        return;
      }

      this.trips = tr.data || [];
      this.trucks = tk.data || [];
      this.parties = pt.data || [];
      this.payments = py.data || [];
      this.drivers = dr.data || [];
      this.driverAdvances = da.error ? [] : (da.data || []);
      this.expenses = ex.data || [];

      this.renderParty();
      this.renderDriver();
      this.renderFuel();
      this.renderMaintenance();
    },

    loading(){
      if($("taBody")){
        $("taBody").innerHTML =
          '<tr><td colspan="15" class="p-10 text-center text-slate-400">' +
          '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Loading trip accounts...</td></tr>';
      }
    },

    error(msg){
      if($("taBody")){
        $("taBody").innerHTML =
          `<tr><td colspan="15" class="p-8 text-center text-rose-600">${esc(msg)}</td></tr>`;
      }
    },

    switchSection(name){
      this.section = name;

      ["fixed","party","driver","fuel","maintenance"].forEach(x=>{
        const cap = x.charAt(0).toUpperCase()+x.slice(1);
        $(`ta${cap}Section`)?.classList.toggle("hidden",x!==name);
        $(`taCard${cap}`)?.classList.toggle("active",x===name);
      });

      if(name==="party") this.renderParty();
      if(name==="driver") this.renderDriver();
      if(name==="fuel") this.renderFuel();
      if(name==="maintenance") this.renderMaintenance();
    },

    clearFilters(){
      if($("taSearch")) $("taSearch").value="";
      if($("taDate")) $("taDate").value="";
      this.renderParty();
    },

    filteredTrips(){
      const q = clean($("taSearch")?.value).toLowerCase();
      const d = $("taDate")?.value || "";

      return this.trips.filter(t=>{
        if(d && dateOnly(t.loading_date)!==d) return false;

        const tr = this.truck(t.truck_id);
        const p = this.party(t.party_id);
        const route = `${t.loading_point||t.from_location||""} ${t.destination||t.to_location||""}`;

        if(q){
          const hay = [
            tr?.truck_number,
            p?.name,
            p?.party_code,
            route
          ].map(v=>clean(v).toLowerCase()).join(" ");

          if(!hay.includes(q)) return false;
        }

        return true;
      });
    },

    renderParty(){
      if(this.section!=="party") return;

      const rows = this.filteredTrips();

      let totalReceivable=0;
      let totalReceived=0;
      let totalCharges=0;
      let totalBalance=0;

      const html = rows.map(t=>{
        const tr = this.truck(t.truck_id);
        const p = this.party(t.party_id);
        const c = this.calc(t);

        totalReceivable += c.totalReceivable;
        totalReceived += c.totalReceived;
        totalCharges += c.additionalCharges;
        totalBalance += c.balanceRemaining;

        const route =
          `${clean(t.loading_point||t.from_location)||"—"} → ${clean(t.destination||t.to_location)||"—"}`;

        return `
          <tr class="hover:bg-slate-50">
            <td class="px-3 py-3 font-semibold">${esc(fmtDate(t.loading_date))}</td>
            <td class="px-3 py-3 font-bold text-blue-700">${esc(tr?.truck_number||"—")}</td>
            <td class="px-3 py-3 font-semibold text-slate-800">${esc(p?.name||"—")}</td>
            <td class="px-3 py-3">${esc(route)}</td>

            <td class="px-3 py-3 text-right">${money(c.freight)}</td>

            <td class="px-3 py-3 text-right text-emerald-700 font-semibold">
              ${this.editableMoneyCell(t.id,"advance",c.advance)}
            </td>

            <td class="px-3 py-3 text-right text-amber-700">${money(c.freightBalance)}</td>

            <td class="px-3 py-3 text-right">
              ${this.editableMoneyCell(t.id,"loading_detention",c.loadingDet)}
            </td>

            <td class="px-3 py-3 text-right">
              ${this.editableMoneyCell(t.id,"unloading_detention",c.unloadingDet)}
            </td>

            <td class="px-3 py-3 text-right">
              ${this.editableMoneyCell(t.id,"unloading_charge",c.unloading)}
            </td>

            <td class="px-3 py-3 text-right">
              ${this.editableMoneyCell(t.id,"other_charge",c.other)}
            </td>

            <td class="px-3 py-3 text-right font-bold">${money(c.totalReceivable)}</td>
            <td class="px-3 py-3 text-right text-emerald-700 font-bold">${money(c.totalReceived)}</td>
            <td class="px-3 py-3 text-right text-amber-700 font-black">${money(c.balanceRemaining)}</td>

            <td class="px-3 py-3">
              <div class="flex justify-center gap-1">
                <button onclick="TripAccounts.viewParty('${esc(t.id)}')"
                  class="px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 font-bold">
                  View
                </button>

                <button onclick="TripAccounts.payment('${esc(t.id)}')"
                  class="px-2 py-1.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold">
                  + Payment
                </button>
              </div>
            </td>
          </tr>`;
      }).join("");

      $("taBody").innerHTML = html;
      $("taEmpty").classList.toggle("hidden",rows.length>0);
      $("taPartyCountText").textContent = `${rows.length} trip(s)`;

      $("taTripCount").textContent = rows.length;
      $("taReceived").textContent = money(totalReceived);
      $("taCharges").textContent = money(totalCharges);
      $("taBalanceTop").textContent = money(totalBalance);

      if($("taPartyReceivable")) $("taPartyReceivable").textContent = money(totalReceivable);
      if($("taPartyBalance")) $("taPartyBalance").textContent = money(totalBalance);
    },


    editableMoneyCell(tripId,field,value){
      return `<span class="ta-editable-cell"
        title="Double-click to edit"
        ondblclick="event.stopPropagation();TripAccounts.editMoneyCell(this,'${esc(tripId)}','${field}',${num(value)})">
        ${money(value)}
      </span>`;
    },

    editMoneyCell(el,tripId,field,currentValue){
      if(!el || el.querySelector("input")) return;

      const oldHtml = el.innerHTML;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.min = "0";
      input.className = "ta-cell-input";
      input.value = String(num(currentValue));

      let finished = false;

      const finish = async (save) => {
        if(finished) return;
        finished = true;

        if(!save){
          el.innerHTML = oldHtml;
          return;
        }

        const next = num(input.value);
        el.classList.add("ta-cell-saving");

        const ok = await this.saveDirectMoney(tripId,field,next);

        el.classList.remove("ta-cell-saving");

        if(ok){
          await this.refresh();
        }else{
          el.innerHTML = oldHtml;
        }
      };

      input.addEventListener("keydown",(e)=>{
        if(e.key==="Enter"){
          e.preventDefault();
          finish(true);
        }else if(e.key==="Escape"){
          e.preventDefault();
          finish(false);
        }
      });

      input.addEventListener("blur",()=>finish(true));

      el.innerHTML = "";
      el.appendChild(input);
      input.focus();
      input.select();
    },

    async saveDirectMoney(tripId,field,value){
      const sb = client();
      const t = this.trips.find(x=>String(x.id)===String(tripId));
      if(!sb || !t) return false;

      try{
        if(field==="advance"){
          const otherAdvance = this.tripPayments(tripId)
            .filter(x =>
              clean(x.payment_type).toUpperCase()==="ADVANCE" &&
              clean(x.reference_number)!=="DIRECT_ADVANCE"
            )
            .reduce((a,x)=>a+num(x.amount),0);

          if(value < otherAdvance){
            alert(`Advance cannot be less than existing advance payments (${money(otherAdvance)}).`);
            return false;
          }

          const directAmount = value - otherAdvance;
          const existing = this.tripPayments(tripId).find(
            x => clean(x.payment_type).toUpperCase()==="ADVANCE" &&
                 clean(x.reference_number)==="DIRECT_ADVANCE"
          );

          if(directAmount <= 0){
            if(existing){
              const del = await sb.from("trip_payments").delete().eq("id",existing.id);
              if(del.error) throw del.error;
            }
          }else if(existing){
            const up = await sb.from("trip_payments")
              .update({
                amount:directAmount,
                payment_date:new Date().toISOString().slice(0,10),
                remarks:"Direct advance edit from Trip Accounts"
              })
              .eq("id",existing.id);
            if(up.error) throw up.error;
          }else{
            const ins = await sb.from("trip_payments").insert({
              trip_id:tripId,
              party_id:t.party_id || null,
              payment_date:new Date().toISOString().slice(0,10),
              amount:directAmount,
              payment_type:"ADVANCE",
              payment_mode:null,
              reference_number:"DIRECT_ADVANCE",
              remarks:"Direct advance edit from Trip Accounts"
            });
            if(ins.error) throw ins.error;
          }

          return true;
        }

        if(field==="loading_detention" || field==="unloading_detention" || field==="unloading_charge" || field==="other_charge"){
          let notes = clean(t.notes) || "";

          const putNote = (source,key,val)=>{
            const tag = `[TRACKING:${key}=${val}]`;
            const re = new RegExp(`\\[TRACKING:${key}=[^\\]]*\\]`,"i");
            return re.test(source)
              ? source.replace(re,tag)
              : (source ? source + "\\n" : "") + tag;
          };

          if(field==="loading_detention"){
            notes = putNote(notes,"LOADING_DETENTION_CHARGE",value);
          }else if(field==="unloading_detention"){
            notes = putNote(notes,"UNLOADING_DETENTION_CHARGE",value);
          }else if(field==="unloading_charge"){
            notes = putNote(notes,"UNLOADING_CHARGE",value);
          }else{
            notes = putNote(notes,"OTHER_CHARGE",value);
          }

          const r = await sb.from("trips").update({notes}).eq("id",tripId);
          if(r.error) throw r.error;
          return true;
        }

        return false;

      }catch(err){
        console.error("[TRIP ACCOUNTS] Direct cell save failed:",err);
        alert("Save failed: " + (err.message || "Database error"));
        return false;
      }
    },


    clearDriverFilters(){
      if($("taDriverSearch")) $("taDriverSearch").value="";
      if($("taDriverDate")) $("taDriverDate").value="";
      this.renderDriver();
    },

    filteredDriverTrips(){
      const q = clean($("taDriverSearch")?.value).toLowerCase();
      const d = $("taDriverDate")?.value || "";

      return this.trips.filter(t=>{
        if(d && dateOnly(t.loading_date)!==d) return false;

        const tr = this.truck(t.truck_id);
        const dr = this.driverForTrip(t);
        const route = `${t.loading_point||t.from_location||""} ${t.destination||t.to_location||""}`;

        if(q){
          const hay = [
            tr?.truck_number,
            dr?.name,
            this.driverPhone(dr),
            route
          ].map(v=>clean(v).toLowerCase()).join(" ");

          if(!hay.includes(q)) return false;
        }

        return true;
      });
    },

    renderDriver(){
      if(!$("taDriverBody")) return;

      const rows = this.filteredDriverTrips();
      let totalAdvance = 0;
      const driverIds = new Set();

      $("taDriverBody").innerHTML = rows.map(t=>{
        const tr = this.truck(t.truck_id);
        const dr = this.driverForTrip(t);
        const total = this.driverAdvanceTotal(t.id);
        totalAdvance += total;
        if(dr?.id) driverIds.add(String(dr.id));

        const route =
          `${clean(t.loading_point||t.from_location)||"—"} → ${clean(t.destination||t.to_location)||"—"}`;

        return `
          <tr class="hover:bg-slate-50 cursor-pointer"
              onclick="TripAccounts.openDriverLedger('${esc(t.id)}')">
            <td class="px-3 py-3 font-semibold">${esc(fmtDate(t.loading_date))}</td>
            <td class="px-3 py-3 font-bold text-blue-700">${esc(tr?.truck_number||"—")}</td>
            <td class="px-3 py-3 font-semibold text-slate-800">${esc(dr?.name||"NO DRIVER")}</td>
            <td class="px-3 py-3">${esc(this.driverPhone(dr)||"—")}</td>
            <td class="px-3 py-3">${esc(route)}</td>
            <td class="px-3 py-3 text-right font-black text-emerald-700">${money(total)}</td>
            <td class="px-3 py-3 text-center">
              <button onclick="event.stopPropagation();TripAccounts.openDriverLedger('${esc(t.id)}')"
                class="px-2 py-1.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold">
                Open
              </button>
            </td>
          </tr>`;
      }).join("");

      $("taDriverEmpty")?.classList.toggle("hidden",rows.length>0);
      $("taDriverCountText").textContent = `${rows.length} trip(s)`;
      $("taDriverTripCount").textContent = rows.length;
      $("taDriverCount").textContent = driverIds.size;
      $("taDriverAdvanceTop").textContent = money(totalAdvance);
    },

    openDriverLedger(id){
      const t = this.trips.find(x=>String(x.id)===String(id));
      if(!t) return;

      const tr = this.truck(t.truck_id);
      const dr = this.driverForTrip(t);
      const phone = this.driverPhone(dr);
      const photo = this.driverPhoto(dr);

      const route =
        `${clean(t.loading_point||t.from_location)||"—"} → ${clean(t.destination||t.to_location)||"—"}`;

      const initials =
        clean(dr?.name||"Driver")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0,2)
          .map(x=>x[0])
          .join("")
          .toUpperCase() || "D";

      $("taDriverLedgerTitle").textContent =
        `${dr?.name||"Driver"} · ${tr?.truck_number||"—"}`;

      $("taDriverLedgerHeader").innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-[100px_1fr_auto] gap-4 items-center">
          <div class="w-[90px] h-[90px] rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center text-xl font-black text-slate-500">
            ${
              photo
              ? `<img src="${esc(photo)}" class="w-full h-full object-cover" onerror="this.outerHTML='<div class=&quot;w-full h-full flex items-center justify-center&quot;>${esc(initials)}</div>'">`
              : esc(initials)
            }
          </div>

          <div>
            <div class="font-black text-lg text-slate-800">${esc(dr?.name||"NO DRIVER")}</div>
            <div class="text-xs text-slate-500 mt-1">${esc(phone||"—")}</div>

            <div class="mt-3 text-xs">
              <span class="font-bold text-slate-500">Truck:</span>
              <span class="font-semibold text-slate-800 ml-1">${esc(tr?.truck_number||"—")}</span>
            </div>

            <div class="mt-1 text-xs">
              <span class="font-bold text-slate-500">Route:</span>
              <span class="font-semibold text-slate-800 ml-1">${esc(route)}</span>
            </div>

            <div class="mt-1 text-xs">
              <span class="font-bold text-slate-500">Loading Date:</span>
              <span class="font-semibold text-slate-800 ml-1">${esc(fmtDate(t.loading_date))}</span>
            </div>
          </div>

          <div class="lg:text-right">
            <div class="text-[10px] uppercase font-black text-slate-500">Total Advance</div>
            <div class="text-2xl font-black text-emerald-700 mt-1">${money(this.driverAdvanceTotal(t.id))}</div>
          </div>
        </div>
      `;

      $("taAddDriverAdvanceButton").onclick = () => this.addDriverAdvance(id);

      const entries = this.driverAdvanceEntries(id)
        .slice()
        .sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));

      $("taDriverLedgerBody").innerHTML = entries.length
        ? entries.map(x=>{
            const dt = x.created_at ? new Date(x.created_at) : null;
            return `
              <tr>
                <td class="px-3 py-3">${esc(dt ? dt.toLocaleDateString("en-IN") : fmtDate(x.advance_date))}</td>
                <td class="px-3 py-3">${esc(dt ? dt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "—")}</td>
                <td class="px-3 py-3 text-right font-black text-emerald-700">${money(x.amount)}</td>
                <td class="px-3 py-3">${esc(x.payment_mode||"MANUAL")}</td>
                <td class="px-3 py-3">${esc(x.reference_number||"—")}</td>
                <td class="px-3 py-3">${esc(x.status||"RECORDED")}</td>
                <td class="px-3 py-3">${esc(x.remarks||"—")}</td>
              </tr>`;
          }).join("")
        : `<tr><td colspan="7" class="p-8 text-center text-slate-400">No driver advance entered yet.</td></tr>`;

      $("taDriverLedger").classList.remove("hidden");
      document.body.classList.add("ta-driver-ledger-open");
      $("taDriverLedger").scrollTop = 0;
    },

    closeDriverLedger(){
      this.closeDriverAdvanceModal();
      $("taDriverLedger")?.classList.add("hidden");
      document.body.classList.remove("ta-driver-ledger-open");
    },

    addDriverAdvance(id){
      const t = this.trips.find(x=>String(x.id)===String(id)) || {};
      const tr = this.truck(t.truck_id);
      const dr = this.driverForTrip(t);
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      const localTime = now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});

      $("taDriverAdvanceModalBody").innerHTML = `
        <form onsubmit="return TripAccounts.saveDriverAdvance(event,'${esc(id)}')" class="p-5 space-y-3">
          <div class="flex justify-between items-start">
            <div>
              <div class="text-[10px] uppercase font-black text-emerald-600">Driver Advance</div>
              <h2 class="font-black text-lg text-slate-800 mt-1">Add Advance</h2>
              <p class="text-xs text-slate-500 mt-1">
                ${esc(dr?.name||"NO DRIVER")} · ${esc(tr?.truck_number||"—")}
              </p>
            </div>

            <button type="button" onclick="TripAccounts.closeDriverAdvanceModal()"
              class="w-8 h-8 rounded-full bg-slate-100">✕</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
              <input name="advance_date" type="date" required value="${localDate}"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs">
            </div>

            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Time</label>
              <input value="${esc(localTime)}" readonly
                class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-slate-50">
            </div>

            <div class="md:col-span-2">
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Advance Amount ₹</label>
              <input name="amount" type="number" min="0.01" step="0.01" required
                placeholder="Enter advance amount"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs">
            </div>

            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Payment Mode</label>
              <select name="payment_mode"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-white">
                <option value="MANUAL">MANUAL</option>
                <option value="CASH">CASH</option>
                <option value="UPI">UPI</option>
                <option value="BANK">BANK</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Reference / UTR</label>
              <input name="reference_number"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs"
                placeholder="Optional">
            </div>

            <div class="md:col-span-2">
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Remarks</label>
              <textarea name="remarks" rows="2"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs"
                placeholder="Optional remarks"></textarea>
            </div>
          </div>

          <button class="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg p-2.5 text-xs font-black">
            Save Advance
          </button>
        </form>
      `;

      $("taDriverAdvanceModal").classList.remove("hidden");
      $("taDriverAdvanceModal").classList.add("flex");
    },

    closeDriverAdvanceModal(){
      $("taDriverAdvanceModal")?.classList.add("hidden");
      $("taDriverAdvanceModal")?.classList.remove("flex");
    },

    async saveDriverAdvance(ev,id){
      ev.preventDefault();

      const sb = client();
      const f = new FormData(ev.target);
      const t = this.trips.find(x=>String(x.id)===String(id)) || {};
      const dr = this.driverForTrip(t);

      if(!dr?.id){
        alert("Driver is not linked to this trip yet.");
        return false;
      }

      const payload = {
        trip_id:id,
        truck_id:t.truck_id || null,
        driver_id:dr.id,
        advance_date:f.get("advance_date"),
        amount:num(f.get("amount")),
        payment_mode:f.get("payment_mode") || "MANUAL",
        reference_number:clean(f.get("reference_number")) || null,
        status:"RECORDED",
        remarks:clean(f.get("remarks")) || null
      };

      const {error} = await sb.from("driver_advances").insert(payload);

      if(error){
        alert("Driver advance save failed: " + (error.message || "Database error"));
        return false;
      }

      this.closeDriverAdvanceModal();
      await this.refresh();
      this.openDriverLedger(id);
      return false;
    },


    expenseEntries(tripId,type){
      return this.expenses.filter(x =>
        String(x.trip_id)===String(tripId) &&
        clean(x.expense_type).toUpperCase()===String(type).toUpperCase()
      );
    },

    expenseTotal(tripId,type){
      return this.expenseEntries(tripId,type).reduce((a,x)=>a+num(x.amount),0);
    },

    tripRoute(t){
      return `${clean(t?.loading_point||t?.from_location)||"—"} → ${clean(t?.destination||t?.to_location)||"—"}`;
    },

    clearFuelFilters(){
      if($("taFuelSearch")) $("taFuelSearch").value="";
      if($("taFuelDate")) $("taFuelDate").value="";
      this.renderFuel();
    },

    filteredFuelTrips(){
      const q=clean($("taFuelSearch")?.value).toLowerCase();
      const d=$("taFuelDate")?.value||"";

      return this.trips.filter(t=>{
        if(d && dateOnly(t.loading_date)!==d) return false;
        const tr=this.truck(t.truck_id);
        const dr=this.driverForTrip(t);
        const hay=[tr?.truck_number,dr?.name,this.tripRoute(t)]
          .map(v=>clean(v).toLowerCase()).join(" ");
        return !q || hay.includes(q);
      });
    },

    renderFuel(){
      if(!$("taFuelBody")) return;

      const rows=this.filteredFuelTrips();
      let total=0, entries=0;

      $("taFuelBody").innerHTML=rows.map(t=>{
        const tr=this.truck(t.truck_id);
        const dr=this.driverForTrip(t);
        const tripTotal=this.expenseTotal(t.id,"FUEL");
        const cnt=this.expenseEntries(t.id,"FUEL").length;
        total+=tripTotal; entries+=cnt;

        return `
          <tr class="hover:bg-slate-50 cursor-pointer" onclick="TripAccounts.openFuelLedger('${esc(t.id)}')">
            <td class="px-3 py-3 font-semibold">${esc(fmtDate(t.loading_date))}</td>
            <td class="px-3 py-3 font-bold text-blue-700">${esc(tr?.truck_number||"—")}</td>
            <td class="px-3 py-3 font-semibold">${esc(dr?.name||"NO DRIVER")}</td>
            <td class="px-3 py-3">${esc(this.tripRoute(t))}</td>
            <td class="px-3 py-3 text-right font-black text-orange-700">${money(tripTotal)}</td>
            <td class="px-3 py-3 text-center">
              <button onclick="event.stopPropagation();TripAccounts.openFuelLedger('${esc(t.id)}')"
                class="px-2 py-1.5 rounded-md bg-orange-50 text-orange-700 hover:bg-orange-100 font-bold">Open</button>
            </td>
          </tr>`;
      }).join("");

      $("taFuelEmpty")?.classList.toggle("hidden",rows.length>0);
      $("taFuelCountText").textContent=`${rows.length} trip(s)`;
      $("taFuelTripCount").textContent=rows.length;
      $("taFuelEntryCount").textContent=entries;
      $("taFuelExpenseTop").textContent=money(total);
    },

    openFuelLedger(id){
      const t=this.trips.find(x=>String(x.id)===String(id)); if(!t)return;
      const tr=this.truck(t.truck_id), dr=this.driverForTrip(t);
      const total=this.expenseTotal(id,"FUEL");

      $("taFuelLedgerTitle").textContent=`${tr?.truck_number||"Truck"} · Fuel`;
      $("taFuelLedgerHeader").innerHTML=`
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-center">
          <div>
            <div class="font-black text-lg text-slate-800">${esc(tr?.truck_number||"—")}</div>
            <div class="text-xs text-slate-500 mt-1">${esc(dr?.name||"NO DRIVER")}</div>
            <div class="mt-3 text-xs"><b class="text-slate-500">Route:</b> ${esc(this.tripRoute(t))}</div>
            <div class="mt-1 text-xs"><b class="text-slate-500">Loading Date:</b> ${esc(fmtDate(t.loading_date))}</div>
          </div>
          <div class="lg:text-right">
            <div class="text-[10px] uppercase font-black text-slate-500">Total Fuel Expense</div>
            <div class="text-2xl font-black text-orange-700 mt-1">${money(total)}</div>
          </div>
        </div>`;

      $("taAddFuelButton").onclick=()=>this.addFuel(id);

      const entries=this.expenseEntries(id,"FUEL").slice()
        .sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));

      $("taFuelLedgerBody").innerHTML=entries.length ? entries.map(x=>{
        const dt=x.created_at?new Date(x.created_at):null;
        return `<tr>
          <td class="px-3 py-3">${esc(dt?dt.toLocaleDateString("en-IN"):fmtDate(x.expense_date))}</td>
          <td class="px-3 py-3">${esc(dt?dt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—")}</td>
          <td class="px-3 py-3">${esc(x.vendor_name||"—")}</td>
          <td class="px-3 py-3 text-right">${esc(x.quantity_litres??"—")}</td>
          <td class="px-3 py-3 text-right">${money(x.rate_per_litre)}</td>
          <td class="px-3 py-3 text-right font-black text-orange-700">${money(x.amount)}</td>
          <td class="px-3 py-3 text-right">${esc(x.odometer_km??"—")}</td>
          <td class="px-3 py-3">${esc(x.payment_mode||"—")}</td>
          <td class="px-3 py-3">${esc(x.bill_number||"—")}</td>
          <td class="px-3 py-3">${esc(x.description||"—")}</td>
        </tr>`;
      }).join("") : `<tr><td colspan="10" class="p-8 text-center text-slate-400">No fuel entry yet.</td></tr>`;

      $("taFuelLedger").classList.remove("hidden");
      document.body.classList.add("ta-fuel-ledger-open");
      $("taFuelLedger").scrollTop=0;
    },

    closeFuelLedger(){
      this.closeFuelModal();
      $("taFuelLedger")?.classList.add("hidden");
      document.body.classList.remove("ta-fuel-ledger-open");
    },

    addFuel(id){
      const t=this.trips.find(x=>String(x.id)===String(id))||{};
      const tr=this.truck(t.truck_id);
      const now=new Date();
      const localDate=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      const localTime=now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});

      $("taFuelModalBody").innerHTML=`
        <form onsubmit="return TripAccounts.saveFuel(event,'${esc(id)}')" class="p-5 space-y-3">
          <div class="flex justify-between items-start">
            <div>
              <div class="text-[10px] uppercase font-black text-orange-600">Fuel Entry</div>
              <h2 class="font-black text-lg text-slate-800 mt-1">Add Fuel</h2>
              <p class="text-xs text-slate-500 mt-1">${esc(tr?.truck_number||"—")}</p>
            </div>
            <button type="button" onclick="TripAccounts.closeFuelModal()" class="w-8 h-8 rounded-full bg-slate-100">✕</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
              <input name="expense_date" type="date" value="${localDate}" required class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>
            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Time</label>
              <input value="${esc(localTime)}" readonly class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-slate-50"></div>

            <div class="md:col-span-2"><label class="block text-[10px] font-bold text-slate-500 mb-1">Fuel Station / Pump Name</label>
              <input name="vendor_name" class="w-full border border-slate-200 rounded-lg p-2 text-xs" placeholder="Pump name"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Diesel Quantity (Litres)</label>
              <input name="quantity_litres" type="number" step="0.01" min="0" oninput="TripAccounts.calcFuelForm(this.form)"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Rate / Litre ₹</label>
              <input name="rate_per_litre" type="number" step="0.01" min="0" oninput="TripAccounts.calcFuelForm(this.form)"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Amount ₹</label>
              <input name="amount" type="number" step="0.01" min="0.01" required
                class="w-full border border-slate-200 rounded-lg p-2 text-xs font-bold"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Odometer KM</label>
              <input name="odometer_km" type="number" step="1" min="0" class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Payment Mode</label>
              <select name="payment_mode" class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-white">
                <option value="MANUAL">MANUAL</option><option value="CASH">CASH</option><option value="UPI">UPI</option><option value="BANK">BANK</option>
              </select></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Bill / Receipt No.</label>
              <input name="bill_number" class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div class="md:col-span-2"><label class="block text-[10px] font-bold text-slate-500 mb-1">Remarks</label>
              <textarea name="description" rows="2" class="w-full border border-slate-200 rounded-lg p-2 text-xs"></textarea></div>
          </div>

          <button class="w-full bg-orange-600 hover:bg-orange-700 text-white rounded-lg p-2.5 text-xs font-black">Save Fuel</button>
        </form>`;

      $("taFuelModal").classList.remove("hidden");
      $("taFuelModal").classList.add("flex");
    },

    calcFuelForm(form){
      const q=num(form.quantity_litres?.value), r=num(form.rate_per_litre?.value);
      if(q>0 && r>0) form.amount.value=(q*r).toFixed(2);
    },

    closeFuelModal(){
      $("taFuelModal")?.classList.add("hidden");
      $("taFuelModal")?.classList.remove("flex");
    },

    async saveFuel(ev,id){
      ev.preventDefault();
      const sb=client(), f=new FormData(ev.target);
      const t=this.trips.find(x=>String(x.id)===String(id))||{};

      const payload={
        trip_id:id,
        truck_id:t.truck_id||null,
        expense_type:"FUEL",
        expense_date:f.get("expense_date"),
        amount:num(f.get("amount")),
        description:clean(f.get("description"))||null,
        vendor_name:clean(f.get("vendor_name"))||null,
        quantity_litres:num(f.get("quantity_litres"))||null,
        rate_per_litre:num(f.get("rate_per_litre"))||null,
        odometer_km:num(f.get("odometer_km"))||null,
        payment_mode:f.get("payment_mode")||"MANUAL",
        bill_number:clean(f.get("bill_number"))||null
      };

      const {error}=await sb.from("trip_expenses").insert(payload);
      if(error){ alert("Fuel save failed: "+(error.message||"Database error")); return false; }

      this.closeFuelModal();
      await this.refresh();
      this.openFuelLedger(id);
      return false;
    },

    clearMaintenanceFilters(){
      if($("taMaintenanceSearch")) $("taMaintenanceSearch").value="";
      if($("taMaintenanceDate")) $("taMaintenanceDate").value="";
      this.renderMaintenance();
    },

    filteredMaintenanceTrips(){
      const q=clean($("taMaintenanceSearch")?.value).toLowerCase();
      const d=$("taMaintenanceDate")?.value||"";

      return this.trips.filter(t=>{
        if(d && dateOnly(t.loading_date)!==d) return false;
        const tr=this.truck(t.truck_id), dr=this.driverForTrip(t);
        const hay=[tr?.truck_number,dr?.name,this.tripRoute(t)].map(v=>clean(v).toLowerCase()).join(" ");
        return !q || hay.includes(q);
      });
    },

    renderMaintenance(){
      if(!$("taMaintenanceBody")) return;
      const rows=this.filteredMaintenanceTrips();
      let total=0, entries=0;

      $("taMaintenanceBody").innerHTML=rows.map(t=>{
        const tr=this.truck(t.truck_id), dr=this.driverForTrip(t);
        const tripTotal=this.expenseTotal(t.id,"MAINTENANCE");
        const cnt=this.expenseEntries(t.id,"MAINTENANCE").length;
        total+=tripTotal; entries+=cnt;

        return `<tr class="hover:bg-slate-50 cursor-pointer" onclick="TripAccounts.openMaintenanceLedger('${esc(t.id)}')">
          <td class="px-3 py-3 font-semibold">${esc(fmtDate(t.loading_date))}</td>
          <td class="px-3 py-3 font-bold text-blue-700">${esc(tr?.truck_number||"—")}</td>
          <td class="px-3 py-3 font-semibold">${esc(dr?.name||"NO DRIVER")}</td>
          <td class="px-3 py-3">${esc(this.tripRoute(t))}</td>
          <td class="px-3 py-3 text-right font-black text-violet-700">${money(tripTotal)}</td>
          <td class="px-3 py-3 text-center">
            <button onclick="event.stopPropagation();TripAccounts.openMaintenanceLedger('${esc(t.id)}')"
              class="px-2 py-1.5 rounded-md bg-violet-50 text-violet-700 hover:bg-violet-100 font-bold">Open</button>
          </td>
        </tr>`;
      }).join("");

      $("taMaintenanceEmpty")?.classList.toggle("hidden",rows.length>0);
      $("taMaintenanceCountText").textContent=`${rows.length} trip(s)`;
      $("taMaintenanceTripCount").textContent=rows.length;
      $("taMaintenanceEntryCount").textContent=entries;
      $("taMaintenanceExpenseTop").textContent=money(total);
    },

    openMaintenanceLedger(id){
      const t=this.trips.find(x=>String(x.id)===String(id)); if(!t)return;
      const tr=this.truck(t.truck_id), dr=this.driverForTrip(t);
      const total=this.expenseTotal(id,"MAINTENANCE");

      $("taMaintenanceLedgerTitle").textContent=`${tr?.truck_number||"Truck"} · Maintenance`;
      $("taMaintenanceLedgerHeader").innerHTML=`
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-center">
          <div>
            <div class="font-black text-lg text-slate-800">${esc(tr?.truck_number||"—")}</div>
            <div class="text-xs text-slate-500 mt-1">${esc(dr?.name||"NO DRIVER")}</div>
            <div class="mt-3 text-xs"><b class="text-slate-500">Route:</b> ${esc(this.tripRoute(t))}</div>
            <div class="mt-1 text-xs"><b class="text-slate-500">Loading Date:</b> ${esc(fmtDate(t.loading_date))}</div>
          </div>
          <div class="lg:text-right">
            <div class="text-[10px] uppercase font-black text-slate-500">Total Maintenance</div>
            <div class="text-2xl font-black text-violet-700 mt-1">${money(total)}</div>
          </div>
        </div>`;

      $("taAddMaintenanceButton").onclick=()=>this.addMaintenance(id);

      const entries=this.expenseEntries(id,"MAINTENANCE").slice()
        .sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));

      $("taMaintenanceLedgerBody").innerHTML=entries.length ? entries.map(x=>{
        const dt=x.created_at?new Date(x.created_at):null;
        return `<tr>
          <td class="px-3 py-3">${esc(dt?dt.toLocaleDateString("en-IN"):fmtDate(x.expense_date))}</td>
          <td class="px-3 py-3">${esc(dt?dt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—")}</td>
          <td class="px-3 py-3">${esc(x.maintenance_category||"OTHER")}</td>
          <td class="px-3 py-3">${esc(x.vendor_name||"—")}</td>
          <td class="px-3 py-3 text-right font-black text-violet-700">${money(x.amount)}</td>
          <td class="px-3 py-3 text-right">${esc(x.odometer_km??"—")}</td>
          <td class="px-3 py-3">${esc(x.payment_mode||"—")}</td>
          <td class="px-3 py-3">${esc(x.bill_number||"—")}</td>
          <td class="px-3 py-3">${esc(x.description||"—")}</td>
        </tr>`;
      }).join("") : `<tr><td colspan="9" class="p-8 text-center text-slate-400">No maintenance entry yet.</td></tr>`;

      $("taMaintenanceLedger").classList.remove("hidden");
      document.body.classList.add("ta-maintenance-ledger-open");
      $("taMaintenanceLedger").scrollTop=0;
    },

    closeMaintenanceLedger(){
      this.closeMaintenanceModal();
      $("taMaintenanceLedger")?.classList.add("hidden");
      document.body.classList.remove("ta-maintenance-ledger-open");
    },

    addMaintenance(id){
      const t=this.trips.find(x=>String(x.id)===String(id))||{};
      const tr=this.truck(t.truck_id), now=new Date();
      const localDate=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      const localTime=now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});

      $("taMaintenanceModalBody").innerHTML=`
        <form onsubmit="return TripAccounts.saveMaintenance(event,'${esc(id)}')" class="p-5 space-y-3">
          <div class="flex justify-between items-start">
            <div>
              <div class="text-[10px] uppercase font-black text-violet-600">Trip Maintenance</div>
              <h2 class="font-black text-lg text-slate-800 mt-1">Add Maintenance</h2>
              <p class="text-xs text-slate-500 mt-1">${esc(tr?.truck_number||"—")}</p>
            </div>
            <button type="button" onclick="TripAccounts.closeMaintenanceModal()" class="w-8 h-8 rounded-full bg-slate-100">✕</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
              <input name="expense_date" type="date" value="${localDate}" required class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>
            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Time</label>
              <input value="${esc(localTime)}" readonly class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-slate-50"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Category</label>
              <select name="maintenance_category" class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-white">
                <option value="REPAIR">REPAIR</option><option value="SERVICE">SERVICE</option><option value="TYRE">TYRE</option>
                <option value="BREAKDOWN">BREAKDOWN</option><option value="SPARE_PART">SPARE PART</option><option value="OTHER">OTHER</option>
              </select></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Vendor / Garage</label>
              <input name="vendor_name" class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Amount ₹</label>
              <input name="amount" type="number" step="0.01" min="0.01" required class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Odometer KM</label>
              <input name="odometer_km" type="number" step="1" min="0" class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Payment Mode</label>
              <select name="payment_mode" class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-white">
                <option value="MANUAL">MANUAL</option><option value="CASH">CASH</option><option value="UPI">UPI</option><option value="BANK">BANK</option>
              </select></div>

            <div><label class="block text-[10px] font-bold text-slate-500 mb-1">Bill / Receipt No.</label>
              <input name="bill_number" class="w-full border border-slate-200 rounded-lg p-2 text-xs"></div>

            <div class="md:col-span-2"><label class="block text-[10px] font-bold text-slate-500 mb-1">Remarks / Work Description</label>
              <textarea name="description" rows="2" class="w-full border border-slate-200 rounded-lg p-2 text-xs"></textarea></div>
          </div>

          <button class="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-lg p-2.5 text-xs font-black">Save Maintenance</button>
        </form>`;

      $("taMaintenanceModal").classList.remove("hidden");
      $("taMaintenanceModal").classList.add("flex");
    },

    closeMaintenanceModal(){
      $("taMaintenanceModal")?.classList.add("hidden");
      $("taMaintenanceModal")?.classList.remove("flex");
    },

    async saveMaintenance(ev,id){
      ev.preventDefault();
      const sb=client(), f=new FormData(ev.target);
      const t=this.trips.find(x=>String(x.id)===String(id))||{};

      const payload={
        trip_id:id,
        truck_id:t.truck_id||null,
        expense_type:"MAINTENANCE",
        expense_date:f.get("expense_date"),
        amount:num(f.get("amount")),
        description:clean(f.get("description"))||null,
        vendor_name:clean(f.get("vendor_name"))||null,
        maintenance_category:f.get("maintenance_category")||"OTHER",
        odometer_km:num(f.get("odometer_km"))||null,
        payment_mode:f.get("payment_mode")||"MANUAL",
        bill_number:clean(f.get("bill_number"))||null
      };

      const {error}=await sb.from("trip_expenses").insert(payload);
      if(error){ alert("Maintenance save failed: "+(error.message||"Database error")); return false; }

      this.closeMaintenanceModal();
      await this.refresh();
      this.openMaintenanceLedger(id);
      return false;
    },

    open(content){
      $("taModalBody").innerHTML = content;
      $("taModal").classList.remove("hidden");
      $("taModal").classList.add("flex");
    },

    closeModal(){
      $("taModal").classList.add("hidden");
      $("taModal").classList.remove("flex");
    },

    async viewParty(id){
      const t = this.trips.find(x=>String(x.id)===String(id));
      if(!t) return;

      const tr = this.truck(t.truck_id);
      const p = this.party(t.party_id);
      const c = this.calc(t);

      const payments = this.tripPayments(id)
        .sort((a,b)=>String(b.payment_date||"").localeCompare(String(a.payment_date||"")));

      this.open(`
        <div class="p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[10px] text-blue-600 font-black uppercase">Party Trip Account</div>
              <h2 class="font-black text-lg text-slate-800 mt-1">
                ${esc(tr?.truck_number||"—")} · ${esc(p?.name||"—")}
              </h2>
              <p class="text-xs text-slate-500 mt-1">
                ${esc(fmtDate(t.loading_date))} ·
                ${esc(t.loading_point||t.from_location||"—")} →
                ${esc(t.destination||t.to_location||"—")}
              </p>
            </div>

            <button type="button" onclick="TripAccounts.closeModal()"
              class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200">
              ✕
            </button>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            ${[
              ["Freight",c.freight],
              ["Advance Received",c.advance],
              ["Freight Balance",c.freightBalance],
              ["Loading Detention",c.loadingDet],
              ["Unloading Detention",c.unloadingDet],
              ["Unloading Charge",c.unloading],
              ["Other Charge",c.other],
              ["Total Receivable",c.totalReceivable],
              ["Balance Remaining",c.balanceRemaining]
            ].map(([label,value])=>`
              <div class="border border-slate-200 rounded-lg p-3">
                <div class="text-[9px] text-slate-500 font-bold uppercase">${label}</div>
                <div class="font-black text-slate-800 mt-1">${money(value)}</div>
              </div>`).join("")}
          </div>

          <div class="mt-5 flex items-center justify-between">
            <h3 class="font-black text-sm text-slate-800">Party Payments</h3>

            <button onclick="TripAccounts.closeModal();TripAccounts.payment('${esc(id)}')"
              class="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold">
              + Add Payment
            </button>
          </div>

          <div class="mt-2 border border-slate-200 rounded-lg overflow-hidden">
            ${
              payments.length
              ? payments.map(x=>`
                <div class="px-3 py-2 border-b last:border-b-0 border-slate-100 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <b>${esc(fmtDate(x.payment_date))}</b>
                    <span class="text-slate-500 ml-2">${esc(x.payment_type||"")}</span>
                    ${x.payment_mode?`<span class="text-slate-400 ml-2">${esc(x.payment_mode)}</span>`:""}
                  </div>
                  <b class="text-emerald-700">${money(x.amount)}</b>
                </div>`).join("")
              : '<div class="p-4 text-xs text-slate-400 text-center">No party payment entered yet.</div>'
            }
          </div>
        </div>
      `);
    },

    payment(id){
      const t = this.trips.find(x=>String(x.id)===String(id)) || {};
      const tr = this.truck(t.truck_id);
      const p = this.party(t.party_id);

      this.open(`
        <form onsubmit="return TripAccounts.savePayment(event,'${esc(id)}')" class="p-5 space-y-3">

          <div class="flex justify-between items-start">
            <div>
              <h2 class="font-black text-lg text-slate-800">Add Party Payment</h2>
              <p class="text-xs text-slate-500 mt-1">
                ${esc(tr?.truck_number||"—")} · ${esc(p?.name||"—")}
              </p>
            </div>

            <button type="button" onclick="TripAccounts.closeModal()"
              class="w-8 h-8 rounded-full bg-slate-100">✕</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Payment Date</label>
              <input name="payment_date" type="date" required
                class="w-full border border-slate-200 rounded-lg p-2 text-xs"
                value="${new Date().toISOString().slice(0,10)}">
            </div>

            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Amount ₹</label>
              <input name="amount" type="number" step="0.01" min="0.01" required
                placeholder="Amount"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs">
            </div>

            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Payment Type</label>
              <select name="payment_type"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-white">
                <option value="ADVANCE">ADVANCE</option>
                <option value="PART_PAYMENT">PART PAYMENT</option>
                <option value="BALANCE">BALANCE</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Payment Mode</label>
              <select name="payment_mode"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs bg-white">
                <option value="">Not Set</option>
                <option value="CASH">CASH</option>
                <option value="BANK">BANK</option>
                <option value="UPI">UPI</option>
                <option value="CHEQUE">CHEQUE</option>
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>

            <div class="md:col-span-2">
              <label class="block text-[10px] font-bold text-slate-500 mb-1">UTR / Cheque / Reference No.</label>
              <input name="reference_number"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs"
                placeholder="Optional">
            </div>

            <div class="md:col-span-2">
              <label class="block text-[10px] font-bold text-slate-500 mb-1">Remarks</label>
              <textarea name="remarks"
                class="w-full border border-slate-200 rounded-lg p-2 text-xs"
                rows="2" placeholder="Optional remarks"></textarea>
            </div>
          </div>

          <button class="w-full bg-[#3677b6] hover:bg-[#2f6ba6] text-white rounded-lg p-2.5 text-xs font-black">
            Save Party Payment
          </button>

        </form>
      `);
    },

    async savePayment(ev,id){
      ev.preventDefault();

      const sb = client();
      const f = new FormData(ev.target);
      const t = this.trips.find(x=>String(x.id)===String(id)) || {};

      const payload = {
        trip_id:id,
        party_id:t.party_id || null,
        payment_date:f.get("payment_date"),
        amount:num(f.get("amount")),
        payment_type:f.get("payment_type"),
        payment_mode:f.get("payment_mode") || null,
        reference_number:clean(f.get("reference_number")) || null,
        remarks:clean(f.get("remarks")) || null
      };

      const {error} = await sb.from("trip_payments").insert(payload);

      if(error){
        alert("Payment save failed: " + (error.message || "Database error"));
        return false;
      }

      this.closeModal();
      await this.refresh();
      return false;
    }
  };


  // Fixed Kharcha master: independent of existing trip/driver ledgers.
  // Symmetric rates: A→B and B→A share one rate. No destructive DB changes.
  A.fixedRows=[]; A.fixedPending=[];
  A.fixedNorm=v=>clean(v).toUpperCase().replace(/\s+/g,' ');
  A.fixedKey=(a,b)=>window.EktaLocation?window.EktaLocation.key(a,b):[A.fixedNorm(a),A.fixedNorm(b)].sort().join('||');
  A.fixedMsg=function(msg){const el=$('taFixedMsg');if(el)el.textContent=msg;};
  A.fixedLoad=async function(){
    const sb=client();if(!sb){this.fixedMsg('Supabase connection unavailable');return;}
    const {data,error}=await sb.from('fixed_kharcha_rates').select('id,from_location,to_location,amount').order('from_location');
    if(error){this.fixedMsg('Rate table unavailable: '+error.message+' — see included SQL setup.');return;}
    this.fixedRows=data||[];this.fixedMsg(new Set(this.fixedRows.map(r=>this.fixedKey(r.from_location,r.to_location))).size+' route pairs saved');this.fixedRender();
  };
  A.fixedRender=function(){
    const body=$('taFixedBody');if(!body)return;
    const q=this.fixedNorm($('taFixedSearch')?.value);const grouped=new Map();
    for(const r of this.fixedRows){const key=this.fixedKey(r.from_location,r.to_location);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
    const rows=[...grouped.values()].map(group=>({primary:group[0],group,places:[this.fixedNorm(group[0].from_location),this.fixedNorm(group[0].to_location)].sort()}))
      .filter(r=>r.places.join(' ').includes(q));
    body.innerHTML=rows.map(({primary,group,places})=>`<tr class="border-t"><td class="p-3 font-semibold">${esc(places[0])}</td><td class="p-3 font-semibold">${esc(places[1])} <span class="text-slate-400">↔</span></td><td class="p-3 text-right font-bold">${money(primary.amount)}${group.some(x=>num(x.amount)!==num(primary.amount))?' <span class="text-amber-600" title="Reverse route rate differs; edit to reconcile">⚠</span>':''}</td><td class="p-3 text-center"><button class="text-blue-700 font-bold" onclick="TripAccounts.fixedEdit('${esc(primary.id)}')">Edit</button></td></tr>`).join('')||'<tr><td colspan="4" class="p-6 text-center text-slate-400">No rates yet</td></tr>';
  };
  A.fixedNew=function(){$('taFixedId').value='';$('taFixedFrom').value='';$('taFixedTo').value='';$('taFixedAmount').value='';$('taFixedEditor').classList.remove('hidden');$('taFixedFrom').focus();};
  A.fixedEdit=function(id){const r=this.fixedRows.find(x=>String(x.id)===String(id));if(!r)return;this.fixedNew();$('taFixedId').value=r.id;$('taFixedFrom').value=r.from_location;$('taFixedTo').value=r.to_location;$('taFixedAmount').value=r.amount;};
  A.fixedCheck=async function(rows,editingId=''){
    const existing=this.fixedRows;const changes=[];const seen=new Map();
    for(const raw of rows){
      const from_location=this.fixedNorm(raw.from_location),to_location=this.fixedNorm(raw.to_location),amount=Number(raw.amount);
      if(!from_location||!to_location||!Number.isFinite(amount)||amount<0){
        const index=rows.indexOf(raw);
        const reason=(!from_location||!to_location)?'From or To is empty':'Amount is invalid';
        const tr=$('taFixedReviewBody')?.children[index];
        if(tr){tr.style.backgroundColor='#fff0f0';tr.scrollIntoView({behavior:'smooth',block:'center'});}
        throw new Error('Review row '+(index+1)+': '+reason+'. Correct or Remove this row, then Approve again.');
      }
      const key=this.fixedKey(from_location,to_location);
      if(seen.has(key)&&seen.get(key).amount!==amount)throw new Error('Different rates found for '+from_location+' ↔ '+to_location+'. Correct in Review first.');
      seen.set(key,{from_location,to_location,amount});
    }
    for(const [key,row] of seen){
      const matches=existing.filter(x=>this.fixedKey(x.from_location,x.to_location)===key);
      const conflicts=matches.filter(x=>num(x.amount)!==row.amount);
      if(conflicts.length){
        const detail=conflicts.map(x=>`${x.from_location} → ${x.to_location}: ${money(x.amount)}`).join('\n');
        if(!confirm(`Existing rate differs for ${row.from_location} ↔ ${row.to_location}:\n${detail}\n\nApply ${money(row.amount)} to BOTH directions?`))return null;
      }
      changes.push({row,matches});
    }
    // Route rename is handled separately in fixedSave, preserving the original record ID.
    return changes;
  };
  A.fixedApply=async function(changes){
    const sb=client();if(!sb)throw new Error('Supabase connection unavailable');
    // Update any already-existing directional rows; otherwise insert ONE canonical row.
    // The reverse lookup uses fixedKey, so no duplicate reverse record is required.
    for(const {row,matches} of changes){
      if(matches.length){for(const m of matches){if(num(m.amount)!==row.amount){const {error}=await sb.from('fixed_kharcha_rates').update({amount:row.amount}).eq('id',m.id);if(error)throw error;}}}
      else{const [from_location,to_location]=[row.from_location,row.to_location].sort();const {error}=await sb.from('fixed_kharcha_rates').insert({from_location,to_location,amount:row.amount});if(error)throw error;}
    }
  };
  A.fixedSave=async function(ev){ev.preventDefault();try{
    const row={from_location:$('taFixedFrom').value,to_location:$('taFixedTo').value,amount:Number($('taFixedAmount').value)};
    const editingId=$('taFixedId').value;
    const old=editingId?this.fixedRows.find(r=>String(r.id)===String(editingId)):null;
    if(editingId&&!old)throw new Error('Edited route no longer exists. Refresh and try again.');
    const oldKey=old?this.fixedKey(old.from_location,old.to_location):'';
    const newKey=this.fixedKey(row.from_location,row.to_location);
    if(old&&oldKey!==newKey){
      const from_location=this.fixedNorm(row.from_location),to_location=this.fixedNorm(row.to_location),amount=Number(row.amount);
      if(!from_location||!to_location||!Number.isFinite(amount)||amount<0)throw new Error('Enter valid From, To and non-negative Kharcha.');
      const oldRows=this.fixedRows.filter(r=>this.fixedKey(r.from_location,r.to_location)===oldKey);
      const destination=this.fixedRows.filter(r=>this.fixedKey(r.from_location,r.to_location)===newKey);
      if(destination.length)throw new Error('This route already exists ('+from_location+' ↔ '+to_location+'). Cancel Edit and edit that route instead. No data changed.');
      if(oldRows.length>2)throw new Error('Multiple old route records found. Please review them before renaming.');
      // Preserve original row IDs, including any separately stored reverse direction.
      const db=client();if(!db)throw new Error('Supabase connection unavailable');
      const updates=oldRows.map((r,i)=>({id:r.id,from_location:i===0?from_location:to_location,to_location:i===0?to_location:from_location,amount}));
      if(updates.length===2&&from_location===to_location)throw new Error('Two directional records cannot both be renamed to a same-city route. Review duplicate rows first.');
      // Update first row without deleting any existing data. An update failure is displayed.
      for(const change of updates){const {error}=await db.from('fixed_kharcha_rates').update({from_location:change.from_location,to_location:change.to_location,amount:change.amount}).eq('id',change.id);if(error)throw error;}
      $('taFixedEditor').classList.add('hidden');await this.fixedLoad();this.fixedMsg('Route name and both-direction rate updated.');
    }else{
      const changes=await this.fixedCheck([row],editingId);if(!changes)return false;
      await this.fixedApply(changes);$('taFixedEditor').classList.add('hidden');await this.fixedLoad();this.fixedMsg('Both directions use the same saved rate.');
    }
  }catch(err){this.fixedMsg('Save failed: '+err.message);}return false;};
  A.fixedImport=async function(ev){const file=ev.target.files?.[0];ev.target.value='';if(!file)return;
    try{
      if(!window.XLSX){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Excel reader could not load'));document.head.appendChild(script);});}
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});const pending=[];
      for(const sheet of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:''});const blocks=[];
        for(let c=0;c<25;c++){if(rows.some(row=>String(row[c]||'').trim().toUpperCase()==='FROM'&&String(row[c+1]||'').trim().toUpperCase()==='TO'&&String(row[c+2]||'').trim().toUpperCase()==='KHARCHA'))blocks.push(c);}
        if(!blocks.length&&rows.length&&String(rows[0][0]||'').toUpperCase()==='FROM')blocks.push(0);
        for(const c of blocks){for(const row of rows){const f=this.fixedNorm(row[c]),t=this.fixedNorm(row[c+1]),v=row[c+2],amount=Number(String(v).replace(/[,₹\s]/g,''));if(!f||!t||f==='FROM'||t==='TO'||!Number.isFinite(amount)||amount<0||v==='')continue;pending.push({from_location:f,to_location:t,amount});}}
      }
      // Keep conflicts visible in Review instead of silently replacing them.
      const unique=new Map();for(const r of pending){const key=this.fixedKey(r.from_location,r.to_location);if(!unique.has(key)||unique.get(key).amount===r.amount)unique.set(key,r);else unique.set(key+'|CONFLICT|'+unique.size,r);}
      this.fixedPending=[...unique.values()];if(!this.fixedPending.length){this.fixedMsg('No route rows found. Expected FROM / TO / KHARCHA columns.');return;}
      this.fixedReviewRender();$('taFixedReview').classList.remove('hidden');this.fixedMsg('Review '+this.fixedPending.length+' extracted rates before saving. Reverse routes share one rate.');
    }catch(err){this.fixedMsg('Excel read failed: '+err.message);}
  };
  A.fixedReviewRender=function(){ $('taFixedReviewCount').textContent=this.fixedPending.length+' rows (reverse directions share one rate; conflicting amounts must be corrected)';
    $('taFixedReviewBody').innerHTML=this.fixedPending.map((r,i)=>`<tr class="border-t"><td class="p-1"><input class="border p-1 w-full" value="${esc(r.from_location)}" onchange="TripAccounts.fixedPending[${i}].from_location=this.value.toUpperCase()"></td><td class="p-1"><input class="border p-1 w-full" value="${esc(r.to_location)}" onchange="TripAccounts.fixedPending[${i}].to_location=this.value.toUpperCase()"></td><td class="p-1"><input type="number" min="0" step="0.01" class="border p-1 w-full text-right" value="${r.amount}" onchange="TripAccounts.fixedPending[${i}].amount=Number(this.value)"></td><td class="text-center"><button onclick="TripAccounts.fixedPending.splice(${i},1);TripAccounts.fixedReviewRender()" class="text-rose-600">Remove</button></td></tr>`).join('');
  };
  A.fixedReviewCancel=function(){this.fixedPending=[];$('taFixedReview').classList.add('hidden');};
  A.fixedImportSave=async function(){
    const btn=$('taFixedApproveBtn'),status=$('taFixedApproveStatus');
    if(this.fixedSaving)return;
    this.fixedSaving=true;
    if(btn){btn.disabled=true;btn.textContent='Checking routes…';btn.style.opacity='0.65';}
    if(status)status.textContent='Checking Excel routes…';
    try{
      if(!Array.isArray(this.fixedPending)||!this.fixedPending.length)throw new Error('No routes to import.');
      const changes=await this.fixedCheck(this.fixedPending);
      if(!changes){if(status)status.textContent='Import cancelled — no data changed.';return;}
      if(btn)btn.textContent='Saving…';
      if(status)status.textContent='Saving '+changes.length+' route pairs to Supabase…';
      await this.fixedApply(changes);
      const count=changes.length;
      this.fixedReviewCancel();await this.fixedLoad();
      this.fixedMsg(count+' route pairs saved (both directions).');
    }catch(err){
      const message='Import save failed: '+(err?.message||String(err));
      if(status)status.textContent=message;
      this.fixedMsg(message);
      console.error('[Fixed Kharcha import]',err);
    }finally{
      this.fixedSaving=false;
      if(btn){btn.disabled=false;btn.textContent='Approve & Save';btn.style.opacity='';}
    }
  };
  // Load rates only when Fixed card is selected; do not alter other sections.
  const originalFixedSwitch=A.switchSection.bind(A);
  A.switchSection=function(name){originalFixedSwitch(name);if(name==='fixed')this.fixedLoad();};
  if(A.section==='fixed')A.fixedLoad();

  window.TripAccounts = A;
  A.refresh();

})();