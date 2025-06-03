// api/drive-state.js
import { google } from 'googleapis';

// These packages should be in your package.json:
//    "googleapis": "^105.0.0"
//    "stream": "latest"
// Vercel automatically installs dependencies.

let driveClient = null;

// Helper: initialize the Drive client exactly once
async function getDriveClient() {
  if (driveClient) return driveClient;

  // 1) Read the service account JSON from env var
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const jwtClient = new google.auth.JWT(
    keyJson.client_email,
    null,
    keyJson.private_key,
    ['https://www.googleapis.com/auth/drive.file']
  );

  // 2) Authorize the JWT (service account)
  await jwtClient.authorize();

  driveClient = google.drive({ version: 'v3', auth: jwtClient });
  return driveClient;
}

// 3) The ID of the file you pre-created (ecotrack_state.json)
const STATE_FILE_ID = '1z3A24MS7kgIV52kmUceEWo10kvMNuBiL'; 

export default async function handler(req, res) {
  const drive = await getDriveClient();

  if (req.method === 'GET') {
    // Download the JSON contents
    try {
      const response = await drive.files.get(
        { fileId: STATE_FILE_ID, alt: 'media' },
        { responseType: 'stream' }
      );

      // Pipe the stream into a string
      let data = '';
      response.data.on('data', (chunk) => (data += chunk));
      response.data.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          res.status(200).json(parsed);
        } catch (e) {
          // If the file was empty or invalid, return {}
          res.status(200).json({});
        }
      });
    } catch (err) {
      console.error('Drive GET error', err);
      res.status(500).json({ error: 'Failed to download state' });
    }
    return;
  }

  if (req.method === 'POST') {
    // Expect body to be a JSON object, e.g. { devices: [...] }
    const newState = req.body;
    if (!newState || typeof newState !== 'object') {
      res.status(400).json({ error: 'Request body must be a JSON object' });
      return;
    }

    // Prepare a multipart upload to overwrite the file
    const boundary = '----EcotrackBoundary' + Date.now();
    const metadata = {
      name: 'ecotrack_state.json',
      mimeType: 'application/json',
    };
    const multipartRequestBody =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      '\r\n--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(newState) +
      `\r\n--${boundary}--`;

    try {
      await drive.files.update({
        fileId: STATE_FILE_ID,
        uploadType: 'multipart',
        requestBody: metadata,
        media: {
          mimeType: 'application/json',
          body: multipartRequestBody,
        },
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
      });
      res.status(200).json({ status: 'ok' });
    } catch (uploadErr) {
      console.error('Drive UPDATE error', uploadErr);
      res.status(500).json({ error: 'Failed to save state' });
    }
    return;
  }

  // Any other method is not allowed
  res.setHeader('Allow', 'GET, POST');
  res.status(405).end('Method Not Allowed');
}
