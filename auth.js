/**
 * Ekta Transport Company - Auth & Security Management (auth.js)
 * Handles Owner/Staff Session, Login Verification, and Token Security
 */

// Check if user is already logged in when visiting the main portal
document.addEventListener("DOMContentLoaded", function () {
    const currentPath = window.location.pathname;
    const isLoggedIn = localStorage.getItem("ekta_auth_token");

    // If trying to access dashboard/modules without auth, redirect or handle UI
    if (!isLoggedIn && currentPath.includes("dashboard")) {
        alert("Unauthorized access! Please login first.");
        window.location.href = "index.html";
    }
});

// Handle Secure Login Verification (Connected with index.html handleLogin)
function validateAndLoginUser(userId, password, role) {
    if (!userId || !password) {
        alert("Please enter both User ID and Password!");
        return false;
    }

    // Basic simulation of secure token generation (Can be replaced with backend API call later)
    const mockToken = "EKTA_SECURE_TOKEN_" + Math.random().toString(36).substring(2) + Date.now();
    
    // Store session in localStorage
    localStorage.setItem("ekta_auth_token", mockToken);
    localStorage.setItem("ekta_user_role", role);
    localStorage.setItem("ekta_user_id", userId);

    return true;
}

// Logout Functionality to clear session securely
function handleLogout() {
    localStorage.removeItem("ekta_auth_token");
    localStorage.removeItem("ekta_user_role");
    localStorage.removeItem("ekta_user_id");
    
    alert("Logged out successfully securely.");
    window.location.href = "index.html";
}

// Export or attach to global window for seamless integration with index.html
window.EktaAuth = {
    validateAndLoginUser,
    handleLogout
};