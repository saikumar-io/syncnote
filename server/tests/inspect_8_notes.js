const { db } = require('../src/db/database');
const fs = require('fs');

const notes = db.prepare('SELECT id, title, file_path FROM notes WHERE user_id = ?').all('adaf27dc-7bfc-4f2f-9b5a-5e3a2a62885e');
console.log('Total notes:', notes.length);

notes.forEach((n) => {
  let content = '';
  if (fs.existsSync(n.file_path)) {
    content = fs.readFileSync(n.file_path, 'utf8');
  } else {
    content = '[FILE NOT FOUND: ' + n.file_path + ']';
  }
  console.log('--- Note:', n.id, '| Title:', n.title);
  console.log('Content:', content);
});
