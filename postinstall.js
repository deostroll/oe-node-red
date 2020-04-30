var fs = require('fs');
var deleteFolderRecursive = function (path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function (file, index) {
      var curPath = path + '/' + file;
      // recurse
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};
var initDir = process.env.INIT_CWD;
deleteFolderRecursive(initDir + '/node_modules/node-red-node-email');
deleteFolderRecursive(initDir + '/node_modules/mailparser');
deleteFolderRecursive(initDir + '/node_modules/mimelib');
// eslint-disable-next-line no-console
console.log('Removed node-red-node-email module');
