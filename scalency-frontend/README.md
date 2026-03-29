# Scalency Frontend - Testing Dashboard

A React-based testing dashboard for the Scalency resale marketplace backend API. This frontend allows you to test all core flows of the Scalency platform from image upload through listing publication.

## Features

- 🖼️ **Image Upload**: Input image URLs to generate AI-powered listings
- ✨ **AI Listing Generation**: Automatically generate listing attributes using the backend API
- ✏️ **Listing Preview & Edit**: Review and edit generated listing details before creation
- 📋 **Create Listings**: Save generated listings to the backend
- 🚀 **Publish Listings**: Publish listings and track job status
- 📊 **Job Polling**: Real-time polling of background job status (updates every 2 seconds)
- 🎯 **Listings Feed**: View all created listings with their status and pricing

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Axios** - HTTP client for API communication
- **Plain CSS** - Styling (no external CSS frameworks)

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- The Scalency backend API running at `http://localhost:8000/api/v1`

## Installation

```bash
npm install
```

## Running the Development Server

```bash
npm run dev
```

The application will start at `http://localhost:5173`

## Building for Production

```bash
npm run build
```

The optimized build will be in the `dist/` directory.

## Project Structure

```
scalency-frontend/
├── src/
│   ├── components/
│   │   ├── ImageUpload.jsx       # Image URL input and generation
│   │   ├── GeneratedListing.jsx  # Preview and edit generated listings
│   │   └── ListingsTable.jsx     # Display all listings
│   │
│   ├── services/
│   │   └── api.js                # Axios configuration and API endpoints
│   │
│   ├── App.jsx                   # Main application component
│   ├── main.jsx                  # React entry point
│   └── styles.css                # Global styles
│
├── index.html                    # HTML entry point
├── package.json                  # Dependencies and scripts
├── vite.config.js                # Vite configuration
└── README.md                     # This file
```

## API Integration

The frontend communicates with the following backend endpoints:

### Generate Listing
```
POST /api/v1/listings/generate
Body: { image_url: "string" }
```

### Create Listing
```
POST /api/v1/listings
Body: {
  title, description, brand, category, material, style, color,
  hashtags, image_urls, stock
}
```

### Publish Listing
```
POST /api/v1/listings/{id}/publish
Response: { job_id, status }
```

### Poll Job Status
```
GET /api/v1/jobs/{job_id}
Response: { status: "pending | success | failed" }
```

### List Listings
```
GET /api/v1/listings
Response: { items, total }
```

## Workflow

1. **Enter Image URL**: Paste an image URL in the input field
2. **Generate Listing**: Click "Generate Listing" to create AI-generated attributes
3. **Review & Edit**: Check the generated attributes and edit if needed
4. **Create Listing**: Save the listing to the backend by clicking "Create Listing"
5. **Publish Listing**: Click "Publish Listing" to trigger the publication process
6. **Monitor Job**: Watch the job status poll in real-time (updates every 2 seconds)
7. **View Results**: Check the "Listings Feed" panel to see all created listings

## Error Handling

The application displays error messages for:
- Failed API requests
- Network connectivity issues
- Invalid input validation
- Backend errors

All errors are shown in a red banner at the top of the page.

## Features

### Real-time Job Polling
The dashboard automatically polls job status every 2 seconds after publishing a listing. Polling stops when the job completes (success or failed).

### Editable Preview
Before creating a listing, you can edit any of the generated attributes:
- Title, Description, Brand, Category
- Material, Style, Color
- Hashtags

### Responsive Design
The dashboard is responsive and adapts to different screen sizes. On mobile devices, panels stack vertically.

## Development

### File Organization
- Components are in `src/components/`
- API communication is centralized in `src/services/api.js`
- All styles are in `src/styles.css`

### State Management
The app uses React hooks (useState, useEffect) for state management:
- Generated listings are stored in `generatedListing`
- Created listings are tracked via `createdListingId`
- Job data is stored in `jobId` and `jobStatus`

### Styling Approach
Plain CSS with a focus on clarity and maintainability. The design uses:
- Gradient backgrounds (purple theme)
- Card-based layout
- Clear visual hierarchy
- Accessible color schemes

## Testing the API

Example workflow to test the entire system:

1. Use this test image URL:
   ```
   https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400
   ```

2. Click "Generate Listing" to create AI attributes

3. Review the generated data (feel free to edit)

4. Click "Create Listing" to save it

5. Click "Publish Listing" to start the publication process

6. Watch the job status in real-time

7. Check the "Listings Feed" to see your published listing

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Troubleshooting

### Backend Connection Error
If you see "Failed to generate listing" or similar errors:
- Ensure the backend is running on `http://localhost:8000`
- Check that CORS is enabled on the backend
- Verify the API endpoints match the backend documentation

### No Listings Showing
- Click "Refresh Listings" in the Listings Feed panel
- Ensure you've successfully created and published listings

### Job Polling Not Starting
- Check that the listing was created successfully
- Verify the publishing was initiated (you should see the job status section appear)

## License

MIT

## Support

For issues or questions about this frontend, please check the backend API documentation or contact the Scalency team.
