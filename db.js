// ==========================================
// CENTRAL DATABASE & API CONNECTOR (db.js)
// ==========================================

// Aapka live cloud/custom domain base URL
const API_BASE_URL = "https://ektatransportcompany.in/api"; 

/**
 * Server par data bhejne ke liye (POST Request)
 * @param {string} endpoint - API route (jaise '/save-employee.php')
 * @param {Object} data - Jo data aapko bhejna hai
 */
async function postData(endpoint, data) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Agar authentication token ki zaroorat ho toh yahan add kar sakte hain
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Database POST Error:", error);
        return { success: false, message: "Server connection failed!" };
    }
}

/**
 * Server se data laane ke liye (GET Request)
 * @param {string} endpoint - API route (jaise '/get-fleet.php')
 */
async function fetchData(endpoint) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Database GET Error:", error);
        return { success: false, message: "Failed to fetch data!" };
    }
}