/* =========================================================
   EKTA TRANSPORT - PARTIES MODULE v2
   Matches the EXISTING public.parties database structure.
   ========================================================= */
(function () {
    "use strict";

    const TABLE = "parties";
    const BILLING_GROUPS_TABLE = "billing_client_groups";
    const BILLING_UNITS_TABLE = "billing_client_units";
    const RATE_TABLE = "party_rate_list";
    let parties = [];
    let billingGroups = [];
    let billingUnits = [];
    let partyRates = [];
    let aiRatePreviewRows = [];
    let rateImportCancelled = false;
    let rateImportRunning = false;
    let editingSavedRateIndex = -1;
    let addingInlineRate = false;
    let savingInlineRate = false;
    let ratePartyOptions = [];
    let aiPartyPreviewRows = [];
    let aiPartySourceHasCodeColumn = false;
    let activePartySection = "";
    let addingUnitFor = null;
    let codeLookupTimer = null;

    const $ = (id) => document.getElementById(id);
    const norm = (v) => String(v || "").trim().toLowerCase();
    // Token-based search: words can match across code, name, branch and city.
    // Keep original party codes unchanged; tolerate case, extra spaces and Haier/Hair.
    function searchText(value) {
        return String(value ?? "").toLowerCase().normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/haier/g, "hair")
            .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    }
    function searchMatches(query, fields) {
        const terms = searchText(query).split(" ").filter(Boolean);
        if (!terms.length) return true;
        const text = searchText(fields.filter(v => v != null).join(" "));
        return terms.every(term => text.includes(term));
    }


    function esc(v) {
        return String(v ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function money(v) {
        return Number(v || 0).toLocaleString("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2
        });
    }

    function statusBadge(status) {
        const active = norm(status) === "active";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-bold ${
            active
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-red-50 text-red-700 border-red-200"
        }"><i class="fa-solid ${active ? "fa-circle-check" : "fa-circle-xmark"} mr-1"></i>${esc(status || "-")}</span>`;
    }

    function typeBadge(type) {
        const client = norm(type) === "billing client";
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-bold ${
            client
                ? "bg-blue-50 text-blue-700 border-blue-200"
                : "bg-orange-50 text-orange-700 border-orange-200"
        }">${client ? "Billing Client" : "Transporter"}</span>`;
    }

    function zoneBadge(zone) {
        const cls = {
            North: "bg-emerald-50 text-emerald-700 border-emerald-200",
            South: "bg-purple-50 text-purple-700 border-purple-200",
            East: "bg-amber-50 text-amber-700 border-amber-200",
            West: "bg-blue-50 text-blue-700 border-blue-200"
        }[zone] || "bg-slate-50 text-slate-600 border-slate-200";

        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-bold ${cls}">${esc(zone || "-")}</span>`;
    }

    /*
     * Four zones only.
     * Database trigger also handles mapped cities.
     * This client-side map gives immediate visual feedback.
     */
    const CITY_ZONE_MAP = {
        delhi: "North", newdelhi: "North", noida: "North",
        greaternoida: "North", ghaziabad: "North", gurgaon: "North",
        gurugram: "North", faridabad: "North", sonipat: "North",
        panipat: "North", rohtak: "North", chandigarh: "North",
        amritsar: "North", ludhiana: "North", jaipur: "North",
        ajmer: "North", udaipur: "North", kota: "North",
        lucknow: "North", kanpur: "North", agra: "North",
        varanasi: "North", prayagraj: "North", dehradun: "North",
        haridwar: "North", shimla: "North", jammu: "North",

        bengaluru: "South", bangalore: "South", chennai: "South",
        hyderabad: "South", secunderabad: "South", kochi: "South",
        cochin: "South", thiruvananthapuram: "South",
        trivandrum: "South", coimbatore: "South", madurai: "South",
        mysuru: "South", mysore: "South", vijayawada: "South",
        visakhapatnam: "South", vizag: "South",
        mangalore: "South", mangaluru: "South",

        kolkata: "East", calcutta: "East", patna: "East",
        ranchi: "East", jamshedpur: "East", bhubaneswar: "East",
        cuttack: "East", guwahati: "East", siliguri: "East",
        durgapur: "East", bokaro: "East",

        mumbai: "West", pune: "West", nashik: "West",
        nagpur: "West", surat: "West", vadodara: "West",
        baroda: "West", ahmedabad: "West", rajkot: "West",
        indore: "West", bhopal: "West", aurangabad: "West",
        goa: "West", panaji: "West"
    };

    function detectZone(city) {
        const key = norm(city).replace(/[\s,.-]+/g, "");
        return CITY_ZONE_MAP[key] || "";
    }

    function autoDetectZone() {
        const city = $("partyCity");
        const zone = $("partyZone");
        const hint = $("partyZoneHint");

        if (!city || !zone) return;

        const detected = detectZone(city.value);
        // City changes must not silently rewrite an editable Party Code.
        if (detected) {
            zone.value = detected;
            if (hint) {
                hint.textContent =
                    `Auto-detected from city: ${detected}. You can change it manually.`;
                hint.className = "text-[9px] text-emerald-600 mt-1";
            }
        } else if (hint) {
            hint.textContent =
                "City not in auto-map. Please select the zone manually.";
            hint.className = "text-[9px] text-amber-600 mt-1";
        }
    }

    function available() {
        return !!(
            window.supabaseClient &&
            typeof window.supabaseClient.from === "function"
        );
    }

    async function load() {
        if (!available()) {
            throw new Error("Supabase client is not available.");
        }

        const result = await window.supabaseClient
            .from(TABLE)
            .select("*")
            .order("name", { ascending: true });

        if (result.error) throw result.error;

        parties = result.data || [];
        renderAll();
    }

    function billingUnitForParty(partyId) {
        return billingUnits.find(u => String(u.party_id) === String(partyId)) || null;
    }

    function billingGroupForParty(partyId) {
        const unit = billingUnitForParty(partyId);
        if (!unit) return null;
        return billingGroups.find(g => String(g.id) === String(unit.group_id)) || null;
    }

    function visiblePartyCode(party) {
        // Display the stored code: never fabricate a different code from the city.
        return party?.party_code || "-";
    }

    function baseBillingCode(value) {
        return String(value || "").trim().toUpperCase().split("__UNIT__")[0];
    }

    function safeUnitKey(value) {
        return String(value || "UNIT").trim().toUpperCase()
            .replace(/[^A-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "") || "UNIT";
    }

    async function ensureBillingMapping(party, requestedCode = "", requestedName = "", requestedUnit = "") {
        if (!party || norm(party.party_type) !== "billing client") return;

        const code = baseBillingCode(requestedCode || party.party_code);
        const companyName = String(requestedName || party.name || "").trim();
        const unitName = String(requestedUnit || party.city || "").trim();
        if (!code || !companyName || !unitName) return;

        let group = billingGroups.find(g => norm(g.company_code) === norm(code));
        if (!group) {
            const created = await window.supabaseClient
                .from(BILLING_GROUPS_TABLE)
                .insert({ company_code: code, company_name: companyName, status: "Active" })
                .select()
                .single();
            if (created.error) throw created.error;
            group = created.data;
            billingGroups.push(group);
        }

        // Read the actual saved unit, not a possibly stale client-side cache.
        const unitLookup = await window.supabaseClient.from(BILLING_UNITS_TABLE)
            .select("*").eq("party_id", party.id);
        if (unitLookup.error) throw unitLookup.error;
        if ((unitLookup.data || []).length > 1) throw new Error("Multiple billing units found for this party; manual review required.");
        const existingUnit = (unitLookup.data || [])[0] || null;
        if (existingUnit) {
            const changed = String(existingUnit.group_id) !== String(group.id) || norm(existingUnit.unit_name) !== norm(unitName);
            if (changed) {
                const updated = await window.supabaseClient
                    .from(BILLING_UNITS_TABLE)
                    .update({ group_id: group.id, unit_name: unitName, status: "Active" })
                    .eq("party_id", party.id).select("*");
                if (updated.error) throw updated.error;
                if (!updated.data || updated.data.length !== 1) throw new Error("Billing unit update was not confirmed.");
                Object.assign(existingUnit, updated.data[0]);
            }
            const cacheIndex = billingUnits.findIndex(u => String(u.party_id) === String(party.id));
            if (cacheIndex >= 0) billingUnits[cacheIndex] = existingUnit;
            else billingUnits.push(existingUnit);
            return;
        }

        const mapped = await window.supabaseClient
            .from(BILLING_UNITS_TABLE)
            .insert({ group_id: group.id, party_id: party.id, unit_name: unitName, status: "Active" })
            .select()
            .single();
        if (mapped.error) throw mapped.error;
        billingUnits.push(mapped.data);
    }

    async function autoMapExistingBillingClients() {
        const mappedIds = new Set(billingUnits.map(u => String(u.party_id)));
        const missing = billingClients().filter(p => !mappedIds.has(String(p.id)));
        if (!missing.length) return false;
        let changed = false;
        for (const party of missing) {
            try {
                await ensureBillingMapping(
                    party,
                    baseBillingCode(party.party_code),
                    party.name,
                    party.city
                );
                changed = true;
            } catch (error) {
                // Do not block Rate List UI. The Billing Client itself is still a
                // valid rate owner because party_rate_list is keyed by party_id.
                console.error("[EKTA PARTIES] Auto-map skipped for", party?.party_code, party?.city, error);
            }
        }
        return changed;
    }


    function numericPartyCode(value) {
        const base = baseBillingCode(value);
        return /^\d+$/.test(base) ? Number(base) : null;
    }

    async function fetchUsedPartyCodes() {
        const result = await window.supabaseClient.from(TABLE).select("party_code");
        if (result.error) throw result.error;
        return new Set((result.data || []).map(x => baseBillingCode(x.party_code)).filter(Boolean));
    }

    function nextPartyCodeFromUsed(used) {
        let max = 0;
        used.forEach(code => {
            if (/^\d+$/.test(code)) max = Math.max(max, Number(code));
        });
        let next = max + 1;
        while (used.has(String(next))) next++;
        return String(next);
    }

    async function getNextPartyCode() {
        const used = await fetchUsedPartyCodes();
        return nextPartyCodeFromUsed(used);
    }

    async function resetForm() {
        $("partyForm")?.reset();
        addingUnitFor = null;

       if ($("partyId")) $("partyId").value = "";
if ($("partyCode")) { $("partyCode").value = ""; $("partyCode").disabled = false; $("partyCode").readOnly = false; }
if ($("partyType")) $("partyType").value = activePartySection || "Billing Client";
        if ($("partyZone")) $("partyZone").value = "North";
        if ($("partyStatus")) $("partyStatus").value = "Active";
        if ($("partyCreditDays")) $("partyCreditDays").value = "0";
        if ($("partyCreditLimit")) $("partyCreditLimit").value = "0";

        if ($("partyFormTitle")) $("partyFormTitle").textContent = "Add New Party";
        if ($("partySaveButton")) {
            $("partySaveButton").innerHTML =
                '<i class="fa-solid fa-floppy-disk mr-1"></i>Save Party';
        }

        if ($("partyZoneHint")) {
            $("partyZoneHint").textContent =
                "Zone can be auto-detected from city.";
            $("partyZoneHint").className =
                "text-[9px] text-slate-400 mt-1";
        }
    }

    async function openForm(id) {
        await resetForm();

        if (id) {
            const party = parties.find(
                (p) => String(p.id) === String(id)
            );

            if (!party) return;

            $("partyId").value = party.id;
            $("partyCode").value = visiblePartyCode(party) || "";
            $("partyCode").disabled = false;
            $("partyCode").readOnly = false;
            $("partyName").value = party.name || "";
            $("partyType").value = party.party_type || "Billing Client";
            $("partyContactPerson").value = party.contact_person || "";
            $("partyMobile").value = party.mobile || "";
            $("partyEmail").value = party.email || "";
            $("partyGst").value = party.gst_number || "";
            $("partyPan").value = party.pan_number || "";
            $("partyCity").value = party.city || "";
            $("partyZone").value =
                party.zone || detectZone(party.city) || "North";
            $("partyState").value = party.state || "";
            $("partyCreditDays").value = party.credit_days ?? 0;
            $("partyCreditLimit").value = party.credit_limit ?? 0;
            $("partyPaymentTerms").value = party.payment_terms || "";
            $("partyStatus").value = party.status || "Active";
            $("partyAddress").value = party.address || "";
            $("partyNotes").value = party.notes || "";

            if ($("partyFormTitle")) {
                $("partyFormTitle").textContent = "Edit Party";
            }

            if ($("partySaveButton")) {
                $("partySaveButton").innerHTML =
                    '<i class="fa-solid fa-floppy-disk mr-1"></i>Update Party';
            }

            autoDetectZone();
        }

        if (!id && $("partyCode")) {
            try {
                $("partyCode").value = await getNextPartyCode();
            } catch (e) {
                console.error("[EKTA PARTIES] Auto code preview failed:", e);
                $("partyCode").value = "AUTO";
            }
        }

        $("partyFormModal")?.classList.remove("hidden");
        $("partyFormModal")?.classList.add("flex");

        setTimeout(() => $("partyName")?.focus(), 50);
    }

    function checkExistingPartyCode() {
        clearTimeout(codeLookupTimer);
        if ($("partyId")?.value || addingUnitFor) return;
        const code = baseBillingCode($("partyCode")?.value);
        const panel = $("partyExistingCodePanel");
        if (!panel) return;
        panel.classList.add("hidden");
        if (!code) return;
        codeLookupTimer = setTimeout(() => {
            if ($("partyId")?.value || addingUnitFor || baseBillingCode($("partyCode")?.value) !== code) return;
            const existing = parties.find(p => norm(p.party_type) === "billing client" && baseBillingCode(p.party_code) === code);
            if (!existing || $("partyType")?.value !== "Billing Client") return;
            $("partyExistingCompanyName").textContent = existing.name || "Existing Billing Party";
            $("partyExistingUnitNames").textContent = parties.filter(p => norm(p.party_type) === "billing client" && baseBillingCode(p.party_code) === code).map(p => billingUnitForParty(p.id)?.unit_name || p.city).filter(Boolean).join(", ");
            panel.classList.remove("hidden");
            $("partyAddBranchButton").onclick = () => addUnit(existing.id);
        }, 180);
    }

    async function addUnit(partyId) {
        const parent = parties.find(p => String(p.id) === String(partyId));
        if (!parent || norm(parent.party_type) !== "billing client") return;
        await openForm();
        addingUnitFor = String(parent.id);
        $("partyCode").value = baseBillingCode(parent.party_code);
        $("partyName").value = String(parent.name || "").replace(/\s*\([^)]*\)\s*$/, "");
        $("partyType").value = "Billing Client";
        $("partyType").disabled = true;
        $("partyCity").value = "";
        $("partyGst").value = "";
        $("partyPan").value = parent.pan_number || "";
        $("partyAddress").value = "";
        $("partyState").value = "";
        $("partyFormTitle").textContent = "Add Billing Unit — " + baseBillingCode(parent.party_code);
        $("partyExistingCodePanel")?.classList.add("hidden");
        $("partyCity").focus();
    }

    function closeForm() {
        if ($("partyType")) $("partyType").disabled = false;
        $("partyFormModal")?.classList.add("hidden");
        $("partyFormModal")?.classList.remove("flex");
    }

    async function saveParty(event) {
        event?.preventDefault();

        if (!available()) {
            alert("Supabase client is not available.");
            return false;
        }

        const id = $("partyId")?.value || "";
        let partyCode = $("partyCode")?.value.trim().toUpperCase() || "";
        const name = $("partyName")?.value.trim() || "";
        const city = $("partyCity")?.value.trim() || "";
        const zone = $("partyZone")?.value || "";
        const partyType = $("partyType")?.value || "Billing Client";

        if (!id && !partyCode) {
            alert("Party Code is required.");
            $("partyCode")?.focus();
            return false;
        }

        if (!id && partyType === "Transporter") {
            const duplicateParty = parties.find(
                (p) => String(p.party_code || "").trim().toUpperCase() === partyCode
            );
            if (duplicateParty) {
                alert(`Party Code ${partyCode} already exists.`);
                $("partyCode")?.focus();
                return false;
            }
        }

        if (partyType !== "Billing Client" && partyType !== "Transporter") {
            alert("Please select a valid Party Type.");
            $("partyType")?.focus();
            return false;
        }

        if (!name) {
            alert("Party Name is required.");
            $("partyName")?.focus();
            return false;
        }

        if (!city) {
            alert("City is required.");
            $("partyCity")?.focus();
            return false;
        }

        if (!zone) {
            alert("Zone is required.");
            $("partyZone")?.focus();
            return false;
        }

        const originalParty = id ? parties.find(p => String(p.id) === String(id)) : null;
        if (id && !originalParty) {
            alert("Party not found. Refresh and try again.");
            return false;
        }
        // The form edits the company/master code. For Billing Clients, preserve
        // the existing internal branch suffix unless the city actually changes.
        const requestedBase = baseBillingCode(partyCode);
        if (!requestedBase || !/^[A-Z0-9_-]+$/.test(requestedBase)) {
            alert("Enter a valid Party Code (letters, numbers, _ or -).");
            $("partyCode")?.focus();
            return false;
        }
        let storedCode = partyCode;
        const oldBase = originalParty ? baseBillingCode(originalParty.party_code) : "";
        const baseChanged = !!id && oldBase !== requestedBase;
        const cityChanged = !!id && norm(originalParty.city) !== norm(city);
        if (id && partyType === "Billing Client") {
            const oldInternal = String(originalParty.party_code || "").toUpperCase();
            const suffix = oldInternal.includes("__UNIT__")
                ? oldInternal.slice(oldInternal.indexOf("__UNIT__")) : "";
            storedCode = requestedBase + (cityChanged
                ? `__UNIT__${safeUnitKey(city)}` : suffix);
            if (baseChanged) {
                // Shared company codes cannot be moved one branch at a time:
                // that would split the group and orphan other branch searches.
                const siblings = parties.filter(p => String(p.id) !== String(id)
                    && norm(p.party_type) === "billing client"
                    && baseBillingCode(p.party_code) === oldBase);
                if (siblings.length) {
                    alert(`Code ${oldBase} is shared by ${siblings.length + 1} locations. Company-wide code transfer needs a database transaction; no data was changed.`);
                    return false;
                }
            }
        } else if (id) {
            storedCode = requestedBase;
        }
        // Only a code/location change needs a duplicate-code lookup. The current
        // party's own UUID is excluded. Mobile/name edits never trigger this.
        if (id && (norm(storedCode) !== norm(originalParty.party_code))) {
            const duplicate = await window.supabaseClient.from(TABLE)
                .select("id").ilike("party_code", storedCode).neq("id", id).limit(1);
            if (duplicate.error) { alert(`Code check failed: ${duplicate.error.message}`); return false; }
            if (duplicate.data?.length) {
                alert(`Party Code ${storedCode} already exists for another party.`);
                return false;
            }
        }
        if (id && baseChanged && partyType === "Billing Client") {
            const conflictingGroup = billingGroups.find(g => norm(g.company_code) === norm(requestedBase)
                && norm(g.company_code) !== norm(oldBase));
            if (conflictingGroup) {
                alert(`Company Code ${requestedBase} already belongs to another billing group.`);
                return false;
            }
        }

        const payload = {
            name,
            party_type: partyType,
            gst_number: $("partyGst")?.value.trim().toUpperCase() || null,
            mobile: $("partyMobile")?.value.trim() || null,
            address: $("partyAddress")?.value.trim() || null,
            city,
            state: $("partyState")?.value.trim() || null,
            credit_days: Number($("partyCreditDays")?.value || 0),
            credit_limit: Number($("partyCreditLimit")?.value || 0),
            status: $("partyStatus")?.value || "Active",
            contact_person: $("partyContactPerson")?.value.trim() || null,
            email: $("partyEmail")?.value.trim() || null,
            pan_number: $("partyPan")?.value.trim().toUpperCase() || null,
            zone,
            payment_terms: $("partyPaymentTerms")?.value || null,
            notes: $("partyNotes")?.value.trim() || null,
            updated_at: new Date().toISOString()
        };

        let result;

        if (id) {
            payload.party_code = storedCode;
            result = await window.supabaseClient
                .from(TABLE)
                .update(payload)
                .eq("id", id)
                .select("*");
        } else {
            // Respect manually entered codes. A billing unit has a unique internal
            // code but shares the displayed company code and group mapping.
            const usedCodes = await fetchUsedPartyCodes();
            if (addingUnitFor) {
                const parent = parties.find(p => String(p.id) === addingUnitFor);
                if (!parent || baseBillingCode(parent.party_code) !== requestedBase) {
                    alert("Unit company code changed. Reopen Add Unit."); return false;
                }
                partyCode = requestedBase + "__UNIT__" + safeUnitKey(city);
            } else {
                partyCode = requestedBase;
                if (partyType === "Billing Client" && usedCodes.has(requestedBase)) {
                    alert("Company Code " + requestedBase + " already exists. Use + Add Unit beside that Billing Party instead.");
                    return false;
                }
            }
            const exists = await window.supabaseClient.from(TABLE).select("id").ilike("party_code", partyCode).limit(1);
            if (exists.error) { alert("Code check failed: " + exists.error.message); return false; }
            if (exists.data?.length) { alert("This party/unit code already exists. Please check the unit city."); return false; }
            payload.party_code = partyCode;

            result = await window.supabaseClient
                .from(TABLE)
                .insert(payload)
                .select()
                .single();
        }

        if (result.error) {
            console.error("[EKTA PARTIES] Save error:", result.error);
            alert(
                `Party save failed: ${
                    result.error.message || "Unknown database error"
                }`
            );
            return false;
        }

        if (id && (!result.data || result.data.length !== 1)) {
            alert("Party update was not confirmed. Please refresh and check permissions.");
            return false;
        }
        try {
            if (partyType === "Billing Client") {
                const savedParty = id ? result.data[0] : result.data;
                // Single-branch code reassignment must update the company group,
                // not silently create a second group and abandon the old one.
                if (id && baseChanged) {
                    const oldGroup = billingGroupForParty(id);
                    if (oldGroup) {
                        const otherUnits = billingUnits.filter(u => String(u.group_id) === String(oldGroup.id)
                            && String(u.party_id) !== String(id));
                        if (otherUnits.length) throw new Error("Company group has other linked units. Review group mapping before code transfer.");
                        const groupUpdate = await window.supabaseClient.from(BILLING_GROUPS_TABLE)
                            .update({ company_code: requestedBase, company_name: name })
                            .eq("id", oldGroup.id).select("*");
                        if (groupUpdate.error) throw groupUpdate.error;
                        if (groupUpdate.data?.length !== 1) throw new Error("Billing company code update not confirmed. Party row saved; mapping needs review.");
                        Object.assign(oldGroup, groupUpdate.data[0]);
                    }
                }
                // Do not touch billing units/groups on a simple mobile/name/address edit.
                // Mapping changes only when the code/city changes or mapping is absent.
                const mappingMissing = !billingUnitForParty(savedParty.id);
                if (!id || baseChanged || cityChanged || mappingMissing) {
                    await ensureBillingMapping(savedParty, baseBillingCode(savedParty.party_code), name, city);
                }
            }
        } catch (mappingError) {
            console.error("[EKTA PARTIES] Automatic billing mapping error:", mappingError);
            alert("Party details saved, but Billing Unit mapping FAILED: " + (mappingError.message || "Unknown error") + ". Do not re-enter this party; please retry Edit after checking the error.");
            try { await load(); await loadBillingData(); } catch (e) { console.error(e); }
            return false;
        }

        alert(id ? "Party updated successfully." : "Party saved successfully.");
        closeForm();
        await load();
        try { await loadBillingData(); } catch (e) { console.error(e); }

        return false;
    }

    function getFilteredParties() {
        const q = $("partySearch")?.value || "";
        const type = $("partyTypeFilter")?.value || "";
        const zone = $("partyZoneFilter")?.value || "";
        const status = $("partyStatusFilter")?.value || "";

        return parties.filter((party) => {
            const haystack = [
                party.party_code,
                party.name,
                party.contact_person,
                party.mobile,
                party.city,
                party.state,
                party.zone,
                party.gst_number,
                party.pan_number
            ].map(norm).join(" ");

            if (!searchMatches(q, [party.party_code, baseBillingCode(party.party_code), party.name, party.city, party.contact_person, party.mobile, party.state, party.zone, party.gst_number, party.pan_number])) return false;
            if (type && norm(party.party_type) !== norm(type)) return false;
            if (zone && norm(party.zone) !== norm(zone)) return false;
            if (status && norm(party.status) !== norm(status)) return false;

            return true;
        });
    }

    function renderTable() {
        const body = $("partyTableBody");
        if (!body) return;

        const list = getFilteredParties();

        if (!list.length) {
            body.innerHTML = `
                <tr>
                    <td colspan="11" class="py-10 text-center text-slate-400">
                        No party records found.
                    </td>
                </tr>
            `;
        } else {
            body.innerHTML = list.map((party, index) => `
                <tr class="border-t border-slate-100 hover:bg-slate-50 transition">
                    <td class="py-2.5 px-3">${index + 1}</td>
                    <td class="py-2.5 px-3 font-mono font-bold text-blue-700">
                        ${esc(visiblePartyCode(party))}
                    </td>
                    <td class="py-2.5 px-3 font-bold text-slate-800">
                        ${esc(party.name || "-")}
                        ${norm(party.party_type)==="billing client" ? `<div class="text-[10px] font-normal text-slate-500">Unit: ${esc(billingUnitForParty(party.id)?.unit_name || party.city || "—")}</div>` : ""}
                    </td>
                    <td class="py-2.5 px-3">${typeBadge(party.party_type)}</td>
                    <td class="py-2.5 px-3">${esc(party.city || "-")}</td>
                    <td class="py-2.5 px-3">${zoneBadge(party.zone)}</td>
                    <td class="py-2.5 px-3">${esc(party.state || "-")}</td>
                    <td class="py-2.5 px-3">${esc(party.contact_person || "-")}</td>
                    <td class="py-2.5 px-3 font-mono">${esc(party.mobile || "-")}</td>
                    <td class="py-2.5 px-3">${statusBadge(party.status)}</td>
                    <td class="py-2.5 px-3">
                        <div class="flex items-center gap-1">
                            <button type="button"
                                onclick="window.EktaParties.openView('${esc(party.id)}')"
                                title="View"
                                class="w-7 h-7 rounded-md border border-slate-200 text-blue-600 hover:bg-blue-50">
                                <i class="fa-solid fa-eye text-[10px]"></i>
                            </button>
                                            <button type="button"
                                onclick="window.EktaParties.openForm('${esc(party.id)}')"
                                title="Edit"
                                class="w-7 h-7 rounded-md border border-slate-200 text-blue-600 hover:bg-blue-50">
                                <i class="fa-solid fa-pen text-[10px]"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join("");
        }

        if ($("partyFilteredCount")) {
            $("partyFilteredCount").textContent = `${list.length.toLocaleString("en-IN")} ${list.length === 1 ? "party" : "parties"}`;
        }
        if ($("partyTableFooter")) {
            $("partyTableFooter").textContent =
                `Showing ${list.length} of ${parties.length} parties`;
        }
    }

    function openView(id) {
        const party = parties.find(
            (p) => String(p.id) === String(id)
        );

        if (!party) return;

        $("partyViewName").textContent = party.name || "-";

        $("partyViewContent").innerHTML = `
            <div class="space-y-3">
                <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                        <div class="text-[10px] text-slate-400 font-bold">
                            ${esc(visiblePartyCode(party))}
                        </div>
                        <div class="font-black text-slate-800">
                            ${esc(party.name || "-")}
                        </div>
                    </div>
                    ${statusBadge(party.status)}
                </div>

                <div class="grid grid-cols-2 gap-2 text-[11px]">
                    <div class="bg-slate-50 rounded-lg p-2"><b>Type</b><div>${typeBadge(party.party_type)}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>Zone</b><div class="mt-1">${zoneBadge(party.zone)}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>Contact Person</b><div>${esc(party.contact_person || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>Mobile</b><div>${esc(party.mobile || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>Email</b><div>${esc(party.email || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>City</b><div>${esc(party.city || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>State</b><div>${esc(party.state || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>GST</b><div>${esc(party.gst_number || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>PAN</b><div>${esc(party.pan_number || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>Credit Days</b><div>${esc(party.credit_days ?? 0)}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>Credit Limit</b><div>${money(party.credit_limit)}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2"><b>Payment Terms</b><div>${esc(party.payment_terms || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2 col-span-2"><b>Address</b><div>${esc(party.address || "-")}</div></div>
                    <div class="bg-slate-50 rounded-lg p-2 col-span-2"><b>Notes</b><div>${esc(party.notes || "-")}</div></div>
                </div>

                <div class="border border-blue-100 bg-blue-50/50 rounded-lg p-3 text-[10px] text-slate-500">
                    This Party Master is ready to link with Trips/LR, POD, Billing, Ledger and Outstanding.
                </div>

                <button type="button"
                    onclick="window.EktaParties.openForm('${esc(party.id)}');window.EktaParties.closeView()"
                    class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold">
                    <i class="fa-solid fa-pen mr-1"></i>Edit Party
                </button>
            </div>
        `;

        $("partyViewModal").classList.remove("hidden");
        $("partyViewModal").classList.add("flex");
    }

    function closeView() {
        $("partyViewModal")?.classList.add("hidden");
        $("partyViewModal")?.classList.remove("flex");
    }

    function updateSummaries() {
        const total = parties.length;
        const active = parties.filter(
            (p) => norm(p.status) === "active"
        ).length;

        $("partyTotalSummary") && ($("partyTotalSummary").textContent = total);
        $("partyActiveSummary") && ($("partyActiveSummary").textContent = active);
        $("partyInactiveSummary") && ($("partyInactiveSummary").textContent = total - active);

        $("partyClientSummary") && ($("partyClientSummary").textContent =
            parties.filter((p) => norm(p.party_type) === "billing client").length);

        $("partyTransporterSummary") && ($("partyTransporterSummary").textContent =
            parties.filter((p) => norm(p.party_type) === "transporter").length);

        if ($("billingPartyCardCount")) $("billingPartyCardCount").textContent = billingGroups.length || parties.filter(p => norm(p.party_type) === "billing client").length;
        if ($("transporterCardCount")) $("transporterCardCount").textContent = parties.filter(p => norm(p.party_type) === "transporter").length;
    }


    function setBillingPanel(mode) {
        const units = $("billingUnitsPanel");
        const rates = $("billingRatesPanel");
        const title = $("billingWorkspaceTitle");
        if (!units || !rates) return;
        const showRates = true;
        units.classList.add("hidden");
        rates.classList.remove("hidden");
        if (title) title.textContent = showRates ? "Party Rate List" : "Billing Companies & Units";
    }

    async function openBillingWorkspace(mode = "units") {
        const box = $("billingWorkspace");
        if (!box) return;

        // Keep Party Master search completely separate from Rate List inputs.
        if ($("partySearch")) $("partySearch").value = "";
        if ($("rateDestination")) $("rateDestination").value = "";
        if ($("rate32")) $("rate32").value = "";
        if ($("rate34")) $("rate34").value = "";
        aiRatePreviewRows = [];
        renderAiRatePreview();
        if ($("rateAiStatus")) $("rateAiStatus").classList.add("hidden");

        box.classList.remove("hidden");
        $("partyAiImportPanel")?.classList.add("hidden");
        $("partyMasterListArea")?.classList.add("hidden");
        setBillingPanel(mode);
        await loadBillingData();
        box.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function closeBillingWorkspace() {
        $("billingWorkspace")?.classList.add("hidden");
        $("partyMasterListArea")?.classList.toggle("hidden", !activePartySection);
        if ($("partyAiImportPanel")) $("partyAiImportPanel").classList.toggle("hidden", !activePartySection);
    }

    function billingClients() {
        return parties.filter((p) => norm(p.party_type) === "billing client");
    }

    function renderBillingSelectors() {
        const groupSelect = $("billingUnitGroup");
        if (groupSelect) groupSelect.innerHTML = '<option value="">Select Company</option>' + billingGroups.map(g => `<option value="${esc(g.id)}">${esc(g.company_code)} — ${esc(g.company_name)}</option>`).join("");

        const mappedPartyIds = new Set(billingUnits.map(u => String(u.party_id)));
        const partySelect = $("billingUnitParty");
        if (partySelect) partySelect.innerHTML = '<option value="">Select Billing Party / GST Unit</option>' + billingClients().filter(p => !mappedPartyIds.has(String(p.id))).map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.city || "-")} — ${esc(p.gst_number || "GST not set")}</option>`).join("");

        const rateParty = $("ratePartySelect");
        if (rateParty) {
            const current = rateParty.value;

            // Rate List must remain usable even if a billing-unit mapping is still
            // being created in the background. Build one option per Billing Client
            // party_id, preferring the mapped Company/Unit label when available.
            const mappedByParty = new Map(
                billingUnits.map(u => [String(u.party_id), u])
            );

            const rateOptions = billingClients().map(p => {
                const unit = mappedByParty.get(String(p.id));
                const group = unit
                    ? billingGroups.find(g => String(g.id) === String(unit.group_id))
                    : null;

                // Rate selector must identify the exact billing-party row.
                // Keep Unit/Party Code + exact Party Name visible/searchable.
                // GST is intentionally NOT shown in this selector.
                const exactName = String(p.name || unit?.unit_name || p.city || "Billing Party").trim();
                const exactCode = String(p.party_code || "").trim();
                return {
                    partyId: p.id,
                    label: exactCode ? `${exactCode} - ${exactName} - ${p.city || ""}` : `${exactName} - ${p.city || ""}`,
                    code: exactCode, name: exactName, city: p.city || ""
                };
            });

            rateParty.innerHTML =
                '<option value="">Select Billing Party / Location</option>' +
                rateOptions.map(o =>
                    `<option value="${esc(o.partyId)}">${esc(o.label)}</option>`
                ).join("");

            ratePartyOptions = rateOptions;
            // Keep dropdown closed until the user clicks/types in the search box.
            $("ratePartyDropdown")?.classList.add("hidden");

            if ([...rateParty.options].some(o => o.value === current)) {
                rateParty.value = current;
            }
            const rateSearch = $("ratePartySearch");
            if (rateSearch) {
                const selected = rateOptions.find(o => String(o.partyId) === String(rateParty.value));
                if (selected) rateSearch.value = selected.label;
            }
        }
    }

    function renderRatePartyDropdown(query = "", openMenu = true) {
        const menu = $("ratePartyDropdown");
        if (!menu) return;
        const q = norm(query);
        const rows = ratePartyOptions.filter(o => searchMatches(query, [o.label, o.code, o.city, o.name])).slice(0, 100);
        menu.innerHTML = rows.length ? rows.map((o, i) => `
            <button type="button" data-rate-index="${i}" data-party-id="${esc(o.partyId)}"
                onmousedown="event.preventDefault();window.EktaParties.selectRateParty('${esc(o.partyId)}')"
                class="rate-party-option w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 border-b border-slate-100 last:border-0">${esc(o.label)}</button>`).join("")
            : '<div class="px-3 py-4 text-xs text-slate-400 text-center">No matching Billing Party / Location</div>';
        if (openMenu) menu.classList.remove("hidden");
    }

    function selectRateParty(partyId) {
        const item = ratePartyOptions.find(o => String(o.partyId) === String(partyId));
        if (!item) return;
        if ($("ratePartySelect")) $("ratePartySelect").value = item.partyId;
        if ($("ratePartySearch")) $("ratePartySearch").value = item.label;
        $("ratePartyDropdown")?.classList.add("hidden");
        syncRateTypeUi();
        loadRateList();
    }

    function ratePartyKeydown(event) {
        const menu = $("ratePartyDropdown");
        if (!menu) return;
        const items = [...menu.querySelectorAll('.rate-party-option')];
        if (!items.length) return;
        let idx = items.findIndex(x => x.classList.contains('bg-emerald-50'));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            items.forEach(x => x.classList.remove('bg-emerald-50'));
            idx = event.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : (idx <= 0 ? items.length - 1 : idx - 1);
            items[idx].classList.add('bg-emerald-50');
            items[idx].scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter') {
            const chosen = idx >= 0 ? items[idx] : items[0];
            if (chosen) { event.preventDefault(); selectRateParty(chosen.dataset.partyId); }
        } else if (event.key === 'Escape') {
            menu.classList.add('hidden');
        }
    }

    function handleRatePartySearch(value, commit = false) {
        renderRatePartyDropdown(value, true);
        const search = String(value || "").trim();
        const select = $("ratePartySelect");
        if (!select) return;

        const exact = ratePartyOptions.find(o => norm(o.label) === norm(search));
        if (exact) {
            const changed = String(select.value) !== String(exact.partyId);
            select.value = exact.partyId;
            if (changed || commit) loadRateList();
            return;
        }

        // While typing, do not disturb the current rate list. On commit of a
        // non-matching value, clear selection so a wrong party can never be used.
        if (commit && search) {
            select.value = "";
            renderRateList();
        }
    }

    function renderBillingGroups() {
        const el = $("billingGroupsList");
        if (!el) return;
        if (!billingGroups.length) {
            el.innerHTML = '<div class="text-slate-400 py-4 text-center">No billing company created yet.</div>';
            return;
        }
        el.innerHTML = billingGroups.map(g => {
            const units = billingUnits.filter(u => String(u.group_id) === String(g.id));
            return `<div class="border border-slate-200 rounded-lg p-3"><div class="flex items-center justify-between gap-2"><div><span class="font-black text-indigo-700">${esc(g.company_code)}</span><span class="text-slate-500 ml-2">${esc(g.company_name)}</span></div><span class="text-[9px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold">${units.length} Unit${units.length === 1 ? "" : "s"}</span></div><div class="mt-2 flex flex-wrap gap-1.5">${units.length ? units.map(u => `<span class="px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">${esc(u.unit_name)}</span>`).join("") : '<span class="text-[10px] text-slate-400">No unit mapped</span>'}</div></div>`;
        }).join("");
    }

    // Fetch every saved rate, not just Supabase/PostgREST's first response page.
    // Stable ordering by primary key avoids skipped/duplicated rows between pages.
    async function fetchAllPartyRates() {
        const pageSize = 500;
        const all = [];
        for (let start = 0; ; start += pageSize) {
            const result = await window.supabaseClient
                .from(RATE_TABLE)
                .select("*")
                .order("id", { ascending: true })
                .range(start, start + pageSize - 1);
            if (result.error) throw result.error;
            const batch = result.data || [];
            all.push(...batch);
            if (batch.length < pageSize) break;
        }
        return all;
    }

    async function loadBillingData() {
        if (!available()) return;
        const [g, u, rates] = await Promise.all([
            window.supabaseClient.from(BILLING_GROUPS_TABLE).select("*").order("company_name", { ascending: true }),
            window.supabaseClient.from(BILLING_UNITS_TABLE).select("*").order("unit_name", { ascending: true }),
            fetchAllPartyRates()
        ]);
        if (g.error) throw g.error;
        if (u.error) throw u.error;
        billingGroups = g.data || [];
        billingUnits = u.data || [];
        partyRates = rates;

        const autoMapped = await autoMapExistingBillingClients();
        if (autoMapped) {
            const [g2, u2] = await Promise.all([
                window.supabaseClient.from(BILLING_GROUPS_TABLE).select("*").order("company_name", { ascending: true }),
                window.supabaseClient.from(BILLING_UNITS_TABLE).select("*").order("unit_name", { ascending: true })
            ]);
            if (g2.error) throw g2.error;
            if (u2.error) throw u2.error;
            billingGroups = g2.data || [];
            billingUnits = u2.data || [];
        }

        if ($("billingGroupSummary")) $("billingGroupSummary").textContent = billingGroups.length;
        if ($("billingPartyCardCount")) $("billingPartyCardCount").textContent = billingClients().length;
        if ($("billingRateSummary")) $("billingRateSummary").textContent = new Set(partyRates.filter(x => !x.status || norm(x.status) === "active").map(x => `${x.party_id}|${norm(x.from_location)}|${norm(x.destination)}`)).size;
        renderBillingGroups();
        renderBillingSelectors();
        renderRateList();
    }

    async function createBillingGroup() {
        const code = String($("billingCompanyCode")?.value || "").trim().toUpperCase();
        const name = String($("billingCompanyName")?.value || "").trim();
        if (!code || !name) return alert("Company Code and Company Name are required.");
        const result = await window.supabaseClient.from(BILLING_GROUPS_TABLE).insert({ company_code: code, company_name: name, status: "Active" }).select().single();
        if (result.error) return alert(result.error.message || "Unable to create billing company.");
        $("billingCompanyCode").value = "";
        $("billingCompanyName").value = "";
        await loadBillingData();
    }

    async function mapBillingUnit() {
        const groupId = $("billingUnitGroup")?.value || "";
        const partyId = $("billingUnitParty")?.value || "";
        const unitName = String($("billingUnitName")?.value || "").trim();
        if (!groupId || !partyId || !unitName) return alert("Company, Billing Party and Unit/Location are required.");
        const party = parties.find(p => String(p.id) === String(partyId));
        if (!party || norm(party.party_type) !== "billing client") return alert("Only Billing Client parties can be mapped.");
        const result = await window.supabaseClient.from(BILLING_UNITS_TABLE).insert({ group_id: groupId, party_id: partyId, unit_name: unitName, status: "Active" }).select().single();
        if (result.error) return alert(result.error.message || "Unable to map billing unit.");
        $("billingUnitName").value = "";
        await loadBillingData();
    }

    function selectedRateParty() {
        const id = $("ratePartySelect")?.value || "";
        return parties.find(p => String(p.id) === String(id)) || null;
    }

    function isHaierRateParty() {
        const p = selectedRateParty();
        return /haier/i.test(String(p?.name || ""));
    }

    function currentRateType() {
        if (!isHaierRateParty()) return "STANDARD";
        return $("rateTypeSelect")?.value || "HAIER_TO_HAIER";
    }

    function syncRateTypeUi() {
        const haier = isHaierRateParty();
        const sel = $("rateTypeSelect"), hint = $("rateTypeHint");
        if (sel) sel.classList.toggle("hidden", !haier);
        if (hint) {
            hint.classList.toggle("hidden", !haier);
            if (haier) hint.textContent = sel?.value === "HAIER_TO_OTHER"
                ? "Haier to Other: source is this Haier unit; Program will use Destination + selected FT/Ton option + rate."
                : "Haier to Haier: source is this Haier unit; this rate book is kept separate from Haier to Other.";
        }
        const p = selectedRateParty();
        const unit = billingUnitForParty(p?.id);
        if ($("rateFromLocation")) $("rateFromLocation").value = unit?.unit_name || p?.city || "";
    }

    function changeRateType() {
        aiRatePreviewRows = [];
        renderAiRatePreview();
        syncRateTypeUi();
        renderRateList();
    }

    function activeRatesForParty(partyId) {
        const type = currentRateType();
        return partyRates.filter(r => String(r.party_id) === String(partyId) &&
            (!r.status || norm(r.status) === "active") &&
            norm(r.rate_type || "STANDARD") === norm(type));
    }

    function cleanRateCategory(v) {
        return String(v || "").trim().toUpperCase().replace(/\s+/g, " ");
    }

    function categorySort(a,b) {
        const na = parseFloat(a), nb = parseFloat(b);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na-nb;
        return String(a).localeCompare(String(b), undefined, {numeric:true});
    }

    function groupedRateRows(rows) {
        const map = new Map();
        rows.forEach(r => {
            const key = `${norm(r.destination)}|${r.effective_from || ""}`;
            if (!map.has(key)) map.set(key, {destination:r.destination, from:r.from_location, effective:r.effective_from, options:{}, ids:{}});
            const x = map.get(key), cat = cleanRateCategory(r.vehicle_category || "RATE");
            x.options[cat] = Number(r.rate);
            x.ids[cat] = r.id;
        });
        return [...map.values()].sort((a,b)=>String(a.destination).localeCompare(String(b.destination)));
    }

    function allCategories(list) {
        return [...new Set(list.flatMap(x => Object.keys(x.options || {})))].sort(categorySort);
    }

    function renderRateList() {
        const body = $("rateListBody"), head = $("rateListHead");
        if (!body || !head) return;
        syncRateTypeUi();
        const partyId = $("ratePartySelect")?.value || "";
        if (!partyId) {
            head.innerHTML = '<tr><th class="text-left p-2">Destination</th><th class="text-left p-2">Rate Options</th></tr>';
            body.innerHTML = '<tr><td colspan="2" class="px-3 py-8 text-center text-slate-400">Select a Billing Unit to view rates.</td></tr>';
            if ($("rateListFooter")) $("rateListFooter").textContent = "";
            return;
        }
        const list = groupedRateRows(activeRatesForParty(partyId));
        const cats = allCategories(list);
        if (!cats.length) cats.push("32FT", "34FT");
        head.innerHTML = `<tr><th class="text-left py-2.5 px-3">From</th><th class="text-left py-2.5 px-3">Destination</th>${cats.map(c=>`<th class="text-right py-2.5 px-3">${esc(c)}</th>`).join("")}<th class="text-left py-2.5 px-3">Effective</th><th class="text-center py-2.5 px-3 whitespace-nowrap">Action <button type="button" onclick="window.EktaParties.startAddDestination()" class="ml-2 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-bold"><i class="fa-solid fa-plus mr-1"></i>Add Manual Row</button></th></tr>`;
        body.innerHTML = list.length ? list.map((x,i)=> {
            const editing = editingSavedRateIndex === i;
            const cell = (key,value) => editing
                ? `<input data-rate-edit="${esc(key)}" class="w-full min-w-24 border border-blue-300 rounded px-2 py-1 text-xs" value="${esc(value ?? '')}">`
                : esc(value || "-");
            return `<tr class="border-t border-slate-100 ${editing ? 'bg-blue-50' : ''}">
                <td class="py-2.5 px-3 text-slate-500">${esc(x.from||"-")}</td>
                <td class="py-2.5 px-3 font-bold text-slate-700">${cell('destination',x.destination)}</td>
                ${cats.map(c=>`<td class="py-2.5 px-3 text-right font-semibold text-slate-800">${x.options[c]==null ? '—' : (editing ? `<input data-rate-category="${esc(c)}" type="number" min="0" step="0.01" class="w-28 border border-blue-300 rounded px-2 py-1 text-right text-xs" value="${esc(x.options[c])}">` : money(x.options[c]))}</td>`).join('')}
                <td class="py-2.5 px-3 text-slate-500">${editing ? `<input data-rate-edit="effective" type="date" class="border border-blue-300 rounded px-2 py-1 text-xs" value="${esc(x.effective || '')}">` : esc(x.effective||'-')}</td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">${editing
                    ? `<button type="button" onclick="window.EktaParties.saveInlineRateEdit(${i})" class="px-2 py-1 mr-1 rounded bg-emerald-600 text-white text-[10px] font-bold">Save</button><button type="button" onclick="window.EktaParties.cancelInlineRateEdit()" class="px-2 py-1 rounded border text-[10px] font-bold">Cancel</button>`
                    : `<button type="button" onclick="window.EktaParties.editRateRow(${i})" class="px-2 py-1 mr-1 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-bold"><i class="fa-solid fa-pen mr-1"></i>Edit</button><button type="button" onclick="window.EktaParties.deleteSavedRateRow(${i})" class="px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700 text-[10px] font-bold"><i class="fa-solid fa-trash mr-1"></i>Delete Row</button>`}</td></tr>`;
        }).join('') : `<tr><td colspan="${cats.length+4}" class="px-3 py-8 text-center text-slate-400">No active rates saved for this rate book.</td></tr>`;
        if (addingInlineRate) {
            const from = String($("rateFromLocation")?.value || "").trim();
            const effective = $("rateEffectiveFrom")?.value || new Date().toISOString().slice(0,10);
            const input = (cat) => `<input data-new-rate-category="${esc(cat)}" type="number" min="0" step="0.01" placeholder="₹ Rate" class="w-28 max-w-full border border-slate-300 focus:border-emerald-500 rounded-md px-2 py-1.5 text-right text-xs bg-white">`;
            const row = `<tr data-new-rate-row="1" class="border-t border-emerald-200 bg-emerald-50/60"><td class="py-2.5 px-3 text-slate-600">${esc(from || "—")}</td><td class="py-2.5 px-3"><input data-new-rate-destination="1" placeholder="New destination" class="w-full min-w-28 border border-slate-300 focus:border-emerald-500 rounded-md px-2 py-1.5 text-xs bg-white"></td>${cats.map(c=>`<td class="py-2.5 px-3 text-right">${input(c)}</td>`).join("")}<td class="py-2.5 px-3"><input data-new-rate-effective="1" type="date" value="${esc(effective)}" class="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"></td><td class="py-2.5 px-3 whitespace-nowrap text-center"><button type="button" onclick="window.EktaParties.saveNewDestination()" class="px-2.5 py-1.5 bg-emerald-600 text-white rounded-md text-[10px] font-bold mr-1">Save</button><button type="button" onclick="window.EktaParties.cancelAddDestination()" class="px-2.5 py-1.5 border border-slate-300 rounded-md text-[10px] font-bold">Cancel</button></td></tr>`;
            body.insertAdjacentHTML("afterbegin", row);
        }
        window.__ektaRenderedRateRows = list;
        if ($("rateListFooter")) $("rateListFooter").textContent = `${list.length} destination${list.length===1?"":"s"} • ${currentRateType().replaceAll("_"," ")}`;
    }

    async function deleteSavedRateRow(index) {
        const row = (window.__ektaRenderedRateRows || [])[index];
        if (!row) return;
        if (!confirm(`Delete complete rate row for ${row.destination}?`)) return;
        const ids = Object.values(row.ids || {}).filter(Boolean);
        if (!ids.length) return;
        const result = await window.supabaseClient.from(RATE_TABLE).delete().in("id", ids);
        if (result.error) return alert(result.error.message || "Unable to delete rate row.");
        await loadBillingData();
        renderRateList();
    }

    async function loadRateList() { syncRateTypeUi(); renderRateList(); }

    // Old fixed manual 32/34 entry is intentionally retired. Full-sheet import is the master flow.
    async function saveRateRow() { return alert("Use AI Import Full Rate List. Verify/edit the preview, then Confirm & Replace."); }
    function startAddDestination() {
        if (!$("ratePartySelect")?.value) return alert("First select a Billing Party / location.");
        if (addingInlineRate) return $("rateListBody")?.querySelector("[data-new-rate-destination]")?.focus();
        editingSavedRateIndex = -1;
        addingInlineRate = true;
        renderRateList();
        $("rateListBody")?.querySelector("[data-new-rate-destination]")?.focus();
    }
    function cancelAddDestination() {
        addingInlineRate = false;
        renderRateList();
    }
    async function saveNewDestination() {
        if (savingInlineRate) return;
        const tr = $("rateListBody")?.querySelector("[data-new-rate-row]");
        if (!tr) return;
        const partyId = $("ratePartySelect")?.value || "";
        const from = String($("rateFromLocation")?.value || "").trim();
        const destination = String(tr.querySelector("[data-new-rate-destination]")?.value || "").trim().toUpperCase();
        const effective = tr.querySelector("[data-new-rate-effective]")?.value || "";
        if (!partyId || !from || !destination || !effective) return alert("From, Destination and Effective Date are required.");
        const rates = [];
        for (const el of tr.querySelectorAll("[data-new-rate-category]")) {
            const raw = el.value.trim();
            if (!raw) continue;
            const rate = Number(raw);
            if (!Number.isFinite(rate) || rate < 0) return alert(`Invalid rate for ${el.dataset.newRateCategory}.`);
            rates.push({party_id:partyId,from_location:from,destination,vehicle_category:cleanRateCategory(el.dataset.newRateCategory),rate,effective_from:effective,status:"Active",rate_type:currentRateType()});
        }
        if (!rates.length) return alert("Enter at least one freight rate.");
        const existing = activeRatesForParty(partyId).some(r => norm(r.destination)===norm(destination) && String(r.effective_from||"")===effective && norm(r.from_location)===norm(from));
        if (existing) return alert(`${destination} already exists for this date. Use Edit instead.`);
        savingInlineRate = true;
        try {
            const check = await window.supabaseClient.from(RATE_TABLE).select("id").eq("party_id",partyId).eq("rate_type",currentRateType()).ilike("destination",destination).eq("effective_from",effective).limit(1);
            if (check.error) throw check.error;
            if (check.data?.length) return alert(`${destination} already exists for this date. Use Edit instead.`);
            const result = await window.supabaseClient.from(RATE_TABLE).insert(rates).select("id");
            if (result.error) throw result.error;
            addingInlineRate = false;
            await loadBillingData();
            setAiRateStatus(`${destination}: ${rates.length} rate(s) saved.`, "success");
        } catch(error) {
            alert(`Could not save new destination: ${error.message || error}`);
        } finally { savingInlineRate = false; }
    }
    function editRateRow(index) {
        addingInlineRate = false;
        editingSavedRateIndex = index;
        renderRateList();
    }
    function cancelInlineRateEdit() {
        editingSavedRateIndex = -1;
        renderRateList();
    }
    async function saveInlineRateEdit(index) {
        const row = (window.__ektaRenderedRateRows || [])[index];
        if (!row || index !== editingSavedRateIndex) return;
        const tr = $("rateListBody")?.querySelectorAll("tr:not([data-new-rate-row])")[index];
        if (!tr) return;
        const destination = tr.querySelector('[data-rate-edit="destination"]')?.value.trim() || '';
        const effective = tr.querySelector('[data-rate-edit="effective"]')?.value || '';
        if (!destination || !effective) return alert('Destination and Effective Date are required.');
        const edits = [];
        for (const [category,id] of Object.entries(row.ids || {})) {
            const input = [...tr.querySelectorAll('[data-rate-category]')].find(e=>e.dataset.rateCategory===category);
            if (!input || !id) continue;
            const raw = input.value.trim(), rate = Number(raw);
            if (!raw || !Number.isFinite(rate) || rate < 0) return alert(`Invalid ${category} rate.`);
            edits.push({id,rate});
        }
        if (!edits.length) return alert('No saved rates found for this row.');
        if (!confirm(`Update ${destination} (${edits.length} rate option(s))?`)) return;
        // Update existing records by primary key; no deletion or replacement of other destinations.
        for (const item of edits) {
            const result = await window.supabaseClient.from(RATE_TABLE)
                .update({destination, effective_from:effective, rate:item.rate})
                .eq('id',item.id);
            if (result.error) {
                alert(`Update stopped: ${result.error.message}. Refresh to check any rates already updated.`);
                await loadBillingData(); return;
            }
        }
        editingSavedRateIndex = -1;
        await loadBillingData();
        setAiRateStatus(`${destination}: saved rate row updated successfully.`, 'success');
    }

    function setAiRateStatus(message, kind = "info") {
        const el = $("rateAiStatus");
        if (!el) return;
        el.className = "mt-3 text-xs rounded-lg px-3 py-2 border";
        if (kind === "error") el.classList.add("bg-red-50","text-red-700","border-red-200");
        else if (kind === "success") el.classList.add("bg-emerald-50","text-emerald-700","border-emerald-200");
        else el.classList.add("bg-blue-50","text-blue-700","border-blue-200");
        el.classList.remove("hidden");
        el.textContent = message;
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
            reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
            reader.readAsDataURL(file);
        });
    }

    function extractRateOptions(row) {
        const out = {};
        const add = (label, value) => {
            const category = cleanRateCategory(label);
            if (!category || value === null || value === undefined || String(value).trim() === "" || String(value).trim() === "-") return;
            const amount = Number(String(value).replace(/,/g, ""));
            if (Number.isFinite(amount) && amount >= 0) out[category] = amount;
        };
        // Current Gemini contract: preserve exact PDF vehicle headings.
        if (row?.ratesByCategory && typeof row.ratesByCategory === "object" && !Array.isArray(row.ratesByCategory)) {
            Object.entries(row.ratesByCategory).forEach(([category, amount]) => add(category, amount));
            return out; // Never add ambiguous 32FT / 34FT legacy aliases.
        }
        if (row?.options && typeof row.options === "object" && !Array.isArray(row.options)) {
            Object.entries(row.options).forEach(([category, amount]) => add(category, amount));
            return out;
        }
        if (Array.isArray(row?.rates)) {
            row.rates.forEach(item => { if (item?.vehicle_category) add(item.vehicle_category, item.rate); });
            if (Object.keys(out).length) return out;
        }
        if (row?.vehicle_category) { add(row.vehicle_category, row.rate); return out; }
        Object.entries(row || {}).forEach(([key, value]) => {
            if (/^(?:rate[_ -]*)?\d+(?:\.\d+)?(?:ft|t(?:on)?)(?:[a-z0-9_-]*)$/i.test(key)) {
                add(key.replace(/^rate[_ -]*/i, ""), value);
            }
        });
        // Legacy responses cannot identify SXL/-N; display as legacy, not invented labels.
        if (!Object.keys(out).length) {
            add("32FT", row?.rate32);
            add("34FT", row?.rate34);
        }
        return out;
    }

    function renderAiRatePreview() {
        const wrap=$("rateAiPreview"), body=$("rateAiPreviewBody"), head=$("rateAiPreviewHead");
        if (!wrap || !body || !head) return;
        if (!aiRatePreviewRows.length) { wrap.classList.add("hidden"); body.innerHTML=""; head.innerHTML=""; return; }
        wrap.classList.remove("hidden");
        const cats = allCategories(aiRatePreviewRows);
        head.innerHTML = `<tr><th class="text-left p-2">Destination</th><th class="text-left p-2">Source</th>${cats.map(c=>`<th class="text-right p-2">${esc(c)}</th>`).join("")}<th class="text-center p-2">Action</th></tr>`;
        body.innerHTML = aiRatePreviewRows.map((r,i)=>`<tr class="border-t border-violet-100"><td class="p-2"><input data-ai-row="${i}" data-ai-field="destination" class="w-44 border rounded px-2 py-1" value="${esc(r.destination||"")}"></td><td class="p-2"><span class="px-2 py-1 rounded-full text-[10px] font-bold ${r.source==="Manual"?"bg-blue-50 text-blue-700":"bg-violet-50 text-violet-700"}">${esc(r.source||"AI")}</span></td>${cats.map(c=>`<td class="p-2"><input data-ai-row="${i}" data-ai-cat="${esc(c)}" type="number" min="0" step="0.01" class="w-28 ml-auto block text-right border rounded px-2 py-1" value="${r.options?.[c] ?? ""}"></td>`).join("")}<td class="p-2 text-center"><button type="button" onclick="window.EktaParties.deleteAiRateRow(${i})" class="px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700 text-[10px] font-bold"><i class="fa-solid fa-trash mr-1"></i>Delete</button></td></tr>`).join("");
    }

    function deleteAiRateRow(index) {
        aiRatePreviewRows.splice(index,1);
        renderAiRatePreview();
        setAiRateStatus(`${aiRatePreviewRows.length} destination(s) remain in preview.`, "success");
    }

    function syncAiRateInputs() {
        document.querySelectorAll("#rateAiPreviewBody [data-ai-row]").forEach(input=>{
            const i=Number(input.dataset.aiRow); if (!aiRatePreviewRows[i]) return;
            if (input.dataset.aiField === "destination") aiRatePreviewRows[i].destination=String(input.value||"").trim();
            if (input.dataset.aiCat) {
                const cat=input.dataset.aiCat;
                if (input.value === "") delete aiRatePreviewRows[i].options[cat];
                else aiRatePreviewRows[i].options[cat]=Number(input.value);
            }
        });
    }

    // PDF-Lib splits a large PDF in the browser: no original full PDF is sent to the Edge Function.
    async function loadPdfLibForRates() {
        if (window.PDFLib?.PDFDocument) return window.PDFLib;
        if (!window.__ektaPdfLibPromise) {
            window.__ektaPdfLibPromise = new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
                script.onload = () => window.PDFLib?.PDFDocument ? resolve(window.PDFLib) : reject(new Error("PDF library unavailable"));
                script.onerror = () => reject(new Error("PDF splitting library could not load. Check internet connection."));
                document.head.appendChild(script);
            }).catch(error => { window.__ektaPdfLibPromise = null; throw error; });
        }
        return window.__ektaPdfLibPromise;
    }

    function bytesToBase64(bytes) {
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        return btoa(binary);
    }

    async function rateImportChunks(file) {
        if (file.type !== "application/pdf") {
            return [{ fileBase64: await fileToBase64(file), mimeType: file.type || "image/jpeg", label: "Image" }];
        }
        const { PDFDocument } = await loadPdfLibForRates();
        const source = await PDFDocument.load(await file.arrayBuffer());
        const count = source.getPageCount();
        const chunks = [];
        // Three pages per invocation keeps each Gemini call bounded.
        for (let start = 0; start < count; start += 3) {
            if (rateImportCancelled) throw new Error("Import cancelled.");
            const split = await PDFDocument.create();
            const indices = Array.from({length: Math.min(3, count - start)}, (_, i) => start + i);
            const pages = await split.copyPages(source, indices);
            pages.forEach(page => split.addPage(page));
            const bytes = await split.save();
            chunks.push({ fileBase64: bytesToBase64(bytes), mimeType: "application/pdf", label: `Pages ${start + 1}–${start + indices.length}` });
        }
        return chunks;
    }

    function cancelAiRateImport() {
        rateImportCancelled = true;
        if (!rateImportRunning) {
            aiRatePreviewRows = [];
            renderAiRatePreview();
            setAiRateStatus("Unsaved preview cleared. Saved rates were not changed.", "info");
        } else {
            setAiRateStatus("Cancelling after the current request finishes. No rates will be saved.", "info");
        }
    }

    async function analyzeRateFile(file) {
        const partyId = $("ratePartySelect")?.value || "";
        if (!partyId) { if ($("rateAiFile")) $("rateAiFile").value = ""; return alert("First select a Billing Party / location."); }
        if (!file) return;
        if (rateImportRunning) return alert("A rate import is already running.");
        if (!(file.type.startsWith("image/") || file.type === "application/pdf")) return alert("Please upload a photo or PDF rate list.");
        if (file.size > 12 * 1024 * 1024) return alert("File is too large. Please use a file up to 12 MB.");
        syncRateTypeUi();
        syncAiRateInputs();
        rateImportCancelled = false;
        rateImportRunning = true;
        const importedMap = new Map();
        const party = selectedRateParty();
        try {
            setAiRateStatus("Preparing PDF batches… no rates will be saved until you confirm.");
            const chunks = await rateImportChunks(file);
            for (let index = 0; index < chunks.length; index++) {
                if (rateImportCancelled) throw new Error("Import cancelled.");
                const chunk = chunks[index];
                setAiRateStatus(`Reading ${chunk.label} — batch ${index + 1}/${chunks.length}. ${importedMap.size} destinations found so far. Please keep this page open.`);
                const { data, error } = await window.supabaseClient.functions.invoke("gemini-chat", {
                    body: { mode: "party_rate_list", fileBase64: chunk.fileBase64, mimeType: chunk.mimeType,
                        partyName: party?.name || "", loadingPoint: String($("rateFromLocation")?.value || "").trim(),
                        rateType: currentRateType(), dynamicRateOptions: true }
                });
                if (rateImportCancelled) throw new Error("Import cancelled.");
                if (error) throw new Error(`Batch ${index + 1}/${chunks.length} (${chunk.label}) failed: ${error.message || "Edge Function error"}. Nothing has been saved.`);
                if (!data?.success) throw new Error(`Batch ${index + 1}/${chunks.length}: ${data?.error || "AI could not read this batch"}. Nothing has been saved.`);
                const raw = Array.isArray(data?.rates) ? data.rates : [];
                raw.forEach(r => {
                    const destination = String(r?.destination || r?.location || r?.to_location || "").trim();
                    if (!destination) return;
                    const key = norm(destination);
                    if (!importedMap.has(key)) importedMap.set(key, { destination, options: {}, source: "AI" });
                    Object.assign(importedMap.get(key).options, extractRateOptions(r));
                });
            }
            const imported = [...importedMap.values()].filter(r => Object.keys(r.options).length);
            if (!imported.length) return setAiRateStatus("No usable rates found. Existing preview and saved rates are unchanged.", "error");
            aiRatePreviewRows.push(...imported);
            renderAiRatePreview();
            setAiRateStatus(`${imported.length} AI destinations imported from ${chunks.length} batch(es). Review every category and rate before confirming.`, "success");
        } catch (error) {
            console.error("AI rate import failed:", error);
            setAiRateStatus(`${error?.message || "Import failed"} Existing preview and saved rates are unchanged.`, "error");
        } finally {
            rateImportRunning = false;
            if ($("rateAiFile")) $("rateAiFile").value = "";
        }
    }

    function addManualRateRow() {
        const partyId=$("ratePartySelect")?.value||"";
        if (!partyId) return alert("First select a Billing Party / location.");
        syncAiRateInputs();
        const destination=String($("manualRateDestination")?.value||"").trim();
        const category=cleanRateCategory($("manualRateCategory")?.value||"");
        const raw=String($("manualRateAmount")?.value||"").trim();
        const rate=Number(raw);
        if (!destination) return alert("Enter Destination.");
        if (!category) return alert("Enter FT / Ton / Rate Option.");
        if (raw==="" || !Number.isFinite(rate) || rate<0) return alert("Enter a valid Rate.");
        aiRatePreviewRows.push({destination,options:{[category]:rate},source:"Manual"});
        if ($("manualRateDestination")) $("manualRateDestination").value="";
        if ($("manualRateCategory")) $("manualRateCategory").value="";
        if ($("manualRateAmount")) $("manualRateAmount").value="";
        renderAiRatePreview();
        setAiRateStatus("Manual row added. AI import will append below existing rows.","success");
    }

    function approveAiRateRow(){ /* no separate approval required in v19 */ }

    async function confirmAiRates() {
        if (rateImportRunning) return alert("Wait for all PDF batches to finish before confirming.");
        const partyId=$("ratePartySelect")?.value||"", from=String($("rateFromLocation")?.value||"").trim();
        const effectiveFrom=$("rateEffectiveFrom")?.value||new Date().toISOString().slice(0,10), rateType=currentRateType();
        if (!partyId || !from) return alert("Billing Party/location and Loading Point are required.");
        syncAiRateInputs();
        const invalid=aiRatePreviewRows.filter(r=>!String(r.destination||"").trim() || !Object.keys(r.options||{}).length || Object.values(r.options||{}).some(v=>!Number.isFinite(Number(v))||Number(v)<0));
        if (invalid.length) return alert(`Please correct ${invalid.length} incomplete/invalid row(s) before confirming.`);
        if (!aiRatePreviewRows.length) return alert("No rate rows are ready to save.");
        const totalRates=aiRatePreviewRows.reduce((n,r)=>n+Object.keys(r.options||{}).length,0);
        if (!confirm(`Replace this ${rateType.replaceAll("_"," ")} rate list with ${aiRatePreviewRows.length} destination(s) / ${totalRates} rate(s)?`)) return;
        setAiRateStatus("Replacing active rate list…");
        const rows=[];
        aiRatePreviewRows.forEach(r=>Object.entries(r.options||{}).forEach(([cat,rate])=>rows.push({party_id:partyId,from_location:from,destination:String(r.destination).trim(),vehicle_category:cleanRateCategory(cat),rate:Number(rate),effective_from:effectiveFrom,status:"Active",rate_type:rateType})));
        const repl=await window.supabaseClient.rpc("replace_party_rate_list", {p_party_id:partyId,p_rate_type:rateType,p_from_location:from,p_effective_from:effectiveFrom,p_rows:rows});
        if (repl.error) { setAiRateStatus(repl.error.message||"Could not replace rate list.","error"); return; }
        aiRatePreviewRows=[]; renderAiRatePreview(); await loadBillingData(); if ($("ratePartySelect")) $("ratePartySelect").value=partyId; syncRateTypeUi(); renderRateList();
        setAiRateStatus(`Rate list replaced successfully: ${rows.length} rate(s) saved.`,"success");
    }

    function setAiPartyStatus(message, kind = "info") {
        const el = $("partyAiStatus");
        if (!el) return;
        el.className = "mt-3 text-xs rounded-lg px-3 py-2 border";
        if (kind === "error") el.classList.add("bg-red-50","text-red-700","border-red-200");
        else if (kind === "success") el.classList.add("bg-emerald-50","text-emerald-700","border-emerald-200");
        else el.classList.add("bg-blue-50","text-blue-700","border-blue-200");
        el.classList.remove("hidden");
        el.textContent = message;
    }

    // FINAL DUPLICATE RULE: block only the same business entry.
    // Same code + same city is allowed when Party Name differs.
    // GST may repeat across genuine units; when GST is present it participates in exact identity.
    function duplicatePartyMatch(row) {
        const sourceCode = baseBillingCode(row.party_code);
        const name = norm(row.name);
        const city = norm(row.city);
        const gst = norm(row.gst_number);
        // Transporters: a code belongs to exactly one record, regardless of name/city.
        if (activePartySection === "Transporter") {
            const code = baseBillingCode(row.party_code || row.autoCode);
            return code ? (parties.find(p => baseBillingCode(p.party_code) === code) || null) : null;
        }

        return parties.find(p => {
            if (norm(p.party_type) !== norm(activePartySection)) return false;
            const pCode = baseBillingCode(p.party_code);
            const sameCode = sourceCode ? pCode === sourceCode : true;
            const sameName = name && norm(p.name) === name;
            const sameCity = city && norm(p.city) === city;
            return sameCode && sameName && sameCity;
        }) || null;
    }

    // Suggestions are advisory: a matching name never silently assigns a code.
    function aiPartyCodeSuggestion(row) {
        const name = norm(row.name);
        const matches = parties.filter(p => norm(p.party_type) === norm(activePartySection) && norm(p.name) === name);
        const codes = [...new Set(matches.map(p => baseBillingCode(p.party_code)).filter(Boolean))];
        return codes.length === 1 ? codes[0] : "";
    }

    function aiPartyCodeConflict(row) {
        const code = baseBillingCode(row.party_code || row.autoCode);
        if (!code) return "";
        const matching = parties.filter(p => norm(p.party_type) === norm(activePartySection) && baseBillingCode(p.party_code) === code);
        const differentCompany = matching.find(p => norm(p.name) !== norm(row.name));
        if (differentCompany) return `Code ${code} is already assigned to ${differentCompany.name}. Verify company identity.`;
        return "";
    }

    function renderAiPartyPreview() {
        const wrap = $("partyAiPreview"), body = $("partyAiPreviewBody");
        if (!wrap || !body) return;
        if (!aiPartyPreviewRows.length) {
            wrap.classList.add("hidden"); body.innerHTML = ""; return;
        }
        wrap.classList.remove("hidden");
        body.innerHTML = aiPartyPreviewRows.map((r,i) => {
            const dup = duplicatePartyMatch(r);
            if (activePartySection === "Transporter" && dup) r.selected = false;
            const review = dup ? `Already Exists — ${esc(visiblePartyCode(dup))}`
                : aiPartyCodeConflict(r) ? esc(aiPartyCodeConflict(r))
                : (!r.party_code && r.sourceCodeRequired) ? "Confirm Party Code"
                : r.needsReview ? "Verify Details" : "Ready";
            const extra = [
                ["State", "state"], ["GST Number", "gst_number"], ["PAN Number", "pan_number"],
                ["Contact Person", "contact_person"], ["Mobile", "mobile"], ["Address", "address"]
            ].map(([label,field]) => `<label>${label}<input data-party-ai-row="${i}" data-party-ai-field="${field}" value="${esc(r[field]||"")}"></label>`).join("");
            return `<tr class="border-t border-slate-100 ${dup ? "bg-amber-50/40" : ""}">
                <td class="text-center"><input data-party-ai-row="${i}" data-party-ai-field="selected" type="checkbox" ${r.selected && !dup ? "checked" : ""} ${dup ? "disabled" : ""}></td>
                <td><input data-party-ai-row="${i}" data-party-ai-field="party_code" class="font-mono font-bold" value="${esc(r.party_code || r.autoCode || "")}" placeholder="Party Code"></td>
                <td><input data-party-ai-row="${i}" data-party-ai-field="name" value="${esc(r.name||"")}" placeholder="Party Name"></td>
                <td><input data-party-ai-row="${i}" data-party-ai-field="city" value="${esc(r.city||"")}" placeholder="${activePartySection === "Transporter" ? "Verify later" : "City / Branch"}"></td>
                <td><span class="inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${dup ? "bg-amber-100 text-amber-800" : r.needsReview ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}">${review}</span>
                    <details><summary>More details <i class="fa-solid fa-chevron-down ml-1"></i></summary><div class="ai-extra-grid">${extra}</div></details></td>
            </tr>`;
        }).join("");
    }

    async function assignPreviewCodes() {
        const used = await fetchUsedPartyCodes();
        aiPartyPreviewRows.forEach(r => {
            const sourceCode = baseBillingCode(r.party_code);
            if (sourceCode) {
                r.party_code = sourceCode;
                r.autoCode = "";
                return;
            }
            if (aiPartySourceHasCodeColumn || r.sourceCodeRequired) {
                r.autoCode = "";
                r.selected = true;
                r.needsReview = true;
                return;
            }
            const code = nextPartyCodeFromUsed(used);
            r.autoCode = code;
            used.add(code);
        });
    }

    async function analyzePartyMasterFile(file) {
        if (!activePartySection) {
            if ($("partyAiFile")) $("partyAiFile").value = "";
            return alert("First select Billing Parties or Transporters.");
        }
        if (!file) return;
        if (!(file.type.startsWith("image/") || file.type === "application/pdf")) {
            $("partyAiFile").value = "";
            return alert("Please upload a party-list photo or PDF.");
        }
        if (file.size > 12 * 1024 * 1024) {
            $("partyAiFile").value = "";
            return alert("File is too large. Please use a file up to 12 MB.");
        }
        aiPartyPreviewRows = [];
        aiPartySourceHasCodeColumn = false;
        renderAiPartyPreview();
        setAiPartyStatus(`Gemini is reading ${activePartySection === "Billing Client" ? "Billing Parties" : "Transporters"}…`);
        try {
            const fileBase64 = await fileToBase64(file);
            const {data,error} = await window.supabaseClient.functions.invoke("gemini-chat", {
                body: {
                    mode: "party_master_import",
                    fileBase64,
                    mimeType: file.type || "image/jpeg",
                    partyType: activePartySection
                }
            });
            if (error) throw error;
            if (!data?.success) throw new Error(data?.error || "AI could not read this party list.");
            aiPartySourceHasCodeColumn = data?.source_has_party_code_column === true;
            aiPartyPreviewRows = (Array.isArray(data.parties) ? data.parties : []).map(r => {
                const sourcePartyCode = baseBillingCode(r?.party_code || r?.code || "");
                return ({
                selected: true,
                party_code: sourcePartyCode,
                autoCode: "",
                sourceCodeRequired: aiPartySourceHasCodeColumn,
                name: String(r?.name||"").trim(),
                city: String(r?.city||"").trim(),
                state: String(r?.state||"").trim(),
                gst_number: String(r?.gst_number||r?.gst||"").trim().toUpperCase(),
                pan_number: String(r?.pan_number||r?.pan||"").trim().toUpperCase(),
                contact_person: String(r?.contact_person||"").trim(),
                mobile: String(r?.mobile||"").trim(),
                email: String(r?.email||"").trim(),
                address: String(r?.address||"").trim(),
                credit_days: Number(r?.credit_days||0),
                payment_terms: String(r?.payment_terms||"").trim(),
                notes: String(r?.notes||"").trim(),
                needsReview:
                    r?.needsReview === true ||
                    !String(r?.name||"").trim() ||
                    (aiPartySourceHasCodeColumn && !sourcePartyCode)
                });
            }).filter(r => r.name || r.city || r.gst_number || r.mobile || r.party_code);
            await assignPreviewCodes();
            renderAiPartyPreview();
            setAiPartyStatus(aiPartyPreviewRows.length
                ? aiPartySourceHasCodeColumn
                ? `${aiPartyPreviewRows.length} row(s) found. Missing source codes need your manual confirmation. Check existing company code suggestions before saving.`
                : `${aiPartyPreviewRows.length} row(s) found. No Party Code column detected: missing codes may be auto-generated. Existing parties are blocked automatically.`
                : "No party rows were found. Nothing has been saved.",
                aiPartyPreviewRows.length ? "success" : "error");
        } catch(e) {
            console.error("[EKTA PARTIES] AI party import failed:", e);
            setAiPartyStatus(e?.message || "AI party import failed. Nothing has been saved.", "error");
        } finally {
            if ($("partyAiFile")) $("partyAiFile").value = "";
        }
    }

    function syncAiPartyInputs() {
        document.querySelectorAll("#partyAiPreviewBody [data-party-ai-row]").forEach(input => {
            const i = Number(input.dataset.partyAiRow);
            const field = input.dataset.partyAiField;
            if (!aiPartyPreviewRows[i] || !field) return;
            aiPartyPreviewRows[i][field] = input.type === "checkbox" ? input.checked : input.value;
        });
    }

    async function confirmAiParties() {
        if (!activePartySection) return alert("Select Billing Parties or Transporters first.");
        syncAiPartyInputs();

        const live = await window.supabaseClient.from(TABLE).select("*");
        if (live.error) return alert(live.error.message || "Could not verify existing parties.");
        parties = live.data || [];
        try { await loadBillingData(); } catch(e) { console.error(e); }

        const selectedRows = aiPartyPreviewRows.filter(r => r.selected);
        if (activePartySection === "Transporter") {
            const duplicates = selectedRows.filter(r => duplicatePartyMatch(r));
            if (duplicates.length) return alert(`Already Exists: Transporter code ${baseBillingCode(duplicates[0].party_code || duplicates[0].autoCode)} is already assigned. Duplicate code is blocked.`);
            const seenTransportCodes = new Set();
            for (const r of selectedRows) {
                const code = baseBillingCode(r.party_code || r.autoCode);
                if (code && seenTransportCodes.has(code)) return alert(`Already Exists: Transporter code ${code} is repeated in this import. Uncheck the duplicate.`);
                if (code) seenTransportCodes.add(code);
            }
        }
        const missingCodes = selectedRows.filter(r => !baseBillingCode(r.party_code || r.autoCode));
        if (missingCodes.length) return alert(`${missingCodes.length} selected row(s) need a Party Code. Enter the correct existing code or a verified new code, or uncheck the row.`);
        const conflicts = [...new Set(selectedRows.map(aiPartyCodeConflict).filter(Boolean))];
        // Existing master codes may have multiple owner-approved trade names/branches.
        // Warn once and require explicit approval, rather than blocking forever.
        if (activePartySection !== "Transporter" && conflicts.length && !confirm(`Existing Party Code review:\n${conflicts.join("\n")}\n\nOnly continue if these are intentionally separate entries under the same master code. Existing records will NOT be changed. Continue?`)) return;
        const candidates = selectedRows.filter(r => !duplicatePartyMatch(r));
        // Transporter onboarding: City may be completed by staff later.
        // Billing Client validation is intentionally unchanged.
        const invalid = candidates.filter(r => !String(r.name||"").trim() ||
            (activePartySection !== "Transporter" && !String(r.city||"").trim()));
        if (invalid.length) return alert(activePartySection === "Transporter"
            ? `Please fill Party Name in ${invalid.length} selected transporter row(s).`
            : `Please fill Party Name and Location/City in ${invalid.length} selected row(s).`);
        if (!candidates.length) return alert("All selected party locations already exist. Nothing new to save.");
        // Check duplicates and conflicting identities within this upload too.
        const seen = new Set();
        for (const r of candidates) {
            const code = baseBillingCode(r.party_code || r.autoCode);
            const key = [code, norm(r.name), norm(r.city), norm(r.gst_number)].join("|");
            if (seen.has(key)) return alert(`Repeated row in this upload: ${r.name} — ${r.city}. Uncheck the duplicate.`);
            seen.add(key);
        }
        if (!confirm(`You reviewed ${candidates.length} new location(s) and their Party Codes. Save them to Supabase?`)) return;

        setAiPartyStatus("Saving verified party locations…");
        let saved = 0, skipped = 0;

        for (const r of candidates) {
            const used = await fetchUsedPartyCodes();
            const sourceCode = baseBillingCode(r.party_code || r.autoCode);
            if (!sourceCode || duplicatePartyMatch(r)) {
                skipped++; continue;
            }

            // Recheck against live database before every transporter insert.
            if (activePartySection === "Transporter") {
                const existing = await window.supabaseClient.from(TABLE).select("id,party_code")
                    .ilike("party_code", sourceCode).limit(1);
                if (existing.error || existing.data?.length || used.has(sourceCode)) {
                    skipped++; continue;
                }
            }
            const location = String(r.city||"").trim() ||
                (activePartySection === "Transporter" ? "PENDING VERIFICATION" : "");
            const masterCode = sourceCode;

            // FINAL LOCKED RULE: every Billing Client gets UNIT from City column,
            // including the first/only location. Do not derive it from Party Name brackets
            // and do not auto-add _2/_3. Same code+city may repeat for different Party Names.
            const internalCode = activePartySection === "Billing Client"
                ? `${masterCode}__UNIT__${safeUnitKey(location)}`
                : masterCode;

            // A company may have several distinct branches under one master code.
            // The database party_code remains unique: use a branch-specific suffix
            // only when the usual CITY-based internal code is already occupied.
            // The master code displayed to the owner is unchanged.
            let uniqueInternalCode = internalCode;
            const usedInternalCodes = new Set(parties.map(p => norm(p.party_code)));
            if (activePartySection === "Billing Client" && usedInternalCodes.has(norm(uniqueInternalCode))) {
                let n = 2;
                while (usedInternalCodes.has(norm(`${internalCode}__BRANCH__${n}`))) n++;
                uniqueInternalCode = `${internalCode}__BRANCH__${n}`;
            }
            const zone = detectZone(location) || "North";
            const payload = {
                party_code: uniqueInternalCode,
                name: String(r.name).trim(),
                party_type: activePartySection,
                gst_number: String(r.gst_number||"").trim().toUpperCase() || null,
                mobile: String(r.mobile||"").trim() || null,
                address: String(r.address||"").trim() || null,
                city: location,
                state: String(r.state||"").trim() || null,
                credit_days: Number(r.credit_days||0),
                credit_limit: 0,
                status: "Active",
                contact_person: String(r.contact_person||"").trim() || null,
                email: String(r.email||"").trim() || null,
                pan_number: String(r.pan_number||"").trim().toUpperCase() || null,
                zone,
                payment_terms: String(r.payment_terms||"").trim() || null,
                notes: String(r.notes||"").trim() || null,
                updated_at: new Date().toISOString()
            };

            const ins = await window.supabaseClient.from(TABLE).insert(payload).select().single();
            if (ins.error) {
                console.error("[EKTA PARTIES] AI location save failed:", ins.error, payload);
                skipped++; continue;
            }

            parties.push(ins.data);
            saved++;

            // Billing Client: one master group code, one unit + party_id per location.
            if (activePartySection === "Billing Client") {
                try {
                    await ensureBillingMapping(ins.data, masterCode, payload.name, location);
                } catch(e) {
                    console.error("[EKTA PARTIES] Billing location mapping failed:", e);
                }
            }
        }

        await load();
        try { await loadBillingData(); } catch(e) { console.error(e); }
        if (!skipped) aiPartyPreviewRows = [];
        renderAiPartyPreview();
        setAiPartyStatus(
            `${saved} location(s) saved successfully.${skipped ? ` ${skipped} duplicate/failed row(s) skipped.` : ""}`,
            saved ? "success" : "error"
        );
    }

    function showPartySection(type) {
        activePartySection = type || "";
        closeBillingWorkspace();
        $("partyMasterListArea")?.classList.toggle("hidden", !activePartySection);
        if ($("partyAiImportPanel")) $("partyAiImportPanel").classList.toggle("hidden", !activePartySection);
        if ($("partyAiImportTitle")) $("partyAiImportTitle").textContent =
            activePartySection === "Billing Client" ? "AI Import Billing Parties" :
            activePartySection === "Transporter" ? "AI Import Transporters" : "Select a section first";
        aiPartyPreviewRows = [];
        renderAiPartyPreview();
        if ($("partyAiStatus")) $("partyAiStatus").classList.add("hidden");
        if ($("partyTypeFilter")) $("partyTypeFilter").value = type || "";
        if ($("partySearch")) $("partySearch").value = "";
        renderTable();
        const table = $("partyTableBody")?.closest(".bg-white");
        table?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function renderAll() {
        updateSummaries();
        renderTable();
    }

    async function refresh() {
        await load();
    }

    async function init() {
        if (!$("partiesModule")) return;

        // Close the Rate Party search menu whenever the user clicks anywhere
        // outside the search field/dropdown. Keep selection and rate data intact.
        if (!window.__ektaRatePartyOutsideClickBound) {
            document.addEventListener("pointerdown", (event) => {
                const search = $("ratePartySearch");
                const menu = $("ratePartyDropdown");
                if (!search || !menu || menu.classList.contains("hidden")) return;
                if (search.contains(event.target) || menu.contains(event.target)) return;
                menu.classList.add("hidden");
            });
            window.__ektaRatePartyOutsideClickBound = true;
        }

        // On first entry, show only the four module cards. The party table
        // becomes visible only after Billing Parties or Transporters is chosen.
        $("partyMasterListArea")?.classList.add("hidden");
        $("partyAiImportPanel")?.classList.add("hidden");
        await refresh();
        try { await loadBillingData(); } catch (error) { console.error("Billing workspace load failed:", error); }
        if ($("rateEffectiveFrom") && !$("rateEffectiveFrom").value) $("rateEffectiveFrom").value = new Date().toISOString().slice(0,10);
    }

    window.EktaParties = {
        __initialized: true,
        init,
        refresh,
        openForm,
        closeForm,
        saveParty,
        addUnit,
        checkExistingPartyCode,
        openView,
        closeView,
        renderTable,
        autoDetectZone,
        resetForm,
        openBillingWorkspace,
        closeBillingWorkspace,
        loadBillingData,
        createBillingGroup,
        mapBillingUnit,
        loadRateList,
        handleRatePartySearch,
        renderRatePartyDropdown,
        selectRateParty,
        ratePartyKeydown,
        saveRateRow,
        startAddDestination,
        cancelAddDestination,
        saveNewDestination,
        editRateRow,
        saveInlineRateEdit,
        cancelInlineRateEdit,
        analyzeRateFile,
        cancelAiRateImport,
        addManualRateRow,
        approveAiRateRow,
        confirmAiRates,
        analyzePartyMasterFile,
        confirmAiParties,
        showPartySection,
        changeRateType,
        deleteAiRateRow,
        deleteSavedRateRow
    };

    // Arrow keys scroll the active Party worksheet when focus is not editing a field.
    document.addEventListener("keydown", function(event) {
        if (!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)) return;
        if (!$("partiesModule") || $("partyMasterListArea")?.classList.contains("hidden")) return;
        if (!$("partyFormModal")?.classList.contains("hidden")) return;
        const el = event.target;
        if (el?.closest?.('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
        const dir = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
        const tableScroll = $("partyTableBody")?.closest(".overflow-x-auto");
        if (horizontal && tableScroll && tableScroll.scrollWidth > tableScroll.clientWidth) {
            event.preventDefault(); tableScroll.scrollBy({left: dir * 160, behavior:"smooth"});
        } else if (!horizontal) {
            event.preventDefault();
            const panel = $("partiesModule")?.closest('[style*="overflow"], .overflow-y-auto');
            const scroller = panel && panel.scrollHeight > panel.clientHeight ? panel : window;
            scroller.scrollBy({top: dir * 100, behavior:"smooth"});
        }
    });

    init();
})();


// V12: reliable footer Add New Destination bridge.
window.startEktaAddDestination = function () {
    if (window.EktaParties && typeof window.EktaParties.startAddDestination === "function") {
        window.EktaParties.startAddDestination();
    }
};
