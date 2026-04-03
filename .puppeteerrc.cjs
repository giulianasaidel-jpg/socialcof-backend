const { join } = require('path');

module.exports = {
  cacheDirectory: join(require('os').homedir(), '.cache', 'puppeteer'),
};
