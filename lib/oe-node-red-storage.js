var when = require('when');
var loopback = require('loopback');
var crypto = require('crypto');
var credentialhelper = require('../../node-red/red/runtime/nodes/credentials.js');

var settings = {};
var runtime = {};
var flows = [];
var credentials = {};
var sessions = [];
var libraryEntries = {};
var NodeRedFlows;
var flowsSet = false;
var options = {ignoreAutoScope: true, fetchAllScopes: true};
var encryptionAlgorithm = "aes-256-ctr";
var userKey;
var key;

var storage={

    init: function(_settings, _runtime) {
        settings = _settings;
        runtime = _runtime;
        userKey = settings.get('credentialSecret');
        key = crypto.createHash('sha256').update(userKey).digest();
        NodeRedFlows = loopback.getModelByType('NodeRedFlow');
        NodeRedCred = loopback.getModelByType('NodeRedCred');
    },

    getFlows: function() {
        return when.promise(function(resolve,reject){
            NodeRedFlows.find({}, options, function findCb(err, results) {
                if(err) console.log(err);
                if(!results) results = [];
                return resolve(results);
            });
        });
    },

    saveFlows: function(newflows) {
        return when.promise(function(resolve,reject){
            NodeRedFlows.upsert(newflows, options, function upsertCb(err, results1) {
                if(err) console.log(err);
                return resolve(results1);
            });
        });
    },


    getCredentials: function() {
        return when.promise(function(resolve,reject){
            NodeRedCred.findOne({order: "t DESC"}, options, function findCb(err, results4) {
                if(err) console.log(err);
                if(!results4) results4 = {};
                var res = {};
                if(results4.d) res['$'] = results4.d;
                credentials = res;
                return resolve(credentials);
            });
        });
    },

    saveCredentials: function(_credentials) {
        credentials = _credentials;
        var decrypted1 = decryptCredentials(_credentials);
        var decrypted2;
        return when.promise(function(resolve,reject){
            NodeRedCred.findOne({order: "t DESC"}, options, function findCb(err, results4) {
                if(err) console.log(err);
                if(!results4) results4 = {};
                var res = {};
                if(results4.d) res['$'] = results4.d;
                credentials = res;
                decrypted2 = decryptCredentials(credentials);
                Object.keys(decrypted1).forEach(function(newKey) {
                    if(!decrypted2[newKey]) decrypted2[newKey] = decrypted1[newKey];
                    else {
                        var newCreds = decrypted1[newKey];
                        Object.keys(newCreds).forEach(function(newCredParm) {
                            decrypted2[newKey][newCredParm] = decrypted1[newKey][newCredParm];
                        }); 
                    }
                });
                var encrypted = encryptCredentials(decrypted2);
                NodeRedCred.upsert({d: encrypted.$, t: new Date().getTime()}, options, function upsertCb(err, results2) {
                    if(err) console.log(err);
                    var res = {};
                    res['$'] = results2.d;
                    return resolve(res);
                });
            });
        });
    },

    getSettings: function() {
        return when.promise(function(resolve,reject){
            return resolve(settings);
        });
    },
    
    saveSettings: function(_settings) {
        settings = _settings;
        return when.promise(function(resolve,reject){
            return resolve(settings);
        });
    },

    getSessions: function() {
        return when.promise(function(resolve,reject){
            return resolve(sessions);
        });
    },

    saveSessions: function(_sessions) {
        sessions = _sessions;
        return when.promise(function(resolve,reject){
            return resolve(sessions);
        });
    },

    getLibraryEntry: function(type,path) {
        return when.promise(function(resolve,reject){
            var res = [];
            if(path === '/') {
                Object.keys(libraryEntries).forEach(function(e) {
                    var item = {'type': 'flow'};
                    item['path'] = e;
                    item['body'] = libraryEntries[e];
                    res.push(item);
                });
            } else res = [ { path: libraryEntries[path.replace(/\//g, "_")]} ];
            if(!res) res = [];
            return resolve(res);
        });
    },

    saveLibraryEntry: function(type,path,meta,body) {
        return when.promise(function(resolve,reject){
            libraryEntries[path.replace(/\//g, "_")] = body;
            return resolve(body);
        });
    }

}


function decryptCredentials(credentials) {
    var creds = credentials["$"];
    var initVector = new Buffer(creds.substring(0, 32),'hex');
    creds = creds.substring(32);
    var decipher = crypto.createDecipheriv(encryptionAlgorithm, key, initVector);
    var decrypted = decipher.update(creds, 'base64', 'utf8') + decipher.final('utf8');
    return JSON.parse(decrypted);
}


function encryptCredentials(credentials) {
    var initVector = crypto.randomBytes(16);
    var cipher = crypto.createCipheriv(encryptionAlgorithm, key, initVector);
    return {"$":initVector.toString('hex') + cipher.update(JSON.stringify(credentials), 'utf8', 'base64') + cipher.final('base64')};
}

module.exports=storage;