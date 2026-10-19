// ==========================================================
// EKTA TRANSPORT - CENTRAL DATABASE CONNECTOR
// STEP 1: SUPABASE CONNECTION + LEGACY API COMPATIBILITY
// ==========================================================

(function () {
    "use strict";

    // ========================================================
    // 1. SUPABASE CONFIGURATION
    // ========================================================

    const SUPABASE_URL =
        "https://hsrtysxybppsochlekjm.supabase.co";

    const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_TmG1ZN43ZrSiR1KYHA7bdw_e3fUQOmy";


    // ========================================================
    // 2. CREATE CENTRAL SUPABASE CLIENT
    // ========================================================

    if (
        typeof window.supabase === "undefined" ||
        typeof window.supabase.createClient !== "function"
    ) {
        console.error(
            "[EKTA DB] Supabase JS library is not loaded."
        );

        window.supabaseClient = null;
    } else {

        try {

            // Prevent duplicate client creation
            if (
                !window.supabaseClient ||
                typeof window.supabaseClient.from !== "function"
            ) {

                window.supabaseClient =
                    window.supabase.createClient(
                        SUPABASE_URL,
                        SUPABASE_PUBLISHABLE_KEY
                    );
            }

            console.log(
                "[EKTA DB] Supabase client initialized successfully."
            );

        } catch (error) {

            console.error(
                "[EKTA DB] Supabase client initialization failed:",
                error
            );

            window.supabaseClient = null;
        }
    }


    // ========================================================
    // 3. CONNECTION STATUS
    // ========================================================

    window.ektaSupabaseConfig = {
        url: SUPABASE_URL,
        connected:
            !!window.supabaseClient
    };


    // ========================================================
    // 4. SUPABASE HEALTH TEST
    // ========================================================

    async function testSupabaseConnection() {

        if (!window.supabaseClient) {

            console.error(
                "[EKTA DB] Cannot test Supabase: client unavailable."
            );

            return {
                success: false,
                message: "Supabase client unavailable."
            };
        }

        try {

            /*
             * We intentionally do NOT query any table here.
             *
             * Reason:
             * Step 1 is only testing whether the Supabase
             * client is initialized correctly.
             *
             * Table/RLS testing will happen in the Fleet step.
             */

            console.log(
                "[EKTA DB] Supabase client is ready."
            );

            return {
                success: true,
                message: "Supabase client is ready."
            };

        } catch (error) {

            console.error(
                "[EKTA DB] Supabase test failed:",
                error
            );

            return {
                success: false,
                message: error.message || "Supabase test failed."
            };
        }
    }


    // ========================================================
    // 5. EXPOSE SUPABASE TEST
    // ========================================================

    window.testSupabaseConnection =
        testSupabaseConnection;


    // ========================================================
    // 6. LEGACY API CONFIGURATION
    // ========================================================
    //
    // IMPORTANT:
    // Existing Dashboard / index.html still use these
    // functions. We are NOT breaking them in Step 1.
    //
    // Later, module-by-module, we will move data to Supabase.
    // ========================================================

    const API_BASE_URL =
        "https://ektatransportcompany.in/api";


    // ========================================================
    // 7. LEGACY POST API
    // ========================================================

    async function postData(endpoint, data) {

        try {

            const response =
                await fetch(
                    `${API_BASE_URL}${endpoint}`,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(data)
                    }
                );


            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );
            }


            const result =
                await response.json();


            return result;

        } catch (error) {

            console.error(
                "[EKTA DB] Legacy API POST Error:",
                error
            );

            return {
                success: false,
                message:
                    "Server connection failed!"
            };
        }
    }


    // ========================================================
    // 8. LEGACY GET API
    // ========================================================

    async function fetchData(endpoint) {

        try {

            const response =
                await fetch(
                    `${API_BASE_URL}${endpoint}`
                );


            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );
            }


            const result =
                await response.json();


            return result;

        } catch (error) {

            console.error(
                "[EKTA DB] Legacy API GET Error:",
                error
            );

            return {
                success: false,
                message:
                    "Failed to fetch data!"
            };
        }
    }


    // ========================================================
    // 9. EXPOSE LEGACY FUNCTIONS
    // ========================================================

    window.postData =
        postData;

    window.fetchData =
        fetchData;


    // ========================================================
    // 10. SUPABASE HELPER
    // ========================================================

    window.getSupabaseClient =
        function () {

            if (!window.supabaseClient) {

                console.error(
                    "[EKTA DB] Supabase client is not available."
                );

                return null;
            }

            return window.supabaseClient;
        };


    // ========================================================
    // 11. FINAL STATUS LOG
    // ========================================================

    console.log(
        "[EKTA DB] Central database connector loaded."
    );

    console.log(
        "[EKTA DB] Supabase:",
        window.supabaseClient
            ? "READY"
            : "NOT READY"
    );

    console.log(
        "[EKTA DB] Legacy API:",
        API_BASE_URL
    );

})();