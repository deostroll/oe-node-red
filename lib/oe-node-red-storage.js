/**
 *
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */

/**
 * This file is an implementation of a Node-RED storage module for use with an
 * oe-cloud based application. (See https://nodered.org/docs/api/storage/)
 *  It is responsible for storing node-red flows into database (instead of
 * the filesystem) and fetching the same back from the DB.
 *
 * Author : Ajith Vasudevan
 **/


const when = require('when');
const loopback = require('loopback');
const crypto = require('crypto');
const async = require('async');
var settings = {};
var credentials = {};
var sessions = [];
// Model used to store Flows
var NodeRedFlows;

// Model used to store Credentials
var NodeRedCred;

var options = {
  ignoreAutoScope: true,
  fetchAllScopes: true
};

// Encryption Algotithm used by default in Node-RED
var encryptionAlgorithm = 'aes-256-ctr';

// This variable stores the user-specified key for encryption
var userKey;

// The key used by the crypto algorithm
var key;


// The object that implements the storage functions (https://nodered.org/docs/api/storage/methods/)
var storage = {

  // Initializes settings and other variables
  init: function (_settings, _runtime) {
    settings = _settings;
    userKey = settings.get('credentialSecret');
    key = crypto.createHash('sha256').update(userKey).digest();
    NodeRedFlows = loopback.getModelByType('NodeRedFlow');
    NodeRedCred = loopback.getModelByType('NodeRedCred');
  },

  // Fetches the flows from the database, without any filter. This is
  // required asNode-RED caches the returned flows and uses the same
  // for execution. A partial (filtered) list of flows would cause
  // only partial flows to be executed.
  getFlows: function () {
    return when.promise(function (resolve, reject) {
      NodeRedFlows.find({}, options, function findCb(err, results) {
        var res;
        /* istanbul ignore if */
        if (err) {
          // eslint-disable-next-line no-console
          console.log(err);
        } else if (!results) res = [];
        else {
          res = [];
          results.forEach(function (result) {
            res.push(result.node);
          });
        }
        return resolve(res);
      });
    });
  },

  // Saves the specified flows into the database. The incoming flows are
  // the same as the body of the /red/flows POST request. This is ensured to
  // be the complete list of flows from the node-red.js boot script.
  saveFlows: function (newflows) {
    return when.promise(function (resolve, reject) {
      NodeRedFlows.remove({}, options, function findCb(err, results) {
        if (err) {
          return reject(err);
        }
        async.forEachLimit(newflows, 10, function (item, done) {
          NodeRedFlows.upsert({ id: item.id, node: item }, item.callContext, done);
        },
        function (err) {
          if (err) {
            return reject(err);
          }
          return resolve(newflows);
        });
      });
    });
  },

  // Fetches the latest credentials record from the database.
  // Node-RED used "$" as the key for the credentials, but
  // Loopback cannot handle "$" as a key, hence credentials are
  // stored with "d" as key, and changed on the fly to '$' when
  // required, as below.
  getCredentials: function () {
    return when.promise(function (resolve, reject) {
      NodeRedCred.findOne({
        order: 't DESC'
      }, options, function findCb(err, results4) {
        /* istanbul ignore if */
        if (err) {
          // eslint-disable-next-line no-console
          console.log(err);
        }
        if (!results4) results4 = {};
        var res = {};
        if (results4.d) res.$ = results4.d;
        credentials = res;
        return resolve(credentials);
      });
    });
  },

  // Adds/Updates the specified credentials into the credentials
  // already in the database.
  // Node-RED sends the current credentials from the UI to
  // this function. We need to, however, update the complete
  // credentials available in the DB with the one sent.
  // Hence, we decrypt the input credentials, do a DB query
  // to retrieve the complete encrypted creds from DB,
  // decrypt it, merge the two decrypted JSONs, encrypt the
  // result, and save the encrypted result back into the DB.
  saveCredentials: function (_credentials) {
    credentials = _credentials;
    var decrypted1 = decryptCredentials(_credentials);
    var decrypted2;
    return when.promise(function (resolve, reject) {
      NodeRedCred.findOne({
        order: 't DESC'
      }, options, function findCb(err, results4) {
        /* istanbul ignore if */
        if (err) {
          // eslint-disable-next-line no-console
          console.log(err);
        }
        if (!results4) results4 = {};
        var res = {};
        if (results4.d) {
          res.$ = results4.d;
          credentials = res;
          decrypted2 = decryptCredentials(credentials);
        } else decrypted2 = {};
        Object.keys(decrypted1).forEach(function (newKey) {
          if (!decrypted2[newKey]) decrypted2[newKey] = decrypted1[newKey];
          else {
            var newCreds = decrypted1[newKey];
            Object.keys(newCreds).forEach(function (newCredParm) {
              decrypted2[newKey][newCredParm] = decrypted1[newKey][newCredParm];
            });
          }
        });
        var encrypted = encryptCredentials(decrypted2);
        NodeRedCred.upsert({
          d: encrypted.$,
          t: new Date().getTime()
        }, options, function upsertCb(err, results2) {
          /* istanbul ignore if */
          if (err) {
            // eslint-disable-next-line no-console
            console.log(err);
          }
          var res = {};
          res.$ = results2.d;
          return resolve(res);
        });
      });
    });
  },

  // Fetches the settings (which was initialized through init())
  getSettings: function () {
    return when.promise(function (resolve, reject) {
      return resolve(settings);
    });
  },

  // Saves the settings. This is in memory as we don't want to
  // persist any settings changes while server is up.
  saveSettings: function (_settings) {
    settings = _settings;
    return when.promise(function (resolve, reject) {
      return resolve(settings);
    });
  },

  // Fetches Node-RED sessions. This is in-memory, and we're not
  // using this, since we use Loopback session instead.
  getSessions: function () {
    /* istanbul ignore next */
    return when.promise(function (resolve, reject) {
      return resolve(sessions);
    });
  },

  // Saves Node-RED sessions. This is in-memory, and we're not
  // using this, since we use Loopback session instead.
  saveSessions: function (_sessions) {
    /* istanbul ignore next */
    sessions = _sessions;
    /* istanbul ignore next */
    return when.promise(function (resolve, reject) {
      return resolve(sessions);
    });
  },

  // Fetches Node-RED Library Entries. This is in-memory, and
  // we're not using this, since we're disabling Libraries while in
  // DB Storage mode.
  getLibraryEntry: function (type, path) {
    return when.promise(function (resolve, reject) {
      return resolve([]);
    });
  },

  // Saves Node-RED Library Entries. This is in-memory, and
  // we're not using this, since we're disabling Libraries while in
  // DB Storage mode.
  saveLibraryEntry: function (type, path, meta, body) {
    return when.promise(function (resolve, reject) {
      return reject('Library is disabled');
    });
  }

};

// This function is the same as the one in
// ../../node-red/red/runtime/nodes/credentials.js.
// It is used to decrypt the credentials to JSON.
// Re-implemented here as it is not exported from NR
function decryptCredentials(credentials) {
  var creds = credentials.$;
  var initVector = new Buffer(creds.substring(0, 32), 'hex');
  creds = creds.substring(32);
  var decipher = crypto.createDecipheriv(encryptionAlgorithm, key, initVector);
  var decrypted = decipher.update(creds, 'base64', 'utf8') + decipher.final('utf8');
  return JSON.parse(decrypted);
}


// This function is the same as the one in
// ../../node-red/red/runtime/nodes/credentials.js.
// It is used to encrypt the JSON credentials.
// Re-implemented here as it is not exported from NR
function encryptCredentials(credentials) {
  var initVector = crypto.randomBytes(16);
  var cipher = crypto.createCipheriv(encryptionAlgorithm, key, initVector);
  return {
    '$': initVector.toString('hex') + cipher.update(JSON.stringify(credentials), 'utf8', 'base64') + cipher.final('base64')
  };
}

module.exports = storage;
