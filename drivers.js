(function () {
    "use strict";

    /*
     * =========================================================
     * EKTA DRIVERS MANAGEMENT
     * =========================================================
     * IIFE is required because dashboard-home dynamically injects
     * this module more than once during navigation.
     */

    if (window.EktaDrivers && window.EktaDrivers.__initialized) {
        try {
            window.EktaDrivers.refresh();
        } catch (e) {
            console.warn("[EKTA DRIVERS] Existing module refresh failed:", e);
        }
        return;
    }

    const DRIVER_TABLE = "drivers";
    const ASSIGNMENT_TABLE = "truck_driver_assignments";
    const TRUCK_TABLE = "trucks";

    let drivers = [];
    let trucks = [];
    let assignments = [];

    let currentSection = "master";

    const $ = function (id) {
        return document.getElementById(id);
    };

    const esc = function (value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // Compatibility alias used by the profile/document preview helpers.
    const escapeHTML = esc;

    const hasSupabase = function () {
        return !!(
            window.supabaseClient &&
            typeof window.supabaseClient.from === "function"
        );
    };

    const todayISO = function () {
        return new Date().toISOString().slice(0, 10);
    };

    const formatDate = function (value) {
        if (!value) return "-";

        const d = new Date(value + (String(value).length === 10 ? "T00:00:00" : ""));
        if (Number.isNaN(d.getTime())) return value;

        return d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
    };

    const formatDateTime = function (value) {
        if (!value) return "-";

        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;

        return d.toLocaleString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    };

    const statusBadge = function (status) {
        const normalized = String(status || "").toLowerCase();

        if (normalized === "active") {
            return `
                <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                    <i class="fa-solid fa-circle text-[5px] mr-1"></i> Active
                </span>
            `;
        }

        return `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold text-[10px]">
                <i class="fa-solid fa-circle text-[5px] mr-1"></i> ${esc(status || "Inactive")}
            </span>
        `;
    };

    const findDriverById = function (id) {
        return drivers.find(function (driver) {
            return String(driver.id) === String(id);
        });
    };

    const findTruckById = function (id) {
        return trucks.find(function (truck) {
            return String(truck.id) === String(id);
        });
    };

    const getActiveAssignmentForDriver = function (driverId) {
        return assignments.find(function (assignment) {
            return (
                String(assignment.driver_id) === String(driverId) &&
                String(assignment.status || "").toLowerCase() === "active"
            );
        });
    };

    const getTruckNumber = function (truckId) {
        const truck = findTruckById(truckId);
        return truck ? truck.truck_number : "-";
    };

    const getDriverName = function (driverId) {
        const driver = findDriverById(driverId);
        return driver ? driver.name : "-";
    };

    const getNextDriverCode = function () {
        let maxNumber = 0;

        drivers.forEach(function (driver) {
            const match = String(driver.driver_code || "")
                .trim()
                .toUpperCase()
                .match(/^DRV(\d+)$/);

            if (match) {
                maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
            }
        });

        return "DRV" + String(maxNumber + 1).padStart(3, "0");
    };

    const fillNextDriverCode = function () {
        const codeInput = $("driverCode");
        const editId = $("editDriverId")?.value || "";

        if (codeInput && !editId) {
            codeInput.value = getNextDriverCode();
        }
    };

    // Update the existing owner-dashboard page title only while Drivers is shown.
    function syncDashboardTitle() {
        if (!$('driversModule')) return;
        const root = $('driversModule');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (root.contains(node) || !node.parentElement) continue;
            if (node.textContent.trim().toUpperCase() === 'EKTA TRANSPORT - FLEET MANAGEMENT') {
                node.textContent = node.textContent.replace(/EKTA TRANSPORT - FLEET MANAGEMENT/i, 'EKTA TRANSPORT - DRIVERS MANAGEMENT');
                break;
            }
        }
    }

    /* =========================================================
       SECTION SWITCHING
       ========================================================= */

    function togglePanel(which, force, scroll) {
        const suffix = which === "assignment" ? "Assignment" : "Master";
        const panel = $("driverPanel" + suffix);
        const button = $("driverToggle" + suffix);
        const chevron = $("driverChevron" + suffix);
        if (!panel || !button) return;
        const open = typeof force === "boolean" ? force : !panel.classList.contains("is-open");
        panel.classList.toggle("is-open", open);
        panel.setAttribute("aria-hidden", String(!open));
        button.setAttribute("aria-expanded", String(open));
        if (chevron) chevron.classList.toggle("driver-chevron-open", open);
        if (open && scroll) button.scrollIntoView({behavior:"smooth",block:"nearest"});
    }

    function switchSection(section) {
        const validSections = ["master", "assignment", "history", "reports"];

        if (!validSections.includes(section)) {
            section = "master";
        }

        currentSection = section;

        document.querySelectorAll("#driversModule .driver-section").forEach(function (element) {
            element.classList.add("hidden");
        });

        const sectionMap = {
            master: "driverSectionMaster",
            assignment: "driverSectionAssignment",
            history: "driverSectionHistory",
            reports: "driverSectionReports"
        };

        const target = $(sectionMap[section]);

        if (target) {
            target.classList.remove("hidden");
        }

        document.querySelectorAll("#driversModule .driver-section-card").forEach(function (card) {
            const active = card.getAttribute("data-driver-section") === section;

            card.classList.toggle("border-blue-500", active);
            card.classList.toggle("border-slate-200", !active);

            if (!active) {
                card.classList.remove("border-emerald-500", "border-purple-500", "border-amber-500");
            }
        });

        if (section === "assignment") {
            populateAssignmentSelectors();
        }

        if (section === "history") {
            renderHistory();
        }

        if (section === "reports") {
            renderReport();
        }
    }

    /* =========================================================
       KEYBOARD NAVIGATION
       ========================================================= */

    function setupKeyboard() {
        const root = $("driversModule");
        if (!root) return;

        root.addEventListener("keydown", function (event) {

            const tag = event.target && event.target.tagName
                ? event.target.tagName.toLowerCase()
                : "";

            const isInput =
                tag === "input" ||
                tag === "select" ||
                tag === "textarea";

            /*
             * Alt + ArrowLeft / Alt + ArrowRight:
             * move between Driver module sections.
             */
            if (event.altKey && event.key === "ArrowRight") {
                event.preventDefault();

                const sections = ["master", "assignment", "history", "reports"];
                const index = sections.indexOf(currentSection);
                const next = sections[(index + 1) % sections.length];

                switchSection(next);
                return;
            }

            if (event.altKey && event.key === "ArrowLeft") {
                event.preventDefault();

                const sections = ["master", "assignment", "history", "reports"];
                const index = sections.indexOf(currentSection);
                const previous = sections[
                    (index - 1 + sections.length) % sections.length
                ];

                switchSection(previous);
                return;
            }

            /*
             * Enter navigation is handled by formKey on the inputs.
             * Do not override Enter in search boxes.
             */
            if (event.key === "Enter" && isInput) {
                const id = event.target.id || "";

                if (
                    id === "driverSearch" ||
                    id === "driverStatusFilter" ||
                    id === "historySearch" ||
                    id === "historyStatusFilter"
                ) {
                    return;
                }
            }
        });
    }

   function formKey(event, nextId) {

    const target = event.target;

    if (!target) return;

    const tag = target.tagName
        ? target.tagName.toLowerCase()
        : "";

    const isField =
        tag === "input" ||
        tag === "select" ||
        tag === "textarea";

    if (!isField) return;

    /*
     * Search boxes और file inputs में keyboard navigation
     * interfere नहीं करेगा.
     */
    if (
        target.id === "driverSearch" ||
        target.id === "historySearch" ||
        target.type === "file"
    ) {
        return;
    }

    /*
     * ENTER
     * अगले predefined field पर जाए.
     */
    if (event.key === "Enter") {

        event.preventDefault();

        const next = $(nextId);

        if (next) {
            next.focus();
        }

        return;
    }

    /*
     * Arrow Navigation
     *
     * ↑ ↓ ← →
     * form के visible fields के बीच move करेगा.
     */
    const arrowKeys = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight"
    ];

    if (!arrowKeys.includes(event.key)) {
        return;
    }

    const form = target.closest("form");

    if (!form) return;

    /*
     * Text input में Left / Right arrow को normal cursor
     * movement की तरह काम करने दें जब cursor बीच में हो.
     */
    if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        target.tagName.toLowerCase() === "input" &&
        target.type !== "date" &&
        target.type !== "tel"
    ) {

        const value = target.value || "";
        const start = target.selectionStart;
        const end = target.selectionEnd;

        if (event.key === "ArrowLeft" && start > 0 && start === end) {
            return;
        }

        if (
            event.key === "ArrowRight" &&
            end < value.length &&
            start === end
        ) {
            return;
        }
    }

    /*
     * केवल usable form fields.
     */
    const fields = Array.from(
        form.querySelectorAll(
            "input:not([type='hidden']):not([type='file']), select, textarea"
        )
    ).filter(function (el) {

        if (el.disabled) return false;
        if (el.offsetParent === null) return false;

        if (
            el.id === "driverSearch" ||
            el.id === "historySearch"
        ) {
            return false;
        }

        return true;
    });

    const currentIndex = fields.indexOf(target);

    if (currentIndex === -1) return;

    const currentRect = target.getBoundingClientRect();

    const currentX =
        currentRect.left + currentRect.width / 2;

    const currentY =
        currentRect.top + currentRect.height / 2;

    let candidates = fields.filter(function (field) {
        return field !== target;
    });

    let nextField = null;

    /*
     * RIGHT
     */
    if (event.key === "ArrowRight") {

        candidates = candidates.filter(function (field) {

            const rect = field.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            return x > currentX &&
                   Math.abs(y - currentY) < Math.max(
                       currentRect.height * 1.5,
                       50
                   );
        });

        candidates.sort(function (a, b) {

            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();

            const ax = ra.left + ra.width / 2;
            const bx = rb.left + rb.width / 2;

            return ax - bx;
        });

        nextField = candidates[0] || null;
    }

    /*
     * LEFT
     */
    if (event.key === "ArrowLeft") {

        candidates = candidates.filter(function (field) {

            const rect = field.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            return x < currentX &&
                   Math.abs(y - currentY) < Math.max(
                       currentRect.height * 1.5,
                       50
                   );
        });

        candidates.sort(function (a, b) {

            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();

            const ax = ra.left + ra.width / 2;
            const bx = rb.left + rb.width / 2;

            return bx - ax;
        });

        nextField = candidates[0] || null;
    }

    /*
     * DOWN
     */
    if (event.key === "ArrowDown") {

        candidates = candidates.filter(function (field) {

            const rect = field.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            return y > currentY;
        });

        candidates.sort(function (a, b) {

            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();

            const ay = ra.top + ra.height / 2;
            const by = rb.top + rb.height / 2;

            const ax = ra.left + ra.width / 2;
            const bx = rb.left + rb.width / 2;

            const dy = ay - by;

            if (Math.abs(dy) > 20) {
                return dy;
            }

            return Math.abs(ax - currentX) -
                   Math.abs(bx - currentX);
        });

        nextField = candidates[0] || null;
    }

    /*
     * UP
     */
    if (event.key === "ArrowUp") {

        candidates = candidates.filter(function (field) {

            const rect = field.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            return y < currentY;
        });

        candidates.sort(function (a, b) {

            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();

            const ay = ra.top + ra.height / 2;
            const by = rb.top + rb.height / 2;

            const ax = ra.left + ra.width / 2;
            const bx = rb.left + rb.width / 2;

            const dy = by - ay;

            if (Math.abs(dy) > 20) {
                return dy;
            }

            return Math.abs(ax - currentX) -
                   Math.abs(bx - currentX);
        });

        nextField = candidates[0] || null;
    }

    if (nextField) {

        event.preventDefault();

        nextField.focus();

        /*
         * Text input हो तो cursor को end पर रखें.
         */
        if (
            nextField.tagName.toLowerCase() === "input" &&
            typeof nextField.setSelectionRange === "function"
        ) {
            try {
                const length = nextField.value.length;
                nextField.setSelectionRange(length, length);
            } catch (e) {}
        }
    }
}

    /* =========================================================
       LOAD DATA
       ========================================================= */

    async function loadDrivers() {
        if (!hasSupabase()) {
            throw new Error("Supabase client is not available.");
        }

        const result = await window.supabaseClient
            .from(DRIVER_TABLE)
            .select(
                "id,driver_code,name,phone,license_number,license_expiry,status,created_at,updated_at"
            )
            .order("created_at", { ascending: false });

        if (result.error) throw result.error;

        drivers = result.data || [];

        console.log(
            `[EKTA DRIVERS] ${drivers.length} drivers loaded from Supabase.`
        );
    }

    async function loadTrucks() {
        if (!hasSupabase()) {
            throw new Error("Supabase client is not available.");
        }

        const result = await window.supabaseClient
            .from(TRUCK_TABLE)
            .select("id,truck_number,vehicle_type,capacity_ton,owner_name,status")
            .order("truck_number", { ascending: true });

        if (result.error) throw result.error;

        trucks = result.data || [];

        console.log(
            `[EKTA DRIVERS] ${trucks.length} trucks loaded from Supabase.`
        );
    }

    async function loadAssignments() {
        if (!hasSupabase()) {
            throw new Error("Supabase client is not available.");
        }

        const result = await window.supabaseClient
            .from(ASSIGNMENT_TABLE)
            .select(
                "id,truck_id,driver_id,assigned_from,assigned_until,status,notes,created_at"
            )
            .order("created_at", { ascending: false });

        if (result.error) throw result.error;

        assignments = result.data || [];

        console.log(
            `[EKTA DRIVERS] ${assignments.length} assignments loaded from Supabase.`
        );
    }

    async function refresh() {
        syncDashboardTitle();
        if (!hasSupabase()) {
            console.error("[EKTA DRIVERS] Supabase client is not ready.");
            alert("Supabase connection is not available.");
            return;
        }

        try {
            await Promise.all([
                loadDrivers(),
                loadTrucks(),
                loadAssignments()
            ]);

            renderAll();
            fillNextDriverCode();
        } catch (error) {
            console.error("[EKTA DRIVERS] Load error:", error);

            alert(
                "Drivers data could not be loaded from Supabase.\n\n" +
                "Please check the browser console."
            );
        }
    }

    /* =========================================================
       DRIVER MASTER
       ========================================================= */

    const PROFILE_KEY = "ekta_driver_profile_meta_v1";
    const DRIVER_DOC_TABLE = "driver_documents";
    const DRIVER_DOC_BUCKET = "driver-documents";

    function loadProfileMeta(){ try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||"{}")}catch(e){return{}} }
    function saveProfileMeta(meta){localStorage.setItem(PROFILE_KEY,JSON.stringify(meta));}
    function readFileData(file){return new Promise((resolve,reject)=>{if(!file)return resolve(null);const r=new FileReader();r.onload=e=>resolve({name:file.name,data:e.target.result,type:file.type});r.onerror=reject;r.readAsDataURL(file);});}
    function getProfileMeta(id){return loadProfileMeta()[String(id)]||{};}

    function documentFileInput(type){
        const map={photo:"driverPhotoFile",driving_license:"driverLicenseFile",aadhaar:"driverAadhaarFile",pan:"driverPanFile",payment_qr:"driverQrFile"};
        return $(map[type]);
    }

    async function getDriverDocuments(driverId){
        if(!hasSupabase()) return [];
        const result=await window.supabaseClient.from(DRIVER_DOC_TABLE).select("id,driver_id,document_type,document_number,file_name,storage_path,issue_date,expiry_date,status,created_at,updated_at").eq("driver_id",driverId).order("created_at",{ascending:false});
        if(result.error) throw result.error;
        return result.data||[];
    }

    async function getDocumentSignedUrl(storagePath){
        if(!storagePath || !hasSupabase()) return "";
        const result=await window.supabaseClient.storage.from(DRIVER_DOC_BUCKET).createSignedUrl(storagePath,3600);
        if(result.error){console.warn("[EKTA DRIVERS] Signed URL error:",result.error);return "";}
        return result.data?.signedUrl||"";
    }

    async function uploadDriverDocument(driverId,type,file,extra={}){
        if(!file) return null;
        if(!hasSupabase()) throw new Error("Supabase client is not available.");
        const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
        const path=`${driverId}/${type}/${crypto.randomUUID()}-${safeName}`;
        const upload=await window.supabaseClient.storage.from(DRIVER_DOC_BUCKET).upload(path,file,{upsert:false,contentType:file.type||"application/octet-stream"});
        if(upload.error) throw upload.error;

        const existing=await window.supabaseClient.from(DRIVER_DOC_TABLE).select("id,storage_path").eq("driver_id",driverId).eq("document_type",type).order("created_at",{ascending:false}).limit(1);
        if(existing.error) throw existing.error;
        const old=existing.data?.[0]||null;

        const payload={driver_id:driverId,document_type:type,document_number:extra.documentNumber||null,file_name:file.name,storage_path:path,issue_date:extra.issueDate||null,expiry_date:extra.expiryDate||null,status:extra.status||"Active",updated_at:new Date().toISOString()};
        let dbResult;
        if(old){
            dbResult=await window.supabaseClient.from(DRIVER_DOC_TABLE).update(payload).eq("id",old.id).select().single();
        }else{
            dbResult=await window.supabaseClient.from(DRIVER_DOC_TABLE).insert(payload).select().single();
        }
        if(dbResult.error) throw dbResult.error;

        if(old?.storage_path && old.storage_path!==path){
            const removed=await window.supabaseClient.storage.from(DRIVER_DOC_BUCKET).remove([old.storage_path]);
            if(removed.error) console.warn("[EKTA DRIVERS] Old document cleanup warning:",removed.error);
        }
        return dbResult.data;
    }

    async function loadDriverDocumentUI(driverId){
        try{
            const docs=await getDriverDocuments(driverId);
            const byType={}; docs.forEach(d=>{if(!byType[d.document_type])byType[d.document_type]=d;});
            [
                ["driverPhotoPreview","photo"],
                ["driverQrPreview","payment_qr"],
                ["driverAadhaarStatus","aadhaar"],
                ["driverPanStatus","pan"],
                ["driverLicenseStatus","driving_license"]
            ].forEach(async pair=>{
                const d=byType[pair[1]];
                if(pair[0].includes("Preview")){
                    if(d){const url=await getDocumentSignedUrl(d.storage_path);renderRemotePreview(pair[0],url,d.file_name,pair[1]==="photo");}
                    else renderRemotePreview(pair[0],"","");
                }else updateDocStatus(pair[0],d);
            });
            return byType;
        }catch(error){console.warn("[EKTA DRIVERS] Document load warning:",error);return {}; }
    }

    async function saveDriverExtras(driverId){
        const meta=loadProfileMeta(),old=meta[String(driverId)]||{};
        meta[String(driverId)]={...old,referralName:$("driverReferralName")?.value?.trim()||old.referralName||"",referralPhone:$("driverReferralPhone")?.value?.trim()||old.referralPhone||""};
        saveProfileMeta(meta);
        const files=[
            ["photo",$("driverPhotoFile")?.files?.[0]],
            ["payment_qr",$("driverQrFile")?.files?.[0]],
            ["aadhaar",$("driverAadhaarFile")?.files?.[0]],
            ["pan",$("driverPanFile")?.files?.[0]],
            ["driving_license",$("driverLicenseFile")?.files?.[0]]
        ];
        const errors=[];
        for(const [type,file] of files){
            if(!file) continue;
            try{
                await uploadDriverDocument(driverId,type,file,{documentNumber:type==="driving_license"?$("driverLicense")?.value?.trim().toUpperCase():null,expiryDate:type==="driving_license"?$("driverLicenseExpiry")?.value||null:null});
            }catch(error){errors.push(`${type}: ${error.message||error}`);console.error(`[EKTA DRIVERS] ${type} upload error:`,error);}
        }
        if(errors.length) alert("Driver saved, but some document uploads failed:\n\n"+errors.join("\n"));
        await loadDriverDocumentUI(driverId);
    }

    async function saveDriver(event) {
        if (event) event.preventDefault();

        if (!hasSupabase()) {
            alert("Supabase connection is not available.");
            return;
        }

        const editId = $("editDriverId")?.value || "";

        const driverCode = ($("driverCode")?.value || "").trim().toUpperCase();
        const name = ($("driverName")?.value || "").trim();
        const phone = ($("driverPhone")?.value || "").trim();
        const licenseNumber = ($("driverLicense")?.value || "").trim().toUpperCase();
        const licenseExpiry = $("driverLicenseExpiry")?.value || null;
        const status = $("driverStatus")?.value || "Active";

        if (!driverCode || !name) {
            alert("Driver Code and Driver Name are required.");
            return;
        }

        if (phone && !/^\d{10}$/.test(phone)) {
            alert("Driver Phone Number must be exactly 10 digits.");
            $("driverPhone")?.focus();
            return;
        }

        const referralPhone = ($("driverReferralPhone")?.value || "").trim();
        if (referralPhone && !/^\d{10}$/.test(referralPhone)) {
            alert("Referral Contact must be exactly 10 digits.");
            $("driverReferralPhone")?.focus();
            return;
        }

        const duplicate = drivers.find(function (driver) {
            return (
                String(driver.driver_code || "").toUpperCase() === driverCode &&
                String(driver.id) !== String(editId)
            );
        });

        if (duplicate) {
            alert(`Driver Code ${driverCode} already exists.`);
            return;
        }

        // One mobile number can belong to only one driver.
        // While editing, the current driver's own number remains valid.
        if (phone) {
            const duplicatePhone = drivers.find(function (driver) {
                const existingPhone = String(driver.phone || "").replace(/\D/g, "").slice(-10);
                return (
                    existingPhone === phone &&
                    String(driver.id) !== String(editId)
                );
            });

            if (duplicatePhone) {
                alert(
                    `Mobile number ${phone} already exists for ` +
                    `${duplicatePhone.driver_code || "another driver"} - ${duplicatePhone.name || "Driver"}.`
                );
                $("driverPhone")?.focus();
                return;
            }
        }

        const payload = {
            driver_code: driverCode,
            name: name,
            phone: phone || null,
            license_number: licenseNumber || null,
            license_expiry: licenseExpiry || null,
            status: status
        };

        try {
            let result;

            if (editId) {
                result = await window.supabaseClient
                    .from(DRIVER_TABLE)
                    .update({
                        ...payload,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", editId)
                    .select()
                    .single();
            } else {
                result = await window.supabaseClient
                    .from(DRIVER_TABLE)
                    .insert(payload)
                    .select()
                    .single();
            }

            if (result.error) {
                throw result.error;
            }

            console.log(
                "[EKTA DRIVERS] Driver saved successfully:",
                result.data
            );

            alert(
                editId
                    ? `Driver ${driverCode} updated successfully.`
                    : `Driver ${driverCode} added successfully.`
            );

            await persistCurrentDriverExtras(result.data.id);
            await refresh();

        } catch (error) {
            console.error("[EKTA DRIVERS] Save driver error:", error);

            alert(
                "Driver could not be saved to Supabase.\n\n" +
                "Please check the browser console."
            );
        }
    }

    async function persistCurrentDriverExtras(driverId){
        if(!driverId)return;
        await saveDriverExtras(driverId);
        resetForm();
        togglePanel("master", false);
        togglePanel("master", false);
    }


    function editDriver(id) {
        const driver = findDriverById(id);

        if (!driver) {
            alert("Driver record not found.");
            return;
        }

        $("editDriverId").value = driver.id;
        $("driverCode").value = driver.driver_code || "";
        $("driverName").value = driver.name || "";
        $("driverPhone").value = driver.phone || "";
        $("driverLicense").value = driver.license_number || "";
        $("driverLicenseExpiry").value = driver.license_expiry || "";
        $("driverStatus").value = driver.status || "Active";

        const meta = getProfileMeta(driver.id);
        $("driverReferralName").value = meta.referralName || "";
        $("driverReferralPhone").value = meta.referralPhone || "";
        renderRemotePreview("driverPhotoPreview", "", "");
        renderRemotePreview("driverQrPreview", "", "");
        updateDocStatus("driverAadhaarStatus", null);
        updateDocStatus("driverPanStatus", null);
        updateDocStatus("driverLicenseStatus", null);
        loadDriverDocumentUI(driver.id);

        const title = $("driverFormTitle");
        if (title) {
            title.textContent = `Edit Driver - ${driver.driver_code || driver.name}`;
        }

        const saveBtn = $("driverSaveBtn");
        if (saveBtn) {
            saveBtn.innerHTML =
                '<i class="fa-solid fa-pen-to-square mr-1"></i> Update Driver';
        }

        switchSection("master");
        togglePanel("master", true, true);

        const form = $("driverMasterForm");
        if (form) {
            form.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }

        $("driverCode")?.focus();
    }

    async function deleteDriver(id) {
        const driver = findDriverById(id);

        if (!driver) {
            alert("Driver record not found.");
            return;
        }

        const linkedAssignments = assignments.filter(function (assignment) {
            return String(assignment.driver_id) === String(driver.id);
        });

        if (linkedAssignments.length > 0) {
            alert(
                `Driver ${driver.driver_code || driver.name} has ${linkedAssignments.length} assignment record(s).\n\n` +
                `For data safety, the driver is not deleted. You can mark the driver Inactive instead.`
            );
            return;
        }

        if (
            !confirm(
                `Delete driver ${driver.driver_code || driver.name}?`
            )
        ) {
            return;
        }

        try {
            const result = await window.supabaseClient
                .from(DRIVER_TABLE)
                .delete()
                .eq("id", driver.id);

            if (result.error) {
                throw result.error;
            }

            alert(
                `Driver ${driver.driver_code || driver.name} deleted successfully.`
            );

            await refresh();

        } catch (error) {
            console.error("[EKTA DRIVERS] Delete driver error:", error);

            alert(
                "Driver could not be deleted from Supabase.\n\n" +
                "Please check the browser console."
            );
        }
    }

    function resetForm() {
        const form = $("driverMasterForm");

        if (form) {
            form.reset();
        }

        $("editDriverId").value = "";
        $("driverStatus").value = "Active";
        fillNextDriverCode();

        const title = $("driverFormTitle");
        if (title) {
            title.textContent = "Add New Driver";
        }

        const saveBtn = $("driverSaveBtn");
        if (saveBtn) {
            saveBtn.innerHTML =
                '<i class="fa-solid fa-floppy-disk mr-1"></i> Save Driver';
        }
        $("driverPhotoPreview").innerHTML=""; $("driverQrPreview").innerHTML="";
        $("driverAadhaarStatus").textContent="Not uploaded"; $("driverPanStatus").textContent="Not uploaded"; $("driverLicenseStatus").textContent="Not uploaded";
    }

    function renderFilePreview(id,obj){
        const el=$(id); if(!el)return;
        if(!obj?.data){el.innerHTML="";return;}
        el.innerHTML=`<img src="${esc(obj.data)}" class="w-12 h-12 rounded-full object-cover border border-blue-100">`;
    }

    function renderRemotePreview(id,url,name,circle=false){
        const el=$(id); if(!el)return;
        if(!url){el.innerHTML="";return;}
        el.innerHTML=`${circle?`<img src="${esc(url)}" class="w-12 h-12 rounded-full object-cover border border-blue-100">`:`<a href="${esc(url)}" target="_blank" rel="noopener" class="text-blue-600 font-semibold text-[10px]">View / Download</a>`}<span class="block text-[9px] text-slate-400 mt-1 truncate">${esc(name||"")}</span>`;
    }

    function updateDocStatus(id,obj){const el=$(id);if(!el)return;el.textContent=obj?.file_name?`Uploaded: ${obj.file_name}`:"Not uploaded";}

    function loadSavedPassword(driverId){
        try{return localStorage.getItem("ekta_driver_password_"+String(driverId))||"";}catch(e){return "";}
    }

   async function saveDriverPassword(driverId, password){
    if(!hasSupabase()){
        throw new Error("Supabase client is not available.");
    }

    const result = await window.supabaseClient.rpc(
        "set_driver_app_password",
        {
            p_driver_id: driverId,
            p_password: password
        }
    );

    if(result.error){
        throw result.error;
    }

    return true;
}

    function openPhotoPreview(url,name){
        if(!url)return;
        const old=$("driverPhotoLightbox"); if(old) old.remove();
        const box=document.createElement("div");
        box.id="driverPhotoLightbox";
        box.className="fixed inset-0 z-[10001] bg-black/70 flex items-center justify-center p-6";
        box.innerHTML=`<div class="relative max-w-[520px] max-h-[85vh]"><button type="button" class="absolute -right-3 -top-3 w-8 h-8 rounded-full bg-white text-slate-700 shadow-lg" onclick="this.closest('#driverPhotoLightbox').remove()"><i class="fa-solid fa-xmark"></i></button><img src="${esc(url)}" alt="${esc(name||'Driver Photo')}" class="max-w-full max-h-[80vh] rounded-2xl object-contain bg-white shadow-2xl"></div>`;
        box.addEventListener("click",function(e){if(e.target===box)box.remove();});
        document.body.appendChild(box);
    }

    async function openProfile(id){
        const d=findDriverById(id);if(!d)return;
        const m=getProfileMeta(id),a=getActiveAssignmentForDriver(id),initial=(d.name||"D").trim().charAt(0).toUpperCase();
        const content=$("driverProfileContent"); if(!content)return;
        const savedPassword=loadSavedPassword(id);
        content.innerHTML=`
        <div class="text-center border-b border-slate-200 pb-4">
            <button type="button" id="profilePhotoBox" class="mx-auto w-24 h-24 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center overflow-hidden border-2 border-blue-100 cursor-zoom-in" title="View larger photo">
                <span class="text-2xl font-black">${esc(initial)}</span>
            </button>
            <h2 class="mt-2 text-base font-black text-slate-800">${esc(d.name||"-")}</h2>
            <p class="text-[10px] text-slate-500 font-mono">${esc(d.driver_code||"-")} • ${esc(d.phone||"-")}</p>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div class="bg-slate-50 rounded p-2"><b>Mobile</b><div>${esc(d.phone||"-")}</div></div>
            <div class="bg-slate-50 rounded p-2"><b>Status</b><div>${statusBadge(d.status)}</div></div>
            <div class="bg-slate-50 rounded p-2"><b>License</b><div>${esc(d.license_number||"-")}</div></div>
            <div class="bg-slate-50 rounded p-2"><b>License Expiry</b><div>${esc(d.license_expiry||"-")}</div></div>
            <div class="bg-slate-50 rounded p-2 col-span-2"><b>Assigned Truck</b><div>${esc(a?getTruckNumber(a.truck_id):"Not Assigned")}</div></div>
        </div>
        <div class="border rounded-lg p-3"><h4 class="font-bold text-slate-700 mb-2">Referral</h4><div class="text-[11px]">${esc(m.referralName||"-")} ${m.referralPhone?`• ${esc(m.referralPhone)}`:""}</div></div>
        <div class="border rounded-lg p-3 space-y-2"><h4 class="font-bold text-slate-700">Documents</h4>
            <div class="flex justify-between items-center"><span>Driving License</span><span id="profileLicenseDoc" class="text-[10px] text-slate-400">Loading...</span></div>
            <div class="flex justify-between items-center"><span>Aadhaar</span><span id="profileAadhaarDoc" class="text-[10px] text-slate-400">Loading...</span></div>
            <div class="flex justify-between items-center"><span>PAN</span><span id="profilePanDoc" class="text-[10px] text-slate-400">Loading...</span></div>
        </div>
        <div class="border rounded-lg p-3 text-center"><h4 class="font-bold text-slate-700 mb-2">Payment QR</h4><div id="profileQrDoc"><span class="text-[10px] text-slate-400">Loading...</span></div></div>
        <div class="border border-blue-100 rounded-lg p-3 bg-blue-50/40">
            <div class="flex items-center justify-between mb-3"><h4 class="font-bold text-slate-700"><i class="fa-solid fa-mobile-screen-button mr-1 text-blue-600"></i>Driver App Login</h4><span class="text-[9px] font-bold text-slate-400">PRIVATE</span></div>
            <label class="block text-[10px] font-bold text-slate-600 mb-1">User ID (Mobile Number)</label>
            <input id="driverLoginUserId" value="${esc(d.phone||"")}" readonly class="w-full h-9 px-3 rounded-md border border-slate-200 bg-slate-100 text-xs font-mono text-slate-700 mb-3">
            <label class="block text-[10px] font-bold text-slate-600 mb-1">Create Password</label>
            <input id="driverLoginPassword" type="password" placeholder="Enter password" value="" class="w-full h-9 px-3 rounded-md border border-slate-200 bg-white text-xs">
            <div class="flex items-center justify-between mt-2"><span id="driverPasswordStatus" class="text-[9px] ${savedPassword?'text-emerald-600':'text-slate-400'}">${savedPassword?'Password created':'No password created'}</span><button type="button" id="saveDriverPasswordBtn" class="px-3 py-1.5 rounded-md bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700">Save Password</button></div>
        </div>`;
        $("driverProfileDrawer").classList.remove("hidden");

        const photoBox=$("profilePhotoBox");
        if(photoBox){
            photoBox.addEventListener("click",function(){
                const img=photoBox.querySelector("img"); if(img?.src)openPhotoPreview(img.src,d.name);
            });
        }
       const passBtn=$("saveDriverPasswordBtn");

if(passBtn)passBtn.addEventListener("click", async function(){
    const password=$("driverLoginPassword")?.value||"";

    if(password.length<4){
        alert("Password must be at least 4 characters.");
        return;
    }

    try{
        passBtn.disabled=true;

        await saveDriverPassword(id,password);

        const st=$("driverPasswordStatus");
        if(st){
            st.textContent="Password created";
            st.className="status-badge ok";
        }

        $("driverLoginPassword").value="";
        alert("Driver App password saved.");

    }catch(e){
        console.error("Driver password save failed:",e);
        alert("Password could not be saved: "+(e?.message||"Unknown error"));
    }finally{
        passBtn.disabled=false;
    }
});
        try{
            const docs=await getDriverDocuments(id),byType={};docs.forEach(x=>{if(!byType[x.document_type])byType[x.document_type]=x;});
            const photo=byType.photo?await getDocumentSignedUrl(byType.photo.storage_path):"";
            if(photo && $("profilePhotoBox")){
                $("profilePhotoBox").innerHTML=`<img src="${esc(photo)}" class="w-full h-full object-cover" alt="${esc(d.name||'Driver')}">`;
                $("profilePhotoBox").onclick=function(){openPhotoPreview(photo,d.name);};
            }
            const putLink=async(idEl,doc)=>{const el=$(idEl);if(!el)return;if(!doc){el.textContent="Not uploaded";return;}const url=await getDocumentSignedUrl(doc.storage_path);el.innerHTML=url?`<a href="${esc(url)}" target="_blank" rel="noopener" class="text-blue-600 font-semibold">View / Download</a>`:`Unavailable`;};
            await putLink("profileLicenseDoc",byType.driving_license);await putLink("profileAadhaarDoc",byType.aadhaar);await putLink("profilePanDoc",byType.pan);
            const qr=byType.payment_qr?await getDocumentSignedUrl(byType.payment_qr.storage_path):"";
            $("profileQrDoc").innerHTML=qr?`<img src="${esc(qr)}" class="w-40 h-40 object-contain border rounded-md mx-auto"><a href="${esc(qr)}" target="_blank" rel="noopener" class="block mt-2 text-blue-600 font-semibold text-[10px]">Open QR</a>`:`<span class="text-[10px] text-slate-400">QR not uploaded</span>`;
        }catch(error){console.error("[EKTA DRIVERS] Profile documents error:",error);}
    }
    function closeProfile(){$("driverProfileDrawer")?.classList.add("hidden");}

    function renderDriverTable() {
        const body = $("driverTableBody");
        if (!body) return;

        const search = (
            $("driverSearch")?.value || ""
        ).trim().toLowerCase();

        const statusFilter =
            $("driverStatusFilter")?.value || "";

        const filtered = drivers.filter(function (driver) {

            const searchable = [
                driver.driver_code,
                driver.name,
                driver.phone,
                driver.license_number
            ]
                .join(" ")
                .toLowerCase();

            const matchesSearch =
                !search || searchable.includes(search);

            const matchesStatus =
                !statusFilter ||
                String(driver.status || "") === statusFilter;

            return matchesSearch && matchesStatus;
        });

        if (filtered.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="9" class="py-8 text-center text-slate-400">
                        <i class="fa-solid fa-id-card text-2xl mb-2"></i>
                        <div class="font-bold">No driver records found.</div>
                        <div class="text-[10px] mt-1">
                            Add a driver above or change the search/filter.
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML = filtered.map(function (driver, index) {

            const assignment =
                getActiveAssignmentForDriver(driver.id);
                const driverIsActive =
    String(driver.status || "").toLowerCase() === "active";

const displayStatus =
    !driverIsActive
        ? "Inactive"
        : assignment
            ? "Active – Assigned"
            : "Active – Not Assigned";
            

                

            const truckNumber =
                assignment
                    ? getTruckNumber(assignment.truck_id)
                    : "-";

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-2.5 px-3 text-center font-mono">
                        ${index + 1}
                    </td>

                    <td class="py-2.5 px-3 font-mono font-bold text-blue-700">
                        ${esc(driver.driver_code || "-")}
                    </td>

                    <td class="py-2.5 px-3 font-bold text-slate-800">
                        <button type="button" class="inline-flex items-center gap-2 text-left group" onclick="window.EktaDrivers.openProfile('${esc(driver.id)}')" title="Open Driver Profile">
                            <span id="driverAvatar_${esc(driver.id)}" class="w-7 h-7 rounded-full bg-blue-50 text-blue-600 border border-blue-100 inline-flex items-center justify-center overflow-hidden shrink-0">
                                <span class="text-[11px] font-black">${esc((driver.name||"D").trim().charAt(0).toUpperCase())}</span>
                            </span>
                            <span class="group-hover:text-blue-700">${esc(driver.name || "-")}</span>
                        </button>
                    </td>

                    <td class="py-2.5 px-3 font-mono">
                        ${esc(driver.phone || "-")}
                    </td>

                    <td class="py-2.5 px-3 font-mono">
                        ${esc(driver.license_number || "-")}
                    </td>

                    <td class="py-2.5 px-3 font-mono">
                        ${formatDate(driver.license_expiry)}
                    </td>

                    <td class="py-2.5 px-3 font-mono font-bold text-emerald-700">
                        ${esc(truckNumber)}
                    </td>

                    <td class="py-2.5 px-3">
                        ${statusBadge(displayStatus)}
                    </td>

                    <td class="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                            type="button"
                            onclick="window.EktaDrivers.editDriver('${esc(driver.id)}')"
                            class="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-600 hover:text-white mr-1"
                            title="Edit Driver"
                        >
                            <i class="fa-solid fa-pen-to-square text-[9px]"></i>
                        </button>

                        <button
                            type="button"
                            onclick="window.EktaDrivers.switchSection('assignment'); window.EktaDrivers.focusAssignmentForDriver('${esc(driver.id)}')"
                            class="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-600 hover:text-white mr-1"
                            title="Assign Truck"
                        >
                            <i class="fa-solid fa-link text-[9px]"></i>
                        </button>

                        <button
                            type="button"
                            onclick="window.EktaDrivers.openProfile('${esc(driver.id)}')"
                            class="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-600 hover:text-white mr-1"
                            title="View Driver Profile"
                        >
                            <i class="fa-solid fa-eye text-[9px]"></i>
                        </button>

                        <button
                            type="button"
                            onclick="window.EktaDrivers.deleteDriver('${esc(driver.id)}')"
                            class="px-1.5 py-0.5 bg-red-50 text-red-600 rounded hover:bg-red-600 hover:text-white"
                            title="Delete Driver"
                        >
                            <i class="fa-solid fa-trash-can text-[9px]"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        // Load small remote avatars without blocking the main table render.
        filtered.forEach(async function(driver){
            try{
                const docs=await getDriverDocuments(driver.id);
                const photo=docs.find(function(x){return x.document_type==="photo";});
                if(!photo)return;
                const url=await getDocumentSignedUrl(photo.storage_path);
                const avatar=$("driverAvatar_"+driver.id);
               if(url && avatar){

    avatar.innerHTML =
        `<img src="${esc(url)}"
              class="w-full h-full object-cover"
              alt="${esc(driver.name || 'Driver')}">`;

    /*
     * Driver list avatar:
     * सिर्फ Profile Drawer खोलना है.
     *
     * बड़ा Photo Preview केवल Drawer के अंदर
     * बड़े photo पर click करने पर खुलेगा.
     */
    avatar.onclick = function(e){

        e.preventDefault();
        e.stopPropagation();

        openProfile(driver.id);
    };
}
            }catch(e){console.warn("[EKTA DRIVERS] Avatar load warning:",e);}
        });
    }
/* =========================================================
   SEARCHABLE TRUCK PICKER
   ========================================================= */

function getAvailableAssignmentTrucks() {

    const editId =
        $("editAssignmentId")?.value || "";

    const currentTruckId =
        $("assignmentTruck")?.value || "";

    return trucks
        .filter(function (truck) {

            const isActive =
                String(truck.status || "").toLowerCase() !== "inactive";

            if (!isActive) return false;

            /*
             * Existing active assignment check.
             */
            const activeAssignment =
                assignments.find(function (assignment) {

                    return (
                        String(assignment.truck_id) === String(truck.id) &&
                        String(assignment.status || "").toLowerCase() === "active" &&
                        String(assignment.id) !== String(editId)
                    );
                });

            /*
             * Current truck को edit के समय रहने दें.
             */
            if (
                currentTruckId &&
                String(truck.id) === String(currentTruckId)
            ) {
                return true;
            }

            /*
             * जिस truck पर active driver है,
             * वह नया assignment नहीं दिखेगा.
             */
            return !activeAssignment;
        })
        .sort(function (a, b) {

            return String(a.truck_number || "")
                .localeCompare(
                    String(b.truck_number || ""),
                    undefined,
                    {
                        numeric: true,
                        sensitivity: "base"
                    }
                );
        });
}


function openTruckPicker() {

    renderTruckPicker("");

    const dropdown = $("assignmentTruckDropdown");

    if (dropdown) {
        dropdown.classList.remove("hidden");
    }
}


function filterTruckPicker() {

    const input =
        $("assignmentTruckSearch");

    const dropdown =
        $("assignmentTruckDropdown");

    if (!input || !dropdown) return;

    renderTruckPicker(input.value);

    dropdown.classList.remove("hidden");
}


function renderTruckPicker(searchText) {

    const dropdown =
        $("assignmentTruckDropdown");

    if (!dropdown) return;

    const query =
        String(searchText || "")
            .trim()
            .toLowerCase();

    const available =
        getAvailableAssignmentTrucks();

    const filtered =
        available.filter(function (truck) {

            const number =
                String(truck.truck_number || "")
                    .toLowerCase();

            return !query || number.includes(query);
        });

    if (filtered.length === 0) {

        dropdown.innerHTML = `
            <div class="px-3 py-2 text-sm text-slate-400">
                No available truck found
            </div>
        `;

        return;
    }

    dropdown.innerHTML =
        filtered.map(function (truck, index) {

            return `
                <button
                    type="button"
                    class="truck-picker-item w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border-b border-slate-100 last:border-b-0"
                    data-truck-id="${esc(truck.id)}"
                    data-index="${index}"
                    onclick="window.EktaDrivers.selectTruck('${esc(truck.id)}')"
                >
                    ${esc(truck.truck_number)}
                </button>
            `;

        }).join("");
}


function selectTruck(truckId) {

    const truck =
        trucks.find(function (item) {

            return String(item.id) === String(truckId);

        });

    if (!truck) return;

    const hidden =
        $("assignmentTruck");

    const search =
        $("assignmentTruckSearch");

    const dropdown =
        $("assignmentTruckDropdown");

    if (hidden) {
        hidden.value = truck.id;
    }

    if (search) {
        search.value = truck.truck_number || "";
    }

    if (dropdown) {
        dropdown.classList.add("hidden");
    }

    /*
     * Next field.
     */
    $("assignedFrom")?.focus();
}


function truckPickerKey(event) {

    const dropdown =
        $("assignmentTruckDropdown");

    if (!dropdown) return;

    const items =
        Array.from(
            dropdown.querySelectorAll(".truck-picker-item")
        );

    if (!items.length) {

        if (event.key === "Escape") {
            dropdown.classList.add("hidden");
        }

        return;
    }

    let activeIndex =
        items.findIndex(function (item) {

            return item.classList.contains("bg-emerald-50");

        });

    if (event.key === "ArrowDown") {

        event.preventDefault();

        activeIndex =
            activeIndex < items.length - 1
                ? activeIndex + 1
                : 0;

        highlightTruckPickerItem(items, activeIndex);

        return;
    }

    if (event.key === "ArrowUp") {

        event.preventDefault();

        activeIndex =
            activeIndex > 0
                ? activeIndex - 1
                : items.length - 1;

        highlightTruckPickerItem(items, activeIndex);

        return;
    }

    if (event.key === "Enter") {

        event.preventDefault();

        const item =
            activeIndex >= 0
                ? items[activeIndex]
                : items[0];

        if (item) {
            selectTruck(item.getAttribute("data-truck-id"));
        }

        return;
    }

    if (event.key === "Escape") {

        event.preventDefault();

        dropdown.classList.add("hidden");
    }
}


function highlightTruckPickerItem(items, index) {

    items.forEach(function (item) {

        item.classList.remove(
            "bg-emerald-50",
            "text-emerald-700"
        );

    });

    const item = items[index];

    if (!item) return;

    item.classList.add(
        "bg-emerald-50",
        "text-emerald-700"
    );

    item.scrollIntoView({
        block: "nearest"
    });
}


function syncTruckPickerFromValue() {

    const hidden =
        $("assignmentTruck");

    const search =
        $("assignmentTruckSearch");

    if (!hidden || !search) return;

    const truck =
        trucks.find(function (item) {

            return String(item.id) === String(hidden.value);

        });

    search.value =
        truck
            ? truck.truck_number || ""
            : "";
}


function closeTruckPickerOutside(event) {

    const wrapper =
        $("assignmentTruckSearch")?.parentElement;

    const dropdown =
        $("assignmentTruckDropdown");

    if (!wrapper || !dropdown) return;

    if (!wrapper.contains(event.target)) {

        dropdown.classList.add("hidden");
    }
}
    /* =========================================================
       ASSIGNMENT
       ========================================================= */

    function populateAssignmentSelectors() {
        const driverSelect = $("assignmentDriver");
        const truckSelect = $("assignmentTruck");

        if (!driverSelect || !truckSelect) return;

        const currentDriver = driverSelect.value;
        const currentTruck = truckSelect.value;

        driverSelect.innerHTML =
            `<option value="">Select Driver</option>` +
            drivers
                .filter(function (driver) {
                    return String(driver.status || "").toLowerCase() === "active";
                })
                .map(function (driver) {
                    return `
                        <option value="${esc(driver.id)}">
                            ${esc(driver.name)} (${esc(driver.driver_code)})
                        </option>
                    `;
                })
                .join("");

       

        if (
            currentDriver &&
            drivers.some(function (driver) {
                return String(driver.id) === String(currentDriver);
            })
        ) {
            driverSelect.value = currentDriver;
        }

     syncTruckPickerFromValue();
    }

    function focusAssignmentForDriver(driverId) {
        switchSection("assignment");
        populateAssignmentSelectors();

        const driverSelect = $("assignmentDriver");

        if (driverSelect) {
            driverSelect.value = driverId;
            driverSelect.focus();
        }
    }

    async function saveAssignment(event) {
        if (event) event.preventDefault();

        if (!hasSupabase()) {
            alert("Supabase connection is not available.");
            return;
        }

        const editId =
            $("editAssignmentId")?.value || "";

        const driverId =
            $("assignmentDriver")?.value || "";

        const truckId =
            $("assignmentTruck")?.value || "";

        const assignedFrom =
            $("assignedFrom")?.value || "";

        const assignedUntil =
            $("assignedUntil")?.value || null;

        const status =
            $("assignmentStatus")?.value || "Active";

        const notes =
            ($("assignmentNotes")?.value || "").trim();

        if (!driverId || !truckId || !assignedFrom) {
            alert(
                "Driver, Truck and Assigned From are required."
            );
            return;
        }

        if (
            assignedUntil &&
            assignedUntil < assignedFrom
        ) {
            alert(
                "Assigned Until cannot be before Assigned From."
            );
            return;
        }

        /*
         * Safety rule:
         * One driver should not have two active assignments.
         */
        if (status === "Active") {

            const conflict =
                assignments.find(function (assignment) {
                    return (
                        String(assignment.driver_id) === String(driverId) &&
                        String(assignment.status || "").toLowerCase() === "active" &&
                        String(assignment.id) !== String(editId)
                    );
                });

            if (conflict) {
                alert(
                    "This driver already has an active truck assignment.\n\n" +
                    "Close the existing assignment first."
                );
                return;
            }

            const truckConflict =
                assignments.find(function (assignment) {
                    return (
                        String(assignment.truck_id) === String(truckId) &&
                        String(assignment.status || "").toLowerCase() === "active" &&
                        String(assignment.id) !== String(editId)
                    );
                });

            if (truckConflict) {
                alert(
                    "This truck already has an active driver assignment.\n\n" +
                    "Close the existing assignment first."
                );
                return;
            }
        }

        const payload = {
            truck_id: truckId,
            driver_id: driverId,
            assigned_from: assignedFrom,
            assigned_until: assignedUntil || null,
            status: status,
            notes: notes || null
        };

        try {

            let result;

            if (editId) {

                result = await window.supabaseClient
                    .from(ASSIGNMENT_TABLE)
                    .update(payload)
                    .eq("id", editId)
                    

            } else {

                result = await window.supabaseClient
                    .from(ASSIGNMENT_TABLE)
                    .insert(payload)
                    .select()
                    .single();
            }

            if (result.error) {
                throw result.error;
            }

            console.log(
                "[EKTA DRIVERS] Assignment saved successfully:",
                result.data
            );

            alert(
                editId
                    ? "Truck assignment updated successfully."
                    : "Truck assignment saved successfully."
            );

            resetAssignmentForm();
            togglePanel("assignment", false);
            await refresh();

            switchSection("assignment");

        } catch (error) {

            console.error(
                "[EKTA DRIVERS] Assignment save error:",
                error
            );

            alert(
                "Truck assignment could not be saved.\n\n" +
                "Please check the browser console."
            );
        }
    }

    function editAssignment(id) {
        const assignment =
            assignments.find(function (item) {
                return String(item.id) === String(id);
            });

        if (!assignment) {
            alert("Assignment record not found.");
            return;
        }

        switchSection("assignment");
        populateAssignmentSelectors();

        $("editAssignmentId").value = assignment.id;
        $("assignmentDriver").value = assignment.driver_id;
        $("assignmentTruck").value = assignment.truck_id;
        syncTruckPickerFromValue();
        $("assignedFrom").value = assignment.assigned_from || "";
        $("assignedUntil").value = assignment.assigned_until || "";
        $("assignmentStatus").value = assignment.status || "Active";
        $("assignmentNotes").value = assignment.notes || "";

        togglePanel("assignment", true, true);
        $("assignedFrom")?.focus();

        const saveBtn = $("assignmentSaveBtn");
        if (saveBtn) {
            saveBtn.innerHTML =
                '<i class="fa-solid fa-pen-to-square mr-1"></i> Update Assignment';
        }
    }

    async function deleteAssignment(id) {
        const assignment =
            assignments.find(function (item) {
                return String(item.id) === String(id);
            });

        if (!assignment) {
            alert("Assignment record not found.");
            return;
        }

        const driverName =
            getDriverName(assignment.driver_id);

        const truckNumber =
            getTruckNumber(assignment.truck_id);

        if (
            !confirm(
                `Delete assignment?\n\nDriver: ${driverName}\nTruck: ${truckNumber}`
            )
        ) {
            return;
        }

        try {

            const result =
                await window.supabaseClient
                    .from(ASSIGNMENT_TABLE)
                    .delete()
                    .eq("id", assignment.id);

            if (result.error) {
                throw result.error;
            }

            alert("Assignment deleted successfully.");

            await refresh();

            switchSection("assignment");

        } catch (error) {

            console.error(
                "[EKTA DRIVERS] Delete assignment error:",
                error
            );

            alert(
                "Assignment could not be deleted from Supabase.\n\n" +
                "Please check the browser console."
            );
        }
    }

    function resetAssignmentForm() {
        const form = $("driverAssignmentForm");

        if (form) {
            form.reset();
        }

        $("editAssignmentId").value = "";
        $("assignedFrom").value = todayISO();
        $("assignmentStatus").value = "Active";

        const saveBtn = $("assignmentSaveBtn");

        if (saveBtn) {
            saveBtn.innerHTML =
                '<i class="fa-solid fa-link mr-1"></i> Save Assignment';
        }

        populateAssignmentSelectors();
    }

    function renderAssignments() {
        const body = $("assignmentTableBody");

        if (!body) return;

        const current =
            assignments.filter(function (assignment) {
                return String(assignment.status || "").toLowerCase() === "active";
            });

        if (current.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="8" class="py-8 text-center text-slate-400">
                        <i class="fa-solid fa-link-slash text-2xl mb-2"></i>
                        <div class="font-bold">No active driver assignments.</div>
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML = current.map(function (assignment, index) {

            return `
                <tr class="hover:bg-slate-50 transition">

                    <td class="py-2.5 px-3 font-mono">
                        ${index + 1}
                    </td>

                    <td class="py-2.5 px-3 font-bold">
                        ${esc(getDriverName(assignment.driver_id))}
                    </td>

                    <td class="py-2.5 px-3 font-mono font-bold text-emerald-700">
                        ${esc(getTruckNumber(assignment.truck_id))}
                    </td>

                    <td class="py-2.5 px-3 font-mono">
                        ${formatDate(assignment.assigned_from)}
                    </td>

                    <td class="py-2.5 px-3 font-mono">
                        ${formatDate(assignment.assigned_until)}
                    </td>

                    <td class="py-2.5 px-3">
                        ${statusBadge(assignment.status)}
                    </td>

                    <td class="py-2.5 px-3">
                        ${esc(assignment.notes || "-")}
                    </td>

                    <td class="py-2.5 px-3 text-right whitespace-nowrap">

                        <button
                            type="button"
                            onclick="window.EktaDrivers.editAssignment('${esc(assignment.id)}')"
                            class="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-600 hover:text-white mr-1"
                            title="Edit Assignment"
                        >
                            <i class="fa-solid fa-pen-to-square text-[9px]"></i>
                        </button>

                        <button
                            type="button"
                            onclick="window.EktaDrivers.deleteAssignment('${esc(assignment.id)}')"
                            class="px-1.5 py-0.5 bg-red-50 text-red-600 rounded hover:bg-red-600 hover:text-white"
                            title="Delete Assignment"
                        >
                            <i class="fa-solid fa-trash-can text-[9px]"></i>
                        </button>

                    </td>
                </tr>
            `;
        }).join("");
    }

    function renderHistory() {
        const body = $("historyTableBody");

        if (!body) return;

        const search =
            ($("historySearch")?.value || "")
                .trim()
                .toLowerCase();

        const statusFilter =
            $("historyStatusFilter")?.value || "";

        const filtered =
            assignments.filter(function (assignment) {

                const driverName =
                    getDriverName(assignment.driver_id);

                const truckNumber =
                    getTruckNumber(assignment.truck_id);

                const searchable =
                    `${driverName} ${truckNumber} ${assignment.notes || ""}`
                        .toLowerCase();

                const matchesSearch =
                    !search ||
                    searchable.includes(search);

                const matchesStatus =
                    !statusFilter ||
                    String(assignment.status || "") === statusFilter;

                return matchesSearch && matchesStatus;
            });

        if (filtered.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="8" class="py-8 text-center text-slate-400">
                        No assignment history found.
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML =
            filtered.map(function (assignment, index) {

                return `
                    <tr class="hover:bg-slate-50 transition">

                        <td class="py-2.5 px-3 font-mono">
                            ${index + 1}
                        </td>

                        <td class="py-2.5 px-3 font-bold">
                            ${esc(getDriverName(assignment.driver_id))}
                        </td>

                        <td class="py-2.5 px-3 font-mono font-bold">
                            ${esc(getTruckNumber(assignment.truck_id))}
                        </td>

                        <td class="py-2.5 px-3 font-mono">
                            ${formatDate(assignment.assigned_from)}
                        </td>

                        <td class="py-2.5 px-3 font-mono">
                            ${formatDate(assignment.assigned_until)}
                        </td>

                        <td class="py-2.5 px-3">
                            ${statusBadge(assignment.status)}
                        </td>

                        <td class="py-2.5 px-3">
                            ${esc(assignment.notes || "-")}
                        </td>

                        <td class="py-2.5 px-3 text-[10px] text-slate-500">
                            ${formatDateTime(assignment.created_at)}
                        </td>

                    </tr>
                `;
            }).join("");
    }

    /* =========================================================
       REPORT
       ========================================================= */

    let reportSuggestionIndex = -1;
    let reportMatches = [];

    function reportRows() {
        return drivers.map(function (driver) {
            const assignment = getActiveAssignmentForDriver(driver.id);
            const truckNumber = assignment ? getTruckNumber(assignment.truck_id) : "";
            return { driver: driver, truckNumber: String(truckNumber || "") };
        });
    }

    function reportQuery() {
        return String($("driverReportSearch")?.value || "").trim().toUpperCase().replace(/\s+/g, "");
    }

    function reportFilteredRows() {
        const query = reportQuery();
        if (!query) return reportRows();
        return reportRows().filter(function (row) {
            const driver = row.driver;
            const fields = [driver.name, driver.phone, driver.driver_code, row.truckNumber];
            return fields.some(function (field) {
                const raw = String(field || "").toUpperCase();
                return raw.includes(query) || raw.replace(/[^A-Z0-9]/g, "").includes(query.replace(/[^A-Z0-9]/g, ""));
            });
        });
    }

    function hideReportSuggestions() {
        const box = $("driverReportSuggestions");
        if (box) box.classList.add("hidden");
        reportSuggestionIndex = -1;
    }

    function reportSearchChanged() {
        const input = $("driverReportSearch");
        const box = $("driverReportSuggestions");
        const clear = $("driverReportSearchClear");
        if (!input || !box) return;
        const query = reportQuery();
        if (clear) clear.classList.toggle("hidden", !query);
        reportMatches = reportFilteredRows();
        reportSuggestionIndex = -1;
        renderReport();
        if (!query) { hideReportSuggestions(); return; }
        const suggestions = reportMatches.slice(0, 40);
        box.innerHTML = suggestions.length ? suggestions.map(function (row, index) {
            return `<button type="button" role="option" data-report-index="${index}" aria-selected="false"
                class="driver-report-option w-full text-left px-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none flex items-center justify-between gap-3">
                <span class="min-w-0"><span class="block font-bold text-slate-800 text-xs truncate">${esc(row.driver.name || "-")}</span>
                <span class="block text-[10px] text-slate-500">${esc(row.driver.driver_code || "-")} · ${esc(row.driver.phone || "-")}</span></span>
                <span class="font-mono text-[11px] text-blue-700 font-bold shrink-0">${esc(row.truckNumber || "No Truck")}</span>
            </button>`;
        }).join("") : '<div class="p-3 text-xs text-slate-500">No matching driver or truck found.</div>';
        box.classList.remove("hidden");
    }

    function selectReportSuggestion(index) {
        const row = reportMatches[index];
        if (!row) return;
        const input = $("driverReportSearch");
        if (input) input.value = row.truckNumber || row.driver.name || row.driver.driver_code || "";
        hideReportSuggestions();
        renderReport();
    }

    function reportSearchKey(event) {
        const box = $("driverReportSuggestions");
        if (!box || box.classList.contains("hidden")) {
            if (event.key === "Escape") hideReportSuggestions();
            return;
        }
        const options = box.querySelectorAll("[data-report-index]");
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            reportSuggestionIndex = event.key === "ArrowDown"
                ? Math.min(reportSuggestionIndex + 1, options.length - 1)
                : Math.max(reportSuggestionIndex - 1, 0);
            options.forEach(function (option, index) {
                option.classList.toggle("bg-blue-100", index === reportSuggestionIndex);
                option.setAttribute("aria-selected", String(index === reportSuggestionIndex));
            });
            options[reportSuggestionIndex]?.scrollIntoView({block:"nearest"});
        } else if (event.key === "Enter" && options.length) {
            event.preventDefault();
            selectReportSuggestion(reportSuggestionIndex >= 0 ? reportSuggestionIndex : 0);
        } else if (event.key === "Escape") {
            event.preventDefault(); hideReportSuggestions();
        }
    }

    function clearReportSearch() {
        const input = $("driverReportSearch");
        if (input) { input.value = ""; input.focus(); }
        reportSearchChanged();
    }

    document.addEventListener("click", function (event) {
        const wrap = $("driverReportSearchWrap");
        if (!wrap) return;
        const option = event.target.closest("[data-report-index]");
        if (option && wrap.contains(option)) {
            selectReportSuggestion(Number(option.dataset.reportIndex));
        } else if (!wrap.contains(event.target)) hideReportSuggestions();
    });

    function renderReport() {
        const total =
            drivers.length;

        const active =
            drivers.filter(function (driver) {
                return String(driver.status || "").toLowerCase() === "active";
            }).length;

        const assignedDriverIds =
            new Set(
                assignments
                    .filter(function (assignment) {
                        return String(assignment.status || "").toLowerCase() === "active";
                    })
                    .map(function (assignment) {
                        return String(assignment.driver_id);
                    })
            );

        if ($("reportTotalDrivers")) {
            $("reportTotalDrivers").textContent = total;
        }

        if ($("reportActiveDrivers")) {
            $("reportActiveDrivers").textContent = active;
        }

        if ($("reportAssignedDrivers")) {
            $("reportAssignedDrivers").textContent =
                assignedDriverIds.size;
        }

        const body = $("reportTableBody");

        if (!body) return;

        const filteredReportRows = reportFilteredRows();
        const reportCount = $("driverReportSearchCount");
        if (reportCount) reportCount.textContent = reportQuery() ? `${filteredReportRows.length} matching driver(s)` : `${drivers.length} drivers`;

        if (filteredReportRows.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="6" class="py-8 text-center text-slate-400">
                        ${reportQuery() ? "No matching drivers found." : "No driver records available."}
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML =
            filteredReportRows.map(function (row, index) {
                const driver = row.driver;
                const truckNumber = row.truckNumber;
                return `
                    <tr class="hover:bg-slate-50 transition">

                        <td class="py-2.5 px-3">
                            ${index + 1}
                        </td>

                        <td class="py-2.5 px-3 font-mono font-bold text-blue-700">
                            ${esc(driver.driver_code || "-")}
                        </td>

                        <td class="py-2.5 px-3 font-bold">
                            ${esc(driver.name || "-")}
                        </td>

                        <td class="py-2.5 px-3 font-mono">
                            ${esc(driver.phone || "-")}
                        </td>

                        <td class="py-2.5 px-3">
                            ${statusBadge(driver.status)}
                        </td>

                        <td class="py-2.5 px-3 font-mono font-bold text-emerald-700">
                            ${esc(
                                truckNumber || "-"
                            )}
                        </td>

                    </tr>
                `;
            }).join("");
    }

    function printReport() {
        const report =
            $("driverSectionReports");

        if (!report) return;

        const printWindow =
            window.open(
                "",
                "_blank",
                "noopener,noreferrer"
            );

        if (!printWindow) {
            alert("Please allow pop-ups to print the report.");
            return;
        }

        printWindow.document.write(`
            <html>
            <head>
                <title>Ekta Transport - Driver Report</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        padding: 24px;
                        color: #111827;
                    }
                    h1 { margin-bottom: 4px; }
                    p { color: #64748b; }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    th, td {
                        border: 1px solid #cbd5e1;
                        padding: 8px;
                        text-align: left;
                        font-size: 12px;
                    }
                    th {
                        background: #f1f5f9;
                    }
                    .stats {
                        display: flex;
                        gap: 20px;
                        margin-top: 20px;
                    }
                    .stat {
                        border: 1px solid #cbd5e1;
                        padding: 12px;
                        min-width: 140px;
                    }
                    .label {
                        font-size: 10px;
                        color: #64748b;
                    }
                    .value {
                        font-size: 20px;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <h1>Ekta Transport - Driver Summary</h1>
                <p>Generated: ${esc(new Date().toLocaleString("en-IN"))}</p>

                <div class="stats">
                    <div class="stat">
                        <div class="label">TOTAL DRIVERS</div>
                        <div class="value">${drivers.length}</div>
                    </div>

                    <div class="stat">
                        <div class="label">ACTIVE DRIVERS</div>
                        <div class="value">
                            ${
                                drivers.filter(function (driver) {
                                    return String(driver.status || "").toLowerCase() === "active";
                                }).length
                            }
                        </div>
                    </div>

                    <div class="stat">
                        <div class="label">ASSIGNED DRIVERS</div>
                        <div class="value">
                            ${
                                new Set(
                                    assignments
                                        .filter(function (assignment) {
                                            return String(assignment.status || "").toLowerCase() === "active";
                                        })
                                        .map(function (assignment) {
                                            return String(assignment.driver_id);
                                        })
                                ).size
                            }
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>S.No</th>
                            <th>Driver Code</th>
                            <th>Driver</th>
                            <th>Phone</th>
                            <th>License</th>
                            <th>Status</th>
                            <th>Current Truck</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${
                            drivers.map(function (driver, index) {

                                const assignment =
                                    getActiveAssignmentForDriver(driver.id);

                                return `
                                    <tr>
                                        <td>${index + 1}</td>
                                        <td>${esc(driver.driver_code || "-")}</td>
                                        <td>${esc(driver.name || "-")}</td>
                                        <td>${esc(driver.phone || "-")}</td>
                                        <td>${esc(driver.license_number || "-")}</td>
                                        <td>${esc(driver.status || "-")}</td>
                                        <td>
                                            ${
                                                assignment
                                                    ? esc(getTruckNumber(assignment.truck_id))
                                                    : "-"
                                            }
                                        </td>
                                    </tr>
                                `;
                            }).join("")
                        }
                    </tbody>
                </table>
            </body>
            </html>
        `);

        printWindow.document.close();

        setTimeout(function () {
            printWindow.print();
        }, 250);
    }

    /* =========================================================
       SUMMARY + RENDER
       ========================================================= */

    function updateSummaries() {

        const total =
            drivers.length;

        const assigned =
            new Set(
                assignments
                    .filter(function (assignment) {
                        return String(assignment.status || "").toLowerCase() === "active";
                    })
                    .map(function (assignment) {
                        return String(assignment.driver_id);
                    })
            ).size;

        if ($("driversTotalSummary")) {
            $("driversTotalSummary").textContent =
                `${total} Driver${total === 1 ? "" : "s"}`;
        }

        if ($("driversAssignedSummary")) {
            $("driversAssignedSummary").textContent =
                `${assigned} Assigned`;
        }

        if ($("driversHistorySummary")) {
            $("driversHistorySummary").textContent =
                `${assignments.length} Records`;
        }

        if ($("driversReportSummary")) {
            $("driversReportSummary").textContent =
                `${drivers.filter(function (driver) {
                    return String(driver.status || "").toLowerCase() === "active";
                }).length} Active`;
        }
    }

    function renderAll() {
        renderDriverTable();
        renderAssignments();
        renderHistory();
        renderReport();
        updateSummaries();
        populateAssignmentSelectors();
        switchSection(currentSection);
    }

    /* =========================================================
       INIT
       ========================================================= */

    async function init() {

        if (!$("driversModule")) {
            return;
        }

        syncDashboardTitle();
        setupKeyboard();

        if ($("assignedFrom")) {
            $("assignedFrom").value = todayISO();
        }

        switchSection("master");

        await refresh();
    }

    /*
     * =========================================================
     * PUBLIC API
     * =========================================================
     */

    window.EktaDrivers = {
        __initialized: true,

        init: init,
        refresh: refresh,

        togglePanel: togglePanel,
        switchSection: switchSection,
        formKey: formKey,
                openTruckPicker: openTruckPicker,
        filterTruckPicker: filterTruckPicker,
        truckPickerKey: truckPickerKey,
        selectTruck: selectTruck,

        saveDriver: saveDriver,
        editDriver: editDriver,
        deleteDriver: deleteDriver,
        resetForm: resetForm,
        openProfile: openProfile,
        closeProfile: closeProfile,

        saveAssignment: saveAssignment,
        editAssignment: editAssignment,
        deleteAssignment: deleteAssignment,
        resetAssignmentForm: resetAssignmentForm,
        focusAssignmentForDriver: focusAssignmentForDriver,

        renderDriverTable: renderDriverTable,
        renderHistory: renderHistory,
        reportSearchChanged: reportSearchChanged,
        reportSearchKey: reportSearchKey,
        clearReportSearch: clearReportSearch,
        printReport: printReport
    };

    /*
     * Start automatically because this file is dynamically
     * injected by owner-dashboard.html.
     */
    init();

})();
