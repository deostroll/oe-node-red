var loopback = require('loopback');
var logger = require('oe-logger');
var log = logger('boot-cleanup');
var options = {
  ignoreAutoScope: true,
  fetchAllScopes: true
};

module.exports = function bootCleanup(server, cb) {
  var TAG = 'bootCleanup()';
  /* istanbul ignore if */
  if (typeof global.it !== 'function') {
    log.debug(TAG, 'We are not is test mode. Skipping cleanup.');
    return cb();
  }

  var NodeRedFlow = loopback.getModelByType('NodeRedFlow');
  var NodeRedCred = loopback.getModelByType('NodeRedCred');

  NodeRedCred.remove({}, options, function removeCb(err, res) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);  
      log.error(TAG, 'Could not delete NodeRedCred records during boot-cleanup' + JSON.stringify(err));
      return cb(err, null);
    }
    log.debug(TAG, 'deleted NodeRedCred records during boot-cleanup');
    NodeRedFlow.remove({}, options, function removeCb(err, res) {
      /* istanbul ignore if */
      if (err) {
        // eslint-disable-next-line no-console
        console.error(err);  
        log.error(TAG, 'Could not delete NodeRedFlow records during boot-cleanup' + JSON.stringify(err));
        return cb(err, null);
      }
      log.debug(TAG, 'deleted NodeRedFlow records during boot-cleanup');
      cb(null, null);
    });
  });
};
