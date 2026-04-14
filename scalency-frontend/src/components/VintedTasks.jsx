import { useState, useEffect } from 'react';

const BACKEND_URL = 'http://localhost:8000';

export default function VintedTasks() {
  const [profiles, setProfiles] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [activeTaskType, setActiveTaskType] = useState('send_message');
  const [formData, setFormData] = useState({
    profile_id: '',
    task_type: 'send_message',
    payload: {},
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [twoFACode, setTwoFACode] = useState('');

  // Load profiles on mount
  useEffect(() => {
    loadProfiles();
  }, []);

  // Log profile changes for debugging
  useEffect(() => {
    console.log('[VintedTasks] Profiles loaded:', profiles);
    console.log('[VintedTasks] Selected profile:', selectedProfileId);
  }, [profiles, selectedProfileId]);

  // Listen for vinted profile enrollment
  useEffect(() => {
    const handleEnrollment = (event) => {
      console.log('[VintedTasks] Enrollment event:', event.detail);
      const { profile_id } = event.detail;

      // Auto-select the newly enrolled profile
      setSelectedProfileId(profile_id);
      console.log('[VintedTasks] Auto-selected newly enrolled profile:', profile_id);

      // Reload profiles to refresh the list
      setTimeout(() => loadProfiles(), 500);
    };

    window.addEventListener('vinted-profile-enrolled', handleEnrollment);
    return () => window.removeEventListener('vinted-profile-enrolled', handleEnrollment);
  }, []);

  // Load tasks when profile is selected
  useEffect(() => {
    if (selectedProfileId) {
      loadTasks();
    }
  }, [selectedProfileId]);

  // Cleanup login state when task completes
  useEffect(() => {
    if (success && activeTaskType === 'login_vinted') {
      const timeout = setTimeout(() => {
        setLoginInProgress(false);
        setNeeds2FA(false);
        setTwoFACode('');
        sessionStorage.removeItem('scalency_2fa_code');
        sessionStorage.removeItem('scalency_2fa_waiting');
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [success, activeTaskType]);

  // Reset 2FA state when task type changes
  useEffect(() => {
    if (activeTaskType !== 'login_vinted') {
      setLoginInProgress(false);
      setNeeds2FA(false);
      setTwoFACode('');
      sessionStorage.removeItem('scalency_2fa_code');
      sessionStorage.removeItem('scalency_2fa_waiting');
    }
  }, [activeTaskType]);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/v1/vinted/profiles`);
      if (!response.ok) throw new Error('Failed to load profiles');
      const data = await response.json();
      setProfiles(data.profiles || []);
      if (data.profiles?.length > 0 && !selectedProfileId) {
        setSelectedProfileId(data.profiles[0].profile_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async () => {
    if (!selectedProfileId) return;

    try {
      setLoading(true);
      const response = await fetch(
        `${BACKEND_URL}/api/v1/vinted/tasks/list?profile_id=${selectedProfileId}`
      );
      if (!response.ok) throw new Error('Failed to load tasks');
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const createTask = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!selectedProfileId) {
      setError('Please select a profile');
      return;
    }

    try {
      setLoading(true);

      // Validate payload based on task type
      const payload = formData.payload;
      if (activeTaskType === 'login_vinted') {
        if (!payload.username || !payload.password) {
          throw new Error('Missing required fields: username, password');
        }
      } else if (activeTaskType === 'send_message') {
        if (!payload.user_id || !payload.message) {
          throw new Error('Missing required fields: user_id, message');
        }
      } else if (activeTaskType === 'publish_listing') {
        if (!payload.title || !payload.description || !payload.price || !payload.category) {
          throw new Error('Missing required fields: title, description, price, category');
        }
      } else if (activeTaskType === 'bump_listing') {
        if (!payload.listing_id) {
          throw new Error('Missing required field: listing_id');
        }
      }

      const response = await fetch(`${BACKEND_URL}/api/v1/vinted/tasks/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: selectedProfileId,
          task_type: activeTaskType,
          payload,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create task');
      }

      // For login tasks, monitor for 2FA requirement
      if (activeTaskType === 'login_vinted') {
        setLoginInProgress(true);
        console.log('[VintedTasks] Waiting for 2FA requirement from extension...');

        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            // Check multiple storage methods (handle cross-origin issues)
            const hasFlagSessionStorage = sessionStorage.getItem('scalency_2fa_waiting') === 'true';
            const hasFlagLocalStorage = localStorage.getItem('scalency_2fa_waiting') === 'true';
            const hasFlagWindow = window.scalency_2fa_waiting === 'true';
            const hasFlag = hasFlagSessionStorage || hasFlagLocalStorage || hasFlagWindow;

            if (hasFlag) {
              console.log('[VintedTasks] ✓ 2FA flag detected!');
              clearInterval(checkInterval);
              setNeeds2FA(true);
              resolve();
            }
          }, 200); // Check frequently

          // Timeout after 180 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            console.log('[VintedTasks] 2FA monitoring timeout - login may have completed without 2FA');
            setLoginInProgress(false);
            resolve();
          }, 180000);
        });
      } else {
        setSuccess('Task created successfully!');
        setFormData({
          profile_id: selectedProfileId,
          task_type: activeTaskType,
          payload: {},
        });
      }

      // Reload tasks
      setTimeout(() => loadTasks(), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      setLoginInProgress(false);
      setNeeds2FA(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePayloadChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      payload: {
        ...prev.payload,
        [field]: value,
      },
    }));
  };

  // Send 2FA code to extension when user enters it
  useEffect(() => {
    if (!needs2FA || !twoFACode || twoFACode.length !== 4) return;

    console.log('[VintedTasks] ✓ Sending 2FA code to extension...');

    // Send via all methods for maximum compatibility
    try {
      sessionStorage.setItem('scalency_2fa_code', twoFACode);
      localStorage.setItem('scalency_2fa_code', twoFACode);
      window.scalency_2fa_code_value = twoFACode;
      console.log('[VintedTasks] Sent 2FA code via sessionStorage, localStorage, and window property');
    } catch (e) {
      console.error('[VintedTasks] Error sending 2FA code:', e.message);
    }
  }, [twoFACode, needs2FA]);

  const getStatusBadge = (status) => {
    const colors = {
      success: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      pending: 'bg-yellow-100 text-yellow-800',
      running: 'bg-blue-100 text-blue-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Vinted Automation Tasks</h2>
        <p className="text-gray-600">Create and manage Vinted listing automation</p>
      </div>

      {/*Profile Selection */}
      <div className="border rounded-lg p-6 bg-white">
        <h3 className="text-lg font-semibold mb-4">Select Profile</h3>

        {loading && profiles.length === 0 ? (
          <p className="text-gray-600">Loading profiles...</p>
        ) : profiles.length === 0 ? (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
            <p className="font-medium mb-2">⚠️ No Vinted profiles enrolled</p>
            <p className="text-sm mb-3">
              You need to enroll a Vinted account first. Click the "🔐 Enroll Vinted" button at the top-right to link your account.
            </p>
            <p className="text-xs text-yellow-700">
              After enrolling, refresh the page and select your profile here to create tasks.
            </p>
          </div>
        ) : (
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {profiles.map((profile) => (
              <option key={profile.profile_id} value={profile.profile_id}>
                {profile.account_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedProfileId && (
        <>
          {/* Task Creation */}
          <div className="border rounded-lg p-6 bg-white">
            <h3 className="text-lg font-semibold mb-4">Create New Task</h3>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-3">Task Type</label>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { type: 'login_vinted', label: '🔐 Login' },
                  { type: 'send_message', label: 'Send Message' },
                  { type: 'publish_listing', label: 'Publish Listing' },
                  { type: 'bump_listing', label: 'Bump Listing' },
                ].map(({ type, label }) => (
                  <button
                    key={type}
                    onClick={() => {
                      setActiveTaskType(type);
                      setFormData((prev) => ({
                        ...prev,
                        task_type: type,
                        payload: {},
                      }));
                    }}
                    className={`p-4 rounded-lg border-2 transition ${
                      activeTaskType === type
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <p className="font-medium text-sm">{label}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Task-specific form fields */}
            <form onSubmit={createTask} className="space-y-4">
              {activeTaskType === 'login_vinted' && (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-blue-800">
                      The extension will fill out the Vinted login form automatically on the login page.
                      If 2FA is enabled, you'll be asked to enter the verification code here.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Username or Email</label>
                    <input
                      type="text"
                      value={formData.payload.username || ''}
                      onChange={(e) => handlePayloadChange('username', e.target.value)}
                      placeholder="your@email.com or username"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                      disabled={loginInProgress}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Password</label>
                    <input
                      type="password"
                      value={formData.payload.password || ''}
                      onChange={(e) => handlePayloadChange('password', e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                      disabled={loginInProgress}
                    />
                  </div>

                  {/* 2FA Verification Code Input */}
                  {needs2FA && (
                    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-5">
                      <div className="bg-yellow-100 text-yellow-900 px-4 py-3 rounded mb-4">
                        <p className="text-sm font-semibold">🔐 Verify Your Activity</p>
                        <p className="text-xs mt-1">A 4-digit code has been sent to your phone.</p>
                      </div>

                      <label className="block text-sm font-medium mb-3 text-yellow-900">
                        Enter the 4-digit verification code:
                      </label>

                      <div className="relative mb-4">
                        <input
                          type="text"
                          value={twoFACode}
                          onChange={(e) => {
                            const code = e.target.value.replace(/\D/g, '').slice(0, 4);
                            setTwoFACode(code);
                            if (code.length === 4) {
                              console.log('[VintedTasks] 4-digit code complete, sending to extension');
                              sessionStorage.setItem('scalency_2fa_code', code);
                            }
                          }}
                          placeholder="• • • •"
                          maxLength="4"
                          inputMode="numeric"
                          autoComplete="off"
                          className="w-full px-4 py-3 border-2 border-yellow-300 rounded-lg focus:outline-none focus:border-yellow-500 text-center text-3xl tracking-[0.5rem] font-mono font-bold"
                        />
                        <div className="absolute right-3 top-3">
                          {twoFACode.length === 4 ? (
                            <span className="text-2xl">✓</span>
                          ) : (
                            <span className="text-lg text-yellow-600">{twoFACode.length}/4</span>
                          )}
                        </div>
                      </div>

                      {twoFACode.length === 4 && (
                        <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 border border-green-200 rounded">
                          <span className="text-lg">✓</span>
                          <span className="text-sm text-green-700">Code detected. Extension is verifying...</span>
                        </div>
                      )}

                      <label className="flex items-center gap-2 text-sm text-yellow-900 cursor-pointer">
                        <input
                          type="checkbox"
                          defaultChecked
                          className="w-4 h-4 rounded"
                          title="Extension will check 'Remember this device' on Vinted"
                        />
                        Remember this device
                        <span className="text-xs text-yellow-700">(extension will check this for you)</span>
                      </label>

                      <p className="text-xs text-yellow-600 mt-3 text-center">
                        Waiting for extension to complete verification...
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || loginInProgress}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition"
                  >
                    {loading ? 'Logging in...' : loginInProgress ? 'Waiting for extension...' : 'Log In to Vinted'}
                  </button>

                  {/* Status indicator */}
                  {loginInProgress && (
                    <div className="p-3 bg-blue-50 border border-blue-300 rounded text-sm text-blue-700">
                      ⏳ Extension is processing your login...
                    </div>
                  )}
                </>
              )}

              {activeTaskType === 'send_message' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">User ID</label>
                    <input
                      type="text"
                      value={formData.payload.user_id || ''}
                      onChange={(e) => handlePayloadChange('user_id', e.target.value)}
                      placeholder="e.g., 12345678"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Message</label>
                    <textarea
                      value={formData.payload.message || ''}
                      onChange={(e) => handlePayloadChange('message', e.target.value)}
                      placeholder="Enter your message..."
                      rows={4}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </>
              )}

              {activeTaskType === 'publish_listing' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">Title</label>
                    <input
                      type="text"
                      value={formData.payload.title || ''}
                      onChange={(e) => handlePayloadChange('title', e.target.value)}
                      placeholder="e.g., Nike Air Max White"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Description</label>
                    <textarea
                      value={formData.payload.description || ''}
                      onChange={(e) => handlePayloadChange('description', e.target.value)}
                      placeholder="Describe the item..."
                      rows={4}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Price (€)</label>
                      <input
                        type="number"
                        value={formData.payload.price || ''}
                        onChange={(e) => handlePayloadChange('price', parseFloat(e.target.value))}
                        placeholder="e.g., 45.50"
                        step="0.01"
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Category</label>
                      <input
                        type="text"
                        value={formData.payload.category || ''}
                        onChange={(e) => handlePayloadChange('category', e.target.value)}
                        placeholder="e.g., shoes, clothing"
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Brand</label>
                      <input
                        type="text"
                        value={formData.payload.brand || ''}
                        onChange={(e) => handlePayloadChange('brand', e.target.value)}
                        placeholder="e.g., Nike"
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Size</label>
                      <input
                        type="text"
                        value={formData.payload.size || ''}
                        onChange={(e) => handlePayloadChange('size', e.target.value)}
                        placeholder="e.g., M, L, 10, 42"
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Condition</label>
                      <select
                        value={formData.payload.condition || ''}
                        onChange={(e) => handlePayloadChange('condition', e.target.value)}
                        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select condition...</option>
                        <option value="New with tags">New with tags</option>
                        <option value="Like new">Like new</option>
                        <option value="Good">Good</option>
                        <option value="Fair">Fair</option>
                        <option value="Poor">Poor</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Color(s) - Select up to 2</label>
                      <div className="space-y-2">
                        {/* First color */}
                        <select
                          value={formData.payload.color?.[0] || ''}
                          onChange={(e) => {
                            const colors = [...(formData.payload.color || [])];
                            colors[0] = e.target.value;
                            handlePayloadChange('color', colors.filter(Boolean));
                          }}
                          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select color 1...</option>
                          <option value="Black">Black</option>
                          <option value="White">White</option>
                          <option value="Red">Red</option>
                          <option value="Blue">Blue</option>
                          <option value="Green">Green</option>
                          <option value="Yellow">Yellow</option>
                          <option value="Orange">Orange</option>
                          <option value="Purple">Purple</option>
                          <option value="Pink">Pink</option>
                          <option value="Brown">Brown</option>
                          <option value="Gray">Gray</option>
                          <option value="Beige">Beige</option>
                          <option value="Navy">Navy</option>
                          <option value="Cream">Cream</option>
                          <option value="Gold">Gold</option>
                          <option value="Silver">Silver</option>
                          <option value="Turquoise">Turquoise</option>
                        </select>

                        {/* Second color */}
                        <select
                          value={formData.payload.color?.[1] || ''}
                          onChange={(e) => {
                            const colors = [...(formData.payload.color || [])];
                            colors[1] = e.target.value;
                            handlePayloadChange('color', colors.filter(Boolean));
                          }}
                          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select color 2 (optional)...</option>
                          <option value="Black">Black</option>
                          <option value="White">White</option>
                          <option value="Red">Red</option>
                          <option value="Blue">Blue</option>
                          <option value="Green">Green</option>
                          <option value="Yellow">Yellow</option>
                          <option value="Orange">Orange</option>
                          <option value="Purple">Purple</option>
                          <option value="Pink">Pink</option>
                          <option value="Brown">Brown</option>
                          <option value="Gray">Gray</option>
                          <option value="Beige">Beige</option>
                          <option value="Navy">Navy</option>
                          <option value="Cream">Cream</option>
                          <option value="Gold">Gold</option>
                          <option value="Silver">Silver</option>
                          <option value="Turquoise">Turquoise</option>
                        </select>

                        {/* Display selected colors */}
                        {formData.payload.color && formData.payload.color.length > 0 && (
                          <div className="flex gap-2 flex-wrap pt-2">
                            {formData.payload.color.map((color, idx) => (
                              <div
                                key={idx}
                                className="px-3 py-1 bg-blue-100 border border-blue-300 rounded-full text-sm flex items-center gap-2"
                              >
                                {color}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const colors = formData.payload.color.filter((_, i) => i !== idx);
                                    handlePayloadChange('color', colors);
                                  }}
                                  className="text-blue-600 hover:text-blue-800 font-bold"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Material(s)</label>
                    <input
                      type="text"
                      value={formData.payload.material?.join(', ') || ''}
                      onChange={(e) => handlePayloadChange('material', e.target.value.split(',').map(m => m.trim()).filter(Boolean))}
                      placeholder="e.g., Cotton, Polyester (comma-separated)"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Image URLs</label>
                    <div className="space-y-2">
                      {[0, 1, 2].map((idx) => (
                        <div key={idx}>
                          <label className="text-xs text-gray-600 block mb-1">Image {idx + 1} {idx === 0 ? '(required)' : '(optional)'}</label>
                          <input
                            type="text"
                            value={formData.payload.photos_urls?.[idx] || ''}
                            onChange={(e) => {
                              const input = e.target.value.trim();

                              // If input contains multiple URLs (concatenated without spaces)
                              if (input.includes('https://') && input.split('https://').length > 2) {
                                // Split and reconstruct URLs, trimming each URL
                                const parts = input.split('https://').filter(Boolean);
                                const urls = parts.map(part => `https://${part.trim()}`).filter(url => url.length > 8); // Filter out 'https://' only

                                // Update all image fields with parsed URLs
                                handlePayloadChange('photos_urls', urls.slice(0, 3));
                              } else {
                                // Single URL - just update this field
                                const urls = [...(formData.payload.photos_urls || [])];
                                if (input) {
                                  urls[idx] = input;
                                } else {
                                  urls.splice(idx, 1);
                                }
                                handlePayloadChange('photos_urls', urls.filter(Boolean));
                              }
                            }}
                            placeholder={`Paste image URL ${idx + 1}`}
                            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                          />
                        </div>
                      ))}

                      {/* Show parsed URLs */}
                      {formData.payload.photos_urls && formData.payload.photos_urls.length > 0 && (
                        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm">
                          <p className="font-medium text-blue-900 mb-2">📸 {formData.payload.photos_urls.length} image(s) ready:</p>
                          <ul className="space-y-1">
                            {formData.payload.photos_urls.map((url, idx) => (
                              <li key={idx} className="text-blue-800 truncate">
                                {idx + 1}. {url.substring(0, 60)}...
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTaskType === 'bump_listing' && (
                <div>
                  <label className="block text-sm font-medium mb-2">Listing ID</label>
                  <input
                    type="text"
                    value={formData.payload.listing_id || ''}
                    onChange={(e) => handlePayloadChange('listing_id', e.target.value)}
                    placeholder="e.g., 123456789"
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                  {error}
                </div>
              )}

              {success && (
                <div className="p-3 bg-green-100 border border-green-400 text-green-700 rounded">
                  {success}
                </div>
              )}

              {activeTaskType !== 'login_vinted' && (
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition"
                >
                  {loading ? 'Creating...' : 'Create Task'}
                </button>
              )}
            </form>
          </div>

          {/* Task Queue */}
          <div className="border rounded-lg p-6 bg-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Task Queue</h3>
              <button
                onClick={() => loadTasks()}
                disabled={loading}
                className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded disabled:opacity-50 transition"
              >
                Refresh
              </button>
            </div>

            {tasks.length === 0 ? (
              <p className="text-gray-600 text-center py-8">No tasks yet</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tasks.map((task) => (
                  <div key={task.task_id} className="p-4 border rounded-lg bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{task.task_type.replace('_', ' ')}</p>
                        <p className="text-sm text-gray-600">
                          {new Date(task.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className={`px-3 py-1 text-sm rounded-full font-medium ${getStatusBadge(task.status)}`}>
                        {task.status}
                      </span>
                    </div>
                    {task.error_message && (
                      <p className="text-red-600 text-sm mt-2">{task.error_message}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
