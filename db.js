// ==========================================
// CENTRAL DATABASE & API CONNECTOR (db.js)
// Supabase Cloud Integration for Ekta Transport
// ==========================================

// Supabase Configuration Credentials
const SUPABASE_URL = 'https://hsrtysxybppsochlekjm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzcnR5c3h5YnBwc29jaGxla2ptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTQ2MTYsImV4cCI6MjEwMzg3MDYxNn0.gijeBCiK3UYd6RtTTgapA6y9qQHes0hrwYELZJPYKCk';

// Initialize Supabase Client (Ensure supabase-js library is loaded in HTML)
let _supabase = null;
if (typeof supabase !== 'undefined') {
    const { createClient } = supabase;
    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.error("Supabase JS Library is missing in HTML! Please add the CDN script.");
}

/**
 * Supabase database mein data bhejne ke liye (INSERT Request)
 * @param {string} tableName - Table ka naam (jaise 'fleet', 'drivers', 'lr_entries', 'ledgers')
 * @param {Object} data - Jo data object aapko bhejna hai
 */
async function postData(tableName, data) {
    try {
        if (!_supabase) throw new Error("Supabase client not initialized!");

        const { data: result, error } = await _supabase
            .from(tableName)
            .insert([data])
            .select();
        
        if (error) {
            console.error("Database POST Error:", error.message);
            return { success: false, message: error.message };
        }
        
        return { success: true, data: result };
    } catch (error) {
        console.error("Database POST Exception:", error);
        return { success: false, message: error.message || "Server connection failed!" };
    }
}

/**
 * Supabase database se data update karne ke liye (UPDATE Request)
 */
async function updateData(tableName, matchCriteria, updateValues) {
    try {
        if (!_supabase) throw new Error("Supabase client not initialized!");

        let query = _supabase.from(tableName).update(updateValues);
        Object.keys(matchCriteria).forEach(key => {
            query = query.eq(key, matchCriteria[key]);
        });

        const { data: result, error } = await query.select();
        
        if (error) {
            console.error("Database UPDATE Error:", error.message);
            return { success: false, message: error.message };
        }
        
        return { success: true, data: result };
    } catch (error) {
        console.error("Database UPDATE Exception:", error);
        return { success: false, message: error.message || "Server connection failed!" };
    }
}

/**
 * Supabase database se data laane ke liye (SELECT/RETRIEVE Request)
 * @param {string} tableName - Table ka naam (jaise 'fleet', 'drivers')
 */
async function fetchData(tableName) {
    try {
        if (!_supabase) throw new Error("Supabase client not initialized!");

        const { data: result, error } = await _supabase
            .from(tableName)
            .select('*')
            .order('id', { ascending: false });
        
        if (error) {
            console.error("Database GET Error:", error.message);
            return { success: false, message: error.message };
        }
        
        return { success: true, data: result };
    } catch (error) {
        console.error("Database GET Exception:", error);
        return { success: "false", message: "Failed to fetch data!" };
    }
}