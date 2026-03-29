import { useState } from 'react';
import { generateListing, uploadImage } from '../services/api';

export default function ImageUpload({ userId, onListingGenerated, onError }) {
  const [imageUrl, setImageUrl] = useState('');
  const [uploadedImages, setUploadedImages] = useState([]); // Support multiple files
  const [previewUrls, setPreviewUrls] = useState([]); // Support multiple previews
  const [loading, setLoading] = useState(false);
  const [uploadMode, setUploadMode] = useState('url'); // 'url' or 'file'
  const [stock, setStock] = useState(1);

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (!files) return;

    const newImages = [];
    const newPreviews = [];
    let hasError = false;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      if (!file.type.startsWith('image/')) {
        onError(`File ${i + 1}: Not a valid image file`);
        hasError = true;
        continue;
      }

      // Validate file size (max 10MB per file)
      if (file.size > 10 * 1024 * 1024) {
        onError(`File ${i + 1}: Image size must be less than 10MB`);
        hasError = true;
        continue;
      }

      newImages.push(file);

      // Create preview
      const reader = new FileReader();
      reader.onload = (event) => {
        setPreviewUrls((prev) => [...prev, event.target.result]);
      };
      reader.readAsDataURL(file);
    }

    if (!hasError) {
      setUploadedImages(newImages);
      onError(null);
    }
  };

  const handleRemoveImage = (index) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
    setPreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!userId) {
      onError('User not initialized. Please refresh the page.');
      return;
    }

    let imagesToUse = [];

    // If file uploaded, upload all files first and get URLs
    if (uploadMode === 'file' && uploadedImages.length > 0) {
      setLoading(true);
      try {
        imagesToUse = [];
        for (const file of uploadedImages) {
          console.log('Uploading file:', file.name);
          const uploadResponse = await uploadImage(file);
          imagesToUse.push(uploadResponse.image_url);
        }
        console.log('Files uploaded, got URLs:', imagesToUse);
        onError(null);
      } catch (error) {
        console.error('Error uploading files:', error);
        const errorMsg = error.message || 'Failed to upload files';
        onError(errorMsg);
        setLoading(false);
        return;
      }
    } else if (uploadMode === 'url') {
      if (!imageUrl.trim()) {
        onError('Please enter an image URL or upload files');
        return;
      }
      imagesToUse = [imageUrl];
    }

    if (imagesToUse.length === 0) {
      onError('Please provide at least one image');
      return;
    }

    setLoading(true);
    try {
      console.log('Generating listing with userId:', userId, 'stock:', stock, 'images:', imagesToUse);
      const listing = await generateListing(imagesToUse[0], userId, stock, imagesToUse);
      console.log('Generated listing response:', listing);
      onListingGenerated(listing);
      onError(null);
    } catch (error) {
      console.error('Error generating listing:', error);
      const errorMsg = error.message || 'Failed to generate listing';
      onError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>1. Generate Listing</h2>

      {/* Mode Selector */}
      <div className="mode-selector">
        <button
          className={`mode-btn ${uploadMode === 'url' ? 'active' : ''}`}
          onClick={() => {
            setUploadMode('url');
            handleRemoveImage();
          }}
          disabled={loading}
        >
          📎 Image URL
        </button>
        <button
          className={`mode-btn ${uploadMode === 'file' ? 'active' : ''}`}
          onClick={() => {
            setUploadMode('file');
            setImageUrl('');
          }}
          disabled={loading}
        >
          📤 Upload File
        </button>
      </div>

      {/* URL Input Mode */}
      {uploadMode === 'url' && (
        <div className="form-group">
          <label>Image URL</label>
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://example.com/image.jpg"
            disabled={loading}
          />
          <small>Paste a publicly accessible image URL</small>
        </div>
      )}

      {/* File Upload Mode */}
      {uploadMode === 'file' && (
        <div className="form-group">
          <label>Upload Images (Multiple)</label>
          {uploadedImages.length === 0 ? (
            <div className="file-upload-area">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                disabled={loading}
                id="image-input"
              />
              <label htmlFor="image-input" className="file-upload-label">
                <span>🖼️ Click to select images</span>
                <span className="file-upload-hint">or drag and drop (select multiple)</span>
              </label>
            </div>
          ) : (
            <div className="file-selected">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {previewUrls.map((preview, index) => (
                  <div key={index} style={{ position: 'relative' }}>
                    <img
                      src={preview}
                      alt={`Preview ${index + 1}`}
                      style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '6px' }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(index)}
                      className="btn-secondary"
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        padding: '4px 8px',
                        fontSize: '12px',
                        borderRadius: '3px'
                      }}
                      disabled={loading}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="file-info">
                <p><strong>Files selected:</strong> {uploadedImages.length}</p>
                <p><strong>Total size:</strong> {(uploadedImages.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(2)} KB</p>
              </div>
              <label htmlFor="image-input" className="file-upload-label" style={{ marginTop: '12px', display: 'block' }}>
                <span>+ Add more images</span>
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                disabled={loading}
                id="image-input"
                style={{ display: 'none' }}
              />
            </div>
          )}
          <small>Supported: JPG, PNG, GIF, WebP (max 10MB per file). First image will be used for AI analysis.</small>
        </div>
      )}

      {/* Stock Input */}
      <div className="form-group">
        <label>Initial Stock Quantity</label>
        <input
          type="number"
          min="1"
          value={stock}
          onChange={(e) => setStock(Math.max(1, parseInt(e.target.value) || 1))}
          disabled={loading}
        />
        <small>How many units do you have in stock?</small>
      </div>

      <button onClick={handleGenerate} disabled={loading} className="btn-primary">
        {loading ? 'Generating...' : 'Generate Listing'}
      </button>
    </div>
  );
}
