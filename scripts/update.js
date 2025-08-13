const fs = require('fs');
const https = require('https');

/*
 * This script fetches the khoindvn.io.vn homepage and attempts to detect the
 * availability status of the KSign and eSign tools. It updates the
 * local `data/statuses.json` file accordingly. Running this script
 * regularly via GitHub Actions ensures that the status badges on the
 * website stay up to date with the upstream source. If fetching fails
 * or parsing does not succeed, the current values in the JSON are left
 * unchanged.
 */

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', err => reject(err));
  });
}

async function updateStatuses() {
  const jsonPath = 'data/statuses.json';
  let statuses;
  try {
    statuses = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error('Unable to read statuses.json', err);
    return;
  }
  try {
    const html = await fetchHtml('https://khoindvn.io.vn/');
    /*
     * Extract availability and download URLs for each tool. The upstream site
     * lists each tool (e.g. "KSign", "eSign", "KSign BMW", "eSign VNJ")
     * along with an accompanying check mark (✅) if the tool is currently
     * available. It also contains download links via loadly.io. To ensure
     * our data stays current we parse both the status indicator and the
     * associated href. The regular expressions search forward up to 200
     * characters to capture the nearest anchor tag after the tool name.
     */
    function extractStatus(name) {
      const regex = new RegExp(name + "[^\u{2705}\u{274C}]{0,10}[\u{2705}\u{274C}]", 'iu');
      const match = html.match(regex);
      if (match) {
        const char = match[0].match(/[\u{2705}\u{274C}]/u)[0];
        return char === '✅';
      }
      return false;
    }
    function extractUrl(name) {
      const regex = new RegExp(name + "[\\s\\S]{0,200}?href=\"([^\"]+)\"", 'iu');
      const match = html.match(regex);
      if (match) {
        return match[1];
      }
      return null;
    }
    statuses.tools = statuses.tools.map(tool => {
      // Determine status by scanning for check/cross icons near the tool name
      const status = extractStatus(tool.name.replace(/\s+V?1?$/i, ''));
      if (status !== undefined) {
        tool.status = status;
      }
      // Update the download URL if a new one is found
      const newUrl = extractUrl(tool.name);
      if (newUrl) {
        tool.url = newUrl;
      }
      return tool;
    });
    // Write the updated JSON back to disk
    fs.writeFileSync(jsonPath, JSON.stringify(statuses, null, 2));
    console.log('Updated statuses.json');
  } catch (err) {
    console.error('Failed to fetch remote site', err);
  }
}

updateStatuses();