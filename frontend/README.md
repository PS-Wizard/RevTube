# YouTube Video Metadata Fetcher

A professional, production-grade web application built with React and TypeScript to fetch and export video metadata from YouTube playlists.

## Features

- **Secure Authentication**: Google Sign-In restricted to whitelisted domain email addresses
- Fetch up to 50 videos or all videos from any YouTube playlist
- Professional spreadsheet-like table view with video details
- Export data to CSV format
- Real-time API integration with YouTube Data API v3
- Progressive data loading for better UX
- Responsive design with modern UI/UX
- API quota optimization (50% reduction)
- **Organization (Org) Mode**: Multi-tenant support with per-org channel access, tier indicators, and isolated data contexts
- **Org-Scoped Caching**: VideosPage and PlaylistPage use org-suffixed `localStorage` keys (`::org:{orgId}`) to prevent data leakage between personal and org contexts. Each mode has its own independent cache namespace.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- YouTube Data API v3 key
- Firebase project with Google Authentication enabled
- Whitelisted email domain for access

### Installation

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your configuration:
# - YouTube API key
# - Firebase configuration (API key, project ID, etc.)
```

### Firebase Setup

1. **Create Firebase Project:**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project or select an existing one

2. **Enable Google Authentication:**
   - Navigate to **Authentication** > **Sign-in method**
   - Enable **Google** provider
   - Add your domain to **Authorized domains**

3. **Get Firebase Configuration:**
   - Go to **Project Settings** > **General**
   - Scroll to **Your apps** section
   - Click **Web app** icon to create a web app (if not created)
   - Copy the configuration values to your `.env` file

4. **Configure OAuth Consent Screen:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Select your Firebase project
   - Navigate to **APIs & Services** > **OAuth consent screen**
   - Configure the consent screen with your app information

3. Start the development server:
```bash
pnpm dev
```

4. Open your browser and navigate to the local development URL (typically `http://localhost:5173`)

## How to Use

### Step 1: Configure Your YouTube API Key

1. **Get an API Key:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the **YouTube Data API v3**
   - Go to **Credentials** → **Create Credentials** → **API Key**
   - Copy your API key

2. **Add to Environment File:**
   - Open the `.env` file in the project root
   - Set `VITE_YOUTUBE_API_KEY=your_actual_api_key_here`
   - Save the file and restart the dev server

3. **Verify Configuration:**
   - Open the app in your browser
   - Check the sidebar for "API Key: Configured" status (green)
   - If it shows "API Key: Not Set" (red), double-check your .env file

### Step 2: Choose Your Fetch Method

The application supports three ways to fetch videos:

#### Option 1: Playlist ID (Default)
Use any public YouTube playlist:
```
https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxxxxxxxxxxxxx
                                      ↑ This is your Playlist ID
```

#### Option 2: Username/Handle
Fetch all uploads from a channel using their username or handle:
- Modern handles: `@username` (e.g., `@mkbhd`, `@LinusTechTips`)
- Legacy usernames: Just the username without @ (e.g., `pewdiepie`)
- The app will automatically find the channel's uploads playlist

#### Option 3: Channel ID
Use the channel ID directly (starts with `UC`):
```
UCxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
The app will automatically fetch the uploads playlist for that channel

### Step 3: Fetch Video Metadata

1. Ensure your API key is configured (check the green status indicator)
2. Select your **Fetch Mode** (Playlist, Username, or Channel)
3. Enter the corresponding ID, username, or handle
4. Choose options:
   - **Max Results per Request**: Number of videos to fetch (1-50)
   - **Fetch All Videos**: Check this to fetch all videos from the playlist (will use more API quota)
5. Click "Fetch Videos"
6. View results in the dashboard stats and table
7. Click "Export to CSV" to download the data

### Examples

**Fetch from a playlist:**
- Mode: `Playlist`
- Input: `PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf`

**Fetch all videos from a channel by handle:**
- Mode: `Username`
- Input: `@mkbhd` or `mkbhd`

**Fetch all videos from a channel by ID:**
- Mode: `Channel`
- Input: `UCBJycsmduvYEL83R_U4JriQ`

## Video Metadata Included

The application fetches the following metadata for each video:

- Position (order in playlist)
- Thumbnail
- Title (clickable link to video)
- Video ID
- Published date and time
- Channel title
- Description

## CSV Export Format

The exported CSV file includes:
- Position
- Title
- Video ID
- Published At
- Channel Title
- Description
- Thumbnail URL

## API Quota Considerations

The YouTube Data API v3 has daily quota limits:
- Default quota: 10,000 units per day
- Each API request costs approximately 1 unit for `playlistItems.list`

**Recommendations:**
- For playlists with many videos, the "Fetch All" option will make multiple API requests
- Use the "Max Results" option (50) when you only need recent videos
- Monitor your quota usage in the Google Cloud Console

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **CSS3** - Custom styling with modern gradients and animations
- **Kinetika Font** - Professional typography

## Building for Production

```bash
pnpm build
```

The production-ready files will be in the `dist/` directory.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

MIT

## Support

For issues or questions, please refer to the [YouTube Data API documentation](https://developers.google.com/youtube/v3/docs).
