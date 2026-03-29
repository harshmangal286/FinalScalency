import { useState } from 'react';
import { createListing } from '../services/api';

export default function GeneratedListing({ listing, userId, onListingCreated, onError, imageUrl }) {
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedListing, setEditedListing] = useState(listing);

  const handleCreateListing = async () => {
    if (!userId) {
      onError('User not initialized. Please refresh the page.');
      return;
    }

    if (!editedListing.price) {
      onError('Please set a selling price before creating the listing');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        title: editedListing.title,
        description: editedListing.description,
        brand: editedListing.brand,
        category: editedListing.category,
        size: editedListing.size,
        condition: editedListing.condition_estimate,
        material: editedListing.material,
        style: editedListing.style,
        color: editedListing.color,
        hashtags: editedListing.hashtags || [],
        image_urls: editedListing.image_urls || (imageUrl ? [imageUrl] : []),
        stock: editedListing.stock || 1,
        price: editedListing.price || null,
      };
      const response = await createListing(payload, userId);
      onListingCreated(response);
      onError(null);
    } catch (error) {
      onError(error.message || 'Failed to create listing');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (field, value) => {
    setEditedListing({
      ...editedListing,
      [field]: value,
    });
  };

  if (!listing) {
    return null;
  }

  return (
    <div className="card">
      <h2>2. Generated Listing Preview</h2>

      {isEditing ? (
        <div className="form-group">
          <label>Title</label>
          <input
            type="text"
            value={editedListing.title}
            onChange={(e) => handleFieldChange('title', e.target.value)}
          />
          <label>Description</label>
          <textarea
            value={editedListing.description}
            onChange={(e) => handleFieldChange('description', e.target.value)}
            rows="4"
          />
          <label>Brand</label>
          <input
            type="text"
            value={editedListing.brand}
            onChange={(e) => handleFieldChange('brand', e.target.value)}
          />
          <label>Category</label>
          <input
            type="text"
            value={editedListing.category}
            onChange={(e) => handleFieldChange('category', e.target.value)}
          />
          <label>Size</label>
          <input
            type="text"
            value={editedListing.size || ''}
            placeholder="e.g., M, L, 10, 42"
            onChange={(e) => handleFieldChange('size', e.target.value)}
          />
          <label>Material</label>
          <input
            type="text"
            value={editedListing.material}
            onChange={(e) => handleFieldChange('material', e.target.value)}
          />
          <label>Style</label>
          <input
            type="text"
            value={editedListing.style}
            onChange={(e) => handleFieldChange('style', e.target.value)}
          />
          <label>Color</label>
          <input
            type="text"
            value={editedListing.color}
            onChange={(e) => handleFieldChange('color', e.target.value)}
          />
          <label>Condition</label>
          <select
            value={editedListing.condition_estimate || ''}
            onChange={(e) => handleFieldChange('condition_estimate', e.target.value)}
          >
            <option value="">Select condition...</option>
            <option value="new">New</option>
            <option value="like_new">Like New</option>
            <option value="good">Good</option>
            <option value="used">Used</option>
          </select>
          <label>Hashtags (comma-separated)</label>
          <input
            type="text"
            value={editedListing.hashtags ? editedListing.hashtags.join(', ') : ''}
            onChange={(e) =>
              handleFieldChange('hashtags', e.target.value.split(',').map(h => h.trim()))
            }
          />
          <label>Stock Quantity</label>
          <input
            type="number"
            min="1"
            value={editedListing.stock || 1}
            onChange={(e) => handleFieldChange('stock', Math.max(1, parseInt(e.target.value) || 1))}
          />
          <label>Selling Price *</label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter your selling price"
            value={editedListing.price || ''}
            onChange={(e) => handleFieldChange('price', e.target.value ? parseFloat(e.target.value) : null)}
          />
          <small style={{ color: '#d9534f' }}>Required: Set your actual selling price (suggested: ${editedListing.price_suggestion?.recommended_price || 'N/A'})</small>
          <div className="button-group">
            <button onClick={() => setIsEditing(false)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={() => setIsEditing(false)} className="btn-primary">
              Done Editing
            </button>
          </div>
        </div>
      ) : (
        <div className="listing-preview">
          {/* Display product image */}
          {imageUrl && (
            <div className="image-preview-large">
              <img
                src={imageUrl}
                alt={editedListing.title}
                style={{
                  maxWidth: '100%',
                  maxHeight: '300px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  objectFit: 'cover'
                }}
              />
            </div>
          )}

          <div className="preview-field">
            <strong>Title:</strong> {editedListing.title}
          </div>
          <div className="preview-field">
            <strong>Description:</strong> {editedListing.description}
          </div>
          <div className="preview-field">
            <strong>Brand:</strong> {editedListing.brand || 'N/A'}
          </div>
          <div className="preview-field">
            <strong>Category:</strong> {editedListing.category || 'N/A'}
          </div>
          <div className="preview-field">
            <strong>Size:</strong> {editedListing.size || 'N/A'}
          </div>
          <div className="preview-field">
            <strong>Material:</strong> {editedListing.material || 'N/A'}
          </div>
          <div className="preview-field">
            <strong>Style:</strong> {editedListing.style || 'N/A'}
          </div>
          <div className="preview-field">
            <strong>Color:</strong> {editedListing.color || 'N/A'}
          </div>
          <div className="preview-field">
            <strong>Condition:</strong> {editedListing.condition_estimate || 'N/A'}
          </div>
          <div className="preview-field">
            <strong>Hashtags:</strong> {editedListing.hashtags && editedListing.hashtags.length > 0 ? editedListing.hashtags.join(', ') : 'None'}
          </div>
          <div className="preview-field">
            <strong>Stock Quantity:</strong> {editedListing.stock || 1} units
          </div>
          <div className="preview-field" style={{ backgroundColor: editedListing.price ? '#d4edda' : '#fff3cd', borderLeftColor: editedListing.price ? '#28a745' : '#ffc107' }}>
            <strong>Selling Price:</strong> {editedListing.price ? `$${parseFloat(editedListing.price).toFixed(2)}` : '⚠️ NOT SET'}
          </div>
          {editedListing.price_suggestion && (
            <div className="preview-field" style={{ backgroundColor: '#f0f8ff', borderLeftColor: '#4169e1' }}>
              <strong>Price Suggestion:</strong> {editedListing.price_suggestion.recommended_price ? `$${editedListing.price_suggestion.recommended_price}` : 'Not available'} {editedListing.price_suggestion.min_price && editedListing.price_suggestion.max_price && `($${editedListing.price_suggestion.min_price} - $${editedListing.price_suggestion.max_price})`}
            </div>
          )}
          <div className="button-group">
            <button onClick={() => setIsEditing(true)} className="btn-secondary">
              Edit
            </button>
            <button onClick={handleCreateListing} disabled={loading} className="btn-primary">
              {loading ? 'Creating...' : 'Create Listing'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
