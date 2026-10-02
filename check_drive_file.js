const { GoogleDriveAuthModel, NoteModel } = require('./server/src/db/database');
const { getValidDriveAccessToken } = require('./server/src/utils/googleSyncService');

async function checkFile() {
  const userId = 'adaf27dc-7bfc-4f2f-9b5a-5e3a2a62885e';
  const auth = GoogleDriveAuthModel.get(userId);
  if (!auth || (!auth.accessToken && !auth.refreshToken)) {
    console.log('No auth found for user', userId);
    return;
  }
  console.log('Got auth record for user. Token:', auth.accessToken?.substring(0, 15));

  const fileId = '1aXxBIVYbgtde2UAQKkYSwwyjVRNBMZdZ';
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,parents,trashed,size`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });

  const mediaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  const text = await mediaRes.text();
  console.log('--- RAW CONTENT FROM DRIVE ---');
  console.log(JSON.stringify(text));
  console.log('--- FORMATTED CONTENT ---');
  console.log(text);

  // Also check folder files
  if (data.parents && data.parents[0]) {
    const folderId = data.parents[0];
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,trashed)`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
    const listData = await listRes.json();
    console.log('Folder files:', JSON.stringify(listData, null, 2));
  }
}

checkFile().catch(console.error);
