const path = require('path');
const fs = require('fs');
const BetterSqlite3 = require('better-sqlite3');

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'syncnote.db');

console.log('--- SYNCNOTE SQLITE DIAGNOSTIC ---');
console.log('Database Path:', dbPath);
console.log('Database Exists:', fs.existsSync(dbPath));

if (fs.existsSync(dbPath)) {
  const db = new BetterSqlite3(dbPath);
  const notes = db.prepare('SELECT * FROM notes').all();
  console.log(`Found ${notes.length} notes in SQLite:`);
  
  notes.forEach((n, idx) => {
    console.log(`\n[Note #${idx + 1}]`);
    console.log('  ID:', n.id);
    console.log('  Title:', n.title);
    console.log('  User ID:', n.user_id);
    console.log('  Notebook ID:', n.notebook_id);
    console.log('  File Path:', n.file_path);
    console.log('  Content Hash:', n.content_hash);
    console.log('  Current Version ID:', n.current_version_id);
    console.log('  Updated At:', n.updated_at);
    
    let diskExists = false;
    let diskContent = '';
    if (n.file_path) {
      diskExists = fs.existsSync(n.file_path);
      if (diskExists) {
        diskContent = fs.readFileSync(n.file_path, 'utf8');
      }
    }
    console.log('  Disk File Exists:', diskExists);
    console.log('  Disk Content Length:', diskContent.length);
    console.log('  Disk Content Sample:', JSON.stringify(diskContent.substring(0, 100)));
  });

  const versions = db.prepare('SELECT * FROM versions').all();
  console.log(`\nFound ${versions.length} version records in SQLite.`);
  versions.forEach((v) => {
    console.log(`  Version: ${v.id} (Note: ${v.note_id}, V${v.version_number}, Parent: ${v.parent_version_id})`);
  });
}
