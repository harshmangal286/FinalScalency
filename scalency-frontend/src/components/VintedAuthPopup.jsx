import { useState } from 'react';
import './VintedAuthPopup.css';

export default function VintedAuthPopup({ onEnrollmentSuccess, userId }) {
  const [showModal, setShowModal] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [enrollmentToken, setEnrollmentToken] = useState('');

  const handleOpenModal = () => {
    setShowModal(true);
    setError('');
    setSuccess('');
    setAccountName('');
    setEnrollmentToken('');
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setError('');
    setSuccess('');
    setAccountName('');
    setEnrollmentToken('');
  };

  const handleEnroll = async (e) => {
    e.preventDefault();
    if (!accountName.trim()) {
      setError('Please enter an account name');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('http://localhost:8000/api/v1/vinted/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_name: accountName }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setEnrollmentToken(data.enrollment_token);
      setSuccess(`✓ Account enrolled! Token: ${data.enrollment_token.substring(0, 8)}...`);

      // Store in localStorage for browser extension to pick up
      localStorage.setItem('vinted_enrollment_token', data.enrollment_token);
      localStorage.setItem('vinted_profile_id', data.profile_id);
      localStorage.setItem('vinted_account_name', data.account_name);

      // Call parent callback if provided
      if (onEnrollmentSuccess) {
        onEnrollmentSuccess({
          enrollment_token: data.enrollment_token,
          profile_id: data.profile_id,
          account_name: data.account_name,
        });
      }

      // Keep modal open for user to copy token or see that extension can pick it up
    } catch (err) {
      console.error('Enrollment error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(enrollmentToken);
    setSuccess('✓ Token copied to clipboard!');
    setTimeout(() => setSuccess(''), 2000);
  };

  return (
    <>
      {/* Enrollment Button */}
      <button
        onClick={handleOpenModal}
        className="btn-enroll-vinted"
        title="Link your Vinted account to the browser extension"
      >
        🔐 Enroll Vinted
      </button>

      {/* Modal Overlay */}
      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          {/* Modal Content */}
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Enroll Vinted Account</h2>
              <button className="modal-close" onClick={handleCloseModal}>×</button>
            </div>

            <div className="modal-body">
              {!enrollmentToken ? (
                <>
                  {/* Enrollment Form */}
                  <form onSubmit={handleEnroll}>
                    <div className="form-group">
                      <label htmlFor="account-name">Account Name or Email:</label>
                      <input
                        type="text"
                        id="account-name"
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        placeholder="e.g., myaccount or email@example.com"
                        disabled={loading}
                        required
                      />
                      <small>A friendly name to identify this Vinted account in Scalency</small>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={loading || !accountName.trim()}
                    >
                      {loading ? 'Enrolling...' : 'Link Account'}
                    </button>
                  </form>

                  <div className="info-box">
                    <h3>What happens next?</h3>
                    <ul>
                      <li>Your account is registered with Scalency</li>
                      <li>An enrollment token is generated and stored locally</li>
                      <li>The browser extension picks up the token automatically</li>
                      <li>Extension begins polling for automation tasks</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  {/* Success Screen */}
                  <div className="success-box">
                    <h3>✓ Account Enrolled!</h3>
                    <p><strong>Account:</strong> {accountName}</p>
                    <p><strong>Token:</strong></p>
                    <div className="token-display">
                      <code>{enrollmentToken}</code>
                      <button
                        onClick={handleCopyToken}
                        className="btn-copy"
                        title="Copy token to clipboard"
                      >
                        📋 Copy
                      </button>
                    </div>
                    {success && <div className="success-message">{success}</div>}
                    <p style={{ marginTop: '16px', fontSize: '13px', color: '#666' }}>
                      ✓ The browser extension will automatically pick up this token.
                      You can close this popup and open the extension to start using it.
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button
                onClick={handleCloseModal}
                className="btn-secondary"
              >
                {enrollmentToken ? 'Done' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
