import { useState, useEffect } from 'react';
import { getListings, repostListing, updateListingStock, deleteListing } from '../services/api';

export default function ListingsTable({ refreshTrigger }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // Track which listing is being acted upon
  const [expandedListing, setExpandedListing] = useState(null); // Track expanded listing for stock form
  const [stockQuantity, setStockQuantity] = useState({});
  const [repostStock, setRepostStock] = useState({});

  // Fetch listings when refreshTrigger changes
  const fetchListings = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getListings();
      setListings(response.items || []);
    } catch (error) {
      setError(error.response?.data?.detail || error.message || 'Failed to fetch listings');
    } finally {
      setLoading(false);
    }
  };

  // Fetch listings when component mounts or refreshTrigger changes
  useEffect(() => {
    fetchListings();
  }, [refreshTrigger]);

  const handleRepost = async (listingId) => {
    const stock = parseInt(repostStock[listingId] || 1);
    if (stock <= 0) {
      setError('Please enter a valid stock quantity for repost');
      return;
    }

    setActionLoading(listingId);
    try {
      await repostListing(listingId, stock);
      // Refresh listings after repost
      await fetchListings();
      setRepostStock({}); // Clear form
      alert('Listing reposted successfully!');
    } catch (err) {
      setError(err.message || 'Failed to repost listing');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStockUpdate = async (listingId) => {
    const quantity = parseInt(stockQuantity[listingId] || 0);
    if (quantity <= 0) {
      setError('Please enter a valid quantity');
      return;
    }

    setActionLoading(listingId);
    try {
      const result = await updateListingStock(listingId, quantity);
      // Refresh listings after stock update
      await fetchListings();
      setStockQuantity({}); // Clear form
      setExpandedListing(null); // Close form
      alert(`Stock updated. New status: ${result.status}`);
    } catch (err) {
      setError(err.message || 'Failed to update stock');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (listingId) => {
    if (!window.confirm('Are you sure you want to delete this listing? This action cannot be undone.')) {
      return;
    }

    setActionLoading(listingId);
    try {
      await deleteListing(listingId);
      // Refresh listings after deletion
      await fetchListings();
      alert('Listing deleted successfully!');
    } catch (err) {
      setError(err.message || 'Failed to delete listing');
    } finally {
      setActionLoading(null);
    }
  };

  const canRepost = (listing) => listing.status === 'sold';
  const canUpdateStock = (listing) => listing.status !== 'sold' && listing.stock > 0;
  const canPublish = (listing) => listing.status === 'draft';

  return (
    <div className="card">
      <h2>5. Listings Feed</h2>
      <button onClick={fetchListings} disabled={loading} className="btn-secondary">
        {loading ? 'Loading...' : 'Refresh Listings'}
      </button>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <p>Loading listings...</p>
      ) : listings.length === 0 ? (
        <p>No listings yet.</p>
      ) : (
        <div className="listings-grid">
          {listings.map((listing) => (
            <div key={listing.id} className="listing-card">
              {/* Display product thumbnail */}
              {listing.image_urls && listing.image_urls.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <img
                    src={listing.image_urls[0]}
                    alt={listing.title}
                    style={{
                      width: '100%',
                      height: '150px',
                      objectFit: 'cover',
                      borderRadius: '6px'
                    }}
                  />
                </div>
              )}

              <h3>{listing.title}</h3>
              <p><strong>Status:</strong> {listing.status}</p>
              <p><strong>Price:</strong> ${listing.price || 'N/A'}</p>
              <p><strong>Stock:</strong> {listing.stock || 0}</p>
              <p><strong>ID:</strong> <code>{listing.id.substring(0, 8)}...</code></p>

              {/* Action Buttons */}
              <div className="listing-actions" style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {canRepost(listing) && (
                  <>
                    {expandedListing === `repost-${listing.id}` ? (
                      <div style={{ flex: '1', display: 'flex', gap: '4px' }}>
                        <input
                          type="number"
                          min="1"
                          value={repostStock[listing.id] || ''}
                          onChange={(e) => setRepostStock({ ...repostStock, [listing.id]: e.target.value })}
                          placeholder="Stock qty"
                          style={{ flex: '1', padding: '6px' }}
                        />
                        <button
                          onClick={() => handleRepost(listing.id)}
                          disabled={actionLoading === listing.id}
                          className="btn-primary"
                          style={{ padding: '6px 12px' }}
                        >
                          {actionLoading === listing.id ? '...' : '✓'}
                        </button>
                        <button
                          onClick={() => setExpandedListing(null)}
                          className="btn-secondary"
                          style={{ padding: '6px 12px' }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setExpandedListing(`repost-${listing.id}`)}
                        className="btn-secondary"
                        style={{ flex: '1', minWidth: '80px' }}
                      >
                        📤 Repost
                      </button>
                    )}
                  </>
                )}

                {canUpdateStock(listing) && (
                  <>
                    {expandedListing === listing.id ? (
                      <div style={{ flex: '1', display: 'flex', gap: '4px' }}>
                        <input
                          type="number"
                          min="1"
                          max={listing.stock}
                          value={stockQuantity[listing.id] || ''}
                          onChange={(e) => setStockQuantity({ ...stockQuantity, [listing.id]: e.target.value })}
                          placeholder="Qty"
                          style={{ flex: '1', padding: '6px' }}
                        />
                        <button
                          onClick={() => handleStockUpdate(listing.id)}
                          disabled={actionLoading === listing.id}
                          className="btn-primary"
                          style={{ padding: '6px 12px' }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setExpandedListing(null)}
                          className="btn-secondary"
                          style={{ padding: '6px 12px' }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setExpandedListing(listing.id)}
                        className="btn-secondary"
                        style={{ flex: '1', minWidth: '80px' }}
                      >
                        📉 Stock
                      </button>
                    )}
                  </>
                )}

                {/* Delete Button */}
                <button
                  onClick={() => handleDelete(listing.id)}
                  disabled={actionLoading === listing.id}
                  className="btn-secondary"
                  style={{ flex: '1', minWidth: '80px', backgroundColor: '#dc3545' }}
                >
                  {actionLoading === listing.id ? 'Deleting...' : '🗑️ Delete'}
                </button>
              </div>

              {/* Status indicator */}
              {listing.status === 'draft' && <p style={{ color: '#ff9800', fontSize: '12px', marginTop: '8px' }}>Ready to publish</p>}
              {listing.status === 'published' && <p style={{ color: '#4caf50', fontSize: '12px', marginTop: '8px' }}>Live listing</p>}
              {listing.status === 'sold' && <p style={{ color: '#f44336', fontSize: '12px', marginTop: '8px' }}>Sold - can repost</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
