import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

console.log('[API] Initialized with base URL:', API_BASE_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Helper to extract error message
const getErrorMessage = (error) => {
  const fullData = error.response?.data;
  console.log('[API] Full error response:', JSON.stringify(fullData, null, 2));

  // Handle Pydantic validation errors (list of objects)
  if (Array.isArray(fullData)) {
    const msgs = fullData.map(err => {
      if (err.msg) return err.msg;
      if (err.detail) return err.detail;
      return JSON.stringify(err);
    }).join('; ');
    return `Validation Error: ${msgs}`;
  }

  // Handle standard error response with detail field
  if (fullData?.detail) {
    if (typeof fullData.detail === 'string') {
      return fullData.detail;
    } else if (Array.isArray(fullData.detail)) {
      const msgs = fullData.detail.map(err => {
        if (typeof err === 'string') return err;
        if (err.msg) return err.msg;
        return JSON.stringify(err);
      }).join('; ');
      return `Validation Error: ${msgs}`;
    }
  }

  // Handle other error formats
  if (fullData?.message) return fullData.message;
  if (fullData?.error) return fullData.error;
  if (typeof fullData === 'string') return fullData;

  return error.message || 'Unknown error';
};

export const generateListing = async (imageUrl, userId, stock = 1, additionalImages = []) => {
  try {
    console.log('[API] Calling POST /listings/generate with URL:', imageUrl, 'user_id:', userId, 'stock:', stock, 'additional images:', additionalImages.length);
    const response = await api.post('/listings/generate', {
      image_url: imageUrl,
      user_id: userId,
      stock: stock,
      additional_image_urls: additionalImages.length > 1 ? additionalImages.slice(1) : [],
    });
    console.log('[API] Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('[API] Error:', error.message);
    const msg = getErrorMessage(error);
    console.error('[API] Extracted error message:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export const createListing = async (listingData, userId) => {
  try {
    const payload = {
      ...listingData,
      user_id: userId,
    };
    const response = await api.post('/listings', payload);
    return response.data;
  } catch (error) {
    const msg = getErrorMessage(error);
    console.error('[API] Extracted error message:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export const publishListing = async (listingId) => {
  try {
    const response = await api.post(`/listings/${listingId}/publish`);
    return response.data;
  } catch (error) {
    const msg = getErrorMessage(error);
    console.error('[API] Extracted error message:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export const repostListing = async (listingId, stock = 1) => {
  try {
    console.log('[API] Reposting listing:', listingId, 'with stock:', stock);
    const response = await api.post(`/listings/${listingId}/repost`, {
      stock: stock,
    });
    return response.data;
  } catch (error) {
    const msg = getErrorMessage(error);
    console.error('[API] Error reposting listing:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export const updateListingStock = async (listingId, quantitySold) => {
  try {
    console.log('[API] Updating stock for listing:', listingId, 'quantity sold:', quantitySold);
    const response = await api.patch(`/listings/${listingId}/stock`, {
      quantity_sold: quantitySold,
    });
    return response.data;
  } catch (error) {
    const msg = getErrorMessage(error);
    console.error('[API] Error updating stock:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export const deleteListing = async (listingId) => {
  try {
    console.log('[API] Deleting listing:', listingId);
    await api.delete(`/listings/${listingId}`);
    console.log('[API] Listing deleted successfully');
  } catch (error) {
    const msg = getErrorMessage(error);
    console.error('[API] Error deleting listing:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export const getJobStatus = async (jobId) => {
  const response = await api.get(`/jobs/${jobId}`);
  return response.data;
};

export const getListings = async () => {
  const response = await api.get('/listings');
  return response.data;
};

export const createUser = async (email, password) => {
  try {
    console.log('[API] Creating test user with email:', email);
    const response = await api.post('/users', {
      email,
      password,
    });
    console.log('[API] User created:', response.data);
    return response.data;
  } catch (error) {
    const msg = getErrorMessage(error);
    console.error('[API] Error creating user:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export const uploadImage = async (file) => {
  try {
    console.log('[API] Uploading image file:', file.name, 'size:', file.size);
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/listings/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    console.log('[API] Upload response:', response.data);
    return response.data;
  } catch (error) {
    const msg = getErrorMessage(error);
    console.error('[API] Error uploading image:', msg);
    const customError = new Error(msg);
    customError.response = error.response;
    throw customError;
  }
};

export default api;
