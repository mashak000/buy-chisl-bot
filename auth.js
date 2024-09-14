const { google } = require('googleapis');
const fs = require('fs');

function authorize() {
  const credentials = JSON.parse(fs.readFileSync('../credentials.json'));
  const auth = new google.auth.GoogleAuth({
    keyFile: '../credentials.json', // path to your service account JSON
    scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

module.exports = { authorize };