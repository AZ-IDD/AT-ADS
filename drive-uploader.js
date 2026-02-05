/**
 * Google Drive API uploader using OAuth2
 * Uploads screenshots directly to Google Drive and returns shareable links
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'Drive API', 'client_secret_434271007149-31kriqdgfbgtvt4ohrc55hcohjqpr7gb.apps.googleusercontent.com.json');
const TOKEN_PATH = path.join(__dirname, 'Drive API', 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_NAME = 'ADS Screenshots';

let oauth2Client = null;
let cachedFolderId = null;

/**
 * Initialize the OAuth2 client from stored credentials
 */
function getOAuth2Client() {
  if (oauth2Client) return oauth2Client;

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } = credentials.web;

  oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3000/auth/callback'
  );

  // Load saved token if exists
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);

    // Auto-refresh token when it expires
    oauth2Client.on('tokens', (tokens) => {
      const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      const updated = { ...current, ...tokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
      console.log('[Drive] Token refreshed and saved');
    });
  }

  return oauth2Client;
}

/**
 * Get the authorization URL for initial OAuth consent
 */
function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

/**
 * Exchange authorization code for tokens and save them
 */
async function handleAuthCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Save token
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('[Drive] Token saved to', TOKEN_PATH);

  // Listen for future token refreshes
  client.on('tokens', (newTokens) => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    const updated = { ...current, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
    console.log('[Drive] Token refreshed and saved');
  });

  return tokens;
}

/**
 * Check if we have valid credentials (token exists)
 */
function isAuthenticated() {
  if (!fs.existsSync(TOKEN_PATH)) return false;
  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    return !!(token.access_token && token.refresh_token);
  } catch {
    return false;
  }
}

/**
 * Get or create the "ADS Screenshots" folder in Drive
 */
async function getOrCreateFolder(drive) {
  if (cachedFolderId) {
    // Verify folder still exists
    try {
      await drive.files.get({ fileId: cachedFolderId, fields: 'id' });
      return cachedFolderId;
    } catch {
      cachedFolderId = null;
    }
  }

  // Search for existing folder
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive'
  });

  if (res.data.files.length > 0) {
    cachedFolderId = res.data.files[0].id;
    return cachedFolderId;
  }

  // Create folder
  const folder = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id'
  });

  cachedFolderId = folder.data.id;
  console.log('[Drive] Created folder:', FOLDER_NAME);
  return cachedFolderId;
}

/**
 * Upload a base64 image/file to Google Drive
 * @param {string} base64Data - Base64 encoded file content
 * @param {string} filename - Name for the file
 * @param {string} mimeType - MIME type (default: image/png)
 * @returns {object} - { success, fileUrl, fileId, downloadUrl }
 */
async function uploadToDrive(base64Data, filename, mimeType = 'image/png') {
  const client = getOAuth2Client();

  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Visit /auth to authorize Google Drive access.' };
  }

  const drive = google.drive({ version: 'v3', auth: client });

  // Get or create the screenshots folder
  const folderId = await getOrCreateFolder(drive);

  // Convert base64 to buffer
  const buffer = Buffer.from(base64Data, 'base64');

  // Upload file
  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId]
    },
    media: {
      mimeType: mimeType,
      body: require('stream').Readable.from(buffer)
    },
    fields: 'id, webViewLink'
  });

  const fileId = file.data.id;

  // Set sharing: anyone with link can view
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone'
    }
  });

  const downloadUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

  console.log(`[Drive] Uploaded: ${filename} -> ${downloadUrl}`);

  return {
    success: true,
    fileId: fileId,
    fileUrl: file.data.webViewLink,
    downloadUrl: downloadUrl
  };
}

module.exports = {
  getAuthUrl,
  handleAuthCallback,
  isAuthenticated,
  uploadToDrive
};
