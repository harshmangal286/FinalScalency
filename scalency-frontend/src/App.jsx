import { useState, useEffect } from 'react';
import ImageUpload from './components/ImageUpload';
import GeneratedListing from './components/GeneratedListing';
import ListingsTable from './components/ListingsTable';
import VintedTasks from './components/VintedTasks';
import VintedAuthPopup from './components/VintedAuthPopup';
import { publishListing, getJobStatus } from './services/api';
import './styles.css';

export default function App() {
  const [currentView, setCurrentView] = useState('listings'); // 'listings' or 'vinted-tasks'
  const [generatedListing, setGeneratedListing] = useState(null);
  const [createdListingId, setCreatedListingId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [error, setError] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [publishLoading, setPublishLoading] = useState(false);
  const [listingsRefresh, setListingsRefresh] = useState(0);
  const [userId, setUserId] = useState(null);

  // Poll job status every 2 seconds
  useEffect(() => {
    if (!jobId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await getJobStatus(jobId);
        setJobStatus(response.status);

        if (response.status === 'success' || response.status === 'failed') {
          clearInterval(pollInterval);
          if (response.status === 'success') {
            // Refresh listings after job completes
            setListingsRefresh(prev => prev + 1);
          }
        }
      } catch (error) {
        console.error('Error polling job status:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [jobId]);

  const handleListingGenerated = (listing) => {
    console.log('Setting generated listing:', listing);
    setGeneratedListing(listing);
    setCreatedListingId(null);
    setJobId(null);
    setJobStatus(null);
  };

  const handleListingCreated = (response) => {
    setCreatedListingId(response.id);
    setGeneratedListing(null);
  };

  const handlePublishListing = async () => {
    if (!createdListingId) {
      setError('No listing to publish');
      return;
    }

    setPublishLoading(true);
    try {
      const response = await publishListing(createdListingId);
      setJobId(response.job_id);
      setJobStatus(response.status);
      setError(null);
    } catch (error) {
      setError(error.response?.data?.detail || error.message || 'Failed to publish listing');
    } finally {
      setPublishLoading(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Scalency Dashboard</h1>
        <p>AI-powered listing automation and Vinted task management</p>
      </header>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '12px', padding: '16px', borderBottom: '1px solid #ddd', backgroundColor: '#f9f9f9', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => setCurrentView('listings')}
            style={{
              padding: '8px 16px',
              border: 'none',
              backgroundColor: currentView === 'listings' ? '#007bff' : '#e9ecef',
              color: currentView === 'listings' ? 'white' : '#333',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: currentView === 'listings' ? 'bold' : 'normal',
              transition: 'all 0.3s',
            }}
          >
            📝 Listings
          </button>
          <button
            onClick={() => setCurrentView('vinted-tasks')}
            style={{
              padding: '8px 16px',
              border: 'none',
              backgroundColor: currentView === 'vinted-tasks' ? '#007bff' : '#e9ecef',
              color: currentView === 'vinted-tasks' ? 'white' : '#333',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: currentView === 'vinted-tasks' ? 'bold' : 'normal',
              transition: 'all 0.3s',
            }}
          >
            ⚡ Vinted Tasks
          </button>
        </div>
        <VintedAuthPopup userId={userId} />
      </div>

      {error && typeof error === 'string' && (
        <div className="error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {currentView === 'listings' ? (
        <div className="main-content">
          <div className="left-panel">
            {!userId ? (
              <div className="card info-message" style={{ padding: '20px', textAlign: 'center' }}>
                <p>Please authenticate via Vinted to begin.</p>
              </div>
            ) : (
              <>
                <ImageUpload
                  userId={userId}
                  onListingGenerated={(listing) => {
                    handleListingGenerated(listing);
                    setImageUrl(listing.image_urls?.[0] || imageUrl);
                  }}
                  onError={setError}
                />

                {generatedListing && (
                  <GeneratedListing
                    listing={generatedListing}
                    userId={userId}
                    onListingCreated={handleListingCreated}
                    onError={setError}
                    imageUrl={imageUrl}
                  />
                )}

                {createdListingId && (
                  <div className="card">
                    <h2>3. Publish Listing</h2>
                    <div className="info-box">
                      <p><strong>Listing Created:</strong> {createdListingId.substring(0, 8)}...</p>
                    </div>
                    <button
                      onClick={handlePublishListing}
                      disabled={publishLoading}
                      className="btn-primary"
                    >
                      {publishLoading ? 'Publishing...' : 'Publish Listing'}
                    </button>
                  </div>
                )}

                {jobId && (
                  <div className="card">
                    <h2>4. Job Status Polling</h2>
                    <div className="info-box">
                      <p><strong>Job ID:</strong> {jobId.substring(0, 8)}...</p>
                      <p>
                        <strong>Status:</strong>{' '}
                        <span className={`status-badge status-${jobStatus || 'pending'}`}>
                          {jobStatus || 'pending'}
                        </span>
                      </p>
                    </div>
                    {jobStatus === 'success' && (
                      <div className="success-message">
                        Listing published successfully!
                      </div>
                    )}
                    {jobStatus === 'failed' && (
                      <div className="error-message">
                        Failed to publish listing. Please try again.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="right-panel">
            <ListingsTable refreshTrigger={listingsRefresh} />
          </div>
        </div>
      ) : (
        <div style={{ padding: '20px' }}>
          <VintedTasks />
        </div>
      )}
    </div>
  );
}
