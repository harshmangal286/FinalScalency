/**
 * Vinted Extension MVP - Enrollment Flow
 */

// CONFIG is loaded from config.js before this script

document.getElementById('enroll-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const accountName = document.getElementById('account-name').value.trim();
  const statusDiv = document.getElementById('status');

  if (!accountName) {
    statusDiv.innerHTML = '<div class="error">Please enter an account name</div>';
    return;
  }

  statusDiv.innerHTML = '<div class="loading">Enrolling account...</div>';

  try {
    // Call backend enrollment endpoint
    const enrollUrl = CONFIG.getFullUrl(CONFIG.API_ENDPOINTS.ENROLL);
    const response = await fetch(enrollUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_name: accountName }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Store enrollment token locally
    await chrome.storage.local.set({
      enrollment_token: data.enrollment_token,
      profile_id: data.profile_id,
      account_name: data.account_name,
      enrolled_at: new Date().toISOString(),
    });

    statusDiv.innerHTML = `
      <div class="success">
        <h3>✓ Account Enrolled!</h3>
        <p><strong>Account:</strong> ${data.account_name}</p>
        <p><strong>Profile ID:</strong> ${data.profile_id}</p>
        <p><strong>Token:</strong> ${data.enrollment_token.substring(0, 8)}...</p>
        <p style="margin-top: 12px; color: #666;">The extension will now poll Scalency backend for tasks every 15 seconds.</p>
      </div>
    `;

    // Close this tab after 3 seconds
    setTimeout(() => {
      window.close();
    }, 3000);
  } catch (error) {
    console.error('Enrollment error:', error);
    statusDiv.innerHTML = `<div class="error"><strong>Error:</strong> ${error.message}</div>`;
  }
});
